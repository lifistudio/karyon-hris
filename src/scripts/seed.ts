import { RecordId } from "@/lib/postgres";
/**
 * Idempotent database seed.
 *
 * Run with `npm run seed`. Safe to re-run: every step upserts, so it can be used
 * both to bootstrap a fresh install and to top up an existing database with
 * newly-added settings, modules, or master data.
 */
import database from "@/lib/postgres";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "../lib/db";
import { SETTING_DEFS } from "../lib/settings";
import { encryptOnce } from "../lib/crypto";
import Role from "../models/Role";
import RolePermission from "../models/RolePermission";
import Setting from "../models/Setting";
import User from "../models/User";
import ApprovalFlow from "../models/ApprovalFlow";
import LeaveType from "../models/LeaveType";
import Branch from "../models/Branch";
import Division from "../models/Division";
import Position from "../models/Position";
import Employee from "../models/Employee";
import WorkSchedule from "../models/WorkSchedule";
import NationalHoliday from "../models/NationalHoliday";
import Counter from "../models/Counter";
import PayslipTemplate from "../models/PayslipTemplate";
import { DEFAULT_BLOCKS, DEFAULT_EMPLOYEE_FIELDS } from "../lib/hr/payslip";
import KpiTemplate from "../models/KpiTemplate";


const log = (msg: string) => console.log(`  ${msg}`);
const step = (msg: string) => console.log(`\n▸ ${msg}`);

/* ------------------------------------------------------------------ */
/* RBAC matrix                                                          */
/* ------------------------------------------------------------------ */

type Scope = "all" | "branch" | "division" | "self" | "reports";

interface PermSeed {
  role: string;
  module: string;
  actions: string[];
  scope: Scope;
}

/**
 * Mirrors the module × action matrix in Instructions.md §4.2.
 * Superadmin is intentionally absent — `checkPermission` short-circuits it.
 */
const PERMISSIONS: PermSeed[] = [
  // ---- STAFF: self-service only ----
  { role: "STAFF", module: "attendance", actions: ["read", "write"], scope: "self" },
  { role: "STAFF", module: "leave", actions: ["read", "write"], scope: "self" },
  { role: "STAFF", module: "holiday_swap", actions: ["read", "write"], scope: "self" },
  { role: "STAFF", module: "payroll", actions: ["read"], scope: "self" },
  { role: "STAFF", module: "kpi", actions: ["read"], scope: "self" },
  { role: "STAFF", module: "contracts", actions: ["read"], scope: "self" },
  { role: "STAFF", module: "inventory", actions: ["read"], scope: "self" },
  { role: "STAFF", module: "complaint", actions: ["read", "write"], scope: "self" },
  { role: "STAFF", module: "employees", actions: ["read"], scope: "self" },

  // ---- SPV: own division ----
  { role: "SPV", module: "attendance", actions: ["read", "write"], scope: "division" },
  { role: "SPV", module: "employees", actions: ["read"], scope: "division" },
  { role: "SPV", module: "leave", actions: ["read", "approve"], scope: "division" },
  { role: "SPV", module: "holiday_swap", actions: ["read", "approve"], scope: "division" },
  { role: "SPV", module: "recruitment", actions: ["read"], scope: "division" },
  { role: "SPV", module: "kpi", actions: ["read", "write"], scope: "division" },
  { role: "SPV", module: "inventory", actions: ["read"], scope: "division" },
  { role: "SPV", module: "complaint", actions: ["read", "write"], scope: "division" },
  { role: "SPV", module: "reports", actions: ["read", "export"], scope: "division" },

  // ---- HRD: company-wide operator ----
  { role: "HRD", module: "attendance", actions: ["read", "write", "export"], scope: "all" },
  { role: "HRD", module: "employees", actions: ["read", "write", "export"], scope: "all" },
  { role: "HRD", module: "leave", actions: ["read", "write", "approve", "export"], scope: "all" },
  { role: "HRD", module: "holiday_swap", actions: ["read", "write", "approve"], scope: "all" },
  { role: "HRD", module: "recruitment", actions: ["read", "write", "export"], scope: "all" },
  { role: "HRD", module: "payroll", actions: ["read", "write", "export"], scope: "all" },
  { role: "HRD", module: "kpi", actions: ["read", "write", "export"], scope: "all" },
  { role: "HRD", module: "contracts", actions: ["read", "write"], scope: "all" },
  { role: "HRD", module: "inventory", actions: ["read"], scope: "all" },
  { role: "HRD", module: "complaint", actions: ["read", "write"], scope: "all" },
  { role: "HRD", module: "settings", actions: ["read", "write"], scope: "all" },
  { role: "HRD", module: "reports", actions: ["read", "export"], scope: "all" },

  // ---- AUDIT: read + export everywhere, approve on escalations ----
  { role: "AUDIT", module: "attendance", actions: ["read", "export"], scope: "all" },
  { role: "AUDIT", module: "employees", actions: ["read", "export"], scope: "all" },
  { role: "AUDIT", module: "leave", actions: ["read", "approve", "export"], scope: "all" },
  { role: "AUDIT", module: "holiday_swap", actions: ["read", "approve"], scope: "all" },
  { role: "AUDIT", module: "recruitment", actions: ["read"], scope: "all" },
  { role: "AUDIT", module: "payroll", actions: ["read", "export"], scope: "all" },
  { role: "AUDIT", module: "kpi", actions: ["read", "export"], scope: "all" },
  { role: "AUDIT", module: "contracts", actions: ["read"], scope: "all" },
  { role: "AUDIT", module: "inventory", actions: ["read", "write", "export"], scope: "all" },
  { role: "AUDIT", module: "complaint", actions: ["read", "write"], scope: "all" },
  { role: "AUDIT", module: "audit", actions: ["read", "export"], scope: "all" },
  { role: "AUDIT", module: "reports", actions: ["read", "export"], scope: "all" },

  // ---- GA: asset custodian ----
  { role: "GA", module: "inventory", actions: ["read", "write", "delete", "export"], scope: "all" },
  { role: "GA", module: "employees", actions: ["read"], scope: "all" },
  { role: "GA", module: "reports", actions: ["read"], scope: "all" },

  // ---- DIREKSI: oversight + final approvals ----
  { role: "DIREKSI", module: "attendance", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "employees", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "leave", actions: ["read", "approve"], scope: "all" },
  { role: "DIREKSI", module: "holiday_swap", actions: ["read", "approve"], scope: "all" },
  { role: "DIREKSI", module: "recruitment", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "payroll", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "kpi", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "contracts", actions: ["read", "approve"], scope: "all" },
  { role: "DIREKSI", module: "inventory", actions: ["read"], scope: "all" },
  { role: "DIREKSI", module: "complaint", actions: ["read", "write"], scope: "all" },
  { role: "DIREKSI", module: "reports", actions: ["read", "export"], scope: "all" },
];

/* ------------------------------------------------------------------ */
/* Master data                                                          */
/* ------------------------------------------------------------------ */

const LEAVE_TYPES = [
  {
    name: "Cuti Tahunan",
    description: "Hak cuti tahunan yang dihitung dari masa kerja.",
    quotaDays: 12,
    accrualMode: "prorata",
    carryOverMaxDays: 6,
    requiresEvidence: false,
    minLeadDays: 3,
    maxConsecutiveDays: 12,
    quotaMode: "annual",
    deductsBalance: true,
    colorTone: "primary",
  },
  {
    name: "Izin Sakit",
    description: "Izin karena sakit. Wajib surat dokter bila 2 hari atau lebih.",
    quotaDays: 30,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: true,
    minLeadDays: 0,
    maxConsecutiveDays: 0,
    quotaMode: "none",
    deductsBalance: false,
    colorTone: "warning",
  },
  {
    name: "Cuti Menikah",
    description: "Cuti pernikahan karyawan sendiri. Maksimal 3 hari setiap kali, dapat diajukan lagi bila terjadi lagi.",
    quotaDays: 3,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: true,
    minLeadDays: 14,
    maxConsecutiveDays: 3,
    quotaMode: "per_event",
    deductsBalance: false,
    colorTone: "success",
  },
  {
    name: "Cuti Melahirkan",
    description: "Cuti melahirkan sesuai ketentuan ketenagakerjaan.",
    quotaDays: 90,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: true,
    minLeadDays: 30,
    maxConsecutiveDays: 0,
    quotaMode: "per_event",
    deductsBalance: false,
    genderRestriction: "female",
    colorTone: "info",
  },
  {
    name: "Cuti Ayah",
    description: "Cuti mendampingi istri melahirkan, setiap kelahiran.",
    quotaDays: 2,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: true,
    minLeadDays: 0,
    maxConsecutiveDays: 2,
    quotaMode: "per_event",
    deductsBalance: false,
    genderRestriction: "male",
    colorTone: "info",
  },
  {
    name: "Izin Keluarga Meninggal",
    description: "Izin duka untuk keluarga inti. Maksimal 3 hari setiap kejadian.",
    quotaDays: 3,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: false,
    minLeadDays: 0,
    maxConsecutiveDays: 3,
    quotaMode: "per_event",
    deductsBalance: false,
    colorTone: "neutral",
  },
  {
    name: "WFH / Dinas Luar",
    description:
      "Bekerja dari luar kantor. Disetujui lebih dulu agar presensi di luar radius kantor diterima sistem.",
    quotaDays: 0,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: false,
    minLeadDays: 0,
    maxConsecutiveDays: 0,
    quotaMode: "none",
    deductsBalance: false,
    allowsRemoteAttendance: true,
    colorTone: "info",
  },
  {
    name: "Cuti di Luar Tanggungan",
    description: "Cuti tanpa dibayar, memerlukan persetujuan berjenjang.",
    quotaDays: 30,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: true,
    minLeadDays: 14,
    maxConsecutiveDays: 0,
    quotaMode: "none",
    deductsBalance: false,
    colorTone: "danger",
  },
  {
    name: "Izin Keperluan Lainnya",
    description: "Untuk keperluan yang tidak ada di daftar. Tuliskan keperluannya; HRD menilai per pengajuan.",
    quotaMode: "none",
    quotaDays: 0,
    accrualMode: "flat",
    carryOverMaxDays: 0,
    requiresEvidence: false,
    minLeadDays: 0,
    maxConsecutiveDays: 3,
    deductsBalance: false,
    isOther: true,
    sortOrder: 900,
    colorTone: "neutral",
  },
];

const WORK_SCHEDULES = [
  { name: "Backoffice A (Sen–Sab)", clockIn: "09:00", clockOut: "17:00", breakOut: "12:00", breakIn: "13:00", isBreakActive: true, gracePeriodMinutes: 5, activeDays: [1, 2, 3, 4, 5, 6] },
  { name: "Backoffice B (Sen–Jum)", clockIn: "09:00", clockOut: "18:00", breakOut: "12:00", breakIn: "13:00", isBreakActive: true, gracePeriodMinutes: 5, activeDays: [1, 2, 3, 4, 5] },
  { name: "Shift Pagi", clockIn: "07:00", clockOut: "15:00", isBreakActive: false, gracePeriodMinutes: 1, activeDays: [1, 2, 3, 4, 5, 6, 0] },
  { name: "Shift Siang", clockIn: "15:00", clockOut: "23:00", isBreakActive: false, gracePeriodMinutes: 1, activeDays: [1, 2, 3, 4, 5, 6, 0] },
  { name: "Shift Malam", clockIn: "23:00", clockOut: "07:00", isBreakActive: false, gracePeriodMinutes: 1, activeDays: [1, 2, 3, 4, 5, 6, 0] },
];

/** Indonesian public holidays — top up each year from the SKB three ministers. */
const HOLIDAYS_2026 = [
  { dateKey: "2026-01-01", name: "Tahun Baru Masehi" },
  { dateKey: "2026-01-17", name: "Isra Mikraj Nabi Muhammad SAW" },
  { dateKey: "2026-02-17", name: "Tahun Baru Imlek" },
  { dateKey: "2026-03-19", name: "Hari Suci Nyepi" },
  { dateKey: "2026-03-20", name: "Idul Fitri 1447 H" },
  { dateKey: "2026-03-21", name: "Idul Fitri 1447 H (Hari Kedua)" },
  { dateKey: "2026-04-03", name: "Wafat Isa Almasih" },
  { dateKey: "2026-05-01", name: "Hari Buruh Internasional" },
  { dateKey: "2026-05-14", name: "Kenaikan Isa Almasih" },
  { dateKey: "2026-05-27", name: "Idul Adha 1447 H" },
  { dateKey: "2026-05-31", name: "Hari Raya Waisak" },
  { dateKey: "2026-06-01", name: "Hari Lahir Pancasila" },
  { dateKey: "2026-06-16", name: "Tahun Baru Islam 1448 H" },
  { dateKey: "2026-08-17", name: "Hari Kemerdekaan Republik Indonesia" },
  { dateKey: "2026-08-25", name: "Maulid Nabi Muhammad SAW" },
  { dateKey: "2026-12-25", name: "Hari Raya Natal" },
];

/* ------------------------------------------------------------------ */

/**
 * Baseline master data and the superadmin are production-safe: the Docker
 * image runs this bundle as `node db-seed.cjs` to bootstrap a new install.
 * The demo staff account is only created outside production and only when
 * SEED_STAFF_PASSWORD is supplied.
 */
function bootstrapAccounts() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@hris.com").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  const staffPassword = process.env.SEED_STAFF_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254) {
    throw new Error("SEED_ADMIN_EMAIL tidak valid.");
  }
  if (adminPassword.length < 12) throw new Error("SEED_ADMIN_PASSWORD minimal 12 karakter wajib diisi sebelum seed.");
  const demoStaff = process.env.NODE_ENV !== "production" && staffPassword.length > 0;
  if (demoStaff && staffPassword.length < 12) throw new Error("SEED_STAFF_PASSWORD minimal 12 karakter.");
  return { adminEmail, adminPassword, staffPassword: demoStaff ? staffPassword : null };
}

export async function seed() {
  const accounts = bootstrapAccounts();
  console.log("HRIS — seeding database\n" + "=".repeat(40));
  await connectToDatabase();

  /* 1. Roles ------------------------------------------------------- */
  step("Roles");
  const roleNames = ["SUPERADMIN", "DIREKSI", "HRD", "AUDIT", "GA", "SPV", "STAFF"];
  const roles: Record<string, { _id: RecordId }> = {};
  for (const name of roleNames) {
    const doc = await Role.findOneAndUpdate(
      { name },
      { name, isSystemDefault: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    roles[name] = doc;
  }
  log(`${roleNames.length} peran tersedia`);

  /* 2. Permissions -------------------------------------------------- */
  step("Role permissions");
  // Upsert rather than wipe: a Superadmin may have customised the matrix in the
  // CMS, and a re-seed should not silently revert their configuration for roles
  // it does not know about.
  for (const p of PERMISSIONS) {
    const roleId = roles[p.role]?._id;
    if (!roleId) continue;
    await RolePermission.findOneAndUpdate(
      { roleId, module: p.module },
      { roleId, module: p.module, actions: p.actions, scope: p.scope },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  log(`${PERMISSIONS.length} entri izin disinkronkan`);

  /* 3. Settings ------------------------------------------------------ */
  step("Settings");
  let created = 0;
  for (const def of SETTING_DEFS) {
    const existing = await Setting.findOne({ key: def.key });
    if (!existing) {
      await Setting.create({ key: def.key, value: def.default, description: def.description });
      created++;
    } else if (existing.description !== def.description) {
      // Keep the operator's value, refresh only the explanatory text.
      existing.description = def.description;
      await existing.save();
    }
  }
  log(`${SETTING_DEFS.length} kunci pengaturan (${created} baru dibuat, sisanya dipertahankan)`);

  /* 4. Leave types --------------------------------------------------- */
  step("Leave types");
  for (const lt of LEAVE_TYPES) {
    await LeaveType.findOneAndUpdate(
      { name: lt.name },
      { $setOnInsert: lt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  // Types created before quota modes existed: give them the mode they were
  // seeded with, without touching anything an operator configured since.
  for (const lt of LEAVE_TYPES) {
    await LeaveType.updateOne(
      { name: lt.name, quotaMode: { $exists: false } },
      { $set: { quotaMode: lt.quotaMode, ...(lt.quotaMode === "per_event" ? { maxConsecutiveDays: lt.quotaDays } : {}) } }
    );
  }
  log(`${LEAVE_TYPES.length} jenis izin/cuti`);

  /* 5. Approval flows ------------------------------------------------ */
  step("Approval flows");
  for (const type of ["leave", "correction", "holiday_swap"] as const) {
    await ApprovalFlow.findOneAndUpdate(
      { transactionType: type },
      {
        $setOnInsert: {
          transactionType: type,
          steps: [
            { stepNumber: 1, approverRole: "SPV", isMandatory: true },
            { stepNumber: 2, approverRole: "HRD", isMandatory: true },
          ],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  log("3 alur persetujuan (cuti, koreksi absen, tukar libur)");

  /* 6. National holidays --------------------------------------------- */
  step("National holidays");
  for (const h of HOLIDAYS_2026) {
    await NationalHoliday.findOneAndUpdate(
      { dateKey: h.dateKey },
      { $setOnInsert: { ...h, type: "libur_nasional", isActive: true } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  log(`${HOLIDAYS_2026.length} tanggal merah 2026`);

  /* 7. Work schedules ------------------------------------------------ */
  step("Work schedules");
  for (const ws of WORK_SCHEDULES) {
    await WorkSchedule.findOneAndUpdate(
      { name: ws.name },
      { $setOnInsert: ws },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  log(`${WORK_SCHEDULES.length} template jadwal kerja`);

  /* 8. Organisation -------------------------------------------------- */
  step("Organisation");
  const branch = await Branch.findOneAndUpdate(
    { name: "Kantor Pusat Jakarta" },
    {
      $setOnInsert: {
        name: "Kantor Pusat Jakarta",
        address: "Jl. Jenderal Sudirman No. 1, Jakarta Pusat",
        lat: -6.2,
        lng: 106.816666,
        // The model field is `radiusMeter`; the previous seed set `radius`,
        // which Mongoose dropped, leaving every office on the 15 m default.
        radiusMeter: 150,
        workHours: { start: "09:00", end: "17:00" },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const division = await Division.findOneAndUpdate(
    { name: "Teknologi Informasi" },
    { $setOnInsert: { name: "Teknologi Informasi", branchId: branch._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const position = await Position.findOneAndUpdate(
    { name: "Senior Software Engineer" },
    {
      $setOnInsert: {
        name: "Senior Software Engineer",
        divisionId: division._id,
        description: "Merancang dan membangun layanan internal perusahaan.",
        location: "Jakarta",
        type: "Full-Time",
        status: "active",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  log(`Cabang "${branch.name}" · Divisi "${division.name}" · Jabatan "${position.name}"`);

  /* 9. Payslip template ------------------------------------------------ */
  step("Payslip template");
  await PayslipTemplate.findOneAndUpdate(
    { name: "Slip Gaji Standar" },
    {
      $setOnInsert: {
        name: "Slip Gaji Standar",
        description: "Tata letak bawaan yang dipakai untuk seluruh karyawan.",
        isDefault: true,
        paperSize: "A4",
        accentColor: "#0468c9",
        baseFontSize: 12,
        margin: 18,
        companyName: "PT Contoh Nusantara",
        companyAddress: "Jl. Jenderal Sudirman No. 1, Jakarta Pusat",
        documentTitle: "SLIP GAJI KARYAWAN",
        employeeFields: DEFAULT_EMPLOYEE_FIELDS,
        blocks: DEFAULT_BLOCKS,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  log("Template slip gaji bawaan");

  /* 10. KPI template --------------------------------------------------- */
  step("KPI template");
  await KpiTemplate.findOneAndUpdate(
    { name: "Penilaian Kinerja Umum" },
    {
      $setOnInsert: {
        name: "Penilaian Kinerja Umum",
        description:
          "Template dasar tiga aspek yang berlaku untuk seluruh divisi. Sesuaikan bobot dan indikatornya lewat menu KPI & Kinerja.",
        periodType: "quarterly",
        scoreMode: "scale_5",
        allowSelfAssessment: false,
        isActive: true,
        aspects: [
          {
            key: "hasil",
            name: "Hasil Kerja",
            description: "Pencapaian target dan kualitas keluaran.",
            weight: 40,
            indicators: [
              { key: "target", name: "Pencapaian target", description: "", target: "Minimal 100% dari target periode", weight: 60 },
              { key: "kualitas", name: "Kualitas hasil kerja", description: "", target: "Minim revisi dan kesalahan", weight: 40 },
            ],
          },
          {
            key: "disiplin",
            name: "Kedisiplinan",
            description: "Kehadiran dan kepatuhan pada aturan kerja.",
            weight: 30,
            indicators: [
              { key: "hadir", name: "Kehadiran dan ketepatan waktu", description: "", target: "Tanpa alpha, keterlambatan minimal", weight: 50 },
              { key: "sop", name: "Kepatuhan prosedur", description: "", target: "Mengikuti SOP yang berlaku", weight: 50 },
            ],
          },
          {
            key: "sikap",
            name: "Sikap Kerja",
            description: "Kerja sama, inisiatif, dan komunikasi.",
            weight: 30,
            indicators: [
              { key: "tim", name: "Kerja sama tim", description: "", target: "Kooperatif dan membantu rekan", weight: 50 },
              { key: "inisiatif", name: "Inisiatif", description: "", target: "Mengusulkan perbaikan tanpa diminta", weight: 50 },
            ],
          },
        ],
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  log("Template KPI bawaan (3 aspek, 6 indikator)");

  /* 11. Demo accounts -------------------------------------------------- */
  step("Accounts");
  const { adminEmail, adminPassword, staffPassword } = accounts;

  await User.findOneAndUpdate(
    { email: adminEmail },
    {
      $setOnInsert: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      roleId: roles.SUPERADMIN._id,
      isActive: true,
      // The superadmin is the bootstrap account; forcing a change here would
      // lock the installer out before any other account exists.
      mustChangePassword: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!staffPassword) {
    log(`Superadmin ${adminEmail} siap. Akun demo karyawan dilewati (produksi atau SEED_STAFF_PASSWORD kosong).`);
  } else {
  await Counter.findOneAndUpdate(
    { key: "employee:2026" },
    { $max: { seq: 1 } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const employee = await Employee.findOneAndUpdate(
    { employeeId: "EMP-2026-0001" },
    {
      $setOnInsert: {
        employeeId: "EMP-2026-0001",
        name: "Budi Santoso",
        // Sensitive identifiers are stored encrypted, matching what the API writes.
        nik: encryptOnce("3174012345678901"),
        npwp: encryptOnce("09.254.294.3-407.000"),
        birthPlace: "Jakarta",
        birthDate: new Date("1995-05-15"),
        gender: "male",
        religion: "Islam",
        maritalStatus: "Belum Menikah",
        ktpAddress: {
          street: "Jl. Mawar No. 12",
          subdistrict: "Tebet",
          city: "Jakarta Selatan",
          province: "DKI Jakarta",
          country: "Indonesia",
        },
        domicileAddress: {
          street: "Jl. Mawar No. 12",
          subdistrict: "Tebet",
          city: "Jakarta Selatan",
          province: "DKI Jakarta",
          country: "Indonesia",
        },
        personalEmail: "budi@hris.com",
        officeEmail: "budi.santoso@hris.com",
        phone: "08123456789",
        socialMedia: {},
        taxStatus: "TK/0",
        bankAccount: {
          bankName: "Bank Central Asia (BCA)",
          accountNumber: encryptOnce("8881234567"),
          accountHolder: "Budi Santoso",
        },
        branchId: branch._id,
        divisionId: division._id,
        positionId: position._id,
        joinDate: new Date("2026-01-01"),
        employmentStatus: "pkwtt",
        status: "active",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await User.findOneAndUpdate(
    { email: "budi@hris.com" },
    {
      $setOnInsert: {
        passwordHash: await bcrypt.hash(staffPassword, 12),
        roleId: roles.STAFF._id,
        employeeId: employee._id,
        phone: "08123456789",
        isActive: true,
        email: "budi@hris.com", mustChangePassword: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  }

  console.log("\n" + "=".repeat(40));
  console.log("Seeding selesai.\n");
  console.log(`  Akun: ${adminEmail}${staffPassword ? " dan budi@hris.com (demo)" : ""}. Kata sandi tidak dicetak dan akun lama tidak direset.`);
  console.log(
    "\n  Simpan kredensial bootstrap ini secara aman dan ganti setelah login pertama.\n"
  );

}

if (/\/(seed\.ts|db-seed\.cjs)$/.test(process.argv[1]?.replaceAll("\\", "/") || "")) seed().catch(async (err) => {
  console.error("\nSeeding gagal:", err.message);
  process.exitCode = 1;
}).finally(() => database.disconnect());
