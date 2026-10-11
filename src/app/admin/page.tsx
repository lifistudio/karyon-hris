"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BirthdayPanel } from "@/components/BirthdayPanel";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Briefcase, CalendarOff, ClipboardCheck, Clock3, FileWarning, PartyPopper, UserCheck, UserPlus, Users } from "@/components/icons";
import { DonutChart, LegendDot, TrendBars } from "@/components/charts";
import { HrisBanners } from "@/components/admin/HrisBanners";
import { useSession } from "next-auth/react";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  SkeletonCards,
  StatCard,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateLong, timezoneLabel } from "@/lib/time";

interface DashboardData {
  todayKey: string;
  period: string;
  cards: {
    headcount: number;
    onboarding: number;
    presentToday: number;
    lateToday: number;
    flaggedToday: number;
    onLeaveToday: number;
    absentToday: number;
    pendingApprovals: number;
    openCandidates: number;
    expiringContracts: number;
    branches: number;
  };
  trend: Array<{ dateKey: string; present: number; late: number; isWeekend: boolean }>;
  month: {
    workingDays: number;
    attendanceRate: number;
    punctualityRate: number;
    lateRecords: number;
    lateMinutes: number;
  };
  upcomingHolidays: Array<{ dateKey: string; name: string; type: string }>;
  birthdays: Array<{ _id: string; name: string; day: number }>;
}

/**
 * `useSearchParams` forces a Suspense boundary during prerender, so the banner
 * that reads `?denied=` lives in its own component and the dashboard itself
 * renders immediately.
 */
function DeniedBanner() {
  const denied = useSearchParams().get("denied");
  if (!denied) return null;
  return (
    <Alert tone="warning" title="Akses ditolak">
      Peran Anda tidak memiliki izin membuka halaman <strong>{denied}</strong>. Hubungi
      Superadmin bila Anda memerlukan akses tersebut.
    </Alert>
  );
}

export default function AdminDashboardPage() {
  const { data: session } = useSession();
  const superadmin = session?.user?.role === "SUPERADMIN";

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<DashboardData>("/api/v1/dashboard");
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Ringkasan hari ini</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          {data ? formatDateLong(data.todayKey) : "Memuat…"} · seluruh waktu dalam {timezoneLabel()}
        </p>
      </header>

      <Suspense fallback={null}>
        <DeniedBanner />
      </Suspense>

      <HrisBanners placement="dashboard" enabled={superadmin} />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonCards count={4} />
      ) : data ? (
        <>
          {/* Attention first: things that need a human today. */}
          {(data.cards.pendingApprovals > 0 || data.cards.flaggedToday > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.cards.pendingApprovals > 0 && (
                <Link href="/admin/approvals" className="card p-4 flex items-center gap-3 hover:border-primary transition-colors">
                  <span className="grid place-items-center w-10 h-10 rounded-lg bg-warning-soft text-warning shrink-0">
                    <ClipboardCheck className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">
                      {data.cards.pendingApprovals} pengajuan menunggu Anda
                    </span>
                    <span className="block text-label text-muted">Buka antrean persetujuan →</span>
                  </span>
                </Link>
              )}
              {data.cards.flaggedToday > 0 && (
                <Link href="/admin/employees" className="card p-4 flex items-center gap-3 hover:border-primary transition-colors">
                  <span className="grid place-items-center w-10 h-10 rounded-lg bg-danger-soft text-danger shrink-0">
                    <FileWarning className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">
                      {data.cards.flaggedToday} presensi perlu ditinjau
                    </span>
                    <span className="block text-label text-muted">
                      Kendala lokasi, lintas cabang, atau foto manual
                    </span>
                  </span>
                </Link>
              )}
            </div>
          )}

          {/* Today: tiles + composition, BoardUI's white card holding grey tiles */}
          <Card>
            <CardHeader
              title="Kehadiran hari ini"
              actions={<Link href="/admin/attendance" className="text-body-sm font-semibold text-primary hover:underline">Lihat per karyawan →</Link>}
            />
            <CardBody className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Sudah absen masuk" value={data.cards.presentToday} hint={`dari ${data.cards.headcount} karyawan aktif`} icon={UserCheck} />
                <StatCard label="Terlambat" value={data.cards.lateToday} hint="melewati jadwal + toleransi" icon={Clock3} />
                <StatCard label="Cuti / izin" value={data.cards.onLeaveToday} hint="pengajuan disetujui" icon={CalendarOff} />
                <StatCard label="Belum absen / alpha" value={data.cards.absentToday} hint="jadwal mulai, tanpa presensi & izin" icon={AlertTriangle} />
              </div>
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-surface-2 p-4">
                <DonutChart
                  caption="karyawan aktif"
                  total={data.cards.headcount}
                  slices={[
                    { label: "Tepat waktu", value: Math.max(0, data.cards.presentToday - data.cards.lateToday), tone: 7 },
                    { label: "Terlambat", value: data.cards.lateToday, tone: 8 },
                    { label: "Cuti / izin", value: data.cards.onLeaveToday, tone: 5 },
                    { label: "Belum absen", value: data.cards.absentToday, tone: 3 },
                  ]}
                />
                <div className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5">
                  <LegendDot tone={7} label="Tepat" />
                  <LegendDot tone={8} label="Terlambat" />
                  <LegendDot tone={5} label="Cuti" />
                  <LegendDot tone={3} label="Belum" />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Organisation */}
          <Card>
            <CardHeader title="Organisasi" />
            <CardBody className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard label="Karyawan aktif" value={data.cards.headcount} hint={`${data.cards.branches} cabang`} icon={Users} />
              <StatCard label="Dalam onboarding" value={data.cards.onboarding} hint="belum berstatus aktif" icon={UserPlus} />
              <StatCard label="Kandidat berjalan" value={data.cards.openCandidates} hint="di pipeline rekrutmen" icon={Briefcase} />
              <StatCard label="Kontrak segera berakhir" value={data.cards.expiringContracts} hint="dalam 30 hari ke depan" icon={FileWarning} />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Trend */}
            <Card className="lg:col-span-2">
              <CardHeader
                title="Tren kehadiran 14 hari terakhir"
                description={`Bulan berjalan: ${data.month.attendanceRate}% kehadiran · ${data.month.punctualityRate}% tepat waktu dari ${data.month.workingDays} hari kerja.`}
                actions={<div className="hidden sm:flex items-center gap-4"><LegendDot tone={6} label="Tepat waktu" /><LegendDot tone={8} label="Terlambat" /><LegendDot tone="neutral" label="Akhir pekan" /></div>}
              />
              <CardBody>
                <div className="rounded-2xl bg-surface-2 p-4">
                  <TrendBars
                    label={`Grafik kehadiran 14 hari terakhir: ${data.trend.map((t) => `${formatDate(t.dateKey)} hadir ${t.present}, terlambat ${t.late}`).join("; ")}`}
                    series={[{ key: "onTime", label: "Tepat waktu", tone: 6 }, { key: "late", label: "Terlambat", tone: 8 }]}
                    data={data.trend.map((t) => ({ label: t.dateKey.slice(-2), title: formatDate(t.dateKey), onTime: Math.max(0, t.present - t.late), late: t.late, muted: t.isWeekend }))}
                  />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Metric label="Hari kerja berjalan" value={data.month.workingDays} />
                  <Metric label="Kejadian terlambat" value={data.month.lateRecords} />
                  <Metric label="Akumulasi terlambat" value={`${data.month.lateMinutes} mnt`} />
                </div>
              </CardBody>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader icon={PartyPopper} title="Hari libur berikutnya" />
                <CardBody className="p-0">
                  {data.upcomingHolidays.length === 0 ? (
                    <EmptyState
                      icon={PartyPopper}
                      title="Belum ada data"
                      description="Tambahkan tanggal merah di menu Hari Libur Nasional."
                    />
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {data.upcomingHolidays.map((h) => (
                        <li key={h.dateKey} className="flex items-center justify-between gap-3 px-5 py-3">
                          <span className="min-w-0">
                            <span className="block text-label font-semibold truncate">{h.name}</span>
                            <span className="block text-caption text-subtle">{formatDate(h.dateKey)}</span>
                          </span>
                          <Badge tone={h.type === "cuti_bersama" ? "warning" : "danger"}>
                            {h.type === "cuti_bersama" ? "Cuti bersama" : "Libur"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <BirthdayPanel compact href="/admin/birthdays" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3">
      <p className="text-body-sm text-muted">{label}</p>
      <p className="text-title-sm font-medium text-heading tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
