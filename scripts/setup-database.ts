import database from "../src/lib/postgres";
import "../src/lib/postgres-models";
import { purgeExpired, setupSchema } from "../packages/database/schema-setup";

// Runs before the server starts: creates the whole schema on an empty database
// in one step, or with --cleanup removes expired rows.
(async()=>{
  try { console.log(process.argv.includes("--cleanup") ? {deletedExpired:await purgeExpired(database)} : await setupSchema(database, "hris")); }
  catch(error) {
    const e=error as {code?:string;message?:string};
    if (e.code==="SCHEMA_MISMATCH") console.error(e.message); else console.error("PostgreSQL setup failed",{code:e.code || "SCHEMA"});
    process.exitCode=1;
  }
  finally {await database.disconnect();}
})();
