import { RecordId } from "@/lib/postgres";
import { connectToDatabase } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { holidayMap } from "@/lib/hr/calendar";
import { crossesMidnight, expandDays, type ScheduleTemplateLike } from "@/lib/hr/schedule-days";
import { wibEndOfDay, wibParts, wibStartOfDay, wibTimeOnDay } from "@/lib/time";
import Attendance from "@/models/Attendance";
import Employee from "@/models/Employee";
import EmployeeSchedule from "@/models/EmployeeSchedule";
import HolidaySwapRequest from "@/models/HolidaySwapRequest";
import LeaveRequest from "@/models/LeaveRequest";

/**
 * Daily attendance status for every employee in a scope, computed with one
 * query per collection instead of `resolveSchedule` per person.
 *
 * Resolution order mirrors `resolveSchedule`: date override → weekly template
 * → branch hours. A national holiday is a day off unless an approved holiday
 * swap makes it a working day; the swap's replacement date becomes a day off.
 */

export type DailyStatus =
  | "present"      // clocked in on time
  | "late"         // clocked in late
  | "incomplete"   // clocked in, but the day's required tasks were never finished
  | "leave"        // approved leave covers the day
  | "off"          // day off by roster/template or swap
  | "holiday"      // national holiday / collective leave
  | "not_started"  // shift not started yet (or still inside grace)
  | "missing"      // shift running, no clock-in yet ("belum absen")
  | "absent";      // shift over, no clock-in, no approved leave ("alpha")

export const DAILY_STATUS_LABEL: Record<DailyStatus, string> = {
  present: "Hadir",
  late: "Terlambat",
  incomplete: "Task belum selesai",
  leave: "Izin/Cuti",
  off: "Libur",
  holiday: "Libur nasional",
  not_started: "Belum mulai",
  missing: "Belum absen",
  absent: "Alpha",
};

export interface DailyRow {
  employee: {
    _id: string;
    employeeId: string;
    name: string;
    branch: string | null;
    branchId: string | null;
    division: string | null;
    divisionId: string | null;
    position: string | null;
    supervisorId: string | null;
  };
  status: DailyStatus;
  schedule: { name: string; clockIn: string; clockOut: string; graceMinutes: number; startsAt: string; endsAt: string } | null;
  attendance: { clockIn: string | null; clockOut: string | null; lateMinutes: number; needsReview: boolean } | null;
  /** Required tasks for the day; null for people without daily tasks. */
  tasks: { total: number; pending: number } | null;
  note: string;
  /** Clocked in, shift over, never clocked out. */
  missingClockOut: boolean;
  /** A leave request covering the day is still waiting for approval. */
  pendingLeave: boolean;
}

type Template = ScheduleTemplateLike & { name?: string; gracePeriodMinutes?: number };
interface EmployeeDoc {
  _id: RecordId;
  employeeId: string;
  name: string;
  supervisorId?: RecordId | null;
  branchId?: { _id: RecordId; name?: string; workHours?: { start?: string; end?: string } } | null;
  divisionId?: { _id: RecordId; name?: string } | null;
  positionId?: { _id: RecordId; name?: string } | null;
  workScheduleId?: (Template & { _id: RecordId }) | null;
}

const id = (value: unknown) => (value == null ? null : String((value as { _id?: unknown })._id ?? value));

function dayOf(template: Template, dateKey: string) {
  const weekday = wibParts(wibStartOfDay(dateKey)).weekday;
  return expandDays(template).find((d) => d.day === weekday)!;
}

export async function dailyAttendance(options: {
  dateKey: string;
  /** Employee filter fragment already limited to the caller's scope. */
  employeeFilter?: Record<string, unknown>;
  now?: Date;
}): Promise<{ rows: DailyRow[]; summary: Record<DailyStatus, number> & { missingClockOut: number; total: number } }> {
  const { dateKey, employeeFilter = {}, now = new Date() } = options;
  await connectToDatabase();
  const settings = await getSettings();
  const globalGrace = Number(settings.grace_period_minutes ?? 1);
  const dayStart = wibStartOfDay(dateKey), dayEnd = wibEndOfDay(dateKey);

  const employees = await Employee.find({ status: { $in: ["active", "onboarding"] }, ...employeeFilter })
    .select("employeeId name supervisorId branchId divisionId positionId workScheduleId")
    .populate("branchId", "name workHours")
    .populate("divisionId", "name")
    .populate("positionId", "name")
    .populate("workScheduleId")
    .sort({ name: 1 })
    .lean<EmployeeDoc[]>();
  const ids = employees.map((e) => e._id);

  const [overrides, attendances, leaves, holidays, swaps] = ids.length
    ? await Promise.all([
        EmployeeSchedule.find({ employeeId: { $in: ids }, date: { $gte: dayStart, $lte: dayEnd } })
          .populate("scheduleId")
          .lean<Array<{ employeeId: RecordId; isOffDay?: boolean; note?: string; scheduleId?: Template | null }>>(),
        Attendance.find({ employeeId: { $in: ids }, date: { $gte: dayStart, $lte: dayEnd } })
          .select("employeeId clockIn clockOut isLate lateMinutes needsReview tasksTotal tasksPending tasksCountAttendance")
          .lean<Array<{ employeeId: RecordId; clockIn?: Date; clockOut?: Date; isLate?: boolean; lateMinutes?: number; needsReview?: boolean; tasksTotal?: number; tasksPending?: number; tasksCountAttendance?: boolean }>>(),
        LeaveRequest.find({ employeeId: { $in: ids }, status: { $in: ["approved", "pending"] }, startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } })
          .populate("leaveTypeId", "name")
          .select("employeeId status leaveTypeId")
          .lean<Array<{ employeeId: RecordId; status: string; leaveTypeId?: { name?: string } | null }>>(),
        holidayMap(dateKey, dateKey),
        HolidaySwapRequest.find({
          employeeId: { $in: ids },
          status: "approved",
          $or: [{ holidayDate: { $gte: dayStart, $lte: dayEnd } }, { replacementDate: { $gte: dayStart, $lte: dayEnd } }],
        })
          .select("employeeId holidayDate replacementDate")
          .lean<Array<{ employeeId: RecordId; holidayDate: Date; replacementDate: Date }>>(),
      ])
    : [[], [], [], new Map(), []];

  const byEmployee = <T extends { employeeId: RecordId }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) { const key = String(row.employeeId); map.set(key, [...(map.get(key) ?? []), row]); }
    return map;
  };
  const overrideMap = byEmployee(overrides), attendanceMap = byEmployee(attendances), leaveMap = byEmployee(leaves), swapMap = byEmployee(swaps);
  const holiday = holidays.get(dateKey);

  const rows: DailyRow[] = employees.map((emp) => {
    const key = String(emp._id);
    const override = overrideMap.get(key)?.[0];
    const swapsToday = swapMap.get(key) ?? [];
    const worksHoliday = swapsToday.some((s) => s.holidayDate >= dayStart && s.holidayDate <= dayEnd);
    const swapOff = swapsToday.some((s) => s.replacementDate >= dayStart && s.replacementDate <= dayEnd);

    let schedule: { name: string; clockIn: string; clockOut: string; grace: number; active: boolean };
    if (override?.isOffDay) {
      schedule = { name: override.note ? `Libur: ${override.note}` : "Libur (jadwal khusus)", clockIn: "", clockOut: "", grace: globalGrace, active: false };
    } else if (override?.scheduleId) {
      const d = dayOf(override.scheduleId, dateKey);
      schedule = { name: override.scheduleId.name ?? "Jadwal khusus", clockIn: d.clockIn, clockOut: d.clockOut, grace: override.scheduleId.gracePeriodMinutes ?? globalGrace, active: true };
    } else if (emp.workScheduleId) {
      const d = dayOf(emp.workScheduleId, dateKey);
      schedule = { name: emp.workScheduleId.name ?? "Jadwal kerja", clockIn: d.clockIn, clockOut: d.clockOut, grace: emp.workScheduleId.gracePeriodMinutes ?? globalGrace, active: d.active };
    } else {
      schedule = { name: emp.branchId?.name ? `Jam operasional ${emp.branchId.name}` : "Jam kerja default", clockIn: emp.branchId?.workHours?.start ?? "09:00", clockOut: emp.branchId?.workHours?.end ?? "17:00", grace: globalGrace, active: true };
    }

    const att = attendanceMap.get(key)?.[0];
    const empLeaves = leaveMap.get(key) ?? [];
    const approvedLeave = empLeaves.find((l) => l.status === "approved");
    const pendingLeave = empLeaves.some((l) => l.status === "pending");
    const isHolidayOff = Boolean(holiday) && !worksHoliday;
    const working = schedule.active && !isHolidayOff && !swapOff;

    let startsAt: Date | null = null, endsAt: Date | null = null;
    if (schedule.clockIn && schedule.clockOut) {
      startsAt = wibTimeOnDay(dateKey, schedule.clockIn);
      endsAt = wibTimeOnDay(dateKey, schedule.clockOut);
      if (crossesMidnight(schedule.clockIn, schedule.clockOut)) endsAt = new Date(endsAt.getTime() + 24 * 3600_000);
    }

    let status: DailyStatus, note = "";
    if (att?.clockIn) {
      status = att.isLate ? "late" : "present";
      if (att.isLate) note = `Terlambat ${att.lateMinutes ?? 0} menit`;
      // Decided when the shift ends: until then the tasks can still be done.
      if (att.tasksCountAttendance && (att.tasksPending ?? 0) > 0 && endsAt && now.getTime() >= endsAt.getTime()) {
        status = "incomplete";
        note = `${att.tasksPending} dari ${att.tasksTotal ?? 0} task wajib belum selesai`;
      }
    } else if (approvedLeave) {
      status = "leave"; note = approvedLeave.leaveTypeId?.name ?? "Izin disetujui";
    } else if (!working) {
      status = isHolidayOff ? "holiday" : "off";
      note = isHolidayOff ? holiday!.name : swapOff ? "Libur pengganti (tukar libur)" : schedule.name;
    } else if (startsAt && now.getTime() < startsAt.getTime() + schedule.grace * 60_000) {
      status = "not_started";
    } else if (endsAt && now.getTime() < endsAt.getTime()) {
      status = "missing";
    } else {
      status = "absent";
    }
    if (pendingLeave && (status === "missing" || status === "absent")) note = "Ada pengajuan izin menunggu persetujuan";
    const missingClockOut = Boolean(att?.clockIn && !att.clockOut && endsAt && now.getTime() > endsAt.getTime());

    return {
      employee: {
        _id: key,
        employeeId: emp.employeeId,
        name: emp.name,
        branch: emp.branchId?.name ?? null,
        branchId: id(emp.branchId),
        division: emp.divisionId?.name ?? null,
        divisionId: id(emp.divisionId),
        position: emp.positionId?.name ?? null,
        supervisorId: id(emp.supervisorId),
      },
      status,
      schedule: working || att?.clockIn
        ? { name: schedule.name, clockIn: schedule.clockIn, clockOut: schedule.clockOut, graceMinutes: schedule.grace, startsAt: startsAt?.toISOString() ?? "", endsAt: endsAt?.toISOString() ?? "" }
        : null,
      attendance: att
        ? { clockIn: att.clockIn?.toISOString() ?? null, clockOut: att.clockOut?.toISOString() ?? null, lateMinutes: att.lateMinutes ?? 0, needsReview: Boolean(att.needsReview) }
        : null,
      tasks: att?.tasksTotal ? { total: att.tasksTotal, pending: att.tasksPending ?? 0 } : null,
      note,
      missingClockOut,
      pendingLeave,
    };
  });

  const summary = { present: 0, late: 0, incomplete: 0, leave: 0, off: 0, holiday: 0, not_started: 0, missing: 0, absent: 0, missingClockOut: 0, total: rows.length };
  for (const row of rows) { summary[row.status] += 1; if (row.missingClockOut) summary.missingClockOut += 1; }
  return { rows, summary };
}
