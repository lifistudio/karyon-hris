import type { DynamicValue } from "./schema";
/* Explicitly bounded repository API for the existing HRIS contracts. All
 * predicates compile to parameterized SQL; no MongoDB protocol is used. */
import { Connection, type SqlExecutor } from "./connection";
import { descriptor, fields, hydrate, ident, normalize, RecordId, Schema, isSchema, sqlType, tableName, type Shape } from "./schema";
import { SqlBuilder } from "./query";
export { RecordId, Schema } from "./schema";
export type InferSchemaType<T> = T extends Schema<infer U> ? U : never;
export type Document = { _id: DynamicValue; createdAt?: Date; updatedAt?: Date; save(): Promise<DynamicValue>; deleteOne(): Promise<{ deletedCount: number }>; toObject(): DynamicValue; toJSON(): DynamicValue; set(values: Shape): void; markModified(path: string): void; validateSync(): Error | undefined; [key: string]: DynamicValue };
export interface Model<T = DynamicValue> {
  new(data?: Shape): T & Document;
  modelName: string; schema: Schema; repository: Repository;
  find(filter?: Shape, projection?: DynamicValue): Query<DynamicValue[]>;
  findOne(filter?: Shape, projection?: DynamicValue): Query<DynamicValue>;
  findById(id: DynamicValue): Query<DynamicValue>;
  countDocuments(filter?: Shape): Promise<number>;
  estimatedDocumentCount(): Promise<number>;
  exists(filter?: Shape): Query<DynamicValue>;
  create(input: DynamicValue): Promise<DynamicValue>;
  insertMany(input: Shape[], options?: Shape): Promise<DynamicValue[]>;
  findOneAndUpdate(filter: Shape, update: Shape, options?: Shape): Query<DynamicValue>;
  findByIdAndUpdate(id: DynamicValue, update: Shape, options?: Shape): Query<DynamicValue>;
  updateOne(filter: Shape, update: Shape, options?: Shape): Promise<DynamicValue>;
  updateMany(filter: Shape, update: Shape, options?: Shape): Promise<DynamicValue>;
  deleteOne(filter: Shape): Promise<DynamicValue>;
  deleteMany(filter: Shape): Promise<DynamicValue>;
  findOneAndDelete(filter: Shape): Query<DynamicValue>;
  findByIdAndDelete(id: DynamicValue): Query<DynamicValue>;
  distinct(path: string, filter?: Shape): Promise<DynamicValue[]>;
  aggregate<U = DynamicValue>(pipeline: Shape[]): Promise<U[]>;
  bulkWrite(operations: Shape[], options?: Shape): Promise<DynamicValue>;
}
const copy = (value: DynamicValue): DynamicValue => {
  if (value instanceof RecordId) return value.toString();
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value === undefined ? undefined : structuredClone(value);
};
const get = (obj: DynamicValue, path: string) => path.split(".").reduce((v, k) => v?.[k], obj);
function put(obj: Shape, path: string, value: DynamicValue) { const keys = path.split("."); keys.forEach(ident); let target = obj; for (const key of keys.slice(0, -1)) target = target[key] ??= {}; if (value === undefined) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = value; }
const json = (value: DynamicValue) => JSON.stringify(value);
function storageValue(def: DynamicValue, value: DynamicValue) { return value == null ? null : sqlType(def) === "jsonb" ? JSON.stringify(value) : value; }
function translated(error: DynamicValue): never { if (error?.code === "23505") { const e = new Error("Duplicate record") as Error & { code: number }; e.code = 11000; throw e; } throw error; }

export class Query<T = DynamicValue> implements PromiseLike<T> {
  private projection: DynamicValue; private ordering: Shape = {}; private take?: number; private offset = 0;
  private populations: DynamicValue[] = []; private plain = false; private promise?: Promise<T>;
  constructor(private repository: Repository, private filter: Shape, private single = false, private operation?: () => Promise<DynamicValue>) {}
  select(value: DynamicValue) { this.projection = value; return this; }
  sort(value: DynamicValue) { this.ordering = typeof value === "string" ? Object.fromEntries(value.split(/\s+/).map(v => [v.replace(/^-/, ""), v.startsWith("-") ? -1 : 1])) : value; return this; }
  limit(value: number) { if (!Number.isInteger(value) || value < 0) throw new Error("Invalid query limit"); this.take = value || undefined; return this; }
  skip(value: number) { if (!Number.isInteger(value) || value < 0) throw new Error("Invalid query offset"); this.offset = value; return this; }
  populate<U = T>(path: DynamicValue, select?: DynamicValue): Query<U> { if (typeof path === "string") for (const name of path.split(/\s+/)) this.populations.push({ path: name, select }); else if (Array.isArray(path)) this.populations.push(...path); else this.populations.push(path); return this as unknown as Query<U>; }
  lean<U = T>(): Query<U> { this.plain = true; return this as unknown as Query<U>; }
  async exec(): Promise<T> {
    if (this.promise) return this.promise;
    this.promise = this.execute(); return this.promise;
  }
  private async execute(): Promise<T> {
    let rows: DynamicValue[];
    if (this.operation) { const result = await this.operation(); rows = result == null ? [] : Array.isArray(result) ? result : [result]; }
    else {
      const b = new SqlBuilder(this.repository.shape);
      const where = b.condition(this.filter);
      const order = Object.entries(this.ordering).map(([key, direction]) => `${b.field(key).sql} ${Number(direction) < 0 ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`).join(",");
      const limit = this.single ? 1 : this.take;
      const sql = `SELECT t.* FROM ${ident(this.repository.table)} t WHERE ${where}${order ? ` ORDER BY ${order}` : ""}${limit ? ` LIMIT ${b.param(limit)}` : ""}${this.offset ? ` OFFSET ${b.param(this.offset)}` : ""}`;
      rows = (await this.repository.db.connection.query(sql, b.values)).rows.map(row => this.repository.decode(row));
    }
    const result = rows.map(row => this.repository.project(row, this.projection));
    for (const spec of this.populations) await this.repository.populate(result, spec);
    const output = result.map((row, i) => this.plain ? row : this.repository.document(row, rows[i]));
    return (this.single ? output[0] ?? null : output) as T;
  }
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: DynamicValue) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return this.exec().then(onfulfilled, onrejected); }
  catch<TResult = never>(onrejected: (reason: DynamicValue) => TResult | PromiseLike<TResult>) { return this.exec().catch(onrejected); }
}

export class Repository {
  readonly table: string; readonly shape: Shape;
  constructor(public db: Database, public name: string, public schema: Schema) { this.table = tableName(name); this.shape = fields(schema); }
  decode(row: Shape) {
    const data: Shape = { ...(row._extra || {}) };
    for (const [key, def] of Object.entries(this.shape)) if (row[key] !== null && row[key] !== undefined) data[key] = hydrate(def, row[key]); else if (row[key] === null) data[key] = null;
    Object.defineProperty(data, "_version", { value: Number(row._version || 0), enumerable: false, writable: true });
    return data;
  }
  normalize(data: Shape, defaults = true, preserveUnknown = false) {
    const result: Shape = { _id: data._id == null ? new RecordId().toString() : String(data._id) };
    for (const [key, def] of Object.entries(this.shape)) if (key !== "_id") {
      const value = normalize(def, data[key], key, defaults);
      if (value !== undefined) result[key] = value;
    }
    for (const [key, value] of Object.entries(data)) if (!(key in this.shape) && !["_version", "_extra"].includes(key) && (preserveUnknown || key === "_demoSeed")) result[key] = value;
    return result;
  }
  project(row: Shape, select?: DynamicValue) {
    const spec: Shape = typeof select === "string" ? Object.fromEntries(select.split(/\s+/).filter(Boolean).map(p => [p.replace(/^[+-]/, ""), p.startsWith("-") ? 0 : p.startsWith("+") ? 2 : 1])) : select || {};
    const includes = Object.keys(spec).filter(k => spec[k] === 1 && k !== "_id");
    const output: Shape = Object.values(spec).includes(1) ? { _id: row._id } : copy(row);
    const pick = (source: DynamicValue, destination: DynamicValue, path: string[]) => {
      const [key, ...rest] = path; if (!key || source?.[key] === undefined) return;
      if (!rest.length) destination[key] = copy(source[key]);
      else if (Array.isArray(source[key])) { destination[key] ??= source[key].map(() => ({})); source[key].forEach((v: DynamicValue, i: number) => pick(v, destination[key][i], rest)); }
      else { destination[key] ??= {}; pick(source[key], destination[key], rest); }
    };
    for (const key of includes) pick(row, output, key.split("."));
    for (const [key, def] of Object.entries(this.shape)) if (descriptor(def).select === false && !spec[key]) delete output[key];
    for (const [key, value] of Object.entries(spec)) if (value === 0) put(output, key, undefined); else if (value === 2 && row[key] !== undefined) output[key] = copy(row[key]);
    return output;
  }
  document(data: Shape, baseline?: Shape): DynamicValue {
    const instance = data; let original = copy(data); let version = baseline?._version;
    const methods = {
      toObject: () => copy(Object.fromEntries(Object.entries(instance))),
      toJSON: () => methods.toObject(),
      set: (values: Shape) => Object.assign(instance, values),
      markModified: (_path: string) => undefined,
      deleteOne: async () => {
        if (!instance._id) throw new Error("Cannot delete a document without its identifier");
        const result = await this.remove({ _id: instance._id }, false);
        return { deletedCount: result.deletedCount };
      },
      validateSync: () => { try { this.normalize(instance); return undefined; } catch (e) { return e as Error; } },
      save: async () => {
        if (version === undefined) {
          const created = await this.insert(instance); Object.assign(instance, created); version = created._version;
        } else {
          const patch: Shape = {}, unset: Shape = {};
          for (const key of new Set([...Object.keys(original), ...Object.keys(instance)])) {
            if (key === "_id") continue;
            if (json(instance[key]) !== json(original[key])) { if (instance[key] === undefined) unset[key] = ""; else patch[key] = instance[key]; }
          }
          const result = await this.mutate({ _id: instance._id }, { $set: patch, $unset: unset }, { version, returnDocument: "after" });
          if (!result.rows[0]) throw new Error("CONFLICT");
          const saved = result.rows[0];
          // Preserve the query's projection and populated relations. Saving a
          // selected document must never reveal previously excluded secrets.
          for (const key of Object.keys(instance)) {
            const ref = descriptor(this.shape[key]).ref;
            if (ref && instance[key]?._id && String(instance[key]._id) === String(saved[key])) continue;
            if (saved[key] === undefined) delete instance[key]; else instance[key] = copy(saved[key]);
          }
          if ("updatedAt" in original) instance.updatedAt = saved.updatedAt;
          version = saved._version;
        }
        original = copy(Object.fromEntries(Object.entries(instance))); return instance;
      },
    };
    for (const [key, value] of Object.entries(methods)) Object.defineProperty(instance, key, { value, configurable: true, enumerable: false });
    return instance;
  }
  async populate(rows: Shape[], spec: Shape) {
    const paths = String(spec.path).split(".");
    // A root schema may itself have a field named "type" (positions/contracts).
    // It is a field map, never a field descriptor.
    let raw: DynamicValue = this.schema.definition[paths[0]];
    for (const key of paths.slice(1)) { const type = descriptor(raw).type; raw = (isSchema(type) ? type.definition : Array.isArray(type) ? descriptor(type[0]).type : type)?.[key]; }
    let definition = descriptor(raw);
    if (Array.isArray(definition.type)) definition = descriptor(definition.type[0]);
    if (!definition.ref) throw new Error(`Unknown relation ${this.name}.${spec.path}`);
    const model = this.db.models[definition.ref]; if (!model) throw new Error(`Relation model not registered: ${definition.ref}`);
    const ids = new Set<string>();
    const visit = (root: DynamicValue, parts: string[], fn: (obj: Shape, key: string) => void) => { if (!root) return; if (Array.isArray(root)) { root.forEach(item => visit(item, parts, fn)); return; } if (parts.length === 1) fn(root, parts[0]); else visit(root[parts[0]], parts.slice(1), fn); };
    rows.forEach(row => visit(row, paths, (obj, key) => { for (const v of Array.isArray(obj[key]) ? obj[key] : [obj[key]]) if (v) ids.add(String(v._id ?? v)); }));
    let query = model.find({ _id: { $in: [...ids] }, ...(spec.match || {}) }).select(spec.select).lean();
    if (spec.populate) query = query.populate(spec.populate);
    const related = await query; const byId = new Map(related.map((item: DynamicValue) => [String(item._id), item]));
    rows.forEach(row => visit(row, paths, (obj, key) => { obj[key] = Array.isArray(obj[key]) ? obj[key].map((id: DynamicValue) => copy(byId.get(String(id)))).filter(Boolean) : copy(byId.get(String(obj[key]))) ?? null; }));
  }
  async insert(data: Shape, preserveUnknown = false) {
    const now = new Date();
    const value = this.normalize({ ...data, ...(this.schema.options.timestamps ? { createdAt: data.createdAt ?? now, updatedAt: data.updatedAt ?? now } : {}) }, true, preserveUnknown);
    const keys = Object.keys(this.shape).filter(k => value[k] !== undefined);
    const extra = Object.fromEntries(Object.entries(value).filter(([k]) => !(k in this.shape)));
    const params = keys.map(k => storageValue(this.shape[k], value[k])); keys.push("_extra"); params.push(json(extra));
    try { const result = await this.db.connection.query(`INSERT INTO ${ident(this.table)} (${keys.map(ident).join(",")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, params); return this.decode(result.rows[0]); }
    catch (e) { translated(e); }
  }
  async insertIfAbsentBatch(input: Shape[]) {
    let inserted = 0;
    const keys = [...Object.keys(this.shape), "_extra"];
    const size = Math.min(100, Math.floor(60000 / keys.length));
    for (let start = 0; start < input.length; start += size) {
      const params: DynamicValue[] = [];
      const tuples = input.slice(start, start + size).map(data => {
        const now = new Date();
        const value = this.normalize({ ...data, ...(this.schema.options.timestamps ? { createdAt: data.createdAt ?? now, updatedAt: data.updatedAt ?? now } : {}) });
        const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !(key in this.shape)));
        return `(${keys.map(key => { params.push(key === "_extra" ? json(extra) : storageValue(this.shape[key], value[key])); return `$${params.length}`; }).join(",")})`;
      });
      const result = await this.db.connection.query(`INSERT INTO ${ident(this.table)} (${keys.map(ident).join(",")}) VALUES ${tuples.join(",")} ON CONFLICT ("_id") DO NOTHING RETURNING "_id"`, params).catch(translated);
      inserted += result.rows.length;
    }
    return { matchedCount: input.length - inserted, modifiedCount: 0, upsertedCount: inserted };
  }
  async mutate(filter: Shape, update: Shape, options: Shape = {}) {
    if (Array.isArray(update)) throw new Error("Use an explicit PostgreSQL transaction for pipeline updates");
    return this.db.connection.transaction(async () => {
      // Serialize insert-if-absent per table; updates to existing rows use row locks.
      if (options.upsert) await this.db.connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [this.table]);
      const b = new SqlBuilder(this.shape), where = b.condition(filter);
      const found = await this.db.connection.query(`SELECT t.* FROM ${ident(this.table)} t WHERE ${where}${options.many ? "" : " LIMIT 1"} FOR UPDATE`, b.values);
      const rows: Shape[] = []; let inserted = 0;
      const rawRows = found.rows.map(row => this.decode(row));
      if (!rawRows.length && options.upsert) rawRows.push(Object.fromEntries(Object.entries(filter).filter(([k,v]) => !k.startsWith("$") && (v === null || typeof v !== "object" || v instanceof Date || v instanceof RecordId))));
      for (const row of rawRows) {
        const exists = row._version !== undefined;
        if (options.version !== undefined && row._version !== options.version) throw new Error("CONFLICT");
        const before = copy(row); const next = copy(row);
        const operators = Object.keys(update).some(k => k.startsWith("$")) ? update : { $set: update };
        for (const [op, changes] of Object.entries(operators)) {
          if (!["$set", "$setOnInsert", "$unset", "$inc", "$max", "$push", "$addToSet", "$pull"].includes(op)) throw new Error(`Unsupported update ${op}`);
          if (op === "$setOnInsert" && exists) continue;
          for (const [path, value] of Object.entries(changes as Shape)) {
            const key = path.split(".")[0]; if (key === "_id" && exists && String(value) !== row._id) throw new Error("Cannot change primary key");
            if (!(key in this.shape) && key !== "_demoSeed") throw new Error(`Unknown update field ${key}`);
            if (op === "$set" || op === "$setOnInsert") put(next, path, value);
            else if (op === "$unset") put(next, path, undefined);
            else if (op === "$inc") { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid increment"); put(next, path, Number(get(next, path) ?? 0) + value); }
            else if (op === "$max") { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid maximum"); put(next, path, Math.max(Number(get(next,path)??value),value)); }
            else {
              const current = get(next, path) ?? []; if (!Array.isArray(current)) throw new Error("Array update expected");
              const values = value && typeof value === "object" && "$each" in value ? (value as Shape).$each : [value];
              put(next, path, op === "$pull" ? current.filter(v => json(v) !== json(value)) : op === "$addToSet" ? [...current, ...values.filter((v:DynamicValue) => !current.some(i => json(i) === json(v)))] : [...current, ...values]);
            }
          }
        }
        if (!exists) { const result = await this.insert(next); rows.push(result); inserted++; continue; }
        if (this.schema.options.timestamps) next.updatedAt = new Date();
        const value = this.normalize(next, false, true), keys = Object.keys(this.shape).filter(k => k !== "_id");
        const params = keys.map(k => storageValue(this.shape[k], value[k]));
        const extra = Object.fromEntries(Object.entries(value).filter(([k]) => !(k in this.shape)));
        keys.push("_extra"); params.push(json(extra)); params.push(row._id);
        const result = await this.db.connection.query(`UPDATE ${ident(this.table)} SET ${keys.map((k,i) => `${ident(k)}=$${i+1}`).join(",")}, "_version"="_version"+1 WHERE "_id"=$${params.length} RETURNING *`, params).catch(translated);
        const after = this.decode(result.rows[0]);
        rows.push(options.new || options.returnDocument === "after" ? after : Object.defineProperty(before, "_version", { value: row._version }));
      }
      return { rows, matchedCount: found.rows.length, modifiedCount: found.rows.length, upsertedCount: inserted, upsertedId: inserted ? rows[0]._id : null };
    });
  }
  async remove(filter: Shape, many: boolean) {
    const b = new SqlBuilder(this.shape); const where = b.condition(filter);
    const result = await this.db.connection.query(`DELETE FROM ${ident(this.table)} WHERE "_id" IN (SELECT t."_id" FROM ${ident(this.table)} t WHERE ${where}${many ? "" : " LIMIT 1"}) RETURNING *`, b.values);
    return { deletedCount: result.rows.length, rows: result.rows.map(row => this.decode(row)) };
  }
  async aggregate<T>(pipeline: Shape[]): Promise<T[]> {
    const b = new SqlBuilder(this.shape); let sql = `SELECT * FROM ${ident(this.table)}`;
    for (const stage of pipeline) {
      if (stage.$match) sql = `SELECT t.* FROM (${sql}) t WHERE ${b.condition(stage.$match)}`;
      else if (stage.$limit) { if (!Number.isInteger(stage.$limit) || stage.$limit < 1) throw new Error("Invalid aggregate limit"); sql = `SELECT * FROM (${sql}) t LIMIT ${b.param(stage.$limit)}`; }
      else if (stage.$sort) sql = `SELECT * FROM (${sql}) t ORDER BY ${Object.entries(stage.$sort).map(([k,v]) => `${b.field(k).sql} ${Number(v)<0 ? "DESC" : "ASC"}`).join(",")}`;
      else if (stage.$group) {
        const group = stage.$group, id = b.expression(group._id);
        const output: Shape = { _id: typeof group._id === "object" && group._id !== null && !Object.keys(group._id).some(k=>k.startsWith("$")) ? Object : String };
        const expressions = [`${id} AS "_id"`];
        for (const [key, expression] of Object.entries(group)) if (key !== "_id") { if (!expression || typeof expression !== "object" || !("$sum" in expression)) throw new Error("Unsupported aggregate accumulator"); expressions.push(`SUM((${b.expression((expression as Shape).$sum)})::double precision) AS ${ident(key)}`); output[key] = Number; }
        sql = `SELECT ${expressions.join(",")} FROM (${sql}) t${group._id !== null ? " GROUP BY 1" : " HAVING COUNT(*) > 0"}`; b.shape = output;
      } else if (stage.$project) {
        const output: Shape = {}; const expressions: string[] = [];
        const projection = { ...(stage.$project._id === undefined ? { _id: 1 } : {}), ...stage.$project };
        for (const [key, value] of Object.entries(projection)) { if (value === 0) continue; const expression = value === 1 ? b.field(key).sql : b.expression(value); expressions.push(`${expression} AS ${ident(key)}`); output[key] = value === 1 ? b.shape[key] : key === "_id" ? String : Number; }
        sql = `SELECT ${expressions.join(",")} FROM (${sql}) t`; b.shape = output;
      } else throw new Error("Unsupported aggregate stage");
    }
    return (await this.db.connection.query(sql, b.values)).rows as T[];
  }
}

export class Database {
  readonly models: Record<string, Model> = {};
  readonly repositories = new Map<string, Repository>();
  readonly connection: Connection;
  constructor(prefix: string, driver?: SqlExecutor) { this.connection = new Connection(prefix, driver); }
  model<T = DynamicValue>(name: string, schema: Schema<T>): Model<T> {
    if (this.models[name]) return this.models[name];
    const repository = new Repository(this, name, schema); this.repositories.set(name, repository);
    const query = (filter: Shape = {}, single = false) => new Query<DynamicValue>(repository, filter, single);
    class Entity {
      static modelName = name; static schema = schema; static repository = repository;
      constructor(data: Shape = {}) { return repository.document(repository.normalize(data)); }
      static find(filter: Shape = {}, projection?: DynamicValue) { return new Query<DynamicValue[]>(repository, filter).select(projection); }
      static findOne(filter: Shape = {}, projection?: DynamicValue) { return query(filter, true).select(projection); }
      static findById(id: DynamicValue) { return query({ _id: id }, true); }
      static async countDocuments(filter: Shape = {}) { const b = new SqlBuilder(repository.shape); const where = b.condition(filter); return Number((await repository.db.connection.query(`SELECT COUNT(*) AS count FROM ${ident(repository.table)} t WHERE ${where}`, b.values)).rows[0].count); }
      static estimatedDocumentCount() { return this.countDocuments(); }
      static exists(filter: Shape = {}) { return this.findOne(filter).select("_id").lean(); }
      static async create(input: DynamicValue): Promise<DynamicValue> { if (Array.isArray(input)) return this.insertMany(input); const row = await repository.insert(input); return repository.document(repository.project(row), row); }
      static async insertMany(input: Shape[], _options: Shape = {}): Promise<DynamicValue[]> { return repository.db.connection.transaction(async () => { const rows = []; for (const row of input) rows.push(await this.create(row)); return rows; }); }
      static findOneAndUpdate(filter: Shape, update: Shape, options: Shape = {}) { return new Query<DynamicValue>(repository, {}, true, async () => (await repository.mutate(filter, update, options)).rows[0] ?? null); }
      static findByIdAndUpdate(id: DynamicValue, update: Shape, options: Shape = {}) { return this.findOneAndUpdate({ _id: id }, update, options); }
      static async updateOne(filter: Shape, update: Shape, options: Shape = {}) { const { rows: _rows, ...result } = await repository.mutate(filter, update, options); return result; }
      static async updateMany(filter: Shape, update: Shape, options: Shape = {}) { const { rows: _rows, ...result } = await repository.mutate(filter, update, { ...options, many: true }); return result; }
      static async deleteOne(filter: Shape) { const result = await repository.remove(filter, false); return { deletedCount: result.deletedCount }; }
      static async deleteMany(filter: Shape) { const result = await repository.remove(filter, true); return { deletedCount: result.deletedCount }; }
      static findOneAndDelete(filter: Shape) { return new Query<DynamicValue>(repository, {}, true, async () => (await repository.remove(filter, false)).rows[0] ?? null); }
      static findByIdAndDelete(id: DynamicValue) { return this.findOneAndDelete({ _id: id }); }
      static async distinct(path: string, filter: Shape = {}): Promise<DynamicValue[]> { const b = new SqlBuilder(repository.shape); const field = b.field(path); const where = b.condition(filter); const sql = field.array ? `SELECT DISTINCT item #>> '{}' AS value FROM ${ident(repository.table)} t CROSS JOIN LATERAL jsonb_array_elements(${field.sql}) item WHERE ${where}` : `SELECT DISTINCT ${field.sql} AS value FROM ${ident(repository.table)} t WHERE ${where}`; return (await repository.db.connection.query(sql, b.values)).rows.map(r => r.value); }
      static aggregate<U = DynamicValue>(pipeline: Shape[]) { return repository.aggregate<U>(pipeline); }
      static async bulkWrite(operations: Shape[], _options: Shape = {}) {
        // Seed-style immutable upserts can be sent in bounded SQL batches.
        // Only an exact primary-key match is safe for ON CONFLICT DO NOTHING.
        if (operations.length && operations.every(op => {
          const item = op.updateOne;
          return Object.keys(op).length === 1 && item?.upsert === true && Object.keys(item.filter ?? {}).length === 1 && item.filter._id != null && Object.keys(item.update ?? {}).length === 1 && item.update.$setOnInsert && String(item.update.$setOnInsert._id) === String(item.filter._id);
        })) return repository.db.connection.transaction(() => repository.insertIfAbsentBatch(operations.map(op => op.updateOne.update.$setOnInsert)));
        return repository.db.connection.transaction(async () => { const result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }; for (const operation of operations) { if (!operation.updateOne) throw new Error("Unsupported bulk operation"); const { filter, update, ...options } = operation.updateOne; const next = await repository.mutate(filter, update, options); result.matchedCount += next.matchedCount; result.modifiedCount += next.modifiedCount; result.upsertedCount += next.upsertedCount; } return result; });
      }
    }
    this.models[name] = Entity as unknown as Model;
    return Entity as unknown as Model<T>;
  }
  async connect() { await this.connection.query("SELECT 1"); return this; }
  async disconnect() { await this.connection.close(); }
  transaction<T>(work: () => Promise<T>) { return this.connection.transaction(work); }
}
