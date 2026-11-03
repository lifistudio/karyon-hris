"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, ClipboardCheck, Edit, FileUp, Printer, RefreshCcw, UserPlus, Wrench, X, XCircle } from "@/components/icons";
import { Alert, Badge, Button, ButtonLink, SkeletonList, Tabs, cn } from "@/components/ui";
import { Portal } from "@/components/ui/Floating";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/time";
import { generateCode39Svg } from "@/lib/barcode";
import { ASSIGNMENT_STATUS_LABELS, CHECK_TYPE_LABELS, EVENT_TYPE_LABELS, type CheckItem, type InventoryEventType, type SpecCheck, type SpecValue } from "@/lib/inventory/templates";
import { ChecklistView, PhotoGrid, SpecList, categoryLabel, conditionLabel, conditionTone, type ShownPhoto } from "./parts";

export interface AssetDetail {
  asset: {
    _id: string;
    code: string;
    name: string;
    category: string;
    condition: string;
    specs?: SpecValue[];
    location?: string;
    acquiredAt?: string;
    notes?: string;
    createdAt?: string;
    initialCheck?: { condition: string; checklist: CheckItem[]; specs?: SpecValue[]; photos?: ShownPhoto[]; reading?: number | null; notes?: string; recordedAt: string } | null;
  };
  assignments: Array<{
    _id: string;
    status: string;
    handoverDate: string;
    employeeId?: { _id: string; name: string; employeeId?: string } | null;
    assignedBy?: { email?: string } | null;
    receivedBy?: { email?: string } | null;
    handoverCondition?: string;
    handoverChecklist?: CheckItem[];
    handoverPhotos?: ShownPhoto[];
    handoverSpecs?: SpecValue[];
    handoverReading?: number | null;
    handoverNotes?: string;
    signedVia?: string;
    signatureHash?: string;
    signature?: { href: string; pdf: boolean } | null;
    signedAt?: string | null;
    employeeNote?: string;
    disputeNote?: string;
    returnDate?: string | null;
    returnCondition?: string;
    returnChecklist?: CheckItem[];
    returnPhotos?: ShownPhoto[];
    returnReading?: number | null;
    returnNotes?: string;
    cancelReason?: string;
  }>;
  checks: Array<{
    _id: string;
    type: string;
    period: string;
    auditDate: string;
    previousCondition?: string | null;
    condition: string;
    checklist?: CheckItem[];
    specChecks?: SpecCheck[];
    photos?: ShownPhoto[];
    reading?: number | null;
    notes?: string;
    status: "verified" | "changed" | "flagged";
    findings?: string[];
    changes?: string[];
    auditorId?: { email?: string } | null;
    holderEmployeeId?: { name?: string } | null;
  }>;
  events: Array<{
    _id: string;
    type: InventoryEventType;
    eventDate: string;
    component?: string;
    fromValue?: string;
    toValue?: string;
    description?: string;
    vendor?: string;
    cost?: number | null;
    photos?: ShownPhoto[];
    conditionBefore?: string | null;
    conditionAfter?: string | null;
    actorUserId?: { email?: string } | null;
    employeeId?: { name?: string } | null;
    resolvedAt?: string | null;
  }>;
}

type Section = "info" | "history" | "checks" | "handover";

const assignmentTone = (s: string) =>
  (s === "active" ? "success" : s === "pending_handover" ? "warning" : s === "disputed" ? "danger" : "neutral") as "success" | "warning" | "danger" | "neutral";

/**
 * Everything about one asset: what it is, how it looked when registered, how
 * every check compared, and who has held it. The actions at the bottom follow
 * the asset's state, so only the next sensible step is offered.
 */
export function AssetDrawer({
  assetId,
  refreshKey,
  onClose,
  onEdit,
  onAssign,
  onTransfer,
  onReturn,
  onCancelHandover,
  onCheck,
  onRepair,
  onPaperBast,
}: {
  assetId: string | null;
  refreshKey: number;
  onClose: () => void;
  onEdit: (detail: AssetDetail) => void;
  onAssign: (detail: AssetDetail) => void;
  onTransfer: (detail: AssetDetail) => void;
  onReturn: (detail: AssetDetail) => void;
  onCancelHandover: (detail: AssetDetail) => void;
  onCheck: (detail: AssetDetail) => void;
  onRepair: (detail: AssetDetail) => void;
  onPaperBast: (detail: AssetDetail) => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("info");
  const [signature, setSignature] = useState<{ href: string; pdf: boolean } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    queueMicrotask(() => alive && setError(""));
    api.get<AssetDetail>(`/api/v1/inventory/${assetId}`)
      .then((res) => alive && setDetail(res.data ?? null))
      .catch((err) => alive && setError(errorMessage(err, "Detail aset gagal dimuat.")));
    return () => { alive = false; };
  }, [assetId, refreshKey]);

  useEffect(() => {
    if (!assetId) queueMicrotask(() => { setDetail(null); setSection("info"); setSignature(null); });
  }, [assetId]);

  const open = detail?.assignments.find((a) => ["pending_handover", "active", "disputed"].includes(a.status));
  const asset = detail?.asset;
  const isLost = asset?.condition === "lost";

  return (
    <AnimatePresence>
      {assetId && (
        <Portal>
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-overlay backdrop-blur-[2px]" />
            <motion.aside
              aria-label="Detail aset"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 260 }}
              className="drawer-panel max-w-xl"
            >
              <div className="drawer-head">
                <div className="min-w-0">
                  {asset ? (
                    <>
                      <p className="font-mono text-body-sm text-muted">{asset.code}</p>
                      <h2 className="text-title-sm font-semibold text-heading">{asset.name}</h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge>{categoryLabel(asset.category)}</Badge>
                        <Badge tone={conditionTone(asset.condition)} dot>{conditionLabel(asset.condition)}</Badge>
                        <Badge tone={open ? assignmentTone(open.status) : "primary"}>{open ? ASSIGNMENT_STATUS_LABELS[open.status] : isLost ? "Tidak tersedia" : "Tersedia"}</Badge>
                      </div>
                    </>
                  ) : (
                    <h2 className="text-title-sm font-semibold text-heading">Detail aset</h2>
                  )}
                </div>
                <button type="button" onClick={onClose} aria-label="Tutup" className="icon-close"><X className="h-4 w-4" /></button>
              </div>

              <div className="drawer-body space-y-5">
                {error && <Alert tone="danger">{error}</Alert>}
                {!detail && !error && <SkeletonList rows={4} />}
                {detail && asset && (
                  <>
                    {open && <HolderCard assignment={open} onSignature={setSignature} />}
                    {detail.events.filter((e) => e.type === "employee_report" && !e.resolvedAt).map((e) => (
                      <Alert key={e._id} tone="warning" title={`${e.employeeId?.name ?? "Karyawan"} melaporkan masalah`}>{e.description}</Alert>
                    ))}

                    <Tabs
                      value={section}
                      onChange={setSection}
                      tabs={[
                        { id: "info", label: "Spesifikasi" },
                        { id: "history", label: "Riwayat" },
                        { id: "checks", label: "Pengecekan", count: detail.checks.filter((c) => c.type !== "initial").length },
                        { id: "handover", label: "Serah terima", count: detail.assignments.length },
                      ]}
                    />

                    {section === "info" && <InfoSection detail={detail} />}
                    {section === "history" && <HistorySection detail={detail} />}
                    {section === "checks" && <ChecksSection detail={detail} />}
                    {section === "handover" && <HandoverSection detail={detail} onSignature={setSignature} />}
                  </>
                )}
              </div>

              {detail && (
                <div className="drawer-foot">
                  <Button variant="ghost" icon={Edit} onClick={() => onEdit(detail)}>Ubah data</Button>
                  <Button variant="ghost" icon={Wrench} onClick={() => onRepair(detail)}>Catat perbaikan</Button>
                  {open && <ButtonLink variant="ghost" icon={Printer} href={`/print/bast/${asset?._id}/${open._id}`}>Cetak BAST</ButtonLink>}
                  <Button variant="secondary" icon={ClipboardCheck} onClick={() => onCheck(detail)}>{isLost ? "Catat aset ditemukan" : "Catat pengecekan"}</Button>
                  {open?.status === "active" && <Button variant="secondary" icon={ArrowLeftRight} onClick={() => onTransfer(detail)}>Pindahkan</Button>}
                  {open?.status === "active" && <Button icon={RefreshCcw} onClick={() => onReturn(detail)}>Terima pengembalian</Button>}
                  {open?.status === "pending_handover" && <Button variant="secondary" icon={FileUp} onClick={() => onPaperBast(detail)}>Unggah BAST kertas</Button>}
                  {(open?.status === "pending_handover" || open?.status === "disputed") && (
                    <Button variant="secondary" icon={XCircle} onClick={() => onCancelHandover(detail)}>Batalkan serah terima</Button>
                  )}
                  {!open && !isLost && <Button icon={UserPlus} onClick={() => onAssign(detail)}>Serahkan ke karyawan</Button>}
                </div>
              )}
            </motion.aside>
          </div>

          {signature && (
            <div className="fixed inset-0 z-[80] grid place-items-center bg-overlay p-4" onClick={() => setSignature(null)}>
              <div className="max-w-md rounded-3xl bg-background-primary-default p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <p className="mb-3 text-body font-semibold text-heading">Tanda tangan BAST</p>
                {signature.pdf ? (
                  <a href={signature.href} download="bast.pdf" className="text-primary hover:underline">Unduh BAST (PDF)</a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signature data URL
                  <img src={signature.href} alt="Tanda tangan BAST" className="max-h-60 rounded-xl bg-white object-contain" />
                )}
                <div className="mt-3 text-end"><Button variant="secondary" onClick={() => setSignature(null)}>Tutup</Button></div>
              </div>
            </div>
          )}
        </Portal>
      )}
    </AnimatePresence>
  );
}

type HistoryEntry = { id: string; at: string; title: string; tone: "primary" | "success" | "warning" | "danger" | "neutral"; lines: string[]; photos?: ShownPhoto[] };

/** Every event of the asset's life on one line of time, newest first. */
function historyOf({ asset, checks, assignments, events }: AssetDetail): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  if (asset.initialCheck) entries.push({ id: "initial", at: asset.initialCheck.recordedAt, title: "Aset didaftarkan", tone: "primary", lines: [`Kondisi awal ${conditionLabel(asset.initialCheck.condition)}`], photos: asset.initialCheck.photos });
  for (const c of checks) {
    if (c.type === "initial") continue;
    entries.push({
      id: c._id, at: c.auditDate, title: CHECK_TYPE_LABELS[c.type] ?? c.type,
      tone: c.status === "flagged" ? "danger" : c.status === "changed" ? "primary" : "success",
      lines: [`Kondisi ${conditionLabel(c.condition)}${c.auditorId?.email ? ` · ${c.auditorId.email}` : ""}`, ...(c.findings ?? []), ...(c.changes ?? [])],
      photos: c.photos,
    });
  }
  for (const a of assignments) {
    const name = a.employeeId?.name ?? "karyawan";
    entries.push({ id: `${a._id}-out`, at: a.handoverDate, title: `Diserahkan ke ${name}`, tone: "neutral", lines: [`Kondisi ${conditionLabel(a.handoverCondition)}`, ...(a.handoverNotes ? [a.handoverNotes] : [])], photos: a.handoverPhotos });
    if (a.signedAt) entries.push({ id: `${a._id}-sign`, at: a.signedAt, title: `BAST ditandatangani ${name}`, tone: "success", lines: [a.signedVia === "paper" ? "BAST kertas diunggah GA" : "Ditandatangani di portal"] });
    if (a.disputeNote) entries.push({ id: `${a._id}-dispute`, at: a.handoverDate, title: `${name} melaporkan tidak sesuai`, tone: "danger", lines: [a.disputeNote] });
    if (a.returnDate) entries.push({ id: `${a._id}-back`, at: a.returnDate, title: `Dikembalikan ${name}`, tone: a.returnCondition === a.handoverCondition ? "neutral" : "warning", lines: [`Kondisi ${conditionLabel(a.returnCondition)}`, ...(a.returnNotes ? [a.returnNotes] : [])], photos: a.returnPhotos });
  }
  for (const e of events) {
    const swap = e.fromValue || e.toValue ? `${e.fromValue || "-"} → ${e.toValue || "-"}` : "";
    entries.push({
      id: e._id, at: e.eventDate, title: `${EVENT_TYPE_LABELS[e.type]}${e.component ? `: ${e.component}` : ""}`,
      tone: e.type === "employee_report" ? "warning" : "primary",
      lines: [swap, e.description ?? "", [e.vendor, e.cost != null ? `Rp${e.cost.toLocaleString("id-ID")}` : ""].filter(Boolean).join(" · "), e.actorUserId?.email ?? e.employeeId?.name ?? ""].filter(Boolean),
      photos: e.photos,
    });
  }
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

const HISTORY_DOT: Record<HistoryEntry["tone"], string> = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-subtle" };

function HistorySection({ detail }: { detail: AssetDetail }) {
  const entries = historyOf(detail);
  if (!entries.length) return <p className="text-body-sm text-muted">Belum ada riwayat.</p>;
  return (
    <ol className="relative space-y-5 border-s border-line ps-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative space-y-1">
          <span className={cn("absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-background-primary-default", HISTORY_DOT[entry.tone])} aria-hidden />
          <p className="text-body font-semibold text-heading">{entry.title}</p>
          <p className="text-label text-subtle">{formatDateTime(entry.at)}</p>
          {entry.lines.map((line) => <p key={line} className="break-words text-body-sm text-muted">{line}</p>)}
          {entry.photos && entry.photos.length > 0 && <div className="pt-1"><PhotoGrid photos={entry.photos} label={`Foto ${entry.title}`} /></div>}
        </li>
      ))}
    </ol>
  );
}

function HolderCard({ assignment, onSignature }: { assignment: AssetDetail["assignments"][number]; onSignature: (signature: { href: string; pdf: boolean }) => void }) {
  const name = assignment.employeeId?.name ?? "Karyawan";
  return (
    <div className={cn("rounded-2xl p-4", assignment.status === "disputed" ? "bg-danger-soft" : "bg-background-secondary-default")}>
      <p className="text-label text-subtle">{assignment.status === "active" ? "Dipegang oleh" : "Diserahkan kepada"}</p>
      <p className="text-body font-semibold text-heading">{name}{assignment.employeeId?.employeeId ? ` · ${assignment.employeeId.employeeId}` : ""}</p>
      <p className="mt-1 text-body-sm text-muted">
        Diserahkan {formatDate(assignment.handoverDate)} dalam kondisi {conditionLabel(assignment.handoverCondition)}
        {assignment.signedAt ? ` · ditandatangani ${formatDate(assignment.signedAt)}` : ""}
      </p>
      {assignment.status === "pending_handover" && <p className="mt-2 text-body-sm text-warning">Menunggu karyawan memeriksa aset dan menandatangani BAST di portal.</p>}
      {assignment.status === "disputed" && (
        <p className="mt-2 text-body-sm text-danger">Karyawan melaporkan aset tidak sesuai: “{assignment.disputeNote}”. Periksa lalu batalkan dan serahkan ulang.</p>
      )}
      {assignment.signature && (
        <button type="button" onClick={() => onSignature(assignment.signature!)} className="mt-2 cursor-pointer text-body-sm font-medium text-primary hover:underline">Lihat tanda tangan</button>
      )}
    </div>
  );
}

function InfoSection({ detail }: { detail: AssetDetail }) {
  const { asset, checks } = detail;
  const initial = asset.initialCheck ?? checks.find((c) => c.type === "initial") ?? null;
  const changedSpecs = (asset.initialCheck?.specs ?? []).filter((s) => asset.specs?.find((c) => c.label === s.label)?.value !== s.value);
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-body font-semibold text-heading">Spesifikasi</h3>
        <SpecList specs={asset.specs} />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-label text-subtle">Lokasi</dt><dd className="text-body text-heading">{asset.location || "-"}</dd></div>
          <div><dt className="text-label text-subtle">Tanggal perolehan</dt><dd className="text-body text-heading">{formatDate(asset.acquiredAt)}</dd></div>
        </dl>
        {asset.notes && <p className="text-body-sm text-muted">{asset.notes}</p>}
        <div className="h-8 w-40 opacity-80 dark:invert" dangerouslySetInnerHTML={{ __html: generateCode39Svg(asset.code).svg }} />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-body font-semibold text-heading">Kondisi awal</h3>
          {initial && <span className="text-label text-subtle">Dicatat {formatDate("recordedAt" in initial ? initial.recordedAt : initial.auditDate)}</span>}
        </div>
        {initial ? (
          <div className="space-y-3 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={conditionTone(initial.condition)} dot>{conditionLabel(initial.condition)}</Badge>
              {initial.reading != null && <span className="text-body-sm text-muted">Pembacaan: {initial.reading.toLocaleString("id-ID")}</span>}
            </div>
            <ChecklistView items={initial.checklist} />
            {initial.notes && <p className="text-body-sm text-muted">{initial.notes}</p>}
            <PhotoGrid photos={initial.photos} label="Foto kondisi awal" />
            {changedSpecs.length > 0 && (
              <div>
                <p className="mb-1 text-label font-semibold text-subtle">Spesifikasi saat didaftarkan</p>
                <p className="text-body-sm text-muted">{changedSpecs.map((s) => `${s.label}: ${s.value}`).join(" · ")}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-body-sm text-muted">Aset ini didaftarkan sebelum kondisi awal dicatat. Pengecekan pertama akan dipakai sebagai pembanding.</p>
        )}
      </section>
    </div>
  );
}

function ChecksSection({ detail }: { detail: AssetDetail }) {
  const checks = detail.checks;
  if (!checks.length) return <p className="text-body-sm text-muted">Belum ada pengecekan.</p>;
  return (
    <ol className="relative space-y-4 border-s border-line ps-5">
      {checks.map((c) => (
        <li key={c._id} className="relative">
          <span className={cn("absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-background-primary-default", c.status === "flagged" ? "bg-danger" : c.type === "initial" ? "bg-primary" : "bg-success")} aria-hidden />
          <div className="space-y-2 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body font-semibold text-heading">
                {CHECK_TYPE_LABELS[c.type] ?? c.type}
                {c.type === "monthly" && <span className="font-normal text-muted"> · {formatPeriod(c.period)}</span>}
              </p>
              <Badge tone={c.status === "flagged" ? "danger" : c.status === "changed" ? "info" : "success"}>{c.status === "flagged" ? "Ada temuan" : c.status === "changed" ? "Ada perubahan" : "Sesuai"}</Badge>
            </div>
            <p className="text-body-sm text-muted">
              {formatDateTime(c.auditDate)} · {c.auditorId?.email ?? "-"}
              {c.holderEmployeeId?.name ? ` · dipegang ${c.holderEmployeeId.name}` : ""}
            </p>
            <p className="text-body-sm text-foreground">
              Kondisi: {c.previousCondition && c.previousCondition !== c.condition ? <>{conditionLabel(c.previousCondition)} → </> : null}
              <span className="font-semibold">{conditionLabel(c.condition)}</span>
              {c.reading != null && <> · Pembacaan {c.reading.toLocaleString("id-ID")}</>}
            </p>
            {c.findings && c.findings.length > 0 && (
              <ul className="list-disc space-y-0.5 ps-5 text-body-sm text-danger">
                {c.findings.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
            {c.changes && c.changes.length > 0 && (
              <ul className="list-disc space-y-0.5 ps-5 text-body-sm text-info">
                {c.changes.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
            {c.notes && <p className="text-body-sm text-muted">“{c.notes}”</p>}
            <PhotoGrid photos={c.photos} label="Foto pengecekan" />
            {c.checklist && c.checklist.length > 0 && (
              <details className="text-body-sm">
                <summary className="cursor-pointer text-primary">Lihat daftar periksa</summary>
                <div className="mt-2"><ChecklistView items={c.checklist} /></div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function HandoverSection({ detail, onSignature }: { detail: AssetDetail; onSignature: (signature: { href: string; pdf: boolean }) => void }) {
  if (!detail.assignments.length) return <p className="text-body-sm text-muted">Aset ini belum pernah diserahkan.</p>;
  return (
    <ul className="space-y-3">
      {detail.assignments.map((a) => (
        <li key={a._id} className="space-y-2 rounded-2xl bg-background-secondary-default p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body font-semibold text-heading">{a.employeeId?.name ?? "Karyawan"}</p>
            <Badge tone={assignmentTone(a.status)}>{ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status}</Badge>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-label text-subtle">Diserahkan</dt>
              <dd className="text-foreground">{formatDate(a.handoverDate)} · {conditionLabel(a.handoverCondition)}{a.handoverReading != null ? ` · ${a.handoverReading.toLocaleString("id-ID")}` : ""}</dd>
              {a.assignedBy?.email && <dd className="text-label text-subtle">oleh {a.assignedBy.email}</dd>}
            </div>
            <div>
              <dt className="text-label text-subtle">Dikembalikan</dt>
              <dd className="text-foreground">{a.returnDate ? `${formatDate(a.returnDate)} · ${conditionLabel(a.returnCondition)}${a.returnReading != null ? ` · ${a.returnReading.toLocaleString("id-ID")}` : ""}` : "-"}</dd>
              {a.receivedBy?.email && <dd className="text-label text-subtle">diterima {a.receivedBy.email}</dd>}
            </div>
          </dl>
          {a.handoverCondition && a.returnCondition && a.handoverCondition !== a.returnCondition && (
            <Alert tone="warning">Kondisi saat kembali ({conditionLabel(a.returnCondition)}) berbeda dari saat diserahkan ({conditionLabel(a.handoverCondition)}).</Alert>
          )}
          <PhotoGrid photos={a.handoverPhotos} label="Foto saat diserahkan" />
          <PhotoGrid photos={a.returnPhotos} label="Foto saat dikembalikan" />
          {a.handoverNotes && <p className="text-body-sm text-muted">Catatan serah terima: {a.handoverNotes}</p>}
          {a.employeeNote && <p className="text-body-sm text-muted">Catatan karyawan: {a.employeeNote}</p>}
          {a.disputeNote && <p className="text-body-sm text-danger">Laporan ketidaksesuaian: {a.disputeNote}</p>}
          {a.returnNotes && <p className="text-body-sm text-muted">Catatan pengembalian: {a.returnNotes}</p>}
          {a.cancelReason && <p className="text-body-sm text-muted">Alasan dibatalkan: {a.cancelReason}</p>}
          {a.signature && (
            <button type="button" onClick={() => onSignature(a.signature!)} className="cursor-pointer text-body-sm font-medium text-primary hover:underline">Lihat tanda tangan{a.signedVia === "paper" ? " (BAST kertas)" : ""}</button>
          )}
          {a.signatureHash && <p className="break-all font-mono text-label text-subtle">Kode verifikasi {a.signatureHash.slice(0, 16)}</p>}
        </li>
      ))}
    </ul>
  );
}
