import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, BadRequest, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { decryptOrEmpty } from "@/lib/crypto";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import Payroll from "@/models/Payroll";
import PayslipTemplate from "@/models/PayslipTemplate";
import { DEFAULT_BLOCKS, DEFAULT_EMPLOYEE_FIELDS } from "@/lib/hr/payslip";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/hr/labels";
import "@/models/Employee";
import "@/models/Division";
import "@/models/Position";
import "@/models/Branch";

/**
 * Everything a payslip document needs to render: the template to lay it out
 * with, and the payroll record to fill it.
 *
 * Employees may fetch their own published slip; reading anyone else's requires
 * a company-wide payroll scope. Every fetch is written to the audit log,
 * because a payslip is one of the few documents where "who looked at this"
 * genuinely matters.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID slip gaji tidak valid.");

  const payroll = await Payroll.findById(id)
    .populate({
      path: "employeeId",
      select: "employeeId name positionId divisionId branchId joinDate employmentStatus taxStatus bankAccount npwp",
      populate: [
        { path: "positionId", select: "name" },
        { path: "divisionId", select: "name" },
        { path: "branchId", select: "name" },
      ],
    })
    .lean<Record<string, unknown> | null>();

  if (!payroll) throw NotFound("Slip gaji tidak ditemukan.");

  const employee = payroll.employeeId as Record<string, unknown> | null;
  if (!employee) throw NotFound("Data karyawan pada slip ini sudah tidak tersedia.");

  const isOwner = String(employee._id) === ctx.user.employeeId;
  const perm = await checkPermission(ctx.user.id, "payroll", "read");

  if (!isOwner) {
    if (!perm.allowed || perm.scope !== "all") {
      throw Forbidden("Anda tidak memiliki izin membuka slip gaji karyawan lain.");
    }
  } else if (payroll.status === "draft") {
    // Drafts are Finance's working copy; the employee sees nothing until it is
    // published.
    throw Forbidden("Slip gaji periode ini belum diterbitkan.");
  }

  /* --- template --- */
  const requested = sp.get("templateId");
  const template =
    (requested && /^[0-9a-fA-F]{24}$/.test(requested)
      ? await PayslipTemplate.findById(requested).lean<Record<string, unknown> | null>()
      : null) ??
    (await PayslipTemplate.findOne({ isDefault: true }).lean<Record<string, unknown> | null>()) ??
    (await PayslipTemplate.findOne({}).lean<Record<string, unknown> | null>());

  const settings = await getSettings();

  // Falling back to a built-in layout means a slip is always printable, even
  // before anyone has configured a template.
  const resolvedTemplate = template ?? {
    name: "Bawaan",
    paperSize: "A4",
    accentColor: "#0468c9",
    baseFontSize: 12,
    margin: 18,
    companyName: String(settings.company_name ?? ""),
    companyAddress: String(settings.company_address ?? ""),
    documentTitle: "SLIP GAJI KARYAWAN",
    showLogo: false,
    logoUrl: "",
    logoHeight: 14,
    footerNote:
      "Dokumen ini dihasilkan otomatis oleh sistem dan sah tanpa tanda tangan basah. " +
      "Keberatan atas perhitungan dapat diajukan ke HRD paling lambat 7 hari sejak slip diterbitkan.",
    employeeFields: DEFAULT_EMPLOYEE_FIELDS,
    signatories: [],
    blocks: DEFAULT_BLOCKS,
  };

  const bank = employee.bankAccount as { bankName?: string; accountNumber?: string } | undefined;

  const data = {
    period: payroll.period as string,
    status: payroll.status as string,
    employee: {
      employeeId: (employee.employeeId as string) ?? "",
      name: (employee.name as string) ?? "",
      positionName: (employee.positionId as { name?: string } | null)?.name ?? "",
      divisionName: (employee.divisionId as { name?: string } | null)?.name ?? "",
      branchName: (employee.branchId as { name?: string } | null)?.name ?? "",
      joinDate: employee.joinDate ? formatDate(employee.joinDate as Date) : "",
      employmentStatus:
        EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as string] ??
        ((employee.employmentStatus as string) || ""),
      taxStatus: (employee.taxStatus as string) ?? "",
      bankName: bank?.bankName ?? "",
      // Decrypted only for the owner or a company-wide reader, which is exactly
      // who reached this point.
      bankAccount: bank?.accountNumber ? decryptOrEmpty(bank.accountNumber) : "",
      npwp: employee.npwp ? decryptOrEmpty(employee.npwp as string) : "",
    },
    basicSalary: (payroll.basicSalary as number) ?? 0,
    allowances: (payroll.allowances as Array<{ name: string; amount: number }>) ?? [],
    deductions: (payroll.deductions as Array<{ name: string; amount: number }>) ?? [],
    overtimeSalary: (payroll.overtimeSalary as number) ?? 0,
    overtimeHours: (payroll.overtimeHours as number) ?? 0,
    totalEarnings: (payroll.totalEarnings as number) ?? 0,
    totalDeductions: (payroll.totalDeductions as number) ?? 0,
    netSalary: (payroll.netSalary as number) ?? 0,
    lateMinutes: (payroll.lateMinutes as number) ?? 0,
    absentDays: (payroll.absentDays as number) ?? 0,
    presentDays: (payroll.presentDays as number) ?? 0,
    workingDays: (payroll.workingDays as number) ?? 0,
    generatedAt: payroll.generatedAt ? String(payroll.generatedAt) : undefined,
  };

  void logActivity({
    userId: ctx.user.id,
    action: "VIEW_PAYSLIP_DOCUMENT",
    module: "payroll",
    after: { period: data.period, employee: data.employee.employeeId, self: isOwner },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ template: resolvedTemplate, data }, "Berhasil memuat dokumen slip gaji");
});
