"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, Clock3, MapPin, Moon, Search, Sun, UserRoundSearch } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import {
  Badge,
  EmptyState,
  ErrorState,
  ICON_STROKE,
  Input,
  Select,
  SkeletonList,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatRupiah, timezoneLabel } from "@/lib/time";

interface Vacancy {
  _id: string;
  title: string;
  slug: string;
  summary: string;
  employmentTypeLabel: string;
  workArrangementLabel: string;
  employmentType: string;
  workArrangement: string;
  location: string;
  division: string;
  publishedAt?: string;
  closesAt?: string | null;
  salary: { min: number; max: number } | null;
}

export default function CareerPage() {
  const { theme, toggleTheme } = useTheme();
  const [items, setItems] = useState<Vacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [arrangement, setArrangement] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<Vacancy[]>("/api/v1/public/vacancies");
      setItems(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtering happens client-side: the list is capped at 200 openings, so a
  // round trip per keystroke would cost more than it saves.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((v) => {
      if (type !== "all" && v.employmentType !== type) return false;
      if (arrangement !== "all" && v.workArrangement !== arrangement) return false;
      if (!q) return true;
      return `${v.title} ${v.division} ${v.location} ${v.summary}`.toLowerCase().includes(q);
    });
  }, [items, query, type, arrangement]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-16 border-b border-line bg-background/85 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto w-full h-full px-5 flex items-center justify-between gap-4">
          <Link href="/" aria-label="Kembali ke beranda" title="Kembali ke beranda" className="grid size-9 place-items-center rounded-full text-muted hover:text-foreground hover:bg-background-secondary-default transition-colors">
            <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
          </Link>
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
              className="p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              {theme === "dark" ? (
                <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              ) : (
                <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              )}
            </button>
            <BrandLogo variant="mark" height={30} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-5 py-12 md:py-16">
        <div className="max-w-2xl">
          <p className="eyebrow">Karier</p>
          <h1 className="mt-3 text-display md:text-hero-sm text-heading leading-[1.1]">
            Lowongan yang sedang dibuka.
          </h1>
          <p className="mt-4 text-body-lg text-muted leading-relaxed">
            Kirim lamaran langsung dari halaman ini. Setiap lamaran masuk ke proses seleksi yang
            sama, dan kami menghubungi pelamar yang profilnya sesuai lewat email atau telepon.
          </p>
        </div>

        {items.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <div className="relative flex-1" style={{ minWidth: "14rem" }}>
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
                strokeWidth={ICON_STROKE}
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari posisi atau divisi…"
                aria-label="Cari lowongan"
                className="pl-10"
              />
            </div>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Saring tipe pekerjaan"
              className="w-44"
            >
              <option value="all">Semua tipe</option>
              <option value="full_time">Penuh waktu</option>
              <option value="part_time">Paruh waktu</option>
              <option value="contract">Kontrak</option>
              <option value="internship">Magang</option>
              <option value="freelance">Lepas</option>
            </Select>
            <Select
              value={arrangement}
              onChange={(e) => setArrangement(e.target.value)}
              aria-label="Saring pengaturan kerja"
              className="w-40"
            >
              <option value="all">Semua lokasi</option>
              <option value="onsite">Di kantor</option>
              <option value="hybrid">Hibrida</option>
              <option value="remote">Jarak jauh</option>
            </Select>
          </div>
        )}

        <div className="mt-8">
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : loading ? (
            <SkeletonList rows={3} />
          ) : filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={UserRoundSearch}
                title={
                  items.length === 0
                    ? "Belum ada lowongan yang dibuka"
                    : "Tidak ada lowongan yang cocok"
                }
                description={
                  items.length === 0
                    ? "Saat ini kami belum membuka posisi baru. Silakan periksa kembali lain waktu."
                    : "Coba ubah kata kunci atau lepas salah satu penyaring."
                }
              />
            </div>
          ) : (
            <>
              <p className="text-body-sm text-subtle mb-4">
                {filtered.length} lowongan
                {filtered.length !== items.length && ` dari ${items.length} total`}
              </p>
              <ul className="space-y-3">
                {filtered.map((v) => (
                  <li key={v._id}>
                    <Link
                      href={`/career/${v.slug}`}
                      className="card-interactive group block p-6 hover:border-primary"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-title-sm font-semibold text-heading group-hover:text-primary transition-colors">
                            {v.title}
                          </h2>

                          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-body-sm text-muted">
                            {v.division && (
                              <span className="inline-flex items-center gap-1.5">
                                <Building2 className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                                {v.division}
                              </span>
                            )}
                            {v.location && (
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                                {v.location}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1.5">
                              <Clock3 className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                              {v.employmentTypeLabel}
                            </span>
                          </div>

                          {v.summary && (
                            <p className="mt-3 text-body-sm text-muted leading-relaxed line-clamp-2 max-w-2xl">
                              {v.summary}
                            </p>
                          )}

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Badge tone="neutral">{v.workArrangementLabel}</Badge>
                            {v.salary && v.salary.max > 0 && (
                              <Badge tone="success">
                                {formatRupiah(v.salary.min)} – {formatRupiah(v.salary.max)}
                              </Badge>
                            )}
                            {v.closesAt && (
                              <Badge tone="warning">Ditutup {formatDate(v.closesAt)}</Badge>
                            )}
                          </div>
                        </div>

                        <ArrowRight
                          className="w-5 h-5 text-subtle group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1"
                          strokeWidth={ICON_STROKE}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-5xl mx-auto w-full px-5 py-7 flex flex-wrap items-center justify-between gap-3 text-body-sm">
          <p className="text-subtle">
            &copy; {new Date().getFullYear()} HRIS. Seluruh waktu dalam {timezoneLabel()}.
          </p>
          <Link href="/auth/login" className="text-muted hover:text-foreground transition-colors">
            Sudah menjadi karyawan? Masuk portal
          </Link>
        </div>
      </footer>
    </div>
  );
}
