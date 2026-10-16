import database, { RecordId } from "@/lib/postgres";
import { connectToDatabase } from "@/lib/db";
import { logActivity } from "@/lib/audit/logger";
import { BadRequest, Conflict, NotFound } from "@/lib/http-error";
import type { GuardContext } from "@/lib/guard";
import { notifyUsers, resolveRecipientForEmployee, resolveRecipientsByUserIds } from "@/lib/notification/notify";
import { INVENTORY_CONDITION_LABELS } from "@/lib/hr/labels";
import { wibPeriodKey } from "@/lib/time";
import Setting from "@/models/Setting";
import Inventory, { type InventoryCondition } from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import AuditReport, { type CheckType } from "@/models/AuditReport";
import Employee from "@/models/Employee";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_TEMPLATES,
  compareCheck,
  conditionWorse,
  sanitizeChecklist,
  sanitizeSpecChecks,
  sanitizeTemplate,
  type CategoryTemplate,
  type CheckItem,
} from "./templates";

/**
 * Inventory workflow rules, shared by the admin API, the employee portal and
 * the legacy `POST /inventory` body.
 *
 * An asset has at most one open handover (waiting for a signature, signed, or
 * disputed). Every state change runs under a per-asset advisory lock so two GA
 * officers clicking at the same moment cannot hand one laptop to two people.
 */

export const OPEN_STATUSES = ["pending_handover", "active", "disputed"] as const;
const CONDITIONS: InventoryCondition[] = ["good", "damaged", "lost"];

const CATEGORY_KEY = "inventory_categories";
const TEMPLATE_KEY = "inventory_category_templates";

export function parseCondition(value: unknown, fallback?: InventoryCondition): InventoryCondition {
  if (CONDITIONS.includes(value as InventoryCondition)) return value as InventoryCondition;
  if (fallback) return fallback;
  throw BadRequest("Kondisi aset harus Baik, Rusak, atau Hilang.");
}

export function parseReading(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw BadRequest("Angka pembacaan (misalnya odometer) tidak valid.");
  return n;
}

const note = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function audit(ctx: GuardContext, action: string, before: unknown, after: unknown) {
  void logActivity({
    userId: ctx.user.id,
    action,
    module: "inventory",
    before: (before ?? null) as Record<string, unknown> | null,
    after: (after ?? null) as Record<string, unknown> | null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

/** Never lets a notification outage fail the inventory action that caused it. */
function notifyQuietly(work: () => Promise<void>) {
  void work().catch((err) => console.error("Notifikasi inventaris gagal dikirim:", err));
}

async function lockAsset(inventoryId: string) {
  await database.connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory:${inventoryId}`]);
}

function assetId(value: unknown): string {
  if (!RecordId.isValid(value)) throw BadRequest("ID aset tidak valid.");
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Categories and templates                                             */
/* ------------------------------------------------------------------ */

export async function getCategorySettings(): Promise<{ categories: string[]; templates: Record<string, CategoryTemplate> }> {
  await connectToDatabase();
  const [cat, tpl] = await Promise.all([
    Setting.findOne({ key: CATEGORY_KEY }).lean<{ value?: unknown } | null>(),
    Setting.findOne({ key: TEMPLATE_KEY }).lean<{ value?: unknown } | null>(),
  ]);
  const categories = Array.isArray(cat?.value) && cat.value.length ? (cat.value as string[]) : DEFAULT_CATEGORIES;
  const stored = (tpl?.value && typeof tpl.value === "object" ? tpl.value : {}) as Record<string, unknown>;
  const templates: Record<string, CategoryTemplate> = {};
  for (const key of categories) templates[key] = sanitizeTemplate(stored[key], DEFAULT_TEMPLATES[key] ?? DEFAULT_TEMPLATES.other);
  return { categories, templates };
}

export async function saveCategorySettings(ctx: GuardContext, input: { categories: unknown; templates?: unknown }) {
  if (!Array.isArray(input.categories)) throw BadRequest("Data kategori harus berupa daftar.");
  // Keys are stored on each asset, so keep them short, unique and non-empty.
  const categories = [...new Set(input.categories.filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 40)).filter(Boolean))];
  if (!categories.length || categories.length > 50) throw BadRequest("Isi 1 sampai 50 kategori.");
  const raw = (input.templates && typeof input.templates === "object" ? input.templates : {}) as Record<string, unknown>;
  const templates: Record<string, CategoryTemplate> = {};
  for (const key of categories) templates[key] = sanitizeTemplate(raw[key], DEFAULT_TEMPLATES[key] ?? DEFAULT_TEMPLATES.other);

  await connectToDatabase();
  const before = await getCategorySettings();
  await Setting.findOneAndUpdate(
    { key: CATEGORY_KEY },
    { $set: { value: categories, description: "Daftar kategori barang inventaris GA" } },
    { upsert: true, new: true }
  );
  await Setting.findOneAndUpdate(
    { key: TEMPLATE_KEY },
    { $set: { value: templates, description: "Spesifikasi dan daftar periksa per kategori inventaris" } },
    { upsert: true, new: true }
  );
  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_INVENTORY_CATEGORIES",
    module: "settings",
    before: before as unknown as Record<string, unknown>,
    after: { categories, templates },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { categories, templates };
}

/* ------------------------------------------------------------------ */
/* Checks                                                               */
/* ------------------------------------------------------------------ */

interface CheckInput {
  inventoryId: unknown;
  type?: unknown;
  condition: unknown;
  checklist?: unknown;
  specChecks?: unknown;
  reading?: unknown;
  notes?: unknown;
}

/**
 * Records a physical check, compares it against the asset's baseline (the
 * initial check) and the previous check, and moves the asset's current
 * condition to what was found.
 */
export async function recordCheck(ctx: GuardContext, input: CheckInput) {
  const id = assetId(input.inventoryId);
  const type: CheckType = input.type === "monthly" ? "monthly" : "incidental";
  const condition = parseCondition(input.condition);
  const checklist = sanitizeChecklist(input.checklist);
  const specChecks = sanitizeSpecChecks(input.specChecks);
  const reading = parseReading(input.reading);
  const notes = note(input.notes, 1000);
  const period = wibPeriodKey();

  await connectToDatabase();
  return database.transaction(async () => {
    await lockAsset(id);
    const asset = await Inventory.findById(id);
    if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");

    if (type === "monthly") {
      const done = await AuditReport.findOne({ inventoryId: id, type: "monthly", period }).select("_id auditDate").lean<{ auditDate?: Date } | null>();
      if (done) throw Conflict("Aset ini sudah dicek untuk bulan ini. Pilih jenis pengecekan insidental bila perlu dicek ulang.");
    }

    const holder = await InventoryAssignment.findOne({ inventoryId: id, status: { $in: [...OPEN_STATUSES] } })
      .select("employeeId").lean<{ employeeId?: RecordId } | null>();
    const previous = await AuditReport.findOne({ inventoryId: id }).sort({ auditDate: -1 })
      .select("condition checklist reading").lean<{ condition?: string; checklist?: CheckItem[]; reading?: number | null } | null>();

    // The baseline is the registration record; assets registered before
    // baselines existed fall back to the previous check.
    const baseline = asset.initialCheck ?? previous ?? null;
    const findings = compareCheck({ condition, checklist, specChecks }, baseline, INVENTORY_CONDITION_LABELS);
    const readingDropped = reading !== null && previous?.reading != null && reading < previous.reading;
    if (readingDropped) findings.push(`Pembacaan ${reading} lebih kecil dari pengecekan sebelumnya (${previous?.reading})`);
    // A repaired asset (Rusak → Baik) is a change worth showing, not a problem.
    const flagged = conditionWorse(condition, baseline?.condition)
      || (!baseline && condition !== "good")
      || checklist.some((c) => c.result === "issue")
      || specChecks.some((s) => !s.matches)
      || readingDropped;

    const previousCondition = asset.condition as InventoryCondition;
    const report = await AuditReport.create({
      auditorId: ctx.user.id,
      inventoryId: id,
      auditDate: new Date(),
      type,
      period,
      previousCondition,
      condition,
      checklist,
      specChecks,
      reading,
      holderEmployeeId: holder?.employeeId ?? null,
      notes,
      status: flagged ? "flagged" : "verified",
      findings,
    });

    asset.condition = condition;
    await asset.save();

    audit(ctx, "PHYSICAL_AUDIT_ASSET", { code: asset.code, condition: previousCondition }, { code: asset.code, condition, type, period, findings, reportId: String(report._id) });
    return report;
  });
}

/* ------------------------------------------------------------------ */
/* Handover (BAST)                                                      */
/* ------------------------------------------------------------------ */

interface HandoverInput {
  inventoryId: unknown;
  employeeId: unknown;
  condition?: unknown;
  checklist?: unknown;
  reading?: unknown;
  notes?: unknown;
}

export async function assignAsset(ctx: GuardContext, input: HandoverInput) {
  const id = assetId(input.inventoryId);
  if (!RecordId.isValid(input.employeeId)) throw BadRequest("Pilih karyawan penerima.");
  const employeeId = String(input.employeeId);

  await connectToDatabase();
  const result = await database.transaction(async () => {
    await lockAsset(id);
    const asset = await Inventory.findById(id);
    if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");
    const condition = parseCondition(input.condition, asset.condition as InventoryCondition);
    if (condition === "lost" || asset.condition === "lost") throw BadRequest("Aset berstatus hilang tidak dapat diserahkan. Catat pengecekan bila aset sudah ditemukan.");

    const employee = await Employee.findById(employeeId).select("_id name status").lean<{ _id: RecordId; name: string; status?: string } | null>();
    if (!employee) throw NotFound("Karyawan tidak ditemukan.");
    if (employee.status === "resigned" || employee.status === "suspended") throw BadRequest(`${employee.name} tidak berstatus aktif sehingga tidak dapat menerima aset.`);

    const open = await InventoryAssignment.findOne({ inventoryId: id, status: { $in: [...OPEN_STATUSES] } })
      .populate("employeeId", "name").lean<{ status: string; employeeId?: { name?: string } } | null>();
    if (open) {
      const holderName = open.employeeId?.name ?? "karyawan lain";
      throw Conflict(open.status === "active"
        ? `Aset masih dipegang ${holderName}. Terima pengembalian dulu sebelum menyerahkan ke karyawan lain.`
        : `Aset sedang dalam proses serah terima ke ${holderName}. Batalkan serah terima itu dulu.`);
    }

    const assignment = await InventoryAssignment.create({
      inventoryId: id,
      employeeId,
      assignedBy: ctx.user.id,
      handoverDate: new Date(),
      handoverCondition: condition,
      handoverChecklist: sanitizeChecklist(input.checklist),
      handoverReading: parseReading(input.reading),
      handoverNotes: note(input.notes),
      status: "pending_handover",
    });
    if (asset.condition !== condition) {
      asset.condition = condition;
      await asset.save();
    }
    audit(ctx, "ASSIGN_INVENTORY", null, assignment.toObject());
    return { assignment, asset, employee };
  });

  notifyQuietly(async () => {
    const recipients = await resolveRecipientForEmployee(employeeId);
    await notifyUsers(recipients, {
      kind: "inventory",
      title: "Aset menunggu tanda tangan BAST",
      body: `${result.asset.name} (${result.asset.code}) diserahkan kepada Anda. Periksa kondisinya lalu tanda tangani BAST di portal.`,
      href: "/portal/inventory",
      refType: "InventoryAssignment",
      refId: String(result.assignment._id),
    });
  });
  return result.assignment;
}

interface ReturnInput {
  inventoryId: unknown;
  condition?: unknown;
  checklist?: unknown;
  reading?: unknown;
  notes?: unknown;
}

/** GA receives the asset back; its condition at return becomes the current one. */
export async function returnAsset(ctx: GuardContext, input: ReturnInput) {
  const id = assetId(input.inventoryId);
  await connectToDatabase();
  return database.transaction(async () => {
    await lockAsset(id);
    const asset = await Inventory.findById(id);
    if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");
    const assignment = await InventoryAssignment.findOne({ inventoryId: id, status: "active" });
    if (!assignment) {
      const pending = await InventoryAssignment.findOne({ inventoryId: id, status: { $in: ["pending_handover", "disputed"] } }).select("_id").lean();
      throw BadRequest(pending
        ? "Serah terima belum ditandatangani karyawan. Gunakan Batalkan serah terima, bukan pengembalian."
        : "Aset ini tidak sedang dipegang karyawan.");
    }
    const condition = parseCondition(input.condition, asset.condition as InventoryCondition);
    const before = assignment.toObject();
    assignment.status = "returned";
    assignment.returnDate = new Date();
    assignment.returnCondition = condition;
    assignment.returnChecklist = sanitizeChecklist(input.checklist);
    assignment.returnReading = parseReading(input.reading);
    assignment.returnNotes = note(input.notes);
    assignment.receivedBy = ctx.user.id as unknown as RecordId;
    await assignment.save();
    asset.condition = condition;
    await asset.save();
    audit(ctx, "RETURN_INVENTORY", before, assignment.toObject());
    return assignment;
  });
}

/** Withdraws a handover the employee has not signed yet (or reported as wrong). */
export async function cancelHandover(ctx: GuardContext, input: { inventoryId: unknown; reason?: unknown }) {
  const id = assetId(input.inventoryId);
  await connectToDatabase();
  return database.transaction(async () => {
    await lockAsset(id);
    const assignment = await InventoryAssignment.findOne({ inventoryId: id, status: { $in: ["pending_handover", "disputed"] } });
    if (!assignment) throw BadRequest("Tidak ada serah terima yang menunggu tanda tangan untuk aset ini.");
    const before = assignment.toObject();
    assignment.status = "cancelled";
    assignment.cancelReason = note(input.reason, 300);
    await assignment.save();
    audit(ctx, "CANCEL_INVENTORY_HANDOVER", before, assignment.toObject());
    return assignment;
  });
}

/* ------------------------------------------------------------------ */
/* Employee portal                                                      */
/* ------------------------------------------------------------------ */

const DATA_URL = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

export async function signHandover(ctx: GuardContext & { employeeId: string }, input: { assignmentId: unknown; signatureData: unknown; note?: unknown }) {
  if (!RecordId.isValid(input.assignmentId)) throw BadRequest("ID serah terima tidak valid.");
  const signature = typeof input.signatureData === "string" ? input.signatureData : "";
  if (!DATA_URL.test(signature)) throw BadRequest("Tanda tangan harus berupa gambar (PNG/JPG/WebP) atau PDF.");
  if (signature.length * 0.75 > MAX_SIGNATURE_BYTES) throw BadRequest("Berkas tanda tangan maksimal 5 MB.");

  await connectToDatabase();
  const assignment = await InventoryAssignment.findOne({ _id: String(input.assignmentId), employeeId: ctx.employeeId, status: "pending_handover" });
  if (!assignment) throw NotFound("Serah terima tidak ditemukan atau sudah ditandatangani.");
  const before = assignment.toObject();
  assignment.signatureUrl = signature;
  assignment.signedAt = new Date();
  assignment.employeeNote = note(input.note, 300);
  assignment.status = "active";
  await assignment.save();
  audit(ctx, "SIGN_INVENTORY_BAST", { ...before, signatureUrl: undefined }, { _id: String(assignment._id), status: "active", signedAt: assignment.signedAt });

  notifyQuietly(async () => {
    if (!assignment.assignedBy) return;
    const asset = await Inventory.findById(assignment.inventoryId).select("name code").lean<{ name: string; code: string } | null>();
    await notifyUsers(await resolveRecipientsByUserIds([assignment.assignedBy]), {
      kind: "inventory",
      title: "BAST sudah ditandatangani",
      body: `${asset?.name ?? "Aset"} (${asset?.code ?? "-"}) diterima karyawan dan kini tercatat dipegang.`,
      href: "/admin/inventory",
      refType: "InventoryAssignment",
      refId: String(assignment._id),
      emailOptOut: true,
    });
  });
  return assignment;
}

/** The employee says the asset does not match what the BAST describes. */
export async function disputeHandover(ctx: GuardContext & { employeeId: string }, input: { assignmentId: unknown; note: unknown }) {
  if (!RecordId.isValid(input.assignmentId)) throw BadRequest("ID serah terima tidak valid.");
  const reason = note(input.note, 500);
  if (reason.length < 5) throw BadRequest("Jelaskan apa yang tidak sesuai (minimal 5 karakter).");

  await connectToDatabase();
  const assignment = await InventoryAssignment.findOne({ _id: String(input.assignmentId), employeeId: ctx.employeeId, status: "pending_handover" });
  if (!assignment) throw NotFound("Serah terima tidak ditemukan atau sudah diproses.");
  const before = assignment.toObject();
  assignment.status = "disputed";
  assignment.disputeNote = reason;
  await assignment.save();
  audit(ctx, "DISPUTE_INVENTORY_BAST", before, assignment.toObject());

  notifyQuietly(async () => {
    if (!assignment.assignedBy) return;
    const asset = await Inventory.findById(assignment.inventoryId).select("name code").lean<{ name: string; code: string } | null>();
    await notifyUsers(await resolveRecipientsByUserIds([assignment.assignedBy]), {
      kind: "inventory",
      title: "Karyawan melaporkan aset tidak sesuai",
      body: `${asset?.name ?? "Aset"} (${asset?.code ?? "-"}): ${reason}`,
      href: "/admin/inventory",
      refType: "InventoryAssignment",
      refId: String(assignment._id),
    });
  });
  return assignment;
}
