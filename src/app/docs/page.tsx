"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowLeft, Filter, Menu, Moon, Search, Sun, X } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { Alert, Badge, ErrorState, Input, Select, SkeletonList, cn } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { ROLE_LABELS } from "@/lib/docs/roles";
import type { DocBlock, DocChapter, DocSection } from "@/lib/docs/content";
import { DocumentationCode } from "@/components/DocumentationCode";

/**
 * The guide.
 *
 * Signed-in only, and filtered by role on the server: each role receives the
 * procedures written for it and nothing else. Superadmin reads everything and
 * can preview what a particular role sees.
 */
export default function DocsPage() {
  const { theme, toggleTheme } = useTheme();
  const { data: session } = useSession();
  const sessionRole = session?.user?.role;

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [navOpen, setNavOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [source, setSource] = useState<DocChapter[] | null>(null);
  const [canPreview, setCanPreview] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const qs = roleFilter !== "all" ? `?role=${encodeURIComponent(roleFilter)}` : "";
      const res = await api.get<{ chapters: DocChapter[]; canPreview: boolean }>(`/api/v1/docs${qs}`);
      setSource(res.data?.chapters ?? []);
      setCanPreview(Boolean(res.data?.canPreview));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const allSections = useMemo(() => (source ?? []).flatMap((c) => c.sections), [source]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSections.filter((s) => {
      if (!q) return true;
      const haystack = [
        s.title,
        s.summary,
        ...s.blocks.flatMap(blockText),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, allSections]);

  const visibleIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);

  const chapters = useMemo(
    () =>
      (source ?? []).map((c) => ({
        ...c,
        sections: c.sections.filter((s) => visibleIds.has(s.id)),
      })).filter((c) => c.sections.length > 0),
    [visibleIds, source]
  );

  // Highlights the section currently in view in the sidebar.
  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-section]"));
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [chapters]);

  const nav = (
    <nav className="space-y-5">
      {chapters.map((c) => (
        <div key={c.id}>
          <p className="px-3 mb-1 text-body-sm font-semibold text-heading">
            {c.title}
          </p>
          <ul className="space-y-0.5">
            {c.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={() => setNavOpen(false)}
                  className={cn(
                    "block px-3 py-1.5 rounded-xl text-body-sm leading-snug transition-colors",
                    activeId === s.id
                      ? "bg-background-primary-default text-heading font-medium shadow-xs"
                      : "text-muted hover:text-foreground hover:bg-background-secondary-hover"
                  )}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-16 bg-background/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-[100rem] mx-auto h-full px-4 md:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Buka daftar isi"
              className="lg:hidden grid size-9 place-items-center rounded-full text-muted hover:bg-background-secondary-default cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/" className="flex items-center gap-3 min-w-0">
              <BrandLogo height={26} />
              <span className="hidden sm:block h-5 w-px bg-line" aria-hidden />
              <span className="hidden sm:block text-body font-medium text-heading truncate">Dokumentasi</span>
            </Link>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Mode terang" : "Mode gelap"}
              className="grid size-9 place-items-center rounded-full text-muted hover:text-foreground hover:bg-background-secondary-default cursor-pointer"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              href={sessionRole && sessionRole !== "STAFF" ? "/admin" : "/portal/attendance"}
              aria-label="Kembali ke aplikasi"
              title="Kembali ke aplikasi"
              className="grid size-9 place-items-center rounded-full text-muted hover:text-foreground hover:bg-background-secondary-default transition-colors"
            >
              <ArrowLeft className="w-[18px] h-[18px]" />
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8 pt-4 pb-12 grid grid-cols-1 gap-10 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <div className="docs-scroll sticky top-20 space-y-5 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-3xl bg-background-secondary-default p-3">
            <DocFilters
              query={query}
              setQuery={setQuery}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              canPreview={canPreview}
            />
            {nav}
          </div>
        </aside>

        {/* Mobile nav drawer */}
        {navOpen && (
          <div
            className="fixed inset-0 z-50 lg:hidden"
            style={{ background: "var(--overlay)" }}
            onClick={() => setNavOpen(false)}
          >
            <div
              className="m-2 w-80 max-w-[85vw] h-[calc(100dvh-16px)] rounded-3xl bg-background-secondary-default p-3 overflow-y-auto animate-fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-body-lg font-semibold text-heading">Daftar isi</span>
                <button
                  onClick={() => setNavOpen(false)}
                  aria-label="Tutup"
                  className="icon-close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <DocFilters
                  query={query}
                  setQuery={setQuery}
                  roleFilter={roleFilter}
                  setRoleFilter={setRoleFilter}
                  canPreview={canPreview}
                />
                {nav}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="min-w-0 max-w-[52rem]">
          <div className="mb-10 pt-4">
            <h1 className="text-display-sm md:text-display text-heading">Panduan penggunaan HRIS</h1>
            <p className="mt-2 text-body text-muted leading-relaxed max-w-2xl">
              {canPreview
                ? "Sebagai Superadmin Anda melihat panduan semua peran. Pilih peran di penyaring untuk melihat persis apa yang ditampilkan kepada peran tersebut."
                : `Panduan untuk peran ${ROLE_LABELS[sessionRole ?? ""] ?? sessionRole ?? "Anda"}: hanya menu dan alur yang bisa Anda gunakan.`}
            </p>
            {canPreview && roleFilter !== "all" && (
              <p className="mt-3 text-label text-subtle">
                Menampilkan bagian untuk peran{" "}
                <strong className="text-foreground">{ROLE_LABELS[roleFilter] ?? roleFilter}</strong>{" "}
                dan bagian yang berlaku untuk semua orang.
              </p>
            )}
          </div>

          <div className="lg:hidden mb-6">
            <DocFilters
              query={query}
              setQuery={setQuery}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              canPreview={canPreview}
            />
          </div>

          {loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : source === null ? (
            <SkeletonList rows={6} />
          ) : chapters.length === 0 ? (
            <Alert tone="info" title="Tidak ada bagian yang cocok">
              Tidak ditemukan bagian dokumentasi untuk kata kunci &ldquo;{query}&rdquo;. Coba kata
              lain.
            </Alert>
          ) : (
            <div className="space-y-14">
              {chapters.map((chapter) => (
                <section key={chapter.id}>
                  <h2 className="text-title font-semibold text-heading mb-6">
                    {chapter.title}
                  </h2>
                  <div className="space-y-10">
                    {chapter.sections.map((section) => (
                      <SectionView key={section.id} section={section} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <footer className="mt-16 rounded-3xl bg-background-secondary-default px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-body-sm text-muted">
            <p>Dokumentasi ini menjelaskan perilaku sistem versi yang sedang berjalan.</p>
            {canPreview && (
              <Link href="/api-docs" className="hover:text-foreground transition-colors">
                Referensi API →
              </Link>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function DocFilters({
  query,
  setQuery,
  roleFilter,
  setRoleFilter,
  canPreview,
}: {
  query: string;
  setQuery: (v: string) => void;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  canPreview: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari di dokumentasi…"
          aria-label="Cari di dokumentasi"
          className="ps-10 bg-background-primary-default"
        />
      </div>
      {canPreview && (
      <div>
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Saring menurut peran"
          size="sm"
          icon={Filter}
        >
          <option value="all">Semua peran</option>
          {Object.entries(ROLE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      )}
    </div>
  );
}

function SectionView({ section }: { section: DocSection }) {
  return (
    <article>
      <h3
        id={section.id}
        data-doc-section
        className="scroll-mt-24 text-title-sm font-semibold text-heading flex flex-wrap items-center gap-2"
      >
        {section.title}
        {section.audience.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {section.audience.map((a) => (
              <Badge key={a} tone="neutral">
                {ROLE_LABELS[a] ?? a}
              </Badge>
            ))}
          </span>
        )}
      </h3>
      <p className="mt-1.5 text-body text-muted">{section.summary}</p>

      <div className="mt-4 space-y-4">
        {section.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </article>
  );
}

function BlockView({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "p":
      return <p className="text-body text-foreground/85 leading-relaxed max-w-3xl">{block.text}</p>;

    case "steps":
      return (
        <ol className="space-y-2.5 max-w-3xl">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid place-items-center size-6 rounded-full bg-background-secondary-default text-heading text-label font-semibold shrink-0 tabular-nums">
                {i + 1}
              </span>
              <span className="text-body text-foreground/85 leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      );

    case "list":
      return (
        <ul className="space-y-2 max-w-3xl">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-line-strong shrink-0" aria-hidden />
              <span className="text-body text-foreground/85 leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      );

    case "note":
      return (
        <Alert tone={block.tone} title={block.title} className="max-w-3xl">
          {block.text}
        </Alert>
      );

    case "table":
      return (
        <div className="overflow-x-auto max-w-3xl">
          <table className="w-full text-body border-separate border-spacing-0 min-w-[520px] overflow-hidden rounded-2xl border border-border-button-default">
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th
                    key={h}
                    className="text-left text-body-sm font-medium text-muted bg-background-secondary-default px-4 py-2.5 border-b border-line"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-4 py-3 border-b border-line text-body-sm leading-relaxed align-top",
                        j === 0 ? "font-medium text-heading" : "text-muted"
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "code":
      return <DocumentationCode text={block.text} />;

    default:
      return null;
  }
}

/** Flattens a block into searchable text. */
function blockText(block: DocBlock): string[] {
  switch (block.type) {
    case "p":
    case "code":
      return [block.text];
    case "note":
      return [block.title ?? "", block.text];
    case "steps":
    case "list":
      return block.items;
    case "table":
      return [...block.head, ...block.rows.flat()];
    default:
      return [];
  }
}
