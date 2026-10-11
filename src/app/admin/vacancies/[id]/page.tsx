"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, ClipboardList, ListFilter, MapPin, Star, CircleCheck, CircleX, FileText, MoveRight, UserPlus, Users } from "@/components/icons";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ICON_STROKE,
  PageHeader,
  SkeletonList,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatRelative } from "@/lib/time";

import { AddCandidateModal } from "@/components/recruitment/AddCandidateModal";
import { MoveStageDialog, type StageMove } from "@/components/recruitment/MoveStageDialog";
import { FloatingPanel, useFloatingPlacement } from "@/components/ui/Floating";
import { useToast } from "@/components/ui/Toast";
interface HistoryEntry {
  _id: string;
  stage: string;
  status: string;
  notes?: string;
  createdAt: string;
  interviewerId?: { name?: string } | null;
}

interface Candidate {
  _id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  currentStage: string;
  status: string;
  cvUrl?: string;
  coverLetter?: string;
  portfolioUrl?: string;
  rejectionReason?: string;
  city?: string;
  rating?: number;
  nextInterviewAt?: string | null;
  employeeId?: string | null;
  offeringSalary?: number;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

interface BoardData {
  vacancy: {
    _id: string;
    title: string;
    slug: string;
    status: string;
    stages: string[];
    openings: number;
    divisionId?: { name: string } | null;
    branchId?: { name: string } | null;
    positionId?: { _id: string; name: string } | null;
  };
  board: Record<string, Candidate[]>;
  orphaned: Candidate[];
  total: number;
  byStatus: Record<string, number>;
}

export default function VacancyBoardPage() {
  const params = useParams<{ id: string }>();

  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(null);
  const [pending, setPending] = useState<(StageMove & { rejected: boolean }) | null>(null);
  const [moving, setMoving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<BoardData>(`/api/v1/vacancies/${params.id}`);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64" />
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { vacancy, board, orphaned } = data;
  const everyone = [...Object.values(board).flat(), ...orphaned];
  const requestMove = (candidateId: string, to: string) => {
    const candidate = everyone.find((c) => c._id === candidateId);
    if (!candidate || candidate.employeeId || candidate.currentStage === to) return;
    setPending({ candidateId, candidateName: candidate.name, from: candidate.currentStage, to, rejected: candidate.status === "rejected" });
  };
  const confirmMove = async (notes: string) => {
    if (!pending) return;
    setMoving(true);
    try {
      const res = await api.patch("/api/v1/candidates", {
        id: pending.candidateId,
        stage: pending.to,
        ...(pending.rejected ? { status: "in_progress" } : {}),
        ...(notes ? { notes } : {}),
      });
      toast.success("Tahap diperbarui", res.message);
      setPending(null);
      await load();
    } catch (err) {
      toast.error("Gagal memindahkan", errorMessage(err));
    } finally {
      setMoving(false);
    }
  };

  return (
    <div>
      <Link
        href="/admin/vacancies"
        className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
        Semua lowongan
      </Link>

      <PageHeader
        eyebrow="Papan pelamar"
        title={vacancy.title}
        description={
          [vacancy.divisionId?.name, vacancy.branchId?.name].filter(Boolean).join(" · ") ||
          "Penempatan belum diatur"
        }
        actions={
          <>
            <Link href={`/admin/recruitment?vacancyId=${vacancy._id}`}>
              <Button variant="ghost" icon={ListFilter}>
                Daftar & filter
              </Button>
            </Link>
            <Link href={`/admin/vacancies/${vacancy._id}/form`}>
              <Button variant="secondary" icon={ClipboardList}>
                Atur formulir lamaran
              </Button>
            </Link>
            <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
              Tambah pelamar
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-7">
        <StatCard label="Total pelamar" value={data.total} icon={Users} />
        <StatCard
          label="Sedang diproses"
          value={data.byStatus.in_progress ?? 0}
          hint="masuk tahap seleksi"
          icon={ArrowRight}
          tone="info"
        />
        <StatCard
          label="Lolos"
          value={data.byStatus.passed ?? 0}
          hint={`kebutuhan ${vacancy.openings} posisi`}
          icon={CircleCheck}
          tone="success"
        />
        <StatCard
          label="Tidak lolos"
          value={data.byStatus.rejected ?? 0}
          icon={CircleX}
          tone={data.byStatus.rejected ? "danger" : "neutral"}
        />
      </div>

      {orphaned.length > 0 && (
        <Alert tone="warning" title="Ada pelamar di tahap yang sudah dihapus" className="mb-6">
          {orphaned.length} pelamar masih tercatat pada tahap yang tidak lagi ada di lowongan ini.
          Buka kartunya dan pindahkan ke salah satu tahap aktif.
        </Alert>
      )}

      {data.total === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Belum ada pelamar"
            description={
              vacancy.status === "open"
                ? "Lowongan sudah tayang. Lamaran yang masuk lewat halaman karier akan muncul di sini."
                : "Lowongan ini belum tayang, jadi belum bisa menerima lamaran dari halaman karier."
            }
            action={
              <Button size="sm" icon={UserPlus} onClick={() => setAddOpen(true)}>
                Tambah pelamar manual
              </Button>
            }
          />
        </Card>
      ) : (
        <>
        <p className="mb-3 text-label text-subtle">
          Seret kartu ke kolom lain, atau pakai tombol <b>Pindah</b> di kartu. Setiap perpindahan dikonfirmasi dulu.
        </p>
        <div className="overflow-x-auto pb-4 -mx-1 px-1">
          <div className="flex gap-4 min-w-max">
            {vacancy.stages.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                stages={vacancy.stages}
                candidates={board[stage] ?? []}
                dragging={dragging}
                onDragState={setDragging}
                onRequestMove={requestMove}
              />
            ))}
            {orphaned.length > 0 && (
              <StageColumn
                stage="Tahap tidak dikenal"
                stages={vacancy.stages}
                candidates={orphaned}
                orphan
                dragging={dragging}
                onDragState={setDragging}
                onRequestMove={requestMove}
              />
            )}
          </div>
        </div>
        </>
      )}

      <MoveStageDialog
        move={pending}
        stages={vacancy.stages}
        rejected={pending?.rejected}
        loading={moving}
        onClose={() => setPending(null)}
        onConfirm={confirmMove}
      />

      <AddCandidateModal
        open={addOpen}
        vacancyId={vacancy._id}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          void load();
        }}
      />

    </div>
  );
}

/* ------------------------------------------------------------------ */

function StageColumn({
  stage,
  stages,
  candidates,
  orphan = false,
  dragging,
  onDragState,
  onRequestMove,
}: {
  stage: string;
  stages: string[];
  candidates: Candidate[];
  orphan?: boolean;
  dragging: { id: string; from: string } | null;
  onDragState: (value: { id: string; from: string } | null) => void;
  onRequestMove: (candidateId: string, to: string) => void;
}) {
  const [over, setOver] = useState(false);
  // Every real column accepts drops from another column; the unknown-stage column only gives.
  const accepts = !orphan && !!dragging && dragging.from !== stage;

  return (
    <section
      className="w-[290px] shrink-0"
      onDragOver={(e) => {
        if (!accepts) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/x-candidate") || dragging?.id;
        onDragState(null);
        if (id && accepts) onRequestMove(id, stage);
      }}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-t-[var(--radius-card)] border border-b-0 border-line",
          orphan ? "bg-warning-soft" : "bg-surface-2"
        )}
      >
        <h2 className="text-body-sm font-semibold text-heading truncate" title={stage}>{stage}</h2>
        <span className="text-label font-semibold text-subtle tabular-nums shrink-0">
          {candidates.length}
        </span>
      </header>

      <div
        className={cn(
          "border border-line rounded-b-[var(--radius-card)] bg-surface/50 p-2 space-y-2 min-h-32 transition-colors",
          accepts && "border-dashed border-primary/50",
          over && "border-primary bg-primary-soft"
        )}
      >
        {candidates.length === 0 ? (
          <p className="text-label text-subtle text-center py-8 px-3 leading-relaxed">
            {accepts ? "Lepaskan di sini untuk memindahkan." : "Belum ada pelamar di tahap ini."}
          </p>
        ) : (
          candidates.map((c) => {
            const movable = !c.employeeId;
            return (
              <div
                key={c._id}
                draggable={movable}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/x-candidate", c._id);
                  e.dataTransfer.effectAllowed = "move";
                  onDragState({ id: c._id, from: stage });
                }}
                onDragEnd={() => onDragState(null)}
                className={cn(
                  "card p-3.5 hover:border-primary transition-[border-color,opacity]",
                  movable && "cursor-grab active:cursor-grabbing",
                  dragging?.id === c._id && "opacity-50"
                )}
              >
                <Link href={`/admin/recruitment/${c._id}`} draggable={false} className="block text-left">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-body-sm font-semibold text-heading truncate" title={c.name}>{c.name}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1.5 text-label text-muted truncate" title={c.email}>{c.email}</p>
                  {(c.city || (c.rating ?? 0) > 0) && (
                    <div className="mt-1.5 flex items-center gap-3 text-label text-muted">
                      {c.city && (
                        <span className="inline-flex items-center gap-1 truncate" title={c.city}>
                          <MapPin className="w-3 h-3 shrink-0" strokeWidth={ICON_STROKE} />
                          {c.city}
                        </span>
                      )}
                      {(c.rating ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-warning shrink-0">
                          <Star className="w-3 h-3 fill-current" strokeWidth={ICON_STROKE} />
                          {c.rating}
                        </span>
                      )}
                    </div>
                  )}
                  {c.nextInterviewAt && !c.employeeId && c.status !== "rejected" && new Date(c.nextInterviewAt) > new Date() && (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-label text-info">
                      <CalendarClock className="w-3 h-3" strokeWidth={ICON_STROKE} />
                      {formatDateTime(c.nextInterviewAt)}
                    </p>
                  )}
                </Link>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-caption text-subtle">{formatRelative(c.updatedAt)}</span>
                  <span className="flex items-center gap-2">
                    {c.cvUrl && (
                      <span className="inline-flex items-center gap-1 text-caption text-subtle">
                        <FileText className="w-3 h-3" strokeWidth={ICON_STROKE} />
                        CV
                      </span>
                    )}
                    {movable && (
                      <MoveMenu stages={stages} current={orphan ? "" : stage} name={c.name} onPick={(to) => onRequestMove(c._id, to)} />
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** Keyboard- and touch-friendly alternative to drag & drop. */
function MoveMenu({ stages, current, name, onPick }: { stages: string[]; current: string; name: string; onPick: (stage: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(open, triggerRef, { width: 230, maxHeight: 320 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Pindahkan ${name} ke tahap lain`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption font-semibold text-muted hover:text-primary hover:bg-primary-soft transition-colors cursor-pointer"
      >
        <MoveRight className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
        Pindah
      </button>
      {open && (
        <FloatingPanel ref={panelRef} placement={placement} onDismiss={() => setOpen(false)} title="Pindahkan ke tahap">
          <div role="menu" className="p-1.5 overflow-y-auto">
            {stages.map((s, i) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                disabled={s === current}
                onClick={() => {
                  setOpen(false);
                  onPick(s);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body-sm text-foreground hover:bg-primary-soft hover:text-primary disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground cursor-pointer disabled:cursor-default"
              >
                <span className="w-5 shrink-0 text-caption text-subtle tabular-nums">{i + 1}</span>
                <span className="truncate" title={s}>{s}</span>
                {s === current && <span className="ml-auto shrink-0 text-caption text-subtle">saat ini</span>}
              </button>
            ))}
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
