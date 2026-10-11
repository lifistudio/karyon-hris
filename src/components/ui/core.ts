import type { IconComponent } from "@/components/icons";
import type React from "react";

/**
 * Primitives shared by every UI component.
 *
 * Kept apart from `index.tsx` so components that `index.tsx` itself builds on
 * (the dropdown behind `Select`) can import them without a circular import.
 */

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Default icon geometry for the whole product.
 *
 * Lucide ships at stroke-width 2, which is heavy next to Inter at UI sizes and
 * makes small icons look like clip art. 1.75 keeps them legible at 14px while
 * sitting at the same optical weight as the text beside them.
 */
export const ICON_STROKE = 1.75;

/** Any icon from "@/components/icons" (Remix Icon). */
export type IconType = IconComponent;
