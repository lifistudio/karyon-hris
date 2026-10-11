"use client";

import React, { useState } from "react";
import { Check, Copy, KeyRound } from "@/components/icons";
import { Alert, Button, ICON_STROKE, Modal } from "@/components/ui";

/**
 * Shows the initial login of a just-created account once.
 *
 * A random initial password exists nowhere else, so it gets a dialog the reader
 * has to close rather than a toast that fades while they reach for a pen.
 */
export function CredentialDialog({
  credential,
  onClose,
}: {
  credential: { email: string; password: string; name?: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!credential) return null;

  const copy = async () => {
    await navigator.clipboard?.writeText(`Email: ${credential.email}\nKata sandi awal: ${credential.password}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Akun login dibuat"
      description={credential.name ? `Sampaikan data ini kepada ${credential.name} secara langsung atau lewat pesan pribadi.` : undefined}
      footer={
        <>
          <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? "Disalin" : "Salin"}
          </Button>
          <Button size="sm" onClick={onClose}>
            Sudah dicatat
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="card p-4 space-y-3">
          <div>
            <dt className="text-label text-muted">Email login</dt>
            <dd className="text-body font-medium text-heading break-all">{credential.email}</dd>
          </div>
          <div>
            <dt className="text-label text-muted flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
              Kata sandi awal
            </dt>
            <dd className="text-title-sm font-mono font-semibold text-heading tracking-wide break-all select-all">
              {credential.password}
            </dd>
          </div>
        </dl>
        <Alert tone="warning">
          Kata sandi ini tidak ditampilkan lagi setelah jendela ditutup. Karyawan diminta menggantinya saat login pertama.
        </Alert>
      </div>
    </Modal>
  );
}
