"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import Link from "next/link";
import { Eye, ExternalLink, Plus, Search, Trash2, UserRoundSearch, Users } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ICON_STROKE,
  Input,
  PageHeader,
  Select,
  SkeletonList,
  Tabs,
  type BadgeTone,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatRupiah } from "@/lib/time";
import { VacancyForm, type VacancyDraft } from "./VacancyForm";

export interface Vacancy {
  _id: string;
  title: string;
  slug: string;
  positionId?: { _id: string; name: string } | null;
  divisionId?: { _id: string; name: string } | null;
  branchId?: { _id: string; name: string } | null;
  employmentType: string;
  workArrangement: string;
  location: string;
  summary: string;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  benefits: string[];
  salaryMin: number;
  salaryMax: number;
  showSalary: boolean;
  openings: number;
  stages: string[];
  status: "draft" | "open" | "closed" | "archived";
  publishedAt?: string | null;
  closesAt?: string | null;
  viewCount: number;
  applicants: { total: number; stages: Record<string, number> };
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  open: "success",
  closed: "warning",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  open: "Dibuka",
  closed: "Ditutup",
  archived: "Diarsipkan",
};

const TYPE_LABEL: Record<string, string> = {
  full_time: "Penuh waktu",
  part_time: "Paruh waktu",
  contract: "Kontrak",
  internship: "Magang",
  freelance: "Lepas",
};

const ARRANGEMENT_LABEL: Record<string, string> = {
  onsite: "Di kantor",
  hybrid: "Hibrida",
  remote: "Jarak jauh",
};

export default function VacanciesPage() {
  const toast = useToast();
  const [items, setItems] = useState<Vacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"all" | "open" | "draft" | "closed">("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VacancyDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vacancy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (tab !== "all") qs.set("status", tab);
      if (query.trim()) qs.set("q", query.trim());
      const res = await api.get<Vacancy[]>(`/api/v1/vacancies?${qs}`);
      setItems(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, query, page, limit]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), query ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  const changeStatus = async (v: Vacancy, status: Vacancy["status"]) => {
    try {
      const res = await api.patch("/api/v1/vacancies", { id: v._id, status });
      toast.success("Status diperbarui", res.message);
      await load();
    } catch (err) {
      toast.error("Gagal memperbarui", errorMessage(err));
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/vacancies?id=${deleteTarget._id}`);
      toast.success("Dihapus", res.message);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Lowongan kerja"
        description="Buat, tayangkan, dan pantau lowongan beserta pelamarnya."
        actions={
          <>
            <Link href="/career" target="_blank">
              <Button variant="secondary" icon={ExternalLink}>
                Lihat halaman karier
              </Button>
            </Link>
            <Button
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Buat lowongan
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "all", label: "Semua" },
            { id: "open", label: "Dibuka" },
            { id: "draft", label: "Draf" },
            { id: "closed", label: "Ditutup" },
          ]}
        />
        <div className="relative flex-1 max-w-xs" style={{ minWidth: "14rem" }}>
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
            strokeWidth={ICON_STROKE}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul lowongan…"
            aria-label="Cari lowongan"
            className="pl-10"
          />
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonList rows={4} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={UserRoundSearch}
            title={query ? "Tidak ada lowongan yang cocok" : "Belum ada lowongan"}
            description={
              query
                ? "Coba kata kunci lain atau ubah penyaring status."
                : "Buat lowongan pertama Anda. Selama statusnya masih draf, lowongan tidak tampil di halaman karier."
            }
            action={
              !query ? (
                <Button
                  size="sm"
                  icon={Plus}
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  Buat lowongan
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((v) => (
            <Card key={v._id}>
              <CardBody className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[v.status]} dot>
                      {STATUS_LABEL[v.status]}
                    </Badge>
                    <Badge tone="neutral">{TYPE_LABEL[v.employmentType] ?? v.employmentType}</Badge>
                    <Badge tone="neutral">
                      {ARRANGEMENT_LABEL[v.workArrangement] ?? v.workArrangement}
                    </Badge>
                  </div>

                  <h3 className="mt-2.5 text-title-sm font-semibold text-heading truncate">
                    {v.title}
                  </h3>

                  <p className="mt-1 text-body-sm text-muted">
                    {[v.divisionId?.name, v.location || v.branchId?.name]
                      .filter(Boolean)
                      .join(" · ") || "Penempatan belum diatur"}
                    {v.openings > 1 && ` · ${v.openings} posisi`}
                  </p>

                  {v.showSalary && v.salaryMax > 0 && (
                    <p className="mt-1 text-body-sm text-muted">
                      {formatRupiah(v.salaryMin)} – {formatRupiah(v.salaryMax)}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-label text-subtle">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                      {v.applicants.total} pelamar
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                      {v.viewCount} kunjungan
                    </span>
                    {v.publishedAt && <span>Tayang {formatDate(v.publishedAt)}</span>}
                    {v.closesAt && <span>Ditutup {formatDate(v.closesAt)}</span>}
                  </div>

                  {v.applicants.total > 0 && (
                    <StageBar stages={v.stages} counts={v.applicants.stages} total={v.applicants.total} />
                  )}
                </div>

                <div className="flex flex-col items-stretch gap-2 shrink-0 w-full sm:w-auto">
                  <Link href={`/admin/vacancies/${v._id}`}>
                    <Button size="sm" icon={Users} className="w-full justify-center">
                      Kelola pelamar
                    </Button>
                  </Link>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 justify-center"
                      onClick={() => {
                        setEditing(toDraft(v));
                        setFormOpen(true);
                      }}
                    >
                      Ubah
                    </Button>
                    <Select
                      aria-label={`Ubah status lowongan ${v.title}`}
                      value={v.status}
                      onChange={(e) => changeStatus(v, e.target.value as Vacancy["status"])}
                      size="sm"
                      className="w-32"
                    >
                      <option value="draft">Draf</option>
                      <option value="open">Dibuka</option>
                      <option value="closed">Ditutup</option>
                      <option value="archived">Arsip</option>
                    </Select>
                  </div>

                  {v.status === "open" && (
                    <Link
                      href={`/career/${v.slug}`}
                      target="_blank"
                      className="text-label text-primary hover:underline text-center"
                    >
                      Lihat halaman publik
                    </Link>
                  )}

                  {v.applicants.total === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      className="text-danger justify-center"
                      onClick={() => setDeleteTarget(v)}
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / limit))}
            total={total}
            limit={limit}
            onPage={setPage}
            onLimit={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        </div>
      )}

      <VacancyForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title="Hapus lowongan?"
        confirmLabel="Ya, hapus"
        message={`Lowongan "${deleteTarget?.title}" akan dihapus permanen. Lowongan yang sudah menerima pelamar tidak dapat dihapus, arsipkan saja.`}
      />
    </div>
  );
}

/** Horizontal distribution of applicants across the selection stages. */
function StageBar({
  stages,
  counts,
  total,
}: {
  stages: string[];
  counts: Record<string, number>;
  total: number;
}) {
  return (
    <div className="mt-4 max-w-xl">
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-2">
        {stages.map((s, i) => {
          const n = counts[s] ?? 0;
          if (!n) return null;
          // Later stages read as further along, so the fill deepens toward the
          // end of the pipeline rather than using seven arbitrary colours.
          const opacity = 0.35 + (i / Math.max(stages.length - 1, 1)) * 0.65;
          return (
            <div
              key={s}
              className="bg-primary"
              style={{ width: `${(n / total) * 100}%`, opacity }}
              title={`${s}: ${n} pelamar`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {stages.map((s) => {
          const n = counts[s] ?? 0;
          if (!n) return null;
          return (
            <span key={s} className="text-caption text-subtle">
              {s} <span className="text-foreground font-medium tabular-nums">{n}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function toDraft(v: Vacancy): VacancyDraft {
  return {
    id: v._id,
    title: v.title,
    positionId: v.positionId?._id ?? "",
    divisionId: v.divisionId?._id ?? "",
    branchId: v.branchId?._id ?? "",
    employmentType: v.employmentType,
    workArrangement: v.workArrangement,
    location: v.location,
    summary: v.summary,
    responsibilities: v.responsibilities,
    requirements: v.requirements,
    niceToHave: v.niceToHave,
    benefits: v.benefits,
    salaryMin: v.salaryMin,
    salaryMax: v.salaryMax,
    showSalary: v.showSalary,
    openings: v.openings,
    stages: v.stages,
    status: v.status,
    closesAt: v.closesAt ? v.closesAt.slice(0, 10) : "",
  };
}
