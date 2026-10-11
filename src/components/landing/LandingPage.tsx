"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { ArrowRight, BookOpen, Boxes, CalendarRange, CheckCircle2, Clock3, Fingerprint, MapPin, Moon, ReceiptText, Repeat2, ScrollText, ServerCog, ShieldCheck, Sun, Workflow } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { ButtonLink, ICON_STROKE, cn, type IconType } from "@/components/ui";
import { timezoneAbbr, timezoneLabel } from "@/lib/time";

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/**
 * Public page of a company's HRIS: visitors are employees and job applicants,
 * so it describes what they get, never how the system works underneath.
 */
const GUARANTEES: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: Clock3, title: "Jam server, bukan jam ponsel", body: "Waktu presensi diambil dari jam server sesuai zona waktu perusahaan. Mengubah jam di perangkat tidak berpengaruh." },
  { icon: ShieldCheck, title: "Data pribadi terenkripsi", body: "NIK dan rekening disimpan terenkripsi dan hanya terlihat oleh peran yang berhak." },
  { icon: ScrollText, title: "Setiap keputusan tercatat", body: "Login, persetujuan, akses slip gaji, dan perubahan aturan tercatat di jejak audit." },
  { icon: ServerCog, title: "Data milik perusahaan", body: "Sistem dan datanya dikelola langsung oleh perusahaan Anda." },
];

const MODULES: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: Fingerprint, title: "Presensi bergeofence", body: "Absen dengan foto dan lokasi dari ponsel. Kendala saat absen dapat dilaporkan langsung ke HRD." },
  { icon: CalendarRange, title: "Izin dan cuti", body: "Saldo hanya terpotong di hari kerja, dan langsung ditahan saat pengajuan dikirim." },
  { icon: Workflow, title: "Persetujuan berjenjang", body: "Cuti, koreksi absen, dan tukar libur disetujui berurutan oleh atasan dan HRD." },
  { icon: ReceiptText, title: "Slip gaji dari presensi", body: "Lembur, potongan, BPJS, dan PPh 21 dihitung dari catatan presensi. Slip dapat diunduh dari portal." },
  { icon: Repeat2, title: "Tukar libur", body: "Masuk di tanggal merah dapat ditukar dengan libur di hari lain sesuai aturan perusahaan." },
  { icon: Boxes, title: "Rekrutmen dan inventaris", body: "Dari lamaran sampai onboarding, dan serah terima aset sampai clearance saat resign." },
];

const ROLES: Array<[string, string]> = [
  ["Karyawan", "Absen, ajukan cuti dan tukar libur, unduh slip gaji, dan laporkan kendala."],
  ["Atasan", "Persetujuan tahap pertama untuk anggota divisinya."],
  ["HRD", "Data karyawan, jadwal, penggajian, rekrutmen, dan pengaturan."],
  ["Audit", "Membaca dan mengekspor data, serta memverifikasi pengajuan yang dieskalasi."],
  ["GA", "Aset perusahaan dan serah terima inventaris."],
  ["Direksi", "Ringkasan eksekutif dan persetujuan tahap akhir."],
];

const EASE = [0.16, 1, 0.3, 1] as const;
const WRAP = "mx-auto w-full max-w-[80rem] px-4 sm:px-6 lg:px-8";

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

export default function LandingPage({ dashboardHref }: { dashboardHref: string | null }) {
  const enterHref = dashboardHref ?? "/auth/login";
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl">
        <div className={cn(WRAP, "flex h-16 items-center justify-between gap-4")}>
          <Link href="/" className="flex items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" aria-label="Beranda">
            <BrandLogo height={28} />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/career" className="hidden h-9 items-center rounded-full px-3.5 text-body-sm font-medium text-muted transition-colors hover:bg-background-secondary-default hover:text-foreground sm:inline-flex">
              Karier
            </Link>
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
              className="grid size-9 cursor-pointer place-items-center rounded-full text-subtle transition-colors hover:bg-background-secondary-default hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="size-[18px]" strokeWidth={ICON_STROKE} /> : <Moon className="size-[18px]" strokeWidth={ICON_STROKE} />}
            </button>
            <ButtonLink href={enterHref} size="sm">{dashboardHref ? "Buka dashboard" : "Masuk"}</ButtonLink>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ---------------- hero ---------------- */}
        <section className="pt-[clamp(3rem,7vw,6rem)] pb-[clamp(3rem,6vw,5rem)]">
          <div className={cn(WRAP, "grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16")}>
            <div>
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}
                className="inline-flex items-center gap-2 rounded-full bg-background-secondary-default px-3 py-1.5 text-body-sm font-medium text-muted">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                Sistem informasi kepegawaian
              </motion.p>
              <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05, ease: EASE }}
                className="mt-6 text-display-sm text-heading sm:text-hero">
                Semua urusan kerja Anda, dalam satu portal.
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
                className="mt-5 max-w-xl text-body-lg leading-relaxed text-muted">
                Absen dari ponsel, ajukan cuti, pantau persetujuan, dan unduh slip gaji kapan saja. Aturannya ditetapkan HRD perusahaan Anda dan berlaku sama untuk semua.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.15, ease: EASE }}
                className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href={enterHref} size="lg" iconRight={ArrowRight}>{dashboardHref ? "Buka dashboard" : "Masuk ke portal"}</ButtonLink>
                <ButtonLink href="/career" size="lg" variant="secondary" icon={BookOpen}>Lihat lowongan</ButtonLink>
              </motion.div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }} className="mt-6 text-body-sm text-subtle">
                Panduan penggunaan tersedia di dalam aplikasi, sesuai peran akun Anda.
              </motion.p>
            </div>

            <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, delay: 0.12, ease: EASE }}>
              <AttendancePreview />
            </motion.div>
          </div>
        </section>

        {/* ---------------- guarantees ---------------- */}
        <section className="pb-[clamp(3rem,6vw,5rem)]">
          <div className={WRAP}>
            <Reveal className="rounded-[28px] bg-background-secondary-default p-2">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {GUARANTEES.map((g) => (
                  <li key={g.title} className="rounded-[22px] bg-background-primary-default p-5">
                    <g.icon className="size-5 text-primary" strokeWidth={ICON_STROKE} aria-hidden />
                    <h3 className="mt-4 text-body font-semibold text-heading">{g.title}</h3>
                    <p className="mt-1.5 text-body-sm leading-relaxed text-muted">{g.body}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ---------------- modules ---------------- */}
        <section className="py-[clamp(3.5rem,7vw,6rem)]">
          <div className={WRAP}>
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-display-sm text-heading md:text-display">Enam modul, satu sumber data</h2>
              <p className="mt-4 text-body-lg leading-relaxed text-muted">
                Presensi yang dicatat pagi ini adalah angka yang sama yang dipakai menghitung slip gaji akhir bulan. Tidak ada rekap manual di antaranya.
              </p>
            </Reveal>
            <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((m, i) => (
                <Reveal key={m.title} delay={(i % 3) * 0.06} className="h-full">
                  <li className="group h-full rounded-[28px] border border-border-button-default bg-background-primary-default p-2 transition-shadow hover:shadow-[var(--shadow-pop)]">
                    <div className="h-full rounded-[22px] bg-background-secondary-default p-6">
                      <span className="grid size-10 place-items-center rounded-full bg-background-primary-default text-primary shadow-xs transition-transform duration-300 group-hover:-translate-y-0.5">
                        <m.icon className="size-5" strokeWidth={ICON_STROKE} aria-hidden />
                      </span>
                      <h3 className="mt-5 text-body-lg font-semibold text-heading">{m.title}</h3>
                      <p className="mt-1.5 text-body leading-relaxed text-muted">{m.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- roles ---------------- */}
        <section className="bg-background-secondary-default py-[clamp(3.5rem,7vw,6rem)]">
          <div className={cn(WRAP, "grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16")}>
            <Reveal>
              <h2 className="text-display-sm text-heading md:text-display">Setiap peran melihat bagiannya sendiri</h2>
              <p className="mt-4 text-body-lg leading-relaxed text-muted">Setiap akun hanya melihat dan mengubah data yang sesuai dengan perannya di perusahaan.</p>
            </Reveal>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ROLES.map(([role, desc], i) => (
                <Reveal key={role} delay={(i % 2) * 0.06} className="h-full">
                  <li className="flex h-full gap-3 rounded-[22px] bg-background-primary-default p-5 shadow-xs">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={ICON_STROKE} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-body font-semibold text-heading">{role}</p>
                      <p className="mt-1 text-body-sm leading-relaxed text-muted">{desc}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- entry points ---------------- */}
        <section className="py-[clamp(3.5rem,7vw,6rem)]">
          <div className={cn(WRAP, "grid grid-cols-1 gap-4 md:grid-cols-2")}>
            <EntryCard href={enterHref} title="Portal karyawan" body="Absen harian, pengajuan cuti, tukar libur, slip gaji, dan pengaduan." cta="Masuk ke portal" />
            <EntryCard href="/career" title="Halaman karier" body="Lowongan yang sedang dibuka beserta formulir lamarannya." cta="Lihat lowongan" />
          </div>
        </section>
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="pb-6">
        <div className={WRAP}>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-background-secondary-default px-6 py-5">
            <div className="flex items-center gap-4">
              <BrandLogo height={22} />
              <p className="text-body-sm text-muted">&copy; {new Date().getFullYear()} · Seluruh waktu dalam {timezoneLabel()}</p>
            </div>
            <nav className="flex items-center gap-1 text-body-sm">
              <Link href="/career" className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-background-primary-default hover:text-foreground">Karier</Link>
              <Link href={enterHref} className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-background-primary-default hover:text-foreground">Masuk</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EntryCard({ href, title, body, cta }: { href: string; title: string; body: string; cta: string }) {
  return (
    <Reveal className="h-full">
      <Link href={href} className="group block h-full rounded-[28px] border border-border-button-default bg-background-primary-default p-2 outline-none transition-shadow hover:shadow-[var(--shadow-pop)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <div className="flex h-full min-h-44 flex-col justify-between rounded-[22px] bg-background-secondary-default p-7">
          <div>
            <h3 className="text-title-sm font-semibold text-heading">{title}</h3>
            <p className="mt-2 max-w-sm text-body leading-relaxed text-muted">{body}</p>
          </div>
          <span className="mt-6 inline-flex items-center gap-1.5 text-body font-semibold text-primary">
            {cta}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={ICON_STROKE} aria-hidden />
          </span>
        </div>
      </Link>
    </Reveal>
  );
}

const STEPS = [
  { label: "Absen masuk", time: "08:47" },
  { label: "Mulai istirahat", time: "12:03" },
  { label: "Selesai istirahat", time: "12:58" },
  { label: "Absen pulang", time: "17:05" },
];

/**
 * A live preview of the attendance screen, built from the same tokens as the
 * real interface: the steps check off one by one, then the day starts again.
 */
function AttendancePreview() {
  const reduce = useReducedMotion();
  const [done, setDone] = useState(reduce ? 3 : 1);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setDone((d) => (d >= STEPS.length ? 1 : d + 1)), 1800);
    return () => clearInterval(timer);
  }, [reduce]);
  const current = STEPS[Math.min(done, STEPS.length) - 1];

  return (
    <div className="rounded-[32px] border border-border-button-default bg-background-primary-default p-2 shadow-[var(--shadow-pop)]" aria-hidden>
      <div className="rounded-[26px] bg-background-secondary-default p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-body-sm font-medium text-muted">Presensi hari ini</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={current.time} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}
                  className="text-display font-semibold tabular-nums text-heading">
                  {current.time}
                </motion.span>
              </AnimatePresence>
              <span className="text-body font-medium text-subtle">{timezoneAbbr()}</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-body-sm font-medium text-success">
            <span className="size-1.5 rounded-full bg-current" />
            Tepat waktu
          </span>
        </div>

        <ol className="mt-5 space-y-2">
          {STEPS.map((step, i) => {
            const isDone = i < done;
            const isNext = i === done;
            return (
              <li key={step.label} className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-500", isDone || isNext ? "bg-background-primary-default" : "bg-transparent")}>
                <motion.span
                  animate={{ scale: isDone ? [1, 1.15, 1] : 1 }}
                  transition={{ duration: 0.35 }}
                  className={cn("grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-500", isDone ? "bg-success text-white" : isNext ? "bg-primary-soft text-primary" : "bg-background-tertiary-default text-subtle")}
                >
                  {isDone ? <CheckCircle2 className="size-4" strokeWidth={ICON_STROKE} /> : <Clock3 className="size-4" strokeWidth={ICON_STROKE} />}
                </motion.span>
                <span className={cn("flex-1 text-body-sm", isDone ? "font-medium text-heading" : isNext ? "font-semibold text-primary" : "text-muted")}>{step.label}</span>
                <span className="text-body-sm font-semibold tabular-nums text-heading">
                  {isDone ? step.time : isNext ? <span className="text-primary">Giliran Anda</span> : "--:--"}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-background-primary-default px-4 py-3">
          <span className="flex items-center gap-2 text-body-sm text-muted">
            <MapPin className="size-4 text-subtle" strokeWidth={ICON_STROKE} />
            Kantor Pusat · 12 m
          </span>
          <span className="text-body-sm font-medium text-success">Dalam radius</span>
        </div>
      </div>
    </div>
  );
}
