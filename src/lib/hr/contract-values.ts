import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { decryptOrEmpty } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { formatDate, formatRupiah, wibDateKey } from "@/lib/time";
import { contractTypeLabel, durationLabel } from "@/lib/hr/contracts";
import Employee from "@/models/Employee";
import "@/models/Position";
import "@/models/Division";
import "@/models/Branch";

/**
 * The values a contract template's placeholders resolve to.
 *
 * Contract terms (dates, pay, position, number) come from the contract itself,
 * so a printed contract always says what was agreed; identity details come from
 * the employee record at print time.
 */
export async function contractValues(
  contract: {
    contractNumber: string;
    type: string;
    customTypeLabel?: string;
    startDate: Date;
    endDate?: Date | null;
    positionName?: string;
    salarySnapshot?: { basicSalary?: number; allowances?: number };
    employeeId: RecordId | string;
  },
  template?: { signerName?: string; signerTitle?: string; city?: string } | null
): Promise<Record<string, string>> {
  const [settings, employee] = await Promise.all([
    getSettings(),
    Employee.findById(contract.employeeId)
      .select("name employeeId nik birthPlace birthDate ktpAddress positionId divisionId branchId")
      .populate("positionId", "name")
      .populate("divisionId", "name")
      .populate("branchId", "name address")
      .lean<{
        name: string;
        employeeId: string;
        nik?: string;
        birthPlace?: string;
        birthDate?: Date;
        ktpAddress?: { street?: string; subdistrict?: string; city?: string; province?: string };
        positionId?: { name?: string } | null;
        divisionId?: { name?: string } | null;
        branchId?: { name?: string; address?: string } | null;
      } | null>(),
  ]);

  const startKey = wibDateKey(contract.startDate);
  const endKey = contract.endDate ? wibDateKey(contract.endDate) : null;
  const addr = employee?.ktpAddress;

  return {
    nomor_kontrak: contract.contractNumber,
    jenis_kontrak: contractTypeLabel(contract.type, contract.customTypeLabel),
    nama: employee?.name ?? "",
    nip: employee?.employeeId ?? "",
    nik: employee?.nik ? decryptOrEmpty(employee.nik) : "",
    tempat_lahir: employee?.birthPlace ?? "",
    tanggal_lahir: employee?.birthDate ? formatDate(employee.birthDate) : "",
    alamat: [addr?.street, addr?.subdistrict, addr?.city, addr?.province].filter(Boolean).join(", "),
    jabatan: contract.positionName || employee?.positionId?.name || "",
    divisi: employee?.divisionId?.name ?? "",
    cabang: employee?.branchId?.name ?? "",
    tanggal_mulai: formatDate(contract.startDate),
    tanggal_selesai: contract.endDate ? formatDate(contract.endDate) : "tidak ditentukan",
    durasi: durationLabel(startKey, endKey),
    gaji_pokok: formatRupiah(contract.salarySnapshot?.basicSalary ?? 0),
    tunjangan: formatRupiah(contract.salarySnapshot?.allowances ?? 0),
    nama_perusahaan: String(settings.company_name ?? ""),
    alamat_perusahaan: String(settings.company_address ?? ""),
    penandatangan: template?.signerName || "",
    jabatan_penandatangan: template?.signerTitle || "",
    kota: template?.city || employee?.branchId?.name || "",
    tanggal_hari_ini: formatDate(new Date()),
  };
}
