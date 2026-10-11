"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, Coffee, FileClock, History, LogIn, LogOut, Plus, Utensils, ScanFace } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  StatusBadge,
  Tabs,
  Td,
  TableWrap,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";
import Link from "next/link";
import { BirthdayPanel } from "@/components/BirthdayPanel";
import { SelfieCapture } from "@/components/portal/SelfieCapture";
import { GeoStatus, type GeoState } from "@/components/portal/GeoStatus";
import { useToast } from "@/components/ui/Toast";
import {
  FileOrLinkInput,
  attachmentProblem,
  toAttachmentInputs,
  type AttachmentItem,
} from "@/components/ui/FileOrLinkInput";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateLong, formatTime, wibDateKey, timezoneAbbr } from "@/lib/time";
import { CORRECTION_REASON_LABELS } from "@/lib/hr/labels";

import { DatePicker } from "@/components/ui/DatePicker";
type Action = "clock_in" | "break_out" | "break_in" | "clock_out";

interface AttendanceLog {
  _id: string;
  date: string;
  clockIn?: string;
  breakOut?: string;
  breakIn?: string;
  clockOut?: string;
  isLate: boolean;
  lateMinutes: number;
  isEarlyLeave?: boolean;
  earlyLeaveMinutes?: number;
  isCrossBranch?: boolean;
  isLocationOverride?: boolean;
  needsReview?: boolean;
  distanceMeter?: number;
  note?: string;
  photoUrl?: string[];
}

interface AttendanceSettings {
  face_recognition_enabled: boolean;
  face_enrolled: boolean;
  require_selfie_clock_in: boolean;
  require_selfie_break_out: boolean;
  require_selfie_break_in: boolean;
  require_selfie_clock_out: boolean;
  enable_break_attendance: boolean;
  allow_location_override: boolean;
  location_override_min_note: number;
}

interface Correction {
  _id: string;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  reasonType: string;
  reasonNote: string;
  isOverQuota?: boolean;
  status: string;
  createdAt: string;
}

const STEP_META: Record<Action, { label: string; help: string; icon: React.ComponentType<{ className?: string }> }> = {
  clock_in: { label: "Absen masuk", help: "Mulai hari kerja Anda", icon: LogIn },
  break_out: { label: "Mulai istirahat", help: "Catat waktu keluar istirahat", icon: Coffee },
  break_in: { label: "Selesai istirahat", help: "Catat waktu kembali bekerja", icon: Utensils },
  clock_out: { label: "Absen pulang", help: "Akhiri hari kerja Anda", icon: LogOut },
};

export default function AttendancePage() {
  const toast = useToast();

  const [tab, setTab] = useState<"today" | "history" | "corrections">("today");
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [quota, setQuota] = useState<{ used: number; max: number; remaining: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [geo, setGeo] = useState<GeoState | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  // Opened directly from the missed clock-out reminder. Read after mount so
  // the server render and the first client render agree.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("koreksi") === "1") setCorrectionOpen(true);
  }, []);

  const todayKey = wibDateKey();

  /* ---------------------------------------------------------------- */

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [att, corr] = await Promise.all([
        api.get<{ logs: AttendanceLog[]; settings: AttendanceSettings }>("/api/v1/attendance"),
        api.get<{ corrections: Correction[]; quota: typeof quota }>("/api/v1/attendance/correction"),
      ]);
      setLogs(att.data?.logs ?? []);
      setSettings(att.data?.settings ?? null);
      setCorrections(corr.data?.corrections ?? []);
      setQuota(corr.data?.quota ?? null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "corrections") setTab("corrections");
    void load();
  }, [load]);

  const todayLog = useMemo(
    () => logs.find((l) => wibDateKey(new Date(l.date)) === todayKey) ?? null,
    [logs, todayKey]
  );

  /** The single action that makes sense right now, mirroring the server's rule. */
  const nextAction = useMemo<Action | null>(() => {
    if (!settings) return null;
    if (!todayLog?.clockIn) return "clock_in";
    if (todayLog.clockOut) return null;
    if (settings.enable_break_attendance) {
      if (!todayLog.breakOut) return "break_out";
      if (!todayLog.breakIn) return "break_in";
    }
    return "clock_out";
  }, [todayLog, settings]);

  // Mirrors the server rule: with face verification on, clocking in and out
  // always need a photo, whatever the per-step selfie settings say.
  const faceOn = Boolean(settings?.face_recognition_enabled);
  const selfieRequired =
    nextAction && settings
      ? settings[`require_selfie_${nextAction}`] ||
        (faceOn && (nextAction === "clock_in" || nextAction === "clock_out"))
      : false;
  const faceBlocked = faceOn && !settings?.face_enrolled;
  const minNote = settings?.location_override_min_note ?? 15;

  const canSubmit =
    Boolean(nextAction) &&
    Boolean(geo) &&
    !faceBlocked &&
    (!selfieRequired || Boolean(photo)) &&
    (!overrideMode || note.trim().length >= minNote);

  const submit = async (action: Action) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ attendance: AttendanceLog }>("/api/v1/attendance", {
        action,
        lat: geo!.lat,
        lng: geo!.lng,
        accuracy: geo!.accuracy,
        photo: photo ?? undefined,
        isLocationOverride: overrideMode || undefined,
        note: note.trim() || undefined,
      });
      toast.success("Presensi tercatat", res.message);
      setPhoto(null);
      setNote("");
      setOverrideMode(false);
      await load();
    } catch (err) {
      toast.error("Presensi gagal", errorMessage(err));
      // A rejected face means this photo will never pass; drop it so the next
      // attempt is a fresh shot rather than a resend of the same one.
      if (/wajah/i.test(errorMessage(err))) setPhoto(null);
    } finally {
      setSubmitting(false);
      setConfirmAction(null);
    }
  };

  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-56" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Presensi mandiri</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">{formatDateLong(todayKey)}</p>
      </header>

      {loadError && <ErrorState message={loadError} onRetry={load} />}
      <BirthdayPanel compact />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "today", label: "Hari ini", icon: Clock },
          { id: "history", label: "Riwayat bulan ini", count: logs.length, icon: History },
          { id: "corrections", label: "Koreksi absen", count: corrections.length, icon: FileClock },
        ]}
      />

      {/* ---------------- TODAY ---------------- */}
      {tab === "today" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
          <Card>
            <CardHeader
              icon={CalendarClock}
              title="Catatan presensi hari ini"
              description="Setiap tahap hanya dapat dicatat satu kali dan harus berurutan."
            />
            <CardBody className="space-y-3">
              <Timeline log={todayLog} settings={settings} nextAction={nextAction} />

              {todayLog?.needsReview && (
                <Alert tone="warning" title="Catatan ini sedang ditinjau HRD">
                  {todayLog.isLocationOverride && "Presensi tercatat di luar radius kantor melalui menu Kendala Lokasi. "}
                  {todayLog.isCrossBranch && "Presensi dilakukan di cabang lain. "}
                  Tidak ada tindakan yang perlu Anda lakukan; HRD akan memverifikasi.
                </Alert>
              )}

              {!nextAction && todayLog?.clockOut && (
                <Alert tone="success" title="Presensi hari ini lengkap">
                  Anda sudah absen pulang pukul {formatTime(todayLog.clockOut)}. Sampai jumpa besok!
                </Alert>
              )}
            </CardBody>
          </Card>

          {/* Action panel */}
          <Card>
            <CardHeader
              icon={nextAction ? STEP_META[nextAction].icon : CheckCircle2}
              title={nextAction ? STEP_META[nextAction].label : "Selesai"}
              description={nextAction ? STEP_META[nextAction].help : "Tidak ada langkah presensi tersisa hari ini."}
            />
            <CardBody className="space-y-4">
              {!nextAction ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Presensi hari ini sudah lengkap"
                  description="Butuh memperbaiki jam yang keliru? Ajukan koreksi absen."
                  action={
                    <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCorrectionOpen(true)}>
                      Ajukan koreksi absen
                    </Button>
                  }
                />
              ) : faceBlocked ? (
                <EmptyState
                  icon={ScanFace}
                  title="Daftarkan wajah untuk mulai absen"
                  description="Perusahaan mewajibkan verifikasi wajah. Setiap foto presensi dicocokkan dengan wajah yang Anda daftarkan, jadi daftarkan wajah Anda lebih dulu."
                  action={
                    <Link href="/portal/profile?tab=face">
                      <Button size="sm" icon={ScanFace}>
                        Daftarkan wajah
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <>
                  <GeoStatus value={geo} onChange={setGeo} />

                  {selfieRequired && (
                    <div>
                      <p className="text-label font-semibold mb-2">
                        Foto selfie <span className="text-danger">*</span>
                      </p>
                      {faceOn && (
                        <p className="text-caption text-muted mb-2 leading-relaxed">
                          Wajah dicocokkan dengan wajah terdaftar Anda. Hadapkan wajah ke kamera di
                          tempat yang terang.
                        </p>
                      )}
                      <SelfieCapture
                        photo={photo}
                        onCapture={setPhoto}
                        onClear={() => setPhoto(null)}
                        disabled={submitting}
                      />
                    </div>
                  )}

                  {settings?.allow_location_override && (
                    <div className="rounded-lg border border-line p-3">
                      <Toggle
                        checked={overrideMode}
                        onChange={(v) => {
                          setOverrideMode(v);
                          if (!v) setNote("");
                        }}
                        label="Saya mengalami kendala lokasi"
                        description="Pakai ini hanya bila Anda benar-benar berada di kantor tetapi GPS tidak akurat. Entri akan ditandai dan ditinjau HRD."
                      />
                      {overrideMode && (
                        <div className="mt-2">
                          <Field
                            label="Alasan kendala"
                            required
                            error={
                              note.trim().length > 0 && note.trim().length < minNote
                                ? `Masih kurang ${minNote - note.trim().length} karakter.`
                                : undefined
                            }
                            hint={`Minimal ${minNote} karakter. Contoh: "GPS meleset ±300 m, saya berada di lantai 3 gedung kantor."`}
                          >
                            <Textarea
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              maxLength={500}
                              placeholder="Jelaskan kendalanya…"
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}

                  {!overrideMode && (
                    <Field label="Catatan (opsional)">
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={200}
                        placeholder="Misalnya: rapat di cabang Bekasi"
                      />
                    </Field>
                  )}

                  <Button
                    size="lg"
                    className="w-full justify-center"
                    icon={STEP_META[nextAction].icon}
                    disabled={!canSubmit}
                    loading={submitting}
                    onClick={() => setConfirmAction(nextAction)}
                  >
                    {STEP_META[nextAction].label}
                  </Button>

                  {!canSubmit && (
                    <p className="text-caption text-subtle text-center leading-relaxed">
                      {!geo
                        ? "Menunggu lokasi terdeteksi…"
                        : selfieRequired && !photo
                          ? "Ambil foto selfie terlebih dahulu."
                          : `Alasan kendala lokasi minimal ${minNote} karakter.`}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ---------------- HISTORY ---------------- */}
      {tab === "history" && (
        <Card>
          <CardHeader title="Riwayat presensi bulan ini" description={`${logs.length} catatan.`} />
          <CardBody className="p-0">
            {logs.length === 0 ? (
              <EmptyState
                icon={History}
                title="Belum ada riwayat"
                description="Catatan presensi bulan berjalan akan muncul di sini."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Tanggal</Th>
                    <Th>Masuk</Th>
                    <Th>Istirahat</Th>
                    <Th>Pulang</Th>
                    <Th>Status</Th>
                    <Th>Catatan</Th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l._id} className="hover:bg-surface-2 transition-colors">
                      <Td className="whitespace-nowrap font-medium">{formatDate(l.date)}</Td>
                      <Td className="tabular-nums">{formatTime(l.clockIn)}</Td>
                      <Td className="tabular-nums text-muted whitespace-nowrap">
                        {l.breakOut || l.breakIn
                          ? `${formatTime(l.breakOut)} – ${formatTime(l.breakIn)}`
                          : "—"}
                      </Td>
                      <Td className="tabular-nums">{formatTime(l.clockOut)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {l.isLate ? (
                            <Badge tone="warning">Telat {l.lateMinutes}m</Badge>
                          ) : l.clockIn ? (
                            <Badge tone="success">Tepat waktu</Badge>
                          ) : null}
                          {l.isEarlyLeave && <Badge tone="warning">Pulang awal</Badge>}
                          {l.isCrossBranch && <Badge tone="info">Lintas cabang</Badge>}
                          {l.isLocationOverride && <Badge tone="danger">Kendala lokasi</Badge>}
                        </div>
                      </Td>
                      <Td className="text-label text-muted max-w-64">
                        <span className="line-clamp-2">{l.note || "—"}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </CardBody>
        </Card>
      )}

      {/* ---------------- CORRECTIONS ---------------- */}
      {tab === "corrections" && (
        <div className="space-y-4">
          {quota && (
            <Alert tone={quota.remaining === 0 ? "warning" : "info"}>
              Kuota koreksi absen bulan ini: <strong>{quota.used} dari {quota.max}</strong> terpakai.
              {quota.remaining === 0
                ? " Pengajuan berikutnya akan melalui persetujuan berlapis HRD → Audit → Direksi."
                : ` Sisa ${quota.remaining} pengajuan.`}
            </Alert>
          )}

          <Card>
            <CardHeader
              title="Pengajuan koreksi absen"
              description="Koreksi memperbaiki catatan jam, bukan menggantikan kewajiban absen harian."
              actions={
                <Button size="sm" icon={Plus} onClick={() => setCorrectionOpen(true)}>
                  Ajukan koreksi
                </Button>
              }
            />
            <CardBody className="p-0">
              {corrections.length === 0 ? (
                <EmptyState
                  icon={FileClock}
                  title="Belum ada pengajuan koreksi"
                  description="Ajukan koreksi bila ada jam presensi yang tidak tercatat atau keliru."
                  action={
                    <Button size="sm" icon={Plus} onClick={() => setCorrectionOpen(true)}>
                      Ajukan koreksi absen
                    </Button>
                  }
                />
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>Tanggal</Th>
                      <Th>Jam diajukan</Th>
                      <Th>Alasan</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrections.map((c) => (
                      <tr key={c._id} className="hover:bg-surface-2 transition-colors">
                        <Td className="whitespace-nowrap font-medium">{formatDate(c.date)}</Td>
                        <Td className="tabular-nums whitespace-nowrap">
                          {c.clockInTime} – {c.clockOutTime}
                        </Td>
                        <Td className="max-w-80">
                          <span className="block text-label font-medium">
                            {CORRECTION_REASON_LABELS[c.reasonType] ?? c.reasonType}
                          </span>
                          <span className="block text-label text-muted line-clamp-2">{c.reasonNote}</span>
                        </Td>
                        <Td>
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={c.status} />
                            {c.isOverQuota && <Badge tone="danger">Melebihi kuota</Badge>}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <CorrectionModal
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        onDone={() => {
          setCorrectionOpen(false);
          setTab("corrections");
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && submit(confirmAction)}
        loading={submitting}
        tone="primary"
        title={confirmAction ? `Konfirmasi ${STEP_META[confirmAction].label}` : ""}
        confirmLabel="Ya, catat sekarang"
        message={
          overrideMode
            ? "Presensi akan dicatat di luar radius kantor dan ditandai untuk ditinjau HRD. Pastikan alasan yang Anda tulis benar."
            : `Waktu presensi diambil dari jam server (${timezoneAbbr()}) dan tidak dapat diubah sendiri setelah tercatat.`
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Today's timeline                                                     */
/* ------------------------------------------------------------------ */

function Timeline({
  log,
  settings,
  nextAction,
}: {
  log: AttendanceLog | null;
  settings: AttendanceSettings | null;
  nextAction: Action | null;
}) {
  const steps: Array<{ action: Action; time?: string }> = [
    { action: "clock_in", time: log?.clockIn },
    ...(settings?.enable_break_attendance
      ? ([
          { action: "break_out" as Action, time: log?.breakOut },
          { action: "break_in" as Action, time: log?.breakIn },
        ])
      : []),
    { action: "clock_out", time: log?.clockOut },
  ];

  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const meta = STEP_META[s.action];
        const done = Boolean(s.time);
        const current = nextAction === s.action;
        return (
          <li key={s.action} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <span
                className={
                  done
                    ? "grid place-items-center w-8 h-8 rounded-full bg-success-soft text-success"
                    : current
                      ? "grid place-items-center w-8 h-8 rounded-full bg-primary-soft text-primary ring-2 ring-primary/30"
                      : "grid place-items-center w-8 h-8 rounded-full bg-surface-2 text-subtle"
                }
              >
                {done ? <CheckCircle2 className="w-4 h-4" /> : <meta.icon className="w-4 h-4" />}
              </span>
              {i < steps.length - 1 && (
                <span className={`w-px flex-1 min-h-6 ${done ? "bg-success/40" : "bg-line"}`} />
              )}
            </div>
            <div className="pb-4 min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-body ${current ? "font-semibold text-foreground" : done ? "font-semibold" : "text-muted"}`}>
                  {meta.label}
                </p>
                <p className="text-body font-semibold tabular-nums shrink-0">
                  {done ? formatTime(s.time) : current ? <span className="text-primary text-label">Giliran Anda</span> : <span className="text-subtle">—</span>}
                </p>
              </div>
              {s.action === "clock_in" && log?.isLate && (
                <p className="text-caption text-warning mt-0.5">
                  Terlambat {log.lateMinutes} menit dari jadwal.
                </p>
              )}
              {s.action === "clock_out" && log?.isEarlyLeave && (
                <p className="text-caption text-warning mt-0.5">
                  Pulang {log.earlyLeaveMinutes} menit lebih awal.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Correction form                                                      */
/* ------------------------------------------------------------------ */

function CorrectionModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [clockInTime, setClockInTime] = useState("09:00");
  const [clockOutTime, setClockOutTime] = useState("17:00");
  const [reasonType, setReasonType] = useState("lupa_tap");
  const [reasonNote, setReasonNote] = useState("");
  const [evidence, setEvidence] = useState<AttachmentItem[]>([]);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(wibDateKey());
      setReasonNote("");
      setEvidence([]);
      setFileError("");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = attachmentProblem(evidence);
    setFileError(problem ?? "");
    if (problem) return;
    setSaving(true);
    try {
      const res = await api.post("/api/v1/attendance/correction", {
        date,
        clockInTime,
        clockOutTime,
        reasonType,
        reasonNote: reasonNote.trim(),
        attachment: toAttachmentInputs(evidence)[0],
      });
      toast.success("Pengajuan terkirim", res.message);
      onDone();
    } catch (err) {
      toast.error("Pengajuan gagal", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajukan koreksi absen"
      description="Gunakan bila jam presensi tidak tercatat atau keliru. Perlu persetujuan atasan dan HRD."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" form="correction-form" type="submit" loading={saving}>
            Kirim pengajuan
          </Button>
        </>
      }
    >
      <form id="correction-form" onSubmit={submit} className="space-y-4">
        <Alert tone="info">
          Koreksi memperbaiki catatan historis. Anda tetap wajib melakukan presensi normal pada hari
          berjalan.
        </Alert>

        <Field label="Tanggal yang dikoreksi" required htmlFor="corr-date">
          <DatePicker
            id="corr-date"
            required
            max={wibDateKey()}
            value={date}
            onChange={(value) => setDate(value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam masuk seharusnya" required htmlFor="corr-in">
            <Input
              id="corr-in"
              type="time"
              required
              value={clockInTime}
              onChange={(e) => setClockInTime(e.target.value)}
            />
          </Field>
          <Field label="Jam pulang seharusnya" required htmlFor="corr-out">
            <Input
              id="corr-out"
              type="time"
              required
              value={clockOutTime}
              onChange={(e) => setClockOutTime(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Kategori alasan"
          required
          htmlFor="corr-type"
          hint="Kategori membantu HRD melihat pola kendala yang berulang."
        >
          <Select id="corr-type" value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
            {Object.entries(CORRECTION_REASON_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Penjelasan"
          required
          htmlFor="corr-note"
          hint={`${reasonNote.trim().length}/15 karakter minimum.`}
          error={
            reasonNote.length > 0 && reasonNote.trim().length < 15
              ? "Jelaskan lebih rinci agar approver dapat menilai."
              : undefined
          }
        >
          <Textarea
            id="corr-note"
            required
            maxLength={1000}
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Contoh: HP mati saat tiba di kantor, jam masuk sebenarnya 08.55 dan disaksikan rekan satu tim."
          />
        </Field>

        <Field
          label="Bukti pendukung (opsional)"
          htmlFor="corr-file"
          error={fileError}
          hint="Misalnya tangkapan layar galat aplikasi, surat tugas dinas luar, atau tautan ke berkasnya."
        >
          <FileOrLinkInput
            id="corr-file"
            value={evidence}
            onChange={(next) => {
              setEvidence(next);
              setFileError("");
            }}
            context="correction"
            invalid={Boolean(fileError)}
            disabled={saving}
          />
        </Field>
      </form>
    </Modal>
  );
}
