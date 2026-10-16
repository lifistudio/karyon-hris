import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireEmployee, BadRequest } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import InventoryAssignment from "@/models/InventoryAssignment";
import { disputeHandover, signHandover } from "@/lib/inventory/server";
import "@/models/Inventory";

/** The employee's own assets: waiting for a signature, reported, and held. */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  await connectToDatabase();

  const assignments = await InventoryAssignment.find({
    employeeId: ctx.employeeId,
    status: { $in: ["pending_handover", "disputed", "active"] },
  })
    .select("-signatureUrl")
    .populate("inventoryId", "code name category specs condition")
    .sort({ handoverDate: -1 })
    .lean<Array<Record<string, unknown>>>();

  return apiSuccess(assignments, "Berhasil memuat inventaris karyawan");
});

/**
 * `action: "sign"` (default) accepts the asset with a signature;
 * `action: "dispute"` reports that it does not match the BAST instead.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");

  if (body.action === "dispute") {
    const result = await disputeHandover(ctx, body);
    return apiSuccess({ _id: result._id, status: result.status }, "Laporan dikirim ke tim GA. Aset belum tercatat sebagai milik Anda.");
  }
  const result = await signHandover(ctx, body);
  return apiSuccess({ _id: result._id, status: result.status }, "BAST ditandatangani. Aset kini tercatat dipegang Anda.");
});
