"use client";

import React, { Suspense, useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell, PasswordInput } from "@/components/auth/AuthShell";
import { Alert, Button, Field, Input } from "@/components/ui";

/**
 * NextAuth reports every credential failure as `CredentialsSignin`; the server
 * deliberately does not distinguish "unknown email" from "wrong password" or
 * "account locked", so the copy here has to cover all three without guessing.
 *
 * The one case it does separate is the database being unreachable, which is not
 * the user's fault and must not send them to reset a working password.
 */
function messageFor(code: string | null): string {
  if (!code) return "";
  switch (code) {
    case "db_unavailable":
      return "Server sedang tidak dapat memproses login. Coba lagi beberapa saat lagi, atau hubungi administrator bila terus berulang.";
    case "CredentialsSignin":
    case "Callback":
      return "Email atau kata sandi salah. Setelah beberapa percobaan gagal, akun akan terkunci sementara demi keamanan.";
    case "SessionRequired":
      return "Sesi Anda telah berakhir. Silakan masuk kembali.";
    case "rate_limited":
      return "Terlalu banyak percobaan masuk. Tunggu sekitar 15 menit sebelum mencoba kembali.";
    case "AccessDenied":
      return "Akun Anda tidak memiliki akses ke halaman tersebut.";
    default:
      return "Tidak dapat memproses login saat ini. Coba lagi beberapa saat lagi.";
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedRedirect = params.get("callbackUrl") ?? "";
  const callbackUrl = /^\/(?!\/)/.test(requestedRedirect) && !/[\\\x00-\x20]/.test(requestedRedirect)
    ? requestedRedirect : "/portal/attendance";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(messageFor(params.get("code") ?? params.get("error")));
  // SSO is configured at runtime (OIDC_* env), so ask the server instead of a build-time flag.
  const [ssoName, setSsoName] = useState("");
  useEffect(() => {
    getProviders().then((providers) => setSsoName(providers?.["corporate-sso"]?.name ?? "")).catch(() => setSsoName(""));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email kantor wajib diisi.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Format email kantor belum valid.");
      return;
    }
    if (!password) {
      setError("Kata sandi wajib diisi.");
      return;
    }
    setLoading(true);

    const res = await signIn("credentials", {
      redirect: false,
      email: normalizedEmail,
      password,
    }).catch(() => null);

    if (!res || res.error) {
      // Auth.js puts a custom error subclass's `code` next to the generic
      // `error`, so the specific reason is preferred when there is one.
      setError(messageFor(res?.code ?? res?.error ?? "CredentialsSignin"));
      setLoading(false);
      return;
    }

    // A full navigation rather than a soft push, so the session cookie is read
    // by the proxy before the destination renders.
    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <AuthShell
      badge="Portal Karyawan"
      title="Masuk ke akun Anda"
      subtitle="Gunakan email kantor dan kata sandi yang diberikan HRD."
      // No link to the administration panel here on purpose. Advertising it to
      // every employee invites them to try the door, and the people who need it
      // already know the address. It is not a security control by itself — the
      // panel is guarded by RBAC either way — but it removes the invitation.
      // The password-reset link lives next to the password field instead, where
      // someone who cannot get in is already looking.
      footer={
        <>
          Belum punya akun? Akun dibuatkan HRD saat Anda bergabung. Hubungi HRD
          bila belum menerimanya.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@perusahaan.com"
          />
        </Field>

        <Field label="Kata sandi" htmlFor="password" required>
          <PasswordInput id="password" value={password} onChange={setPassword} placeholder="••••••••" />
        </Field>

        <div className="flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="text-caption font-semibold text-primary hover:underline"
          >
            Lupa kata sandi?
          </Link>
        </div>

        <Button type="submit" loading={loading} className="w-full justify-center" size="lg">
          {loading ? "Memverifikasi…" : "Masuk"}
        </Button>
        {ssoName && <Button type="button" variant="secondary" className="w-full justify-center" size="lg" onClick={() => signIn("corporate-sso", { redirectTo: callbackUrl })}>Masuk dengan {ssoName}</Button>}
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center bg-background">
          <div className="skeleton w-64 h-40 rounded-xl" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
