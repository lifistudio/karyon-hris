"use client";

import React, { useState, useEffect, useRef } from "react";
import { Package, FileText, CheckCircle2 } from "@/components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SkeletonCards, Tabs } from "@/components/ui";
import { INVENTORY_CATEGORY_LABELS } from "@/lib/hr/labels";
import { useToast } from "@/components/ui/Toast";

interface InventoryAsset {
  _id: string;
  code: string;
  name: string;
  category: string;
  condition: "good" | "damaged" | "lost";
}

interface InventoryAssignment {
  _id: string;
  inventoryId: InventoryAsset;
  handoverDate: string;
  signatureUrl?: string;
  status: "pending_handover" | "active" | "returned";
}

export default function InventoryEmployeePage() {
  const toast = useToast();
  const [assignments, setAssignments] = useState<InventoryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAsg, setSelectedAsg] = useState<InventoryAssignment | null>(null);

  // Canvas ref for signature
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signMethod, setSignMethod] = useState<"draw" | "upload">("draw");
  const [uploadedFileBase64, setUploadedFileBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedFileBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const fetchMyInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/inventory/self");
      const data = await res.json();
      if (data.success) {
        setAssignments(data.data || []);
      }
    } catch (err) {
      console.error("Gagal memuat inventaris pribadi:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyInventory();
  }, []);

  // Canvas drawing functions
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.beginPath();
    ctx.moveTo((clientX - rect.left) * (canvas.width / rect.width), (clientY - rect.top) * (canvas.height / rect.height));
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.lineTo((clientX - rect.left) * (canvas.width / rect.width), (clientY - rect.top) * (canvas.height / rect.height));
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSubmitSignature = async () => {
    if (!selectedAsg) return;

    let signatureData = "";
    if (signMethod === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      signatureData = canvas.toDataURL("image/png");
    } else {
      if (!uploadedFileBase64) {
        toast.error("Berkas belum dipilih", "Pilih dan unggah berkas BAST yang sudah ditandatangani terlebih dahulu.");
        return;
      }
      signatureData = uploadedFileBase64;
    }
    setSubmitting(true);

    try {
      const res = await fetch("/api/v1/inventory/self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: selectedAsg._id,
          signatureData
        })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedAsg(null);
        fetchMyInventory();
      } else {
        toast.error("BAST gagal ditandatangani", data.message || "Coba lagi beberapa saat.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Tidak dapat terhubung", "Periksa koneksi internet Anda lalu coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventaris saya"
        description="Aset kantor yang sedang Anda gunakan. Tanda tangani BAST untuk aset yang baru diserahkan."
      />

      {loading ? (
        <SkeletonCards count={2} />
      ) : assignments.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title="Belum ada aset untuk Anda" description="Aset yang diserahkan tim GA akan muncul di sini." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {assignments.map((asg) => {
            const item = asg.inventoryId;
            const isPending = asg.status === "pending_handover";
            return (
              <Card key={asg._id} className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-body-sm text-muted">{item.code}</p>
                    <h3 className="mt-0.5 text-body-lg font-semibold text-heading">{item.name}</h3>
                    <p className="text-body-sm text-muted">{INVENTORY_CATEGORY_LABELS[item.category] ?? item.category}</p>
                  </div>
                  <Badge tone={isPending ? "warning" : "success"} dot>{isPending ? "Menunggu BAST" : "Diterima"}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-background-secondary-default px-4 py-3 text-body-sm">
                  <span className="text-muted">Tanggal penyerahan</span>
                  <span className="font-medium text-heading">
                    {new Date(asg.handoverDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                </div>
                {isPending ? (
                  <Button icon={FileText} className="w-full" onClick={() => setSelectedAsg(asg)}>Tanda tangani BAST</Button>
                ) : (
                  <p className="flex items-center justify-center gap-1.5 text-body-sm font-medium text-success">
                    <CheckCircle2 className="size-4" aria-hidden />
                    Serah terima selesai
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!selectedAsg}
        onClose={() => setSelectedAsg(null)}
        title="Tanda tangan BAST"
        description={selectedAsg ? `Konfirmasi penerimaan ${selectedAsg.inventoryId.name}.` : undefined}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={signMethod === "draw" ? clearCanvas : () => { setUploadedFileBase64(""); setFileName(""); }}
            >
              {signMethod === "draw" ? "Bersihkan" : "Hapus berkas"}
            </Button>
            <Button onClick={handleSubmitSignature} loading={submitting}>Konfirmasi & simpan</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Tabs
            value={signMethod}
            onChange={setSignMethod}
            tabs={[
              { id: "draw", label: "Tulis tanda tangan" },
              { id: "upload", label: "Unggah berkas" },
            ]}
          />
          <p className="text-body-sm leading-relaxed text-muted">
            {signMethod === "draw"
              ? "Dengan menandatangani, saya menyatakan telah menerima aset dalam kondisi baik dan bertanggung jawab atas pemeliharaannya."
              : "Unggah pindaian atau foto BAST fisik yang sudah ditandatangani."}
          </p>
          {signMethod === "draw" ? (
            <div className="relative overflow-hidden rounded-2xl bg-white border border-border-button-default">
              <canvas
                ref={canvasRef}
                width={380}
                height={180}
                className="h-44 w-full cursor-crosshair touch-none bg-white"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
              <span className="pointer-events-none absolute bottom-2 end-3 select-none text-body-sm text-neutral-500">Gunakan mouse atau layar sentuh</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-background-secondary-default p-6 text-center">
              <input type="file" id="bast-file-upload" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
              <label htmlFor="bast-file-upload" className="inline-flex h-10 cursor-pointer items-center rounded-full bg-background-primary-default px-4 text-body font-medium text-heading shadow-xs border border-border-button-default hover:bg-background-secondary-hover">
                Pilih berkas PDF atau gambar
              </label>
              {fileName ? (
                <p className="max-w-xs truncate text-body-sm font-medium text-success">Terpilih: {fileName}</p>
              ) : (
                <p className="text-body-sm text-muted">PDF, PNG, atau JPG, maksimal 5 MB</p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
