"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Bot, Check, MapPin, ScanFace, X } from "@/components/icons";
import { ButtonLink, cn } from "@/components/ui";
import { useNotices, type OfferBanner } from "@/lib/use-notices";
import { useLicense } from "@/lib/use-license";

/**
 * Banners from the license website (CMS → Penawaran di HRIS), for the
 * superadmin only. Community and lapsed installations see every banner; an
 * active Pro installation sees only banners meant for everyone. Each banner
 * can be dismissed for a week.
 */

const DISMISS_KEY = (id: string) => `karyon-banner-dismissed:${id}`;
const WEEK = 7 * 86_400_000;

function isDismissed(id: string) {
  try { const at = Number(localStorage.getItem(DISMISS_KEY(id)) ?? 0); return at > 0 && Date.now() - at < WEEK; } catch { return false; }
}

function rememberDismissal(id: string) {
  try { localStorage.setItem(DISMISS_KEY(id), String(Date.now())); } catch { /* storage blocked: hide for this view only */ }
}

export function HrisBanners({ placement, enabled }: { placement: "dashboard" | "license"; enabled: boolean }) {
  const notices = useNotices(enabled);
  const { license } = useLicense();
  // Dismissals live in this browser; read once after mount (null until then, so SSR renders nothing).
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const ids = notices?.offer?.banners.map((b) => b.id).join(",") ?? "";
  useEffect(() => { queueMicrotask(() => setHidden(new Set(ids.split(",").filter((id) => id && isDismissed(id))))); }, [ids]);
  if (!enabled || !hidden || !notices?.offer) return null;
  const proRunning = license?.edition === "pro" && ["active", "grace"].includes(license.status);
  const banners = notices.offer.banners.filter((b) => (b.placement === placement || b.placement === "both") && (b.audience === "all" || !proRunning) && !hidden.has(b.id));
  if (!banners.length) return null;
  const dismiss = (id: string) => {
    rememberDismissal(id);
    setHidden((current) => new Set(current ?? []).add(id));
  };
  return <div className="space-y-4">{banners.slice(0, 2).map((banner) => <Banner key={banner.id} banner={banner} onDismiss={() => dismiss(banner.id)} />)}</div>;
}

function Banner({ banner, onDismiss }: { banner: OfferBanner; onDismiss: () => void }) {
  const close = (
    <button type="button" onClick={onDismiss} aria-label="Sembunyikan banner selama 7 hari" className="absolute end-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-surface/80 text-subtle backdrop-blur hover:text-heading cursor-pointer">
      <X className="size-4" aria-hidden />
    </button>
  );
  const cta = banner.url && <ButtonLink href={banner.url} target="_blank" rel="noopener noreferrer" size="sm" iconRight={ArrowUpRight}>{banner.ctaLabel}</ButtonLink>;

  if (banner.kind === "image") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-2">
        {close}
        <a href={banner.url || undefined} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[18px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- banner served by the license website */}
          <img src={banner.imageUrl} alt={banner.title || "Promo Karyon"} className="block h-auto w-full" loading="lazy" />
        </a>
      </div>
    );
  }
  if (banner.kind === "video") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-2">
        {close}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
          <video src={banner.videoUrl} className="w-full rounded-[18px] bg-surface-2" autoPlay muted loop playsInline preload="metadata" aria-label={banner.title || "Video promo Karyon"} />
          <div className="space-y-2 p-3">
            {banner.title && <p className="text-title-sm font-semibold text-heading">{banner.title}</p>}
            {banner.body && <p className="text-body text-muted">{banner.body}</p>}
            <div className="pt-1">{cta}</div>
          </div>
        </div>
      </div>
    );
  }
  if (banner.kind === "text") {
    return (
      <div className="relative flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 pe-12 sm:flex-row sm:items-center">
        {close}
        <div className="min-w-0 flex-1">
          <p className="text-body-lg font-semibold text-heading">{banner.title}</p>
          {banner.body && <p className="mt-0.5 text-body text-muted">{banner.body}</p>}
        </div>
        {cta}
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-2">
      {close}
      <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3 p-4 md:p-6">
          <p className="text-title font-semibold tracking-[-0.02em] text-heading">{banner.title}</p>
          {banner.body && <p className="text-body text-muted leading-relaxed">{banner.body}</p>}
          <div className="pt-1">{cta}</div>
        </div>
        <UpgradeMotion />
      </div>
    </div>
  );
}

const SCENES = ["face", "branches", "ai"] as const;

/** Built-in motion for the upgrade banner: three Pro features, one after another. */
export function UpgradeMotion({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % SCENES.length), 3200);
    return () => clearInterval(timer);
  }, [reduce]);
  const scene = SCENES[index];
  return (
    <div className={cn("relative h-52 overflow-hidden rounded-[18px] bg-surface-2", className)} aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_0%,color-mix(in_srgb,var(--color-accent-200)_60%,transparent),transparent_70%)] dark:opacity-40" />
      <AnimatePresence mode="wait">
        <motion.div key={scene} className="absolute inset-0 grid place-items-center p-5"
          initial={{ opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
          {scene === "face" && (
            <div className="flex items-center gap-4 rounded-2xl bg-background-inner-default px-5 py-4 shadow-card">
              <span className="relative grid size-16 place-items-center rounded-full bg-primary-soft"><ScanFace className="size-8 text-primary" /><span className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full bg-[var(--color-chart-7-active)] text-white"><Check className="size-3.5" /></span></span>
              <div><p className="text-body font-semibold text-heading">Wajah cocok · 98%</p><p className="text-body-sm text-muted">Anti-spoof lolos · Kantor Bandung</p></div>
            </div>
          )}
          {scene === "branches" && (
            <div className="w-full max-w-xs space-y-2.5 rounded-2xl bg-background-inner-default p-4 shadow-card">
              {[["Jakarta", 96, 6], ["Bandung", 93, 1], ["Surabaya", 89, 5]].map(([name, rate, tone], i) => (
                <div key={String(name)}>
                  <div className="flex justify-between text-label"><span className="flex items-center gap-1 text-heading"><MapPin className="size-3.5 text-subtle" />{name}</span><span className="tabular-nums text-muted">{rate}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-chart-track)]"><motion.div className="h-full rounded-full" style={{ background: `var(--color-chart-${tone}-active)` }} initial={{ width: 0 }} animate={{ width: `${rate}%` }} transition={{ duration: 0.9, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }} /></div>
                </div>
              ))}
            </div>
          )}
          {scene === "ai" && (
            <div className="w-full max-w-xs space-y-2">
              <p className="ms-auto w-fit max-w-full rounded-2xl rounded-br-md bg-primary px-3 py-2 text-body-sm font-medium text-primary-foreground">Siapa yang belum absen hari ini?</p>
              <p className="flex items-center gap-2 rounded-2xl bg-background-inner-default px-3 py-2 text-body-sm text-heading shadow-card"><Bot className="size-4 shrink-0 text-primary" />3 orang di cabang Bandung, 1 sedang cuti.</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
        {SCENES.map((s, i) => <span key={s} className={cn("h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-primary" : "w-1.5 bg-line-strong")} />)}
      </div>
    </div>
  );
}
