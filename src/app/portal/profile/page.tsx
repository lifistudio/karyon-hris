"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSignature } from "@/components/icons";
import { MyContracts } from "@/components/portal/MyContracts";
import { useSession, signOut } from "next-auth/react";
import { Briefcase, Building2, IdCard, KeyRound, Landmark, Mail, Save, ScanFace, ShieldCheck, UserRound } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  SkeletonList,
  Tabs,
} from "@/components/ui";
import { PasswordInput } from "@/components/auth/AuthShell";
import { FaceEnrollment } from "@/components/portal/FaceEnrollment";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/time";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/hr/labels";

interface Profile {
  _id: string;
  employeeId: string;
  name: string;
  nik: string;
  npwp: string;
  birthPlace: string;
  birthDate?: string;
  gender?: string;
  religion: string;
  maritalStatus: string;
  taxStatus: string;
  bpjsKesehatan: string;
  bpjsKetenagakerjaan: string;
  personalEmail: string;
  officeEmail: string;
  phone: string;
  photoUrl: string;
  isPiiMasked: boolean;
  ktpAddress?: Record<string, string>;
  domicileAddress?: Record<string, string>;
  socialMedia?: Record<string, string>;
  bankAccount?: { bankName: string; accountNumber: string; accountHolder: string };
  branchId?: { name: string } | null;
  divisionId?: { name: string } | null;
  positionId?: { name: string } | null;
  supervisorId?: { name: string; employeeId: string } | null;
  joinDate?: string;
  employmentStatus: string;
  status: string;
}

export default function ProfilePageWrapper() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <ProfilePage />
    </Suspense>
  );
}

function ProfilePage() {
  const { data: session } = useSession();
  const params = useSearchParams();
  const forced = params.get("force_password") === "1";
  // `?tab=face` is where the attendance page and face notifications send people.
  const requestedTab = params.get("tab");
  const initialTab = forced
    ? "security"
    : requestedTab === "face" || requestedTab === "contract"
      ? requestedTab
      : "profile";

  const [tab, setTab] = useState<"profile" | "security" | "face" | "contract">(initialTab);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const employeeId = session?.user?.employeeId;

  const load = useCallback(async () => {
    if (!employeeId) {
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await api.get<Profile>(`/api/v1/employees/${employeeId}`);
      setProfile(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-52" />
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Profil &amp; keamanan</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Perbarui data kontak, kelola kata sandi, dan lihat kontrak kerja Anda.
        </p>
      </header>

      {forced && (
        <Alert tone="warning" title="Anda wajib mengganti kata sandi terlebih dahulu">
          Akun Anda masih memakai kata sandi awal dari HRD. Ganti kata sandi sekarang untuk membuka
          akses ke seluruh menu sistem.
        </Alert>
      )}

      {error && <ErrorState message={error} onRetry={load} />}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "profile", label: "Data diri", icon: UserRound },
          { id: "security", label: "Keamanan akun", icon: ShieldCheck },
          // Face enrolment belongs to an employee record; admin-only accounts
          // have no attendance to verify.
          ...(employeeId ? [{ id: "face" as const, label: "Wajah presensi", icon: ScanFace }] : []),
          ...(employeeId ? [{ id: "contract" as const, label: "Kontrak kerja", icon: FileSignature }] : []),
        ]}
      />

      {tab === "contract" && employeeId ? (
        <MyContracts />
      ) : tab === "face" && employeeId ? (
        <FaceEnrollment />
      ) : tab === "profile" ? (
        !employeeId ? (
          <Card>
            <CardBody>
              <Alert tone="info" title="Akun administrasi">
                Akun ini tidak tertaut ke data karyawan, sehingga tidak memiliki profil kepegawaian.
                Anda tetap dapat mengganti kata sandi di tab Keamanan Akun.
              </Alert>
            </CardBody>
          </Card>
        ) : profile ? (
          <ProfileTab profile={profile} onSaved={load} />
        ) : null
      ) : (
        <SecurityTab
          onChanged={async () => {
            // Password changes revoke existing sessions, including this one.
            await signOut({ callbackUrl: "/auth/login" });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProfileTab({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [personalEmail, setPersonalEmail] = useState(profile.personalEmail ?? "");
  const [domicile, setDomicile] = useState({
    street: profile.domicileAddress?.street ?? "",
    subdistrict: profile.domicileAddress?.subdistrict ?? "",
    city: profile.domicileAddress?.city ?? "",
    province: profile.domicileAddress?.province ?? "",
    country: profile.domicileAddress?.country ?? "Indonesia",
  });
  const [social, setSocial] = useState<Record<string, string>>({
    linkedIn: profile.socialMedia?.linkedIn ?? "",
    instagram: profile.socialMedia?.instagram ?? "",
    whatsApp: profile.socialMedia?.whatsApp ?? "",
    website: profile.socialMedia?.website ?? "",
  });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.patch(`/api/v1/employees/${profile._id}`, {
        phone: phone.trim() || undefined,
        personalEmail: personalEmail.trim(),
        domicileAddress: domicile,
        socialMedia: social,
      });
      toast.success("Profil diperbarui", res.message);
      onSaved();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr] items-start">
      {/* Read-only identity summary */}
      <div className="space-y-6">
        <Card>
          <CardBody className="text-center">
            <span className="inline-grid place-items-center w-20 h-20 rounded-2xl bg-primary-soft text-primary text-title font-semibold mb-3">
              {profile.name
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </span>
            <h2 className="text-body-lg font-semibold">{profile.name}</h2>
            <p className="text-label text-muted mt-0.5">{profile.positionId?.name ?? "Jabatan belum diatur"}</p>
            <p className="text-caption font-mono text-subtle mt-1">{profile.employeeId}</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
              <Badge tone={profile.status === "active" ? "success" : "info"}>
                {EMPLOYEE_STATUS_LABELS[profile.status] ?? profile.status}
              </Badge>
              <Badge tone="neutral">
                {EMPLOYMENT_STATUS_LABELS[profile.employmentStatus] ?? profile.employmentStatus}
              </Badge>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={Briefcase} title="Penempatan" />
          <CardBody className="space-y-3">
            <ReadRow icon={Building2} label="Cabang" value={profile.branchId?.name} />
            <ReadRow icon={Briefcase} label="Divisi" value={profile.divisionId?.name} />
            <ReadRow
              icon={UserRound}
              label="Atasan langsung"
              value={profile.supervisorId?.name}
            />
            <ReadRow icon={Mail} label="Email kantor" value={profile.officeEmail} />
            <ReadRow
              icon={IdCard}
              label="Tanggal masuk"
              value={profile.joinDate ? formatDate(profile.joinDate) : undefined}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={Landmark} title="Data administratif" description="Hanya dapat diubah oleh HRD." />
          <CardBody className="space-y-3">
            <ReadRow icon={IdCard} label="NIK (KTP)" value={profile.nik} mono />
            <ReadRow icon={IdCard} label="NPWP" value={profile.npwp} mono />
            <ReadRow icon={IdCard} label="Status pajak" value={profile.taxStatus} />
            <ReadRow icon={Landmark} label="BPJS Kesehatan" value={profile.bpjsKesehatan} mono />
            <ReadRow icon={Landmark} label="BPJS Ketenagakerjaan" value={profile.bpjsKetenagakerjaan} mono />
            <ReadRow
              icon={Landmark}
              label="Rekening"
              value={
                profile.bankAccount?.accountNumber
                  ? `${profile.bankAccount.bankName} — ${profile.bankAccount.accountNumber}`
                  : undefined
              }
              mono
            />
          </CardBody>
        </Card>
      </div>

      {/* Editable */}
      <Card>
        <CardHeader
          icon={UserRound}
          title="Data yang dapat Anda ubah sendiri"
          description="Perubahan NIK, NPWP, dan rekening harus melalui HRD demi validitas data payroll."
          actions={
            <Button size="sm" icon={Save} type="submit" form="profile-form" loading={saving}>
              Simpan
            </Button>
          }
        />
        <CardBody>
          <form id="profile-form" onSubmit={save} className="space-y-6">
            <section className="space-y-4">
              <h3 className="eyebrow">Kontak</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Nomor HP / WhatsApp" htmlFor="pf-phone">
                  <Input
                    id="pf-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                  />
                </Field>
                <Field label="Email pribadi" htmlFor="pf-email" hint="Dipakai untuk kode verifikasi bila email kantor tidak dapat diakses.">
                  <Input
                    id="pf-email"
                    type="email"
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                    placeholder="nama@gmail.com"
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="eyebrow">
                Alamat domisili saat ini
              </h3>
              <Field label="Jalan / nomor rumah" htmlFor="pf-street">
                <Input
                  id="pf-street"
                  value={domicile.street}
                  onChange={(e) => setDomicile({ ...domicile, street: e.target.value })}
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Kecamatan" htmlFor="pf-sub">
                  <Input
                    id="pf-sub"
                    value={domicile.subdistrict}
                    onChange={(e) => setDomicile({ ...domicile, subdistrict: e.target.value })}
                  />
                </Field>
                <Field label="Kota / kabupaten" htmlFor="pf-city">
                  <Input
                    id="pf-city"
                    value={domicile.city}
                    onChange={(e) => setDomicile({ ...domicile, city: e.target.value })}
                  />
                </Field>
                <Field label="Provinsi" htmlFor="pf-prov">
                  <Input
                    id="pf-prov"
                    value={domicile.province}
                    onChange={(e) => setDomicile({ ...domicile, province: e.target.value })}
                  />
                </Field>
                <Field label="Negara" htmlFor="pf-country">
                  <Input
                    id="pf-country"
                    value={domicile.country}
                    onChange={(e) => setDomicile({ ...domicile, country: e.target.value })}
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="eyebrow">
                Media sosial (opsional)
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {(
                  [
                    ["linkedIn", "LinkedIn"],
                    ["instagram", "Instagram"],
                    ["whatsApp", "WhatsApp"],
                    ["website", "Website pribadi"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={`pf-${key}`}>
                    <Input
                      id={`pf-${key}`}
                      value={social[key] ?? ""}
                      onChange={(e) => setSocial({ ...social, [key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            </section>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function ReadRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-3.5 h-3.5 text-subtle shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-subtle">{label}</p>
        <p className={`text-label mt-0.5 break-words ${mono ? "font-mono" : ""} ${value ? "" : "text-subtle italic"}`}>
          {value || "Belum diisi"}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SecurityTab({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");

  const requestOtp = async () => {
    setLoading(true);
    try {
      const res = await api.post<{ email: string }>("/api/v1/auth/change-password-verify");
      setMaskedEmail(res.data?.email ?? "");
      toast.info("Kode dikirim", res.message);
      setStep("verify");
    } catch (err) {
      toast.error("Gagal mengirim kode", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.error("Konfirmasi tidak cocok", "Kata sandi baru dan konfirmasinya harus sama.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/api/v1/auth/change-password", {
        currentPassword,
        code: code.trim(),
        newPassword,
      });
      toast.success("Kata sandi diganti", res.message);
      onChanged();
    } catch (err) {
      toast.error("Gagal mengganti kata sandi", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <Card>
        <CardHeader
          icon={KeyRound}
          title="Ganti kata sandi"
          description="Diverifikasi dengan kata sandi lama dan kode yang dikirim ke email Anda."
        />
        <CardBody>
          {step === "request" ? (
            <div className="space-y-4">
              <Alert tone="info">
                Kami akan mengirim kode verifikasi 6 angka ke email akun Anda. Kode berlaku 10 menit.
              </Alert>
              <Button onClick={requestOtp} loading={loading} className="w-full justify-center" size="lg">
                Kirim kode verifikasi
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {maskedEmail && (
                <Alert tone="success">Kode verifikasi telah dikirim ke {maskedEmail}.</Alert>
              )}

              <Field label="Kata sandi saat ini" required htmlFor="sec-current">
                <PasswordInput
                  id="sec-current"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder="••••••••"
                />
              </Field>

              <Field label="Kode verifikasi" required htmlFor="sec-code">
                <Input
                  id="sec-code"
                  inputMode="numeric"
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
                required
                htmlFor="sec-new"
                hint="Minimal 10 karakter, memuat huruf besar, huruf kecil, dan angka."
              >
                <PasswordInput
                  id="sec-new"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                />
              </Field>

              <Field
                label="Ulangi kata sandi baru"
                required
                htmlFor="sec-confirm"
                error={confirm && confirm !== newPassword ? "Konfirmasi belum cocok." : undefined}
              >
                <PasswordInput
                  id="sec-confirm"
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
                onClick={() => setStep("request")}
                className="w-full text-label text-muted hover:text-foreground cursor-pointer"
              >
                Kode tidak diterima? Kirim ulang
              </button>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={ShieldCheck} title="Tips menjaga keamanan akun" />
        <CardBody>
          <ul className="space-y-3 text-label text-muted leading-relaxed">
            <Tip>
              Jangan pernah membagikan kata sandi atau kode verifikasi kepada siapa pun, termasuk
              yang mengaku sebagai staf HRD atau IT.
            </Tip>
            <Tip>
              Gunakan kata sandi yang berbeda dari akun lain. Kebocoran di layanan lain tidak boleh
              ikut membuka akun HRIS Anda.
            </Tip>
            <Tip>
              Akun terkunci sementara setelah beberapa kali gagal login. Bila terkunci, tunggu
              beberapa menit atau gunakan menu Lupa Kata Sandi.
            </Tip>
            <Tip>
              Seluruh aktivitas login, persetujuan, dan akses slip gaji tercatat di log audit dan
              dapat ditelusuri bila terjadi penyalahgunaan.
            </Tip>
            <Tip>
              Selalu keluar dari akun setelah memakai perangkat bersama, terutama komputer kantor
              yang dipakai bergantian.
            </Tip>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
