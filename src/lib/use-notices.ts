"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export type Offer = {
  website: string;
  upgrade: { title: string; text: string; ctaLabel: string; url: string; points: string[] } | null;
  renew: { ctaLabel: string; url: string };
  promo: { title: string; text: string; code: string; ctaLabel: string; url: string; endsAt: string | null } | null;
  banners: OfferBanner[];
};
export type OfferBanner = { id: string; kind: "text" | "image" | "video" | "motion"; title: string; body: string; imageUrl: string; videoUrl: string; ctaLabel: string; url: string; placement: "dashboard" | "license" | "both"; audience: "community" | "all" };
export type Notices = { offer: Offer | null; update: { current: string; latest: string | null; available: boolean } | null };

// One request per page load, shared by the header chip and Lisensi & Paket.
let pending: Promise<Notices> | null = null;
let loadedAt = 0;

function load(): Promise<Notices> {
  if (!pending || Date.now() - loadedAt > 10 * 60_000) {
    loadedAt = Date.now();
    pending = api.get<Notices>("/api/v1/license/offer", { cache: "no-store" })
      .then((res) => res.data ?? { offer: null, update: null })
      .catch(() => { pending = null; return { offer: null, update: null }; });
  }
  return pending;
}

/** Superadmin notices (upgrade offer, promo, new version); empty for everyone else. */
export function useNotices(enabled: boolean) {
  const [notices, setNotices] = useState<Notices | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void load().then((value) => { if (active) setNotices(value); });
    return () => { active = false; };
  }, [enabled]);
  return notices;
}
