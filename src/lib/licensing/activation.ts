import "server-only";
import { randomBytes } from "node:crypto";
import { connectToDatabase } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import Setting from "@/models/Setting";

/**
 * In-app license activation: the HRIS server talks to the license website
 * directly, no agent needed. State (installation id, activation secret, signed
 * lease) is stored encrypted with ENCRYPTION_KEY in one settings row that the
 * generic settings API never exposes.
 *
 * Community stores the activation so the upgrade command can be issued; only
 * the Pro build turns the signed lease into enabled features.
 *
 * Lifecycle: activate (any key, any time) → renew every few minutes → on
 * expiry/suspension the lease is cleared and the app runs as Community while
 * still retrying, so paying on the website re-enables Pro automatically. A new
 * key can replace the current one at any time; the license website releases the
 * previous key so it can be used elsewhere.
 */

export const ACTIVATION_SETTING_KEY = "license_activation";

export type LicenseState = "active" | "expired" | "suspended" | "released";

interface ActivationState {
  installationId: string;
  /** Empty after "Lepas lisensi"; the installation id is kept for the next activation. */
  activationSecret: string;
  lease: string;
  siteOrigin: string;
  updatedAt: string;
  keyHint?: string;
  subscriptionExpiresAt?: string;
  licenseState?: LicenseState;
  lastError?: string;
}

export class LicenseServerError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
}

/** The license website; HTTPS only, plain HTTP only on loopback for development. */
export function licenseServer(): string {
  const raw = process.env.HRIS_LICENSE_SERVER?.trim();
  if (!raw) throw new LicenseServerError("Alamat server lisensi (HRIS_LICENSE_SERVER) belum diisi pada instalasi ini.");
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new LicenseServerError("HRIS_LICENSE_SERVER wajib HTTPS.");
  return url.origin;
}

export function siteOrigin(): string {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) throw new LicenseServerError("NEXTAUTH_URL belum diisi; lisensi terikat pada alamat website HRIS.");
  return new URL(raw).origin;
}

export async function readActivation(): Promise<ActivationState | null> {
  await connectToDatabase();
  const row = await Setting.findOne({ key: ACTIVATION_SETTING_KEY }).lean<{ value?: unknown } | null>();
  if (typeof row?.value !== "string" || !row.value) return null;
  try { return JSON.parse(decrypt(row.value)) as ActivationState; } catch { return null; }
}

async function writeActivation(state: ActivationState) {
  await connectToDatabase();
  await Setting.findOneAndUpdate(
    { key: ACTIVATION_SETTING_KEY },
    { $set: { value: encrypt(JSON.stringify(state)), description: "Aktivasi lisensi Pro (terenkripsi)" } },
    { upsert: true }
  );
}

async function call<T>(path: string, body: unknown, notFound = "Server lisensi tidak mengenali instalasi ini. Aktifkan ulang license key."): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${licenseServer()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof LicenseServerError) throw error;
    throw new LicenseServerError("Server lisensi tidak dapat dihubungi. Periksa koneksi internet server HRIS.");
  }
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: string; code?: string };
  const code = typeof json.code === "string" ? json.code : undefined;
  if (response.status === 404 && !code) throw new LicenseServerError(notFound, 404);
  if (!response.ok) throw new LicenseServerError(typeof json.error === "string" ? json.error : `Server lisensi menolak permintaan (${response.status}).`, response.status, code);
  return json.data as T;
}

type LeaseResponse = { lease: string; keyHint?: string; expiresAt?: string };
const stateFromCode = (code?: string): LicenseState | null =>
  code === "LICENSE_EXPIRED" ? "expired" : code === "LICENSE_SUSPENDED" ? "suspended" : code === "LICENSE_RELEASED" ? "released" : null;

/**
 * Activates a license key for this installation and origin. Works for a first
 * activation, re-activation of the same key, and replacing the current key with
 * a different one (the website then releases the previous license).
 */
export async function activateLicense(licenseKey: string) {
  const current = await readActivation();
  const settings = await getSettings();
  const installationId = current?.installationId ?? `inst${randomBytes(16).toString("hex")}`;
  const origin = siteOrigin();
  const data = await call<{ activationSecret: string } & LeaseResponse>("/api/licenses/activate", {
    licenseKey,
    installationId,
    instanceName: String(settings.company_name ?? "HRIS").slice(0, 120) || "HRIS",
    siteOrigin: origin,
    ...(current?.activationSecret ? { activationSecret: current.activationSecret } : {}),
  }, "License key tidak dikenal. Salin ulang dari dashboard pelanggan di website lisensi.");
  await writeActivation({
    installationId,
    activationSecret: data.activationSecret,
    lease: data.lease,
    siteOrigin: origin,
    updatedAt: new Date().toISOString(),
    keyHint: data.keyHint ?? licenseKey.slice(-8),
    subscriptionExpiresAt: data.expiresAt,
    licenseState: "active",
  });
}

let renewing: Promise<void> | null = null;
/** Fetches a fresh lease; concurrent callers share one request. */
export function renewLease(): Promise<void> {
  if (!renewing) {
    renewing = (async () => {
      const current = await readActivation();
      if (!current?.activationSecret) return;
      let data: LeaseResponse;
      try {
        data = await call<LeaseResponse>("/api/licenses/lease", { installationId: current.installationId, activationSecret: current.activationSecret, siteOrigin: siteOrigin() });
      } catch (error) {
        // A definitive answer (expired, suspended, released, bound elsewhere) clears
        // the lease so the app drops to Community now, not at the end of the grace.
        // A bare 404 (e.g. a mistyped HRIS_LICENSE_SERVER) is not definitive; coded answers are.
        if (error instanceof LicenseServerError && (error.status === 403 || !!stateFromCode(error.code) || error.code === "LICENSE_BOUND")) {
          await writeActivation({ ...current, lease: "", updatedAt: new Date().toISOString(), licenseState: stateFromCode(error.code) ?? "expired", lastError: error.message });
        }
        throw error;
      }
      await writeActivation({ ...current, lease: data.lease, updatedAt: new Date().toISOString(), keyHint: data.keyHint ?? current.keyHint, subscriptionExpiresAt: data.expiresAt ?? current.subscriptionExpiresAt, licenseState: "active", lastError: undefined });
    })().finally(() => { renewing = null; });
  }
  return renewing;
}

/**
 * "Lepas lisensi": frees the key on the license website so it can be activated
 * on another server, and returns this installation to Community. The local
 * release happens even when the website is unreachable; the website side can
 * then be released from the customer dashboard.
 */
export async function deactivateLicense(): Promise<{ remoteReleased: boolean }> {
  const current = await readActivation();
  if (!current?.activationSecret) return { remoteReleased: false };
  let remoteReleased = false;
  try {
    const data = await call<{ released: boolean }>("/api/licenses/deactivate", { installationId: current.installationId, activationSecret: current.activationSecret, siteOrigin: siteOrigin() });
    remoteReleased = !!data?.released;
  } catch (error) {
    if (!(error instanceof LicenseServerError)) throw error;
  }
  await writeActivation({ installationId: current.installationId, activationSecret: "", lease: "", siteOrigin: current.siteOrigin, updatedAt: new Date().toISOString(), keyHint: current.keyHint, licenseState: "released" });
  return { remoteReleased };
}

/** Unverified view of the stored lease for display only; the Pro build verifies the signature. */
export async function activationSummary() {
  const current = await readActivation();
  if (!current?.activationSecret) {
    return { activated: false as const, licenseState: current?.licenseState ?? null, keyHint: current?.keyHint ?? null };
  }
  let claims: { plan?: string; features?: string[]; exp?: number; graceUntil?: number } = {};
  try { claims = JSON.parse(Buffer.from(current.lease.split(".")[1] ?? "", "base64url").toString("utf8")); } catch { /* malformed or cleared lease shows as unknown */ }
  return {
    activated: true as const,
    installationId: current.installationId,
    siteOrigin: current.siteOrigin,
    plan: claims.plan ?? null,
    features: Array.isArray(claims.features) ? claims.features : [],
    leaseExpiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    graceUntil: claims.graceUntil ? new Date(claims.graceUntil * 1000).toISOString() : null,
    subscriptionExpiresAt: current.subscriptionExpiresAt ?? null,
    keyHint: current.keyHint ?? null,
    licenseState: current.licenseState ?? (current.lease ? "active" : "expired"),
    lastError: current.lastError ?? null,
    updatedAt: current.updatedAt,
  };
}
