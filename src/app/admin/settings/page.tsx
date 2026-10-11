"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound } from "@/components/icons";
import { InitialPasswordsPanel } from "./InitialPasswords";
import { Plus, RotateCcw, Save, Shield, Sliders, Trash2, Users } from "@/components/icons";
import {
  Alert,
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
  Tabs,
  Toggle,
  cn,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

type SettingValue = string | number | boolean;

interface SettingField {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "string" | "select";
  default: SettingValue;
  group: string;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

interface SettingGroup {
  id: string;
  label: string;
  description: string;
}

interface RolePermission {
  module: string;
  actions: string[];
  scope: string;
}

interface RoleRow {
  _id: string;
  name: string;
  isSystemDefault: boolean;
  userCount: number;
  permissions: RolePermission[];
}

interface RbacMeta {
  modules: Array<{ id: string; label: string; hint: string }>;
  actions: Array<{ id: string; label: string }>;
  scopes: Array<{ id: string; label: string }>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"settings" | "roles" | "passwords">("settings");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Pengaturan sistem</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Semua aturan bisnis di bawah ini berlaku seketika tanpa perlu deploy ulang.
        </p>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "settings", label: "Aturan bisnis", icon: Sliders },
          { id: "roles", label: "Peran & hak akses", icon: Shield },
          { id: "passwords", label: "Kata sandi awal", icon: KeyRound },
        ]}
      />

      {tab === "settings" ? <BusinessRules /> : tab === "roles" ? <RolesPanel /> : <InitialPasswordsPanel />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Business rules                                                       */
/* ------------------------------------------------------------------ */

function BusinessRules() {
  const toast = useToast();
  const [fields, setFields] = useState<SettingField[]>([]);
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [initial, setInitial] = useState<Record<string, SettingValue>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{
        values: Record<string, SettingValue>;
        groups: SettingGroup[];
        fields: SettingField[];
      }>("/api/v1/settings?schema=1");
      const data = res.data!;
      setFields(data.fields);
      setGroups(data.groups);
      setValues(data.values);
      setInitial(data.values);
      setActiveGroup((g) => g || data.groups[0]?.id || "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only changed keys are submitted, so two admins editing different sections
  // do not overwrite each other's work.
  const dirty = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(values).filter(([k, v]) => initial[k] !== v && fields.some((f) => f.key === k))
      ),
    [values, initial, fields]
  );
  const dirtyCount = Object.keys(dirty).length;

  const save = async () => {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      const res = await api.post<Record<string, SettingValue>>("/api/v1/settings", dirty);
      toast.success("Tersimpan", res.message);
      setInitial(res.data ?? values);
      setValues(res.data ?? values);
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonList rows={5} />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const shown = fields.filter((f) => f.group === activeGroup);
  const group = groups.find((g) => g.id === activeGroup);

  return (
    <div className="space-y-4">
      {dirtyCount > 0 && (
        <div className="sticky top-20 z-30 card flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-primary/40">
          <p className="text-label text-muted">
            <strong className="text-foreground">{dirtyCount} pengaturan</strong> diubah dan belum
            disimpan.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              onClick={() => setValues(initial)}
              disabled={saving}
            >
              Kembalikan
            </Button>
            <Button size="sm" icon={Save} onClick={save} loading={saving}>
              Simpan perubahan
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr] items-start">
        <nav className="card p-1.5 lg:sticky lg:top-20">
          <ul className="flex lg:flex-col gap-1 overflow-x-auto">
            {groups.map((g) => {
              const changedHere = Object.keys(dirty).filter(
                (k) => fields.find((f) => f.key === k)?.group === g.id
              ).length;
              return (
                <li key={g.id} className="shrink-0 lg:w-full">
                  <button
                    onClick={() => setActiveGroup(g.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-label font-semibold text-left transition-colors cursor-pointer whitespace-nowrap",
                      g.id === activeGroup
                        ? "bg-primary-soft text-primary"
                        : "text-muted hover:text-foreground hover:bg-surface-2"
                    )}
                  >
                    {g.label}
                    {changedHere > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="ada perubahan" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <Card>
          <CardHeader title={group?.label ?? ""} description={group?.description} icon={Sliders} />
          <CardBody className="divide-y divide-[var(--border)] py-0">
            {shown.map((f) => (
              <SettingRow
                key={f.key}
                field={f}
                value={values[f.key] ?? f.default}
                changed={initial[f.key] !== values[f.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SettingRow({
  field,
  value,
  changed,
  onChange,
}: {
  field: SettingField;
  value: SettingValue;
  changed: boolean;
  onChange: (v: SettingValue) => void;
}) {
  if (field.type === "boolean") {
    return (
      <div className={cn("py-1", changed && "-mx-5 px-5 bg-primary-soft/40")}>
        <Toggle
          checked={Boolean(value)}
          onChange={onChange}
          label={field.label}
          description={field.description}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 py-4",
        changed && "-mx-5 px-5 bg-primary-soft/40"
      )}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={`set-${field.key}`} className="block text-body font-medium">
          {field.label}
        </label>
        {field.description && (
          <p className="text-label text-muted mt-0.5 leading-relaxed max-w-xl">{field.description}</p>
        )}
      </div>

      <div className="w-full sm:w-56 shrink-0">
        {field.type === "select" ? (
          <Select
            id={`set-${field.key}`}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : field.type === "number" ? (
          <div className="flex items-center gap-2">
            <Input
              id={`set-${field.key}`}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              value={String(value)}
              onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
              className="tabular-nums"
            />
            {field.unit && (
              <span className="text-caption text-subtle whitespace-nowrap shrink-0">{field.unit}</span>
            )}
          </div>
        ) : (
          <Input
            id={`set-${field.key}`}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roles & permissions                                                  */
/* ------------------------------------------------------------------ */

function RolesPanel() {
  const toast = useToast();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [meta, setMeta] = useState<RbacMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Record<string, RolePermission>>({});
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ roles: RoleRow[] } & RbacMeta>("/api/v1/roles");
      const data = res.data!;
      setRoles(data.roles);
      setMeta({ modules: data.modules, actions: data.actions, scopes: data.scopes });
      setSelectedId((cur) => cur || data.roles.find((r) => r.name !== "SUPERADMIN")?._id || data.roles[0]?._id || "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = roles.find((r) => r._id === selectedId) ?? null;

  // Rebuild the editable matrix whenever the selected role changes: every
  // module gets a row so a module with no grant is still visible and grantable.
  useEffect(() => {
    if (!selected || !meta) return;
    const map: Record<string, RolePermission> = {};
    for (const m of meta.modules) {
      const found = selected.permissions.find((p) => p.module === m.id);
      map[m.id] = found ?? { module: m.id, actions: [], scope: "self" };
    }
    setDraft(map);
  }, [selected, meta]);

  const isSuperadmin = selected?.name === "SUPERADMIN";

  const toggleAction = (moduleId: string, action: string) => {
    setDraft((prev) => {
      const row = prev[moduleId];
      const has = row.actions.includes(action);
      const actions = has ? row.actions.filter((a) => a !== action) : [...row.actions, action];
      const disciplineActions = action === "read" && has ? [] : Array.from(new Set([...actions, "read"]));
      return {
        ...prev,
        [moduleId]: {
          ...row,
          actions: moduleId === "discipline" ? disciplineActions : actions,
        },
      };
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.post("/api/v1/roles", {
        roleId: selected._id,
        permissions: Object.values(draft).filter((p) => p.actions.length > 0),
      });
      toast.success("Hak akses diperbarui", res.message);
      await load();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post<{ _id: string }>("/api/v1/roles", { name: newName.trim() });
      toast.success("Peran dibuat", res.message);
      setCreateOpen(false);
      setNewName("");
      await load();
      if (res.data?._id) setSelectedId(res.data._id);
    } catch (err) {
      toast.error("Gagal membuat peran", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/roles?id=${deleteTarget._id}`);
      toast.success("Peran dihapus", res.message);
      setDeleteTarget(null);
      setSelectedId("");
      await load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <SkeletonList rows={4} />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!meta) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr] items-start">
      <Card className="lg:sticky lg:top-20">
        <CardHeader
          title="Peran"
          icon={Users}
          actions={
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreateOpen(true)}>
              Baru
            </Button>
          }
        />
        <CardBody className="p-1.5">
          <ul className="space-y-0.5 max-h-[28rem] overflow-y-auto">
            {roles.map((r) => (
              <li key={r._id}>
                <button
                  onClick={() => setSelectedId(r._id)}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg text-left transition-colors cursor-pointer",
                    r._id === selectedId ? "bg-primary-soft" : "hover:bg-surface-2"
                  )}
                >
                  <span
                    className={cn(
                      "block text-label font-semibold",
                      r._id === selectedId ? "text-primary" : "text-foreground"
                    )}
                  >
                    {r.name}
                  </span>
                  <span className="block text-caption text-subtle mt-0.5">
                    {r.userCount} akun
                    {r.isSystemDefault && " · bawaan sistem"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon={Shield} title="Pilih peran" description="Pilih peran di samping untuk mengatur hak aksesnya." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            icon={Shield}
            title={selected.name}
            description={`Digunakan oleh ${selected.userCount} akun. Perubahan berlaku pada permintaan berikutnya.`}
            actions={
              <>
                {!selected.isSystemDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="text-danger"
                    onClick={() => setDeleteTarget(selected)}
                  >
                    Hapus
                  </Button>
                )}
                <Button size="sm" icon={Save} onClick={save} loading={saving} disabled={isSuperadmin}>
                  Simpan
                </Button>
              </>
            }
          />
          <CardBody className="space-y-4">
            {isSuperadmin ? (
              <Alert tone="warning" title="Peran ini tidak dapat dibatasi">
                SUPERADMIN memiliki akses penuh secara mutlak dan melewati tabel hak akses.
                Bila Anda memerlukan administrator dengan akses terbatas, buat peran baru lalu
                berikan hanya modul yang diperlukan.
              </Alert>
            ) : (
              <Alert tone="info">
                Modul tanpa satu pun centang berarti peran ini <strong>tidak memiliki akses</strong>{" "}
                ke modul tersebut. Lingkup menentukan seberapa luas data yang terlihat.
              </Alert>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-body border-collapse min-w-[720px]">
                <thead>
                  <tr>
                    <th className="text-left text-label font-semibold text-subtle px-3 py-3 border-b border-line">
                      Modul
                    </th>
                    {meta.actions.map((a) => (
                      <th
                        key={a.id}
                        className="text-center text-label font-semibold text-subtle px-2 py-3 border-b border-line whitespace-nowrap"
                      >
                        {a.label}
                      </th>
                    ))}
                    <th className="text-left text-label font-semibold text-subtle px-3 py-3 border-b border-line">
                      Lingkup
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {meta.modules.map((m) => {
                    const row = draft[m.id];
                    if (!row) return null;
                    const granted = row.actions.length > 0;
                    return (
                      <tr key={m.id} className={cn("border-b border-line", !granted && "opacity-60")}>
                        <td className="px-3 py-3 align-top">
                          <span className="block text-label font-semibold">{m.label}</span>
                          <span className="block text-caption text-subtle mt-0.5 max-w-56 leading-relaxed">
                            {m.hint}
                          </span>
                        </td>
                        {meta.actions.map((a) => (
                          <td key={a.id} className="text-center px-2 py-3 align-top">
                            <input
                              type="checkbox"
                              aria-label={`${a.label} pada modul ${m.label}`}
                              disabled={isSuperadmin || (m.id === "discipline" && !["read", "write", "approve"].includes(a.id))}
                              checked={row.actions.includes(a.id)}
                              onChange={() => toggleAction(m.id, a.id)}
                              className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer disabled:cursor-not-allowed"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-3 align-top">
                          <Select
                            aria-label={`Lingkup akses modul ${m.label}`}
                            disabled={isSuperadmin || !granted}
                            value={row.scope}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [m.id]: { ...prev[m.id], scope: e.target.value },
                              }))
                            }
                            className="h-8 text-label w-40"
                          >
                            {meta.scopes.filter((s) => s.id !== "reports" || m.id === "discipline").map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat peran baru"
        description="Peran baru dibuat tanpa hak akses apa pun; Anda menentukan sendiri modul yang boleh diakses."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button size="sm" type="submit" form="role-form" loading={saving}>
              Buat peran
            </Button>
          </>
        }
      >
        <form id="role-form" onSubmit={create}>
          <Field
            label="Nama peran"
            required
            htmlFor="role-name"
            hint="Otomatis diubah menjadi HURUF_BESAR, misalnya 'Finance Staff' menjadi FINANCE_STAFF."
          >
            <Input
              id="role-name"
              required
              maxLength={40}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Contoh: Finance Staff"
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title="Hapus peran?"
        confirmLabel="Ya, hapus"
        message={`Peran ${deleteTarget?.name} beserta seluruh hak aksesnya akan dihapus permanen. Peran yang masih dipakai akun tidak dapat dihapus.`}
      />
    </div>
  );
}
