import database from "../src/lib/postgres";
import "../src/lib/postgres-models";
import { purgeExpired, resetSchema, setupSchema } from "../packages/database/schema-setup";

// Runs before the server starts: creates the schema on an empty database or adds
// what an existing one is missing (never drops data), or with --cleanup removes
// expired rows.
(async()=>{
  try {
    if (process.argv.includes("--cleanup")) console.log({deletedExpired:await purgeExpired(database)});
    // Test/dummy databases only: `node db-setup.cjs --reset --confirm=<database name>` empties the
    // database (every table and function), then the next start creates a fresh schema.
    else if (process.argv.includes("--reset")) console.log(await resetSchema(database, process.argv.find((a)=>a.startsWith("--confirm="))?.slice(10) ?? ""), "Database dikosongkan. Jalankan ulang aplikasi untuk membuat skema baru.");
    else {
      const result = await setupSchema(database, "hris");
      console.log(result.changes.length ? `Database diperbarui (${result.changes.length} perubahan):\n- ${result.changes.join("\n- ")}` : "Database sudah sesuai versi ini.");
      for (const warning of result.warnings) console.warn(`Peringatan database: ${warning}`);
    }
  }
  catch(error) {
    const e=error as {code?:string;message?:string};
    console.error("PostgreSQL setup failed",{code:e.code || "SCHEMA", message:(e.message||"").slice(0,300)});
    process.exitCode=1;
  }
  finally {await database.disconnect();}
})();
