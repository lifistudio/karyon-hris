import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { BadRequest, enforceRateLimit, requireEmployee } from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { wibDateKey } from "@/lib/time";
import { submitTask, tasksForDay } from "@/lib/hr/attendance-tasks-server";

/** The signed-in employee's tasks for a day (today unless `date` says otherwise). */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("daily-task-read", ctx.employeeId, RATE_RULES.read);
  const date = new URL(req.url).searchParams.get("date") ?? wibDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw BadRequest("Tanggal harus YYYY-MM-DD.");
  const response = apiSuccess(await tasksForDay(ctx.employeeId, date), "Berhasil memuat task");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

/** Sends the proof for one task. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("daily-task", ctx.employeeId, RATE_RULES.write);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  return apiSuccess(await submitTask(ctx, body), "Bukti task terkirim.");
});
