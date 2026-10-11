"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, FileText, Link2, LoaderCircle, Paperclip, UploadCloud, X } from "@/components/icons";
import { cn, ICON_STROKE } from "./core";
import {
  ACCEPT_ATTR,
  ACCEPT_LABEL,
  UPLOAD_POLICY,
  formatBytes,
  linkHost,
  type AttachmentInput,
  type UploadContext,
} from "@/lib/attachments";

/** One entry as the form holds it, including uploads still in flight. */
export type AttachmentItem =
  | {
      id: string;
      kind: "file";
      name: string;
      size: number;
      status: "uploading" | "done" | "error";
      progress: number;
      token?: string;
      error?: string;
    }
  | { id: string; kind: "link"; url: string };

let counter = 0;
const nextId = () => `att-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** The error to show before submit, or null when every attachment is ready. */
export function attachmentProblem(items: AttachmentItem[]): string | null {
  if (items.some((i) => i.kind === "file" && i.status === "uploading")) {
    return "Tunggu hingga semua berkas selesai diunggah.";
  }
  if (items.some((i) => i.kind === "file" && i.status === "error")) {
    return "Ada berkas yang gagal diunggah. Hapus lalu unggah ulang berkas tersebut.";
  }
  return null;
}

/** What the API receives. Call only after `attachmentProblem` returned null. */
export function toAttachmentInputs(items: AttachmentItem[]): AttachmentInput[] {
  return items.flatMap((i): AttachmentInput[] => {
    if (i.kind === "link") return i.url.trim() ? [{ kind: "link", url: i.url.trim() }] : [];
    return i.token ? [{ kind: "file", token: i.token, name: i.name, size: i.size }] : [];
  });
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Attach a document by uploading a file or pasting a link.
 *
 * Files upload the moment they are chosen, one request each, with visible
 * progress — the form's own submit then only sends short tokens. Files can be
 * dropped onto the box on a desktop; on a phone the box is simply a button that
 * opens the file picker, which also offers the camera.
 */
export function FileOrLinkInput({
  value,
  onChange,
  context,
  multiple = false,
  maxFiles,
  allowLink = true,
  vacancySlug,
  disabled,
  id,
  invalid,
}: {
  value: AttachmentItem[];
  onChange: (next: AttachmentItem[]) => void;
  context: UploadContext;
  multiple?: boolean;
  maxFiles?: number;
  allowLink?: boolean;
  /** Set on the public career page: uploads go to the anonymous endpoint. */
  vacancySlug?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "link">("file");
  const [draftLink, setDraftLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Updates arrive from XHR callbacks long after this render, so they are
  // applied to the latest list through a ref rather than a stale closure.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const patch = (itemId: string, changes: Partial<AttachmentItem>) => {
    // Written back immediately: two progress events can land before the parent
    // re-renders, and the second must build on the first rather than undo it.
    const next = latest.current.map((i) => (i.id === itemId ? ({ ...i, ...changes } as AttachmentItem) : i));
    latest.current = next;
    onChange(next);
  };

  const limit = multiple ? (maxFiles ?? 5) : 1;
  const policy = UPLOAD_POLICY[context];
  const full = value.length >= limit;

  const upload = (file: File, itemId: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("context", context);
    if (vacancySlug) form.append("vacancySlug", vacancySlug);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", vacancySlug ? "/api/v1/public/uploads" : "/api/v1/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(itemId, { progress: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      let body: { success?: boolean; data?: { token: string }; error?: { message?: string } } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }
      if (xhr.status < 300 && body.success && body.data?.token) {
        patch(itemId, { status: "done", progress: 100, token: body.data.token });
      } else {
        patch(itemId, { status: "error", error: body.error?.message ?? "Berkas gagal diunggah." });
      }
    };
    xhr.onerror = () => patch(itemId, { status: "error", error: "Koneksi terputus saat mengunggah." });
    xhr.send(form);
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, limit - (multiple ? value.length : 0)));
    if (!list.length) return;

    const created: AttachmentItem[] = list.map((file) => {
      // Size is checked here only to save a pointless upload; the server
      // checks again, along with the real file type.
      const tooBig = file.size > policy.maxBytes;
      return {
        id: nextId(),
        kind: "file",
        name: file.name,
        size: file.size,
        status: tooBig ? "error" : "uploading",
        progress: 0,
        error: tooBig ? `Melebihi batas ${formatBytes(policy.maxBytes)}.` : undefined,
      };
    });

    const next = multiple ? [...value, ...created] : created;
    latest.current = next;
    onChange(next);
    created.forEach((item, i) => {
      if (item.kind === "file" && item.status === "uploading") upload(list[i], item.id);
    });
  };

  const addLink = () => {
    const url = draftLink.trim();
    if (!isHttpUrl(url)) {
      setLinkError("Tautan harus diawali http:// atau https://");
      return;
    }
    setLinkError("");
    const item: AttachmentItem = { id: nextId(), kind: "link", url };
    onChange(multiple ? [...value, item] : [item]);
    setDraftLink("");
  };

  const remove = (itemId: string) => onChange(value.filter((i) => i.id !== itemId));

  return (
    <div id={id} className="space-y-2.5">
      {allowLink && (
        <div role="tablist" className="inline-flex p-0.5 rounded-[var(--radius-control)] bg-surface-2 border border-line">
          {(
            [
              ["file", "Unggah berkas", UploadCloud],
              ["link", "Tempel tautan", Link2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              disabled={disabled}
              onClick={() => setMode(key)}
              className={cn(
                "h-8 px-3 inline-flex items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] text-body-sm transition-colors",
                mode === key ? "bg-surface text-foreground font-medium shadow-[0_1px_2px_rgba(20,20,43,0.08)]" : "text-muted hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
              {label}
            </button>
          ))}
        </div>
      )}

      {!full && mode === "file" && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!disabled && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 px-4 py-5 text-center cursor-pointer",
            "rounded-[var(--radius-control)] border border-dashed transition-colors",
            dragOver ? "border-primary bg-primary-soft" : invalid ? "border-danger bg-danger-soft/40" : "border-line-strong bg-surface hover:bg-surface-2",
            disabled && "opacity-55 cursor-not-allowed"
          )}
        >
          <UploadCloud className="w-6 h-6 text-primary" strokeWidth={ICON_STROKE} />
          <span className="text-body-sm text-foreground">
            <span className="font-medium text-primary">Pilih berkas</span>
            <span className="hidden sm:inline"> atau seret ke sini</span>
          </span>
          <span className="text-label text-subtle">
            {ACCEPT_LABEL[context]} · maks. {formatBytes(policy.maxBytes)}
            {multiple && ` · hingga ${limit} berkas`}
          </span>
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            className="sr-only"
            accept={ACCEPT_ATTR[context]}
            multiple={multiple}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {!full && mode === "link" && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              value={draftLink}
              disabled={disabled}
              onChange={(e) => {
                setDraftLink(e.target.value);
                setLinkError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              placeholder="https://drive.google.com/…"
              aria-invalid={Boolean(linkError) || undefined}
              className={cn(
                "flex-1 min-w-0 h-11 rounded-[var(--radius-control)] bg-surface border px-3 text-body text-foreground placeholder:text-subtle",
                "focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
                linkError ? "border-danger" : "border-line hover:border-line-strong"
              )}
            />
            <button
              type="button"
              onClick={addLink}
              disabled={disabled || !draftLink.trim()}
              className="h-11 px-4 rounded-[var(--radius-control)] bg-surface-2 border border-line text-body-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
            >
              Tambahkan
            </button>
          </div>
          {linkError ? (
            <p className="text-label text-danger">{linkError}</p>
          ) : (
            <p className="text-label text-subtle">
              Pastikan tautan dapat dibuka tanpa meminta izin akses, misalnya Google Drive dengan akses
              &ldquo;Siapa saja yang memiliki link&rdquo;.
            </p>
          )}
        </div>
      )}

      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5",
                item.kind === "file" && item.status === "error" ? "border-danger/40 bg-danger-soft/40" : "border-line bg-surface"
              )}
            >
              <span className="w-8 h-8 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-surface-2 text-muted">
                {item.kind === "link" ? (
                  <Link2 className="w-4 h-4" strokeWidth={ICON_STROKE} />
                ) : item.status === "uploading" ? (
                  <LoaderCircle className="w-4 h-4 animate-spin text-primary" strokeWidth={ICON_STROKE} />
                ) : item.status === "error" ? (
                  <AlertCircle className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                ) : (
                  <FileText className="w-4 h-4" strokeWidth={ICON_STROKE} />
                )}
              </span>

              <span className="flex-1 min-w-0">
                <span className="block text-body-sm text-foreground truncate">
                  {item.kind === "link" ? linkHost(item.url) : item.name}
                </span>
                {item.kind === "link" ? (
                  <span className="block text-label text-subtle truncate">{item.url}</span>
                ) : item.status === "error" ? (
                  <span className="block text-label text-danger">{item.error}</span>
                ) : item.status === "uploading" ? (
                  <span className="mt-1.5 block h-1 rounded-full bg-surface-2 overflow-hidden" aria-label={`Mengunggah ${item.progress}%`}>
                    <span className="block h-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} />
                  </span>
                ) : (
                  <span className="block text-label text-subtle">{formatBytes(item.size)}</span>
                )}
              </span>

              <button
                type="button"
                onClick={() => remove(item.id)}
                disabled={disabled}
                aria-label={`Hapus ${item.kind === "link" ? "tautan" : item.name}`}
                className="w-8 h-8 shrink-0 grid place-items-center rounded-[var(--radius-control)] text-subtle hover:text-danger hover:bg-danger-soft"
              >
                <X className="w-4 h-4" strokeWidth={ICON_STROKE} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {full && multiple && (
        <p className="flex items-center gap-1.5 text-label text-subtle">
          <Paperclip className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
          Batas {limit} lampiran tercapai. Hapus salah satu untuk menambah.
        </p>
      )}
    </div>
  );
}
