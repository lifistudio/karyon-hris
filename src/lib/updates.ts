import "server-only";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { HttpError } from "@/lib/guard";
import Setting from "@/models/Setting";

/**
 * Application updates, started from Lisensi & Paket.
 *
 * Three ways to replace the running image, chosen automatically:
 *  - installer manager (official installer: Docker on Linux/macOS/Windows/VPS):
 *    backs up the bundled database, pulls the version, restarts, checks health
 *    and switches back on failure;
 *  - Dokploy API (URL + API key + compose ID): pins HRIS_IMAGE to the version
 *    in the service environment, then redeploys; rollback pins the previous one;
 *  - deploy webhook (Dokploy/Coolify/Portainer/CapRover style URL): redeploys
 *    the configured tag, normally `latest`.
 * The database never needs a manual step: every start adds what the new version
 * is missing and keeps everything else, so the previous version still runs.
 */

export const CURRENT_VERSION = process.env.APP_VERSION || "dev";
export const OFFICIAL_IMAGE = "ghcr.io/lifistudio/hris";
const TARGET_KEY = "update_target";
const HISTORY_KEY = "update_history";
const IMAGE = /^[a-z0-9][a-z0-9._/-]{0,200}:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export interface Release { version: string; image: string; notes: string; publishedAt: string | null }

/** Numeric comparison of `1.4.0`-style versions; anything else counts as older (e.g. `dev`). */
export function compareVersions(a: string, b: string) {
  const parse = (v: string) => (/^\d+(\.\d+){0,3}/.exec(v)?.[0] ?? "").split(".").filter(Boolean).map(Number);
  const x = parse(a), y = parse(b);
  if (!x.length || !y.length) return x.length - y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}

let releaseCache: { at: number; value: Release | null } | null = null;
export async function latestRelease(force = false): Promise<Release | null> {
  if (!force && releaseCache && Date.now() - releaseCache.at < 30 * 60_000) return releaseCache.value;
  const server = process.env.HRIS_LICENSE_SERVER?.replace(/\/+$/, "");
  let value: Release | null = null;
  if (server && /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(server)) {
    try {
      const response = await fetch(`${server}/api/releases/latest`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
      const body = response.ok ? await response.json() as { data?: Partial<Release> } : null;
      const data = body?.data;
      if (data && typeof data.version === "string" && /^\d+\.\d+\.\d+/.test(data.version)) {
        const image = typeof data.image === "string" && IMAGE.test(data.image) && data.image.startsWith(`${OFFICIAL_IMAGE}:`) ? data.image : `${OFFICIAL_IMAGE}:${data.version}`;
        value = { version: data.version, image, notes: String(data.notes ?? "").slice(0, 2000), publishedAt: data.publishedAt ? String(data.publishedAt) : null };
      }
    } catch { value = null; }
  }
  releaseCache = { at: Date.now(), value };
  return value;
}

/* ---------- where updates are sent ---------- */

export const targetInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("dokploy"),
    url: z.string().trim().url().regex(/^https:\/\/[^\s/]+\/?$/, "Alamat Dokploy harus https://domain-dokploy (tanpa path)."),
    apiKey: z.string().trim().min(16, "API key Dokploy tidak valid.").max(500).optional(),
    composeId: z.string().trim().regex(/^[A-Za-z0-9_-]{4,64}$/, "Compose ID tidak valid."),
  }),
  z.object({
    mode: z.literal("webhook"),
    url: z.string().trim().url().regex(/^https:\/\/\S+$/, "URL webhook harus https://."),
  }),
]);
type Target = { mode: "dokploy"; url: string; apiKey: string; composeId: string } | { mode: "webhook"; url: string };

async function readSetting<T>(key: string): Promise<T | null> {
  await connectToDatabase();
  const row = await Setting.findOne({ key }).lean<{ value?: unknown } | null>();
  return (row?.value as T) ?? null;
}
async function writeSetting(key: string, value: unknown, description: string) {
  await connectToDatabase();
  await Setting.findOneAndUpdate({ key }, { value, description }, { upsert: true });
}

async function readTarget(): Promise<Target | null> {
  const stored = await readSetting<{ secret?: string }>(TARGET_KEY);
  if (!stored?.secret) return null;
  try { return JSON.parse(decrypt(stored.secret)) as Target; } catch { return null; }
}

/** What the page may show: never the API key or the full webhook URL. */
export async function targetSummary() {
  const target = await readTarget();
  if (!target) return null;
  return target.mode === "dokploy"
    ? { mode: "dokploy" as const, url: target.url, composeId: target.composeId, apiKeySet: true }
    : { mode: "webhook" as const, url: `${new URL(target.url).origin}/…` };
}

export async function saveTarget(raw: unknown) {
  const input = targetInput.parse(raw);
  let target: Target;
  if (input.mode === "dokploy") {
    const current = await readTarget();
    const apiKey = input.apiKey || (current?.mode === "dokploy" ? current.apiKey : "");
    if (!apiKey) throw new HttpError(400, "BAD_REQUEST", "Isi API key Dokploy.");
    target = { mode: "dokploy", url: input.url.replace(/\/+$/, ""), apiKey, composeId: input.composeId };
  } else target = { mode: "webhook", url: input.url };
  await writeSetting(TARGET_KEY, { secret: encrypt(JSON.stringify(target)) }, "Tujuan pembaruan aplikasi (terenkripsi).");
  return targetSummary();
}
export async function clearTarget() {
  await connectToDatabase();
  await Setting.deleteOne({ key: TARGET_KEY });
}

/* ---------- installer manager ---------- */

function managerConfig() {
  const raw = process.env.HRIS_MANAGER_URL, token = process.env.HRIS_MANAGER_TOKEN;
  if (!raw || !token || token.length < 32) return null;
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) return null;
  if (url.protocol === "http:" && !/^(manager|localhost|127\.0\.0\.1)$/.test(url.hostname)) return null;
  return { url: url.origin, token };
}

export type ManagerStatus = { available: boolean; supportsUpdate: boolean; stage: string; code?: string; previousImage?: string | null; backups?: Array<{ name: string; size: number; createdAt: string }> };
export async function managerStatus(): Promise<ManagerStatus> {
  const config = managerConfig();
  if (!config) return { available: false, supportsUpdate: false, stage: "unavailable" };
  try {
    const response = await fetch(`${config.url}/v1/status`, { headers: { authorization: `Bearer ${config.token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
    // An older manager answers only /v1/upgrade: it can run, but cannot update yet.
    if (response.status === 404) return { available: true, supportsUpdate: false, stage: "legacy" };
    if (!response.ok) return { available: false, supportsUpdate: false, stage: "unavailable" };
    const data = await response.json();
    return { available: true, supportsUpdate: true, stage: String(data.stage ?? "idle"), ...(data.code ? { code: String(data.code) } : {}), previousImage: data.previousImage ?? null, backups: Array.isArray(data.backups) ? data.backups.slice(0, 10) : [] };
  } catch { return { available: false, supportsUpdate: false, stage: "unavailable" }; }
}
async function managerPost(path: string, body: unknown) {
  const config = managerConfig();
  if (!config) throw new HttpError(409, "UPDATE_UNAVAILABLE", "Pengelola instalasi tidak tersedia.");
  const response = await fetch(`${config.url}${path}`, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(409, "UPDATE_FAILED", data.error === "busy" ? "Pembaruan lain sedang berjalan." : "Pengelola instalasi menolak permintaan. Periksa log pengelola (docker compose logs manager).");
  return data as { stage: string };
}

/* ---------- Dokploy API / webhook ---------- */

async function dokploy(target: Extract<Target, { mode: "dokploy" }>, path: string, init: RequestInit = {}) {
  const response = await fetch(`${target.url}/api/${path}`, { ...init, headers: { "x-api-key": target.apiKey, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new HttpError(502, "UPDATE_FAILED", response.status === 401 || response.status === 403 ? "Dokploy menolak API key. Buat API key baru di Dokploy (Settings → Profile → API/CLI) lalu simpan ulang." : `Dokploy menolak permintaan (HTTP ${response.status}). Periksa alamat Dokploy dan Compose ID.`);
  return response.json().catch(() => ({}));
}
/** Sets HRIS_IMAGE in the Dokploy service environment, keeping every other line, and redeploys. */
async function dokployDeploy(target: Extract<Target, { mode: "dokploy" }>, image: string) {
  const compose = await dokploy(target, `compose.one?composeId=${encodeURIComponent(target.composeId)}`) as { env?: string | null };
  const env = String(compose.env ?? "");
  const previous = /^HRIS_IMAGE=(.*)$/m.exec(env)?.[1]?.trim() || null;
  const next = /^HRIS_IMAGE=.*$/m.test(env) ? env.replace(/^HRIS_IMAGE=.*$/m, `HRIS_IMAGE=${image}`) : `${env.replace(/\s*$/, "")}\nHRIS_IMAGE=${image}\n`;
  await dokploy(target, "compose.update", { method: "POST", body: JSON.stringify({ composeId: target.composeId, env: next }) });
  await dokploy(target, "compose.deploy", { method: "POST", body: JSON.stringify({ composeId: target.composeId, title: `HRIS ${image.split(":").pop()}`, description: "Dimulai dari HRIS → Lisensi & Paket" }) });
  return previous;
}

/* ---------- what the page shows and does ---------- */

export async function updateOverview() {
  const [latest, manager, target, history] = await Promise.all([latestRelease(), managerStatus(), targetSummary(), readSetting<{ previousImage?: string; updatedAt?: string }>(HISTORY_KEY)]);
  const method = manager.supportsUpdate ? "manager" : target?.mode ?? (manager.available ? "legacy-manager" : "manual");
  return {
    current: CURRENT_VERSION,
    latest,
    updateAvailable: !!latest && compareVersions(latest.version, CURRENT_VERSION) > 0,
    method,
    manager,
    target,
    previousImage: manager.supportsUpdate ? manager.previousImage ?? null : history?.previousImage ?? null,
  };
}

export async function startUpdate(version?: string) {
  const latest = await latestRelease(true);
  const image = version ? `${OFFICIAL_IMAGE}:${version}` : latest?.image;
  if (!image || !IMAGE.test(image)) throw new HttpError(409, "UPDATE_UNAVAILABLE", "Versi terbaru belum dapat diperiksa. Pastikan HRIS_LICENSE_SERVER dapat dihubungi.");
  const manager = await managerStatus();
  if (manager.supportsUpdate) return { method: "manager", image, ...(await managerPost("/v1/update", { image })) };
  const target = await readTarget();
  if (target?.mode === "dokploy") {
    const previous = await dokployDeploy(target, image);
    await writeSetting(HISTORY_KEY, { previousImage: previous, updatedAt: new Date().toISOString() }, "Image sebelum pembaruan terakhir (untuk rollback).");
    return { method: "dokploy", image, stage: "deploying" };
  }
  if (target?.mode === "webhook") {
    const response = await fetch(target.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!response?.ok) throw new HttpError(502, "UPDATE_FAILED", "Webhook deploy tidak merespons dengan sukses. Periksa URL webhook di platform Anda.");
    return { method: "webhook", image, stage: "deploying" };
  }
  throw new HttpError(409, "UPDATE_UNAVAILABLE", manager.available
    ? "Pengelola instalasi masih versi lama. Jalankan installer resmi sekali lagi di folder instalasi, lalu tombol ini dapat dipakai."
    : "Hubungkan platform deploy dulu (Dokploy atau webhook deploy) di bagian Pembaruan aplikasi.");
}

export async function startRollback() {
  const manager = await managerStatus();
  if (manager.supportsUpdate) return { method: "manager", ...(await managerPost("/v1/rollback", {})) };
  const target = await readTarget();
  const history = await readSetting<{ previousImage?: string }>(HISTORY_KEY);
  if (target?.mode === "dokploy" && history?.previousImage && IMAGE.test(history.previousImage)) {
    const current = await dokployDeploy(target, history.previousImage);
    await writeSetting(HISTORY_KEY, { previousImage: current, updatedAt: new Date().toISOString() }, "Image sebelum pembaruan terakhir (untuk rollback).");
    return { method: "dokploy", image: history.previousImage, stage: "deploying" };
  }
  throw new HttpError(409, "ROLLBACK_UNAVAILABLE", "Belum ada versi sebelumnya yang tercatat untuk dikembalikan dari sini. Ganti HRIS_IMAGE ke versi sebelumnya di platform deploy Anda lalu deploy ulang.");
}
