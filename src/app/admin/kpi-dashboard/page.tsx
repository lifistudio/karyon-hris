"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MeterBar } from "@/components/charts";
import { BarChart3, CircleCheck, ClipboardList, Layers, Plus, Printer, Target, Undo2, Users, FileText, FileUp, Send } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonCards,
  SkeletonList,
  StatCard,
  Tabs,
  TableWrap,
  Td,
  Th,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatRelative } from "@/lib/time";
import { KpiTemplateBuilder } from "./KpiTemplateBuilder";
import { EvaluationForm, type ExistingEvaluation } from "./EvaluationForm";
import { UploadEvaluationDialog } from "./UploadEvaluationDialog";
import { Pagination } from "@/components/ui/Pagination";
import { EVALUATION_STATUS_LABELS } from "@/lib/hr/kpi";

interface Overview {
  stats: {
    totalEvaluations: number;
    settledEvaluations: number;
    averageScore: number;
    templateCount: number;
    activeEmployees: number;
    coverage: number | null;
  };
  byStatus: Record<string, number>;
  divisionAverages: Array<{ name: string; average: number; count: number }>;
  distribution: Array<{ label: string; min: number; count: number }>;
  topPerformers: Array<{
    employeeName: string;
    divisionName: string;
    finalScore: number;
    gradeLabel: string;
    period: string;
  }>;
  periods: string[];
}

interface EvaluationRow {
  _id: string;
  period: string;
  finalScore: number;
  gradeLabel: string;
  status: string;
  updatedAt: string;
  employeeId: {
    _id: string;
    name: string;
    employeeId: string;
    divisionId?: { name: string } | null;
    positionId?: { name: string } | null;
  } | null;
  templateId: { _id: string; name: string } | null;
  source?: "form" | "uploaded";
  title?: string;
  uploadedFile?: string;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  submitted: "warning",
  acknowledged: "info",
  finalized: "success",
};

export default function KpiPage() {
  const [tab, setTab] = useState<"overview" | "evaluations" | "templates">("overview");

  return (
    <div>
      <PageHeader
        title="KPI & kinerja"
        description="Susun template penilaian, nilai karyawan, dan pantau hasilnya per divisi."
      />

      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "Ringkasan", icon: BarChart3 },
            { id: "evaluations", label: "Penilaian", icon: ClipboardList },
            { id: "templates", label: "Template", icon: Layers },
          ]}
        />
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "evaluations" && <EvaluationsTab />}
      {tab === "templates" && <KpiTemplateBuilder />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [period, setPeriod] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<Overview>(`/api/v1/kpi${period ? `?period=${period}` : ""}`);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonCards count={4} />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const maxDivision = Math.max(...data.divisionAverages.map((d) => d.average), 1);
  const totalDistribution = data.distribution.reduce((n, d) => n + d.count, 0);

  return (
    <div className="space-y-6">
      {data.periods.length > 0 && (
        <div className="flex items-center gap-3">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Saring periode"
            className="w-52"
          >
            <option value="">Semua periode</option>
            {data.periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Rata-rata nilai"
          value={data.stats.averageScore.toFixed(1)}
          hint={`dari ${data.stats.settledEvaluations} penilaian yang sudah dibagikan`}
          icon={Target}
          tone="primary"
        />
        <StatCard
          label="Menunggu tanggapan"
          value={data.byStatus.submitted ?? 0}
          hint="sudah dikirim, belum ditanggapi karyawan"
          icon={ClipboardList}
          tone={data.byStatus.submitted ? "warning" : "neutral"}
        />
        <StatCard
          label="Sudah final"
          value={data.byStatus.finalized ?? 0}
          hint="terkunci dan dapat diunduh karyawan"
          icon={CircleCheck}
          tone="success"
        />
        <StatCard
          label={period ? "Cakupan periode" : "Karyawan aktif"}
          value={period && data.stats.coverage !== null ? `${data.stats.coverage}%` : data.stats.activeEmployees}
          hint={period ? `dari ${data.stats.activeEmployees} karyawan aktif` : `${data.stats.templateCount} template aktif`}
          icon={Users}
        />
      </div>

      {data.byStatus.draft > 0 && (
        <Alert tone="info" title={`${data.byStatus.draft} penilaian masih berstatus draf`}>
          Draf hanya terlihat oleh penilainya dan belum sampai ke karyawan. Kirimkan agar karyawan
          dapat menanggapi.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader
            title="Rata-rata per divisi"
            icon={BarChart3}
            description="Hanya penilaian yang sudah dibagikan ke karyawan yang dihitung."
          />
          <CardBody>
            {data.divisionAverages.length === 0 ? (
              <p className="text-body-sm text-muted py-6 text-center">Belum ada data penilaian.</p>
            ) : (
              <ul className="space-y-4">
                {data.divisionAverages.map((d) => (
                  <li key={d.name}>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-body-sm font-medium text-foreground truncate">{d.name}</span>
                      <span className="text-body-sm text-muted shrink-0">
                        <strong className="text-foreground tabular-nums">{d.average.toFixed(1)}</strong>
                        <span className="text-subtle"> · {d.count} orang</span>
                      </span>
                    </div>
                    <MeterBar percent={(d.average / maxDivision) * 100} tone={6} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sebaran predikat" icon={Target} />
          <CardBody>
            {totalDistribution === 0 ? (
              <p className="text-body-sm text-muted py-6 text-center">Belum ada data penilaian.</p>
            ) : (
              <ul className="space-y-3.5">
                {data.distribution.map((d, i) => {
                  const tones = [7, 6, 8, 3] as const;
                  const pct = Math.round((d.count / totalDistribution) * 100);
                  return (
                    <li key={d.label}>
                      <div className="flex items-baseline justify-between gap-3 mb-1.5">
                        <span className="text-body-sm text-foreground">
                          {d.label}
                          <span className="text-subtle"> · ≥ {d.min}</span>
                        </span>
                        <span className="text-body-sm text-muted tabular-nums">
                          {d.count} orang ({pct}%)
                        </span>
                      </div>
                      <MeterBar percent={pct} tone={tones[i] ?? 6} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {data.topPerformers.length > 0 && (
        <Card>
          <CardHeader title="Nilai tertinggi" icon={Target} />
          <CardBody className="p-0">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Karyawan</Th>
                  <Th>Divisi</Th>
                  <Th>Periode</Th>
                  <Th className="text-right">Nilai</Th>
                  <Th>Predikat</Th>
                </tr>
              </thead>
              <tbody>
                {data.topPerformers.map((p, i) => (
                  <Tr key={`${p.employeeName}-${i}`}>
                    <Td className="font-medium">{p.employeeName}</Td>
                    <Td className="text-muted">{p.divisionName}</Td>
                    <Td className="text-muted">{p.period}</Td>
                    <Td className="text-right font-semibold tabular-nums">
                      {p.finalScore.toFixed(1)}
                    </Td>
                    <Td>
                      <Badge tone="success">{p.gradeLabel || "—"}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EvaluationsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExistingEvaluation | null>(null);
  const [confirm, setConfirm] = useState<{ row: EvaluationRow; action: "finalize" | "return" | "share" } | null>(
    null
  );
  const [acting, setActing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status !== "all") qs.set("status", status);
      if (period.trim()) qs.set("period", period.trim());
      const res = await api.get<EvaluationRow[]>(`/api/v1/kpi/evaluations?${qs}`);
      setRows(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, period, page, limit]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), period ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, period]);

  const openEdit = async (row: EvaluationRow) => {
    try {
      const res = await api.get<ExistingEvaluation>(`/api/v1/kpi/evaluations?id=${row._id}`);
      setEditing(res.data ?? null);
      setFormOpen(true);
    } catch (err) {
      toast.error("Gagal memuat penilaian", errorMessage(err));
    }
  };

  const act = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      const res = await api.patch("/api/v1/kpi/evaluations", {
        id: confirm.row._id,
        action: confirm.action,
      });
      toast.success("Berhasil", res.message);
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error("Gagal memproses", errorMessage(err));
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Saring status"
          className="w-52"
        >
          <option value="all">Semua status</option>
          {Object.entries(EVALUATION_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="Periode, misalnya 2026-Q3"
          aria-label="Saring periode"
          className="w-56"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={FileUp} onClick={() => setUploadOpen(true)}>
            Unggah PDF
          </Button>
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Buat penilaian
          </Button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonList rows={4} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="Belum ada penilaian"
            description="Buat penilaian pertama dengan memilih karyawan, template, dan periodenya."
            action={
              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Buat penilaian
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Karyawan</Th>
                  <Th>Template</Th>
                  <Th>Periode</Th>
                  <Th className="text-right">Nilai</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row._id}>
                    <Td>
                      <span className="block text-body-sm font-medium text-foreground">
                        {row.employeeId?.name ?? "Karyawan dihapus"}
                      </span>
                      <span className="block text-label text-subtle mt-0.5">
                        {row.employeeId?.divisionId?.name ?? "—"}
                      </span>
                    </Td>
                    <Td className="text-muted text-body-sm">
                      {row.source === "uploaded" ? (
                        <>
                          {row.title || "Penilaian unggahan"}
                          <span className="block text-caption text-subtle">PDF unggahan</span>
                        </>
                      ) : (
                        row.templateId?.name ?? "—"
                      )}
                    </Td>
                    <Td className="text-muted text-body-sm">{row.period}</Td>
                    <Td className="text-right">
                      <span className="text-body font-semibold tabular-nums">
                        {row.finalScore.toFixed(1)}
                      </span>
                      {row.gradeLabel && (
                        <span className="block text-caption text-subtle mt-0.5">{row.gradeLabel}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"} dot>
                        {EVALUATION_STATUS_LABELS[row.status as keyof typeof EVALUATION_STATUS_LABELS] ??
                          row.status}
                      </Badge>
                      <span className="block text-caption text-subtle mt-1">
                        {formatRelative(row.updatedAt)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {row.status !== "finalized" && row.source !== "uploaded" && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                            Ubah
                          </Button>
                        )}
                        {row.source === "uploaded" && row.status === "draft" && (
                          <Button variant="ghost" size="sm" icon={Send} onClick={() => setConfirm({ row, action: "share" })}>
                            Bagikan
                          </Button>
                        )}
                        {row.status === "submitted" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Undo2}
                            onClick={() => setConfirm({ row, action: "return" })}
                          >
                            Tarik
                          </Button>
                        )}
                        {(row.status === "acknowledged" || row.status === "submitted") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={CircleCheck}
                            className="text-success"
                            onClick={() => setConfirm({ row, action: "finalize" })}
                          >
                            Finalkan
                          </Button>
                        )}
                        {row.source === "uploaded" ? (
                          <a href={row.uploadedFile} target="_blank" rel="noreferrer">
                            <Button variant="ghost" size="sm" icon={FileText}>
                              Buka PDF
                            </Button>
                          </a>
                        ) : (
                          <Link href={`/print/kpi/${row._id}`} target="_blank">
                            <Button variant="ghost" size="sm" icon={Printer}>
                              Cetak
                            </Button>
                          </Link>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </CardBody>
        </Card>
      )}

      {rows.length > 0 && (
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
      )}

      {uploadOpen && (
        <UploadEvaluationDialog
          onClose={() => setUploadOpen(false)}
          onSaved={() => {
            setUploadOpen(false);
            void load();
          }}
        />
      )}

      <EvaluationForm
        open={formOpen}
        existing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        loading={acting}
        tone={confirm?.action === "return" ? "danger" : "primary"}
        title={confirm?.action === "finalize" ? "Finalkan penilaian?" : confirm?.action === "share" ? "Bagikan ke karyawan?" : "Tarik kembali penilaian?"}
        confirmLabel={confirm?.action === "finalize" ? "Ya, finalkan" : confirm?.action === "share" ? "Bagikan" : "Ya, tarik"}
        message={
          confirm?.action === "share"
            ? `Dokumen penilaian ${confirm.row.employeeId?.name ?? ""} periode ${confirm.row.period} akan terlihat di portal karyawan dan karyawan menerima notifikasi.`
            : confirm?.action === "finalize"
            ? `Penilaian ${confirm.row.employeeId?.name ?? ""} periode ${confirm?.row.period} akan dikunci dan tidak dapat diubah lagi. Karyawan menerima notifikasi dan dapat mengunduh dokumennya.`
            : `Penilaian akan kembali menjadi draf dan hilang dari portal karyawan sampai Anda mengirimkannya lagi.`
        }
      />
    </div>
  );
}
