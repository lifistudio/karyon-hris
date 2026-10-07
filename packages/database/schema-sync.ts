import { createHash, randomBytes } from "node:crypto";
import type { Database } from "./model";
import { ident } from "./schema";

/**
 * Brings a PostgreSQL database to the schema of the running version, safely.
 *
 * The target schema is built in a temporary "shadow" schema from the same
 * CREATE statements a fresh installation uses, then compared with the live
 * schema. Only additive or relaxing changes are applied:
 *   - missing tables, columns, indexes, functions and triggers are created;
 *   - CHECK/foreign-key rules are replaced by the version's own rules
 *     (added NOT VALID, so existing rows are never rejected);
 *   - NOT NULL is only relaxed, never tightened on existing data.
 * Tables, columns and rows are never dropped or rewritten, so a database can
 * move to a newer version and back to an older one (rollback) without loss.
 * Every run that changed something is recorded in `_schema_history`.
 */

export interface SyncResult {
  name: string;
  checksum: string;
  /** True when the database was empty and the whole schema was created. */
  created: boolean;
  /** Human-readable list of applied changes (empty when already up to date). */
  changes: string[];
  /** Changes that were skipped because they could not be applied safely. */
  warnings: string[];
}

const INTERNAL = new Set(["_schema", "_schema_history", "_schema_migrations"]);
type Row = Record<string, unknown>;

async function rows<T extends Row>(database: Database, sql: string, params: unknown[] = []) {
  return (await database.connection.query(sql, params)).rows as T[];
}

/** Runs a statement that may fail (duplicates, conflicting data) without aborting the transaction. */
async function attempt(database: Database, sql: string, warnings: string[], label: string) {
  const savepoint = `sp_${randomBytes(4).toString("hex")}`;
  await database.connection.query(`SAVEPOINT ${savepoint}`);
  try {
    await database.connection.query(sql);
    await database.connection.query(`RELEASE SAVEPOINT ${savepoint}`);
    return true;
  } catch (error) {
    await database.connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    warnings.push(`${label}: ${(error as Error).message}`);
    return false;
  }
}

const tableOf = (statement: string) => /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i.exec(statement)?.[1] ?? null;
const isInsert = (statement: string) => /^\s*INSERT\s+INTO\s/i.test(statement);

/** Removes the shadow schema name from catalog output so definitions compare equal. */
const unqualify = (text: string, shadow: string) => text.split(`${shadow}.`).join("").split(`"${shadow}".`).join("");

async function ensureMarkerTables(database: Database) {
  await database.connection.query(`CREATE TABLE IF NOT EXISTS "_schema" (name text PRIMARY KEY, checksum text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await database.connection.query(`ALTER TABLE "_schema" ADD COLUMN IF NOT EXISTS app_version text NOT NULL DEFAULT ''`);
  await database.connection.query(`ALTER TABLE "_schema" ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
  await database.connection.query(`CREATE TABLE IF NOT EXISTS "_schema_history" (
    id bigserial PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, app_version text NOT NULL DEFAULT '',
    changes jsonb NOT NULL DEFAULT '[]'::jsonb, warnings jsonb NOT NULL DEFAULT '[]'::jsonb, applied_at timestamptz NOT NULL DEFAULT now())`);
}

export async function syncSchema(database: Database, name: string, statements: string[], appVersion = ""): Promise<SyncResult> {
  const checksum = createHash("sha256").update(statements.join(";\n")).digest("hex");
  const changes: string[] = [], warnings: string[] = [];
  let created = false;

  await database.transaction(async () => {
    await database.connection.query("SELECT pg_advisory_xact_lock(hashtext('hris-schema-setup'))");
    const [{ current }] = await rows<{ current: string }>(database, "SELECT current_schema() AS current");
    const hasMarker = (await rows<{ present: boolean }>(database, "SELECT to_regclass('_schema') IS NOT NULL AS present"))[0].present;
    if (hasMarker) {
      const marker = await rows<{ checksum: string }>(database, `SELECT checksum FROM "_schema" WHERE name=$1`, [name]);
      // Same version as last time: nothing to compare.
      if (marker[0]?.checksum === checksum) return;
    }

    const existing = await rows<{ total: number }>(database, "SELECT count(*)::int AS total FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT LIKE '\\_schema%'");
    if (existing[0].total === 0) {
      // Empty database: create everything directly (same statements, same order).
      for (const statement of statements) await database.connection.query(statement);
      created = true;
      changes.push("Skema lengkap dibuat di database kosong.");
    } else {
      await diffAndApply(database, statements, current, changes, warnings);
    }

    await ensureMarkerTables(database);
    await database.connection.query(
      `INSERT INTO "_schema"(name,checksum,app_version,updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(name) DO UPDATE SET checksum=EXCLUDED.checksum,app_version=EXCLUDED.app_version,updated_at=now()`,
      [name, checksum, appVersion],
    );
    await database.connection.query(`INSERT INTO "_schema_history"(name,checksum,app_version,changes,warnings) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
      [name, checksum, appVersion, JSON.stringify(changes), JSON.stringify(warnings)]);
  });
  return { name, checksum, created, changes, warnings };
}

async function diffAndApply(database: Database, statements: string[], current: string, changes: string[], warnings: string[]) {
  const shadow = `_schema_shadow_${randomBytes(6).toString("hex")}`;
  const q = (sql: string, params: unknown[] = []) => database.connection.query(sql, params);

  // 1. Build the target schema in the shadow schema.
  await q(`CREATE SCHEMA ${ident(shadow)}`);
  await q(`SET LOCAL search_path TO ${ident(shadow)}`);
  for (const statement of statements) await q(statement);
  await q(`SET LOCAL search_path TO ${ident(current)}`);

  const relations = async (schema: string) => new Set((await rows<{ name: string }>(database, "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p')", [schema])).map((r) => r.name));
  const targetTables = await relations(shadow);
  let liveTables = await relations(current);

  // 2. Missing tables: run their own CREATE statement in the live schema.
  for (const statement of statements) {
    const table = tableOf(statement);
    if (!table || INTERNAL.has(table) || liveTables.has(table) || !targetTables.has(table)) continue;
    await q(statement);
    changes.push(`Tabel baru: ${table}`);
  }
  liveTables = await relations(current);

  // 3. Sequences referenced by new columns (bigserial added to an existing table).
  const sequences = async (schema: string) => new Set((await rows<{ name: string }>(database, "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='S'", [schema])).map((r) => r.name));
  const liveSequences = await sequences(current);

  // 4. Columns.
  type Column = { table: string; column: string; type: string; not_null: boolean; default: string | null };
  const columns = (schema: string) => rows<Column>(database, `SELECT c.relname AS table, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS default
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`, [schema]);
  const target = await columns(shadow), live = await columns(current);
  const liveByKey = new Map(live.map((c) => [`${c.table}.${c.column}`, c]));
  const targetByKey = new Map(target.map((c) => [`${c.table}.${c.column}`, c]));
  const rowCount = new Map<string, number>();
  const hasRows = async (table: string) => {
    if (!rowCount.has(table)) rowCount.set(table, (await rows<{ n: number }>(database, `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${ident(table)} LIMIT 1) x`))[0].n);
    return rowCount.get(table)! > 0;
  };
  for (const column of target) {
    if (INTERNAL.has(column.table) || !liveTables.has(column.table)) continue;
    const have = liveByKey.get(`${column.table}.${column.column}`);
    const def = column.default ? unqualify(column.default, shadow) : null;
    if (!have) {
      const sequence = def && /nextval\('([^']+)'/.exec(def)?.[1]?.replace(/"/g, "");
      if (sequence && !liveSequences.has(sequence)) await q(`CREATE SEQUENCE IF NOT EXISTS ${ident(sequence)}`);
      // A NOT NULL column without a default is only enforced on an empty table, so an older
      // version that does not know the column can still insert rows after a rollback.
      const notNull = column.not_null && (def !== null || !(await hasRows(column.table)));
      if (column.not_null && !notNull) warnings.push(`Kolom ${column.table}.${column.column} ditambahkan tanpa NOT NULL karena tabel sudah berisi data.`);
      await q(`ALTER TABLE ${ident(column.table)} ADD COLUMN ${ident(column.column)} ${column.type}${def ? ` DEFAULT ${def}` : ""}${notNull ? " NOT NULL" : ""}`);
      changes.push(`Kolom baru: ${column.table}.${column.column}`);
      continue;
    }
    if (have.not_null && !column.not_null) {
      await q(`ALTER TABLE ${ident(column.table)} ALTER COLUMN ${ident(column.column)} DROP NOT NULL`);
      changes.push(`Kolom boleh kosong: ${column.table}.${column.column}`);
    }
    if (def !== null && (have.default ?? null) !== def) {
      await q(`ALTER TABLE ${ident(column.table)} ALTER COLUMN ${ident(column.column)} SET DEFAULT ${def}`);
      changes.push(`Nilai bawaan: ${column.table}.${column.column}`);
    }
    if (have.type !== column.type) warnings.push(`Tipe ${column.table}.${column.column} berbeda (${have.type} → ${column.type}); tidak diubah otomatis agar data aman.`);
  }
  // Columns this version does not know: relax NOT NULL without default so inserts keep working (rollback).
  for (const column of live) {
    if (INTERNAL.has(column.table) || !targetTables.has(column.table) || targetByKey.has(`${column.table}.${column.column}`)) continue;
    if (column.not_null && column.default === null) {
      await q(`ALTER TABLE ${ident(column.table)} ALTER COLUMN ${ident(column.column)} DROP NOT NULL`);
      changes.push(`Kolom versi lain dilonggarkan: ${column.table}.${column.column}`);
    }
  }

  // 5. CHECK and foreign-key rules of tables this version owns.
  type Constraint = { table: string; name: string; type: string; def: string };
  const constraints = (schema: string) => rows<Constraint>(database, `SELECT c.relname AS table, k.conname AS name, k.contype AS type, pg_get_constraintdef(k.oid) AS def
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND k.contype IN ('c','f','u','p')`, [schema]);
  const norm = (def: string) => def.replace(/\s+NOT VALID$/i, "").trim();
  const targetConstraints = (await constraints(shadow)).map((k) => ({ ...k, def: norm(unqualify(k.def, shadow)) }));
  const liveConstraints = (await constraints(current)).map((k) => ({ ...k, def: norm(k.def) }));
  for (const table of targetTables) {
    if (INTERNAL.has(table) || !liveTables.has(table)) continue;
    const want = targetConstraints.filter((k) => k.table === table), have = liveConstraints.filter((k) => k.table === table);
    const haveDefs = new Set(have.map((k) => `${k.type}:${k.def}`)), wantDefs = new Set(want.map((k) => `${k.type}:${k.def}`));
    const haveNames = new Set(have.map((k) => k.name));
    // Rules that differ from this version are removed first (a widened list of allowed values
    // would otherwise still be blocked by the old rule). Unique/primary keys are never dropped.
    for (const k of have) {
      if ((k.type === "c" || k.type === "f") && !wantDefs.has(`${k.type}:${k.def}`)) {
        await q(`ALTER TABLE ${ident(table)} DROP CONSTRAINT ${ident(k.name)}`);
        haveNames.delete(k.name);
        changes.push(`Aturan diganti: ${table}.${k.name}`);
      }
    }
    for (const k of want) {
      if (haveDefs.has(`${k.type}:${k.def}`)) continue;
      let constraintName = k.name;
      for (let n = 2; haveNames.has(constraintName); n++) constraintName = `${k.name}_${n}`;
      const notValid = k.type === "c" || k.type === "f" ? " NOT VALID" : "";
      if (await attempt(database, `ALTER TABLE ${ident(table)} ADD CONSTRAINT ${ident(constraintName)} ${k.def}${notValid}`, warnings, `Aturan ${table}.${constraintName}`)) {
        haveNames.add(constraintName);
        changes.push(`Aturan baru: ${table}.${constraintName}`);
      }
    }
  }

  // 6. Indexes (by name; an index whose definition changed is rebuilt). Extra live indexes are kept.
  type Index = { name: string; table: string; def: string; constraint: boolean };
  const indexes = (schema: string) => rows<Index>(database, `SELECT i.relname AS name, t.relname AS table, pg_get_indexdef(i.oid) AS def,
      EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.oid) AS constraint
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=i.relnamespace
    WHERE n.nspname=$1`, [schema]);
  const liveIndexes = new Map((await indexes(current)).map((i) => [i.name, i]));
  for (const index of await indexes(shadow)) {
    if (index.constraint || INTERNAL.has(index.table)) continue;
    const def = unqualify(index.def, shadow).replace(` ON ${ident(shadow)}.`, " ON ").replace(` ON ${shadow}.`, " ON ");
    const have = liveIndexes.get(index.name);
    const liveDef = have ? have.def.replace(` ON ${ident(current)}.`, " ON ").replace(` ON ${current}.`, " ON ") : null;
    if (have && liveDef === def) continue;
    if (have) await q(`DROP INDEX ${ident(index.name)}`);
    if (await attempt(database, def, warnings, `Indeks ${index.name}`)) changes.push(`${have ? "Indeks diperbarui" : "Indeks baru"}: ${index.name}`);
  }

  // 7. Functions and triggers.
  const functions = (schema: string) => rows<{ name: string; def: string }>(database, `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind='f'`, [schema]);
  const liveFunctions = new Map((await functions(current)).map((f) => [f.name, unqualify(f.def, current)]));
  for (const fn of await functions(shadow)) {
    const def = unqualify(fn.def, shadow);
    if (liveFunctions.get(fn.name) === def) continue;
    await q(def);
    changes.push(`Fungsi diperbarui: ${fn.name}`);
  }
  const triggers = (schema: string) => rows<{ name: string; table: string; def: string }>(database, `SELECT t.tgname AS name, c.relname AS table, pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal`, [schema]);
  const liveTriggers = new Set((await triggers(current)).map((t) => `${t.table}.${t.name}`));
  for (const trigger of await triggers(shadow)) {
    if (liveTriggers.has(`${trigger.table}.${trigger.name}`)) continue;
    await q(unqualify(trigger.def, shadow));
    changes.push(`Trigger baru: ${trigger.name}`);
  }

  // 8. Singleton rows (settings with id = 1) that a newer version expects.
  for (const statement of statements) {
    if (!isInsert(statement) || /ON\s+CONFLICT/i.test(statement)) continue;
    const result = await q(`${statement} ON CONFLICT DO NOTHING`);
    if (result.rowCount) changes.push(`Baris awal: ${statement.replace(/\s+/g, " ").slice(0, 80)}`);
  }

  await q(`DROP SCHEMA ${ident(shadow)} CASCADE`);
}
