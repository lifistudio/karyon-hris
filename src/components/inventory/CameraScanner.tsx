"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw } from "@/components/icons";
import { Button, ICON_STROKE, Select } from "@/components/ui";
import { decodeCode39Row } from "@/lib/barcode";

const STORAGE_KEY = "hris.inventory.camera";
const FORMATS = ["code_39", "code_128", "qr_code", "ean_13", "ean_8", "upc_a", "itf", "codabar"];

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = { new (options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
}
function store(value: string) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ }
}

/**
 * Reads asset barcodes with any camera the browser can see: laptop webcam,
 * phone front/back camera, or an external USB camera. Uses the native
 * BarcodeDetector where the browser has one (Chrome, Edge, Android) and a
 * built-in Code 39 reader everywhere else (Safari, Firefox), which is the
 * format HRIS prints on asset labels.
 */
export function CameraScanner({ onDetected, paused = false }: { onDetected: (code: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(null);
  const last = useRef<{ code: string; at: number; hits: number }>({ code: "", at: 0, hits: 0 });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const start = useCallback(async (id: string) => {
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Kamera hanya dapat dipakai lewat HTTPS (atau localhost). Gunakan scanner atau ketik kode aset.");
      return;
    }
    setState("starting");
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { deviceId: { exact: id }, width: { ideal: 1280 } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      // Labels are only readable after permission is granted.
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setDevices(list);
      const active = media.getVideoTracks()[0]?.getSettings().deviceId ?? id;
      setDeviceId(active);
      setState("live");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setState("error");
      setError(
        name === "NotAllowedError" ? "Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, lalu coba lagi."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "Kamera tidak ditemukan. Sambungkan webcam atau pilih kamera lain."
            : name === "NotReadableError" ? "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi."
              : "Kamera belum dapat dibuka."
      );
      if (id) store("");
    }
  }, [stop]);

  // Pick the engine once.
  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) { queueMicrotask(() => setEngine("Pembaca Code 39 bawaan")); return; }
    void (async () => {
      try {
        const supported = (await Ctor.getSupportedFormats?.()) ?? FORMATS;
        const formats = FORMATS.filter((f) => supported.includes(f));
        detector.current = new Ctor({ formats: formats.length ? formats : ["code_39"] });
        setEngine("Detektor barcode browser");
      } catch {
        setEngine("Pembaca Code 39 bawaan");
      }
    })();
  }, []);

  useEffect(() => {
    queueMicrotask(() => void start(readStored()));
    return stop;
  }, [start, stop]);

  // Scan loop: a few frames per second is plenty and spares phone batteries.
  useEffect(() => {
    if (state !== "live" || paused) return;
    let alive = true, busy = false;
    const tick = async () => {
      const el = video.current;
      if (!alive || busy || !el || el.readyState < 2 || !el.videoWidth) return;
      busy = true;
      try {
        const code = await readFrame(el);
        if (code) accept(code);
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 180);
    return () => { alive = false; window.clearInterval(timer); };

    async function readFrame(el: HTMLVideoElement): Promise<string | null> {
      if (detector.current) {
        try {
          const found = await detector.current.detect(el);
          if (found[0]?.rawValue) return found[0].rawValue.trim();
        } catch { /* fall through to the built-in reader */ }
      }
      const width = Math.min(960, el.videoWidth), height = Math.round((el.videoHeight / el.videoWidth) * width);
      const c = (canvas.current ??= document.createElement("canvas"));
      c.width = width; c.height = height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(el, 0, 0, width, height);
      for (const ratio of [0.5, 0.44, 0.56, 0.38, 0.62]) {
        const y = Math.round(height * ratio);
        const pixels = ctx.getImageData(0, y, width, 1).data;
        const row = new Uint8ClampedArray(width);
        for (let x = 0; x < width; x++) row[x] = (pixels[x * 4] * 299 + pixels[x * 4 + 1] * 587 + pixels[x * 4 + 2] * 114) / 1000;
        const text = decodeCode39Row(row);
        if (text) return text;
      }
      return null;
    }
    function accept(code: string) {
      const now = Date.now(), prev = last.current;
      // Two matching reads in a row filter out a misread; the same label is
      // not reported again for a few seconds.
      const hits = prev.code === code && now - prev.at < 1500 ? prev.hits + 1 : 1;
      last.current = { code, at: now, hits };
      if (hits === 2) onDetected(code);
    }
  }, [state, paused, onDetected]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-line bg-black aspect-video">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        {state === "live" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-1/3 w-4/5 rounded-md border-2 border-dashed border-white/70">
              <span className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-danger shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse" />
            </div>
          </div>
        )}
        {state !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/85">
            {state === "error" ? <CameraOff className="h-6 w-6" strokeWidth={ICON_STROKE} /> : <Camera className="h-6 w-6 animate-pulse" strokeWidth={ICON_STROKE} />}
            <p className="text-label">{state === "error" ? error : "Membuka kamera…"}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {devices.length > 1 && (
          <Select
            aria-label="Pilih kamera"
            value={deviceId}
            onChange={(e) => { store(e.target.value); void start(e.target.value); }}
            className="min-w-0 flex-1"
          >
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Kamera ${i + 1}`}</option>)}
          </Select>
        )}
        <Button type="button" size="sm" variant="secondary" icon={RefreshCw} onClick={() => void start(deviceId)}>
          {state === "error" ? "Coba lagi" : "Mulai ulang"}
        </Button>
      </div>
      <p className="text-caption text-subtle">
        Arahkan barcode label aset ke garis merah dan tahan sebentar. {engine && `Mesin: ${engine}.`} Pilihan kamera diingat di perangkat ini.
      </p>
    </div>
  );
}
