"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus, Save, Trash2, TriangleAlert } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  ICON_STROKE,
  Input,
  Select,
  SkeletonList,
  Textarea,
  Toggle,
  cn,
} from "@/components/ui";
import { ReorderList } from "@/components/ui/Reorder";
import { LogoField } from "@/components/print/LogoField";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { PERIOD_TYPE_LABELS, SCORE_MODE_LABELS } from "@/lib/hr/kpi";

interface Indicator {
  key: string;
  name: string;
  description: string;
  target: string;
  weight: number;
}

interface Aspect {
  key: string;
  name: string;
  description: string;
  weight: number;
  indicators: Indicator[];
}

export interface KpiTemplate {
  _id: string;
  name: string;
  description: string;
  periodType: string;
  scoreMode: string;
  aspects: Aspect[];
  divisionIds: Array<{ _id: string; name: string }> | string[];
  positionIds: Array<{ _id: string; name: string }> | string[];
  allowSelfAssessment: boolean;
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
  isActive: boolean;
  usageCount?: number;
}

/** Short random key so an indicator keeps its identity when renamed. */
const newKey = () => Math.random().toString(36).slice(2, 8);

const STARTER_ASPECTS: Aspect[] = [
  {
    key: newKey(),
    name: "Hasil Kerja",
    description: "Pencapaian target dan kualitas keluaran.",
    weight: 40,
    indicators: [
      { key: newKey(), name: "Pencapaian target", description: "", target: "Minimal 100% dari target periode", weight: 60 },
      { key: newKey(), name: "Kualitas hasil kerja", description: "", target: "Minim revisi dan kesalahan", weight: 40 },
    ],
  },
  {
    key: newKey(),
    name: "Kedisiplinan",
    description: "Kehadiran dan kepatuhan pada aturan kerja.",
    weight: 30,
    indicators: [
      { key: newKey(), name: "Kehadiran dan ketepatan waktu", description: "", target: "Tanpa alpha, keterlambatan minimal", weight: 50 },
      { key: newKey(), name: "Kepatuhan prosedur", description: "", target: "Mengikuti SOP yang berlaku", weight: 50 },
    ],
  },
  {
    key: newKey(),
    name: "Sikap Kerja",
    description: "Kerja sama, inisiatif, dan komunikasi.",
    weight: 30,
    indicators: [
      { key: newKey(), name: "Kerja sama tim", description: "", target: "Kooperatif dan membantu rekan", weight: 50 },
      { key: newKey(), name: "Inisiatif", description: "", target: "Mengusulkan perbaikan tanpa diminta", weight: 50 },
    ],
  },
];

export function KpiTemplateBuilder() {
  const toast = useToast();
  const [templates, setTemplates] = useState<KpiTemplate[]>([]);
  const [divisions, setDivisions] = useState<Array<{ _id: string; name: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<KpiTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KpiTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([
        api.get<KpiTemplate[]>("/api/v1/kpi/templates"),
        api.get<Array<{ _id: string; name: string }>>("/api/v1/divisions"),
      ]);
      setTemplates(t.data ?? []);
      setDivisions(d.data ?? []);
    } catch (err) {
      toast.error("Gagal memuat template", errorMessage(err));
    } finally {
      setLoading(false);
    }
    // `toast` is stable from context; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const found = templates.find((t) => t._id === activeId);
    setDraft(found ? structuredClone(found) : null);
  }, [activeId, templates]);

  const createNew = () => {
    setActiveId(null);
    setDraft({
      _id: "",
      name: "",
      description: "",
      periodType: "quarterly",
      scoreMode: "scale_5",
      aspects: structuredClone(STARTER_ASPECTS),
      divisionIds: [],
      positionIds: [],
      allowSelfAssessment: false,
      showLogo: false,
      logoUrl: "",
      logoHeight: 14,
      isActive: true,
    });
  };

  /* Most companies already put their logo on the payslip template; offering
     that one saves uploading the same file twice. */
  const copyPayslipLogo = async () => {
    try {
      const res = await api.get<{ templates: Array<{ isDefault: boolean; logoUrl?: string; logoHeight?: number }> }>(
        "/api/v1/payroll/templates"
      );
      const list = res.data?.templates ?? [];
      const source = list.find((t) => t.isDefault && t.logoUrl) ?? list.find((t) => t.logoUrl);
      if (!source?.logoUrl) {
        toast.error("Belum ada logo", "Template slip gaji belum punya logo. Unggah logo di sini.");
        return;
      }
      setDraft((d) => (d ? { ...d, logoUrl: source.logoUrl!, logoHeight: source.logoHeight ?? 14, showLogo: true } : d));
      toast.success("Logo disalin", "Tekan Simpan agar logo ikut tercetak.");
    } catch (err) {
      toast.error("Gagal menyalin logo", errorMessage(err));
    }
  };

  const set = <K extends keyof KpiTemplate>(key: K, value: KpiTemplate[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  /* --- weight arithmetic, mirrored from the server so the form can warn --- */
  const aspectTotal = useMemo(
    () => (draft?.aspects ?? []).reduce((n, a) => n + (Number(a.weight) || 0), 0),
    [draft]
  );

  const problems = useMemo(() => {
    if (!draft) return [];
    const list: string[] = [];
    if (Math.round(aspectTotal) !== 100) {
      list.push(`Total bobot aspek ${aspectTotal}%, harus tepat 100%.`);
    }
    for (const a of draft.aspects) {
      const t = a.indicators.reduce((n, i) => n + (Number(i.weight) || 0), 0);
      if (!a.indicators.length) list.push(`Aspek "${a.name || "tanpa nama"}" belum punya indikator.`);
      else if (Math.round(t) !== 100) {
        list.push(`Bobot indikator aspek "${a.name || "tanpa nama"}" berjumlah ${t}%, harus 100%.`);
      }
    }
    return list;
  }, [draft, aspectTotal]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api.post<KpiTemplate>("/api/v1/kpi/templates", {
        ...draft,
        id: draft._id || undefined,
        divisionIds: (draft.divisionIds as Array<{ _id: string } | string>).map((d) =>
          typeof d === "string" ? d : d._id
        ),
        positionIds: [],
      });
      toast.success("Tersimpan", res.message);
      const savedId = res.data?._id ?? draft._id;
      await load();
      if (savedId) setActiveId(savedId);
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/kpi/templates?id=${deleteTarget._id}`);
      toast.success("Dihapus", res.message);
      setDeleteTarget(null);
      setActiveId(null);
      await load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  /* --- aspect + indicator mutations --- */
  const patchAspect = (ai: number, patch: Partial<Aspect>) => {
    if (!draft) return;
    set("aspects", draft.aspects.map((a, i) => (i === ai ? { ...a, ...patch } : a)));
  };

  const patchIndicator = (ai: number, ii: number, patch: Partial<Indicator>) => {
    if (!draft) return;
    set(
      "aspects",
      draft.aspects.map((a, i) =>
        i === ai
          ? { ...a, indicators: a.indicators.map((ind, j) => (j === ii ? { ...ind, ...patch } : ind)) }
          : a
      )
    );
  };

  /** Splits 100 evenly across the rows, giving the remainder to the first. */
  const distributeEvenly = (ai?: number) => {
    if (!draft) return;
    if (ai === undefined) {
      const n = draft.aspects.length;
      if (!n) return;
      const base = Math.floor(100 / n);
      set(
        "aspects",
        draft.aspects.map((a, i) => ({ ...a, weight: i === 0 ? 100 - base * (n - 1) : base }))
      );
      return;
    }
    const aspect = draft.aspects[ai];
    const n = aspect.indicators.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    patchAspect(ai, {
      indicators: aspect.indicators.map((ind, i) => ({
        ...ind,
        weight: i === 0 ? 100 - base * (n - 1) : base,
      })),
    });
  };

  if (loading) return <SkeletonList rows={4} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr] items-start">
      {/* ---------------- list ---------------- */}
      <Card className="xl:sticky xl:top-24">
        <CardHeader
          title="Template penilaian"
          icon={Layers}
          actions={
            <Button size="sm" variant="secondary" icon={Plus} onClick={createNew}>
              Baru
            </Button>
          }
        />
        <CardBody className="p-2">
          {templates.length === 0 ? (
            <p className="text-body-sm text-muted px-3 py-4 leading-relaxed">
              Belum ada template. Buat satu untuk mulai menilai kinerja karyawan.
            </p>
          ) : (
            <ul className="space-y-1 max-h-[28rem] overflow-y-auto">
              {templates.map((t) => (
                <li key={t._id}>
                  <button
                    onClick={() => setActiveId(t._id)}
                    className={cn(
                      "w-full px-3 py-2.5 rounded-[var(--radius-control)] text-left transition-colors cursor-pointer",
                      t._id === activeId ? "bg-primary-soft" : "hover:bg-surface-2"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-body-sm font-medium truncate",
                          t._id === activeId ? "text-primary" : "text-foreground"
                        )}
                      >
                        {t.name}
                      </span>
                      {!t.isActive && <Badge tone="neutral">Nonaktif</Badge>}
                    </span>
                    <span className="block text-caption text-subtle mt-0.5">
                      {PERIOD_TYPE_LABELS[t.periodType] ?? t.periodType} ·{" "}
                      {t.aspects?.length ?? 0} aspek
                      {t.usageCount ? ` · dipakai ${t.usageCount}×` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ---------------- editor ---------------- */}
      {!draft ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Pilih atau buat template"
            description="Template menentukan aspek, indikator, bobot, dan skala nilai yang dipakai saat menilai karyawan."
            action={
              <Button size="sm" icon={Plus} onClick={createNew}>
                Buat template
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title={draft._id ? "Ubah template" : "Template baru"}
              actions={
                <Button size="sm" icon={Save} onClick={save} loading={saving} disabled={problems.length > 0}>
                  Simpan
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <Field label="Nama template" required htmlFor="kt-name">
                <Input
                  id="kt-name"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Contoh: Penilaian Kinerja Staf Operasional"
                />
              </Field>

              <Field label="Keterangan" htmlFor="kt-desc">
                <Textarea
                  id="kt-desc"
                  className="min-h-20"
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Kapan template ini dipakai dan untuk siapa."
                />
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Periode penilaian" htmlFor="kt-period">
                  <Select
                    id="kt-period"
                    value={draft.periodType}
                    onChange={(e) => set("periodType", e.target.value)}
                  >
                    {Object.entries(PERIOD_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Skala nilai"
                  htmlFor="kt-scale"
                  hint="Nilai selalu disimpan sebagai 0–100 apa pun skalanya."
                >
                  <Select
                    id="kt-scale"
                    value={draft.scoreMode}
                    onChange={(e) => set("scoreMode", e.target.value)}
                  >
                    {Object.entries(SCORE_MODE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Berlaku untuk divisi"
                htmlFor="kt-div"
                hint="Kosongkan bila template ini berlaku untuk semua divisi."
              >
                <div className="flex flex-wrap gap-2 pt-1">
                  {divisions.map((d) => {
                    const ids = (draft.divisionIds as Array<{ _id: string } | string>).map((x) =>
                      typeof x === "string" ? x : x._id
                    );
                    const checked = ids.includes(d._id);
                    return (
                      <button
                        key={d._id}
                        type="button"
                        onClick={() =>
                          set(
                            "divisionIds",
                            (checked ? ids.filter((x) => x !== d._id) : [...ids, d._id]) as string[]
                          )
                        }
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-label font-medium transition-colors cursor-pointer",
                          checked
                            ? "bg-primary-soft text-primary border-primary/20"
                            : "bg-surface-2 text-muted border-line hover:text-foreground"
                        )}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <div className="rounded-[var(--radius-control)] border border-line px-3">
                <Toggle
                  checked={draft.isActive}
                  onChange={(v) => set("isActive", v)}
                  label="Template aktif"
                  description="Template nonaktif tidak muncul saat membuat penilaian baru, tetapi riwayatnya tetap utuh."
                />
              </div>
            </CardBody>
          </Card>

          {problems.length > 0 && (
            <Alert tone="warning" title="Bobot belum seimbang">
              <ul className="space-y-1 mt-1">
                {problems.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Card>
            <CardHeader
              title="Kop dokumen"
              description="Logo yang tercetak di formulir penilaian. Nama dan alamat perusahaan diambil dari Pengaturan."
            />
            <CardBody>
              <LogoField
                logoUrl={draft.logoUrl ?? ""}
                showLogo={Boolean(draft.showLogo)}
                logoHeight={draft.logoHeight ?? 14}
                onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                extraAction={
                  <Button type="button" variant="ghost" size="sm" onClick={copyPayslipLogo}>
                    Salin dari slip gaji
                  </Button>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Aspek penilaian"
              description="Bobot aspek harus berjumlah 100%, dan bobot indikator di dalam tiap aspek juga 100%."
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => distributeEvenly()}>
                    Ratakan bobot
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    onClick={() =>
                      set("aspects", [
                        ...draft.aspects,
                        { key: newKey(), name: "", description: "", weight: 0, indicators: [] },
                      ])
                    }
                  >
                    Aspek
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
                <span className="text-body-sm text-muted">Total bobot aspek</span>
                <span
                  className={cn(
                    "text-body-lg font-semibold tabular-nums",
                    Math.round(aspectTotal) === 100 ? "text-success" : "text-warning"
                  )}
                >
                  {aspectTotal}%
                </span>
              </div>

              {draft.aspects.length === 0 ? (
                <p className="text-body-sm text-muted py-4">Belum ada aspek. Tambahkan minimal satu.</p>
              ) : (
                <ReorderList
                  items={draft.aspects}
                  getKey={(aspect) => aspect.key}
                  onReorder={(next) => set("aspects", next)}
                  className="space-y-4"
                  describeItem={(aspect, ai) =>
                    aspect.name.trim() ? `Aspek ${aspect.name.trim()}` : `Aspek ${ai + 1}`
                  }
                  renderItem={(aspect, ai) => (
                    <AspectEditor
                      aspect={aspect}
                      index={ai}
                      onPatch={(patch) => patchAspect(ai, patch)}
                      onPatchIndicator={(ii, patch) => patchIndicator(ai, ii, patch)}
                      onDistribute={() => distributeEvenly(ai)}
                      onRemove={() =>
                        set(
                          "aspects",
                          draft.aspects.filter((_, i) => i !== ai)
                        )
                      }
                    />
                  )}
                />
              )}
            </CardBody>
          </Card>

          {draft._id && (
            <Button
              variant="ghost"
              icon={Trash2}
              className="text-danger"
              onClick={() => setDeleteTarget(draft)}
            >
              Hapus template ini
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title="Hapus template?"
        confirmLabel="Ya, hapus"
        message={`Template "${deleteTarget?.name}" akan dihapus. Template yang sudah dipakai menilai tidak dapat dihapus, nonaktifkan saja.`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AspectEditor({
  aspect,
  index,
  onPatch,
  onPatchIndicator,
  onDistribute,
  onRemove,
}: {
  aspect: Aspect;
  index: number;
  onPatch: (patch: Partial<Aspect>) => void;
  onPatchIndicator: (ii: number, patch: Partial<Indicator>) => void;
  onDistribute: () => void;
  onRemove: () => void;
}) {
  const indicatorTotal = aspect.indicators.reduce((n, i) => n + (Number(i.weight) || 0), 0);

  return (
    <div className="rounded-[var(--radius-card)] border border-line">
      <div className="flex items-start gap-3 p-4 border-b border-line bg-surface-2/50">
        <div className="flex-1 min-w-0 grid sm:grid-cols-[1fr_110px] gap-3">
          <Input
            value={aspect.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Nama aspek, misalnya Hasil Kerja"
            aria-label={`Nama aspek ${index + 1}`}
          />
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              value={aspect.weight}
              onChange={(e) =>
                onPatch({ weight: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0 })
              }
              aria-label={`Bobot aspek ${index + 1}`}
              className="pr-8 tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-body-sm text-subtle pointer-events-none">
              %
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Hapus aspek"
          className="text-danger shrink-0"
          onClick={onRemove}
        >
          <Trash2 className="w-4 h-4" strokeWidth={ICON_STROKE} />
        </Button>
      </div>

      <div className="p-4 space-y-3">
        <Input
          value={aspect.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="Keterangan aspek (opsional)"
          aria-label={`Keterangan aspek ${index + 1}`}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">Indikator</span>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "text-label font-semibold tabular-nums",
                Math.round(indicatorTotal) === 100 ? "text-success" : "text-warning"
              )}
            >
              {indicatorTotal}%
            </span>
            {Math.round(indicatorTotal) !== 100 && (
              <TriangleAlert className="w-3.5 h-3.5 text-warning" strokeWidth={ICON_STROKE} />
            )}
            <Button size="sm" variant="ghost" onClick={onDistribute}>
              Ratakan
            </Button>
          </span>
        </div>

        <ReorderList
          items={aspect.indicators}
          getKey={(ind) => ind.key}
          onReorder={(next) => onPatch({ indicators: next })}
          describeItem={(ind, ii) =>
            ind.name.trim() ? `Indikator ${ind.name.trim()}` : `Indikator ${ii + 1}`
          }
          renderItem={(ind, ii) => (
          <div className="rounded-[var(--radius-control)] border border-line p-3 space-y-2.5">
            <div className="grid sm:grid-cols-[1fr_100px_auto] gap-2">
              <Input
                value={ind.name}
                onChange={(e) => onPatchIndicator(ii, { name: e.target.value })}
                placeholder="Nama indikator"
                aria-label={`Nama indikator ${ii + 1}`}
              />
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={ind.weight}
                  onChange={(e) =>
                    onPatchIndicator(ii, {
                      weight: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0,
                    })
                  }
                  aria-label={`Bobot indikator ${ii + 1}`}
                  className="pr-8 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-body-sm text-subtle pointer-events-none">
                  %
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Hapus indikator"
                className="text-danger"
                onClick={() =>
                  onPatch({ indicators: aspect.indicators.filter((_, j) => j !== ii) })
                }
              >
                <Trash2 className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </Button>
            </div>
            <Input
              value={ind.target}
              onChange={(e) => onPatchIndicator(ii, { target: e.target.value })}
              placeholder="Target atau patokan penilaian, ditampilkan ke penilai"
              aria-label={`Target indikator ${ii + 1}`}
            />
          </div>
          )}
        />

        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() =>
            onPatch({
              indicators: [
                ...aspect.indicators,
                { key: newKey(), name: "", description: "", target: "", weight: 0 },
              ],
            })
          }
        >
          Tambah indikator
        </Button>
      </div>
    </div>
  );
}
