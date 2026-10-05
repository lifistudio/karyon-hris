import crypto from "crypto";

/**
 * At-rest encryption for the fields the spec calls sensitive: NIK, NPWP, and
 * bank account numbers.
 *
 * Format: `v2:<iv>:<authTag>:<ciphertext>` using AES-256-GCM. GCM is
 * authenticated, so a tampered ciphertext fails loudly instead of decrypting to
 * garbage — the old AES-256-CBC format had no integrity protection at all.
 * Legacy `<iv>:<ciphertext>` CBC values written before this change are still
 * readable so existing records keep working; anything re-saved is upgraded.
 */

const GCM = "aes-256-gcm";
const LEGACY_CBC = "aes-256-cbc";
const PREFIX = "v2";

function resolveSecret(): string {
  const secret =
    process.env.ENCRYPTION_KEY ||
    (process.env.NODE_ENV !== "production"
      ? process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
      : undefined);
  if (!secret) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "ENCRYPTION_KEY khusus wajib diset di produksi. Jangan gunakan secret sesi untuk enkripsi data."
        : "ENCRYPTION_KEY (atau secret auth untuk development) belum diset. Data sensitif tidak dapat dienkripsi."
    );
  }
  return secret;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = crypto.createHash("sha256").update(resolveSecret()).digest();
  return cachedKey;
}

export function encrypt(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(12); // 96-bit nonce, the size GCM is defined for
  const cipher = crypto.createCipheriv(GCM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decrypt(value: string): string {
  if (!value || typeof value !== "string" || !value.includes(":")) return value;

  const parts = value.split(":");

  try {
    if (parts[0] === PREFIX && !/^v2:[0-9a-f]{24}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/.test(value)) {
      throw new Error("Invalid encrypted envelope");
    }
    if (parts[0] === PREFIX && parts.length === 4) {
      const [, ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(GCM, key(), Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
      ]).toString("utf8");
    }

    // Legacy CBC payload written by the previous implementation.
    if (/^[0-9a-f]{32}:(?:[0-9a-f]{32})+$/.test(value)) {
      const [ivHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(LEGACY_CBC, key(), Buffer.from(ivHex, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
      ]).toString("utf8");
    }
  } catch {
    // An authenticated envelope that cannot be opened is corruption or a key
    // mismatch. Never return ciphertext to an API response as if it were data.
    throw new Error("Data terenkripsi tidak dapat dibuka. Periksa kunci enkripsi dan integritas data.");
  }

  return value;
}

/**
 * For screens that show a record to fix it: a value that cannot be opened comes
 * back empty and `onUnreadable` is called, so one damaged field (or a key mismatch)
 * does not hide the whole record. Re-entering the value encrypts it again.
 */
export function decryptOrEmpty(value: string, onUnreadable?: () => void): string {
  try { return decrypt(value); } catch { warnUnreadableOnce(); onUnreadable?.(); return ""; }
}

let warnedUnreadable = false;
/** One log line per process: the usual cause is a deployment started with a different ENCRYPTION_KEY. */
function warnUnreadableOnce() {
  if (warnedUnreadable) return;
  warnedUnreadable = true;
  console.warn("[CRYPTO] Data terenkripsi tidak dapat dibuka. Pastikan ENCRYPTION_KEY sama dengan kunci saat data dibuat (mis. .env instalasi lama).");
}

/** True for an encrypted value this server cannot open (damaged, or another ENCRYPTION_KEY). */
export function isUnreadable(value: string): boolean {
  try { decrypt(value); return false; } catch { return true; }
}

/** True when the value already carries an encrypted envelope. */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && (value.startsWith(`${PREFIX}:`) || /^[0-9a-f]{32}:[0-9a-f]+$/.test(value));
}

/** Encrypts only if not already encrypted — safe to call on every save. */
export function encryptOnce(value: string): string {
  if (!value) return value;
  return isEncrypted(value) ? value : encrypt(value);
}

/**
 * Renders a sensitive value for users who may see that it exists but not what
 * it is, e.g. `••••••7788` for a bank account in a list view.
 */
export function maskTail(value: string, visible = 4): string {
  if (!value) return "-";
  // A masked list never needs the plain value: one unreadable record (key
  // mismatch, damaged row) shows as fully masked instead of failing the whole list.
  let plain: string;
  try { plain = decrypt(value); } catch { return "••••••"; }
  if (plain.length <= visible) return "•".repeat(plain.length);
  return "•".repeat(Math.min(plain.length - visible, 8)) + plain.slice(-visible);
}

/** Constant-time string compare for tokens and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** URL-safe random token for reset links and API keys. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Numeric OTP code of the given length. */
export function randomOtp(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

/** SHA-256 hash, used to store OTPs and reset tokens without keeping plaintext. */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
