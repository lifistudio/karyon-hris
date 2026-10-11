"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { EyeOff, Lock, MessageSquareWarning, Paperclip, User } from "@/components/icons";
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
  Modal,
  Select,
  SkeletonList,
  StatusBadge,
  Tabs,
  Textarea,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/time";
import { COMPLAINT_TARGET_LABELS } from "@/lib/hr/labels";

const CATEGORIES: Record<string, string> = {
  etik: "Pelanggaran etik",
  pelecehan: "Pelecehan / diskriminasi",
  keselamatan: "Keselamatan kerja",
  fasilitas: "Fasilitas kantor",
  atasan: "Hubungan atasan/rekan",
  lainnya: "Lainnya",
};

const STATUS_OPTIONS = [
  { value: "received", label: "Diterima" },
  { value: "in_progress", label: "Sedang diproses" },
  { value: "resolved", label: "Selesai" },
  { value: "rejected", label: "Ditolak / tidak terbukti" },
];

interface Complaint {
  _id: string;
  ticketCode: string;
  subject: string;
  description: string;
  category: string;
  target: string;
  isAnonymous: boolean;
  isIdentityRevealed: boolean;
  employeeId: { name: string; employeeId: string } | null;
  status: string;
  createdAt: string;
  attachments?: string;
  responses: Array<{ _id?: string; message: string; createdAt: string; isInternal?: boolean }>;
}

export default function AdminComplaintsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [active, setActive] = useState<Complaint | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ open: 0, closed: 0 });

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{ items: Complaint[]; asHandler: boolean; counts: { open: number; closed: number } }>(
        `/api/v1/complaints?state=${tab}&page=${page}&limit=${limit}`
      );
      setItems(res.data?.items ?? []);
      setCounts(res.data?.counts ?? { open: 0, closed: 0 });
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = items;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Pengaduan karyawan</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Tindak lanjuti laporan yang ditujukan kepada peran Anda.
        </p>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}

      <Alert tone="warning" title="Perlakukan laporan ini sebagai informasi rahasia">
        Isi pengaduan hanya boleh dibahas dengan pihak yang berkepentingan dalam penanganan kasus.
        Identitas pelapor anonim tidak boleh diungkap kepada terlapor dalam keadaan apa pun.
      </Alert>

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
        tabs={[
          { id: "open", label: "Perlu ditangani", count: counts.open, icon: MessageSquareWarning },
          { id: "closed", label: "Selesai", count: counts.closed },
        ]}
      />

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareWarning}
            title={tab === "open" ? "Tidak ada pengaduan aktif" : "Belum ada pengaduan selesai"}
            description={
              tab === "open"
                ? "Semua laporan yang ditujukan kepada Anda sudah ditangani."
                : "Laporan yang sudah diselesaikan akan tercatat di sini."
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title={tab === "open" ? "Perlu ditangani" : "Riwayat penanganan"} description={`${total} tiket.`} />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--border)]">
              {shown.map((c) => (
                <li key={c._id}>
                  <button
                    onClick={() => setActive(c)}
                    className="w-full text-left px-5 py-4 hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-label font-mono text-subtle">{c.ticketCode}</span>
                          <Badge tone="neutral">{CATEGORIES[c.category] ?? c.category}</Badge>
                          <Badge tone="primary">{COMPLAINT_TARGET_LABELS[c.target] ?? c.target}</Badge>
                        </div>
                        <p className="text-body font-semibold mt-1.5 truncate">{c.subject}</p>
                        <p className="text-caption text-subtle mt-0.5 flex items-center gap-1.5">
                          {c.isAnonymous && !c.isIdentityRevealed ? (
                            <>
                              <EyeOff className="w-3 h-3" />
                              Pelapor anonim
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3" />
                              {c.employeeId?.name ?? "Tidak diketahui"}
                              {c.isAnonymous && " (anonim, identitas dibuka untuk HRD/Audit)"}
                            </>
                          )}
                          {" · "}
                          {formatDateTime(c.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {total > 0 && (
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

      <HandleModal
        complaint={active}
        onClose={() => setActive(null)}
        onDone={() => {
          setActive(null);
          void load();
        }}
      />
    </div>
  );
}

function HandleModal({
  complaint,
  onClose,
  onDone,
}: {
  complaint: Complaint | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState("received");
  const [message, setMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (complaint) {
      setStatus(complaint.status);
      setMessage("");
      setIsInternal(false);
    }
  }, [complaint]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaint) return;
    setSaving(true);
    try {
      const res = await api.patch("/api/v1/complaints", {
        id: complaint._id,
        status: status !== complaint.status ? status : undefined,
        message: message.trim() || undefined,
        isInternal,
      });
      toast.success("Tersimpan", res.message);
      onDone();
    } catch (err) {
      toast.error("Gagal memperbarui", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(complaint)}
      onClose={onClose}
      title={complaint ? `${complaint.ticketCode} — ${complaint.subject}` : ""}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Tutup
          </Button>
          <Button
            size="sm"
            type="submit"
            form="handle-form"
            loading={saving}
            disabled={!message.trim() && status === complaint?.status}
          >
            Simpan tindak lanjut
          </Button>
        </>
      }
    >
      {complaint && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={complaint.status} />
            <Badge tone="primary">{COMPLAINT_TARGET_LABELS[complaint.target] ?? complaint.target}</Badge>
            <Badge tone="neutral">{CATEGORIES[complaint.category] ?? complaint.category}</Badge>
            {complaint.isAnonymous && (
              <Badge tone="warning" icon={EyeOff}>
                Anonim
              </Badge>
            )}
          </div>

          <div className="rounded-lg bg-surface-2 border border-line p-3.5">
            <p className="eyebrow mb-1">Pelapor</p>
            <p className="text-body">
              {complaint.isAnonymous && !complaint.isIdentityRevealed
                ? "Identitas disembunyikan sesuai permintaan pelapor."
                : `${complaint.employeeId?.name ?? "Tidak diketahui"} (${complaint.employeeId?.employeeId ?? "-"})`}
            </p>
            <p className="text-caption text-subtle mt-1">Dilaporkan {formatDateTime(complaint.createdAt)}</p>
          </div>

          <div>
            <p className="eyebrow mb-1.5">Uraian</p>
            <p className="text-body leading-relaxed whitespace-pre-wrap">{complaint.description}</p>
            {complaint.attachments && (
              <a
                href={complaint.attachments}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-label font-semibold text-primary hover:underline"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Buka lampiran bukti
              </a>
            )}
          </div>

          {complaint.responses.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">
                Riwayat tindak lanjut
              </p>
              <ul className="space-y-2">
                {complaint.responses.map((r, i) => (
                  <li key={r._id ?? i} className="rounded-lg bg-surface-2 border border-line p-3">
                    <p className="text-label leading-relaxed whitespace-pre-wrap">{r.message}</p>
                    <p className="text-caption text-subtle mt-1.5 flex items-center gap-1.5">
                      {r.isInternal && (
                        <span className="inline-flex items-center gap-1 text-warning font-semibold">
                          <Lock className="w-2.5 h-2.5" />
                          Catatan internal
                        </span>
                      )}
                      {formatDateTime(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form id="handle-form" onSubmit={submit} className="space-y-4 pt-4 border-t border-line">
            <Field label="Ubah status" htmlFor="cm-status">
              <Select id="cm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Tanggapan"
              htmlFor="cm-message"
              hint="Tanggapan non-internal akan terbaca oleh pelapor beserta notifikasinya."
            >
              <Textarea
                id="cm-message"
                maxLength={3000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tuliskan langkah yang sudah atau akan diambil…"
              />
            </Field>

            <div className="rounded-lg border border-line p-3">
              <Toggle
                checked={isInternal}
                onChange={setIsInternal}
                label="Simpan sebagai catatan internal"
                description="Hanya terlihat oleh penangan pengaduan, tidak dikirimkan ke pelapor."
              />
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
