"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardCheck, Edit, RefreshCcw, UserPlus, X, XCircle } from "@/components/icons";
import { Alert, Badge, Button, SkeletonList, Tabs, cn } from "@/components/ui";
import { Portal } from "@/components/ui/Floating";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/time";
import { generateCode39Svg } from "@/lib/barcode";
import { ASSIGNMENT_STATUS_LABELS, CHECK_TYPE_LABELS, type CheckItem, type SpecCheck, type SpecValue } from "@/lib/inventory/templates";
import { ChecklistView, SpecList, categoryLabel, conditionLabel, conditionTone } from "./parts";

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
    initialCheck?: { condition: string; checklist: CheckItem[]; reading?: number | null; notes?: string; recordedAt: string } | null;
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
    handoverReading?: number | null;
    handoverNotes?: string;
    signatureUrl?: string;
    signedAt?: string | null;
    employeeNote?: string;
    disputeNote?: string;
    returnDate?: string | null;
    returnCondition?: string;
    returnChecklist?: CheckItem[];
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
    reading?: number | null;
    notes?: string;
    status: "verified" | "flagged";
    findings?: string[];
    auditorId?: { email?: string } | null;
    holderEmployeeId?: { name?: string } | null;
  }>;
}

type Section = "info" | "checks" | "handover";

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
  onReturn,
  onCancelHandover,
  onCheck,
}: {
  assetId: string | null;
  refreshKey: number;
  onClose: () => void;
  onEdit: (detail: AssetDetail) => void;
  onAssign: (detail: AssetDetail) => void;
  onReturn: (detail: AssetDetail) => void;
  onCancelHandover: (detail: AssetDetail) => void;
  onCheck: (detail: AssetDetail) => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("info");
  const [signature, setSignature] = useState<string | null>(null);

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

                    <Tabs
                      value={section}
                      onChange={setSection}
                      tabs={[
                        { id: "info", label: "Spesifikasi & kondisi awal" },
                        { id: "checks", label: "Pengecekan", count: detail.checks.filter((c) => c.type !== "initial").length },
                        { id: "handover", label: "Serah terima", count: detail.assignments.length },
                      ]}
                    />

                    {section === "info" && <InfoSection detail={detail} />}
                    {section === "checks" && <ChecksSection detail={detail} />}
                    {section === "handover" && <HandoverSection detail={detail} onSignature={setSignature} />}
                  </>
                )}
              </div>

              {detail && (
                <div className="drawer-foot">
                  <Button variant="ghost" icon={Edit} onClick={() => onEdit(detail)}>Ubah data</Button>
                  {!isLost && <Button variant="secondary" icon={ClipboardCheck} onClick={() => onCheck(detail)}>Catat pengecekan</Button>}
                  {open?.status === "active" && <Button icon={RefreshCcw} onClick={() => onReturn(detail)}>Terima pengembalian</Button>}
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
                {signature.startsWith("data:application/pdf") ? (
                  <a href={signature} download="bast.pdf" className="text-primary hover:underline">Unduh BAST (PDF)</a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signature data URL
                  <img src={signature} alt="Tanda tangan BAST" className="max-h-60 rounded-xl bg-white object-contain" />
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

function HolderCard({ assignment, onSignature }: { assignment: AssetDetail["assignments"][number]; onSignature: (url: string) => void }) {
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
      {assignment.signatureUrl && (
        <button type="button" onClick={() => onSignature(assignment.signatureUrl!)} className="mt-2 cursor-pointer text-body-sm font-medium text-primary hover:underline">Lihat tanda tangan</button>
      )}
    </div>
  );
}

function InfoSection({ detail }: { detail: AssetDetail }) {
  const { asset, checks } = detail;
  const initial = asset.initialCheck ?? checks.find((c) => c.type === "initial") ?? null;
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
              <Badge tone={c.status === "flagged" ? "danger" : "success"}>{c.status === "flagged" ? "Ada temuan" : "Sesuai"}</Badge>
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
            {c.notes && <p className="text-body-sm text-muted">“{c.notes}”</p>}
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

function HandoverSection({ detail, onSignature }: { detail: AssetDetail; onSignature: (url: string) => void }) {
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
          {a.handoverNotes && <p className="text-body-sm text-muted">Catatan serah terima: {a.handoverNotes}</p>}
          {a.employeeNote && <p className="text-body-sm text-muted">Catatan karyawan: {a.employeeNote}</p>}
          {a.disputeNote && <p className="text-body-sm text-danger">Laporan ketidaksesuaian: {a.disputeNote}</p>}
          {a.returnNotes && <p className="text-body-sm text-muted">Catatan pengembalian: {a.returnNotes}</p>}
          {a.cancelReason && <p className="text-body-sm text-muted">Alasan dibatalkan: {a.cancelReason}</p>}
          {a.signatureUrl && (
            <button type="button" onClick={() => onSignature(a.signatureUrl!)} className="cursor-pointer text-body-sm font-medium text-primary hover:underline">Lihat tanda tangan</button>
          )}
        </li>
      ))}
    </ul>
  );
}
