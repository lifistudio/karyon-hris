"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Crosshair, MapPin, RefreshCw, TriangleAlert } from "@/components/icons";
import { Alert, Button, cn } from "@/components/ui";

export interface GeoState {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Acquires and displays the device location for attendance.
 *
 * `enableHighAccuracy` is on because a 2 km cell-tower fix would fail every
 * geofence; accuracy is surfaced to the user so a poor fix is visibly the
 * device's fault rather than a mysterious rejection.
 */
export function GeoStatus({
  value,
  onChange,
  autoStart = true,
}: {
  value: GeoState | null;
  onChange: (v: GeoState | null) => void;
  autoStart?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [address, setAddress] = useState("");

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Browser ini tidak mendukung deteksi lokasi. Gunakan browser lain.");
      return;
    }
    setLoading(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        onChange(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu tekan Perbarui."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Lokasi tidak dapat ditentukan. Pastikan GPS aktif dan Anda tidak berada di area tanpa sinyal."
              : "Deteksi lokasi memakan waktu terlalu lama. Coba lagi di dekat jendela atau area terbuka."
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }, [onChange]);

  useEffect(() => {
    if (autoStart) locate();
    // Runs once on mount; re-running on every `locate` identity change would
    // re-prompt the user repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse geocoding is a convenience only — a failure never blocks attendance.
  useEffect(() => {
    if (!value) {
      setAddress("");
      return;
    }
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${value.lat}&lon=${value.lng}&zoom=17`,
          { signal: controller.signal, headers: { Accept: "application/json" } }
        );
        const data = (await res.json()) as { display_name?: string };
        if (data.display_name) setAddress(data.display_name);
      } catch {
        /* offline or blocked — the coordinates alone are enough */
      }
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [value]);

  const accuracyTone = !value
    ? "neutral"
    : value.accuracy <= 30
      ? "good"
      : value.accuracy <= 100
        ? "fair"
        : "poor";

  return (
    <div className="space-y-2.5">
      {error && (
        <Alert tone="danger">
          {error}
        </Alert>
      )}

      <div className="rounded-lg border border-line bg-surface-2 p-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid place-items-center w-8 h-8 rounded-lg shrink-0",
              value ? "bg-success-soft text-success" : "bg-surface text-subtle"
            )}
          >
            <MapPin className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            {value ? (
              <>
                <p className="text-label font-semibold tabular-nums">
                  {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
                </p>
                <p className="text-label text-muted mt-0.5 leading-relaxed line-clamp-2">
                  {address || "Mengambil nama lokasi…"}
                </p>
              </>
            ) : (
              <p className="text-label text-muted">
                {loading ? "Mendeteksi lokasi Anda…" : "Lokasi belum terdeteksi."}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Perbarui lokasi"
            onClick={locate}
            loading={loading}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {value && (
          <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 text-caption">
            <Crosshair className="w-3.5 h-3.5 text-subtle shrink-0" />
            <span className="text-muted">Akurasi perangkat</span>
            <span
              className={cn(
                "font-semibold tabular-nums ml-auto",
                accuracyTone === "good" && "text-success",
                accuracyTone === "fair" && "text-warning",
                accuracyTone === "poor" && "text-danger"
              )}
            >
              ±{value.accuracy} m
            </span>
          </div>
        )}
      </div>

      {accuracyTone === "poor" && (
        <Alert tone="warning">
          <span className="flex items-start gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Akurasi GPS lemah (±{value?.accuracy} m). Sistem mungkin menganggap Anda di luar radius
              kantor. Dekati jendela atau area terbuka lalu tekan Perbarui sebelum absen.
            </span>
          </span>
        </Alert>
      )}
    </div>
  );
}
