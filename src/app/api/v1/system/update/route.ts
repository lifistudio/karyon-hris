import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { enforceRateLimit, Forbidden, parseBody, requireUser } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { clearTarget, saveTarget, startRollback, startUpdate, targetInput, updateOverview } from "@/lib/updates";

async function superadmin(req: Request) {
  const ctx = await requireUser(req);
  if (ctx.user.role !== "SUPERADMIN") throw Forbidden("Hanya Superadmin yang dapat mengelola pembaruan aplikasi.");
  return ctx;
}

/** Version running now, the latest release, and how this installation can be updated. */
export const GET = wrapRouteHandler(async (req) => {
  await superadmin(req);
  const response = apiSuccess(await updateOverview());
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/).optional() }).strict(),
  z.object({ action: z.literal("rollback") }).strict(),
]);

/** Starts an update to the latest (or a given) version, or returns to the previous one. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await superadmin(req);
  const body = await parseBody(req, action);
  enforceRateLimit("app-update", ctx.user.id, { max: 6, windowMs: 10 * 60_000 });
  const result = body.action === "update" ? await startUpdate(body.version) : await startRollback();
  await logActivity({ userId: ctx.user.id, action: body.action === "update" ? "APP_UPDATE_STARTED" : "APP_ROLLBACK_STARTED", module: "settings", after: result, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(result, body.action === "update"
    ? "Pembaruan dimulai. Aplikasi akan tersambung kembali dalam beberapa menit; data tetap aman."
    : "Mengembalikan versi sebelumnya. Aplikasi akan tersambung kembali dalam beberapa menit.");
});

/** Saves where updates are sent (Dokploy API or a deploy webhook). Secrets are stored encrypted. */
export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await superadmin(req);
  const body = await parseBody(req, targetInput);
  const target = await saveTarget(body);
  await logActivity({ userId: ctx.user.id, action: "APP_UPDATE_TARGET_SAVED", module: "settings", after: target ?? undefined, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(target, "Tujuan pembaruan disimpan.");
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await superadmin(req);
  await clearTarget();
  await logActivity({ userId: ctx.user.id, action: "APP_UPDATE_TARGET_REMOVED", module: "settings", ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ removed: true }, "Tujuan pembaruan dihapus.");
});
