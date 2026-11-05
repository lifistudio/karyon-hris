import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireCompanyPermission, BadRequest } from "@/lib/guard";
import { recordMaintenance } from "@/lib/inventory/server";

/** Records a repair or a replaced part, outside the monthly round. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "inventory", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  return apiSuccess(await recordMaintenance(ctx, body), "Catatan tersimpan di riwayat aset.");
});
