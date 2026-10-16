import { RecordId, Model } from "@/lib/postgres";
/** Additive, rerunnable synthetic fixture set. No existing account is modified. */
import database from "@/lib/postgres";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { connectToDatabase } from "../lib/db";
import { DemoSeedRun } from "../lib/postgres-auxiliary";
import { eachDayKey, isWeekendKey, wibStartOfDay, wibStartOfMonth, wibEndOfMonth, wibPeriodKey, wibDateKey } from "../lib/time";
// Community demo fixtures do not execute the private payroll policy engine.
const classifyLateness = (logs: Array<{date:string;lateMinutes:number}>, _policy:unknown, absent:string[]) => ({lateMinutes:logs.reduce((n,l)=>n+l.lateMinutes,0),lateDays:logs.filter(l=>l.lateMinutes>0).length,absentDays:absent.length,absentDates:absent,convertedDates:[] as string[]});
const attendanceDeductions = (_facts:unknown,_policy:unknown) => ({late:0,absent:0,total:0});
import { SETTING_DEFS } from "../lib/settings";
import Role from "../models/Role";
import User from "../models/User";
import Employee from "../models/Employee";
import Branch from "../models/Branch";
import Division from "../models/Division";
import Position from "../models/Position";
import WorkSchedule from "../models/WorkSchedule";
import EmployeeSchedule from "../models/EmployeeSchedule";
import Attendance from "../models/Attendance";
import AttendanceCorrection from "../models/AttendanceCorrection";
import LeaveType from "../models/LeaveType";
import LeaveRequest from "../models/LeaveRequest";
import LeaveBalance from "../models/LeaveBalance";
import HolidaySwapRequest from "../models/HolidaySwapRequest";
import ApprovalInstance from "../models/ApprovalInstance";
import OvertimeRecord from "../models/OvertimeRecord";
import Contract from "../models/Contract";
import PayProfile from "../models/PayProfile";
import PayrollInput from "../models/PayrollInput";
import Payroll from "../models/Payroll";
import Inventory from "../models/Inventory";
import InventoryAssignment from "../models/InventoryAssignment";
import AuditReport from "../models/AuditReport";
import Complaint from "../models/Complaint";
import KpiEvaluation from "../models/KpiEvaluation";
import JobVacancy, { DEFAULT_STAGES } from "../models/JobVacancy";
import Candidate from "../models/Candidate";
import CandidateStageHistory from "../models/CandidateStageHistory";
import Notification from "../models/Notification";
import DisciplineCase from "../models/DisciplineCase";
import NationalHoliday from "../models/NationalHoliday";
import Setting from "../models/Setting";

const TAG = "hris-demo-200-v1";
type SeedModel = Model<Record<string, unknown>>;
type SeedDoc = Record<string, unknown> & { _id: RecordId; _demoSeed: string };
const batches = new Map<string, { model: SeedModel; docs: SeedDoc[] }>();
function oid(model: string, key: string | number) { return new RecordId(createHash("sha256").update(`${TAG}:${model}:${key}`).digest("hex").slice(0, 24)); }
const previousMonth = (period: string) => { const [y, m] = period.split("-").map(Number); return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`; };
let fixtureTime = new Date();
function add(model: SeedModel, key: string | number, payload: Record<string, unknown>) {
  const _id = oid(model.modelName, key);
  const document = new model({ _id, ...payload, createdAt: fixtureTime, updatedAt: fixtureTime });
  const error = document.validateSync();
  if (error) throw new Error(`Invalid fixture ${model.modelName}/${key}: ${error.message}`);
  const docs = batches.get(model.modelName) ?? { model, docs: [] };
  docs.docs.push({ ...document.toObject(), _id, _demoSeed: TAG } as SeedDoc);
  batches.set(model.modelName, docs);
  return _id;
}

export async function seedDemo({ apply = false }: { apply?: boolean } = {}) {
  batches.clear();
  if (process.env.NODE_ENV === "production") throw new Error("Seed demo dilarang pada NODE_ENV=production.");
  const password = process.env.DEMO_EMPLOYEE_PASSWORD || "DemoHris2026!";
  if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("Password demo harus 12–72 byte.");
  await connectToDatabase();
  const manifest = DemoSeedRun;
  const previous = await manifest.findOne({ _id: TAG });
  const period = previous?.period ?? previousMonth(wibPeriodKey());
  const cutoffDay = previous?.cutoffDay ?? wibDateKey(new Date(Date.now() - 86400_000));
  fixtureTime = wibStartOfMonth(period);
  const staff = await Role.findOne({ name: "STAFF" }).lean<{ _id: RecordId } | null>();
  const superRole = await Role.findOne({ name: "SUPERADMIN" }).lean<{ _id: RecordId } | null>();
  if (!staff || !superRole) throw new Error("Peran STAFF/SUPERADMIN belum tersedia. Bootstrap aplikasi diperlukan, bukan reset seed lama.");
  const adminsBefore = await User.find({ roleId: superRole._id }).sort({ _id: 1 }).lean();
  if (!adminsBefore.length) throw new Error("Akun superadmin belum ada.");
  const adminFingerprint = createHash("sha256").update(JSON.stringify(adminsBefore)).digest("hex");
  const actor = adminsBefore[0]._id;
  const hash = await bcrypt.hash(password, 12);
  const branches = [
    ["Jakarta", -6.1754, 106.8272], ["Bandung", -6.9175, 107.6191], ["Surabaya", -7.2575, 112.7521],
    ["Yogyakarta", -7.7956, 110.3695], ["Semarang", -6.9667, 110.4167],
  ] as const;
  branches.forEach(([city, lat, lng], i) => add(Branch, i, { name: `DEMO — ${city}`, address: `Titik ilustrasi pusat ${city}; bukan alamat kantor nyata.`, lat, lng, radiusMeter: 100, workHours: { start: "09:00", end: "17:00" } }));
  const divisions = ["Operasional", "Penjualan", "Keuangan", "Teknologi", "Layanan Pelanggan"];
  divisions.forEach((name, i) => {
    add(Division, i, { name: `DEMO — ${name}`, branchId: oid("Branch", i) });
    add(Position, i, { name: `DEMO Staff ${name}`, divisionId: oid("Division", i), description: "Jabatan sintetis untuk pengujian tampilan." });
  });
  add(WorkSchedule, 0, { name: "DEMO Reguler 09–17", clockIn: "09:00", clockOut: "17:00", breakOut: "12:00", breakIn: "13:00", isBreakActive: true, activeDays: [1, 2, 3, 4, 5], gracePeriodMinutes: 5,
    days: Array.from({ length: 7 }, (_, day) => ({ day, active: day > 0 && day < 6, clockIn: "09:00", clockOut: "17:00", breakOut: "12:00", breakIn: "13:00" })) });
  const leaveTypeId = add(LeaveType, 0, { name: "DEMO Cuti Tahunan", description: "Data contoh; tidak mengubah jenis cuti asli.", quotaDays: 12 });
  const [anchorYear, anchorMonth] = period.split("-").map(Number);
  const nextMonth = `${anchorMonth === 12 ? anchorYear + 1 : anchorYear}-${String(anchorMonth === 12 ? 1 : anchorMonth + 1).padStart(2, "0")}`;
  const months = [previousMonth(period), period, nextMonth];
  const existingHolidays = await NationalHoliday.find({ dateKey: { $gte: wibDateKey(wibStartOfMonth(months[0])), $lte: wibDateKey(wibEndOfMonth(nextMonth)) }, isActive: true }).select("dateKey").lean();
  const holidayKeys = new Set(existingHolidays.map((h) => h.dateKey));
  const allWorkdays = months.map((p) => eachDayKey(wibStartOfMonth(p), wibEndOfMonth(p)).filter((d) => d <= cutoffDay && !isWeekendKey(d) && !holidayKeys.has(d)));
  if (allWorkdays.some((days) => days.length === 0)) throw new Error("Periode demo belum memiliki hari kerja selesai; jalankan setelah hari kerja pertama.");
  const given = ["Adi", "Bima", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hana", "Indra", "Jihan", "Kevin", "Laras", "Maya", "Nanda", "Oki", "Putri", "Raka", "Sari", "Tania", "Yoga"];
  const family = ["Pratama", "Wijaya", "Santoso", "Lestari", "Saputra", "Utami", "Kusuma", "Permana", "Nugraha", "Pertiwi"];
  function approval(kind: string, refId: RecordId, employeeId: RecordId, userId: RecordId, key: string, status: string, divisionId: RecordId) {
    return add(ApprovalInstance, key, { refType: kind, refId, employeeId, divisionId, status, currentStep: 1,
      stepsStatus: [{ stepNumber: 1, approverRole: "HRD", status, ...(status !== "pending" ? { actionedBy: actor, actionedAt: fixtureTime, comment: "Keputusan contoh DEMO." } : {}) }],
      history: [{ action: "SUBMITTED", userId, timestamp: fixtureTime, comment: "Permintaan sintetis DEMO." }, ...(status !== "pending" ? [{ action: status.toUpperCase(), userId: actor, timestamp: fixtureTime, comment: "Keputusan sintetis DEMO." }] : [])],
    });
  }
  for (let i = 1; i <= 200; i++) {
    const group = (i - 1) % 5, num = String(i).padStart(3, "0"), name = `DEMO ${given[(i - 1) % 20]} ${family[Math.floor((i - 1) / 20)]} ${num}`;
    const employeeId = oid("Employee", i), userId = oid("User", i), divisionId = oid("Division", group);
    const email = `demo${num}@hris.invalid`;
    add(Employee, i, { employeeId: `DEMO-${num}`, name, officeEmail: email, personalEmail: `personal-${num}@hris.invalid`, gender: i % 2 ? "male" : "female", branchId: oid("Branch", group), divisionId, positionId: oid("Position", group), workScheduleId: oid("WorkSchedule", 0), status: i <= 190 ? "active" : i <= 195 ? "onboarding" : "resigned", joinDate: new Date("2025-01-01T00:00:00+07:00"), employmentStatus: i % 3 ? "pkwt" : "pkwtt", taxStatus: "TK/0", birthPlace: branches[group][0] });
    // Disposable test-only accounts use an invalid mail domain; no email OTP is sent.
    add(User, i, { email, passwordHash: hash, roleId: staff._id, employeeId, isActive: i <= 195, mustChangePassword: false });
    add(Contract, i, { employeeId, contractNumber: `DEMO/CONTRACT/${num}`, type: "pkwt", startDate: new Date("2025-01-01T00:00:00+07:00"), endDate: new Date("2027-12-31T00:00:00+07:00"), salarySnapshot: { basicSalary: 4000000 + group * 500000, allowances: 250000 }, status: i > 195 ? "ended" : "active", createdBy: actor, body: "Dokumen DEMO sintetis, bukan kontrak sah.", positionName: `Staff ${divisions[group]}` });
    add(PayProfile, i, { employeeId, overtimeMode: "company_rate", exemptLatePenalty: i % 19 === 0, target: { enabled: false }, recurring: [{ kind: "earning", name: "DEMO transport", amount: 150000 }], updatedBy: actor });
    let used = 0, pending = 0;
    for (let m = 0; m < months.length; m++) {
      const p = months[m], days = allWorkdays[m], baseKey = `${i}:${p}`;
      const leaveStatus = i % 3 === 0 ? "pending" : i % 3 === 1 ? "approved" : "rejected";
      if (leaveStatus === "approved") used++; if (leaveStatus === "pending") pending++;
      const leaveDate = days[(i + 2) % days.length], leaveId = oid("LeaveRequest", baseKey);
      const approvalId = approval("leave", leaveId, employeeId, userId, `leave:${baseKey}`, leaveStatus, divisionId);
      add(LeaveRequest, baseKey, { employeeId, leaveTypeId, startDate: wibStartOfDay(leaveDate), endDate: wibStartOfDay(leaveDate), chargedDays: 1, calendarDays: 1, reason: "DEMO keperluan keluarga sintetis.", status: leaveStatus, approvalInstanceId: approvalId });
      const logs: Array<{ id: string; date: string; lateMinutes: number }> = [], absent: string[] = [];
      for (let d = 0; d < days.length; d++) {
        const day = days[d];
        if (day === leaveDate && leaveStatus === "approved") continue;
        if ((i + d) % 17 === 0) { absent.push(day); continue; }
        const minutes = (i + d) % 13 === 0 ? 260 : (i + d) % 4 === 0 ? 15 + i % 80 : 0;
        const attendanceId = add(Attendance, `${i}:${day}`, { employeeId, date: wibStartOfDay(day), clockIn: new Date(new Date(`${day}T09:00:00+07:00`).getTime() + minutes * 60000), clockOut: new Date(`${day}T17:00:00+07:00`), breakOut: new Date(`${day}T12:00:00+07:00`), breakIn: new Date(`${day}T13:00:00+07:00`), gpsLat: branches[group][1], gpsLng: branches[group][2], gpsAccuracy: 10, branchId: oid("Branch", group), distanceMeter: 5, isLate: minutes > 0, lateMinutes: minutes, scheduleClockIn: "09:00", scheduleClockOut: "17:00", needsReview: minutes > 240, note: "DEMO — catatan sintetis, tanpa foto atau biometrik." });
        logs.push({ id: String(attendanceId), date: day, lateMinutes: minutes });
      }
      const correctionKey = `${baseKey}:correction`, correctionId = oid("AttendanceCorrection", correctionKey);
      const correctionApproval = approval("correction", correctionId, employeeId, userId, correctionKey, "pending", divisionId);
      add(AttendanceCorrection, correctionKey, { employeeId, date: wibStartOfDay(days[0]), clockInTime: "09:00", clockOutTime: "17:00", reasonType: "kendala_aplikasi", reasonNote: "DEMO pengajuan koreksi untuk menguji alur persetujuan.", status: "pending", approvalInstanceId: correctionApproval });
      add(OvertimeRecord, baseKey, { employeeId, date: wibStartOfDay(days[days.length - 1]), hours: 1 + i % 3, source: "manual", status: "approved", note: "DEMO lembur sintetis." });
      add(PayrollInput, baseKey, { employeeId, period: p, adjustments: [{ kind: "earning", name: "DEMO bonus", amount: 100000 }], targetActual: null, updatedBy: actor });
      const policy = { latePerMinute: 1000, latePenaltyCap: 100000, absentPerDay: 50000, lateUnit: "minute" as const, alphaEnabled: true, alphaAfterHours: 4 };
      const classified = classifyLateness(logs, policy, absent);
      const facts = { lateMinutes: classified.lateMinutes, lateDays: classified.lateDays, absentDays: classified.absentDays, exemptLate: i % 19 === 0, exemptAbsent: false };
      const result = attendanceDeductions(facts, policy), basicSalary = 4000000 + group * 500000, overtimeSalary = (1 + i % 3) * 25000, gross = basicSalary + 500000 + overtimeSalary;
      const uncappedLate = facts.exemptLate ? 0 : facts.lateMinutes * 1000;
      const generatedAt = p === nextMonth ? new Date(`${cutoffDay}T23:59:59+07:00`) : wibEndOfMonth(p);
      const snapshot = { engineVersion: "attendance-deductions-v2", rulesFingerprint: createHash("sha256").update(JSON.stringify(policy)).digest("hex"), capturedAt: generatedAt.toISOString(), period: p, policy, facts, result, attendance: logs, absentDates: classified.absentDates, convertedDates: classified.convertedDates, unconvertedAbsentDates: absent, uncappedLate, capExceeded: uncappedLate > policy.latePenaltyCap };
      add(Payroll, baseKey, { employeeId, period: p, basicSalary, allowances: [{ name: "DEMO tunjangan dan bonus", amount: 500000 }], deductions: [{ name: "DEMO keterlambatan", amount: result.late }, { name: "DEMO alpha", amount: result.absent }], overtimeHours: 1 + i % 3, overtimeSalary, lateMinutes: facts.lateMinutes, absentDays: facts.absentDays, presentDays: logs.length, workingDays: days.length, totalEarnings: gross, totalDeductions: result.total, netSalary: gross - result.total, generatedBy: actor, generatedAt, status: p === nextMonth || i % 5 === 0 ? "draft" : "published", source: "generated", decisionEvidence: snapshot, notes: ["DEMO sintetis; nominal ilustrasi bukan payroll nyata atau perhitungan pajak. Tarif demo tersimpan pada snapshot, tidak mengubah pengaturan perusahaan."] });
    }
    add(LeaveBalance, i, { employeeId, leaveTypeId, year: Number(period.slice(0, 4)), allocatedDays: 12, usedDays: used, pendingDays: pending, remainingDays: 12 - used - pending });
    const holiday = `${period.slice(0, 4)}-08-17`, swapId = oid("HolidaySwapRequest", i);
    const swapApproval = approval("holiday_swap", swapId, employeeId, userId, `swap:${i}`, "pending", divisionId);
    add(HolidaySwapRequest, i, { employeeId, holidayDate: wibStartOfDay(holiday), replacementDate: wibStartOfDay(allWorkdays[1][i % allWorkdays[1].length]), reason: "DEMO tukar libur, belum disetujui.", status: "pending", approvalInstanceId: swapApproval });
    add(EmployeeSchedule, i, { employeeId, date: wibStartOfDay(allWorkdays[1][0]), scheduleId: oid("WorkSchedule", 0), isOffDay: false, note: "DEMO penugasan jadwal", createdBy: actor });
    const asset = add(Inventory, i, { code: `DEMO-AST-${num}`, name: `DEMO ${i % 2 ? "Laptop" : "Telepon"} ${num}`, category: i % 2 ? "laptop" : "phone", condition: i % 15 ? "good" : "damaged", specs: [{ label: "Merek", value: i % 2 ? "Lenovo" : "Samsung" }, { label: "Nomor seri", value: `DEMO-SN-${num}` }], initialCheck: { condition: "good", checklist: [{ label: "Fisik & casing", result: "ok" }], notes: "", recordedAt: fixtureTime } });
    add(InventoryAssignment, i, { employeeId, inventoryId: asset, handoverDate: fixtureTime, handoverCondition: "good", signedAt: i % 3 === 0 ? null : fixtureTime, status: i % 3 === 0 ? "pending_handover" : "active" });
    if (i % 5 === 0) add(AuditReport, i, { auditorId: actor, inventoryId: asset, auditDate: fixtureTime, type: "incidental", previousCondition: "good", condition: i % 15 ? "good" : "damaged", findings: i % 15 ? [] : ["Kondisi berubah dari Baik menjadi Rusak"], notes: "DEMO audit aset sintetis.", status: i % 15 ? "verified" : "flagged" });
    add(KpiEvaluation, i, { employeeId, period, periodType: "monthly", scoreMode: "percent", title: "DEMO Kinerja Bulanan", finalScore: 65 + i % 31, gradeLabel: "DEMO", status: i % 4 === 0 ? "draft" : "submitted", evaluatorId: actor, submittedAt: fixtureTime, scores: [{ aspectKey: "delivery", aspectName: "Hasil kerja", aspectWeight: 100, indicatorKey: "target", indicatorName: "Target pekerjaan", indicatorWeight: 100, rawScore: 65 + i % 31, score: 65 + i % 31, note: "Ilustrasi sintetis" }], strengths: "DEMO kerja sama", improvements: "DEMO dokumentasi", developmentPlan: "DEMO pelatihan internal" });
    add(Notification, i, { userId, kind: "system", title: "Akun DEMO HRIS", body: "Seluruh data akun ini sintetis. Password bersama hanya untuk demo, bukan penggunaan produksi.", href: "/portal/profile", isRead: i % 2 === 0, createdAt: new Date() });
    if (i % 4 === 0) add(Complaint, i, { employeeId, reporterId: employeeId, target: "hrd", category: "fasilitas", subject: `DEMO fasilitas ${num}`, description: "DEMO permintaan perbaikan fasilitas kantor, bukan pengaduan nyata.", ticketCode: `DEMO-TKT-${num}`, status: i % 8 ? "received" : "in_progress" });
    if (i <= 32) {
      const actions = ["coaching", "warning", "sp1", "sp2", "sp3", "termination", "resignation", "other"];
      const action = actions[(i - 1) % actions.length], status = i % 3 ? "open" : "issued";
      add(DisciplineCase, i, { employeeId, category: action === "resignation" ? "separation" : i % 4 ? "misconduct" : "fatal", title: `DEMO tinjauan ${num}`, description: "DEMO kronologi sintetis untuk pengujian daftar sanksi; bukan tuduhan atau keputusan nyata.", evidence: "DEMO referensi dokumen", employeeStatement: "DEMO klarifikasi karyawan", action, status, occurredAt: fixtureTime, createdBy: actor, effectiveAt: status === "issued" ? fixtureTime : null, history: [{ actorId: actor, status: "open", note: "DEMO kasus dicatat", at: fixtureTime }, ...(status === "issued" ? [{ actorId: actor, status: "issued", note: "DEMO keputusan ilustratif", at: fixtureTime }] : [])] });
    }
  }
  for (let v = 0; v < 5; v++) add(JobVacancy, v, { title: `DEMO Lowongan ${divisions[v]}`, slug: `demo-vacancy-${v}`, positionId: oid("Position", v), divisionId: oid("Division", v), branchId: oid("Branch", v), status: "draft", summary: "DEMO lowongan sintetis; tidak dipublikasikan ke pelamar nyata.", stages: DEFAULT_STAGES, openings: 5, applicantCount: 10, createdBy: actor });
  for (let c = 0; c < 50; c++) {
    const candidateId = add(Candidate, c, { name: `DEMO Pelamar ${c + 1}`, email: `candidate${c + 1}@hris.invalid`, phone: "0000000000", vacancyId: oid("JobVacancy", c % 5), positionId: oid("Position", c % 5), source: "manual", currentStage: DEFAULT_STAGES[c % 5], status: c % 3 ? "in_progress" : "pending", reference: `DEMO-CAN-${c + 1}`, city: branches[c % 5][0], notes: "DEMO kandidat sintetis", lastActivityAt: fixtureTime });
    add(CandidateStageHistory, c, { candidateId, stage: DEFAULT_STAGES[c % 5], status: "in_progress", type: "stage", authorUserId: actor, authorName: "DEMO HR", notes: "DEMO perpindahan tahapan." });
  }
  // Validate every target namespace before any write. Reruns preserve edits to demo rows.
  for (const { model, docs } of batches.values()) {
    const existing = await model.find({ _id: { $in: docs.map((doc) => doc._id) } }).select("_id _demoSeed").lean();
    if (existing.some((doc) => doc._demoSeed !== TAG)) throw new Error(`Collision outside demo namespace: ${model.modelName}`);
  }
  const demoEmails = Array.from({ length: 200 }, (_, i) => `demo${String(i + 1).padStart(3, "0")}@hris.invalid`);
  if (await User.exists({ email: { $in: demoEmails }, _id: { $nin: Array.from({ length: 200 }, (_, i) => oid("User", i + 1)) } })) throw new Error("Email demo sudah dipakai akun di luar namespace.");
  const report = Object.fromEntries([...batches].map(([name, batch]) => [name, batch.docs.length]));
  console.log(JSON.stringify({ mode: apply ? "apply" : "plan-read-only", database: "PostgreSQL HRIS", namespace: TAG, periods: months, accounts: 200, existingEmployees: await Employee.countDocuments(), planned: report, notifications: "in-app fixtures only; no email/WhatsApp", password: process.env.DEMO_EMPLOYEE_PASSWORD ? "from DEMO_EMPLOYEE_PASSWORD (not printed)" : "documented demo default", superadmin: "read-only; preserve all fields" }, null, 2));
  if (!apply) return;
  await manifest.findOneAndUpdate({ _id: TAG, $or: [{ lockUntil: { $lt: new Date() } }, { lockUntil: { $exists: false } }] }, { $set: { period, cutoffDay, lockUntil: new Date(Date.now() + 600_000) } }, { upsert: true });
  let inserted = 0;
  try {
    for (const { model, docs } of batches.values()) {
      for (let start = 0; start < docs.length; start += 500) {
        const result = await model.bulkWrite(docs.slice(start, start + 500).map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: true });
        inserted += result.upsertedCount;
      }
      console.log(`DEMO ${model.modelName}: ${docs.length} fixtures checked/inserted`);
    }
    for (const definition of SETTING_DEFS) await Setting.updateOne({ key: definition.key }, { $setOnInsert: { value: definition.default, description: definition.description } }, { upsert: true });
    const after = await User.find({ roleId: superRole._id }).sort({ _id: 1 }).lean();
    const unchanged = createHash("sha256").update(JSON.stringify(after)).digest("hex") === adminFingerprint;
    if (!unchanged) throw new Error("Superadmin changed concurrently; investigate. Seed never writes existing superadmins.");
    await manifest.updateOne({ _id: TAG }, { $set: { completedAt: new Date() } });
    console.log(JSON.stringify({ inserted, demoEmployees: await Employee.countDocuments({ employeeId: /^DEMO-\d{3}$/ }), superadminUnchanged: unchanged, demoLogin: "demo001@hris.invalid … demo195@hris.invalid; 196–200 resigned/inactive" }));
  } finally { await manifest.updateOne({ _id: TAG }, { $unset: { lockUntil: "" } }); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/seed-demo.ts")) seedDemo({ apply: process.argv.includes("--apply") }).catch((error) => { console.error("Demo seed failed:", error.message); process.exitCode = 1; }).finally(() => database.disconnect());
