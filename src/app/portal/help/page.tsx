"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { BookOpen, CalendarDays, ChevronDown, Clock, CreditCard, ExternalLink, LifeBuoy, MessageSquareWarning, Package, Repeat, ShieldCheck, Target } from "@/components/icons";
import { Alert, Badge, Card, CardBody, CardHeader, cn } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/docs/roles";

/**
 * Role-aware quick help.
 *
 * Deliberately short: it answers the handful of questions that actually
 * generate HRD tickets and links to the full documentation for everything else,
 * rather than duplicating it and drifting out of date.
 */

interface Faq {
  q: string;
  a: string;
  roles?: string[];
}

const QUICK_LINKS = [
  {
    href: "/portal/attendance",
    icon: Clock,
    title: "Presensi Mandiri",
    body: "Absen masuk, istirahat, dan pulang. Juga tempat mengajukan koreksi absen.",
  },
  {
    href: "/portal/leave",
    icon: CalendarDays,
    title: "Izin & Cuti",
    body: "Lihat sisa saldo dan ajukan izin, cuti, atau WFH.",
  },
  {
    href: "/portal/holiday-swap",
    icon: Repeat,
    title: "Tukar Libur",
    body: "Tukar tanggal merah yang Anda masuki dengan hari libur pengganti.",
  },
  {
    href: "/portal/payroll",
    icon: CreditCard,
    title: "Slip Gaji Saya",
    body: "Rincian penghasilan dan potongan tiap periode, tersimpan permanen.",
  },
  {
    href: "/portal/kpi",
    icon: Target,
    title: "Penilaian Kinerja",
    body: "Hasil penilaian tiap periode, catatan atasan, dan kolom tanggapan Anda.",
  },
  {
    href: "/portal/inventory",
    icon: Package,
    title: "Inventaris Saya",
    body: "Aset perusahaan yang sedang Anda pegang beserta bukti serah terimanya.",
  },
  {
    href: "/portal/complaints",
    icon: MessageSquareWarning,
    title: "Pengaduan",
    body: "Sampaikan keluhan atau laporan, termasuk secara anonim.",
  },
];

const FAQS: Faq[] = [
  {
    q: "Absen saya ditolak karena di luar radius, padahal saya di kantor. Harus bagaimana?",
    a:
      "Pertama, tekan tombol perbarui lokasi dan perhatikan angka akurasi GPS. Bila di atas 100 meter, dekati jendela atau area terbuka lalu ulangi. Jika masih meleset, aktifkan tombol \"Saya mengalami kendala lokasi\" dan tulis alasannya secara jelas. Absen akan diterima dan ditandai untuk ditinjau HRD.",
  },
  {
    q: "Saya lupa absen kemarin. Apa yang harus saya lakukan?",
    a:
      "Buka Presensi Mandiri, pilih tab Koreksi Absen, lalu ajukan koreksi untuk tanggal tersebut. Isi jam yang seharusnya, pilih kategori alasan, dan jelaskan kronologinya. Pengajuan akan diteruskan ke atasan lalu HRD. Ingat, koreksi bukan pengganti absen hari berjalan.",
  },
  {
    q: "Kenapa cuti 3 hari saya hanya memotong 2 hari saldo?",
    a:
      "Pada mode perhitungan hari kerja, akhir pekan dan tanggal merah di dalam rentang pengajuan tidak memotong kuota. Kolom durasi pada riwayat pengajuan menampilkan jumlah hari kerja dan hari kalender secara terpisah agar selisihnya terlihat jelas.",
  },
  {
    q: "Pengajuan cuti saya masih menunggu. Kapan diproses?",
    a:
      "Pengajuan melewati beberapa tahap approver secara berurutan, umumnya atasan langsung lalu HRD. Anda akan menerima notifikasi pada setiap perkembangan. Selama belum ada approver yang bertindak, Anda masih dapat membatalkan pengajuan sendiri dan saldo akan dikembalikan.",
  },
  {
    q: "Saya masuk di tanggal merah tetapi hak libur pengganti saya hilang. Kenapa?",
    a:
      "Hak libur pengganti hanya berlaku bila Anda benar-benar tercatat absen masuk pada tanggal merah tersebut. Bila tidak ada catatan presensi hari itu, pengajuan otomatis ditandai gugur meskipun sebelumnya sudah disetujui.",
  },
  {
    q: "Angka di slip gaji saya terasa tidak sesuai. Ke mana saya mengadu?",
    a:
      "Buka Rincian pada slip yang bersangkutan untuk melihat komponen penghasilan, potongan, dan dasar kehadirannya. Bila masih ada selisih, ajukan keberatan ke HRD paling lambat 7 hari sejak slip diterbitkan.",
  },
  {
    q: "Atasan bilang penilaian saya sudah dikirim, tetapi halaman saya kosong.",
    a:
      "Penilaian baru terlihat setelah benar-benar dikirim, bukan saat masih berstatus draf. Selama atasan masih menyuntingnya, penilaian itu memang tidak muncul di portal Anda. Bila statusnya sudah Menunggu tanggapan tetapi halaman tetap kosong, periksa saringan periode di bagian atas halaman.",
  },
  {
    q: "Saya tidak setuju dengan nilai yang diberikan. Apa yang bisa saya lakukan?",
    a:
      "Tekan Tanggapi dan tuliskan keberatan Anda pada kolom komentar. Menanggapi menandakan Anda sudah membaca hasilnya, bukan menyetujuinya. Komentar tersebut ikut tercetak pada dokumen penilaian dan terbaca oleh HRD sebelum penilaian difinalkan.",
  },
  {
    q: "Absen saya ditolak karena wajah tidak cocok, padahal itu saya sendiri.",
    a:
      "Paling sering penyebabnya cahaya. Absen di tempat yang terang, hindari cahaya kuat dari belakang kepala, lepas masker, dan dekatkan ponsel sampai wajah mengisi sebagian besar bingkai. Bila tetap gagal, ajukan koreksi absen untuk hari itu dan beri tahu atasan. Bila penampilan Anda banyak berubah, ajukan penggantian wajah di Profil & Keamanan, tab Wajah Presensi.",
  },
  {
    q: "Apakah pengaduan anonim benar-benar anonim?",
    a:
      "Identitas Anda tidak ditampilkan kepada atasan. Identitas tetap tersimpan terbatas untuk HRD dan Audit agar laporan dapat dipertanggungjawabkan dan agar Anda tetap bisa memantau tindak lanjut serta menerima notifikasi atas tiket Anda.",
  },
  {
    q: "Akun saya terkunci setelah salah kata sandi. Berapa lama?",
    a:
      "Penguncian bersifat sementara dan berlangsung beberapa menit sesuai kebijakan perusahaan. Anda dapat menunggu, atau langsung memakai menu Lupa Kata Sandi untuk mengatur ulang dan sekaligus membuka kunci akun.",
  },
  {
    q: "Kenapa antrean persetujuan saya kosong padahal ada pengajuan baru?",
    a:
      "Sebagai atasan, Anda hanya melihat pengajuan dari karyawan di divisi yang sama dengan Anda. Pengajuan dari divisi lain tidak akan muncul. Selain itu, pengajuan baru muncul hanya bila giliran persetujuannya sudah sampai pada peran Anda.",
    roles: ["SPV"],
  },
];

export default function HelpPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const [open, setOpen] = useState<number | null>(0);

  const faqs = useMemo(
    () => FAQS.filter((f) => !f.roles || (role !== undefined && (f.roles.includes(role) || role === "SUPERADMIN"))),
    [role]
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Panduan penggunaan</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Jawaban cepat untuk pertanyaan yang paling sering muncul
          {role ? ` untuk peran ${ROLE_LABELS[role] ?? role}` : ""}.
        </p>
      </header>

      <Alert tone="info" title="Butuh penjelasan lengkap?">
        Halaman ini hanya memuat ringkasan. Panduan lengkap sesuai peran Anda tersedia di{" "}
        <Link href="/docs" className="font-semibold underline">
          halaman Dokumentasi
        </Link>
        .
      </Alert>

      <section>
        <h2 className="eyebrow mb-3">
          Menu yang tersedia untuk Anda
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="card p-5 hover:border-primary transition-colors group"
            >
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary-soft text-primary">
                <l.icon className="w-4 h-4" />
              </span>
              <h3 className="mt-3 text-body font-semibold group-hover:text-primary transition-colors">
                {l.title}
              </h3>
              <p className="mt-1 text-label text-muted leading-relaxed">{l.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader
          icon={LifeBuoy}
          title="Pertanyaan yang sering diajukan"
          description={`${faqs.length} pertanyaan.`}
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-[var(--border)]">
            {faqs.map((f, i) => {
              const expanded = open === i;
              return (
                <li key={f.q}>
                  <button
                    onClick={() => setOpen(expanded ? null : i)}
                    aria-expanded={expanded}
                    className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <span className="text-body font-semibold leading-snug">{f.q}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {f.roles && (
                        <Badge tone="neutral">
                          {f.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                        </Badge>
                      )}
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 text-subtle transition-transform mt-0.5",
                          expanded && "rotate-180"
                        )}
                      />
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-5 pb-4 -mt-1">
                      <p className="text-body text-muted leading-relaxed max-w-3xl">{f.a}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/docs" className="card p-5 flex items-start gap-3 hover:border-primary transition-colors">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary-soft text-primary shrink-0">
            <BookOpen className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-body font-semibold">
              Dokumentasi lengkap
              <ExternalLink className="w-3 h-3 text-subtle" />
            </span>
            <span className="block text-label text-muted mt-1 leading-relaxed">
              Alur lengkap setiap menu yang bisa Anda gunakan.
            </span>
          </span>
        </Link>

        <Link
          href="/portal/profile"
          className="card p-5 flex items-start gap-3 hover:border-primary transition-colors"
        >
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary-soft text-primary shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-body font-semibold">Keamanan akun</span>
            <span className="block text-label text-muted mt-1 leading-relaxed">
              Ganti kata sandi dan baca tips menjaga akun Anda tetap aman.
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
