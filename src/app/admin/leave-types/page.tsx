"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarHeart, Pencil, Plus, Trash2 } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  PageHeader,
  SkeletonList,
  Textarea,
  Toggle,
  cn,
  type BadgeTone,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { QUOTA_MODE_LABELS, describeQuota, type LeaveQuotaMode } from "@/lib/hr/leave-policy";

interface LeaveTypeRow {
  _id?: string;
  name: string;
  description: string;
  quotaMode: LeaveQuotaMode;
  quotaDays: number;
  accrualMode: "prorata" | "flat";
  carryOverMaxDays: number;
  maxConsecutiveDays: number;
  maxEventsPerYear: number;
  requiresEvidence: boolean;
  minLeadDays: number;
  allowsRemoteAttendance: boolean;
  genderRestriction: "any" | "male" | "female";
  isOther: boolean;
  isActive: boolean;
  colorTone: BadgeTone;
  sortOrder: number;
  requestCount?: number;
}

const EMPTY: LeaveTypeRow = {
  name: "",
  description: "",
  quotaMode: "per_event",
  quotaDays: 3,
  accrualMode: "flat",
  carryOverMaxDays: 0,
  maxConsecutiveDays: 0,
  maxEventsPerYear: 0,
  requiresEvidence: false,
  minLeadDays: 0,
  allowsRemoteAttendance: false,
  genderRestriction: "any",
  isOther: false,
  isActive: true,
  colorTone: "primary",
  sortOrder: 100,
};

const MODE_OPTIONS: Array<{ value: LeaveQuotaMode; label: string; hint: string }> = [
  { value: "annual", label: "Saldo tahunan", hint: "Contoh: cuti tahunan 12 hari per tahun" },
  { value: "per_event", label: "Per kejadian", hint: "Contoh: menikah, keluarga meninggal — berlaku setiap kali terjadi" },
  { value: "none", label: "Tanpa kuota", hint: "Contoh: sakit dengan surat dokter, WFH, keperluan lain" },
];

const TONES: BadgeTone[] = ["primary", "success", "warning", "danger", "info", "neutral"];

export default function LeaveTypesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<LeaveTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<LeaveTypeRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LeaveTypeRow | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<LeaveTypeRow[]>("/api/v1/leave/types");
      setRows(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!removeTarget?._id) return;
    try {
      const res = await api.delete(`/api/v1/leave/types?id=${removeTarget._id}`);
      toast.success("Selesai", res.message);
      setRemoveTarget(null);
      void load();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    }
  };

  const groups = useMemo(
    () =>
      (["annual", "per_event", "none"] as LeaveQuotaMode[]).map((mode) => ({
        mode,
        items: rows.filter((r) => r.quotaMode === mode),
      })),
    [rows]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Jenis izin & cuti"
        description="Atur jenis yang bisa diajukan karyawan dan bagaimana kuotanya dihitung. Perubahan berlaku untuk pengajuan berikutnya."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ ...EMPTY })}>
            Tambah jenis
          </Button>
        }
      />

      <Alert tone="info" title="Tiga cara menghitung kuota" className="mb-6">
        <ul className="mt-1 space-y-1 list-disc pl-4">
          <li>
            <strong>Saldo tahunan</strong>: jatah hari per tahun yang berkurang setiap dipakai.
          </li>
          <li>
            <strong>Per kejadian</strong>: batas hari untuk setiap peristiwa. Izin menikah 3 hari berarti 3 hari untuk satu
            pernikahan; bila terjadi lagi, karyawan mengajukan lagi. Bisa dibatasi jumlah kejadian per tahun.
          </li>
          <li>
            <strong>Tanpa kuota</strong>: tidak ada jatah, hanya batas hari per pengajuan bila diisi.
          </li>
        </ul>
      </Alert>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading ? (
        <SkeletonList rows={6} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarHeart} title="Belum ada jenis izin/cuti" />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.mode}>
                <h2 className="eyebrow mb-2">{QUOTA_MODE_LABELS[g.mode]}</h2>
                <Card>
                  <ul className="divide-y divide-[var(--border)]">
                    {g.items.map((t) => (
                      <li key={t._id} className={cn("px-5 py-4 flex items-start gap-4", !t.isActive && "opacity-60")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-body font-semibold text-heading">{t.name}</p>
                            <Badge tone={t.colorTone}>{QUOTA_MODE_LABELS[t.quotaMode]}</Badge>
                            {t.isOther && <Badge tone="neutral">Keperluan diisi karyawan</Badge>}
                            {t.requiresEvidence && <Badge tone="warning">Perlu bukti</Badge>}
                            {t.allowsRemoteAttendance && <Badge tone="info">Boleh absen di luar kantor</Badge>}
                            {t.genderRestriction !== "any" && (
                              <Badge tone="neutral">{t.genderRestriction === "female" ? "Perempuan" : "Laki-laki"}</Badge>
                            )}
                            {!t.isActive && <Badge tone="danger">Nonaktif</Badge>}
                          </div>
                          <p className="mt-1 text-body-sm text-muted leading-relaxed">{describeQuota(t)}</p>
                          <p className="mt-0.5 text-label text-subtle">
                            {t.minLeadDays > 0 ? `Diajukan minimal H-${t.minLeadDays}. ` : ""}
                            {t.requestCount ? `${t.requestCount} pengajuan tercatat.` : "Belum pernah dipakai."}
                          </p>
                        </div>
                        <div className="flex shrink-0">
                          <Button variant="ghost" size="icon" aria-label={`Ubah ${t.name}`} onClick={() => setEditing({ ...t })}>
                            <Pencil className="w-4 h-4" strokeWidth={ICON_STROKE} />
                          </Button>
                          {t.isActive && (
                            <Button variant="ghost" size="icon" aria-label={`Hapus ${t.name}`} onClick={() => setRemoveTarget(t)}>
                              <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            ))}
        </div>
      )}

      {editing && (
        <LeaveTypeForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={remove}
        title={`Hapus ${removeTarget?.name ?? ""}?`}
        message={
          removeTarget?.requestCount
            ? "Jenis ini sudah pernah dipakai, jadi akan dinonaktifkan: tidak muncul lagi di formulir, tetapi riwayat pengajuannya tetap utuh."
            : "Jenis ini belum pernah dipakai dan akan dihapus permanen."
        }
        confirmLabel={removeTarget?.requestCount ? "Nonaktifkan" : "Hapus"}
      />
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 0)}
        className="pr-16 tabular-nums"
      />
      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-label text-subtle pointer-events-none">{suffix}</span>
    </div>
  );
}

function LeaveTypeForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: LeaveTypeRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<LeaveTypeRow>(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<LeaveTypeRow>) => setF((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const { _id, requestCount: _rc, ...rest } = f;
      void _rc;
      const payload = _id ? { id: _id, ...rest } : rest;
      const res = _id ? await api.patch("/api/v1/leave/types", payload) : await api.post("/api/v1/leave/types", payload);
      toast.success("Tersimpan", res.message);
      onSaved();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial._id ? `Ubah ${initial.name}` : "Tambah jenis izin/cuti"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} onClick={save} disabled={f.name.trim().length < 3}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nama" required htmlFor="lt-name" className="sm:col-span-2">
            <Input id="lt-name" maxLength={60} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Contoh: Izin Khitanan Anak" />
          </Field>
          <Field label="Keterangan untuk karyawan" htmlFor="lt-desc" className="sm:col-span-2">
            <Textarea id="lt-desc" rows={2} maxLength={300} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Cara menghitung kuota" htmlFor="lt-mode" className="sm:col-span-2">
            <Combobox id="lt-mode" value={f.quotaMode} onChange={(v) => set({ quotaMode: v as LeaveQuotaMode })} options={MODE_OPTIONS} />
          </Field>

          {f.quotaMode !== "none" && (
            <Field label={f.quotaMode === "annual" ? "Saldo per tahun" : "Maksimal per kejadian"} htmlFor="lt-quota">
              <NumberInput id="lt-quota" value={f.quotaDays} onChange={(v) => set({ quotaDays: v })} suffix="hari" />
            </Field>
          )}
          {f.quotaMode === "per_event" && (
            <Field label="Batas kejadian per tahun" htmlFor="lt-events" hint="0 = tidak dibatasi.">
              <NumberInput id="lt-events" value={f.maxEventsPerYear} onChange={(v) => set({ maxEventsPerYear: v })} suffix="kali" />
            </Field>
          )}
          {f.quotaMode !== "per_event" && (
            <Field label="Maksimal per pengajuan" htmlFor="lt-max" hint="0 = tidak dibatasi.">
              <NumberInput id="lt-max" value={f.maxConsecutiveDays} onChange={(v) => set({ maxConsecutiveDays: v })} suffix="hari" />
            </Field>
          )}
          {f.quotaMode === "annual" && (
            <>
              <Field label="Karyawan baru" htmlFor="lt-accrual">
                <Combobox
                  id="lt-accrual"
                  value={f.accrualMode}
                  onChange={(v) => set({ accrualMode: v as LeaveTypeRow["accrualMode"] })}
                  options={[
                    { value: "prorata", label: "Proporsional sisa bulan", hint: "Masuk Juli dapat 6 dari 12 hari" },
                    { value: "flat", label: "Penuh sejak awal" },
                  ]}
                />
              </Field>
              <Field label="Sisa yang boleh dibawa ke tahun berikut" htmlFor="lt-carry">
                <NumberInput id="lt-carry" value={f.carryOverMaxDays} onChange={(v) => set({ carryOverMaxDays: v })} suffix="hari" />
              </Field>
            </>
          )}
          <Field label="Diajukan paling lambat" htmlFor="lt-lead" hint="Hari sebelum tanggal mulai. 0 = boleh hari itu juga.">
            <NumberInput id="lt-lead" value={f.minLeadDays} onChange={(v) => set({ minLeadDays: v })} suffix="hari" />
          </Field>
          <Field label="Khusus untuk" htmlFor="lt-gender">
            <Combobox
              id="lt-gender"
              value={f.genderRestriction}
              onChange={(v) => set({ genderRestriction: v as LeaveTypeRow["genderRestriction"] })}
              options={[
                { value: "any", label: "Semua karyawan" },
                { value: "female", label: "Perempuan" },
                { value: "male", label: "Laki-laki" },
              ]}
            />
          </Field>
          <Field label="Warna label" htmlFor="lt-tone">
            <div className="flex gap-1.5 flex-wrap">
              {TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => set({ colorTone: tone })}
                  aria-pressed={f.colorTone === tone}
                  className={cn("rounded-full p-0.5 border-2 cursor-pointer", f.colorTone === tone ? "border-primary" : "border-transparent")}
                >
                  <Badge tone={tone}>{tone}</Badge>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="pt-4 border-t border-line grid sm:grid-cols-2 gap-4">
          <Toggle checked={f.requiresEvidence} onChange={(v) => set({ requiresEvidence: v })} label="Wajib lampirkan bukti" />
          <Toggle
            checked={f.isOther}
            onChange={(v) => set({ isOther: v })}
            label="Keperluan ditulis karyawan"
            description="Untuk jenis “lainnya” yang tidak ada di daftar."
          />
          <Toggle
            checked={f.allowsRemoteAttendance}
            onChange={(v) => set({ allowsRemoteAttendance: v })}
            label="Boleh absen di luar radius kantor"
            description="Untuk WFH atau dinas luar."
          />
          <Toggle checked={f.isActive} onChange={(v) => set({ isActive: v })} label="Aktif" description="Nonaktif = tidak muncul di formulir karyawan." />
        </div>

        <Alert tone="info" title="Yang dilihat karyawan">
          {describeQuota(f)}
        </Alert>
      </div>
    </Modal>
  );
}
