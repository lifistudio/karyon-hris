import crypto from "crypto";
import database, { RecordId } from "@/lib/postgres";
import { connectToDatabase } from "@/lib/db";
import { logActivity } from "@/lib/audit/logger";
import { BadRequest, Conflict, Forbidden, NotFound } from "@/lib/http-error";
import { checkPermission } from "@/lib/rbac";
import { attachmentInputSchema, type AttachmentInput, type StoredAttachment } from "@/lib/attachments";
import { claimAttachments, presentAttachment } from "@/lib/uploads";
import { notifyUsers, resolveRecipientForEmployee, resolveRecipientsByUserIds } from "@/lib/notification/notify";
import { getSettings } from "@/lib/settings";
import { resolveSchedule } from "@/lib/hr/calendar";
import { wibDateKey, wibEndOfDay, wibParts, wibStartOfDay } from "@/lib/time";
import type { GuardContext } from "@/lib/guard";
import Attendance from "@/models/Attendance";
import AttendanceTaskPolicy from "@/models/AttendanceTaskPolicy";
import DailyTask from "@/models/DailyTask";
import Employee from "@/models/Employee";
import LeaveRequest from "@/models/LeaveRequest";
import User from "@/models/User";
import {
  MATCH_FIELDS,
  MAX_PROOF_ITEMS,
  policyCovers,
  proofProblem,
  sanitizePolicyTasks,
  sanitizeProofTypes,
  summarizeTasks,
  type PolicyTask,
  type ProofMode,
  type ProofType,
  type TaskStatus,
} from "./attendance-tasks";

/**
 * Daily task rules. The attendance route, the portal and the supervisor screens
 * all go through here, so "may this person clock out" has a single answer.
 *
 * Fixed tasks are copied onto the day the first time anyone needs them. That
 * keeps history stable and means nothing has to run at midnight.
 */

const MATERIALIZE_DAYS_BACK = 7;

export interface LeanTask {
  _id: RecordId;
  employeeId: RecordId;
  dateKey: string;
  taskKey: string;
  source: "fixed" | "assigned";
  title: string;
  description: string;
  proofTypes: ProofType[];
  proofMode: ProofMode;
  required: boolean;
  blockClockOut: boolean;
  countsAttendance: boolean;
  requireReview: boolean;
  status: TaskStatus;
  proofText: string;
  proofItems: StoredAttachment[];
  submittedAt?: Date | null;
  reviewNote: string;
}

interface LeanPolicy {
  _id: RecordId;
  name: string;
  tasks: PolicyTask[];
  blockClockOut: boolean;
  countsAttendance: boolean;
  requireReview: boolean;
  roleIds: unknown[];
  divisionIds: unknown[];
  positionIds: unknown[];
  employeeIds: unknown[];
  branchIds: unknown[];
}

function oid(value: unknown, message: string): string {
  if (!RecordId.isValid(value)) throw BadRequest(message);
  return String(value);
}

function audit(ctx: GuardContext, action: string, after: unknown, before: unknown = null) {
  void logActivity({
    userId: ctx.user.id,
    action,
    module: "attendance",
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

function notifyQuietly(work: () => Promise<void>) {
  void work().catch((err) => console.error("Notifikasi task gagal dikirim:", err));
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/* ------------------------------------------------------------------ */
/* Who is covered                                                       */
/* ------------------------------------------------------------------ */

async function employeeFacts(employeeId: string) {
  const employee = await Employee.findById(employeeId).select("_id divisionId positionId branchId").lean<{ _id: RecordId; divisionId?: unknown; positionId?: unknown; branchId?: unknown } | null>();
  if (!employee) return null;
  const user = await User.findOne({ employeeId }).select("roleId").lean<{ roleId?: unknown } | null>();
  const text = (value: unknown) => (value ? String(value) : null);
  return { id: employeeId, roleId: text(user?.roleId), divisionId: text(employee.divisionId), positionId: text(employee.positionId), branchId: text(employee.branchId) };
}

async function policiesFor(employeeId: string): Promise<LeanPolicy[]> {
  const facts = await employeeFacts(employeeId);
  if (!facts) return [];
  const policies = await AttendanceTaskPolicy.find({ isActive: true }).lean<LeanPolicy[]>();
  return policies.filter((p) => policyCovers(p, facts));
}

/** Nobody owes tasks on a day they are not working. */
async function isWorkingDay(employeeId: string, dateKey: string) {
  const start = wibStartOfDay(dateKey), end = wibEndOfDay(dateKey);
  const [employee, leave] = await Promise.all([
    Employee.findById(employeeId).populate("branchId", "name workHours").select("branchId").lean<{ branchId?: { name?: string; workHours?: { start?: string; end?: string } } | null } | null>(),
    LeaveRequest.exists({ employeeId, status: "approved", startDate: { $lte: end }, endDate: { $gte: start } }),
  ]);
  if (leave) return false;
  const schedule = await resolveSchedule(employeeId, dateKey, employee?.branchId ?? undefined);
  return !schedule.isOffDay;
}

/** Copies the fixed tasks due on a day. Safe to repeat; existing rows are left alone. */
export async function ensureDailyTasks(employeeId: string, dateKey: string): Promise<void> {
  // Only days that are or just were work: reading a far date must not write rows,
  // and a future copy would keep today's rules after a policy changes.
  const today = wibDateKey();
  if (dateKey > today || dateKey < wibDateKey(new Date(Date.now() - MATERIALIZE_DAYS_BACK * 86_400_000))) return;
  await connectToDatabase();
  const policies = await policiesFor(employeeId);
  if (!policies.length) return;
  const weekday = wibParts(wibStartOfDay(dateKey)).weekday;
  const due = policies.flatMap((policy) =>
    (policy.tasks ?? []).filter((t) => !t.weekdays?.length || t.weekdays.includes(weekday)).map((task) => ({ policy, task, taskKey: `${policy._id}:${task.id}` })));
  if (!due.length) return;
  const existing = await DailyTask.find({ employeeId, dateKey }).select("taskKey").lean<Array<{ taskKey: string }>>();
  const have = new Set(existing.map((t) => t.taskKey));
  const missing = due.filter((d) => !have.has(d.taskKey));
  if (!missing.length || !(await isWorkingDay(employeeId, dateKey))) return;
  await database.transaction(async () => {
    // Two tabs opening the same morning must not race for the unique index.
    await database.connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`daily-task:${employeeId}:${dateKey}`]);
    const inside = new Set((await DailyTask.find({ employeeId, dateKey }).select("taskKey").lean<Array<{ taskKey: string }>>()).map((t) => t.taskKey));
    for (const { policy, task, taskKey } of missing) {
      if (inside.has(taskKey)) continue;
      await DailyTask.create({
        employeeId, dateKey, taskKey, source: "fixed", policyId: policy._id,
        title: task.title, description: task.description, proofTypes: task.proofTypes, proofMode: task.proofMode, required: task.required,
        blockClockOut: policy.blockClockOut, countsAttendance: policy.countsAttendance, requireReview: policy.requireReview,
      });
    }
  });
}

/** Keeps the attendance row's task counters equal to the tasks themselves. */
export async function syncAttendanceTasks(employeeId: string, dateKey: string) {
  const tasks = await DailyTask.find({ employeeId, dateKey }).lean<LeanTask[]>();
  const summary = summarizeTasks(tasks);
  await Attendance.updateMany(
    { employeeId, date: { $gte: wibStartOfDay(dateKey), $lte: wibEndOfDay(dateKey) } },
    { $set: { tasksTotal: summary.total, tasksPending: summary.pending, tasksCountAttendance: summary.countsAttendance } }
  );
  return summary;
}

/** Throws when open tasks stop this employee from clocking out. */
export async function assertTasksAllowClockOut(employeeId: string, dateKey: string) {
  await ensureDailyTasks(employeeId, dateKey);
  const tasks = await DailyTask.find({ employeeId, dateKey }).lean<LeanTask[]>();
  const { blocking } = summarizeTasks(tasks);
  if (!blocking.length) return;
  const names = blocking.slice(0, 3).map((t) => t.title).join(", ") + (blocking.length > 3 ? `, dan ${blocking.length - 3} lainnya` : "");
  const waitingReview = blocking.every((t) => t.status === "submitted");
  throw Object.assign(
    Conflict(waitingReview
      ? `Absen pulang menunggu persetujuan atasan untuk: ${names}.`
      : `Selesaikan task berikut sebelum absen pulang: ${names}. Bila berhalangan, minta atasan membebaskan task.`),
    { code: "TASKS_INCOMPLETE" }
  );
}

async function presentTask(task: LeanTask) {
  return { ...task, proofItems: await Promise.all((task.proofItems ?? []).map((item) => presentAttachment(item))) };
}

/** The employee's own view of a day. */
export async function tasksForDay(employeeId: string, dateKey: string) {
  await ensureDailyTasks(employeeId, dateKey);
  const tasks = await DailyTask.find({ employeeId, dateKey }).sort({ source: -1, createdAt: 1 }).lean<LeanTask[]>();
  const summary = summarizeTasks(tasks);
  return {
    dateKey,
    tasks: await Promise.all(tasks.map(presentTask)),
    summary: { total: summary.total, done: summary.done, pending: summary.pending, blocked: summary.blocking.length > 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Doing a task                                                         */
/* ------------------------------------------------------------------ */

interface SubmitInput {
  taskId: unknown;
  text?: unknown;
  attachments?: unknown;
}

export async function submitTask(ctx: GuardContext & { employeeId: string }, input: SubmitInput) {
  const id = oid(input.taskId, "ID task tidak valid.");
  const text = clean(input.text, 4000);
  const raw = Array.isArray(input.attachments) ? input.attachments : [];
  if (raw.length > MAX_PROOF_ITEMS) throw BadRequest(`Maksimal ${MAX_PROOF_ITEMS} lampiran.`);
  const attachments: AttachmentInput[] = raw.map((item) => {
    const parsed = attachmentInputSchema.safeParse(item);
    if (!parsed.success) throw BadRequest(parsed.error.issues[0]?.message ?? "Lampiran tidak valid.");
    return parsed.data;
  });

  await connectToDatabase();
  const task = await DailyTask.findOne({ _id: id, employeeId: ctx.employeeId });
  if (!task) throw NotFound("Task tidak ditemukan.");
  if (task.status === "approved" || task.status === "waived") throw Conflict("Task ini sudah selesai.");

  // Past days stay open only for the grace the company allows.
  const settings = await getSettings();
  const graceDays = Number(settings.attendance_task_backfill_days ?? 1);
  const age = Math.round((wibStartOfDay(wibDateKey()).getTime() - wibStartOfDay(task.dateKey).getTime()) / 86_400_000);
  if (age < 0) throw BadRequest("Task untuk hari mendatang belum dapat dikerjakan.");
  if (age > graceDays) throw BadRequest("Batas mengirim bukti task ini sudah lewat. Hubungi atasan Anda.");

  const attendance = await Attendance.findOne({ employeeId: ctx.employeeId, date: { $gte: wibStartOfDay(task.dateKey), $lte: wibEndOfDay(task.dateKey) } })
    .select("clockIn").lean<{ clockIn?: Date } | null>();
  if (!attendance?.clockIn) throw BadRequest("Absen masuk dulu sebelum mengerjakan task.");

  const links = attachments.filter((a) => a.kind === "link").length;
  const problem = proofProblem(task, { text, files: attachments.length - links, links });
  if (problem) throw BadRequest(problem);

  const dateKey = task.dateKey;
  const proofItems = attachments.length
    ? await claimAttachments(attachments, { context: "task", ownerUserId: ctx.user.id, destination: `task-proofs/${ctx.employeeId}/${dateKey}` })
    : [];
  task.proofText = text;
  task.proofItems = proofItems;
  task.status = "submitted";
  task.submittedAt = new Date();
  task.reviewNote = "";
  await task.save();
  const summary = await syncAttendanceTasks(ctx.employeeId, dateKey);
  audit(ctx, "SUBMIT_DAILY_TASK", { taskId: id, dateKey, title: task.title, files: proofItems.length });

  if (task.requireReview) notifyLeads(ctx.employeeId, task.title, dateKey);
  return { task: await presentTask(task.toObject() as LeanTask), summary };
}

function notifyLeads(employeeId: string, title: string, dateKey: string) {
  notifyQuietly(async () => {
    const employee = await Employee.findById(employeeId).select("name supervisorId storeManagerId areaManagerId").lean<{ name: string; supervisorId?: unknown; storeManagerId?: unknown; areaManagerId?: unknown } | null>();
    const leads = [employee?.supervisorId, employee?.storeManagerId, employee?.areaManagerId].filter(Boolean);
    if (!leads.length) return;
    const users = await User.find({ employeeId: { $in: leads }, isActive: { $ne: false } }).select("_id").lean<Array<{ _id: RecordId }>>();
    await notifyUsers(await resolveRecipientsByUserIds(users.map((u) => u._id)), {
      kind: "attendance",
      title: "Bukti task menunggu persetujuan",
      body: `${employee?.name ?? "Karyawan"} mengirim bukti untuk "${title}".`,
      href: `/portal/team-tasks?date=${dateKey}`,
      refType: `task:review:${employeeId}:${dateKey}`,
      emailOptOut: true,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Supervisors                                                          */
/* ------------------------------------------------------------------ */

/**
 * Employees this person leads. Direct reports (supervisor, store manager or
 * area manager on the employee record) always count, whatever the role is
 * called in this company; `attendance:write` widens that to its scope.
 */
export async function teamFilter(ctx: GuardContext): Promise<Record<string, unknown> | null> {
  const permission = await checkPermission(ctx.user.id, "attendance", "write");
  const me = ctx.user.employeeId;
  const reports = me ? [{ supervisorId: me }, { storeManagerId: me }, { areaManagerId: me }] : [];
  if (permission.allowed) {
    if (permission.scope === "all") return {};
    if (permission.scope === "branch" && ctx.user.branchId) reports.push({ branchId: ctx.user.branchId } as never);
    if (permission.scope === "division" && ctx.user.divisionId) reports.push({ divisionId: ctx.user.divisionId } as never);
  }
  return reports.length ? { $or: reports } : null;
}

export async function isLead(ctx: GuardContext): Promise<boolean> {
  const filter = await teamFilter(ctx);
  if (!filter) return false;
  return Boolean(await Employee.exists({ ...filter, status: { $in: ["active", "onboarding"] } }));
}

async function assertLeads(ctx: GuardContext, employeeIds: string[]) {
  const filter = await teamFilter(ctx);
  if (!filter) throw Forbidden("Anda tidak memiliki anggota tim.");
  // Nobody excuses or approves their own work.
  if (ctx.user.employeeId && employeeIds.includes(ctx.user.employeeId)) throw Forbidden("Task Anda sendiri ditangani atasan Anda.");
  const allowed = await Employee.countDocuments({ ...filter, _id: { $in: employeeIds } });
  if (allowed !== employeeIds.length) throw Forbidden("Sebagian karyawan bukan anggota tim Anda.");
}

interface AssignInput {
  employeeIds: unknown;
  dates: unknown;
  title: unknown;
  description?: unknown;
  proofTypes?: unknown;
  proofMode?: unknown;
  required?: unknown;
  requireReview?: unknown;
}

const MAX_ASSIGN_DAYS = 31;
const MAX_ASSIGN_EMPLOYEES = 200;

export async function assignTask(ctx: GuardContext, input: AssignInput) {
  const title = clean(input.title, 150);
  if (title.length < 3) throw BadRequest("Isi judul task minimal 3 karakter.");
  if (!Array.isArray(input.employeeIds) || !input.employeeIds.length) throw BadRequest("Pilih minimal satu karyawan.");
  if (input.employeeIds.length > MAX_ASSIGN_EMPLOYEES) throw BadRequest(`Maksimal ${MAX_ASSIGN_EMPLOYEES} karyawan sekali kirim.`);
  const employeeIds = [...new Set(input.employeeIds.map((id) => oid(id, "ID karyawan tidak valid.")))];
  const dates = Array.isArray(input.dates) ? [...new Set(input.dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))] : [];
  if (!dates.length || dates.length > MAX_ASSIGN_DAYS) throw BadRequest(`Pilih 1 sampai ${MAX_ASSIGN_DAYS} tanggal.`);
  const today = wibDateKey();
  if (dates.some((d) => d < today)) throw BadRequest("Task tidak dapat diberikan untuk tanggal yang sudah lewat.");

  await connectToDatabase();
  await assertLeads(ctx, employeeIds);

  // The employee's own policy decides how a supervisor's task behaves at clock-out.
  const proofTypes = sanitizeProofTypes(input.proofTypes);
  let created = 0;
  await database.transaction(async () => {
    for (const employeeId of employeeIds) {
      const policies = await policiesFor(employeeId);
      for (const dateKey of dates) {
        await DailyTask.create({
          employeeId, dateKey, taskKey: `a:${crypto.randomBytes(8).toString("hex")}`, source: "assigned",
          title, description: clean(input.description, 1000), proofTypes, proofMode: input.proofMode === "all" ? "all" : "any",
          required: input.required !== false,
          blockClockOut: policies.length ? policies.some((p) => p.blockClockOut) : true,
          countsAttendance: policies.some((p) => p.countsAttendance),
          requireReview: input.requireReview === true || policies.some((p) => p.requireReview),
          assignedBy: ctx.user.id,
        });
        created += 1;
      }
    }
  });
  for (const employeeId of employeeIds) for (const dateKey of dates) if (dateKey === today) await syncAttendanceTasks(employeeId, dateKey);
  audit(ctx, "ASSIGN_DAILY_TASK", { title, employees: employeeIds.length, dates });

  notifyQuietly(async () => {
    const when = dates.length === 1 ? (dates[0] === today ? "hari ini" : `tanggal ${dates[0]}`) : `${dates.length} hari`;
    for (const employeeId of employeeIds) {
      await notifyUsers(await resolveRecipientForEmployee(employeeId), {
        kind: "attendance",
        title: "Task baru dari atasan",
        body: `"${title}" untuk ${when}.`,
        href: "/portal/attendance",
        refType: "DailyTask",
        emailOptOut: true,
      });
    }
  });
  return { created };
}

async function loadForLead(ctx: GuardContext, taskId: unknown) {
  await connectToDatabase();
  const task = await DailyTask.findById(oid(taskId, "ID task tidak valid."));
  if (!task) throw NotFound("Task tidak ditemukan.");
  await assertLeads(ctx, [String(task.employeeId)]);
  return task;
}

/** Approves or sends back submitted proof. */
export async function reviewTask(ctx: GuardContext, input: { taskId: unknown; decision: unknown; note?: unknown; submittedAt?: unknown }) {
  const task = await loadForLead(ctx, input.taskId);
  if (input.decision !== "approve" && input.decision !== "reject") throw BadRequest("Keputusan harus setujui atau tolak.");
  if (task.status !== "submitted" && task.status !== "approved") throw Conflict("Hanya bukti yang sudah dikirim yang dapat ditinjau.");
  // An approval covers the proof the lead looked at, not one sent after the page loaded.
  if (input.decision === "approve" && new Date(String(input.submittedAt)).getTime() !== task.submittedAt?.getTime()) {
    throw Conflict("Karyawan baru saja mengganti bukti. Muat ulang lalu tinjau bukti terbaru.");
  }
  const note = clean(input.note, 500);
  if (input.decision === "reject" && note.length < 5) throw BadRequest("Tuliskan apa yang perlu diperbaiki (minimal 5 karakter).");
  const before = task.status;
  task.status = input.decision === "approve" ? "approved" : "rejected";
  task.reviewedBy = ctx.user.id as unknown as RecordId;
  task.reviewedAt = new Date();
  task.reviewNote = note;
  await task.save();
  await syncAttendanceTasks(String(task.employeeId), task.dateKey);
  audit(ctx, input.decision === "approve" ? "APPROVE_DAILY_TASK" : "REJECT_DAILY_TASK", { taskId: String(task._id), title: task.title, note }, { status: before });
  if (input.decision === "reject") {
    const { employeeId, title } = task;
    notifyQuietly(async () => {
      await notifyUsers(await resolveRecipientForEmployee(String(employeeId)), {
        kind: "attendance",
        title: "Bukti task perlu diperbaiki",
        body: `"${title}": ${note}`,
        href: "/portal/attendance",
        refType: "DailyTask",
        refId: String(task._id),
      });
    });
  }
  return task;
}

/** Excuses a task, for the day a client cancelled or the employee had to leave. */
export async function waiveTask(ctx: GuardContext, input: { taskId: unknown; note: unknown }) {
  const task = await loadForLead(ctx, input.taskId);
  const note = clean(input.note, 500);
  if (note.length < 5) throw BadRequest("Tuliskan alasan pembebasan (minimal 5 karakter).");
  if (task.status === "approved" || task.status === "waived") throw Conflict("Task ini sudah selesai.");
  const before = task.status;
  task.status = "waived";
  task.reviewedBy = ctx.user.id as unknown as RecordId;
  task.reviewedAt = new Date();
  task.reviewNote = note;
  await task.save();
  await syncAttendanceTasks(String(task.employeeId), task.dateKey);
  audit(ctx, "WAIVE_DAILY_TASK", { taskId: String(task._id), title: task.title, note }, { status: before });
  return task;
}

export async function removeAssignedTask(ctx: GuardContext, input: { taskId: unknown }) {
  const task = await loadForLead(ctx, input.taskId);
  if (task.source !== "assigned") throw BadRequest("Task tetap dari aturan tidak dapat dihapus. Gunakan bebaskan task.");
  if (task.status !== "pending") throw Conflict("Task yang sudah dikerjakan tidak dapat dihapus.");
  const { employeeId, dateKey, title } = task;
  await DailyTask.deleteOne({ _id: task._id });
  await syncAttendanceTasks(String(employeeId), dateKey);
  audit(ctx, "REMOVE_DAILY_TASK", { title, dateKey, employeeId: String(employeeId) });
}

/** A team's tasks for a day, grouped by employee. */
export async function teamTasks(ctx: GuardContext, dateKey: string, extra: Record<string, unknown> = {}) {
  await connectToDatabase();
  const filter = await teamFilter(ctx);
  if (!filter) return { isLead: false, rows: [] };
  const employees = await Employee.find({ ...filter, ...extra, status: { $in: ["active", "onboarding"] } })
    .select("name employeeId divisionId positionId branchId")
    .populate("divisionId", "name").populate("positionId", "name").populate("branchId", "name")
    .sort({ name: 1 }).limit(500)
    .lean<Array<{ _id: RecordId; name: string; employeeId: string; divisionId?: { name?: string } | null; positionId?: { name?: string } | null; branchId?: { name?: string } | null }>>();
  const self = ctx.user.employeeId;
  const team = employees.filter((e) => String(e._id) !== self);
  if (!team.length) return { isLead: false, rows: [] };
  if (await AttendanceTaskPolicy.exists({ isActive: true })) {
    await Promise.all(team.map((e) => ensureDailyTasks(String(e._id), dateKey)));
  }
  const ids = team.map((e) => e._id);
  const [tasks, attendances] = await Promise.all([
    DailyTask.find({ employeeId: { $in: ids }, dateKey }).sort({ createdAt: 1 }).lean<LeanTask[]>(),
    Attendance.find({ employeeId: { $in: ids }, date: { $gte: wibStartOfDay(dateKey), $lte: wibEndOfDay(dateKey) } }).select("employeeId clockIn clockOut").lean<Array<{ employeeId: RecordId; clockIn?: Date; clockOut?: Date }>>(),
  ]);
  const shown = await Promise.all(tasks.map(presentTask));
  const rows = team.flatMap((employee) => {
    const own = shown.filter((t) => String(t.employeeId) === String(employee._id));
    if (!own.length) return [];
    const att = attendances.find((a) => String(a.employeeId) === String(employee._id));
    const summary = summarizeTasks(own);
    return [{
      employee: { _id: String(employee._id), name: employee.name, employeeId: employee.employeeId, division: employee.divisionId?.name ?? null, position: employee.positionId?.name ?? null, branch: employee.branchId?.name ?? null },
      clockIn: att?.clockIn ?? null,
      clockOut: att?.clockOut ?? null,
      summary: { total: summary.total, done: summary.done, pending: summary.pending, waitingReview: own.filter((t) => t.status === "submitted" && t.requireReview).length },
      tasks: own,
    }];
  });
  return { isLead: true, rows, teamSize: team.length };
}

/** Everyone a lead can give a task to. */
export async function teamMembers(ctx: GuardContext) {
  await connectToDatabase();
  const filter = await teamFilter(ctx);
  if (!filter) return [];
  const rows = await Employee.find({ ...filter, status: { $in: ["active", "onboarding"] } })
    .select("name employeeId divisionId").populate("divisionId", "name").sort({ name: 1 }).limit(1000)
    .lean<Array<{ _id: RecordId; name: string; employeeId: string; divisionId?: { name?: string } | null }>>();
  return rows.filter((e) => String(e._id) !== ctx.user.employeeId);
}

/* ------------------------------------------------------------------ */
/* Policies                                                             */
/* ------------------------------------------------------------------ */

const ids = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((v) => RecordId.isValid(v)).map(String))] : []);

interface PolicyInput {
  id?: unknown;
  name?: unknown;
  isActive?: unknown;
  roleIds?: unknown;
  divisionIds?: unknown;
  positionIds?: unknown;
  employeeIds?: unknown;
  branchIds?: unknown;
  tasks?: unknown;
  blockClockOut?: unknown;
  countsAttendance?: unknown;
  requireReview?: unknown;
}

export async function savePolicy(ctx: GuardContext, input: PolicyInput) {
  const name = clean(input.name, 120);
  if (name.length < 3) throw BadRequest("Isi nama aturan minimal 3 karakter.");
  const target = Object.fromEntries(MATCH_FIELDS.map((f) => [f, ids(input[f])]));
  if (!MATCH_FIELDS.some((f) => (target[f] as string[]).length)) throw BadRequest("Pilih minimal satu role, divisi, jabatan, atau karyawan.");
  const doc = {
    ...target,
    name,
    branchIds: ids(input.branchIds),
    isActive: input.isActive !== false,
    tasks: sanitizePolicyTasks(input.tasks),
    blockClockOut: input.blockClockOut !== false,
    countsAttendance: input.countsAttendance !== false,
    requireReview: input.requireReview === true,
  };
  await connectToDatabase();
  if (input.id) {
    const id = oid(input.id, "ID aturan tidak valid.");
    const before = await AttendanceTaskPolicy.findById(id).lean<Record<string, unknown> | null>();
    if (!before) throw NotFound("Aturan tidak ditemukan.");
    const saved = await AttendanceTaskPolicy.findByIdAndUpdate(id, { $set: doc }, { new: true });
    audit(ctx, "UPDATE_ATTENDANCE_TASK_POLICY", doc, before);
    return saved;
  }
  const saved = await AttendanceTaskPolicy.create({ ...doc, createdBy: ctx.user.id });
  audit(ctx, "CREATE_ATTENDANCE_TASK_POLICY", doc);
  return saved;
}

export async function deletePolicy(ctx: GuardContext, policyId: unknown) {
  const id = oid(policyId, "ID aturan tidak valid.");
  await connectToDatabase();
  const before = await AttendanceTaskPolicy.findById(id).lean<Record<string, unknown> | null>();
  if (!before) throw NotFound("Aturan tidak ditemukan.");
  await AttendanceTaskPolicy.deleteOne({ _id: id });
  audit(ctx, "DELETE_ATTENDANCE_TASK_POLICY", null, before);
}

