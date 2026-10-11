import "server-only";
import { fallbackOffer, parseOffer, safeUrl, type Offer, type OfferBanner } from "./offer-parse";

export type { Offer, OfferBanner };

/**
 * Upgrade, renewal and promotion copy shown on Lisensi & Paket, read from the
 * license website (`/api/hris/offer`) so the owner can change wording, links,
 * and promotions — or move the website to another domain — without an HRIS
 * release. Every field is validated here: the website is trusted for copy, but
 * links are checked in offer-parse.ts.
 */

function licenseServer(): string | null {
  const raw = process.env.HRIS_LICENSE_SERVER?.trim().replace(/\/+$/, "");
  return raw && safeUrl(raw) ? new URL(raw).origin : null;
}

let cache: { at: number; value: Offer | null; fresh: boolean } | null = null;
/** Cached for five minutes, matching the website's cache header; a fallback is retried after a minute. */
export async function currentOffer(): Promise<Offer | null> {
  if (cache && Date.now() - cache.at < (cache.fresh ? 5 * 60_000 : 60_000)) return cache.value;
  const server = licenseServer();
  let value: Offer | null = null, fresh = false;
  if (server) {
    try {
      const response = await fetch(`${server}/api/hris/offer`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
      const body = response.ok ? await response.json() as { data?: unknown } : null;
      fresh = !!body?.data;
      value = body?.data ? parseOffer(body.data, server) : fallbackOffer(server);
    } catch { value = fallbackOffer(server); }
  }
  cache = { at: Date.now(), value, fresh };
  return value;
}
