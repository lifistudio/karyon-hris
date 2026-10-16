import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, scopeFilter } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import Employee from "@/models/Employee";
import "@/models/Division";

/**
 * Who an asset can be handed to. Separate from `/employees` so a GA officer
 * with only inventory rights can still pick a recipient, and so the list never
 * carries more than a name, number and division.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "inventory", "write");
  await connectToDatabase();
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 60);
  const filter: Record<string, unknown> = {
    ...scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" }),
    status: { $in: ["active", "onboarding"] },
  };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { employeeId: rx }];
  }
  const employees = await Employee.find(filter)
    .select("name employeeId divisionId")
    .populate("divisionId", "name")
    .sort({ name: 1 })
    .limit(1000)
    .lean();
  return apiSuccess(employees, "Berhasil memuat daftar karyawan");
});
