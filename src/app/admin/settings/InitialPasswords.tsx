"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, RotateCcw, Save, Shuffle } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  ICON_STROKE,
  Input,
  SkeletonList,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { ROLE_LABELS } from "@/lib/docs/roles";

interface RoleRow {
  role: string;
  mode: "fixed" | "random";
  password: string;
}

const MODE_OPTIONS = [
  { value: "fixed", label: "Kata sandi tetap", hint: "Sama untuk semua akun baru peran ini" },
  { value: "random", label: "Acak per akun", hint: "Dibuat otomatis, ditampilkan sekali saat akun dibuat" },
];

/** Client-side mirror of the server's complexity rule, for instant feedback. */
function weakness(password: string, minLength: number): string | null {
  if (password.length < minLength) return `Minimal ${minLength} karakter.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Harus memuat huruf kecil, huruf besar, dan angka.";
  }
  return null;
}

function randomPassword() {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  const chars = [lower[buf[0] % lower.length], upper[buf[1] % upper.length], digits[buf[2] % digits.length]];
  for (let i = 3; i < 12; i++) chars.push(all[buf[i] % all.length]);
  return chars.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1)).join("");
}

export function InitialPasswordsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [saved, setSaved] = useState("");
  const [minLength, setMinLength] = useState(10);
  const [forceChange, setForceChange] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{ roles: RoleRow[]; minLength: number; forceChange: boolean }>(
        "/api/v1/settings/initial-passwords"
      );
      setRows(res.data?.roles ?? []);
      setSaved(JSON.stringify(res.data?.roles ?? []));
      setMinLength(res.data?.minLength ?? 10);
      setForceChange(Boolean(res.data?.forceChange));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = saved !== "" && JSON.stringify(rows) !== saved;
  const problems = useMemo(
    () =>
      Object.fromEntries(
        rows.map((r) => [r.role, r.mode === "fixed" ? weakness(r.password, minLength) : null])
      ) as Record<string, string | null>,
    [rows, minLength]
  );
  const hasProblem = Object.values(problems).some(Boolean);

  const update = (role: string, patch: Partial<RoleRow>) =>
    setRows((prev) => prev.map((r) => (r.role === role ? { ...r, ...patch } : r)));

  const save = async () => {
    if (hasProblem) {
      toast.error("Belum bisa disimpan", "Perbaiki kata sandi yang ditandai merah.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.put("/api/v1/settings/initial-passwords", { roles: rows });
      toast.success("Tersimpan", res.message);
      setSaved(JSON.stringify(rows));
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonList rows={5} />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Kapan kata sandi awal dipakai">
        Saat HRD membuat akun login untuk karyawan baru, termasuk ketika pelamar diterima menjadi karyawan. Akun yang
        sudah ada tidak berubah. Kata sandi awal Superadmin tidak dapat diatur di sini: akun Superadmin baru selalu
        mendapat kata sandi acak.
      </Alert>

      {!forceChange && (
        <Alert tone="warning" title="Wajib ganti kata sandi sedang nonaktif">
          Karyawan dapat terus memakai kata sandi awal. Nyalakan &ldquo;Wajib ganti password saat login pertama&rdquo; di
          tab Aturan Bisnis → Keamanan, terutama bila memakai kata sandi tetap.
        </Alert>
      )}

      <Card>
        <CardHeader
          icon={KeyRound}
          title="Kata sandi awal per peran"
          description="Kata sandi tetap praktis untuk dibagikan langsung, tetapi sama untuk semua akun baru peran itu. Acak per akun lebih aman: kata sandinya muncul sekali setelah akun dibuat."
          actions={
            dirty ? (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setRows(JSON.parse(saved))} disabled={saving}>
                  Kembalikan
                </Button>
                <Button size="sm" icon={Save} loading={saving} onClick={save}>
                  Simpan
                </Button>
              </div>
            ) : undefined
          }
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((r) => {
              const problem = problems[r.role];
              const shown = revealed[r.role];
              return (
                <li key={r.role} className="px-5 py-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)] xl:grid-cols-[160px_220px_minmax(0,1fr)] sm:items-start">
                  <div className="pt-2 sm:row-span-2 xl:row-span-1">
                    <p className="text-body font-semibold text-heading">{ROLE_LABELS[r.role] ?? r.role}</p>
                    <p className="text-caption text-subtle font-mono">{r.role}</p>
                  </div>
                  <Combobox
                    value={r.mode}
                    onChange={(v) =>
                      update(r.role, {
                        mode: v as RoleRow["mode"],
                        password: v === "fixed" && !r.password ? randomPassword() : r.password,
                      })
                    }
                    options={MODE_OPTIONS}
                    aria-label={`Mode kata sandi awal ${r.role}`}
                  />
                  {r.mode === "fixed" ? (
                    <div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={shown ? "text" : "password"}
                            value={r.password}
                            autoComplete="new-password"
                            aria-label={`Kata sandi awal ${r.role}`}
                            aria-invalid={Boolean(problem)}
                            className={cn("pr-10 font-mono", problem && "border-danger")}
                            onChange={(e) => update(r.role, { password: e.target.value })}
                          />
                          <button
                            type="button"
                            onClick={() => setRevealed((p) => ({ ...p, [r.role]: !shown }))}
                            aria-label={shown ? "Sembunyikan" : "Tampilkan"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-subtle hover:text-foreground cursor-pointer"
                          >
                            {shown ? (
                              <EyeOff className="w-4 h-4" strokeWidth={ICON_STROKE} />
                            ) : (
                              <Eye className="w-4 h-4" strokeWidth={ICON_STROKE} />
                            )}
                          </button>
                        </div>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Buat kata sandi acak"
                          title="Buat kata sandi acak"
                          onClick={() => {
                            update(r.role, { password: randomPassword() });
                            setRevealed((p) => ({ ...p, [r.role]: true }));
                          }}
                        >
                          <Shuffle className="w-4 h-4" strokeWidth={ICON_STROKE} />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label="Salin"
                          title="Salin"
                          onClick={() => {
                            void navigator.clipboard?.writeText(r.password);
                            toast.success("Disalin", `Kata sandi awal ${r.role} disalin.`);
                          }}
                        >
                          <Copy className="w-4 h-4" strokeWidth={ICON_STROKE} />
                        </Button>
                      </div>
                      {problem && <p className="mt-1.5 text-label text-danger">{problem}</p>}
                    </div>
                  ) : (
                    <p className="pt-2 text-body-sm text-muted">
                      <Badge tone="success">Lebih aman</Badge>{" "}
                      Kata sandi dibuat saat akun dibuat dan ditampilkan sekali kepada pembuat akun.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
