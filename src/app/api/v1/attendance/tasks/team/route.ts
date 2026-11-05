import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { BadRequest, enforceRateLimit, requireUser } from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { wibDateKey } from "@/lib/time";
import { assignTask, isLead, removeAssignedTask, reviewTask, teamMembers, teamTasks, waiveTask } from "@/lib/hr/attendance-tasks-server";

/**
 * The supervisor side of daily tasks. Access is decided per employee in the
 * service: direct reports always, plus whatever `attendance:write` covers, so a
 * lead does not need a particular role name.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const url = new URL(req.url);
  // The menu only asks whether to show the link.
  if (url.searchParams.get("view") === "access") return apiSuccess({ isLead: await isLead(ctx) });
  enforceRateLimit("daily-task-team-read", ctx.user.id, RATE_RULES.read);
  const date = url.searchParams.get("date") ?? wibDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw BadRequest("Tanggal harus YYYY-MM-DD.");
  const [team, members] = await Promise.all([teamTasks(ctx, date), teamMembers(ctx)]);
  const response = apiSuccess({ ...team, date, members }, "Berhasil memuat task tim");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  enforceRateLimit("daily-task-team", ctx.user.id, RATE_RULES.write);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");

  switch (body.action) {
    case "assign": {
      const result = await assignTask(ctx, body);
      return apiSuccess(result, `${result.created} task dibuat.`);
    }
    case "review":
      await reviewTask(ctx, body);
      return apiSuccess(null, body.decision === "approve" ? "Bukti disetujui." : "Bukti dikembalikan ke karyawan.");
    case "waive":
      await waiveTask(ctx, body);
      return apiSuccess(null, "Task dibebaskan.");
    case "remove":
      await removeAssignedTask(ctx, body);
      return apiSuccess(null, "Task dihapus.");
    default:
      throw BadRequest("Aksi harus assign, review, waive, atau remove.");
  }
});
