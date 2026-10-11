"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "@/components/icons";
import { AuthShell, PasswordInput } from "@/components/auth/AuthShell";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/ui/Toast";

type Step = "request" | "verify" | "done";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<null>("/api/v1/auth/forgot-password", { email: email.trim() });
      toast.info("Kode dikirim", res.message);
      setStep("verify");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Checked client-side purely for a faster correction; the server enforces
    // the real policy.
    if (password !== confirm) {
      setError("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/api/v1/auth/reset-password", {
        email: email.trim(),
        code: code.trim(),
        newPassword: password,
      });
      setStep("done");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <AuthShell title="Kata sandi diperbarui" subtitle="Anda sudah bisa masuk dengan kata sandi baru.">
        <div className="text-center py-2">
          <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
          <p className="mt-4 text-label text-muted leading-relaxed">
            Demi keamanan, kami mengirim pemberitahuan ke email Anda. Jika perubahan ini bukan Anda
            yang melakukan, segera hubungi HRD.
          </p>
          <Button className="w-full justify-center mt-6" onClick={() => router.push("/auth/login")}>
            Masuk sekarang
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={step === "request" ? "Lupa kata sandi" : "Masukkan kode verifikasi"}
      subtitle={
        step === "request"
          ? "Kami akan mengirim kode verifikasi 6 angka ke email Anda."
          : `Kode dikirim ke ${email}. Berlaku 10 menit dan hanya bisa dipakai sekali.`
      }
      footer={
        <Link href="/auth/login" className="font-semibold text-primary hover:underline">
          Kembali ke halaman masuk
        </Link>
      }
    >
      {step === "request" ? (
        <form onSubmit={requestCode} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email terdaftar" htmlFor="fp-email" required>
            <Input
              id="fp-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@perusahaan.com"
            />
          </Field>
          <Button type="submit" loading={loading} className="w-full justify-center" size="lg">
            Kirim kode verifikasi
          </Button>
        </form>
      ) : (
        <form onSubmit={resetPassword} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="Kode verifikasi" htmlFor="fp-code" required>
            <Input
              id="fp-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="text-center text-title-sm tracking-[0.5em] font-semibold"
            />
          </Field>

          <Field
            label="Kata sandi baru"
            htmlFor="fp-pass"
            required
            hint="Minimal 10 karakter, memuat huruf besar, huruf kecil, dan angka."
          >
            <PasswordInput
              id="fp-pass"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="••••••••••"
            />
          </Field>

          <Field label="Ulangi kata sandi baru" htmlFor="fp-confirm" required>
            <PasswordInput
              id="fp-confirm"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              placeholder="••••••••••"
            />
          </Field>

          <Button type="submit" loading={loading} className="w-full justify-center" size="lg">
            Simpan kata sandi baru
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep("request");
              setCode("");
              setError("");
            }}
            className="w-full text-label text-muted hover:text-foreground cursor-pointer"
          >
            Salah email atau kode tidak kunjung tiba? Kirim ulang
          </button>
        </form>
      )}
    </AuthShell>
  );
}
