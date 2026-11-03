"use client";

import React, { useState } from "react";
import { CheckCircle2, FileText, Link2, ListChecks } from "@/components/icons";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Modal, Textarea, cn, type BadgeTone } from "@/components/ui";
import { FileOrLinkInput, attachmentProblem, toAttachmentInputs, type AttachmentItem } from "@/components/ui/FileOrLinkInput";
import { api, errorMessage } from "@/lib/client-api";
import { linkHost } from "@/lib/attachments";
import { MAX_PROOF_ITEMS, PROOF_LABELS, TASK_STATUS_LABELS, proofProblem, taskDone, type ProofMode, type ProofType, type TaskStatus } from "@/lib/hr/attendance-tasks";

export type ShownProof =
  | { kind: "file"; key: string; name: string; mime: string; size: number; href: string }
  | { kind: "link"; url: string; href: string };

export interface DayTask {
  _id: string;
  source: "fixed" | "assigned";
  title: string;
  description: string;
  proofTypes: ProofType[];
  proofMode: ProofMode;
  required: boolean;
  blockClockOut: boolean;
  requireReview: boolean;
  status: TaskStatus;
  proofText: string;
  proofItems: ShownProof[];
  submittedAt?: string | null;
  reviewNote: string;
}

export interface DayTasks {
  dateKey: string;
  tasks: DayTask[];
  summary: { total: number; done: number; pending: number; blocked: boolean };
}

export const TASK_TONE: Record<TaskStatus, BadgeTone> = { pending: "neutral", submitted: "info", approved: "success", rejected: "danger", waived: "neutral" };

/** The proof an employee sent, as the reviewer and the employee both read it. */
export function ProofView({ task }: { task: Pick<DayTask, "proofText" | "proofItems"> }) {
  if (!task.proofText && !task.proofItems?.length) return null;
  return (
    <div className="space-y-2">
      {task.proofText && <p className="whitespace-pre-line break-words text-body-sm text-foreground">{task.proofText}</p>}
      {task.proofItems?.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {task.proofItems.map((item) => {
            const image = item.kind === "file" && item.mime.startsWith("image/");
            return (
              <li key={item.kind === "file" ? item.key : item.url} className="min-w-0">
                <a href={item.href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-xl bg-background-tertiary-default px-3 py-2 text-body-sm font-medium text-heading outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
                    <img src={item.href} alt="" className="size-8 rounded-lg object-cover" />
                  ) : item.kind === "link" ? <Link2 className="size-4 shrink-0" aria-hidden /> : <FileText className="size-4 shrink-0" aria-hidden />}
                  <span className="truncate">{item.kind === "link" ? linkHost(item.url) : item.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The day's tasks on the attendance page. Read top to bottom like a checklist:
 * what is left is what stands between the employee and clocking out.
 */
export function TodayTasks({ data, clockedIn, onChanged }: { data: DayTasks; clockedIn: boolean; onChanged: () => void }) {
  const [active, setActive] = useState<DayTask | null>(null);
  const { summary } = data;
  const finished = summary.total > 0 && summary.pending === 0;

  return (
    <Card>
      <CardHeader
        icon={ListChecks}
        title="Task hari ini"
        description={summary.total ? `${summary.done} dari ${summary.total} task wajib selesai` : "Tidak ada task wajib hari ini"}
      />
      <CardBody className="space-y-3">
        {summary.blocked && clockedIn && <Alert tone="warning">Absen pulang terbuka setelah semua task wajib selesai. Bila berhalangan, minta atasan membebaskan task.</Alert>}
        {finished && <Alert tone="success">Semua task wajib selesai.</Alert>}
        {!clockedIn && <p className="text-body-sm text-muted">Task dapat dikerjakan setelah absen masuk.</p>}
        <ul className="divide-y divide-line">
          {data.tasks.map((task) => {
            const done = taskDone(task);
            return (
              <li key={task._id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", done ? "bg-success-soft text-success" : "bg-background-tertiary-default text-subtle")} aria-hidden>
                  {done ? <CheckCircle2 className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn("text-body font-medium", done ? "text-muted" : "text-heading")}>{task.title}</p>
                    {!task.required && <Badge>Opsional</Badge>}
                    {task.source === "assigned" && <Badge tone="primary">Dari atasan</Badge>}
                  </div>
                  {task.description && <p className="whitespace-pre-line break-words text-body-sm text-muted">{task.description}</p>}
                  {task.status === "rejected" && <p className="text-body-sm text-danger">Perlu diperbaiki: {task.reviewNote}</p>}
                  {task.status === "waived" && <p className="text-body-sm text-muted">Dibebaskan atasan: {task.reviewNote}</p>}
                  {task.status === "submitted" && task.requireReview && <p className="text-body-sm text-info">Menunggu persetujuan atasan.</p>}
                  <ProofView task={task} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge tone={TASK_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                  {clockedIn && (task.status === "pending" || task.status === "rejected" || task.status === "submitted") && (
                    <Button size="sm" variant={task.status === "submitted" ? "ghost" : "secondary"} onClick={() => setActive(task)}>
                      {task.status === "submitted" ? "Ubah bukti" : task.proofTypes.length ? "Kirim bukti" : "Tandai selesai"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
      {active && <ProofModal task={active} onClose={() => setActive(null)} onDone={() => { setActive(null); onChanged(); }} />}
    </Card>
  );
}

function ProofModal({ task, onClose, onDone }: { task: DayTask; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(task.proofText ?? "");
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wantsText = task.proofTypes.includes("text");
  const wantsFile = task.proofTypes.includes("file");
  const wantsLink = task.proofTypes.includes("link");
  const none = !task.proofTypes.length;

  const submit = async () => {
    const problem = attachmentProblem(items) ?? proofProblem(task, {
      text,
      files: items.filter((i) => i.kind === "file").length,
      links: items.filter((i) => i.kind === "link").length,
    });
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError("");
    try {
      await api.post("/api/v1/attendance/tasks", { taskId: task._id, text, attachments: toAttachmentInputs(items) });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Bukti gagal dikirim."));
    } finally {
      setSaving(false);
    }
  };

  const rule = none ? "" : task.proofTypes.length === 1
    ? `Wajib: ${PROOF_LABELS[task.proofTypes[0]].toLowerCase()}.`
    : `${task.proofMode === "all" ? "Wajib semua" : "Wajib salah satu"}: ${task.proofTypes.map((t) => PROOF_LABELS[t].toLowerCase()).join(", ")}.`;

  return (
    <Modal
      open
      onClose={onClose}
      title={task.title}
      description={[task.description, rule].filter(Boolean).join(" ")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>{none ? "Tandai selesai" : "Kirim bukti"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {task.status === "rejected" && <Alert tone="warning" title="Catatan atasan">{task.reviewNote}</Alert>}
        {task.proofItems?.length > 0 && <p className="text-body-sm text-muted">Mengirim ulang akan mengganti bukti sebelumnya.</p>}
        {(wantsText || none) && (
          <Field label={none ? "Catatan (opsional)" : "Laporan"}>
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={none ? "" : "Contoh: mengunjungi 5 toko di Bekasi, 2 pesanan baru"} />
          </Field>
        )}
        {(wantsFile || wantsLink) && (
          <Field label={wantsFile && wantsLink ? "Berkas atau tautan" : wantsFile ? "Foto atau berkas" : "Tautan"}>
            <FileOrLinkInput value={items} onChange={setItems} context="task" multiple maxFiles={MAX_PROOF_ITEMS} allowFile={wantsFile} allowLink={wantsLink} disabled={saving} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
