import { z } from "zod";
import type { SniffedKind } from "@/lib/storage/sniff";

/**
 * Attachments: a file someone uploaded, or a link they pasted.
 *
 * Every place in the product that takes a document — a CV, a medical letter, a
 * complaint's evidence — accepts either. Plenty of people keep their CV or
 * certificates in Google Drive and would rather share a link than download and
 * re-upload; plenty of others only have the file.
 *
 * This module has no server imports so forms can share the types and limits.
 */

/** What a form submits for one attachment. */
export type AttachmentInput =
  | { kind: "file"; token: string; name?: string; size?: number }
  | { kind: "link"; url: string };

/** What is stored once an upload has been claimed. */
export type StoredAttachment =
  | { kind: "file"; key: string; name: string; mime: string; size: number }
  | { kind: "link"; url: string };

/** Where an upload is going to be used; each has its own limits. */
export type UploadContext = "application" | "leave" | "correction" | "complaint" | "contract" | "document" | "inventory" | "task";

export interface UploadPolicy {
  kinds: SniffedKind[];
  maxBytes: number;
  /** Uploads per identity per hour. */
  hourlyLimit: number;
}

const DOCUMENTS: SniffedKind[] = ["pdf", "jpeg", "png", "webp", "docx"];
const EVIDENCE: SniffedKind[] = ["pdf", "jpeg", "png", "webp"];
const WORK_PROOF: SniffedKind[] = ["pdf", "jpeg", "png", "webp", "docx", "xlsx"];

export const UPLOAD_POLICY: Record<UploadContext, UploadPolicy> = {
  application: { kinds: DOCUMENTS, maxBytes: 8 * 1024 * 1024, hourlyLimit: 40 },
  leave: { kinds: EVIDENCE, maxBytes: 8 * 1024 * 1024, hourlyLimit: 30 },
  correction: { kinds: EVIDENCE, maxBytes: 8 * 1024 * 1024, hourlyLimit: 30 },
  complaint: { kinds: EVIDENCE, maxBytes: 8 * 1024 * 1024, hourlyLimit: 30 },
  /** Signed contract scans. */
  contract: { kinds: EVIDENCE, maxBytes: 15 * 1024 * 1024, hourlyLimit: 200 },
  /** Per-employee payslips and appraisals HR produced outside the system. */
  document: { kinds: ["pdf"], maxBytes: 15 * 1024 * 1024, hourlyLimit: 500 },
  /** Asset photos and receipts: a monthly round can touch many assets in one sitting. */
  inventory: { kinds: EVIDENCE, maxBytes: 8 * 1024 * 1024, hourlyLimit: 300 },
  /** Proof that a daily attendance task was done. */
  task: { kinds: WORK_PROOF, maxBytes: 15 * 1024 * 1024, hourlyLimit: 60 },
};

/** Browser `accept` attribute for a context — a hint only; the server decides. */
export const ACCEPT_ATTR: Record<UploadContext, string> = {
  application: ".pdf,.jpg,.jpeg,.png,.webp,.docx,application/pdf,image/*",
  leave: ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*",
  correction: ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*",
  complaint: ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*",
  contract: ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*",
  document: ".pdf,application/pdf",
  inventory: ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*",
  task: ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/*",
};

export const ACCEPT_LABEL: Record<UploadContext, string> = {
  application: "PDF, JPG, PNG, WebP, atau Word (DOCX)",
  leave: "PDF, JPG, PNG, atau WebP",
  correction: "PDF, JPG, PNG, atau WebP",
  complaint: "PDF, JPG, PNG, atau WebP",
  contract: "PDF atau foto hasil pindai",
  document: "PDF",
  inventory: "Foto (JPG, PNG, WebP) atau PDF",
  task: "Foto, PDF, Word, atau Excel",
};

/**
 * A link is only ever shown to staff as something to click, never fetched by
 * the server — fetching arbitrary URLs from inside the network is how internal
 * services get probed. So validation is about the scheme: http and https only,
 * which rules out `javascript:` and `data:` links that would run on click.
 */
export const httpUrl = z
  .string()
  .trim()
  .max(2000, "Tautan terlalu panjang")
  .refine((value) => {
    try {
      const u = new URL(value);
      return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, "Tautan harus diawali http:// atau https://");

export const attachmentInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    token: z.string().regex(/^[a-f0-9]{40}$/, "Berkas unggahan tidak valid"),
    name: z.string().max(255).optional(),
    size: z.number().optional(),
  }),
  z.object({ kind: z.literal("link"), url: httpUrl }),
]);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** A readable host for a link, so staff can see where it goes before clicking. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
