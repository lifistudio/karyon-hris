import { RecordId } from "@/lib/postgres";
import { employeeRecordScopeFilter, Forbidden, scopeFilter, type GuardContext } from "@/lib/guard";
import { decrypt, maskTail } from "@/lib/crypto";
import { formatDate, formatDateTime, formatPeriod, wibEndOfMonth, wibStartOfMonth, timezoneName } from "@/lib/time";
import {
  CORRECTION_REASON_LABELS, EMPLOYEE_STATUS_LABELS, EMPLOYMENT_STATUS_LABELS, INVENTORY_CATEGORY_LABELS, INVENTORY_CONDITION_LABELS,
} from "@/lib/hr/labels";
import { dailyAttendance, DAILY_STATUS_LABEL } from "@/lib/hr/attendance-monitor";
import type { ExportTable } from "./table";
import type { ExportDataset } from "./catalog";
import Attendance from "@/models/Attendance";
import AttendanceCorrection from "@/models/AttendanceCorrection";
import Candidate from "@/models/Candidate";
import Contract from "@/models/Contract";
import Employee from "@/models/Employee";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import KpiEvaluation from "@/models/KpiEvaluation";
import LeaveRequest from "@/models/LeaveRequest";
import Payroll from "@/models/Payroll";

export const MAX_EXPORT_ROWS = 20_000;

export interface ExportParams {
  period?: string;
  date?: string;
  branchId?: string;
}

type Populated = { name?: string; employeeId?: string; branchId?: { name?: string } | null } | null;
const emp = (value: unknown) => value as Populated;
const named = (value: unknown) => (value as { name?: string } | null)?.name ?? "";
const time = (value: Date | null | undefined) =>
  value ? new Intl.DateTimeFormat("id-ID", { timeZone: timezoneName(), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "";
const yes = (value: unknown) => (value ? "Ya" : "Tidak");

export async function buildExport(dataset: ExportDataset, params: ExportParams, ctx: GuardContext): Promise<ExportTable> {
  const owned = await employeeRecordScopeFilter(ctx);
  const monthRange = () => ({ $gte: wibStartOfMonth(params.period!), $lte: wibEndOfMonth(params.period!) });

  switch (dataset) {
    case "employees": {
      const rows = await Employee.find(scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" }))
        .populate("branchId", "name").populate("divisionId", "name").populate("positionId", "name")
        .sort({ name: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      // Only a company-wide grant may export plaintext identifiers.
      // One unreadable value (wrong key, damaged row) must not fail the whole export.
      const reveal = (value: unknown) => {
        if (typeof value !== "string" || !value) return "";
        try { return ctx.permission.scope === "all" ? decrypt(value) : maskTail(value); } catch { return "[tidak dapat dibuka]"; }
      };
      return {
        sheet: "Karyawan",
        columns: ["NIP", "Nama", "Status", "Status kepegawaian", "Cabang", "Divisi", "Jabatan", "Tanggal masuk", "Email kantor", "Email pribadi", "Telepon", "Tempat lahir", "Tanggal lahir", "Jenis kelamin", "Agama", "Status pernikahan", "Status pajak", "NIK", "NPWP", "BPJS Kesehatan", "BPJS Ketenagakerjaan", "Bank", "No. rekening", "Atas nama"].map((label) => ({ label })),
        rows: rows.map((e) => {
          const bank = (e.bankAccount ?? {}) as { bankName?: string; accountNumber?: string; accountHolder?: string };
          return [
            e.employeeId as string, e.name as string, EMPLOYEE_STATUS_LABELS[e.status as string] ?? (e.status as string),
            EMPLOYMENT_STATUS_LABELS[e.employmentStatus as string] ?? (e.employmentStatus as string),
            named(e.branchId), named(e.divisionId), named(e.positionId), formatDate(e.joinDate as Date, ""),
            (e.officeEmail as string) ?? "", (e.personalEmail as string) ?? "", (e.phone as string) ?? "",
            (e.birthPlace as string) ?? "", formatDate(e.birthDate as Date, ""), e.gender === "male" ? "Laki-laki" : e.gender === "female" ? "Perempuan" : "",
            (e.religion as string) ?? "", (e.maritalStatus as string) ?? "", (e.taxStatus as string) ?? "",
            reveal(e.nik), reveal(e.npwp), (e.bpjsKesehatan as string) ?? "", (e.bpjsKetenagakerjaan as string) ?? "",
            bank.bankName ?? "", reveal(bank.accountNumber), bank.accountHolder ?? "",
          ];
        }),
      };
    }
    case "attendance": {
      const logs = await Attendance.find({ ...owned, date: monthRange() })
        .populate({ path: "employeeId", select: "name employeeId branchId", populate: { path: "branchId", select: "name" } })
        .sort({ date: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: `Presensi ${params.period}`,
        columns: ["Tanggal", "NIP", "Nama", "Cabang", "Jadwal masuk", "Jadwal pulang", "Masuk", "Istirahat keluar", "Istirahat masuk", "Pulang", "Terlambat (menit)", "Pulang awal (menit)", "Jarak (m)", "Lintas cabang", "Kendala lokasi", "Perlu ditinjau", "Catatan"].map((label) => ({ label })),
        rows: logs.map((l) => [
          formatDate(l.date as Date), emp(l.employeeId)?.employeeId ?? "", emp(l.employeeId)?.name ?? "", emp(l.employeeId)?.branchId?.name ?? "",
          (l.scheduleClockIn as string) ?? "", (l.scheduleClockOut as string) ?? "",
          time(l.clockIn as Date), time(l.breakOut as Date), time(l.breakIn as Date), time(l.clockOut as Date),
          l.isLate ? Number(l.lateMinutes ?? 0) : 0, l.isEarlyLeave ? Number(l.earlyLeaveMinutes ?? 0) : 0,
          typeof l.distanceMeter === "number" ? Math.round(l.distanceMeter) : "", yes(l.isCrossBranch), yes(l.isLocationOverride), yes(l.needsReview), (l.note as string) ?? "",
        ]),
      };
    }
    case "attendance_daily": {
      const filter: Record<string, unknown> = scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" });
      const { rows } = await dailyAttendance({ dateKey: params.date!, employeeFilter: filter });
      const selected = params.branchId ? rows.filter((r) => r.employee.branchId === params.branchId) : rows;
      return {
        sheet: `Kehadiran ${params.date}`,
        columns: ["Tanggal", "NIP", "Nama", "Cabang", "Divisi", "Jabatan", "Jadwal", "Masuk", "Pulang", "Status", "Terlambat (menit)", "Keterangan"].map((label) => ({ label })),
        rows: selected.map((r) => [
          formatDate(params.date!), r.employee.employeeId, r.employee.name, r.employee.branch ?? "", r.employee.division ?? "", r.employee.position ?? "",
          r.schedule ? `${r.schedule.clockIn}-${r.schedule.clockOut}` : "", time(r.attendance?.clockIn ? new Date(r.attendance.clockIn) : null),
          time(r.attendance?.clockOut ? new Date(r.attendance.clockOut) : null), DAILY_STATUS_LABEL[r.status], r.attendance?.lateMinutes ?? 0,
          [r.note, r.missingClockOut ? "Belum absen pulang" : ""].filter(Boolean).join("; "),
        ]),
      };
    }
    case "corrections": {
      const rows = await AttendanceCorrection.find({ ...owned, date: monthRange() }).populate("employeeId", "name employeeId").sort({ date: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: `Koreksi ${params.period}`,
        columns: ["Tanggal", "NIP", "Nama", "Jam masuk", "Jam pulang", "Kategori alasan", "Keterangan", "Melebihi kuota", "Status"].map((label) => ({ label })),
        rows: rows.map((c) => [formatDate(c.date as Date), emp(c.employeeId)?.employeeId ?? "", emp(c.employeeId)?.name ?? "", c.clockInTime as string, c.clockOutTime as string,
          CORRECTION_REASON_LABELS[c.reasonType as string] ?? (c.reasonType as string), c.reasonNote as string, yes(c.isOverQuota), c.status as string]),
      };
    }
    case "leave": {
      const range = monthRange();
      const rows = await LeaveRequest.find({ ...owned, startDate: { $lte: range.$lte }, endDate: { $gte: range.$gte } })
        .populate("employeeId", "name employeeId").populate("leaveTypeId", "name").sort({ startDate: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: `Izin cuti ${params.period}`,
        columns: ["NIP", "Nama", "Jenis", "Mulai", "Selesai", "Hari kerja", "Hari kalender", "Status", "Alasan", "Diajukan"].map((label) => ({ label })),
        rows: rows.map((r) => [emp(r.employeeId)?.employeeId ?? "", emp(r.employeeId)?.name ?? "", named(r.leaveTypeId), formatDate(r.startDate as Date), formatDate(r.endDate as Date),
          Number(r.chargedDays ?? 0), Number(r.calendarDays ?? 0), r.status as string, (r.reason as string) ?? "", formatDateTime(r.createdAt as Date)]),
      };
    }
    case "payroll": {
      const rows = await Payroll.find({ ...owned, period: params.period }).populate("employeeId", "name employeeId").sort({ createdAt: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      const sum = (items: unknown) => (Array.isArray(items) ? items.reduce((n, i) => n + Number((i as { amount?: number }).amount ?? 0), 0) : 0);
      return {
        sheet: `Slip gaji ${params.period}`,
        columns: ["Periode", "NIP", "Nama", "Gaji pokok", "Tunjangan", "Insentif", "Lembur", "Total penghasilan", "Total potongan", "Gaji bersih", "Hari hadir", "Hari kerja", "Menit telat", "Hari alpha", "Status"].map((label) => ({ label })),
        rows: rows.map((p) => [formatPeriod(p.period as string), emp(p.employeeId)?.employeeId ?? "", emp(p.employeeId)?.name ?? "", Number(p.basicSalary ?? 0), sum(p.allowances), sum(p.incentives),
          Number(p.overtimeSalary ?? 0), Number(p.totalEarnings ?? 0), Number(p.totalDeductions ?? 0), Number(p.netSalary ?? 0), Number(p.presentDays ?? 0), Number(p.workingDays ?? 0),
          Number(p.lateMinutes ?? 0), Number(p.absentDays ?? 0), p.status as string]),
      };
    }
    case "kpi": {
      const rows = await KpiEvaluation.find({ ...owned, period: params.period }).populate("employeeId", "name employeeId").populate("evaluatorId", "email").sort({ finalScore: -1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: `KPI ${params.period}`,
        columns: ["Periode", "NIP", "Nama", "Judul", "Nilai akhir", "Predikat", "Status", "Penilai", "Dikirim", "Diketahui karyawan", "Kekuatan", "Area perbaikan", "Rencana pengembangan"].map((label) => ({ label })),
        rows: rows.map((k) => [k.period as string, emp(k.employeeId)?.employeeId ?? "", emp(k.employeeId)?.name ?? "", (k.title as string) ?? "", Number(k.finalScore ?? 0), (k.gradeLabel as string) ?? "",
          k.status as string, (k.evaluatorId as { email?: string } | null)?.email ?? "", formatDateTime(k.submittedAt as Date, ""), formatDateTime(k.acknowledgedAt as Date, ""),
          (k.strengths as string) ?? "", (k.improvements as string) ?? "", (k.developmentPlan as string) ?? ""]),
      };
    }
    case "contracts": {
      const rows = await Contract.find({ ...owned, status: { $ne: "draft" } }).populate("employeeId", "name employeeId").sort({ startDate: -1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: "Kontrak",
        columns: ["Nomor", "NIP", "Nama", "Jenis", "Jabatan", "Mulai", "Selesai", "Status", "Keputusan", "Gaji pokok"].map((label) => ({ label })),
        rows: rows.map((c) => [(c.contractNumber as string) ?? "", emp(c.employeeId)?.employeeId ?? "", emp(c.employeeId)?.name ?? "",
          EMPLOYMENT_STATUS_LABELS[c.type as string] ?? (c.customTypeLabel as string) ?? (c.type as string), (c.positionName as string) ?? "", formatDate(c.startDate as Date, ""), formatDate(c.endDate as Date, ""),
          c.status as string, (c.decision as string) ?? "", Number((c.salarySnapshot as { basicSalary?: number } | undefined)?.basicSalary ?? 0) || ""]),
      };
    }
    case "inventory":
    case "candidates": {
      // Company-level registers have no employee owner to narrow by.
      if (ctx.permission.scope !== "all") throw Forbidden("Ekspor ini memerlukan izin seluruh perusahaan.");
      if (dataset === "inventory") {
        const items = await Inventory.find({}).sort({ code: 1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown> & { _id: RecordId }>>();
        const holders = await InventoryAssignment.find({ inventoryId: { $in: items.map((i) => i._id) }, status: { $in: ["active", "pending_handover"] } })
          .populate("employeeId", "name employeeId").lean<Array<{ inventoryId: RecordId; employeeId: Populated; handoverDate?: Date; status: string }>>();
        const byItem = new Map(holders.map((h) => [String(h.inventoryId), h]));
        return {
          sheet: "Inventaris",
          columns: ["Kode", "Nama aset", "Kategori", "Kondisi", "Pemegang (NIP)", "Pemegang", "Tanggal serah terima", "Status serah terima"].map((label) => ({ label })),
          rows: items.map((i) => { const h = byItem.get(String(i._id)); return [i.code as string, i.name as string, INVENTORY_CATEGORY_LABELS[i.category as string] ?? (i.category as string),
            INVENTORY_CONDITION_LABELS[i.condition as string] ?? (i.condition as string), h?.employeeId?.employeeId ?? "", h?.employeeId?.name ?? "", formatDate(h?.handoverDate, ""), h?.status ?? "Tersedia"]; }),
        };
      }
      const rows = await Candidate.find({}).populate("vacancyId", "title").populate("positionId", "name").sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean<Array<Record<string, unknown>>>();
      return {
        sheet: "Pelamar",
        columns: ["Nama", "Email", "Telepon", "Lowongan", "Posisi", "Sumber", "Tahap", "Status", "Kota", "Pendidikan terakhir", "Gaji diharapkan", "Rating", "Melamar"].map((label) => ({ label })),
        rows: rows.map((c) => [c.name as string, (c.email as string) ?? "", (c.phone as string) ?? "", (c.vacancyId as { title?: string } | null)?.title ?? "", named(c.positionId), c.source as string,
          (c.currentStage as string) ?? "", c.status as string, (c.city as string) ?? "", (c.lastEducation as string) ?? "", Number(c.expectedSalary ?? 0) || "", Number(c.rating ?? 0) || "", formatDateTime(c.createdAt as Date)]),
      };
    }
  }
}
