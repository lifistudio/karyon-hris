"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { CalendarCheck2, Info, PartyPopper, Repeat, Trash2 } from "@/components/icons";
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
  TableWrap,
  Td,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/time";

import { DatePicker } from "@/components/ui/DatePicker";
interface Holiday {
  dateKey: string;
  name: string;
  alreadyRequested: boolean;
}

interface SwapRequest {
  _id: string;
  holidayDate: string;
  replacementDate: string;
  isHalfDay: boolean;
  session: string;
  reason: string;
  status: string;
  forfeitedReason?: string;
}

interface Rules {
  leadDays: number;
  allowHalfDay: boolean;
  maxConsecutive: number;
  blockSameDivision: boolean;
}

export default function HolidaySwapPage() {
  const toast = useToast();
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SwapRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{ requests: SwapRequest[]; holidays: Holiday[]; rules: Rules }>(
        `/api/v1/holiday-swap?page=${page}&limit=${limit}`
      );
      setRequests(res.data?.requests ?? []);
      setTotal(res.meta?.total ?? 0);
      setHolidays(res.data?.holidays ?? []);
      setRules(res.data?.rules ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await api.delete(`/api/v1/holiday-swap?id=${cancelTarget._id}`);
      toast.success("Dibatalkan", res.message);
      setCancelTarget(null);
      await load();
    } catch (err) {
      toast.error("Gagal membatalkan", errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  const available = holidays.filter((h) => !h.alreadyRequested);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-44" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Tukar libur</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">
            Bersedia masuk di tanggal merah? Tukar dengan hari libur pengganti.
          </p>
        </div>
        <Button
          icon={Repeat}
          onClick={() => setFormOpen(true)}
          disabled={available.length === 0}
        >
          Ajukan tukar libur
        </Button>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}

      {rules && (
        <Alert tone="warning" title="Syarat yang perlu Anda tahu">
          <ul className="list-disc pl-4 space-y-0.5 mt-1">
            <li>Diajukan minimal H-{rules.leadDays} sebelum tanggal merah.</li>
            <li>
              Hak libur pengganti <strong>hanya berlaku bila Anda benar-benar absen masuk</strong> pada
              tanggal merah tersebut. Jika tidak masuk, pengajuan otomatis gugur.
            </li>
            <li>Satu tanggal merah hanya dapat ditukar satu kali.</li>
            {rules.blockSameDivision && (
              <li>Tanggal pengganti tidak boleh sama dengan rekan satu divisi.</li>
            )}
            {rules.maxConsecutive > 0 && (
              <li>Maksimal {rules.maxConsecutive} tanggal merah berdekatan yang dapat ditukar.</li>
            )}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <Card>
          <CardHeader
            title="Pengajuan saya"
            description={`${total} pengajuan tercatat.`}
            icon={CalendarCheck2}
          />
          <CardBody className="p-0">
            {requests.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title="Belum ada pengajuan tukar libur"
                description="Pilih tanggal merah yang ingin Anda tukar dari daftar di samping."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Tanggal merah (masuk)</Th>
                    <Th>Libur pengganti</Th>
                    <Th>Sesi</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r._id} className="hover:bg-surface-2 transition-colors">
                      <Td className="whitespace-nowrap font-medium">{formatDate(r.holidayDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.replacementDate)}</Td>
                      <Td className="text-label text-muted whitespace-nowrap">
                        {r.isHalfDay
                          ? r.session === "morning"
                            ? "Setengah hari (pagi)"
                            : "Setengah hari (siang)"
                          : "Sehari penuh"}
                      </Td>
                      <Td>
                        {r.status === "forfeited" ? (
                          <div>
                            <Badge tone="danger">Gugur</Badge>
                            <span className="block text-caption text-subtle mt-1 max-w-44">
                              {r.forfeitedReason || "Tidak masuk pada tanggal merah."}
                            </span>
                          </div>
                        ) : (
                          <StatusBadge status={r.status} />
                        )}
                      </Td>
                      <Td>
                        {r.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            className="text-danger"
                            onClick={() => setCancelTarget(r)}
                          >
                            Batalkan
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </CardBody>
        </Card>
        {total > limit && (
          <div className="lg:col-span-2 lg:order-last">
            <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPage={setPage} />
          </div>
        )}

        <Card>
          <CardHeader title="Tanggal merah mendatang" icon={PartyPopper} />
          <CardBody className="p-0">
            {holidays.length === 0 ? (
              <EmptyState
                icon={PartyPopper}
                title="Tidak ada tanggal merah"
                description="Belum ada hari libur nasional tersisa di tahun ini."
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {holidays.map((h) => (
                  <li key={h.dateKey} className="px-5 py-3">
                    <p className="text-label font-semibold">{h.name}</p>
                    <p className="text-caption text-subtle mt-0.5">{formatDate(h.dateKey)}</p>
                    {h.alreadyRequested && (
                      <Badge tone="info" className="mt-1.5">
                        Sudah diajukan
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <SwapFormModal
        open={formOpen}
        holidays={available}
        rules={rules}
        onClose={() => setFormOpen(false)}
        onDone={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancel}
        loading={cancelling}
        title="Batalkan pengajuan tukar libur?"
        confirmLabel="Ya, batalkan"
        message="Pengajuan akan dibatalkan dan tanggal merah tersebut dapat Anda ajukan kembali selama masih memenuhi batas waktu."
      />
    </div>
  );
}

function SwapFormModal({
  open,
  holidays,
  rules,
  onClose,
  onDone,
}: {
  open: boolean;
  holidays: Holiday[];
  rules: Rules | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [holidayDate, setHolidayDate] = useState("");
  const [replacementDate, setReplacementDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [session, setSession] = useState<"morning" | "afternoon">("morning");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHolidayDate(holidays[0]?.dateKey ?? "");
    setReplacementDate("");
    setIsHalfDay(false);
    setReason("");
  }, [open, holidays]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post("/api/v1/holiday-swap", {
        holidayDate,
        replacementDate,
        isHalfDay,
        session: isHalfDay ? session : "full",
        reason: reason.trim() || undefined,
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
      title="Ajukan tukar libur"
      description="Anda masuk kerja di tanggal merah, dan mengambil libur di hari kerja lain."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="swap-form" loading={saving}>
            Kirim pengajuan
          </Button>
        </>
      }
    >
      <form id="swap-form" onSubmit={submit} className="space-y-4">
        <Field
          label="Tanggal merah yang akan Anda masuki"
          required
          htmlFor="sw-holiday"
          hint={rules ? `Hanya tanggal yang masih memenuhi batas H-${rules.leadDays} yang ditampilkan.` : undefined}
        >
          <Select
            id="sw-holiday"
            required
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
          >
            <option value="" disabled>
              Pilih tanggal merah…
            </option>
            {holidays.map((h) => (
              <option key={h.dateKey} value={h.dateKey}>
                {formatDate(h.dateKey)} — {h.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Tanggal libur pengganti"
          required
          htmlFor="sw-replacement"
          hint="Harus hari kerja (bukan akhir pekan atau tanggal merah lain)."
        >
          <DatePicker
            id="sw-replacement"
            required
            value={replacementDate}
            onChange={(value) => setReplacementDate(value)}
          />
        </Field>

        {rules?.allowHalfDay && (
          <div className="rounded-lg border border-line p-3">
            <Toggle
              checked={isHalfDay}
              onChange={setIsHalfDay}
              label="Tukar setengah hari saja"
              description="Anda tetap bekerja separuh hari pada tanggal pengganti."
            />
            {isHalfDay && (
              <div className="mt-2">
                <Field label="Sesi libur" htmlFor="sw-session">
                  <Select
                    id="sw-session"
                    value={session}
                    onChange={(e) => setSession(e.target.value as "morning" | "afternoon")}
                  >
                    <option value="morning">Pagi</option>
                    <option value="afternoon">Siang</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        <Field label="Catatan (opsional)" htmlFor="sw-reason">
          <Textarea
            id="sw-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Bersedia menjaga operasional toko saat libur nasional."
          />
        </Field>

        <Alert tone="info">
          <span className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Setelah disetujui, Anda tetap wajib melakukan presensi normal pada tanggal merah
              tersebut. Tanpa catatan presensi, hak libur pengganti otomatis gugur.
            </span>
          </span>
        </Alert>
      </form>
    </Modal>
  );
}
