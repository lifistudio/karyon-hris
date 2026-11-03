export interface StorageProvider {
  /**
   * Persists a file and returns its **storage key** — a provider-independent
   * relative path such as `attendances/<employeeId>/2026-07-07-clock_in.jpg`.
   *
   * The key is what gets written to MongoDB. It is intentionally *not* a URL:
   * URLs are minted on read via `getUrl`/`getSignedUrl`, so swapping
   * STORAGE_PROVIDER never invalidates stored records.
   */
  upload(file: Buffer | Blob, key: string, mimeType?: string): Promise<string>;

  /** A URL for a non-sensitive asset (still access-controlled for local disk). */
  getUrl(key: string): string;

  /**
   * A short-lived signed URL for sensitive files (KTP, NPWP, slip gaji, foto
   * presensi). Never expose a permanent public URL for these.
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  delete(key: string): Promise<void>;

  /** Reads a file back — used by the authenticated download route. */
  read(key: string): Promise<{ buffer: Buffer; contentType: string }>;
}

/**
 * Normalises anything we might find in the database into a storage key.
 *
 * Records written before files were moved out of `public/` hold values like
 * `/uploads/payrolls/<id>/2026-07.html`; new records hold the bare key. Both
 * must resolve to the same file.
 */
export function toStorageKey(value: string): string {
  if (!value) return "";
  let key = value.trim();
  try {
    // Tolerate a full URL or an already-signed link being passed back in.
    if (key.startsWith("http://") || key.startsWith("https://")) {
      key = new URL(key).pathname;
    } else if (key.startsWith("/api/v1/storage/")) {
      const qs = key.split("?")[1] ?? "";
      const p = new URLSearchParams(qs).get("key") ?? new URLSearchParams(qs).get("path");
      if (p) key = p;
    }
  } catch {
    /* fall through to prefix stripping */
  }
  key = key.replace(/^\/+/, "");
  if (key.startsWith("uploads/")) key = key.slice("uploads/".length);
  return key;
}

/**
 * Access rules match on the key's first folder, so one file must have exactly
 * one spelling. `./faces/x` reaches the same file as `faces/x` but matches none
 * of those rules; every such variant is refused before they run.
 */
export function isCanonicalKey(key: string): boolean {
  if (!key || key.includes("\\")) return false;
  return key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_BY_EXT[key.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/** Upload types we accept, mapped to the extension we will store them under. */
export const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
