"use client";
import Link from "next/link";
import { ArrowRight, Lock } from "@/components/icons";
import { Card, IconTile, PageHeader, ICON_STROKE } from "@/components/ui";

const REASONS = {
  community: {
    heading: "Tersedia pada HRIS Pro",
    body: "Instalasi ini berjalan sebagai Community. Data yang sudah ada tetap tersimpan dan tidak dihapus; fitur ini aktif setelah lisensi Pro dimasukkan di menu Lisensi & Paket.",
    cta: "Aktifkan Pro",
  },
  expired: {
    heading: "Lisensi Pro berakhir",
    body: "Aplikasi kembali ke fitur Community. Seluruh data tetap aman dan fitur ini aktif kembali segera setelah lisensi diperpanjang atau diganti dengan license key baru.",
    cta: "Perpanjang atau ganti lisensi",
  },
  inactive: {
    heading: "Fitur belum termasuk lisensi aktif",
    body: "Lisensi yang aktif belum mencakup fitur ini atau belum diaktifkan. Data tetap tersimpan; periksa status di menu Lisensi & Paket.",
    cta: "Lihat status lisensi",
  },
} as const;

/**
 * Shown by Community pages whose engine ships only in the Pro distribution, and
 * by Pro pages whose license lapsed. Existing data stays in the database.
 */
export function ProFeatureNotice({
  title,
  description,
  included,
  reason = "community",
}: {
  title: string;
  description: string;
  included: string[];
  reason?: keyof typeof REASONS;
}) {
  const copy = REASONS[reason];
  return (
    <div className="animate-fade-up">
      <PageHeader eyebrow="HRIS Pro" title={title} description={description} />
      <Card className="p-6 md:p-8 max-w-3xl">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <IconTile icon={Lock} tone="accent" size="lg" />
          <div className="min-w-0">
            <h2 className="text-body-lg font-semibold text-heading">{copy.heading}</h2>
            <p className="text-body-sm text-muted mt-1 leading-relaxed">{copy.body}</p>
            <ul className="mt-4 space-y-2">
              {included.map((item) => (
                <li key={item} className="flex gap-2 text-body-sm text-foreground">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/admin/license"
              className="group mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-body font-semibold text-primary-foreground transition-[background-color,box-shadow,transform] duration-200 hover:bg-primary-hover hover:shadow-[var(--shadow-raise)] active:scale-[0.97]"
            >
              {copy.cta}
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={ICON_STROKE} />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
