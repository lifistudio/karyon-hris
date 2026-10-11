"use client";

import React, { useState, useEffect } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { Package, Search, Plus, Edit, Trash2, UserPlus, RefreshCcw, Camera, ScanLine, Tag } from "@/components/icons";
import { CameraScanner } from "@/components/inventory/CameraScanner";
import { generateCode39Svg } from "@/lib/barcode";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SkeletonList, TableWrap, Td, Textarea, Th, Tr, cn } from "@/components/ui";
import { confirmDialog } from "@/components/ui/ConfirmHost";
import { INVENTORY_CATEGORY_LABELS, INVENTORY_CONDITION_LABELS } from "@/lib/hr/labels";

/** Built-in keys keep their Indonesian label; custom categories are stored as typed. */
const categoryLabel = (key: string) => INVENTORY_CATEGORY_LABELS[key] ?? key;

interface Employee {
  _id: string;
  name: string;
  NIK: string;
}

interface InventoryAsset {
  _id: string;
  code: string;
  name: string;
  category: string;
  condition: "good" | "damaged" | "lost";
  assignment?: {
    _id: string;
    employeeId?: {
      _id: string;
      name: string;
      NIK: string;
      divisionId?: { name: string };
      positionId?: { name: string };
    };
    handoverDate: string;
    signatureUrl?: string;
    status: "pending_handover" | "active" | "returned";
  };
}

export default function InventoryAdminPage() {
  const [assets, setAssets] = useState<InventoryAsset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<InventoryAsset | null>(null);
  const [signatureModalUrl, setSignatureModalUrl] = useState<string | null>(null);

  // Audit fields
  const [auditAsset, setAuditAsset] = useState<InventoryAsset | null>(null);
  const [auditCondition, setAuditCondition] = useState<"good" | "damaged" | "lost">("good");
  const [auditNotes, setAuditNotes] = useState("");
  const [scanInputCode, setScanInputCode] = useState("");
  const [scanError, setScanError] = useState("");
  // Hardware scanners type into the focused field; the camera is optional.
  const [scanMode, setScanMode] = useState<"device" | "camera">("device");
  useEffect(() => {
    try { if (localStorage.getItem("hris.inventory.scanMode") === "camera") queueMicrotask(() => setScanMode("camera")); } catch { /* private mode */ }
  }, []);
  const chooseScanMode = (mode: "device" | "camera") => {
    setScanMode(mode);
    try { localStorage.setItem("hris.inventory.scanMode", mode); } catch { /* private mode */ }
  };

  // Form fields
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<string>("laptop");
  const [formCondition, setFormCondition] = useState<"good" | "damaged" | "lost">("good");
  const [assignEmployeeId, setAssignEmployeeId] = useState("");

  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [categories, setCategories] = useState<string[]>(["laptop", "phone", "vehicle", "other"]);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [categoryError, setCategoryError] = useState("");

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/v1/settings/categories");
      const data = await res.json();
      if (data.success && data.data) {
        setCategories(data.data);
        if (data.data.length > 0 && !selectedAsset) {
          setFormCategory(data.data[0]);
        }
      }
    } catch (err) {
      console.error("Gagal memuat kategori settings:", err);
    }
  };

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      const res = await fetch(`/api/v1/inventory?${params}`);
      const data = await res.json();
      if (data.success) {
        setAssets(data.data || []);
        setTotal(data.meta?.total ?? 0);
      }
    } catch (err) {
      console.error("Gagal memuat aset:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/v1/employees");
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data || []);
      }
    } catch (err) {
      console.error("Gagal memuat karyawan:", err);
    }
  };

  useEffect(() => {
    fetchEmployees();
    fetchCategories();
  }, []);

  // Assets reload from the server whenever the page or filters change; search
  // waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchAssets(), searchQuery ? 350 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, searchQuery, categoryFilter]);

  const handleOpenForm = (asset: InventoryAsset | null = null) => {
    setErrorMsg("");
    setSuccessMsg("");
    if (asset) {
      setSelectedAsset(asset);
      setFormCode(asset.code);
      setFormName(asset.name);
      setFormCategory(asset.category);
      setFormCondition(asset.condition);
    } else {
      setSelectedAsset(null);
      setFormCode("");
      setFormName("");
      setFormCategory(categories[0] ?? "other");
      setFormCondition("good");
    }
    setIsFormOpen(true);
  };

  const handleOpenAssign = (asset: InventoryAsset) => {
    setErrorMsg("");
    setSuccessMsg("");
    setSelectedAsset(asset);
    setAssignEmployeeId(asset.assignment?.employeeId?._id || "");
    setIsAssignOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedAsset?._id,
          code: formCode,
          name: formName,
          category: formCategory,
          condition: formCondition
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(selectedAsset ? "Aset berhasil diperbarui!" : "Aset baru berhasil ditambahkan!");
        fetchAssets();
        setTimeout(() => setIsFormOpen(false), 800);
      } else {
        setErrorMsg(data.message || "Gagal menyimpan data aset");
      }
    } catch (err) {
      setErrorMsg("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedAsset._id,
          employeeId: assignEmployeeId
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Aset berhasil ditugaskan!");
        fetchAssets();
        setTimeout(() => setIsAssignOpen(false), 800);
      } else {
        setErrorMsg(data.message || "Gagal menugaskan aset");
      }
    } catch (err) {
      setErrorMsg("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnAsset = async (asset: InventoryAsset) => {
    if (!await confirmDialog({ title: "Terima pengembalian aset?", message: `${asset.name} (${asset.code}) dicatat sudah dikembalikan dan kembali tersedia.`, confirmLabel: "Terima pengembalian", tone: "primary" })) return;
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: asset._id,
          action: "return"
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchAssets();
      } else {
        setErrorMsg(data.message || "Pengembalian aset gagal dicatat. Muat ulang halaman lalu coba lagi.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const playBeep = () => {
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error(e);
    }
  };

  const handleScanSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookupCode(scanInputCode);
  };

  const lookupCode = async (raw: string) => {
    setScanError("");
    const code = raw.trim();
    if (!code) return;

    // Looked up on the server: the asset may be on a page that is not loaded.
    let found: InventoryAsset | undefined;
    try {
      const res = await fetch(`/api/v1/inventory?code=${encodeURIComponent(code)}&limit=1`);
      const data = await res.json();
      found = data.success ? (data.data?.[0] as InventoryAsset | undefined) : undefined;
    } catch {
      found = undefined;
    }
    if (found) {
      playBeep();
      setAuditAsset(found);
      setAuditCondition(found.condition);
      setScanError("");
    } else {
      setScanError(`Aset dengan kode "${code}" tidak terdaftar`);
      setAuditAsset(null);
    }
  };

  const handleSaveAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auditAsset) return;
    setSubmitting(true);
    setScanError("");

    try {
      const res = await fetch("/api/v1/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryId: auditAsset._id,
          condition: auditCondition,
          notes: auditNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Laporan audit berhasil disimpan!");
        fetchAssets();
        setTimeout(() => {
          setIsAuditOpen(false);
          setAuditAsset(null);
          setAuditNotes("");
          setScanInputCode("");
          setSuccessMsg("");
        }, 1000);
      } else {
        setScanError(data.message || "Gagal menyimpan laporan audit");
      }
    } catch (err) {
      setScanError("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const conditionTone = (c: string) => (c === "good" ? "success" : c === "damaged" ? "warning" : "danger") as "success" | "warning" | "danger";

  const openCategories = () => {
    setCategoryDraft(categories);
    setNewCategory("");
    setCategoryError("");
    setIsCategoryOpen(true);
  };

  const addDraftCategory = () => {
    const value = newCategory.trim();
    if (!value) return;
    if (categoryDraft.some((c) => c.toLowerCase() === value.toLowerCase() || categoryLabel(c).toLowerCase() === value.toLowerCase())) {
      setCategoryError(`Kategori "${value}" sudah ada`);
      return;
    }
    setCategoryDraft([...categoryDraft, value.slice(0, 40)]);
    setNewCategory("");
    setCategoryError("");
  };

  const saveCategories = async () => {
    setSubmitting(true);
    setCategoryError("");
    try {
      const res = await fetch("/api/v1/settings/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: categoryDraft }),
      });
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
        setIsCategoryOpen(false);
      } else {
        setCategoryError(data.message || "Kategori gagal disimpan");
      }
    } catch {
      setCategoryError("Koneksi terputus. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const closeAudit = () => {
    setIsAuditOpen(false);
    setAuditAsset(null);
  };

  return (
    <div>
      <PageHeader
        title="Inventaris & aset"
        description="Kelola daftar aset kantor, serah terima BAST digital, dan pemegang setiap barang."
        actions={
          <>
            <Button variant="secondary" icon={Tag} onClick={openCategories}>Kategori</Button>
            <Button
              variant="secondary"
              icon={ScanLine}
              onClick={() => {
                setScanInputCode("");
                setScanError("");
                setAuditAsset(null);
                setAuditNotes("");
                setIsAuditOpen(true);
              }}
            >
              Pindai & audit
            </Button>
            <Button icon={Plus} onClick={() => handleOpenForm(null)}>Tambah aset</Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              aria-label="Cari kode atau nama aset"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Cari kode atau nama aset…"
              className="ps-10"
            />
          </div>
          <Select
            aria-label="Saring kategori"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{categoryLabel(cat)}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <div className="p-4"><SkeletonList rows={5} /></div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon={Package}
            title={searchQuery || categoryFilter ? "Tidak ada aset yang cocok" : "Belum ada aset terdaftar"}
            description={searchQuery || categoryFilter ? "Ubah kata kunci atau kategori pencarian." : "Tambahkan aset pertama untuk mulai mencatat serah terima."}
            action={!searchQuery && !categoryFilter ? <Button icon={Plus} onClick={() => handleOpenForm(null)}>Tambah aset</Button> : undefined}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Kode aset</Th>
                <Th>Nama barang</Th>
                <Th>Kategori</Th>
                <Th>Kondisi</Th>
                <Th>Pemegang</Th>
                <Th className="text-right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const isAssigned = asset.assignment && (asset.assignment.status === "active" || asset.assignment.status === "pending_handover");
                return (
                  <Tr key={asset._id}>
                    <Td>
                      <div className="font-mono text-body-sm font-semibold text-heading">{asset.code}</div>
                      <div className="mt-1 h-5 w-28 opacity-80 dark:invert" dangerouslySetInnerHTML={{ __html: generateCode39Svg(asset.code).svg }} />
                    </Td>
                    <Td className="font-medium text-heading">{asset.name}</Td>
                    <Td className="text-muted">{categoryLabel(asset.category)}</Td>
                    <Td><Badge tone={conditionTone(asset.condition)} dot>{INVENTORY_CONDITION_LABELS[asset.condition] ?? asset.condition}</Badge></Td>
                    <Td>
                      {isAssigned ? (
                        <div className="space-y-1">
                          <div className="font-medium text-heading">{asset.assignment?.employeeId?.name || "Karyawan"}</div>
                          <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted">
                            <Badge tone={asset.assignment?.status === "active" ? "success" : "warning"}>
                              {asset.assignment?.status === "active" ? "Aktif" : "Menunggu BAST"}
                            </Badge>
                            {asset.assignment?.signatureUrl && (
                              <button
                                type="button"
                                onClick={() => setSignatureModalUrl(asset.assignment?.signatureUrl || null)}
                                className="cursor-pointer text-primary hover:underline"
                              >
                                Lihat tanda tangan
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-subtle">Belum ditugaskan</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Ubah ${asset.name}`} title="Ubah aset" icon={Edit} onClick={() => handleOpenForm(asset)} />
                        <Button variant="ghost" size="icon" aria-label={`Tugaskan ${asset.name}`} title="Tugaskan aset" icon={UserPlus} disabled={asset.condition === "lost"} onClick={() => handleOpenAssign(asset)} />
                        {isAssigned && (
                          <Button variant="ghost" size="icon" aria-label={`Terima pengembalian ${asset.name}`} title="Terima pengembalian" icon={RefreshCcw} onClick={() => handleReturnAsset(asset)} />
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
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
            onLimit={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Asset form */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={selectedAsset ? "Ubah aset" : "Tambah aset"}
        description="Kode aset dicetak sebagai barcode dan dipakai saat audit fisik."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsFormOpen(false)}>Batal</Button>
            <Button type="submit" form="asset-form" loading={submitting}>{selectedAsset ? "Simpan perubahan" : "Tambah aset"}</Button>
          </>
        }
      >
        <form id="asset-form" onSubmit={handleSaveAsset} className="space-y-4">
          {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}
          {successMsg && <Alert tone="success">{successMsg}</Alert>}
          <Field label="Kode aset" required hint={selectedAsset ? "Kode tidak dapat diubah setelah aset dibuat." : "Harus unik, misalnya AST-LAP-001."}>
            <Input required value={formCode} onChange={(e) => setFormCode(e.target.value)} disabled={!!selectedAsset} placeholder="AST-LAP-001" className="font-mono" />
          </Field>
          <Field label="Nama barang atau spesifikasi" required>
            <Input required value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="MacBook Pro M2 16 GB" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Kategori" required>
              <Select aria-label="Kategori" required value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                {categories.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
              </Select>
            </Field>
            <Field label="Kondisi" required>
              <Select aria-label="Kondisi" required value={formCondition} onChange={(e) => setFormCondition(e.target.value as "good" | "damaged" | "lost")}>
                <option value="good">Baik</option>
                <option value="damaged">Rusak</option>
                <option value="lost">Hilang</option>
              </Select>
            </Field>
          </div>
          <button type="button" onClick={openCategories} className="cursor-pointer text-body-sm font-medium text-primary hover:underline">
            Kategori belum ada? Kelola kategori
          </button>
        </form>
      </Modal>

      {/* Category manager */}
      <Modal
        open={isCategoryOpen}
        onClose={() => setIsCategoryOpen(false)}
        title="Kategori aset"
        description="Tambah, ganti nama tampilan, atau hapus kategori. Aset lama tetap menyimpan kategorinya."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCategoryOpen(false)}>Batal</Button>
            <Button onClick={saveCategories} loading={submitting} disabled={!categoryDraft.length}>Simpan kategori</Button>
          </>
        }
      >
        <div className="space-y-4">
          {categoryError && <Alert tone="danger">{categoryError}</Alert>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addDraftCategory();
            }}
          >
            <Input aria-label="Nama kategori baru" value={newCategory} maxLength={40} onChange={(e) => setNewCategory(e.target.value)} placeholder="Contoh: Furnitur" />
            <Button type="submit" variant="secondary" icon={Plus} disabled={!newCategory.trim()}>Tambah</Button>
          </form>
          <ul className="divide-y divide-line rounded-2xl bg-background-secondary-default px-4">
            {categoryDraft.map((cat) => (
              <li key={cat} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-body text-heading">{categoryLabel(cat)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  icon={Trash2}
                  aria-label={`Hapus kategori ${categoryLabel(cat)}`}
                  disabled={categoryDraft.length <= 1}
                  onClick={() => setCategoryDraft(categoryDraft.filter((c) => c !== cat))}
                />
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      {/* Assign */}
      <Modal
        open={isAssignOpen && !!selectedAsset}
        onClose={() => setIsAssignOpen(false)}
        title="Tugaskan aset"
        description="Karyawan menerima permintaan tanda tangan BAST di portal."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsAssignOpen(false)}>Batal</Button>
            <Button onClick={handleAssignAsset} loading={submitting} disabled={!assignEmployeeId}>Tugaskan</Button>
          </>
        }
      >
        {selectedAsset && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-background-secondary-default p-4">
              <p className="text-body font-semibold text-heading">{selectedAsset.name}</p>
              <p className="mt-0.5 text-body-sm text-muted"><span className="font-mono">{selectedAsset.code}</span> · {categoryLabel(selectedAsset.category)}</p>
            </div>
            {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}
            {successMsg && <Alert tone="success">{successMsg}</Alert>}
            <Field label="Karyawan penerima" required>
              <Select aria-label="Karyawan penerima" value={assignEmployeeId} onChange={(e) => setAssignEmployeeId(e.target.value)} placeholder="Pilih karyawan…">
                <option value="">Pilih karyawan…</option>
                {employees.map((emp) => <option key={emp._id} value={emp._id}>{`${emp.name} (${emp.NIK})`}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      {/* Signature */}
      <Modal
        open={!!signatureModalUrl}
        onClose={() => setSignatureModalUrl(null)}
        title="Tanda tangan serah terima"
        size="sm"
        footer={<Button variant="secondary" onClick={() => setSignatureModalUrl(null)}>Tutup</Button>}
      >
        {signatureModalUrl && (
          <div className="grid place-items-center rounded-2xl bg-background-secondary-default p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- signature data URL */}
            <img src={signatureModalUrl} alt="Tanda tangan BAST" className="max-h-48 object-contain dark:invert" />
          </div>
        )}
      </Modal>

      {/* Physical audit */}
      <Modal
        open={isAuditOpen}
        onClose={closeAudit}
        title="Audit fisik inventaris"
        description="Pindai label barcode atau ketik kode aset, lalu catat kondisinya."
        footer={
          auditAsset ? (
            <>
              <Button variant="secondary" onClick={() => setAuditAsset(null)}>Pindai ulang</Button>
              <Button type="submit" form="audit-form" loading={submitting}>Simpan hasil audit</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={closeAudit}>Tutup</Button>
          )
        }
      >
        <div className="space-y-4">
          <div role="tablist" aria-label="Cara memindai" className="grid grid-cols-2 gap-1 rounded-full bg-background-secondary-default p-1">
            {([["device", "Scanner atau ketik", ScanLine], ["camera", "Kamera", Camera]] as const).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={scanMode === mode}
                onClick={() => chooseScanMode(mode)}
                className={cn(
                  "flex h-9 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-body-sm font-medium transition-colors",
                  scanMode === mode ? "bg-background-primary-default text-heading shadow-xs" : "text-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleScanSearch} className="flex gap-2">
            <Input
              aria-label="Kode aset"
              required
              value={scanInputCode}
              onChange={(e) => setScanInputCode(e.target.value)}
              autoFocus={scanMode === "device"}
              placeholder="Pindai barcode atau ketik kode aset…"
              className="font-mono"
            />
            <Button type="submit" variant="secondary" icon={Search}>Cari</Button>
          </form>

          {scanError && <Alert tone="danger">{scanError}</Alert>}
          {successMsg && <Alert tone="success">{successMsg}</Alert>}

          {scanMode === "camera" && !successMsg && (
            <CameraScanner
              paused={!!auditAsset || submitting}
              onDetected={(code) => {
                setScanInputCode(code);
                void lookupCode(code);
              }}
            />
          )}

          {scanMode === "device" && !auditAsset && !successMsg && (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-background-secondary-default px-5 py-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-background-primary-default text-subtle shadow-xs"><ScanLine className="size-6" aria-hidden /></span>
              <p className="max-w-sm text-body-sm text-muted">Scanner USB atau Bluetooth bekerja seperti keyboard: klik kolom di atas, lalu pindai label. Kode juga dapat diketik manual.</p>
            </div>
          )}

          {auditAsset && (
            <form id="audit-form" onSubmit={handleSaveAudit} className="space-y-4">
              <div className="rounded-2xl bg-background-secondary-default p-4">
                <p className="text-body font-semibold text-heading">{auditAsset.name}</p>
                <p className="mt-0.5 text-body-sm text-muted"><span className="font-mono">{auditAsset.code}</span> · {categoryLabel(auditAsset.category)} · Kondisi tercatat: {INVENTORY_CONDITION_LABELS[auditAsset.condition] ?? auditAsset.condition}</p>
              </div>
              <Field label="Kondisi hasil pemeriksaan" required>
                <Select aria-label="Kondisi hasil pemeriksaan" value={auditCondition} onChange={(e) => setAuditCondition(e.target.value as "good" | "damaged" | "lost")}>
                  <option value="good">Baik</option>
                  <option value="damaged">Rusak</option>
                  <option value="lost">Hilang</option>
                </Select>
              </Field>
              <Field label="Catatan pemeriksa">
                <Textarea rows={3} value={auditNotes} onChange={(e) => setAuditNotes(e.target.value)} placeholder="Contoh: layar lecet ringan, adaptor hilang" />
              </Field>
            </form>
          )}
        </div>
      </Modal>
    </div>
  );
}
