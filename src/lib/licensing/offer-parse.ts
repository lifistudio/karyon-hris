/**
 * Validation for the upgrade/renewal/promo copy served by the license website.
 * The website is trusted for wording, but any link that is not plain https (or
 * http on loopback for development) is dropped. Pure so it can be unit tested.
 */

export interface Offer {
  website: string;
  upgrade: { title: string; text: string; ctaLabel: string; url: string; points: string[] } | null;
  renew: { ctaLabel: string; url: string };
  promo: { title: string; text: string; code: string; ctaLabel: string; url: string; endsAt: string | null } | null;
  banners: OfferBanner[];
}

export interface OfferBanner {
  id: string;
  kind: "text" | "image" | "video" | "motion";
  title: string;
  body: string;
  imageUrl: string;
  videoUrl: string;
  ctaLabel: string;
  url: string;
  placement: "dashboard" | "license" | "both";
  audience: "community" | "all";
}

const KINDS = ["text", "image", "video", "motion"] as const;
function parseBanner(raw: unknown): OfferBanner | null {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = KINDS.find((k) => k === b.kind);
  const id = str(b.id, 40).replace(/[^a-z0-9-]/g, "");
  if (!kind || !id) return null;
  const imageUrl = safeUrl(b.imageUrl), videoUrl = safeUrl(b.videoUrl);
  if (kind === "image" && !imageUrl) return null;
  if (kind === "video" && !/\.(mp4|webm)(\?|$)/i.test(videoUrl)) return null;
  return {
    id, kind, title: str(b.title, 80), body: str(b.body, 240), imageUrl, videoUrl,
    ctaLabel: str(b.ctaLabel, 40) || "Pelajari", url: safeUrl(b.url),
    placement: b.placement === "license" || b.placement === "both" ? b.placement : "dashboard",
    audience: b.audience === "all" ? "all" : "community",
  };
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password) return "";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return url.toString();
  } catch { /* not a URL */ }
  return "";
}

/** Fallback when the website is unreachable: links still point at the configured license server. */
export function fallbackOffer(server: string): Offer {
  return {
    website: server,
    upgrade: { title: "Buka fitur Pro tanpa instal ulang", text: "Kelola banyak cabang, cegah titip absen dengan pengenalan wajah, dan hubungkan HRIS ke sistem lain lewat API. Data dan akun tetap sama.", ctaLabel: "Lihat paket Pro", url: `${server}/pricing`, points: [] },
    renew: { ctaLabel: "Perpanjang lisensi", url: `${server}/dashboard/licenses` },
    promo: null,
    banners: [],
  };
}

export function parseOffer(raw: unknown, server: string): Offer {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = fallbackOffer(server);
  const up = data.upgrade as Record<string, unknown> | null | undefined;
  const renew = data.renew as Record<string, unknown> | undefined;
  const promo = data.promo as Record<string, unknown> | null | undefined;
  const upgradeUrl = safeUrl(up?.url);
  const promoUrl = safeUrl(promo?.url);
  return {
    website: safeUrl(data.website).replace(/\/$/, "") || server,
    upgrade: up === null ? null : up && upgradeUrl && str(up.title, 80)
      ? { title: str(up.title, 80), text: str(up.text, 300), ctaLabel: str(up.ctaLabel, 40) || base.upgrade!.ctaLabel, url: upgradeUrl, points: Array.isArray(up.points) ? up.points.map((point) => str(point, 80)).filter(Boolean).slice(0, 5) : [] }
      : base.upgrade,
    renew: { ctaLabel: str(renew?.ctaLabel, 40) || base.renew.ctaLabel, url: safeUrl(renew?.url) || base.renew.url },
    promo: promo && promoUrl && str(promo.title, 80)
      ? { title: str(promo.title, 80), text: str(promo.text, 240), code: str(promo.code, 40).replace(/[^A-Za-z0-9_-]/g, ""), ctaLabel: str(promo.ctaLabel, 40) || "Pakai promo", url: promoUrl, endsAt: str(promo.endsAt, 40) || null }
      : null,
    banners: Array.isArray(data.banners) ? data.banners.map(parseBanner).filter((b): b is OfferBanner => !!b).slice(0, 10) : [],
  };
}
