"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, CircleCheck, Clock3, MapPin, Moon, Send, Sun } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { Badge, Button, ICON_STROKE, SkeletonList } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError, errorMessage } from "@/lib/client-api";
import {
  ApplicationFormRenderer,
  focusFirstError,
  initialValues,
  prepareAnswers,
  serverFieldErrors,
  type FormErrors,
  type FormValues,
  type RenderField,
} from "@/components/recruitment/ApplicationFormRenderer";
import { formatDate, formatRupiah, timezoneLabel } from "@/lib/time";

interface VacancyDetail {
  _id: string;
  title: string;
  slug: string;
  summary: string;
  employmentTypeLabel: string;
  workArrangementLabel: string;
  location: string;
  division: string;
  publishedAt?: string;
  closesAt?: string | null;
  salary: { min: number; max: number } | null;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  benefits: string[];
  formFields: RenderField[];
}

export default function VacancyDetailPage() {
  const params = useParams<{ slug: string }>();
  const { theme, toggleTheme } = useTheme();

  const [vacancy, setVacancy] = useState<VacancyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<VacancyDetail>(
        `/api/v1/public/vacancies?slug=${encodeURIComponent(params.slug)}`
      );
      setVacancy(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-16 border-b border-line bg-background/85 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto w-full h-full px-5 flex items-center justify-between gap-4">
          <Link
            href="/career"
            className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
            Semua lowongan
          </Link>
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
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-5 py-12">
        {loading ? (
          <SkeletonList rows={3} />
        ) : error || !vacancy ? (
          <div className="card p-10 text-center">
            <h1 className="text-title text-heading">Lowongan tidak tersedia</h1>
            <p className="mt-3 text-body text-muted leading-relaxed max-w-md mx-auto">
              {error || "Lowongan ini sudah ditutup atau tautannya tidak berlaku lagi."}
            </p>
            <Link href="/career">
              <Button variant="secondary" className="mt-6">
                Lihat lowongan lain
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-display md:text-hero-sm text-heading leading-[1.12]">
                {vacancy.title}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-body text-muted">
                {vacancy.division && (
                  <span className="inline-flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                    {vacancy.division}
                  </span>
                )}
                {vacancy.location && (
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                    {vacancy.location}
                  </span>
                )}
                <span className="inline-flex items-center gap-2">
                  <Clock3 className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
                  {vacancy.employmentTypeLabel}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{vacancy.workArrangementLabel}</Badge>
                {vacancy.salary && vacancy.salary.max > 0 && (
                  <Badge tone="success">
                    {formatRupiah(vacancy.salary.min)} – {formatRupiah(vacancy.salary.max)}
                  </Badge>
                )}
                {vacancy.closesAt && (
                  <Badge tone="warning">Lamaran ditutup {formatDate(vacancy.closesAt)}</Badge>
                )}
              </div>
            </div>

            {vacancy.summary && (
              <p className="mt-8 text-body-lg text-foreground/85 leading-[1.7]">{vacancy.summary}</p>
            )}

            <div className="mt-10 space-y-9">
              <BulletSection title="Tanggung jawab" items={vacancy.responsibilities} />
              <BulletSection title="Kualifikasi" items={vacancy.requirements} />
              <BulletSection title="Nilai tambah" items={vacancy.niceToHave} />
              <BulletSection title="Yang kami sediakan" items={vacancy.benefits} />
            </div>

            <div id="lamar" className="mt-12 pt-10 border-t border-line scroll-mt-24">
              {submitted ? (
                <div className="card p-8 text-center">
                  <span className="inline-grid place-items-center w-12 h-12 rounded-[14px] bg-success-soft text-success mb-4">
                    <CircleCheck className="w-6 h-6" strokeWidth={ICON_STROKE} />
                  </span>
                  <h2 className="text-title text-heading">Lamaran terkirim</h2>
                  <p className="mt-3 text-body text-muted leading-relaxed max-w-md mx-auto">
                    Nomor referensi Anda <strong className="text-foreground">{submitted}</strong>.
                    Simpan nomor ini bila suatu saat perlu menanyakan status lamaran. Tim rekrutmen
                    akan menghubungi pelamar yang profilnya sesuai.
                  </p>
                  <Link href="/career">
                    <Button variant="secondary" className="mt-6">
                      Lihat lowongan lain
                    </Button>
                  </Link>
                </div>
              ) : (
                <ApplyForm
                  slug={vacancy.slug}
                  title={vacancy.title}
                  fields={vacancy.formFields ?? []}
                  onDone={setSubmitted}
                />
              )}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="max-w-4xl mx-auto w-full px-5 py-7 text-body-sm text-subtle">
          &copy; {new Date().getFullYear()} HRIS. Seluruh waktu dalam {timezoneLabel()}.
        </div>
      </footer>
    </div>
  );
}

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <section>
      <h2 className="text-title-sm font-semibold text-heading">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
            <span className="text-body text-foreground/85 leading-[1.65]">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ApplyForm({
  slug,
  title,
  fields,
  onDone,
}: {
  slug: string;
  title: string;
  fields: RenderField[];
  onDone: (reference: string) => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<FormErrors>({});
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  const setValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // An error disappears as soon as the field is touched again, rather than
    // lingering until the next submit.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { answers, errors: found } = prepareAnswers(fields, values);
    if (!consent) found.__consent = "Centang persetujuan pemrosesan data untuk melanjutkan.";
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error("Periksa kembali isian Anda", `${Object.keys(found).length} isian perlu diperbaiki.`);
      focusFirstError(found, fields);
      return;
    }

    setSaving(true);
    try {
      const res = await api.post<{ reference: string } | null>("/api/v1/public/candidates", {
        vacancySlug: slug,
        answers,
      });
      // A repeat application returns the same neutral message with no payload,
      // so the reference falls back to a dash rather than rendering "undefined".
      onDone(res.data?.reference ?? "—");
      window.scrollTo({ top: document.getElementById("lamar")?.offsetTop ?? 0, behavior: "smooth" });
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? serverFieldErrors(err.details) : {};
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        focusFirstError(fieldErrors, fields);
      }
      toast.error("Lamaran gagal terkirim", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const requiredCount = fields.filter((f) => f.required).length;

  return (
    <div>
      <h2 className="text-title text-heading">Lamar posisi ini</h2>
      <p className="mt-2.5 text-body text-muted leading-relaxed">
        Isi formulir di bawah. Kolom bertanda <span className="text-danger">*</span> wajib diisi
        ({requiredCount} kolom). Kami hanya memakai data ini untuk proses seleksi{title ? ` posisi ${title}` : ""}.
      </p>

      <form onSubmit={submit} noValidate className="mt-7 card p-5 sm:p-7 space-y-8">
        <ApplicationFormRenderer
          fields={fields}
          values={values}
          onChange={setValue}
          errors={errors}
          vacancySlug={slug}
          disabled={saving}
          idPrefix="ap"
        />

        <div className="pt-6 border-t border-line space-y-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setValue("__consent", e.target.checked);
              }}
              className="mt-0.5 w-[18px] h-[18px] accent-[var(--primary)] shrink-0 cursor-pointer"
            />
            <span className="text-body-sm text-foreground/85 leading-relaxed">
              Saya menyetujui data dan dokumen di atas disimpan dan diproses untuk keperluan rekrutmen.
              Data pelamar yang tidak lolos tetap disimpan sebagai riwayat seleksi.
            </span>
          </label>
          {errors.__consent && <p className="text-label text-danger -mt-2">{errors.__consent}</p>}

          <Button type="submit" size="lg" icon={Send} loading={saving} className="w-full justify-center">
            Kirim lamaran
          </Button>
        </div>
      </form>
    </div>
  );
}
