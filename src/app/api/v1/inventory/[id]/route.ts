import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, BadRequest, Forbidden, NotFound } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { RecordId } from "@/lib/postgres";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import InventoryEvent from "@/models/InventoryEvent";
import AuditReport from "@/models/AuditReport";
import { presentPhotos, presentSignature, visibleAssetIds } from "@/lib/inventory/server";
import "@/models/Employee";
import "@/models/User";

type Ctx = RouteContext<{ id: string }>;

/** One asset with its full handover history, every check and every repair, newest first. */
export const GET = wrapRouteHandler<Ctx>(async (req, route) => {
  const ctx = await requirePermission(req, "inventory", "read");
  const { id } = await route.params;
  if (!RecordId.isValid(id)) throw BadRequest("ID aset tidak valid.");
  await connectToDatabase();
  // This response carries signatures and evidence photos of other employees.
  const visible = await visibleAssetIds(ctx);
  if (visible && !visible.some((v) => String(v) === id)) throw Forbidden("Aset ini di luar cakupan izin Anda.");

  const asset = await Inventory.findById(id).lean<(Record<string, unknown> & { initialCheck?: Record<string, unknown> | null }) | null>();
  if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");

  const [assignments, checks, events] = await Promise.all([
    InventoryAssignment.find({ inventoryId: id })
      .populate("employeeId", "name employeeId")
      .populate("assignedBy", "email")
      .populate("receivedBy", "email")
      .sort({ handoverDate: -1 })
      .limit(100)
      .lean<Array<Record<string, unknown>>>(),
    AuditReport.find({ inventoryId: id })
      .populate("auditorId", "email")
      .populate("holderEmployeeId", "name")
      .sort({ auditDate: -1 })
      .limit(200)
      .lean<Array<Record<string, unknown>>>(),
    InventoryEvent.find({ inventoryId: id })
      .populate("actorUserId", "email")
      .populate("employeeId", "name")
      .sort({ eventDate: -1 })
      .limit(200)
      .lean<Array<Record<string, unknown>>>(),
  ]);

  return apiSuccess({
    asset: { ...asset, initialCheck: asset.initialCheck ? { ...asset.initialCheck, photos: await presentPhotos(asset.initialCheck.photos) } : null },
    assignments: await Promise.all(assignments.map(async (a) => {
      const { signatureUrl, ...rest } = a;
      return { ...rest, signature: await presentSignature(signatureUrl), handoverPhotos: await presentPhotos(a.handoverPhotos), returnPhotos: await presentPhotos(a.returnPhotos) };
    })),
    checks: await Promise.all(checks.map(async (c) => ({ ...c, photos: await presentPhotos(c.photos) }))),
    events: await Promise.all(events.map(async (e) => ({ ...e, photos: await presentPhotos(e.photos) }))),
  }, "Berhasil memuat detail aset");
});
