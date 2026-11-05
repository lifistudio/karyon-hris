import crypto from "crypto";
import database, { RecordId } from "@/lib/postgres";
import { connectToDatabase } from "@/lib/db";
import { logActivity } from "@/lib/audit/logger";
import { BadRequest, Conflict, Forbidden, NotFound } from "@/lib/http-error";
import type { GuardContext } from "@/lib/guard";
import { notifyUsers, resolveRecipientForEmployee, resolveRecipientsByUserIds } from "@/lib/notification/notify";
import { INVENTORY_CONDITION_LABELS } from "@/lib/hr/labels";
import { wibPeriodKey } from "@/lib/time";
import { attachmentInputSchema, type AttachmentInput, type StoredAttachment } from "@/lib/attachments";
import { claimAttachments, presentAttachment } from "@/lib/uploads";
import { decodeDataUrl, storageProvider } from "@/lib/storage";
import { sniffFile } from "@/lib/storage/sniff";
import Setting from "@/models/Setting";
import Inventory, { type InventoryCondition } from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import AuditReport, { type CheckType } from "@/models/AuditReport";
import InventoryEvent from "@/models/InventoryEvent";
import Employee from "@/models/Employee";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_TEMPLATES,
  compareCheck,
  conditionWorse,
  describeChanges,
  sanitizeChecklist,
  sanitizeSpecChecks,
  sanitizeTemplate,
  type CategoryTemplate,
  type CheckItem,
  type SpecValue,
  type StoredPhoto,
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

const MAX_PHOTOS = 8;

/** Validates the photo tokens a form sent. Links are refused: evidence must live here. */
function photoInputs(value: unknown): AttachmentInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw BadRequest("Daftar foto tidak valid.");
  if (value.length > MAX_PHOTOS) throw BadRequest(`Maksimal ${MAX_PHOTOS} foto.`);
  return value.map((item) => {
    const parsed = attachmentInputSchema.safeParse(item);
    if (!parsed.success || parsed.data.kind !== "file") throw BadRequest("Foto harus diunggah sebagai berkas.");
    return parsed.data;
  });
}

async function claimPhotos(ctx: GuardContext, inputs: AttachmentInput[], folder: string): Promise<StoredPhoto[]> {
  if (!inputs.length) return [];
  const stored = await claimAttachments(inputs, { context: "inventory", ownerUserId: ctx.user.id, destination: folder });
  return stored.filter((s): s is Extract<StoredAttachment, { kind: "file" }> => s.kind === "file");
}

export const claimInitialPhotos = (ctx: GuardContext, id: string, photos: unknown) => claimPhotos(ctx, photoInputs(photos), `inventory/${id}/initial`);

/** Stored photos as links the browser can open for a few minutes. */
export async function presentPhotos(photos: unknown) {
  if (!Array.isArray(photos)) return [];
  return Promise.all((photos as StoredPhoto[]).map((photo) => presentAttachment(photo)));
}

/** A signature reference as something the browser can show: a signed link, or the legacy data URL. */
export async function presentSignature(value: unknown): Promise<{ href: string; pdf: boolean } | null> {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("data:")) return { href: value, pdf: value.startsWith("data:application/pdf") };
  return { href: await storageProvider.getSignedUrl(value, 900), pdf: value.endsWith(".pdf") };
}

/**
 * What a read grant covers. Assets belong to the company, so a branch or
 * division grant sees the assets its own people hold, and `self` sees none of
 * the register (employees use /inventory/self).
 */
export async function visibleAssetIds(ctx: GuardContext): Promise<RecordId[] | null> {
  if (ctx.permission.scope === "all") return null;
  if (ctx.permission.scope !== "branch" && ctx.permission.scope !== "division") throw Forbidden("Daftar aset perusahaan hanya untuk petugas inventaris.");
  const unit = ctx.permission.scope === "branch" ? { branchId: ctx.user.branchId } : { divisionId: ctx.user.divisionId };
  if (!Object.values(unit)[0]) return [];
  const people = await Employee.distinct("_id", unit);
  const open = await InventoryAssignment.find({ employeeId: { $in: people }, status: { $in: [...OPEN_STATUSES] } }).select("inventoryId").lean<Array<{ inventoryId: RecordId }>>();
  return open.map((a) => a.inventoryId);
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
  photos?: unknown;
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
  const photoTokens = photoInputs(input.photos);

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
      || specChecks.some((s) => !s.matches && !s.replaced)
      || readingDropped;
    const changes = describeChanges({ checklist, specChecks });

    const previousCondition = asset.condition as InventoryCondition;
    const photos = await claimPhotos(ctx, photoTokens, `inventory/${id}/checks`);
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
      photos,
      reading,
      holderEmployeeId: holder?.employeeId ?? null,
      notes,
      status: flagged ? "flagged" : changes.length ? "changed" : "verified",
      findings,
      changes,
    });

    // A replaced part moves the current record; the baseline and any signed BAST keep the old value.
    const specs = [...((asset.specs ?? []) as SpecValue[])];
    for (const spec of specChecks.filter((s) => s.replaced)) {
      const index = specs.findIndex((s) => s.label === spec.label);
      if (index >= 0) specs[index] = { label: spec.label, value: spec.actual! };
      else specs.push({ label: spec.label, value: spec.actual! });
      await InventoryEvent.create({
        inventoryId: id, type: "replacement", component: spec.label, fromValue: spec.expected, toValue: spec.actual,
        description: spec.note ?? "", checkId: report._id, actorUserId: ctx.user.id, conditionBefore: previousCondition, conditionAfter: condition,
      });
    }
    for (const item of checklist.filter((c) => c.result === "repaired" || c.result === "replaced")) {
      await InventoryEvent.create({
        inventoryId: id, type: item.result === "repaired" ? "repair" : "replacement", component: item.label,
        description: item.note ?? "", checkId: report._id, actorUserId: ctx.user.id, conditionBefore: previousCondition, conditionAfter: condition,
      });
    }
    if (specChecks.some((s) => s.replaced)) asset.specs = specs;
    asset.condition = condition;
    await asset.save();

    audit(ctx, "PHYSICAL_AUDIT_ASSET", { code: asset.code, condition: previousCondition }, { code: asset.code, condition, type, period, findings, changes, reportId: String(report._id) });
    return report;
  });
}

/* ------------------------------------------------------------------ */
/* Repairs, replacements and reports between checks                     */
/* ------------------------------------------------------------------ */

interface MaintenanceInput {
  inventoryId: unknown;
  type?: unknown;
  component?: unknown;
  toValue?: unknown;
  description?: unknown;
  vendor?: unknown;
  cost?: unknown;
  eventDate?: unknown;
  condition?: unknown;
  photos?: unknown;
}

/**
 * GA records work done on an asset. A replacement of a recorded specification
 * also moves that specification, so the next check compares against what is
 * really inside the asset now.
 */
export async function recordMaintenance(ctx: GuardContext, input: MaintenanceInput) {
  const id = assetId(input.inventoryId);
  const type = input.type === "replacement" ? "replacement" : input.type === "repair" ? "repair" : null;
  if (!type) throw BadRequest("Jenis catatan harus perbaikan atau penggantian.");
  const description = note(input.description, 1000);
  const component = note(input.component, 80);
  if (description.length < 5) throw BadRequest("Jelaskan pekerjaan yang dilakukan (minimal 5 karakter).");
  const toValue = note(input.toValue, 200);
  const cost = input.cost === undefined || input.cost === null || input.cost === "" ? null : Number(input.cost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 1e12)) throw BadRequest("Biaya tidak valid.");
  const eventDate = input.eventDate ? new Date(String(input.eventDate)) : new Date();
  if (!Number.isFinite(eventDate.getTime()) || eventDate.getTime() > Date.now() + 86_400_000) throw BadRequest("Tanggal pekerjaan tidak valid.");
  const photoTokens = photoInputs(input.photos);

  await connectToDatabase();
  return database.transaction(async () => {
    await lockAsset(id);
    const asset = await Inventory.findById(id);
    if (!asset) throw NotFound("Aset inventaris tidak ditemukan.");
    const conditionBefore = asset.condition as InventoryCondition;
    const conditionAfter = parseCondition(input.condition, conditionBefore);

    const specs = [...((asset.specs ?? []) as SpecValue[])];
    const index = specs.findIndex((s) => s.label === component);
    const fromValue = index >= 0 ? specs[index].value : "";
    if (type === "replacement" && index >= 0) {
      if (!toValue) throw BadRequest(`Isi nilai ${component} yang baru.`);
      specs[index] = { label: component, value: toValue };
      asset.specs = specs;
    }
    const event = await InventoryEvent.create({
      inventoryId: id, type, component, fromValue, toValue, description,
      vendor: note(input.vendor, 150), cost, eventDate,
      photos: await claimPhotos(ctx, photoTokens, `inventory/${id}/events`),
      conditionBefore, conditionAfter, actorUserId: ctx.user.id,
    });
    asset.condition = conditionAfter;
    await asset.save();
    // Work done on an asset answers the reports waiting on it.
    await InventoryEvent.updateMany({ inventoryId: id, type: "employee_report", resolvedAt: null }, { $set: { resolvedAt: new Date() } });
    audit(ctx, "RECORD_INVENTORY_MAINTENANCE", { code: asset.code, condition: conditionBefore }, { code: asset.code, type, component, fromValue, toValue, condition: conditionAfter });
    return event;
  });
}

/** Keeps a trace of a specification corrected from the edit form. */
export async function logSpecChanges(ctx: GuardContext, inventoryId: string, changes: Array<{ label: string; from: string; to: string }>) {
  for (const change of changes) {
    await InventoryEvent.create({
      inventoryId, type: "spec_update", component: change.label, fromValue: change.from, toValue: change.to,
      description: "Diubah dari form data aset", actorUserId: ctx.user.id,
    });
  }
}

/** The holder tells GA something is wrong with an asset they signed for. */
export async function reportAssetIssue(ctx: GuardContext & { employeeId: string }, input: { assignmentId: unknown; note: unknown; photos?: unknown }) {
  if (!RecordId.isValid(input.assignmentId)) throw BadRequest("ID serah terima tidak valid.");
  const description = note(input.note, 1000);
  if (description.length < 5) throw BadRequest("Jelaskan kondisi aset (minimal 5 karakter).");
  const photoTokens = photoInputs(input.photos);

  await connectToDatabase();
  const assignment = await InventoryAssignment.findOne({ _id: String(input.assignmentId), employeeId: ctx.employeeId, status: "active" });
  if (!assignment) throw NotFound("Aset ini tidak tercatat sedang Anda pegang.");
  const id = String(assignment.inventoryId);
  const asset = await Inventory.findById(id).select("name code condition").lean<{ name: string; code: string; condition: InventoryCondition } | null>();
  const event = await InventoryEvent.create({
    inventoryId: id, type: "employee_report", description, employeeId: ctx.employeeId, actorUserId: ctx.user.id,
    photos: await claimPhotos(ctx, photoTokens, `inventory/${id}/reports`), conditionBefore: asset?.condition ?? null,
  });
  audit(ctx, "REPORT_INVENTORY_ISSUE", null, { code: asset?.code, description });
  notifyQuietly(async () => {
    if (!assignment.assignedBy) return;
    await notifyUsers(await resolveRecipientsByUserIds([assignment.assignedBy]), {
      kind: "inventory",
      title: "Karyawan melaporkan masalah aset",
      body: `${asset?.name ?? "Aset"} (${asset?.code ?? "-"}): ${description}`,
      href: "/admin/inventory",
      refType: "InventoryEvent",
      refId: String(event._id),
    });
  });
  return event;
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
  photos?: unknown;
  /** Moves a held asset straight to `employeeId`, closing the current handover. */
  transfer?: unknown;
}

export async function assignAsset(ctx: GuardContext, input: HandoverInput) {
  const id = assetId(input.inventoryId);
  if (!RecordId.isValid(input.employeeId)) throw BadRequest("Pilih karyawan penerima.");
  const employeeId = String(input.employeeId);
  const photoTokens = photoInputs(input.photos);

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
      .populate("employeeId", "name");
    if (open) {
      const holderName = (open.employeeId as unknown as { _id?: RecordId; name?: string } | null)?.name ?? "karyawan lain";
      if (open.status !== "active") throw Conflict(`Aset sedang dalam proses serah terima ke ${holderName}. Batalkan serah terima itu dulu.`);
      if (input.transfer !== true) throw Conflict(`Aset masih dipegang ${holderName}. Terima pengembalian dulu sebelum menyerahkan ke karyawan lain.`);
      if (String((open.employeeId as unknown as { _id?: RecordId })?._id ?? open.employeeId) === employeeId) throw Conflict(`Aset sudah dipegang ${holderName}.`);
      const before = open.toObject();
      open.status = "returned";
      open.returnDate = new Date();
      open.returnCondition = condition;
      open.returnChecklist = sanitizeChecklist(input.checklist);
      open.returnReading = parseReading(input.reading);
      open.returnNotes = `Dipindahkan langsung ke ${employee.name}`;
      open.receivedBy = ctx.user.id as unknown as RecordId;
      await open.save();
      audit(ctx, "RETURN_INVENTORY", before, open.toObject());
    }

    const assignment = await InventoryAssignment.create({
      inventoryId: id,
      employeeId,
      assignedBy: ctx.user.id,
      handoverDate: new Date(),
      handoverCondition: condition,
      handoverChecklist: sanitizeChecklist(input.checklist),
      handoverSpecs: asset.specs ?? [],
      handoverPhotos: await claimPhotos(ctx, photoTokens, `inventory/${id}/handover`),
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
  photos?: unknown;
}

/** GA receives the asset back; its condition at return becomes the current one. */
export async function returnAsset(ctx: GuardContext, input: ReturnInput) {
  const id = assetId(input.inventoryId);
  const photoTokens = photoInputs(input.photos);
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
    assignment.returnPhotos = await claimPhotos(ctx, photoTokens, `inventory/${id}/return`);
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

const SIGNATURE_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

/** What a signature attests to, hashed with the signature file itself. */
function signedDigest(assignment: { _id: unknown; inventoryId: unknown; employeeId: unknown; handoverCondition?: string; handoverChecklist?: unknown; handoverSpecs?: unknown; handoverNotes?: string }, signature: Buffer, signedAt: Date) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: String(assignment._id),
    inventoryId: String(assignment.inventoryId),
    employeeId: String(assignment.employeeId),
    condition: assignment.handoverCondition,
    checklist: assignment.handoverChecklist,
    specs: assignment.handoverSpecs,
    notes: assignment.handoverNotes,
    signedAt: signedAt.toISOString(),
  })).update(signature).digest("hex");
}

export async function signHandover(ctx: GuardContext & { employeeId: string }, input: { assignmentId: unknown; signatureData: unknown; note?: unknown }) {
  if (!RecordId.isValid(input.assignmentId)) throw BadRequest("ID serah terima tidak valid.");
  const signature = typeof input.signatureData === "string" ? input.signatureData : "";
  let decoded: { buffer: Buffer; mime: string; ext: string };
  try {
    decoded = decodeDataUrl(signature, SIGNATURE_MIME);
  } catch {
    throw BadRequest("Tanda tangan harus berupa gambar (PNG/JPG/WebP) atau PDF.");
  }
  if (decoded.buffer.byteLength > MAX_SIGNATURE_BYTES) throw BadRequest("Berkas tanda tangan maksimal 5 MB.");
  // The declared type comes from the browser; the bytes decide.
  const sniffed = sniffFile(decoded.buffer);
  if (!sniffed || sniffed.mime !== decoded.mime) throw BadRequest("Isi berkas tanda tangan tidak sesuai dengan jenisnya.");

  await connectToDatabase();
  const owned = await InventoryAssignment.findOne({ _id: String(input.assignmentId), employeeId: ctx.employeeId }).select("inventoryId").lean<{ inventoryId: RecordId } | null>();
  if (!owned) throw NotFound("Serah terima tidak ditemukan atau sudah ditandatangani.");

  const assignment = await database.transaction(async () => {
    // Same lock as GA's cancel: a BAST cannot be signed while it is being withdrawn.
    await lockAsset(String(owned.inventoryId));
    const row = await InventoryAssignment.findOne({ _id: String(input.assignmentId), employeeId: ctx.employeeId, status: "pending_handover" });
    if (!row) throw NotFound("Serah terima tidak ditemukan atau sudah ditandatangani.");
    const before = row.toObject();
    const signedAt = new Date();
    row.signatureUrl = await storageProvider.upload(decoded.buffer, `inventory-bast/${ctx.employeeId}/${row._id}${sniffed.ext}`, sniffed.mime);
    row.signedAt = signedAt;
    row.signedVia = "portal";
    row.signedIp = ctx.ip;
    row.signedUserAgent = ctx.userAgent.slice(0, 300);
    row.signatureHash = signedDigest(row, decoded.buffer, signedAt);
    row.employeeNote = note(input.note, 300);
    row.status = "active";
    await row.save();
    audit(ctx, "SIGN_INVENTORY_BAST", { ...before, signatureUrl: undefined }, { _id: String(row._id), status: "active", signedAt, signatureHash: row.signatureHash });
    return row;
  });

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

/**
 * GA files a BAST the employee signed on paper. This is the way through for
 * staff without a portal account, or a device that cannot open it.
 */
export async function recordPaperBast(ctx: GuardContext, input: { inventoryId: unknown; document: unknown }) {
  const id = assetId(input.inventoryId);
  const [token] = photoInputs(input.document === undefined || input.document === null ? [] : [input.document]);
  if (!token) throw BadRequest("Unggah BAST yang sudah ditandatangani.");

  await connectToDatabase();
  return database.transaction(async () => {
    await lockAsset(id);
    const row = await InventoryAssignment.findOne({ inventoryId: id, status: "pending_handover" });
    if (!row) throw BadRequest("Tidak ada serah terima yang menunggu tanda tangan untuk aset ini.");
    const before = row.toObject();
    const [file] = await claimPhotos(ctx, [token], `inventory-bast/${row.employeeId}`);
    const { buffer } = await storageProvider.read(file.key);
    const signedAt = new Date();
    row.signatureUrl = file.key;
    row.signedAt = signedAt;
    row.signedVia = "paper";
    row.signedIp = ctx.ip;
    row.signedUserAgent = ctx.userAgent.slice(0, 300);
    row.signatureHash = signedDigest(row, buffer, signedAt);
    row.status = "active";
    await row.save();
    audit(ctx, "RECORD_PAPER_BAST", { ...before, signatureUrl: undefined }, { _id: String(row._id), status: "active", signedAt, signatureHash: row.signatureHash });
    return row;
  });
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
