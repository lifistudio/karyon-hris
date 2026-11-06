import type { DynamicValue } from "./schema";
import { descriptor, fields, ident, isRecordId, literal, Schema, isSchema, sqlType, type Shape } from "./schema";

export class SqlBuilder {
  values: DynamicValue[] = [];
  constructor(public shape: Shape, public alias = "t") {}
  param(value: DynamicValue, cast = "") { this.values.push(isRecordId(value) ? String(value) : value); return `$${this.values.length}${cast ? `::${cast}` : ""}`; }
  field(path: string): { sql: string; type: string; array: boolean; definition: DynamicValue } {
    const parts = path.split(".");
    parts.forEach(ident);
    const root = parts.shift()!;
    if (!Object.hasOwn(this.shape, root)) {
      if (root === "_demoSeed") return { sql: `${this.alias}."_extra" ->> '_demoSeed'`, type: "text", array: false, definition: String };
      throw new Error(`Unknown query field: ${root}`);
    }
    let raw = this.shape[root];
    let sql = `${this.alias}.${ident(root)}`;
    if (parts.length) {
      let type = descriptor(raw).type;
      if (Array.isArray(type)) throw new Error("Use elemMatch for nested array predicates");
      for (const part of parts) {
        const shape = isSchema(type) ? type.definition : type;
        raw = shape?.[part]; type = descriptor(raw ?? Object).type;
      }
      const pathSql = `ARRAY[${parts.map(literal).join(",")}]::text[]`;
      const kind = sqlType(raw ?? Object);
      sql = kind === "jsonb" ? `(${sql} #> ${pathSql})` : `(${sql} #>> ${pathSql})::${kind}`;
    }
    return { sql, type: sqlType(raw ?? Object), array: Array.isArray(descriptor(raw).type), definition: raw };
  }
  scalar(value: DynamicValue, type: string) {
    if (type === "jsonb") return this.param(JSON.stringify(value), "jsonb");
    if (type === "timestamptz") {
      const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Invalid query date");
      return this.param(date, type);
    }
    return this.param(isRecordId(value) ? String(value) : value, type);
  }
  condition(filter: Shape = {}): string {
    const terms: string[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (["$and", "$or", "$nor"].includes(key)) {
        if (!Array.isArray(value)) throw new Error("Invalid logical predicate");
        const clauses = value.map(v => `(${this.condition(v)})`);
        const joined = clauses.join(key === "$and" ? " AND " : " OR ") || (key === "$and" ? "TRUE" : "FALSE");
        terms.push(key === "$nor" ? `NOT (${joined})` : `(${joined})`); continue;
      }
      if (key === "$expr") { terms.push(this.expression(value)); continue; }
      if (key.startsWith("$")) throw new Error(`Unsupported query operator ${key}`);
      const f = this.field(key);
      const compare = (op: string, val: DynamicValue): string => {
        if (val === null || val === undefined) return `${f.sql} IS ${op === "<>" ? "NOT " : ""}NULL`;
        if (f.array && !Array.isArray(val)) {
          const v = this.param(JSON.stringify([val]), "jsonb");
          return op === "<>" ? `NOT COALESCE(${f.sql} @> ${v}, FALSE)` : `${f.sql} @> ${v}`;
        }
        return `${f.sql} ${op} ${this.scalar(val, f.type)}`;
      };
      if (value instanceof RegExp) { terms.push(`${f.sql} ${value.ignoreCase ? "~*" : "~"} ${this.param(value.source)}`); continue; }
      if (value && typeof value === "object" && !(value instanceof Date) && !isRecordId(value) && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith("$"))) {
        for (const [op, val] of Object.entries(value)) {
          if (op === "$options") continue;
          if (op === "$eq") terms.push(compare("=", val));
          else if (op === "$ne") terms.push(val == null ? compare("<>", val) : `(${f.sql} IS NULL OR ${compare("<>", val)})`);
          else if (["$gt", "$gte", "$lt", "$lte"].includes(op)) terms.push(compare(({ $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" } as Shape)[op], val));
          else if (op === "$exists") terms.push(`${f.sql} IS ${val ? "NOT " : ""}NULL`);
          else if (op === "$type") { if (val !== "date" || f.type !== "timestamptz") throw new Error("Unsupported type predicate"); terms.push(`${f.sql} IS NOT NULL`); }
          else if (op === "$in" || op === "$nin") {
            if (!Array.isArray(val)) throw new Error("Invalid membership predicate");
            const expression = val.map(v => compare("=", v)).join(" OR ") || "FALSE";
            terms.push(op === "$nin" ? `NOT COALESCE((${expression}), FALSE)` : `(${expression})`);
          } else if (op === "$regex") {
            const regex = val instanceof RegExp ? val.source : String(val);
            if (regex.length > 1000 || (value.$options && !/^[i]*$/.test(value.$options))) throw new Error("Unsupported regex");
            terms.push(`${f.sql} ${value.$options?.includes("i") || val instanceof RegExp && val.ignoreCase ? "~*" : "~"} ${this.param(regex)}`);
          } else if (op === "$elemMatch") {
            if (!f.array) throw new Error("elemMatch requires an array");
            const def = descriptor(f.definition).type[0];
            const nested = isSchema(def) ? def.definition : descriptor(def).type;
            const builder = new JsonPredicate(this, nested, "element");
            terms.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${f.sql}, '[]'::jsonb)) element WHERE ${builder.condition(val as Shape)})`);
          } else throw new Error(`Unsupported predicate ${op}`);
        }
      } else terms.push(compare("=", value));
    }
    return terms.length ? terms.map(t => `(${t})`).join(" AND ") : "TRUE";
  }
  expression(value: DynamicValue): string {
    if (typeof value === "string" && value.startsWith("$")) return this.field(value.slice(1)).sql;
    if (value === null) return "NULL";
    if (typeof value !== "object" || value instanceof Date) return this.param(value);
    if (Array.isArray(value)) throw new Error("Unsupported array expression");
    const keys = Object.keys(value);
    if (!keys.some(k => k.startsWith("$"))) return `jsonb_build_object(${Object.entries(value).flatMap(([k, v]) => [literal(k), `to_jsonb(${this.expression(v)})`]).join(",")})`;
    if (keys.length !== 1) throw new Error("Invalid SQL expression");
    const op = keys[0], arg = value[op];
    if (["$eq", "$ne", "$gt", "$gte", "$lt", "$lte"].includes(op)) return `(${this.expression(arg[0])} ${({ $eq: "=", $ne: "<>", $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" } as Shape)[op]} ${this.expression(arg[1])})`;
    if (op === "$mod") return `MOD(${this.expression(arg[0])}, ${this.expression(arg[1])})`;
    if (op === "$toLong") return `(EXTRACT(EPOCH FROM ${this.expression(arg)}) * 1000)::bigint`;
    if (op === "$toString") return `(${this.expression(arg)})::text`;
    if (op === "$ifNull") return `COALESCE(${arg.map((v: DynamicValue) => this.expression(v)).join(",")})`;
    if (op === "$cond") {
      const cond = arg[0];
      let test: string;
      if (cond?.$ifNull && cond.$ifNull[1] === false) test = `${this.expression(cond.$ifNull[0])} IS NOT NULL`;
      else test = this.expression(cond);
      return `(CASE WHEN ${test} THEN ${this.expression(arg[1])} ELSE ${this.expression(arg[2])} END)`;
    }
    if (["$month", "$dayOfMonth", "$year"].includes(op)) {
      const unit = ({ $month: "MONTH", $dayOfMonth: "DAY", $year: "YEAR" } as Shape)[op];
      return `EXTRACT(${unit} FROM (${this.expression(arg.date ?? arg)} AT TIME ZONE ${this.param(arg.timezone || "UTC")}))::integer`;
    }
    if (op === "$dateToString") {
      const format = ({ "%Y-%m": "YYYY-MM", "%Y-%m-%d": "YYYY-MM-DD" } as Shape)[arg.format];
      if (!format) throw new Error("Unsupported date format");
      return `to_char(${this.expression(arg.date)} AT TIME ZONE ${this.param(arg.timezone || "UTC")}, ${this.param(format)})`;
    }
    if (op === "$concat") return `concat(${arg.map((v: DynamicValue) => this.expression(v)).join(",")})`;
    throw new Error(`Unsupported aggregate expression ${op}`);
  }
}
class JsonPredicate extends SqlBuilder {
  constructor(private parent: SqlBuilder, shape: Shape, alias: string) { super(shape, alias); this.values = parent.values; }
  override field(path: string) {
    path.split(".").forEach(ident);
    const raw = this.shape[path]; if (!raw) throw new Error("Unknown nested predicate");
    const type = sqlType(raw);
    return { sql: type === "jsonb" ? `(${this.alias} -> ${literal(path)})` : `(${this.alias} ->> ${literal(path)})::${type}`, type, array: Array.isArray(descriptor(raw).type), definition: raw };
  }
}
export function compileFilter(schema: Schema, filter: Shape) { const builder = new SqlBuilder(fields(schema)); return { text: builder.condition(filter), values: builder.values }; }
