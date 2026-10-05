import { RecordId } from "@/lib/postgres";
import crypto from "crypto";
import database from "@/lib/postgres";
import { storageProvider, decodeDataUrl } from "@/lib/storage";
import { sniffFile, KIND_LABEL } from "@/lib/storage/sniff";
import { optimizeImage } from "@/lib/storage/image";
import { HttpError } from "@/lib/guard";
import PendingUpload from "@/models/PendingUpload";
import {
  UPLOAD_POLICY,
  formatBytes,
  type AttachmentInput,
  type StoredAttachment,
  type UploadContext,
} from "@/lib/attachments";

/** How long an unclaimed upload survives. Long enough to finish a form. */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

/** File names are shown back to staff; keep them printable and short. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "berkas";
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "").trim();
  return (cleaned || "berkas").slice(0, 160);
}

export async function createPendingUpload({
  file,
  context,
  ownerUserId,
  scope,
}: {
  file: File;
  context: UploadContext;
  ownerUserId?: string | null;
  scope?: string;
}) {
  const policy = UPLOAD_POLICY[context];

  if (file.size === 0) throw new HttpError(400, "BAD_REQUEST", "Berkas kosong.");
  if (file.size > policy.maxBytes) {
    throw new HttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Ukuran berkas ${formatBytes(file.size)} melebihi batas ${formatBytes(policy.maxBytes)}.`
    );
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let sniffed = sniffFile(buffer);
  if (!sniffed || !policy.kinds.includes(sniffed.kind)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_FILE",
      `Jenis berkas tidak didukung. Gunakan ${policy.kinds.map((k) => KIND_LABEL[k]).join(", ")}.`
    );
  }

  // Images are stored as WebP (smaller, metadata removed); documents unchanged.
  if (sniffed.kind === "jpeg" || sniffed.kind === "png" || sniffed.kind === "webp") {
    const image = await optimizeImage(buffer).catch(() => { throw new HttpError(415, "UNSUPPORTED_FILE", "Gambar tidak dapat dibaca. Simpan ulang sebagai JPG atau PNG lalu unggah kembali."); });
    buffer = image.buffer;
    sniffed = { ...sniffed, kind: "webp", mime: image.mime, ext: image.ext };
  }

  const token = crypto.randomBytes(20).toString("hex");
  // The stored name comes from the detected type, never from the client's
  // file name, so nothing can be written under an extension it is not.
  const day = new Date().toISOString().slice(0, 10);
  const key = await storageProvider.upload(buffer, `tmp/${day}/${token}${sniffed.ext}`, sniffed.mime);

  await PendingUpload.create({
    token,
    key,
    name: cleanName(file.name),
    mime: sniffed.mime,
    size: buffer.byteLength,
    context,
    ownerUserId: ownerUserId ? new RecordId(ownerUserId) : null,
    scope: scope ?? "",
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
  });

  return { token, name: cleanName(file.name), size: buffer.byteLength, mime: sniffed.mime, label: sniffed.label };
}

/**
 * Turns submitted attachments into stored ones.
 *
 * A file token must belong to the same context, the same user (or, for the
 * public career page, the same vacancy), be unexpired and unclaimed. The file
 * is then moved under `destination`, which is chosen by the server — so where a
 * file ends up, and therefore who may read it, never depends on the client.
 */
export async function claimAttachments(
  inputs: AttachmentInput[],
  {
    context,
    ownerUserId,
    scope,
    destination,
  }: { context: UploadContext; ownerUserId?: string | null; scope?: string; destination: string }
): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  const now = new Date();

  for (const input of inputs) {
    if (input.kind === "link") {
      out.push({ kind: "link", url: input.url.trim() });
      continue;
    }

    // Atomic claim: two submissions racing for one token cannot both win.
    const pending = await PendingUpload.findOneAndUpdate(
      {
        token: input.token,
        context,
        claimedAt: null,
        expiresAt: { $gt: now },
        ownerUserId: ownerUserId ? new RecordId(ownerUserId) : null,
        ...(scope !== undefined ? { scope } : {}),
      },
      { $set: { claimedAt: now } },
      { new: true }
    ).lean<{ key: string; name: string; mime: string; size: number } | null>();

    if (!pending) {
      throw new HttpError(
        400,
        "UPLOAD_EXPIRED",
        "Salah satu berkas sudah kedaluwarsa atau tidak valid. Unggah ulang berkas tersebut lalu kirim kembali."
      );
    }

    const ext = pending.key.slice(pending.key.lastIndexOf("."));
    const finalKey = `${destination.replace(/\/+$/, "")}/${crypto.randomBytes(8).toString("hex")}${ext}`;
    const { buffer } = await storageProvider.read(pending.key);
    const key = await storageProvider.upload(buffer, finalKey, pending.mime);
    await storageProvider.delete(pending.key).catch(() => {});

    out.push({ kind: "file", key, name: pending.name, mime: pending.mime, size: pending.size });
  }

  return out;
}

/** For reads: files become short-lived signed links; links pass through. */
export async function presentAttachment(att: StoredAttachment, seconds = 900) {
  if (att.kind === "link") return { ...att, href: att.url };
  return { ...att, href: await storageProvider.getSignedUrl(att.key, seconds) };
}

/**
 * Removes uploads nobody attached to a form before they expired — someone who
 * picked a CV and then closed the tab. Also clears claimed records, whose
 * files have already been moved. Run from the daily cron.
 */
export async function purgeExpiredUploads(limit = 2000) {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const stale = await PendingUpload.find({
    $or: [{ expiresAt: { $lt: new Date() }, claimedAt: null }, { claimedAt: { $lt: dayAgo } }],
  })
    .select("key claimedAt")
    .limit(limit)
    .lean<Array<{ _id: unknown; key: string; claimedAt?: Date | null }>>();

  let files = 0;
  for (const p of stale) {
    if (!p.claimedAt) {
      await storageProvider.delete(p.key).then(() => files++).catch(() => {});
    }
  }
  if (stale.length) await PendingUpload.deleteMany({ _id: { $in: stale.map((p) => p._id) } });
  return { records: stale.length, files };
}

/**
 * A stored single-attachment reference — a storage key or a pasted link — as
 * something a browser can open. Keys become short-lived signed links.
 */
export async function attachmentRefHref(ref: string | null | undefined, seconds = 900): Promise<string> {
  if (!ref) return "";
  if (/^https?:\/\//i.test(ref)) return ref;
  return storageProvider.getSignedUrl(ref, seconds);
}

/**
 * Resolves the one attachment a leave request, correction or complaint carries
 * into what is stored on it: a storage key for an uploaded file, the URL for a
 * pasted link. Older clients still send an inline data URL, which is accepted
 * as before.
 */
export async function resolveSingleAttachment({
  input,
  legacyDataUrl,
  context,
  ownerUserId,
  destination,
}: {
  input?: AttachmentInput | null;
  legacyDataUrl?: string;
  context: UploadContext;
  ownerUserId: string;
  destination: string;
}): Promise<string> {
  if (input) {
    const [stored] = await claimAttachments([input], { context, ownerUserId, destination });
    return stored ? (stored.kind === "file" ? stored.key : stored.url) : "";
  }
  if (legacyDataUrl) {
    const decoded = decodeDataUrl(legacyDataUrl, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    const { buffer, ext, mime } = decoded.mime === "application/pdf" ? decoded : await optimizeImage(decoded.buffer);
    return storageProvider.upload(buffer, `${destination.replace(/\/+$/, "")}/${Date.now()}${ext}`, mime);
  }
  return "";
}
