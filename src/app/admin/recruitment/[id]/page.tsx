"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, CircleX, ExternalLink, FileText, History, Link2, Mail, MessageSquareText, Phone, RotateCcw, Star, Tag, UserPlus, UserRoundCheck, type IconComponent } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  SkeletonList,
  StatusBadge,
  Textarea,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { HireModal } from "@/components/recruitment/HireModal";
import { MoveStageDialog, type StageMove } from "@/components/recruitment/MoveStageDialog";
import { api, errorMessage } from "@/lib/client-api";
import { displayAnswer, EDUCATION_OPTIONS, type FieldType } from "@/lib/hr/application-form";
import { formatBytes, linkHost } from "@/lib/attachments";
import { formatDate, formatDateTime, formatRelative, wibDateKey, isoOffset, getTimezoneOffset, timezoneAbbr } from "@/lib/time";

interface PresentedAttachment {
  kind: "file" | "link";
  href: string;
  name?: string;
  size?: number;
  url?: string;
}

interface Answer {
  key: string;
  label: string;
  type: FieldType;
  section: string;
  system: string | null;
  value: unknown;
  attachments: PresentedAttachment[];
}

interface Candidate {
  _id: string;
  name: string;
  email: string;
  phone: string;
  city?: string;
  source: string;
  reference?: string;
  currentStage: string;
  status: string;
  rating?: number;
  tags?: string[];
  rejectionReason?: string;
  nextInterviewAt?: string | null;
  employeeId?: string | null;
  hiredAt?: string | null;
  availableFrom?: string | null;
  createdAt: string;
  answers: Answer[];
}

interface TimelineEntry {
  _id: string;
  type?: string;
  stage: string;
  status: string;
  notes?: string;
  authorName?: string;
  scheduledAt?: string;
  location?: string;
  interviewerName?: string;
  createdAt: string;
}

interface Detail {
  candidate: Candidate;
  vacancy: { _id: string; title: string; slug: string; status: string; stages: string[]; positionId?: string } | null;
  timeline: TimelineEntry[];
  otherApplications: Array<{
    _id: string;
    currentStage: string;
    status: string;
    createdAt: string;
    employeeId?: string | null;
    vacancyId?: { title: string } | null;
  }>;
  employee: { _id: string; employeeId: string; name: string; status: string; isNewHire?: boolean } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  career_page: "halaman karier",
  api: "API eksternal",
  manual: "input manual",
};

const TIMELINE_ICON: Record<string, IconComponent> = {
  applied: FileText,
  stage: ArrowRight,
  note: MessageSquareText,
  interview: CalendarClock,
  rejected: CircleX,
  hired: UserRoundCheck,
  rating: Star,
};

export default function ApplicantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"reject" | "interview" | "hire" | null>(null);
  const [pendingMove, setPendingMove] = useState<StageMove | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Detail>(`/api/v1/candidates/${params.id}`);
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

  const move = async (body: Record<string, unknown>, title = "Tersimpan") => {
    if (!data) return false;
    setBusy(true);
    try {
      const res = await api.patch("/api/v1/candidates", { id: data.candidate._id, ...body });
      toast.success(title, res.message);
      await load();
      return true;
    } catch (err) {
      toast.error("Gagal memperbarui", errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const activity = async (body: Record<string, unknown>) => {
    if (!data) return false;
    try {
      const res = await api.post(`/api/v1/candidates/${data.candidate._id}`, body);
      toast.success("Tersimpan", res.message);
      await load();
      return true;
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
      return false;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64" />
        <SkeletonList rows={5} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { candidate: c, vacancy, timeline, otherApplications, employee } = data;
  const stages = vacancy?.stages ?? [];
  const stageIndex = stages.indexOf(c.currentStage);
  const nextStage = stageIndex >= 0 && stageIndex < stages.length - 1 ? stages[stageIndex + 1] : null;
  const previousStage = stageIndex > 0 ? stages[stageIndex - 1] : null;
  const askMove = (to: string) => setPendingMove({ candidateId: c._id, candidateName: c.name, from: c.currentStage, to });
  const hired = Boolean(c.employeeId);
  const rejected = c.status === "rejected";
  const locked = hired;

  // Answers grouped by the section they were asked in; contact fields are
  // already in the header, so they are not repeated.
  const HEADER_KEYS = ["name", "email", "phone"];
  const sections: Array<{ title: string; answers: Answer[] }> = [];
  for (const a of c.answers.filter((a) => !HEADER_KEYS.includes(a.system ?? ""))) {
    const last = sections[sections.length - 1];
    if (last && last.title === a.section) last.answers.push(a);
    else sections.push({ title: a.section || "Lainnya", answers: [a] });
  }

  return (
    <div>
      <button
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/admin/recruitment"))}
        className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors mb-5 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
        Kembali
      </button>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 mb-6">
        <div className="min-w-0">
          <p className="eyebrow mb-2">
            {vacancy ? (
              <Link href={`/admin/vacancies/${vacancy._id}`} className="hover:text-primary transition-colors">
                {vacancy.title}
              </Link>
            ) : (
              "Lowongan dihapus"
            )}
          </p>
          <h1 className="text-display-sm md:text-display text-heading break-words">{c.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hired ? <Badge tone="success" icon={BadgeCheck}>Direkrut</Badge> : <StatusBadge status={c.status} />}
            <Badge tone="neutral">{c.currentStage}</Badge>
            {c.reference && <span className="text-label text-subtle">Ref. {c.reference}</span>}
            <span className="text-label text-subtle">
              Melamar {formatRelative(c.createdAt)} lewat {SOURCE_LABEL[c.source] ?? c.source}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <ContactLink icon={Mail} href={`mailto:${c.email}`} value={c.email} />
            {c.phone && <ContactLink icon={Phone} href={`tel:${c.phone.replace(/\s/g, "")}`} value={c.phone} />}
            {c.phone && (
              <ContactLink
                icon={MessageSquareText}
                href={`https://wa.me/${waNumber(c.phone)}`}
                value="WhatsApp"
                external
              />
            )}
          </div>
        </div>

        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            {rejected ? (
              <Button variant="secondary" icon={RotateCcw} loading={busy} onClick={() => move({ status: "in_progress" }, "Dibuka kembali")}>
                Buka kembali
              </Button>
            ) : (
              <>
                <Button variant="ghost" icon={CircleX} onClick={() => setModal("reject")} className="text-danger">
                  Tidak lolos
                </Button>
                <Button variant="secondary" icon={CalendarClock} onClick={() => setModal("interview")}>
                  Jadwalkan wawancara
                </Button>
                {previousStage && (
                  <Button variant="ghost" icon={ArrowLeft} disabled={busy} onClick={() => askMove(previousStage)}>
                    Kembali ke {previousStage}
                  </Button>
                )}
                {nextStage ? (
                  <Button icon={ArrowRight} loading={busy} onClick={() => askMove(nextStage)}>
                    Lanjut ke {nextStage}
                  </Button>
                ) : (
                  <Button variant="accent" icon={UserPlus} onClick={() => setModal("hire")}>
                    Terima jadi karyawan
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </header>

      {hired && employee && (
        <Alert tone="success" title="Pelamar ini sudah menjadi karyawan" className="mb-6">
          NIP {employee.employeeId}
          {c.hiredAt ? `, diterima ${formatDate(c.hiredAt)}` : ""}.{" "}
          {employee.isNewHire ? "Datanya masih ditandai baru dan perlu dilengkapi HRD. " : ""}
          <Link href={`/admin/employees?q=${encodeURIComponent(employee.employeeId)}`} className="font-semibold underline underline-offset-2">
            Buka data karyawan
          </Link>
        </Alert>
      )}
      {rejected && c.rejectionReason && (
        <Alert tone="danger" title="Tidak lolos" className="mb-6">
          {c.rejectionReason}
        </Alert>
      )}
      {!hired && !rejected && c.nextInterviewAt && new Date(c.nextInterviewAt) > new Date() && (
        <Alert tone="info" title="Wawancara terjadwal" className="mb-6">
          {formatDateTime(c.nextInterviewAt)}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left: application */}
        <div className="space-y-6 min-w-0">
          {stages.length > 0 && (
            <Card className="p-4 sm:p-5">
              <p className="eyebrow mb-3">Tahap seleksi</p>
              <StageTrack
                stages={stages}
                current={c.currentStage}
                disabled={locked || busy || rejected}
                onPick={askMove}
              />
            </Card>
          )}

          {sections.map((s, i) => (
            <Card key={`${s.title}-${i}`} className="p-4 sm:p-6">
              <p className="eyebrow mb-4">{s.title}</p>
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                {s.answers.map((a) => (
                  <AnswerItem key={a.key} answer={a} />
                ))}
              </dl>
            </Card>
          ))}
        </div>

        {/* Right: assessment & history */}
        <aside className="space-y-6 min-w-0">
          <Card className="p-4 sm:p-5">
            <p className="eyebrow mb-3">Penilaian tim</p>
            <RatingInput value={c.rating ?? 0} disabled={locked} onChange={(rating) => activity({ type: "rating", rating })} />
            <div className="mt-4">
              <TagsInput value={c.tags ?? []} disabled={locked} onChange={(tags) => activity({ type: "tags", tags })} />
            </div>
          </Card>

          <NoteBox onSubmit={(notes) => activity({ type: "note", notes })} />

          <Card className="p-4 sm:p-5">
            <p className="eyebrow mb-4 flex items-center gap-2">
              <History className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
              Riwayat
            </p>
            {timeline.length === 0 ? (
              <p className="text-body-sm text-muted">Belum ada riwayat.</p>
            ) : (
              <ol className="relative space-y-5 before:absolute before:left-[13px] before:top-2 before:bottom-2 before:w-px before:bg-line">
                {timeline.map((t) => {
                  const Icon = TIMELINE_ICON[t.type ?? "stage"] ?? ArrowRight;
                  return (
                    <li key={t._id} className="relative flex gap-3">
                      <span
                        className={cn(
                          "relative z-[1] grid place-items-center w-[27px] h-[27px] rounded-full border shrink-0 bg-surface",
                          t.type === "rejected" ? "border-danger/40 text-danger" : t.type === "hired" ? "border-success/40 text-success" : "border-line text-muted"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-body-sm font-medium text-foreground">{timelineTitle(t)}</p>
                        {t.type === "interview" && t.scheduledAt && (
                          <p className="text-label text-foreground/80 mt-0.5">
                            {formatDateTime(t.scheduledAt)}
                            {t.location ? ` · ${t.location}` : ""}
                            {t.interviewerName ? ` · ${t.interviewerName}` : ""}
                          </p>
                        )}
                        {t.notes && <p className="text-label text-muted mt-1 leading-relaxed whitespace-pre-wrap break-words">{t.notes}</p>}
                        <p className="text-caption text-subtle mt-1">
                          {formatDateTime(t.createdAt)}
                          {t.authorName ? ` · ${t.authorName}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {otherApplications.length > 0 && (
            <Card className="p-4 sm:p-5">
              <p className="eyebrow mb-3">Lamaran lain orang ini</p>
              <ul className="space-y-2.5">
                {otherApplications.map((o) => (
                  <li key={o._id}>
                    <Link href={`/admin/recruitment/${o._id}`} className="block rounded-[var(--radius-control)] -mx-2 px-2 py-1.5 hover:bg-surface-2 transition-colors">
                      <p className="text-body-sm font-medium text-foreground truncate">{o.vacancyId?.title ?? "Lowongan dihapus"}</p>
                      <p className="text-label text-muted">
                        {o.employeeId ? "Direkrut" : o.currentStage} · {formatDate(o.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <MoveStageDialog
        move={pendingMove}
        stages={stages}
        loading={busy}
        onClose={() => setPendingMove(null)}
        onConfirm={async (notes) => {
          if (!pendingMove) return;
          if (await move({ stage: pendingMove.to, ...(notes ? { notes } : {}) }, "Tahap diperbarui")) setPendingMove(null);
        }}
      />

      <RejectModal
        open={modal === "reject"}
        name={c.name}
        onClose={() => setModal(null)}
        onSubmit={async (reason) => {
          if (await move({ status: "rejected", rejectionReason: reason }, "Ditandai tidak lolos")) setModal(null);
        }}
        busy={busy}
      />

      <InterviewModal
        open={modal === "interview"}
        stage={c.currentStage}
        onClose={() => setModal(null)}
        onSubmit={async (body) => {
          if (await activity({ type: "interview", ...body })) setModal(null);
        }}
      />

      <HireModal
        candidate={modal === "hire" ? c : null}
        defaultPositionId={vacancy?.positionId ?? ""}
        defaultJoinDate={c.availableFrom ? wibDateKey(new Date(c.availableFrom)) : ""}
        onClose={() => setModal(null)}
        onHired={() => {
          setModal(null);
          void load();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function timelineTitle(t: TimelineEntry) {
  switch (t.type) {
    case "applied":
      return `Melamar · ${t.stage}`;
    case "note":
      return "Catatan";
    case "interview":
      return `Wawancara dijadwalkan · ${t.stage}`;
    case "rejected":
      return `Tidak lolos di ${t.stage}`;
    case "hired":
      return "Diterima jadi karyawan";
    case "rating":
      return "Penilaian diperbarui";
    default:
      return `Pindah ke ${t.stage}`;
  }
}

function ContactLink({
  icon: Icon,
  href,
  value,
  external,
}: {
  icon: IconComponent;
  href: string;
  value: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-2 text-body-sm text-muted hover:text-primary transition-colors break-all"
    >
      <Icon className="w-4 h-4 text-subtle shrink-0" strokeWidth={ICON_STROKE} />
      {value}
    </a>
  );
}

function StageTrack({
  stages,
  current,
  disabled,
  onPick,
}: {
  stages: string[];
  current: string;
  disabled: boolean;
  onPick: (stage: string) => void;
}) {
  const index = stages.indexOf(current);
  return (
    <ol className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {stages.map((s, i) => {
        const done = index >= 0 && i < index;
        const active = i === index;
        return (
          <li key={s} className="flex-1" style={{ minWidth: 112 }}>
            <button
              type="button"
              disabled={disabled || active}
              onClick={() => onPick(s)}
              title={active ? "Tahap saat ini" : `Pindahkan ke ${s}`}
              className={cn(
                "w-full text-left rounded-[var(--radius-control)] border px-3 py-2 transition-colors",
                active
                  ? "border-primary bg-primary-soft"
                  : done
                    ? "border-line bg-surface-2"
                    : "border-line bg-surface",
                !disabled && !active && "hover:border-primary cursor-pointer",
                disabled && !active && "cursor-default"
              )}
            >
              <span className={cn("block h-1 rounded-full mb-2", active || done ? "bg-primary" : "bg-line")} />
              <span className={cn("block text-label truncate", active ? "text-primary font-semibold" : done ? "text-foreground" : "text-muted")}>
                {s}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AnswerItem({ answer: a }: { answer: Answer }) {
  const wide = ["long_text", "file", "address", "multi_select"].includes(a.type);
  let content: React.ReactNode;

  if (a.type === "file") {
    content = a.attachments.length ? (
      <ul className="space-y-2">
        {a.attachments.map((att, i) => (
          <li key={i}>
            <a
              href={att.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5 hover:border-primary hover:bg-surface-2 transition-colors"
            >
              {att.kind === "link" ? (
                <Link2 className="w-4 h-4 text-subtle shrink-0" strokeWidth={ICON_STROKE} />
              ) : (
                <FileText className="w-4 h-4 text-subtle shrink-0" strokeWidth={ICON_STROKE} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm text-foreground truncate">
                  {att.kind === "link" ? linkHost(att.url ?? att.href) : att.name}
                </span>
                <span className="block text-caption text-subtle truncate">
                  {att.kind === "link" ? att.url : att.size ? formatBytes(att.size) : "Berkas"}
                </span>
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-subtle shrink-0" strokeWidth={ICON_STROKE} />
            </a>
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-subtle">Tidak dilampirkan</span>
    );
  } else {
    const options = a.system === "lastEducation" ? EDUCATION_OPTIONS : a.system === "gender" ? [{ value: "male", label: "Laki-laki" }, { value: "female", label: "Perempuan" }] : [];
    let text = displayAnswer(a, options);
    if (a.type === "date" && typeof a.value === "string" && a.value) text = formatDate(`${a.value}T00:00:00${isoOffset()}`);
    content = text ? (
      a.type === "url" ? (
        <a href={text} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
          {text}
        </a>
      ) : (
        <span className="whitespace-pre-wrap break-words">{text}</span>
      )
    ) : (
      <span className="text-subtle">—</span>
    );
  }

  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-label text-muted mb-1">{a.label}</dt>
      <dd className="text-body text-foreground">{content}</dd>
    </div>
  );
}

function RatingInput({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Penilaian">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} dari 5`}
            disabled={disabled}
            onMouseEnter={() => setHover(n)}
            // Clicking the current rating again clears it.
            onClick={() => onChange(value === n ? 0 : n)}
            className="p-1 cursor-pointer disabled:cursor-default"
          >
            <Star
              className={cn("w-6 h-6 transition-colors", n <= shown ? "text-warning fill-current" : "text-line-strong")}
              strokeWidth={ICON_STROKE}
            />
          </button>
        ))}
      </div>
      <span className="text-body-sm text-muted">{value ? `${value}/5` : "Belum dinilai"}</span>
    </div>
  );
}

function TagsInput({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().toLowerCase().slice(0, 30);
    if (!t || value.includes(t) || value.length >= 12) return setDraft("");
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.length === 0 && <span className="text-label text-subtle">Belum ada label.</span>}
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line pl-2.5 pr-1 py-0.5 text-label text-foreground">
            {t}
            {!disabled && (
              <button
                type="button"
                aria-label={`Hapus label ${t}`}
                onClick={() => onChange(value.filter((x) => x !== t))}
                className="grid place-items-center w-4 h-4 rounded-full hover:bg-line text-subtle cursor-pointer"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="relative">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtle pointer-events-none" strokeWidth={ICON_STROKE} />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder="Tambah label, tekan Enter"
            className="pl-9 h-9 text-body-sm"
            aria-label="Tambah label"
          />
        </div>
      )}
    </div>
  );
}

function NoteBox({ onSubmit }: { onSubmit: (notes: string) => Promise<boolean> }) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Card className="p-4 sm:p-5">
      <p className="eyebrow mb-3">Catatan</p>
      <Textarea
        value={notes}
        maxLength={2000}
        rows={3}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Hasil wawancara, kesan, atau hal yang perlu dicek. Terlihat oleh tim rekrutmen."
        aria-label="Catatan"
      />
      <div className="mt-2.5 flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          loading={saving}
          disabled={notes.trim().length < 2}
          onClick={async () => {
            setSaving(true);
            if (await onSubmit(notes.trim())) setNotes("");
            setSaving(false);
          }}
        >
          Simpan catatan
        </Button>
      </div>
    </Card>
  );
}

function RejectModal({
  open,
  name,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Tandai ${name} tidak lolos?`}
      description="Data pelamar tetap tersimpan sebagai riwayat dan dapat dibuka kembali kapan saja."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="danger" size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
            Tandai tidak lolos
          </Button>
        </>
      }
    >
      <Field label="Alasan" required htmlFor="rj-reason" hint="Hanya terlihat tim internal. Membantu bila orang ini melamar lagi.">
        <Textarea
          id="rj-reason"
          autoFocus
          maxLength={600}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Contoh: Pengalaman belum sesuai kebutuhan level ini."
        />
      </Field>
    </Modal>
  );
}

function InterviewModal({
  open,
  stage,
  onClose,
  onSubmit,
}: {
  open: boolean;
  stage: string;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [people, setPeople] = useState<Array<{ _id: string; name: string; email: string; role: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || people.length) return;
    api
      .get<typeof people>("/api/v1/candidates/interviewers")
      .then((res) => setPeople(res.data ?? []))
      .catch(() => {});
  }, [open, people.length]);

  const [today] = useState(() => new Date(Date.now() + getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Jadwalkan wawancara"
      description={`Untuk tahap ${stage}. Pewawancara yang dipilih mendapat notifikasi berisi tautan ke pelamar ini.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!valid}
            onClick={async () => {
              setSaving(true);
              await onSubmit({
                scheduledAt: `${date}T${time}:00${isoOffset()}`,
                location: location.trim(),
                interviewerUserId: interviewer || undefined,
                notes: notes.trim(),
              });
              setSaving(false);
            }}
          >
            Simpan jadwal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <Field label="Tanggal" required htmlFor="iv-date">
            <DatePicker id="iv-date" value={date} onChange={setDate} min={today} />
          </Field>
          <Field label={`Jam (${timezoneAbbr()})`} required htmlFor="iv-time">
            <Input id="iv-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Tempat atau tautan" htmlFor="iv-loc" hint="Alamat kantor, ruang rapat, atau tautan Google Meet/Zoom.">
          <Input id="iv-loc" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Pewawancara" htmlFor="iv-who">
          <Combobox
            id="iv-who"
            value={interviewer}
            onChange={setInterviewer}
            options={people.map((p) => ({ value: p._id, label: p.name, hint: `${p.role} · ${p.email}` }))}
            placeholder="Pilih pewawancara (opsional)"
            clearable
            sheetTitle="Pewawancara"
          />
        </Field>
        <Field label="Catatan" htmlFor="iv-notes">
          <Textarea id="iv-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
