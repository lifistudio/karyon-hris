"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import Link from "next/link";
import { CircleCheck, FileText, MessageSquare, Printer, Target, TrendingUp } from "@/components/icons";
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
  PageHeader,
  SkeletonList,
  StatCard,
  Textarea,
  type BadgeTone,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/time";
import {
  EVALUATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  SCORE_MODE_MAX,
} from "@/lib/hr/kpi";

interface Score {
  aspectKey: string;
  aspectName: string;
  aspectWeight: number;
  indicatorKey: string;
  indicatorName: string;
  indicatorWeight: number;
  rawScore: number;
  score: number;
  note: string;
}

interface Evaluation {
  _id: string;
  period: string;
  scoreMode: string;
  finalScore: number;
  gradeLabel: string;
  status: string;
  strengths: string;
  improvements: string;
  developmentPlan: string;
  recommendation: string;
  notes: string;
  employeeComment: string;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  finalizedAt?: string | null;
  updatedAt: string;
  source?: "form" | "uploaded";
  title?: string;
  uploadedFile?: string;
  scores: Score[];
  templateId: { name: string } | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  submitted: "warning",
  acknowledged: "info",
  finalized: "success",
};

export default function PortalKpiPage() {
  const toast = useToast();
  const [items, setItems] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Evaluation | null>(null);
  const [ackTarget, setAckTarget] = useState<Evaluation | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Evaluation[]>(`/api/v1/kpi/evaluations?mine=1&page=${page}&limit=${limit}`);
      setItems(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row: Evaluation) => {
    try {
      const res = await api.get<Evaluation>(`/api/v1/kpi/evaluations?id=${row._id}`);
      setDetail(res.data ?? null);
    } catch (err) {
      toast.error("Gagal memuat detail", errorMessage(err));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-52" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  const pending = items.filter((i) => i.status === "submitted");
  const latest = items.find((i) => i.status !== "draft");
  // Trend needs at least two settled appraisals to say anything.
  const previous = items.filter((i) => i !== latest && i.status !== "draft")[0];
  const delta = latest && previous ? latest.finalScore - previous.finalScore : null;

  return (
    <div>
      <PageHeader
        title="Penilaian kinerja saya"
        description="Hasil penilaian dari atasan beserta catatan dan rencana pengembangannya."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {pending.length > 0 && (
        <Alert tone="warning" title="Ada penilaian yang menunggu tanggapan Anda" className="mb-6">
          {pending.length} penilaian sudah dibagikan atasan. Buka, baca isinya, lalu berikan
          tanggapan. Tanggapan Anda tercatat dan dibaca oleh atasan serta HRD.
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="Belum ada penilaian"
            description="Hasil penilaian kinerja akan muncul di sini setelah atasan Anda menyelesaikan dan membagikannya."
          />
        </Card>
      ) : (
        <>
          {latest && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-7">
              <StatCard
                label="Nilai terakhir"
                value={latest.finalScore.toFixed(1)}
                hint={`periode ${latest.period}`}
                icon={Target}
                tone="primary"
              />
              <StatCard
                label="Predikat"
                value={latest.gradeLabel || "—"}
                hint={latest.templateId?.name ?? ""}
                icon={CircleCheck}
                tone="success"
              />
              {delta !== null && (
                <StatCard
                  label="Dibanding periode sebelumnya"
                  value={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                  hint={`dari ${previous!.finalScore.toFixed(1)} pada ${previous!.period}`}
                  icon={TrendingUp}
                  tone={delta >= 0 ? "success" : "warning"}
                />
              )}
              <StatCard
                label="Total penilaian"
                value={items.length}
                hint="tersimpan permanen"
                icon={Target}
              />
            </div>
          )}

          <Card>
            <CardHeader title="Riwayat penilaian" description={`${total} penilaian.`} />
            <CardBody className="p-0">
              <ul className="divide-y divide-[var(--border)]">
                {items.map((e) => (
                  <li
                    key={e._id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body-lg font-semibold text-heading">{e.period}</span>
                        <Badge tone={STATUS_TONE[e.status] ?? "neutral"} dot>
                          {EVALUATION_STATUS_LABELS[e.status as keyof typeof EVALUATION_STATUS_LABELS] ??
                            e.status}
                        </Badge>
                      </div>
                      <p className="text-body-sm text-muted mt-1">
                        {e.source === "uploaded" ? e.title || "Penilaian kinerja" : e.templateId?.name ?? "Template dihapus"}
                        {e.finalizedAt && ` · final ${formatDateTime(e.finalizedAt)}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-title font-semibold text-heading tabular-nums leading-none">
                          {e.finalScore.toFixed(1)}
                        </p>
                        <p className="text-caption text-subtle mt-1">{e.gradeLabel || "—"}</p>
                      </div>

                      <div className="flex items-center gap-1">
                        {e.source === "uploaded" ? (
                          <a href={e.uploadedFile} target="_blank" rel="noreferrer">
                            <Button variant="secondary" size="sm" icon={FileText}>
                              Buka dokumen
                            </Button>
                          </a>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => openDetail(e)}>
                            Lihat
                          </Button>
                        )}
                        {e.status === "submitted" && (
                          <Button size="sm" icon={MessageSquare} onClick={() => setAckTarget(e)}>
                            Tanggapi
                          </Button>
                        )}
                        {e.status === "finalized" && e.source !== "uploaded" && (
                          <Link href={`/print/kpi/${e._id}`} target="_blank">
                            <Button variant="ghost" size="sm" icon={Printer}>
                              Cetak
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </>
      )}

      {total > limit && (
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPage={setPage} />
      )}

      <DetailModal
        evaluation={detail}
        onClose={() => setDetail(null)}
        onAcknowledge={(e) => {
          setDetail(null);
          setAckTarget(e);
        }}
      />

      <AcknowledgeModal
        evaluation={ackTarget}
        onClose={() => setAckTarget(null)}
        onDone={() => {
          setAckTarget(null);
          void load();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DetailModal({
  evaluation,
  onClose,
  onAcknowledge,
}: {
  evaluation: Evaluation | null;
  onClose: () => void;
  onAcknowledge: (e: Evaluation) => void;
}) {
  if (!evaluation) return null;

  const max = SCORE_MODE_MAX[evaluation.scoreMode as keyof typeof SCORE_MODE_MAX] ?? 5;
  const aspects = groupByAspect(evaluation.scores);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Penilaian ${evaluation.period}`}
      description={evaluation.templateId?.name ?? undefined}
      size="lg"
      footer={
        <>
          {evaluation.status === "finalized" && (
            <Link href={`/print/kpi/${evaluation._id}`} target="_blank">
              <Button variant="secondary" size="sm" icon={Printer}>
                Cetak / simpan PDF
              </Button>
            </Link>
          )}
          {evaluation.status === "submitted" && (
            <Button size="sm" icon={MessageSquare} onClick={() => onAcknowledge(evaluation)}>
              Berikan tanggapan
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] bg-primary-soft px-4 py-3.5">
          <div>
            <p className="eyebrow">Nilai akhir</p>
            <p className="text-display-sm font-semibold text-primary tabular-nums leading-none mt-1">
              {evaluation.finalScore.toFixed(2)}
              <span className="text-body text-muted font-normal"> / 100</span>
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Predikat</p>
            <p className="text-body-lg font-semibold text-heading mt-1">
              {evaluation.gradeLabel || "—"}
            </p>
          </div>
        </div>

        {aspects.map((aspect) => (
          <section key={aspect.key}>
            <div className="flex items-baseline justify-between gap-3 mb-2.5">
              <h3 className="text-body-lg font-semibold text-heading">{aspect.name}</h3>
              <span className="text-label text-subtle">Bobot {aspect.weight}%</span>
            </div>
            <ul className="space-y-2">
              {aspect.items.map((s) => (
                <li
                  key={s.indicatorKey}
                  className="rounded-[var(--radius-control)] border border-line p-3.5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">{s.indicatorName}</p>
                      {s.note && (
                        <p className="text-label text-muted mt-1 leading-relaxed">{s.note}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-body-lg font-semibold tabular-nums text-foreground">
                        {s.rawScore}
                        <span className="text-subtle font-normal text-body-sm"> / {max}</span>
                      </span>
                      <span className="block text-caption text-subtle mt-0.5">{s.indicatorWeight}%</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="space-y-4 pt-5 border-t border-line">
          <Narrative title="Kekuatan" body={evaluation.strengths} />
          <Narrative title="Hal yang perlu ditingkatkan" body={evaluation.improvements} />
          <Narrative title="Rencana pengembangan" body={evaluation.developmentPlan} />
          <Narrative
            title="Rekomendasi"
            body={RECOMMENDATION_LABELS[evaluation.recommendation] ?? ""}
          />
          <Narrative title="Catatan penilai" body={evaluation.notes} />
          {evaluation.employeeComment && (
            <div className="rounded-[var(--radius-control)] bg-surface-2 border border-line p-4">
              <p className="eyebrow mb-1.5">Tanggapan Anda</p>
              <p className="text-body-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                {evaluation.employeeComment}
              </p>
              {evaluation.acknowledgedAt && (
                <p className="text-caption text-subtle mt-2">
                  Dikirim {formatDateTime(evaluation.acknowledgedAt)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AcknowledgeModal({
  evaluation,
  onClose,
  onDone,
}: {
  evaluation: Evaluation | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (evaluation) setComment("");
  }, [evaluation]);

  if (!evaluation) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.patch("/api/v1/kpi/evaluations", {
        id: evaluation._id,
        action: "acknowledge",
        comment: comment.trim() || undefined,
      });
      toast.success("Tanggapan terkirim", res.message);
      onDone();
    } catch (err) {
      toast.error("Gagal mengirim", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Tanggapi penilaian ${evaluation.period}`}
      description={`Nilai akhir Anda ${evaluation.finalScore.toFixed(1)} dengan predikat ${evaluation.gradeLabel || "—"}.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="ack-form" loading={saving}>
            Kirim tanggapan
          </Button>
        </>
      }
    >
      <form id="ack-form" onSubmit={submit} className="space-y-4">
        <Alert tone="info">
          Tanggapan bersifat opsional. Anda tetap dapat mengirim tanpa menulis apa pun, yang berarti
          Anda sudah membaca hasil penilaian ini. Jika ada yang menurut Anda kurang tepat, tuliskan
          di sini agar tercatat bersama penilaiannya.
        </Alert>

        <Field
          label="Tanggapan Anda"
          htmlFor="ack-comment"
          hint="Dibaca oleh atasan penilai dan HRD."
        >
          <Textarea
            id="ack-comment"
            className="min-h-32"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Contoh: Saya setuju dengan penilaian ini. Untuk indikator ketepatan waktu, saya ingin menambahkan bahwa ada dua hari dinas luar yang belum tercatat."
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function groupByAspect(scores: Score[]) {
  const map = new Map<string, { key: string; name: string; weight: number; items: Score[] }>();
  for (const s of scores) {
    const entry = map.get(s.aspectKey) ?? {
      key: s.aspectKey,
      name: s.aspectName,
      weight: s.aspectWeight,
      items: [],
    };
    entry.items.push(s);
    map.set(s.aspectKey, entry);
  }
  return [...map.values()];
}

function Narrative({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <p className="text-body-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  );
}
