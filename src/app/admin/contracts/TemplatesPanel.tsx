"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, ICON_STROKE, Input, Modal, SkeletonList, Tabs, Textarea, Toggle } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { LogoField } from "@/components/print/LogoField";
import { ContractDocument } from "@/components/print/ContractDocument";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { CONTRACT_TYPES, CONTRACT_TYPE_MAP, type ContractType } from "@/lib/hr/contracts";
import { PlaceholderHelp } from "./ContractDetail";

interface Template {
  _id?: string;
  name: string;
  type: ContractType;
  content: string;
  isActive: boolean;
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
  signerName: string;
  signerTitle: string;
  city: string;
}

const SAMPLE: Record<string, string> = {
  nomor_kontrak: "PKWT/2026/0012",
  jenis_kontrak: "PKWT",
  nama: "Siti Rahmawati",
  nip: "EMP-2026-0012",
  nik: "3273xxxxxxxxxxxx",
  tempat_lahir: "Bandung",
  tanggal_lahir: "12 Mar 1998",
  alamat: "Jl. Melati No. 4, Bandung",
  jabatan: "Staf Akuntansi",
  divisi: "Keuangan",
  cabang: "Kantor Pusat",
  tanggal_mulai: "1 Okt 2026",
  tanggal_selesai: "30 Sep 2027",
  durasi: "1 tahun",
  gaji_pokok: "Rp 6.500.000",
  tunjangan: "Rp 750.000",
  tanggal_hari_ini: "17 Sep 2026",
};

export function TemplatesPanel({ canEdit, companyName, companyAddress }: { canEdit: boolean; companyName: string; companyAddress: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Template | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Template | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Template[]>("/api/v1/contracts/templates");
      setRows(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <SkeletonList rows={3} />;

  return (
    <>
      {canEdit && (
        <div className="flex justify-end mb-3">
          <Button
            icon={Plus}
            onClick={() =>
              setEditing({ name: "", type: "pkwt", content: rows[0]?.content ?? "# PERJANJIAN KERJA\nNomor: {{nomor_kontrak}}\n\n", isActive: true, showLogo: false, logoUrl: "", logoHeight: 14, signerName: "", signerTitle: "HRD Manager", city: "" })
            }
          >
            Template baru
          </Button>
        </div>
      )}
      {!rows.length ? (
        <Card>
          <EmptyState icon={FileText} title="Belum ada template kontrak" />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((t) => (
              <li key={t._id} className="px-5 py-4 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-heading">{t.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="primary">{CONTRACT_TYPE_MAP[t.type]?.short ?? t.type}</Badge>
                    {t.showLogo && t.logoUrl && <Badge tone="neutral">Dengan logo</Badge>}
                    {!t.isActive && <Badge tone="danger">Nonaktif</Badge>}
                  </div>
                  <p className="mt-1 text-label text-muted">
                    Penandatangan: {t.signerName || "belum diisi"}
                    {t.signerTitle ? ` (${t.signerTitle})` : ""}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" aria-label={`Ubah ${t.name}`} onClick={() => setEditing({ ...t })}>
                      <Pencil className="w-4 h-4" strokeWidth={ICON_STROKE} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Hapus ${t.name}`} onClick={() => setRemoveTarget(t)}>
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <TemplateEditor
          initial={editing}
          companyName={companyName}
          companyAddress={companyAddress}
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
        onConfirm={async () => {
          try {
            const res = await api.delete(`/api/v1/contracts/templates?id=${removeTarget?._id}`);
            toast.success("Selesai", res.message);
            setRemoveTarget(null);
            void load();
          } catch (err) {
            toast.error("Gagal", errorMessage(err));
          }
        }}
        title={`Hapus template ${removeTarget?.name ?? ""}?`}
        message="Kontrak yang sudah dibuat menyimpan salinan isinya sendiri dan tidak berubah."
        confirmLabel="Hapus"
      />
    </>
  );
}

function TemplateEditor({
  initial,
  companyName,
  companyAddress,
  onClose,
  onSaved,
}: {
  initial: Template;
  companyName: string;
  companyAddress: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [t, setT] = useState<Template>(initial);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Template>) => setT((prev) => ({ ...prev, ...patch }));

  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return set({ content: t.content + token });
    const start = el.selectionStart;
    set({ content: t.content.slice(0, start) + token + t.content.slice(el.selectionEnd) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const copyPayslipLogo = async () => {
    try {
      const res = await api.get<{ templates: Array<{ isDefault: boolean; logoUrl?: string; logoHeight?: number }> }>("/api/v1/payroll/templates");
      const list = res.data?.templates ?? [];
      const source = list.find((x) => x.isDefault && x.logoUrl) ?? list.find((x) => x.logoUrl);
      if (!source?.logoUrl) {
        toast.error("Belum ada logo", "Template slip gaji belum punya logo. Unggah logo di sini.");
        return;
      }
      set({ logoUrl: source.logoUrl, logoHeight: source.logoHeight ?? 14, showLogo: true });
    } catch (err) {
      toast.error("Gagal menyalin logo", errorMessage(err));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { _id, ...rest } = t;
      const res = await api.post("/api/v1/contracts/templates", { id: _id, ...rest });
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
      title={initial._id ? `Ubah ${initial.name}` : "Template kontrak baru"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Batal</Button>
          <Button size="sm" loading={saving} onClick={save} disabled={t.name.trim().length < 3}>Simpan template</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nama template" required>
            <Input maxLength={80} value={t.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Untuk jenis kontrak">
            <Combobox value={t.type} onChange={(v) => set({ type: v as ContractType })} options={CONTRACT_TYPES.map((x) => ({ value: x.value, label: x.label }))} />
          </Field>
          <Field label="Nama penandatangan perusahaan">
            <Input maxLength={120} value={t.signerName} onChange={(e) => set({ signerName: e.target.value })} />
          </Field>
          <Field label="Jabatan penandatangan">
            <Input maxLength={120} value={t.signerTitle} onChange={(e) => set({ signerTitle: e.target.value })} />
          </Field>
          <Field label="Kota penandatanganan" hint="Kosong = nama cabang karyawan.">
            <Input maxLength={80} value={t.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <div className="sm:pt-7">
            <Toggle checked={t.isActive} onChange={(v) => set({ isActive: v })} label="Aktif" description="Nonaktif = tidak ditawarkan saat membuat kontrak." />
          </div>
        </div>

        <LogoField
          logoUrl={t.logoUrl}
          showLogo={t.showLogo}
          logoHeight={t.logoHeight}
          onChange={(patch) => set(patch)}
          extraAction={
            <Button type="button" variant="ghost" size="sm" onClick={copyPayslipLogo}>
              Salin dari slip gaji
            </Button>
          }
        />

        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: "edit", label: "Tulis" },
            { id: "preview", label: "Pratinjau dengan contoh data" },
          ]}
        />
        {view === "edit" ? (
          <>
            <PlaceholderHelp onInsert={insert} />
            <Textarea ref={ref} rows={20} className="font-mono text-body-sm" value={t.content} onChange={(e) => set({ content: e.target.value })} />
          </>
        ) : (
          <div className="bg-[#eceef4] rounded-[var(--radius-card)] p-4 overflow-x-auto">
            <div className="bg-white mx-auto shadow-sm" style={{ width: "210mm", padding: "20mm" }}>
              <ContractDocument
                content={t.content}
                values={{ ...SAMPLE, nama_perusahaan: companyName, alamat_perusahaan: companyAddress, penandatangan: t.signerName, jabatan_penandatangan: t.signerTitle, kota: t.city || "Jakarta" }}
                branding={{ companyName, companyAddress, showLogo: t.showLogo, logoUrl: t.logoUrl, logoHeight: t.logoHeight, signerName: t.signerName, signerTitle: t.signerTitle }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
