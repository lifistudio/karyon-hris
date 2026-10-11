"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, X } from "@/components/icons";
import {
  Alert,
  Button,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
  cn,
} from "@/components/ui";
import { ReorderList } from "@/components/ui/Reorder";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

import { DatePicker } from "@/components/ui/DatePicker";
export interface VacancyDraft {
  id?: string;
  title: string;
  positionId: string;
  divisionId: string;
  branchId: string;
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
  status: string;
  closesAt: string;
}

const DEFAULT_STAGES = [
  "Lamaran Masuk",
  "Seleksi Berkas",
  "Tes / Psikotes",
  "Interview HRD",
  "Interview User",
  "Penawaran",
  "Onboarding",
];

const EMPTY: VacancyDraft = {
  title: "",
  positionId: "",
  divisionId: "",
  branchId: "",
  employmentType: "full_time",
  workArrangement: "onsite",
  location: "",
  summary: "",
  responsibilities: [""],
  requirements: [""],
  niceToHave: [],
  benefits: [],
  salaryMin: 0,
  salaryMax: 0,
  showSalary: false,
  openings: 1,
  stages: DEFAULT_STAGES,
  status: "draft",
  closesAt: "",
};

interface Option {
  _id: string;
  name: string;
}

export function VacancyForm({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: VacancyDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<VacancyDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [positions, setPositions] = useState<Option[]>([]);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [step, setStep] = useState<"detail" | "content" | "process">("detail");

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? { ...EMPTY, ...initial } : EMPTY);
    setStep("detail");
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [p, d, b] = await Promise.all([
          api.get<Option[]>("/api/v1/positions"),
          api.get<Option[]>("/api/v1/divisions"),
          api.get<Option[]>("/api/v1/branches"),
        ]);
        setPositions(p.data ?? []);
        setDivisions(d.data ?? []);
        setBranches(b.data ?? []);
      } catch {
        // The form still works without the dropdowns; they are all optional.
      }
    })();
  }, [open]);

  const set = useCallback(<K extends keyof VacancyDraft>(key: K, value: VacancyDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post("/api/v1/vacancies", {
        ...draft,
        responsibilities: draft.responsibilities.filter((s) => s.trim()),
        requirements: draft.requirements.filter((s) => s.trim()),
        niceToHave: draft.niceToHave.filter((s) => s.trim()),
        benefits: draft.benefits.filter((s) => s.trim()),
        salaryMin: Number(draft.salaryMin) || 0,
        salaryMax: Number(draft.salaryMax) || 0,
        openings: Number(draft.openings) || 1,
        closesAt: draft.closesAt || null,
      });
      toast.success("Tersimpan", res.message);
      onSaved();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Ubah lowongan" : "Buat lowongan"}
      description="Isian yang lengkap membuat pelamar tahu persis apa yang dicari, dan mengurangi lamaran yang tidak relevan."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="vacancy-form" loading={saving}>
            {draft.status === "open" ? "Simpan & tayangkan" : "Simpan"}
          </Button>
        </>
      }
    >
      <div className="flex gap-1 p-1 rounded-[var(--radius-control)] bg-surface-2 border border-line mb-5">
        {(
          [
            ["detail", "Detail posisi"],
            ["content", "Isi lowongan"],
            ["process", "Proses seleksi"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStep(id)}
            className={cn(
              "flex-1 px-3 py-2 rounded-lg text-body-sm font-medium transition-colors cursor-pointer",
              step === id
                ? "bg-surface text-heading font-semibold border border-line"
                : "text-muted hover:text-foreground border border-transparent"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <form id="vacancy-form" onSubmit={submit} className="space-y-5">
        {/* ---------------- detail ---------------- */}
        <div className={step === "detail" ? "space-y-5" : "hidden"}>
          <Field label="Judul lowongan" required htmlFor="vc-title">
            <Input
              id="vc-title"
              required
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Contoh: Staf Akuntansi"
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field
              label="Jabatan terkait"
              htmlFor="vc-position"
              hint="Dipakai saat pelamar diterima menjadi karyawan."
            >
              <Select
                id="vc-position"
                value={draft.positionId}
                onChange={(e) => set("positionId", e.target.value)}
              >
                <option value="">Belum ditentukan</option>
                {positions.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Divisi" htmlFor="vc-division">
              <Select
                id="vc-division"
                value={draft.divisionId}
                onChange={(e) => set("divisionId", e.target.value)}
              >
                <option value="">Belum ditentukan</option>
                {divisions.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cabang penempatan" htmlFor="vc-branch">
              <Select
                id="vc-branch"
                value={draft.branchId}
                onChange={(e) => set("branchId", e.target.value)}
              >
                <option value="">Belum ditentukan</option>
                {branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Lokasi yang ditampilkan"
              htmlFor="vc-location"
              hint="Kosongkan untuk memakai nama cabang."
            >
              <Input
                id="vc-location"
                value={draft.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Jakarta Selatan"
              />
            </Field>
            <Field label="Tipe pekerjaan" htmlFor="vc-type">
              <Select
                id="vc-type"
                value={draft.employmentType}
                onChange={(e) => set("employmentType", e.target.value)}
              >
                <option value="full_time">Penuh waktu</option>
                <option value="part_time">Paruh waktu</option>
                <option value="contract">Kontrak</option>
                <option value="internship">Magang</option>
                <option value="freelance">Lepas</option>
              </Select>
            </Field>
            <Field label="Pengaturan kerja" htmlFor="vc-arrangement">
              <Select
                id="vc-arrangement"
                value={draft.workArrangement}
                onChange={(e) => set("workArrangement", e.target.value)}
              >
                <option value="onsite">Di kantor</option>
                <option value="hybrid">Hibrida</option>
                <option value="remote">Jarak jauh</option>
              </Select>
            </Field>
            <Field label="Jumlah posisi" htmlFor="vc-openings">
              <Input
                id="vc-openings"
                type="number"
                min={1}
                value={draft.openings}
                onChange={(e) =>
                  set("openings", Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 1)
                }
              />
            </Field>
            <Field
              label="Batas lamaran"
              htmlFor="vc-closes"
              hint="Setelah tanggal ini lowongan berhenti tayang otomatis."
            >
              <DatePicker
                id="vc-closes"
                value={draft.closesAt}
                onChange={(value) => set("closesAt", value)}
              />
            </Field>
          </div>

          <div className="rounded-[var(--radius-control)] border border-line p-4 space-y-4">
            <Toggle
              checked={draft.showSalary}
              onChange={(v) => set("showSalary", v)}
              label="Tampilkan kisaran gaji di halaman karier"
              description="Kisaran tetap tersimpan untuk keperluan internal meskipun tidak ditampilkan."
            />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Gaji minimum" htmlFor="vc-smin">
                <Input
                  id="vc-smin"
                  type="number"
                  min={0}
                  step={100000}
                  value={draft.salaryMin}
                  onChange={(e) =>
                    set("salaryMin", Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)
                  }
                />
              </Field>
              <Field label="Gaji maksimum" htmlFor="vc-smax">
                <Input
                  id="vc-smax"
                  type="number"
                  min={0}
                  step={100000}
                  value={draft.salaryMax}
                  onChange={(e) =>
                    set("salaryMax", Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)
                  }
                />
              </Field>
            </div>
          </div>

          <Field
            label="Status"
            htmlFor="vc-status"
            hint="Draf tidak tampil di halaman karier. Pilih Dibuka untuk mulai menerima lamaran."
          >
            <Select id="vc-status" value={draft.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Draf</option>
              <option value="open">Dibuka</option>
              <option value="closed">Ditutup</option>
            </Select>
          </Field>
        </div>

        {/* ---------------- content ---------------- */}
        <div className={step === "content" ? "space-y-5" : "hidden"}>
          <Field
            label="Ringkasan posisi"
            htmlFor="vc-summary"
            hint="Dua sampai tiga kalimat tentang peran ini dan timnya."
          >
            <Textarea
              id="vc-summary"
              value={draft.summary}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="Contoh: Mengelola pencatatan transaksi harian dan menyusun laporan keuangan bulanan bersama tim Finance yang terdiri dari empat orang."
            />
          </Field>

          <ListEditor
            label="Tanggung jawab"
            hint="Apa yang dikerjakan sehari-hari."
            values={draft.responsibilities}
            onChange={(v) => set("responsibilities", v)}
            placeholder="Menyusun jurnal dan rekonsiliasi bank harian"
          />
          <ListEditor
            label="Kualifikasi wajib"
            hint="Syarat yang tidak bisa ditawar. Semakin sedikit, semakin banyak pelamar yang relevan."
            values={draft.requirements}
            onChange={(v) => set("requirements", v)}
            placeholder="Minimal D3 Akuntansi dengan pengalaman 1 tahun"
          />
          <ListEditor
            label="Nilai tambah"
            hint="Opsional. Hal yang membuat pelamar lebih dipertimbangkan."
            values={draft.niceToHave}
            onChange={(v) => set("niceToHave", v)}
            placeholder="Terbiasa memakai Accurate atau Jurnal"
          />
          <ListEditor
            label="Benefit"
            hint="Opsional."
            values={draft.benefits}
            onChange={(v) => set("benefits", v)}
            placeholder="BPJS Kesehatan dan Ketenagakerjaan"
          />
        </div>

        {/* ---------------- process ---------------- */}
        <div className={step === "process" ? "space-y-5" : "hidden"}>
          <Alert tone="info" title="Tahap seleksi menjadi kolom pada papan pelamar">
            Urutan di bawah menentukan alur yang dilihat tim rekrutmen. Tahap pertama menjadi tempat
            lamaran baru masuk. Tahap yang masih berisi pelamar tidak dapat dihapus.
          </Alert>

          <ListEditor
            label="Tahap seleksi"
            hint="Minimal dua tahap."
            values={draft.stages}
            onChange={(v) => set("stages", v)}
            placeholder="Interview User"
            ordered
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => set("stages", DEFAULT_STAGES)}
          >
            Kembalikan ke tahap bawaan
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Repeatable text-row editor.
 *
 * Rows reorder by dragging the grip — with a mouse, a finger, or a pen — or by
 * focusing the grip and pressing the arrow keys. The grip used to be drawn here
 * as a plain icon with no behaviour at all, next to separate up/down buttons,
 * which invited people to drag something that could not be dragged.
 */
function ListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
  ordered = false,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  ordered?: boolean;
}) {
  const rows = values.length ? values : [""];

  const update = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-body-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-label text-subtle mt-1 leading-relaxed">{hint}</p>}
      </div>

      <ReorderList
        items={rows}
        // Rows are plain strings and can repeat (two empty lines), so position
        // is the only stable identity available.
        getKey={(_, i) => String(i)}
        onReorder={onChange}
        handleAlign="center"
        describeItem={(row, i) => (row.trim() ? `Baris "${row.trim()}"` : `Baris ${i + 1}`)}
        renderItem={(row, i) => (
          <div className="flex items-center gap-2">
            {ordered && (
              <span className="w-5 text-center text-label font-semibold text-subtle tabular-nums shrink-0">
                {i + 1}
              </span>
            )}
            <Input
              value={row}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              aria-label={`${label} baris ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              aria-label={`Hapus baris ${i + 1}`}
              className="shrink-0 p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-danger-soft cursor-pointer"
            >
              <X className="w-4 h-4" strokeWidth={ICON_STROKE} />
            </button>
          </div>
        )}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={Plus}
        onClick={() => onChange([...rows, ""])}
      >
        Tambah baris
      </Button>
    </div>
  );
}
