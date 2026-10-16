import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, BadRequest } from "@/lib/guard";
import { getCategorySettings, saveCategorySettings } from "@/lib/inventory/server";

/** Categories with the specification fields and checklist each one uses. */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "inventory", "read");
  return apiSuccess(await getCategorySettings(), "Berhasil memuat kategori inventaris");
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  return apiSuccess(await saveCategorySettings(ctx, body), "Kategori inventaris disimpan");
});
