"use client";

import React from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Moon, ShieldCheck, Sun } from "@/components/icons";
import { motion } from "framer-motion";
import { useTheme } from "@/components/ThemeProvider";
import { ICON_STROKE } from "@/components/ui";

/**
 * Shared chrome for every unauthenticated page.
 *
 * A single centred column on the tinted ground, with the brand mark doing the
 * work a hero image would otherwise do. Nothing decorative competes with the
 * form, which is the only thing anyone is here to use.
 */
export function AuthShell({
  title,
  subtitle,
  badge: _badge,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 max-w-[80rem] mx-auto w-full">
        <Link href="/" aria-label="Kembali ke beranda" title="Kembali ke beranda" className="grid size-9 place-items-center rounded-full text-muted hover:text-foreground hover:bg-background-secondary-default transition-colors">
          <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        </Link>
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
          className="grid size-9 place-items-center rounded-full text-subtle hover:text-foreground hover:bg-background-secondary-default transition-colors cursor-pointer"
        >
          {theme === "dark" ? (
            <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
          ) : (
            <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
          )}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <motion.div
          className="w-full max-w-[26rem]"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="rounded-[32px] border border-border-button-default bg-background-primary-default p-2 shadow-[var(--shadow-pop)]">
            <div className="rounded-[26px] bg-background-secondary-default px-6 pt-7 pb-6 text-center">
              <span className="inline-flex justify-center">
                <BrandLogo height={32} />
              </span>
              <h1 className="mt-6 text-title font-semibold text-heading">{title}</h1>
              <p className="mt-2 text-body text-muted leading-relaxed">{subtitle}</p>
            </div>
            <div className="px-5 pt-6 pb-5 sm:px-6">{children}</div>
          </div>

          {footer && <div className="mt-6 text-center text-body-sm text-muted">{footer}</div>}
        </motion.div>
      </main>

      <footer className="shrink-0 py-6 px-5">
        <p className="flex items-center justify-center gap-2 text-body-sm text-subtle">
          <ShieldCheck className="w-4 h-4" strokeWidth={ICON_STROKE} />
          Aktivitas login dicatat untuk keperluan audit keamanan.
        </p>
      </footer>
    </div>
  );
}

/** Password field with a show/hide toggle that stays keyboard accessible. */
export function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
  autoComplete = "current-password",
  required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="field w-full h-10 ps-3.5 pe-12"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        className="absolute end-1 top-1 h-8 w-10 grid place-items-center rounded-lg text-subtle hover:text-foreground hover:bg-background-secondary-hover cursor-pointer transition-colors"
      >
        {visible ? (
          <EyeOff className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        ) : (
          <Eye className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        )}
      </button>
    </div>
  );
}
