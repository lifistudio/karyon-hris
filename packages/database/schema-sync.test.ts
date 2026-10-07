import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { syncSchema } from "./schema-sync";
import { Database } from "./model";

/** Two versions of a small schema: v2 adds a table, a column, an index, a wider rule and a settings row. */
const V1 = [
  `CREATE TABLE item (id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('a','b')), title text NOT NULL)`,
  `CREATE TABLE settings (id integer PRIMARY KEY CHECK (id = 1), mode text NOT NULL DEFAULT 'x')`,
  `INSERT INTO settings(id) VALUES (1)`,
];
const V2 = [
  `CREATE TABLE item (id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('a','b','c')), title text NOT NULL,
    note text NOT NULL DEFAULT '', score integer NOT NULL, owner text REFERENCES person(id))`,
  `CREATE TABLE person (id text PRIMARY KEY, name text NOT NULL)`,
  `CREATE INDEX item_kind ON item(kind)`,
  `CREATE TABLE settings (id integer PRIMARY KEY CHECK (id = 1), mode text NOT NULL DEFAULT 'y', flag boolean NOT NULL DEFAULT false)`,
  `INSERT INTO settings(id) VALUES (1)`,
  `CREATE TABLE log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`,
];
// person must exist before item references it on a fresh install.
const V2_ORDERED = [V2[1], V2[0], ...V2.slice(2)];

async function withDb(run: (db: Database) => Promise<void>) {
  const pg = new PGlite();
  const db = new Database("TEST_");
  db.connection.testDriver = pg;
  try { await run(db); } finally { db.connection.testDriver = undefined; await pg.close(); }
}
const q = (db: Database, sql: string, params: unknown[] = []) => db.connection.query(sql, params);

test("empty database gets the whole schema; same version is a no-op", () => withDb(async (db) => {
  const first = await syncSchema(db, "app", V1, "1.0.0");
  assert.equal(first.created, true);
  const again = await syncSchema(db, "app", V1, "1.0.0");
  assert.deepEqual(again.changes, []);
  assert.equal((await q(db, "SELECT count(*)::int AS n FROM settings")).rows[0].n, 1);
}));

test("upgrade adds what is missing without touching data; rollback keeps data and works", () => withDb(async (db) => {
  await syncSchema(db, "app", V1, "1.0.0");
  await q(db, "INSERT INTO item(id,kind,title) VALUES ('1','a','lama')");

  const up = await syncSchema(db, "app", V2_ORDERED, "2.0.0");
  assert.ok(up.changes.some((c) => c.includes("person")), "new table");
  assert.ok(up.changes.some((c) => c.includes("item.note")), "new column");
  // A NOT NULL column without default cannot be enforced on existing rows: added as nullable.
  assert.ok(up.warnings.some((w) => w.includes("item.score")));
  await q(db, "INSERT INTO item(id,kind,title,score) VALUES ('2','c','baru',5)");
  assert.equal((await q(db, "SELECT title FROM item WHERE id='1'")).rows[0].title, "lama", "old row kept");
  assert.equal((await q(db, "SELECT note FROM item WHERE id='1'")).rows[0].note, "", "default filled");
  assert.equal((await q(db, "SELECT flag FROM settings WHERE id=1")).rows[0].flag, false);
  assert.ok((await q(db, "SELECT 1 FROM pg_indexes WHERE indexname='item_kind'")).rows.length);
  await q(db, "INSERT INTO log DEFAULT VALUES");

  // Back to v1: nothing is dropped, the v2-only row survives, v1 can still insert.
  const down = await syncSchema(db, "app", V1, "1.0.0");
  assert.equal(down.created, false);
  await q(db, "INSERT INTO item(id,kind,title) VALUES ('3','b','setelah rollback')");
  assert.equal((await q(db, "SELECT count(*)::int AS n FROM item")).rows[0].n, 3);
  assert.equal((await q(db, "SELECT kind FROM item WHERE id='2'")).rows[0].kind, "c", "v2 data survives rollback");
  assert.ok((await q(db, "SELECT 1 FROM log")).rows.length, "v2 table kept");

  // And forward again.
  await syncSchema(db, "app", V2_ORDERED, "2.0.0");
  await q(db, "INSERT INTO item(id,kind,title,score) VALUES ('4','c','lagi',1)");
  const history = await q(db, `SELECT app_version FROM "_schema_history" ORDER BY id`);
  assert.deepEqual(history.rows.map((r) => r.app_version), ["1.0.0", "2.0.0", "1.0.0", "2.0.0"]);
}));

test("a database created before the version marker existed is adopted, not recreated", () => withDb(async (db) => {
  for (const statement of V1) await q(db, statement);
  await q(db, `CREATE TABLE "_schema_migrations" (version text PRIMARY KEY, checksum text NOT NULL)`);
  await q(db, "INSERT INTO item(id,kind,title) VALUES ('1','a','dari versi lama')");
  const result = await syncSchema(db, "app", V2_ORDERED, "2.0.0");
  assert.equal(result.created, false);
  assert.equal((await q(db, "SELECT title FROM item")).rows[0].title, "dari versi lama");
  assert.equal((await q(db, "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE '\\_schema\\_shadow%'")).rows[0].n, 0, "shadow schema removed");
}));
