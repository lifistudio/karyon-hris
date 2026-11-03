import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { connectToDatabase } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { notifyUsers, resolveRecipientsByUserIds, type NotifyPayload } from "@/lib/notification/notify";
import { formatDate, wibDateKey, wibParts, wibPeriodKey } from "@/lib/time";
import { dailyAttendance, type DailyRow } from "@/lib/hr/attendance-monitor";
import AuditReport from "@/models/AuditReport";
import Inventory from "@/models/Inventory";
import Notification from "@/models/Notification";
import RolePermission from "@/models/RolePermission";
import Role from "@/models/Role";
import User from "@/models/User";

/**
 * Attendance notifications, all delivered through the in-app bell (and email /
 * WhatsApp when those channels are switched on in Settings).
 *
 * Every message carries a per-day `refType`; a recipient who already has it
 * is skipped, so the 5-minute scheduler, a restart or a second instance never
 * sends the same reminder twice.
 */

/** Sends `payload` to users who have not yet received this `refType`. */
export async function notifyOnce(userIds: string[], payload: NotifyPayload & { refType: string }): Promise<number> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return 0;
  const already = await Notification.distinct("userId", { userId: { $in: unique }, refType: payload.refType });
  const sent = new Set(already.map(String));
  const pending = unique.filter((id) => !sent.has(id));
  if (!pending.length) return 0;
  await notifyUsers(await resolveRecipientsByUserIds(pending), payload);
  return pending.length;
}

/** employee _id → active user id */
async function usersForEmployees(employeeIds: string[]): Promise<Map<string, string>> {
  if (!employeeIds.length) return new Map();
  const users = await User.find({ employeeId: { $in: employeeIds }, isActive: { $ne: false } })
    .select("_id employeeId")
    .lean<Array<{ _id: RecordId; employeeId: RecordId }>>();
  return new Map(users.map((u) => [String(u.employeeId), String(u._id)]));
}

/** Users whose role may read attendance company-wide (plus Superadmin). */
async function companyAttendanceReaders(): Promise<string[]> {
  const grants = (await RolePermission.find({ module: "attendance", scope: "all" })
    .select("roleId actions")
    .lean<Array<{ roleId: RecordId; actions: string[] }>>()).filter((g) => g.actions?.includes("read"));
  const superadmin = await Role.findOne({ name: "SUPERADMIN" }).select("_id").lean<{ _id: RecordId } | null>();
  const roleIds = [...grants.map((g) => g.roleId), ...(superadmin ? [superadmin._id] : [])];
  if (!roleIds.length) return [];
  const users = await User.find({ roleId: { $in: roleIds }, isActive: { $ne: false } }).select("_id").lean<Array<{ _id: RecordId }>>();
  return users.map((u) => String(u._id));
}

const names = (rows: DailyRow[], max = 8) =>
  rows.slice(0, max).map((r) => r.employee.name).join(", ") + (rows.length > max ? `, dan ${rows.length - max} lainnya` : "");

/** Manual reminder from the dashboard: everyone in `rows` still missing today. */
export async function remindMissing(rows: DailyRow[], dateKey: string): Promise<number> {
  const missing = rows.filter((r) => r.status === "missing");
  const users = await usersForEmployees(missing.map((r) => r.employee._id));
  return notifyOnce([...users.values()], {
    kind: "attendance",
    title: "Anda belum absen masuk",
    body: `Jadwal Anda hari ini sudah dimulai. Silakan lakukan presensi, atau ajukan izin bila berhalangan.`,
    href: "/portal/attendance",
    refType: `attendance:manual:${dateKey}`,
  });
}

/**
 * One scheduler tick. Serialised across instances with a PostgreSQL advisory
 * lock; each part is idempotent per day through `notifyOnce`.
 */
export async function runAttendanceAlerts(now = new Date()): Promise<{ skipped?: string; reminders: number; clockOut: number; tasks: number; summaries: number; alpha: number }> {
  const result = { reminders: 0, clockOut: 0, tasks: 0, summaries: 0, alpha: 0 };
  await connectToDatabase();
  const settings = await getSettings(true);
  if (!settings.attendance_alerts_enabled) return { skipped: "disabled", ...result };

  return database.transaction(async () => {
    const lock = await database.connection.query("SELECT pg_try_advisory_xact_lock(hashtext('hris-attendance-alerts')) AS ok");
    if (!lock.rows[0]?.ok) return { skipped: "locked", ...result };

    const todayKey = wibDateKey(now);
    const reminderAfter = Number(settings.attendance_reminder_after_minutes ?? 15) * 60_000;
    const clockOutAfter = Number(settings.attendance_clockout_reminder_minutes ?? 60) * 60_000;
    const summaryHour = Number(settings.attendance_summary_hour ?? 10);
    const { rows } = await dailyAttendance({ dateKey: todayKey, now });
    const users = await usersForEmployees(rows.map((r) => r.employee._id));

    // 1. Employees who have not clocked in some minutes after start + grace.
    const late = rows.filter((r) => r.status === "missing" && r.schedule?.startsAt &&
      now.getTime() >= new Date(r.schedule.startsAt).getTime() + r.schedule.graceMinutes * 60_000 + reminderAfter);
    result.reminders = await notifyOnce(late.map((r) => users.get(r.employee._id)).filter(Boolean) as string[], {
      kind: "attendance",
      title: "Anda belum absen masuk",
      body: "Jadwal kerja Anda hari ini sudah dimulai tetapi belum ada presensi masuk. Lakukan presensi sekarang atau ajukan izin bila berhalangan.",
      href: "/portal/attendance",
      refType: `attendance:missing:${todayKey}`,
      emailOptOut: true,
    });

    // 2. Clocked in, shift over, no clock-out yet.
    const openShift = rows.filter((r) => r.missingClockOut && r.schedule?.endsAt && now.getTime() >= new Date(r.schedule.endsAt).getTime() + clockOutAfter);
    result.clockOut = await notifyOnce(openShift.map((r) => users.get(r.employee._id)).filter(Boolean) as string[], {
      kind: "attendance",
      title: "Anda belum absen pulang",
      body: "Jam kerja Anda sudah berakhir tetapi presensi pulang belum tercatat. Lakukan absen pulang atau ajukan koreksi absen.",
      href: "/portal/attendance",
      refType: `attendance:clockout:${todayKey}`,
      emailOptOut: true,
    });

    // Unfinished daily tasks, while there is still time to finish them.
    const taskLead = Number(settings.attendance_task_reminder_minutes ?? 60) * 60_000;
    const openTasks = rows.filter((r) => (r.tasks?.pending ?? 0) > 0 && !r.attendance?.clockOut && r.schedule?.endsAt && now.getTime() >= new Date(r.schedule.endsAt).getTime() - taskLead);
    result.tasks = await notifyOnce(openTasks.map((r) => users.get(r.employee._id)).filter(Boolean) as string[], {
      kind: "attendance",
      title: "Task hari ini belum selesai",
      body: "Selesaikan task dan kirim buktinya sebelum absen pulang.",
      href: "/portal/attendance",
      refType: `attendance:tasks:${todayKey}`,
      emailOptOut: true,
    });

    if (wibParts(now).hour < summaryHour) return result;

    // 3. Daily summary: supervisors see their own team, HR sees the company.
    const readers = await companyAttendanceReaders();
    const missingToday = rows.filter((r) => r.status === "missing" || r.status === "absent");
    const bySupervisor = new Map<string, DailyRow[]>();
    for (const row of missingToday) if (row.employee.supervisorId) bySupervisor.set(row.employee.supervisorId, [...(bySupervisor.get(row.employee.supervisorId) ?? []), row]);
    const supervisorUsers = await usersForEmployees([...bySupervisor.keys()]);
    for (const [supervisorId, team] of bySupervisor) {
      const userId = supervisorUsers.get(supervisorId);
      if (!userId) continue;
      result.summaries += await notifyOnce([userId], {
        kind: "attendance",
        title: `${team.length} anggota tim belum absen hari ini`,
        body: `${names(team)}. Buka Kehadiran untuk detail dan kirim pengingat.`,
        href: `/admin/attendance?date=${todayKey}&status=missing`,
        refType: `attendance:team:${todayKey}`,
      });
    }
    if (missingToday.length) {
      result.summaries += await notifyOnce(readers, {
        kind: "attendance",
        title: `${missingToday.length} karyawan belum absen hari ini`,
        body: `Per ${String(summaryHour).padStart(2, "0")}:00 WIB: ${names(missingToday)}.`,
        href: `/admin/attendance?date=${todayKey}&status=missing`,
        refType: `attendance:summary:${todayKey}`,
      });
    }

    // 4. Yesterday's alpha: tell the employee (so they can correct it) and their supervisor.
    const yesterdayKey = wibDateKey(new Date(now.getTime() - 24 * 3600_000));
    const yesterday = await dailyAttendance({ dateKey: yesterdayKey, now });
    const alpha = yesterday.rows.filter((r) => r.status === "absent");
    if (alpha.length) {
      const alphaUsers = await usersForEmployees(alpha.map((r) => r.employee._id));
      result.alpha += await notifyOnce([...alphaUsers.values()], {
        kind: "attendance",
        title: "Anda tercatat alpha kemarin",
        body: `Tidak ada presensi maupun izin yang disetujui pada ${formatDate(yesterdayKey)}. Jika keliru, ajukan koreksi absen atau izin dengan bukti.`,
        href: "/portal/attendance",
        refType: `attendance:alpha:${yesterdayKey}`,
      });
      const alphaBySupervisor = new Map<string, DailyRow[]>();
      for (const row of alpha) if (row.employee.supervisorId) alphaBySupervisor.set(row.employee.supervisorId, [...(alphaBySupervisor.get(row.employee.supervisorId) ?? []), row]);
      const alphaSupervisors = await usersForEmployees([...alphaBySupervisor.keys()]);
      for (const [supervisorId, team] of alphaBySupervisor) {
        const userId = alphaSupervisors.get(supervisorId);
        if (userId) result.alpha += await notifyOnce([userId], {
          kind: "attendance",
          title: `${team.length} anggota tim alpha kemarin`,
          body: `${names(team)} (${formatDate(yesterdayKey)}).`,
          href: `/admin/attendance?date=${yesterdayKey}&status=absent`,
          refType: `attendance:team-alpha:${yesterdayKey}`,
        });
      }
      result.alpha += await notifyOnce(readers, {
        kind: "attendance",
        title: `${alpha.length} karyawan alpha kemarin`,
        body: `${names(alpha)} (${formatDate(yesterdayKey)}).`,
        href: `/admin/attendance?date=${yesterdayKey}&status=absent`,
        refType: `attendance:alpha-summary:${yesterdayKey}`,
      });
    }
    return result;
  });
}

/**
 * Tells the inventory team, once a month, how many assets still miss their
 * monthly check. Quiet until the configured day so the round is not nagged early.
 */
export async function runInventoryAlerts(now = new Date()): Promise<number> {
  await connectToDatabase();
  const settings = await getSettings(true);
  const fromDay = Number(settings.inventory_check_reminder_day ?? 25);
  if (!fromDay || wibParts(now).day < fromDay) return 0;
  const period = wibPeriodKey(now);
  const [total, done] = await Promise.all([
    Inventory.countDocuments({ condition: { $ne: "lost" } }),
    AuditReport.countDocuments({ type: "monthly", period }),
  ]);
  const left = total - done;
  if (left <= 0) return 0;
  const grants = (await RolePermission.find({ module: "inventory", scope: "all" }).select("roleId actions").lean<Array<{ roleId: RecordId; actions: string[] }>>())
    .filter((g) => g.actions?.includes("write"));
  const custodians = await User.find({ roleId: { $in: grants.map((g) => g.roleId) }, isActive: { $ne: false } }).select("_id").lean<Array<{ _id: RecordId }>>();
  return notifyOnce(custodians.map((u) => String(u._id)), {
    kind: "inventory",
    title: `${left} aset belum dicek bulan ini`,
    body: `Dari ${total} aset, ${done} sudah dicek. Selesaikan pengecekan sebelum akhir bulan.`,
    href: "/admin/inventory",
    refType: `inventory:monthly:${period}`,
  });
}
