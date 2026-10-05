<div align="center">

<img src="public/brand/karyon-logo.webp" alt="Karyon" height="72" />

# Karyon HRIS

**HRIS self-hosted untuk perusahaan Indonesia.** Presensi foto dan GPS, cuti, payroll BPJS dan PPh 21, KPI, rekrutmen, dan inventaris, dijalankan di server milik perusahaan Anda sendiri.

[Website](https://karyon.lifistudio.com/) · [Dokumentasi](https://karyon.lifistudio.com/docs) · [Fitur](https://karyon.lifistudio.com/features) · [Harga](https://karyon.lifistudio.com/pricing) · [Blog](https://karyon.lifistudio.com/blog)

</div>

---

## Kenapa Karyon HRIS

- **Data tetap di server Anda.** Database, lampiran, dan kunci enkripsi tidak pernah dikirim ke server kami. Server lisensi hanya menerima identitas instalasi, alamat website, dan status langganan.
- **Gratis untuk mulai.** Edisi Community gratis selamanya, tanpa batas jumlah karyawan.
- **Bayar per instalasi, bukan per karyawan.** Edisi Pro dibayar per alamat website HRIS, bulanan atau tahunan.
- **Upgrade tanpa instal ulang.** Tempel license key di aplikasi, jalankan satu perintah, dan fitur Pro aktif. Data, akun, dan kunci tidak berubah. Jika langganan berakhir, aplikasi kembali ke Community tanpa menghapus data.
- **Satu perintah untuk memasang.** Tidak perlu menyiapkan database sendiri: installer menyiapkan database, kunci keamanan acak, dan akun superadmin pertama.

## Fitur

| Fitur | Community | Pro |
| --- | :---: | :---: |
| Presensi foto, GPS, dan radius cabang | ✓ | ✓ |
| Monitor hadir, belum absen, alpha, dan notifikasi | ✓ | ✓ |
| Cuti, izin, jadwal, shift, dan tukar libur | ✓ | ✓ |
| Payroll dasar, BPJS, PPh 21, dan slip gaji | ✓ | ✓ |
| KPI, kontrak, rekrutmen (pipeline drag & drop), inventaris (scan barcode lewat kamera) | ✓ | ✓ |
| Ekspor Excel/CSV dan impor CSV | ✓ | ✓ |
| Multi-cabang dan analitik lanjutan | | ✓ |
| Face recognition dengan anti-spoof | | ✓ |
| Payroll lanjutan dan simulator kebijakan | | ✓ |
| Workflow disiplin (SP, pembinaan, PHK) | | ✓ |
| REST API dengan API key dan webhook | | ✓ |
| Backup, update, dan rollback otomatis (agent, server Linux) | | ✓ |
| Logo perusahaan sendiri di dashboard, portal, dan halaman masuk | | ✓ |
| Dukungan | Komunitas & dokumentasi | Email hari kerja |

Daftar lengkap dan perbandingannya ada di [halaman fitur](https://karyon.lifistudio.com/features).

## Instalasi cepat

Prasyarat: Docker Engine 24+ atau Docker Desktop, Docker Compose 2.24+. Aplikasi hanya terikat ke `127.0.0.1` sampai Anda memasang reverse proxy HTTPS di depannya.

**Linux dan macOS**

```sh
curl -fsSL https://karyon.lifistudio.com/install.sh | sh
```

**Windows (PowerShell)**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod "https://karyon.lifistudio.com/install.ps1")))
```

Installer membuat folder `hris` berisi `.env` dengan kunci acak, menjalankan database bawaan dan aplikasi, lalu menampilkan password superadmin pertama **satu kali**. Buka `http://localhost:3000/auth/admin` dan segera ganti password tersebut. Anda **tidak perlu** menyiapkan PostgreSQL sebelum instalasi.

Untuk domain produksi:

```sh
curl -fsSL https://karyon.lifistudio.com/install.sh | sh -s -- --url https://hr.perusahaan.co.id --trust-proxy 1
```

Panduan per sistem operasi, database eksternal, Dokploy, dan pemecahan masalah ada di [dokumentasi instalasi](https://karyon.lifistudio.com/docs#install). Anda juga bisa membaca isi skrip sebelum menjalankannya: [install.sh](https://karyon.lifistudio.com/install.sh) · [install.ps1](https://karyon.lifistudio.com/install.ps1).

### Menjalankan ulang dan memperbarui

Menjalankan installer lagi di folder yang sama **tidak mengubah kunci di `.env`**. Installer hanya memperbarui file compose, menarik image terbaru, dan me-restart aplikasi.

### Memakai PostgreSQL sendiri (opsional)

Database bawaan sudah cukup untuk sebagian besar perusahaan. Bila ingin memakai PostgreSQL milik sendiri (misalnya layanan database terkelola), lakukan **setelah** instalasi:

1. Buat database kosong dan pengguna yang boleh membuat tabel di dalamnya.
2. Bila HRIS sudah berisi data, pindahkan dulu datanya: `docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris.dump`, lalu `pg_restore` ke database baru.
3. Isi `HRIS_DATABASE_URL=postgresql://PENGGUNA:PASSWORD@HOST:5432/NAMA_DB` di `.env` (password berkarakter khusus harus di-URL-encode). Untuk koneksi TLS isi juga `HRIS_DB_SSL=verify-full`.
4. Jalankan installer lagi di folder yang sama. Aplikasi memakai database baru dan database bawaan dihentikan. Tabel dibuat otomatis saat aplikasi start.

Database baru yang masih kosong tidak berisi akun. Buat superadmin dengan `docker compose exec -e SEED_ADMIN_EMAIL=email@perusahaan.co.id -e SEED_ADMIN_PASSWORD='password-minimal-12-karakter' app node db-seed.cjs`.

### Upgrade ke Pro

1. Beli lisensi di [halaman harga](https://karyon.lifistudio.com/pricing). License key muncul di dashboard pelanggan setelah pembayaran terkonfirmasi.
2. Di HRIS, masuk sebagai superadmin, buka **Lisensi & Paket**, tempel license key, lalu klik **Aktifkan**.
3. Klik **Aktifkan fitur Pro**. Halaman menampilkan progresnya; ada restart singkat, data dan akun tidak berubah.

Instalasi lama yang belum memiliki pengelola upgrade akan menampilkan **Perbarui installer sekali**: jalankan installer terbaru di folder instalasi, atau salin perintah upgrade yang ditampilkan (berlaku 15 menit). License key bisa diganti atau dilepas dari menu yang sama saat pindah server.

Opsi `--lifecycle` (Pro, khusus server Linux) menambahkan backup, update, dan rollback terjadwal. Opsi ini memerlukan akses penuh ke Docker di server, jadi mati secara default.

## Logo

Community dan Pro memakai logo Karyon bawaan dari `public/brand/`:

| File | Dipakai untuk |
| --- | --- |
| `karyon-logo.webp` | Logo tema terang (sidebar, halaman masuk, beranda) |
| `karyon-logo-dark.webp` | Logo tema gelap |
| `karyon-mark.webp` | Simbol untuk ruang sempit (karier, dokumentasi) |
| `karyon-icon.png`, `karyon-apple-icon.png`, `src/app/favicon.ico` | Favicon dan ikon aplikasi |

Ganti file-file tersebut (nama sama) untuk mengubah logo bawaan pada rilis berikutnya; Community tidak menyediakan pengaturan logo. Pada HRIS Pro dengan lisensi aktif, superadmin dapat mengunggah logo perusahaan di **Admin → Logo & Tampilan**. Bila lisensi berakhir, logo bawaan tampil kembali dan logo yang diunggah tetap tersimpan.

## Keamanan

- Database memakai role aplikasi yang **bukan superuser** dan tidak membuka port ke host.
- Data sensitif karyawan dienkripsi dengan `ENCRYPTION_KEY`. Simpan `.env` bersama backup database dan lampiran; backup tanpa kunci tidak bisa dipulihkan.
- `TRUST_PROXY` menentukan jumlah proxy tepercaya (1 untuk Traefik/nginx, 2 untuk Cloudflare → Traefik). IP klien untuk rate limit dan audit diambil dari entri `X-Forwarded-For` milik proxy tersebut.

Temukan celah keamanan? Laporkan secara privat melalui [halaman kontak](https://karyon.lifistudio.com/contact), jangan lewat issue publik.

## Backup dan pemulihan

```sh
docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris-$(date +%F).dump
```

Cadangkan juga `.env` dan volume `uploads`. Bila memakai PostgreSQL sendiri, gunakan fasilitas backup penyedia database tersebut. Gunakan tag atau digest image yang tetap, backup sebelum update, dan uji proses restore secara berkala. Rollback image tidak membatalkan perubahan schema database.

## Masalah umum

| Gejala | Penyebab umum | Yang perlu dilakukan |
| --- | --- | --- |
| `docker: command not found` / tidak tersambung ke Docker | Docker belum berjalan | Buka Docker Desktop (Windows/macOS) atau `sudo systemctl enable --now docker` (Linux), lalu jalankan installer lagi. |
| `port is already allocated` / `address already in use` | Port 3000 dipakai aplikasi lain | Lihat [Port bentrok saat instalasi](#port-bentrok-saat-instalasi). |
| `HRIS did not become healthy` | Aplikasi gagal start, biasanya database | Lihat `docker compose logs --tail 80 app`. Jika memakai `HRIS_DATABASE_URL`, pastikan host, password, dan izin pengguna database benar. |
| Halaman login terbuka tetapi selalu kembali ke login | `NEXTAUTH_URL` tidak sama dengan alamat yang dibuka | Samakan `NEXTAUTH_URL` dengan alamat di browser (termasuk `https`), lalu `docker compose up -d`. |
| Password superadmin awal hilang | Password hanya tampil sekali | Jalankan `docker compose exec -e SEED_ADMIN_EMAIL=email-baru@perusahaan.co.id -e SEED_ADMIN_PASSWORD='password-baru-panjang' app node db-seed.cjs` untuk membuat superadmin baru. |
| Email OTP/notifikasi tidak terkirim | SMTP/Resend belum diisi | Isi `EMAIL_PROVIDER` dan kredensial email di `.env`, lalu `docker compose up -d`. |
| Lisensi aktif tetapi fitur Pro belum muncul | Server tidak bisa menjangkau website lisensi, atau pembaruan belum selesai | Buka **Lisensi & Paket** → **Periksa ulang status**. Pastikan server bisa membuka `https://karyon.lifistudio.com`. |
| Data hilang setelah perintah tertentu | `docker compose down -v` menghapus volume | Jangan pernah memakai `-v`. Pulihkan dari backup. |

### Port bentrok saat instalasi

HRIS memakai port `3000` di mesin tempat installer dijalankan. Bila port itu sudah dipakai, installer berhenti dengan pesan `port is already allocated` atau `address already in use`. Data tidak rusak.

1. **Cari aplikasi yang memakai port.** Linux: `sudo ss -ltnp | grep :3000` · macOS: `lsof -nP -iTCP:3000 -sTCP:LISTEN` · Windows: `netstat -ano | findstr :3000`, lalu `Get-Process -Id NOMOR_PROSES` · Container: `docker ps --format "table {{.Names}}\t{{.Ports}}"`. Hentikan aplikasi itu bila boleh, atau pilih port lain untuk HRIS.
2. **Belum ada folder `hris`:** jalankan installer dengan port lain.
   ```sh
   curl -fsSL https://karyon.lifistudio.com/install.sh | sh -s -- --port 3080
   ```
   ```powershell
   & ([scriptblock]::Create((Invoke-RestMethod "https://karyon.lifistudio.com/install.ps1"))) -Port 3080
   ```
3. **Folder `hris` sudah terbuat (installer sempat gagal):** installer tidak mengubah port pada `.env` yang sudah ada. Ubah `APP_PORT=3080` di `.env`; bila `NEXTAUTH_URL` berisi `http://localhost:3000`, ganti juga ke `http://localhost:3080` (biarkan bila berisi domain). Lalu jalankan `docker compose up -d` di folder itu. Bila password superadmin awal belum tampil, jalankan installer sekali lagi di folder yang sama.
4. **Memakai reverse proxy:** arahkan proxy ke port baru; domain yang dibuka pengguna tetap sama.

**Port database 5432** tidak pernah bentrok karena database bawaan tidak membuka port ke host. Bila Anda sengaja membuka port database untuk aplikasi seperti TablePlus dan 5432 sudah terpakai, gunakan `127.0.0.1:5433:5432` lalu sambungkan ke port `5433`.

**Dua instalasi di satu server** wajib memakai folder, port, dan nama proyek yang berbeda; tanpa nama proyek berbeda, instalasi kedua mengambil alih container dan database instalasi pertama.

```sh
curl -fsSL https://karyon.lifistudio.com/install.sh | sh -s -- --dir ./hris-kantor2 --port 3081 --project-name hris-kantor2
```

PowerShell: tambahkan `-Dir .\hris-kantor2 -Port 3081 -ProjectName hris-kantor2`.

Pertanyaan lain: lihat [dokumentasi](https://karyon.lifistudio.com/docs#troubleshooting) atau hubungi kami lewat [halaman kontak](https://karyon.lifistudio.com/contact).

## Development

Prasyarat: Node.js 24 LTS, npm, dan PostgreSQL 18.

```sh
npm ci
node scripts/setup-env.mjs     # hanya bila .env belum ada
# Isi HRIS_DATABASE_URL (atau HRIS_DB_*) dan NEXTAUTH_URL di .env
npm run db:setup              # membuat seluruh tabel di database kosong (sekali langkah)
npm run seed
npm run dev
```

Database yang dibuat versi lain ditolak dengan pesan jelas; untuk database uji/dummy kosongkan dengan `npm run db:reset -- --confirm=<nama database>` lalu jalankan `db:setup` dan `seed` lagi. Semua gambar yang diunggah disimpan sebagai WebP.

Akun bootstrap memakai `SEED_ADMIN_EMAIL` di http://localhost:3000/auth/admin. Password berasal dari `.env`, dan seed tidak mereset akun yang sudah ada. Dataset demo 200 karyawan tersedia untuk pengujian: `npm run seed:demo:plan`, lalu `npm run seed:demo`.

### Docker dari source

```sh
node scripts/setup-env.mjs
docker compose up -d --build
docker compose exec app node db-seed.cjs
```

Compose membuat PostgreSQL 18 terpisah pada volume `postgres18_data`. Jangan menjalankan `docker compose down -v` kecuali memang ingin menghapus seluruh data dan lampiran. Instalasi lama dengan PostgreSQL 17 perlu dipindahkan manual (dump → database baru → restore).

### Pemeriksaan

```sh
npm run typecheck
npm run lint
npm run build
npm run test:postgres
npm run test:security
npm run test:barcode
```

### Struktur

| Folder | Isi |
| --- | --- |
| `src/` | Aplikasi Next.js (App Router): halaman admin, portal karyawan, dan API `/api/v1` |
| `packages/database` | Lapisan SQL milik aplikasi (model, schema, migrasi) |
| `scripts/` | Migrasi, seed, dan build |
| `install.sh`, `install.ps1`, `compose.*.yml` | Installer dan file compose yang disajikan website |
| `installer-manager/` | Sidecar kecil yang menukar kode upgrade Pro |
| `storage/` | Berkas privat saat development (tidak masuk Git) |

Setelah mengubah `install.sh`, `install.ps1`, atau file compose, jalankan `node scripts/sync-installer.mjs` di folder `website/` agar versi yang disajikan website ikut diperbarui.

## Deploy di Dokploy

Ikuti [panduan Dokploy Raw Compose](docs/DOKPLOY-RAW-COMPOSE.md) atau bagian [Instalasi Dokploy](https://karyon.lifistudio.com/docs#dokploy) di dokumentasi. Pasang domain ke service `app` port `3000`, aktifkan HTTPS, isi `NEXTAUTH_URL` sesuai domain, dan `TRUST_PROXY=1`.

## Kontribusi

Laporan bug dan usulan fitur dapat dikirim melalui GitHub Issues. Jangan sertakan `.env`, password, token, data karyawan, atau log yang belum disensor.

---

<div align="center">

[karyon.lifistudio.com](https://karyon.lifistudio.com/) · [Blog](https://karyon.lifistudio.com/blog) · [Kontak](https://karyon.lifistudio.com/contact)

</div>
