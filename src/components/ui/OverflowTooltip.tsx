"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Shows the full text of anything cut off with an ellipsis (`truncate`,
 * `line-clamp`) after the mouse rests on it — table cells, dropdown options,
 * badges, card titles. Mounted once in the root layout, so no page has to opt
 * in. Elements can also carry an explicit `data-tooltip`.
 *
 * Mouse only: touch users long-press, which already selects the text.
 */
const DELAY = 350;
const MAX_DEPTH = 5;
const SKIP = "input, textarea, select, [contenteditable='true'], [data-no-tooltip]";

function clipped(el: HTMLElement) {
  if (el.matches(SKIP)) return false;
  const style = getComputedStyle(el);
  const hides = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none" || /hidden|clip/.test(style.overflow + style.overflowX);
  if (!hides) return false;
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

function findTarget(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : null;
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (el.dataset.tooltip) return el;
    // Icon-only buttons and links describe themselves through aria-label.
    if (el.matches("button, a") && el.getAttribute("aria-label") && !el.innerText.trim()) return el;
    if (el.childElementCount <= 3 && clipped(el)) return el;
  }
  return null;
}

type Tip = { text: string; top: number; left: number; below: boolean };

export function OverflowTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<{ el: HTMLElement; title: string | null } | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      const active = current.current;
      // Restore a native title we set aside so it does not show twice.
      if (active?.title !== null && active?.title !== undefined) active.el.setAttribute("title", active.title);
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = (el.dataset.tooltip || el.getAttribute("title") || el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+\n/g, "\n").slice(0, 600);
      if (!text || !el.isConnected) return;
      const title = el.getAttribute("title");
      if (title !== null) el.removeAttribute("title");
      current.current = { el, title };
      const r = el.getBoundingClientRect();
      const below = r.top < 90;
      setTip({ text, below, top: below ? r.bottom + 8 : r.top - 8, left: Math.min(Math.max(12, r.left + r.width / 2), window.innerWidth - 12) });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = findTarget(e.target);
      if (current.current?.el === el) return;
      hide();
      if (!el) return;
      timer.current = window.setTimeout(() => show(el), DELAY);
    };
    const out = (e: PointerEvent) => {
      const active = current.current?.el;
      const next = e.relatedTarget as Node | null;
      if (active && next && active.contains(next)) return;
      if (!active) window.clearTimeout(timer.current);
      else hide();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const box = useRef<HTMLDivElement>(null);
  // Keep the bubble inside the viewport once its real width is known.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.min(Math.max(12 + w / 2, tip.left), document.documentElement.clientWidth - 12 - w / 2)}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="overflow-tooltip"
      style={{ top: tip.top, left: tip.left, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>,
    document.body
  );
}
