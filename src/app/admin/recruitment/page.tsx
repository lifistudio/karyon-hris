"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, FileText, MapPin, Search, SlidersHorizontal, Star, UserPlus, Users, X } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  PageHeader,
  SkeletonList,
  StatusBadge,
  Tabs,
  TableWrap,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Pagination } from "@/components/ui/Pagination";
import { AddCandidateModal } from "@/components/recruitment/AddCandidateModal";
import { api, errorMessage } from "@/lib/client-api";
import { EDUCATION_OPTIONS } from "@/lib/hr/application-form";
import { formatDate, formatDateTime, formatRelative, formatRupiah } from "@/lib/time";

interface Row {
  _id: string;
  name: string;
  email: string;
  phone: string;
  city?: string;
  lastEducation?: string;
  currentStage: string;
  status: string;
  rating?: number;
  hasCv?: boolean;
  source: string;
  reference?: string;
  availableFrom?: string | null;
  expectedSalary?: number | null;
  nextInterviewAt?: string | null;
  employeeId?: string | null;
  createdAt: string;
  vacancyId?: { _id: string; title: string; stages: string[] } | null;
  tags?: string[];
}

interface ListData {
  rows: Row[];
  counts: Record<string, number>;
}

interface VacancyOption {
  _id: string;
  title: string;
  stages: string[];
  status: string;
}

type StatusTab = "all" | "active" | "passed" | "hired" | "rejected";

const FILTER_KEYS = ["q", "vacancyId", "stage", "source", "education", "hasCv", "minRating", "from", "to", "availableBy", "interview"] as const;

const SOURCE_OPTIONS = [
  { value: "career_page", label: "Halaman karier" },
  { value: "manual", label: "Input manual" },
  { value: "api", label: "API eksternal" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru melamar" },
  { value: "oldest", label: "Terlama melamar" },
  { value: "activity", label: "Aktivitas terakhir" },
  { value: "rating", label: "Penilaian tertinggi" },
  { value: "available", label: "Paling cepat bisa mulai" },
  { value: "interview", label: "Jadwal wawancara terdekat" },
  { value: "name", label: "Nama (A–Z)" },
];

const educationLabel = (v?: string) => EDUCATION_OPTIONS.find((o) => o.value === v)?.label ?? v ?? "";

export default function ApplicantsPage() {
  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <ApplicantsView />
    </Suspense>
  );
}

function ApplicantsView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Filters live in the URL, so a filtered list can be bookmarked, shared with
  // a colleague, and survives going into an applicant and coming back.
  const get = (key: string) => sp.get(key) ?? "";
  const status = (get("status") || "all") as StatusTab;
  const sort = get("sort") || "newest";
  const page = Math.max(1, Number(get("page")) || 1);
  const limit = Number(get("limit")) || 25;

  const setParams = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === undefined) next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, sp]
  );

  const [data, setData] = useState<ListData | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vacancies, setVacancies] = useState<VacancyOption[]>([]);
  const [search, setSearch] = useState(get("q"));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const query = sp.toString();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      if (!params.get("limit")) params.set("limit", "25");
      const res = await api.get<ListData>(`/api/v1/candidates?${params.toString()}`);
      setData(res.data ?? null);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<VacancyOption[]>("/api/v1/vacancies?status=all&limit=200")
      .then((res) => setVacancies(res.data ?? []))
      .catch(() => {});
  }, []);

  // Search applies after a short pause in typing, not on every keystroke.
  useEffect(() => {
    if (search === get("q")) return;
    const t = window.setTimeout(() => setParams({ q: search.trim() || null }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selectedVacancy = vacancies.find((v) => v._id === get("vacancyId"));
  const stageOptions = useMemo(() => {
    const stages = selectedVacancy ? selectedVacancy.stages : Array.from(new Set(vacancies.flatMap((v) => v.stages)));
    return stages.map((s) => ({ value: s, label: s }));
  }, [selectedVacancy, vacancies]);

  const activeFilters = FILTER_KEYS.filter((k) => k !== "q" && get(k)).length;
  const counts = data?.counts ?? {};
  const allCount = (counts.active ?? 0) + (counts.passed ?? 0) + (counts.hired ?? 0) + (counts.rejected ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <PageHeader
        eyebrow="Rekrutmen"
        title="Pelamar"
        description="Semua lamaran dari seluruh lowongan. Saring berdasarkan tahap, pendidikan, kesiapan mulai kerja, atau penilaian, lalu buka pelamar untuk melihat detail dan memprosesnya."
        actions={
          <>
            <Link href="/admin/vacancies">
              <Button variant="secondary">Kelola lowongan</Button>
            </Link>
            <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
              Tambah pelamar
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <Tabs<StatusTab>
          value={status}
          onChange={(id) => setParams({ status: id === "all" ? null : id })}
          tabs={[
            { id: "all", label: "Semua", count: allCount },
            { id: "active", label: "Dalam proses", count: counts.active },
            { id: "passed", label: "Lolos", count: counts.passed },
            { id: "hired", label: "Direkrut", count: counts.hired },
            { id: "rejected", label: "Tidak lolos", count: counts.rejected },
          ]}
        />
      </div>

      <Card className="p-3 sm:p-4 mb-4">
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_16rem_14rem_auto]">
          <div className="relative sm:col-span-3 xl:col-span-1">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
              strokeWidth={ICON_STROKE}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, email, telepon, kota, atau nomor referensi"
              className="pl-10"
              aria-label="Cari pelamar"
            />
          </div>
          <Combobox
            value={get("vacancyId")}
            onChange={(v) => setParams({ vacancyId: v || null, stage: null })}
            options={vacancies.map((v) => ({
              value: v._id,
              label: v.title,
              hint: v.status === "open" ? "Tayang" : v.status === "closed" ? "Ditutup" : "Draf",
            }))}
            placeholder="Semua lowongan"
            clearable
            aria-label="Lowongan"
          />
          <Combobox
            value={sort}
            onChange={(v) => setParams({ sort: v === "newest" ? null : v })}
            options={SORT_OPTIONS}
            aria-label="Urutkan"
          />
          <Button
            variant={filtersOpen || activeFilters ? "secondary" : "ghost"}
            icon={SlidersHorizontal}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="justify-center"
          >
            Filter{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
        </div>

        {filtersOpen && (
          <div className="mt-4 pt-4 border-t border-line grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tahap">
              <Combobox
                value={get("stage")}
                onChange={(v) => setParams({ stage: v || null })}
                options={stageOptions}
                placeholder="Semua tahap"
                clearable
                size="sm"
              />
            </Field>
            <Field label="Pendidikan terakhir">
              <Combobox
                value={get("education")}
                onChange={(v) => setParams({ education: v || null })}
                options={EDUCATION_OPTIONS}
                placeholder="Semua jenjang"
                clearable
                size="sm"
              />
            </Field>
            <Field label="Sumber lamaran">
              <Combobox
                value={get("source")}
                onChange={(v) => setParams({ source: v || null })}
                options={SOURCE_OPTIONS}
                placeholder="Semua sumber"
                clearable
                size="sm"
              />
            </Field>
            <Field label="Penilaian minimal">
              <Combobox
                value={get("minRating")}
                onChange={(v) => setParams({ minRating: v || null })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${"★".repeat(n)} ${n} ke atas` }))}
                placeholder="Semua"
                clearable
                size="sm"
              />
            </Field>
            <Field label="Melamar sejak">
              <DatePicker value={get("from")} onChange={(v) => setParams({ from: v || null })} max={get("to") || undefined} clearable />
            </Field>
            <Field label="Melamar sampai">
              <DatePicker value={get("to")} onChange={(v) => setParams({ to: v || null })} min={get("from") || undefined} clearable />
            </Field>
            <Field label="Bisa mulai paling lambat">
              <DatePicker value={get("availableBy")} onChange={(v) => setParams({ availableBy: v || null })} clearable />
            </Field>
            <div className="flex flex-col justify-end gap-2.5 pb-1">
              <CheckFilter label="Hanya yang melampirkan CV" checked={get("hasCv") === "1"} onChange={(on) => setParams({ hasCv: on ? "1" : null })} />
              <CheckFilter
                label="Ada jadwal wawancara"
                checked={get("interview") === "upcoming"}
                onChange={(on) => setParams({ interview: on ? "upcoming" : null })}
              />
            </div>
            {activeFilters > 0 && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  onClick={() => setParams(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "q").map((k) => [k, null])))}
                >
                  Hapus semua filter
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading && !data ? (
        <SkeletonList rows={6} />
      ) : !data?.rows.length ? (
        <Card>
          <EmptyState
            icon={Users}
            title={activeFilters || get("q") || status !== "all" ? "Tidak ada pelamar yang cocok" : "Belum ada pelamar"}
            description={
              activeFilters || get("q") || status !== "all"
                ? "Coba longgarkan filter atau ubah kata kunci pencarian."
                : "Lamaran dari halaman karier akan muncul di sini begitu lowongan ditayangkan."
            }
          />
        </Card>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          {/* Phones: cards. A seven-column table is unreadable at 375px. */}
          <div className="lg:hidden space-y-2.5">
            {data.rows.map((r) => (
              <Link key={r._id} href={`/admin/recruitment/${r._id}`} className="block card p-4 hover:border-primary transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-heading truncate">{r.name}</p>
                    <p className="text-label text-muted truncate">{r.vacancyId?.title ?? "Lowongan dihapus"}</p>
                  </div>
                  <RowStatus row={r} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
                  <span className="font-medium text-foreground/80">{r.currentStage}</span>
                  {r.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" strokeWidth={ICON_STROKE} />
                      {r.city}
                    </span>
                  )}
                  {(r.rating ?? 0) > 0 && <Rating value={r.rating ?? 0} />}
                  <span className="text-subtle">{formatRelative(r.createdAt)}</span>
                </div>
                {r.nextInterviewAt && !r.employeeId && r.status !== "rejected" && <InterviewLine at={r.nextInterviewAt} />}
              </Link>
            ))}
          </div>

          <Card className="hidden lg:block overflow-hidden">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pelamar</Th>
                  <Th>Lowongan & tahap</Th>
                  <Th>Profil</Th>
                  <Th>Bisa mulai</Th>
                  <Th>Penilaian</Th>
                  <Th>Status</Th>
                  <Th>Melamar</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r._id}>
                    <Td>
                      <Link href={`/admin/recruitment/${r._id}`} className="block min-w-0 group">
                        <span className="flex items-center gap-1.5">
                          <span className="text-body-sm font-semibold text-heading group-hover:text-primary transition-colors truncate max-w-[220px]">
                            {r.name}
                          </span>
                          {r.hasCv && (
                            <FileText className="w-3.5 h-3.5 text-subtle shrink-0" strokeWidth={ICON_STROKE} aria-label="Melampirkan CV" />
                          )}
                        </span>
                        <span className="block text-label text-muted truncate max-w-[240px]">{r.email}</span>
                      </Link>
                    </Td>
                    <Td>
                      <p className="text-body-sm text-foreground truncate max-w-[220px]">{r.vacancyId?.title ?? "—"}</p>
                      <p className="text-label text-muted">{r.currentStage}</p>
                      {r.nextInterviewAt && !r.employeeId && r.status !== "rejected" && <InterviewLine at={r.nextInterviewAt} />}
                    </Td>
                    <Td>
                      <p className="text-body-sm text-foreground">{educationLabel(r.lastEducation) || "—"}</p>
                      <p className="text-label text-muted">
                        {[r.city, r.expectedSalary ? formatRupiah(r.expectedSalary) : ""].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </Td>
                    <Td className="text-body-sm whitespace-nowrap">{r.availableFrom ? formatDate(r.availableFrom) : "—"}</Td>
                    <Td>{(r.rating ?? 0) > 0 ? <Rating value={r.rating ?? 0} /> : <span className="text-label text-subtle">Belum</span>}</Td>
                    <Td>
                      <RowStatus row={r} />
                    </Td>
                    <Td className="text-label text-muted whitespace-nowrap">{formatRelative(r.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            onPage={(p) => setParams({ page: p === 1 ? null : p }, false)}
            onLimit={(l) => setParams({ limit: l === 25 ? null : l })}
          />
        </div>
      )}

      <AddCandidateModal
        open={addOpen}
        vacancyId={get("vacancyId") || undefined}
        vacancies={vacancies.filter((v) => v.status !== "archived")}
        onClose={() => setAddOpen(false)}
        onSaved={(id) => {
          setAddOpen(false);
          if (id) router.push(`/admin/recruitment/${id}`);
          else void load();
        }}
      />
    </div>
  );
}

function RowStatus({ row }: { row: Row }) {
  if (row.employeeId) return <Badge tone="success">Direkrut</Badge>;
  return <StatusBadge status={row.status} />;
}

function Rating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-warning" aria-label={`Penilaian ${value} dari 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn("w-3.5 h-3.5", i < value ? "fill-current" : "text-line-strong")} strokeWidth={ICON_STROKE} />
      ))}
    </span>
  );
}

function InterviewLine({ at }: { at: string }) {
  if (new Date(at) < new Date()) return null;
  return (
    <p className="mt-1 inline-flex items-center gap-1 text-label text-info">
      <CalendarClock className="w-3 h-3" strokeWidth={ICON_STROKE} />
      Wawancara {formatDateTime(at)}
    </p>
  );
}

function CheckFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-body-sm text-foreground cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
      />
      {label}
    </label>
  );
}
