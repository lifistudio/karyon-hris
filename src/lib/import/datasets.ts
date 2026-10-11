import bcrypt from "bcryptjs";
import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { encryptOnce } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { initialPasswordFor } from "@/lib/auth/initial-password";
import { wibStartOfDay, getTimezoneOffset } from "@/lib/time";
import Branch from "@/models/Branch";
import Counter from "@/models/Counter";
import Division from "@/models/Division";
import Employee from "@/models/Employee";
import Position from "@/models/Position";
import Role from "@/models/Role";
import User from "@/models/User";
import { IMPORT_DATASETS, type ImportDataset } from "./catalog";
import { cleanCell, mapHeaders, parseCsv, parseDateCell } from "./csv";

export interface ImportRow {
  line: number;
  action: "create" | "update";
  label: string;
  errors: string[];
  warnings: string[];
}

export interface ImportPlan {
  rows: ImportRow[];
  counts: { create: number; update: number; invalid: number };
  missingColumns: string[];
  apply: () => Promise<{ created: number; updated: number; credentials: Array<{ nip: string; name: string; email: string; password: string }> }>;
}

const key = (value: string) => value.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\-\s]{8,20}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Masked values from an export ("••••1234") mean "leave unchanged".
const masked = (value: string) => /[•*]/.test(value);

const EMPLOYMENT: Array<[RegExp, string]> = [
  [/^(pkwtt|tetap|permanen)/i, "pkwtt"], [/^(pkwt|kontrak)/i, "pkwt"], [/^(probation|masa percobaan|percobaan)/i, "probation"],
  [/^(magang|intern)/i, "magang"], [/^(harian)/i, "harian_lepas"], [/^(paruh|part)/i, "paruh_waktu"], [/^(outsourc)/i, "outsource"], [/^(lainnya|lain)/i, "lainnya"],
];
const employmentCode = (value: string) => EMPLOYMENT.find(([pattern]) => pattern.test(value.replace(/_/g, " ").trim()))?.[1] ?? null;
const statusCode = (value: string) => (/^(aktif|active)$/i.test(value) ? "active" : /^onboarding$/i.test(value) ? "onboarding" : null);
const genderCode = (value: string) => (/^(l|laki|laki-laki|pria|male|m)$/i.test(value) ? "male" : /^(p|perempuan|wanita|female|f)$/i.test(value) ? "female" : null);
const yesNo = (value: string) => (/^(ya|y|yes|true|1)$/i.test(value) ? true : /^(tidak|t|no|n|false|0)$/i.test(value) ? false : null);

function readRows(dataset: ImportDataset, csv: string) {
  const fields = IMPORT_DATASETS[dataset].fields;
  const { headers, rows } = parseCsv(csv);
  const index = mapHeaders(headers, [...fields]);
  const missingColumns = fields.filter((f) => "required" in f && f.required && !index.has(f.key)).map((f) => f.label);
  const records = rows.map(({ line, values }) => {
    const get = (k: string) => { const i = index.get(k); return i === undefined ? "" : cleanCell(values[i]); };
    return { line, get };
  });
  return { records, missingColumns };
}

async function nextEmployeeId(year: number): Promise<string> {
  const counter = await Counter.findOneAndUpdate({ key: `employee:${year}` }, { $inc: { seq: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  return `EMP-${year}-${String(counter.seq).padStart(4, "0")}`;
}

/**
 * Validates every row against the database without writing anything. The
 * returned `apply` re-uses the validated values and writes them in one
 * transaction; callers only invoke it when there are no errors.
 */
export async function planImport(dataset: ImportDataset, csv: string): Promise<ImportPlan> {
  const { records, missingColumns } = readRows(dataset, csv);
  const rows: ImportRow[] = [];
  const ops: Array<() => Promise<void>> = [];
  const result = { created: 0, updated: 0, credentials: [] as Array<{ nip: string; name: string; email: string; password: string }> };
  const seen = new Set<string>();
  const duplicate = (value: string, row: ImportRow, what: string) => {
    if (!value) return;
    if (seen.has(`${what}:${key(value)}`)) row.errors.push(`${what} "${value}" muncul lebih dari sekali dalam berkas.`);
    seen.add(`${what}:${key(value)}`);
  };

  if (dataset === "branches") {
    const existing = await Branch.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>();
    const byName = new Map(existing.map((b) => [key(b.name), b]));
    const settings = await getSettings();
    let creates = 0;
    for (const { line, get } of records) {
      const name = get("name"), address = get("address"), lat = Number(get("lat").replace(",", ".")), lng = Number(get("lng").replace(",", "."));
      const radiusRaw = get("radius"), open = get("open") || "09:00", close = get("close") || "17:00";
      const current = byName.get(key(name));
      const row: ImportRow = { line, action: current ? "update" : "create", label: name || "(tanpa nama)", errors: [], warnings: [] };
      duplicate(name, row, "Cabang");
      if (name.length < 2 || name.length > 120) row.errors.push("Nama cabang 2–120 karakter.");
      if (address.length < 5) row.errors.push("Alamat minimal 5 karakter.");
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) row.errors.push("Latitude tidak valid.");
      if (!Number.isFinite(lng) || Math.abs(lng) > 180) row.errors.push("Longitude tidak valid.");
      const radius = radiusRaw ? Number(radiusRaw) : Number(settings.default_geo_radius);
      if (!Number.isFinite(radius) || radius < 5 || radius > 5000) row.errors.push("Radius absen 5–5000 meter.");
      if (!HHMM.test(open) || !HHMM.test(close) || close <= open) row.errors.push("Jam buka/tutup harus HH:MM dan jam tutup setelah jam buka.");
      if (!current) creates += 1;
      rows.push(row);
      const payload = { name, address, lat, lng, radiusMeter: radius, workHours: { start: open, end: close } };
      ops.push(async () => {
        if (current) { await Branch.findByIdAndUpdate(current._id, payload); result.updated++; }
        else { await Branch.create(payload); result.created++; }
      });
    }
    if (creates > 0 && existing.length + creates > 1) {
      // Same rule as creating a branch by hand: additional branches are a Pro entitlement.
      const { getEntitlements } = await import("@/lib/licensing/server");
      const license = await getEntitlements();
      if (!["active", "grace"].includes(license.status) || !license.features.includes("organization.multi_branch")) {
        for (const row of rows) if (row.action === "create") row.errors.push("Cabang tambahan memerlukan HRIS Pro (Community mendukung satu cabang).");
      }
    }
  }

  if (dataset === "divisions") {
    const [divisions, branches] = await Promise.all([
      Division.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
      Branch.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
    ]);
    const byName = new Map(divisions.map((d) => [key(d.name), d])), branchByName = new Map(branches.map((b) => [key(b.name), b]));
    for (const { line, get } of records) {
      const name = get("name"), branchName = get("branch");
      const current = byName.get(key(name));
      const row: ImportRow = { line, action: current ? "update" : "create", label: name || "(tanpa nama)", errors: [], warnings: [] };
      duplicate(name, row, "Divisi");
      if (name.length < 2 || name.length > 120) row.errors.push("Nama divisi 2–120 karakter.");
      const branch = branchName ? branchByName.get(key(branchName)) : undefined;
      if (branchName && !branch) row.errors.push(`Cabang "${branchName}" belum ada. Impor cabang terlebih dahulu.`);
      rows.push(row);
      const payload = { name, ...(branch ? { branchId: branch._id } : {}) };
      ops.push(async () => {
        if (current) { await Division.findByIdAndUpdate(current._id, payload); result.updated++; }
        else { await Division.create(payload); result.created++; }
      });
    }
  }

  if (dataset === "positions") {
    const [positions, divisions] = await Promise.all([
      Position.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
      Division.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
    ]);
    const byName = new Map(positions.map((p) => [key(p.name), p])), divisionByName = new Map(divisions.map((d) => [key(d.name), d]));
    for (const { line, get } of records) {
      const name = get("name"), divisionName = get("division"), description = get("description");
      const current = byName.get(key(name));
      const row: ImportRow = { line, action: current ? "update" : "create", label: name || "(tanpa nama)", errors: [], warnings: [] };
      duplicate(name, row, "Jabatan");
      if (name.length < 2 || name.length > 120) row.errors.push("Nama jabatan 2–120 karakter.");
      if (description.length > 2000) row.errors.push("Deskripsi maksimal 2000 karakter.");
      const division = divisionName ? divisionByName.get(key(divisionName)) : undefined;
      if (divisionName && !division) row.errors.push(`Divisi "${divisionName}" belum ada. Impor divisi terlebih dahulu.`);
      rows.push(row);
      const payload = { name, ...(division ? { divisionId: division._id } : {}), ...(description ? { description } : {}) };
      ops.push(async () => {
        if (current) { await Position.findByIdAndUpdate(current._id, payload); result.updated++; }
        else { await Position.create(payload); result.created++; }
      });
    }
  }

  if (dataset === "employees") {
    const [employees, users, branches, divisions, positions, staffRole] = await Promise.all([
      Employee.find({}).select("employeeId name officeEmail").lean<Array<{ _id: RecordId; employeeId: string; name: string; officeEmail?: string }>>(),
      User.find({}).select("email employeeId").lean<Array<{ email: string; employeeId?: RecordId }>>(),
      Branch.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
      Division.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
      Position.find({}).select("name").lean<Array<{ _id: RecordId; name: string }>>(),
      Role.findOne({ name: "STAFF" }).select("_id").lean<{ _id: RecordId } | null>(),
    ]);
    const settings = await getSettings();
    const byNip = new Map(employees.map((e) => [key(e.employeeId), e]));
    const emailOwner = new Map(users.map((u) => [key(u.email), u.employeeId ? String(u.employeeId) : "account"]));
    const lookup = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [key(x.name), x]));
    const branchByName = lookup(branches), divisionByName = lookup(divisions), positionByName = lookup(positions);

    for (const { line, get } of records) {
      const nip = get("nip"), name = get("name");
      const current = nip ? byNip.get(key(nip)) : undefined;
      const row: ImportRow = { line, action: current ? "update" : "create", label: name || nip || "(tanpa nama)", errors: [], warnings: [] };
      if (nip && !current) row.errors.push(`NIP "${nip}" tidak ditemukan. Kosongkan NIP untuk menambah karyawan baru.`);
      duplicate(nip, row, "NIP");
      if (!current && (name.length < 3 || name.length > 150)) row.errors.push("Nama lengkap 3–150 karakter.");
      if (current && name && (name.length < 3 || name.length > 150)) row.errors.push("Nama lengkap 3–150 karakter.");

      const payload: Record<string, unknown> = {};
      const set = (field: string, value: unknown) => { if (value !== "" && value !== undefined && value !== null) payload[field] = value; };
      if (name) set("name", name);

      const officeEmail = get("officeEmail").toLowerCase(), personalEmail = get("personalEmail").toLowerCase();
      if (officeEmail) {
        if (!EMAIL.test(officeEmail)) row.errors.push("Email kantor tidak valid.");
        const owner = emailOwner.get(officeEmail);
        if (owner && owner !== String(current?._id ?? "")) row.errors.push(`Email kantor ${officeEmail} sudah dipakai akun lain.`);
        duplicate(officeEmail, row, "Email kantor");
        set("officeEmail", officeEmail);
      }
      if (personalEmail) { if (!EMAIL.test(personalEmail)) row.errors.push("Email pribadi tidak valid."); set("personalEmail", personalEmail); }
      const phone = get("phone");
      if (phone) { if (!PHONE.test(phone)) row.errors.push("Nomor telepon tidak valid."); set("phone", phone); }

      for (const [field, list, label] of [["branch", branchByName, "Cabang"], ["division", divisionByName, "Divisi"], ["position", positionByName, "Jabatan"]] as const) {
        const value = get(field);
        if (!value) continue;
        const found = list.get(key(value));
        if (!found) row.errors.push(`${label} "${value}" belum ada. Tambahkan di master data atau impor terlebih dahulu.`);
        else set(`${field}Id`, found._id);
      }
      for (const [field, label] of [["joinDate", "Tanggal masuk"], ["birthDate", "Tanggal lahir"]] as const) {
        const value = get(field);
        if (!value) continue;
        const iso = parseDateCell(value);
        if (!iso) row.errors.push(`${label} "${value}" tidak valid (YYYY-MM-DD atau DD/MM/YYYY).`);
        else set(field, wibStartOfDay(iso));
      }
      const employment = get("employmentStatus");
      if (employment) { const code = employmentCode(employment); if (!code) row.errors.push(`Status kepegawaian "${employment}" tidak dikenal.`); else set("employmentStatus", code); }
      const status = get("status");
      if (status) { const code = statusCode(status); if (!code) row.errors.push("Status harus Aktif atau Onboarding (penonaktifan dilakukan dari halaman karyawan)."); else set("status", code); }
      const gender = get("gender");
      if (gender) { const code = genderCode(gender); if (!code) row.errors.push("Jenis kelamin harus L atau P."); else set("gender", code); }
      for (const [field, max] of [["birthPlace", 100], ["religion", 50], ["maritalStatus", 50], ["taxStatus", 10], ["bpjsKesehatan", 40], ["bpjsKetenagakerjaan", 40]] as const) {
        const value = get(field);
        if (!value) continue;
        if (value.length > max) row.errors.push(`${field} maksimal ${max} karakter.`);
        set(field, value);
      }
      const nik = get("nik"), npwp = get("npwp");
      if (nik && !masked(nik)) { if (!/^\d{16}$/.test(nik)) row.errors.push("NIK harus 16 digit angka."); else set("nik", encryptOnce(nik)); }
      if (npwp && !masked(npwp)) { if (npwp.length > 40) row.errors.push("NPWP maksimal 40 karakter."); else set("npwp", encryptOnce(npwp)); }
      const bankName = get("bankName"), accountNumber = get("accountNumber"), accountHolder = get("accountHolder");
      if (bankName || (accountNumber && !masked(accountNumber)) || accountHolder) {
        if (accountNumber && !masked(accountNumber) && !/^[0-9\- ]{5,40}$/.test(accountNumber)) row.errors.push("Nomor rekening hanya angka (5–40).");
        payload.bankAccount = { bankName, accountHolder, accountNumber: accountNumber && !masked(accountNumber) ? encryptOnce(accountNumber) : "" };
        if (current && (!accountNumber || masked(accountNumber))) row.warnings.push("Nomor rekening tidak diubah karena kosong/tersamarkan; data bank akan menimpa nama bank dan pemilik saja.");
      }
      if ([nik, npwp, accountNumber].some((v) => v && masked(v))) row.warnings.push("Nilai tersamarkan (••••) dilewati dan tidak mengubah data.");

      const supervisorNip = get("supervisorNip");
      if (supervisorNip) {
        // New rows get their NIP at commit time, so a supervisor must already be registered.
        const supervisor = byNip.get(key(supervisorNip));
        if (supervisorNip === nip) row.errors.push("Karyawan tidak boleh menjadi atasan dirinya sendiri.");
        else if (!supervisor) row.errors.push(`NIP atasan ${supervisorNip} belum terdaftar.`);
        else payload.supervisorId = supervisor._id;
      }
      const accountFlag = get("createAccount");
      const wantsAccount = accountFlag ? yesNo(accountFlag) : !current && Boolean(officeEmail);
      if (accountFlag && wantsAccount === null) row.errors.push("Kolom Buat akun login harus Ya atau Tidak.");
      const hasAccount = current ? users.some((u) => String(u.employeeId ?? "") === String(current._id)) : false;
      if (wantsAccount && !hasAccount && !(officeEmail || current?.officeEmail)) row.errors.push("Akun login memerlukan email kantor.");
      if (wantsAccount && !staffRole) row.errors.push("Peran STAFF tidak ditemukan; jalankan seed data dasar.");
      rows.push(row);

      ops.push(async () => {
        let employeeId = current?._id;
        if (current) {
          await Employee.findByIdAndUpdate(current._id, payload);
          if (payload.officeEmail && hasAccount) await User.updateOne({ employeeId: current._id }, { email: payload.officeEmail });
          result.updated++;
        } else {
          const joinYear = payload.joinDate instanceof Date ? new Date(payload.joinDate.getTime() + getTimezoneOffset() * 60_000).getUTCFullYear() : new Date().getUTCFullYear();
          const nipValue = await nextEmployeeId(joinYear);
          payload.employeeId = nipValue;
          const created = await Employee.create({ status: "active", ...payload, employeeId: nipValue });
          employeeId = created._id;
          result.created++;
        }
        if (wantsAccount && !hasAccount && staffRole) {
          const initial = await initialPasswordFor(String(staffRole._id));
          await User.create({
            email: String(payload.officeEmail ?? current?.officeEmail),
            passwordHash: await bcrypt.hash(initial.password, 12),
            roleId: staffRole._id,
            employeeId,
            phone: String(payload.phone ?? ""),
            mustChangePassword: Boolean(settings.force_password_change_on_first_login),
          });
          // Fixed policy passwords are known to HR already; only random ones are handed back once.
          if (initial.mode === "random") result.credentials.push({ nip: String(payload.employeeId ?? current?.employeeId), name: String(payload.name ?? current?.name), email: String(payload.officeEmail ?? current?.officeEmail), password: initial.password });
        }
      });
    }
  }

  const invalid = rows.filter((r) => r.errors.length).length;
  return {
    rows,
    missingColumns,
    counts: { create: rows.filter((r) => r.action === "create").length, update: rows.filter((r) => r.action === "update").length, invalid },
    apply: async () => {
      if (invalid || missingColumns.length) throw new Error("Validation failed: impor masih memiliki kesalahan.");
      await database.transaction(async () => { for (const op of ops) await op(); });
      return result;
    },
  };
}
