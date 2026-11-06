import { randomBytes } from "node:crypto";

// Keep existing API identifiers stable during migration. These are plain text
// primary keys in PostgreSQL, not BSON or a dependency on a MongoDB server.
export class RecordId {
  private readonly value: string;
  constructor(value?: unknown) {
    const text = value == null ? randomBytes(12).toString("hex") : String(value);
    if (!RecordId.isValid(text)) throw new Error("Invalid record identifier");
    this.value = text.toLowerCase();
  }
  static isValid(value: unknown) { return /^[a-f\d]{24}$/i.test(String(value ?? "")); }
  toString() { return this.value; }
  toHexString() { return this.value; }
  toJSON() { return this.value; }
  equals(value: unknown) { return this.value === String(value); }
}

/** Bundlers can load this module twice, and `instanceof` fails across the two copies. */
export function isRecordId(value: unknown): value is RecordId {
  return value instanceof RecordId || (typeof value === "object" && value !== null && typeof (value as { toHexString?: unknown }).toHexString === "function");
}

// Schema declarations are retained to validate existing API contracts. Storage
// is one SQL table per model, with native scalar columns and JSONB nested data.
// Deliberately dynamic at the schema compiler boundary; every stored field is
// normalized against a declaration and every query operator is allowlisted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DynamicValue = any;
export type Shape = Record<string, DynamicValue>;
export interface Field {
  type?: DynamicValue; required?: boolean; default?: DynamicValue; enum?: readonly DynamicValue[];
  trim?: boolean; lowercase?: boolean; min?: number; max?: number;
  minlength?: number; maxlength?: number; unique?: boolean; index?: boolean;
  sparse?: boolean; select?: boolean; ref?: string; expires?: number; match?: RegExp;
}
export class Schema<T = DynamicValue> {
  static readonly __hrisSchema = true;
  declare readonly inferredType: T;
  static Types = { Id: RecordId, Mixed: Object };
  readonly indexes: { fields: Shape; options: Shape }[] = [];
  constructor(public definition: Shape, public options: Shape = {}) {}
  index(fields: Shape, options: Shape = {}) { this.indexes.push({ fields, options }); return this; }
}
// A production bundle can load this module twice; a sub-schema built by the
// other copy fails `instanceof Schema`, so recognise the class by its brand.
export const isSchema = (value: unknown): value is Schema => value instanceof Schema || Boolean(value && typeof value === "object" && (value as { constructor?: { __hrisSchema?: unknown } }).constructor?.__hrisSchema === true);
export const descriptor = (value: DynamicValue): Field => {
  if (isSchema(value) || Array.isArray(value) || typeof value === "function") return { type: value };
  if (value && Object.hasOwn(value, "type")) return value;
  return { type: value };
};
export function sqlType(raw: DynamicValue): string {
  const { type } = descriptor(raw);
  if (type === String || type === RecordId) return "text";
  if (type === Number) return "double precision";
  if (type === Boolean) return "boolean";
  if (type === Date) return "timestamptz";
  return "jsonb";
}
export function normalize(raw: DynamicValue, input: DynamicValue, path: string, defaults = true): DynamicValue {
  const field = descriptor(raw), type = field.type;
  let value = input;
  if (value === undefined && defaults) {
    if (field.default !== undefined) value = typeof field.default === "function" ? field.default() : structuredClone(field.default);
    else if (Array.isArray(type)) value = [];
    else if (type && typeof type === "object" && !isSchema(type)) value = {};
  }
  if (value === undefined || value === null) {
    if (field.required) throw new Error(`Validation failed: ${path} is required`);
    return value;
  }
  if (type === RecordId) value = new RecordId(typeof value === "object" && value._id ? value._id : value).toString();
  else if (type === String) {
    if (typeof value !== "string") value = String(value);
    if (field.trim) value = value.trim();
    if (field.lowercase) value = value.toLowerCase();
    if (field.match && !new RegExp(field.match.source, field.match.flags).test(value)) throw new Error(`Validation failed: ${path} format`);
    if (field.required && !value) throw new Error(`Validation failed: ${path} is required`);
    if ((field.minlength !== undefined && value.length < field.minlength) || (field.maxlength !== undefined && value.length > field.maxlength)) throw new Error(`Validation failed: ${path} length`);
  } else if (type === Number) {
    value = Number(value);
    if (!Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) throw new Error(`Validation failed: ${path} number`);
  } else if (type === Boolean) {
    if (![true, false, "true", "false", 0, 1].includes(value)) throw new Error(`Validation failed: ${path} boolean`);
    value = value === true || value === "true" || value === 1;
  } else if (type === Date) {
    value = new Date(value);
    if (!Number.isFinite(value.getTime())) throw new Error(`Validation failed: ${path} date`);
  } else if (Array.isArray(type)) {
    if (!Array.isArray(value)) throw new Error(`Validation failed: ${path} array`);
    value = value.map((item, index) => normalize(type[0] ?? Object, item, `${path}.${index}`, defaults));
  } else if (isSchema(type) || (type && typeof type === "object")) {
    if (typeof value !== "object" || Array.isArray(value)) throw new Error(`Validation failed: ${path} object`);
    const shape = isSchema(type) ? type.definition : type;
    const result: Shape = { ...value };
    if (isSchema(type) && type.options._id !== false) result._id = value._id ? String(value._id) : new RecordId().toString();
    for (const [key, def] of Object.entries(shape)) {
      const item = normalize(def, value[key], `${path}.${key}`, defaults);
      if (item !== undefined) result[key] = item;
    }
    value = result;
  }
  if (field.enum && !field.enum.includes(value)) throw new Error(`Validation failed: ${path} enum`);
  return value;
}
export function hydrate(raw: DynamicValue, value: DynamicValue): DynamicValue {
  if (value == null) return value;
  const type = descriptor(raw).type;
  if (type === Date) return new Date(value);
  if (type === Number) return Number(value);
  if (Array.isArray(type)) return value.map((v: DynamicValue) => hydrate(type[0], v));
  const shape = isSchema(type) ? type.definition : typeof type === "object" ? type : null;
  if (shape) for (const [key, def] of Object.entries(shape)) if (value[key] !== undefined) value[key] = hydrate(def, value[key]);
  return value;
}
export function fields(schema: Schema): Shape {
  return { _id: String, ...schema.definition, ...(schema.options.timestamps ? { createdAt: Date, updatedAt: Date } : {}) };
}
export const ident = (name: string) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ["__proto__", "prototype", "constructor"].includes(name)) throw new Error("Invalid SQL identifier"); return `"${name}"`; };
export const tableName = (name: string) => `app_${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
export const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
