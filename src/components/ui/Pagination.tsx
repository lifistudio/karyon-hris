"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn, ICON_STROKE } from "./core";
import { Combobox } from "./Combobox";

/**
 * Page numbers to render, with gaps collapsed.
 *
 * Always shows the first and last page plus a window around the current one, so
 * the control stays a fixed width whether there are four pages or four hundred.
 */
function pageItems(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const items: Array<number | "gap"> = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);

  if (from > 2) items.push("gap");
  for (let p = from; p <= to; p++) items.push(p);
  if (to < total - 1) items.push("gap");

  items.push(total);
  return items;
}

/**
 * Pager for server-paginated tables.
 *
 * Reports the range in plain words as well as offering the controls, because
 * "231–255 dari 1.204" answers the question people actually have — how much is
 * there — which a row of page numbers does not.
 */
export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPage,
  onLimit,
  limitOptions = [25, 50, 100],
  className,
}: {
  page: number;
  totalPages: number;
  /** Total matching rows, for the range summary. */
  total?: number;
  limit?: number;
  onPage: (page: number) => void;
  onLimit?: (limit: number) => void;
  limitOptions?: number[];
  className?: string;
}) {
  if (totalPages <= 1 && !onLimit) return null;

  const safeTotal = Math.max(1, totalPages);
  const from = limit ? (page - 1) * limit + 1 : null;
  const to = limit && total !== undefined ? Math.min(total, page * limit) : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-4 mt-4 border-t border-line",
        className
      )}
    >
      <div className="flex items-center gap-4 text-body-sm text-muted">
        {total !== undefined && (
          <span className="tabular-nums">
            {total === 0
              ? "Tidak ada data"
              : from !== null && to !== null
                ? `${from.toLocaleString("id-ID")}–${to.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")}`
                : `${total.toLocaleString("id-ID")} data`}
          </span>
        )}

        {onLimit && limit !== undefined && (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">Baris</span>
            <Combobox
              size="sm"
              aria-label="Jumlah baris per halaman"
              className="w-20"
              value={String(limit)}
              onChange={(v) => onLimit(Number(v))}
              options={limitOptions.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </label>
        )}
      </div>

      {safeTotal > 1 && (
        <nav aria-label="Navigasi halaman" className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Halaman sebelumnya"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className={cn(
              "w-8 h-8 grid place-items-center rounded-[var(--radius-control)] text-muted transition-colors",
              "hover:bg-surface-2 hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
            )}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
          </button>

          {pageItems(page, safeTotal).map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} className="w-8 h-8 grid place-items-center text-subtle">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={`Halaman ${item}`}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPage(item)}
                className={cn(
                  "min-w-8 h-8 px-2 rounded-[var(--radius-control)] text-body-sm tabular-nums transition-colors",
                  item === page
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                {item}
              </button>
            )
          )}

          <button
            type="button"
            aria-label="Halaman berikutnya"
            disabled={page >= safeTotal}
            onClick={() => onPage(page + 1)}
            className={cn(
              "w-8 h-8 grid place-items-center rounded-[var(--radius-control)] text-muted transition-colors",
              "hover:bg-surface-2 hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
            )}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={ICON_STROKE} />
          </button>
        </nav>
      )}
    </div>
  );
}
