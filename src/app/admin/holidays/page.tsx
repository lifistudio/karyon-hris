"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CloudDownload, PartyPopper, Trash2 } from "@/components/icons";
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
  TableWrap,
  Td,
  Th,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { ImportHolidaysModal } from "./ImportHolidaysModal";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateLong, wibDateKey } from "@/lib/time";

import { DatePicker } from "@/components/ui/DatePicker";
interface Holiday {
  _id: string;
  dateKey: string;
  name: string;
  type: "libur_nasional" | "cuti_bersama";
  isActive: boolean;
}

export default function HolidaysPage() {
  const toast = useToast();
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState(currentYear);
  const [items, setItems] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<Holiday[]>(`/api/v1/holidays?year=${year}`);
      setItems(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/holidays?dateKey=${deleteTarget.dateKey}`);
      toast.success("Dihapus", res.message);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const todayKey = wibDateKey();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Hari libur nasional</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">
            Menentukan hari mana yang tidak memotong saldo cuti dan mana yang dapat ditukar libur.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Pilih tahun"
            className="w-28"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Button variant="secondary" icon={CloudDownload} onClick={() => setImportOpen(true)}>
            Impor kalender
          </Button>
          <Button
            icon={CalendarPlus}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Tambah
          </Button>
        </div>
      </header>

      <Alert tone="info" title="Perbedaan kedua jenis">
        <strong>Libur nasional</strong> tidak memotong saldo cuti dan berhak ditukar libur.{" "}
        <strong>Cuti bersama</strong> tetap memotong saldo cuti tahunan karyawan sesuai ketentuan
        pemerintah.
      </Alert>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <Card>
          <CardHeader
            icon={PartyPopper}
            title={`Kalender ${year}`}
            description={`${items.length} tanggal terdaftar.`}
          />
          <CardBody className="p-0">
            {items.length === 0 ? (
              <EmptyState
                icon={PartyPopper}
                title={`Belum ada hari libur untuk ${year}`}
                description="Tambahkan tanggal merah sesuai SKB Tiga Menteri agar perhitungan cuti dan tukar libur akurat."
                action={
                  <Button
                    size="sm"
                    icon={CalendarPlus}
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    Tambah hari libur
                  </Button>
                }
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Tanggal</Th>
                    <Th>Nama</Th>
                    <Th>Jenis</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((h) => {
                    const past = h.dateKey < todayKey;
                    return (
                      <tr
                        key={h._id}
                        className={`hover:bg-surface-2 transition-colors ${past ? "opacity-60" : ""}`}
                      >
                        <Td className="whitespace-nowrap">
                          <span className="block text-body font-semibold">{formatDate(h.dateKey)}</span>
                          <span className="block text-caption text-subtle">
                            {formatDateLong(h.dateKey).split(",")[0]}
                          </span>
                        </Td>
                        <Td className="font-medium">{h.name}</Td>
                        <Td>
                          <Badge tone={h.type === "cuti_bersama" ? "warning" : "danger"}>
                            {h.type === "cuti_bersama" ? "Cuti bersama" : "Libur nasional"}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge tone={h.isActive ? "success" : "neutral"}>
                            {h.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(h);
                                setFormOpen(true);
                              }}
                            >
                              Ubah
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Trash2}
                              className="text-danger"
                              onClick={() => setDeleteTarget(h)}
                            >
                              Hapus
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </CardBody>
        </Card>
      )}

      <HolidayForm
        open={formOpen}
        editing={editing}
        year={year}
        onClose={() => setFormOpen(false)}
        onDone={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title="Hapus hari libur?"
        confirmLabel="Ya, hapus"
        message={`"${deleteTarget?.name}" pada ${deleteTarget ? formatDate(deleteTarget.dateKey) : ""} akan dihapus. Perhitungan cuti dan tukar libur untuk tanggal ini akan kembali dianggap hari kerja biasa.`}
      />
      <ImportHolidaysModal
        open={importOpen}
        year={year}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />

    </div>
  );
}

function HolidayForm({
  open,
  editing,
  year,
  onClose,
  onDone,
}: {
  open: boolean;
  editing: Holiday | null;
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [dateKey, setDateKey] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"libur_nasional" | "cuti_bersama">("libur_nasional");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDateKey(editing?.dateKey ?? `${year}-01-01`);
    setName(editing?.name ?? "");
    setType(editing?.type ?? "libur_nasional");
    setIsActive(editing?.isActive ?? true);
  }, [open, editing, year]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post("/api/v1/holidays", { dateKey, name: name.trim(), type, isActive });
      toast.success("Tersimpan", res.message);
      onDone();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Ubah hari libur" : "Tambah hari libur"}
      description="Satu tanggal hanya dapat memiliki satu entri; menyimpan tanggal yang sama akan menimpa data lama."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="holiday-form" loading={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="holiday-form" onSubmit={submit} className="space-y-4">
        <Field label="Tanggal" required htmlFor="hd-date">
          <DatePicker
            id="hd-date"
            required
            disabled={Boolean(editing)}
            value={dateKey}
            onChange={(value) => setDateKey(value)}
          />
        </Field>

        <Field label="Nama hari libur" required htmlFor="hd-name">
          <Input
            id="hd-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Hari Kemerdekaan Republik Indonesia"
          />
        </Field>

        <Field label="Jenis" required htmlFor="hd-type">
          <Select
            id="hd-type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="libur_nasional">Libur nasional (tidak memotong cuti)</option>
            <option value="cuti_bersama">Cuti bersama (memotong saldo cuti)</option>
          </Select>
        </Field>

        <div className="rounded-lg border border-line p-3">
          <Toggle
            checked={isActive}
            onChange={setIsActive}
            label="Aktif"
            description="Nonaktifkan bila pemerintah membatalkan tanggal ini, tanpa menghapus riwayatnya."
          />
        </div>
      </form>
    </Modal>
  );
}
