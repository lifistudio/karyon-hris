"use client";

import React from "react";
import { Input, cn } from "@/components/ui";
import { INVENTORY_CATEGORY_LABELS, INVENTORY_CONDITION_LABELS } from "@/lib/hr/labels";
import { CHECK_RESULT_LABELS, type CheckItem, type CheckResult, type SpecValue } from "@/lib/inventory/templates";

export type Condition = "good" | "damaged" | "lost";

/** Built-in keys keep their Indonesian label; custom categories are stored as typed. */
export const categoryLabel = (key: string) => INVENTORY_CATEGORY_LABELS[key] ?? key;
export const conditionLabel = (c?: string | null) => (c ? INVENTORY_CONDITION_LABELS[c] ?? c : "-");
export const conditionTone = (c?: string | null) => (c === "good" ? "success" : c === "damaged" ? "warning" : "danger") as "success" | "warning" | "danger";

const resultTone: Record<CheckResult, string> = {
  ok: "bg-success-soft text-success",
  issue: "bg-danger-soft text-danger",
  na: "bg-background-tertiary-default text-muted",
};

/** A small segmented control: one choice of a few, all visible at once. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; tone?: string }>;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full gap-1 rounded-full bg-background-secondary-default p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "h-7 px-2.5 text-label" : "h-8 px-3 text-body-sm",
              active ? cn("shadow-xs", o.tone ?? "bg-background-primary-default text-heading") : "text-muted hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ConditionPicker({ value, onChange, allowLost = true, label = "Kondisi" }: { value: Condition; onChange: (c: Condition) => void; allowLost?: boolean; label?: string }) {
  const options: Array<{ value: Condition; label: string; tone: string }> = [
    { value: "good", label: "Baik", tone: resultTone.ok },
    { value: "damaged", label: "Rusak", tone: "bg-warning-soft text-warning" },
  ];
  if (allowLost) options.push({ value: "lost", label: "Hilang", tone: resultTone.issue });
  return <Segmented label={label} value={value} onChange={onChange} options={options} />;
}

/**
 * The per-category checklist. When `baseline` / `previous` are given, each row
 * shows what the item looked like at registration and at the last check, so the
 * checker compares instead of guessing.
 */
export function ChecklistEditor({
  items,
  onChange,
  baseline,
  previous,
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
  baseline?: CheckItem[] | null;
  previous?: CheckItem[] | null;
}) {
  if (!items.length) return <p className="text-body-sm text-muted">Kategori ini belum punya daftar periksa. Tambahkan di menu Kategori.</p>;
  const set = (i: number, patch: Partial<CheckItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <ul className="divide-y divide-line rounded-2xl bg-background-secondary-default">
      {items.map((item, i) => {
        const before = baseline?.find((b) => b.label === item.label);
        const last = previous?.find((b) => b.label === item.label);
        const changed = before && before.result !== item.result;
        return (
          <li key={item.label} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-body font-medium text-heading">{item.label}</p>
                {(before || last) && (
                  <p className="mt-0.5 text-label text-subtle">
                    {before && <>Awal: <span className={cn(changed && "font-semibold text-foreground")}>{CHECK_RESULT_LABELS[before.result]}</span>{before.note ? ` (${before.note})` : ""}</>}
                    {before && last && " · "}
                    {last && <>Terakhir: {CHECK_RESULT_LABELS[last.result]}{last.note ? ` (${last.note})` : ""}</>}
                  </p>
                )}
              </div>
              <Segmented
                size="sm"
                label={item.label}
                value={item.result}
                onChange={(result) => set(i, { result })}
                options={(["ok", "issue", "na"] as CheckResult[]).map((r) => ({ value: r, label: CHECK_RESULT_LABELS[r], tone: resultTone[r] }))}
              />
            </div>
            {(item.result === "issue" || item.note) && (
              <Input
                aria-label={`Catatan ${item.label}`}
                value={item.note ?? ""}
                maxLength={300}
                onChange={(e) => set(i, { note: e.target.value })}
                placeholder={item.result === "issue" ? "Jelaskan masalahnya, misalnya: layar retak di sudut kiri" : "Catatan (opsional)"}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Specification inputs generated from the category template. */
export function SpecFields({ labels, values, onChange }: { labels: string[]; values: SpecValue[]; onChange: (values: SpecValue[]) => void }) {
  // Values whose label is no longer in the template are kept, so switching the
  // category back and forth never loses what was typed.
  const all = [...labels, ...values.map((v) => v.label).filter((l) => !labels.includes(l))];
  if (!all.length) return <p className="text-body-sm text-muted">Kategori ini tidak memiliki kolom spesifikasi.</p>;
  const valueOf = (label: string) => values.find((v) => v.label === label)?.value ?? "";
  const set = (label: string, value: string) => {
    const rest = values.filter((v) => v.label !== label);
    onChange(all.flatMap((l) => (l === label ? (value ? [{ label, value }] : []) : rest.filter((r) => r.label === l))));
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {all.map((label) => (
        <label key={label} className="space-y-1.5">
          <span className="block text-body-sm font-medium text-foreground">{label}</span>
          <Input value={valueOf(label)} maxLength={200} onChange={(e) => set(label, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

/** Read-only specification grid. */
export function SpecList({ specs }: { specs?: SpecValue[] | null }) {
  if (!specs?.length) return <p className="text-body-sm text-muted">Spesifikasi belum diisi.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {specs.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="text-label text-subtle">{s.label}</dt>
          <dd className="break-words text-body text-heading">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Read-only checklist results as compact rows. */
export function ChecklistView({ items }: { items?: CheckItem[] | null }) {
  if (!items?.length) return <p className="text-body-sm text-muted">Tidak ada daftar periksa.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-start justify-between gap-3 text-body-sm">
          <span className="min-w-0 text-foreground">
            {it.label}
            {it.note && <span className="block text-label text-subtle">{it.note}</span>}
          </span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-label font-medium", resultTone[it.result])}>{CHECK_RESULT_LABELS[it.result]}</span>
        </li>
      ))}
    </ul>
  );
}
