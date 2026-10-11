"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Positioning for panels that open from a trigger: dropdowns, date pickers.
 *
 * Panels are rendered into `document.body` through a portal and placed with
 * `position: fixed` next to their trigger. Rendering them inside the trigger's
 * own box was the obvious approach and it broke in the one place these controls
 * are used most — forms inside a modal, whose `overflow` clipped the panel so
 * the lower options could not be reached.
 *
 * On narrow screens the panel becomes a bottom sheet instead: a dropdown a
 * thumb has to hit precisely, half hidden behind the on-screen keyboard, is the
 * least usable way to pick from a long list on a phone.
 */

export const SHEET_BREAKPOINT = 640;

export interface FloatingPlacement {
  sheet: boolean;
  style: React.CSSProperties;
}

export function useIsSheet(): boolean {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${SHEET_BREAKPOINT - 1}px)`);
    const update = () => setSheet(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return sheet;
}

/**
 * Tracks the trigger's position while the panel is open, including when the
 * page or any scrolling ancestor (a modal body) scrolls underneath it.
 */
export function useFloatingPlacement(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  { width, maxHeight = 320 }: { width?: number; maxHeight?: number } = {}
): FloatingPlacement {
  const sheet = useIsSheet();
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const vh = window.innerHeight;
    // clientWidth excludes the page scrollbar, so a panel never hides under it.
    const vw = document.documentElement.clientWidth || window.innerWidth;

    const panelWidth = Math.min(Math.max(width ?? r.width, r.width), vw - 16);
    const below = vh - r.bottom - gap - 8;
    const above = r.top - gap - 8;
    // Open upwards only when there is clearly more room there.
    const up = below < Math.min(maxHeight, 220) && above > below;
    const room = Math.max(160, Math.min(maxHeight, up ? above : below));

    const left = Math.min(Math.max(8, r.left), vw - panelWidth - 8);
    setStyle({
      position: "fixed",
      left,
      width: panelWidth,
      maxHeight: room,
      ...(up ? { bottom: vh - r.top + gap } : { top: r.bottom + gap }),
    });
  }, [triggerRef, width, maxHeight]);

  useLayoutEffect(() => {
    if (!open || sheet) return;
    place();
    // Capture phase catches scrolling in any ancestor, not just the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, sheet, place]);

  return { sheet, style };
}

/** Renders children into `document.body`. */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

/**
 * The panel shell: a floating card on wide screens, a bottom sheet with a
 * backdrop on narrow ones.
 */
export const FloatingPanel = React.forwardRef<
  HTMLDivElement,
  {
    placement: FloatingPlacement;
    onDismiss: () => void;
    title?: string;
    className?: string;
    children: React.ReactNode;
  }
>(function FloatingPanel({ placement, onDismiss, title, className, children }, ref) {
  // The sheet takes over the screen, so the page must not scroll behind it.
  useEffect(() => {
    if (!placement.sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [placement.sheet]);

  if (placement.sheet) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[80] flex flex-col justify-end">
          <button
            type="button"
            aria-label="Tutup"
            tabIndex={-1}
            onClick={onDismiss}
            className="absolute inset-0 bg-[rgba(20,20,43,0.45)] backdrop-blur-[1px]"
          />
          <div
            ref={ref}
            role="dialog"
            aria-label={title}
            className={
              "relative z-10 flex flex-col max-h-[80dvh] rounded-t-[var(--radius-xl2)] bg-surface " +
              "border-t border-line pb-[env(safe-area-inset-bottom)] animate-[sheet-in_160ms_ease-out] " +
              (className ?? "")
            }
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
            {title && <p className="px-4 pb-2 text-title-sm font-semibold text-heading">{title}</p>}
            {children}
          </div>
        </div>
      </Portal>
    );
  }

  return (
    <Portal>
      <div
        ref={ref}
        style={placement.style}
        className={
          "z-[80] flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface " +
          "shadow-[var(--shadow-pop)] animate-[pop-in_120ms_ease-out] " +
          (className ?? "")
        }
      >
        {children}
      </div>
    </Portal>
  );
});
