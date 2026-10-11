"use client";

import React, { useRef, useState } from "react";
import { GripVertical } from "@/components/icons";
import { cn, ICON_STROKE } from "./core";

/** Moves one item, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Pointer travel, in pixels, before a press on the handle counts as a drag. */
const DRAG_THRESHOLD = 4;

interface DragState {
  from: number;
  to: number;
  /** Vertical distance the pointer has travelled since the press. */
  dy: number;
  pointerId: number;
  startY: number;
  /** Row boxes captured at the press, so the maths is not thrown off by the
   *  very transforms the drag applies. */
  rects: DOMRect[];
  /** Space between rows, used to open a gap of the right size. */
  gap: number;
  moved: boolean;
}

/**
 * A reorderable list.
 *
 * Built on pointer events rather than the HTML5 drag-and-drop API, for three
 * reasons that all showed up in this app:
 *
 * - HTML5 drag does not fire for touch on Android, and several of these forms
 *   are filled in on tablets.
 * - It needs `draggable` on the whole row. When the row contains an input,
 *   Chrome then refuses to let you select text inside it and Firefox can turn
 *   a click in the field into a drag.
 * - It gives no control over the picture while dragging, so rows cannot slide
 *   aside to show where the item will land.
 *
 * Only the grip starts a drag, so everything else in the row — inputs, buttons,
 * toggles — behaves normally. The grip is also a keyboard control (arrow keys,
 * Home, End), because a drag of any kind is unusable without a pointer.
 *
 * `onReorder` receives the already-reordered array, so callers set state and
 * nothing else.
 */
export function ReorderList<T>({
  items,
  getKey,
  onReorder,
  renderItem,
  disabled,
  className,
  itemClassName,
  handleAlign = "start",
  /** Announced to screen readers when an item moves. */
  describeItem,
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  /** `center` suits single-line rows such as a text input. */
  handleAlign?: "start" | "center";
  describeItem?: (item: T, index: number) => string;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  /** Mirrors `drag` for pointer handlers, which must not wait for a render. */
  const dragRef = useRef<DragState | null>(null);

  const setDragState = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const describe = (index: number) => describeItem?.(items[index], index) ?? `Item ${index + 1}`;

  const commit = (from: number, to: number) => {
    if (from === to) return;
    const label = describe(from);
    onReorder(moveItem(items, from, to));
    setAnnouncement(`${label} dipindahkan ke posisi ${to + 1} dari ${items.length}.`);
  };

  /**
   * Keeps focus on the row the user just moved, rather than on a position.
   *
   * Direct-child selectors only: lists nest (indicators inside aspects), and a
   * descendant match on the outer list would find an inner row that happens to
   * share the index and sits earlier in the document.
   */
  const refocus = (index: number) => {
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>(`:scope > [data-row="${index}"] > [data-handle]`)
        ?.focus();
    });
  };

  const rowElements = () =>
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>(":scope > [data-row]") ?? []);

  /* ---------------- pointer ---------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || items.length < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const rects = rowElements().map((el) => el.getBoundingClientRect());
    if (rects.length !== items.length) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      from: index,
      to: index,
      dy: 0,
      pointerId: e.pointerId,
      startY: e.clientY,
      rects,
      gap: rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0,
      moved: false,
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || e.pointerId !== current.pointerId) return;

    const dy = e.clientY - current.startY;
    const moved = current.moved || Math.abs(dy) > DRAG_THRESHOLD;
    if (!moved) return;

    // The item lands after every other row whose middle it has passed.
    const fromRect = current.rects[current.from];
    const centre = fromRect.top + fromRect.height / 2 + dy;
    let to = 0;
    current.rects.forEach((r, i) => {
      if (i !== current.from && r.top + r.height / 2 < centre) to += 1;
    });

    setDragState({ ...current, dy, to, moved });
  };

  const finish = (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const current = dragRef.current;
    if (!current || e.pointerId !== current.pointerId) return;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragState(null);

    if (!cancelled && current.moved && current.from !== current.to) {
      commit(current.from, current.to);
      refocus(current.to);
    }
  };

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (disabled) return;

    if (e.key === "Escape" && dragRef.current) {
      e.preventDefault();
      setDragState(null);
      return;
    }

    let target: number;
    if (e.key === "ArrowUp") target = index - 1;
    else if (e.key === "ArrowDown") target = index + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = items.length - 1;
    else return;

    e.preventDefault();
    if (target < 0 || target >= items.length || target === index) return;
    commit(index, target);
    refocus(target);
  };

  /* ---------------- rendering ---------------- */

  /** How far a row slides to open a gap for the item being dragged. */
  const offsetFor = (index: number): number => {
    if (!drag || !drag.moved) return 0;
    if (index === drag.from) return drag.dy;

    const size = drag.rects[drag.from].height + drag.gap;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -size;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return size;
    return 0;
  };

  return (
    <div ref={rootRef} className={cn("space-y-2", className)}>
      {items.map((item, index) => {
        const isDragging = drag?.moved && drag.from === index;
        const offset = offsetFor(index);

        return (
          <div
            key={getKey(item, index)}
            data-row={index}
            style={offset ? { transform: `translateY(${offset}px)` } : undefined}
            className={cn(
              "relative flex gap-2 rounded-[var(--radius-control)]",
              handleAlign === "center" ? "items-center" : "items-start",
              // Rows making room glide; the row under the pointer follows it
              // exactly, since any easing there reads as lag.
              drag?.moved && !isDragging && "transition-transform duration-150 ease-out",
              isDragging && "z-10 shadow-[0_10px_30px_rgba(20,20,43,0.16)] bg-surface",
              itemClassName
            )}
          >
            <button
              type="button"
              data-handle
              disabled={disabled}
              aria-label={`${describe(index)}. Posisi ${index + 1} dari ${items.length}. Seret, atau tekan panah atas dan bawah untuk memindahkan.`}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finish(e, false)}
              onPointerCancel={(e) => finish(e, true)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "shrink-0 w-7 h-7 grid place-items-center rounded-[var(--radius-control)]",
                handleAlign === "start" && "mt-0.5",
                "text-subtle transition-colors select-none",
                // Without this the browser claims a touch on the grip for
                // scrolling, and the drag never starts.
                "touch-none",
                "hover:bg-surface-2 hover:text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:text-foreground",
                disabled ? "opacity-40 cursor-not-allowed" : isDragging ? "cursor-grabbing" : "cursor-grab"
              )}
            >
              <GripVertical className="w-4 h-4" strokeWidth={ICON_STROKE} />
            </button>

            <div className="flex-1 min-w-0">{renderItem(item, index)}</div>
          </div>
        );
      })}

      {/* Movement is invisible to a screen reader without this. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
