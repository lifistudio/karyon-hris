import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { BadRequest, requireCompanyPermission } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { deletePolicy, savePolicy } from "@/lib/hr/attendance-tasks-server";
import AttendanceTaskPolicy from "@/models/AttendanceTaskPolicy";
import Branch from "@/models/Branch";
import Division from "@/models/Division";
import Employee from "@/models/Employee";
import Position from "@/models/Position";
import Role from "@/models/Role";

/** Policies change what everyone must do to clock out, so they are company-wide settings. */
export const GET = wrapRouteHandler(async (req) => {
  await requireCompanyPermission(req, "attendance", "write");
  await connectToDatabase();
  const [policies, roles, divisions, positions, branches, employees] = await Promise.all([
    AttendanceTaskPolicy.find({}).sort({ createdAt: -1 }).lean(),
    Role.find({}).select("name").sort({ name: 1 }).lean(),
    Division.find({}).select("name").sort({ name: 1 }).lean(),
    Position.find({}).select("name").sort({ name: 1 }).lean(),
    Branch.find({}).select("name").sort({ name: 1 }).lean(),
    Employee.find({ status: { $in: ["active", "onboarding"] } }).select("name employeeId").sort({ name: 1 }).limit(2000).lean(),
  ]);
  return apiSuccess({ policies, options: { roles, divisions, positions, branches, employees } }, "Berhasil memuat aturan task");
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "attendance", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  return apiSuccess(await savePolicy(ctx, body), "Aturan task disimpan.");
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "attendance", "write");
  await deletePolicy(ctx, new URL(req.url).searchParams.get("id"));
  return apiSuccess(null, "Aturan task dihapus. Task yang sudah terbentuk tetap tersimpan.");
});
