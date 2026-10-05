import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import database from "./postgres";
import "./postgres-models";
import { setupSchema } from "../../packages/database/schema-setup";
import { seed } from "../scripts/seed";
import { seedDemo } from "../scripts/seed-demo";
import Employee from "../models/Employee";
import User from "../models/User";
import Attendance from "../models/Attendance";
import { getBirthdayDirectory } from "./hr/birthdays-server";
import { resolveSchedule } from "./hr/calendar";

test("every HRIS model creates a relational PostgreSQL schema", async () => {
  const pg = new PGlite(); database.connection.testDriver = pg;
  try {
    const result = await setupSchema(database, "hris");
    assert.ok(result.tables >= 46);
    const constraints = await pg.query("SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY'");
    assert.ok((constraints.rows[0] as {count:number}).count > 30);
    console.log(`PostgreSQL schema: ${result.tables} HRIS tables`);
    process.env.SEED_ADMIN_PASSWORD="TestOnly-admin-passphrase-2026";
    process.env.SEED_STAFF_PASSWORD="TestOnly-staff-passphrase-2026";
    process.env.ENCRYPTION_KEY="postgres-integration-test-key-not-for-production";
    process.env.NEXTAUTH_SECRET="postgres-integration-test-session-not-for-production";
    await seed();
    const adminBefore=JSON.stringify(await User.findOne({email:"admin@hris.com"}).lean());
    await seedDemo({apply:true});
    assert.equal(await Employee.countDocuments({employeeId:/^DEMO-\d{3}$/}),200);
    assert.equal(JSON.stringify(await User.findOne({email:"admin@hris.com"}).lean()),adminBefore);
    const demo=await Employee.findOne({employeeId:"DEMO-001"});
    assert.equal((await resolveSchedule(String(demo._id),"2026-08-03")).clockIn,"09:00");
    await Employee.updateOne({_id:demo._id},{$set:{birthDate:new Date("1995-09-22T00:00:00+07:00")}});
    assert.equal((await getBirthdayDirectory()).showBirthYearAndAge,false);
    const trend=await Attendance.aggregate([
      {$group:{_id:{$dateToString:{date:"$date",format:"%Y-%m-%d",timezone:"Asia/Jakarta"}},present:{$sum:{$cond:[{$ifNull:["$clockIn",false]},1,0]}},late:{$sum:{$cond:["$isLate",1,0]}}}},{$sort:{_id:1}}
    ]);
    assert.ok(trend.length>20);assert.ok(trend.some(row=>row.present>0));
    const employeeCount=await Employee.countDocuments();
    await seedDemo({apply:true});
    assert.equal(await Employee.countDocuments(),employeeCount);
  } finally { database.connection.testDriver=undefined; await pg.close(); }
});
