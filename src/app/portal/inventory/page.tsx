"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Package } from "@/components/icons";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, SkeletonCards, Tabs, Textarea } from "@/components/ui";
import { ChecklistView, SpecList, categoryLabel, conditionLabel, conditionTone } from "@/components/inventory/parts";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/time";
import type { CheckItem, SpecValue } from "@/lib/inventory/templates";

interface InventoryAssignment {
  _id: string;
  inventoryId: { _id: string; code: string; name: string; category: string; condition: string; specs?: SpecValue[] };
  handoverDate: string;
  handoverCondition?: string;
  handoverChecklist?: CheckItem[];
  handoverReading?: number | null;
  handoverNotes?: string;
  signedAt?: string | null;
  disputeNote?: string;
  status: "pending_handover" | "active" | "disputed";
}

const MAX_FILE = 5 * 1024 * 1024;

export default function InventoryEmployeePage() {
  const toast = useToast();
  const [assignments, setAssignments] = useState<InventoryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<InventoryAssignment | null>(null);
  const [mode, setMode] = useState<"sign" | "dispute">("sign");

  const fetchMine = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.get<InventoryAssignment[]>("/api/v1/inventory/self");
      setAssignments(res.data ?? []);
    } catch (err) {
      setLoadError(errorMessage(err, "Inventaris Anda gagal dimuat."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchMine());
  }, [fetchMine]);

  const pending = assignments.filter((a) => a.status === "pending_handover");
  const others = assignments.filter((a) => a.status !== "pending_handover");

  const open = (asg: InventoryAssignment, next: "sign" | "dispute") => {
    setMode(next);
    setSelected(asg);
  };

  return (
    <div>
      <PageHeader
        title="Inventaris saya"
        description="Aset kantor yang diserahkan kepada Anda. Periksa kondisinya sebelum menandatangani BAST."
      />

      {loadError && <div className="mb-4"><Alert tone="danger">{loadError}</Alert></div>}

      {loading ? (
        <SkeletonCards count={2} />
      ) : assignments.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title="Belum ada aset untuk Anda" description="Aset yang diserahkan tim GA akan muncul di sini untuk Anda periksa dan tanda tangani." />
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-body-lg font-semibold text-heading">Perlu Anda periksa ({pending.length})</h2>
                <p className="text-body-sm text-muted">Cocokkan aset fisik dengan catatan di bawah. Tanda tangani bila sesuai, atau laporkan bila ada yang berbeda.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {pending.map((asg) => (
                  <Card key={asg._id} className="flex flex-col gap-4 p-5">
                    <AssetHead asg={asg} />
                    <HandoverDetails asg={asg} />
                    <div className="mt-auto grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button variant="secondary" icon={AlertTriangle} onClick={() => open(asg, "dispute")}>Laporkan tidak sesuai</Button>
                      <Button icon={FileText} onClick={() => open(asg, "sign")}>Sesuai, tanda tangani</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-body-lg font-semibold text-heading">Aset yang Anda pegang</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {others.map((asg) => (
                  <Card key={asg._id} className="flex flex-col gap-3 p-5">
                    <AssetHead asg={asg} />
                    {asg.status === "disputed" ? (
                      <Alert tone="warning">Laporan Anda sedang ditinjau tim GA: “{asg.disputeNote}”. Aset belum tercatat sebagai tanggung jawab Anda.</Alert>
                    ) : (
                      <>
                        <SpecList specs={asg.inventoryId.specs} />
                        <p className="flex items-center gap-1.5 text-body-sm font-medium text-success">
                          <CheckCircle2 className="size-4" aria-hidden />
                          BAST ditandatangani {formatDate(asg.signedAt ?? asg.handoverDate)}
                        </p>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {selected && (
        <ActionModal
          asg={selected}
          mode={mode}
          onMode={setMode}
          onClose={() => setSelected(null)}
          onDone={(title, message) => {
            setSelected(null);
            toast.success(title, message);
            void fetchMine();
          }}
        />
      )}
    </div>
  );
}

function AssetHead({ asg }: { asg: InventoryAssignment }) {
  const item = asg.inventoryId;
  const badge = asg.status === "pending_handover"
    ? { tone: "warning" as const, label: "Menunggu tanda tangan" }
    : asg.status === "disputed"
      ? { tone: "danger" as const, label: "Dilaporkan" }
      : { tone: "success" as const, label: "Diterima" };
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-mono text-body-sm text-muted">{item.code}</p>
        <h3 className="mt-0.5 text-body-lg font-semibold text-heading">{item.name}</h3>
        <p className="text-body-sm text-muted">{categoryLabel(item.category)} · diserahkan {formatDate(asg.handoverDate)}</p>
      </div>
      <Badge tone={badge.tone} dot>{badge.label}</Badge>
    </div>
  );
}

function HandoverDetails({ asg }: { asg: InventoryAssignment }) {
  return (
    <div className="space-y-4 rounded-2xl bg-background-secondary-default p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-muted">Kondisi saat diserahkan</span>
        <Badge tone={conditionTone(asg.handoverCondition)} dot>{conditionLabel(asg.handoverCondition)}</Badge>
        {asg.handoverReading != null && <span className="text-body-sm text-muted">· Pembacaan {asg.handoverReading.toLocaleString("id-ID")}</span>}
      </div>
      <div>
        <p className="mb-2 text-label font-semibold text-subtle">Spesifikasi</p>
        <SpecList specs={asg.inventoryId.specs} />
      </div>
      {asg.handoverChecklist && asg.handoverChecklist.length > 0 && (
        <div>
          <p className="mb-2 text-label font-semibold text-subtle">Hasil pemeriksaan GA</p>
          <ChecklistView items={asg.handoverChecklist} />
        </div>
      )}
      {asg.handoverNotes && <p className="text-body-sm text-foreground">Kelengkapan: {asg.handoverNotes}</p>}
    </div>
  );
}

function ActionModal({
  asg,
  mode,
  onMode,
  onClose,
  onDone,
}: {
  asg: InventoryAssignment;
  mode: "sign" | "dispute";
  onMode: (mode: "sign" | "dispute") => void;
  onClose: () => void;
  onDone: (title: string, message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [signMethod, setSignMethod] = useState<"draw" | "upload">("draw");
  const [upload, setUpload] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };
  const stop = () => { drawing.current = false; };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE) {
      setError("Berkas maksimal 5 MB.");
      return;
    }
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => setUpload(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError("");
    let body: Record<string, unknown>;
    if (mode === "dispute") {
      if (note.trim().length < 5) { setError("Jelaskan apa yang tidak sesuai."); return; }
      body = { action: "dispute", assignmentId: asg._id, note };
    } else {
      const signatureData = signMethod === "draw" ? (hasInk ? canvasRef.current?.toDataURL("image/png") : "") : upload;
      if (!signatureData) { setError(signMethod === "draw" ? "Bubuhkan tanda tangan terlebih dahulu." : "Pilih berkas BAST yang sudah ditandatangani."); return; }
      body = { action: "sign", assignmentId: asg._id, signatureData, note };
    }
    setSaving(true);
    try {
      const res = await api.post("/api/v1/inventory/self", body);
      onDone(mode === "dispute" ? "Laporan terkirim" : "BAST ditandatangani", res.message ?? "");
    } catch (err) {
      setError(errorMessage(err, "Permintaan gagal. Coba lagi."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "sign" ? "Tanda tangan BAST" : "Laporkan aset tidak sesuai"}
      description={`${asg.inventoryId.name} · ${asg.inventoryId.code}`}
      footer={
        <>
          {mode === "sign" && signMethod === "draw" && <Button variant="ghost" onClick={clear}>Bersihkan</Button>}
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button variant={mode === "dispute" ? "danger" : "primary"} onClick={submit} loading={saving}>
            {mode === "sign" ? "Konfirmasi & tanda tangani" : "Kirim laporan"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          value={mode}
          onChange={onMode}
          tabs={[
            { id: "sign", label: "Sesuai" },
            { id: "dispute", label: "Tidak sesuai" },
          ]}
        />
        {error && <Alert tone="danger">{error}</Alert>}

        {mode === "dispute" ? (
          <>
            <p className="text-body-sm text-muted">Aset tidak akan tercatat sebagai tanggung jawab Anda sampai tim GA menindaklanjuti laporan ini.</p>
            <Field label="Apa yang tidak sesuai?" required>
              <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Contoh: nomor seri berbeda, charger tidak ada, layar retak" />
            </Field>
          </>
        ) : (
          <>
            <p className="text-body-sm leading-relaxed text-muted">
              Dengan menandatangani, saya menyatakan telah menerima aset ini dalam kondisi <span className="font-medium text-heading">{conditionLabel(asg.handoverCondition).toLowerCase()}</span> sesuai catatan serah terima, dan bertanggung jawab atas pemeliharaannya.
            </p>
            <Tabs
              value={signMethod}
              onChange={setSignMethod}
              tabs={[
                { id: "draw", label: "Tulis tanda tangan" },
                { id: "upload", label: "Unggah BAST" },
              ]}
            />
            {signMethod === "draw" ? (
              <div className="relative overflow-hidden rounded-2xl border border-border-button-default bg-white">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={180}
                  className="h-44 w-full cursor-crosshair touch-none bg-white"
                  onPointerDown={start}
                  onPointerMove={move}
                  onPointerUp={stop}
                  onPointerLeave={stop}
                />
                {!hasInk && <span className="pointer-events-none absolute bottom-2 end-3 select-none text-body-sm text-neutral-500">Gunakan mouse atau layar sentuh</span>}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-background-secondary-default p-6 text-center">
                <input type="file" id="bast-file-upload" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={pickFile} className="hidden" />
                <label htmlFor="bast-file-upload" className="inline-flex h-10 cursor-pointer items-center rounded-full border border-border-button-default bg-background-primary-default px-4 text-body font-medium text-heading shadow-xs hover:bg-background-secondary-hover">
                  Pilih berkas PDF atau gambar
                </label>
                <p className="max-w-xs truncate text-body-sm text-muted">{fileName ? `Terpilih: ${fileName}` : "PDF, PNG, JPG, atau WebP, maksimal 5 MB"}</p>
              </div>
            )}
            <Field label="Catatan untuk GA (opsional)">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Contoh: ada baret kecil di tutup, sudah sesuai catatan" />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
