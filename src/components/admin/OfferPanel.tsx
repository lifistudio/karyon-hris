"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, TicketPercent } from "@/components/icons";
import { ButtonLink, Card, CardBody } from "@/components/ui";
import type { Offer } from "@/lib/use-notices";

const until = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

/** Promotion strip from the license website; shown to Community and lapsed installations only. */
export function PromoStrip({ promo }: { promo: NonNullable<Offer["promo"]> }) {
  const [copied, setCopied] = useState(false);
  const ends = until(promo.endsAt);
  const copy = async () => {
    try { await navigator.clipboard.writeText(promo.code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the code stays visible */ }
  };
  return (
    <div role="note" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-primary/20 bg-primary-soft px-5 py-4 sm:flex-row sm:items-center">
      <TicketPercent className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-heading">{promo.title}</p>
        {(promo.text || ends) && <p className="text-body-sm text-muted">{promo.text}{promo.text && ends ? " · " : ""}{ends && `Berlaku sampai ${ends}`}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {promo.code && (
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-primary/40 bg-surface px-3 py-1.5 font-mono text-body-sm font-semibold text-primary cursor-pointer" aria-label={`Salin kode ${promo.code}`}>
            {promo.code}{copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
        <ButtonLink href={promo.url} target="_blank" rel="noopener noreferrer" size="sm" iconRight={ArrowUpRight}>{promo.ctaLabel}</ButtonLink>
      </div>
    </div>
  );
}

/** Why upgrade, in the owner's words, with a link to the current website address. */
export function UpgradeCard({ upgrade }: { upgrade: NonNullable<Offer["upgrade"]> }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-title font-semibold text-heading">{upgrade.title}</h2>
          {upgrade.text && <p className="text-body text-muted leading-relaxed">{upgrade.text}</p>}
          {upgrade.points.length > 0 && (
            <ul className="grid gap-1.5 pt-1 sm:grid-cols-2">
              {upgrade.points.map((point) => <li key={point} className="flex items-start gap-2 text-body-sm text-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />{point}</li>)}
            </ul>
          )}
        </div>
        <ButtonLink href={upgrade.url} target="_blank" rel="noopener noreferrer" className="shrink-0" iconRight={ArrowUpRight}>{upgrade.ctaLabel}</ButtonLink>
      </CardBody>
    </Card>
  );
}
