"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { CalendarDays, CalendarPlus, History, Info, Paperclip, Trash2 } from "@/components/icons";
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
  Field,
  Input,
  Modal,
  Select,
  SkeletonCards,
  StatusBadge,
  Tabs,
  TableWrap,
  Td,
  Textarea,
  Th,
  type BadgeTone,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import {
  FileOrLinkInput,
  attachmentProblem,
  toAttachmentInputs,
  type AttachmentItem,
} from "@/components/ui/FileOrLinkInput";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateTime, wibDateKey } from "@/lib/time";

import { DatePicker } from "@/components/ui/DatePicker";
interface LeaveType {
  _id: string;
  name: string;
  description: string;
  quotaDays: number;
  requiresEvidence: boolean;
  minLeadDays: number;
  maxConsecutiveDays: number;
  deductsBalance: boolean;
  colorTone: BadgeTone;
  quotaMode: "annual" | "per_event" | "none";
  maxEventsPerYear?: number;
  isOther?: boolean;
  /** Worded by the server from the same rules it enforces. */
  rule: string;
  eventsThisYear: number;
}

interface Balance {
  _id: string;
  leaveTypeId: LeaveType | null;
  year: number;
  allocatedDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

interface LeaveRequest {
  _id: string;
  leaveTypeId: { name: string; colorTone?: BadgeTone } | null;
  customPurpose?: string;
  startDate: string;
  endDate: string;
  chargedDays: number;
  calendarDays: number;
  reason: string;
  status: string;
  createdAt: string;
  evidenceUrl?: string;
}

export default function LeavePage() {
  const toast = useToast();

  const [tab, setTab] = useState<"balance" | "history">("balance");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const historyLimit = 20;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [data, typeRes] = await Promise.all([
        api.get<{ balances: Balance[]; history: LeaveRequest[]; year: number; pendingCount: number }>(
          `/api/v1/leave?page=${historyPage}&limit=${historyLimit}`
        ),
        api.get<LeaveType[]>("/api/v1/leave?type=types"),
      ]);
      setBalances(data.data?.balances ?? []);
      setHistory(data.data?.history ?? []);
      setHistoryTotal(data.meta?.total ?? 0);
      setPendingTotal(data.data?.pendingCount ?? 0);
      setYear(data.data?.year ?? new Date().getFullYear());
      setTypes(typeRes.data ?? []);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [historyPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = pendingTotal;

  const cancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await api.delete(`/api/v1/leave?id=${cancelTarget._id}`);
      toast.success("Pengajuan dibatalkan", res.message);
      setCancelTarget(null);
      await load();
    } catch (err) {
      toast.error("Gagal membatalkan", errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        <SkeletonCards count={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Izin &amp; cuti</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">
            Saldo tahun {year}. Akhir pekan dan hari libur nasional tidak dihitung.
          </p>
        </div>
        <Button icon={CalendarPlus} onClick={() => setFormOpen(true)}>
          Ajukan izin / cuti
        </Button>
      </header>

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "balance", label: "Saldo & aturan", icon: CalendarDays },
          { id: "history", label: "Riwayat pengajuan", count: pendingCount, icon: History },
        ]}
      />

      {tab === "balance" && (
        <>
          <h2 className="eyebrow">Saldo tahunan</h2>
          {balances.length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarDays}
                title="Saldo belum tersedia"
                description="Hubungi HRD bila jenis cuti belum muncul untuk akun Anda."
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {balances.map((b) => {
                const type = b.leaveTypeId;
                if (!type) return null;
                const pct = b.allocatedDays
                  ? Math.round((b.remainingDays / b.allocatedDays) * 100)
                  : 0;
                return (
                  <div key={b._id} className="card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body font-semibold truncate">{type.name}</p>
                        <p className="text-caption text-subtle mt-0.5 line-clamp-2 leading-relaxed">
                          {type.description || "—"}
                        </p>
                      </div>
                      {!type.deductsBalance && (
                        <Badge tone="neutral">Tidak potong saldo</Badge>
                      )}
                    </div>

                    <div className="mt-4 flex items-baseline gap-1.5">
                      <span className="text-display font-semibold tabular-nums">{b.remainingDays}</span>
                      <span className="text-label text-muted">dari {b.allocatedDays} hari</span>
                    </div>

                    <div
                      className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Sisa saldo ${type.name}`}
                    >
                      <div
                        className={`h-full rounded-full ${pct > 40 ? "bg-success" : pct > 15 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>

                    <dl className="mt-3.5 grid grid-cols-2 gap-2 text-caption">
                      <div>
                        <dt className="text-subtle">Terpakai</dt>
                        <dd className="font-semibold tabular-nums">{b.usedDays} hari</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">Menunggu approval</dt>
                        <dd className="font-semibold tabular-nums">{b.pendingDays} hari</dd>
                      </div>
                    </dl>

                    {type.minLeadDays > 0 && (
                      <p className="mt-3 pt-3 border-t border-line text-caption text-subtle flex items-start gap-1.5">
                        <Info className="w-3 h-3 shrink-0 mt-0.5" />
                        Wajib diajukan minimal H-{type.minLeadDays}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {types.some((t) => t.quotaMode !== "annual") && (
            <>
              <h2 className="eyebrow pt-2">Izin khusus &amp; keperluan lain</h2>
              <p className="text-body-sm text-muted -mt-2 max-w-3xl leading-relaxed">
                Jenis di bawah ini tidak memotong saldo cuti tahunan. Batas harinya berlaku untuk setiap kejadian,
                jadi bila peristiwanya terjadi lagi, ajukan lagi sebagai pengajuan baru.
              </p>
              <Card>
                <ul className="divide-y divide-[var(--border)]">
                  {types
                    .filter((t) => t.quotaMode !== "annual")
                    .map((t) => (
                      <li key={t._id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                        <div className="sm:w-56 shrink-0">
                          <p className="text-body font-semibold text-heading">{t.name}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {t.quotaMode === "per_event" && <Badge tone="info">{t.quotaDays} hari / kejadian</Badge>}
                            {t.quotaMode === "none" && <Badge tone="neutral">Tanpa kuota</Badge>}
                            {t.requiresEvidence && <Badge tone="warning">Perlu bukti</Badge>}
                          </div>
                        </div>
                        <div className="min-w-0 text-body-sm text-muted leading-relaxed">
                          {t.description && <p className="text-foreground/85">{t.description}</p>}
                          <p className="mt-0.5">{t.rule}</p>
                          {t.eventsThisYear > 0 && (
                            <p className="mt-1 text-label text-subtle">
                              Sudah diajukan {t.eventsThisYear} kali tahun ini
                              {t.maxEventsPerYear ? ` dari batas ${t.maxEventsPerYear} kali` : ""}.
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}

      {tab === "history" && (
        <Card>
          <CardHeader title="Riwayat pengajuan" description={`${historyTotal} pengajuan tercatat.`} />
          <CardBody className="p-0">
            {history.length === 0 ? (
              <EmptyState
                icon={History}
                title="Belum ada pengajuan"
                description="Pengajuan izin dan cuti Anda akan tercatat di sini beserta statusnya."
                action={
                  <Button size="sm" icon={CalendarPlus} onClick={() => setFormOpen(true)}>
                    Ajukan izin / cuti
                  </Button>
                }
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Jenis</Th>
                    <Th>Periode</Th>
                    <Th>Durasi</Th>
                    <Th>Alasan</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h._id} className="hover:bg-surface-2 transition-colors">
                      <Td className="whitespace-nowrap font-medium">
                        {h.leaveTypeId?.name ?? "—"}
                        {h.customPurpose && (
                          <span className="block text-label font-normal text-muted">{h.customPurpose}</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-label">
                        {formatDate(h.startDate)} – {formatDate(h.endDate)}
                      </Td>
                      <Td className="whitespace-nowrap text-label">
                        <span className="font-semibold tabular-nums">{h.chargedDays} hari kerja</span>
                        {h.calendarDays !== h.chargedDays && (
                          <span className="block text-caption text-subtle">
                            {h.calendarDays} hari kalender
                          </span>
                        )}
                      </Td>
                      <Td className="max-w-72">
                        <span className="text-label text-muted line-clamp-2">{h.reason}</span>
                        {h.evidenceUrl && (
                          <a
                            href={h.evidenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-caption text-primary hover:underline"
                          >
                            <Paperclip className="w-3 h-3" />
                            Lihat lampiran
                          </a>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={h.status} />
                        <span className="block text-caption text-subtle mt-1">
                          {formatDateTime(h.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        {h.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            onClick={() => setCancelTarget(h)}
                            className="text-danger"
                          >
                            Batalkan
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "history" && historyTotal > historyLimit && (
        <Pagination
          page={historyPage}
          totalPages={Math.ceil(historyTotal / historyLimit)}
          total={historyTotal}
          limit={historyLimit}
          onPage={setHistoryPage}
        />
      )}

      <LeaveFormModal
        open={formOpen}
        types={types}
        balances={balances}
        onClose={() => setFormOpen(false)}
        onDone={() => {
          setFormOpen(false);
          setTab("history");
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancel}
        loading={cancelling}
        title="Batalkan pengajuan?"
        confirmLabel="Ya, batalkan"
        message={`Pengajuan ${cancelTarget?.leaveTypeId?.name ?? ""} ${cancelTarget ? `${formatDate(cancelTarget.startDate)} – ${formatDate(cancelTarget.endDate)}` : ""} akan dibatalkan. Bila jenisnya memakai saldo tahunan, harinya dikembalikan. Tindakan ini tidak dapat diurungkan.`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LeaveFormModal({
  open,
  types,
  balances,
  onClose,
  onDone,
}: {
  open: boolean;
  types: LeaveType[];
  balances: Balance[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [customPurpose, setCustomPurpose] = useState("");
  const [evidence, setEvidence] = useState<AttachmentItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLeaveTypeId(types[0]?._id ?? "");
    setStartDate("");
    setEndDate("");
    setReason("");
    setCustomPurpose("");
    setEvidence([]);
    setFileError("");
  }, [open, types]);

  const selected = types.find((t) => t._id === leaveTypeId);
  const balance = balances.find((b) => b.leaveTypeId?._id === leaveTypeId);

  // Earliest date the chosen type permits, so the picker cannot offer a date
  // the server will reject for lead time.
  const minDate = useMemo(() => {
    const lead = selected?.minLeadDays ?? 0;
    const d = new Date();
    d.setDate(d.getDate() + lead);
    return wibDateKey(d);
  }, [selected]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = attachmentProblem(evidence);
    setFileError(problem ?? "");
    if (problem) return;
    setSaving(true);
    try {
      const res = await api.post("/api/v1/leave", {
        leaveTypeId,
        startDate,
        endDate,
        reason: reason.trim(),
        customPurpose: selected?.isOther ? customPurpose.trim() : undefined,
        attachment: toAttachmentInputs(evidence)[0],
      });
      toast.success("Pengajuan terkirim", res.message);
      onDone();
    } catch (err) {
      toast.error("Pengajuan gagal", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajukan izin / cuti"
      description="Pengajuan akan diteruskan ke atasan dan HRD sesuai alur yang berlaku."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="leave-form" loading={saving}>
            Kirim pengajuan
          </Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={submit} className="space-y-4">
        <Field label="Jenis izin / cuti" required htmlFor="lv-type">
          <Select
            id="lv-type"
            required
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
          >
            <option value="" disabled>
              Pilih jenis…
            </option>
            {types.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        {selected && (
          <Alert tone="info">
            {selected.description && <span className="block mb-1">{selected.description}</span>}
            <span className="block">
              {selected.rule}
              {balance && selected.quotaMode === "annual" &&
                ` Sisa saldo Anda ${balance.remainingDays} dari ${balance.allocatedDays} hari.`}
              {selected.minLeadDays > 0 && ` Minimal diajukan H-${selected.minLeadDays}.`}
              {selected.requiresEvidence && " Wajib melampirkan bukti."}
            </span>
          </Alert>
        )}

        {selected?.isOther && (
          <Field
            label="Keperluan"
            required
            htmlFor="lv-purpose"
            hint="Singkat saja, misalnya Mengurus dokumen kependudukan atau Wisuda anak."
          >
            <Input
              id="lv-purpose"
              required
              maxLength={120}
              value={customPurpose}
              onChange={(e) => setCustomPurpose(e.target.value)}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal mulai" required htmlFor="lv-start">
            <DatePicker
              id="lv-start"
              required
              min={minDate}
              value={startDate}
              onChange={(value) => {
                setStartDate(value);
                if (!endDate || endDate < value) setEndDate(value);
              }}
            />
          </Field>
          <Field label="Tanggal selesai" required htmlFor="lv-end">
            <DatePicker
              id="lv-end"
              required
              min={startDate || minDate}
              value={endDate}
              onChange={(value) => setEndDate(value)}
            />
          </Field>
        </div>

        <Field
          label="Alasan"
          required
          htmlFor="lv-reason"
          hint="Minimal 10 karakter. Alasan yang jelas mempercepat persetujuan."
        >
          <Textarea
            id="lv-reason"
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Menghadiri pernikahan saudara kandung di Yogyakarta."
          />
        </Field>

        <Field
          label={`Lampiran bukti${selected?.requiresEvidence ? "" : " (opsional)"}`}
          htmlFor="lv-file"
          error={fileError}
          hint="Unggah foto atau PDF surat dokter/undangan, atau tempel tautan Google Drive."
        >
          <FileOrLinkInput
            id="lv-file"
            value={evidence}
            onChange={(next) => {
              setEvidence(next);
              setFileError("");
            }}
            context="leave"
            invalid={Boolean(fileError)}
            disabled={saving}
          />
        </Field>
      </form>
    </Modal>
  );
}
