"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "@/components/icons";
import { cn, ICON_STROKE, type IconType } from "./core";
import { FloatingPanel, useFloatingPlacement } from "./Floating";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line, for telling apart people or codes with similar names. */
  hint?: string;
  disabled?: boolean;
}

export type ComboboxSize = "sm" | "md";

/** Accent-insensitive, case-insensitive text for matching "Möller" to "moller". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * The dropdown used everywhere in the interface.
 *
 * Every dropdown is searchable: typing narrows the list, arrow keys move, Enter
 * picks, Escape backs out. The search box is always present rather than
 * appearing only for long lists — a control that behaves differently depending
 * on how many options it happens to hold is harder to learn than one that
 * always works the same way.
 *
 * The panel is portalled so a modal cannot clip it, and becomes a bottom sheet
 * on phones.
 *
 * When `required` or `name` is given, a visually hidden native `<select>`
 * mirrors the value so the browser's own form validation and `FormData` keep
 * working exactly as they did with a plain select.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  searchPlaceholder = "Cari…",
  emptyLabel = "Tidak ada yang cocok.",
  disabled,
  clearable,
  required,
  name,
  id,
  size = "md",
  className,
  "aria-label": ariaLabel,
  sheetTitle,
  icon: Icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Offers an explicit "clear" affordance for optional fields. */
  clearable?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  size?: ComboboxSize;
  className?: string;
  "aria-label"?: string;
  /** Heading shown on the phone bottom sheet; defaults to the aria-label. */
  sheetTitle?: string;
  /** Leading icon inside the trigger, e.g. a filter glyph on a toolbar. */
  icon?: IconType;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const placement = useFloatingPlacement(open, triggerRef, { maxHeight: 340 });

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter((o) => fold(o.label).includes(q) || fold(o.hint ?? "").includes(q));
  }, [options, query]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    if (disabled) return;
    // Start on the current choice so Enter keeps it and arrows move from it.
    const index = options.findIndex((o) => o.value === value);
    setActive(Math.max(0, index));
    setOpen(true);
  };

  /* Outside click: the panel lives in a portal, so it is checked separately. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, close]);

  /* Focus the search once the panel exists. */
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  /* Keep the highlighted row in view while arrowing through a long list. */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };

  const move = (delta: number) => {
    if (!filtered.length) return;
    setActive((i) => {
      let next = i;
      // Skip disabled rows so the highlight never rests on something unpickable.
      for (let step = 0; step < filtered.length; step++) {
        next = Math.min(filtered.length - 1, Math.max(0, next + delta));
        if (!filtered[next]?.disabled) break;
        if (next === 0 || next === filtered.length - 1) break;
      }
      return next;
    });
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(Math.max(0, filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[active]) pick(filtered[active]);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close();
        break;
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openPanel();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on a closed dropdown opens it with that letter already searched.
      openPanel();
      setQuery(e.key);
    }
  };

  const height = size === "sm" ? "h-9 text-body-sm" : "h-10 text-body";

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "w-full rounded-[var(--radius-control)] bg-[var(--field-bg)] border border-transparent px-3",
          "flex items-center gap-2 text-left transition-colors",
          "hover:bg-[var(--field-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          "disabled:opacity-55 disabled:cursor-not-allowed",
          open && "bg-surface border-line ring-2 ring-[var(--ring)]",
          height
        )}
      >
        {Icon && <Icon className="w-4 h-4 shrink-0 text-subtle" strokeWidth={ICON_STROKE} />}
        <span className={cn("flex-1 min-w-0 truncate", selected ? "text-foreground" : "text-subtle")}>
          {selected ? selected.label : placeholder}
        </span>

        {clearable && selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Kosongkan pilihan"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 grid place-items-center w-5 h-5 rounded text-subtle hover:text-foreground hover:bg-surface-2"
          >
            <X className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
          </span>
        )}

        <ChevronsUpDown className="w-4 h-4 shrink-0 text-subtle" strokeWidth={ICON_STROKE} />
      </button>

      {(required || name) && (
        <select
          aria-hidden
          tabIndex={-1}
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          onChange={() => {}}
          // Sits over the trigger so the browser's "please select" bubble points
          // at the visible control.
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {open && (
        <FloatingPanel
          ref={panelRef}
          placement={placement}
          onDismiss={() => close(true)}
          title={sheetTitle ?? ariaLabel}
        >
          <div onKeyDown={onPanelKeyDown} className="flex flex-col min-h-0">
            <div className={cn("p-2 border-b border-line", placement.sheet && "px-4 pb-3")}>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
                  strokeWidth={ICON_STROKE}
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-controls={listId}
                  aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                  className={cn(
                    "w-full rounded-[var(--radius-control)] bg-surface-2 border border-transparent pl-9 pr-3",
                    "text-foreground placeholder:text-subtle focus:outline-none focus:border-primary",
                    // 16px on phones: anything smaller makes iOS zoom the page on focus.
                    placement.sheet ? "h-11 text-body-lg" : "h-9 text-body-sm"
                  )}
                />
              </div>
            </div>

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5", placement.sheet && "px-2 pb-3")}
            >
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-body-sm text-muted">{emptyLabel}</p>
              ) : (
                filtered.map((option, i) => {
                  const isSelected = option.value === value;
                  return (
                    <div
                      key={option.value}
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onMouseEnter={() => setActive(i)}
                      // mousedown, not click: keeps focus from leaving the search
                      // box before the pick is registered.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(option)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 cursor-pointer select-none",
                        placement.sheet ? "min-h-12 py-2" : "min-h-9 py-1.5",
                        option.disabled && "opacity-45 cursor-not-allowed",
                        i === active && !option.disabled && "bg-surface-2",
                        isSelected && "text-primary"
                      )}
                    >
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            "block truncate",
                            placement.sheet ? "text-body" : "text-body-sm",
                            isSelected ? "font-medium text-primary" : "text-foreground"
                          )}
                        >
                          {option.label}
                        </span>
                        {option.hint && (
                          <span className="block text-label text-subtle truncate">{option.hint}</span>
                        )}
                      </span>
                      {isSelected && (
                        <Check className="w-4 h-4 shrink-0 text-primary" strokeWidth={2} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}
