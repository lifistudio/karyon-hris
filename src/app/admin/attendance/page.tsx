"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, BellRing, CalendarOff, Clock3, Download, Search, UserCheck, UserX } from "@/components/icons";
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonList, TableWrap, Td, Th, cn,
  type BadgeTone,
} from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateLong, formatTime, wibDateKey } from "@/lib/time";

type Status = "present" | "late" | "leave" | "off" | "holiday" | "not_started" | "missing" | "absent";
interface Row {
  employee: { _id: string; employeeId: string; name: string; branch: string | null; branchId: string | null; division: string | null; position: string | null };
  status: Status;
  schedule: { name: string; clockIn: string; clockOut: string } | null;
  attendance: { clockIn: string | null; clockOut: string | null; lateMinutes: number; needsReview: boolean } | null;
  note: string;
  missingClockOut: boolean;
  pendingLeave: boolean;
}
interface Daily { date: string; summary: Record<Status, number> & { missingClockOut: number; total: number }; rows: Row[]; labels: Record<Status, string> }

const TONE: Record<Status, BadgeTone> = {
  present: "success", late: "warning", leave: "info", off: "neutral", holiday: "neutral", not_started: "neutral", missing: "accent", absent: "danger",
};
const FILTERS: Array<{ id: Status | "all"; label: string }> = [
  { id: "all", label: "Semua" }, { id: "missing", label: "Belum absen" }, { id: "absent", label: "Alpha" }, { id: "late", label: "Terlambat" },
  { id: "present", label: "Hadir" }, { id: "leave", label: "Izin/Cuti" }, { id: "not_started", label: "Belum mulai" }, { id: "off", label: "Libur" }, { id: "holiday", label: "Libur nasional" },
];

function AttendanceMonitor() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const today = wibDateKey();
  const [date, setDate] = useState(params.get("date") ?? today);
  const [status, setStatus] = useState<Status | "all">((params.get("status") as Status) ?? "all");
  const [branchId, setBranchId] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Daily | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  // Loading is derived from which request last finished, so the effect never sets state synchronously.
  const requestKey = `${date}|${branchId}|${reload}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== requestKey;
  const [branches, setBranches] = useState<Array<{ _id: string; name: string }>>([]);
  const [reminding, setReminding] = useState(false);

  useEffect(() => {
    api.get<Array<{ _id: string; name: string }>>("/api/v1/branches").then((r) => setBranches(r.data ?? [])).catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    let active = true;
    const search = new URLSearchParams({ date });
    if (branchId) search.set("branchId", branchId);
    api.get<Daily>(`/api/v1/attendance/daily?${search}`, { cache: "no-store" })
      .then((res) => { if (active) { setData(res.data ?? null); setError(""); } })
      .catch((err) => { if (active) setError(errorMessage(err)); })
      .finally(() => { if (active) setLoadedKey(requestKey); });
    return () => { active = false; };
  }, [date, branchId, reload, requestKey]);

  // Keep the URL shareable (notification links open a specific day and filter).
  useEffect(() => {
    const search = new URLSearchParams();
    if (date !== today) search.set("date", date);
    if (status !== "all") search.set("status", status);
    router.replace(`/admin/attendance${search.size ? `?${search}` : ""}`, { scroll: false });
  }, [date, status, today, router]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (status === "all" || r.status === status) &&
      (!q || r.employee.name.toLowerCase().includes(q) || r.employee.employeeId.toLowerCase().includes(q)));
  }, [data, status, query]);

  const remind = useCallback(async () => {
    setReminding(true);
    try { const res = await api.post<{ sent: number }>("/api/v1/attendance/daily", { action: "remind" }); toast.success("Pengingat", res.message ?? "Terkirim"); }
    catch (err) { toast.error("Gagal mengirim pengingat", errorMessage(err)); }
    finally { setReminding(false); }
  }, [toast]);

  const s = data?.summary;
  const exportHref = (format: "csv" | "xlsx") => `/api/v1/reports/export?dataset=attendance_daily&date=${date}&format=${format}${branchId ? `&branchId=${branchId}` : ""}`;

  return (
    <div>
      <PageHeader
        eyebrow="Operasional HR"
        title="Kehadiran"
        description={`Siapa yang sudah hadir, terlambat, izin, libur, belum absen, atau alpha pada ${formatDateLong(date)}. Status dihitung dari jadwal kerja, presensi, izin yang disetujui, dan hari libur.`}
        actions={<>
          <DatePicker value={date} onChange={(v) => setDate(v || today)} max={today} aria-label="Pilih tanggal" className="w-44" />
          <a href={exportHref("xlsx")} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-body font-semibold text-foreground hover:bg-surface-2"><Download className="w-4 h-4" />Excel</a>
          <a href={exportHref("csv")} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-body font-semibold text-foreground hover:bg-surface-2"><Download className="w-4 h-4" />CSV</a>
          {date === today && <Button icon={BellRing} loading={reminding} onClick={() => void remind()} disabled={!s?.missing}>Ingatkan yang belum absen</Button>}
        </>}
      />

      {error ? <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} /> : (
        <div className="space-y-6">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            {[
              { id: "present" as const, label: "Hadir tepat waktu", value: s?.present, icon: UserCheck, tone: "text-success" },
              { id: "late" as const, label: "Terlambat", value: s?.late, icon: Clock3, tone: "text-warning" },
              { id: "missing" as const, label: "Belum absen", value: s?.missing, icon: AlarmClock, tone: "text-warning" },
              { id: "absent" as const, label: "Alpha", value: s?.absent, icon: UserX, tone: "text-danger" },
              { id: "leave" as const, label: "Izin/Cuti", value: s?.leave, icon: CalendarOff, tone: "text-info" },
            ].map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setStatus(status === card.id ? "all" : card.id)}
                aria-pressed={status === card.id}
                className={cn("card p-4 text-left transition-colors hover:border-line-strong cursor-pointer", status === card.id && "border-primary ring-2 ring-primary/20")}
              >
                <span className="flex items-center justify-between gap-2 text-body-sm text-muted">{card.label}<card.icon className={cn("w-4 h-4", card.tone)} /></span>
                <span className="block mt-2 text-display-sm font-semibold text-heading tabular-nums">{loading && !s ? "…" : card.value ?? 0}</span>
              </button>
            ))}
          </div>
          {s && (s.missingClockOut > 0 || s.not_started > 0) && (
            <p className="text-body-sm text-muted">
              {s.not_started > 0 && <>{s.not_started} karyawan belum masuk jam kerjanya. </>}
              {s.missingClockOut > 0 && <>{s.missingClockOut} karyawan belum absen pulang setelah jam kerja berakhir.</>}
            </p>
          )}

          <Card>
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-line">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau NIP" aria-label="Cari karyawan" className="pl-9" />
              </div>
              {branches.length > 1 && (
                <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Filter cabang" className="w-full sm:w-52">
                  <option value="">Semua cabang</option>
                  {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </Select>
              )}
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" onClick={() => setStatus(f.id)} aria-pressed={status === f.id}
                    className={cn("h-8 px-3 rounded-full border text-label font-semibold transition-colors cursor-pointer",
                      status === f.id ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-muted border-line hover:text-foreground")}>
                    {f.label}{f.id !== "all" && s ? ` · ${s[f.id]}` : ""}
                  </button>
                ))}
              </div>
            </div>
            {loading && !data ? <div className="p-5"><SkeletonList rows={6} /></div> : rows.length === 0 ? (
              <EmptyState title="Tidak ada karyawan pada filter ini" description="Ubah tanggal, status, atau kata kunci pencarian." />
            ) : (
              <TableWrap>
                <thead><tr><Th>Karyawan</Th><Th>Unit</Th><Th>Jadwal</Th><Th>Masuk</Th><Th>Pulang</Th><Th>Status</Th><Th>Keterangan</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee._id} className="border-b border-line last:border-0">
                      <Td className="min-w-44"><Link href={`/admin/employees?focus=${r.employee._id}`} className="font-semibold text-foreground hover:text-primary">{r.employee.name}</Link><div className="text-caption text-subtle">{r.employee.employeeId}{r.employee.position ? ` · ${r.employee.position}` : ""}</div></Td>
                      <Td className="text-muted"><div>{r.employee.branch ?? "—"}</div><div className="text-caption">{r.employee.division ?? ""}</div></Td>
                      <Td className="text-muted whitespace-nowrap">{r.schedule ? `${r.schedule.clockIn}–${r.schedule.clockOut}` : "—"}</Td>
                      <Td className="tabular-nums whitespace-nowrap">{r.attendance?.clockIn ? formatTime(r.attendance.clockIn) : "—"}</Td>
                      <Td className="tabular-nums whitespace-nowrap">{r.attendance?.clockOut ? formatTime(r.attendance.clockOut) : r.missingClockOut ? <Badge tone="warning">Belum</Badge> : "—"}</Td>
                      <Td><Badge tone={TONE[r.status]} dot>{data?.labels[r.status] ?? r.status}</Badge></Td>
                      <Td className="text-muted text-body-sm min-w-48">{r.note || (r.attendance?.needsReview ? "Perlu ditinjau" : "")}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function AttendancePage() {
  return <Suspense fallback={<SkeletonList rows={6} />}><AttendanceMonitor /></Suspense>;
}
