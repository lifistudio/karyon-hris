"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarDays, CalendarOff, Copy, Eye, Info, Pencil, Plus, Search, Trash2, Users, X } from "@/components/icons";
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
  Tabs,
  TableWrap,
  Td,
  Th,
  Toggle,
  Tr,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import {
  DAY_NAMES,
  WEEK_ORDER,
  crossesMidnight,
  summariseDays,
  workMinutes,
  type ScheduleDay,
} from "@/lib/hr/schedule-days";
import { formatDate, formatDateLong, wibDateKey, isoOffset } from "@/lib/time";

interface Template {
  _id: string;
  name: string;
  description?: string;
  gracePeriodMinutes: number;
  isBreakActive: boolean;
  days: ScheduleDay[];
  summary: string;
  weeklyMinutes: number;
  employeeCount: number;
}

interface EmployeeRow {
  _id: string;
  name: string;
  employeeId: string;
  branchId?: { name: string; workHours?: { start?: string; end?: string } } | null;
  divisionId?: { name: string } | null;
  workScheduleId?: { _id: string; name: string } | null;
  scheduleSummary: string | null;
}

interface OverrideRow {
  _id: string;
  date: string;
  isOffDay: boolean;
  note: string;
  hours: string | null;
  employeeId?: { _id: string; name: string; employeeId: string } | null;
  scheduleId?: { _id: string; name: string } | null;
}

type TabId = "templates" | "employees" | "overrides";

const hours = (min: number) => `${Math.floor(min / 60)} jam${min % 60 ? ` ${min % 60} mnt` : ""}`;

export default function SchedulesPage() {
  const [tab, setTab] = useState<TabId>("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    setTemplatesError("");
    try {
      const res = await api.get<Template[]>("/api/v1/schedules?type=template");
      setTemplates(res.data ?? []);
    } catch (err) {
      setTemplatesError(errorMessage(err));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  return (
    <div>
      <PageHeader
        eyebrow="Presensi"
        title="Jadwal & shift"
        description="Jam kerja yang dipakai sistem untuk menentukan terlambat, pulang lebih awal, dan hari libur setiap karyawan."
      />

      <Card className="p-4 sm:p-5 mb-6">
        <p className="eyebrow mb-3 flex items-center gap-2">
          <Info className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
          Urutan jadwal yang dipakai saat absen
        </p>
        <ol className="grid gap-3 md:grid-cols-3">
          {[
            ["1", "Jadwal khusus tanggal", "Bila ada, misalnya tukar shift atau libur pengganti pada tanggal tertentu."],
            ["2", "Template karyawan", "Jam per hari dari template mingguan yang dipasang ke karyawan. Hari yang tidak aktif = libur."],
            ["3", "Jam operasional cabang", "Cadangan bila karyawan belum punya template."],
          ].map(([n, title, body]) => (
            <li key={n} className="flex gap-3">
              <span className="grid place-items-center w-6 h-6 rounded-full bg-primary-soft text-primary text-label font-semibold shrink-0">
                {n}
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-heading">{title}</span>
                <span className="block text-label text-muted leading-relaxed">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mb-5">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "templates", label: "Template shift", icon: CalendarClock, count: templates.length },
            { id: "employees", label: "Jadwal karyawan", icon: Users },
            { id: "overrides", label: "Jadwal khusus tanggal", icon: CalendarDays },
          ]}
        />
      </div>

      {tab === "templates" &&
        (templatesError ? (
          <ErrorState message={templatesError} onRetry={loadTemplates} />
        ) : templatesLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <TemplatesTab templates={templates} onChanged={loadTemplates} />
        ))}
      {tab === "employees" && <EmployeesTab templates={templates} onChanged={loadTemplates} />}
      {tab === "overrides" && <OverridesTab templates={templates} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_DAYS: ScheduleDay[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  active: day >= 1 && day <= 5,
  clockIn: "08:00",
  clockOut: "17:00",
  breakOut: "12:00",
  breakIn: "13:00",
}));

function TemplatesTab({ templates, onChanged }: { templates: Template[]; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Template | null>(null);

  const remove = async () => {
    if (!removeTarget) return;
    try {
      const res = await api.delete(`/api/v1/schedules/${removeTarget._id}`);
      toast.success("Dihapus", res.message);
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      toast.error("Tidak dapat dihapus", errorMessage(err));
      setRemoveTarget(null);
    }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button icon={Plus} onClick={() => setEditing({ name: "", days: DEFAULT_DAYS, gracePeriodMinutes: 5, isBreakActive: true })}>
          Buat template
        </Button>
      </div>
      {templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Belum ada template shift"
            description="Buat template seperti Kantor (Sen–Jum) atau Shift Pagi, lalu pasang ke karyawan di tab Jadwal karyawan."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <Card key={t._id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-lg font-semibold text-heading">{t.name}</p>
                  {t.description && <p className="text-label text-muted mt-0.5">{t.description}</p>}
                </div>
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label={`Ubah ${t.name}`} onClick={() => setEditing(t)}>
                    <Pencil className="w-4 h-4" strokeWidth={ICON_STROKE} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Salin ${t.name}`}
                    title="Salin sebagai template baru"
                    onClick={() => setEditing({ ...t, _id: undefined, name: `${t.name} (salinan)` })}
                  >
                    <Copy className="w-4 h-4" strokeWidth={ICON_STROKE} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Hapus ${t.name}`} onClick={() => setRemoveTarget(t)}>
                    <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                  </Button>
                </div>
              </div>

              <ul className="mt-4 grid grid-cols-7 gap-1">
                {WEEK_ORDER.map((d) => {
                  const day = t.days.find((x) => x.day === d)!;
                  return (
                    <li
                      key={d}
                      className={cn(
                        "rounded-lg px-1 py-2 text-center border",
                        day.active ? "border-primary/30 bg-primary-soft" : "border-line bg-surface-2"
                      )}
                      title={day.active ? `${DAY_NAMES[d]} ${day.clockIn}–${day.clockOut}` : `${DAY_NAMES[d]} libur`}
                    >
                      <span className={cn("block text-caption font-semibold", day.active ? "text-primary" : "text-subtle")}>
                        {DAY_NAMES[d].slice(0, 3)}
                      </span>
                      <span className="block text-caption tabular-nums text-foreground/80 leading-tight mt-0.5">
                        {day.active ? (
                          <>
                            {day.clockIn}
                            <br />
                            {day.clockOut}
                          </>
                        ) : (
                          "Libur"
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted">
                <span>{hours(t.weeklyMinutes)} / minggu</span>
                <span>Toleransi {t.gracePeriodMinutes} menit</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                  {t.employeeCount} karyawan
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={remove}
        title={`Hapus template ${removeTarget?.name ?? ""}?`}
        message="Template hanya dapat dihapus bila tidak dipakai karyawan mana pun. Riwayat presensi lama tidak berubah."
        confirmLabel="Hapus"
      />
    </>
  );
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<Template>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [grace, setGrace] = useState(initial.gracePeriodMinutes ?? 5);
  const [days, setDays] = useState<ScheduleDay[]>(
    (initial.days ?? DEFAULT_DAYS).map((d) => ({ ...d, breakOut: d.breakOut ?? "", breakIn: d.breakIn ?? "" }))
  );
  const [saving, setSaving] = useState(false);

  const setDay = (day: number, patch: Partial<ScheduleDay>) =>
    setDays((prev) => prev.map((d) => (d.day === day ? { ...d, ...patch } : d)));

  const copyToWorkdays = (source: ScheduleDay) =>
    setDays((prev) =>
      prev.map((d) =>
        d.active && d.day !== source.day
          ? { ...d, clockIn: source.clockIn, clockOut: source.clockOut, breakOut: source.breakOut, breakIn: source.breakIn }
          : d
      )
    );

  const weekly = days.filter((d) => d.active).reduce((n, d) => n + workMinutes(d), 0);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post("/api/v1/schedules", {
        mode: "template",
        id: initial._id,
        name,
        description,
        gracePeriodMinutes: grace,
        isBreakActive: days.some((d) => d.active && d.breakOut && d.breakIn),
        days,
      });
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
      size="xl"
      title={initial._id ? `Ubah ${initial.name}` : "Template shift baru"}
      description="Atur jam per hari. Hari yang dimatikan dihitung sebagai libur untuk karyawan pemakai template ini."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} onClick={save} disabled={name.trim().length < 2}>
            Simpan template
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px] gap-4">
          <Field label="Nama template" required htmlFor="tp-name">
            <Input id="tp-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Kantor Pusat" />
          </Field>
          <Field label="Keterangan" htmlFor="tp-desc">
            <Input id="tp-desc" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opsional" />
          </Field>
          <Field label="Toleransi terlambat" htmlFor="tp-grace">
            <div className="relative">
              <Input
                id="tp-grace"
                inputMode="numeric"
                value={String(grace)}
                onChange={(e) => setGrace(Math.min(120, Number(e.target.value.replace(/\D/g, "")) || 0))}
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-label text-subtle">menit</span>
            </div>
          </Field>
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="text-left text-label text-subtle">
                <th className="py-2 pr-3 font-semibold">Hari</th>
                <th className="py-2 px-2 font-semibold">Masuk</th>
                <th className="py-2 px-2 font-semibold">Pulang</th>
                <th className="py-2 px-2 font-semibold">Istirahat mulai</th>
                <th className="py-2 px-2 font-semibold">Istirahat selesai</th>
                <th className="py-2 pl-2 font-semibold text-right">Jam kerja</th>
              </tr>
            </thead>
            <tbody>
              {WEEK_ORDER.map((dayIndex) => {
                const d = days.find((x) => x.day === dayIndex)!;
                return (
                  <tr key={dayIndex} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.active}
                          onChange={(e) => setDay(dayIndex, { active: e.target.checked })}
                          className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
                        />
                        <span className={cn("text-body-sm font-medium", !d.active && "text-subtle")}>{DAY_NAMES[dayIndex]}</span>
                      </label>
                    </td>
                    {d.active ? (
                      <>
                        {(["clockIn", "clockOut", "breakOut", "breakIn"] as const).map((k) => (
                          <td key={k} className="py-2 px-2">
                            <Input
                              type="time"
                              aria-label={`${DAY_NAMES[dayIndex]} ${k}`}
                              value={d[k] ?? ""}
                              onChange={(e) => setDay(dayIndex, { [k]: e.target.value })}
                              className="h-9 text-body-sm tabular-nums"
                            />
                          </td>
                        ))}
                        <td className="py-2 pl-2 text-right whitespace-nowrap">
                          <span className="text-body-sm tabular-nums">{hours(workMinutes(d))}</span>
                          {crossesMidnight(d.clockIn, d.clockOut) && (
                            <span className="block text-caption text-info">selesai hari berikutnya</span>
                          )}
                          <button
                            type="button"
                            onClick={() => copyToWorkdays(d)}
                            className="block ml-auto text-caption text-primary hover:underline cursor-pointer"
                          >
                            Salin ke hari aktif lain
                          </button>
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-2 px-2 text-body-sm text-subtle">
                        Libur
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-body-sm text-muted">
          Total <strong className="text-foreground">{hours(weekly)}</strong> per minggu ·{" "}
          {summariseDays(days)}. Kosongkan jam istirahat bila hari itu tanpa absen istirahat.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Employees                                                            */
/* ------------------------------------------------------------------ */

function EmployeesTab({ templates, onChanged }: { templates: Template[]; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filterSchedule, setFilterSchedule] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [preview, setPreview] = useState<EmployeeRow | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type: "employees", page: String(page), limit: String(limit) });
      if (query) params.set("q", query);
      if (filterSchedule) params.set("scheduleId", filterSchedule);
      const res = await api.get<EmployeeRow[]>(`/api/v1/schedules?${params}`);
      setRows(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, query, filterSchedule]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r._id));

  const assign = async () => {
    setAssigning(true);
    try {
      const res = await api.post("/api/v1/schedules", {
        mode: "assign",
        employeeIds: [...selected],
        scheduleId: assignTo === "__none" ? null : assignTo,
      });
      toast.success("Tersimpan", res.message);
      setSelected(new Set());
      setAssignTo("");
      void load();
      onChanged();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    } finally {
      setAssigning(false);
    }
  };

  const templateOptions = templates.map((t) => ({ value: t._id, label: t.name, hint: t.summary }));

  return (
    <>
      <Card className="p-3 sm:p-4 mb-4">
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" strokeWidth={ICON_STROKE} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau NIP" className="pl-10" aria-label="Cari karyawan" />
          </div>
          <Combobox
            value={filterSchedule}
            onChange={(v) => {
              setFilterSchedule(v);
              setPage(1);
            }}
            options={[{ value: "none", label: "Belum punya template" }, ...templateOptions]}
            placeholder="Semua template"
            clearable
            aria-label="Saring template"
          />
        </div>

        {selected.size > 0 && (
          <div className="mt-3 pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center gap-2.5">
            <p className="text-body-sm text-foreground shrink-0">
              <strong>{selected.size}</strong> karyawan dipilih
            </p>
            <Combobox
              value={assignTo}
              onChange={setAssignTo}
              options={[{ value: "__none", label: "Lepas template (pakai jam cabang)" }, ...templateOptions]}
              placeholder="Pasang template…"
              className="sm:w-72"
              aria-label="Template untuk karyawan terpilih"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={assign} loading={assigning} disabled={!assignTo}>
                Terapkan
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())}>
                Batal pilih
              </Button>
            </div>
          </div>
        )}
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading && !rows.length ? (
        <SkeletonList rows={6} />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={Users} title="Tidak ada karyawan yang cocok" />
        </Card>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <Card className="overflow-hidden">
            <TableWrap>
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua di halaman ini"
                      checked={allOnPage}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          rows.forEach((r) => (allOnPage ? next.delete(r._id) : next.add(r._id)));
                          return next;
                        })
                      }
                      className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
                    />
                  </Th>
                  <Th>Karyawan</Th>
                  <Th>Template mingguan</Th>
                  <Th>Jam yang berlaku</Th>
                  <Th className="text-right">Cek</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r._id}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${r.name}`}
                        checked={selected.has(r._id)}
                        onChange={() => toggle(r._id)}
                        className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
                      />
                    </Td>
                    <Td>
                      <p className="text-body-sm font-semibold text-heading">{r.name}</p>
                      <p className="text-label text-muted">
                        {r.employeeId}
                        {r.branchId?.name ? ` · ${r.branchId.name}` : ""}
                      </p>
                    </Td>
                    <Td>
                      {r.workScheduleId ? (
                        <Badge tone="primary">{r.workScheduleId.name}</Badge>
                      ) : (
                        <Badge tone="warning">Belum ada</Badge>
                      )}
                    </Td>
                    <Td className="text-label text-muted">
                      {r.scheduleSummary ??
                        `Jam cabang ${r.branchId?.workHours?.start ?? "09:00"}–${r.branchId?.workHours?.end ?? "17:00"} setiap hari`}
                    </Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" icon={Eye} onClick={() => setPreview(r)}>
                        14 hari
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <Pagination
            className="mt-4"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / limit))}
            total={total}
            limit={limit}
            onPage={setPage}
            onLimit={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        </div>
      )}

      {preview && <PreviewModal employee={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function PreviewModal({ employee, onClose }: { employee: EmployeeRow; onClose: () => void }) {
  const [days, setDays] = useState<
    Array<{ date: string; clockIn: string; clockOut: string; isOffDay: boolean; source: string; scheduleName: string }> | null
  >(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ days: NonNullable<typeof days> }>(`/api/v1/schedules?type=preview&employeeId=${employee._id}&days=14`)
      .then((res) => setDays(res.data?.days ?? []))
      .catch((err) => setError(errorMessage(err)));
  }, [employee._id]);

  const SOURCE: Record<string, string> = {
    date_override: "Jadwal khusus",
    employee_template: "Template",
    branch_default: "Jam cabang",
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Jadwal ${employee.name}`}
      description="Persis jadwal yang dipakai sistem saat karyawan ini absen, 14 hari ke depan."
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !days ? (
        <SkeletonList rows={5} />
      ) : (
        <ul className="divide-y divide-[var(--border)] -mx-1">
          {days.map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-3 px-1 py-2.5">
              <span className="text-body-sm text-foreground min-w-0">{formatDateLong(`${d.date}T00:00:00${isoOffset()}`)}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={cn("text-body-sm tabular-nums", d.isOffDay ? "text-subtle" : "text-heading font-medium")}>
                  {d.isOffDay ? "Libur" : `${d.clockIn}–${d.clockOut}`}
                </span>
                <Badge tone={d.source === "date_override" ? "accent" : d.source === "branch_default" ? "warning" : "neutral"}>
                  {SOURCE[d.source] ?? d.source}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Overrides                                                            */
/* ------------------------------------------------------------------ */

function OverridesTab({ templates }: { templates: Template[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [from, setFrom] = useState(() => wibDateKey());
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type: "overrides", page: String(page), limit: String(limit), from });
      if (to) params.set("to", to);
      const res = await api.get<OverrideRow[]>(`/api/v1/schedules?${params}`);
      setRows(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      const res = await api.delete(`/api/v1/schedules?id=${id}`);
      toast.success("Dihapus", res.message);
      void load();
    } catch (err) {
      toast.error("Gagal", errorMessage(err));
    }
  };

  return (
    <>
      <Card className="p-3 sm:p-4 mb-4">
        <div className="grid gap-2.5 sm:grid-cols-[12rem_12rem_minmax(0,1fr)] sm:items-end">
          <Field label="Dari tanggal">
            <DatePicker value={from} onChange={(v) => { setFrom(v || wibDateKey()); setPage(1); }} />
          </Field>
          <Field label="Sampai">
            <DatePicker value={to} onChange={(v) => { setTo(v); setPage(1); }} min={from} clearable placeholder="Seterusnya" />
          </Field>
          <div className="sm:justify-self-end">
            <Button icon={Plus} onClick={() => setAddOpen(true)}>
              Tambah jadwal khusus
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading && !rows.length ? (
        <SkeletonList rows={5} />
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={CalendarOff}
            title="Tidak ada jadwal khusus pada rentang ini"
            description="Gunakan untuk tukar shift, lembur di hari libur, atau libur pengganti pada tanggal tertentu tanpa mengubah template karyawan."
          />
        </Card>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <Card className="overflow-hidden">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Tanggal</Th>
                  <Th>Karyawan</Th>
                  <Th>Jadwal hari itu</Th>
                  <Th>Catatan</Th>
                  <Th className="text-right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r._id}>
                    <Td className="whitespace-nowrap text-body-sm">{formatDate(r.date)}</Td>
                    <Td>
                      <p className="text-body-sm font-semibold text-heading">{r.employeeId?.name ?? "—"}</p>
                      <p className="text-label text-muted">{r.employeeId?.employeeId}</p>
                    </Td>
                    <Td>
                      {r.isOffDay ? (
                        <Badge tone="warning">Libur</Badge>
                      ) : (
                        <span className="text-body-sm">
                          {r.scheduleId?.name ?? "—"}
                          {r.hours && <span className="text-muted"> · {r.hours}</span>}
                        </span>
                      )}
                    </Td>
                    <Td className="text-label text-muted">{r.note || "—"}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="icon" aria-label="Hapus jadwal khusus" onClick={() => remove(r._id)}>
                        <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <Pagination
            className="mt-4"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / limit))}
            total={total}
            limit={limit}
            onPage={setPage}
            onLimit={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        </div>
      )}

      {addOpen && (
        <OverrideForm
          templates={templates}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function OverrideForm({
  templates,
  onClose,
  onSaved,
}: {
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [people, setPeople] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [chosen, setChosen] = useState<Array<{ _id: string; name: string }>>([]);
  const [from, setFrom] = useState(() => wibDateKey());
  const [to, setTo] = useState(() => wibDateKey());
  const [offDay, setOffDay] = useState(false);
  const [scheduleId, setScheduleId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<typeof people>("/api/v1/employees?limit=500")
      .then((res) => setPeople(res.data ?? []))
      .catch(() => {});
  }, []);

  const options = useMemo(
    () =>
      people
        .filter((p) => !chosen.some((c) => c._id === p._id))
        .map((p) => ({ value: p._id, label: p.name, hint: p.employeeId })),
    [people, chosen]
  );

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post("/api/v1/schedules", {
        mode: "override",
        employeeIds: chosen.map((c) => c._id),
        from,
        to: to || from,
        isOffDay: offDay,
        scheduleId: offDay ? null : scheduleId || null,
        note,
      });
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
      size="md"
      title="Jadwal khusus tanggal"
      description="Mengganti jadwal pada tanggal tertentu tanpa mengubah template mingguan karyawan."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} onClick={save} disabled={!chosen.length || (!offDay && !scheduleId)}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Karyawan" required>
          <Combobox
            value=""
            onChange={(v) => {
              const p = people.find((x) => x._id === v);
              if (p) setChosen((prev) => [...prev, { _id: p._id, name: p.name }]);
            }}
            options={options}
            placeholder="Tambah karyawan…"
            sheetTitle="Karyawan"
          />
          {chosen.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <span key={c._id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-line pl-2.5 pr-1 py-0.5 text-label">
                  {c.name}
                  <button
                    type="button"
                    aria-label={`Hapus ${c.name}`}
                    onClick={() => setChosen((prev) => prev.filter((x) => x._id !== c._id))}
                    className="grid place-items-center w-4 h-4 rounded-full hover:bg-line cursor-pointer"
                  >
                    <X className="w-3 h-3" strokeWidth={ICON_STROKE} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dari tanggal" required>
            <DatePicker value={from} onChange={(v) => { setFrom(v); if (to && v > to) setTo(v); }} />
          </Field>
          <Field label="Sampai tanggal" required>
            <DatePicker value={to} onChange={setTo} min={from} />
          </Field>
        </div>
        <Toggle checked={offDay} onChange={setOffDay} label="Jadikan hari libur" description="Karyawan tidak dianggap terlambat atau alpha pada tanggal ini." />
        {!offDay && (
          <Field label="Pakai shift" required>
            <Combobox
              value={scheduleId}
              onChange={setScheduleId}
              options={templates.map((t) => ({ value: t._id, label: t.name, hint: t.summary }))}
              placeholder="Pilih template shift…"
            />
          </Field>
        )}
        <Field label="Catatan" hint="Misalnya: tukar shift dengan Budi, libur pengganti lembur 17 Agustus.">
          <Input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
