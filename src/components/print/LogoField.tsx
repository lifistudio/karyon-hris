"use client";

import React, { useRef, useState } from "react";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Button, Field, Toggle, ICON_STROKE } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

/**
 * Company logo for the document header.
 *
 * The file is sent to the server, which validates and re-encodes it, and the
 * returned data URL is stored on the template. Inlining is deliberate — see
 * `api/v1/branding/logo` — because a printed document must not depend on a
 * network fetch completing before the print dialog opens.
 */
export function LogoField({
  logoUrl,
  showLogo,
  logoHeight,
  onChange,
  extraAction,
}: {
  logoUrl: string;
  showLogo: boolean;
  logoHeight: number;
  onChange: (patch: { logoUrl?: string; showLogo?: boolean; logoHeight?: number }) => void;
  /** Extra control beside the upload button, e.g. copying a logo already set elsewhere. */
  extraAction?: React.ReactNode;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Berkas tidak dapat dibaca."));
        reader.readAsDataURL(file);
      });

      const res = await api.post<{ dataUrl: string; bytes: number }>(
        "/api/v1/branding/logo",
        { dataUrl }
      );
      onChange({ logoUrl: res.data!.dataUrl, showLogo: true });
      toast.success("Logo diunggah", "Tekan Simpan agar ikut tercetak.");
    } catch (err) {
      toast.error("Gagal mengunggah logo", errorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-[var(--radius-control)] border border-line p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-surface-2 overflow-hidden">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo perusahaan" className="max-w-full max-h-full object-contain" />
          ) : (
            <ImageIcon className="w-5 h-5 text-subtle" strokeWidth={ICON_STROKE} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-medium text-foreground">Logo perusahaan</p>
          <p className="text-label text-muted leading-relaxed mt-0.5">
            PNG, JPG, WebP, atau SVG; otomatis dikonversi ke WebP. Hasil maksimal 256 KB — logo kop tidak perlu beresolusi tinggi.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={Upload}
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {logoUrl ? "Ganti logo" : "Unggah logo"}
            </Button>
            {extraAction}
            {logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="text-danger"
                onClick={() => onChange({ logoUrl: "", showLogo: false })}
              >
                Hapus
              </Button>
            )}
          </div>
        </div>
      </div>

      {logoUrl && (
        <>
          <Toggle
            checked={showLogo}
            onChange={(v) => onChange({ showLogo: v })}
            label="Cetak logo di kop dokumen"
            description="Matikan untuk menyimpan logo tanpa menampilkannya."
          />
          <Field
            label="Tinggi logo saat dicetak"
            htmlFor="pt-logo-h"
            hint={`${logoHeight} mm. Lebar menyesuaikan proporsi gambar.`}
          >
            <input
              id="pt-logo-h"
              type="range"
              min={6}
              max={40}
              value={logoHeight}
              onChange={(e) => onChange({ logoHeight: Number(e.target.value) })}
              className="w-full accent-[var(--primary)] cursor-pointer"
            />
          </Field>
        </>
      )}
    </div>
  );
}
