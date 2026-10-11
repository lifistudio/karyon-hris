"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "@/components/icons";
import { cn, ICON_STROKE } from "./core";
import { FloatingPanel, useFloatingPlacement } from "./Floating";

/* ------------------------------------------------------------------ */
/* Calendar maths                                                      */
/* ------------------------------------------------------------------ */

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Monday-first, matching how Indonesian calendars are printed. */
const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/**
 * All dates are handled as plain `YYYY-MM-DD` strings, never as `Date`.
 *
 * A `Date` carries a time and a timezone, and the moment one is created from a
 * date-only value the browser's offset can shift it a day either way — the
 * classic "birthday is one day early" bug. The calendar only ever does integer
 * arithmetic on year/month/day, so there is nothing to shift.
 */
function parseKey(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Weekday index with Monday as 0, for the grid offset. */
function mondayIndex(y: number, m: number, d: number) {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Today in WIB, so "hari ini" matches the rest of the system. */
function todayKeyWib(): string {
  const now = new Date(Date.now() + 7 * 3_600_000);
  return toKey(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

function formatLong(key: string): string {
  const p = parseKey(key);
  if (!p) return "";
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const triggerClass = (open: boolean) =>
  cn(
    "w-full h-10 rounded-[var(--radius-control)] bg-[var(--field-bg)] border border-transparent px-3",
    "flex items-center gap-2 text-left text-body transition-colors",
    "hover:bg-[var(--field-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
    "disabled:opacity-55 disabled:cursor-not-allowed",
    open && "bg-surface border-line ring-2 ring-[var(--ring)]"
  );

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-9 h-9 grid place-items-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}

/** Closes a floating panel on a press that is neither on the trigger nor in it. */
function useDismiss(
  open: boolean,
  refs: Array<React.RefObject<HTMLElement | null>>,
  onDismiss: () => void
) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      dismissRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
    // The refs are stable objects created once per component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * Month and year grids shared by both pickers.
 *
 * Tapping a grid replaces the two tiny `<select>`s the calendar used to have: a
 * dropdown nested inside a dropdown, fiddly on a phone, and closed by any click
 * that landed in its own list because that list lived outside the calendar.
 */
function MonthGrid({ year, selected, onPick }: { year: number; selected?: number; onPick: (m: number) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {MONTHS.map((name, i) => (
        <button
          key={name}
          type="button"
          onClick={() => onPick(i + 1)}
          aria-label={`${name} ${year}`}
          className={cn(
            "h-11 rounded-[var(--radius-control)] text-body-sm transition-colors",
            "hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
            selected === i + 1 ? "bg-primary text-primary-foreground font-semibold hover:bg-primary" : "text-foreground"
          )}
        >
          {name.slice(0, 3)}
        </button>
      ))}
    </div>
  );
}

function YearGrid({ start, selected, onPick }: { start: number; selected?: number; onPick: (y: number) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {Array.from({ length: 16 }, (_, i) => start + i).map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => onPick(y)}
          className={cn(
            "h-11 rounded-[var(--radius-control)] text-body-sm tabular-nums transition-colors",
            "hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
            selected === y ? "bg-primary text-primary-foreground font-semibold hover:bg-primary" : "text-foreground"
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DatePicker                                                          */
/* ------------------------------------------------------------------ */

/**
 * A date field with its own calendar.
 *
 * The native `<input type="date">` looks different in every browser, cannot be
 * themed, and shows month names in the browser's locale rather than the app's.
 * This keeps the same value format (`YYYY-MM-DD`) so it is a drop-in
 * replacement. The calendar is portalled so a modal cannot clip it, and opens
 * as a bottom sheet on phones.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pilih tanggal",
  disabled,
  clearable,
  required,
  name,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  /** `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const today = todayKeyWib();
  const initial = parseKey(value) ?? parseKey(today)!;
  const [viewY, setViewY] = useState(initial.y);
  const [viewM, setViewM] = useState(initial.m);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(open, triggerRef, { width: 312, maxHeight: 420 });

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  useDismiss(open, [triggerRef, panelRef], () => close());

  const openPanel = () => {
    if (disabled) return;
    const p = parseKey(value) ?? parseKey(today)!;
    setViewY(p.y);
    setViewM(p.m);
    setView("days");
    setOpen(true);
  };

  const outOfRange = (key: string) => Boolean((min && key < min) || (max && key > max));

  const grid = useMemo(() => {
    const total = daysInMonth(viewY, viewM);
    const offset = mondayIndex(viewY, viewM, 1);
    const cells: Array<{ key: string; day: number } | null> = Array(offset).fill(null);
    for (let d = 1; d <= total; d++) cells.push({ key: toKey(viewY, viewM, d), day: d });
    return cells;
  }, [viewY, viewM]);

  const step = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setViewM(m);
    setViewY(y);
  };

  const commit = (key: string) => {
    if (outOfRange(key)) return;
    onChange(key);
    close(true);
  };

  const selected = parseKey(value);
  const yearStart = Math.floor(viewY / 16) * 16;

  const back = () => (view === "years" ? setViewY((y) => y - 16) : view === "months" ? setViewY((y) => y - 1) : step(-1));
  const forward = () => (view === "years" ? setViewY((y) => y + 16) : view === "months" ? setViewY((y) => y + 1) : step(1));

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        className={triggerClass(open)}
      >
        <CalendarDays className="w-4 h-4 shrink-0 text-subtle" strokeWidth={ICON_STROKE} />
        <span className={cn("flex-1 min-w-0 truncate", value ? "text-foreground" : "text-subtle")}>
          {value ? formatLong(value) : placeholder}
        </span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Kosongkan tanggal"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 grid place-items-center w-5 h-5 rounded text-subtle hover:text-foreground hover:bg-surface-2"
          >
            <X className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
          </span>
        )}
      </button>

      {(required || name) && (
        <input
          aria-hidden
          tabIndex={-1}
          name={name}
          required={required}
          value={value}
          onChange={() => {}}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        />
      )}

      {open && (
        <FloatingPanel ref={panelRef} placement={placement} onDismiss={() => close(true)} title={ariaLabel ?? "Pilih tanggal"}>
          <div
            className={cn("p-3", placement.sheet && "px-4 pb-5")}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close(true);
              }
            }}
          >
            <div className="flex items-center gap-1 mb-3">
              <NavButton label="Sebelumnya" onClick={back}>
                <ChevronLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </NavButton>
              <button
                type="button"
                onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "days")}
                aria-label="Ganti tampilan bulan atau tahun"
                className="flex-1 h-9 rounded-[var(--radius-control)] text-body font-semibold text-heading hover:bg-surface-2 transition-colors tabular-nums"
              >
                {view === "days" && `${MONTHS[viewM - 1]} ${viewY}`}
                {view === "months" && viewY}
                {view === "years" && `${yearStart} – ${yearStart + 15}`}
              </button>
              <NavButton label="Berikutnya" onClick={forward}>
                <ChevronRight className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </NavButton>
            </div>

            {view === "months" && (
              <MonthGrid
                year={viewY}
                selected={selected?.y === viewY ? selected.m : undefined}
                onPick={(m) => {
                  setViewM(m);
                  setView("days");
                }}
              />
            )}

            {view === "years" && (
              <YearGrid
                start={yearStart}
                selected={selected?.y}
                onPick={(y) => {
                  setViewY(y);
                  setView("months");
                }}
              />
            )}

            {view === "days" && (
              <>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {WEEKDAYS.map((d, i) => (
                    <span
                      key={d}
                      className={cn("h-7 grid place-items-center text-caption font-medium", i === 6 ? "text-danger" : "text-subtle")}
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {grid.map((cell, i) => {
                    if (!cell) return <span key={`pad-${i}`} />;
                    const isSelected = cell.key === value;
                    const isToday = cell.key === today;
                    const blocked = outOfRange(cell.key);
                    const isSunday = i % 7 === 6;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        disabled={blocked}
                        aria-label={formatLong(cell.key)}
                        aria-current={isToday ? "date" : undefined}
                        aria-pressed={isSelected}
                        onClick={() => commit(cell.key)}
                        className={cn(
                          "rounded-[var(--radius-control)] text-body-sm tabular-nums transition-colors",
                          placement.sheet ? "h-11" : "h-9",
                          "hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                          blocked && "opacity-30 cursor-not-allowed hover:bg-transparent",
                          !isSelected && (isSunday ? "text-danger" : "text-foreground"),
                          isToday && !isSelected && "ring-1 ring-inset ring-primary/50 font-semibold",
                          isSelected && "bg-primary text-primary-foreground font-semibold hover:bg-primary"
                        )}
                      >
                        {cell.day}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => commit(today)}
                disabled={outOfRange(today)}
                className="h-9 px-2 -ml-2 rounded-[var(--radius-control)] text-body-sm font-medium text-primary hover:bg-primary-soft disabled:opacity-40"
              >
                Hari ini
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    close(true);
                  }}
                  className="h-9 px-2 -mr-2 rounded-[var(--radius-control)] text-body-sm text-muted hover:text-foreground hover:bg-surface-2"
                >
                  Kosongkan
                </button>
              )}
            </div>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MonthPicker                                                         */
/* ------------------------------------------------------------------ */

/**
 * Month field (`YYYY-MM`), for payroll and appraisal periods.
 *
 * `input[type=month]` cannot be styled and does not exist in Firefox at all,
 * where it silently degrades to a free-text box.
 */
export function MonthPicker({
  value,
  onChange,
  disabled,
  required,
  id,
  className,
  clearable,
  placeholder = "Pilih periode",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"months" | "years">("months");
  const today = todayKeyWib();
  const current = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const [viewY, setViewY] = useState(current ? Number(current[1]) : Number(today.slice(0, 4)));

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(open, triggerRef, { width: 288, maxHeight: 360 });

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  useDismiss(open, [triggerRef, panelRef], () => close());

  const label = current ? `${MONTHS[Number(current[2]) - 1]} ${current[1]}` : "";
  const yearStart = Math.floor(viewY / 16) * 16;

  return (
    <div className={cn("relative", className)}>
      {required && (
        <input
          type="text"
          className="sr-only"
          tabIndex={-1}
          aria-label={ariaLabel ?? "Periode wajib diisi"}
          value={value}
          onChange={() => {}}
          required
          disabled={disabled}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
            setOpen(true);
          }}
        />
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setViewY(current ? Number(current[1]) : Number(today.slice(0, 4)));
          setView("months");
          setOpen(true);
        }}
        className={triggerClass(open)}
      >
        <CalendarDays className="w-4 h-4 shrink-0 text-subtle" strokeWidth={ICON_STROKE} />
        <span className={cn("flex-1 min-w-0 truncate", label ? "text-foreground" : "text-subtle")}>
          {label || placeholder}
        </span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Kosongkan periode"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 grid place-items-center w-5 h-5 rounded text-subtle hover:text-foreground hover:bg-surface-2"
          >
            <X className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
          </span>
        )}
      </button>

      {open && (
        <FloatingPanel ref={panelRef} placement={placement} onDismiss={() => close(true)} title={ariaLabel ?? "Pilih periode"}>
          <div className={cn("p-3", placement.sheet && "px-4 pb-5")}>
            <div className="flex items-center gap-1 mb-3">
              <NavButton label="Sebelumnya" onClick={() => setViewY((y) => y - (view === "years" ? 16 : 1))}>
                <ChevronLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </NavButton>
              <button
                type="button"
                onClick={() => setView(view === "months" ? "years" : "months")}
                aria-label="Ganti tampilan tahun"
                className="flex-1 h-9 rounded-[var(--radius-control)] text-body font-semibold text-heading hover:bg-surface-2 transition-colors tabular-nums"
              >
                {view === "months" ? viewY : `${yearStart} – ${yearStart + 15}`}
              </button>
              <NavButton label="Berikutnya" onClick={() => setViewY((y) => y + (view === "years" ? 16 : 1))}>
                <ChevronRight className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </NavButton>
            </div>

            {view === "months" ? (
              <MonthGrid
                year={viewY}
                selected={current && Number(current[1]) === viewY ? Number(current[2]) : undefined}
                onPick={(m) => {
                  onChange(`${viewY}-${String(m).padStart(2, "0")}`);
                  close(true);
                }}
              />
            ) : (
              <YearGrid
                start={yearStart}
                selected={current ? Number(current[1]) : undefined}
                onPick={(y) => {
                  setViewY(y);
                  setView("months");
                }}
              />
            )}
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}
