"use client";

import React from "react";
import { CircleAlert, CircleCheck, Info, Inbox, LoaderCircle, TriangleAlert, X } from "@/components/icons";

import { cn, ICON_STROKE, type IconType } from "./core";
import { Combobox, type ComboboxOption } from "./Combobox";
import { Portal } from "./Floating";

export { cn, ICON_STROKE };
export type { IconType };

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant =
  | "primary"
  | "accent"
  | "secondary"
  | "ghost"
  | "danger"
  | "success"
  | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-button-primary text-white shadow-xs disabled:opacity-100 disabled:text-button-primary-disabled-foreground disabled:shadow-none",
  /* Gold. Reserved for the single most important action on a screen. */
  accent: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary: "bg-surface text-foreground border border-line hover:bg-surface-2 hover:border-line-strong",
  outline: "bg-transparent text-foreground border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-surface-2",
  danger: "bg-danger text-danger-foreground hover:brightness-110",
  success: "bg-success text-success-foreground hover:brightness-110",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-body-sm gap-1.5",
  md: "h-10 px-4 text-body gap-2",
  lg: "h-12 px-6 text-body-lg gap-2",
  icon: "h-9 w-9 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconType;
  iconRight?: IconType;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center rounded-[var(--radius-control)] font-semibold tracking-[-0.01em]",
        "transition-[background-color,border-color,color,filter,opacity,box-shadow,transform] duration-200 ease-out",
        "enabled:active:scale-[0.97] enabled:hover:shadow-[var(--shadow-raise)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap select-none",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {loading ? (
        <LoaderCircle className="w-4 h-4 animate-spin shrink-0" strokeWidth={ICON_STROKE} />
      ) : Icon ? (
        <Icon className="w-4 h-4 shrink-0" strokeWidth={ICON_STROKE} />
      ) : null}
      {children}
      {IconRight && !loading && (
        <IconRight className="w-4 h-4 shrink-0" strokeWidth={ICON_STROKE} />
      )}
    </button>
  );
}

/** A link that looks like a Button — never nest a <button> inside an <a>. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: IconType; iconRight?: IconType }) {
  return (
    <a
      {...rest}
      className={cn(
        "inline-flex items-center rounded-[var(--radius-control)] font-semibold tracking-[-0.01em]",
        "transition-[background-color,border-color,color,filter,box-shadow,transform] duration-200 ease-out active:scale-[0.97] hover:shadow-[var(--shadow-raise)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] whitespace-nowrap select-none",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" strokeWidth={ICON_STROKE} />}
      {children}
      {IconRight && <IconRight className="w-4 h-4 shrink-0" strokeWidth={ICON_STROKE} />}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Icon tile                                                           */
/* ------------------------------------------------------------------ */

export type TileTone = "primary" | "accent" | "success" | "warning" | "danger" | "info" | "neutral";

const tileTones: Record<TileTone, string> = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-warning",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-muted",
};

/** The one container every icon in the product sits in. */
export function IconTile({
  icon: Icon,
  tone = "primary",
  size = "md",
  className,
}: {
  icon: IconType;
  tone?: TileTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = { sm: "w-8 h-8", md: "w-10 h-10", lg: "w-12 h-12" }[size];
  const glyph = { sm: "w-4 h-4", md: "w-[18px] h-[18px]", lg: "w-5 h-5" }[size];
  return (
    <span className={cn("icon-tile", box, tileTones[tone], className)}>
      <Icon className={glyph} strokeWidth={ICON_STROKE} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("card", className)}>
      {children}
    </div>
  );
}

/** BoardUI card headers carry a plain title; an icon, when given, is a quiet inline glyph. */
function IconGlyph({ icon: Icon }: { icon: IconType }) {
  return <Icon className="mt-0.5 w-5 h-5 shrink-0 text-subtle" strokeWidth={ICON_STROKE} aria-hidden />;
}

export function CardHeader({
  title,
  description,
  icon,
  tone: _tone,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconType;
  tone?: TileTone;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4 pb-1 sm:px-5 sm:pt-5",
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <IconGlyph icon={icon} />}
        <div className="min-w-0">
          <h2 className="text-body-lg font-semibold text-heading truncate">{title}</h2>
          {description && (
            <p className="text-body-sm text-muted mt-1 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow: _eyebrow,
  title,
  description,
  actions,
}: {
  /** @deprecated Not shown: headings carry the page on their own. */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 mb-7">
      <div className="min-w-0">
        <h1 className="text-display-sm md:text-display text-heading">{title}</h1>
        {description && (
          <p className="text-body text-muted mt-2 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

/* BoardUI field: a filled control with no resting border; focus draws the
   accent ring. Reads as one quiet surface inside a card, like iOS forms. */
const fieldBase =
  "w-full rounded-[var(--radius-control)] bg-[var(--field-bg)] border border-transparent px-3.5 text-body text-foreground " +
  "placeholder:text-subtle outline-none transition-[background-color,box-shadow,border-color] duration-150 " +
  "hover:bg-[var(--field-bg-hover)] focus:bg-surface focus:border-line focus:ring-2 focus:ring-[var(--ring)] " +
  "aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger disabled:opacity-55 disabled:cursor-not-allowed";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-body-sm font-medium text-foreground">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-label text-danger flex items-start gap-1.5 leading-relaxed">
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={ICON_STROKE} />
          {error}
        </p>
      ) : hint ? (
        <p className="text-label text-subtle leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cn(fieldBase, "h-10", className)} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea ref={ref} {...rest} className={cn(fieldBase, "py-3 min-h-28 leading-relaxed", className)} />
  );
});

/** Reads `<option>` children into the option list the dropdown works from. */
function optionsFromChildren(children: React.ReactNode): ComboboxOption[] {
  const out: ComboboxOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      out.push(...optionsFromChildren((child.props as { children?: React.ReactNode }).children));
      return;
    }
    if (child.type !== "option") return;
    const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
    const label = React.Children.toArray(props.children).join("");
    out.push({
      value: String(props.value ?? label),
      label,
      disabled: props.disabled,
    });
  });
  return out;
}

/**
 * Every dropdown in the product.
 *
 * Keeps the native `<select>` API — `<option>` children, `value`, and an
 * `onChange` whose event carries `target.value` — so existing forms did not have
 * to change, while rendering the searchable `Combobox` underneath. The event is
 * a minimal stand-in: only `target.value` and `currentTarget.value` exist on it,
 * which is all any form here reads.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  children,
  className,
  disabled,
  required,
  name,
  id,
  placeholder,
  size,
  icon,
  "aria-label": ariaLabel,
}: {
  value?: string | number | readonly string[];
  defaultValue?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  size?: "sm" | "md";
  icon?: IconType;
  "aria-label"?: string;
}) {
  const all = optionsFromChildren(children);
  // An empty-value option ("Pilih cabang…", "Semua status") is not a choice but
  // the absence of one: it becomes the placeholder, and picking it again is the
  // clear action, instead of sitting in the list as a checkable row.
  const empty = all.find((o) => o.value === "");
  const options = all.filter((o) => o.value !== "");
  const [inner, setInner] = React.useState(String(defaultValue ?? all[0]?.value ?? ""));
  const current = value !== undefined ? String(value) : inner;

  return (
    <Combobox
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder ?? empty?.label}
      clearable={Boolean(empty) && !required}
      size={size}
      icon={icon}
      value={current}
      options={options}
      className={className}
      onChange={(next) => {
        if (value === undefined) setInner(next);
        const target = { value: next, name } as HTMLSelectElement;
        onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-start justify-between gap-4 py-3.5",
        disabled ? "opacity-55" : "cursor-pointer"
      )}
    >
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">{label}</span>
        {description && (
          <span className="block text-body-sm text-muted mt-1 leading-relaxed">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative shrink-0 w-[42px] h-6 rounded-full transition-colors mt-0.5",
          checked ? "bg-primary" : "bg-line-strong",
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-transform",
            checked && "translate-x-[18px]"
          )}
          style={{ boxShadow: "0 1px 3px rgb(0 0 0 / 0.25)" }}
        />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type BadgeTone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  primary: "bg-primary-soft text-primary border-primary/15",
  accent: "bg-accent-soft text-warning border-warning/15",
  success: "bg-success-soft text-success border-success/15",
  warning: "bg-warning-soft text-warning border-warning/15",
  danger: "bg-danger-soft text-danger border-danger/15",
  info: "bg-info-soft text-info border-info/15",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  icon: Icon,
  dot = false,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  icon?: IconType;
  /** Shows a status dot instead of an icon — quieter in dense tables. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-label font-medium whitespace-nowrap",
        badgeTones[tone],
        className
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />}
      {Icon && !dot && <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={ICON_STROKE} />}
      {children}
    </span>
  );
}

/** Every request/record status in the product renders through this one map. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    pending: { tone: "warning", label: "Menunggu" },
    in_progress: { tone: "info", label: "Diproses" },
    approved: { tone: "success", label: "Disetujui" },
    passed: { tone: "success", label: "Lulus" },
    rejected: { tone: "danger", label: "Ditolak" },
    cancelled: { tone: "neutral", label: "Dibatalkan" },
    forfeited: { tone: "danger", label: "Gugur" },
    received: { tone: "info", label: "Diterima" },
    resolved: { tone: "success", label: "Selesai" },
    on_hold: { tone: "neutral", label: "Ditahan" },
    active: { tone: "success", label: "Aktif" },
    onboarding: { tone: "info", label: "Onboarding" },
    suspended: { tone: "warning", label: "Ditangguhkan" },
    resigned: { tone: "neutral", label: "Resign" },
    draft: { tone: "neutral", label: "Draf" },
    published: { tone: "success", label: "Terbit" },
    paid: { tone: "success", label: "Dibayar" },
    expired: { tone: "danger", label: "Kedaluwarsa" },
  };
  const entry = map[status] ?? { tone: "neutral" as BadgeTone, label: status };
  return (
    <Badge tone={entry.tone} dot>
      {entry.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton / empty / error states                                     */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-4 flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-[10px] shrink-0" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full shrink-0" />
        </div>
      ))}
      <span className="sr-only">Memuat data…</span>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: IconType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <IconTile icon={icon} tone="neutral" size="lg" className="mb-4" />
      <p className="text-body-lg font-semibold text-heading">{title}</p>
      {description && (
        <p className="text-body-sm text-muted mt-2 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card p-8 text-center border-danger/25">
      <IconTile icon={TriangleAlert} tone="danger" size="lg" className="mx-auto mb-4" />
      <p className="text-body-lg font-semibold text-heading">Data gagal dimuat</p>
      <p className="text-body-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Muat ulang
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Alert                                                               */
/* ------------------------------------------------------------------ */

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: { cls: "bg-info-soft border-info/20 text-info", Icon: Info },
    success: { cls: "bg-success-soft border-success/20 text-success", Icon: CircleCheck },
    warning: { cls: "bg-warning-soft border-warning/20 text-warning", Icon: TriangleAlert },
    danger: { cls: "bg-danger-soft border-danger/20 text-danger", Icon: CircleAlert },
  }[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-[var(--radius-control)] border p-4", tones.cls, className)}
    >
      <tones.Icon className="w-[18px] h-[18px] shrink-0 mt-px" strokeWidth={ICON_STROKE} />
      <div className="min-w-0 text-body-sm leading-relaxed">
        {title && <p className="font-semibold mb-1">{title}</p>}
        <div className="text-foreground/75">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];

  // Portal: a transformed/animated ancestor would otherwise trap `fixed` inside the page area.
  return (
    <Portal>
    <div
      className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-4 overflow-y-auto backdrop-blur-[2px]"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("w-full my-auto animate-fade-up rounded-[28px] bg-background-primary-default p-1.5 border border-border-button-default", widths)}
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-title-sm font-semibold text-heading">{title}</h2>
            {description && (
              <p className="text-body text-muted mt-1 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="grid size-8 place-items-center rounded-full bg-background-secondary-default text-subtle hover:text-foreground hover:bg-background-secondary-hover cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={ICON_STROKE} />
          </button>
        </div>
        <div className="px-5 pt-2 pb-5 max-h-[68vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-[22px] bg-background-secondary-default px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
    </Portal>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Lanjutkan",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button variant={tone} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-muted leading-relaxed">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body border-collapse min-w-[800px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "text-left text-label font-semibold text-subtle px-5 py-3 bg-surface-2/60 border-b border-line whitespace-nowrap first:rounded-tl-[var(--radius-card)] last:rounded-tr-[var(--radius-card)]",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cn("px-5 py-3.5 border-b border-line align-middle", className)}>{children}</td>
  );
}

/** Row wrapper that gives every table the same hover affordance. */
export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("hover:bg-surface-2 transition-colors", className)}>{children}</tr>;
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                           */
/* ------------------------------------------------------------------ */

/** Counts a number up once when it scrolls into view; non-numbers render as-is. */
export function CountUpValue({ value }: { value: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const target = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [shown, setShown] = React.useState<number | null>(target === null ? null : 0);
  React.useEffect(() => {
    if (target === null) return;
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { queueMicrotask(() => setShown(target)); return; }
    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 900);
        setShown(target * (1 - Math.pow(2, -10 * p)));
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(node);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [target]);
  if (target === null) return <>{value}</>;
  const decimals = Number.isInteger(target) ? 0 : 1;
  return <span ref={ref}>{(shown ?? target).toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>;
}

const DELTA_TONE = {
  up: "bg-status-lime-background text-status-lime-text",
  down: "bg-status-rose-background text-status-rose-text",
  neutral: "bg-background-tertiary-default text-muted",
} as const;

/**
 * KPI tile in BoardUI's dashboard style: a grey tile, a white icon square,
 * the label, a large medium-weight number, and an optional delta chip.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: IconType;
  /** @deprecated Kept for older callers; BoardUI tiles use a neutral icon square. */
  tone?: TileTone;
  delta?: { value: string; tone?: keyof typeof DELTA_TONE };
}) {
  return (
    <section className="flex min-h-[124px] min-w-0 flex-col justify-between gap-3 rounded-2xl bg-surface-2 p-3.5 sm:p-4">
      {Icon && (
        <span className="inline-flex w-fit items-center rounded-md bg-stat-card-icon-background p-1.5">
          <Icon className="w-5 h-5 text-heading" strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-body font-medium text-muted">{label}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <p className="text-[1.75rem] leading-9 font-medium tracking-[-0.02em] text-heading tabular-nums"><CountUpValue value={value} /></p>
          {delta && <span className={cn("rounded-md px-1.5 py-0.5 text-label font-semibold tabular-nums", DELTA_TONE[delta.tone ?? "neutral"])}>{delta.value}</span>}
        </div>
        {hint && <p className="text-body-sm text-subtle mt-1 leading-relaxed">{hint}</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number; icon?: IconType }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex max-w-full gap-1 p-1 rounded-full bg-background-secondary-default overflow-x-auto"
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex h-9 items-center gap-2 px-4 rounded-full text-body-sm font-medium transition-colors cursor-pointer whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              active
                ? "bg-background-primary-default text-heading shadow-xs"
                : "text-muted hover:text-foreground"
            )}
          >
            {t.icon && <t.icon className="w-4 h-4" strokeWidth={ICON_STROKE} />}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                className={cn(
                  "px-1.5 py-px rounded-full text-caption tabular-nums font-semibold",
                  active ? "bg-primary-soft text-primary" : "bg-line text-muted"
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section heading — used to break long pages into readable blocks      */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}
