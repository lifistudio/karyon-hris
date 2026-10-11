"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "@/components/icons";

export function DocumentationCode({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Perintah disalin.");
      timer.current=setTimeout(() => setMessage(""), 2500);
    } catch { setMessage("Tidak dapat menyalin otomatis. Pilih teks lalu salin manual."); }
  }
  return <div className="max-w-3xl min-w-0 rounded-lg border border-line bg-surface-2 overflow-hidden">
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2"><span className="text-caption text-muted">Perintah</span><button type="button" onClick={() => void copy()} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-label text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary">{message === "Perintah disalin." ? <Check size={15} /> : <Copy size={15} />}Salin</button></div>
    <pre className="overflow-x-auto p-4 text-label leading-relaxed"><code className="font-mono">{text}</code></pre>
    <p role="status" aria-live="polite" className={message ? "px-4 pb-3 text-caption text-muted" : "sr-only"}>{message}</p>
  </div>;
}
