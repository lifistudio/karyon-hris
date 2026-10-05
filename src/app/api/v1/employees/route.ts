import { z } from "zod";
import bcrypt from "bcryptjs";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requirePermission,
  parseBody,
  scopeFilter,
  pagination,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { decryptOrEmpty, encryptOnce, isUnreadable, maskTail } from "@/lib/crypto";
import { getBranchAccess, isBranchUsable, INACTIVE_BRANCH_MESSAGE } from "@/lib/licensing/branch-access";
import { getSettings } from "@/lib/settings";
import Employee from "@/models/Employee";
import User from "@/models/User";
import Counter from "@/models/Counter";
import Role from "@/models/Role";
import { missingProfileFields } from "@/lib/hr/employee-completeness";
import { initialPasswordFor } from "@/lib/auth/initial-password";

/**
 * Employee master data.
 *
 * NIK, NPWP, and bank account numbers are encrypted at rest. They are decrypted
 * only for callers holding a company-wide read scope; everyone else sees a
 * masked tail, which is enough to confirm a record without exposing the number.
 */

const SENSITIVE_FIELDS = ["nik", "npwp", "bankAccount.accountNumber"] as const;

const addressSchema = z
  .object({
    street: z.string().trim().max(200).default(""),
    subdistrict: z.string().trim().max(100).default(""),
    city: z.string().trim().max(100).default(""),
    province: z.string().trim().max(100).default(""),
    country: z.string().trim().max(100).default("Indonesia"),
  })
  .partial()
  .optional();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");
const optionalObjectId = z.union([objectId, z.literal(""), z.null()]).optional();

const employeeSchema = z.object({
  id: optionalObjectId,
  name: z.string().trim().min(3, "Nama lengkap minimal 3 karakter").max(150),
  nik: z
    .string()
    .trim()
    .regex(/^\d{16}$/, "NIK harus 16 digit angka")
    .or(z.literal(""))
    .optional(),
  birthPlace: z.string().trim().max(100).optional(),
  birthDate: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  religion: z.string().trim().max(50).optional(),
  maritalStatus: z.string().trim().max(50).optional(),
  ktpAddress: addressSchema,
  domicileAddress: addressSchema,
  personalEmail: z.string().trim().toLowerCase().email("Email pribadi tidak valid").or(z.literal("")).optional(),
  officeEmail: z.string().trim().toLowerCase().email("Email kantor tidak valid"),
  phone: z.string().trim().regex(/^[0-9+()\-\s]{8,20}$/, "Nomor telepon tidak valid").or(z.literal("")).optional(),
  socialMedia: z.record(z.string(), z.string().max(200)).optional(),
  npwp: z.string().trim().max(40).optional(),
  taxStatus: z.string().trim().max(10).optional(),
  bpjsKesehatan: z.string().trim().max(40).optional(),
  bpjsKetenagakerjaan: z.string().trim().max(40).optional(),
  bankAccount: z
    .object({
      bankName: z.string().trim().max(60).default(""),
      accountNumber: z.string().trim().max(40).default(""),
      accountHolder: z.string().trim().max(120).default(""),
    })
    .partial()
    .optional(),
  branchId: optionalObjectId,
  divisionId: optionalObjectId,
  positionId: optionalObjectId,
  supervisorId: optionalObjectId,
  storeManagerId: optionalObjectId,
  areaManagerId: optionalObjectId,
  joinDate: z.string().optional(),
  employmentStatus: z.enum(["probation", "pkwt", "pkwtt", "magang", "harian_lepas", "paruh_waktu", "outsource", "lainnya"]).optional(),
  status: z.enum(["active", "onboarding", "suspended", "resigned"]).optional(),
  roleId: optionalObjectId,
  password: z.string().optional(),
});

/** A `YYYY-MM-DD` from a date picker is a WIB calendar day, not UTC midnight. */
function toWibDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+07:00`) : new Date(value);
}

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "employees", "read");
  const fallback = perm.allowed ? perm : await checkPermission(ctx.user.id, "attendance", "read");
  if (!fallback.allowed) throw Forbidden("Anda tidak memiliki akses ke data karyawan.");

  const sp = new URL(req.url).searchParams;
  const { page, limit, skip } = pagination(req, 200, 500);
  const search = sp.get("q")?.trim();
  const status = sp.get("status");

  const filter: Record<string, unknown> = {
    ...scopeFilter({ ...ctx, permission: fallback }, {
      employee: "_id",
      branch: "branchId",
      division: "divisionId",
    }),
  };
  if (status && status !== "all") filter.status = status;
  // Hired from recruitment and not yet completed by HR.
  if (sp.get("newHire") === "1") filter.isNewHire = true;
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: safe, $options: "i" } },
      { employeeId: { $regex: safe, $options: "i" } },
      { officeEmail: { $regex: safe, $options: "i" } },
    ];
  }

  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .select(perm.allowed ? "" : "employeeId name branchId divisionId positionId status")
      .populate("branchId", "name")
      .populate("divisionId", "name")
      .populate("positionId", "name")
      .populate("supervisorId", "name employeeId")
      .populate("storeManagerId", "name employeeId")
      .populate("areaManagerId", "name employeeId")
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter),
  ]);

  const canSeeFullPii = fallback.scope === "all";
  const data = employees.map((e) => ({
    ...revealSensitive(e, canSeeFullPii),
    ...(e.isNewHire ? { missingFields: missingProfileFields(e as Parameters<typeof missingProfileFields>[0]) } : {}),
  }));

  return apiSuccess(data, "Berhasil memuat data karyawan", { page, limit, total });
});

/** Decrypts or masks the protected fields depending on the caller's scope. */
function revealSensitive(doc: Record<string, unknown>, full: boolean) {
  const bank = doc.bankAccount as { bankName?: string; accountNumber?: string; accountHolder?: string } | undefined;
  // One record that cannot be opened (key mismatch, damaged value) must not fail
  // the whole list: it comes back empty and flagged; re-entering it re-encrypts it.
  let unreadable = false;
  const open = (value: string) => decryptOrEmpty(value, () => { unreadable = true; });
  return {
    ...doc,
    nik: doc.nik ? (full ? open(doc.nik as string) : maskTail(doc.nik as string)) : "",
    npwp: doc.npwp ? (full ? open(doc.npwp as string) : maskTail(doc.npwp as string)) : "",
    bankAccount: bank
      ? {
          ...bank,
          accountNumber: bank.accountNumber
            ? full
              ? open(bank.accountNumber)
              : maskTail(bank.accountNumber)
            : "",
        }
      : bank,
    isPiiMasked: !full,
    ...(unreadable ? { piiUnreadable: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* POST — create / update                                               */
/* ------------------------------------------------------------------ */

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "employees", "write");
  const body = await parseBody(req, employeeSchema);
  const settings = await getSettings();
  const emailOwner = await User.findOne({ email: body.officeEmail }).select("employeeId");
  if (emailOwner && (!body.id || String(emailOwner.employeeId) !== body.id)) {
    throw Conflict("Email kantor sudah dipakai akun lain.");
  }
  if (ctx.permission.scope === "self") throw Forbidden("Gunakan perubahan profil mandiri untuk data Anda.");
  if (body.password && (body.password.length < Math.max(10, Number(settings.password_min_length) || 10) || body.password.length > 72)) {
    throw BadRequest("Kata sandi harus 10–72 karakter dan memenuhi minimum perusahaan.");
  }
  const employeeScope = scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" });
  const rolePermission = await checkPermission(ctx.user.id, "roles", "write");
  const privileged = rolePermission.allowed && rolePermission.scope === "all";
  if (body.roleId) {
    const role = await Role.findById(body.roleId).select("name");
    if (!role) throw BadRequest("Peran tidak ditemukan.");
    if (role.name !== "STAFF" && !privileged) throw Forbidden("Pemberian peran istimewa memerlukan izin pengelolaan peran.");
  }
  if (!body.id && ctx.permission.scope === "branch" && (!ctx.user.branchId || body.branchId !== ctx.user.branchId)) throw Forbidden();
  if (!body.id && ctx.permission.scope === "division" && (!ctx.user.divisionId || body.divisionId !== ctx.user.divisionId)) throw Forbidden();

  const payload: Record<string, unknown> = {
    name: body.name,
    birthPlace: body.birthPlace ?? "",
    birthDate: body.birthDate ? toWibDate(body.birthDate) : undefined,
    gender: body.gender,
    religion: body.religion ?? "",
    maritalStatus: body.maritalStatus ?? "",
    ktpAddress: body.ktpAddress,
    domicileAddress: body.domicileAddress,
    personalEmail: body.personalEmail ?? "",
    officeEmail: body.officeEmail,
    phone: body.phone ?? "",
    socialMedia: body.socialMedia,
    taxStatus: body.taxStatus ?? "",
    bpjsKesehatan: body.bpjsKesehatan ?? "",
    bpjsKetenagakerjaan: body.bpjsKetenagakerjaan ?? "",
    branchId: body.branchId || null,
    divisionId: body.divisionId || null,
    positionId: body.positionId || null,
    supervisorId: body.supervisorId || null,
    storeManagerId: body.storeManagerId || null,
    areaManagerId: body.areaManagerId || null,
    joinDate: body.joinDate ? toWibDate(body.joinDate) : undefined,
    employmentStatus: body.employmentStatus,
  };

  // Encrypt-on-write; `encryptOnce` is idempotent so re-saving an unchanged
  // form does not double-encrypt.
  if (body.nik !== undefined) payload.nik = body.nik ? encryptOnce(body.nik) : "";
  if (body.npwp !== undefined) payload.npwp = body.npwp ? encryptOnce(body.npwp) : "";
  if (body.bankAccount) {
    payload.bankAccount = {
      bankName: body.bankAccount.bankName ?? "",
      accountHolder: body.bankAccount.accountHolder ?? "",
      accountNumber: body.bankAccount.accountNumber
        ? encryptOnce(body.bankAccount.accountNumber)
        : "",
    };
  }

  /* --- update ------------------------------------------------------- */
  if (body.id) {
    const existing = await Employee.findOne({ $and: [{ _id: body.id }, employeeScope] });
    if (!existing) throw NotFound("Data karyawan tidak ditemukan.");
    const linkedAccounts = await User.find({ employeeId: existing._id }).populate("roleId", "name");
    if (linkedAccounts.some(account => account.roleId?.name !== "STAFF") && !privileged) {
      throw Forbidden("Perubahan akun berperan istimewa memerlukan izin pengelolaan peran.");
    }

    // Only a company-wide scope may move someone between branches/divisions.
    if (ctx.permission.scope !== "all") {
      delete payload.branchId;
      delete payload.divisionId;
    }
    if (payload.branchId && String(payload.branchId) !== String(existing.branchId ?? "") && !isBranchUsable(await getBranchAccess(), payload.branchId)) {
      throw BadRequest(INACTIVE_BRANCH_MESSAGE);
    }
    // A value this server cannot decrypt (different ENCRYPTION_KEY) reaches the form
    // empty. Saving that form must not wipe the stored value.
    if (payload.nik === "" && existing.nik && isUnreadable(existing.nik)) delete payload.nik;
    if (payload.npwp === "" && existing.npwp && isUnreadable(existing.npwp)) delete payload.npwp;
    const storedAccount = (existing.bankAccount as { accountNumber?: string } | undefined)?.accountNumber;
    const bankPayload = payload.bankAccount as { accountNumber?: string } | undefined;
    if (bankPayload && bankPayload.accountNumber === "" && storedAccount && isUnreadable(storedAccount)) bankPayload.accountNumber = storedAccount;
    if (body.status) {
      payload.status = body.status;
      if (body.status === "resigned" || body.status === "suspended") {
        // Losing employment status must also close the login, otherwise a
        // departed employee keeps a valid session until it expires.
        await User.updateMany({ employeeId: existing._id }, { isActive: false });
      } else {
        await User.updateOne({ employeeId: existing._id }, { isActive: true });
      }
    }

    let updated = await Employee.findByIdAndUpdate(body.id, payload, { new: true });

    // A new hire stops being flagged the moment HR has filled in everything the
    // record needs; nobody has to remember to untick anything.
    let completedNow = false;
    if (updated?.isNewHire && missingProfileFields(updated.toObject()).length === 0) {
      updated = await Employee.findByIdAndUpdate(
        body.id,
        { isNewHire: false, profileCompletedAt: new Date() },
        { new: true }
      );
      completedNow = true;
    }

    if (body.officeEmail && body.officeEmail !== existing.officeEmail) {
      const clash = await User.findOne({
        email: body.officeEmail,
        employeeId: { $ne: existing._id },
      }).lean();
      if (clash) throw Conflict(`Email ${body.officeEmail} sudah dipakai akun lain.`);
      await User.updateOne({ employeeId: existing._id }, { email: body.officeEmail });
    }

    if (body.password) {
      if (body.password.length < Number(settings.password_min_length)) {
        throw BadRequest(`Kata sandi minimal ${settings.password_min_length} karakter.`);
      }
      await User.updateOne(
        { employeeId: existing._id },
        {
          passwordHash: await bcrypt.hash(body.password, 12),
          // A password set by HR must be changed by the employee on first use.
          mustChangePassword: Boolean(settings.force_password_change_on_first_login),
          failedLoginAttempts: 0,
          lockedUntil: null,
        }
      );
      // A reset by HR is a sensitive action in its own right; the value is never logged.
      // Existing sessions end automatically because the credential stamp changes.
      void logActivity({
        userId: ctx.user.id,
        action: "RESET_EMPLOYEE_PASSWORD",
        module: "employees",
        after: { employeeId: String(existing._id), mustChangePassword: Boolean(settings.force_password_change_on_first_login) },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_EMPLOYEE",
      module: "employees",
      // Only the changed field names are logged for protected data — writing the
      // decrypted values into the audit log would defeat encrypting them.
      before: redactForAudit(existing.toObject()),
      after: redactForAudit(updated!.toObject()),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return apiSuccess(
      revealSensitive(updated!.toObject(), ctx.permission.scope === "all"),
      `Data ${body.name} berhasil diperbarui.` +
        (completedNow ? " Data karyawan baru ini sudah lengkap, tanda \"Baru\" dihapus." : "")
    );
  }

  /* --- create -------------------------------------------------------- */
  if (body.branchId && !isBranchUsable(await getBranchAccess(), body.branchId)) throw BadRequest(INACTIVE_BRANCH_MESSAGE);
  const emailTaken = await User.findOne({ email: body.officeEmail }).lean();
  if (emailTaken) throw Conflict(`Email ${body.officeEmail} sudah digunakan akun lain.`);

  const year = new Date(body.joinDate ?? Date.now()).getFullYear();
  const employeeId = await nextEmployeeId(year);

  const employee = await Employee.create({
    ...payload,
    employeeId,
    status: body.status ?? "onboarding",
  });

  let generatedPassword: string | null = null;
  if (body.roleId) {
    const initial = body.password ? null : await initialPasswordFor(body.roleId);
    const pwd = body.password || initial!.password;
    if (!body.password) generatedPassword = pwd;
    await User.create({
      email: body.officeEmail,
      passwordHash: await bcrypt.hash(pwd, 12),
      roleId: body.roleId,
      employeeId: employee._id,
      phone: body.phone ?? "",
      mustChangePassword: Boolean(settings.force_password_change_on_first_login),
    });
  }

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_EMPLOYEE",
    module: "employees",
    after: redactForAudit(employee.toObject()),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    {
      ...revealSensitive(employee.toObject(), ctx.permission.scope === "all"),
      generatedPassword,
    },
    `Karyawan ${body.name} dibuat dengan NIP ${employeeId}.` +
      (generatedPassword ? " Akun login dibuat; kata sandi awalnya ditampilkan di layar." : ""),
    undefined,
    201
  );
});

/**
 * Allocates the next NIP atomically.
 *
 * The previous approach was `countDocuments() + 1`, which produced duplicate
 * ids whenever two HR users saved at the same time and reused ids after a
 * deletion. A counter document guarantees each number is handed out once.
 */
async function nextEmployeeId(year: number): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { key: `employee:${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `EMP-${year}-${String(counter.seq).padStart(4, "0")}`;
}

/** Replaces encrypted PII with a marker before the record enters the audit log. */
function redactForAudit(doc: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...doc };
  for (const field of SENSITIVE_FIELDS) {
    if (field.includes(".")) {
      const [parent, child] = field.split(".");
      const obj = copy[parent] as Record<string, unknown> | undefined;
      if (obj?.[child]) copy[parent] = { ...obj, [child]: "[terenkripsi]" };
    } else if (copy[field]) {
      copy[field] = "[terenkripsi]";
    }
  }
  delete copy.documents;
  return copy;
}

/* ------------------------------------------------------------------ */
/* PATCH — clear the new-hire flag by hand                              */
/* ------------------------------------------------------------------ */

const completeSchema = z.object({ id: objectId });

/**
 * For records HR considers complete even though a checklist item is empty —
 * a contract worker with no bank account on payroll, for instance.
 */
export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "employees", "write");
  const body = await parseBody(req, completeSchema);
  const employee = await Employee.findOne({ $and: [{ _id: body.id }, scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" })] });
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");
  if (!employee.isNewHire) return apiSuccess({ id: body.id }, "Karyawan ini sudah tidak bertanda baru.");

  const missing = missingProfileFields(employee.toObject());
  employee.isNewHire = false;
  employee.profileCompletedAt = new Date();
  await employee.save();

  void logActivity({
    userId: ctx.user.id,
    action: "COMPLETE_NEW_HIRE",
    module: "employees",
    after: { employeeId: employee.employeeId, stillMissing: missing },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id: body.id },
    missing.length
      ? `Tanda "Baru" dihapus. Catatan: ${missing.join(", ")} masih kosong.`
      : `Tanda "Baru" dihapus.`
  );
});

/* ------------------------------------------------------------------ */
/* DELETE                                                               */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "employees", "delete");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID karyawan wajib disertakan.");

  const employeeScope = scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" });
  const employee = await Employee.findOne({ $and: [{ _id: id }, employeeScope] });
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");
  const linkedAccounts = await User.find({ employeeId: employee._id }).populate("roleId", "name");
  if (linkedAccounts.some(account => account.roleId?.name !== "STAFF")) {
    const rolePermission = await checkPermission(ctx.user.id, "roles", "write");
    if (!rolePermission.allowed || rolePermission.scope !== "all") {
      throw Forbidden("Penonaktifan akun berperan istimewa memerlukan izin pengelolaan peran.");
    }
  }

  // Hard-deleting would orphan attendance, payroll, and audit records, so the
  // record is retired instead and the login disabled.
  employee.status = "resigned";
  await employee.save();
  await User.updateMany({ employeeId: employee._id }, { isActive: false });

  void logActivity({
    userId: ctx.user.id,
    action: "DEACTIVATE_EMPLOYEE",
    module: "employees",
    before: redactForAudit(employee.toObject()),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id },
    `${employee.name} dinonaktifkan (status resign) dan akses loginnya ditutup. Riwayat presensi dan payroll tetap tersimpan.`
  );
});
