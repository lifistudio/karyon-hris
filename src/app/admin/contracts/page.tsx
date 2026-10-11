"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlarmClock, FileSignature, FileText, FileWarning, Plus, Search, ShieldCheck } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ICON_STROKE,
  Input,
  PageHeader,
  SkeletonList,
  StatCard,
  Tabs,
  TableWrap,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { Pagination } from "@/components/ui/Pagination";
import { api, errorMessage } from "@/lib/client-api";
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPES, DECISION_LABELS, contractTypeLabel, type ContractStatus } from "@/lib/hr/contracts";
import { formatDate } from "@/lib/time";
import { ContractForm, type ContractFormInitial } from "./ContractForm";
import { ContractDetail } from "./ContractDetail";
import { TemplatesPanel } from "./TemplatesPanel";

interface Row {
  _id: string;
  contractNumber: string;
  type: string;
  customTypeLabel?: string;
  startDate: string;
  endDate?: string | null;
  status: ContractStatus | "expired";
  decision: keyof typeof DECISION_LABELS;
  daysLeft: number | null;
  hasSignedFile: boolean;
  employeeId: {
    _id: string;
    name: string;
    employeeId: string;
    divisionId?: { name: string } | null;
    positionId?: { name: string } | null;
  } | null;
}

interface Counts {
  within30: number;
  within60: number;
  overdue: number;
  active: number;
  unsigned: number;
}

type View = "expiring" | "all" | "templates";

export default function ContractsPage() {
  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <ContractsView />
    </Suspense>
  );
}

function daysBadge(r: Row) {
  if (r.daysLeft === null) return <Badge tone="neutral">Tanpa batas</Badge>;
  if (r.daysLeft < 0) return <Badge tone="danger">Lewat {Math.abs(r.daysLeft)} hari</Badge>;
  if (r.daysLeft === 0) return <Badge tone="danger">Berakhir hari ini</Badge>;
  if (r.daysLeft <= 30) return <Badge tone="warning">{r.daysLeft} hari lagi</Badge>;
  return <Badge tone="info">{r.daysLeft} hari lagi</Badge>;
}

function ContractsView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: session } = useSession();
  const canEdit = ["SUPERADMIN", "HRD"].includes(session?.user?.role ?? "");

  const view = (sp.get("view") as View) || "expiring";
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [days, setDays] = useState("60");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(sp.get("open"));
  const [form, setForm] = useState<ContractFormInitial | null>(null);
  const [company, setCompany] = useState({ name: "", address: "" });

  const setView = (v: View) => {
    const next = new URLSearchParams(sp.toString());
    next.set("view", v);
    next.delete("open");
    router.replace(`${pathname}?${next}`, { scroll: false });
    setPage(1);
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api
      .get<Record<string, unknown>>("/api/v1/settings")
      .then((r) => setCompany({ name: String(r.data?.company_name ?? ""), address: String(r.data?.company_address ?? "") }))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (view === "templates") return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view, page: String(page), limit: String(limit) });
      if (view === "expiring") params.set("days", days);
      if (type) params.set("type", type);
      if (status && view === "all") params.set("status", status);
      if (query) params.set("q", query);
      const res = await api.get<{ rows: Row[]; counts: Counts | null }>(`/api/v1/contracts?${params}`);
      setRows(res.data?.rows ?? []);
      setCounts(res.data?.counts ?? null);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [view, page, limit, days, type, status, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        eyebrow="Karyawan"
        title="Kontrak kerja"
        description="Pantau kontrak yang akan berakhir, putuskan perpanjangan, cetak dokumen dari template, dan simpan kontrak yang sudah ditandatangani."
        actions={
          canEdit && (
            <Button icon={Plus} onClick={() => setForm({})}>
              Buat kontrak
            </Button>
          )
        }
      />

      {counts && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard label="Berakhir ≤ 30 hari" value={counts.within30} icon={AlarmClock} tone={counts.within30 ? "warning" : "neutral"} hint="belum diputuskan" />
          <StatCard label="Lewat, belum diputuskan" value={counts.overdue} icon={FileWarning} tone={counts.overdue ? "danger" : "neutral"} />
          <StatCard label="Kontrak berlaku" value={counts.active} icon={ShieldCheck} tone="success" />
          <StatCard label="Belum ada berkas TTD" value={counts.unsigned} icon={FileSignature} tone={counts.unsigned ? "info" : "neutral"} hint="dari kontrak berlaku" />
        </div>
      )}

      <div className="mb-4">
        <Tabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { id: "expiring", label: "Perlu keputusan", icon: AlarmClock, count: counts ? counts.within60 + counts.overdue : undefined },
            { id: "all", label: "Semua kontrak", icon: FileSignature },
            { id: "templates", label: "Template dokumen", icon: FileText },
          ]}
        />
      </div>

      {view === "templates" ? (
        <TemplatesPanel canEdit={canEdit} companyName={company.name} companyAddress={company.address} />
      ) : (
        <>
          <Card className="p-3 sm:p-4 mb-4">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" strokeWidth={ICON_STROKE} />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIP, atau nomor kontrak" className="pl-10" aria-label="Cari kontrak" />
              </div>
              <Combobox value={type} onChange={(v) => { setType(v); setPage(1); }} options={CONTRACT_TYPES.map((t) => ({ value: t.value, label: t.label }))} placeholder="Semua jenis" clearable aria-label="Jenis kontrak" />
              {view === "expiring" ? (
                <Combobox
                  value={days}
                  onChange={(v) => { setDays(v || "60"); setPage(1); }}
                  options={[
                    { value: "30", label: "Berakhir dalam 30 hari" },
                    { value: "60", label: "Berakhir dalam 60 hari" },
                    { value: "90", label: "Berakhir dalam 90 hari" },
                    { value: "180", label: "Berakhir dalam 6 bulan" },
                  ]}
                  aria-label="Rentang waktu"
                />
              ) : (
                <Combobox
                  value={status}
                  onChange={(v) => { setStatus(v); setPage(1); }}
                  options={(["active", "draft", "ended", "terminated"] as ContractStatus[]).map((s) => ({ value: s, label: CONTRACT_STATUS_LABELS[s] }))}
                  placeholder="Semua status"
                  clearable
                  aria-label="Status kontrak"
                />
              )}
            </div>
          </Card>

          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : loading && !rows.length ? (
            <SkeletonList rows={6} />
          ) : !rows.length ? (
            <Card>
              <EmptyState
                icon={view === "expiring" ? ShieldCheck : FileSignature}
                title={view === "expiring" ? "Tidak ada kontrak yang perlu diputuskan" : "Belum ada kontrak"}
                description={
                  view === "expiring"
                    ? "Semua kontrak dengan tanggal berakhir di rentang ini sudah diperpanjang atau diputuskan."
                    : "Buat kontrak untuk karyawan, atau ubah penyaring."
                }
              />
            </Card>
          ) : (
            <div className={cn("transition-opacity", loading && "opacity-60")}>
              <div className="lg:hidden space-y-2.5">
                {rows.map((r) => (
                  <button key={r._id} type="button" onClick={() => setOpenId(r._id)} className="w-full text-left card p-4 hover:border-primary transition-colors cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body font-semibold text-heading truncate">{r.employeeId?.name ?? "—"}</p>
                        <p className="text-label text-muted">{r.contractNumber} · {contractTypeLabel(r.type, r.customTypeLabel)}</p>
                      </div>
                      {daysBadge(r)}
                    </div>
                    <p className="mt-2 text-label text-muted">
                      {formatDate(r.startDate)} – {r.endDate ? formatDate(r.endDate) : "…"}
                    </p>
                  </button>
                ))}
              </div>
              <Card className="hidden lg:block overflow-hidden">
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>Karyawan</Th>
                      <Th>Kontrak</Th>
                      <Th>Masa berlaku</Th>
                      <Th>{view === "expiring" ? "Sisa waktu" : "Status"}</Th>
                      <Th>Keputusan</Th>
                      <Th>Berkas</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Tr key={r._id}>
                        <Td>
                          <button type="button" onClick={() => setOpenId(r._id)} className="text-left cursor-pointer group">
                            <span className="block text-body-sm font-semibold text-heading group-hover:text-primary transition-colors">{r.employeeId?.name ?? "—"}</span>
                            <span className="block text-label text-muted">
                              {r.employeeId?.employeeId}
                              {r.employeeId?.positionId?.name ? ` · ${r.employeeId.positionId.name}` : ""}
                            </span>
                          </button>
                        </Td>
                        <Td>
                          <span className="block text-body-sm">{r.contractNumber}</span>
                          <span className="block text-label text-muted">{contractTypeLabel(r.type, r.customTypeLabel)}</span>
                        </Td>
                        <Td className="text-body-sm whitespace-nowrap">
                          {formatDate(r.startDate)} – {r.endDate ? formatDate(r.endDate) : "…"}
                        </Td>
                        <Td>
                          {view === "expiring" ? daysBadge(r) : (
                            <Badge tone={r.status === "active" ? "success" : r.status === "draft" ? "neutral" : r.status === "terminated" ? "danger" : "warning"}>
                              {CONTRACT_STATUS_LABELS[(r.status === "expired" ? "ended" : r.status) as ContractStatus]}
                            </Badge>
                          )}
                        </Td>
                        <Td className="text-label">
                          {r.endDate ? (
                            <span className={r.decision === "pending" ? "text-warning" : r.decision === "not_renew" ? "text-danger" : "text-success"}>
                              {DECISION_LABELS[r.decision]}
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </Td>
                        <Td>
                          {r.hasSignedFile ? (
                            <Badge tone="success" icon={FileSignature}>TTD</Badge>
                          ) : (
                            <span className="text-label text-subtle">Belum</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </Card>
              <Pagination
                className="mt-4"
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
        </>
      )}

      {openId && (
        <ContractDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onCreateFollowUp={(initial) => {
            setOpenId(null);
            setForm(initial);
          }}
        />
      )}
      {form && (
        <ContractForm
          initial={form}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            setForm(null);
            void load();
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}
