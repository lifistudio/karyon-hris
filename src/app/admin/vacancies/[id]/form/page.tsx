"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, ListChecks, Lock, Pencil, Plus, RotateCcw, Save, Trash2, X } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  PageHeader,
  SkeletonList,
  Tabs,
  Toggle,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { ReorderList } from "@/components/ui/Reorder";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import {
  FIELD_TYPE_HINTS,
  FIELD_TYPE_LABELS,
  LOCKED_KEYS,
  SECTION_SUGGESTIONS,
  TYPES_WITH_OPTIONS,
  defaultFormFields,
  definitionProblems,
  newCustomField,
  normaliseFields,
  type FieldType,
  type FormField,
} from "@/lib/hr/application-form";
import {
  ApplicationFormRenderer,
  initialValues,
  prepareAnswers,
  type FormErrors,
  type FormValues,
} from "@/components/recruitment/ApplicationFormRenderer";

interface FormData {
  vacancy: { _id: string; title: string; slug: string; status: string };
  fields: FormField[];
  isDefault: boolean;
}

const TYPE_OPTIONS = (Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => ({
  value: t,
  label: FIELD_TYPE_LABELS[t],
  hint: FIELD_TYPE_HINTS[t],
}));

const isLocked = (f: FormField) => f.system !== null && (LOCKED_KEYS as string[]).includes(f.system);

export default function ApplicationFormBuilderPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();

  const [data, setData] = useState<FormData | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"build" | "preview">("build");
  const [editing, setEditing] = useState<{ field: FormField; index: number | null } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<FormData>(`/api/v1/vacancies/${params.id}/form`);
      if (res.data) {
        setData(res.data);
        setFields(res.data.fields);
        setSaved(JSON.stringify(res.data.fields));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = saved !== "" && JSON.stringify(fields) !== saved;

  // Leaving with unsaved changes asks first; a long form is tedious to rebuild.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const problems = useMemo(() => definitionProblems(normaliseFields(fields)), [fields]);

  const save = async () => {
    if (problems.length) {
      toast.error("Formulir belum bisa disimpan", problems[0]);
      return;
    }
    setSaving(true);
    try {
      const res = await api.put<{ fields: FormField[] }>(`/api/v1/vacancies/${params.id}/form`, { fields });
      const next = res.data?.fields ?? fields;
      setFields(next);
      setSaved(JSON.stringify(next));
      toast.success("Formulir disimpan", res.message);
    } catch (err) {
      toast.error("Gagal menyimpan formulir", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const upsert = (field: FormField, index: number | null) => {
    setFields((prev) => {
      if (index === null) return [...prev, field];
      const next = prev.slice();
      next[index] = field;
      return next;
    });
    setEditing(null);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64" />
        <SkeletonList rows={6} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const enabledCount = fields.filter((f) => f.enabled).length;
  const requiredCount = fields.filter((f) => f.enabled && f.required).length;

  return (
    <div className="pb-6">
      <Link
        href={`/admin/vacancies/${params.id}`}
        className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
        Kembali ke papan pelamar
      </Link>

      <PageHeader
        eyebrow="Formulir lamaran"
        title={data.vacancy.title}
        description="Atur apa saja yang diisi pelamar untuk lowongan ini. Seret untuk mengubah urutan; judul bagian mengelompokkan kolom di halaman karier."
        actions={
          <>
            <Button variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
              Kembalikan bawaan
            </Button>
            <Button icon={Plus} variant="secondary" onClick={() => setEditing({ field: newCustomField(), index: null })}>
              Tambah pertanyaan
            </Button>
          </>
        }
      />

      {data.isDefault && !dirty && (
        <Alert tone="info" className="mb-5">
          Lowongan ini masih memakai formulir bawaan. Ubah lalu simpan untuk membuat formulir khusus lowongan ini.
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: "build", label: "Susun", icon: ListChecks, count: fields.length },
            { id: "preview", label: "Pratinjau", icon: Eye },
          ]}
        />
        <p className="text-body-sm text-muted">
          {enabledCount} kolom tampil · {requiredCount} wajib
        </p>
      </div>

      {problems.length > 0 && (
        <Alert tone="warning" title="Perlu diperbaiki sebelum disimpan" className="mb-5">
          <ul className="list-disc pl-4 space-y-1">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}

      {view === "build" ? (
        <ReorderList
          items={fields}
          getKey={(f) => f.key}
          onReorder={setFields}
          describeItem={(f) => f.label || "Kolom tanpa label"}
          className="space-y-2"
          handleAlign="center"
          renderItem={(f, i) => (
            <FieldRow
              field={f}
              previousSection={i > 0 ? fields[i - 1].section : null}
              onEdit={() => setEditing({ field: f, index: i })}
              onToggle={(enabled) => {
                const next = fields.slice();
                next[i] = { ...f, enabled, required: enabled ? f.required : false };
                setFields(next);
              }}
              onRemove={() => setRemoveIndex(i)}
            />
          )}
        />
      ) : (
        <PreviewPane fields={normaliseFields(fields).filter((f) => f.enabled)} />
      )}

      {/* Sticky save bar: stays in the content column, visible while there is something to save. */}
      {dirty && (
        <div className="sticky bottom-3 z-30 mt-6 animate-[pop-in_120ms_ease-out]">
          <div className="card px-4 py-3 flex items-center justify-between gap-3" style={{ boxShadow: "var(--shadow-pop)" }}>
            <p className="text-body-sm text-muted min-w-0 truncate">Ada perubahan yang belum disimpan.</p>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setFields(JSON.parse(saved) as FormField[])} disabled={saving}>
                Batalkan
              </Button>
              <Button size="sm" icon={Save} loading={saving} onClick={save}>
                Simpan formulir
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <FieldEditor
          initial={editing.field}
          isNew={editing.index === null}
          existingKeys={fields.filter((_, i) => i !== editing.index).map((f) => f.key)}
          sections={Array.from(new Set([...fields.map((f) => f.section), ...SECTION_SUGGESTIONS])).filter(Boolean)}
          onClose={() => setEditing(null)}
          onSave={(f) => upsert(f, editing.index)}
        />
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setFields(defaultFormFields());
          setConfirmReset(false);
        }}
        title="Kembalikan ke formulir bawaan?"
        message="Semua pertanyaan tambahan dan perubahan pada formulir ini diganti formulir bawaan. Perubahan baru berlaku setelah Anda menyimpan."
        confirmLabel="Kembalikan"
        tone="danger"
      />

      <ConfirmDialog
        open={removeIndex !== null}
        onClose={() => setRemoveIndex(null)}
        onConfirm={() => {
          if (removeIndex !== null) setFields(fields.filter((_, i) => i !== removeIndex));
          setRemoveIndex(null);
        }}
        title="Hapus pertanyaan ini?"
        message="Jawaban pelamar yang sudah masuk tetap tersimpan. Pelamar berikutnya tidak lagi melihat pertanyaan ini."
        confirmLabel="Hapus"
        tone="danger"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FieldRow({
  field: f,
  previousSection,
  onEdit,
  onToggle,
  onRemove,
}: {
  field: FormField;
  previousSection: string | null;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const locked = isLocked(f);
  const newSection = f.section !== previousSection;
  return (
    <div>
      {newSection && <p className="eyebrow mt-4 mb-2 first:mt-0">{f.section || "Tanpa bagian"}</p>}
      <div
        className={cn(
          "card px-3 py-3 sm:px-4 flex items-center gap-3 transition-opacity",
          !f.enabled && "opacity-60"
        )}
      >
        <button type="button" onClick={onEdit} className="flex-1 min-w-0 text-left cursor-pointer group">
          <p className="text-body font-medium text-heading truncate group-hover:text-primary transition-colors">
            {f.label || <span className="text-subtle italic">Tanpa label</span>}
            {f.required && f.enabled && <span className="text-danger ml-1">*</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{FIELD_TYPE_LABELS[f.type]}</Badge>
            {locked && (
              <Badge tone="primary" icon={Lock}>
                Wajib sistem
              </Badge>
            )}
            {f.system && !locked && <Badge tone="info">Kolom sistem</Badge>}
            {!f.enabled && <Badge tone="warning" icon={EyeOff}>Disembunyikan</Badge>}
            {TYPES_WITH_OPTIONS.includes(f.type) && (
              <span className="text-label text-subtle">{f.options.length} pilihan</span>
            )}
            {f.type === "file" && (
              <span className="text-label text-subtle">
                maks. {f.maxFiles} lampiran{f.allowLink ? " · boleh tautan" : ""}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {!locked && (
            <label className="hidden sm:flex items-center gap-2 mr-1 text-label text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => onToggle(e.target.checked)}
                className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
              />
              Tampil
            </label>
          )}
          <Button variant="ghost" size="icon" aria-label={`Ubah ${f.label}`} onClick={onEdit}>
            <Pencil className="w-4 h-4" strokeWidth={ICON_STROKE} />
          </Button>
          {!f.system && (
            <Button variant="ghost" size="icon" aria-label={`Hapus ${f.label}`} onClick={onRemove}>
              <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FieldEditor({
  initial,
  isNew,
  existingKeys,
  sections,
  onClose,
  onSave,
}: {
  initial: FormField;
  isNew: boolean;
  existingKeys: string[];
  sections: string[];
  onClose: () => void;
  onSave: (field: FormField) => void;
}) {
  const [f, setF] = useState<FormField>(() => ({
    ...initial,
    options: initial.options.length || !TYPES_WITH_OPTIONS.includes(initial.type) ? initial.options : [],
  }));
  const [problem, setProblem] = useState("");
  const locked = isLocked(f);
  const hasOptions = TYPES_WITH_OPTIONS.includes(f.type);
  const set = (patch: Partial<FormField>) => setF((prev) => ({ ...prev, ...patch }));

  const submit = () => {
    if (!f.label.trim()) return setProblem("Label wajib diisi.");
    if (existingKeys.includes(f.key)) return setProblem("Kode kolom sudah dipakai kolom lain.");
    if (hasOptions && f.options.filter((o) => o.label.trim()).length < 2) {
      return setProblem("Tambahkan minimal dua pilihan.");
    }
    const labels = f.options.map((o) => o.label.trim().toLowerCase()).filter(Boolean);
    if (new Set(labels).size !== labels.length) return setProblem("Ada pilihan yang sama persis.");
    // Option values are derived from labels on new options; existing values are
    // kept so answers already given still map to the right label.
    const options = f.options
      .filter((o) => o.label.trim())
      .map((o) => ({ label: o.label.trim(), value: o.value || slugValue(o.label) }));
    onSave(normaliseFields([{ ...f, options }])[0]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "Tambah pertanyaan" : "Ubah kolom"}
      description={f.system ? "Kolom sistem dipakai saat pelamar dijadikan karyawan, jadi jenis isiannya tetap." : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit}>{isNew ? "Tambahkan" : "Terapkan"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {problem && <Alert tone="danger">{problem}</Alert>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Label" required htmlFor="fe-label" className="sm:col-span-2">
            <Input
              id="fe-label"
              autoFocus
              maxLength={120}
              value={f.label}
              placeholder="Contoh: Apakah Anda bersedia ditempatkan di luar kota?"
              onChange={(e) => set({ label: e.target.value })}
            />
          </Field>

          <Field label="Jenis isian" htmlFor="fe-type" hint={FIELD_TYPE_HINTS[f.type]}>
            <Combobox
              id="fe-type"
              value={f.type}
              options={TYPE_OPTIONS}
              disabled={Boolean(f.system)}
              onChange={(v) => {
                const type = v as FieldType;
                set({
                  type,
                  options: TYPES_WITH_OPTIONS.includes(type)
                    ? f.options.length
                      ? f.options
                      : [
                          { value: "", label: "" },
                          { value: "", label: "" },
                        ]
                    : [],
                  maxFiles: type === "file" ? Math.max(1, f.maxFiles) : 1,
                  allowLink: type === "file" ? true : f.allowLink,
                });
              }}
              sheetTitle="Jenis isian"
            />
          </Field>

          <Field label="Bagian" htmlFor="fe-section" hint="Ketik nama bagian baru atau pilih yang sudah ada.">
            <Input
              id="fe-section"
              list="fe-section-list"
              maxLength={60}
              value={f.section}
              onChange={(e) => set({ section: e.target.value })}
            />
            <datalist id="fe-section-list">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          {!["file", "yes_no", "radio", "multi_select", "address"].includes(f.type) && (
            <Field label="Teks contoh (placeholder)" htmlFor="fe-placeholder">
              <Input
                id="fe-placeholder"
                maxLength={150}
                value={f.placeholder}
                onChange={(e) => set({ placeholder: e.target.value })}
              />
            </Field>
          )}

          <Field label="Petunjuk" htmlFor="fe-help" className="sm:col-span-2" hint="Tampil kecil di bawah kolom.">
            <Input id="fe-help" maxLength={300} value={f.helpText} onChange={(e) => set({ helpText: e.target.value })} />
          </Field>
        </div>

        {hasOptions && <OptionsEditor options={f.options} onChange={(options) => set({ options })} />}

        {f.type === "file" && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Jumlah lampiran maksimal" htmlFor="fe-max">
              <Combobox
                id="fe-max"
                value={String(f.maxFiles)}
                onChange={(v) => set({ maxFiles: Number(v) })}
                options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} lampiran` }))}
              />
            </Field>
            <div className="sm:pt-7">
              <Toggle
                checked={f.allowLink}
                onChange={(allowLink) => set({ allowLink })}
                label="Boleh berupa tautan"
                description="Pelamar dapat menempel tautan Google Drive, LinkedIn, dan sejenisnya."
              />
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-line grid sm:grid-cols-2 gap-4">
          <Toggle
            checked={f.enabled}
            disabled={locked}
            onChange={(enabled) => set({ enabled, required: enabled ? f.required : false })}
            label="Tampilkan di formulir"
            description={locked ? "Nama, email, dan telepon selalu ditanyakan." : undefined}
          />
          <Toggle
            checked={f.required}
            disabled={locked || !f.enabled}
            onChange={(required) => set({ required })}
            label="Wajib diisi"
          />
        </div>
      </div>
    </Modal>
  );
}

function slugValue(label: string) {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || `opsi_${Math.random().toString(36).slice(2, 6)}`
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: FormField["options"];
  onChange: (next: FormField["options"]) => void;
}) {
  // Rows need a stable identity while being reordered and typed into; the
  // option value cannot serve, because new options have none yet.
  const [ids, setIds] = useState(() => options.map((_, i) => `opt-${i}-${Math.random().toString(36).slice(2, 6)}`));
  const rows = options.map((o, i) => ({ ...o, id: ids[i] ?? `opt-${i}` }));

  const update = (next: typeof rows) => {
    setIds(next.map((r) => r.id));
    onChange(next.map(({ value, label }) => ({ value, label })));
  };

  return (
    <div>
      <p className="text-body-sm font-medium text-foreground mb-2">
        Pilihan jawaban <span className="text-danger">*</span>
      </p>
      <ReorderList
        items={rows}
        getKey={(r) => r.id}
        onReorder={update}
        handleAlign="center"
        className="space-y-2"
        describeItem={(r) => r.label || "Pilihan kosong"}
        renderItem={(r, i) => (
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Pilihan ${i + 1}`}
              value={r.label}
              maxLength={120}
              placeholder={`Pilihan ${i + 1}`}
              onChange={(e) => {
                const next = rows.slice();
                next[i] = { ...r, label: e.target.value };
                update(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  update([...rows, { id: `opt-${Date.now()}`, value: "", label: "" }]);
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Hapus pilihan ${i + 1}`}
              onClick={() => update(rows.filter((_, j) => j !== i))}
            >
              <X className="w-4 h-4" strokeWidth={ICON_STROKE} />
            </Button>
          </div>
        )}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        className="mt-2"
        onClick={() => update([...rows, { id: `opt-${Date.now()}`, value: "", label: "" }])}
        disabled={rows.length >= 50}
      >
        Tambah pilihan
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PreviewPane({ fields }: { fields: FormField[] }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<FormErrors>({});

  return (
    <Card className="p-5 sm:p-7 max-w-3xl">
      <Alert tone="info" className="mb-6">
        Pratinjau seperti yang dilihat pelamar. Isian di sini tidak dikirim ke mana pun; berkas tidak dapat
        diunggah dari pratinjau.
      </Alert>
      <ApplicationFormRenderer
        fields={fields.map((f) => (f.type === "file" ? { ...f } : f))}
        values={values}
        errors={errors}
        idPrefix="pv"
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
      />
      <div className="mt-8 pt-6 border-t border-line flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => setErrors(prepareAnswers(fields, values).errors)}
        >
          Uji validasi
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setValues(initialValues(fields));
            setErrors({});
          }}
        >
          Kosongkan
        </Button>
      </div>
    </Card>
  );
}
