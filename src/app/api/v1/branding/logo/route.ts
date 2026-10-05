import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, BadRequest } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider, decodeDataUrl } from "@/lib/storage";
import { optimizeImage } from "@/lib/storage/image";

/**
 * Company logo used on printed documents.
 *
 * The logo is stored as a **data URL on the document template**, not as a
 * storage key. That looks wasteful next to every other upload in this system,
 * and it is deliberate: payslips and appraisals are printed through the
 * browser's own print dialog, and a print job that has to fetch an image over
 * the network races the dialog. A signed URL makes it worse, because the
 * signature can expire between opening the page and pressing print, and the
 * document silently prints with a missing logo. Inlined bytes always render.
 *
 * The size cap is therefore tight: a letterhead logo has no business being
 * large, and the bytes travel with every template read.
 */

const MAX_LOGO_BYTES = 256 * 1024;

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const uploadSchema = z.object({
  /** `data:image/png;base64,…` straight from a file input. */
  dataUrl: z.string().min(32, "Berkas logo tidak valid"),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await parseBody(req, uploadSchema);

  // SVG is accepted and rendered to pixels (no script can survive); every logo is
  // stored as WebP at print resolution.
  const decoded = decodeDataUrl(body.dataUrl, ALLOWED);
  const { buffer, mime } = await optimizeImage(decoded.buffer, { maxSide: 1200 }).catch((error: Error) => { throw BadRequest(error.message); });

  if (buffer.byteLength > MAX_LOGO_BYTES) {
    throw BadRequest(
      `Ukuran logo ${(buffer.byteLength / 1024).toFixed(0)} KB melebihi batas ${
        MAX_LOGO_BYTES / 1024
      } KB. Perkecil gambarnya — logo kop dokumen tidak perlu beresolusi tinggi.`
    );
  }

  // Re-encode from the validated buffer rather than echoing what the client
  // sent, so nothing outside the decoded bytes can ride along.
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

  // A copy is also written to storage. Nothing reads it today; it exists so the
  // original is recoverable if a template is deleted by accident.
  const key = `branding/logo-${Date.now()}.webp`;
  await storageProvider.upload(buffer, key, mime).catch(() => null);

  void logActivity({
    userId: ctx.user.id,
    action: "UPLOAD_COMPANY_LOGO",
    module: "settings",
    after: { bytes: buffer.byteLength, mime, key },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { dataUrl, bytes: buffer.byteLength, mime },
    "Logo diunggah. Simpan template agar logo ikut tercetak."
  );
});
