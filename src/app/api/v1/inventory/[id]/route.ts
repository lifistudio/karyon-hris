import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, BadRequest, NotFound } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { RecordId } from "@/lib/postgres";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import AuditReport from "@/models/AuditReport";
import "@/models/Employee";
import "@/models/User";

type Ctx = RouteContext<{ id: string }>;

/** One asset with its full handover history and every check, newest first. */
export const GET = wrapRouteHandler<Ctx>(async (req, route) => {
  await requirePermission(req, "inventory", "read");
  const { id } = await route.params;
  if (!RecordId.isValid(id)) throw BadRequest("ID aset tidak valid.");
  await connectToDatabase();

  const asset = await Inventory.findById(id).lean<Record<string, unknown> | null>();
  if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");

  const [assignments, checks] = await Promise.all([
    InventoryAssignment.find({ inventoryId: id })
      .populate("employeeId", "name employeeId")
      .populate("assignedBy", "email")
      .populate("receivedBy", "email")
      .sort({ handoverDate: -1 })
      .limit(100)
      .lean(),
    AuditReport.find({ inventoryId: id })
      .populate("auditorId", "email")
      .populate("holderEmployeeId", "name")
      .sort({ auditDate: -1 })
      .limit(200)
      .lean(),
  ]);

  return apiSuccess({ asset, assignments, checks }, "Berhasil memuat detail aset");
});
