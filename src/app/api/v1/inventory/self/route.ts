import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireEmployee, BadRequest, enforceRateLimit } from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { connectToDatabase } from "@/lib/db";
import InventoryAssignment from "@/models/InventoryAssignment";
import { disputeHandover, presentPhotos, reportAssetIssue, signHandover } from "@/lib/inventory/server";
import InventoryEvent from "@/models/InventoryEvent";
import "@/models/Inventory";

/** The employee's own assets: waiting for a signature, reported, and held. */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  await connectToDatabase();

  const assignments = await InventoryAssignment.find({
    employeeId: ctx.employeeId,
    status: { $in: ["pending_handover", "disputed", "active"] },
  })
    .select("-signatureUrl -signedIp -signedUserAgent")
    .populate("inventoryId", "code name category specs condition initialCheck")
    .sort({ handoverDate: -1 })
    .lean<Array<Record<string, unknown> & { inventoryId?: { _id?: unknown; initialCheck?: { photos?: unknown } | null } | null }>>();

  const reports = await InventoryEvent.find({
    type: "employee_report", employeeId: ctx.employeeId, resolvedAt: null,
    inventoryId: { $in: assignments.map((a) => a.inventoryId?._id).filter(Boolean) },
  }).select("inventoryId description createdAt").sort({ createdAt: -1 }).lean<Array<{ inventoryId: unknown; description: string; createdAt: Date }>>();

  // The employee compares the asset with the photos GA took, so those links go along.
  const rows = await Promise.all(assignments.map(async (a) => ({
    ...a,
    handoverPhotos: await presentPhotos(a.handoverPhotos),
    initialPhotos: await presentPhotos(a.inventoryId?.initialCheck?.photos),
    openReport: reports.find((r) => String(r.inventoryId) === String(a.inventoryId?._id)) ?? null,
  })));

  return apiSuccess(rows, "Berhasil memuat inventaris karyawan");
});

/**
 * `action: "sign"` (default) accepts the asset with a signature;
 * `action: "dispute"` reports that it does not match the BAST instead;
 * `action: "report"` tells GA about a problem with an asset already held.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("inventory-self", ctx.employeeId, RATE_RULES.write);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");

  if (body.action === "report") {
    const result = await reportAssetIssue(ctx, body);
    return apiSuccess({ _id: result._id }, "Laporan dikirim ke tim GA.");
  }
  if (body.action === "dispute") {
    const result = await disputeHandover(ctx, body);
    return apiSuccess({ _id: result._id, status: result.status }, "Laporan dikirim ke tim GA. Aset belum tercatat sebagai milik Anda.");
  }
  const result = await signHandover(ctx, body);
  return apiSuccess({ _id: result._id, status: result.status }, "BAST ditandatangani. Aset kini tercatat dipegang Anda.");
});
