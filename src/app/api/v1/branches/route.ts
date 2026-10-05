import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, parseBody, BadRequest, Conflict, NotFound, Forbidden } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import Branch from "@/models/Branch";
import Employee from "@/models/Employee";
import { getBranchAccess, isBranchUsable } from "@/lib/licensing/branch-access";


const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM");

const branchSchema = z.object({
  // The form sends null (or "") for a new branch; both mean "create".
  id: z.union([z.string().regex(/^[0-9a-fA-F]{24}$/, "ID cabang tidak valid"), z.literal(""), z.null()]).optional(),
  name: z.string().trim().min(3, "Nama cabang minimal 3 karakter").max(120),
  address: z.string().trim().min(5, "Alamat minimal 5 karakter").max(400),
  // Indonesia spans roughly -11..6 latitude and 95..141 longitude, but the
  // schema stays globally valid so the system can be reused elsewhere.
  lat: z.number().min(-90, "Latitude di luar rentang").max(90, "Latitude di luar rentang"),
  lng: z.number().min(-180, "Longitude di luar rentang").max(180, "Longitude di luar rentang"),
  radiusMeter: z
    .number()
    .int()
    .min(5, "Radius minimal 5 meter")
    .max(5000, "Radius maksimal 5000 meter")
    .optional(),
  workHours: z.object({ start: hhmm, end: hhmm }).optional(),
});

export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);

  // Branch coordinates are needed by the portal to explain a geofence rejection,
  // so any signed-in user may read them. Nothing sensitive lives on this model.
  const branches = await Branch.find({}).sort({ name: 1 }).lean();

  // Headcount per branch helps admins see which sites are actually in use.
  const counts = await Employee.aggregate<{ _id: unknown; count: number }>([
    { $match: { status: { $in: ["active", "onboarding"] } } },
    { $group: { _id: "$branchId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  // Without the multi-branch license only one branch stays usable; the rest are shown as inactive.
  const access = await getBranchAccess();

  return apiSuccess(
    branches.map((b) => ({
      ...b,
      employeeCount: countMap.get(String(b._id)) ?? 0,
      licenseInactive: !isBranchUsable(access, b._id),
    })),
    "Berhasil memuat data cabang"
  );
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await parseBody(req, branchSchema);
  const settings = await getSettings();

  const payload = {
    name: body.name,
    address: body.address,
    lat: body.lat,
    lng: body.lng,
    radiusMeter: body.radiusMeter ?? (Number(settings.default_geo_radius) || 15),
    workHours: body.workHours ?? { start: "09:00", end: "17:00" },
  };

  if (body.workHours && body.workHours.end <= body.workHours.start) {
    // Overnight shifts belong on a work schedule, not on branch opening hours,
    // which are only used as the fallback when no schedule is assigned.
    throw BadRequest("Jam tutup harus lebih besar dari jam buka. Untuk shift malam, gunakan menu Jadwal & Shift.");
  }

  const duplicate = await Branch.findOne({ name: body.name }).select("_id").lean<{ _id: unknown } | null>();
  if (duplicate && String(duplicate._id) !== String(body.id ?? "")) {
    throw Conflict(`Nama cabang "${body.name}" sudah dipakai. Gunakan nama lain.`);
  }

  if (body.id) {
    const before = await Branch.findById(body.id);
    if (!before) throw NotFound("Cabang tidak ditemukan.");

    const branch = await Branch.findByIdAndUpdate(body.id, payload, { new: true });

    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_BRANCH",
      module: "settings",
      before: before.toObject(),
      after: branch!.toObject(),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return apiSuccess(
      branch,
      `Cabang ${body.name} diperbarui. Radius ${payload.radiusMeter} meter langsung berlaku untuk presensi berikutnya.`
    );
  }

  if (await Branch.exists({})) throw Forbidden("Edisi Community mendukung satu cabang. Cabang tambahan memerlukan HRIS Pro dengan lisensi aktif (menu Lisensi & Paket). Anda tetap dapat mengubah cabang yang ada.");

  const branch = await Branch.create(payload);

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_BRANCH",
    module: "settings",
    after: branch.toObject(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(branch, `Cabang ${body.name} ditambahkan.`, undefined, 201);
});
