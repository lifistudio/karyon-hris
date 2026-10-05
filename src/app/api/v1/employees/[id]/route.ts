import { z } from "zod";
import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requireUser, requirePermission, parseBody, scopeFilter, BadRequest, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { decryptOrEmpty, maskTail } from "@/lib/crypto";
import { storageProvider, decodeDataUrl } from "@/lib/storage";
import { optimizeImage } from "@/lib/storage/image";
import Employee from "@/models/Employee";
import User from "@/models/User";

type Ctx = RouteContext<{ id: string }>;

/**
 * Fields an employee is trusted to change about themselves.
 *
 * Everything financial or identity-bearing (NIK, NPWP, bank account, posting,
 * salary) is excluded: the spec requires those to go through HRD, because
 * payroll correctness depends on them.
 */
const selfEditableSchema = z.object({
  phone: z.string().trim().regex(/^[0-9+()\-\s]{8,20}$/, "Nomor telepon tidak valid").optional(),
  personalEmail: z.string().trim().toLowerCase().email("Email pribadi tidak valid").or(z.literal("")).optional(),
  domicileAddress: z
    .object({
      street: z.string().trim().max(200),
      subdistrict: z.string().trim().max(100),
      city: z.string().trim().max(100),
      province: z.string().trim().max(100),
      country: z.string().trim().max(100),
    })
    .partial()
    .optional(),
  socialMedia: z.record(z.string(), z.string().trim().max(200)).optional(),
  /** Profile photo as a data URL. */
  photo: z.string().optional(),
});

export const GET = wrapRouteHandler<Ctx>(async (req, ctxParams) => {
  const ctx = await requireUser(req);
  const { id } = await ctxParams.params;
  if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID karyawan tidak valid.");

  const isSelf = ctx.user.employeeId === id;
  let scope: string = "self";

  if (!isSelf) {
    const perm =
      (await checkPermission(ctx.user.id, "employees", "read")).allowed
        ? await checkPermission(ctx.user.id, "employees", "read")
        : await checkPermission(ctx.user.id, "attendance", "read");
    if (!perm.allowed || perm.scope === "self") {
      throw Forbidden("Anda tidak memiliki izin melihat data karyawan ini.");
    }
    scope = perm.scope;
  }

  const filter = scopeFilter({ ...ctx, permission: { allowed: true, scope: scope as "self" | "all" | "branch" | "division" } }, { employee: "_id", branch: "branchId", division: "divisionId" });
  const employee = await Employee.findOne({ $and: [{ _id: id }, filter] })
    .populate("branchId", "name address lat lng radiusMeter workHours")
    .populate("divisionId", "name")
    .populate("positionId", "name")
    .populate("supervisorId", "name employeeId")
    .populate("storeManagerId", "name employeeId")
    .populate("areaManagerId", "name employeeId")
    .lean<Record<string, unknown> | null>();

  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");

  // Self and company-wide readers see the real values; a narrower scope sees a
  // masked tail, enough to verify a record without exposing the number.
  const full = isSelf || scope === "all";
  const bank = employee.bankAccount as { bankName?: string; accountNumber?: string; accountHolder?: string } | undefined;

  let unreadable = false;
  const open = (value: string) => decryptOrEmpty(value, () => { unreadable = true; });
  const data = {
    ...employee,
    nik: employee.nik ? (full ? open(employee.nik as string) : maskTail(employee.nik as string)) : "",
    npwp: employee.npwp ? (full ? open(employee.npwp as string) : maskTail(employee.npwp as string)) : "",
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
    photoUrl: employee.photoUrl
      ? await storageProvider.getSignedUrl(employee.photoUrl as string, 900)
      : "",
    isPiiMasked: !full,
    ...(unreadable ? { piiUnreadable: true } : {}),
  };

  return apiSuccess(data, "Berhasil memuat data karyawan");
});

/** Self-service profile edit. */
export const PATCH = wrapRouteHandler<Ctx>(async (req, ctxParams) => {
  const ctx = await requireUser(req);
  const { id } = await ctxParams.params;

  if (ctx.user.employeeId !== id) {
    throw Forbidden(
      "Halaman ini hanya untuk memperbarui profil Anda sendiri. Perubahan data karyawan lain dilakukan HRD."
    );
  }

  const body = await parseBody(req, selfEditableSchema);
  const employee = await Employee.findById(id);
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");

  const before = {
    phone: employee.phone,
    personalEmail: employee.personalEmail,
    domicileAddress: employee.domicileAddress,
    socialMedia: employee.socialMedia,
  };

  if (body.phone !== undefined) employee.phone = body.phone;
  if (body.personalEmail !== undefined) employee.personalEmail = body.personalEmail;
  if (body.domicileAddress) {
    employee.domicileAddress = { ...employee.domicileAddress?.toObject?.(), ...body.domicileAddress };
  }
  if (body.socialMedia) employee.socialMedia = body.socialMedia;

  if (body.photo) {
    const { buffer } = decodeDataUrl(body.photo, ["image/jpeg", "image/png", "image/webp"]);
    const photo = await optimizeImage(buffer, { maxSide: 1024 });
    const previous = employee.photoUrl as string | undefined;
    employee.photoUrl = await storageProvider.upload(
      photo.buffer,
      `employees/${id}/avatar${photo.ext}`,
      photo.mime
    );
    // An older photo saved under another extension (e.g. avatar.jpg) is no longer used.
    if (previous && previous !== employee.photoUrl) void storageProvider.delete(previous).catch(() => {});
  }

  await employee.save();

  // Keep the login's contact number in step so notifications keep arriving.
  if (body.phone !== undefined) {
    await User.updateOne({ employeeId: id }, { phone: body.phone });
  }

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_OWN_PROFILE",
    module: "employees",
    before,
    after: {
      phone: employee.phone,
      personalEmail: employee.personalEmail,
      domicileAddress: employee.domicileAddress,
      socialMedia: employee.socialMedia,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id },
    "Profil Anda diperbarui. Perubahan data rekening, NPWP, atau NIK harus diajukan melalui HRD."
  );
});

export const DELETE = wrapRouteHandler<Ctx>(async (req, ctxParams) => {
  const ctx = await requirePermission(req, "employees", "delete");
  const { id } = await ctxParams.params;
  if (!id) throw BadRequest("ID karyawan wajib disediakan.");

  const employee = await Employee.findOne({ $and: [{ _id: id }, scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" })] });
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");
  const account = await User.findOne({ employeeId: id }).populate("roleId", "name");
  const rolePermission = await checkPermission(ctx.user.id, "roles", "write");
  if (account && account.roleId?.name !== "STAFF" && !(rolePermission.allowed && rolePermission.scope === "all")) throw Forbidden();

  // Soft retirement, not deletion: attendance, payroll, and audit records
  // reference this employee, and removing the row would orphan all of them.
  employee.status = "resigned";
  await employee.save();
  await User.updateOne({ employeeId: id }, { isActive: false });

  void logActivity({
    userId: ctx.user.id,
    action: "DEACTIVATE_EMPLOYEE",
    module: "employees",
    before: { employeeId: employee.employeeId, name: employee.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id },
    `${employee.name} dinonaktifkan dan akses loginnya ditutup. Seluruh riwayat tetap tersimpan.`
  );
});
