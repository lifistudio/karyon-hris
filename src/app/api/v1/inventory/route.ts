import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { connectToDatabase } from "@/lib/db";
import { wibPeriodKey } from "@/lib/time";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import AuditReport from "@/models/AuditReport";
import "@/models/Employee";
import {
  OPEN_STATUSES,
  assignAsset,
  getCategorySettings,
  parseCondition,
  parseReading,
  returnAsset,
} from "@/lib/inventory/server";
import { sanitizeChecklist, sanitizeSpecs } from "@/lib/inventory/templates";

/**
 * The handler only reads `_id` off an asset and `inventoryId` off an assignment;
 * everything else is passed straight through to the client, so the rest of each
 * document stays untyped rather than being mirrored here and drifting.
 */
interface LeanAsset extends Record<string, unknown> {
  _id: { toString(): string };
}

interface LeanRef extends Record<string, unknown> {
  inventoryId?: { toString(): string } | null;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "inventory", "read");
  await connectToDatabase();

  // Paged, searchable on the server; `code` is an exact lookup for the barcode scanner.
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const period = wibPeriodKey();
  const filter: Record<string, unknown> = {};
  const code = sp.get("code")?.trim();
  const q = sp.get("q")?.trim();
  const category = sp.get("category")?.trim();
  const status = sp.get("status")?.trim();
  if (code) {
    filter.code = new RegExp(`^${escape(code)}$`, "i");
  } else {
    if (q) {
      const rx = new RegExp(escape(q.slice(0, 60)), "i");
      filter.$or = [{ name: rx }, { code: rx }];
    }
    if (category) filter.category = category;
    if (status === "lost" || status === "damaged") filter.condition = status;
    if (status === "available" || status === "held" || status === "pending") {
      const open = await InventoryAssignment.find({
        status: status === "held" ? "active" : status === "pending" ? { $in: ["pending_handover", "disputed"] } : { $in: [...OPEN_STATUSES] },
      }).select("inventoryId").lean<LeanRef[]>();
      const ids = open.map((a) => a.inventoryId).filter(Boolean);
      filter._id = status === "available" ? { $nin: ids } : { $in: ids };
      if (status === "available") filter.condition = { $ne: "lost" };
    }
    if (status === "unchecked") {
      const checked = await AuditReport.find({ type: "monthly", period }).select("inventoryId").lean<LeanRef[]>();
      filter._id = { $nin: checked.map((r) => r.inventoryId).filter(Boolean) };
      filter.condition = { $ne: "lost" };
    }
  }

  const [assets, total] = await Promise.all([
    Inventory.find(filter).sort({ code: 1 }).skip((page - 1) * limit).limit(limit).lean<LeanAsset[]>(),
    Inventory.countDocuments(filter),
  ]);
  const assetIds = assets.map((a) => a._id);

  // The open handover (if any) and the latest check, per asset on this page.
  const [assignments, checks] = await Promise.all([
    InventoryAssignment.find({ inventoryId: { $in: assetIds }, status: { $in: [...OPEN_STATUSES] } })
      .select("-signatureUrl")
      .populate({
        path: "employeeId",
        select: "name employeeId divisionId positionId",
        populate: [
          { path: "divisionId", select: "name" },
          { path: "positionId", select: "name" },
        ],
      })
      .sort({ handoverDate: -1 })
      .lean<LeanRef[]>(),
    AuditReport.find({ inventoryId: { $in: assetIds } })
      .select("inventoryId type period auditDate condition status")
      .sort({ auditDate: -1 })
      .lean<LeanRef[]>(),
  ]);
  const firstBy = (rows: LeanRef[]) => {
    const map = new Map<string, LeanRef>();
    for (const row of rows) {
      const key = row.inventoryId?.toString();
      if (key && !map.has(key)) map.set(key, row);
    }
    return map;
  };
  const openMap = firstBy(assignments);
  const lastCheck = firstBy(checks);
  const monthly = firstBy(checks.filter((c) => c.type === "monthly" && c.period === period));

  const data = assets.map((asset) => {
    const key = asset._id.toString();
    return {
      ...asset,
      assignment: openMap.get(key) ?? null,
      lastCheck: lastCheck.get(key) ?? null,
      monthlyCheck: monthly.get(key) ?? null,
    };
  });

  return apiSuccess(data, "Berhasil memuat data inventaris", { page, limit, total });
});

/**
 * Creates or edits an asset. A new asset carries its starting condition and
 * checklist, which become the baseline every later check is compared to.
 *
 * `employeeId` and `action: "return"` are still accepted for older API
 * clients; new code calls `POST /inventory/handover`.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "inventory", "write");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw BadRequest("Isi permintaan tidak valid.");
  await connectToDatabase();

  const { id } = body as { id?: string };
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : undefined);

  // Legacy single-endpoint handover.
  if (id && (body.action === "return" || body.employeeId) && !body.name && !body.code) {
    const result = body.action === "return"
      ? await returnAsset(ctx, { inventoryId: id, condition: body.condition })
      : await assignAsset(ctx, { inventoryId: id, employeeId: body.employeeId, condition: body.condition });
    return apiSuccess(result, "Berhasil memproses data inventaris");
  }

  const { categories } = await getCategorySettings();
  const category = text(body.category, 40);
  if (category !== undefined && (!category || !categories.includes(category))) {
    throw BadRequest("Kategori aset tidak dikenal. Tambahkan dulu di menu Kategori.");
  }
  const acquiredAt = body.acquiredAt ? new Date(String(body.acquiredAt)) : undefined;
  if (acquiredAt && !Number.isFinite(acquiredAt.getTime())) throw BadRequest("Tanggal perolehan tidak valid.");

  // Only fields the caller sent are written: an absent field must never wipe
  // the stored value (the database layer removes keys set to undefined).
  const patch: Record<string, unknown> = {};
  const name = text(body.name, 150);
  if (name !== undefined) {
    if (!name) throw BadRequest("Nama aset wajib diisi.");
    patch.name = name;
  }
  if (category !== undefined) patch.category = category;
  if (body.specs !== undefined) patch.specs = sanitizeSpecs(body.specs);
  if (body.location !== undefined) patch.location = text(body.location, 150) ?? "";
  if (body.notes !== undefined) patch.notes = text(body.notes, 1000) ?? "";
  if (body.acquiredAt !== undefined) patch.acquiredAt = acquiredAt ?? null;

  if (id) {
    const before = await Inventory.findById(id).lean<Record<string, unknown> | null>();
    if (!before) throw NotFound("Aset tidak ditemukan.");
    // Condition changes go through a check, handover or return so they always
    // leave a trace; the edit form only changes the description of the asset.
    const asset = await Inventory.findByIdAndUpdate(id, { $set: patch }, { new: true });
    void logActivity({ userId: ctx.user.id, action: "UPDATE_INVENTORY", module: "inventory", before, after: asset?.toObject?.() ?? null, ip: ctx.ip, userAgent: ctx.userAgent });
    return apiSuccess(asset, "Data aset diperbarui");
  }

  const code = text(body.code, 40)?.toUpperCase();
  if (!code || !name || !category) throw BadRequest("Kode aset, nama, dan kategori wajib diisi.");
  if (!/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(code)) throw BadRequest("Kode aset hanya boleh huruf, angka, dan tanda - _ . / (dipakai untuk barcode).");
  if (await Inventory.findOne({ code: new RegExp(`^${escape(code)}$`, "i") }).select("_id").lean()) {
    throw Conflict(`Aset dengan kode ${code} sudah terdaftar.`);
  }

  const condition = parseCondition(body.initialCondition ?? body.condition, "good");
  const initialCheck = {
    condition,
    checklist: sanitizeChecklist(body.initialChecklist),
    reading: parseReading(body.initialReading),
    notes: text(body.initialNotes, 1000) ?? "",
    recordedAt: new Date(),
    recordedBy: ctx.user.id,
  };
  const asset = await Inventory.create({ ...patch, code, condition, initialCheck });
  // The baseline also opens the asset's check timeline.
  await AuditReport.create({
    auditorId: ctx.user.id,
    inventoryId: asset._id,
    auditDate: initialCheck.recordedAt,
    type: "initial",
    period: wibPeriodKey(),
    previousCondition: null,
    condition,
    checklist: initialCheck.checklist,
    specChecks: [],
    reading: initialCheck.reading,
    notes: initialCheck.notes,
    status: "verified",
    findings: [],
  });

  void logActivity({ userId: ctx.user.id, action: "CREATE_INVENTORY", module: "inventory", before: null, after: asset.toObject(), ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(asset, "Aset baru ditambahkan", undefined, 201);
});
