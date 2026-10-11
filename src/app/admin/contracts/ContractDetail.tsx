"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, CalendarPlus, CheckCircle2, ExternalLink, FileSignature, FileText, Pencil, Printer, RotateCcw, Trash2, Undo2, UserCheck, XCircle } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  SkeletonList,
  Textarea,
  Toggle,
  cn,
} from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { FileOrLinkInput, attachmentProblem, toAttachmentInputs, type AttachmentItem } from "@/components/ui/FileOrLinkInput";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import {
  CONTRACT_STATUS_LABELS,
  DECISION_LABELS,
  PLACEHOLDERS,
  contractTypeLabel,
  durationLabel,
  type ContractStatus,
  type ContractType,
} from "@/lib/hr/contracts";
import { formatDate, formatRupiah, wibDateKey, isoOffset } from "@/lib/time";
import type { ContractFormInitial } from "./ContractForm";

interface Detail {
  contract: {
    _id: string;
    contractNumber: string;
    type: ContractType;
    customTypeLabel?: string;
    startDate: string;
    endDate?: string | null;
    positionName: string;
    salarySnapshot: { basicSalary: number; allowances: number };
    status: ContractStatus | "expired";
    decision: keyof typeof DECISION_LABELS;
    decisionNote: string;
    body: string;
    signedFile: string;
    signedFileName: string;
    signedAt?: string | null;
    notes: string;
    terminationReason?: string;
    terminatedAt?: string | null;
    nextContractId?: string | null;
    generatedFromTemplateId?: string | null;
    employeeId: { _id: string; name: string; employeeId: string; status: string } | null;
  };
  chain: Array<{ _id: string; contractNumber: string; type: string; customTypeLabel?: string; startDate: string; endDate?: string | null; status: string; decision: string }>;
  canEdit: boolean;
}

function nextDay(iso: string) {
  const d = new Date(new Date(iso).getTime() + 36 * 3600_000);
  return wibDateKey(d);
}

function statusTone(status: string) {
  return status === "active" ? "success" : status === "draft" ? "neutral" : status === "terminated" ? "danger" : "warning";
}

export function ContractDetail({
  id,
  onClose,
  onChanged,
  onCreateFollowUp,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onCreateFollowUp: (initial: ContractFormInitial) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"not_renew" | "terminate" | "body" | "signed" | "delete" | "terms" | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Detail>(`/api/v1/contracts/${id}`);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/v1/contracts/${id}`, body);
      toast.success("Tersimpan", res.message);
      setDialog(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api.patch(`/api/v1/contracts/${id}`, body);
      toast.success("Tersimpan", res.message);
      setDialog(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const c = data?.contract;
  const hasEnd = Boolean(c?.endDate);
  // Offered from 90 days before the end date; earlier than that it is noise.
  const decisionOpen =
    c &&
    hasEnd &&
    c.decision === "pending" &&
    !c.nextContractId &&
    ["active", "ended", "expired"].includes(c.status) &&
    new Date(c.endDate!).getTime() - now <= 90 * 86_400_000;

  const followUp = (permanent: boolean) => {
    if (!c) return;
    const start = c.endDate ? nextDay(c.endDate) : wibDateKey();
    let end = "";
    if (!permanent && c.endDate) {
      // Same length as the contract being renewed.
      const lengthMs = new Date(c.endDate).getTime() - new Date(c.startDate).getTime();
      end = wibDateKey(new Date(new Date(`${start}T00:00:00${isoOffset()}`).getTime() + lengthMs));
    }
    onCreateFollowUp({
      employeeId: c.employeeId?._id,
      employeeName: c.employeeId?.name,
      type: permanent ? "pkwtt" : c.type,
      customTypeLabel: c.customTypeLabel,
      startDate: start,
      endDate: end,
      positionName: c.positionName,
      basicSalary: c.salarySnapshot.basicSalary,
      allowances: c.salarySnapshot.allowances,
      previousContractId: c._id,
      title: permanent ? "Angkat jadi karyawan tetap" : "Perpanjang kontrak",
      note: permanent
        ? `Kontrak PKWTT mulai ${formatDate(`${start}T00:00:00${isoOffset()}`)}, sehari setelah ${c.contractNumber} berakhir.`
        : `Kontrak lanjutan dengan lama yang sama seperti ${c.contractNumber}. Ubah tanggal atau gaji bila ada kesepakatan baru.`,
    });
  };

  return (
    <Modal open onClose={onClose} size="lg" title={c ? `Kontrak ${c.contractNumber}` : "Kontrak"} description={c?.employeeId ? `${c.employeeId.name} · ${c.employeeId.employeeId}` : undefined}>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !c || !data ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{contractTypeLabel(c.type, c.customTypeLabel)}</Badge>
            <Badge tone={statusTone(c.status)}>{CONTRACT_STATUS_LABELS[(c.status === "expired" ? "ended" : c.status) as ContractStatus]}</Badge>
            {hasEnd && (
              <Badge tone={c.decision === "pending" ? "warning" : c.decision === "not_renew" ? "danger" : "success"}>
                {DECISION_LABELS[c.decision]}
              </Badge>
            )}
            {c.signedFile ? <Badge tone="success" icon={FileSignature}>Sudah ditandatangani</Badge> : <Badge tone="neutral">Belum ada berkas TTD</Badge>}
          </div>

          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 card p-4">
            <Info label="Masa berlaku" value={`${formatDate(c.startDate)} – ${c.endDate ? formatDate(c.endDate) : "tidak ditentukan"}`} />
            <Info label="Lama" value={durationLabel(wibDateKey(new Date(c.startDate)), c.endDate ? wibDateKey(new Date(c.endDate)) : null)} />
            <Info label="Jabatan" value={c.positionName || "—"} />
            <Info label="Gaji pokok / tunjangan" value={`${formatRupiah(c.salarySnapshot.basicSalary)} / ${formatRupiah(c.salarySnapshot.allowances)}`} />
            {c.decisionNote && <Info label="Catatan keputusan" value={c.decisionNote} wide />}
            {c.terminationReason && <Info label="Alasan diakhiri" value={`${c.terminationReason} (${formatDate(c.terminatedAt)})`} wide />}
            {c.notes && <Info label="Catatan" value={c.notes.replace("[auto-resign]", "").trim() || "—"} wide />}
          </dl>

          {decisionOpen && data.canEdit && (
            <Alert tone="warning" title="Perlu keputusan">
              <p>Kontrak ini {new Date(c.endDate!) < new Date() ? "sudah berakhir" : `berakhir ${formatDate(c.endDate)}`}. Pilih tindak lanjutnya:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={CalendarPlus} onClick={() => followUp(false)}>
                  Perpanjang
                </Button>
                {c.type !== "pkwtt" && (
                  <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => followUp(true)}>
                    Angkat karyawan tetap
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setDialog("not_renew")}>
                  Tidak diperpanjang
                </Button>
              </div>
            </Alert>
          )}

          <section>
            <p className="eyebrow mb-2">Dokumen</p>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <Link href={`/print/contract/${c._id}`} target="_blank" className="card p-3.5 flex items-center gap-3 hover:border-primary transition-colors">
                <Printer className="w-5 h-5 text-primary shrink-0" strokeWidth={ICON_STROKE} />
                <span className="min-w-0">
                  <span className="block text-body-sm font-semibold text-heading">Cetak / simpan PDF</span>
                  <span className="block text-label text-muted">{c.body ? "Dari template, siap ditandatangani" : "Belum ada isi dokumen"}</span>
                </span>
              </Link>
              {c.signedFile ? (
                <a href={c.signedFile} target="_blank" rel="noreferrer" className="card p-3.5 flex items-center gap-3 hover:border-primary transition-colors">
                  <FileText className="w-5 h-5 text-success shrink-0" strokeWidth={ICON_STROKE} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-sm font-semibold text-heading truncate">{c.signedFileName || "Berkas bertanda tangan"}</span>
                    <span className="block text-label text-muted">Diunggah {formatDate(c.signedAt)}</span>
                  </span>
                  <ExternalLink className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                </a>
              ) : (
                data.canEdit && (
                  <button type="button" onClick={() => setDialog("signed")} className="card p-3.5 flex items-center gap-3 hover:border-primary transition-colors text-left cursor-pointer">
                    <FileSignature className="w-5 h-5 text-primary shrink-0" strokeWidth={ICON_STROKE} />
                    <span className="min-w-0">
                      <span className="block text-body-sm font-semibold text-heading">Unggah kontrak bertanda tangan</span>
                      <span className="block text-label text-muted">PDF atau foto hasil pindai</span>
                    </span>
                  </button>
                )
              )}
            </div>
          </section>

          {data.chain.length > 1 && (
            <section>
              <p className="eyebrow mb-2">Riwayat kontrak karyawan ini</p>
              <ol className="space-y-1.5">
                {data.chain.map((k) => (
                  <li key={k._id} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2 border", k._id === c._id ? "border-primary bg-primary-soft" : "border-line")}>
                    <span className="text-body-sm">
                      <strong className="text-heading">{k.contractNumber}</strong>{" "}
                      <span className="text-muted">{contractTypeLabel(k.type, k.customTypeLabel)}</span>
                    </span>
                    <span className="text-label text-muted whitespace-nowrap">
                      {formatDate(k.startDate)} – {k.endDate ? formatDate(k.endDate) : "…"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.canEdit && (
            <div className="pt-4 border-t border-line flex flex-wrap gap-2">
              {c.status === "draft" && (
                <Button size="sm" icon={CheckCircle2} loading={busy} onClick={() => act({ action: "activate" })}>
                  Berlakukan
                </Button>
              )}
              {!c.signedFile && (
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setDialog("terms")}>
                  Ubah ketentuan
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={FileText} onClick={() => setDialog("body")}>
                {c.body ? "Ubah isi dokumen" : "Tulis isi dokumen"}
              </Button>
              {c.signedFile && (
                <Button size="sm" variant="ghost" icon={Undo2} loading={busy} onClick={() => patch({ signed: null })}>
                  Lepas berkas TTD
                </Button>
              )}
              {c.decision !== "pending" && !c.nextContractId && c.status !== "terminated" && (
                <Button size="sm" variant="ghost" icon={RotateCcw} loading={busy} onClick={() => act({ action: "reopen_decision" })}>
                  Batalkan keputusan
                </Button>
              )}
              {["active", "draft"].includes(c.status) && c.status !== "draft" && (
                <Button size="sm" variant="ghost" icon={Ban} className="text-danger" onClick={() => setDialog("terminate")}>
                  Akhiri lebih awal
                </Button>
              )}
              {c.status === "draft" && (
                <Button size="sm" variant="ghost" icon={Trash2} className="text-danger" onClick={() => setDialog("delete")}>
                  Hapus draf
                </Button>
              )}
            </div>
          )}

          {dialog === "not_renew" && <NotRenewDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(note, markResigned) => act({ action: "not_renew", note, markResigned })} />}
          {dialog === "terminate" && <TerminateDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(date, reason) => act({ action: "terminate", date, reason })} />}
          {dialog === "signed" && <SignedDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(signed) => patch({ signed })} />}
          {dialog === "body" && <BodyDialog busy={busy} initial={c.body} onClose={() => setDialog(null)} onSubmit={(body) => patch({ body })} />}
          {dialog === "terms" && (
            <TermsDialog
              busy={busy}
              contract={c}
              onClose={() => setDialog(null)}
              onSubmit={(terms) => patch(terms)}
            />
          )}
          <ConfirmDialog
            open={dialog === "delete"}
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              try {
                const res = await api.delete(`/api/v1/contracts/${id}`);
                toast.success("Dihapus", res.message);
                onChanged();
                onClose();
              } catch (err) {
                toast.error("Gagal", errorMessage(err));
              }
            }}
            title="Hapus draf kontrak?"
            message="Draf dihapus permanen. Kontrak sebelumnya (bila ada) kembali menunggu keputusan."
            confirmLabel="Hapus"
          />
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="text-body-sm text-foreground">{value}</dd>
    </div>
  );
}

function NotRenewDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (note: string, markResigned: boolean) => void }) {
  const [note, setNote] = useState("");
  const [markResigned, setMarkResigned] = useState(true);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Tidak diperpanjang"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={() => onSubmit(note.trim(), markResigned)}>
            Simpan keputusan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Alasan" required hint="Catatan internal HRD.">
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Toggle checked={markResigned} onChange={setMarkResigned} label="Nonaktifkan karyawan setelah kontrak berakhir" description="Status karyawan menjadi resign dan akun login ditutup pada tanggal berakhir." />
      </div>
    </Modal>
  );
}

function TerminateDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (date: string, reason: string) => void }) {
  const [date, setDate] = useState(() => wibDateKey());
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Akhiri kontrak lebih awal"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => onSubmit(date, reason.trim())}>
            Akhiri kontrak
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Berlaku per tanggal" required>
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="Alasan" required>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: Mengundurkan diri, PHK sesuai kesepakatan" />
        </Field>
        <Alert tone="info">Status karyawan tidak berubah otomatis. Ubah di Data Karyawan bila karyawan berhenti bekerja.</Alert>
      </div>
    </Modal>
  );
}

function SignedDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (signed: unknown) => void }) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const problem = attachmentProblem(items);
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Unggah kontrak bertanda tangan"
      description="Hasil pindai atau foto kontrak yang sudah ditandatangani kedua pihak. Karyawan dapat melihatnya di portal."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" loading={busy} disabled={!items.length || Boolean(problem)} onClick={() => onSubmit(toAttachmentInputs(items)[0])}>
            Simpan
          </Button>
        </>
      }
    >
      <FileOrLinkInput value={items} onChange={setItems} context="contract" />
    </Modal>
  );
}

function BodyDialog({ busy, initial, onClose, onSubmit }: { busy: boolean; initial: string; onClose: () => void; onSubmit: (body: string) => void }) {
  const [body, setBody] = useState(initial);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Isi dokumen kontrak"
      description="Perubahan hanya berlaku untuk kontrak ini, tidak mengubah template."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" loading={busy} onClick={() => onSubmit(body)}>Simpan</Button>
        </>
      }
    >
      <PlaceholderHelp onInsert={insert} />
      <Textarea ref={ref} rows={18} className="mt-3 font-mono text-body-sm" value={body} onChange={(e) => setBody(e.target.value)} />
    </Modal>
  );
}

export function PlaceholderHelp({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div>
      <p className="text-label text-muted">
        Format: <code># Judul</code>, <code>## Pasal</code>, <code>- poin</code>, <code>1. nomor</code>, <code>**tebal**</code>, baris kosong antarparagraf. Klik
        isian untuk menyisipkan:
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PLACEHOLDERS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onInsert(p.key)}
            title={`{{${p.key}}}`}
            className="px-2 py-0.5 rounded-md border border-line bg-surface-2 text-label hover:border-primary hover:text-primary transition-colors cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TermsDialog({
  busy,
  contract,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  contract: Detail["contract"];
  onClose: () => void;
  onSubmit: (terms: Record<string, unknown>) => void;
}) {
  const [startDate, setStartDate] = useState(wibDateKey(new Date(contract.startDate)));
  const [endDate, setEndDate] = useState(contract.endDate ? wibDateKey(new Date(contract.endDate)) : "");
  const [positionName, setPositionName] = useState(contract.positionName);
  const [basic, setBasic] = useState(contract.salarySnapshot.basicSalary);
  const [allow, setAllow] = useState(contract.salarySnapshot.allowances);
  const money = (v: number, set: (n: number) => void) => (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-body-sm text-subtle">Rp</span>
      <Input inputMode="numeric" className="pl-10 tabular-nums" value={v ? v.toLocaleString("id-ID") : ""} onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)} />
    </div>
  );
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Ubah ketentuan kontrak"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" loading={busy} onClick={() => onSubmit({ startDate, endDate: contract.endDate ? endDate : undefined, positionName, basicSalary: basic, allowances: allow })}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Tanggal mulai">
          <DatePicker value={startDate} onChange={setStartDate} />
        </Field>
        {contract.endDate && (
          <Field label="Tanggal berakhir">
            <DatePicker value={endDate} onChange={setEndDate} min={startDate} />
          </Field>
        )}
        <Field label="Jabatan" className="sm:col-span-2">
          <Input value={positionName} onChange={(e) => setPositionName(e.target.value)} />
        </Field>
        <Field label="Gaji pokok">{money(basic, setBasic)}</Field>
        <Field label="Tunjangan tetap">{money(allow, setAllow)}</Field>
      </div>
    </Modal>
  );
}
