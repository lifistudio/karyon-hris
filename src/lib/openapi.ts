/**
 * OpenAPI 3.1 description of the HRIS API.
 *
 * Hand-maintained but co-located with the code it documents, and served from
 * `/api/v1/openapi` so the reference page and any external client read the same
 * definition. When you add or change a route, update the matching entry here.
 */

import { API_UPDATES } from "./openapi-updates";
export interface ApiParam {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  type?: string;
  description: string;
}

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface ApiEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description: string;
  /** Module × action checked by `checkPermission`, or a plain note. */
  auth: string;
  params?: ApiParam[];
  body?: ApiField[];
  errors?: Array<{ code: string; when: string }>;
  example?: Record<string, unknown>;
}

export interface ApiGroup {
  name: string;
  description: string;
  endpoints: ApiEndpoint[];
}

export const API_BASE = "/api/v1";

const BASE_GROUPS: ApiGroup[] = [
  {
    name: "Autentikasi",
    description:
      "Login memakai Auth.js pada /api/auth/*. Endpoint di bawah menangani reset dan penggantian kata sandi, seluruhnya dibatasi laju per IP dan per identitas.",
    endpoints: [
      {
        method: "POST",
        path: "/auth/forgot-password",
        summary: "Minta kode reset kata sandi",
        description:
          "Mengirim kode 6 angka ke email pengguna. Respons selalu sama baik email terdaftar maupun tidak, agar endpoint ini tidak dapat dipakai memetakan alamat email yang valid.",
        auth: "Publik (rate limited)",
        body: [{ name: "email", type: "string", required: true, description: "Email akun." }],
        errors: [{ code: "429 RATE_LIMITED", when: "Terlalu banyak permintaan dari satu IP atau email." }],
      },
      {
        method: "POST",
        path: "/auth/reset-password",
        summary: "Setel ulang kata sandi dengan kode",
        description:
          "Menukar kode verifikasi dengan kata sandi baru. Berhasil mereset juga membuka penguncian akun.",
        auth: "Publik (rate limited)",
        body: [
          { name: "email", type: "string", required: true, description: "Email akun." },
          { name: "code", type: "string", required: true, description: "Kode 6 angka dari email." },
          { name: "newPassword", type: "string", required: true, description: "Kata sandi baru sesuai kebijakan." },
        ],
        errors: [
          { code: "400 OTP_INVALID", when: "Kode salah atau kedaluwarsa." },
          { code: "429 OTP_LOCKED", when: "Melebihi 5 percobaan kode." },
          { code: "400 WEAK_PASSWORD", when: "Kata sandi tidak memenuhi kebijakan." },
        ],
      },
      {
        method: "POST",
        path: "/auth/change-password-verify",
        summary: "Kirim kode untuk ganti kata sandi",
        description: "Mengirim kode verifikasi ke email pengguna yang sedang login.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/auth/change-password",
        summary: "Ganti kata sandi sendiri",
        description:
          "Memerlukan kata sandi lama sekaligus kode dari email, sehingga sesi yang dibajak saja tidak cukup untuk mengunci pemilik akun.",
        auth: "Perlu sesi",
        body: [
          { name: "currentPassword", type: "string", required: true, description: "Kata sandi saat ini." },
          { name: "code", type: "string", required: true, description: "Kode 6 angka." },
          { name: "newPassword", type: "string", required: true, description: "Kata sandi baru." },
        ],
      },
    ],
  },

  {
    name: "Presensi",
    description: "Pencatatan dan pembacaan presensi harian. Seluruh waktu dihitung dalam WIB.",
    endpoints: [
      {
        method: "GET",
        path: "/attendance",
        summary: "Riwayat presensi",
        description:
          "Mengembalikan catatan presensi satu periode beserta pengaturan yang dibutuhkan portal untuk merender tombolnya. URL foto dikeluarkan sebagai tautan bertanda tangan berumur 15 menit.",
        auth: "attendance:read (lingkup menentukan luas data)",
        params: [
          { name: "period", in: "query", type: "string", description: "Periode YYYY-MM. Default bulan berjalan." },
          { name: "employeeId", in: "query", description: "Membaca presensi karyawan lain; butuh lingkup di atas self." },
          { name: "scope", in: "query", description: "Isi `all` untuk seluruh karyawan dalam lingkup Anda." },
        ],
      },
      {
        method: "POST",
        path: "/attendance",
        summary: "Catat satu tahap presensi",
        description:
          "Mencatat absen masuk, mulai/selesai istirahat, atau absen pulang. Urutan tahap, radius kantor, dan kewajiban selfie divalidasi di server.",
        auth: "Perlu sesi karyawan",
        body: [
          { name: "action", type: "enum", required: true, description: "clock_in | break_out | break_in | clock_out" },
          { name: "lat", type: "number", required: true, description: "Latitude perangkat." },
          { name: "lng", type: "number", required: true, description: "Longitude perangkat." },
          { name: "accuracy", type: "number", description: "Akurasi GPS dalam meter." },
          { name: "photo", type: "string", description: "Data URL foto selfie (JPEG/PNG/WEBP, maks 8 MB)." },
          { name: "isLocationOverride", type: "boolean", description: "Memakai jalur Kendala Lokasi; mewajibkan `note`." },
          { name: "note", type: "string", description: "Catatan bebas, wajib bila override lokasi dipakai." },
        ],
        errors: [
          { code: "400 GEOFENCE_REJECTED", when: "Di luar radius tanpa izin WFH maupun override." },
          { code: "409 CONFLICT", when: "Tahap tidak berurutan, misalnya absen pulang sebelum masuk." },
          { code: "429 RATE_LIMITED", when: "Terlalu sering mengirim dalam satu menit." },
        ],
      },
      {
        method: "GET",
        path: "/attendance/daily",
        summary: "Pemantauan kehadiran harian",
        description:
          "Status setiap karyawan pada satu hari: hadir, terlambat, izin/cuti, libur, libur nasional, belum mulai, belum absen, atau alpha, beserta jadwal, jam masuk/pulang dan penanda belum absen pulang. Ringkasan dihitung atas seluruh lingkup sebelum filter.",
        auth: "attendance:read (lingkup menentukan luas data)",
        params: [
          { name: "date", in: "query", description: "YYYY-MM-DD, default hari ini (WIB). Maks 1 tahun ke belakang, 31 hari ke depan." },
          { name: "status", in: "query", description: "present | late | leave | off | holiday | not_started | missing | absent" },
          { name: "branchId", in: "query", description: "Filter cabang." },
          { name: "divisionId", in: "query", description: "Filter divisi." },
          { name: "q", in: "query", description: "Cari nama atau NIP." },
        ],
      },
      {
        method: "POST",
        path: "/attendance/daily",
        summary: "Kirim pengingat ke karyawan yang belum absen",
        description: "Mengirim notifikasi ke karyawan dalam lingkup yang berstatus belum absen hari ini. Maksimal satu pengingat manual per karyawan per hari; dibatasi 5 permintaan per jam.",
        auth: "attendance:write",
        body: [
          { name: "action", type: "string", required: true, description: "remind" },
          { name: "date", type: "string", description: "Harus hari ini bila diisi." },
        ],
      },
      {
        method: "GET",
        path: "/attendance/correction",
        summary: "Daftar pengajuan koreksi absen",
        description: "Mengembalikan pengajuan koreksi beserta sisa kuota bulan berjalan.",
        auth: "Perlu sesi; `scope=all` butuh attendance:read lingkup luas",
      },
      {
        method: "POST",
        path: "/attendance/correction",
        summary: "Ajukan koreksi absen",
        description:
          "Pengajuan yang melewati kuota bulanan otomatis diarahkan ke alur persetujuan HRD → Audit → Direksi.",
        auth: "Perlu sesi karyawan",
        body: [
          { name: "date", type: "string", required: true, description: "Tanggal yang dikoreksi (YYYY-MM-DD)." },
          { name: "clockInTime", type: "string", required: true, description: "Jam masuk seharusnya (HH:MM)." },
          { name: "clockOutTime", type: "string", required: true, description: "Jam pulang seharusnya (HH:MM)." },
          { name: "reasonType", type: "enum", required: true, description: "lupa_tap | kendala_aplikasi | dinas_luar | lainnya" },
          { name: "reasonNote", type: "string", required: true, description: "Penjelasan, minimal 15 karakter." },
          { name: "attachment", type: "object", description: "Bukti: `{ kind: \"file\", token }` dari POST /uploads, atau `{ kind: \"link\", url }`." },
          { name: "evidence", type: "string", description: "Data URL bukti. Format lama, masih diterima." },
        ],
      },
      {
        method: "DELETE",
        path: "/attendance/correction",
        summary: "Batalkan pengajuan koreksi",
        description: "Hanya untuk pengajuan yang belum disentuh approver.",
        auth: "Perlu sesi karyawan (pemilik pengajuan)",
        params: [{ name: "id", in: "query", required: true, description: "ID pengajuan." }],
      },
    ],
  },

  {
    name: "Izin & Cuti",
    description: "Pengajuan izin/cuti, saldo, dan pembatalan mandiri.",
    endpoints: [
      {
        method: "GET",
        path: "/leave",
        summary: "Saldo dan riwayat cuti",
        description:
          "Tanpa parameter mengembalikan saldo dan riwayat pemohon. Dengan `type=types` mengembalikan jenis cuti yang tersedia untuk profil pemohon.",
        auth: "Perlu sesi",
        params: [{ name: "type", in: "query", description: "`balance` (default) atau `types`." }],
      },
      {
        method: "POST",
        path: "/leave",
        summary: "Ajukan izin atau cuti",
        description:
          "Memvalidasi batas H-, durasi maksimal, tumpang tindih tanggal, kewajiban bukti, dan ketersediaan saldo. Saldo ditahan secara atomik saat pengajuan dibuat.",
        auth: "Perlu sesi karyawan",
        body: [
          { name: "leaveTypeId", type: "string", required: true, description: "ID jenis cuti." },
          { name: "startDate", type: "string", required: true, description: "Tanggal mulai (YYYY-MM-DD)." },
          { name: "endDate", type: "string", required: true, description: "Tanggal selesai (YYYY-MM-DD)." },
          { name: "reason", type: "string", required: true, description: "Alasan, minimal 10 karakter." },
          { name: "attachment", type: "object", description: "Bukti bila jenisnya mewajibkan: `{ kind: \"file\", token }` dari POST /uploads, atau `{ kind: \"link\", url }`." },
          { name: "evidence", type: "string", description: "Data URL bukti. Format lama, masih diterima." },
        ],
        errors: [
          { code: "400 LEAD_TIME", when: "Diajukan lebih mepet dari batas H- jenis cuti tersebut." },
          { code: "409 CONFLICT", when: "Saldo tidak cukup atau tanggal beririsan dengan pengajuan lain." },
        ],
      },
      {
        method: "DELETE",
        path: "/leave",
        summary: "Batalkan pengajuan cuti",
        description: "Mengembalikan saldo yang ditahan. Hanya selama belum ada approver yang bertindak.",
        auth: "Perlu sesi karyawan (pemilik pengajuan)",
        params: [{ name: "id", in: "query", required: true, description: "ID pengajuan." }],
      },
    ],
  },

  {
    name: "Tukar Libur",
    description: "Menukar hari libur nasional yang dimasuki dengan hari libur pengganti.",
    endpoints: [
      {
        method: "GET",
        path: "/holiday-swap",
        summary: "Pengajuan, tanggal merah, dan aturan yang berlaku",
        description: "Mengembalikan riwayat pemohon, tanggal merah mendatang, dan parameter aturan dari CMS.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/holiday-swap",
        summary: "Ajukan tukar libur",
        description:
          "Memvalidasi batas H-, satu klaim per tanggal merah, hari kerja untuk tanggal pengganti, bentrok sedivisi, dan batas tanggal merah berdekatan.",
        auth: "Perlu sesi karyawan",
        body: [
          { name: "holidayDate", type: "string", required: true, description: "Tanggal merah yang akan dimasuki." },
          { name: "replacementDate", type: "string", required: true, description: "Hari kerja pengganti." },
          { name: "isHalfDay", type: "boolean", description: "Tukar setengah hari, bila diizinkan CMS." },
          { name: "session", type: "enum", description: "morning | afternoon, bila setengah hari." },
          { name: "reason", type: "string", description: "Catatan opsional." },
        ],
      },
      {
        method: "DELETE",
        path: "/holiday-swap",
        summary: "Batalkan pengajuan tukar libur",
        description: "Hanya untuk pengajuan yang belum disentuh approver.",
        auth: "Perlu sesi karyawan (pemilik pengajuan)",
        params: [{ name: "id", in: "query", required: true, description: "ID pengajuan." }],
      },
    ],
  },

  {
    name: "Persetujuan",
    description:
      "Mesin persetujuan polimorfik yang dipakai bersama oleh cuti, koreksi absen, dan tukar libur.",
    endpoints: [
      {
        method: "GET",
        path: "/approvals",
        summary: "Antrean persetujuan",
        description:
          "Mengembalikan pengajuan yang menunggu peran pemanggil. SPV hanya melihat divisinya sendiri.",
        auth: "Perlu sesi",
        params: [{ name: "view", in: "query", description: "`inbox` (default) atau `history`." }],
      },
      {
        method: "POST",
        path: "/approvals",
        summary: "Setujui atau tolak",
        description:
          "Mencatat keputusan dan meneruskan ke approver berikutnya, atau menerapkan efek akhirnya bila ini langkah terakhir.",
        auth: "Perlu sesi dengan peran yang cocok dengan langkah aktif",
        body: [
          { name: "instanceId", type: "string", required: true, description: "ID instance persetujuan." },
          { name: "action", type: "enum", required: true, description: "approve | reject" },
          { name: "comment", type: "string", description: "Wajib minimal 5 karakter bila menolak." },
        ],
        errors: [
          { code: "403 FORBIDDEN", when: "Langkah aktif menunggu peran lain." },
          { code: "409 ALREADY_DECIDED", when: "Pengajuan sudah diputuskan approver lain." },
        ],
      },
    ],
  },

  {
    name: "Payroll",
    description: "Slip gaji dan pembuatannya. Seluruh tarif diambil dari pengaturan CMS.",
    endpoints: [
      {
        method: "GET",
        path: "/payroll",
        summary: "Daftar slip gaji",
        description:
          "Pemanggil berlingkup sempit hanya menerima slip miliknya sendiri dan hanya yang sudah terbit. Tautan berkas bertanda tangan berumur 15 menit.",
        auth: "payroll:read",
        params: [{ name: "period", in: "query", description: "Periode YYYY-MM." }],
      },
      {
        method: "POST",
        path: "/payroll",
        summary: "Buat slip gaji",
        description:
          "Menghitung penghasilan, lembur, potongan keterlambatan dan alpha, BPJS, serta PPh 21 berdasarkan tarif di CMS, lalu menyimpan dokumen slipnya.",
        auth: "payroll:write",
        body: [
          { name: "period", type: "string", required: true, description: "Periode YYYY-MM." },
          { name: "employeeIds", type: "string[]", required: true, description: "Daftar ID karyawan, maksimal 500." },
          { name: "publish", type: "boolean", description: "false untuk membuat draf yang belum terlihat karyawan." },
        ],
      },
      {
        method: "DELETE",
        path: "/payroll",
        summary: "Hapus draf slip gaji",
        description: "Slip yang sudah terbit tidak dapat dihapus demi jejak audit.",
        auth: "payroll:delete",
        params: [{ name: "id", in: "query", required: true, description: "ID slip gaji." }],
      },
      {
        method: "GET",
        path: "/payroll/templates",
        summary: "Daftar template slip gaji",
        description:
          "Template menentukan blok mana yang tercetak, urutannya, judulnya, dan identitas perusahaan di kop. Template bertanda isDefault dipakai bila slip tidak menunjuk template tertentu.",
        auth: "payroll:read",
      },
      {
        method: "POST",
        path: "/payroll/templates",
        summary: "Simpan template slip gaji",
        description:
          "Membuat template baru, atau memperbarui yang sudah ada bila id disertakan. Menyetel isDefault melepas tanda itu dari template lain sekaligus.",
        auth: "payroll:write",
        body: [
          { name: "id", type: "string", description: "Sertakan untuk memperbarui, kosongkan untuk membuat baru." },
          { name: "name", type: "string", required: true, description: "Nama template." },
          { name: "mode", type: "string", description: "builder (disusun dari blok) atau upload (berkas sendiri)." },
          { name: "blocks", type: "object[]", required: true, description: "Blok berurutan: type, enabled, title, options." },
          { name: "employeeFields", type: "string[]", description: "Kolom identitas yang dicetak pada blok karyawan." },
          { name: "paperSize", type: "string", description: "A4 atau Letter." },
          { name: "accentColor", type: "string", description: "Warna aksen heksadesimal untuk judul dan baris gaji bersih." },
          { name: "isDefault", type: "boolean", description: "Jadikan template bawaan." },
        ],
        errors: [{ code: "409 CONFLICT", when: "Nama template sudah dipakai." }],
      },
      {
        method: "DELETE",
        path: "/payroll/templates",
        summary: "Hapus template slip gaji",
        description: "Template bawaan tidak dapat dihapus selama masih menjadi satu-satunya.",
        auth: "payroll:delete",
        params: [{ name: "id", in: "query", required: true, description: "ID template." }],
      },
      {
        method: "GET",
        path: "/payroll/document",
        summary: "Data dokumen slip gaji",
        description:
          "Menggabungkan satu slip, template yang berlaku, identitas perusahaan, dan ringkasan kehadiran menjadi satu payload siap cetak. Dipakai halaman /print/payslip/[id], yang mencetak lewat dialog cetak peramban alih-alih generator PDF di server.",
        auth: "payroll:read, atau karyawan pemilik slip",
        params: [{ name: "id", in: "query", required: true, description: "ID slip gaji." }],
        errors: [{ code: "403 FORBIDDEN", when: "Slip milik karyawan lain dan pemanggil tidak berizin luas." }],
      },
    ],
  },

  {
    name: "Master Data",
    description: "Cabang, divisi, jabatan, jadwal kerja, hari libur, peran, dan pengaturan.",
    endpoints: [
      {
        method: "GET",
        path: "/branches",
        summary: "Daftar cabang",
        description: "Termasuk koordinat, radius, dan jumlah karyawan aktif per cabang.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/branches",
        summary: "Tambah atau ubah cabang",
        description: "Sertakan `id` untuk mengubah cabang yang sudah ada.",
        auth: "settings:write",
        body: [
          { name: "name", type: "string", required: true, description: "Nama cabang." },
          { name: "address", type: "string", required: true, description: "Alamat lengkap." },
          { name: "lat", type: "number", required: true, description: "Latitude titik kantor." },
          { name: "lng", type: "number", required: true, description: "Longitude titik kantor." },
          { name: "radiusMeter", type: "number", description: "Radius absen, 5–5000 meter." },
          { name: "workHours", type: "object", description: "{ start, end } format HH:MM." },
        ],
      },
      {
        method: "PUT",
        path: "/branches/active",
        summary: "Pilih cabang yang tetap aktif",
        description: "Tanpa lisensi multi-cabang hanya satu cabang yang dapat dipakai untuk presensi dan penempatan. Cabang lain aktif kembali otomatis setelah lisensi Pro aktif.",
        auth: "settings:write",
        body: [{ name: "branchId", type: "string", required: true, description: "ID cabang yang tetap aktif." }],
      },
      {
        method: "GET",
        path: "/holidays",
        summary: "Hari libur nasional",
        description: "Memengaruhi perhitungan cuti, tukar libur, dan hari kerja payroll.",
        auth: "Perlu sesi",
        params: [
          { name: "year", in: "query", description: "Tahun, default tahun berjalan." },
          { name: "upcoming", in: "query", description: "Isi `1` untuk hanya tanggal mendatang." },
        ],
      },
      {
        method: "POST",
        path: "/holidays",
        summary: "Tambah atau ubah hari libur",
        description: "Menyimpan pada tanggal yang sama akan menimpa entri lama.",
        auth: "settings:write",
        body: [
          { name: "dateKey", type: "string", required: true, description: "Tanggal YYYY-MM-DD." },
          { name: "name", type: "string", required: true, description: "Nama hari libur." },
          { name: "type", type: "enum", description: "libur_nasional | cuti_bersama" },
          { name: "isActive", type: "boolean", description: "Nonaktifkan tanpa menghapus riwayat." },
        ],
      },
      {
        method: "GET",
        path: "/settings",
        summary: "Baca pengaturan",
        description:
          "Mengembalikan nilai efektif (baris tersimpan digabung di atas default). Dengan `schema=1` dan peran admin, menyertakan metadata untuk merender formulirnya.",
        auth: "Perlu sesi",
        params: [{ name: "schema", in: "query", description: "Isi `1` untuk menyertakan metadata field." }],
      },
      {
        method: "POST",
        path: "/settings",
        summary: "Ubah pengaturan",
        description:
          "Kirim hanya kunci yang berubah. Kunci di luar daftar yang dideklarasikan akan ditolak.",
        auth: "settings:write",
      },
      {
        method: "GET",
        path: "/roles",
        summary: "Peran dan matriks hak akses",
        description: "Menyertakan daftar modul, aksi, dan lingkup yang sah untuk merender matriksnya.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/roles",
        summary: "Buat peran atau ubah hak aksesnya",
        description:
          "Kirim `name` untuk membuat peran baru, atau `roleId` + `permissions` untuk mengganti matriksnya. Hak akses SUPERADMIN tidak dapat diubah.",
        auth: "settings:write",
      },
    ],
  },

  {
    name: "Karyawan",
    description: "Data kepegawaian. Field sensitif terenkripsi dan disamarkan menurut lingkup izin.",
    endpoints: [
      {
        method: "GET",
        path: "/employees",
        summary: "Daftar karyawan",
        description: "NIK, NPWP, dan rekening hanya tampil utuh untuk lingkup seluruh perusahaan.",
        auth: "employees:read",
        params: [
          { name: "q", in: "query", description: "Pencarian nama, NIP, atau email kantor." },
          { name: "status", in: "query", description: "active | onboarding | suspended | resigned | all" },
          { name: "newHire", in: "query", description: "1 = hanya karyawan hasil rekrutmen yang datanya belum lengkap. Baris tersebut membawa `missingFields`." },
          { name: "page", in: "query", description: "Halaman, default 1." },
          { name: "limit", in: "query", description: "Baris per halaman, maksimal 500." },
        ],
      },
      {
        method: "POST",
        path: "/employees",
        summary: "Tambah atau ubah karyawan",
        description:
          "Tanpa `id` akan membuat karyawan baru beserta NIP otomatis, dan akun login bila `roleId` disertakan. Pada karyawan bertanda baru, tanda itu hilang otomatis ketika penyimpanan membuat seluruh data wajib terisi.",
        auth: "employees:write",
      },
      {
        method: "PATCH",
        path: "/employees",
        summary: "Hapus tanda karyawan baru",
        description:
          "Untuk karyawan hasil rekrutmen yang dianggap HRD sudah cukup lengkap walau ada data yang memang kosong. Data yang masih kosong disebutkan pada pesan dan dicatat di jejak audit.",
        auth: "employees:write",
        body: [{ name: "id", type: "string", required: true, description: "ID karyawan." }],
      },
      {
        method: "GET",
        path: "/employees/{id}",
        summary: "Detail satu karyawan",
        description: "Membaca profil sendiri selalu diizinkan.",
        auth: "employees:read atau pemilik profil",
        params: [{ name: "id", in: "path", required: true, description: "ID karyawan." }],
      },
      {
        method: "PATCH",
        path: "/employees/{id}",
        summary: "Perbarui profil sendiri",
        description:
          "Hanya kontak, alamat domisili, media sosial, dan foto. Perubahan NIK, NPWP, dan rekening harus lewat HRD.",
        auth: "Pemilik profil",
      },
      {
        method: "DELETE",
        path: "/employees/{id}",
        summary: "Nonaktifkan karyawan",
        description:
          "Mengubah status menjadi resign dan menutup akses login. Data tidak dihapus agar riwayat presensi dan payroll tetap utuh.",
        auth: "employees:delete",
      },
    ],
  },

  {
    name: "Verifikasi Wajah",
    description:
      "Pendaftaran dan verifikasi wajah untuk presensi. Wajah dianalisis di server dari foto aslinya — tidak ada vektor wajah yang diterima dari atau dikirim ke klien. Fitur aktif bila setelan face_recognition_enabled menyala; pendaftaran tetap dapat dilakukan saat nonaktif.",
    endpoints: [
      {
        method: "GET",
        path: "/face",
        summary: "Status wajah milik sendiri",
        description:
          "Status pendaftaran, permintaan penggantian yang menunggu, keputusan terakhir, dan teks persetujuan yang berlaku. Foto acuan dikembalikan sebagai tautan bertanda tangan 10 menit.",
        auth: "Perlu sesi karyawan",
      },
      {
        method: "POST",
        path: "/face",
        summary: "Daftarkan wajah atau ajukan penggantian",
        description:
          "Tanpa wajah terdaftar: langsung didaftarkan dan SPV diberi tahu. Dengan wajah terdaftar: membuat permintaan penggantian yang harus disetujui SPV lewat mesin approval; wajah lama tetap berlaku sampai diputuskan. Ketiga foto harus berisi tepat satu wajah yang cukup besar dan saling cocok.",
        auth: "Perlu sesi karyawan (10 per jam)",
        body: [
          { name: "photos", type: "string[]", required: true, description: "Tepat 3 data URL gambar JPEG/PNG/WebP." },
          { name: "consent", type: "boolean", required: true, description: "Harus true." },
          { name: "consentVersion", type: "string", required: true, description: "Versi teks persetujuan dari GET /face." },
          { name: "reason", type: "string", description: "Wajib minimal 10 karakter untuk penggantian." },
        ],
        errors: [
          { code: "422 FACE_QUALITY", when: "Salah satu foto tanpa wajah, berisi lebih dari satu wajah, atau wajah terlalu kecil." },
          { code: "422 FACE_INCONSISTENT", when: "Foto-foto tidak terlihat sebagai orang yang sama." },
          { code: "409 CONFLICT", when: "Sudah ada permintaan penggantian yang menunggu." },
          { code: "503 FACE_BUSY", when: "Antrean analisis wajah penuh; coba lagi beberapa detik lagi." },
        ],
      },
      {
        method: "DELETE",
        path: "/face",
        summary: "Batalkan permintaan penggantian",
        description: "Hanya selama SPV belum memprosesnya. Foto dan data wajah pengganti dihapus.",
        auth: "Perlu sesi karyawan",
      },
      {
        method: "GET",
        path: "/face/admin",
        summary: "Status wajah karyawan (HRD)",
        description:
          "Dengan employeeId: status satu karyawan beserta foto acuan. Tanpa parameter: ringkasan jumlah terdaftar tanpa foto.",
        auth: "Peran SUPERADMIN atau HRD",
        params: [{ name: "employeeId", in: "query", description: "ID karyawan." }],
      },
      {
        method: "DELETE",
        path: "/face/admin",
        summary: "Reset data wajah karyawan",
        description:
          "Menghapus profil wajah, foto acuan, permintaan yang menunggu, dan data wajah dari seluruh permintaan lama. Dicatat di audit dan diberitahukan ke karyawan.",
        auth: "Peran SUPERADMIN atau HRD",
        params: [
          { name: "employeeId", in: "query", required: true, description: "ID karyawan." },
          { name: "reason", in: "query", required: true, description: "Alasan, minimal 10 karakter." },
        ],
      },
      {
        method: "POST",
        path: "/attendance",
        summary: "Presensi dengan verifikasi wajah",
        description:
          "Saat verifikasi wajah aktif, absen masuk dan pulang wajib berfoto, dan setiap foto dicocokkan dengan wajah terdaftar sebelum rekaman disimpan. Kegagalan pencocokan tidak mengembalikan angka jarak — nilainya hanya dicatat di audit sebagai FACE_MISMATCH.",
        auth: "Perlu sesi karyawan",
        errors: [
          { code: "403 FACE_NOT_ENROLLED", when: "Karyawan belum mendaftarkan wajah." },
          { code: "422 FACE_QUALITY", when: "Wajah tidak terdeteksi, lebih dari satu, atau terlalu jauh." },
          { code: "422 FACE_MISMATCH", when: "Wajah tidak cocok dengan wajah terdaftar." },
        ],
      },
    ],
  },

  {
    name: "Lowongan & Pelamar",
    description:
      "Lowongan terpisah dari jabatan: jabatan adalah entri tetap pada struktur organisasi, sedangkan lowongan terikat waktu dan boleh dibuka berkali-kali untuk jabatan yang sama. Pelamar bergerak melalui tahap seleksi yang ditentukan tiap lowongan.",
    endpoints: [
      {
        method: "GET",
        path: "/vacancies",
        summary: "Daftar lowongan (admin)",
        description: "Termasuk draf dan lowongan tertutup, lengkap dengan jumlah pelamar dan kunjungan.",
        auth: "recruitment:read",
        params: [
          { name: "status", in: "query", description: "draft | open | closed | archived." },
          { name: "q", in: "query", description: "Pencarian pada judul lowongan." },
        ],
      },
      {
        method: "POST",
        path: "/vacancies",
        summary: "Buat lowongan",
        description:
          "Slug dibuat otomatis dari judul dengan akhiran acak, sehingga judul yang sama persis dengan lowongan lama tetap menghasilkan alamat yang unik.",
        auth: "recruitment:write",
        body: [
          { name: "title", type: "string", required: true, description: "Judul lowongan." },
          { name: "positionId", type: "string", required: true, description: "Jabatan yang dilamar." },
          { name: "employmentType", type: "string", required: true, description: "fulltime | contract | parttime | internship | freelance." },
          { name: "workArrangement", type: "string", required: true, description: "onsite | hybrid | remote." },
          { name: "responsibilities", type: "string[]", description: "Daftar tanggung jawab." },
          { name: "requirements", type: "string[]", description: "Daftar kualifikasi wajib." },
          { name: "stages", type: "string[]", required: true, description: "Tahap seleksi berurutan, minimal dua." },
          { name: "status", type: "string", description: "draft agar belum tampil di halaman karier." },
        ],
      },
      {
        method: "PATCH",
        path: "/vacancies",
        summary: "Ubah atau terbitkan lowongan",
        description:
          "Mengubah status menjadi open mengisi publishedAt satu kali saja, sehingga umur lowongan tidak ikut berubah ketika disunting kemudian.",
        auth: "recruitment:write",
      },
      {
        method: "DELETE",
        path: "/vacancies",
        summary: "Hapus lowongan",
        description: "Lowongan yang sudah memiliki pelamar tidak dapat dihapus; arsipkan saja.",
        auth: "recruitment:delete",
        params: [{ name: "id", in: "query", required: true, description: "ID lowongan." }],
        errors: [{ code: "409 CONFLICT", when: "Sudah ada pelamar pada lowongan ini." }],
      },
      {
        method: "GET",
        path: "/vacancies/{id}",
        summary: "Papan pelamar satu lowongan",
        description: "Mengembalikan detail lowongan beserta pelamarnya, dikelompokkan menurut tahap seleksi.",
        auth: "recruitment:read",
        params: [{ name: "id", in: "path", required: true, description: "ID lowongan." }],
      },
      {
        method: "GET",
        path: "/public/vacancies",
        summary: "Lowongan terbuka (publik)",
        description:
          "Hanya lowongan berstatus open yang belum melewati closesAt. Tanpa slug mengembalikan daftar; dengan slug mengembalikan satu lowongan sekaligus menaikkan penghitung kunjungan.",
        auth: "Publik",
        params: [{ name: "slug", in: "query", description: "Slug lowongan untuk mengambil satu detail." }],
      },
      {
        method: "GET",
        path: "/vacancies/{id}/form",
        summary: "Formulir lamaran lowongan",
        description:
          "Definisi kolom formulir lamaran. Lowongan yang belum diatur memakai formulir bawaan (`isDefault: true`).",
        auth: "recruitment:read",
        params: [{ name: "id", in: "path", required: true, description: "ID lowongan." }],
      },
      {
        method: "PUT",
        path: "/vacancies/{id}/form",
        summary: "Simpan formulir lamaran",
        description:
          "Urutan array adalah urutan tampil. Kolom sistem (nama, email, telepon, alamat, CV, dan lainnya) tidak dapat diubah jenisnya karena dipakai saat pelamar dijadikan karyawan; nama, email, dan telepon selalu wajib. Lamaran yang sudah masuk tidak berubah karena label dan jawaban disalin saat dikirim.",
        auth: "recruitment:write",
        body: [
          {
            name: "fields",
            type: "object[]",
            required: true,
            description:
              "`{ key, label, type, required, enabled, system, section, placeholder, helpText, options[{value,label}], maxFiles, allowLink }`. type: short_text | long_text | email | phone | number | currency | date | url | select | multi_select | radio | yes_no | file | address.",
          },
        ],
        errors: [{ code: "400 BAD_REQUEST", when: "Label kosong, pilihan kurang dari dua, kode kolom ganda, atau kolom wajib sistem dihapus." }],
      },
      {
        method: "POST",
          path: "/public/uploads",
          body: [{ name: "file", type: "binary", required: true, description: "Berkas lamaran." }, { name: "vacancySlug", type: "string", required: true, description: "Slug lowongan terbuka." }],
        summary: "Unggah berkas lamaran (publik)",
        description:
          "multipart/form-data, satu berkas per permintaan (`file`, `vacancySlug`). Isi berkas diperiksa dari byte-nya, bukan dari nama: PDF, JPG, PNG, WebP, atau DOCX, maksimal 8 MB. Mengembalikan token yang berlaku 6 jam dan hanya dapat dipakai untuk lowongan yang sama.",
        auth: "Publik (rate limited per IP)",
      },
      {
        method: "POST",
          path: "/uploads",
          body: [{ name: "file", type: "binary", required: true, description: "Berkas unggahan." }, { name: "context", type: "string", required: true, description: "leave | correction | complaint | application | contract | document; izin mengikuti konteks." }],
        summary: "Unggah berkas (dalam aplikasi)",
        description:
          "multipart/form-data dengan `file` dan `context`: leave | correction | complaint | application. Context application hanya untuk pemegang izin recruitment:write. Token hanya dapat diklaim oleh akun yang mengunggah.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/public/candidates",
        summary: "Kirim lamaran",
        description:
          "Jawaban divalidasi ulang terhadap formulir lowongan yang tersimpan: kolom yang dimatikan diabaikan, kolom wajib tidak bisa dilewati, dan pilihan di luar daftar ditolak. Berkas dikirim sebagai token dari POST /public/uploads atau sebagai tautan. Lamaran ganda dengan email yang sama dijawab dengan pesan yang sama seperti lamaran baru, agar endpoint ini tidak bisa dipakai untuk menebak siapa yang sudah melamar. Integrasi lama yang mengirim name/email/phone/cv datar tetap diterima.",
        auth: "Publik (rate limited), atau x-api-key untuk integrasi eksternal",
        body: [
          { name: "vacancySlug", type: "string", required: true, description: "Slug lowongan yang dilamar." },
          { name: "answers", type: "object", required: true, description: "Jawaban per `key` kolom. File: `[{ kind: \"file\", token }]` atau `[{ kind: \"link\", url }]`. Alamat: `{ street, city, province, postalCode }`." },
          { name: "turnstileToken", type: "string", description: "Token Turnstile bila diaktifkan." },
        ],
        errors: [
          { code: "400 VALIDATION_ERROR", when: "Ada isian tidak valid; `details.fields` berisi pesan per kolom." },
          { code: "400 UPLOAD_EXPIRED", when: "Token berkas kedaluwarsa atau bukan untuk lowongan ini." },
          { code: "404 NOT_FOUND", when: "Lowongan sudah ditutup atau tidak ditemukan." },
        ],
      },
      {
        method: "GET",
        path: "/candidates",
        summary: "Daftar semua pelamar",
        description:
          "Lintas lowongan, dengan paginasi. `data.counts` berisi jumlah per kelompok status (active, passed, hired, rejected) mengikuti filter lain, untuk tab di atas daftar.",
        auth: "recruitment:read",
        params: [
          { name: "q", in: "query", description: "Nama, email, telepon, kota, atau nomor referensi." },
          { name: "vacancyId", in: "query", description: "Satu lowongan." },
          { name: "stage", in: "query", description: "Nama tahap." },
          { name: "status", in: "query", description: "active | passed | hired | rejected." },
          { name: "source", in: "query", description: "career_page | manual | api." },
          { name: "education", in: "query", description: "sma | d3 | d4s1 | s2 | s3." },
          { name: "hasCv", in: "query", description: "1 = hanya yang melampirkan CV." },
          { name: "minRating", in: "query", description: "Penilaian minimal 1–5." },
          { name: "from", in: "query", description: "Tanggal melamar sejak (YYYY-MM-DD, WIB)." },
          { name: "to", in: "query", description: "Tanggal melamar sampai." },
          { name: "availableBy", in: "query", description: "Bisa mulai bekerja paling lambat tanggal ini." },
          { name: "interview", in: "query", description: "upcoming = punya jadwal wawancara mendatang." },
          { name: "sort", in: "query", description: "newest | oldest | activity | rating | available | interview | name." },
          { name: "page", in: "query", description: "Halaman." },
          { name: "limit", in: "query", description: "Baris per halaman, maksimal 100." },
        ],
      },
      {
        method: "POST",
        path: "/candidates",
        summary: "Tambah pelamar manual",
        description:
          "Memakai formulir lowongan yang sama dengan halaman karier, tetapi hanya nama, email, dan telepon yang wajib. Berkas diunggah lewat POST /uploads dengan context application.",
        auth: "recruitment:write",
        body: [
          { name: "vacancyId", type: "string", required: true, description: "ID lowongan." },
          { name: "answers", type: "object", required: true, description: "Sama seperti POST /public/candidates." },
          { name: "note", type: "string", description: "Catatan internal, misalnya sumber referensi." },
        ],
      },
      {
        method: "GET",
        path: "/candidates/{id}",
        summary: "Detail pelamar",
        description:
          "Jawaban formulir dengan tautan berkas bertanda tangan berumur 15 menit, riwayat seleksi, lamaran lain dari email atau telepon yang sama, dan data karyawan bila sudah direkrut. Setiap pembukaan tercatat di jejak audit.",
        auth: "recruitment:read",
        params: [{ name: "id", in: "path", required: true, description: "ID pelamar." }],
      },
      {
        method: "POST",
        path: "/candidates/{id}",
        summary: "Catatan, wawancara, penilaian, label",
        description:
          "`type: note` menambah catatan; `interview` menjadwalkan wawancara (`scheduledAt` ISO dengan zona waktu, `location`, `interviewerUserId`) dan memberi tahu pewawancara; `rating` 0–5 (0 menghapus); `tags` mengganti daftar label.",
        auth: "recruitment:write",
        params: [{ name: "id", in: "path", required: true, description: "ID pelamar." }],
      },
      {
        method: "GET",
        path: "/candidates/interviewers",
        summary: "Calon pewawancara",
        description: "Akun aktif selain peran STAFF, untuk dipilih sebagai pewawancara.",
        auth: "recruitment:read",
      },
      {
        method: "PATCH",
        path: "/candidates",
        summary: "Pindahkan tahap atau putuskan",
        description:
          "Tahap harus terdaftar pada lowongan. Menolak wajib menyertakan `rejectionReason`; mengirim status selain rejected pada pelamar yang ditolak membukanya kembali. Pelamar yang sudah direkrut tidak dapat diubah dari sini.",
        auth: "recruitment:write",
        body: [
          { name: "id", type: "string", required: true, description: "ID pelamar." },
          { name: "stage", type: "string", description: "Tahap tujuan." },
          { name: "status", type: "string", description: "pending | in_progress | passed | on_hold | rejected." },
          { name: "rejectionReason", type: "string", description: "Wajib bila status rejected." },
          { name: "notes", type: "string", description: "Catatan riwayat." },
        ],
      },
      {
        method: "PUT",
        path: "/candidates",
        summary: "Rekrut pelamar menjadi karyawan",
        description:
          "Membuat karyawan berstatus onboarding dengan NIP berurutan. Nama, email pribadi, telepon, alamat, tanggal lahir, dan jenis kelamin disalin dari jawaban; CV, portofolio, dan lampiran disalin ke folder karyawan. Karyawan ditandai `isNewHire` sampai HRD melengkapi datanya, dan HRD menerima notifikasi. Lowongan ditutup otomatis bila jumlah yang direkrut sudah memenuhi kuota.",
        auth: "recruitment:write",
        body: [
          { name: "id", type: "string", required: true, description: "ID pelamar." },
          { name: "branchId", type: "string", required: true, description: "Cabang penempatan." },
          { name: "divisionId", type: "string", required: true, description: "Divisi." },
          { name: "positionId", type: "string", required: true, description: "Jabatan." },
          { name: "joinDate", type: "string", required: true, description: "Tanggal mulai bekerja (YYYY-MM-DD)." },
          { name: "officeEmail", type: "string", required: true, description: "Email kantor untuk akun barunya." },
          { name: "employmentStatus", type: "string", description: "probation | pkwt | pkwtt | outsource." },
          { name: "roleId", type: "string", description: "Peran akun login; kosongkan bila akun dibuat belakangan." },
        ],
        errors: [{ code: "409 CONFLICT", when: "Sudah direkrut, ditandai tidak lolos, atau email kantor/pribadi sudah dipakai." }],
      },
    ],
  },

  {
    name: "KPI & Kinerja",
    description:
      "Template menentukan bentuk formulir penilaian; penilaian menyimpan salinan bentuk itu. Salinan tersebut yang membuat appraisal lama tetap terbaca apa adanya walaupun templatenya disunting pada siklus berikutnya.",
    endpoints: [
      {
        method: "GET",
        path: "/kpi",
        summary: "Ringkasan kinerja",
        description:
          "Rata-rata nilai, sebaran predikat, dan rata-rata per divisi. Hanya penilaian yang sudah dibagikan ke karyawan yang ikut dihitung.",
        auth: "kpi:read",
      },
      {
        method: "GET",
        path: "/kpi/templates",
        summary: "Daftar template penilaian",
        description: "Template berisi aspek berbobot, masing-masing memuat indikator yang juga berbobot.",
        auth: "kpi:read",
        params: [{ name: "active", in: "query", description: "Isi 1 untuk hanya template aktif." }],
      },
      {
        method: "POST",
        path: "/kpi/templates",
        summary: "Simpan template penilaian",
        description:
          "Bobot aspek harus berjumlah 100%, dan bobot indikator di dalam tiap aspek juga harus berjumlah 100%. Seluruh pelanggaran dikembalikan sekaligus supaya dapat diperbaiki dalam satu kali sunting.",
        auth: "kpi:write",
        body: [
          { name: "id", type: "string", description: "Sertakan untuk memperbarui." },
          { name: "name", type: "string", required: true, description: "Nama template." },
          { name: "periodType", type: "string", description: "monthly | quarterly | semester | yearly." },
          { name: "scoreMode", type: "string", description: "scale_5 | scale_10 | percent. Nilai selalu disimpan 0-100." },
          { name: "aspects", type: "object[]", required: true, description: "Aspek berbobot beserta indikatornya." },
          { name: "grades", type: "object[]", description: "Ambang predikat: min, label, tone." },
          { name: "allowSelfAssessment", type: "boolean", description: "Izinkan karyawan mengisi kolom nilainya sendiri." },
        ],
        errors: [{ code: "400 VALIDATION_ERROR", when: "Bobot aspek atau indikator tidak berjumlah 100%." }],
      },
      {
        method: "DELETE",
        path: "/kpi/templates",
        summary: "Hapus template penilaian",
        description: "Template yang sudah dipakai menilai tidak dapat dihapus; nonaktifkan saja.",
        auth: "kpi:delete",
        params: [{ name: "id", in: "query", required: true, description: "ID template." }],
      },
      {
        method: "GET",
        path: "/kpi/evaluations",
        summary: "Daftar penilaian",
        description:
          "Pemanggil berlingkup sempit hanya menerima penilaian atas dirinya sendiri, dan draf tidak pernah terlihat oleh karyawan yang dinilai.",
        auth: "kpi:read",
        params: [
          { name: "status", in: "query", description: "draft | submitted | acknowledged | finalized." },
          { name: "period", in: "query", description: "Periode, misalnya 2026-Q3." },
          { name: "mine", in: "query", description: "Isi 1 untuk penilaian atas diri sendiri." },
        ],
      },
      {
        method: "POST",
        path: "/kpi/evaluations",
        summary: "Simpan atau kirim penilaian",
        description:
          "Menyimpan draf, atau mengirimkannya ke karyawan bila submit bernilai true. Nilai mentah dinormalkan ke 0-100 menurut skala template, lalu digulung memakai bobot aspek dikali bobot indikator.",
        auth: "kpi:write",
        body: [
          { name: "id", type: "string", description: "Sertakan untuk memperbarui draf." },
          { name: "employeeId", type: "string", required: true, description: "Karyawan yang dinilai." },
          { name: "templateId", type: "string", required: true, description: "Template yang dipakai." },
          { name: "period", type: "string", required: true, description: "Periode penilaian." },
          { name: "scores", type: "object[]", required: true, description: "aspectKey, indicatorKey, rawScore, note." },
          { name: "recommendation", type: "string", description: "promote | retain | monitor | improve | none." },
          { name: "submit", type: "boolean", description: "true untuk langsung mengirim ke karyawan." },
        ],
        errors: [{ code: "409 DUPLICATE", when: "Karyawan ini sudah dinilai pada periode dan template yang sama." }],
      },
      {
        method: "PATCH",
        path: "/kpi/evaluations",
        summary: "Tanggapi, tarik, atau finalkan penilaian",
        description:
          "acknowledge hanya boleh dilakukan karyawan yang dinilai; return mengembalikan penilaian ke draf selama karyawan belum menanggapi; finalize mengunci dokumen dan membuatnya dapat diunduh.",
        auth: "Karyawan pemilik (acknowledge) atau kpi:write",
        body: [
          { name: "id", type: "string", required: true, description: "ID penilaian." },
          { name: "action", type: "string", required: true, description: "acknowledge | return | finalize." },
          { name: "comment", type: "string", description: "Tanggapan karyawan." },
        ],
      },
      {
        method: "DELETE",
        path: "/kpi/evaluations",
        summary: "Hapus draf penilaian",
        description: "Hanya draf yang dapat dihapus; penilaian yang sudah dikirim menjadi bagian dari riwayat.",
        auth: "kpi:delete",
        params: [{ name: "id", in: "query", required: true, description: "ID penilaian." }],
      },
    ],
  },

  {
    name: "Lain-lain",
    description: "Notifikasi, pengaduan, berkas, laporan, dan tugas terjadwal.",
    endpoints: [
      {
        method: "GET",
        path: "/notifications",
        summary: "Feed notifikasi pengguna",
        description: "Selalu terbatas pada notifikasi milik pemanggil. `unread=1` hanya yang belum dibaca; `page` dan `limit` untuk memuat yang lebih lama. `data.unreadCount` untuk lencana lonceng.",
        auth: "Perlu sesi",
      },
      {
        method: "POST",
        path: "/notifications",
        summary: "Tandai sudah dibaca",
        description: "Kirim `all: true` atau daftar `ids`.",
        auth: "Perlu sesi",
      },
      {
        method: "GET",
        path: "/complaints",
        summary: "Daftar pengaduan",
        description:
          "Dengan `mine=1` mengembalikan tiket pemohon sendiri, termasuk yang anonim. Identitas pelapor anonim tidak pernah dikirim ke peran SPV.",
        auth: "Perlu sesi",
        params: [{ name: "mine", in: "query", description: "Isi `1` untuk tiket sendiri." }],
      },
      {
        method: "POST",
        path: "/complaints",
        summary: "Kirim pengaduan",
        description: "Identitas selalu tercatat, namun disembunyikan dari penerima bila anonim dipilih.",
        auth: "Perlu sesi karyawan",
        body: [
          { name: "attachmentInput", type: "object", description: "Lampiran: `{ kind: \"file\", token }` dari POST /uploads (context complaint) atau `{ kind: \"link\", url }`." },
          { name: "attachment", type: "string", description: "Data URL lampiran. Format lama, masih diterima." },
        ],
      },
      {
        method: "PATCH",
        path: "/complaints",
        summary: "Tindak lanjut pengaduan",
        description: "Hanya peran yang menjadi tujuan pengaduan yang dapat menanganinya.",
        auth: "Peran tujuan pengaduan",
      },
      {
        method: "GET",
        path: "/complaints/attachment",
        summary: "Unduh lampiran pengaduan anonim",
        description: "Akses lampiran tersimpan tanpa membuka URL penyimpanan. Hanya pelapor atau penangan dalam lingkupnya.",
        auth: "Pelapor atau peran tujuan pengaduan",
        params: [{ name: "id", in: "query", description: "ID pengaduan (24 karakter heksadesimal)." }],
      },
      {
        method: "GET",
        path: "/dashboard",
        summary: "Ringkasan dashboard",
        description: "Kehadiran hari ini, tren 14 hari, kontrak kedaluwarsa, ulang tahun, dan hari libur.",
        auth: "Perlu sesi",
      },
      {
        method: "GET",
        path: "/imports",
        summary: "Unduh template impor CSV",
        description: "Header kolom (tanda * = wajib) dan satu baris contoh. Urutan impor untuk instalasi baru: branches → divisions → positions → employees.",
        auth: "{module}:write lingkup seluruh perusahaan (settings untuk master data, employees untuk karyawan)",
        params: [{ name: "dataset", in: "query", required: true, description: "branches | divisions | positions | employees" }],
      },
      {
        method: "POST",
        path: "/imports",
        summary: "Pratinjau atau jalankan impor CSV",
        description: "commit=false memvalidasi setiap baris tanpa menulis (pratinjau). commit=true memvalidasi ulang berkas yang sama lalu menyimpan semua baris dalam satu transaksi; bila ada satu baris bermasalah, tidak ada data yang diubah. CSV koma atau titik koma, UTF-8, maks 1 MB / 5.000 baris. Karyawan baru mendapat NIP otomatis; akun login STAFF dibuat bila diminta, kata sandi acak hanya dikembalikan sekali.",
        auth: "{module}:write lingkup seluruh perusahaan",
        body: [
          { name: "dataset", type: "string", required: true, description: "branches | divisions | positions | employees" },
          { name: "csv", type: "string", required: true, description: "Isi berkas CSV (teks)." },
          { name: "commit", type: "boolean", description: "false = pratinjau (default), true = simpan." },
        ],
      },
      {
        method: "GET",
        path: "/reports/export",
        summary: "Ekspor data ke Excel (.xlsx) atau CSV",
        description: "Mengikuti lingkup izin pemanggil; NIK/NPWP/rekening lengkap hanya untuk izin seluruh perusahaan. Inventaris dan pelamar memerlukan izin seluruh perusahaan. Maksimal 20.000 baris, 30 ekspor per 10 menit, setiap ekspor dicatat di log audit. CSV memakai UTF-8 BOM dan menetralkan formula (=, +, -, @).",
        auth: "{module}:export sesuai dataset (employees, attendance, leave, payroll, kpi, contracts, inventory, recruitment)",
        params: [
          { name: "dataset", in: "query", required: true, description: "employees | attendance | attendance_daily | corrections | leave | payroll | kpi | contracts | inventory | candidates" },
          { name: "format", in: "query", description: "xlsx (default) | csv" },
          { name: "period", in: "query", description: "YYYY-MM untuk presensi, koreksi, izin, slip gaji; periode KPI (YYYY-MM, YYYY-Q1, YYYY-H1, YYYY). Default bulan ini." },
          { name: "date", in: "query", description: "YYYY-MM-DD untuk attendance_daily. Default hari ini." },
          { name: "branchId", in: "query", description: "Filter cabang untuk attendance_daily." },
        ],
      },
      {
        method: "GET",
        path: "/storage/secure",
        summary: "Unduh berkas",
        description:
          "Satu-satunya jalan membaca berkas tersimpan. Memerlukan sesi yang memiliki berkas tersebut, atau tautan bertanda tangan yang belum kedaluwarsa.",
        auth: "Sesi pemilik berkas atau tanda tangan HMAC",
        params: [
          { name: "key", in: "query", required: true, description: "Storage key berkas." },
          { name: "expires", in: "query", description: "Waktu kedaluwarsa tanda tangan (epoch detik)." },
          { name: "sig", in: "query", description: "Tanda tangan HMAC." },
        ],
      },
      {
        method: "GET",
        path: "/cron/daily",
        summary: "Jalankan tugas harian",
        description:
          "Membatalkan tukar libur yang tidak dihadiri, mencatat lembur tanggal merah, mengirim pengingat kontrak dan ucapan ulang tahun, menghapus unggahan yang tidak jadi dilampirkan, lalu mengirim pengingat: absen pulang yang terlewat kemarin (ke karyawan), pengajuan yang tertahan lebih dari 2 hari (ke approver), wawancara besok (ke pewawancara dan HRD), dan setiap Senin data karyawan baru yang belum lengkap (ke HRD). Setiap pengingat hanya dikirim sekali per hari, jadi aman dijalankan ulang.",
        auth: "Header x-cron-secret harus cocok dengan CRON_SECRET",
      },
      {
        method: "GET",
        path: "/public/positions",
        summary: "Lowongan aktif",
        description: "Dipakai halaman karir publik.",
        auth: "Publik",
      },
    ],
  },
  {
    name: "Panduan & Referensi API",
    description: "Isi panduan disaring di server sesuai peran; referensi API hanya untuk Superadmin.",
    endpoints: [
      {
        method: "GET",
        path: "/docs",
        summary: "Panduan sesuai peran",
        description:
          "Mengembalikan bab dan bagian panduan yang boleh dibaca peran pemanggil. Bagian untuk peran lain tidak pernah dikirim ke peramban.",
        auth: "Login",
        params: [{ name: "role", in: "query", description: "Khusus Superadmin: pratinjau panduan sebagai peran lain." }],
      },
      {
        method: "GET",
        path: "/openapi",
        summary: "Dokumen OpenAPI",
        description: "Spesifikasi OpenAPI 3.1, atau daftar grup untuk halaman referensi bila format=groups.",
        auth: "Pro integration.api; sesi dengan settings:read atau Bearer API key apa pun yang aktif",
        params: [{ name: "format", in: "query", description: "groups untuk format halaman referensi." }],
        errors: [{ code: "401/403", when: "Belum login, API key tidak valid, atau instalasi tanpa lisensi Pro." }],
      },
      {
        method: "GET",
        path: "/settings/initial-passwords",
        summary: "Kebijakan kata sandi awal per peran",
        description:
          "Mode (fixed/random) dan kata sandi tetap setiap peran selain Superadmin, beserta saran kata sandi acak. Setiap pembacaan dicatat di log aktivitas.",
        auth: "settings × write",
      },
      {
        method: "PUT",
        path: "/settings/initial-passwords",
        summary: "Simpan kata sandi awal per peran",
        description:
          "Disimpan terenkripsi. Hanya peran yang berubah divalidasi kekuatannya. Kata sandi tetap juga ditolak sebagai kata sandi baru saat karyawan menggantinya.",
        auth: "settings × write",
        body: [{ name: "roles", type: "Array<{ role, mode: fixed|random, password }>", required: true, description: "Kebijakan per peran." }],
        errors: [{ code: "400 WEAK_PASSWORD", when: "Kata sandi tetap tidak memenuhi kebijakan." }],
      },
    ],
  },
  {
    name: "Jenis Izin & Cuti",
    description:
      "quotaMode menentukan cara hitung: annual (saldo tahunan), per_event (batas hari per kejadian, tidak memotong saldo), none (tanpa kuota).",
    endpoints: [
      {
        method: "GET",
        path: "/leave/types",
        summary: "Daftar jenis",
        description: "Semua jenis beserta kalimat aturan (rule) dan jumlah pengajuan yang memakainya.",
        auth: "leave × read",
      },
      {
        method: "POST",
        path: "/leave/types",
        summary: "Tambah jenis",
        description: "Untuk per_event, maxConsecutiveDays disamakan dengan quotaDays.",
        auth: "leave × write",
        body: [
          { name: "name", type: "string", required: true, description: "Nama jenis." },
          { name: "quotaMode", type: "annual | per_event | none", required: true, description: "Cara hitung kuota." },
          { name: "quotaDays", type: "number", required: true, description: "Hari per tahun (annual) atau per kejadian (per_event)." },
          { name: "maxEventsPerYear", type: "number", description: "per_event: batas kejadian per tahun, 0 = tanpa batas." },
          { name: "isOther", type: "boolean", description: "Karyawan wajib menulis keperluan (customPurpose)." },
          { name: "requiresEvidence, minLeadDays, genderRestriction, allowsRemoteAttendance, accrualMode, carryOverMaxDays, maxConsecutiveDays, colorTone, sortOrder, isActive", type: "mixed", description: "Aturan lain." },
        ],
      },
      {
        method: "PATCH",
        path: "/leave/types",
        summary: "Ubah jenis",
        description: "Body sama dengan POST ditambah id.",
        auth: "leave × write",
        errors: [{ code: "409 CONFLICT", when: "Mengubah quotaMode saat masih ada pengajuan menunggu." }],
      },
      {
        method: "DELETE",
        path: "/leave/types",
        summary: "Hapus jenis",
        description: "Jenis yang pernah dipakai tidak dihapus; nonaktifkan lewat PATCH.",
        auth: "leave × write",
        params: [{ name: "id", in: "query", required: true, description: "ID jenis." }],
      },
    ],
  },
  {
    name: "Jadwal & Shift",
    description:
      "Urutan jadwal saat absen: jadwal khusus tanggal → template karyawan (jam per hari) → jam operasional cabang.",
    endpoints: [
      {
        method: "GET",
        path: "/schedules",
        summary: "Template, penugasan, jadwal khusus, atau pratinjau",
        description: "Isi bergantung pada type.",
        auth: "attendance × read",
        params: [
          { name: "type", in: "query", description: "template (bawaan) | employees | overrides | preview" },
          { name: "employeeId", in: "query", description: "preview: karyawan yang dipratinjau." },
          { name: "from, days", in: "query", description: "preview: tanggal awal dan jumlah hari." },
          { name: "q, page, limit", in: "query", description: "employees/overrides: pencarian dan halaman." },
        ],
      },
      {
        method: "POST",
        path: "/schedules",
        summary: "Simpan template, pasang template, atau buat jadwal khusus",
        description: "Dibedakan oleh mode.",
        auth: "attendance × write",
        body: [
          { name: "mode", type: "template | assign | override", required: true, description: "Jenis operasi." },
          { name: "template: id?, name, gracePeriodMinutes, isBreakActive, days[7]", type: "object", description: "days: { day 0–6, active, clockIn, clockOut, breakOut?, breakIn? } (HH:mm)." },
          { name: "assign: employeeIds, scheduleId|null", type: "object", description: "null melepas template (kembali ke jam cabang)." },
          { name: "override: employeeIds, from, to, scheduleId|null, isOffDay, note", type: "object", description: "Tanggal YYYY-MM-DD; isi scheduleId atau isOffDay." },
        ],
        errors: [{ code: "409 CONFLICT", when: "Nama template sudah dipakai." }],
      },
      {
        method: "DELETE",
        path: "/schedules",
        summary: "Hapus template",
        description: "Ditolak bila template masih dipakai karyawan.",
        auth: "attendance × write",
        params: [{ name: "id", in: "query", required: true, description: "ID template." }],
      },
      {
        method: "DELETE",
        path: "/schedules/{id}",
        summary: "Hapus jadwal khusus tanggal",
        description: "Menghapus satu jadwal khusus.",
        auth: "attendance × write",
      },
    ],
  },
  {
    name: "Kontrak Kerja",
    description:
      "Jenis: PKWT, PKWTT (tanpa tanggal berakhir), PROBATION, INTERNSHIP, DAILY, PART_TIME, OUTSOURCE, OTHER. Nomor kontrak dibuat otomatis per jenis dan tahun.",
    endpoints: [
      {
        method: "GET",
        path: "/contracts",
        summary: "Daftar kontrak",
        description: "view=expiring: kontrak berlaku yang berakhir dalam `days` hari atau lewat tanpa keputusan. view=mine: kontrak milik pemanggil.",
        auth: "contracts × read (view=mine: login)",
        params: [
          { name: "view", in: "query", description: "all | expiring | mine" },
          { name: "days", in: "query", description: "expiring: 1–365, bawaan 60." },
          { name: "status, decision, type, employeeId, q", in: "query", description: "Filter." },
          { name: "page, limit", in: "query", description: "Halaman." },
        ],
      },
      {
        method: "POST",
        path: "/contracts",
        summary: "Buat kontrak",
        description: "status active langsung memberlakukan kontrak dan (opsional) menyesuaikan status kepegawaian. previousContractId menandai perpanjangan.",
        auth: "contracts × write",
        body: [
          { name: "employeeId, type, startDate", type: "string", required: true, description: "Tanggal YYYY-MM-DD." },
          { name: "endDate", type: "string", description: "Wajib selain PKWTT." },
          { name: "customTypeLabel, positionName, basicSalary, allowances, templateId, body, notes", type: "mixed", description: "Isi kontrak." },
          { name: "status", type: "draft | active", description: "Bawaan active." },
          { name: "previousContractId, updateEmployeeStatus", type: "mixed", description: "Perpanjangan dan sinkron status karyawan." },
        ],
        errors: [{ code: "409 CONFLICT", when: "Tumpang tindih dengan kontrak berlaku lain." }],
      },
      {
        method: "GET",
        path: "/contracts/{id}",
        summary: "Detail kontrak",
        description: "Termasuk teks dokumen hasil isian template, riwayat perpanjangan, dan tautan berkas bertanda tangan. Karyawan hanya dapat membuka miliknya.",
        auth: "contracts × read atau pemilik",
      },
      {
        method: "PATCH",
        path: "/contracts/{id}",
        summary: "Ubah kontrak atau lampirkan berkas bertanda tangan",
        description: "Tanggal dan gaji terkunci setelah berkas bertanda tangan dilampirkan. signed: null melepas berkas.",
        auth: "contracts × write",
        body: [
          { name: "startDate, endDate, positionName, basicSalary, allowances, body, templateId, notes", type: "mixed", description: "Perubahan isi." },
          { name: "signed", type: "attachment | null", description: "Hasil unggahan konteks contract." },
        ],
      },
      {
        method: "POST",
        path: "/contracts/{id}",
        summary: "Tindakan kontrak",
        description: "activate; not_renew { note, markResigned }; reopen_decision; terminate { date, reason }.",
        auth: "contracts × write",
        body: [{ name: "action", type: "activate | not_renew | reopen_decision | terminate", required: true, description: "Tindakan." }],
      },
      {
        method: "DELETE",
        path: "/contracts/{id}",
        summary: "Hapus draf",
        description: "Hanya draf; kontrak yang pernah berlaku diakhiri dengan terminate.",
        auth: "contracts × write",
      },
      {
        method: "GET",
        path: "/contracts/templates",
        summary: "Template dokumen kontrak",
        description: "Daftar template beserta daftar isian {{placeholder}} yang tersedia.",
        auth: "contracts × read",
      },
      {
        method: "POST",
        path: "/contracts/templates",
        summary: "Simpan template",
        description: "Buat (tanpa id) atau ubah (dengan id).",
        auth: "contracts × write",
        body: [{ name: "id?, name, type, body, logoUrl, logoHeight, signerName, signerTitle, city, isActive", type: "mixed", description: "Isi template." }],
      },
      {
        method: "DELETE",
        path: "/contracts/templates",
        summary: "Hapus template",
        description: "Kontrak yang sudah dibuat menyimpan salinan teksnya sendiri.",
        auth: "contracts × write",
        params: [{ name: "id", in: "query", required: true, description: "ID template." }],
      },
    ],
  },
  {
    name: "Komponen Gaji",
    description:
      "Profil gaji (tetap) dan masukan per periode dipakai bersama oleh pratinjau dan POST /payroll, sehingga hasilnya selalu sama.",
    endpoints: [
      {
        method: "GET",
        path: "/payroll/profiles",
        summary: "Profil gaji karyawan",
        description: "Aturan lembur, pengecualian potongan, komponen tetap, dan insentif target.",
        auth: "payroll × read",
        params: [{ name: "employeeId", in: "query", required: true, description: "ID karyawan." }],
      },
      {
        method: "PUT",
        path: "/payroll/profiles",
        summary: "Simpan profil gaji",
        description: "Insentif target: tingkat tertinggi yang tercapai dibayar, ditambah excessRate per unit di atas target.",
        auth: "payroll × write",
        body: [
          { name: "employeeId", type: "string", required: true, description: "ID karyawan." },
          { name: "overtimeMode, overtimeRate", type: "company_rate | custom_rate | none, number", required: true, description: "Lembur." },
          { name: "exemptLatePenalty, exemptAbsentPenalty", type: "boolean", description: "Tanpa potongan terlambat/alpha." },
          { name: "recurring", type: "Array<{ kind: earning|deduction, name, amount, note, untilPeriod }>", description: "Komponen bulanan; untilPeriod YYYY-MM opsional." },
          { name: "target", type: "{ enabled, name, unit, targetValue, tiers: [{ minPct, amount }], excessRate, note }", description: "Insentif target." },
        ],
      },
      {
        method: "GET",
        path: "/payroll/inputs",
        summary: "Masukan periode",
        description: "Bonus/potongan sekali dan capaian target satu karyawan pada satu periode.",
        auth: "payroll × read",
        params: [
          { name: "employeeId", in: "query", required: true, description: "ID karyawan." },
          { name: "period", in: "query", required: true, description: "YYYY-MM." },
        ],
      },
      {
        method: "PUT",
        path: "/payroll/inputs",
        summary: "Simpan masukan periode",
        description: "Tidak mengubah slip yang sudah ada sampai dihitung ulang.",
        auth: "payroll × write",
        body: [
          { name: "employeeId, period", type: "string", required: true, description: "Karyawan dan periode." },
          { name: "adjustments", type: "Array<{ kind, name, amount, note }>", required: true, description: "Bonus dan potongan periode ini." },
          { name: "targetActual, targetNote", type: "number | null, string", description: "Capaian target." },
        ],
      },
      {
        method: "GET",
        path: "/payroll/preview",
        summary: "Pratinjau slip",
        description: "Menghitung slip tanpa menyimpan apa pun.",
        auth: "payroll × read",
        params: [
          { name: "employeeId", in: "query", required: true, description: "ID karyawan." },
          { name: "period", in: "query", required: true, description: "YYYY-MM." },
        ],
      },
      {
        method: "PATCH",
        path: "/payroll",
        summary: "Terbitkan draf atau unggah slip PDF",
        description:
          "action=publish { ids } menerbitkan draf dan mengirim notifikasi. action=upload { employeeId, period, file, netSalary?, totalEarnings?, totalDeductions?, publish, replace } menyimpan slip buatan luar sistem; periode itu tidak ikut dihitung otomatis.",
        auth: "payroll × write",
        errors: [{ code: "409 CONFLICT", when: "Slip terbit sudah ada dan replace=false." }],
      },
    ],
  },
  {
    name: "Penilaian KPI Unggahan",
    description: "Penilaian dengan formulir perusahaan sendiri, dilampirkan per karyawan sebagai PDF.",
    endpoints: [
      {
        method: "POST",
        path: "/kpi/evaluations/upload",
        summary: "Unggah penilaian PDF",
        description: "Membuat penilaian bersumber uploaded. share=true langsung membagikannya ke karyawan.",
        auth: "kpi × write",
        body: [
          { name: "employeeId, period, periodType, title", type: "string", required: true, description: "Periode: 2026, 2026-07, 2026-Q3, atau 2026-S1." },
          { name: "file", type: "attachment", required: true, description: "Hasil unggahan konteks document." },
          { name: "finalScore, gradeLabel, notes, share", type: "mixed", description: "Nilai opsional masuk ringkasan KPI." },
        ],
      },
      {
        method: "PATCH",
        path: "/kpi/evaluations",
        summary: "Bagikan penilaian draf",
        description: "action=share mengubah draf menjadi menunggu tanggapan karyawan dan mengirim notifikasi.",
        auth: "kpi × write",
        body: [
          { name: "id", type: "string", required: true, description: "ID penilaian." },
          { name: "action", type: "share", required: true, description: "Tindakan." },
        ],
      },
    ],
  },
];

// Older chapters describe two operations twice (face attendance and KPI share).
// Merge those variants into the same operation rather than silently overwriting it.
const seenOperations = new Map<string, ApiEndpoint>();
export const API_GROUPS: ApiGroup[] = [...BASE_GROUPS, ...API_UPDATES].map((group) => ({ ...group, endpoints: group.endpoints.filter((endpoint) => {
  const key = `${endpoint.method} ${endpoint.path}`;
  const previous = seenOperations.get(key);
  if (!previous) { seenOperations.set(key, endpoint); return true; }
  previous.description += `\n\n${endpoint.description}`;
  previous.errors = [...(previous.errors ?? []), ...(endpoint.errors ?? [])];
  for (const field of endpoint.body ?? []) {
    const existing = previous.body?.find((f) => f.name === field.name);
    if (existing) existing.description += `; ${field.type}: ${field.description}`;
    else (previous.body ??= []).push(field);
  }
  return false;
}) })).filter((group) => group.endpoints.length > 0);

/** Renders the groups above into an OpenAPI 3.1 document. */
export function buildOpenApiSpec() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const group of API_GROUPS) {
    for (const ep of group.endpoints) {
      const key = ep.path.replace(/\{(\w+)\}/g, "{$1}");
      paths[key] ??= {};

      paths[key][ep.method.toLowerCase()] = {
        operationId: `${ep.method.toLowerCase()}_${ep.path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
        security: operationSecurity(ep),
        tags: [group.name],
        summary: ep.summary,
        description: `${ep.description}\n\n**Otorisasi:** ${ep.auth}`,
        parameters: [...(ep.params ?? []).flatMap((p) => p.name.split(",").map((name) => ({ ...p, name: name.trim() }))), ...Array.from(ep.path.matchAll(/\{(\w+)\}/g)).filter((match) => !ep.params?.some((p) => p.in === "path" && p.name === match[1])).map((match) => ({ name: match[1], in: "path" as const, required: true, description: "Identitas resource pada URL", type: "string" }))].map((p) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required),
          description: p.description,
          schema: { type: p.type ?? "string" },
        })),
        requestBody: ep.body
          ? {
              required: true,
              content: {
                [ep.path.endsWith("/uploads") ? "multipart/form-data" : "application/json"]: {
                  ...(ep.example ? { example: ep.example } : {}),
                  schema: {
                    type: "object",
                    required: ep.body.flatMap(expandField).filter((f) => f.required).map((f) => f.name),
                    properties: Object.fromEntries(
                      ep.body.flatMap(expandField).map((f) => [
                        f.name,
                        { ...fieldSchema(f.type), description: f.description },
                      ])
                    ),
                  },
                },
              },
            }
          : undefined,
        responses: {
          "200": {
            description: "Berhasil",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessResponse" },
              },
            },
          },
          ...specialResponses(ep),
          ...Object.fromEntries(
            (ep.errors ?? []).map((e) => [
              e.code.split(" ")[0],
              {
                description: `${e.code} — ${e.when}`,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                  },
                },
              },
            ])
          ),
        },
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "HRIS API",
      version: "2.1.0",
      description:
        "REST API sistem HRIS. Seluruh respons memakai amplop { success, data, message, meta } " +
        "atau { success: false, error: { code, message } }. Autentikasi memakai cookie sesi " +
        "httpOnly dari Auth.js kecuali disebutkan lain. Seluruh waktu dalam WIB (Asia/Jakarta).",
    },
    servers: [{ url: API_BASE, description: "Base URL" }],
    tags: API_GROUPS.map((g) => ({ name: g.name, description: g.description })),
    paths,
    components: {
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", const: true },
            data: { description: "Muatan spesifik endpoint." },
            message: { type: "string" },
            meta: {
              type: "object",
              properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", const: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {},
              },
            },
          },
        },
      },
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
        secureSessionCookie: { type: "apiKey", in: "cookie", name: "__Secure-authjs.session-token" },
        publicApiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        cronSecret: { type: "apiKey", in: "header", name: "x-cron-secret" },
        hrisApiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "hris_…",
          description: "HRIS Pro. API key dari Admin → Integrasi API. Berlaku pada endpoint yang memeriksa izin modul (scope modul:aksi) dan tidak melebihi izin pembuatnya; endpoint pribadi dan pengaturan sistem menolak API key.",
        },
      },
    },
  };
}

function expandField(field: ApiField): ApiField[] {
  // Human-readable grouped names must not become fictitious JSON property names.
  if (!/^[\w?, ]+$/.test(field.name)) return [];
  return field.name.split(",").map((name) => ({ ...field, name: name.trim().replace(/\?$/, ""), required: name.trim().endsWith("?") ? false : field.required }));
}
function operationSecurity(ep: ApiEndpoint) {
  if (ep.path === "/cron/daily") return [{ cronSecret: [] }];
  if (ep.path === "/public/candidates") return [{ publicApiKey: [] }, {}];
  if (ep.path.startsWith("/public/") || ["/auth/forgot-password", "/auth/reset-password"].includes(ep.path) || ep.path === "/settings/categories" && ep.method === "GET") return [];
  if (ep.path === "/storage/secure") return [{ sessionCookie: [] }, { secureSessionCookie: [] }, {}];
  if (ep.path === "/integrations/employees") return [{ hrisApiKey: [] }];
  const session = [{ sessionCookie: [] }, { secureSessionCookie: [] }];
  return MODULE_SCOPED_AUTH.test(ep.auth) ? [...session, { hrisApiKey: [] }] : session;
}
// Endpoints documented with a module permission (not settings) can be called with a scoped API key.
const MODULE_SCOPED_AUTH = /\b(attendance|employees|leave|holiday_swap|payroll|recruitment|kpi|contracts|inventory|complaint|reports|audit|discipline)\s*(?::|×)\s*(read|write|delete|approve|export)\b/;
function specialResponses(ep: ApiEndpoint): Record<string, unknown> {
  if (ep.path === "/storage/secure") return { "200": { description: "Berkas privat; content-type mengikuti file yang disimpan", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } };
  if (ep.path === "/reports/export") return { "200": { description: "Unduhan CSV", content: { "text/csv": { schema: { type: "string" } } } } };
  if (ep.path === "/openapi") return { "200": { description: "Dokumen OpenAPI langsung, atau {groups} jika format=groups", content: { "application/json": { schema: { type: "object" } } } } };
  return {};
}
function fieldSchema(type: string): Record<string, unknown> {
  if (type === "file" || type === "binary" || type === "File") return { type: "string", format: "binary" };
  if (type.endsWith("[]")) return { type: "array", items: fieldSchema(type.slice(0, -2)) };
  if (type.startsWith("Array<")) return { type: "array", items: {} };
  if (["string", "number", "boolean", "object", "integer"].includes(type)) return { type };
  // A prose union or nested field description isn't a machine-validated contract.
  return {};
}
