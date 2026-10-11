"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, History, Search, ShieldCheck } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  TableWrap,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, wibDateKey } from "@/lib/time";

import { DatePicker } from "@/components/ui/DatePicker";
interface Actor {
  name: string;
  nip: string;
  email: string;
  role: string;
}

interface AuditEntry {
  _id: string;
  action: string;
  module: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
  actor: Actor;
}

/** Groups actions into tones so a page of log lines is scannable at a glance. */
function toneFor(action: string): BadgeTone {
  if (/DELETE|REJECT|LOCK|DEACTIVATE/.test(action)) return "danger";
  if (/CREATE|APPROVE|GENERATE/.test(action)) return "success";
  if (/UPDATE|CHANGE|RESET/.test(action)) return "warning";
  if (/VIEW|EXPORT|LOGIN/.test(action)) return "info";
  return "neutral";
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [filters, setFilters] = useState<{ modules: string[]; actions: string[] }>({
    modules: [],
    actions: [],
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "50" });
      if (moduleFilter !== "all") qs.set("module", moduleFilter);
      if (actionFilter !== "all") qs.set("action", actionFilter);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);

      const res = await api.get<{ logs: AuditEntry[]; filters: typeof filters }>(
        `/api/v1/audit?${qs}`
      );
      setLogs(res.data?.logs ?? []);
      setFilters(res.data?.filters ?? { modules: [], actions: [] });
      setTotalPages(res.meta?.totalPages ?? 1);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, moduleFilter, actionFilter, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to the first page whenever a filter narrows the result set, otherwise
  // the user lands on an out-of-range page and sees an empty table.
  useEffect(() => {
    setPage(1);
  }, [moduleFilter, actionFilter, from, to]);

  const exportCsv = () => {
    const rows = logs.map((l) => [
      formatDateTime(l.timestamp),
      l.actor.name,
      l.actor.nip,
      l.actor.role,
      l.module,
      l.action,
      l.ip ?? "",
    ]);
    const header = ["Waktu", "Nama", "NIP", "Peran", "Modul", "Aksi", "IP"];
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${wibDateKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Aktivitas audit</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">
            Jejak seluruh tindakan berkonsekuensi di dalam sistem.
          </p>
        </div>
        <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={logs.length === 0}>
          Ekspor halaman ini
        </Button>
      </header>

      <Alert tone="info" title="Apa saja yang dicatat">
        Login dan penguncian akun, perubahan data karyawan, seluruh keputusan persetujuan,
        pembuatan slip gaji, pembukaan dokumen sensitif, perubahan pengaturan, dan perubahan hak
        akses. Nilai terenkripsi ditampilkan sebagai penanda, bukan nilai aslinya.
      </Alert>

      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Modul" htmlFor="au-module">
            <Select id="au-module" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              <option value="all">Semua modul</option>
              {filters.modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aksi" htmlFor="au-action">
            <Select id="au-action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">Semua aksi</option>
              {filters.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dari tanggal" htmlFor="au-from">
            <DatePicker id="au-from" value={from} onChange={(value) => setFrom(value)} />
          </Field>
          <Field label="Sampai tanggal" htmlFor="au-to">
            <DatePicker id="au-to" value={to} onChange={(value) => setTo(value)} />
          </Field>
        </CardBody>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonList rows={6} />
      ) : logs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Tidak ada catatan"
            description="Tidak ditemukan aktivitas yang cocok dengan penyaring yang Anda pilih."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            icon={History}
            title="Catatan aktivitas"
            description={`${total.toLocaleString("id-ID")} catatan · halaman ${page} dari ${totalPages}.`}
          />
          <CardBody className="p-0">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Pelaku</Th>
                  <Th>Aksi</Th>
                  <Th>Modul</Th>
                  <Th>IP</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-surface-2 transition-colors">
                    <Td className="whitespace-nowrap text-label">{formatDateTime(log.timestamp)}</Td>
                    <Td>
                      <span className="block text-label font-semibold">{log.actor.name}</span>
                      <span className="block text-caption text-subtle">
                        {log.actor.nip !== "-" ? `${log.actor.nip} · ` : ""}
                        {log.actor.role}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={toneFor(log.action)}>{log.action}</Badge>
                    </Td>
                    <Td className="text-label text-muted">{log.module}</Td>
                    <Td className="text-caption font-mono text-subtle">{log.ip || "-"}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={() => setDetail(log)}>
                        Detail
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </CardBody>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line">
              <Button
                variant="secondary"
                size="sm"
                icon={ChevronLeft}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Sebelumnya
              </Button>
              <span className="text-label text-muted tabular-nums">
                Halaman {page} dari {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Berikutnya
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.action} · ${detail.module}` : ""}
        description={detail ? formatDateTime(detail.timestamp) : ""}
        size="lg"
      >
        {detail && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Meta label="Pelaku" value={`${detail.actor.name} (${detail.actor.role})`} />
              <Meta label="NIP" value={detail.actor.nip} />
              <Meta label="Email" value={detail.actor.email} />
              <Meta label="Alamat IP" value={detail.ip || "-"} mono />
            </div>

            {detail.userAgent && (
              <Meta label="Perangkat" value={detail.userAgent} mono />
            )}

            {detail.before != null && (
              <JsonBlock title="Nilai sebelum" value={detail.before} />
            )}
            {detail.after != null && <JsonBlock title="Nilai sesudah" value={detail.after} />}

            <p className="flex items-start gap-1.5 text-caption text-subtle leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Catatan audit bersifat permanen dan tidak dapat diubah atau dihapus dari antarmuka ini.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={`text-label mt-0.5 break-words ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <pre className="rounded-lg border border-line bg-surface-2 p-3 text-label leading-relaxed overflow-x-auto max-h-64">
        <code className="font-mono">{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}
