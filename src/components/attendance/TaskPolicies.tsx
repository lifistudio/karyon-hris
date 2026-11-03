"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Edit, ListChecks, Plus, Search, Trash2 } from "@/components/icons";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, SkeletonList, Textarea, Toggle, cn } from "@/components/ui";
import { confirmDialog } from "@/components/ui/ConfirmHost";
import { useToast } from "@/components/ui/Toast";
import { Segmented } from "@/components/inventory/parts";
import { api, errorMessage } from "@/lib/client-api";
import { PROOF_LABELS, WEEKDAY_LABELS, type PolicyTask, type ProofType } from "@/lib/hr/attendance-tasks";

interface Option { _id: string; name: string; employeeId?: string }
interface Options { roles: Option[]; divisions: Option[]; positions: Option[]; branches: Option[]; employees: Option[] }
interface Policy {
  _id?: string;
  name: string;
  isActive: boolean;
  roleIds: string[];
  divisionIds: string[];
  positionIds: string[];
  employeeIds: string[];
  branchIds: string[];
  tasks: PolicyTask[];
  blockClockOut: boolean;
  countsAttendance: boolean;
  requireReview: boolean;
}

const BLANK: Policy = { name: "", isActive: true, roleIds: [], divisionIds: [], positionIds: [], employeeIds: [], branchIds: [], tasks: [], blockClockOut: true, countsAttendance: true, requireReview: false };

const PROOFS: ProofType[] = ["text", "file", "link"];
const newTask = (): PolicyTask => ({ id: `t-${Math.random().toString(36).slice(2, 10)}`, title: "", description: "", proofTypes: ["text"], proofMode: "any", required: true, weekdays: [] });

/** Plain-language summary of who a policy reaches, for the list. */
function audience(policy: Policy, options: Options) {
  const names = (ids: string[], list: Option[]) => ids.map((id) => list.find((o) => o._id === id)?.name).filter(Boolean);
  const parts = [...names(policy.roleIds, options.roles), ...names(policy.divisionIds, options.divisions), ...names(policy.positionIds, options.positions)];
  if (policy.employeeIds.length) parts.push(`${policy.employeeIds.length} karyawan`);
  const branch = names(policy.branchIds, options.branches);
  return `${parts.join(", ") || "Belum ada target"}${branch.length ? ` di ${branch.join(", ")}` : ""}`;
}

/** Company-wide rules: who has daily tasks and what happens when they stay open. */
export function TaskPolicies() {
  const toast = useToast();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Policy | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{ policies: Policy[]; options: Options }>("/api/v1/attendance/tasks/policies", { cache: "no-store" });
      setPolicies(res.data?.policies ?? []);
      setOptions(res.data?.options ?? null);
    } catch (err) {
      setError(errorMessage(err, "Aturan task gagal dimuat."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const remove = async (policy: Policy) => {
    const ok = await confirmDialog({ title: `Hapus aturan "${policy.name}"?`, message: "Task baru tidak lagi dibuat dari aturan ini. Task yang sudah terbentuk tetap tersimpan.", confirmLabel: "Hapus aturan", tone: "danger" });
    if (!ok) return;
    try {
      await api.delete(`/api/v1/attendance/tasks/policies?id=${policy._id}`);
      toast.success("Aturan dihapus");
      void load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-muted">Tentukan siapa yang punya task harian, misalnya divisi Sales. Karyawan di luar aturan tetap absen seperti biasa.</p>
        <Button icon={Plus} onClick={() => setEditing({ ...BLANK, tasks: [newTask()] })}>Tambah aturan</Button>
      </div>
      <Card className="overflow-hidden">
        {loading ? <div className="p-5"><SkeletonList rows={3} /></div> : policies.length === 0 ? (
          <EmptyState icon={ListChecks} title="Belum ada aturan task" description="Selama belum ada aturan, absen masuk dan pulang berjalan tanpa syarat task." action={<Button icon={Plus} onClick={() => setEditing({ ...BLANK, tasks: [newTask()] })}>Tambah aturan</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {policies.map((p) => (
              <li key={p._id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-heading">{p.name}</p>
                    {!p.isActive && <Badge>Nonaktif</Badge>}
                  </div>
                  <p className="text-body-sm text-muted">{options ? audience(p, options) : ""}</p>
                  <p className="text-label text-subtle">
                    {p.tasks.length} task tetap{p.blockClockOut ? " · menahan absen pulang" : ""}{p.countsAttendance ? " · menentukan kehadiran" : ""}{p.requireReview ? " · perlu persetujuan" : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" icon={Edit} aria-label={`Ubah ${p.name}`} onClick={() => setEditing(p)} />
                  <Button variant="ghost" size="icon" icon={Trash2} aria-label={`Hapus ${p.name}`} onClick={() => void remove(p)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && options && <PolicyModal policy={editing} options={options} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success("Aturan disimpan", "Berlaku untuk task yang belum terbentuk."); void load(); }} />}
    </div>
  );
}

function PickList({ label, options, value, onChange, searchable }: { label: string; options: Option[]; value: string[]; onChange: (ids: string[]) => void; searchable?: boolean }) {
  const [open, setOpen] = useState(value.length > 0);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.employeeId?.toLowerCase().includes(q)) : options).slice(0, 200);
  }, [options, query]);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-start">
        <span className="text-body font-medium text-heading">{label}</span>
        <span className="flex items-center gap-2 text-body-sm text-muted">
          {value.length ? `${value.length} dipilih` : "Tidak ada"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="space-y-2 pb-3">
          {searchable && (
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input aria-label={`Cari ${label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau NIP" className="ps-10" />
            </div>
          )}
          {options.length === 0 ? <p className="text-body-sm text-muted">Belum ada data.</p> : (
            <ul className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {shown.map((o) => {
                const on = value.includes(o._id);
                return (
                  <li key={o._id}>
                    <button type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o._id) : [...value, o._id])}
                      className={cn("cursor-pointer rounded-full px-3 py-1 text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]", on ? "bg-primary text-primary-foreground" : "bg-background-tertiary-default text-foreground hover:text-primary")}>
                      {o.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskEditor({ task, onChange, onRemove }: { task: PolicyTask; onChange: (patch: Partial<PolicyTask>) => void; onRemove: () => void }) {
  return (
    <li className="space-y-3 rounded-2xl bg-background-secondary-default p-4">
      <div className="flex items-start gap-2">
        <Field label="Judul task" required className="min-w-0 flex-1">
          <Input value={task.title} maxLength={150} onChange={(e) => onChange({ title: e.target.value })} placeholder="Foto kunjungan toko pertama" />
        </Field>
        <Button variant="ghost" size="icon" icon={Trash2} aria-label="Hapus task" className="mt-6" onClick={onRemove} />
      </div>
      <Field label="Keterangan">
        <Textarea rows={2} value={task.description} maxLength={1000} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-body-sm font-medium text-foreground">Bukti</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {PROOFS.map((p) => (
            <label key={p} className="flex cursor-pointer items-center gap-2 text-body-sm text-foreground">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={task.proofTypes.includes(p)} onChange={(e) => onChange({ proofTypes: e.target.checked ? [...task.proofTypes, p] : task.proofTypes.filter((x) => x !== p) })} />
              {PROOF_LABELS[p]}
            </label>
          ))}
        </div>
        {task.proofTypes.length > 1 && (
          <Segmented size="sm" label="Aturan bukti" value={task.proofMode} onChange={(proofMode) => onChange({ proofMode })} options={[{ value: "any", label: "Salah satu cukup" }, { value: "all", label: "Wajib semua" }]} />
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-body-sm font-medium text-foreground">Hari{task.weekdays.length ? "" : ": setiap hari kerja"}</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const on = task.weekdays.includes(day);
            return (
              <button key={day} type="button" aria-pressed={on} onClick={() => onChange({ weekdays: on ? task.weekdays.filter((d) => d !== day) : [...task.weekdays, day] })}
                className={cn("h-8 min-w-11 cursor-pointer rounded-full px-2 text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]", on ? "bg-primary text-primary-foreground" : "bg-background-tertiary-default text-foreground hover:text-primary")}>
                {WEEKDAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Toggle checked={task.required} onChange={(required) => onChange({ required })} label="Wajib" description="Task opsional tampil di daftar, tetapi tidak menahan absen pulang." />
    </li>
  );
}

function PolicyModal({ policy, options, onClose, onSaved }: { policy: Policy; options: Options; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Policy>(policy);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Policy>) => setDraft((d) => ({ ...d, ...patch }));
  const hasTarget = draft.roleIds.length + draft.divisionIds.length + draft.positionIds.length + draft.employeeIds.length > 0;

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await api.post("/api/v1/attendance/tasks/policies", { ...draft, id: draft._id });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Aturan gagal disimpan."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={draft._id ? "Ubah aturan task" : "Tambah aturan task"}
      description="Karyawan yang cocok dengan salah satu pilihan target mendapat task ini."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving} disabled={draft.name.trim().length < 3 || !hasTarget}>Simpan aturan</Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nama aturan" required>
          <Input value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Task harian sales" />
        </Field>

        <section>
          <h3 className="text-body font-semibold text-heading">Berlaku untuk</h3>
          <div className="divide-y divide-line">
            <PickList label="Divisi" options={options.divisions} value={draft.divisionIds} onChange={(divisionIds) => set({ divisionIds })} />
            <PickList label="Jabatan" options={options.positions} value={draft.positionIds} onChange={(positionIds) => set({ positionIds })} />
            <PickList label="Role akses" options={options.roles} value={draft.roleIds} onChange={(roleIds) => set({ roleIds })} />
            <PickList label="Karyawan tertentu" options={options.employees} value={draft.employeeIds} onChange={(employeeIds) => set({ employeeIds })} searchable />
            <PickList label="Batasi ke cabang" options={options.branches} value={draft.branchIds} onChange={(branchIds) => set({ branchIds })} />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-body font-semibold text-heading">Task tetap</h3>
            <p className="text-body-sm text-muted">Muncul otomatis di hari yang dipilih. Atasan tetap bisa menambah task berbeda tiap hari, jadi bagian ini boleh kosong.</p>
          </div>
          <ul className="space-y-3">
            {draft.tasks.map((task, i) => (
              <TaskEditor
                key={task.id}
                task={task}
                onChange={(patch) => set({ tasks: draft.tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) })}
                onRemove={() => set({ tasks: draft.tasks.filter((_, idx) => idx !== i) })}
              />
            ))}
          </ul>
          <Button variant="secondary" icon={Plus} onClick={() => set({ tasks: [...draft.tasks, newTask()] })}>Tambah task</Button>
        </section>

        <section>
          <h3 className="text-body font-semibold text-heading">Bila task wajib belum selesai</h3>
          <div className="divide-y divide-line">
            <Toggle checked={draft.blockClockOut} onChange={(blockClockOut) => set({ blockClockOut })} label="Tahan absen pulang" description="Tombol absen pulang terkunci sampai task wajib selesai atau dibebaskan atasan." />
            <Toggle checked={draft.countsAttendance} onChange={(countsAttendance) => set({ countsAttendance })} label="Tidak dihitung hadir" description="Sampai jam kerja berakhir task masih terbuka, hari itu berstatus Task belum selesai dan dihitung seperti alpha di payroll Pro." />
            <Toggle checked={draft.requireReview} onChange={(requireReview) => set({ requireReview })} label="Bukti perlu persetujuan atasan" description="Task selesai setelah atasan menyetujui. Karyawan tidak bisa pulang bila atasan belum meninjau, jadi aktifkan hanya bila atasan selalu tersedia." />
            <Toggle checked={draft.isActive} onChange={(isActive) => set({ isActive })} label="Aturan aktif" />
          </div>
        </section>
      </div>
    </Modal>
  );
}
