import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { requireUser } from "@/lib/guard";
import { currentOffer } from "@/lib/licensing/offer";
import { compareVersions, CURRENT_VERSION, latestRelease } from "@/lib/updates";

/**
 * Superadmin-only notices: the upgrade/renewal/promo copy from the license
 * website and whether a newer HRIS version is published. Cheap enough for the
 * header badge — both values are cached server-side.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  if (ctx.user.role !== "SUPERADMIN") {
    const response = apiSuccess({ offer: null, update: null });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const [offer, release] = await Promise.all([currentOffer(), latestRelease()]);
  const available = !!release && CURRENT_VERSION !== "dev" && compareVersions(release.version, CURRENT_VERSION) > 0;
  const response = apiSuccess({ offer, update: { current: CURRENT_VERSION, latest: release?.version ?? null, available } });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
