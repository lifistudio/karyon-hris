import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, BadRequest } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import {
  SETTING_DEFS,
  SETTING_GROUPS,
  SETTING_MAP,
  coerceSetting,
  getSettings,
  invalidateSettingsCache,
} from "@/lib/settings";
import Setting from "@/models/Setting";
import { refreshTimezone } from "@/lib/timezone-server";

/**
 * Reads the effective configuration: stored rows merged over the declared
 * defaults, so the CMS form and every server rule see the same values even for
 * keys that were never saved.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const settings = await getSettings(true);

  // Only the CMS needs the field metadata; ordinary portal reads just want the
  // values. Keys marked internal never leave the server for a non-admin.
  const wantsSchema = new URL(req.url).searchParams.get("schema") === "1";
  const isAdmin = ["SUPERADMIN", "HRD"].includes(ctx.user.role);

  if (!wantsSchema || !isAdmin) {
    // Credentials-like values must not be handed to a portal user.
    const safe = { ...settings };
    delete safe.default_employee_password;
    return apiSuccess(safe, "Berhasil memuat pengaturan");
  }

  return apiSuccess(
    {
      values: settings,
      groups: SETTING_GROUPS,
      fields: SETTING_DEFS.filter((d) => !d.internal),
    },
    "Berhasil memuat pengaturan"
  );
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw BadRequest("Format data tidak valid.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw BadRequest("Format data pengaturan tidak valid.");
  }

  const entries = Object.entries(body as Record<string, unknown>);
  if (!entries.length) throw BadRequest("Tidak ada pengaturan yang dikirim.");

  // Only declared keys are writable — an arbitrary key could otherwise be
  // injected into the settings collection and read back elsewhere.
  const unknownKeys = entries.filter(([k]) => !SETTING_MAP[k]).map(([k]) => k);
  if (unknownKeys.length) {
    throw BadRequest(`Kunci pengaturan tidak dikenali: ${unknownKeys.join(", ")}.`);
  }

  const before = await getSettings(true);
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, rawValue] of entries) {
    const value = coerceSetting(key, rawValue);
    if (before[key] === value) continue;
    await Setting.findOneAndUpdate(
      { key },
      { value, description: SETTING_MAP[key].description },
      { upsert: true, new: true }
    );
    changed[key] = { from: before[key], to: value };
  }

  invalidateSettingsCache();
  if (changed.timezone_offset_minutes) await refreshTimezone(true);
  const after = await getSettings(true);

  if (Object.keys(changed).length) {
    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_SETTINGS",
      module: "settings",
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  return apiSuccess(
    after,
    Object.keys(changed).length
      ? `${Object.keys(changed).length} pengaturan diperbarui dan langsung berlaku.`
      : "Tidak ada perubahan yang perlu disimpan."
  );
});
