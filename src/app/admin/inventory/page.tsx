"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Boxes, Camera, ChevronDown, ClipboardCheck, Eye, FileSignature, Package, Plus, RefreshCcw, ScanLine, Search, Tag, Trash2, UserCheck, UserPlus } from "@/components/icons";
import { CameraScanner } from "@/components/inventory/CameraScanner";
import { AssetDrawer, type AssetDetail } from "@/components/inventory/AssetDrawer";
import { ChecklistEditor, ConditionPicker, Segmented, SpecFields, categoryLabel, conditionLabel, conditionTone, type Condition } from "@/components/inventory/parts";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SkeletonList, StatCard, TableWrap, Td, Textarea, Th, Tr, cn } from "@/components/ui";
import { confirmDialog } from "@/components/ui/ConfirmHost";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatPeriod, wibPeriodKey } from "@/lib/time";
import { INVENTORY_CONDITION_LABELS } from "@/lib/hr/labels";
import {
  ASSIGNMENT_STATUS_LABELS,
  DEFAULT_CATEGORIES,
  DEFAULT_TEMPLATES,
  blankChecklist,
  compareCheck,
  templateFor,
  type CategoryTemplate,
  type CheckItem,
  type SpecCheck,
  type SpecValue,
} from "@/lib/inventory/templates";

interface AssetRow {
  _id: string;
  code: string;
  name: string;
  category: string;
  condition: Condition;
  specs?: SpecValue[];
  assignment?: {
    _id: string;
    status: "pending_handover" | "active" | "disputed";
    handoverDate: string;
    employeeId?: { _id: string; name: string; employeeId?: string; divisionId?: { name: string } };
  } | null;
  lastCheck?: { auditDate: string; condition: string; status: string } | null;
  monthlyCheck?: { auditDate: string; status: string } | null;
}

interface EmployeeOption {
  _id: string;
  name: string;
  employeeId?: string;
  divisionId?: { name?: string } | null;
}

type StatusFilter = "" | "available" | "pending" | "held" | "unchecked" | "damaged" | "lost";
type ActionKind = "edit" | "assign" | "return" | "check";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "", label: "Semua status" },
  { value: "available", label: "Tersedia" },
  { value: "pending", label: "Menunggu tanda tangan" },
  { value: "held", label: "Dipegang karyawan" },
  { value: "unchecked", label: "Belum dicek bulan ini" },
  { value: "damaged", label: "Rusak" },
  { value: "lost", label: "Hilang" },
];

const FLOW_STEPS = [
  { icon: Plus, title: "Daftarkan aset", body: "Isi spesifikasi dan catat kondisi awal sebagai pembanding." },
  { icon: UserPlus, title: "Serahkan", body: "Pilih karyawan dan catat kondisi saat diserahkan." },
  { icon: FileSignature, title: "Karyawan tanda tangan", body: "Karyawan memeriksa lalu menandatangani BAST di portal." },
  { icon: ClipboardCheck, title: "Cek bulanan", body: "Bandingkan kondisi dengan kondisi awal setiap bulan." },
  { icon: RefreshCcw, title: "Terima kembali", body: "Catat kondisi saat aset dikembalikan." },
];

export default function InventoryAdminPage() {
  const toast = useToast();
  const period = wibPeriodKey();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [showFlow, setShowFlow] = useState(false);

  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [templates, setTemplates] = useState<Record<string, CategoryTemplate>>(DEFAULT_TEMPLATES);

  // The drawer and every action modal work from the same loaded detail.
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  const [action, setAction] = useState<{ kind: ActionKind; detail: AssetDetail } | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem("hris.inventory.flow") !== "hidden") queueMicrotask(() => setShowFlow(true)); } catch { queueMicrotask(() => setShowFlow(true)); }
  }, []);
  const toggleFlow = () => {
    setShowFlow((v) => {
      try { localStorage.setItem("hris.inventory.flow", v ? "hidden" : "shown"); } catch { /* private mode */ }
      return !v;
    });
  };

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<{ categories: string[]; templates: Record<string, CategoryTemplate> }>("/api/v1/inventory/categories");
      if (res.data) {
        setCategories(res.data.categories);
        setTemplates(res.data.templates);
      }
    } catch (err) {
      console.error("Gagal memuat kategori:", err);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get<unknown[]>(`/api/v1/inventory/audit?period=${period}`);
      setSummary(res.meta?.summary ?? {});
    } catch { /* the tiles simply stay empty */ }
  }, [period]);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await api.get<AssetRow[]>(`/api/v1/inventory?${params}`);
      setAssets(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setLoadError(errorMessage(err, "Daftar aset gagal dimuat."));
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchQuery, categoryFilter, statusFilter]);

  useEffect(() => {
    queueMicrotask(() => { void fetchCategories(); void fetchSummary(); });
  }, [fetchCategories, fetchSummary]);

  // Assets reload whenever the page or filters change; search waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchAssets(), searchQuery ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [fetchAssets, searchQuery]);

  const refreshAll = () => {
    void fetchAssets();
    void fetchSummary();
    setDrawerKey((k) => k + 1);
  };

  const loadDetail = async (id: string) => {
    const res = await api.get<AssetDetail>(`/api/v1/inventory/${id}`);
    if (!res.data) throw new Error("Detail aset kosong.");
    return res.data;
  };

  const startAction = async (kind: ActionKind, id: string, detail?: AssetDetail) => {
    try {
      setAction({ kind, detail: detail ?? await loadDetail(id) });
    } catch (err) {
      toast.error("Aset gagal dimuat", errorMessage(err));
    }
  };

  const cancelHandover = async (detail: AssetDetail) => {
    const ok = await confirmDialog({
      title: "Batalkan serah terima?",
      message: `${detail.asset.name} (${detail.asset.code}) kembali berstatus tersedia. Karyawan tidak lagi diminta menandatangani BAST.`,
      confirmLabel: "Batalkan serah terima",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.post("/api/v1/inventory/handover", { action: "cancel", inventoryId: detail.asset._id });
      toast.success("Serah terima dibatalkan");
      refreshAll();
    } catch (err) {
      toast.error("Gagal membatalkan", errorMessage(err));
    }
  };

  const monthlyDone = summary.monthlyDone ?? 0;
  const roundTotal = summary.totalAssets ?? 0;
  const filtered = !!(searchQuery || categoryFilter || statusFilter);

  return (
    <div>
      <PageHeader
        title="Inventaris & aset"
        description="Daftarkan aset beserta kondisi awalnya, serahkan ke karyawan dengan BAST digital, lalu cek kondisinya setiap bulan."
        actions={
          <>
            <Button variant="secondary" icon={Tag} onClick={() => setIsCategoryOpen(true)}>Kategori</Button>
            <Button variant="secondary" icon={ScanLine} onClick={() => setIsScanOpen(true)}>Pindai & cek</Button>
            <Button icon={Plus} onClick={() => setIsCreateOpen(true)}>Tambah aset</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total aset" value={summary.totalAssets ?? "–"} icon={Boxes} hint="Tidak termasuk aset hilang" />
        <StatCard label="Dipegang karyawan" value={summary.held ?? "–"} icon={UserCheck} />
        <StatCard label="Menunggu tanda tangan" value={summary.pending ?? "–"} icon={FileSignature} hint={summary.pending ? "Termasuk yang dilaporkan tidak sesuai" : undefined} />
        <StatCard
          label={`Cek ${formatPeriod(period)}`}
          value={roundTotal ? `${monthlyDone}/${roundTotal}` : "–"}
          icon={ClipboardCheck}
          delta={summary.flagged ? { value: `${summary.flagged} temuan`, tone: "down" } : undefined}
        />
      </div>

      <Card className="mb-4 overflow-hidden">
        <button type="button" onClick={toggleFlow} aria-expanded={showFlow} className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-start">
          <span className="text-body font-semibold text-heading">Alur inventaris</span>
          <ChevronDown className={cn("size-4 text-subtle transition-transform", showFlow && "rotate-180")} aria-hidden />
        </button>
        {showFlow && (
          <ol className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5">
            {FLOW_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3 rounded-2xl bg-background-secondary-default p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background-primary-default text-body-sm font-semibold text-heading shadow-xs">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-body-sm font-semibold text-heading">{step.title}</p>
                  <p className="text-label text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_14rem_14rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              aria-label="Cari kode atau nama aset"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Cari kode atau nama aset…"
              className="ps-10"
            />
          </div>
          <Select aria-label="Saring kategori" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
            <option value="">Semua kategori</option>
            {categories.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
          </Select>
          <Select aria-label="Saring status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}>
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>

        {loadError ? (
          <div className="p-4"><Alert tone="danger">{loadError}</Alert></div>
        ) : loading ? (
          <div className="p-4"><SkeletonList rows={5} /></div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtered ? "Tidak ada aset yang cocok" : "Belum ada aset terdaftar"}
            description={filtered ? "Ubah kata kunci, kategori, atau status." : "Tambahkan aset pertama beserta kondisi awalnya untuk mulai mencatat serah terima."}
            action={!filtered ? <Button icon={Plus} onClick={() => setIsCreateOpen(true)}>Tambah aset</Button> : undefined}
          />
        ) : (
          <>
            {/* Phones get one card per asset; the table needs room for its five columns. */}
            <ul className="divide-y divide-line md:hidden">
              {assets.map((asset) => (
                <li key={asset._id} className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <AssetCell asset={asset} onOpen={() => setDrawerId(asset._id)} />
                    <Badge tone={conditionTone(asset.condition)} dot>{conditionLabel(asset.condition)}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0"><p className="mb-1 text-label text-subtle">Status & pemegang</p><HolderCell asset={asset} /></div>
                    <div className="min-w-0"><p className="mb-1 text-label text-subtle">Cek {formatPeriod(period)}</p><CheckCell asset={asset} /></div>
                  </div>
                  <AssetActions asset={asset} onOpen={() => setDrawerId(asset._id)} onAction={startAction} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Aset</Th>
                    <Th>Kondisi</Th>
                    <Th>Status & pemegang</Th>
                    <Th>Cek {formatPeriod(period)}</Th>
                    <Th className="text-right">Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <Tr key={asset._id}>
                      <Td className="min-w-60"><AssetCell asset={asset} onOpen={() => setDrawerId(asset._id)} /></Td>
                      <Td><Badge tone={conditionTone(asset.condition)} dot>{conditionLabel(asset.condition)}</Badge></Td>
                      <Td><HolderCell asset={asset} /></Td>
                      <Td><CheckCell asset={asset} /></Td>
                      <Td><AssetActions asset={asset} onOpen={() => setDrawerId(asset._id)} onAction={startAction} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </>
        )}
      </Card>

      {total > 0 && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / limit))}
            total={total}
            limit={limit}
            onPage={setPage}
            onLimit={(l) => { setLimit(l); setPage(1); }}
          />
        </div>
      )}

      <AssetDrawer
        assetId={drawerId}
        refreshKey={drawerKey}
        onClose={() => setDrawerId(null)}
        onEdit={(d) => startAction("edit", d.asset._id, d)}
        onAssign={(d) => startAction("assign", d.asset._id, d)}
        onReturn={(d) => startAction("return", d.asset._id, d)}
        onCheck={(d) => startAction("check", d.asset._id, d)}
        onCancelHandover={cancelHandover}
      />

      {isCreateOpen && (
        <AssetFormModal
          categories={categories}
          templates={templates}
          onManageCategories={() => setIsCategoryOpen(true)}
          onClose={() => setIsCreateOpen(false)}
          onSaved={(id) => { setIsCreateOpen(false); refreshAll(); setDrawerId(id); toast.success("Aset ditambahkan", "Kondisi awal tersimpan sebagai pembanding pengecekan berikutnya."); }}
        />
      )}
      {action?.kind === "edit" && (
        <AssetFormModal
          detail={action.detail}
          categories={categories}
          templates={templates}
          onManageCategories={() => setIsCategoryOpen(true)}
          onClose={() => setAction(null)}
          onSaved={() => { setAction(null); refreshAll(); toast.success("Data aset diperbarui"); }}
        />
      )}
      {action?.kind === "assign" && (
        <HandoverModal
          detail={action.detail}
          template={templateFor(action.detail.asset.category, templates)}
          onClose={() => setAction(null)}
          onDone={(msg) => { setAction(null); refreshAll(); toast.success("Aset diserahkan", msg); }}
        />
      )}
      {action?.kind === "return" && (
        <ReturnModal
          detail={action.detail}
          template={templateFor(action.detail.asset.category, templates)}
          onClose={() => setAction(null)}
          onDone={(msg) => { setAction(null); refreshAll(); toast.success("Pengembalian dicatat", msg); }}
        />
      )}
      {action?.kind === "check" && (
        <CheckModal
          detail={action.detail}
          template={templateFor(action.detail.asset.category, templates)}
          period={period}
          onClose={() => setAction(null)}
          onDone={(msg, flagged) => { setAction(null); refreshAll(); if (flagged) toast.error("Pengecekan disimpan dengan temuan", msg); else toast.success("Pengecekan disimpan", msg); }}
        />
      )}
      {isScanOpen && (
        <ScanModal
          onClose={() => setIsScanOpen(false)}
          onFound={(id) => { setIsScanOpen(false); void startAction("check", id); }}
        />
      )}
      {isCategoryOpen && (
        <CategoryModal
          categories={categories}
          templates={templates}
          onClose={() => setIsCategoryOpen(false)}
          onSaved={(c, t) => { setCategories(c); setTemplates(t); setIsCategoryOpen(false); toast.success("Kategori disimpan"); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List cells (shared by the table and the phone cards)                 */
/* ------------------------------------------------------------------ */

function AssetCell({ asset, onOpen }: { asset: AssetRow; onOpen: () => void }) {
  const keySpec = asset.specs?.slice(0, 2).map((s) => s.value).join(" · ");
  return (
    <button type="button" onClick={onOpen} className="min-w-0 cursor-pointer text-start">
      <span className="block font-medium text-heading hover:text-primary">{asset.name}</span>
      <span className="block text-body-sm text-muted"><span className="font-mono">{asset.code}</span> · {categoryLabel(asset.category)}</span>
      {keySpec && <span className="block text-label text-subtle">{keySpec}</span>}
    </button>
  );
}

function HolderCell({ asset }: { asset: AssetRow }) {
  const asg = asset.assignment;
  if (!asg) {
    const isLost = asset.condition === "lost";
    return <span className={isLost ? "text-subtle" : "text-body-sm font-medium text-primary"}>{isLost ? "Tidak tersedia" : "Tersedia"}</span>;
  }
  return (
    <div className="space-y-1">
      <div className="truncate font-medium text-heading">{asg.employeeId?.name || "Karyawan"}</div>
      <Badge tone={asg.status === "active" ? "success" : asg.status === "disputed" ? "danger" : "warning"}>{ASSIGNMENT_STATUS_LABELS[asg.status]}</Badge>
    </div>
  );
}

function CheckCell({ asset }: { asset: AssetRow }) {
  if (asset.monthlyCheck) {
    return (
      <div className="space-y-1">
        <Badge tone={asset.monthlyCheck.status === "flagged" ? "danger" : "success"}>{asset.monthlyCheck.status === "flagged" ? "Ada temuan" : "Sudah dicek"}</Badge>
        <div className="text-label text-subtle">{formatDate(asset.monthlyCheck.auditDate)}</div>
      </div>
    );
  }
  return asset.condition === "lost" ? <span className="text-subtle">-</span> : <span className="text-body-sm text-warning">Belum dicek</span>;
}

function AssetActions({ asset, onOpen, onAction }: { asset: AssetRow; onOpen: () => void; onAction: (kind: ActionKind, id: string) => void }) {
  const asg = asset.assignment;
  const isLost = asset.condition === "lost";
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" aria-label={`Detail ${asset.name}`} title="Detail & riwayat" icon={Eye} onClick={onOpen} />
      {!isLost && <Button variant="ghost" size="icon" aria-label={`Cek ${asset.name}`} title="Catat pengecekan" icon={ClipboardCheck} onClick={() => onAction("check", asset._id)} />}
      {!asg && !isLost && <Button variant="ghost" size="icon" aria-label={`Serahkan ${asset.name}`} title="Serahkan ke karyawan" icon={UserPlus} onClick={() => onAction("assign", asset._id)} />}
      {asg?.status === "active" && <Button variant="ghost" size="icon" aria-label={`Terima pengembalian ${asset.name}`} title="Terima pengembalian" icon={RefreshCcw} onClick={() => onAction("return", asset._id)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                        */
/* ------------------------------------------------------------------ */

function AssetFormModal({
  detail,
  categories,
  templates,
  onManageCategories,
  onClose,
  onSaved,
}: {
  detail?: AssetDetail;
  categories: string[];
  templates: Record<string, CategoryTemplate>;
  onManageCategories: () => void;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editing = detail?.asset;
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? categories[0] ?? "other");
  const [specs, setSpecs] = useState<SpecValue[]>(editing?.specs ?? []);
  const [location, setLocation] = useState(editing?.location ?? "");
  const [acquiredAt, setAcquiredAt] = useState(editing?.acquiredAt ? String(editing.acquiredAt).slice(0, 10) : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const template = templateFor(category, templates);
  const [condition, setCondition] = useState<Condition>("good");
  const [checklist, setChecklist] = useState<CheckItem[]>(() => blankChecklist(template));
  const [reading, setReading] = useState("");
  const [initialNotes, setInitialNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const changeCategory = (next: string) => {
    setCategory(next);
    if (!editing) setChecklist(blankChecklist(templateFor(next, templates), checklist));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { name, category, specs, location, notes, acquiredAt: acquiredAt || null };
      if (editing) body.id = editing._id;
      else Object.assign(body, { code, initialCondition: condition, initialChecklist: checklist, initialReading: reading || null, initialNotes });
      const res = await api.post<{ _id: string }>("/api/v1/inventory", body);
      onSaved(res.data?._id ?? editing?._id ?? "");
    } catch (err) {
      setError(errorMessage(err, "Data aset gagal disimpan."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? "Ubah data aset" : "Tambah aset"}
      description={editing ? "Kondisi aset diubah lewat pengecekan, serah terima, atau pengembalian agar selalu tercatat." : "Isi spesifikasi sesuai kategori lalu catat kondisi awal. Kondisi awal menjadi pembanding setiap pengecekan bulanan."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="asset-form" loading={saving}>{editing ? "Simpan perubahan" : "Tambah aset"}</Button>
        </>
      }
    >
      <form id="asset-form" onSubmit={submit} className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}
        <section className="space-y-4">
          <h3 className="form-section">1. Identitas aset</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Kode aset" required hint={editing ? "Kode tidak dapat diubah karena tercetak di label barcode." : "Unik, dicetak sebagai barcode. Contoh: AST-LAP-001."}>
              <Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!!editing} placeholder="AST-LAP-001" className="font-mono" maxLength={40} />
            </Field>
            <Field label="Kategori" required>
              <Select aria-label="Kategori" required value={category} onChange={(e) => changeCategory(e.target.value)}>
                {categories.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Nama barang" required>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Pro 14 M3" maxLength={150} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Lokasi penyimpanan">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Gudang lantai 2" maxLength={150} />
            </Field>
            <Field label="Tanggal perolehan">
              <DatePicker value={acquiredAt} onChange={setAcquiredAt} clearable aria-label="Tanggal perolehan" />
            </Field>
          </div>
          <button type="button" onClick={onManageCategories} className="cursor-pointer text-body-sm font-medium text-primary hover:underline">
            Kategori belum ada? Kelola kategori
          </button>
        </section>

        <section className="space-y-3">
          <h3 className="form-section">2. Spesifikasi {categoryLabel(category).toLowerCase()}</h3>
          <SpecFields labels={template.specs} values={specs} onChange={setSpecs} />
          <Field label="Catatan aset">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Garansi sampai Desember 2027, termasuk tas" maxLength={1000} />
          </Field>
        </section>

        {!editing && (
          <section className="space-y-3">
            <div>
              <h3 className="form-section">3. Kondisi awal</h3>
              <p className="text-body-sm text-muted">Periksa aset sekarang. Hasil ini disimpan permanen sebagai kondisi awal.</p>
            </div>
            <ConditionPicker value={condition} onChange={setCondition} allowLost={false} label="Kondisi awal" />
            <ChecklistEditor items={checklist} onChange={setChecklist} />
            {template.reading && (
              <Field label={template.reading}>
                <Input type="number" min={0} inputMode="numeric" value={reading} onChange={(e) => setReading(e.target.value)} />
              </Field>
            )}
            <Field label="Catatan kondisi awal">
              <Textarea rows={2} value={initialNotes} onChange={(e) => setInitialNotes(e.target.value)} placeholder="Contoh: baret halus di casing bawah sejak dibeli" maxLength={1000} />
            </Field>
          </section>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Handover and return                                                  */
/* ------------------------------------------------------------------ */

/** The first list that actually has rows; older records store an empty array. */
const firstFilled = (...lists: Array<CheckItem[] | null | undefined>) => lists.find((l) => l && l.length) ?? null;

function latestChecklist(detail: AssetDetail): CheckItem[] | null {
  return firstFilled(...detail.checks.map((c) => c.checklist), detail.asset.initialCheck?.checklist);
}

function HandoverModal({ detail, template, onClose, onDone }: { detail: AssetDetail; template: CategoryTemplate; onClose: () => void; onDone: (msg: string) => void }) {
  const asset = detail.asset;
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [condition, setCondition] = useState<Condition>(asset.condition === "damaged" ? "damaged" : "good");
  const [checklist, setChecklist] = useState<CheckItem[]>(() => blankChecklist(template, latestChecklist(detail)));
  const [reading, setReading] = useState(detail.checks.find((c) => c.reading != null)?.reading?.toString() ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<EmployeeOption[]>("/api/v1/inventory/employees")
      .then((res) => setEmployees(res.data ?? []))
      .catch((err) => setError(errorMessage(err, "Daftar karyawan gagal dimuat.")));
  }, []);

  const options = useMemo(() => employees.map((e) => ({
    value: e._id,
    label: e.name,
    hint: [e.employeeId, e.divisionId?.name].filter(Boolean).join(" · ") || undefined,
  })), [employees]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/v1/inventory/handover", { action: "assign", inventoryId: asset._id, employeeId, condition, checklist, reading: reading || null, notes });
      onDone(res.message ?? "");
    } catch (err) {
      setError(errorMessage(err, "Aset gagal diserahkan."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Serahkan aset ke karyawan"
      description="Catat kondisi aset saat diserahkan. Karyawan memeriksa catatan ini lalu menandatangani BAST di portal, atau melaporkan bila tidak sesuai."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving} disabled={!employeeId}>Serahkan & minta tanda tangan</Button>
        </>
      }
    >
      <div className="space-y-5">
        <AssetSummary detail={detail} />
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Karyawan penerima" required>
          <Combobox value={employeeId} onChange={setEmployeeId} options={options} placeholder="Cari nama atau nomor karyawan…" sheetTitle="Karyawan penerima" aria-label="Karyawan penerima" />
        </Field>
        <section className="space-y-3">
          <h3 className="text-body font-semibold text-heading">Kondisi saat diserahkan</h3>
          <ConditionPicker value={condition} onChange={setCondition} allowLost={false} />
          <ChecklistEditor items={checklist} onChange={setChecklist} baseline={asset.initialCheck?.checklist} />
          {template.reading && (
            <Field label={template.reading}>
              <Input type="number" min={0} inputMode="numeric" value={reading} onChange={(e) => setReading(e.target.value)} />
            </Field>
          )}
          <Field label="Kelengkapan & catatan serah terima">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: termasuk charger 65W dan tas laptop" maxLength={500} />
          </Field>
        </section>
      </div>
    </Modal>
  );
}

function ReturnModal({ detail, template, onClose, onDone }: { detail: AssetDetail; template: CategoryTemplate; onClose: () => void; onDone: (msg: string) => void }) {
  const asset = detail.asset;
  const held = detail.assignments.find((a) => a.status === "active");
  const [condition, setCondition] = useState<Condition>(asset.condition as Condition);
  const [checklist, setChecklist] = useState<CheckItem[]>(() => blankChecklist(template, firstFilled(held?.handoverChecklist, latestChecklist(detail))));
  const [reading, setReading] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/v1/inventory/handover", { action: "return", inventoryId: asset._id, condition, checklist, reading: reading || null, notes });
      onDone(res.message ?? "");
    } catch (err) {
      setError(errorMessage(err, "Pengembalian gagal dicatat."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Terima pengembalian aset"
      description="Periksa aset yang dikembalikan dan bandingkan dengan kondisi saat diserahkan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>Catat pengembalian</Button>
        </>
      }
    >
      <div className="space-y-5">
        <AssetSummary detail={detail} />
        {held && (
          <p className="text-body-sm text-muted">
            Dipegang <span className="font-medium text-heading">{held.employeeId?.name}</span> sejak {formatDate(held.signedAt ?? held.handoverDate)}, diserahkan dalam kondisi {conditionLabel(held.handoverCondition)}.
          </p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <ConditionPicker value={condition} onChange={setCondition} />
        {held?.handoverCondition && condition !== held.handoverCondition && (
          <Alert tone="warning">Kondisi berbeda dari saat diserahkan ({conditionLabel(held.handoverCondition)}). Jelaskan penyebabnya di catatan.</Alert>
        )}
        <ChecklistEditor items={checklist} onChange={setChecklist} baseline={firstFilled(held?.handoverChecklist, asset.initialCheck?.checklist)} />
        {template.reading && (
          <Field label={template.reading} hint={held?.handoverReading != null ? `Saat diserahkan: ${held.handoverReading.toLocaleString("id-ID")}` : undefined}>
            <Input type="number" min={0} inputMode="numeric" value={reading} onChange={(e) => setReading(e.target.value)} />
          </Field>
        )}
        <Field label="Catatan pengembalian">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: charger tidak dikembalikan" maxLength={500} />
        </Field>
      </div>
    </Modal>
  );
}

function AssetSummary({ detail }: { detail: AssetDetail }) {
  const a = detail.asset;
  return (
    <div className="rounded-2xl bg-background-secondary-default p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-semibold text-heading">{a.name}</p>
          <p className="mt-0.5 text-body-sm text-muted"><span className="font-mono">{a.code}</span> · {categoryLabel(a.category)}</p>
        </div>
        <Badge tone={conditionTone(a.condition)} dot>{conditionLabel(a.condition)}</Badge>
      </div>
      {a.specs && a.specs.length > 0 && (
        <p className="mt-2 text-label text-subtle">{a.specs.map((s) => `${s.label}: ${s.value}`).join(" · ")}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checks                                                               */
/* ------------------------------------------------------------------ */

function CheckModal({ detail, template, period, onClose, onDone }: { detail: AssetDetail; template: CategoryTemplate; period: string; onClose: () => void; onDone: (msg: string, flagged: boolean) => void }) {
  const asset = detail.asset;
  const doneThisMonth = detail.checks.some((c) => c.type === "monthly" && c.period === period);
  const previous = detail.checks.find((c) => c.type !== "initial") ?? null;
  const baseline = asset.initialCheck ?? detail.checks.find((c) => c.type === "initial") ?? null;
  const lastReading = detail.checks.find((c) => c.reading != null)?.reading ?? null;

  const [type, setType] = useState<"monthly" | "incidental">(doneThisMonth ? "incidental" : "monthly");
  const [condition, setCondition] = useState<Condition>(asset.condition as Condition);
  const [checklist, setChecklist] = useState<CheckItem[]>(() => blankChecklist(template, firstFilled(previous?.checklist, baseline?.checklist)));
  const [specChecks, setSpecChecks] = useState<SpecCheck[]>(() => (asset.specs ?? []).map((s) => ({ label: s.label, expected: s.value, matches: true })));
  const [reading, setReading] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const findings = compareCheck({ condition, checklist, specChecks }, baseline, INVENTORY_CONDITION_LABELS);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ status: string }>("/api/v1/inventory/audit", { inventoryId: asset._id, type, condition, checklist, specChecks, reading: reading || null, notes });
      onDone(res.message ?? "", res.data?.status === "flagged");
    } catch (err) {
      setError(errorMessage(err, "Pengecekan gagal disimpan."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Catat pengecekan aset"
      description="Periksa aset secara fisik. Setiap poin dibandingkan dengan kondisi awal dan pengecekan terakhir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>Simpan pengecekan</Button>
        </>
      }
    >
      <div className="space-y-5">
        <AssetSummary detail={detail} />
        {error && <Alert tone="danger">{error}</Alert>}

        <section className="space-y-2">
          <h3 className="text-body font-semibold text-heading">Jenis pengecekan</h3>
          <Segmented
            label="Jenis pengecekan"
            value={type}
            onChange={setType}
            options={[
              { value: "monthly", label: `Bulanan · ${formatPeriod(period)}` },
              { value: "incidental", label: "Insidental" },
            ]}
          />
          {doneThisMonth && type === "monthly" && <Alert tone="warning">Pengecekan bulanan untuk aset ini sudah ada. Pilih insidental untuk mencatat pengecekan ulang.</Alert>}
        </section>

        <section className="grid grid-cols-1 gap-3 rounded-2xl bg-background-secondary-default p-4 sm:grid-cols-2">
          <div>
            <p className="text-label text-subtle">Kondisi awal</p>
            <p className="text-body font-medium text-heading">{baseline ? conditionLabel(baseline.condition) : "Belum dicatat"}</p>
          </div>
          <div>
            <p className="text-label text-subtle">Pengecekan terakhir</p>
            <p className="text-body font-medium text-heading">{previous ? `${conditionLabel(previous.condition)} · ${formatDate(previous.auditDate)}` : "Belum pernah"}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-body font-semibold text-heading">Kondisi sekarang</h3>
          <ConditionPicker value={condition} onChange={setCondition} />
          <ChecklistEditor items={checklist} onChange={setChecklist} baseline={baseline?.checklist} previous={previous?.checklist} />
          {template.reading && (
            <Field label={template.reading} hint={lastReading != null ? `Pembacaan terakhir: ${lastReading.toLocaleString("id-ID")}` : undefined}>
              <Input type="number" min={0} inputMode="numeric" value={reading} onChange={(e) => setReading(e.target.value)} />
            </Field>
          )}
        </section>

        {specChecks.length > 0 && (
          <section className="space-y-3">
            <div>
              <h3 className="text-body font-semibold text-heading">Cocokkan spesifikasi</h3>
              <p className="text-body-sm text-muted">Pastikan nomor seri dan komponen masih sama dengan catatan.</p>
            </div>
            <ul className="divide-y divide-line rounded-2xl bg-background-secondary-default">
              {specChecks.map((s, i) => (
                <li key={s.label} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-label text-subtle">{s.label}</p>
                      <p className="break-words text-body text-heading">{s.expected}</p>
                    </div>
                    <Segmented
                      size="sm"
                      label={`Spesifikasi ${s.label}`}
                      value={s.matches ? "yes" : "no"}
                      onChange={(v) => setSpecChecks(specChecks.map((x, idx) => (idx === i ? { ...x, matches: v === "yes" } : x)))}
                      options={[
                        { value: "yes", label: "Sesuai", tone: "bg-success-soft text-success" },
                        { value: "no", label: "Tidak sesuai", tone: "bg-danger-soft text-danger" },
                      ]}
                    />
                  </div>
                  {!s.matches && (
                    <Input
                      aria-label={`Temuan ${s.label}`}
                      value={s.note ?? ""}
                      maxLength={300}
                      onChange={(e) => setSpecChecks(specChecks.map((x, idx) => (idx === i ? { ...x, note: e.target.value } : x)))}
                      placeholder="Yang ditemukan, misalnya: RAM terpasang 8 GB"
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Field label="Catatan pemeriksa">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contoh: layar lecet ringan, adaptor hilang" maxLength={1000} />
        </Field>

        <div className={cn("rounded-2xl p-4", findings.length ? "bg-warning-soft" : "bg-success-soft")}>
          <p className={cn("text-body font-semibold", findings.length ? "text-warning" : "text-success")}>
            {findings.length ? `${findings.length} perbedaan dari kondisi awal` : "Sesuai kondisi awal"}
          </p>
          {findings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-body-sm text-foreground">
              {findings.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ScanModal({ onClose, onFound }: { onClose: () => void; onFound: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Hardware scanners type into the focused field; the camera is optional.
  const [mode, setMode] = useState<"device" | "camera">("device");
  useEffect(() => {
    try { if (localStorage.getItem("hris.inventory.scanMode") === "camera") queueMicrotask(() => setMode("camera")); } catch { /* private mode */ }
  }, []);
  const chooseMode = (next: "device" | "camera") => {
    setMode(next);
    try { localStorage.setItem("hris.inventory.scanMode", next); } catch { /* private mode */ }
  };

  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch { /* audio is a nicety */ }
  };

  const lookup = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      // Looked up on the server: the asset may be on a page that is not loaded.
      const res = await api.get<AssetRow[]>(`/api/v1/inventory?code=${encodeURIComponent(value)}&limit=1`);
      const found = res.data?.[0];
      if (!found) setError(`Aset dengan kode "${value}" tidak terdaftar.`);
      else if (found.condition === "lost") setError(`${found.name} tercatat hilang. Ubah lewat detail aset bila sudah ditemukan.`);
      else { playBeep(); onFound(found._id); }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Pindai & cek aset" description="Pindai label barcode atau ketik kode aset untuk membuka formulir pengecekan." footer={<Button variant="secondary" onClick={onClose}>Tutup</Button>}>
      <div className="space-y-4">
        <Segmented
          label="Cara memindai"
          value={mode}
          onChange={chooseMode}
          options={[{ value: "device", label: "Scanner atau ketik" }, { value: "camera", label: "Kamera" }]}
        />
        <form onSubmit={(e) => { e.preventDefault(); void lookup(code); }} className="flex gap-2">
          <Input aria-label="Kode aset" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus={mode === "device"} placeholder="Pindai barcode atau ketik kode aset…" className="font-mono" />
          <Button type="submit" variant="secondary" icon={Search} loading={busy}>Cari</Button>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
        {mode === "camera" ? (
          <CameraScanner paused={busy} onDetected={(c) => { setCode(c); void lookup(c); }} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-background-secondary-default px-5 py-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-background-primary-default text-subtle shadow-xs"><ScanLine className="size-6" aria-hidden /></span>
            <p className="max-w-sm text-body-sm text-muted">Scanner USB atau Bluetooth bekerja seperti keyboard: klik kolom di atas, lalu pindai label. Kode juga dapat diketik manual.</p>
            <span className="inline-flex items-center gap-1.5 text-label text-subtle"><Camera className="size-3.5" aria-hidden /> Pilih “Kamera” untuk memindai dengan kamera perangkat.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Categories                                                           */
/* ------------------------------------------------------------------ */

const linesOf = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function CategoryModal({
  categories,
  templates,
  onClose,
  onSaved,
}: {
  categories: string[];
  templates: Record<string, CategoryTemplate>;
  onClose: () => void;
  onSaved: (categories: string[], templates: Record<string, CategoryTemplate>) => void;
}) {
  const [draft, setDraft] = useState<string[]>(categories);
  const [tpl, setTpl] = useState<Record<string, CategoryTemplate>>(templates);
  const [open, setOpen] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const add = () => {
    const value = newCategory.trim().slice(0, 40);
    if (!value) return;
    if (draft.some((c) => c.toLowerCase() === value.toLowerCase() || categoryLabel(c).toLowerCase() === value.toLowerCase())) {
      setError(`Kategori "${value}" sudah ada.`);
      return;
    }
    setDraft([...draft, value]);
    setTpl({ ...tpl, [value]: templateFor(value, tpl) });
    setOpen(value);
    setNewCategory("");
    setError("");
  };

  const patch = (key: string, change: Partial<CategoryTemplate>) => setTpl({ ...tpl, [key]: { ...templateFor(key, tpl), ...change } });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ categories: string[]; templates: Record<string, CategoryTemplate> }>("/api/v1/inventory/categories", {
        categories: draft,
        // Lines are kept raw while typing; blank ones are dropped here.
        templates: Object.fromEntries(draft.map((c) => {
          const t = templateFor(c, tpl);
          return [c, { specs: linesOf(t.specs.join("\n")), checklist: linesOf(t.checklist.join("\n")), reading: t.reading.trim() }];
        })),
      });
      if (res.data) onSaved(res.data.categories, res.data.templates);
    } catch (err) {
      setError(errorMessage(err, "Kategori gagal disimpan."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Kategori aset"
      description="Setiap kategori punya kolom spesifikasi dan daftar periksa sendiri. Daftar periksa dipakai saat kondisi awal, serah terima, pengecekan bulanan, dan pengembalian."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={save} loading={saving} disabled={!draft.length}>Simpan kategori</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input aria-label="Nama kategori baru" value={newCategory} maxLength={40} onChange={(e) => setNewCategory(e.target.value)} placeholder="Contoh: Furnitur" />
          <Button type="submit" variant="secondary" icon={Plus} disabled={!newCategory.trim()}>Tambah</Button>
        </form>
        <ul className="divide-y divide-line rounded-2xl bg-background-secondary-default">
          {draft.map((cat) => {
            const t = templateFor(cat, tpl);
            const expanded = open === cat;
            return (
              <li key={cat} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setOpen(expanded ? null : cat)} aria-expanded={expanded} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-start">
                    <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform", expanded && "rotate-180")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-heading">{categoryLabel(cat)}</span>
                      <span className="block text-label text-subtle">{linesOf(t.specs.join("\n")).length} spesifikasi · {linesOf(t.checklist.join("\n")).length} poin periksa{t.reading ? ` · ${t.reading}` : ""}</span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    icon={Trash2}
                    aria-label={`Hapus kategori ${categoryLabel(cat)}`}
                    disabled={draft.length <= 1}
                    onClick={() => setDraft(draft.filter((c) => c !== cat))}
                  />
                </div>
                {expanded && (
                  <div className="mt-3 grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2">
                    <Field label="Kolom spesifikasi" hint="Satu per baris, misalnya Nomor seri.">
                      <Textarea rows={5} value={t.specs.join("\n")} onChange={(e) => patch(cat, { specs: e.target.value.split("\n") })} />
                    </Field>
                    <Field label="Daftar periksa" hint="Satu poin per baris, dicek setiap pengecekan.">
                      <Textarea rows={5} value={t.checklist.join("\n")} onChange={(e) => patch(cat, { checklist: e.target.value.split("\n") })} />
                    </Field>
                    <Field label="Angka yang dibaca setiap cek (opsional)" hint="Contoh: Odometer (km). Kosongkan bila tidak ada." className="sm:col-span-2">
                      <Input value={t.reading} maxLength={40} onChange={(e) => patch(cat, { reading: e.target.value })} />
                    </Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-label text-subtle">Aset lama tetap menyimpan kategori dan spesifikasinya walau kategori dihapus.</p>
      </div>
    </Modal>
  );
}
