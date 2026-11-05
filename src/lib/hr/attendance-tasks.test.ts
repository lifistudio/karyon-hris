import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import database from "../postgres";
import "../postgres-models";
import { setupSchema } from "../../../packages/database/schema-setup";
import type { GuardContext } from "../guard";
import { wibDateKey, wibStartOfDay } from "../time";
import Attendance from "../../models/Attendance";
import AttendanceTaskPolicy from "../../models/AttendanceTaskPolicy";
import DailyTask from "../../models/DailyTask";
import Division from "../../models/Division";
import Employee from "../../models/Employee";
import Role from "../../models/Role";
import User from "../../models/User";
import { policyCovers, proofProblem, sanitizePolicyTasks, summarizeTasks } from "./attendance-tasks";
import {
  assertTasksAllowClockOut, assignTask, ensureDailyTasks, isLead, reviewTask, savePolicy, submitTask, syncAttendanceTasks, tasksForDay, teamTasks, waiveTask,
} from "./attendance-tasks-server";

process.env.ENCRYPTION_KEY ??= "test-key-0123456789abcdef0123456789abcdef";

test("policies only cover who they name, and an empty target covers nobody", () => {
  const employee = { id: "e1", roleId: "r1", divisionId: "d1", positionId: "p1", branchId: "b1" };
  assert.equal(policyCovers({}, employee), false);
  assert.equal(policyCovers({ divisionIds: ["d1"] }, employee), true);
  assert.equal(policyCovers({ divisionIds: ["d2"], positionIds: ["p1"] }, employee), true);
  assert.equal(policyCovers({ divisionIds: ["d1"], branchIds: ["b2"] }, employee), false);
  assert.equal(policyCovers({ roleIds: ["r1"] }, { ...employee, roleId: null }), false);
});

test("proof rules: any needs one kind, all needs every kind", () => {
  const empty = { text: "", files: 0, links: 0 };
  assert.equal(proofProblem({ proofTypes: [], proofMode: "any" }, empty), null);
  assert.ok(proofProblem({ proofTypes: ["text", "link"], proofMode: "any" }, empty));
  assert.equal(proofProblem({ proofTypes: ["text", "link"], proofMode: "any" }, { ...empty, links: 1 }), null);
  assert.match(proofProblem({ proofTypes: ["text", "file"], proofMode: "all" }, { ...empty, text: "ok" }) ?? "", /foto atau berkas/);
});

test("task summary: submitted counts as done only without a review", () => {
  const base = { required: true, blockClockOut: true, countsAttendance: true, title: "t" };
  assert.equal(summarizeTasks([{ ...base, status: "submitted" }]).pending, 0);
  assert.equal(summarizeTasks([{ ...base, status: "submitted", requireReview: true }]).pending, 1);
  assert.equal(summarizeTasks([{ ...base, status: "rejected" }]).blocking.length, 1);
  assert.equal(summarizeTasks([{ ...base, status: "waived" }, { ...base, required: false, status: "pending" }]).total, 1);
});

test("task definitions are cleaned and keep stable ids", () => {
  const [task, ...rest] = sanitizePolicyTasks([{ id: "visit", title: " Kunjungan ", proofTypes: ["link", "nope"], weekdays: [1, 1, 9] }, { title: "" }]);
  assert.equal(rest.length, 0);
  assert.deepEqual([task.id, task.title, task.proofTypes, task.weekdays, task.required], ["visit", "Kunjungan", ["link"], [1], true]);
});

test("daily tasks hold clock-out until done, and leads control their own team only", async () => {
  const pg = new PGlite(); database.connection.testDriver = pg;
  try {
    await setupSchema(database, "hris");
    const role = await Role.create({ name: "STAFF" });
    const division = await Division.create({ name: "Sales", code: "SLS" });
    const lead = await Employee.create({ name: "Lia", officeEmail: "lia@test.local", employeeId: "E-1", status: "active" });
    const sales = await Employee.create({ name: "Dimas", officeEmail: "dimas@test.local", employeeId: "E-2", status: "active", divisionId: division._id, supervisorId: lead._id });
    const other = await Employee.create({ name: "Rani", officeEmail: "rani@test.local", employeeId: "E-3", status: "active" });
    const leadUser = await User.create({ email: "lia@test.local", roleId: role._id, employeeId: lead._id });
    const salesUser = await User.create({ email: "dimas@test.local", roleId: role._id, employeeId: sales._id });
    const hr = await User.create({ email: "hr@test.local", roleId: role._id });

    const ctxFor = (id: unknown, employeeId: unknown): GuardContext => ({ user: { id: String(id), email: "x", role: "STAFF", employeeId: employeeId ? String(employeeId) : null, branchId: null, divisionId: null }, permission: { allowed: true, scope: "self" } as never, ip: "127.0.0.1", userAgent: "test" });
    const leadCtx = ctxFor(leadUser._id, lead._id);
    const salesCtx = { ...ctxFor(salesUser._id, sales._id), employeeId: String(sales._id) };
    const today = wibDateKey();

    await assert.rejects(savePolicy(ctxFor(hr._id, null), { name: "Kosong" }), /minimal satu/);
    const policy = await savePolicy(ctxFor(hr._id, null), {
      name: "Task sales", divisionIds: [String(division._id)],
      tasks: [{ id: "visit", title: "Foto kunjungan", proofTypes: ["file", "text"], proofMode: "any" }, { id: "opsi", title: "Catatan bebas", required: false }],
    });
    assert.equal(policy.blockClockOut, true);

    // Copies are created once, for covered people only.
    await ensureDailyTasks(String(sales._id), today);
    await ensureDailyTasks(String(sales._id), today);
    await ensureDailyTasks(String(other._id), today);
    assert.equal(await DailyTask.countDocuments({ employeeId: sales._id, dateKey: today }), 2);
    assert.equal(await DailyTask.countDocuments({ employeeId: other._id }), 0);

    const day = await tasksForDay(String(sales._id), today);
    assert.equal(day.summary.total, 1);
    assert.equal(day.summary.blocked, true);
    await assert.rejects(assertTasksAllowClockOut(String(sales._id), today), /Foto kunjungan/);
    await assertTasksAllowClockOut(String(other._id), today);

    const required = day.tasks.find((t) => t.taskKey.endsWith("visit"))!;
    await assert.rejects(submitTask(salesCtx, { taskId: String(required._id), text: "sudah" }), /Absen masuk dulu/);
    await Attendance.create({ employeeId: sales._id, date: wibStartOfDay(today), clockIn: new Date(), gpsLat: 0, gpsLng: 0, photoUrl: [] });
    await assert.rejects(submitTask(salesCtx, { taskId: String(required._id) }), /Sertakan bukti/);
    await assert.rejects(submitTask({ ...ctxFor(leadUser._id, lead._id), employeeId: String(lead._id) }, { taskId: String(required._id), text: "x" }), /tidak ditemukan/);

    await syncAttendanceTasks(String(sales._id), today);
    assert.equal((await Attendance.findOne({ employeeId: sales._id })).tasksPending, 1);

    await submitTask(salesCtx, { taskId: String(required._id), text: "5 toko dikunjungi", attachments: [{ kind: "link", url: "https://docs.google.com/spreadsheets/d/abc" }] });
    await assertTasksAllowClockOut(String(sales._id), today);
    assert.equal((await Attendance.findOne({ employeeId: sales._id })).tasksPending, 0);

    // A javascript: link never becomes proof.
    await assert.rejects(submitTask(salesCtx, { taskId: String(required._id), text: "x", attachments: [{ kind: "link", url: "javascript:alert(1)" }] }), /http/);

    // A direct supervisor needs no special role; everyone else is refused.
    assert.equal(await isLead(leadCtx), true);
    assert.equal(await isLead(salesCtx), false);
    assert.equal((await teamTasks(salesCtx, today)).isLead, false);
    assert.equal((await teamTasks(leadCtx, today)).rows.length, 1);
    await assert.rejects(assignTask(leadCtx, { employeeIds: [String(other._id)], dates: [today], title: "Di luar tim" }), /bukan anggota tim/);
    await assert.rejects(assignTask(leadCtx, { employeeIds: [String(sales._id)], dates: ["2020-01-01"], title: "Lewat" }), /sudah lewat/);
    await assert.rejects(reviewTask(salesCtx, { taskId: String(required._id), decision: "approve" }), /Task Anda sendiri/);

    const { created } = await assignTask(leadCtx, { employeeIds: [String(sales._id)], dates: [today], title: "Follow up klien A", proofTypes: ["link"], requireReview: true });
    assert.equal(created, 1);
    const assigned = await DailyTask.findOne({ employeeId: sales._id, source: "assigned" });
    await assert.rejects(assertTasksAllowClockOut(String(sales._id), today), /Follow up klien A/);

    await submitTask(salesCtx, { taskId: String(assigned._id), attachments: [{ kind: "link", url: "https://example.com/a" }] });
    await assert.rejects(assertTasksAllowClockOut(String(sales._id), today), /menunggu persetujuan/);
    await assert.rejects(reviewTask(leadCtx, { taskId: String(assigned._id), decision: "reject", note: "x" }), /minimal 5/);
    await reviewTask(leadCtx, { taskId: String(assigned._id), decision: "reject", note: "Tautan tidak bisa dibuka" });
    await assert.rejects(assertTasksAllowClockOut(String(sales._id), today), /Selesaikan task/);

    // Excusing keeps a reason and opens the way out.
    await assert.rejects(waiveTask(leadCtx, { taskId: String(assigned._id), note: "" }), /alasan/);
    await waiveTask(leadCtx, { taskId: String(assigned._id), note: "Klien membatalkan" });
    await assertTasksAllowClockOut(String(sales._id), today);
    assert.equal((await DailyTask.findById(assigned._id)).status, "waived");
  } finally {
    database.connection.testDriver = undefined;
    await pg.close();
  }
});
