import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, enforceRateLimit, Forbidden, parseBody, requireUser } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { clearEntitlementCache, EDITION, getEntitlements } from "@/lib/licensing/server";
import { PRO_FEATURE_LABELS } from "@/lib/licensing/features";
import { activateLicense, activationSummary, deactivateLicense, LicenseServerError, licenseServer, renewLease } from "@/lib/licensing/activation";

function serverOrigin() {
  try { return licenseServer(); } catch { return null; }
}

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const superadmin = ctx.user.role === "SUPERADMIN";
  const license = await getEntitlements();
  const activation = await activationSummary();
  // Only the superadmin sees installation identifiers; everyone else needs the edition and features for the UI.
  const response = apiSuccess({
    ...license,
    installationId: superadmin ? license.installationId : null,
    edition: EDITION,
    featureLabels: PRO_FEATURE_LABELS,
    activation: superadmin ? activation : { activated: activation.activated, licenseState: activation.licenseState },
    licenseServer: superadmin ? serverOrigin() : null,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), licenseKey: z.string().trim().min(16).max(256) }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  z.object({ action: z.literal("deactivate") }).strict(),
]);

/**
 * Superadmin only. `activate` binds a license key to this installation and
 * website origin — also used to replace the current key; `deactivate` releases
 * the key so it can be used on another server; `refresh` renews the signed
 * lease now. The official image contains Pro, so a verified license unlocks the
 * features immediately: nothing is downloaded or reinstalled.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  if (ctx.user.role !== "SUPERADMIN") throw Forbidden("Hanya Superadmin yang dapat mengelola lisensi.");
  const body = await parseBody(req, action);
  enforceRateLimit("license-action", ctx.user.id, { max: 10, windowMs: 10 * 60_000 });
  try {
    if (body.action === "activate") {
      const before = await activationSummary();
      await activateLicense(body.licenseKey);
      clearEntitlementCache();
      void logActivity({ userId: ctx.user.id, action: before.activated ? "LICENSE_REPLACED" : "LICENSE_ACTIVATED", module: "settings", before: before.activated ? { keyHint: before.keyHint } : undefined, after: { keyHint: body.licenseKey.slice(-4) }, ip: ctx.ip, userAgent: ctx.userAgent });
      const license = await getEntitlements(true);
      if (EDITION === "pro" && !["active", "grace"].includes(license.status)) throw new LicenseServerError("Lisensi diterima, tetapi belum dapat diverifikasi oleh aplikasi. Hubungi pengelola untuk memeriksa versi aplikasi dan kunci verifikasi.");
      return apiSuccess({ activation: await activationSummary() }, EDITION === "pro"
        ? (before.activated ? "License key diganti. Fitur Pro aktif dengan lisensi baru." : "Fitur Pro sudah aktif dan siap digunakan.")
        : "Lisensi tersimpan, tetapi aplikasi ini dibangun dari source Community tanpa modul Pro. Ganti HRIS_IMAGE ke image resmi ghcr.io/lifistudio/hris agar fitur Pro langsung aktif.");
    }
    if (body.action === "deactivate") {
      const result = await deactivateLicense();
      clearEntitlementCache();
      await logActivity({ userId: ctx.user.id, action: "LICENSE_RELEASED", module: "settings", after: { remoteReleased: result.remoteReleased }, ip: ctx.ip, userAgent: ctx.userAgent });
      return apiSuccess({ activation: await activationSummary(), ...result }, result.remoteReleased
        ? "Lisensi dilepas. Aplikasi kembali ke fitur Community dan key dapat dipakai di server lain."
        : "Lisensi dilepas dari aplikasi ini. Bila server lisensi tidak terjangkau, lepaskan juga dari dashboard pelanggan sebelum memakai key di server lain.");
    }
    if (body.action === "refresh") {
      try { await renewLease(); } finally { clearEntitlementCache(); }
      await getEntitlements(true);
      return apiSuccess({ activation: await activationSummary() }, "Status lisensi diperbarui dari server lisensi.");
    }
    throw BadRequest("Aksi tidak dikenal.");
  } catch (error) {
    if (error instanceof LicenseServerError) throw BadRequest(error.message);
    throw error;
  }
});
