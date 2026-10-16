import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, BadRequest } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { RecordId } from "@/lib/postgres";
import { wibPeriodKey } from "@/lib/time";
import AuditReport from "@/models/AuditReport";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import { recordCheck } from "@/lib/inventory/server";
import "@/models/User";

/**
 * Check history. `period=YYYY-MM` (default: this month) narrows the list and
 * the summary tells how far the monthly round has got.
 */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "inventory", "read");
  await connectToDatabase();

  const sp = new URL(req.url).searchParams;
  const period = sp.get("period")?.trim() || wibPeriodKey();
  if (!/^\d{4}-\d{2}$/.test(period)) throw BadRequest("Periode harus berformat YYYY-MM.");
  const filter: Record<string, unknown> = { period };
  const inventoryId = sp.get("inventoryId");
  if (inventoryId) {
    if (!RecordId.isValid(inventoryId)) throw BadRequest("ID aset tidak valid.");
    filter.inventoryId = inventoryId;
  }

  const [reports, totalAssets, monthlyDone, flagged, held, pending] = await Promise.all([
    AuditReport.find(filter)
      .populate("auditorId", "email")
      .populate("inventoryId", "code name category")
      .sort({ auditDate: -1 })
      .limit(500)
      .lean(),
    // Lost assets cannot be checked, so they are not part of the round.
    Inventory.countDocuments({ condition: { $ne: "lost" } }),
    AuditReport.countDocuments({ period, type: "monthly" }),
    AuditReport.countDocuments({ period, status: "flagged" }),
    InventoryAssignment.countDocuments({ status: "active" }),
    InventoryAssignment.countDocuments({ status: { $in: ["pending_handover", "disputed"] } }),
  ]);

  return apiSuccess(reports, "Berhasil memuat riwayat pengecekan", {
    period,
    summary: { totalAssets, monthlyDone, flagged, held, pending },
  });
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "inventory", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  const report = await recordCheck(ctx, body);
  return apiSuccess(report, report.status === "flagged"
    ? "Pengecekan disimpan dan ditandai: ada temuan yang perlu ditindaklanjuti."
    : "Pengecekan disimpan. Kondisi sesuai catatan.");
});
