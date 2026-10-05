import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireEmployee,
  parseBody,
  enforceRateLimit,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  employeeRecordScopeFilter,
  pagination,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { RATE_RULES } from "@/lib/rate-limit";
import { calculateDistanceMeters } from "@/lib/geo";
import { storageProvider, decodeDataUrl } from "@/lib/storage";
import { optimizeImage } from "@/lib/storage/image";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import {
  wibDateKey,
  wibStartOfDay,
  wibEndOfDay,
  wibStartOfMonth,
  wibEndOfMonth,
  wibTimeOnDay,
  wibPeriodKey,
} from "@/lib/time";
import { resolveSchedule, holidayMap } from "@/lib/hr/calendar";
import Attendance from "@/models/Attendance";
import Employee from "@/models/Employee";
import Branch from "@/models/Branch";
import LeaveRequest from "@/models/LeaveRequest";
import FaceProfile from "@/models/FaceProfile";
import { getBranchAccess, isBranchUsable, INACTIVE_BRANCH_MESSAGE } from "@/lib/licensing/branch-access";
import { getFaceSettings, verifyAttendanceFace, FaceMismatchError } from "@/lib/face/service";

const ACTIONS = ["clock_in", "break_out", "break_in", "clock_out"] as const;
type Action = (typeof ACTIONS)[number];

const ACTION_LABEL: Record<Action, string> = {
  clock_in: "Absen Masuk",
  break_out: "Mulai Istirahat",
  break_in: "Selesai Istirahat",
  clock_out: "Absen Pulang",
};

/* ------------------------------------------------------------------ */
/* GET — history + the settings the portal needs to render its buttons  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const url = new URL(req.url);
  const period = url.searchParams.get("period") || wibPeriodKey();
  const requestedEmployeeId = url.searchParams.get("employeeId");
  const { page, limit, skip } = pagination(req, 62, 200);

  const filter: Record<string, unknown> = {
    date: { $gte: wibStartOfMonth(period), $lte: wibEndOfMonth(period) },
  };

  if (requestedEmployeeId && requestedEmployeeId !== ctx.user.employeeId) {
    // Reading somebody else's attendance is a privileged action, checked
    // against the database rather than a hardcoded role list.
    const perm = await checkPermission(ctx.user.id, "attendance", "read");
    if (!perm.allowed || perm.scope === "self") {
      throw Forbidden("Anda tidak memiliki izin melihat presensi karyawan lain.");
    }
    Object.assign(filter, await employeeRecordScopeFilter({ ...ctx, permission: perm }));
    // Keep the scope predicate and requested id separate; assigning employeeId
    // directly would overwrite the allowed-id set.
    filter.$and = [{ employeeId: requestedEmployeeId }];
  } else if (!requestedEmployeeId && url.searchParams.get("scope") === "all") {
    const perm = await checkPermission(ctx.user.id, "attendance", "read");
    if (!perm.allowed || perm.scope === "self") {
      throw Forbidden("Anda tidak memiliki izin melihat presensi seluruh karyawan.");
    }
    Object.assign(filter, await employeeRecordScopeFilter({ ...ctx, permission: perm }));
  } else {
    if (!ctx.user.employeeId) {
      return apiSuccess({ logs: [], settings: await attendanceSettings(null), total: 0 });
    }
    filter.employeeId = ctx.user.employeeId;
  }

  const [logs, total] = await Promise.all([
    Attendance.find(filter)
      .populate({ path: "employeeId", select: "name employeeId branchId divisionId", populate: { path: "branchId", select: "name" } })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(filter),
  ]);

  // Selfies must not be handed out as raw paths — mint a short-lived signed URL
  // per photo instead, so a leaked response body expires on its own.
  const withSignedPhotos = await Promise.all(
    logs.map(async (log) => ({
      ...log,
      photoUrl: await Promise.all(
        (log.photoUrl ?? []).map((key: string) => storageProvider.getSignedUrl(key, 900))
      ),
    }))
  );

  return apiSuccess(
    { logs: withSignedPhotos, settings: await attendanceSettings(ctx.user.employeeId), period },
    "Berhasil memuat riwayat presensi",
    { page, limit, total }
  );
});

async function attendanceSettings(employeeId: string | null) {
  const s = await getSettings();
  const face = await getFaceSettings();
  const faceEnrolled =
    face.enabled && employeeId ? Boolean(await FaceProfile.exists({ employeeId })) : false;

  return {
    face_recognition_enabled: face.enabled,
    /** Lets the portal send an unenrolled employee to enrol before they try. */
    face_enrolled: faceEnrolled,
    require_selfie_clock_in: Boolean(s.require_selfie_clock_in),
    require_selfie_break_out: Boolean(s.require_selfie_break_out),
    require_selfie_break_in: Boolean(s.require_selfie_break_in),
    require_selfie_clock_out: Boolean(s.require_selfie_clock_out),
    enable_break_attendance: Boolean(s.enable_break_attendance),
    allow_location_override: Boolean(s.allow_location_override),
    location_override_min_note: Number(s.location_override_min_note),
  };
}

/* ------------------------------------------------------------------ */
/* POST — record one attendance tap                                     */
/* ------------------------------------------------------------------ */

const attendanceSchema = z.object({
  action: z.enum(ACTIONS),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  photo: z.string().optional(),
  // `isManualFallback` used to be accepted from the client. It meant "the face
  // check failed, accept a plain selfie", and a request could simply claim it.
  // Only the server decides that now, so the field is no longer read.
  isLocationOverride: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("attendance", ctx.employeeId, RATE_RULES.write);

  const body = await parseBody(req, attendanceSchema);
  const settings = await getSettings();
  const action = body.action;

  const now = new Date();
  const dayKey = wibDateKey(now);
  const dayStart = wibStartOfDay(dayKey);

  /* --- 1. Selfie requirement -------------------------------------- */
  // Face verification is meaningless if the photo can be skipped, so while it
  // is on, the two taps that decide pay — in and out — always need one.
  const face = await getFaceSettings();
  const selfieRequired =
    Boolean(settings[`require_selfie_${action}`]) ||
    (face.enabled && (action === "clock_in" || action === "clock_out"));
  if (selfieRequired && !body.photo) {
    throw BadRequest(
      `Foto selfie wajib disertakan untuk ${ACTION_LABEL[action]}. Izinkan akses kamera lalu ambil foto terlebih dahulu.`
    );
  }

  /* --- 2. Break steps only exist when breaks are enabled ----------- */
  if ((action === "break_out" || action === "break_in") && !settings.enable_break_attendance) {
    throw BadRequest("Absen istirahat sedang dinonaktifkan oleh HRD.");
  }

  /* --- 3. Employee + branch --------------------------------------- */
  const employee = await Employee.findById(ctx.employeeId).populate("branchId");
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");
  if (employee.status !== "active" && employee.status !== "onboarding") {
    throw Forbidden("Status kepegawaian Anda tidak aktif, sehingga presensi tidak dapat dicatat.");
  }

  const assignedBranch = employee.branchId as unknown as {
    _id: unknown;
    name: string;
    lat: number;
    lng: number;
    radiusMeter: number;
    workHours?: { start?: string; end?: string };
  } | null;

  if (!assignedBranch) {
    throw BadRequest(
      "Cabang penempatan Anda belum diatur oleh HRD, sehingga radius presensi tidak dapat diperiksa. Hubungi HRD."
    );
  }

  /* --- 4. Existing record + step ordering -------------------------- */
  // Ordering is enforced server-side: hiding a button in the UI is not a rule.
  const existing = await Attendance.findOne({
    employeeId: ctx.employeeId,
    date: { $gte: dayStart, $lte: wibEndOfDay(dayKey) },
  });

  assertSequence(action, existing, Boolean(settings.enable_break_attendance));

  /* --- 5. Geofence ------------------------------------------------- */
  let activeBranch = assignedBranch;
  let isCrossBranch = false;
  let distance = calculateDistanceMeters(
    body.lat,
    body.lng,
    assignedBranch.lat,
    assignedBranch.lng
  );
  const defaultRadius = Number(settings.default_geo_radius);
  let isWithinRadius = distance <= (assignedBranch.radiusMeter || defaultRadius);

  // Without the multi-branch license only one branch accepts attendance.
  const branchAccess = await getBranchAccess();
  if (!isWithinRadius) {
    const others = await Branch.find({ _id: { $ne: assignedBranch._id } }).lean<
      Array<{ _id: unknown; name: string; lat: number; lng: number; radiusMeter: number }>
    >();
    for (const br of others) {
      if (!isBranchUsable(branchAccess, br._id)) continue;
      const d = calculateDistanceMeters(body.lat, body.lng, br.lat, br.lng);
      if (d <= (br.radiusMeter || defaultRadius)) {
        activeBranch = br as typeof assignedBranch;
        distance = d;
        isWithinRadius = true;
        isCrossBranch = true;
        break;
      }
    }
  }

  if (!isBranchUsable(branchAccess, activeBranch._id)) throw Forbidden(INACTIVE_BRANCH_MESSAGE);

  // An approved WFH / dinas-luar leave covering today lifts the radius check —
  // this is the exemption the spec describes, and it is checked here rather
  // than trusted from the client.
  let remoteApproved = false;
  if (!isWithinRadius) {
    const approvedRemote = await LeaveRequest.findOne({
      employeeId: ctx.employeeId,
      status: "approved",
      startDate: { $lte: wibEndOfDay(dayKey) },
      endDate: { $gte: dayStart },
    })
      .populate("leaveTypeId", "name allowsRemoteAttendance")
      .lean<{ leaveTypeId?: { name?: string; allowsRemoteAttendance?: boolean } } | null>();

    const typeName = approvedRemote?.leaveTypeId?.name?.toLowerCase() ?? "";
    remoteApproved =
      approvedRemote?.leaveTypeId?.allowsRemoteAttendance === true ||
      /wfh|dinas luar|work from home|remote/.test(typeName);
  }

  const usingOverride = Boolean(body.isLocationOverride) && !isWithinRadius && !remoteApproved;

  if (usingOverride) {
    if (!settings.allow_location_override) {
      throw Forbidden(
        "Menu \"Kendala Lokasi\" sedang dinonaktifkan oleh HRD. Silakan absen dari dalam area kantor."
      );
    }
    const minNote = Number(settings.location_override_min_note);
    if (!body.note || body.note.trim().length < minNote) {
      throw BadRequest(
        `Alasan kendala lokasi wajib diisi minimal ${minNote} karakter agar HRD dapat meninjau pengajuan Anda.`
      );
    }
  }

  if (!isWithinRadius && !remoteApproved && !usingOverride) {
    throw Object.assign(
      BadRequest(
        `Presensi ditolak: Anda berada ${Math.round(distance)} meter dari ${assignedBranch.name}, ` +
          `di luar radius ${assignedBranch.radiusMeter || defaultRadius} meter. ` +
          `Jika GPS perangkat bermasalah padahal Anda berada di kantor, gunakan menu "Kendala Lokasi".`
      ),
      { code: "GEOFENCE_REJECTED" }
    );
  }

  /* --- 6. Photo ----------------------------------------------------- */
  // Verified here, after the cheap checks above have passed, so a request that
  // was going to be refused for sequence or location never spends CPU on face
  // inference — and before anything is stored, so a mismatch leaves no record.
  let photoKey = "";
  let faceDistanceScore: number | null = null;
  if (body.photo) {
    const { buffer } = decodeDataUrl(body.photo, ["image/jpeg", "image/png", "image/webp"]);

    if (face.enabled) {
      try {
        const verdict = await verifyAttendanceFace(ctx.employeeId, buffer, face.threshold);
        faceDistanceScore = Math.round(verdict.distance * 1000) / 1000;
      } catch (err) {
        if (err instanceof FaceMismatchError) {
          // Repeated mismatches are the signal HR looks for when someone is
          // trying to clock in for a colleague.
          void logActivity({
            userId: ctx.user.id,
            action: "FACE_MISMATCH",
            module: "attendance",
            after: {
              date: dayKey,
              action,
              distance: Math.round(err.distance * 1000) / 1000,
              threshold: face.threshold,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
        throw err;
      }
    }

    // Stored as WebP (smaller, no metadata); face matching above used the original.
    // Timestamped so a retap never silently overwrites the earlier evidence.
    const stored = await optimizeImage(buffer, { maxSide: 1600 });
    photoKey = await storageProvider.upload(
      stored.buffer,
      `attendances/${ctx.employeeId}/${dayKey}-${action}-${now.getTime()}${stored.ext}`,
      stored.mime
    );
  }

  /* --- 7. Lateness -------------------------------------------------- */
  const schedule = await resolveSchedule(ctx.employeeId, dayKey, assignedBranch);
  let isLate = false;
  let lateMinutes = 0;

  // On a rostered day off nobody is late or leaves early; the hours still get
  // recorded and overtime rules decide what they are worth.
  if (action === "clock_in" && !schedule.isOffDay) {
    const scheduledAt = wibTimeOnDay(dayKey, schedule.clockIn);
    const deadline = new Date(scheduledAt.getTime() + schedule.gracePeriodMinutes * 60_000);
    if (now.getTime() > deadline.getTime()) {
      isLate = true;
      // Counted from the scheduled time, not from the end of the grace period:
      // grace forgives being marked late, it does not erase the minutes.
      lateMinutes = Math.round((now.getTime() - scheduledAt.getTime()) / 60_000);
    }
  }

  /* --- 8. Early clock-out flag -------------------------------------- */
  let isEarlyLeave = false;
  let earlyLeaveMinutes = 0;
  if (action === "clock_out" && !schedule.isOffDay) {
    // A night shift (23:00–07:00) ends on the following calendar day.
    const outDay = schedule.clockOut <= schedule.clockIn ? new Date(wibStartOfDay(dayKey).getTime() + 86_400_000) : dayKey;
    const scheduledOut = wibTimeOnDay(outDay, schedule.clockOut);
    if (now.getTime() < scheduledOut.getTime()) {
      isEarlyLeave = true;
      earlyLeaveMinutes = Math.round((scheduledOut.getTime() - now.getTime()) / 60_000);
    }
  }

  /* --- 9. Persist ---------------------------------------------------- */
  const holidays = await holidayMap(dayKey, dayKey);
  const record =
    existing ??
    new Attendance({
      employeeId: ctx.employeeId,
      date: dayStart,
      photoUrl: [],
      gpsLat: body.lat,
      gpsLng: body.lng,
    });

  if (action === "clock_in") {
    record.clockIn = now;
    record.isLate = isLate;
    record.lateMinutes = lateMinutes;
    record.scheduleClockIn = schedule.clockIn;
    record.scheduleClockOut = schedule.clockOut;
  } else if (action === "break_out") {
    record.breakOut = now;
  } else if (action === "break_in") {
    record.breakIn = now;
  } else {
    record.clockOut = now;
    record.isEarlyLeave = isEarlyLeave;
    record.earlyLeaveMinutes = earlyLeaveMinutes;
  }

  if (photoKey) record.photoUrl.push(photoKey);
  record.gpsLat = body.lat;
  record.gpsLng = body.lng;
  record.gpsAccuracy = body.accuracy ?? record.gpsAccuracy;
  record.branchId = (activeBranch as { _id: unknown })._id;
  record.distanceMeter = Math.round(distance);
  if (faceDistanceScore !== null) {
    record.faceVerified = true;
    record.faceDistance = faceDistanceScore;
  }
  record.isCrossBranch = isCrossBranch || record.isCrossBranch;
  record.isLocationOverride = usingOverride || record.isLocationOverride;
  record.isRemoteApproved = remoteApproved || record.isRemoteApproved;
  record.isHoliday = holidays.has(dayKey);
  if (body.note) record.note = body.note.trim();
  record.needsReview =
    record.isLocationOverride || record.isCrossBranch || record.isManualFallback;

  await record.save();

  void logActivity({
    userId: ctx.user.id,
    action: action.toUpperCase(),
    module: "attendance",
    after: {
      date: dayKey,
      action,
      branch: activeBranch.name,
      distanceMeter: Math.round(distance),
      isLate,
      lateMinutes,
      isLocationOverride: usingOverride,
      isCrossBranch,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  /* --- 10. Message -------------------------------------------------- */
  let message: string;
  switch (action) {
    case "clock_in":
      message = isLate
        ? `Absen masuk tercatat pukul ${fmt(now)} — terlambat ${lateMinutes} menit dari jadwal ${schedule.clockIn}.`
        : `Absen masuk tercatat pukul ${fmt(now)}. Selamat bekerja!`;
      break;
    case "break_out":
      message = `Istirahat dimulai pukul ${fmt(now)}. Selamat beristirahat!`;
      break;
    case "break_in":
      message = `Kembali bekerja pukul ${fmt(now)}. Semangat!`;
      break;
    default:
      message = isEarlyLeave
        ? `Absen pulang tercatat pukul ${fmt(now)} — ${earlyLeaveMinutes} menit lebih awal dari jadwal ${schedule.clockOut}.`
        : `Absen pulang tercatat pukul ${fmt(now)}. Hati-hati di jalan!`;
  }

  if (isCrossBranch) message += ` Tercatat di ${activeBranch.name} (lintas cabang) dan akan ditinjau HRD.`;
  if (usingOverride) message += " Ditandai sebagai kendala lokasi dan menunggu peninjauan HRD.";

  return apiSuccess({ attendance: record.toObject(), schedule }, message);
});

function fmt(d: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Rejects taps that do not make sense for the day so far — clocking out before
 * clocking in, clocking in twice, or ending a break that never started. Without
 * this the endpoint silently overwrote earlier timestamps.
 */
function assertSequence(
  action: Action,
  existing: {
    clockIn?: Date | null;
    breakOut?: Date | null;
    breakIn?: Date | null;
    clockOut?: Date | null;
  } | null,
  breaksEnabled: boolean
) {
  const clockIn = existing?.clockIn;
  const breakOut = existing?.breakOut;
  const breakIn = existing?.breakIn;
  const clockOut = existing?.clockOut;

  if (clockOut && action !== "clock_out") {
    throw Conflict("Anda sudah absen pulang hari ini. Gunakan Koreksi Absen bila ada yang keliru.");
  }

  switch (action) {
    case "clock_in":
      if (clockIn) {
        throw Conflict(
          `Anda sudah absen masuk hari ini pukul ${fmt(new Date(clockIn))}. Ajukan Koreksi Absen bila jamnya keliru.`
        );
      }
      break;

    case "break_out":
      if (!clockIn) throw Conflict("Absen masuk dulu sebelum memulai istirahat.");
      if (breakOut) throw Conflict("Istirahat hari ini sudah tercatat dimulai.");
      break;

    case "break_in":
      if (!clockIn) throw Conflict("Absen masuk dulu sebelum mencatat selesai istirahat.");
      if (!breakOut) throw Conflict("Catat mulai istirahat terlebih dahulu.");
      if (breakIn) throw Conflict("Selesai istirahat hari ini sudah tercatat.");
      break;

    case "clock_out":
      if (!clockIn) throw Conflict("Anda belum absen masuk hari ini, sehingga absen pulang tidak dapat dicatat.");
      if (clockOut) {
        throw Conflict(`Anda sudah absen pulang hari ini pukul ${fmt(new Date(clockOut))}.`);
      }
      if (breaksEnabled && breakOut && !breakIn) {
        throw Conflict("Catat selesai istirahat terlebih dahulu sebelum absen pulang.");
      }
      break;
  }
}
