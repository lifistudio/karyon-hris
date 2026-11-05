"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ListChecks, Plus, Search, Trash2, X } from "@/components/icons";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, SkeletonList, Textarea, Toggle, cn } from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { confirmDialog } from "@/components/ui/ConfirmHost";
import { useToast } from "@/components/ui/Toast";
import { Segmented } from "@/components/inventory/parts";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateLong, formatTime, wibDateKey, wibStartOfDay } from "@/lib/time";
import { PROOF_LABELS, TASK_STATUS_LABELS, taskDone, type ProofMode, type ProofType } from "@/lib/hr/attendance-tasks";
import { ProofView, TASK_TONE, type DayTask } from "./TodayTasks";

interface TeamRow {
  employee: { _id: string; name: string; employeeId: string; division: string | null; position: string | null; branch: string | null };
  clockIn: string | null;
  clockOut: string | null;
  summary: { total: number; done: number; pending: number; waitingReview: number };
  tasks: DayTask[];
}
interface Member { _id: string; name: string; employeeId: string; divisionId?: { name?: string } | null }
interface TeamData { isLead: boolean; date: string; rows: TeamRow[]; members: Member[]; teamSize?: number }

type Decision = { kind: "reject" | "waive"; task: DayTask };

/**
 * What a supervisor works from during the day: who still owes what, the proof
 * that came in, and a way to add or excuse a task. Shared by the admin panel
 * and the portal, because a store manager is often a plain STAFF account.
 */
export function TeamTasks() {
  const toast = useToast();
  const today = wibDateKey();
  const [date, setDate] = useState(today);
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<TeamData>(`/api/v1/attendance/tasks/team?date=${date}`, { cache: "no-store" });
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err, "Task tim gagal dimuat."));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) queueMicrotask(() => setDate(d));
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    try {
      const res = await api.post("/api/v1/attendance/tasks/team", body);
      toast.success("Tersimpan", res.message);
      void load();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    }
  };

  const remove = async (task: DayTask) => {
    const ok = await confirmDialog({ title: "Hapus task ini?", message: `"${task.title}" dihapus dari daftar karyawan.`, confirmLabel: "Hapus task", tone: "danger" });
    if (ok) void act({ action: "remove", taskId: task._id });
  };

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !onlyPending || r.summary.pending > 0 || r.summary.waitingReview > 0), [data, onlyPending]);
  const totals = useMemo(() => (data?.rows ?? []).reduce((sum, r) => ({ pending: sum.pending + (r.summary.pending ? 1 : 0), review: sum.review + r.summary.waitingReview }), { pending: 0, review: 0 }), [data]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!loading && data && !data.isLead) {
    return <Card><EmptyState icon={ListChecks} title="Anda belum memiliki anggota tim" description="Halaman ini untuk atasan. Anggota tim diatur HRD lewat kolom atasan di data karyawan." /></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <DatePicker value={date} onChange={(v) => setDate(v || today)} aria-label="Pilih tanggal" className="w-44" />
        <Toggle checked={onlyPending} onChange={setOnlyPending} label="Hanya yang belum selesai" />
        <div className="ms-auto"><Button icon={Plus} onClick={() => setAssigning(true)}>Beri task</Button></div>
      </div>

      {data && data.rows.length > 0 && (
        <p className="text-body-sm text-muted">
          {formatDateLong(date)}: {totals.pending} karyawan masih punya task terbuka{totals.review ? `, ${totals.review} bukti menunggu persetujuan Anda` : ""}.
        </p>
      )}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="p-5"><SkeletonList rows={4} /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={onlyPending ? "Semua task sudah selesai" : "Belum ada task pada tanggal ini"}
            description={onlyPending ? "Tidak ada anggota tim yang tertinggal." : "Task tetap muncul otomatis dari aturan. Anda juga bisa memberi task untuk hari tertentu."}
            action={!onlyPending ? <Button icon={Plus} onClick={() => setAssigning(true)}>Beri task</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const expanded = open === row.employee._id;
              return (
                <li key={row.employee._id}>
                  <button type="button" onClick={() => setOpen(expanded ? null : row.employee._id)} aria-expanded={expanded} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]">
                    <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform", expanded && "rotate-180")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-heading">{row.employee.name}</span>
                      <span className="block truncate text-body-sm text-muted">
                        {[row.employee.position, row.employee.branch].filter(Boolean).join(" · ") || row.employee.employeeId}
                        {row.clockIn ? ` · masuk ${formatTime(row.clockIn)}` : " · belum absen masuk"}
                        {row.clockOut ? ` · pulang ${formatTime(row.clockOut)}` : ""}
                      </span>
                    </span>
                    {row.summary.waitingReview > 0 && <Badge tone="info">{row.summary.waitingReview} perlu ditinjau</Badge>}
                    <span className={cn("shrink-0 text-body font-semibold tabular-nums", row.summary.pending ? "text-warning" : "text-success")}>{row.summary.done}/{row.summary.total}</span>
                  </button>
                  {expanded && (
                    <ul className="space-y-2 bg-background-secondary-default px-4 py-3">
                      {row.tasks.map((task) => (
                        <li key={task._id} className="space-y-2 rounded-xl bg-background-primary-default p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-heading">{task.title}</p>
                              {task.description && <p className="whitespace-pre-line text-body-sm text-muted">{task.description}</p>}
                            </div>
                            <Badge tone={TASK_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                          </div>
                          <ProofView task={task} />
                          {task.reviewNote && <p className="text-body-sm text-muted">Catatan: {task.reviewNote}</p>}
                          <div className="flex flex-wrap justify-end gap-2">
                            {task.status === "submitted" && (
                              <>
                                <Button size="sm" variant="secondary" icon={X} onClick={() => setDecision({ kind: "reject", task })}>Minta perbaikan</Button>
                                <Button size="sm" icon={Check} onClick={() => void act({ action: "review", decision: "approve", taskId: task._id, submittedAt: task.submittedAt })}>Setujui</Button>
                              </>
                            )}
                            {!taskDone(task) && <Button size="sm" variant="ghost" onClick={() => setDecision({ kind: "waive", task })}>Bebaskan</Button>}
                            {task.source === "assigned" && task.status === "pending" && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(task)}>Hapus</Button>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {assigning && data && <AssignModal members={data.members} date={date >= today ? date : today} onClose={() => setAssigning(false)} onDone={(msg) => { setAssigning(false); toast.success("Task dibuat", msg); void load(); }} />}
      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onSubmit={async (note) => {
            await act(decision.kind === "reject" ? { action: "review", decision: "reject", taskId: decision.task._id, note } : { action: "waive", taskId: decision.task._id, note });
            setDecision(null);
          }}
        />
      )}
    </div>
  );
}

function DecisionModal({ decision, onClose, onSubmit }: { decision: Decision; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const reject = decision.kind === "reject";
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={reject ? "Minta perbaikan bukti" : "Bebaskan task"}
      description={decision.task.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button loading={saving} disabled={note.trim().length < 5} onClick={async () => { setSaving(true); await onSubmit(note); setSaving(false); }}>{reject ? "Kirim ke karyawan" : "Bebaskan task"}</Button>
        </>
      }
    >
      <Field label={reject ? "Apa yang perlu diperbaiki?" : "Alasan pembebasan"} required hint="Tersimpan di catatan audit.">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={reject ? "Contoh: foto toko tidak terlihat jelas" : "Contoh: kunjungan dibatalkan klien"} />
      </Field>
    </Modal>
  );
}

const PROOFS: ProofType[] = ["text", "file", "link"];

/** Inclusive list of `YYYY-MM-DD` keys, capped so a typo cannot create a year of tasks. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = wibStartOfDay(from).getTime(); t <= wibStartOfDay(to).getTime() && out.length < 32; t += 86_400_000) out.push(wibDateKey(new Date(t + 3_600_000)));
  return out;
}

function AssignModal({ members, date, onClose, onDone }: { members: Member[]; date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [proofTypes, setProofTypes] = useState<ProofType[]>(["text"]);
  const [proofMode, setProofMode] = useState<ProofMode>("any");
  const [required, setRequired] = useState(true);
  const [requireReview, setRequireReview] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const today = wibDateKey();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.employeeId.toLowerCase().includes(q)) : members;
  }, [members, query]);
  const dates = useMemo(() => (to >= from ? daysBetween(from, to) : []), [from, to]);
  const allShown = shown.length > 0 && shown.every((m) => selected.includes(m._id));

  const submit = async () => {
    if (!dates.length || dates.length > 31) { setError("Pilih rentang tanggal 1 sampai 31 hari."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/v1/attendance/tasks/team", { action: "assign", employeeIds: selected, dates, title, description, proofTypes, proofMode, required, requireReview });
      onDone(res.message ?? "");
    } catch (err) {
      setError(errorMessage(err, "Task gagal dibuat."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Beri task"
      description="Task muncul di halaman presensi karyawan pada tanggal yang dipilih."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving} disabled={!selected.length || title.trim().length < 3}>
            {selected.length ? `Kirim ke ${selected.length} karyawan` : "Kirim"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Judul task" required>
          <Input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="Kunjungi 5 calon pelanggan di Bekasi" />
        </Field>
        <Field label="Keterangan">
          <Textarea rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="Foto papan nama toko dan catat hasil pertemuan" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dari tanggal" required>
            <DatePicker value={from} min={today} onChange={(v) => { setFrom(v || today); if ((v || today) > to) setTo(v || today); }} aria-label="Dari tanggal" />
          </Field>
          <Field label="Sampai tanggal" required hint={dates.length > 1 ? `${dates.length} hari, satu task per hari` : undefined}>
            <DatePicker value={to} min={from} onChange={(v) => setTo(v || from)} aria-label="Sampai tanggal" />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-body-sm font-medium text-foreground">Bukti yang harus dikirim</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {PROOFS.map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-2 text-body-sm text-foreground">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={proofTypes.includes(p)} onChange={(e) => setProofTypes(e.target.checked ? [...proofTypes, p] : proofTypes.filter((x) => x !== p))} />
                {PROOF_LABELS[p]}
              </label>
            ))}
          </div>
          {proofTypes.length > 1 && (
            <Segmented size="sm" label="Aturan bukti" value={proofMode} onChange={setProofMode} options={[{ value: "any", label: "Salah satu cukup" }, { value: "all", label: "Wajib semua" }]} />
          )}
          {!proofTypes.length && <p className="text-body-sm text-muted">Tanpa bukti: karyawan cukup menandai selesai.</p>}
        </fieldset>

        <div className="divide-y divide-line">
          <Toggle checked={required} onChange={setRequired} label="Wajib selesai" description="Task wajib ikut menahan absen pulang sesuai aturan karyawan." />
          <Toggle checked={requireReview} onChange={setRequireReview} label="Perlu persetujuan saya" description="Task baru dihitung selesai setelah bukti Anda setujui." />
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-body font-semibold text-heading">Karyawan ({selected.length})</h3>
            <button type="button" className="cursor-pointer text-body-sm font-medium text-primary hover:underline" onClick={() => setSelected(allShown ? selected.filter((id) => !shown.some((m) => m._id === id)) : [...new Set([...selected, ...shown.map((m) => m._id)])])}>
              {allShown ? "Hapus pilihan" : "Pilih semua"}
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Cari karyawan" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau NIP" className="ps-10" />
          </div>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-2xl bg-background-secondary-default">
            {shown.map((m) => (
              <li key={m._id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.includes(m._id)} onChange={(e) => setSelected(e.target.checked ? [...selected, m._id] : selected.filter((id) => id !== m._id))} />
                  <span className="min-w-0">
                    <span className="block truncate text-body text-heading">{m.name}</span>
                    <span className="block truncate text-label text-subtle">{[m.employeeId, m.divisionId?.name].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="px-4 py-3 text-body-sm text-muted">Tidak ada karyawan yang cocok.</li>}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
