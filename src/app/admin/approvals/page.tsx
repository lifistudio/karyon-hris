"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { CalendarDays, Check, ClipboardCheck, FileClock, History, Inbox, Paperclip, Repeat, ScanFace, X } from "@/components/icons";
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
  SkeletonList,
  StatusBadge,
  Tabs,
  Textarea,
  cn,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatRelative } from "@/lib/time";

interface Step {
  stepNumber: number;
  approverRole: string;
  status: string;
  comment?: string;
  actionedAt?: string;
}

interface ApprovalItem {
  _id: string;
  refType: "leave" | "correction" | "holiday_swap" | "face_change";
  refTypeLabel: string;
  status: string;
  currentStep: number;
  activeApproverRole: string | null;
  canAct: boolean;
  requesterName: string;
  requesterNip: string;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
  details: {
    title: string;
    period: string;
    duration: string;
    reason: string;
    evidenceUrl: string;
    /** Face change requests only. */
    facePhotos?: { current: string; proposed: string };
    faceSimilarity?: "similar" | "uncertain" | "different" | "unknown";
  };
}

const TYPE_ICON = {
  leave: CalendarDays,
  correction: FileClock,
  holiday_swap: Repeat,
  face_change: ScanFace,
} as const;

export default function ApprovalsPage() {
  const toast = useToast();
  const [view, setViewState] = useState<"inbox" | "history">("inbox");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const setView = (v: "inbox" | "history") => {
    setViewState(v);
    setPage(1);
  };
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<{ item: ApprovalItem; action: "approve" | "reject" } | null>(
    null
  );
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<ApprovalItem[]>(`/api/v1/approvals?view=${view}&page=${page}&limit=${limit}`);
      setItems(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [view, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      const res = await api.post("/api/v1/approvals", {
        instanceId: decision.item._id,
        action: decision.action,
        comment: comment.trim() || undefined,
      });
      toast.success(decision.action === "approve" ? "Disetujui" : "Ditolak", res.message);
      setDecision(null);
      setComment("");
      await load();
    } catch (err) {
      toast.error("Gagal memproses", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const actionable = items.filter((i) => i.canAct).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Persetujuan</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Antrean pengajuan cuti, koreksi absen, dan tukar libur yang menunggu keputusan Anda.
        </p>
      </header>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { id: "inbox", label: "Menunggu keputusan", count: actionable, icon: Inbox },
          { id: "history", label: "Riwayat", icon: History },
        ]}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title={view === "inbox" ? "Tidak ada pengajuan menunggu" : "Belum ada riwayat"}
            description={
              view === "inbox"
                ? "Semua pengajuan sudah diproses. Antrean baru akan muncul di sini secara otomatis."
                : "Pengajuan yang sudah disetujui atau ditolak akan tercatat di sini."
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const Icon = TYPE_ICON[item.refType] ?? CalendarDays;
            return (
              <Card key={item._id}>
                <CardHeader
                  icon={Icon}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {item.requesterName}
                      <span className="text-caption font-normal text-subtle font-mono">
                        {item.requesterNip}
                      </span>
                    </span>
                  }
                  description={`${item.refTypeLabel} · diajukan ${formatRelative(item.createdAt)}`}
                  actions={
                    item.canAct ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={X}
                          onClick={() => {
                            setComment("");
                            setDecision({ item, action: "reject" });
                          }}
                        >
                          Tolak
                        </Button>
                        <Button
                          variant="success"
                          size="sm"
                          icon={Check}
                          onClick={() => {
                            setComment("");
                            setDecision({ item, action: "approve" });
                          }}
                        >
                          Setujui
                        </Button>
                      </>
                    ) : (
                      <StatusBadge status={item.status} />
                    )
                  }
                />
                <CardBody className="space-y-4">
                  <dl className="grid sm:grid-cols-3 gap-4">
                    <Detail label="Jenis" value={item.details.title} />
                    <Detail label="Periode" value={item.details.period} />
                    <Detail label="Durasi" value={item.details.duration} />
                  </dl>

                  <div>
                    <p className="eyebrow mb-1">
                      Alasan pemohon
                    </p>
                    <p className="text-body text-foreground/90 leading-relaxed">{item.details.reason}</p>
                    {item.details.facePhotos && (
                      <FaceComparison
                        photos={item.details.facePhotos}
                        similarity={item.details.faceSimilarity ?? "unknown"}
                      />
                    )}
                    {item.details.evidenceUrl && (
                      <a
                        href={item.details.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-label font-semibold text-primary hover:underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        Buka lampiran bukti
                      </a>
                    )}
                  </div>

                  <StepTrail steps={item.steps} currentStep={item.currentStep} />

                  {item.canAct && item.activeApproverRole && (
                    <Alert tone="info">
                      Pengajuan ini menunggu keputusan sebagai <strong>{item.activeApproverRole}</strong>.
                      Setelah Anda menyetujui, pengajuan diteruskan ke approver berikutnya bila ada.
                    </Alert>
                  )}
                </CardBody>
              </Card>
            );
          })}
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
        </div>
      )}

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision?.action === "approve" ? "Setujui pengajuan" : "Tolak pengajuan"}
        description={
          decision
            ? `${decision.item.refTypeLabel} dari ${decision.item.requesterName} — ${decision.item.details.period}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDecision(null)} disabled={saving}>
              Batal
            </Button>
            <Button
              variant={decision?.action === "approve" ? "success" : "danger"}
              size="sm"
              loading={saving}
              disabled={decision?.action === "reject" && comment.trim().length < 5}
              onClick={submit}
            >
              {decision?.action === "approve" ? "Ya, setujui" : "Ya, tolak"}
            </Button>
          </>
        }
      >
        <Field
          label={decision?.action === "approve" ? "Catatan (opsional)" : "Alasan penolakan"}
          required={decision?.action === "reject"}
          hint={
            decision?.action === "approve"
              ? "Catatan akan terlihat oleh pemohon dan approver berikutnya."
              : "Wajib diisi minimal 5 karakter. Pemohon akan membaca alasan ini."
          }
        >
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={
              decision?.action === "approve"
                ? "Contoh: Disetujui, pastikan serah terima tugas ke rekan tim."
                : "Contoh: Bertepatan dengan tutup buku bulanan, mohon ajukan ulang setelah tanggal 5."
            }
          />
        </Field>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-body font-medium mt-0.5 break-words">{value}</dd>
    </div>
  );
}

/** Horizontal trail showing where the request sits in its approval chain. */
function StepTrail({ steps, currentStep }: { steps: Step[]; currentStep: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 pt-3 border-t border-line">
      {steps
        .slice()
        .sort((a, b) => a.stepNumber - b.stepNumber)
        .map((s, i) => {
          const isCurrent = s.stepNumber === currentStep && s.status === "pending";
          return (
            <React.Fragment key={s.stepNumber}>
              {i > 0 && <span className="w-4 h-px bg-line" aria-hidden />}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-caption font-semibold border",
                  s.status === "approved" && "bg-success-soft text-success border-success/20",
                  s.status === "rejected" && "bg-danger-soft text-danger border-danger/20",
                  s.status === "pending" && isCurrent && "bg-primary-soft text-primary border-primary/30",
                  s.status === "pending" && !isCurrent && "bg-surface-2 text-subtle border-line"
                )}
                title={
                  s.actionedAt
                    ? `${s.status} pada ${formatDateTime(s.actionedAt)}${s.comment ? ` — "${s.comment}"` : ""}`
                    : undefined
                }
              >
                {s.status === "approved" && <Check className="w-3 h-3" />}
                {s.status === "rejected" && <X className="w-3 h-3" />}
                {s.approverRole}
              </span>
            </React.Fragment>
          );
        })}
      <Badge tone="neutral" className="ml-auto">
        Langkah {currentStep} dari {steps.length}
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const SIMILARITY_COPY = {
  similar: {
    tone: "success" as const,
    title: "Sistem menilai wajahnya mirip",
    body: "Foto baru cocok dengan wajah yang terdaftar. Tetap periksa dengan mata Anda sendiri.",
  },
  uncertain: {
    tone: "warning" as const,
    title: "Sistem ragu",
    body: "Kemiripannya di batas. Bisa karena cahaya atau penampilan berubah — atau orang yang berbeda. Periksa baik-baik.",
  },
  different: {
    tone: "danger" as const,
    title: "Sistem menilai ini wajah yang berbeda",
    body: "Foto baru tidak cocok dengan wajah terdaftar. Setujui hanya bila Anda yakin ini orang yang sama, misalnya setelah perubahan penampilan besar.",
  },
  unknown: {
    tone: "info" as const,
    title: "Belum ada pembanding",
    body: "Karyawan ini belum punya wajah terdaftar untuk dibandingkan.",
  },
};

/**
 * Side-by-side view of the enrolled and proposed face.
 *
 * The approver is the check here — the system's similarity is shown as a hint
 * beneath the photos, never as the answer, because the case that matters most
 * (a colleague who looks alike) is exactly the one a score gets wrong.
 */
function FaceComparison({
  photos,
  similarity,
}: {
  photos: { current: string; proposed: string };
  similarity: keyof typeof SIMILARITY_COPY;
}) {
  const copy = SIMILARITY_COPY[similarity];
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        {(
          [
            ["Wajah terdaftar", photos.current],
            ["Wajah pengganti", photos.proposed],
          ] as const
        ).map(([label, url]) => (
          <figure key={label} className="space-y-1.5">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={label}
                className="w-full aspect-square object-cover rounded-[var(--radius-control)] border border-line"
              />
            ) : (
              <div className="w-full aspect-square grid place-items-center rounded-[var(--radius-control)] border border-dashed border-line text-label text-subtle">
                Tidak ada
              </div>
            )}
            <figcaption className="text-label text-muted">{label}</figcaption>
          </figure>
        ))}
      </div>
      <Alert tone={copy.tone} title={copy.title}>
        {copy.body}
      </Alert>
    </div>
  );
}
