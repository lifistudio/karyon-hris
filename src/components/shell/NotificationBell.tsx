"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BriefcaseBusiness, CakeSlice, CalendarCheck2, CheckCheck, ClipboardCheck, Clock3, FileSignature, LoaderCircle, MessageSquareWarning, Package, ReceiptText, Settings2, X } from "@/components/icons";
import { api } from "@/lib/client-api";
import { formatRelative, wibDateKey } from "@/lib/time";
import { cn, EmptyState, ICON_STROKE, type IconType } from "@/components/ui";
import { Portal, useIsSheet } from "@/components/ui/Floating";

interface NotificationItem {
  _id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  isRead: boolean;
  createdAt: string;
}

/** Icon and tone per kind, so the feed can be scanned without reading. */
const KIND: Record<string, { icon: IconType; tone: string; label: string }> = {
  approval_request: { icon: ClipboardCheck, tone: "bg-warning-soft text-warning", label: "Perlu tindakan" },
  approval_result: { icon: CalendarCheck2, tone: "bg-success-soft text-success", label: "Persetujuan" },
  attendance: { icon: Clock3, tone: "bg-info-soft text-info", label: "Presensi" },
  payroll: { icon: ReceiptText, tone: "bg-primary-soft text-primary", label: "Gaji" },
  contract: { icon: FileSignature, tone: "bg-warning-soft text-warning", label: "Kontrak" },
  recruitment: { icon: BriefcaseBusiness, tone: "bg-primary-soft text-primary", label: "Rekrutmen" },
  inventory: { icon: Package, tone: "bg-surface-2 text-muted", label: "Inventaris" },
  complaint: { icon: MessageSquareWarning, tone: "bg-danger-soft text-danger", label: "Pengaduan" },
  birthday: { icon: CakeSlice, tone: "bg-accent-soft text-accent", label: "Ulang tahun" },
  system: { icon: Settings2, tone: "bg-surface-2 text-muted", label: "Sistem" },
};

const PAGE = 15;

function dayLabel(iso: string) {
  const key = wibDateKey(new Date(iso));
  const today = wibDateKey();
  const yesterday = wibDateKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Hari ini";
  if (key === yesterday) return "Kemarin";
  return "Sebelumnya";
}

/**
 * In-app notification feed.
 *
 * Polls rather than holding an SSE stream: a 60-second interval is well within
 * what approval turnaround needs, and it survives serverless hosting where a
 * long-lived connection would be dropped. Polling pauses while the tab is
 * hidden and catches up when it becomes visible again.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isSheet = useIsSheet();

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: NotificationItem[]; unreadCount: number }>(
        `/api/v1/notifications?limit=${PAGE}${onlyUnread ? "&unread=1" : ""}`
      );
      setItems(res.data?.items ?? []);
      setUnread(res.data?.unreadCount ?? 0);
      setTotal(res.meta?.total ?? 0);
    } catch {
      // A failed poll is not worth interrupting the user for.
    } finally {
      setLoading(false);
    }
  }, [onlyUnread]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = Math.floor(items.length / PAGE) + 1;
      const res = await api.get<{ items: NotificationItem[] }>(
        `/api/v1/notifications?limit=${PAGE}&page=${page}${onlyUnread ? "&unread=1" : ""}`
      );
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i._id));
        return [...prev, ...(res.data?.items ?? []).filter((i) => !seen.has(i._id))];
      });
    } catch {
      // Leave the list as it is.
    } finally {
      setLoadingMore(false);
    }
  };

  const markAll = async () => {
    setItems((prev) => (onlyUnread ? [] : prev.map((i) => ({ ...i, isRead: true }))));
    setUnread(0);
    await api.post("/api/v1/notifications", { all: true }).catch(() => void load());
  };

  const markOne = async (id: string) => {
    setItems((prev) => prev.map((i) => (i._id === id ? { ...i, isRead: true } : i)));
    setUnread((u) => Math.max(0, u - 1));
    await api.post("/api/v1/notifications", { ids: [id] }).catch(() => {});
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} notifikasi belum dibaca` : "Notifikasi"}
        aria-expanded={open}
        className="relative p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <Bell className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 grid place-items-center rounded-full bg-danger text-danger-foreground text-caption font-semibold tabular-nums ring-2 ring-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <SheetPortal enabled={isSheet}>
          {isSheet && <div className="fixed inset-0 z-[79] bg-overlay" aria-hidden onClick={() => setOpen(false)} />}
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Notifikasi"
            className={cn(
              "z-[80] overflow-hidden flex flex-col bg-background-primary-default border border-border-button-default",
              isSheet
                ? "fixed inset-x-0 bottom-0 rounded-t-[28px] max-h-[85dvh] pb-[env(safe-area-inset-bottom)] animate-[sheet-in_160ms_ease-out]"
                : "absolute right-0 mt-2 w-[26rem] max-h-[36rem] rounded-[28px] animate-[pop-in_120ms_ease-out]"
            )}
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
              <p className="text-title-sm font-semibold text-heading">Notifikasi</p>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={markAll}
                    className="flex h-8 items-center gap-1.5 px-3 rounded-full text-body-sm font-medium text-primary hover:bg-primary-soft cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                    Tandai semua dibaca
                  </button>
                )}
                {isSheet && (
                  <button onClick={() => setOpen(false)} aria-label="Tutup" className="icon-close">
                    <X className="w-4 h-4" strokeWidth={ICON_STROKE} />
                  </button>
                )}
              </div>
            </div>

            <div className="mx-5 mb-2 inline-flex w-fit gap-1 rounded-full bg-background-secondary-default p-1" role="tablist">
              {[
                { id: false, label: "Semua" },
                { id: true, label: `Belum dibaca${unread ? ` (${unread})` : ""}` },
              ].map((t) => (
                <button
                  key={String(t.id)}
                  role="tab"
                  aria-selected={onlyUnread === t.id}
                  onClick={() => {
                    setLoading(true);
                    setOnlyUnread(t.id);
                  }}
                  className={cn(
                    "h-8 px-3.5 rounded-full text-body-sm font-medium transition-colors cursor-pointer",
                    onlyUnread === t.id ? "bg-background-primary-default text-heading shadow-xs" : "text-muted hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted">
                  <LoaderCircle className="w-5 h-5 animate-spin" strokeWidth={ICON_STROKE} />
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={Bell}
                  title={onlyUnread ? "Semua sudah dibaca" : "Belum ada notifikasi"}
                  description="Persetujuan yang menunggu Anda, hasil pengajuan, slip gaji, jadwal wawancara, dan pengingat presensi muncul di sini."
                />
              ) : (
                <ul className="space-y-1.5">
                  {items.map((n, index) => {
                    const kind = KIND[n.kind] ?? KIND.system;
                    const group = dayLabel(n.createdAt);
                    const showGroup = index === 0 || dayLabel(items[index - 1].createdAt) !== group;
                    const Icon = kind.icon;

                    const content = (
                      <div className={cn("flex gap-3 rounded-2xl px-3.5 py-3.5 transition-colors", n.isRead ? "hover:bg-background-secondary-default" : "bg-background-secondary-default hover:bg-background-secondary-hover")}>
                        <span className={cn("grid place-items-center size-9 rounded-full shrink-0", kind.tone)} aria-hidden>
                          <Icon className="w-4 h-4" strokeWidth={ICON_STROKE} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-body-sm leading-snug", n.isRead ? "text-foreground/80" : "text-heading font-semibold")}>
                            {n.title}
                          </p>
                          {n.body && <p className="text-body-sm text-muted mt-0.5 leading-relaxed line-clamp-3">{n.body}</p>}
                          <p className="text-label text-subtle mt-1">
                            {kind.label} · {formatRelative(n.createdAt)}
                          </p>
                        </div>
                        {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" aria-label="Belum dibaca" />}
                      </div>
                    );

                    return (
                      <li key={n._id}>
                        {showGroup && (
                          <p className="px-3 pt-3 pb-1 text-label font-medium text-subtle">{group}</p>
                        )}
                        {n.href ? (
                          <Link
                            href={n.href}
                            onClick={() => {
                              if (!n.isRead) void markOne(n._id);
                              setOpen(false);
                            }}
                            className="block"
                          >
                            {content}
                          </Link>
                        ) : (
                          <button onClick={() => void markOne(n._id)} className="block w-full text-left cursor-pointer">
                            {content}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loading && items.length < total && (
                <div className="p-1">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full h-10 rounded-full bg-background-secondary-default text-body-sm font-medium text-heading hover:bg-background-secondary-hover transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {loadingMore ? "Memuat…" : "Muat notifikasi sebelumnya"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </SheetPortal>
      )}
    </div>
  );
}

/**
 * On phones the panel is a bottom sheet and must escape the header: a sticky
 * header with a backdrop blur becomes the containing block for `fixed`
 * children, which would pin the sheet to the header instead of the screen.
 */
function SheetPortal({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return enabled ? <Portal>{children}</Portal> : <>{children}</>;
}
