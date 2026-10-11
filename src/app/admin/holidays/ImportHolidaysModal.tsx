"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CloudDownload, Info, TriangleAlert } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Modal,
  SkeletonList,
  cn,
  ICON_STROKE,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/time";

interface PreviewRow {
  dateKey: string;
  name: string;
  type: "libur_nasional" | "cuti_bersama";
  status: "baru" | "berubah" | "sama";
  currentName?: string;
  currentType?: string;
}

interface Preview {
  year: number;
  source: "google" | "nager";
  partial: boolean;
  warning?: string;
  rows: PreviewRow[];
  localOnly: Array<{ dateKey: string; name: string; type: string }>;
  summary: { total: number; baru: number; berubah: number; sama: number; lokal: number };
}

const STATUS_TONE = {
  baru: { tone: "success" as const, label: "Baru" },
  berubah: { tone: "warning" as const, label: "Berubah" },
  sama: { tone: "neutral" as const, label: "Sama" },
};

/**
 * Preview-then-apply import of the national holiday calendar.
 *
 * The calendar decides which days consume annual leave and which count as
 * working days for payroll, so it is never overwritten from the internet
 * without someone seeing the diff first. Rows already identical to what is
 * stored are deselected by default — the point of the screen is the change.
 */
export function ImportHolidaysModal({
  open,
  year,
  onClose,
  onImported,
}: {
  open: boolean;
  year: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const res = await api.get<Preview>(`/api/v1/holidays/import?year=${year}`);
      const data = res.data!;
      setPreview(data);
      // Everything that would actually change something starts ticked.
      setSelected(new Set(data.rows.filter((r) => r.status !== "sama").map((r) => r.dateKey)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = (dateKey: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });

  const apply = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const res = await api.post<{ inserted: number; updated: number }>(
        "/api/v1/holidays/import",
        { year, dateKeys: [...selected] }
      );
      toast.success("Kalender diperbarui", res.message ?? "");
      onImported();
      onClose();
    } catch (err) {
      toast.error("Gagal mengimpor hari libur", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Impor hari libur ${year}`}
      description="Ambil kalender hari libur nasional dan cuti bersama, lalu pilih tanggal mana yang dipakai."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            icon={CloudDownload}
            loading={saving}
            disabled={loading || selected.size === 0}
            onClick={apply}
          >
            Terapkan {selected.size > 0 ? `${selected.size} tanggal` : ""}
          </Button>
        </>
      }
    >
      {loading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <Alert tone="danger" title="Tidak dapat mengambil kalender">
          {error}
        </Alert>
      ) : preview ? (
        <div className="space-y-4">
          {preview.partial && preview.warning && (
            <Alert tone="warning" title="Daftar ini belum lengkap">
              {preview.warning}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Info className="w-4 h-4" strokeWidth={ICON_STROKE} />
              Sumber:{" "}
              <strong className="text-foreground">
                {preview.source === "google" ? "Kalender Google Indonesia" : "Nager.Date"}
              </strong>
            </span>
            <span>
              {preview.summary.baru} baru · {preview.summary.berubah} berubah ·{" "}
              {preview.summary.sama} sama
            </span>
          </div>

          <div className="max-h-[22rem] overflow-y-auto rounded-[var(--radius-control)] border border-line divide-y divide-[var(--border)]">
            {preview.rows.map((row) => {
              const checked = selected.has(row.dateKey);
              const status = STATUS_TONE[row.status];
              return (
                <label
                  key={row.dateKey}
                  className={cn(
                    "flex items-start gap-3 px-3.5 py-2.5 cursor-pointer transition-colors hover:bg-surface-2",
                    !checked && "opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(row.dateKey)}
                    className="mt-1 w-4 h-4 rounded border-line accent-[var(--primary)] cursor-pointer"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm text-foreground">{row.name}</span>
                      <Badge tone={row.type === "cuti_bersama" ? "warning" : "primary"}>
                        {row.type === "cuti_bersama" ? "Cuti bersama" : "Libur nasional"}
                      </Badge>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </span>
                    <span className="block text-label text-subtle mt-0.5">
                      {formatDate(row.dateKey)}
                      {row.status === "berubah" && row.currentName && (
                        <> · saat ini tersimpan sebagai &ldquo;{row.currentName}&rdquo;</>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {preview.localOnly.length > 0 && (
            <Alert tone="info" title={`${preview.localOnly.length} tanggal buatan sendiri`}>
              Tanggal berikut tidak ada di kalender sumber dan{" "}
              <strong>tidak akan diubah atau dihapus</strong> oleh impor ini:{" "}
              {preview.localOnly.map((h) => h.name).join(", ")}.
            </Alert>
          )}

          <p className="flex gap-2 text-label text-subtle leading-relaxed">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" strokeWidth={ICON_STROKE} />
            <span>
              Tanggal cuti bersama ditetapkan lewat SKB Tiga Menteri dan sesekali direvisi.
              Cocokkan hasil impor dengan surat keputusan terbaru sebelum dipakai untuk
              perhitungan cuti dan payroll.
            </span>
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
