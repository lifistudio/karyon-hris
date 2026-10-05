import type { DynamicValue } from "./schema";
import { createHash } from "node:crypto";
import type { Database } from "./model";
import { descriptor, ident, literal, sqlType } from "./schema";
import { SqlBuilder } from "./query";

const name = (prefix: string, source: string) => `${prefix}_${createHash("sha256").update(source).digest("hex").slice(0,16)}`;
export function schemaStatements(database: Database) {
  const statements: string[] = [], relations: string[] = [];
  for (const repository of database.repositories.values()) {
    const table = ident(repository.table);
    const columns = Object.entries(repository.shape).map(([key, raw]) => {
      const field = descriptor(raw), column = ident(key), type = sqlType(raw);
      let sql = `${column} ${type}${key === "_id" ? " PRIMARY KEY" : field.required ? " NOT NULL" : ""}`;
      if (field.enum && type === "text") sql += ` CHECK (${column} IN (${field.enum.map(v=>literal(String(v))).join(",")}))`;
      if (type === "double precision") {
        sql += ` CHECK (${column} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))`;
        if (field.min !== undefined) sql += ` CHECK (${column} >= ${Number(field.min)})`;
        if (field.max !== undefined) sql += ` CHECK (${column} <= ${Number(field.max)})`;
      }
      if (type === "text" && field.maxlength !== undefined) sql += ` CHECK (length(${column}) <= ${Number(field.maxlength)})`;
      if (field.ref && type === "text") {
        const target = database.repositories.get(field.ref);
        if (!target) throw new Error(`Unregistered foreign key target ${field.ref}`);
        relations.push(`ALTER TABLE ${table} ADD CONSTRAINT ${ident(name("fk", `${repository.table}.${key}`))} FOREIGN KEY (${column}) REFERENCES ${ident(target.table)} ("_id") DEFERRABLE INITIALLY DEFERRED`);
      }
      return sql;
    });
    columns.push('"_extra" jsonb NOT NULL DEFAULT \'{}\'::jsonb', '"_version" bigint NOT NULL DEFAULT 0');
    statements.push(`CREATE TABLE ${table} (${columns.join(",\n")})`);
    const indexes = [...repository.schema.indexes];
    for (const [key, raw] of Object.entries(repository.shape)) { const field = descriptor(raw); if (field.unique || field.index) indexes.push({ fields: { [key]: 1 }, options: { unique: field.unique, sparse: field.sparse } }); }
    indexes.forEach((index, number) => {
      const keys = Object.keys(index.fields); let where = "";
      if (index.options.expireAfterSeconds !== undefined) return; // PostgreSQL retention is an explicit maintenance command.
      if (Object.values(index.fields).some(v=>v==="text")) {
        const expression = keys.map(k=>`COALESCE(${ident(k)}, '')`).join(" || ' ' || ");
        statements.push(`CREATE INDEX ${ident(name("fts", repository.table+number))} ON ${table} USING gin (to_tsvector('simple', ${expression}))`); return;
      }
      if (index.options.partialFilterExpression) {
        const filter = structuredClone(index.options.partialFilterExpression);
        for (const [key,value] of Object.entries(filter)) if ((value as DynamicValue)?.$type === "objectId") filter[key] = { $ne: null };
        const builder = new SqlBuilder(repository.shape, "");
        where = builder.condition(filter).replace(/\."/g,'"').replace(/\$(\d+)/g, (_match, number) => {
          const value = builder.values[Number(number)-1]; return value == null ? "NULL" : typeof value === "boolean" ? String(value) : literal(String(value));
        });
      } else if (index.options.sparse) where = keys.map(k=>`${ident(k)} IS NOT NULL`).join(" AND ");
      statements.push(`CREATE ${index.options.unique ? "UNIQUE " : ""}INDEX ${ident(name("idx", repository.table+number))} ON ${table} (${keys.map(k=>`${ident(k)} ${Number(index.fields[k])<0 ? "DESC" : "ASC"}`).join(",")})${where?` WHERE ${where}`:""}`);
    });
  }
  return [...statements, ...relations];
}

/** Raised when the database was created by another application version. */
export class SchemaMismatchError extends Error {
  code = "SCHEMA_MISMATCH";
  constructor(detail: string) {
    super(`${detail} Database ini dibuat oleh versi aplikasi lain. Untuk database uji/dummy, kosongkan dengan "npm run db:reset -- --confirm=<nama database>" lalu jalankan lagi; untuk data penting, cadangkan dulu.`);
  }
}

const SCHEMA_TABLE = '"_schema"';

/**
 * Creates the complete schema on an empty database in one step: tables from the
 * registered models, then `extra` statements (hand-written tables and singleton
 * rows). A database already created with the same schema is left untouched; any
 * other non-empty database is refused instead of being altered.
 */
export async function setupSchema(database: Database, name: string, extra: string[] = []) {
  const statements = [...schemaStatements(database), ...extra];
  const checksum = createHash("sha256").update(statements.join(";\n")).digest("hex");
  let created = false;
  await database.transaction(async () => {
    await database.connection.query("SELECT pg_advisory_xact_lock(hashtext('hris-schema-setup'))");
    // A failed query would abort this transaction, so look the marker table up first.
    const hasMarker = (await database.connection.query("SELECT to_regclass('_schema') IS NOT NULL AS present")).rows[0].present;
    const marker = hasMarker ? await database.connection.query(`SELECT checksum FROM ${SCHEMA_TABLE} WHERE name=$1`, [name]) : null;
    if (marker?.rows.length) {
      if (marker.rows[0].checksum !== checksum) throw new SchemaMismatchError("Struktur database tidak sama dengan versi aplikasi ini.");
      return;
    }
    const tables = await database.connection.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_schema'");
    if (tables.rows[0].total > 0) throw new SchemaMismatchError("Database sudah berisi tabel yang tidak dibuat oleh versi aplikasi ini.");
    await database.connection.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA_TABLE} (name text PRIMARY KEY, checksum text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    for (const statement of statements) await database.connection.query(statement);
    await database.connection.query(`INSERT INTO ${SCHEMA_TABLE} (name,checksum) VALUES ($1,$2)`, [name, checksum]);
    created = true;
  });
  return { tables: database.repositories.size, checksum, created };
}

/**
 * Drops every table, view, sequence and function in the current schema. Only for
 * test/dummy databases; the caller must confirm with the exact database name.
 */
export async function resetSchema(database: Database, confirmName: string) {
  const current = (await database.connection.query("SELECT current_database() AS name")).rows[0].name as string;
  if (!confirmName || confirmName !== current) throw new Error(`Konfirmasi tidak cocok. Jalankan dengan --confirm=${current} untuk menghapus seluruh isi database ini.`);
  await database.transaction(async () => {
    const tables = await database.connection.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
    for (const { tablename } of tables.rows) await database.connection.query(`DROP TABLE IF EXISTS ${ident(tablename)} CASCADE`);
    const functions = await database.connection.query("SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.prokind = 'f'");
    for (const { signature } of functions.rows) await database.connection.query(`DROP FUNCTION IF EXISTS ${signature} CASCADE`);
  });
  return { database: current, dropped: "all" };
}

export async function purgeExpired(database: Database) {
  let count = 0;
  for (const repository of database.repositories.values()) {
    const policies = Object.entries(repository.shape).filter(([,v])=>descriptor(v).expires !== undefined).map(([key,v])=>({ key, seconds: Number(descriptor(v).expires) }));
    for (const index of repository.schema.indexes) if (index.options.expireAfterSeconds !== undefined) policies.push({ key: Object.keys(index.fields)[0], seconds: Number(index.options.expireAfterSeconds) });
    for (const policy of policies) {
      const result = await database.connection.query(`DELETE FROM ${ident(repository.table)} WHERE ${ident(policy.key)} < now() - ($1 * interval '1 second')`, [policy.seconds]); count += result.rowCount ?? 0;
    }
  }
  return count;
}
