"use client";

import React, { useState, useEffect } from "react";
import { ClipboardList, Briefcase, Plus, Trash2, Edit } from "@/components/icons";
import SearchSelect from "@/components/SearchSelect";

import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SkeletonList, TableWrap, Tabs, Td, Textarea, Th, Tr } from "@/components/ui";
import { confirmDialog } from "@/components/ui/ConfirmHost";
/**
 * A reference the API may return either populated or as a bare id, depending on
 * the endpoint. The form reads `_id` off it and the table reads `name`, so both
 * shapes have to be spelled out rather than collapsed into one.
 */
type Ref = { _id: string; name: string; employeeId?: string } | string | null;

interface MasterItem {
  _id: string;
  name: string;
  headId?: Ref;
  divisionId?: Ref;
  branchId?: Ref;
  description?: string;
  jobdesk?: string;
  requirements?: string;
  location?: string;
  type?: string;
  status?: "active" | "inactive";
}

/** Reads a populated reference, tolerating the bare-id form. */
function refName(ref: Ref | undefined): string {
  return typeof ref === "object" && ref !== null ? ref.name : "";
}

/** Reads the id of a reference in either form. */
function refId(ref: Ref | undefined): string {
  if (!ref) return "";
  return typeof ref === "string" ? ref : ref._id;
}

export default function DepartmentsPage() {
  const [activeTab, setActiveTab] = useState<"division" | "position">("division");
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Data lists
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; employeeId?: string }>>([]);
  const [divisions, setDivisions] = useState<Array<{ _id: string; name: string }>>([]);
  const [branches, setBranches] = useState<Array<{ _id: string; name: string }>>([]);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [headId, setHeadId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [divisionBranchId, setDivisionBranchId] = useState("");
  
  // Vacancy detail states
  const [description, setDescription] = useState("");
  const [jobdesk, setJobdesk] = useState("");
  const [requirements, setRequirements] = useState("");
  const [location, setLocation] = useState("Jakarta");
  const [type, setType] = useState("Full-Time");
  const [status, setStatus] = useState("active");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/v1/employees");
      const data = await res.json();
      if (data.success) setEmployees(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBranchesList = async () => {
    try {
      const res = await fetch("/api/v1/branches");
      const data = await res.json();
      if (data.success) setBranches(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDivisionsList = async () => {
    try {
      const res = await fetch("/api/v1/divisions");
      const data = await res.json();
      if (data.success) setDivisions(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    setItems([]);
    try {
      const endpoint = activeTab === "division" ? "/api/v1/divisions" : "/api/v1/positions";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (err) {
      console.error("Gagal memuat data master:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchEmployees();
    fetchDivisionsList();
    fetchBranchesList();
  }, [activeTab]);

  const handleOpenForm = (item?: MasterItem) => {
    if (item) {
      setSelectedId(item._id);
      setName(item.name);
      setHeadId(refId(item.headId));
      setDivisionId(refId(item.divisionId));
      setDivisionBranchId(refId(item.branchId));
      setDescription(item.description || "");
      setJobdesk(item.jobdesk || "");
      setRequirements(item.requirements || "");
      setLocation(item.location || "Jakarta");
      setType(item.type || "Full-Time");
      setStatus(item.status || "active");
    } else {
      setSelectedId(null);
      setName("");
      setHeadId("");
      setDivisionId(divisions[0]?._id || "");
      setDivisionBranchId(branches[0]?._id || "");
      setDescription("");
      setJobdesk("");
      setRequirements("");
      setLocation("Jakarta");
      setType("Full-Time");
      setStatus("active");
    }
    setErrorMessage("");
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    const endpoint = activeTab === "division" ? "/api/v1/divisions" : "/api/v1/positions";
    const payload = activeTab === "division"
      ? { id: selectedId, name, headId: headId || null, branchId: divisionBranchId || null }
      : { 
          id: selectedId, 
          name, 
          divisionId: divisionId || null,
          description,
          jobdesk,
          requirements,
          location,
          type,
          status
        };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        fetchItems();
        setFormOpen(false);
      } else {
        setErrorMessage(data.error?.message || "Gagal menyimpan data");
      }
    } catch (err) {
      setErrorMessage("Terjadi kesalahan koneksi server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    const label = activeTab === "division" ? "divisi" : "jabatan";
    if (!await confirmDialog({ title: `Hapus ${label}?`, message: `Data ${label} akan dihapus. Hanya bisa bila tidak lagi dipakai karyawan.`, confirmLabel: "Hapus" })) return;

    const endpoint = activeTab === "division" ? `/api/v1/divisions/${id}` : `/api/v1/positions/${id}`;

    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        fetchItems();
      }
    } catch (err) {
      console.error("Gagal menghapus item:", err);
    }
  };

  const noun = activeTab === "division" ? "divisi" : "jabatan";

  return (
    <div>
      <PageHeader
        title="Divisi & jabatan"
        description="Kelola divisi kerja dan jenjang jabatan yang dipakai di data karyawan dan lowongan."
        actions={<Button icon={Plus} onClick={() => handleOpenForm()}>Tambah {noun}</Button>}
      />

      <div className="mb-4">
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "division", label: "Divisi", icon: ClipboardList },
            { id: "position", label: "Jabatan", icon: Briefcase },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4"><SkeletonList rows={4} /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={activeTab === "division" ? ClipboardList : Briefcase}
            title={`Belum ada ${noun}`}
            description={`Tambahkan ${noun} agar dapat dipilih saat mengisi data karyawan.`}
            action={<Button icon={Plus} onClick={() => handleOpenForm()}>Tambah {noun}</Button>}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Nama {noun}</Th>
                {activeTab === "division" ? (
                  <>
                    <Th>Cabang</Th>
                    <Th>Ketua divisi</Th>
                  </>
                ) : (
                  <Th>Divisi</Th>
                )}
                <Th className="text-right">Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item._id}>
                  <Td className="font-medium text-heading">{item.name}</Td>
                  {activeTab === "division" ? (
                    <>
                      <Td className="text-muted">{refName(item.branchId) || "-"}</Td>
                      <Td className="text-muted">
                        {typeof item.headId === "object" && item.headId ? `${item.headId.name} (${item.headId.employeeId ?? "-"})` : "-"}
                      </Td>
                    </>
                  ) : (
                    <Td className="text-muted">{refName(item.divisionId) || "-"}</Td>
                  )}
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" icon={Edit} aria-label={`Ubah ${item.name}`} title="Ubah" onClick={() => handleOpenForm(item)} />
                      <Button variant="ghost" size="icon" icon={Trash2} aria-label={`Hapus ${item.name}`} title="Hapus" onClick={() => handleDeleteItem(item._id)} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={handleCloseForm}
        title={selectedId ? `Ubah ${noun}` : `Tambah ${noun}`}
        size={activeTab === "position" ? "lg" : "md"}
        footer={
          <>
            <Button variant="secondary" onClick={handleCloseForm}>Batal</Button>
            <Button type="submit" form="master-form" loading={submitting}>Simpan</Button>
          </>
        }
      >
        <form id="master-form" onSubmit={handleSubmit} className="space-y-4">
          {errorMessage && <Alert tone="danger">{errorMessage}</Alert>}
          <Field label={`Nama ${noun}`} required>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={activeTab === "division" ? "Contoh: Keuangan & Akuntansi" : "Contoh: Senior Software Engineer"}
            />
          </Field>

          {activeTab === "division" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SearchSelect
                label="Cabang"
                value={divisionBranchId}
                onChange={setDivisionBranchId}
                options={branches.map((b) => ({ label: b.name, value: b._id }))}
                placeholder="Pilih cabang…"
              />
              <SearchSelect
                label="Ketua divisi"
                value={headId}
                onChange={setHeadId}
                options={employees.map((emp) => ({ label: `${emp.name} (${emp.employeeId})`, value: emp._id }))}
                placeholder="Opsional"
              />
            </div>
          ) : (
            <>
              <SearchSelect
                label="Divisi"
                value={divisionId}
                onChange={setDivisionId}
                options={divisions.map((div) => ({ label: div.name, value: div._id }))}
                placeholder="Pilih divisi…"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Tipe pekerjaan">
                  <Select aria-label="Tipe pekerjaan" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="Full-Time">Penuh waktu</option>
                    <option value="Part-Time">Paruh waktu</option>
                    <option value="Contract">Kontrak</option>
                    <option value="Internship">Magang</option>
                    <option value="Freelance">Lepas</option>
                  </Select>
                </Field>
                <Field label="Status lowongan">
                  <Select aria-label="Status lowongan" value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
                    <option value="active">Dibuka</option>
                    <option value="inactive">Ditutup</option>
                  </Select>
                </Field>
                <Field label="Lokasi kerja" required>
                  <Input required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Jakarta, Remote, Hybrid" />
                </Field>
              </div>
              <Field label="Deskripsi lowongan">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Informasi umum tentang posisi ini" />
              </Field>
              <Field label="Tanggung jawab" hint="Satu poin per baris.">
                <Textarea value={jobdesk} onChange={(e) => setJobdesk(e.target.value)} rows={3} />
              </Field>
              <Field label="Persyaratan" hint="Satu poin per baris.">
                <Textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={3} />
              </Field>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
