# HRIS di Dokploy (Raw Compose)

Panduan langkah demi langkah ada di website lisensi: **Dokumentasi → Instalasi HRIS di Dokploy** (`/docs#dokploy`), termasuk YAML Compose dan contoh Environment yang sudah terisi. Ringkasan:

1. **Database**: Dokploy → Create Service → Database → PostgreSQL (`hris-db`, database `hris`, user `hris`). Catat *Internal Host* dari tab General.
2. **Layanan HRIS**: Create Service → Compose → Raw → tempel YAML dari `/docs#dokploy` (image `ghcr.io/lifistudio/hris:latest`, `pull_policy: always`, semua variabel opsional ikut diteruskan).
3. **Environment**: `HRIS_DATABASE_URL=postgresql://hris:PASSWORD@<internal-host>:5432/hris`, `NEXTAUTH_URL`, `TRUST_PROXY=1`, `HRIS_LICENSE_SERVER`, empat secret acak (`AUTH_SECRET`, `ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `CRON_SECRET`), SMTP. Semua variabel dijelaskan di `/docs#env-reference` dan [`.env.example`](../.env.example).
4. **Domain**: service `app`, port `3000`, HTTPS.
5. **Deploy**, lalu buat Superadmin dari terminal container `app`:
   ```sh
   SEED_ADMIN_EMAIL=admin@perusahaan.co.id SEED_ADMIN_PASSWORD='GantiSegera-2026!' node db-seed.cjs
   ```

## Database

- `HRIS_DATABASE_URL` selalu dipakai bila diisi.
- Saat start, aplikasi memeriksa struktur database dan **hanya menambahkan** yang kurang (tabel, kolom, indeks, aturan). Data tidak dihapus, sehingga database lama bisa langsung dipakai dan versi sebelumnya bisa dijalankan kembali.
- Memakai database lama: pakai `ENCRYPTION_KEY`, `AUTH_SECRET`, `STORAGE_SIGNING_SECRET` yang **sama** dengan instalasi lama; kunci baru membuat NIK/NPWP/rekening tidak terbaca (halaman Karyawan menampilkan peringatan, log `[CRYPTO] …`).
- Mengosongkan database uji/dummy dari terminal container `app`: `node db-setup.cjs --reset --confirm=NAMA_DATABASE`, lalu Redeploy dan seed lagi.

## Pro dan pembaruan

- Pro: Lisensi & Paket → tempel license key → fitur Pro langsung aktif. Lisensi berakhir → kembali ke Community otomatis, data tetap.
- Pembaruan: Lisensi & Paket → Versi & pembaruan → hubungkan Dokploy (alamat, API key dari Settings → Profile → API/CLI, Compose ID dari alamat halaman layanan). Tombol **Perbarui** mengganti `HRIS_IMAGE` ke versi baru dan Deploy; **Kembali ke versi sebelumnya** memakai versi lama. Tanpa API: biarkan `:latest` dan klik Redeploy.
- Jangan memilih opsi yang menghapus volume (`freshVolumes`) saat Redeploy; volume `hris_uploads` berisi lampiran.
