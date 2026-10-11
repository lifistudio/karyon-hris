import { getBirthdayDirectory } from "@/lib/hr/birthdays-server";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { holidayMap } from "@/lib/hr/calendar";
import { eachDayKey, isWeekendKey, wibDateKey, wibEndOfDay, wibEndOfMonth, wibPeriodKey, wibStartOfDay, wibStartOfMonth, timezoneName } from "@/lib/time";
import Employee from "@/models/Employee";
import Attendance from "@/models/Attendance";
import ApprovalInstance from "@/models/ApprovalInstance";
import LeaveRequest from "@/models/LeaveRequest";
import Candidate from "@/models/Candidate";
import Contract from "@/models/Contract";
import NationalHoliday from "@/models/NationalHoliday";
import Branch from "@/models/Branch";
import { dailyAttendance } from "@/lib/hr/attendance-monitor";

/**
 * Everything the admin dashboard needs, in one round trip.
 *
 * Counts are computed with aggregation/`countDocuments` rather than by loading
 * collections into memory, so the page stays fast as headcount grows.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "attendance", "read");

  const todayKey = wibDateKey();
  const dayStart = wibStartOfDay(todayKey);
  const dayEnd = wibEndOfDay(todayKey);
  const period = wibPeriodKey();

  // Branch-scoped roles see only their own site's numbers.
  const branchScope: Record<string, unknown> =
    perm.scope === "branch" && ctx.user.branchId ? { branchId: ctx.user.branchId } : {};

  const [
    headcount,
    onboarding,
    presentToday,
    lateToday,
    flaggedToday,
    onLeaveToday,
    pendingApprovals,
    openCandidates,
    expiringContracts,
    upcomingHolidays,
    branches,
  ] = await Promise.all([
    Employee.countDocuments({ status: "active", ...branchScope }),
    Employee.countDocuments({ status: "onboarding", ...branchScope }),
    Attendance.countDocuments({ date: { $gte: dayStart, $lte: dayEnd }, clockIn: { $ne: null } }),
    Attendance.countDocuments({ date: { $gte: dayStart, $lte: dayEnd }, isLate: true }),
    Attendance.countDocuments({ date: { $gte: dayStart, $lte: dayEnd }, needsReview: true }),
    LeaveRequest.countDocuments({
      status: "approved",
      startDate: { $lte: dayEnd },
      endDate: { $gte: dayStart },
    }),
    ApprovalInstance.countDocuments({
      status: "pending",
      ...(ctx.user.role === "SUPERADMIN"
        ? {}
        : { stepsStatus: { $elemMatch: { status: "pending", approverRole: ctx.user.role } } }),
    }),
    Candidate.countDocuments({ status: { $in: ["pending", "in_progress"] } }),
    Contract.countDocuments({
      status: "active",
      endDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86400_000) },
    }),
    NationalHoliday.find({ isActive: true, dateKey: { $gte: todayKey } })
      .sort({ dateKey: 1 })
      .limit(4)
      .lean(),
    Branch.countDocuments({}),
  ]);

  /* --- 14-day attendance trend ------------------------------------- */
  const trendStart = wibStartOfDay(
    wibDateKey(new Date(Date.now() - 13 * 86400_000))
  );
  const trendRows = await Attendance.aggregate<{
    _id: string;
    present: number;
    late: number;
  }>([
    { $match: { date: { $gte: trendStart, $lte: dayEnd } } },
    {
      $group: {
        // Bucket by WIB calendar day, not by the server's timezone.
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: timezoneName() },
        },
        present: { $sum: { $cond: [{ $ifNull: ["$clockIn", false] }, 1, 0] } },
        late: { $sum: { $cond: ["$isLate", 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const trendMap = new Map(trendRows.map((r) => [r._id, r]));
  const trend = eachDayKey(trendStart, dayEnd).map((key) => ({
    dateKey: key,
    present: trendMap.get(key)?.present ?? 0,
    late: trendMap.get(key)?.late ?? 0,
    isWeekend: isWeekendKey(key),
  }));

  /* --- monthly discipline summary ----------------------------------- */
  const monthStart = wibStartOfMonth(period);
  const monthEnd = wibEndOfMonth(period);
  const holidays = await holidayMap(wibDateKey(monthStart), wibDateKey(monthEnd));
  const workingDays = eachDayKey(monthStart, monthEnd).filter(
    (k) => !isWeekendKey(k) && !holidays.has(k) && k <= todayKey
  ).length;

  const monthAgg = await Attendance.aggregate<{
    _id: null;
    totalRecords: number;
    lateRecords: number;
    lateMinutes: number;
  }>([
    { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        lateRecords: { $sum: { $cond: ["$isLate", 1, 0] } },
        lateMinutes: { $sum: "$lateMinutes" },
      },
    },
  ]);

  const month = monthAgg[0] ?? { totalRecords: 0, lateRecords: 0, lateMinutes: 0 };
  // Same status engine as the Kehadiran page: days off and holidays are not "missing".
  const daily = await dailyAttendance({ dateKey: todayKey, employeeFilter: branchScope });
  const expectedRecords = headcount * workingDays;

  /* Same configured window as the dedicated admin and employee directory. */
  const birthdayDirectory = await getBirthdayDirectory(1, 12);
  const birthdays = birthdayDirectory.items;

  return apiSuccess(
    {
      todayKey,
      period,
      cards: {
        headcount,
        onboarding,
        presentToday,
        lateToday,
        flaggedToday,
        onLeaveToday,
        absentToday: daily.summary.missing + daily.summary.absent,
        notStartedToday: daily.summary.not_started,
        pendingApprovals,
        openCandidates,
        expiringContracts,
        branches,
      },
      trend,
      month: {
        workingDays,
        attendanceRate: expectedRecords ? Math.round((month.totalRecords / expectedRecords) * 100) : 0,
        punctualityRate: month.totalRecords
          ? Math.round(((month.totalRecords - month.lateRecords) / month.totalRecords) * 100)
          : 100,
        lateRecords: month.lateRecords,
        lateMinutes: month.lateMinutes,
      },
      upcomingHolidays,
      birthdays,
    },
    "Berhasil memuat ringkasan dashboard"
  );
});
