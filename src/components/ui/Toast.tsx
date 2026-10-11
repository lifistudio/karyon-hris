"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type IconComponent } from "@/components/icons";
import { ICON_STROKE } from "./index";

export type ToastTone = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  toast: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi>({
  toast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

const toneStyles: Record<
  ToastTone,
  { cls: string; Icon: IconComponent }
> = {
  success: { cls: "border-success/25 bg-success-soft text-success", Icon: CircleCheck },
  error: { cls: "border-danger/25 bg-danger-soft text-danger", Icon: CircleAlert },
  warning: { cls: "border-warning/25 bg-warning-soft text-warning", Icon: TriangleAlert },
  info: { cls: "border-info/25 bg-info-soft text-info", Icon: Info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, tone, title, description }]);
      // Errors stay longer — the user usually needs to read what went wrong.
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4200);
    },
    [dismiss]
  );

  const api: ToastApi = {
    toast,
    success: (t, d) => toast("success", t, d),
    error: (t, d) => toast("error", t, d),
    warning: (t, d) => toast("warning", t, d),
    info: (t, d) => toast("info", t, d),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed z-[100] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 pointer-events-none sm:w-96"
      >
        {items.map((t) => {
          const { cls, Icon } = toneStyles[t.tone];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex gap-3 items-start rounded-[var(--radius-control)] border p-4 animate-fade-up ${cls}`}
              style={{ boxShadow: "var(--shadow-pop)" }}
            >
              <Icon className="w-[18px] h-[18px] shrink-0 mt-px" strokeWidth={ICON_STROKE} />
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold">{t.title}</p>
                {t.description && (
                  <p className="text-body-sm mt-1 text-foreground/75 leading-relaxed break-words">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Tutup notifikasi"
                className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
