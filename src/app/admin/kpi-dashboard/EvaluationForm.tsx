"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Send } from "@/components/icons";
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  cn,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { RECOMMENDATION_LABELS, SCORE_MODE_MAX, type ScoreMode } from "@/lib/hr/kpi";
import { kpiPeriodKey } from "@/lib/time";

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

interface Template {
  _id: string;
  name: string;
  periodType: string;
  scoreMode: ScoreMode;
  aspects: Aspect[];
  isActive: boolean;
}

interface Employee {
  _id: string;
  name: string;
  employeeId: string;
}

export interface ExistingEvaluation {
  _id: string;
  employeeId: { _id: string; name: string; employeeId: string } | null;
  templateId: { _id: string } | string;
  period: string;
  status: string;
  scores: Array<{ aspectKey: string; indicatorKey: string; rawScore: number; note: string }>;
  strengths: string;
  improvements: string;
  developmentPlan: string;
  recommendation: string;
  notes: string;
}

/**
 * Appraisal form.
 *
 * Scores are entered in the template's own scale (1–5, 1–10, or a percentage)
 * and converted to 0–100 on the server, so changing a template's scale later
 * does not silently rescale appraisals already filled in.
 */
export function EvaluationForm({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: ExistingEvaluation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  // The period follows the template's cadence until the evaluator types their
  // own, at which point `periodEdited` freezes it so changing template does not
  // overwrite what they wrote.
  const [periodDraft, setPeriodDraft] = useState("");
  const [periodEdited, setPeriodEdited] = useState(false);
  const [scores, setScores] = useState<Record<string, { rawScore: number; note: string }>>({});
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [developmentPlan, setDevelopmentPlan] = useState("");
  const [recommendation, setRecommendation] = useState("none");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);

  const template = templates.find((t) => t._id === templateId) ?? null;
  const max = template ? (SCORE_MODE_MAX[template.scoreMode] ?? 5) : 5;
  /* A quarterly template writes its period as 2026-Q3, a yearly one as 2026. */
  const period = periodEdited
    ? periodDraft
    : kpiPeriodKey(template?.periodType ?? "monthly");

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        api.get<Template[]>("/api/v1/kpi/templates?active=1"),
        api.get<Employee[]>("/api/v1/employees?status=active&limit=500"),
      ]);
      setTemplates((t.data ?? []).filter((x) => x.isActive));
      setEmployees(e.data ?? []);
    } catch (err) {
      toast.error("Gagal memuat data", errorMessage(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTemplateId(
        typeof existing.templateId === "string" ? existing.templateId : existing.templateId._id
      );
      setEmployeeId(existing.employeeId?._id ?? "");
      setPeriodDraft(existing.period);
      setPeriodEdited(true);
      setScores(
        Object.fromEntries(
          existing.scores.map((s) => [
            `${s.aspectKey}.${s.indicatorKey}`,
            { rawScore: s.rawScore, note: s.note },
          ])
        )
      );
      setStrengths(existing.strengths);
      setImprovements(existing.improvements);
      setDevelopmentPlan(existing.developmentPlan);
      setRecommendation(existing.recommendation);
      setNotes(existing.notes);
    } else {
      setTemplateId("");
      setEmployeeId("");
      setPeriodDraft("");
      setPeriodEdited(false);
      setScores({});
      setStrengths("");
      setImprovements("");
      setDevelopmentPlan("");
      setRecommendation("none");
      setNotes("");
    }
  }, [open, existing]);

  /* --- live preview of the weighted roll-up, matching the server formula --- */
  const preview = useMemo(() => {
    if (!template) return { score: 0, filled: 0, total: 0 };
    let weighted = 0;
    let weightSum = 0;
    let filled = 0;
    let total = 0;

    for (const aspect of template.aspects) {
      for (const indicator of aspect.indicators) {
        total += 1;
        const entry = scores[`${aspect.key}.${indicator.key}`];
        if (entry === undefined || entry.rawScore === null) continue;
        filled += 1;
        const w = (aspect.weight / 100) * (indicator.weight / 100);
        if (w <= 0) continue;
        weighted += Math.min(100, (entry.rawScore / max) * 100) * w;
        weightSum += w;
      }
    }

    return {
      score: weightSum > 0 ? Math.round((weighted / weightSum) * 100) / 100 : 0,
      filled,
      total,
    };
  }, [template, scores, max]);

  const submit = async (mode: "draft" | "submit") => {
    if (!template) return;
    setSaving(mode);
    try {
      const payload = {
        id: existing?._id || undefined,
        employeeId,
        templateId,
        period,
        scores: Object.entries(scores).map(([key, v]) => {
          const [aspectKey, indicatorKey] = key.split(".");
          return { aspectKey, indicatorKey, rawScore: v.rawScore, note: v.note ?? "" };
        }),
        strengths,
        improvements,
        developmentPlan,
        recommendation,
        notes,
        submit: mode === "submit",
      };
      const res = await api.post("/api/v1/kpi/evaluations", payload);
      toast.success(mode === "submit" ? "Penilaian dikirim" : "Draf tersimpan", res.message);
      onSaved();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const incomplete = preview.filled < preview.total;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Ubah penilaian" : "Buat penilaian kinerja"}
      description="Nilai setiap indikator sesuai skala template. Nilai akhir dihitung otomatis dari bobot aspek dan indikator."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={Boolean(saving)}>
            Batal
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Save}
            onClick={() => submit("draft")}
            loading={saving === "draft"}
            disabled={!template || !employeeId || preview.filled === 0}
          >
            Simpan draf
          </Button>
          <Button
            size="sm"
            icon={Send}
            onClick={() => submit("submit")}
            loading={saving === "submit"}
            disabled={!template || !employeeId || incomplete}
          >
            Kirim ke karyawan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Karyawan" required htmlFor="ev-emp">
            <Select
              id="ev-emp"
              required
              value={employeeId}
              disabled={Boolean(existing)}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Pilih karyawan…</option>
              {employees.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.name} ({e.employeeId})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Template" required htmlFor="ev-tpl">
            <Select
              id="ev-tpl"
              required
              value={templateId}
              disabled={Boolean(existing)}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setScores({});
              }}
            >
              <option value="">Pilih template…</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Periode"
            required
            htmlFor="ev-period"
            hint="Format bebas: 2026-07, 2026-Q3, 2026-S1, atau 2026."
          >
            <Input
              id="ev-period"
              required
              value={period}
              disabled={Boolean(existing)}
              onChange={(e) => {
                setPeriodEdited(true);
                setPeriodDraft(e.target.value);
              }}
              placeholder="2026-Q3"
            />
          </Field>
        </div>

        {!template ? (
          <Alert tone="info">
            Pilih template terlebih dahulu untuk menampilkan indikator yang harus dinilai.
          </Alert>
        ) : (
          <>
            {/* -top-5 cancels the dialog body's own padding, which would
                otherwise leave a strip of content scrolling above the bar. */}
            <div className="sticky -top-5 z-10 -mx-5 px-5 py-3 bg-surface border-y border-line flex flex-wrap items-center justify-between gap-3">
              <span className="text-body-sm text-muted">
                Terisi <strong className="text-foreground">{preview.filled}</strong> dari{" "}
                {preview.total} indikator
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-body-sm text-muted">Nilai sementara</span>
                <span className="text-title font-semibold text-primary tabular-nums">
                  {preview.score.toFixed(2)}
                </span>
                <span className="text-body-sm text-subtle">/ 100</span>
              </span>
            </div>

            {template.aspects.map((aspect) => (
              <section key={aspect.key}>
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <h3 className="text-body-lg font-semibold text-heading">{aspect.name}</h3>
                  <span className="text-label text-subtle">Bobot {aspect.weight}%</span>
                </div>
                {aspect.description && (
                  <p className="text-body-sm text-muted mb-3 leading-relaxed">{aspect.description}</p>
                )}

                <div className="space-y-2.5">
                  {aspect.indicators.map((ind) => {
                    const key = `${aspect.key}.${ind.key}`;
                    const entry = scores[key];
                    return (
                      <div key={ind.key} className="rounded-[var(--radius-control)] border border-line p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-body font-medium text-foreground">{ind.name}</p>
                            {ind.target && (
                              <p className="text-label text-subtle mt-1 leading-relaxed">
                                Target: {ind.target}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-label text-subtle">{ind.weight}%</span>
                            <ScoreInput
                              max={max}
                              value={entry?.rawScore}
                              onChange={(v) =>
                                setScores((prev) => ({
                                  ...prev,
                                  [key]: { rawScore: v, note: prev[key]?.note ?? "" },
                                }))
                              }
                            />
                          </div>
                        </div>
                        <Input
                          value={entry?.note ?? ""}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [key]: { rawScore: prev[key]?.rawScore ?? 0, note: e.target.value },
                            }))
                          }
                          placeholder="Catatan atau bukti pendukung (opsional)"
                          aria-label={`Catatan untuk ${ind.name}`}
                          className="mt-3 h-10 text-body-sm"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="space-y-4 pt-5 border-t border-line">
              <Field label="Kekuatan" htmlFor="ev-str">
                <Textarea
                  id="ev-str"
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  placeholder="Hal yang sudah dikerjakan dengan baik pada periode ini."
                />
              </Field>
              <Field label="Hal yang perlu ditingkatkan" htmlFor="ev-imp">
                <Textarea
                  id="ev-imp"
                  value={improvements}
                  onChange={(e) => setImprovements(e.target.value)}
                  placeholder="Sebutkan hal yang konkret dan dapat ditindaklanjuti."
                />
              </Field>
              <Field
                label="Rencana pengembangan"
                htmlFor="ev-dev"
                hint="Disepakati bersama karyawan saat sesi umpan balik."
              >
                <Textarea
                  id="ev-dev"
                  value={developmentPlan}
                  onChange={(e) => setDevelopmentPlan(e.target.value)}
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Rekomendasi" htmlFor="ev-rec">
                  <Select
                    id="ev-rec"
                    value={recommendation}
                    onChange={(e) => setRecommendation(e.target.value)}
                  >
                    {Object.entries(RECOMMENDATION_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Catatan penilai" htmlFor="ev-notes">
                  <Input
                    id="ev-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opsional"
                  />
                </Field>
              </div>
            </div>

            {incomplete && (
              <Alert tone="warning">
                Masih ada {preview.total - preview.filled} indikator yang belum dinilai. Anda tetap
                bisa menyimpan sebagai draf, tetapi pengiriman ke karyawan memerlukan semuanya terisi.
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Segmented picker for small scales, plain number entry for percentages.
 * Tapping a value is faster and less error-prone than typing when there are
 * only five or ten options.
 */
function ScoreInput({
  max,
  value,
  onChange,
}: {
  max: number;
  value?: number;
  onChange: (v: number) => void;
}) {
  if (max > 10) {
    return (
      <Input
        type="number"
        min={0}
        max={max}
        value={value ?? ""}
        onChange={(e) =>
          onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)
        }
        aria-label="Nilai"
        className="w-24 h-10 tabular-nums text-center"
      />
    );
  }

  return (
    <div className="flex gap-1" role="group" aria-label="Nilai">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            "w-9 h-9 rounded-[var(--radius-control)] border text-body-sm font-semibold tabular-nums transition-colors cursor-pointer",
            value === n
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-surface border-line text-muted hover:border-line-strong hover:text-foreground"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
