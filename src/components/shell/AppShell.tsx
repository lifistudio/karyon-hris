"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ArrowUpCircle, BookOpen, ChevronDown, KeyRound, LogOut, Menu, Moon, PanelLeftClose, Sun, UserRound } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { NotificationBell } from "./NotificationBell";
import { cn, ICON_STROKE, type IconType } from "@/components/ui";
import { timezoneName, timezoneAbbr } from "@/lib/time";
import { motion } from "framer-motion";
import { useLicense } from "@/lib/use-license";
import { useNotices } from "@/lib/use-notices";

export interface NavItem {
  name: string;
  href: string;
  icon: IconType;
  /** Roles allowed to see the link. Omit for everyone. */
  roles?: string[];
  permission?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/* ------------------------------------------------------------------ */
/* WIB clock                                                           */
/* ------------------------------------------------------------------ */

function useWibNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Starts null so the server and the first client render agree; the clock
    // appears on the first tick instead of causing a hydration mismatch.
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function fmt(now: Date | null, opts: Intl.DateTimeFormatOptions, fallback: string) {
  return now ? new Intl.DateTimeFormat("id-ID", { timeZone: timezoneName(), ...opts }).format(now) : fallback;
}

function ClockPanel() {
  const now = useWibNow();
  return (
    <div className="rounded-2xl bg-background-inner-default shadow-card px-3.5 py-3">
      <p className="text-title-sm font-semibold text-heading tabular-nums tracking-[-0.02em] leading-none">
        {fmt(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }, "--:--:--")}
        <span className="text-label font-medium text-subtle ml-1.5 tracking-normal">{timezoneAbbr()}</span>
      </p>
      <p className="text-label text-muted mt-1.5 truncate">
        {fmt(now, { weekday: "long", day: "numeric", month: "long" }, "Memuat…")}
      </p>
    </div>
  );
}

function ClockInline() {
  const now = useWibNow();
  return (
    <span className="hidden md:flex items-baseline gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-line">
      <span className="text-body-sm font-semibold text-foreground tabular-nums">
        {fmt(now, { hour: "2-digit", minute: "2-digit", hour12: false }, "--:--")}
      </span>
      <span className="text-caption font-medium text-subtle">{timezoneAbbr()}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
      title={theme === "dark" ? "Tampilan terang" : "Tampilan gelap"}
      className="p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
    >
      {theme === "dark" ? (
        <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
      ) : (
        <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
      )}
    </button>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = session?.user;

  const initials = useMemo(() => {
    const source = user?.employeeName || user?.name || user?.email || "?";
    return source
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Menu akun"
        className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-full hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground grid place-items-center text-label font-semibold shrink-0">
          {initials || <UserRound className="w-4 h-4" strokeWidth={ICON_STROKE} />}
        </span>
        <span className="hidden lg:block text-left min-w-0">
          <span className="block text-body-sm font-medium text-foreground truncate max-w-36 leading-tight">
            {user?.employeeName || user?.email || "Pengguna"}
          </span>
          <span className="block text-caption text-subtle leading-tight mt-0.5">{user?.role ?? "-"}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-subtle hidden lg:block" strokeWidth={ICON_STROKE} />
      </button>

      {open && (
        <div
          className="card absolute right-0 mt-2 w-64 z-50 animate-fade-up overflow-hidden"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="px-4 py-3.5 border-b border-line">
            <p className="text-body font-semibold text-heading truncate">
              {user?.employeeName || "Pengguna"}
            </p>
            <p className="text-label text-muted truncate mt-0.5">{user?.email}</p>
            <p className="text-caption text-subtle mt-1.5">Peran {user?.role}</p>
          </div>
          <div className="p-1.5">
            <MenuLink href="/portal/profile" icon={UserRound} onClick={() => setOpen(false)}>
              Profil &amp; keamanan
            </MenuLink>
            <MenuLink href="/docs" icon={BookOpen} onClick={() => setOpen(false)}>
              Panduan penggunaan
            </MenuLink>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-body-sm text-danger hover:bg-danger-soft transition-colors cursor-pointer font-medium"
            >
              <LogOut className="w-4 h-4" strokeWidth={ICON_STROKE} />
              Keluar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href: string;
  icon: IconType;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-body-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
    >
      <Icon className="w-4 h-4" strokeWidth={ICON_STROKE} />
      {children}
    </Link>
  );
}

/**
 * Tells the superadmin, on every admin page, that Pro features are paused
 * because the license lapsed — the app keeps working as Community meanwhile.
 */
/** "New version" chip for the superadmin; links to the one-click update panel. */
function UpdateChip({ enabled }: { enabled: boolean }) {
  const notices = useNotices(enabled);
  const update = notices?.update;
  if (!update?.available || !update.latest) return null;
  return (
    <Link
      href="/admin/license#update"
      className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary-soft text-primary text-body-sm font-semibold hover:brightness-95 transition"
      title={`Versi ${update.latest} tersedia (sekarang ${update.current})`}
    >
      <ArrowUpCircle className="w-4 h-4" strokeWidth={ICON_STROKE} aria-hidden />
      Versi {update.latest}
    </Link>
  );
}

function LicenseBanner() {
  const { license } = useLicense();
  if (!license || license.edition !== "pro" || !["expired", "grace"].includes(license.status)) return null;
  const expired = license.status === "expired";
  return (
    <div role="status" className={cn("mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-body-sm", expired ? "bg-danger-soft border-danger/25 text-danger" : "bg-warning-soft border-warning/25 text-warning")}>
      <KeyRound className="w-4 h-4 shrink-0" strokeWidth={ICON_STROKE} />
      <span className="flex-1 min-w-0 text-foreground/80">
        {expired
          ? "Lisensi Pro berakhir — aplikasi berjalan dengan fitur Community, data tetap aman."
          : "Server lisensi belum terjangkau — fitur Pro tetap aktif selama masa tenggang."}
      </span>
      <Link href="/admin/license" className="font-semibold underline-offset-2 hover:underline">
        {expired ? "Perpanjang atau ganti lisensi" : "Periksa status"}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * The single layout both the admin CMS and the employee portal render inside.
 *
 * The sidebar is a flat rail: the active item is a tinted pill rather than a
 * filled dark block, which keeps the brand colour meaning "this is where you
 * are" instead of competing with every primary button on the page.
 */
export function AppShell({
  sections,
  brand,
  brandHref,
  children,
}: {
  sections: NavSection[];
  brand: { title: string; subtitle: string };
  brandHref: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = session?.user?.role;
  const [disciplineAccess, setDisciplineAccess] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/v1/discipline?view=access", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        const body = r.ok ? await r.json().catch(() => null) : null;
        if (active) setDisciplineAccess(r.ok && body?.data?.available !== false);
      })
      .catch(() => { if (active) setDisciplineAccess(false); });
    return () => { active = false; };
  }, [role]);

  // Links the current role cannot use are removed rather than shown disabled —
  // a menu that only leads to "access denied" is worse than a shorter menu.
  const visibleSections = useMemo(
    () =>
      sections
        .map((s) => ({ ...s, items: s.items.filter((i) => (!i.roles || !role || i.roles.includes(role)) && (!i.permission || disciplineAccess)) }))
        .filter((s) => s.items.length > 0),
    [sections, role, disciplineAccess]
  );

  useEffect(() => setMobileOpen(false), [pathname]);

  const currentTitle = useMemo(() => {
    for (const s of visibleSections) {
      const hit = s.items.find((i) => i.href === pathname);
      if (hit) return hit.name;
    }
    return brand.title;
  }, [visibleSections, pathname, brand.title]);

  const nav = (
    <nav className="flex-1 overflow-y-auto px-0.5 py-4 space-y-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {visibleSections.map((section) => (
        <div key={section.label}>
          <p className="px-2 mb-1 text-label font-semibold text-subtle normal-case tracking-normal">{section.label}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2 px-2 py-2 rounded-[10px] text-body font-medium transition-colors duration-200",
                      active ? "text-white" : "text-muted hover:text-foreground hover:bg-surface-hover"
                    )}
                  >
                    {/* The selected pill slides between items (BoardUI's gradient nav pill). */}
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-[10px] bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn("relative w-5 h-5 shrink-0", active ? "text-white" : "text-subtle group-hover:text-foreground")}
                      strokeWidth={ICON_STROKE}
                    />
                    <span className="relative truncate">{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brandBlock = (
    <Link href={brandHref} className="block min-w-0 rounded-xl px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" aria-label={`${brand.title} — ${brand.subtitle}`}>
      {/* Logo alone carries the brand; the area name sits quietly underneath. */}
      <BrandLogo height={26} />
      <span className="mt-1.5 block truncate text-body-sm text-subtle">{brand.subtitle}</span>
    </Link>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop rail */}
      <div className="hidden lg:block w-[272px] shrink-0">
        <aside className="sticky top-3 m-3 mr-0 h-[calc(100vh-24px)] flex flex-col rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar">
          <div className="px-1 pt-1 pb-2">{brandBlock}</div>
          {nav}
          <div className="pt-2">
            <ClockPanel />
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "var(--overlay)" }}
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="m-2 w-[280px] max-w-[85vw] h-[calc(100dvh-16px)] rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar flex flex-col animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-1 pt-1 pb-2 flex items-center justify-between gap-2">
              {brandBlock}
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Tutup menu"
                className="p-1.5 rounded-lg text-subtle hover:text-foreground hover:bg-surface-2 cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              </button>
            </div>
            {nav}
            <div className="pt-2">
              <ClockPanel />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-background/85 backdrop-blur-xl flex items-center justify-between gap-3 px-4 md:px-6 lg:px-8 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-2 -ml-1 rounded-[var(--radius-control)] text-muted hover:bg-surface-2 cursor-pointer"
            >
              <Menu className="w-5 h-5" strokeWidth={ICON_STROKE} />
            </button>
            <h1 className="text-body-lg font-semibold text-heading truncate">{currentTitle}</h1>
          </div>

          <div className="flex items-center gap-1.5">
            <UpdateChip enabled={role === "SUPERADMIN"} />
            <ClockInline />
            <NotificationBell />
            <ThemeToggle />
            <span className="w-px h-6 bg-line mx-1 hidden sm:block" aria-hidden />
            <UserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 pb-8 pt-2 md:px-6 lg:px-8 min-w-0">
          <div key={pathname} className="mx-auto w-full max-w-[100rem] animate-fade-up">
            {role === "SUPERADMIN" && pathname !== "/admin/license" && <LicenseBanner />}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
