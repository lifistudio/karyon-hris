import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, pagination, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { resolveSchedule } from "@/lib/hr/calendar";
import { expandDays, summariseDays, workMinutes } from "@/lib/hr/schedule-days";
import { eachDayKey, wibDateKey, wibEndOfDay, wibStartOfDay, getTimezoneOffset } from "@/lib/time";
import WorkSchedule from "@/models/WorkSchedule";
import EmployeeSchedule from "@/models/EmployeeSchedule";
import Employee from "@/models/Employee";
import Branch from "@/models/Branch";
import "@/models/Division";

/**
 * Shift templates, who works which template, and date exceptions.
 *
 * How they connect, which is also what attendance uses to decide lateness:
 * a date override for the employee wins; otherwise the employee's weekly
 * template supplies that weekday's hours (or a day off); otherwise the branch's
 * operating hours apply.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:MM");
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");

function escapeRegex(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function presentTemplate(t: Record<string, unknown>, usage?: number) {
  const days = expandDays(t);
  return {
    ...t,
    days,
    summary: summariseDays(days),
    weeklyMinutes: days.filter((d) => d.active).reduce((n, d) => n + workMinutes(d), 0),
    employeeCount: usage ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "attendance", "read");
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") || "template";

  if (type === "template") {
    const [templates, usage] = await Promise.all([
      WorkSchedule.find({}).sort({ name: 1 }).lean<Array<Record<string, unknown>>>(),
      Employee.aggregate<{ _id: RecordId; n: number }>([
        { $match: { workScheduleId: { $ne: null }, status: { $ne: "resigned" } } },
        { $group: { _id: "$workScheduleId", n: { $sum: 1 } } },
      ]),
    ]);
    const usedBy = new Map(usage.map((u) => [String(u._id), u.n]));
    return apiSuccess(templates.map((t) => presentTemplate(t, usedBy.get(String(t._id)))));
  }

  if (type === "employees") {
    const { page, limit, skip } = pagination(req, 25, 100);
    const filter: Record<string, unknown> = { status: { $ne: "resigned" } };
    const q = sp.get("q")?.trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: rx }, { employeeId: rx }];
    }
    const scheduleId = sp.get("scheduleId");
    if (scheduleId === "none") filter.workScheduleId = null;
    else if (scheduleId && objectId.safeParse(scheduleId).success) filter.workScheduleId = scheduleId;
    const branchId = sp.get("branchId");
    if (branchId && objectId.safeParse(branchId).success) filter.branchId = branchId;

    const [rows, total] = await Promise.all([
      Employee.find(filter)
        .select("name employeeId branchId divisionId workScheduleId status")
        .populate("branchId", "name workHours")
        .populate("divisionId", "name")
        .populate("workScheduleId", "name days clockIn clockOut activeDays")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Array<Record<string, unknown>>>(),
      Employee.countDocuments(filter),
    ]);
    return apiSuccess(
      rows.map((r) => {
        const tpl = r.workScheduleId as Record<string, unknown> | null;
        return { ...r, scheduleSummary: tpl ? summariseDays(expandDays(tpl)) : null };
      }),
      undefined,
      { page, limit, total }
    );
  }

  if (type === "overrides") {
    const { page, limit, skip } = pagination(req, 25, 100);
    const from = sp.get("from") || wibDateKey();
    const to = sp.get("to") || "";
    const filter: Record<string, unknown> = {
      date: { $gte: wibStartOfDay(from), ...(to ? { $lte: wibEndOfDay(to) } : {}) },
    };
    const employeeId = sp.get("employeeId");
    if (employeeId && objectId.safeParse(employeeId).success) filter.employeeId = employeeId;

    const [rows, total] = await Promise.all([
      EmployeeSchedule.find(filter)
        .populate("employeeId", "name employeeId")
        .populate("scheduleId", "name days clockIn clockOut activeDays")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Array<Record<string, unknown>>>(),
      EmployeeSchedule.countDocuments(filter),
    ]);
    return apiSuccess(
      rows.map((r) => {
        const tpl = r.scheduleId as Record<string, unknown> | null;
        if (!tpl || r.isOffDay) return { ...r, hours: null };
        const weekday = new Date(wibStartOfDay(wibDateKey(r.date as Date)).getTime() + getTimezoneOffset() * 60_000).getUTCDay();
        const d = expandDays(tpl).find((x) => x.day === weekday);
        return { ...r, hours: d ? `${d.clockIn}–${d.clockOut}` : null };
      }),
      undefined,
      { page, limit, total }
    );
  }

  if (type === "preview") {
    // The schedule attendance will actually use for each of the next days, so
    // HR can check a setup before anyone is marked late by it.
    const employeeId = sp.get("employeeId") ?? "";
    if (!objectId.safeParse(employeeId).success) throw BadRequest("Pilih karyawan.");
    const employee = await Employee.findById(employeeId)
      .select("name branchId")
      .populate("branchId", "name workHours")
      .lean<{ name: string; branchId?: { name?: string; workHours?: { start?: string; end?: string } } | null } | null>();
    if (!employee) throw NotFound("Karyawan tidak ditemukan.");
    const start = sp.get("from") || wibDateKey();
    const days = Math.min(31, Math.max(1, Number(sp.get("days")) || 14));
    const end = wibDateKey(new Date(wibStartOfDay(start).getTime() + (days - 1) * 86_400_000 + 12 * 3600_000));
    const out = [];
    for (const key of eachDayKey(start, end)) {
      out.push({ date: key, ...(await resolveSchedule(employeeId, key, employee.branchId ?? null)) });
    }
    return apiSuccess({ employee: employee.name, days: out });
  }

  throw BadRequest("Parameter type tidak dikenali.");
});

/* ------------------------------------------------------------------ */
/* POST                                                                 */
/* ------------------------------------------------------------------ */

const daySchema = z
  .object({
    day: z.number().int().min(0).max(6),
    active: z.boolean(),
    clockIn: hhmm,
    clockOut: hhmm,
    breakOut: hhmm.or(z.literal("")).optional(),
    breakIn: hhmm.or(z.literal("")).optional(),
  })
  .refine((d) => !d.active || d.clockIn !== d.clockOut, { message: "Jam masuk dan pulang tidak boleh sama." })
  .refine((d) => !d.active || Boolean(d.breakOut) === Boolean(d.breakIn), {
    message: "Isi jam mulai dan selesai istirahat, atau kosongkan keduanya.",
  });

const templateSchema = z.object({
  mode: z.literal("template"),
  id: objectId.optional(),
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(60),
  description: z.string().trim().max(200).default(""),
  color: z.string().max(20).default("primary"),
  gracePeriodMinutes: z.number().int().min(0).max(120).default(0),
  isBreakActive: z.boolean().default(false),
  days: z.array(daySchema).length(7, "Isi ketujuh hari."),
});

const assignSchema = z.object({
  mode: z.literal("assign"),
  employeeIds: z.array(objectId).min(1, "Pilih minimal satu karyawan.").max(500),
  /** Null removes the weekly template; the branch hours apply again. */
  scheduleId: objectId.nullable(),
});

const overrideSchema = z
  .object({
    mode: z.literal("override"),
    employeeIds: z.array(objectId).min(1, "Pilih minimal satu karyawan.").max(200),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduleId: objectId.nullable(),
    isOffDay: z.boolean().default(false),
    note: z.string().trim().max(120).default(""),
  })
  .refine((v) => v.to >= v.from, { message: "Tanggal selesai harus setelah tanggal mulai.", path: ["to"] })
  .refine((v) => v.isOffDay || v.scheduleId, { message: "Pilih shift atau tandai sebagai libur.", path: ["scheduleId"] });

const bodySchema = z.union([templateSchema, assignSchema, overrideSchema]);

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "attendance", "write");
  const body = await parseBody(req, bodySchema);

  if (body.mode === "template") {
    const days = [...body.days].sort((a, b) => a.day - b.day);
    const firstActive = [1, 2, 3, 4, 5, 6, 0].map((d) => days[d]).find((d) => d.active) ?? days[1];
    const doc = {
      name: body.name,
      description: body.description,
      color: body.color,
      gracePeriodMinutes: body.gracePeriodMinutes,
      isBreakActive: body.isBreakActive,
      days: days.map((d) => ({ ...d, breakOut: d.breakOut || "", breakIn: d.breakIn || "" })),
      // Flat fields kept in step for older readers (see the model).
      clockIn: firstActive.clockIn,
      clockOut: firstActive.clockOut,
      breakOut: firstActive.breakOut || undefined,
      breakIn: firstActive.breakIn || undefined,
      activeDays: days.filter((d) => d.active).map((d) => d.day),
    };
    if (!doc.activeDays.length) throw BadRequest("Aktifkan minimal satu hari kerja.");

    const clash = await WorkSchedule.exists({ name: body.name, ...(body.id ? { _id: { $ne: body.id } } : {}) });
    if (clash) throw Conflict(`Template "${body.name}" sudah ada.`);

    if (body.id) {
      const before = await WorkSchedule.findById(body.id).lean<Record<string, unknown> | null>();
      if (!before) throw NotFound("Template jadwal tidak ditemukan.");
      const updated = await WorkSchedule.findByIdAndUpdate(body.id, doc, { new: true }).lean<Record<string, unknown>>();
      void logActivity({ userId: ctx.user.id, action: "UPDATE_SCHEDULE_TEMPLATE", module: "attendance", before, after: updated, ip: ctx.ip, userAgent: ctx.userAgent });
      return apiSuccess(presentTemplate(updated!), `Template "${body.name}" diperbarui. Berlaku mulai absen berikutnya.`);
    }
    const created = await WorkSchedule.create(doc);
    void logActivity({ userId: ctx.user.id, action: "CREATE_SCHEDULE_TEMPLATE", module: "attendance", after: created.toObject(), ip: ctx.ip, userAgent: ctx.userAgent });
    return apiSuccess(presentTemplate(created.toObject()), `Template "${body.name}" dibuat.`, undefined, 201);
  }

  if (body.mode === "assign") {
    if (body.scheduleId && !(await WorkSchedule.exists({ _id: body.scheduleId }))) {
      throw NotFound("Template jadwal tidak ditemukan.");
    }
    const res = await Employee.updateMany(
      { _id: { $in: body.employeeIds } },
      { $set: { workScheduleId: body.scheduleId } }
    );
    void logActivity({
      userId: ctx.user.id,
      action: "ASSIGN_WEEKLY_SCHEDULE",
      module: "attendance",
      after: { employees: body.employeeIds.length, scheduleId: body.scheduleId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return apiSuccess(
      { updated: res.modifiedCount },
      body.scheduleId
        ? `${body.employeeIds.length} karyawan memakai template ini mulai absen berikutnya.`
        : `Template dilepas dari ${body.employeeIds.length} karyawan; jam operasional cabang berlaku kembali.`
    );
  }

  // override
  const dayKeys = eachDayKey(body.from, body.to);
  if (dayKeys.length > 62) throw BadRequest("Rentang pengecualian maksimal 62 hari sekaligus.");
  if (body.scheduleId && !(await WorkSchedule.exists({ _id: body.scheduleId }))) {
    throw NotFound("Template jadwal tidak ditemukan.");
  }
  const ops = body.employeeIds.flatMap((employeeId) =>
    dayKeys.map((key) => ({
      updateOne: {
        filter: { employeeId: new RecordId(employeeId), date: wibStartOfDay(key) },
        update: {
          $set: {
            scheduleId: body.isOffDay ? null : body.scheduleId,
            isOffDay: body.isOffDay,
            note: body.note,
            createdBy: new RecordId(ctx.user.id),
          },
        },
        upsert: true,
      },
    }))
  );
  // Older rows were stored at arbitrary times of the day; clear those first so
  // one date never carries two overrides.
  for (const employeeId of body.employeeIds) {
    await EmployeeSchedule.deleteMany({
      employeeId,
      date: { $gte: wibStartOfDay(body.from), $lte: wibEndOfDay(body.to) },
      $expr: { $ne: [{ $mod: [{ $toLong: "$date" }, 86_400_000] }, (24 - 7) * 3_600_000] },
    });
  }
  await EmployeeSchedule.bulkWrite(ops, { ordered: false });

  void logActivity({
    userId: ctx.user.id,
    action: "SET_SCHEDULE_OVERRIDE",
    module: "attendance",
    after: { employees: body.employeeIds.length, from: body.from, to: body.to, isOffDay: body.isOffDay, scheduleId: body.scheduleId, note: body.note },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { created: ops.length },
    `${ops.length} jadwal khusus disimpan untuk ${body.employeeIds.length} karyawan (${dayKeys.length} hari).`
  );
});

/* ------------------------------------------------------------------ */
/* DELETE — one override                                                */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "attendance", "write");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!objectId.safeParse(id).success) throw BadRequest("ID tidak valid.");
  const row = await EmployeeSchedule.findByIdAndDelete(id).lean<Record<string, unknown> | null>();
  if (!row) throw NotFound("Jadwal khusus tidak ditemukan.");
  void logActivity({ userId: ctx.user.id, action: "DELETE_SCHEDULE_OVERRIDE", module: "attendance", before: row, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ id }, "Jadwal khusus dihapus; hari itu kembali mengikuti template karyawan.");
});

void Branch;
