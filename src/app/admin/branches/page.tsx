"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Building2, Clock, Edit, MapPin, Plus, Trash2, Users } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonCards, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { hasFeature, useLicense } from "@/lib/use-license";
import { Portal } from "@/components/ui/Floating";

// Leaflet touches `window`, so the map only loads in the browser.
const BranchMap = dynamic(() => import("@/components/BranchMap"), {
  ssr: false,
  loading: () => (
    <div className="h-64 bg-surface-2 border border-line rounded-lg animate-pulse flex items-center justify-center text-label text-muted">
      Memuat peta interaktif…
    </div>
  ),
});

interface Branch {
  _id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusMeter: number;
  workHours: { start: string; end: string };
  employeeCount?: number;
  /** Not usable while the multi-branch license is inactive (only one branch stays active). */
  licenseInactive?: boolean;
}

const DEFAULT_POINT = { lat: -6.2, lng: 106.816666 };

export default function BranchesPage() {
  const toast = useToast();
  const { license } = useLicense();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [toDelete, setToDelete] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(DEFAULT_POINT.lat);
  const [lng, setLng] = useState(DEFAULT_POINT.lng);
  const [radiusMeter, setRadiusMeter] = useState(15);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const multiBranch = hasFeature(license, "organization.multi_branch");
  const limitReached = !!license && !multiBranch && branches.length >= 1;
  const inactiveCount = branches.filter((b) => b.licenseInactive).length;
  const activeBranch = inactiveCount > 0 ? branches.find((b) => !b.licenseInactive) : undefined;

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Branch[]>("/api/v1/branches");
      setBranches(res.data ?? []);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err, "Gagal memuat cabang."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBranches();
  }, [fetchBranches]);

  const handleOpenForm = (branch?: Branch) => {
    setSelectedBranchId(branch?._id ?? null);
    setName(branch?.name ?? "");
    setAddress(branch?.address ?? "");
    setLat(branch?.lat ?? DEFAULT_POINT.lat);
    setLng(branch?.lng ?? DEFAULT_POINT.lng);
    setRadiusMeter(branch?.radiusMeter ?? 15);
    setStartTime(branch?.workHours.start ?? "09:00");
    setEndTime(branch?.workHours.end ?? "17:00");
    setFormError("");
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endTime <= startTime) {
      setFormError("Jam pulang harus lebih besar dari jam masuk. Untuk shift malam gunakan menu Jadwal & Shift.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const res = await api.post<Branch>("/api/v1/branches", {
        // A new branch must not send an id at all; `null` used to fail validation.
        ...(selectedBranchId ? { id: selectedBranchId } : {}),
        name: name.trim(),
        address: address.trim(),
        lat,
        lng,
        radiusMeter,
        workHours: { start: startTime, end: endTime },
      });
      toast.success("Cabang tersimpan", res.message ?? "Data cabang diperbarui.");
      setFormOpen(false);
      void fetchBranches();
    } catch (err) {
      setFormError(errorMessage(err, "Gagal menyimpan cabang."));
    } finally {
      setSubmitting(false);
    }
  };

  const makeActive = async (branch: Branch) => {
    setActivating(branch._id);
    try {
      const res = await api.put("/api/v1/branches/active", { branchId: branch._id });
      toast.success("Cabang aktif diganti", res.message ?? "");
      void fetchBranches();
    } catch (err) {
      toast.error("Tidak dapat mengganti cabang aktif", errorMessage(err));
    } finally {
      setActivating(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/branches/${toDelete._id}`);
      toast.success("Cabang dihapus", res.message ?? "");
      setToDelete(null);
      void fetchBranches();
    } catch (err) {
      toast.error("Tidak dapat menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cabang Kantor"
        description="Lokasi penempatan, jam operasional, dan area geofence presensi setiap cabang."
        actions={
          <Button icon={Plus} onClick={() => handleOpenForm()} disabled={limitReached} title={limitReached ? "Cabang tambahan memerlukan HRIS Pro" : undefined}>
            Tambah Cabang
          </Button>
        }
      />

      {inactiveCount > 0 && (
        <Alert tone="warning" title={`Hanya satu cabang aktif: ${activeBranch?.name ?? "-"}`}>
          Lisensi multi-cabang (HRIS Pro) tidak aktif, sehingga {inactiveCount} cabang lain dinonaktifkan sementara: karyawan di cabang
          tersebut tidak dapat presensi dan tidak dapat ditempatkan karyawan baru. Data tidak dihapus. Pilih cabang yang tetap aktif
          dengan tombol <strong>Jadikan cabang aktif</strong>, atau perpanjang lisensi di{" "}
          <Link href="/admin/license" className="font-semibold text-primary underline-offset-2 hover:underline">
            Lisensi &amp; Paket
          </Link>{" "}
          agar semua cabang aktif kembali.
        </Alert>
      )}

      {limitReached && inactiveCount === 0 && (
        <Alert tone="info" title={license?.edition === "pro" ? "Lisensi Pro tidak aktif: satu cabang" : "Edisi Community: satu cabang"}>
          Cabang yang ada tetap dapat diubah dan dipakai untuk presensi. Untuk menambah cabang, aktifkan atau perpanjang HRIS Pro di{" "}
          <Link href="/admin/license" className="font-semibold text-primary underline-offset-2 hover:underline">
            Lisensi &amp; Paket
          </Link>
          .
        </Alert>
      )}

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void fetchBranches()} />
      ) : loading ? (
        <SkeletonCards count={2} />
      ) : branches.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Belum ada cabang"
          description="Tambahkan cabang kantor untuk mulai menempatkan karyawan dan mengaktifkan geofence presensi."
          action={<Button icon={Plus} onClick={() => handleOpenForm()}>Tambah Cabang</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map((branch, index) => (
            <motion.div
              layout
              key={branch._id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index, 6) * 0.04 }}
              className={`card-interactive p-5 flex flex-col justify-between${branch.licenseInactive ? " opacity-75" : ""}`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {inactiveCount > 0 && (branch.licenseInactive
                        ? <Badge tone="warning">Nonaktif (lisensi)</Badge>
                        : <Badge tone="success">Cabang aktif</Badge>)}
                      <Badge tone="primary">Radius {branch.radiusMeter} m</Badge>
                      <Badge icon={Users}>{branch.employeeCount ?? 0} karyawan</Badge>
                    </div>
                    <h3 className="text-body-lg font-semibold text-heading truncate">{branch.name}</h3>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" icon={Edit} aria-label={`Ubah ${branch.name}`} onClick={() => handleOpenForm(branch)} />
                    <Button
                      variant="ghost"
                      size="icon"
                      icon={Trash2}
                      aria-label={`Hapus ${branch.name}`}
                      className="hover:text-danger! hover:bg-danger-soft!"
                      onClick={() => setToDelete(branch)}
                    />
                  </div>
                </div>
                <div className="space-y-2 text-body-sm">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                    <span className="text-foreground">{branch.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted shrink-0" />
                    <span className="text-foreground">
                      Operasional {branch.workHours.start}–{branch.workHours.end} WIB
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-2">
                <span className="text-label text-muted font-mono tabular-nums">
                  {branch.lat.toFixed(6)}, {branch.lng.toFixed(6)}
                </span>
                {branch.licenseInactive && (
                  <Button size="sm" variant="secondary" loading={activating === branch._id} disabled={activating !== null} onClick={() => void makeActive(branch)}>
                    Jadikan cabang aktif
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <Portal><div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFormOpen(false)}
              className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={selectedBranchId ? "Ubah cabang" : "Tambah cabang"}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 260 }}
              className="w-full max-w-lg h-full bg-surface border-l border-line shadow-[var(--shadow-pop)] relative z-10 flex flex-col"
            >
              <div className="px-6 py-4 border-b border-line">
                <h2 className="text-body-lg font-semibold text-heading">{selectedBranchId ? "Ubah Cabang" : "Tambah Cabang Baru"}</h2>
                <p className="text-body-sm text-muted mt-0.5">Klik peta atau geser penanda untuk menentukan titik kantor.</p>
              </div>
              <form id="branch-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                {formError && <Alert tone="danger">{formError}</Alert>}
                <Field label="Nama cabang" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} placeholder="Contoh: Kantor Pusat Jakarta" />
                </Field>
                <Field label="Alamat kantor" required>
                  <Textarea value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={400} rows={2} placeholder="Jl. Sudirman No. 12, Jakarta Selatan" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Jam masuk">
                    <Input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </Field>
                  <Field label="Jam pulang">
                    <Input type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </Field>
                </div>
                <Field label="Radius area presensi (meter)" hint="5–5000 meter dari titik kantor.">
                  <Input
                    type="number"
                    required
                    min={5}
                    max={5000}
                    value={radiusMeter}
                    onChange={(e) => setRadiusMeter(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
                  />
                </Field>
                <BranchMap
                  lat={lat}
                  lng={lng}
                  radius={radiusMeter}
                  onChange={(nLat, nLng) => {
                    setLat(nLat);
                    setLng(nLng);
                  }}
                />
              </form>
              <div className="border-t border-line px-6 py-4 flex items-center justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setFormOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" form="branch-form" loading={submitting}>
                  Simpan Cabang
                </Button>
              </div>
            </motion.aside>
          </div></Portal>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
        title="Hapus cabang?"
        message={toDelete ? `Cabang ${toDelete.name} akan dihapus. Cabang yang masih menjadi penempatan karyawan aktif tidak dapat dihapus.` : ""}
        confirmLabel="Hapus"
      />
    </div>
  );
}
