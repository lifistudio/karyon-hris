/**
 * Documentation content, kept as data rather than JSX so the same source feeds
 * the sidebar, the in-page search, and the rendered body without duplication.
 */

export type DocBlock =
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "note"; tone: "info" | "warning" | "danger" | "success"; title?: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "code"; text: string };

export interface DocSection {
  id: string;
  title: string;
  summary: string;
  /** Roles this section is written for. Empty array = relevant to everyone. */
  audience: string[];
  blocks: DocBlock[];
}

export interface DocChapter {
  id: string;
  title: string;
  sections: DocSection[];
}

export { ROLE_LABELS } from "./roles";

export const CHAPTERS: DocChapter[] = [
  {
    id: "pembaruan-30", title: "Pembaruan 3.0: Kehadiran, Ekspor/Impor, Lisensi", sections: [
      { id: "monitor-kehadiran", title: "Monitor kehadiran harian", summary: "Siapa yang hadir, terlambat, cuti, belum absen, atau alpha, per tanggal.", audience: ["SPV", "HRD", "AUDIT", "DIREKSI", "SUPERADMIN"], blocks: [
        { type: "p", text: "Buka menu Kehadiran di panel admin. Halaman ini menghitung status setiap karyawan aktif pada tanggal terpilih dari jadwal, presensi, cuti/izin yang disetujui, hari libur, dan tukar libur. Atasan hanya melihat timnya; HRD dan peran lain mengikuti cakupan akses masing-masing." },
        { type: "table", head: ["Status", "Artinya"], rows: [
          ["Hadir", "Sudah absen masuk tepat waktu."],
          ["Terlambat", "Sudah absen masuk melewati jam masuk + toleransi."],
          ["Izin/Cuti", "Ada cuti atau izin yang disetujui pada tanggal itu."],
          ["Libur / Libur nasional", "Hari libur jadwal, tukar libur, atau libur nasional."],
          ["Belum mulai", "Jam masuk belum tiba (hari ini)."],
          ["Belum absen", "Jam masuk + toleransi sudah lewat, belum ada absen masuk. Masih bisa absen hari ini."],
          ["Alpha", "Hari kerja yang sudah lewat tanpa absen masuk, tanpa cuti/izin."],
        ] },
        { type: "steps", items: ["Klik kartu ringkasan (mis. Belum absen) untuk memfilter daftar. Gunakan pencarian nama/NIP dan pilihan cabang.", "Ganti tanggal untuk melihat hari sebelumnya. Kolom Lupa absen pulang menandai karyawan yang absen masuk tetapi belum absen pulang.", "Tombol Ingatkan yang belum absen mengirim notifikasi ke karyawan berstatus Belum absen (maks. 5 kali per jam, tercatat di audit).", "Unduh Excel atau CSV untuk tanggal dan filter yang sama."] },
        { type: "note", tone: "info", text: "Kartu Belum absen / alpha di dashboard utama memakai perhitungan yang sama. Klik Lihat detail per karyawan untuk membuka halaman ini." },
      ] },
      { id: "notifikasi-kehadiran", title: "Notifikasi kehadiran otomatis", summary: "Pengingat absen untuk karyawan, ringkasan untuk atasan dan HR.", audience: ["SPV", "HRD", "AUDIT", "DIREKSI", "SUPERADMIN"], blocks: [
        { type: "p", text: "HRIS memantau kehadiran secara berkala dan mengirim notifikasi ke ikon lonceng di aplikasi (dan email bila pengguna tidak menonaktifkannya). Setiap jenis pengingat dikirim paling banyak sekali per orang per hari." },
        { type: "list", items: ["Karyawan: pengingat belum absen masuk setelah jam masuk + toleransi + X menit, dan pengingat belum absen pulang setelah jam pulang + Y menit.", "Atasan: ringkasan harian jumlah bawahan yang belum absen, mulai jam ringkasan.", "HR / peran dengan akses kehadiran seluruh perusahaan: ringkasan perusahaan dan daftar alpha kemarin.", "Karyawan yang alpha kemarin menerima pemberitahuan agar dapat mengajukan koreksi bila ada kekeliruan."] },
        { type: "note", tone: "info", title: "Pengaturan", text: "Superadmin mengatur di Pengaturan → Presensi: Pantau & ingatkan kehadiran otomatis (aktif/nonaktif), menit pengingat absen masuk dan pulang, serta jam ringkasan (WIB)." },
      ] },
      { id: "ekspor-data", title: "Ekspor data ke Excel atau CSV", summary: "Karyawan, presensi, cuti, slip gaji, KPI, kontrak, inventaris, pelamar.", audience: ["SPV", "HRD", "AUDIT", "DIREKSI", "SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka menu Ekspor & Impor, tab Ekspor.", "Pilih data, lalu periode (bulan), tanggal, atau periode KPI bila diminta.", "Pilih format Excel (.xlsx) atau CSV, lalu Unduh."] },
        { type: "list", items: ["Hanya data yang boleh Anda lihat yang ikut terekspor: atasan hanya timnya, HRD sesuai cakupan cabang/perusahaan.", "Peran Anda perlu aksi Ekspor pada modul terkait (Pengaturan → Peran & Hak Akses).", "NPWP dan nomor rekening lengkap hanya untuk cakupan seluruh perusahaan; selain itu disamarkan.", "Setiap ekspor tercatat di audit: siapa, data apa, berapa baris. Maksimal 20.000 baris per ekspor.", "Isi sel yang diawali =, +, - atau @ dinetralkan agar tidak dijalankan sebagai rumus di Excel."] },
      ] },
      { id: "impor-data", title: "Impor data dari CSV", summary: "Cabang, divisi, jabatan, dan karyawan: pratinjau dulu, baru disimpan.", audience: ["HRD", "SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka Ekspor & Impor, tab Impor, pilih jenis data, lalu unduh template CSV. Urutan impor yang disarankan: cabang → divisi → jabatan → karyawan.", "Isi template di Excel/Google Sheets dan simpan sebagai CSV (pemisah koma atau titik koma). Maksimal 1 MB dan 5.000 baris.", "Unggah berkas. Sistem menampilkan pratinjau: baris baru, baris yang diperbarui, dan baris bermasalah beserta alasannya. Belum ada data yang disimpan.", "Perbaiki baris bermasalah atau lanjutkan. Klik Simpan impor: semua baris valid disimpan dalam satu transaksi (semua atau tidak sama sekali).", "Untuk karyawan baru dengan email, akun dibuat otomatis. Unduh berkas kata sandi awal saat itu juga; berkas hanya tersedia sekali."] },
        { type: "list", items: ["Karyawan dicocokkan dengan NIP: NIP yang ada diperbarui, NIP kosong dibuatkan otomatis.", "Nilai yang disamarkan (mis. ****1234) dilewati sehingga data asli tidak tertimpa.", "Atasan (NIP atasan) harus sudah ada. Community hanya mengizinkan satu cabang.", "Setiap impor tercatat di audit dengan jumlah baris dibuat dan diperbarui."] },
      ] },
      { id: "reset-sandi-karyawan", title: "Mengganti kata sandi karyawan", summary: "HRD atau Superadmin mengatur ulang kata sandi karyawan yang lupa.", audience: ["HRD", "SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka Karyawan, pilih karyawan, lalu Ubah.", "Isi Kata Sandi Baru (minimal 8 karakter) dan simpan.", "Sampaikan kata sandi secara langsung atau lewat kanal internal yang aman, lalu minta karyawan menggantinya setelah login."] },
        { type: "note", tone: "info", text: "Kemampuan ini mengikuti izin Ubah pada modul Karyawan di Peran & Hak Akses dan cakupan peran Anda. Setiap penggantian tercatat di audit sebagai RESET_EMPLOYEE_PASSWORD tanpa menyimpan kata sandinya." },
      ] },
      { id: "lisensi-pro", title: "Aktivasi Pro dengan license key", summary: "Tempel license key, fitur Pro langsung aktif; lisensi berakhir kembali ke Community tanpa kehilangan data.", audience: ["SUPERADMIN"], blocks: [
        { type: "steps", items: ["Beli Pro di website lisensi. Setelah pembayaran dikonfirmasi, lihat license key di dashboard pelanggan (perlu konfirmasi kata sandi akun).", "Buka Lisensi & Paket di HRIS sebagai Superadmin, tempel license key, lalu klik Aktifkan. Lisensi terikat ke alamat website HRIS ini (NEXTAUTH_URL).", "Fitur Pro langsung terbuka. Aplikasi resmi sudah berisi fitur Pro, jadi tidak ada unduhan, restart, atau perintah terminal, di jenis instalasi apa pun (installer, Dokploy, Docker, VPS)."] },
        { type: "list", items: ["Bukti lisensi bertanda tangan (lease) diperbarui otomatis. Tombol Periksa ulang status meminta pemeriksaan terbaru.", "Toleransi gangguan koneksi ke server lisensi terbatas dan tidak melampaui akhir langganan.", "Lisensi berakhir, ditangguhkan, atau dilepas: fitur Pro terkunci otomatis dan aplikasi berjalan sebagai Community. Data Pro tetap tersimpan dan aktif lagi setelah lisensi diperpanjang.", "Lebih dari satu cabang tanpa lisensi Pro: hanya satu cabang yang aktif (presensi dan penempatan). Pilih cabangnya di menu Cabang; cabang lain aktif lagi otomatis setelah lisensi diperpanjang.", "Lisensi ditolak bila jam server dimundurkan. Pastikan waktu server sinkron (NTP)."] },
        { type: "note", tone: "info", title: "Image Community dari source", text: "Image yang dibangun sendiri dari source Community tidak berisi fitur Pro. Ganti HRIS_IMAGE ke ghcr.io/lifistudio/hris:latest lalu deploy ulang; license key yang sama langsung membuka Pro." },
      ] },
      { id: "update-aplikasi", title: "Memperbarui dan mengembalikan versi HRIS", summary: "Perbarui dari Lisensi & Paket; database menyesuaikan sendiri dan versi sebelumnya bisa dipulihkan.", audience: ["SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka Lisensi & Paket → Versi & pembaruan. Bagian ini menampilkan versi yang berjalan, versi terbaru, dan catatannya.", "Klik Perbarui. Instalasi dengan installer resmi mencadangkan database bawaan ke folder backups/, mengunduh versi baru, memulai ulang, dan memeriksa kesehatan; bila gagal, otomatis kembali ke versi sebelumnya.", "Dokploy: hubungkan sekali (alamat Dokploy, API key, Compose ID), lalu tombol Perbarui mengganti HRIS_IMAGE dan menjalankan Deploy. Platform lain: tempel URL webhook deploy.", "Setelah pembaruan, tombol Kembali ke versi sebelumnya tersedia bila diperlukan."] },
        { type: "list", items: ["Saat versi baru start, struktur database diperiksa dan hanya ditambah (tabel, kolom, indeks, aturan baru). Data dan tabel lama tidak dihapus atau dibuat ulang.", "Karena hanya menambah, versi sebelumnya tetap berjalan pada database yang sama setelah rollback.", "Database lama dari instalasi sebelumnya dapat langsung dipakai: isi HRIS_DATABASE_URL dan pakai ENCRYPTION_KEY yang sama."] },
        { type: "note", tone: "warning", title: "Memulihkan data", text: "Rollback versi tidak mengubah data. Bila data perlu dikembalikan ke kondisi sebelum pembaruan, pulihkan cadangan dari folder backups/ (lihat dokumentasi Cadangan data di website lisensi)." },
      ] },
      { id: "api-key", title: "API key untuk integrasi (Pro)", summary: "Membuat, membatasi, dan mencabut akses API pihak ketiga.", audience: ["SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka Integrasi API, klik Buat API key, beri nama dan pilih scope seminimal mungkin (mis. employees:read, attendance:read).", "Salin key yang diawali hris_. Key hanya ditampilkan sekali; simpan di secret manager sistem tujuan.", "Panggil API dengan header Authorization: Bearer hris_…. Dokumentasi interaktif ada di /api-docs.", "Cabut key yang tidak dipakai. Aktivitas terakhir tiap key terlihat di daftar."] },
        { type: "code", text: "curl -H \"Authorization: Bearer hris_xxxxxxxx\" https://hr.perusahaan.co.id/api/v1/employees?limit=20" },
        { type: "note", tone: "warning", text: "API key tidak dapat mengubah pengaturan, peran, atau membuat key lain. Fitur yang memerlukan akun karyawan (absen, profil saya) tetap hanya lewat login aplikasi." },
      ] },
      { id: "mcp", title: "Hubungkan ke asisten AI (MCP, Pro)", summary: "Claude, Cursor, VS Code, dan klien MCP lain membaca data HRIS lewat API key berscope.", audience: ["SUPERADMIN", "HRD"], blocks: [
        { type: "steps", items: ["Buka Integrasi API dan buat API key khusus AI dengan scope baca seperlunya (tombol Hanya baca).", "Salin konfigurasi di kartu Hubungkan ke AI (MCP): Claude Code, Cursor/VS Code, atau Claude Desktop (lewat mcp-remote). Ganti hris_KEY_ANDA dengan API key tadi.", "Tanyakan ke asisten AI, misalnya: siapa yang belum absen hari ini di cabang Bandung, atau berapa karyawan aktif per divisi."] },
        { type: "list", items: ["Endpoint: https://alamat-hris/api/mcp (Streamable HTTP). Semua tool hanya membaca data.", "Tool: list_employees, get_employee, daily_attendance, attendance_history, list_branches, dashboard_summary, list_holidays, api_catalog, api_get.", "Scope API key, izin peran pembuatnya, penyamaran NIK/NPWP/rekening, batas laju, dan audit berlaku sama seperti API biasa."] },
        { type: "code", text: "claude mcp add --transport http karyon-hris https://hr.perusahaan.co.id/api/mcp --header \"Authorization: Bearer hris_KEY_ANDA\"" },
        { type: "note", tone: "warning", text: "Data yang dibaca asisten AI dikirim ke penyedia AI tersebut. Pastikan sesuai kebijakan privasi perusahaan dan batasi scope API key." },
      ] },
    ],
  },
  { id: "ulang-tahun", title: "Ulang Tahun Karyawan", sections: [{ id: "direktori-ulang-tahun", title: "Melihat ulang tahun rekan kerja", summary: "Menu khusus, ringkasan portal, dan periode fleksibel dari pengaturan perusahaan.", audience: [], blocks: [
    { type: "p", text: "Buka menu Ulang Tahun di panel admin atau portal karyawan. Ringkasan juga tersedia di overview admin dan halaman Presensi Mandiri. Daftar hanya memuat karyawan aktif dengan tanggal lahir terisi." },
    { type: "list", items: ["Pengelola mengatur periode melalui Pengaturan → Identitas Perusahaan → Periode daftar ulang tahun.", "Bulan ini: dari tanggal 1 sampai akhir bulan WIB.", "Beberapa bulan ke depan: isi 2 untuk hari ini sampai tanggal yang sama dua bulan lagi, disesuaikan bila akhir bulan.", "Rentang hari: sebelum 0 / sesudah 30 untuk 30 hari mendatang; sebelum 15 / sesudah 15 untuk 15 hari terakhir dan 15 hari berikutnya. Hari ini dan kedua batas ikut ditampilkan.", "Aktifkan Tampilkan tahun lahir dan usia jika kebijakan perusahaan memperbolehkan seluruh pengguna direktori melihatnya. Opsi ini nonaktif secara default.", "Ulang tahun 29 Februari ditampilkan 28 Februari pada tahun nonkabisat, tanpa mengubah tanggal lahir asli. Pengaturan ini tidak mengubah jadwal notifikasi otomatis ulang tahun."] },
  ] }] },
  {
    id: "pembaruan-21", title: "Pembaruan 2.1 — Disiplin, Payroll & API", sections: [
      { id: "disiplin-sp", title: "Kasus karyawan dan SP", summary: "Menautkan tindakan ke karyawan, meninjau bukti dan mengatur wewenang.", audience: ["SPV", "HRD", "AUDIT", "DIREKSI", "SUPERADMIN"], blocks: [
        { type: "p", text: "Menu Disiplin & SP hanya tampil jika peran akun diberi izin Lihat pada modul Disiplin & SP. Pilih Lihat/tinjau untuk membuka dialog langsung, bukan rincian di bawah daftar. Dialog menampilkan nama, nomor karyawan, tindakan, bukti, klarifikasi dan riwayat keputusan. Tautan detail membuka profil kerja serta seluruh riwayat kasus karyawan tersebut." },
        { type: "steps", items: ["Atur atasan langsung pada data karyawan (kolom Atasan langsung). Satu divisi saja tidak berarti bawahan langsung.", "Di Pengaturan → Peran & Hak Akses, pilih modul Disiplin & SP. Lihat untuk membaca, Tambah/Ubah untuk mencatat, Setujui untuk menerbitkan/menolak/menutup keputusan.", "Pilih lingkup Bawahan langsung untuk SPV atau peran atasan. Pilihan cabang/divisi/seluruh perusahaan dapat diberikan kepada petugas berwenang seperti HRD, Audit, Direksi. Peran tambahan dapat diatur dari menu yang sama.", "Catat kasus: cari dan pilih karyawan penerima (wajib), kategori, usulan tindakan, tanggal, kronologi, bukti dan klarifikasi.", "Tinjau bukti, tulis dasar keputusan, tanggal efektif dan konfirmasi pemeriksaan. Kasus diterbitkan dapat ditutup, bukan diam-diam diganti atau dihapus."] },
        { type: "note", tone: "warning", text: "Tidak boleh menindak diri sendiri. Resign adalah pengunduran diri, bukan sanksi. PHK/resign di kasus tidak otomatis menutup kontrak atau akses akun. Lakukan offboarding terpisah setelah proses perusahaan selesai. Izin baru diaktifkan admin melalui dashboard, bukan otomatis berdasarkan nama peran; izin existing tidak ditimpa." },
      ] },
      { id: "payroll-fleksibel", title: "Satuan payroll dan ruang uji", summary: "Tarif, alpha, batas bulanan, dan bukti keputusan.", audience: ["HRD", "AUDIT", "DIREKSI", "SUPERADMIN"], blocks: [
        { type: "list", items: ["Potongan telat: per menit, per jam proporsional, atau per hari terlambat. Mengubah satuan tidak otomatis mengubah nominal.", "Ambang alpha opsional: lebih dari X jam, bukan sama dengan. Tanggal yang berubah menjadi alpha tidak dipotong telat lagi. Riwayat presensi asli tetap ada.", "Batas telat bulanan: 0 tanpa batas. Pelampauan dapat membuka tinjauan sanksi, bukan menerbitkan SP otomatis.", "Lembur perusahaan per jam/menit; tarif khusus karyawan tetap per jam. Alpha tetap per hari.", "Ruang Uji Kebijakan membandingkan aturan menggunakan data yang sama, tanpa mengubah pengaturan, slip, atau kasus disiplin. Bukti keputusan pada slip menyimpan snapshot perhitungan."] },
        { type: "note", tone: "warning", text: "Kalender alpha mengikuti perhitungan payroll yang berlaku. Verifikasi shift khusus. Simulasi bukan simulasi pajak/gaji bersih dan belum merupakan alur persetujuan kebijakan." },
      ] },
      { id: "peta-demo", title: "Peta cabang dan data demo", summary: "Pencarian titik dan batas penggunaan data sintetis.", audience: ["HRD", "GA", "SUPERADMIN"], blocks: [
        { type: "p", text: "Form cabang dapat mencari nama/alamat cabang tersimpan atau koordinat lat, lng. Pilih hasil, lalu geser pin/klik peta dan simpan cabang. Pencarian alamat baru memerlukan penyedia geocoding yang dikonfigurasi administrator; jangan kirim data pribadi dalam query." },
        { type: "note", tone: "warning", text: "Dataset 200 karyawan adalah sintetis untuk uji, bukan pegawai/bukti biometrik nyata. Akun dengan password demo bersama tidak boleh dipakai pada produksi. Seed aditif tidak mengubah superadmin atau menggandakan data saat diulang." },
      ] },
      { id: "api-interaktif", title: "Referensi API interaktif", summary: "OpenAPI JSON, konsol permintaan nyata, dan cara menguji.", audience: ["SUPERADMIN"], blocks: [
        { type: "steps", items: ["Buka /api-docs setelah login superadmin. Cari modul dan buka endpoint untuk membaca parameter, body, izin, serta kesalahan umum.", "Buka Coba API, isi path ID, query JSON, header opsional dan body. Upload menggunakan pemilih file dan field multipart.", "Periksa method dan target. Konfirmasi jika operasi dapat mengubah/menghapus data atau mengirim notifikasi. Tidak ada mode simulasi universal.", "Kirim permintaan. HTTP status dan respons ditampilkan; data biner dapat diunduh. API tetap menerapkan izin akun, validasi, scope dan pembatasan laju.", "Unduh /api/v1/openapi untuk klien OpenAPI. API bisnis /api/v1, sesi/login/logout Auth.js /api/auth/*. Gunakan login aplikasi untuk memperoleh cookie, bukan menempel token ke halaman pihak ketiga."] },
        { type: "note", tone: "warning", text: "Konsol memakai database yang sedang aktif, bukan sandbox; utamakan staging/data demo. Jangan mengeksekusi semua endpoint tulis sebagai tes massal. Cakupan katalog diperiksa otomatis terhadap route; kelengkapan katalog tidak membuktikan semua kontrak dan integrasi telah diuji." },
      ] },
    ],
  },
  /* ================================================================ */
  {
    id: "mulai",
    title: "Memulai",
    sections: [
      {
        id: "gambaran",
        title: "Gambaran sistem",
        summary: "Apa saja yang bisa dikerjakan di HRIS dan siapa memakai bagian yang mana.",
        audience: [],
        blocks: [
          {
            type: "p",
            text:
              "HRIS dipakai setiap karyawan untuk urusan dirinya sendiri: absen, cuti, tukar libur, slip gaji, penilaian kinerja, inventaris, dan pengaduan. Panduan ini hanya memuat menu yang bisa Anda gunakan sesuai peran akun Anda.",
          },
          {
            type: "note",
            tone: "info",
            title: "Semua waktu dalam WIB",
            text:
              "Jam masuk, batas keterlambatan, dan tanggal pengajuan dihitung memakai zona waktu Asia/Jakarta, bukan jam perangkat Anda. Karyawan di zona waktu lain tetap dinilai dengan patokan yang sama.",
          },
        ],
      },
      {
        id: "peran-akses",
        title: "Peran dan ruang kerja",
        summary: "Siapa memakai bagian yang mana, dan cara masuk ke panel pengelola.",
        audience: ["SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Ada dua ruang kerja. Portal Karyawan untuk urusan pribadi setiap orang, dan panel pengelola untuk HRD, atasan, dan manajemen. Alamat login panel pengelola sengaja tidak ditautkan dari halaman mana pun; bagikan alamatnya langsung kepada pengelola yang berhak. Membuka alamat panel tanpa login diarahkan ke login karyawan, bukan ke login pengelola.",
          },
          {
            type: "table",
            head: ["Peran", "Ruang kerja", "Tugas utama"],
            rows: [
              ["Karyawan (STAFF)", "Portal", "Presensi harian, pengajuan cuti dan koreksi absen, slip gaji, pengaduan"],
              ["Atasan (SPV)", "Portal + Admin", "Semua tugas karyawan, ditambah persetujuan tahap pertama untuk divisinya"],
              ["HRD", "Admin", "Data karyawan, jadwal, payroll, rekrutmen, dan persetujuan tahap kedua"],
              ["Audit", "Admin", "Membaca dan mengekspor seluruh data, memverifikasi pengajuan yang dieskalasi"],
              ["GA", "Admin", "Mengelola aset dan serah terima inventaris"],
              ["Direksi", "Admin", "Ringkasan eksekutif dan persetujuan tahap akhir"],
              ["Superadmin", "Admin", "Seluruh konfigurasi sistem, peran, dan hak akses"],
            ],
          },
        ],
      },
      {
        id: "login",
        title: "Masuk pertama kali",
        summary: "Cara masuk, apa yang terjadi bila lupa kata sandi, dan mengapa akun bisa terkunci.",
        audience: [],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka halaman utama, lalu tekan Masuk.",
              "Masukkan email kantor dan kata sandi awal yang diberikan HRD.",
              "Pada login pertama, sistem mengarahkan Anda ke halaman Profil & Keamanan untuk mengganti kata sandi. Menu lain terkunci sampai langkah ini selesai.",
              "Klik Kirim kode verifikasi, buka email Anda, lalu masukkan kode 6 angka bersama kata sandi lama dan kata sandi baru.",
            ],
          },
          {
            type: "note",
            tone: "warning",
            title: "Akun terkunci sementara",
            text:
              "Setelah beberapa kali kata sandi salah berturut-turut, akun dikunci selama beberapa menit. Ini melindungi akun Anda dari percobaan tebak kata sandi. Tunggu hingga masa kunci berakhir, atau pakai menu Lupa Kata Sandi.",
          },
          {
            type: "list",
            items: [
              "Kata sandi minimal 10 karakter dan harus memuat huruf besar, huruf kecil, serta angka.",
              "Kata sandi baru tidak boleh sama dengan kata sandi awal bawaan sistem.",
              "Kode verifikasi hanya berlaku 10 menit dan sekali pakai.",
              "Jangan pernah membagikan kode verifikasi — staf HRD maupun IT tidak akan pernah memintanya.",
            ],
          },
        ],
      },
      {
        id: "notifikasi",
        title: "Notifikasi",
        summary: "Pemberitahuan apa yang Anda terima, kapan, dan cara membacanya.",
        audience: [],
        blocks: [
          {
            type: "p",
            text:
              "Ikon lonceng di kanan atas menampilkan pemberitahuan yang perlu Anda ketahui atau kerjakan. Angka merah adalah jumlah yang belum dibaca. Setiap notifikasi membawa Anda langsung ke halaman terkait dan otomatis ditandai sudah dibaca saat dibuka. Gunakan tab Belum dibaca untuk melihat yang tersisa saja.",
          },
          {
            type: "table",
            head: ["Anda menerima", "Saat"],
            rows: [
              ["Hasil pengajuan (cuti, koreksi, tukar libur, ganti wajah)", "Setiap langkah disetujui, dan saat disetujui penuh atau ditolak beserta catatannya"],
              ["Presensi pulang kemarin belum tercatat", "Pagi hari bila Anda absen masuk tanpa absen pulang; langsung membuka formulir koreksi"],
              ["Slip gaji terbit / hasil penilaian kinerja", "Saat HRD menerbitkannya"],
              ["Pengingat kontrak", "30, 14, dan 7 hari sebelum kontrak berakhir (karyawan, atasan, HRD)"],
              ["Pengajuan menunggu persetujuan (atasan/HRD)", "Saat pengajuan masuk ke langkah Anda, dan ringkasan harian bila ada yang tertahan lebih dari 2 hari"],
              ["Pelamar baru, jadwal wawancara (HRD/pewawancara)", "Saat lamaran masuk, saat Anda ditunjuk mewawancarai, dan sehari sebelum wawancara"],
              ["Karyawan baru perlu dilengkapi (HRD)", "Saat pelamar direkrut, dan setiap Senin bila masih ada yang belum lengkap"],
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Email dan WhatsApp",
            text:
              "Bila perusahaan menyalakannya, notifikasi yang sama juga dikirim lewat email atau WhatsApp. Pemberitahuan yang sangat sering, seperti pelamar baru, hanya dikirim di aplikasi. Pengingat terjadwal dikirim sekali per hari.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "presensi",
    title: "Presensi",
    sections: [
      {
        id: "absen-harian",
        title: "Melakukan absen harian",
        summary: "Urutan tahapan absen, syarat foto, dan syarat lokasi.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Halaman Presensi Mandiri hanya menampilkan satu tombol: tahap berikutnya yang boleh Anda lakukan. Urutannya dijaga sistem sehingga Anda tidak bisa absen pulang sebelum absen masuk, atau absen masuk dua kali dalam sehari.",
          },
          {
            type: "steps",
            items: [
              "Buka menu Presensi Mandiri. Sistem meminta izin lokasi — pilih Izinkan.",
              "Tunggu koordinat muncul. Perhatikan angka akurasi; bila di atas 100 meter, dekati jendela atau area terbuka lalu tekan tombol perbarui.",
              "Bila diminta foto, tekan Nyalakan kamera lalu Ambil foto. Foto dipakai untuk memverifikasi bahwa Anda sendiri yang absen.",
              "Tekan tombol tahap yang aktif (Absen Masuk / Mulai Istirahat / Selesai Istirahat / Absen Pulang), lalu konfirmasi.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Waktu diambil dari server",
            text:
              "Jam yang tercatat adalah jam server dalam WIB, bukan jam perangkat Anda. Mengubah jam di ponsel tidak akan mengubah catatan presensi.",
          },
        ],
      },
      {
        id: "radius",
        title: "Radius kantor dan kendala lokasi",
        summary: "Kenapa absen bisa ditolak, dan apa yang harus dilakukan bila GPS bermasalah.",
        audience: ["STAFF", "SPV", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Setiap cabang punya titik koordinat dan radius sendiri. Absen di luar radius akan ditolak, kecuali dalam tiga keadaan berikut.",
          },
          {
            type: "table",
            head: ["Keadaan", "Yang terjadi", "Tindakan"],
            rows: [
              [
                "Anda berada di cabang lain",
                "Absen diterima dan ditandai Lintas Cabang",
                "Tidak perlu tindakan; HRD akan meninjau",
              ],
              [
                "Anda punya izin WFH / Dinas Luar yang sudah disetujui",
                "Radius tidak diperiksa untuk rentang tanggal tersebut",
                "Ajukan izin WFH/Dinas Luar sebelum harinya tiba",
              ],
              [
                "GPS meleset padahal Anda di kantor",
                "Absen diterima lewat menu Kendala Lokasi dan ditandai untuk ditinjau",
                "Aktifkan tombol Kendala Lokasi dan tulis alasan yang jelas",
              ],
            ],
          },
          {
            type: "note",
            tone: "danger",
            title: "Kendala Lokasi bukan jalan pintas",
            text:
              "Setiap pemakaian menu ini ditandai dan muncul di daftar tinjauan HRD lengkap dengan koordinat, jarak, dan alasan yang Anda tulis. Memakainya saat tidak benar-benar berada di kantor adalah pelanggaran kedisiplinan.",
          },
        ],
      },
      {
        id: "koreksi",
        title: "Koreksi absen",
        summary: "Cara memperbaiki jam yang keliru atau lupa tercatat, beserta kuota bulanannya.",
        audience: ["STAFF", "SPV", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Koreksi absen memperbaiki catatan historis — misalnya Anda lupa tap saat tiba di kantor. Koreksi bukan pengganti kewajiban absen: Anda tetap harus melakukan presensi normal pada hari berjalan.",
          },
          {
            type: "steps",
            items: [
              "Buka Presensi Mandiri, pilih tab Koreksi Absen, lalu tekan Ajukan koreksi.",
              "Pilih tanggal yang ingin dikoreksi (hanya dalam rentang hari terakhir yang diizinkan HRD).",
              "Isi jam masuk dan jam pulang yang seharusnya.",
              "Pilih kategori alasan, lalu jelaskan kronologinya minimal 15 karakter.",
              "Bila ada, lampirkan bukti: unggah foto atau PDF (misalnya tangkapan layar galat aplikasi atau surat tugas), atau tempel tautan ke berkasnya.",
              "Kirim. Pengajuan diteruskan ke atasan, lalu HRD.",
            ],
          },
          {
            type: "note",
            tone: "warning",
            title: "Kuota bulanan",
            text:
              "Jumlah koreksi per bulan dibatasi. Bila kuota habis, pengajuan berikutnya tidak ditolak otomatis, tetapi naik ke jalur persetujuan berlapis HRD → Audit → Direksi. Kategori alasan yang Anda pilih dipakai HRD untuk melihat pola kendala yang berulang.",
          },
        ],
      },
      {
        id: "jadwal",
        title: "Jadwal kerja dan keterlambatan",
        summary: "Dari mana jam kerja Anda berasal dan bagaimana sistem menentukan terlambat.",
        audience: [],
        blocks: [
          {
            type: "p",
            text:
              "Sistem membandingkan jam absen masuk Anda dengan jadwal yang berlaku hari itu. Jadwal bisa berbeda per hari, misalnya Senin–Kamis 08.00–17.00, Jumat 08.00–16.00, dan Sabtu 08.00–13.00.",
          },
          {
            type: "table",
            head: ["Urutan", "Sumber jadwal", "Contoh"],
            rows: [
              ["1", "Jadwal khusus tanggal", "Tukar shift atau libur pengganti yang diatur HRD/atasan untuk tanggal tertentu"],
              ["2", "Template shift Anda", "Jam per hari dari template mingguan yang dipasang ke Anda; hari yang tidak aktif adalah hari libur"],
              ["3", "Jam operasional cabang", "Dipakai bila Anda belum punya template"],
            ],
          },
          {
            type: "list",
            items: [
              "Toleransi keterlambatan diatur per template shift.",
              "Toleransi hanya menentukan apakah Anda ditandai terlambat. Menit keterlambatan tetap dihitung dari jam jadwal, bukan dari akhir masa toleransi.",
              "Pada hari libur menurut jadwal, absen tetap bisa dilakukan tetapi tidak pernah dihitung terlambat atau pulang lebih awal.",
              "Shift malam yang berakhir setelah tengah malam (misalnya 23.00–07.00) dihitung sampai jam pulang di hari berikutnya.",
              "Jam jadwal yang berlaku disimpan bersama catatan presensi, sehingga perubahan jadwal di kemudian hari tidak mengubah riwayat lama.",
            ],
          },
        ],
      },
      {
        id: "atur-jadwal",
        title: "Mengatur shift dan jadwal karyawan",
        summary: "Template shift dengan jam berbeda per hari, memasangnya ke karyawan, dan jadwal khusus tanggal.",
        audience: ["HRD", "SPV", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Menu Jadwal & Shift punya tiga tab yang saling terhubung. Template shift menentukan jam per hari; Jadwal karyawan menentukan template mana yang dipakai setiap orang; Jadwal khusus tanggal mengganti jadwal pada tanggal tertentu tanpa mengubah template. Saat karyawan absen, sistem memakai jadwal khusus bila ada, lalu template karyawan, lalu jam operasional cabang.",
          },
          {
            type: "steps",
            items: [
              "Tab Template shift → Buat template. Beri nama, isi toleransi terlambat, lalu atur setiap hari: centang hari kerja, isi jam masuk, pulang, dan istirahat. Gunakan Salin ke hari aktif lain bila jamnya sama.",
              "Tab Jadwal karyawan → centang karyawan (bisa banyak sekaligus), pilih template di bar yang muncul, lalu Terapkan.",
              "Tekan 14 hari pada baris karyawan untuk melihat jadwal yang benar-benar akan dipakai saat absen, lengkap dengan sumbernya.",
              "Tab Jadwal khusus tanggal → Tambah jadwal khusus untuk tukar shift, lembur di hari libur, atau libur pengganti. Pilih karyawan, rentang tanggal, lalu pilih shift atau tandai sebagai libur.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Mengubah template",
            text:
              "Perubahan template berlaku untuk absen berikutnya bagi semua pemakainya. Riwayat presensi yang sudah tercatat tidak berubah. Template yang masih dipakai karyawan tidak bisa dihapus.",
          },
        ],
      },
      {
        id: "wajah-karyawan",
        title: "Mendaftarkan wajah untuk presensi",
        summary: "Pendaftaran pertama, absen dengan verifikasi wajah, dan mengganti wajah.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Bila perusahaan mengaktifkan verifikasi wajah, setiap foto presensi dicocokkan dengan wajah yang Anda daftarkan. Absen ditolak bila wajah di foto tidak cocok, dan absen masuk serta pulang selalu meminta foto.",
          },
          {
            type: "steps",
            items: [
              "Buka Profil & Keamanan, lalu pilih tab Wajah Presensi.",
              "Tekan Daftarkan wajah dan nyalakan kamera.",
              "Ambil tiga foto sesuai petunjuk: menghadap lurus, sedikit menoleh ke kiri, sedikit menoleh ke kanan. Tombol Ambil foto baru aktif setelah gambar kamera siap.",
              "Baca poin persetujuan pengolahan data wajah, centang, lalu tekan Daftarkan wajah.",
              "Sistem memeriksa ketiga foto. Bila salah satu bermasalah, pesan menyebut nomor fotonya — ambil ulang foto itu saja.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Pendaftaran pertama langsung berlaku",
            text:
              "Pendaftaran pertama tidak perlu persetujuan, tetapi atasan Anda menerima pemberitahuan. Setelah terdaftar, penggantian wajah harus disetujui atasan.",
          },
          {
            type: "table",
            head: ["Pesan saat absen", "Artinya dan yang perlu dilakukan"],
            rows: [
              ["Wajah Anda belum terdaftar", "Daftarkan wajah dulu di tab Wajah Presensi."],
              ["Wajah tidak terdeteksi", "Wajah tidak terlihat jelas. Cari tempat lebih terang, lepas masker, dan hadapkan wajah ke kamera."],
              ["Terdeteksi lebih dari satu wajah", "Ada orang lain di bingkai kamera. Pastikan hanya Anda yang terlihat."],
              ["Wajah terlalu jauh", "Dekatkan ponsel hingga wajah mengisi sebagian besar bingkai."],
              ["Wajah tidak cocok", "Foto tidak cocok dengan wajah terdaftar. Ulangi dengan cahaya yang lebih baik. Bila terus gagal padahal Anda sendiri, ajukan koreksi absen dan beri tahu atasan."],
              ["Gambar kamera masih gelap", "Kamera belum siap. Tunggu hingga wajah terlihat di layar, lalu ambil foto lagi."],
            ],
          },
          {
            type: "steps",
            items: [
              "Untuk mengganti wajah, buka tab Wajah Presensi dan tekan Ajukan penggantian wajah.",
              "Ambil tiga foto baru, tuliskan alasan penggantian, dan centang persetujuan.",
              "Permintaan dikirim ke atasan. Selama menunggu, absen tetap memakai wajah yang lama.",
              "Permintaan masih bisa dibatalkan selama atasan belum memprosesnya.",
            ],
          },
        ],
      },
      {
        id: "wajah-spv",
        title: "Menyetujui penggantian wajah",
        summary: "Cara memeriksa permintaan penggantian wajah dari anggota tim.",
        audience: ["SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Permintaan penggantian wajah dari karyawan di divisi Anda muncul di menu Persetujuan. Anda yang paling mengenal wajah anggota tim, jadi keputusan ini ada di tangan Anda — bukan di tangan sistem.",
          },
          {
            type: "steps",
            items: [
              "Buka Persetujuan dan pilih permintaan Penggantian Wajah Presensi.",
              "Bandingkan foto Wajah terdaftar dan Wajah pengganti yang ditampilkan berdampingan.",
              "Baca alasan yang ditulis karyawan.",
              "Setujui bila Anda yakin kedua foto adalah orang yang sama. Tolak dengan alasan bila tidak.",
            ],
          },
          {
            type: "table",
            head: ["Petunjuk sistem", "Cara membacanya"],
            rows: [
              ["Sistem menilai wajahnya mirip", "Foto baru cocok dengan wajah lama. Tetap periksa dengan mata Anda."],
              ["Sistem ragu", "Kemiripan di batas. Bisa karena cahaya atau penampilan berubah, bisa juga orang lain. Periksa baik-baik."],
              ["Sistem menilai ini wajah yang berbeda", "Setujui hanya bila Anda yakin, misalnya setelah perubahan penampilan besar."],
            ],
          },
          {
            type: "note",
            tone: "danger",
            title: "Waspadai titip absen",
            text:
              "Mengganti wajah terdaftar dengan wajah rekan adalah cara menyiapkan titip absen. Bila foto pengganti bukan orang yang sama, tolak dan laporkan ke HRD. Anda tidak dapat memutuskan permintaan milik Anda sendiri.",
          },
        ],
      },
      {
        id: "wajah-admin",
        title: "Mengelola verifikasi wajah",
        summary: "Mengaktifkan fitur, tingkat kecocokan, reset data wajah, dan perlindungan data.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Umumkan ke karyawan agar mendaftarkan wajah di tab Wajah Presensi. Pendaftaran bisa dilakukan sebelum fitur diaktifkan.",
              "Buka Pengaturan Sistem, bagian Presensi.",
              "Pilih Tingkat kecocokan wajah. Normal disarankan.",
              "Nyalakan Verifikasi wajah saat presensi. Perubahan langsung berlaku.",
            ],
          },
          {
            type: "note",
            tone: "warning",
            title: "Karyawan yang belum mendaftar tidak dapat absen",
            text:
              "Begitu fitur aktif, karyawan tanpa wajah terdaftar diarahkan untuk mendaftar dan tidak bisa absen sampai selesai. Aktifkan setelah sebagian besar karyawan terdaftar.",
          },
          {
            type: "table",
            head: ["Tingkat", "Ambang jarak", "Kapan dipakai"],
            rows: [
              ["Ketat", "0,45", "Risiko titip absen tinggi. Lebih sering menolak foto asli dalam cahaya buruk."],
              ["Normal", "0,50", "Pilihan umum. Keseimbangan antara keamanan dan kenyamanan."],
              ["Longgar", "0,55", "Lokasi dengan pencahayaan sulit. Tetap jauh di bawah jarak wajah orang lain yang terukur."],
            ],
          },
          {
            type: "p",
            text:
              "Status wajah tiap karyawan terlihat di form Data Karyawan, bagian Wajah Presensi. Gunakan Reset data wajah bila foto acuan bukan karyawan tersebut atau karyawan meminta datanya dihapus. Alasan reset wajib diisi, tercatat di jejak audit, dan dikirim ke karyawan.",
          },
          {
            type: "list",
            items: [
              "Data wajah adalah data pribadi spesifik menurut UU 27/2022 tentang Pelindungan Data Pribadi. Persetujuan karyawan dicatat beserta versi teksnya.",
              "Data wajah disimpan terenkripsi dan tidak pernah dikirim ke browser.",
              "Foto acuan hanya dapat dibuka pemiliknya, HRD, dan Superadmin. SPV hanya melihatnya lewat tautan sementara saat memeriksa permintaan penggantian.",
              "Foto dan data wajah dari permintaan yang ditolak atau dibatalkan dihapus. Reset menghapus seluruh data wajah karyawan.",
              "Setiap kegagalan pencocokan wajah tercatat di jejak audit dengan aksi FACE_MISMATCH — pola kegagalan berulang pada satu karyawan patut diperiksa.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Batas kemampuan",
            text:
              "Verifikasi wajah memastikan foto berisi wajah karyawan yang terdaftar, tetapi tidak dapat memastikan wajah itu hadir langsung. Foto dari layar ponsel lain yang memperlihatkan wajah karyawan dapat lolos. Karena itu lokasi GPS tetap diperiksa dan jejak audit tetap perlu dipantau.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "cuti",
    title: "Izin, Cuti & Tukar Libur",
    sections: [
      {
        id: "ajukan-cuti",
        title: "Mengajukan izin atau cuti",
        summary: "Alur pengajuan, syarat bukti, dan cara membaca saldo.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka menu Izin & Cuti lalu tekan Ajukan izin / cuti.",
              "Pilih jenisnya. Kotak informasi menjelaskan aturan kuota jenis itu, sisa saldo bila ada, batas H- pengajuan, dan apakah bukti diperlukan.",
              "Untuk Izin Keperluan Lainnya, tuliskan keperluannya di kolom Keperluan.",
              "Pilih tanggal mulai dan selesai. Kalender otomatis membatasi tanggal yang melanggar aturan H-.",
              "Tulis alasan minimal 10 karakter, lampirkan bukti bila diminta (unggah foto/PDF atau tempel tautan Google Drive), lalu kirim.",
            ],
          },
          {
            type: "table",
            head: ["Jenis kuota", "Artinya", "Contoh"],
            rows: [
              ["Saldo tahunan", "Jatah hari per tahun yang berkurang setiap dipakai", "Cuti tahunan 12 hari"],
              ["Per kejadian", "Batas hari untuk setiap peristiwa, tidak memotong saldo tahunan. Bila peristiwanya terjadi lagi, ajukan lagi", "Izin menikah 3 hari, keluarga meninggal 3 hari"],
              ["Tanpa kuota", "Tidak ada jatah, hanya batas hari per pengajuan bila ada", "Sakit dengan surat dokter, WFH, keperluan lain"],
            ],
          },
          {
            type: "note",
            tone: "success",
            title: "Akhir pekan tidak memotong saldo",
            text:
              "Pada mode perhitungan hari kerja, Sabtu, Minggu, dan tanggal merah di dalam rentang pengajuan tidak memotong kuota cuti Anda. Kolom durasi menampilkan hari kerja dan hari kalender secara terpisah agar bedanya terlihat.",
          },
          {
            type: "table",
            head: ["Kolom saldo", "Artinya"],
            rows: [
              ["Sisa", "Hari yang masih bisa Anda ajukan"],
              ["Terpakai", "Hari dari pengajuan yang sudah disetujui"],
              ["Menunggu approval", "Hari yang sedang ditahan untuk pengajuan berjalan"],
            ],
          },
          {
            type: "p",
            text:
              "Saat Anda mengirim pengajuan, saldo langsung ditahan agar tidak bisa dipakai dua kali. Bila pengajuan ditolak atau Anda batalkan, saldo dikembalikan otomatis.",
          },
        ],
      },
      {
        id: "batal-cuti",
        title: "Membatalkan pengajuan",
        summary: "Kapan pengajuan masih bisa ditarik kembali.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Pengajuan dapat dibatalkan sendiri selama belum ada satu pun approver yang menekan tombol setuju atau tolak. Setelah proses berjalan, pembatalan harus lewat HRD agar jejak persetujuannya tetap utuh.",
          },
        ],
      },
      {
        id: "jenis-cuti",
        title: "Mengatur jenis izin dan cuti",
        summary: "Menambah jenis, memilih cara menghitung kuota, dan izin untuk keperluan lain.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka Master Data → Jenis Izin & Cuti, lalu tekan Tambah jenis atau ikon pensil pada jenis yang ada.",
              "Pilih cara menghitung kuota: Saldo tahunan, Per kejadian, atau Tanpa kuota.",
              "Isi jumlah harinya. Untuk Per kejadian, isi juga batas kejadian per tahun bila perlu (0 = tidak dibatasi).",
              "Atur batas H- pengajuan, wajib bukti, khusus jenis kelamin tertentu, dan boleh absen di luar radius kantor.",
              "Nyalakan Keperluan ditulis karyawan untuk jenis serba guna seperti Izin Keperluan Lainnya.",
              "Periksa kotak Yang dilihat karyawan: itulah kalimat aturan yang muncul di formulir pengajuan.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Izin menikah atau duka yang terjadi lebih dari sekali",
            text:
              "Gunakan Per kejadian. Batas hari berlaku untuk setiap peristiwa, bukan per bulan atau per tahun, sehingga karyawan dapat mengajukan lagi bila peristiwanya terjadi lagi. Isi batas kejadian per tahun hanya bila perusahaan memang membatasinya.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Mengubah cara hitung",
            text:
              "Cara hitung tidak bisa diubah selama masih ada pengajuan jenis itu yang menunggu persetujuan, agar saldo yang sudah ditahan tidak salah dikembalikan. Jenis yang pernah dipakai dinonaktifkan, bukan dihapus.",
          },
        ],
      },
      {
        id: "tukar-libur",
        title: "Tukar libur",
        summary: "Menukar tanggal merah dengan hari libur pengganti, beserta syaratnya.",
        audience: ["STAFF", "SPV", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Bila Anda bersedia masuk pada tanggal merah, Anda dapat menukarnya dengan libur di hari kerja lain. Aturan berikut dijaga sistem secara otomatis.",
          },
          {
            type: "list",
            items: [
              "Pengajuan minimal H- sekian sebelum tanggal merah, sesuai pengaturan HRD.",
              "Satu tanggal merah hanya bisa ditukar satu kali oleh orang yang sama.",
              "Tanggal pengganti harus hari kerja — bukan akhir pekan dan bukan tanggal merah lain.",
              "Rekan satu divisi tidak boleh mengambil tanggal pengganti yang sama, agar divisi tidak kosong.",
              "Ada batas jumlah tanggal merah berdekatan yang boleh ditukar sekaligus.",
            ],
          },
          {
            type: "note",
            tone: "danger",
            title: "Hak libur gugur bila Anda tidak masuk",
            text:
              "Hak libur pengganti hanya berlaku bila Anda benar-benar tercatat absen masuk pada tanggal merah tersebut. Bila hari itu Anda tidak masuk, pengajuan otomatis ditandai gugur meskipun sudah disetujui.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "approval",
    title: "Persetujuan",
    sections: [
      {
        id: "cara-menyetujui",
        title: "Memproses antrean persetujuan",
        summary: "Cara approver membaca dan memutuskan pengajuan.",
        audience: ["SPV", "HRD", "AUDIT", "DIREKSI", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Menu Persetujuan menampilkan seluruh pengajuan yang menunggu keputusan peran Anda. Atasan hanya melihat pengajuan dari divisinya sendiri; HRD, Audit, dan Direksi melihat seluruh perusahaan.",
          },
          {
            type: "steps",
            items: [
              "Baca ringkasan: jenis pengajuan, periode, durasi, dan alasan pemohon.",
              "Bila ada lampiran, buka dan periksa sebelum memutuskan. Tautan lampiran hanya berlaku beberapa menit.",
              "Perhatikan jejak langkah di bagian bawah kartu untuk melihat siapa yang sudah menyetujui sebelum Anda.",
              "Tekan Setujui atau Tolak. Penolakan wajib disertai alasan minimal 5 karakter karena pemohon akan membacanya.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Alur berjenjang",
            text:
              "Setelah Anda menyetujui, pengajuan otomatis diteruskan ke approver berikutnya beserta notifikasinya. Bila Anda adalah langkah terakhir, efeknya langsung berlaku: saldo cuti dipotong, atau catatan presensi diperbaiki.",
          },
        ],
      },
      {
        id: "atur-alur",
        title: "Mengubah alur persetujuan",
        summary: "Menentukan siapa saja approver dan urutannya.",
        audience: ["SUPERADMIN", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Alur persetujuan tersimpan sebagai data, bukan kode program. Untuk setiap jenis transaksi (cuti, koreksi absen, tukar libur) Anda menentukan urutan peran approver. Perubahan berlaku untuk pengajuan baru; pengajuan yang sedang berjalan tetap memakai alur saat dikirim, agar jejaknya konsisten.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Pengecualian kuota koreksi absen",
            text:
              "Koreksi absen yang melebihi kuota bulanan selalu memakai alur khusus HRD → Audit → Direksi, terlepas dari alur normal yang Anda atur.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "payroll",
    title: "Payroll & Slip Gaji",
    sections: [
      {
        id: "slip-karyawan",
        title: "Membaca slip gaji Anda",
        summary: "Isi slip gaji dan dasar perhitungannya.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Slip gaji tersimpan permanen dan dapat dibuka kapan saja lewat menu Slip Gaji Saya. Tekan Rincian untuk melihat komponen penghasilan dan potongan, atau Unduh untuk menyimpan dokumen lengkapnya.",
          },
          {
            type: "list",
            items: [
              "Penghasilan terdiri dari gaji pokok, tunjangan, dan lembur yang sudah disetujui.",
              "Potongan mencakup keterlambatan, alpha, BPJS, dan PPh 21 dengan tarif yang diatur perusahaan.",
              "Hari cuti yang sudah disetujui tidak dihitung sebagai alpha.",
              "Bagian bawah slip menampilkan jumlah kehadiran dari total hari kerja sebagai dasar perhitungan.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Bila ada selisih",
            text:
              "Ajukan keberatan ke HRD paling lambat 7 hari sejak slip diterbitkan. Setiap kali slip dibuka atau diunduh, aktivitas tersebut tercatat di log audit.",
          },
        ],
      },
      {
        id: "generate-payroll",
        title: "Menerbitkan slip gaji",
        summary: "Menghitung, meninjau sebagai draf, menerbitkan, dan mengunggah slip PDF.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Pastikan tarif potongan dan lembur di Pengaturan → Payroll sudah sesuai, dan data presensi bulan itu sudah final.",
              "Buka Slip Gaji dan pilih periode. Karyawan yang belum punya slip tampil di kiri.",
              "Tekan Atur pada karyawan yang punya bonus, potongan, atau capaian target bulan ini (lihat bagian Komponen gaji). Hasil hitungnya terlihat langsung di sisi kanan jendela.",
              "Centang karyawan, biarkan Simpan sebagai draf dulu menyala, lalu tekan Hitung.",
              "Periksa draf: tekan nama karyawan untuk rincian. Bila ada yang salah, tekan Atur lalu Hitung ulang.",
              "Tekan Terbitkan per baris atau Terbitkan semua draf. Karyawan menerima notifikasi.",
            ],
          },
          {
            type: "p",
            text:
              "Slip yang dibuat di luar sistem, misalnya dari software akuntansi, dapat diunggah per karyawan lewat Unggah slip PDF. Karyawan membuka berkas itu di portal. Periode yang memakai slip unggahan tidak ikut dihitung otomatis agar tidak tertimpa.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Slip yang sudah terbit tidak bisa dihapus",
            text:
              "Demi jejak audit, slip berstatus terbit hanya bisa direvisi dengan Hitung ulang, bukan dihapus. Hanya draf yang dapat dihapus.",
          },
          {
            type: "note",
            tone: "info",
            title: "Bila ada karyawan yang gagal diproses",
            text:
              "Daftar kegagalan muncul beserta alasannya. Penyebab paling sering adalah belum ada kontrak bernominal gaji pada periode itu sementara Gaji pokok default di Pengaturan masih nol.",
          },
        ],
      },
      {
        id: "komponen-gaji",
        title: "Komponen gaji, lembur, dan insentif target",
        summary: "Tunjangan dan potongan tetap, bonus bulanan, lembur dibayar atau tidak, dan bonus sesuai capaian target.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Gaji pokok dan tunjangan tetap diambil dari kontrak yang berlaku pada periode tersebut. Selebihnya diatur per karyawan lewat tombol Atur di halaman Slip Gaji, yang punya dua tab.",
          },
          {
            type: "table",
            head: ["Tab", "Isi", "Berlaku"],
            rows: [
              ["Komponen tetap & aturan", "Lembur dibayar tarif perusahaan / tarif khusus / tidak dibayar; tanpa potongan terlambat atau alpha; tunjangan dan potongan tetap bulanan (boleh dengan bulan terakhir, misalnya cicilan); insentif target", "Setiap bulan sampai diubah"],
              ["Periode ini", "Bonus dan potongan khusus bulan itu (bonus Lebaran, kasbon, denda); capaian target bulan itu", "Hanya periode yang dipilih"],
            ],
          },
          {
            type: "steps",
            items: [
              "Di Komponen tetap & aturan, nyalakan Insentif berdasarkan target. Isi nama target, nilai target per bulan, dan satuannya.",
              "Isi tingkat bonus sesuai kesepakatan, misalnya capaian 80% ke atas Rp300.000, 100% ke atas Rp750.000, 120% ke atas Rp1.500.000. Yang dibayar adalah tingkat tertinggi yang tercapai.",
              "Bila disepakati, isi tambahan per unit di atas target. Kotak Contoh hitungan memperlihatkan hasilnya untuk capaian 80%, 100%, dan 120%.",
              "Setiap bulan, isi capaiannya di tab Periode ini. Insentif dihitung otomatis dan tercetak di slip beserta persentase capaiannya.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Urutan hitung",
            text:
              "Penghasilan = gaji pokok + tunjangan kontrak + tunjangan tetap + bonus bulan ini + insentif target + lembur. Potongan terlambat, alpha, dan BPJS dihitung lebih dulu; PPh 21 dihitung dari penghasilan dikurangi potongan tersebut di atas ambang PTKP; potongan tetap dan potongan bulan ini dikurangkan setelahnya.",
          },
        ],
      },
      {
        id: "template-slip",
        title: "Merancang template slip gaji",
        summary: "Menyusun tata letak slip dari blok, dan mencetaknya sebagai PDF.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Slip gaji disusun dari blok berurutan, bukan kanvas bebas. Anda menentukan blok mana yang tampil, dalam urutan apa, dengan judul apa, dan kolom identitas mana yang dicetak. Karena blok mengalir mengikuti isinya, slip tetap rapi walau seorang karyawan punya baris tunjangan lebih banyak daripada yang lain.",
          },
          {
            type: "steps",
            items: [
              "Buka Slip Gaji, lalu tekan Template slip gaji di kanan atas.",
              "Tekan Template baru, atau pilih template yang ada untuk menyuntingnya.",
              "Isi identitas perusahaan pada bagian Identitas. Nilai ini yang tercetak di kop dokumen.",
              "Nyalakan atau matikan blok sesuai kebutuhan, lalu geser urutannya. Kosongkan kolom judul bila ingin memakai judul bawaan blok.",
              "Pilih kolom identitas karyawan yang perlu tampil, misalnya NIP, jabatan, status pajak, dan nomor rekening.",
              "Pratinjau di sebelah kanan memakai angka contoh dan ikut berubah seketika. Simpan bila sudah sesuai.",
              "Tandai satu template sebagai Utama. Template itu yang dipakai bila sebuah slip tidak menunjuk template tertentu.",
            ],
          },
          {
            type: "table",
            head: ["Blok", "Isinya"],
            rows: [
              ["Kop dokumen", "Nama perusahaan, alamat, judul dokumen, dan periode."],
              ["Identitas karyawan", "Kolom yang Anda pilih, disusun satu atau dua kolom."],
              ["Rincian penghasilan", "Gaji pokok, tunjangan, dan lembur."],
              ["Rincian potongan", "Keterlambatan, alpha, BPJS, dan PPh 21."],
              ["Gaji bersih", "Nominal diterima, dengan pilihan menampilkan terbilang."],
              ["Ringkasan kehadiran", "Hari kerja, hadir, keterlambatan, dan alpha."],
              ["Catatan kaki", "Teks bebas, misalnya ketentuan pengajuan keberatan."],
              ["Kolom tanda tangan", "Satu atau dua kolom tanda tangan."],
            ],
          },
          {
            type: "p",
            text:
              "Untuk mencetak, tekan Cetak pada baris slip di daftar. Halaman dokumen terbuka lalu memanggil dialog cetak peramban. Pilih tujuan Save as PDF untuk menyimpannya sebagai berkas, dan aktifkan opsi Background graphics agar warna serta garis tabel ikut tercetak.",
          },
          {
            type: "note",
            tone: "info",
            title: "Punya dokumen sendiri?",
            text:
              "Setel mode template menjadi Unggah bila perusahaan sudah memiliki format slip sendiri. Dengan mode itu Anda melampirkan berkas per periode alih-alih menyusunnya dari blok.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "rekrutmen",
    title: "Lowongan & Pelamar",
    sections: [
      {
        id: "buat-loker",
        title: "Memasang lowongan",
        summary: "Menyusun lowongan dan menerbitkannya ke halaman karier.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Lowongan berbeda dari jabatan. Jabatan adalah entri tetap pada struktur organisasi yang ditunjuk karyawan; lowongan terikat waktu dan boleh dibuka berkali-kali untuk jabatan yang sama. Karena itu membuka lowongan tidak menambah apa pun ke struktur organisasi.",
          },
          {
            type: "steps",
            items: [
              "Buka menu Lowongan Kerja, lalu tekan Buat lowongan.",
              "Langkah Detail: isi judul, jabatan, divisi, cabang, tipe kerja, penempatan, dan jumlah kebutuhan.",
              "Langkah Konten: tulis ringkasan, tanggung jawab, kualifikasi, dan benefit. Setiap poin ditulis satu baris.",
              "Langkah Proses: tentukan tahap seleksi. Minimal dua tahap, dan urutannya boleh berbeda antar lowongan.",
              "Simpan sebagai draf untuk ditinjau lebih dulu, atau langsung terbitkan.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Menampilkan rentang gaji",
            text:
              "Rentang gaji hanya tampil di halaman karier bila Tampilkan gaji dinyalakan. Bila dimatikan, nominalnya tetap tersimpan untuk keperluan internal tetapi tidak dipublikasikan.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Lowongan berpelamar tidak dapat dihapus",
            text:
              "Begitu ada satu pelamar masuk, lowongan hanya bisa ditutup atau diarsipkan. Menghapusnya akan memutus riwayat pelamar dari konteks lamarannya.",
          },
        ],
      },
      {
        id: "formulir-lamaran",
        title: "Mengatur formulir lamaran",
        summary: "Kolom yang diisi pelamar, jenis isian, pilihan jawaban, dan urutannya.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Setiap lowongan punya formulir lamarannya sendiri. Lowongan baru memakai formulir bawaan: nama, email, telepon, alamat asal, pendidikan terakhir, CV, portofolio, dokumen tambahan, tanggal bisa mulai bekerja, gaji yang diharapkan, dan surat lamaran singkat.",
          },
          {
            type: "steps",
            items: [
              "Buka Lowongan Kerja, pilih lowongannya, lalu tekan Atur formulir lamaran.",
              "Seret ikon titik enam di kiri kolom untuk mengubah urutan. Di ponsel, tahan lalu geser; dengan keyboard, fokus pada ikon lalu tekan panah atas/bawah.",
              "Hilangkan centang Tampil untuk menyembunyikan kolom yang tidak diperlukan lowongan ini.",
              "Tekan ikon pensil untuk mengubah label, jenis isian, bagian, teks contoh, petunjuk, dan apakah kolom itu wajib.",
              "Tekan Tambah pertanyaan untuk pertanyaan khusus, misalnya kesediaan ditempatkan di luar kota atau software yang dikuasai.",
              "Buka tab Pratinjau untuk melihat formulir seperti yang dilihat pelamar, lalu tekan Simpan formulir.",
            ],
          },
          {
            type: "table",
            head: ["Jenis isian", "Dipakai untuk"],
            rows: [
              ["Teks singkat / Paragraf", "Jawaban bebas satu baris atau panjang"],
              ["Email / Nomor telepon / Tautan", "Diperiksa formatnya sebelum terkirim"],
              ["Angka / Nominal rupiah", "Pengalaman dalam tahun, gaji yang diharapkan"],
              ["Tanggal", "Tanggal lahir, tanggal bisa mulai bekerja"],
              ["Pilihan (dropdown)", "Satu jawaban dari daftar panjang, bisa dicari"],
              ["Pilihan tunggal (tombol)", "Satu jawaban dari 2–5 pilihan yang terlihat semua"],
              ["Pilihan ganda", "Boleh memilih lebih dari satu"],
              ["Ya / tidak", "Pertanyaan tertutup"],
              ["Berkas atau tautan", "CV, sertifikat, portofolio. Atur jumlah lampiran maksimal dan apakah tautan diperbolehkan"],
              ["Alamat", "Jalan, kota, provinsi, dan kode pos dalam satu kolom"],
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Kolom sistem",
            text:
              "Kolom berlabel Kolom sistem dipakai saat pelamar dijadikan karyawan (alamat, tanggal lahir, jenis kelamin, CV, dan lainnya), jadi jenis isiannya tidak dapat diubah; labelnya tetap boleh diganti. Nama, email, dan telepon selalu ditanyakan dan selalu wajib.",
          },
          {
            type: "note",
            tone: "success",
            title: "Lamaran lama tidak ikut berubah",
            text:
              "Label dan jawaban disalin ke data pelamar saat lamaran dikirim. Mengganti nama pertanyaan atau menghapusnya kemudian tidak mengubah apa yang terlihat pada pelamar yang sudah masuk.",
          },
        ],
      },
      {
        id: "proses-pelamar",
        title: "Memproses pelamar",
        summary: "Daftar dan filter pelamar, detail, tahap seleksi, wawancara, penilaian, dan penolakan.",
        audience: ["HRD", "SUPERADMIN", "DIREKSI"],
        blocks: [
          {
            type: "p",
            text:
              "Ada dua cara melihat pelamar. Menu Pelamar menampilkan semua lamaran dari semua lowongan dalam satu daftar yang bisa disaring; papan pelamar pada tiap lowongan mengelompokkan pelamar lowongan itu menurut tahap seleksi. Keduanya membuka halaman detail yang sama.",
          },
          {
            type: "table",
            head: ["Filter di menu Pelamar", "Kegunaan"],
            rows: [
              ["Tab status", "Dalam proses, Lolos, Direkrut, Tidak lolos, masing-masing dengan jumlahnya"],
              ["Cari", "Nama, email, nomor telepon, kota, atau nomor referensi yang diterima pelamar"],
              ["Lowongan dan Tahap", "Mempersempit ke satu lowongan dan satu tahap seleksi"],
              ["Pendidikan, Sumber, Penilaian minimal", "Menyaring profil; sumber membedakan halaman karier, input manual, dan API"],
              ["Melamar sejak/sampai", "Rentang tanggal lamaran masuk"],
              ["Bisa mulai paling lambat", "Pelamar yang siap bekerja sebelum tanggal tertentu"],
              ["Hanya yang melampirkan CV / Ada jadwal wawancara", "Penyaring cepat"],
              ["Urutkan", "Terbaru, penilaian tertinggi, paling cepat bisa mulai, wawancara terdekat, dan lainnya"],
            ],
          },
          {
            type: "p",
            text:
              "Filter tersimpan pada alamat halaman, sehingga daftar yang sudah disaring bisa dibagikan ke rekan atau disimpan sebagai bookmark, dan tetap sama ketika Anda kembali dari halaman detail.",
          },
          {
            type: "steps",
            items: [
              "Buka pelamar untuk membaca seluruh jawaban formulirnya. Berkas dibuka lewat tautan aman yang berlaku 15 menit; tautan yang ditempel pelamar dibuka apa adanya.",
              "Tekan Lanjut ke [tahap] untuk memindahkan ke tahap berikutnya, atau tekan salah satu kotak tahap untuk melompat langsung.",
              "Tekan Jadwalkan wawancara, isi tanggal, jam, tempat atau tautan rapat, dan pewawancara. Pewawancara menerima notifikasi berisi tautan ke pelamar, lalu pengingat sehari sebelumnya.",
              "Beri bintang 1–5 dan label (misalnya kandidat-kuat atau cadangan) agar tim mudah membandingkan. Tekan bintang yang sama sekali lagi untuk menghapus penilaian.",
              "Tulis catatan hasil wawancara pada kotak Catatan. Semua tindakan tercatat pada Riwayat beserta nama pelakunya.",
              "Tekan Tidak lolos dan tulis alasannya bila pelamar tidak dilanjutkan. Pelamar tersebut bisa dibuka kembali kapan saja.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Pelamar yang pernah melamar",
            text:
              "Panel Lamaran lain orang ini menampilkan lamaran lain dengan email atau nomor telepon yang sama, termasuk hasilnya, sehingga Anda tahu bila seseorang pernah ditolak atau sedang diproses di lowongan lain.",
          },
          {
            type: "note",
            tone: "info",
            title: "Alasan penolakan tidak terkirim otomatis",
            text:
              "Alasan yang Anda tulis tersimpan sebagai catatan internal. Kabar kepada pelamar tetap dikirim manual agar redaksinya dapat disesuaikan; tombol WhatsApp di halaman detail membuka percakapan dengan nomornya.",
          },
          {
            type: "p",
            text:
              "Untuk pelamar dari jalur lain (referensi karyawan, walk-in, job fair), tekan Tambah pelamar. Formulirnya sama dengan formulir lowongan di halaman karier, tetapi hanya nama, email, dan telepon yang wajib.",
          },
        ],
      },
      {
        id: "rekrut-karyawan",
        title: "Merekrut pelamar menjadi karyawan",
        summary: "Apa yang dibuat otomatis, apa yang harus dilengkapi HRD, dan tanda Baru.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Pindahkan pelamar ke tahap terakhir, lalu tekan Terima jadi karyawan.",
              "Isi email kantor, cabang, divisi, jabatan, dan status kepegawaian. Tanggal mulai kerja terisi dari jawaban Bisa mulai bekerja dan boleh diubah.",
              "Pilih peran akun bila karyawan langsung perlu login; kata sandi awalnya ditampilkan setelah disimpan. Kosongkan bila akun dibuat belakangan.",
              "Tekan Buat karyawan.",
            ],
          },
          {
            type: "table",
            head: ["Disalin dari lamaran", "Harus dilengkapi HRD"],
            rows: [
              ["Nama, email pribadi, telepon", "NIK"],
              ["Alamat asal (jadi alamat KTP)", "Tempat lahir, agama, status pernikahan"],
              ["Tanggal lahir, jenis kelamin (bila ditanyakan)", "Alamat domisili"],
              ["CV, portofolio, dan lampiran (masuk ke dokumen karyawan)", "Rekening bank, NPWP, BPJS, kontrak kerja"],
            ],
          },
          {
            type: "p",
            text:
              "Karyawan hasil rekrutmen ditandai Baru di Data Karyawan, lengkap dengan jumlah data yang belum diisi. Tab Baru, perlu dilengkapi menampilkan hanya mereka. Buka datanya untuk melihat daftar yang kosong; tanda Baru hilang dengan sendirinya begitu semua data wajib terisi dan disimpan. Bila memang ada data yang sengaja dikosongkan, tekan Tandai sudah lengkap.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Kuota lowongan",
            text:
              "Begitu jumlah pelamar yang direkrut mencapai jumlah kebutuhan lowongan, lowongan otomatis ditutup dari halaman karier. Naikkan jumlah kebutuhan lalu buka kembali bila masih ingin menerima lamaran.",
          },
          {
            type: "note",
            tone: "info",
            title: "Pengingat",
            text:
              "HRD menerima notifikasi saat karyawan dibuat, dan setiap Senin pengingat berisi jumlah karyawan baru yang datanya belum lengkap lebih dari tiga hari.",
          },
        ],
      },
      {
        id: "halaman-karier",
        title: "Halaman karier dan alur melamar",
        summary: "Apa yang dilihat pelamar dan bagaimana lamaran masuk.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Halaman karier di alamat /career memuat seluruh lowongan berstatus terbuka yang belum melewati tanggal tutup. Pelamar dapat menyaring menurut divisi, tipe kerja, dan penempatan, lalu membuka detail lowongan lewat alamat yang memakai slug, bukan ID.",
          },
          {
            type: "list",
            items: [
              "Pelamar mengisi formulir lowongan tersebut. Semua kesalahan ditampilkan sekaligus di samping kolomnya sebelum lamaran terkirim.",
              "Berkas diunggah saat dipilih, dengan indikator progres, lalu diperiksa isinya (bukan hanya nama berkasnya): PDF, JPG, PNG, WebP, atau DOCX, maksimal 8 MB. Pelamar juga boleh menempel tautan, misalnya Google Drive, bila kolomnya mengizinkan.",
              "Setelah terkirim, pelamar menerima nomor referensi. HRD bisa mencari pelamar dengan nomor ini.",
              "Satu email hanya tercatat sekali per lowongan. Lamaran ganda dijawab dengan pesan yang sama seperti lamaran baru, sehingga halaman ini tidak bisa dipakai untuk menebak siapa yang sudah melamar.",
              "Lamaran langsung muncul di tahap pertama, dan HRD menerima notifikasi berisi tautan ke pelamar.",
              "Berkas yang diunggah tetapi tidak jadi dikirim dihapus otomatis oleh tugas harian.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Siapa yang bisa membuka berkas pelamar",
            text:
              "CV dan dokumen pelamar hanya bisa dibuka akun yang memiliki izin membaca modul Rekrutmen. Peran lain yang biasanya punya akses luas, seperti GA atau Audit, tidak otomatis dapat membukanya. Setiap pembukaan detail pelamar tercatat di Jejak Audit.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "kontrak",
    title: "Kontrak Kerja",
    sections: [
      {
        id: "kontrak-kelola",
        title: "Mengelola kontrak karyawan",
        summary: "Jenis kontrak, kontrak yang akan berakhir, perpanjangan, dokumen, dan berkas bertanda tangan.",
        audience: ["HRD", "SUPERADMIN", "AUDIT", "DIREKSI"],
        blocks: [
          {
            type: "table",
            head: ["Jenis", "Tanggal berakhir", "Keterangan"],
            rows: [
              ["PKWT", "Ada", "Karyawan kontrak"],
              ["PKWTT", "Tidak ada", "Karyawan tetap; tidak masuk daftar kontrak yang akan habis"],
              ["Masa percobaan, Magang, Harian lepas, Paruh waktu, Outsource", "Ada", "Status kepegawaian ikut jenis kontrak saat berlaku"],
              ["Lainnya", "Ada", "Tuliskan nama jenisnya sendiri"],
            ],
          },
          {
            type: "steps",
            items: [
              "Buka Kontrak Kerja → Buat kontrak. Pilih karyawan, jenis, tanggal mulai dan berakhir (tombol 3/6/12 bulan membantu), gaji pokok, tunjangan tetap, dan template dokumen.",
              "Simpan sebagai draf bila masih ditinjau, atau langsung berlakukan. Gaji pokok kontrak yang berlaku dipakai payroll.",
              "Buka kontrak lalu Cetak / simpan PDF untuk mencetak dokumen dari template, tanda tangani, kemudian Unggah kontrak bertanda tangan. Kontrak yang sudah jadi di luar sistem bisa langsung diunggah tanpa template.",
            ],
          },
          {
            type: "p",
            text:
              "Tab Perlu keputusan berisi kontrak yang berakhir dalam rentang waktu pilihan Anda (bawaan 60 hari) dan kontrak yang sudah lewat tetapi belum diputuskan. Buka kontraknya lalu pilih tindak lanjut:",
          },
          {
            type: "table",
            head: ["Tindakan", "Yang terjadi"],
            rows: [
              ["Perpanjang", "Formulir kontrak baru terisi otomatis: mulai sehari setelah kontrak lama berakhir, lama dan gaji sama. Ubah bila ada kesepakatan baru, lalu simpan."],
              ["Angkat karyawan tetap", "Formulir kontrak PKWTT tanpa tanggal berakhir."],
              ["Tidak diperpanjang", "Catat alasannya. Pilih Nonaktifkan karyawan setelah kontrak berakhir agar status karyawan menjadi resign dan akun login ditutup otomatis pada tanggal itu."],
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Pengingat otomatis",
            text:
              "Karyawan, atasan, dan HRD menerima pengingat 30, 14, dan 7 hari sebelum kontrak berakhir selama belum diputuskan. Kontrak yang melewati tanggal berakhir ditandai Berakhir oleh tugas harian.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Kontrak bertanda tangan terkunci",
            text:
              "Setelah berkas bertanda tangan diunggah, tanggal dan gaji kontrak tidak bisa diubah. Buat kontrak baru, atau lepaskan dulu berkasnya bila memang salah unggah. Kontrak yang pernah berlaku tidak dihapus; gunakan Akhiri lebih awal.",
          },
          {
            type: "p",
            text:
              "Tab Template dokumen berisi template kontrak. Tulis isinya dengan format sederhana (# judul, ## pasal, - poin, 1. nomor, **tebal**) dan sisipkan isian seperti nama, jabatan, tanggal, dan gaji dengan menekan tombolnya. Atur logo, nama dan jabatan penandatangan, serta kota; lihat hasilnya di tab Pratinjau dengan contoh data. Mengubah template tidak mengubah kontrak yang sudah dibuat.",
          },
        ],
      },
      {
        id: "kontrak-saya",
        title: "Melihat kontrak kerja Anda",
        summary: "Masa berlaku kontrak dan salinan yang sudah ditandatangani.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Buka Profil & Keamanan → tab Kontrak Kerja. Setiap kontrak menampilkan jenis, nomor, masa berlakunya, dan tanda bila akan berakhir dalam 60 hari. Tekan Kontrak bertanda tangan untuk membuka salinan yang diunggah HRD, atau Lihat dokumen kontrak bila salinannya belum diunggah.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "kpi",
    title: "KPI & Kinerja",
    sections: [
      {
        id: "template-kpi",
        title: "Menyusun template penilaian",
        summary: "Aspek, indikator, bobot, skala nilai, dan ambang predikat.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Template menentukan bentuk formulir penilaian. Indikator tidak berdiri sendiri melainkan bersarang di dalam aspek, sama seperti formulir penilaian yang ditulis manual: satu aspek Kualitas Kerja berbobot 40% yang memuat beberapa indikator di dalamnya.",
          },
          {
            type: "steps",
            items: [
              "Buka KPI & Kinerja, pilih tab Template, lalu tekan Baru.",
              "Isi nama template, periode penilaian, dan skala nilai yang dilihat penilai.",
              "Tambahkan aspek beserta bobotnya. Total bobot seluruh aspek harus 100%.",
              "Di dalam tiap aspek, tambahkan indikator beserta bobot dan targetnya. Total bobot indikator dalam satu aspek juga harus 100%.",
              "Atur ambang predikat bila ingin berbeda dari bawaan, lalu simpan.",
            ],
          },
          {
            type: "table",
            head: ["Pengaturan", "Pengaruhnya"],
            rows: [
              ["Periode penilaian", "Menentukan format periode: bulanan menulis 2026-09, triwulanan menulis 2026-Q3, tahunan menulis 2026."],
              ["Skala nilai", "Bentuk input yang dilihat penilai. Nilai selalu disimpan sebagai 0-100, apa pun skalanya."],
              ["Bobot aspek", "Porsi aspek tersebut terhadap nilai akhir."],
              ["Bobot indikator", "Porsi indikator di dalam aspeknya, bukan terhadap nilai akhir."],
              ["Predikat", "Ambang bawah tiap label, misalnya 90 untuk Sangat Baik."],
              ["Penilaian mandiri", "Memberi karyawan kolom nilai sendiri sebelum atasan menilai."],
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Menyunting template tidak mengubah penilaian lama",
            text:
              "Setiap penilaian menyimpan salinan bentuk template saat penilaian itu dibuat. Anda bebas merombak template untuk siklus berikutnya tanpa mengubah appraisal yang sudah ditandatangani.",
          },
          {
            type: "note",
            tone: "warning",
            title: "Template terpakai tidak dapat dihapus",
            text:
              "Template yang sudah dipakai menilai hanya bisa dinonaktifkan. Template nonaktif tidak muncul lagi saat membuat penilaian baru, tetapi penilaian lama tetap terbaca.",
          },
        ],
      },
      {
        id: "menilai",
        title: "Menilai karyawan",
        summary: "Mengisi formulir, mengirim, dan memfinalkan penilaian.",
        audience: ["SPV", "HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka KPI & Kinerja, pilih tab Penilaian, lalu tekan Buat penilaian.",
              "Pilih karyawan dan template. Formulirnya muncul lengkap dengan indikator dan bobotnya.",
              "Periode terisi otomatis mengikuti irama template, dan tetap dapat Anda ubah.",
              "Beri nilai tiap indikator. Nilai sementara di bagian atas ikut berubah setiap kali Anda menilai.",
              "Isi kekuatan, hal yang perlu ditingkatkan, rencana pengembangan, dan rekomendasi.",
              "Simpan sebagai draf bila belum selesai, atau Kirim ke karyawan bila sudah.",
            ],
          },
          {
            type: "table",
            head: ["Status", "Artinya"],
            rows: [
              ["Draf", "Masih Anda kerjakan. Belum terlihat oleh karyawan."],
              ["Menunggu tanggapan", "Sudah dikirim. Karyawan dapat membaca dan menanggapinya."],
              ["Sudah ditanggapi", "Karyawan sudah membaca dan, bila mau, meninggalkan komentar."],
              ["Final", "Dikunci HRD. Tidak dapat disunting lagi dan dapat diunduh karyawan."],
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Menarik kembali penilaian",
            text:
              "Tombol Tarik mengembalikan penilaian ke draf, tetapi hanya selama karyawan belum menanggapinya. Setelah ditanggapi, perbaikan dilakukan dengan penilaian baru agar riwayatnya tetap utuh.",
          },
          {
            type: "p",
            text:
              "Tekan Cetak untuk membuka formulir penilaian dalam bentuk dokumen. Halaman itu memanggil dialog cetak peramban; pilih tujuan Save as PDF untuk menyimpannya.",
          },
          {
            type: "note",
            tone: "info",
            title: "Memakai formulir penilaian sendiri",
            text:
              "Bila perusahaan menilai dengan formulir sendiri, tekan Unggah PDF di tab Penilaian. Pilih karyawan, periode, dan berkasnya; nilai akhir dan predikat boleh diisi agar ikut masuk ringkasan. Penilaian unggahan mengikuti alur yang sama: dibagikan ke karyawan, ditanggapi, lalu difinalkan.",
          },
        ],
      },
      {
        id: "tanggapi-kpi",
        title: "Menanggapi penilaian Anda",
        summary: "Membaca hasil penilaian dan memberi tanggapan.",
        audience: ["STAFF", "SPV"],
        blocks: [
          {
            type: "p",
            text:
              "Penilaian yang sudah dikirim atasan muncul di menu Penilaian Kinerja pada portal. Anda melihat nilai tiap indikator beserta bobotnya, nilai akhir, predikat, dan catatan atasan. Penilaian yang masih berstatus draf tidak pernah terlihat.",
          },
          {
            type: "steps",
            items: [
              "Buka Penilaian Kinerja, lalu pilih periode yang ingin dibaca.",
              "Telusuri nilai per aspek dan catatan pada tiap indikator.",
              "Tekan Tanggapi. Anda boleh menuliskan komentar, boleh juga mengosongkannya.",
              "Setelah HRD memfinalkan, dokumen penilaian dapat Anda unduh kapan saja.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Menanggapi bukan berarti menyetujui",
            text:
              "Tanggapan menandakan Anda sudah membaca hasil penilaian. Bila ada yang keliru, tuliskan pada kolom komentar; catatan itu ikut tercetak pada dokumen penilaian.",
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "admin",
    title: "Administrasi Sistem",
    sections: [
      {
        id: "pengaturan",
        title: "Mengubah aturan bisnis",
        summary: "Semua tolok ukur sistem dan cara mengubahnya tanpa deploy ulang.",
        audience: ["SUPERADMIN", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Menu Pengaturan Sistem mengelompokkan seluruh aturan bisnis ke dalam beberapa bagian. Nilai yang Anda ubah ditandai, dan tombol simpan hanya mengirim kunci yang benar-benar berubah sehingga dua administrator dapat bekerja di bagian berbeda tanpa saling menimpa.",
          },
          {
            type: "table",
            head: ["Bagian", "Contoh yang diatur"],
            rows: [
              ["Identitas Perusahaan", "Nama dan alamat yang tercetak di slip gaji serta email"],
              ["Presensi", "Toleransi telat, radius default, wajib selfie, kuota koreksi absen"],
              ["Izin & Cuti", "Mode perhitungan hari, ambang wajib bukti, izin pembatalan mandiri"],
              ["Tukar Libur & Lembur", "Batas H-, setengah hari, bentrok divisi, lembur otomatis"],
              ["Payroll", "Tarif potongan telat, upah lembur, persentase BPJS dan PPh 21"],
              ["Keamanan", "Panjang minimal kata sandi, batas percobaan login, durasi kunci akun"],
              ["Tab Kata Sandi Awal", "Kata sandi awal akun baru per peran: tetap atau acak per akun"],
              ["Notifikasi", "Menyalakan atau mematikan kanal email, WhatsApp, dan notifikasi aplikasi"],
            ],
          },
          {
            type: "note",
            tone: "success",
            title: "Berlaku seketika",
            text:
              "Perubahan pengaturan langsung dipakai pada permintaan berikutnya. Tidak perlu restart server maupun deploy ulang.",
          },
        ],
      },
      {
        id: "kata-sandi-awal",
        title: "Kata sandi awal akun baru",
        summary: "Mengatur kata sandi awal per peran, selain Superadmin.",
        audience: ["SUPERADMIN", "HRD"],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka Pengaturan & Peran → tab Kata Sandi Awal.",
              "Untuk setiap peran pilih Kata sandi tetap (sama untuk semua akun baru peran itu) atau Acak per akun.",
              "Untuk kata sandi tetap, ketik sendiri atau tekan ikon acak. Kata sandi harus memenuhi aturan panjang dan memuat huruf besar, huruf kecil, serta angka.",
              "Tekan Simpan. Berlaku untuk akun yang dibuat sesudahnya, termasuk saat pelamar diterima menjadi karyawan.",
            ],
          },
          {
            type: "note",
            tone: "warning",
            title: "Pilih acak per akun bila memungkinkan",
            text:
              "Kata sandi tetap diketahui siapa pun yang pernah menerimanya, sehingga akun baru rawan dibuka orang lain sebelum pemiliknya login. Pastikan Wajib ganti password saat login pertama tetap menyala. Akun Superadmin baru selalu mendapat kata sandi acak.",
          },
        ],
      },
      {
        id: "peran",
        title: "Peran dan hak akses",
        summary: "Menyusun matriks modul × aksi × lingkup untuk setiap peran.",
        audience: ["SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Hak akses disusun sebagai matriks. Untuk setiap modul Anda mencentang aksi yang boleh dilakukan, lalu memilih lingkup data yang boleh dilihat.",
          },
          {
            type: "table",
            head: ["Lingkup", "Data yang terlihat"],
            rows: [
              ["Data sendiri", "Hanya catatan milik pengguna itu sendiri"],
              ["Satu divisi", "Seluruh karyawan pada divisi yang sama"],
              ["Satu cabang", "Seluruh karyawan pada cabang penempatan yang sama"],
              ["Seluruh perusahaan", "Semua data tanpa batas"],
            ],
          },
          {
            type: "list",
            items: [
              "Modul tanpa satu pun centang berarti peran tersebut tidak memiliki akses ke modul itu.",
              "Peran SUPERADMIN tidak dapat dibatasi karena melewati tabel hak akses. Buat peran baru bila Anda memerlukan administrator dengan akses terbatas.",
              "Peran STAFF wajib tetap dapat membaca presensi dan cuti miliknya sendiri.",
              "Peran yang masih dipakai akun tidak dapat dihapus; pindahkan akunnya terlebih dahulu.",
            ],
          },
          {
            type: "note",
            tone: "warning",
            title: "Nama modul menentukan pemeriksaan di server",
            text:
              "Setiap permintaan API memeriksa kombinasi modul dan aksi ini di basis data. Menyembunyikan menu saja tidak cukup — izin yang benar di sinilah yang menjadi penjaga sesungguhnya.",
          },
        ],
      },
      {
        id: "hari-libur",
        title: "Hari libur nasional",
        summary: "Mengapa kalender ini harus diisi dan beda kedua jenisnya.",
        audience: ["SUPERADMIN", "HRD"],
        blocks: [
          {
            type: "p",
            text:
              "Kalender hari libur memengaruhi tiga hal sekaligus: perhitungan hari cuti, daftar tanggal yang boleh ditukar libur, dan jumlah hari kerja yang dipakai payroll untuk menghitung alpha. Mengisi kalender di awal tahun adalah langkah persiapan yang paling penting.",
          },
          {
            type: "table",
            head: ["Jenis", "Memotong saldo cuti?", "Bisa ditukar libur?"],
            rows: [
              ["Libur nasional", "Tidak", "Ya"],
              ["Cuti bersama", "Ya", "Tidak"],
            ],
          },
        ],
      },
      {
        id: "karyawan",
        title: "Mengelola data karyawan",
        summary: "Menambah karyawan, data sensitif, dan menonaktifkan akun.",
        audience: ["HRD", "SUPERADMIN"],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka Data Karyawan lalu tambah karyawan baru. NIP dibuat otomatis dengan format EMP-TAHUN-NOMOR.",
              "Isi data diri, penempatan cabang dan divisi, lalu pilih peran akun agar login otomatis dibuat.",
              "Kata sandi awal ditampilkan sekali di layar setelah disimpan, sesuai pengaturan Kata Sandi Awal untuk peran yang dipilih. Sampaikan secara pribadi; karyawan wajib menggantinya saat login pertama.",
              "Setelah karyawan aktif, ia dapat melengkapi sendiri data kontak, alamat domisili, dan media sosialnya.",
            ],
          },
          {
            type: "note",
            tone: "danger",
            title: "Data sensitif terenkripsi",
            text:
              "NIK, NPWP, dan nomor rekening disimpan terenkripsi. Hanya peran dengan lingkup seluruh perusahaan yang melihat nilai aslinya; peran lain melihat versi tersamar. Log audit pun menyimpan penanda, bukan nilainya.",
          },
          {
            type: "note",
            tone: "info",
            title: "Karyawan tidak dihapus, tetapi dinonaktifkan",
            text:
              "Menghapus baris karyawan akan memutus riwayat presensi, payroll, dan audit yang mengacu padanya. Karena itu tombol hapus mengubah status menjadi resign dan menutup akses login, sementara seluruh riwayat tetap tersimpan.",
          },
        ],
      },
      {
        id: "laporan",
        title: "Mengekspor laporan",
        summary: "Mengunduh data dari menu Ekspor & Impor atau lewat URL.",
        audience: ["HRD", "AUDIT", "DIREKSI", "SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Cara termudah: menu Ekspor & Impor (lihat bagian Ekspor data). Laporan juga dapat diunduh langsung lewat URL sebagai Excel (.xlsx) atau CSV. Setiap ekspor tercatat di log audit lengkap dengan siapa yang mengunduh, kapan, dan berapa baris.",
          },
          {
            type: "code",
            text: "/api/v1/reports/export?dataset=attendance&period=2026-07&format=xlsx",
          },
          {
            type: "list",
            items: [
              "dataset: employees, attendance, attendance_daily, corrections, leave, payroll, kpi, contracts, inventory, atau candidates",
              "period: bulan YYYY-MM (presensi, koreksi, cuti, payroll); date: YYYY-MM-DD untuk attendance_daily; format: xlsx atau csv",
              "Peran Anda harus memiliki aksi Ekspor pada modul terkait.",
            ],
          },
        ],
      },
      {
        id: "audit",
        title: "Log audit",
        summary: "Apa saja yang dicatat dan bagaimana membacanya.",
        audience: ["AUDIT", "SUPERADMIN", "DIREKSI"],
        blocks: [
          {
            type: "p",
            text:
              "Sistem mencatat aktivitas yang berkonsekuensi: login dan penguncian akun, perubahan data karyawan, seluruh keputusan persetujuan, pembuatan slip gaji, pembukaan dokumen sensitif, perubahan pengaturan, dan perubahan hak akses.",
          },
          {
            type: "list",
            items: [
              "Setiap entri menyimpan siapa, aksi apa, modul, nilai sebelum dan sesudah, alamat IP, perangkat, dan waktu.",
              "Pengaduan anonim dicatat tanpa identitas pelapor, agar log audit sendiri tidak membocorkan anonimitas.",
              "Nilai terenkripsi ditampilkan sebagai penanda, bukan nilai aslinya.",
            ],
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "pengaduan",
    title: "Pengaduan",
    sections: [
      {
        id: "cara-mengadu",
        title: "Menyampaikan pengaduan",
        summary: "Alur pelaporan dan cara kerja opsi anonim.",
        audience: [],
        blocks: [
          {
            type: "steps",
            items: [
              "Buka menu Pengaduan, lalu tekan Buat pengaduan.",
              "Pilih tujuan laporan: atasan langsung, HRD, atau Direksi untuk kasus sensitif.",
              "Pilih kategori, tulis judul singkat, lalu uraikan kejadian minimal 30 karakter.",
              "Lampirkan bukti bila ada (unggah foto, tangkapan layar, PDF, atau tempel tautan), aktifkan opsi anonim bila diperlukan, lalu kirim.",
              "Catat nomor tiket yang muncul. Anda dapat memantau perkembangannya di halaman yang sama.",
            ],
          },
          {
            type: "note",
            tone: "info",
            title: "Bagaimana anonim bekerja",
            text:
              "Pengaduan anonim tidak menampilkan identitas Anda kepada atasan. Identitas tetap tersimpan terbatas untuk HRD dan Audit agar laporan dapat dipertanggungjawabkan dan agar Anda tetap dapat memantau tindak lanjutnya serta menerima notifikasi.",
          },
        ],
      },
      {
        id: "menangani",
        title: "Menangani pengaduan",
        summary: "Kewajiban penangan laporan.",
        audience: ["SPV", "HRD", "DIREKSI", "AUDIT", "SUPERADMIN"],
        blocks: [
          {
            type: "list",
            items: [
              "Perbarui status agar pelapor tahu laporannya berjalan: Diterima → Diproses → Selesai atau Ditolak.",
              "Tanggapan biasa akan terbaca pelapor beserta notifikasinya.",
              "Catatan internal hanya terlihat oleh sesama penangan dan tidak dikirim ke pelapor.",
              "Identitas pelapor anonim tidak boleh diungkap kepada terlapor dalam keadaan apa pun.",
            ],
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: "teknis",
    title: "Catatan Teknis",
    sections: [
      {
        id: "instalasi",
        title: "Menjalankan sistem",
        summary: "Instalasi produksi dengan installer, dan perintah untuk pengembangan.",
        audience: ["SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text: "Produksi: buka dokumentasi instalasi di website lisensi dan pilih Windows, macOS, atau Linux. Gunakan alamat resmi yang sudah dikonfigurasi, bukan placeholder. Windows memakai PowerShell langsung dengan Docker Desktop; macOS memakai Terminal dan Docker Desktop; Linux memakai Docker Engine dan Compose. Installer membuat .env dengan kunci acak, menyiapkan PostgreSQL 18, dan menampilkan akun Superadmin satu kali. Simpan akun dan cadangan .env. Update Community melalui installer di folder yang sama; update Pro melalui Lisensi & Paket. Perintah berikut hanya untuk pengembang yang memiliki source code, bukan langkah instalasi pelanggan:",
          },
          {
            type: "code",
            text:
              "npm install\nnpm run seed      # mengisi peran, hak akses, pengaturan, dan hari libur\nnpm run dev       # mode pengembangan\nnpm run build     # build produksi\nnpm start         # menjalankan hasil build",
          },
          {
            type: "note",
            tone: "warning",
            title: "Variabel wajib",
            text:
              "Isi HRIS_DB_HOST, HRIS_DB_PORT, HRIS_DB_NAME, HRIS_DB_USER, HRIS_DB_PASSWORD (atau HRIS_DATABASE_URL) untuk PostgreSQL. Jalankan migrasi skema sebelum aplikasi. Pertahankan NEXTAUTH_SECRET serta seluruh kunci enkripsi lama selama pemindahan data; jangan mengganti kunci bersamaan dengan migrasi database.",
          },
        ],
      },
      {
        id: "berkas",
        title: "Penyimpanan berkas",
        summary: "Di mana foto presensi dan slip gaji disimpan, dan siapa yang boleh membukanya.",
        audience: ["SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text:
              "Berkas disimpan di luar folder publik dan hanya dapat dibaca melalui satu pintu, yaitu rute unduhan terautentikasi. Rute tersebut memeriksa dua hal sekaligus: sesi yang sah (atau tautan bertanda tangan yang belum kedaluwarsa) dan kepemilikan berkas.",
          },
          {
            type: "list",
            items: [
              "Karyawan hanya dapat membuka berkas yang berada di foldernya sendiri.",
              "Tautan bertanda tangan berumur pendek, umumnya 15 menit.",
              "Pembukaan slip gaji dan dokumen karyawan dicatat di log audit.",
              "Mengganti STORAGE_PROVIDER memindahkan lokasi penyimpanan tanpa mengubah kode aplikasi.",
            ],
          },
          {
            type: "note",
            tone: "danger",
            title: "Bila Anda memutakhirkan dari versi lama",
            text:
              "Versi sebelumnya menyimpan berkas di public/uploads sehingga dapat diakses siapa pun yang menebak alamatnya. Pindahkan isi folder tersebut ke storage/uploads, lalu pastikan public/uploads sudah kosong.",
          },
        ],
      },
      {
        id: "api",
        title: "Antarmuka API",
        summary: "Format respons dan endpoint publik.",
        audience: ["SUPERADMIN"],
        blocks: [
          {
            type: "p",
            text: "Seluruh endpoint berada di bawah /api/v1 dan memakai format respons yang seragam.",
          },
          {
            type: "code",
            text:
              '{ "success": true, "data": {...}, "message": "...", "meta": { "page": 1, "limit": 25, "total": 120 } }\n\n{ "success": false, "error": { "code": "GEOFENCE_REJECTED", "message": "..." } }',
          },
          {
            type: "p",
            text:
              "Endpoint publik POST /api/v1/public/candidates menerima lamaran dari situs lain. Sertakan header x-api-key yang cocok dengan PUBLIC_API_KEY. Endpoint ini dibatasi lajunya per alamat IP dan dapat dilindungi Cloudflare Turnstile bila TURNSTILE_SECRET_KEY diisi.",
          },
        ],
      },
    ],
  },
];

/** Flat list used by the in-page search. */
export const ALL_SECTIONS = CHAPTERS.flatMap((c) =>
  c.sections.map((s) => ({ ...s, chapterId: c.id, chapterTitle: c.title }))
);

/**
 * The chapters a role may read. Superadmin reads everything and may preview
 * another role's view; every other role only receives the sections written for
 * it plus those for everyone. Filtering happens on the server, so procedures
 * for other roles never reach the reader's browser.
 */
export function chaptersForRole(role: string, preview?: string | null): DocChapter[] {
  const effective = role === "SUPERADMIN" ? preview || null : role;
  return CHAPTERS.map((c) => ({
    ...c,
    sections: c.sections.filter(
      (s) => !effective || s.audience.length === 0 || s.audience.includes(effective)
    ),
  })).filter((c) => c.sections.length > 0);
}
