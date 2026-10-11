import { connection } from "next/server";
import Setting from "@/models/Setting";
import { DEFAULT_TIMEZONE_OFFSET_MINUTES, getTimezoneOffset, isValidTimezoneOffset, setTimezoneOffset } from "./time";

/**
 * Keeps this server process on the company time zone chosen in Pengaturan.
 * Called on every database connection; reads the row at most once a minute so
 * a change made on another instance is picked up without a restart.
 */
const REFRESH_MS = 60_000;
let checkedAt = 0;
let pending: Promise<void> | null = null;

export function refreshTimezone(force = false): Promise<void> {
  if (!force && Date.now() - checkedAt < REFRESH_MS) return Promise.resolve();
  pending ??= (async () => {
    try {
      const row = await Setting.findOne({ key: "timezone_offset_minutes" }).lean<{ value?: unknown } | null>();
      const minutes = row?.value === undefined ? DEFAULT_TIMEZONE_OFFSET_MINUTES : Number(row.value);
      setTimezoneOffset(isValidTimezoneOffset(minutes) ? minutes : DEFAULT_TIMEZONE_OFFSET_MINUTES);
      checkedAt = Date.now();
    } catch {
      // Keep the last known zone; the next connection tries again.
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * Offset for the root layout to hand to the browser. Rendering per request
 * (not at build time) is what lets a change in Pengaturan reach every page.
 */
export async function currentTimezoneOffset(): Promise<number> {
  await connection();
  await refreshTimezone();
  return getTimezoneOffset();
}
