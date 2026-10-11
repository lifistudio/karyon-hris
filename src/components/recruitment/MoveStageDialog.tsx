"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight } from "@/components/icons";
import { Alert, Button, Field, ICON_STROKE, Modal, Textarea, cn } from "@/components/ui";

export interface StageMove {
  candidateId: string;
  candidateName: string;
  from: string;
  to: string;
}

/**
 * Confirms a stage change before it is saved. Used by the candidate page and
 * the vacancy board (buttons and drag & drop), so every move reads the same.
 */
export function MoveStageDialog({
  move,
  stages,
  rejected,
  loading,
  onClose,
  onConfirm,
}: {
  move: StageMove | null;
  stages: string[];
  /** A rejected candidate is reopened by the move. */
  rejected?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const from = move ? stages.indexOf(move.from) : -1;
  const to = move ? stages.indexOf(move.to) : -1;
  const backward = from >= 0 && to >= 0 && to < from;
  const skipped = from >= 0 && to - from > 1 ? to - from - 1 : 0;

  const close = () => {
    if (loading) return;
    setNotes("");
    onClose();
  };

  return (
    <Modal
      open={!!move}
      onClose={close}
      size="sm"
      title={backward ? "Kembalikan ke tahap sebelumnya?" : "Pindahkan ke tahap berikutnya?"}
      description={move ? `${move.candidateName} akan dipindahkan. Perubahan tercatat di riwayat pelamar.` : undefined}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
            Batal
          </Button>
          <Button
            size="sm"
            icon={backward ? ArrowLeft : ArrowRight}
            loading={loading}
            onClick={() => {
              onConfirm(notes.trim());
              setNotes("");
            }}
          >
            {backward ? "Kembalikan" : "Pindahkan"}
          </Button>
        </>
      }
    >
      {move && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
            <span className="min-w-0 flex-1 truncate text-body-sm text-muted" title={move.from}>{move.from}</span>
            {backward ? (
              <ArrowLeft className="w-4 h-4 shrink-0 text-warning" strokeWidth={ICON_STROKE} />
            ) : (
              <ArrowRight className="w-4 h-4 shrink-0 text-primary" strokeWidth={ICON_STROKE} />
            )}
            <span
              className={cn("min-w-0 flex-1 truncate text-right text-body-sm font-semibold", backward ? "text-warning" : "text-primary")}
              title={move.to}
            >
              {move.to}
            </span>
          </div>
          {rejected && (
            <Alert tone="info">Pelamar ini berstatus tidak lolos dan akan dibuka kembali untuk diproses.</Alert>
          )}
          {skipped > 0 && !rejected && (
            <Alert tone="warning">Melewati {skipped} tahap. Pastikan tahap yang dilewati memang tidak diperlukan.</Alert>
          )}
          <Field label="Catatan" hint="Opsional. Terlihat oleh tim rekrutmen di riwayat pelamar.">
            <Textarea
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={backward ? "Contoh: berkas perlu diperiksa ulang." : "Contoh: lolos seleksi berkas."}
              className="min-h-20"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
