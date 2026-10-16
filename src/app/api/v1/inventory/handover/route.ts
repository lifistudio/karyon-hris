import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, BadRequest } from "@/lib/guard";
import { assignAsset, cancelHandover, returnAsset } from "@/lib/inventory/server";

/**
 * GA side of a handover (BAST):
 * - `assign`  hand an available asset to an employee; they sign in the portal
 * - `return`  receive a signed-for asset back, with its condition at return
 * - `cancel`  withdraw a handover the employee has not signed (or disputed)
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "inventory", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");

  switch (body.action) {
    case "assign":
      return apiSuccess(await assignAsset(ctx, body), "Aset diserahkan. Karyawan diminta menandatangani BAST di portal.");
    case "return":
      return apiSuccess(await returnAsset(ctx, body), "Pengembalian aset dicatat. Aset kembali tersedia.");
    case "cancel":
      return apiSuccess(await cancelHandover(ctx, body), "Serah terima dibatalkan.");
    default:
      throw BadRequest("Aksi serah terima harus assign, return, atau cancel.");
  }
});
