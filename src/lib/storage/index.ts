import type { StorageProvider } from "./StorageProvider";
import { LocalProvider } from "./LocalProvider";
import { looksLikeSvg } from "./image";

/**
 * Provider selection happens once, from a single env variable, so swapping
 * storage backends never touches application code. Cloudinary / Supabase / R2 /
 * MinIO / B2 adapters plug in here by implementing `StorageProvider`.
 */
const providerType = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

let instance: StorageProvider;

switch (providerType) {
  case "local":
    instance = new LocalProvider();
    break;
  default:
    // Fail loudly in production rather than silently writing to the wrong place.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `STORAGE_PROVIDER="${providerType}" belum memiliki adapter. Gunakan "local" atau tambahkan adapternya di src/lib/storage/.`
      );
    }
    console.warn(
      `[STORAGE] Provider "${providerType}" belum tersedia — memakai penyimpanan lokal.`
    );
    instance = new LocalProvider();
}

export const storageProvider = instance;
export { LocalProvider };
export type { StorageProvider };
export {
  toStorageKey,
  contentTypeForKey,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "./StorageProvider";

/**
 * Decodes a client-supplied data URL into a validated buffer.
 * Rejects anything that is not an allowed image/PDF or is over the size cap —
 * this is the only place raw base64 from the browser becomes a file.
 */
export function decodeDataUrl(
  dataUrl: string,
  allowed: string[] = ["image/jpeg", "image/png", "image/webp"]
): { buffer: Buffer; mime: string; ext: string } {
  if (dataUrl.length > Math.ceil(MAX_UPLOAD_BYTES_LOCAL / 3) * 4 + 128) {
    throw Object.assign(new Error("Ukuran berkas melebihi batas."), { name: "HttpError", status: 413, code: "PAYLOAD_TOO_LARGE" });
  }
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,([\s\S]+)$/.exec(dataUrl ?? "");
  if (!match) {
    throw Object.assign(new Error("Format berkas tidak dikenali."), {
      name: "HttpError",
      status: 400,
      code: "BAD_REQUEST",
    });
  }
  const [, mime, b64] = match;
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw Object.assign(new Error("Base64 berkas tidak valid."), { name: "HttpError", status: 400, code: "BAD_REQUEST" });
  }
  if (!allowed.includes(mime)) {
    throw Object.assign(
      new Error(`Tipe berkas ${mime} tidak diizinkan. Gunakan: ${allowed.join(", ")}.`),
      { name: "HttpError", status: 400, code: "BAD_REQUEST" }
    );
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.byteLength > MAX_UPLOAD_BYTES_LOCAL) {
    throw Object.assign(
      new Error(
        `Ukuran berkas ${(buffer.byteLength / 1048576).toFixed(1)} MB melebihi batas ${
          MAX_UPLOAD_BYTES_LOCAL / 1048576
        } MB.`
      ),
      { name: "HttpError", status: 400, code: "PAYLOAD_TOO_LARGE" }
    );
  }
  const extMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
  };
  const detected = sniffMime(buffer);
  if (detected !== mime) {
    throw Object.assign(
      new Error("Isi berkas tidak sesuai dengan tipe yang dinyatakan."),
      { name: "HttpError", status: 400, code: "INVALID_FILE_CONTENT" }
    );
  }
  return { buffer, mime, ext: extMap[mime] ?? ".bin" };
}

const MAX_UPLOAD_BYTES_LOCAL = 8 * 1024 * 1024;

function sniffMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  // Only reachable where a caller explicitly allows SVG; it is rasterised before storage.
  if (looksLikeSvg(buffer)) return "image/svg+xml";
  return null;
}
