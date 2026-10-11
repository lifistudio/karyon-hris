"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, SwitchCamera, X } from "@/components/icons";
import { Alert, Button } from "@/components/ui";

/**
 * Webcam selfie capture for attendance.
 *
 * The stream is stopped on every exit path — unmount, capture, retake, or a
 * failed start — because a camera light left on after the user has finished is
 * both alarming and a real privacy problem on shared devices.
 */
export function SelfieCapture({
  photo,
  onCapture,
  onClear,
  disabled,
  autoStart,
  idleHint = "Kamera belum aktif. Foto selfie dipakai untuk memverifikasi bahwa Anda sendiri yang melakukan presensi.",
}: {
  photo: string | null;
  onCapture: (dataUrl: string) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Opens the camera on mount — for the second and later shots of a series,
   *  where permission has already been granted and a click would be busywork. */
  autoStart?: boolean;
  idleHint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  /**
   * True once the camera has been delivering frames for a moment.
   *
   * A camera reports its size as soon as it opens, but for the first few
   * hundred milliseconds most phone sensors send black or very dark frames
   * while exposure settles. Capturing then stores a black image — which, with
   * face verification on, reaches the employee as a baffling "no face found".
   */
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");

  const stop = useCallback(() => {
    setReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (mode: "user" | "environment" = facing) => {
      setError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Perangkat atau browser ini tidak mendukung akses kamera. Gunakan browser lain atau hubungi HRD."
        );
        return;
      }
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        streamRef.current = stream;
        // A camera can end on its own: the phone locks, another app takes the
        // camera, or permission is revoked mid-session. Left alone, the preview
        // freezes on a dead track and every shot is refused as a blank frame,
        // with nothing telling the user to switch the camera back on.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (streamRef.current !== stream) return;
          stop();
          setError("Kamera terputus. Nyalakan kamera lagi untuk melanjutkan.");
        });
        setActive(true);
        // Assigning after the state flip guarantees the <video> element exists.
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            void videoRef.current.play().catch(() => {});
          }
        });
      } catch (err) {
        const name = (err as DOMException).name;
        setError(
          name === "NotAllowedError"
            ? "Akses kamera ditolak. Izinkan kamera pada pengaturan situs di browser Anda, lalu coba lagi."
            : name === "NotFoundError"
              ? "Kamera tidak terdeteksi pada perangkat ini."
              : "Kamera tidak dapat dibuka. Tutup aplikasi lain yang sedang memakai kamera, lalu coba lagi."
        );
        setActive(false);
      }
    },
    [facing, stop]
  );

  useEffect(() => {
    if (autoStart && !photo && !disabled) void start();
    // Only on mount: re-running when `start` changes identity would reopen the
    // camera after the user deliberately closed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !ready) return;

    // Second line of defence behind `ready`: a camera can still hand over a
    // blank frame (lens covered, sensor stalled). Sample a thumbnail and refuse
    // one with no brightness or no detail, instead of sending it off to fail.
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 24;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    if (probeCtx) {
      probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
      const px = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0;
      let sumSq = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        sum += l;
        sumSq += l * l;
      }
      const mean = sum / n;
      const spread = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      if (mean < 12 || spread < 6) {
        setError(
          "Gambar dari kamera masih gelap atau kosong. Tunggu hingga wajah Anda terlihat jelas di layar, lalu ambil foto lagi."
        );
        return;
      }
    }
    setError("");

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (facing === "user") {
      // Un-mirror: the preview is mirrored so it feels natural, but the stored
      // evidence should match how the person actually looked.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    // 0.72 JPEG keeps a recognisable face at roughly 60–90 KB, well under the
    // upload cap even on a slow connection.
    onCapture(canvas.toDataURL("image/jpeg", 0.72));
    stop();
  };

  if (photo) {
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo}
          alt="Foto selfie presensi yang akan dikirim"
          className="w-full aspect-4/3 object-cover rounded-lg border border-line"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => {
            onClear();
            void start();
          }}
          disabled={disabled}
          className="w-full justify-center"
        >
          Ambil ulang foto
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="relative w-full aspect-4/3 rounded-lg border border-line bg-surface-2 overflow-hidden grid place-items-center">
        {active ? (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              // Frames are flowing; give exposure a moment before allowing a shot.
              onPlaying={() => {
                window.setTimeout(() => {
                  if (streamRef.current) setReady(true);
                }, 500);
              }}
              className="w-full h-full object-cover"
              style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
            />
            <button
              type="button"
              onClick={stop}
              aria-label="Tutup kamera"
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="text-center px-6">
            <Camera className="w-7 h-7 text-subtle mx-auto" />
            <p className="mt-2 text-label text-muted leading-relaxed">{idleHint}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {active ? (
          <>
            <Button
              type="button"
              icon={Camera}
              onClick={capture}
              disabled={disabled || !ready}
              className="flex-1 justify-center"
            >
              {ready ? "Ambil foto" : "Menyiapkan kamera…"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Ganti kamera depan/belakang"
              onClick={() => {
                const next = facing === "user" ? "environment" : "user";
                setFacing(next);
                void start(next);
              }}
            >
              <SwitchCamera className="w-4 h-4" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            icon={Camera}
            onClick={() => void start()}
            disabled={disabled}
            className="w-full justify-center"
          >
            Nyalakan kamera
          </Button>
        )}
      </div>
    </div>
  );
}
