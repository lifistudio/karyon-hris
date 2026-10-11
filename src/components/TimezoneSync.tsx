"use client";

import { setTimezoneOffset } from "@/lib/time";

/**
 * Applies the company time zone in the browser before any page renders a date.
 * Rendered first inside <body>; setting a module value during render is safe
 * here because it is idempotent and identical on server and client.
 */
export function TimezoneSync({ minutes }: { minutes: number }) {
  setTimezoneOffset(minutes);
  return null;
}
