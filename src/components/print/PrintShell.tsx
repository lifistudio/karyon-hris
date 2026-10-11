"use client";

import React, { useEffect } from "react";
import { ArrowLeft, Printer } from "@/components/icons";
import { Button, ICON_STROKE } from "@/components/ui";

/**
 * Toolbar + page frame for a printable document.
 *
 * The toolbar carries `no-print`, so what reaches the paper is only the
 * document itself. Documents always render in the light palette regardless of
 * the user's theme: a dark-mode payslip either wastes toner or, more often,
 * prints as white-on-white once the browser drops backgrounds.
 */
export function PrintShell({
  backHref,
  backLabel = "Kembali",
  title,
  subtitle,
  paperSize = "A4",
  autoPrint = false,
  children,
}: {
  backHref: string;
  backLabel?: string;
  title: string;
  subtitle?: string;
  paperSize?: "A4" | "Letter";
  /** Opens the print dialog on load, for a "download" button elsewhere. */
  autoPrint?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    // One frame after paint, so fonts and layout have settled before the
    // dialog snapshots the page.
    const id = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(id);
  }, [autoPrint]);

  return (
    <div className="min-h-screen bg-[#eceef4] py-8 px-4">
      <style>{`
        @page { size: ${paperSize}; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .paper {
            box-shadow: none !important;
            margin: 0 !important;
            width: auto !important;
            min-height: 0 !important;
            border-radius: 0 !important;
          }
          /* Keeps table rows and signature blocks from splitting across pages. */
          tr, .avoid-break { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="no-print max-w-[820px] mx-auto mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <a
            href={backHref}
            className="inline-flex items-center gap-2 text-body-sm font-medium text-[#4c5c74] hover:text-[#1b2a41] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
            {backLabel}
          </a>
          <h1 className="mt-2 text-title font-semibold text-[#01162f] truncate">{title}</h1>
          {subtitle && <p className="text-body-sm text-[#4c5c74] mt-1">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button icon={Printer} onClick={() => window.print()}>
            Cetak / simpan PDF
          </Button>
        </div>
      </div>

      <p className="no-print max-w-[820px] mx-auto mb-4 text-label text-[#66768d] leading-relaxed">
        Pada dialog cetak, pilih tujuan <strong>Save as PDF</strong> untuk menyimpan dokumen ini
        sebagai berkas PDF. Aktifkan opsi <strong>Background graphics</strong> agar warna dan garis
        tabel ikut tercetak.
      </p>

      {children}
    </div>
  );
}

/**
 * A single sheet of paper.
 *
 * Width is fixed in millimetres so the on-screen preview matches the printed
 * result, and colours are literal rather than tokens because the browser prints
 * whatever theme happens to be active.
 */
export function Paper({
  size = "A4",
  margin = 18,
  fontSize = 12,
  children,
}: {
  size?: "A4" | "Letter";
  margin?: number;
  fontSize?: number;
  children: React.ReactNode;
}) {
  const width = size === "A4" ? "210mm" : "216mm";
  const minHeight = size === "A4" ? "297mm" : "279mm";

  return (
    <div
      className="paper mx-auto bg-white text-[#1b2a41]"
      style={{
        width,
        minHeight,
        padding: `${margin}mm`,
        fontSize: `${fontSize}px`,
        lineHeight: 1.55,
        boxShadow: "0 12px 32px -12px rgb(17 17 38 / 0.25)",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}
