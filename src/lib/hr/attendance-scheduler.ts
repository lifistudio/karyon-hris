import { runAttendanceAlerts, runInventoryAlerts } from "@/lib/hr/attendance-alerts";

const INTERVAL_MS = 5 * 60_000;
let started = false;

/**
 * In-process scheduler for self-hosted installs: no external cron is needed
 * for attendance reminders. Ticks are serialised across instances by an
 * advisory lock and every notification is idempotent per day.
 */
export function startAttendanceScheduler() {
  if (started) return;
  started = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAttendanceAlerts();
      await runInventoryAlerts();
    } catch (error) {
      console.error("[ATTENDANCE-ALERTS] tick failed:", error instanceof Error ? error.message : "unknown");
    } finally {
      running = false;
    }
  };
  // Give migrations and the first requests a minute before the first tick.
  setTimeout(() => { void tick(); setInterval(() => void tick(), INTERVAL_MS).unref(); }, 60_000).unref();
}
