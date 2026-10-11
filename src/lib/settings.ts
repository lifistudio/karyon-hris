import Setting from "@/models/Setting";
import { connectToDatabase } from "./db";
import { DEFAULT_TIMEZONE_OFFSET_MINUTES, setTimezoneOffset, timezoneLabel } from "./time";

/**
 * Single source of truth for every configurable business rule.
 *
 * The spec requires that nothing (tolerances, quotas, penalty rates, approval
 * lead times) is hardcoded. Declaring each key once here gives us three things
 * at the same time: a typed default the server can rely on when the row is
 * missing, coercion so a value typed into the CMS as "15" is read back as the
 * number 15, and the metadata the Settings page renders its form from.
 */

export type SettingType = "boolean" | "number" | "string" | "select";

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  default: boolean | number | string;
  group: SettingGroup;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  /** Hidden from the CMS form (managed elsewhere or sensitive). */
  internal?: boolean;
}

export type SettingGroup =
  | "attendance"
  | "leave"
  | "holiday_swap"
  | "payroll"
  | "security"
  | "notification"
  | "company"
  | "region";

export const SETTING_GROUPS: Array<{ id: SettingGroup; label: string; description: string }> = [
  { id: "company", label: "Identitas perusahaan", description: "Nama dan info yang tampil di slip gaji, email, dan halaman publik." },
  { id: "attendance", label: "Presensi", description: "Toleransi keterlambatan, selfie, radius, dan koreksi absen." },
  { id: "leave", label: "Izin & cuti", description: "Perhitungan hari, bukti, dan batas pengajuan." },
  { id: "holiday_swap", label: "Tukar libur & lembur", description: "Aturan tukar hari libur nasional dan konversi lembur." },
  { id: "payroll", label: "Payroll", description: "Tarif potongan, lembur, BPJS, dan pajak." },
  { id: "security", label: "Keamanan", description: "Kebijakan password, sesi, dan pembatasan login." },
  { id: "notification", label: "Notifikasi", description: "Kanal pengiriman pemberitahuan otomatis." },
  { id: "region", label: "Zona waktu", description: "Patokan jam untuk presensi, batas hari, laporan, dan semua tampilan waktu." },
];

/** UTC−12 … UTC+14 in whole hours; stored as minutes so half-hour zones can be added later. */
const TIMEZONE_OPTIONS = Array.from({ length: 27 }, (_, i) => {
  const minutes = (i - 12) * 60;
  return { value: String(minutes), label: timezoneLabel(minutes) };
});

export const SETTING_DEFS: SettingDef[] = [
  { key: "timezone_offset_minutes", label: "Zona waktu perusahaan", description: "Default GMT+7 (WIB). Mengubah zona waktu menggeser jam masuk, batas keterlambatan, pergantian hari, dan laporan untuk semua cabang. Data lama tetap tersimpan dalam UTC.", type: "select", default: String(DEFAULT_TIMEZONE_OFFSET_MINUTES), group: "region", options: TIMEZONE_OPTIONS },
  { key: "birthday_window_mode", label: "Periode daftar ulang tahun", description: "Berlaku sama untuk overview, menu admin dan portal karyawan.", type: "select", default: "current_month", group: "company", options: [{ value: "current_month", label: "Bulan ini" }, { value: "upcoming_months", label: "Beberapa bulan ke depan dari hari ini" }, { value: "custom_days", label: "Rentang hari sebelum / sesudah hari ini" }] },
  { key: "birthday_months_ahead", label: "Ulang tahun: bulan ke depan", description: "Untuk mode beberapa bulan. 2 = dari hari ini sampai tanggal yang sama dua bulan lagi (akhir bulan disesuaikan).", type: "number", default: 2, min: 1, max: 6, unit: "bulan", group: "company" },
  { key: "birthday_days_before", label: "Ulang tahun: hari sebelumnya", description: "Untuk rentang hari. Isi 0 untuk hanya hari ini dan ke depan; isi 15 untuk 15 hari terakhir. Pecahan dibulatkan ke bawah.", type: "number", default: 0, min: 0, max: 180, unit: "hari", group: "company" },
  { key: "birthday_days_after", label: "Ulang tahun: hari berikutnya", description: "Untuk rentang hari. Contoh 0/30 = hari ini sampai 30 hari ke depan; 15/15 = 15 hari lalu, hari ini, dan 15 hari mendatang.", type: "number", default: 30, min: 0, max: 180, unit: "hari", group: "company" },
  { key: "birthday_show_birth_year_age", label: "Tampilkan tahun lahir dan usia", description: "Jika aktif, tahun lahir dan usia pada ulang tahun tersebut terlihat oleh seluruh pengguna yang dapat membuka direktori ulang tahun. Nonaktif secara default untuk menjaga privasi.", type: "boolean", default: false, group: "company" },
  /* ---- company ---- */
  { key: "company_name", label: "Nama perusahaan", description: "Muncul di slip gaji, email notifikasi, dan halaman karir.", type: "string", default: "PT Contoh Nusantara", group: "company" },
  { key: "company_address", label: "Alamat perusahaan", description: "Dicetak pada slip gaji dan dokumen resmi.", type: "string", default: "-", group: "company" },

  /* ---- attendance ---- */
  { key: "grace_period_minutes", label: "Toleransi keterlambatan", description: "Menit setelah jam masuk yang belum dihitung terlambat. Jadwal kerja dapat menimpa nilai ini.", type: "number", default: 1, unit: "menit", min: 0, max: 120, group: "attendance" },
  { key: "default_geo_radius", label: "Radius absen default", description: "Dipakai saat cabang belum punya radius sendiri.", type: "number", default: 15, unit: "meter", min: 5, max: 5000, group: "attendance" },
  { key: "enable_break_attendance", label: "Aktifkan absen istirahat", description: "Jika nonaktif, karyawan hanya absen masuk dan pulang.", type: "boolean", default: true, group: "attendance" },
  { key: "require_selfie_clock_in", label: "Wajib selfie saat absen masuk", description: "Foto disimpan terenkripsi dan hanya bisa dilihat lewat tautan bertanda tangan.", type: "boolean", default: true, group: "attendance" },
  { key: "require_selfie_break_out", label: "Wajib selfie saat mulai istirahat", description: "", type: "boolean", default: false, group: "attendance" },
  { key: "require_selfie_break_in", label: "Wajib selfie saat selesai istirahat", description: "", type: "boolean", default: false, group: "attendance" },
  { key: "require_selfie_clock_out", label: "Wajib selfie saat absen pulang", description: "", type: "boolean", default: true, group: "attendance" },
  { key: "face_recognition_enabled", label: "Verifikasi wajah saat presensi", description: "Foto presensi dicocokkan dengan wajah yang didaftarkan karyawan. Bila aktif, absen masuk dan pulang selalu meminta foto, dan absen ditolak bila wajah tidak cocok. Karyawan yang belum mendaftarkan wajah tidak dapat absen sampai mendaftar.", type: "boolean", default: false, group: "attendance" },
  { key: "face_match_strictness", label: "Tingkat kecocokan wajah", description: "Ketat lebih sulit ditembus orang lain tetapi lebih sering menolak foto asli dalam cahaya buruk. Normal disarankan.", type: "select", default: "normal", group: "attendance", options: [
    { value: "ketat", label: "Ketat" },
    { value: "normal", label: "Normal (disarankan)" },
    { value: "longgar", label: "Longgar" },
  ] },
  { key: "allow_location_override", label: "Izinkan menu \"Kendala Lokasi\"", description: "Karyawan dapat absen di luar radius dengan wajib mengisi alasan; entri ditandai untuk direview HRD.", type: "boolean", default: true, group: "attendance" },
  { key: "location_override_min_note", label: "Panjang minimal alasan kendala lokasi", description: "Mencegah alasan asal-asalan seperti \"a\".", type: "number", default: 15, unit: "karakter", min: 0, max: 500, group: "attendance" },
  { key: "max_absen_correction", label: "Kuota koreksi absen", description: "Maksimal pengajuan koreksi absen per karyawan per bulan.", type: "number", default: 3, unit: "x / bulan", min: 0, max: 31, group: "attendance" },
  { key: "correction_max_backdate_days", label: "Batas mundur koreksi absen", description: "Koreksi hanya boleh untuk tanggal dalam rentang hari terakhir.", type: "number", default: 14, unit: "hari", min: 1, max: 180, group: "attendance" },
  { key: "attendance_alerts_enabled", label: "Pantau & ingatkan kehadiran otomatis", description: "Mengirim notifikasi ke karyawan yang belum absen masuk/pulang, ringkasan harian ke atasan dan HR, serta pemberitahuan alpha. Diperiksa setiap 5 menit oleh server.", type: "boolean", default: true, group: "attendance" },
  { key: "attendance_reminder_after_minutes", label: "Ingatkan belum absen masuk setelah", description: "Menit setelah jam masuk + toleransi. Satu pengingat per karyawan per hari.", type: "number", default: 15, unit: "menit", min: 0, max: 240, group: "attendance" },
  { key: "attendance_clockout_reminder_minutes", label: "Ingatkan belum absen pulang setelah", description: "Menit setelah jam pulang jadwal. Satu pengingat per karyawan per hari.", type: "number", default: 60, unit: "menit", min: 0, max: 480, group: "attendance" },
  { key: "attendance_summary_hour", label: "Jam ringkasan kehadiran untuk atasan & HR", description: "Ringkasan jumlah yang belum absen hari ini dan daftar alpha kemarin dikirim sekali sehari mulai jam ini (WIB).", type: "number", default: 10, unit: "jam", min: 0, max: 23, group: "attendance" },
  { key: "attendance_photo_retention_days", label: "Retensi foto presensi", description: "Foto presensi lebih lama dari ini boleh diarsipkan/dihapus oleh tugas terjadwal. 0 = simpan selamanya.", type: "number", default: 365, unit: "hari", min: 0, max: 3650, group: "attendance" },

  /* ---- leave ---- */
  { key: "leave_count_mode", label: "Cara menghitung hari cuti", description: "Menentukan apakah akhir pekan dan hari libur nasional ikut memotong saldo cuti.", type: "select", default: "working_days", group: "leave", options: [
    { value: "working_days", label: "Hari kerja (lewati Sabtu–Minggu & libur nasional)" },
    { value: "calendar_days", label: "Hari kalender (semua hari dihitung)" },
  ] },
  { key: "leave_allow_overlap", label: "Izinkan pengajuan bertumpuk", description: "Jika nonaktif, sistem menolak cuti yang tanggalnya beririsan dengan pengajuan lain.", type: "boolean", default: false, group: "leave" },
  { key: "leave_evidence_min_days", label: "Ambang wajib bukti", description: "Cuti dengan durasi mulai dari nilai ini wajib melampirkan bukti bila jenis cutinya menuntut bukti.", type: "number", default: 2, unit: "hari", min: 1, max: 30, group: "leave" },
  { key: "leave_allow_cancel_pending", label: "Karyawan boleh membatalkan pengajuan", description: "Hanya berlaku selama belum ada approver yang menyetujui.", type: "boolean", default: true, group: "leave" },

  /* ---- holiday swap ---- */
  { key: "holiday_swap_lead_days", label: "Batas pengajuan tukar libur", description: "Minimal H- sekian sebelum tanggal merah.", type: "number", default: 7, unit: "hari", min: 0, max: 90, group: "holiday_swap" },
  { key: "holiday_swap_allow_half_day", label: "Izinkan tukar libur setengah hari", description: "Menampilkan pilihan sesi pagi/siang pada form pengajuan.", type: "boolean", default: false, group: "holiday_swap" },
  { key: "holiday_swap_block_same_division", label: "Cegah bentrok satu divisi", description: "Menolak tukar libur bila rekan sedivisi sudah mengambil tanggal pengganti yang sama.", type: "boolean", default: true, group: "holiday_swap" },
  { key: "holiday_swap_max_consecutive", label: "Maks tanggal merah berurutan", description: "Batas jumlah tanggal merah berdekatan yang boleh ditukar sekaligus.", type: "number", default: 1, unit: "tanggal", min: 1, max: 10, group: "holiday_swap" },
  { key: "overtime_auto_from_holiday", label: "Hitung lembur otomatis di tanggal merah", description: "Jika karyawan masuk di tanggal merah tanpa tukar libur, jam kerjanya dicatat sebagai lembur.", type: "boolean", default: true, group: "holiday_swap" },

  /* ---- payroll ---- */
  { key: "payroll_late_penalty_per_minute", label: "Potongan keterlambatan", description: "Nominal sesuai satuan pilihan di bawah. Mengubah satuan tidak mengonversi nominal otomatis.", type: "number", default: 0, unit: "Rp", min: 0, max: 1000000000, group: "payroll" },
  { key: "payroll_late_unit", label: "Satuan potongan keterlambatan", description: "Per jam proporsional menit (90 menit = 1,5 jam). Per hari dihitung sekali per tanggal terlambat.", type: "select", default: "minute", group: "payroll", options: [{ value: "minute", label: "Per menit" }, { value: "hour", label: "Per jam" }, { value: "day", label: "Per hari terlambat" }] },
  { key: "payroll_late_alpha_enabled", label: "Keterlambatan dapat dianggap alpha", description: "Hanya untuk perhitungan payroll; catatan presensi asli tetap disimpan. Hari yang menjadi alpha tidak dipotong telat lagi.", type: "boolean", default: false, group: "payroll" },
  { key: "payroll_late_alpha_hours", label: "Ambang terlambat menjadi alpha", description: "Lebih dari jumlah jam ini sejak jadwal masuk dianggap alpha. Tepat di ambang masih terlambat.", type: "number", default: 4, unit: "jam", min: 0.01, max: 24, group: "payroll" },
  { key: "payroll_late_penalty_cap", label: "Batas maksimal potongan telat", description: "Batas atas potongan telat per bulan. 0 = tanpa batas.", type: "number", default: 0, unit: "Rp / bulan", min: 0, group: "payroll" },
  { key: "payroll_cap_sanction_enabled", label: "Tinjau sanksi jika melebihi batas potongan", description: "Buat kasus tinjauan HR saat payroll diproses jika potongan telat sebelum dibatasi melebihi plafon bulanan. Tidak menerbitkan sanksi otomatis.", type: "boolean", default: false, group: "payroll" },
  { key: "payroll_cap_sanction_action", label: "Usulan tindakan pelampauan batas", description: "HR tetap harus meninjau bukti dan memberikan keputusan.", type: "select", default: "coaching", group: "payroll", options: [{ value: "coaching", label: "Pembinaan" }, { value: "warning", label: "Teguran" }, { value: "sp1", label: "SP1" }, { value: "sp2", label: "SP2" }, { value: "sp3", label: "SP3" }, { value: "other", label: "Tindakan lain" }] },
  { key: "payroll_cap_sanction_note", label: "Petunjuk penanganan sanksi", description: "Contoh: panggil karyawan dan atasan untuk klarifikasi; ikuti kebijakan perusahaan.", type: "string", default: "Tinjau bukti dan klarifikasi karyawan sebelum memutuskan tindakan.", group: "payroll" },
  { key: "payroll_overtime_rate_per_hour", label: "Upah lembur", description: "Nominal sesuai satuan lembur. Tarif khusus profil karyawan tetap per jam.", type: "number", default: 25000, unit: "Rp", min: 0, group: "payroll" },
  { key: "payroll_overtime_unit", label: "Satuan upah lembur", description: "Diterapkan pada durasi lembur yang disetujui.", type: "select", default: "hour", group: "payroll", options: [{ value: "hour", label: "Per jam" }, { value: "minute", label: "Per menit" }] },
  { key: "payroll_absent_penalty_per_day", label: "Potongan alpha", description: "Rupiah per hari kerja tanpa absensi dan tanpa izin yang disetujui.", type: "number", default: 0, unit: "Rp / hari", min: 0, group: "payroll" },
  { key: "payroll_bpjs_kesehatan_pct", label: "BPJS Kesehatan", description: "Persentase potongan dari gaji pokok.", type: "number", default: 1, unit: "%", min: 0, max: 100, group: "payroll" },
  { key: "payroll_bpjs_tk_pct", label: "BPJS Ketenagakerjaan", description: "Persentase potongan dari gaji pokok.", type: "number", default: 2, unit: "%", min: 0, max: 100, group: "payroll" },
  { key: "payroll_pph21_pct", label: "Tarif PPh 21 sederhana", description: "Persentase pajak atas penghasilan kena pajak di atas ambang PTKP bulanan.", type: "number", default: 5, unit: "%", min: 0, max: 100, group: "payroll" },
  { key: "payroll_pph21_threshold", label: "Ambang PTKP bulanan", description: "Penghasilan bulanan di bawah nilai ini tidak dikenai PPh 21.", type: "number", default: 4500000, unit: "Rp", min: 0, group: "payroll" },
  { key: "payroll_default_basic_salary", label: "Gaji pokok default", description: "Dipakai bila karyawan belum punya kontrak aktif dengan nominal gaji.", type: "number", default: 0, unit: "Rp", min: 0, group: "payroll" },
  { key: "payroll_publish_day", label: "Tanggal terbit slip gaji", description: "Tanggal setiap bulan saat slip gabungan diterbitkan ke karyawan.", type: "number", default: 25, unit: "tanggal", min: 1, max: 28, group: "payroll" },

  /* ---- security ---- */
  { key: "password_min_length", label: "Panjang minimal password", description: "Berlaku saat karyawan mengubah atau mereset password.", type: "number", default: 10, unit: "karakter", min: 8, max: 64, group: "security" },
  { key: "login_max_attempts", label: "Maks percobaan login gagal", description: "Akun dikunci sementara setelah melewati batas ini.", type: "number", default: 5, unit: "percobaan", min: 3, max: 20, group: "security" },
  { key: "login_lockout_minutes", label: "Durasi kunci akun", description: "Lama akun terkunci setelah percobaan login gagal beruntun.", type: "number", default: 15, unit: "menit", min: 1, max: 1440, group: "security" },
  { key: "force_password_change_on_first_login", label: "Wajib ganti password saat login pertama", description: "Mencegah akun karyawan tetap memakai password default dari HRD.", type: "boolean", default: true, group: "security" },
  // Superseded by per-role initial passwords (lib/auth/initial-password.ts). Kept
  // internal so older deployments keep their value as the starting point.
  { key: "default_employee_password", label: "Password awal karyawan baru (lama)", description: "Digantikan pengaturan kata sandi awal per peran.", type: "string", default: "", group: "security", internal: true },

  /* ---- notification ---- */
  { key: "notify_email_enabled", label: "Kirim notifikasi email", description: "Mematikan ini menghentikan seluruh email otomatis sistem.", type: "boolean", default: true, group: "notification" },
  { key: "notify_whatsapp_enabled", label: "Kirim notifikasi WhatsApp", description: "Membutuhkan WA_PROVIDER yang aktif di environment.", type: "boolean", default: false, group: "notification" },
  { key: "notify_inapp_enabled", label: "Notifikasi dalam aplikasi", description: "Lonceng notifikasi di header portal dan admin.", type: "boolean", default: true, group: "notification" },
];

export const SETTING_MAP: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d])
);

export const SETTING_DEFAULTS: Record<string, boolean | number | string> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d.default])
);

/** Coerces a raw stored value into the type its definition declares. */
export function coerceSetting(key: string, raw: unknown): boolean | number | string {
  const def = SETTING_MAP[key];
  if (!def) return raw as string;
  if (raw === undefined || raw === null || raw === "") return def.default;

  switch (def.type) {
    case "boolean":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.-]/g, ""));
      if (!Number.isFinite(n)) return def.default;
      if (def.min !== undefined && n < def.min) return def.min;
      if (def.max !== undefined && n > def.max) return def.max;
      return n;
    }
    case "select": {
      const v = String(raw);
      return def.options?.some((o) => o.value === v) ? v : def.default;
    }
    default:
      return String(raw);
  }
}

export type SettingsSnapshot = Record<string, boolean | number | string>;

/**
 * Reads every setting, merged over the declared defaults, so callers never have
 * to null-check a missing row. Cached briefly because most requests read several
 * keys and settings change rarely.
 */
let cache: { at: number; data: SettingsSnapshot } | null = null;
const CACHE_TTL_MS = 15_000;

export async function getSettings(force = false): Promise<SettingsSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const snapshot: SettingsSnapshot = { ...SETTING_DEFAULTS };
  try {
    await connectToDatabase();
    const rows = await Setting.find({}).lean<Array<{ key: string; value: unknown }>>();
    for (const row of rows) {
      // Structured, credential-like rows are read by their own modules only.
      if (row.key === "initial_password_policy" || row.key === "license_activation" || row.key === "app_branding") continue;
      snapshot[row.key] = SETTING_MAP[row.key]
        ? coerceSetting(row.key, row.value)
        : (row.value as string);
    }
  } catch (err) {
    console.error("[SETTINGS] Falling back to defaults:", (err as Error).message);
  }

  setTimezoneOffset(Number(snapshot.timezone_offset_minutes));
  cache = { at: Date.now(), data: snapshot };
  return snapshot;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function getSettingNumber(key: string): Promise<number> {
  const s = await getSettings();
  return Number(s[key] ?? SETTING_DEFAULTS[key] ?? 0);
}

export async function getSettingBool(key: string): Promise<boolean> {
  const s = await getSettings();
  return Boolean(s[key] ?? SETTING_DEFAULTS[key] ?? false);
}

export async function getSettingString(key: string): Promise<string> {
  const s = await getSettings();
  return String(s[key] ?? SETTING_DEFAULTS[key] ?? "");
}
