"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users, UserPlus, Trash2, Edit, X, Loader2, AlertCircle, Search, Mail, Phone,
  Building2, Briefcase, MapPin, CreditCard, ShieldCheck, Sparkles, CheckCheck
} from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { CredentialDialog } from "@/components/CredentialDialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ICON_STROKE,
  Input,
  PageHeader,
  SkeletonList,
  StatusBadge,
  Tabs,
  TableWrap,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage as apiErrorMessage } from "@/lib/client-api";
import { formatDate, wibDateKey } from "@/lib/time";
import { EmployeeFaceStatus } from "./EmployeeFaceStatus";
import { motion, AnimatePresence } from "framer-motion";

import { Select } from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { Portal } from "@/components/ui/Floating";
/**
 * A reference the API returns populated on list responses and as a bare id on
 * others. The form needs the id, the table needs the name, so both forms are
 * spelled out and read through the helpers below.
 */
type Ref = { _id: string; name: string } | string | null | undefined;

/** One entry from the public Indonesian region API. */
type Region = { id: string; name: string };

/** Id of a reference in either form. */
function refId(ref: Ref): string {
  if (!ref) return "";
  return typeof ref === "string" ? ref : ref._id;
}

/** Name of a reference, empty when the API returned only an id. */
function refName(ref: Ref): string {
  return typeof ref === "object" && ref !== null ? ref.name : "";
}

interface Branch { _id: string; name: string; }
interface Division { _id: string; name: string; }
interface Position { _id: string; name: string; }
interface Role { _id: string; name: string; }

interface Employee {
  _id?: string;
  /** Set by the API when NIK/NPWP/rekening could not be decrypted with this server's key. */
  piiUnreadable?: boolean;
  employeeId: string;
  name: string;
  nik: string;
  personalEmail: string;
  officeEmail: string;
  phone: string;
  birthPlace: string;
  birthDate: string | Date;
  gender: "male" | "female";
  religion: string;
  maritalStatus: string;
  ktpAddress: { street: string; subdistrict: string; city: string; province: string; country?: string; };
  domicileAddress: { street: string; subdistrict: string; city: string; province: string; country?: string; };
  npwp: string;
  taxStatus: string;
  bpjsKesehatan?: string;
  bpjsKetenagakerjaan?: string;
  bankAccount: { bankName: string; accountNumber: string; accountHolder: string; };
  branchId: Ref;
  divisionId: Ref;
  positionId: Ref;
  supervisorId?: Ref;
  storeManagerId?: Ref;
  areaManagerId?: Ref;
  joinDate: string | Date;
  employmentStatus: "probation" | "pkwt" | "pkwtt" | "magang" | "harian_lepas" | "paruh_waktu" | "outsource" | "lainnya";
  status: "active" | "onboarding" | "suspended" | "resigned";
  isNewHire?: boolean;
  missingFields?: string[];
}

/**
 * Region lists come through our own API rather than straight from the upstream
 * service, so the browser never talks to a third-party host and the CSP stays
 * at connect-src 'self'. Failures resolve to an empty list: a missing dropdown
 * is better than a form that refuses to open.
 */
async function loadRegions(
  level: "provinces" | "regencies" | "districts",
  parent?: string
): Promise<Region[]> {
  const qs = parent ? `?level=${level}&parent=${encodeURIComponent(parent)}` : `?level=${level}`;
  try {
    const res = await fetch(`/api/v1/regions${qs}`);
    const data = await res.json();
    return data.success ? (data.data as Region[]) : [];
  } catch {
    return [];
  }
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <EmployeesView />
    </Suspense>
  );
}

const STATUS_FILTERS = [
  { value: "", label: "Semua status" },
  { value: "active", label: "Aktif" },
  { value: "onboarding", label: "Onboarding" },
  { value: "suspended", label: "Ditangguhkan" },
  { value: "resigned", label: "Resign" },
];

function EmployeesView() {
  const sp = useSearchParams();
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"all" | "new">(sp.get("baru") === "1" ? "new" : "all");
  const [newHireCount, setNewHireCount] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState(sp.get("q") ?? "");
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [credential, setCredential] = useState<{ email: string; password: string; name?: string } | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(sp.get("q") ?? "");

  // Form states
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form inputs
  const [name, setName] = useState("");
  const [nik, setNik] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [officeEmail, setOfficeEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [religion, setReligion] = useState("Islam");
  const [maritalStatus, setMaritalStatus] = useState("Belum Kawin");
  const [ktpStreet, setKtpStreet] = useState("");
  const [ktpSubdistrict, setKtpSubdistrict] = useState("");
  const [ktpCity, setKtpCity] = useState("");
  const [ktpProvince, setKtpProvince] = useState("");
  const [domicileStreet, setDomicileStreet] = useState("");
  const [domicileSubdistrict, setDomicileSubdistrict] = useState("");
  const [domicileCity, setDomicileCity] = useState("");
  const [domicileProvince, setDomicileProvince] = useState("");
  const [npwp, setNpwp] = useState("");
  const [taxStatus, setTaxStatus] = useState("TK/0");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [branchId, setBranchId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [storeManagerId, setStoreManagerId] = useState("");
  const [areaManagerId, setAreaManagerId] = useState("");
  const [roleId, setRoleId] = useState(""); // select login user role
  const [password, setPassword] = useState("");
  const [joinDate, setJoinDate] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState<"probation" | "pkwt" | "pkwtt" | "magang" | "harian_lepas" | "paruh_waktu" | "outsource" | "lainnya">("probation");
  const [status, setStatus] = useState<"active" | "onboarding" | "suspended" | "resigned">("onboarding");

  // Indonesian Region API States
  const [provinces, setProvinces] = useState<{ id: string; name: string }[]>([]);
  const [ktpCities, setKtpCities] = useState<{ id: string; name: string }[]>([]);
  const [ktpDistricts, setKtpDistricts] = useState<{ id: string; name: string }[]>([]);
  const [domicileCities, setDomicileCities] = useState<{ id: string; name: string }[]>([]);
  const [domicileDistricts, setDomicileDistricts] = useState<{ id: string; name: string }[]>([]);

  // Selected region IDs
  const [selectedKtpProvinceId, setSelectedKtpProvinceId] = useState("");
  const [selectedKtpCityId, setSelectedKtpCityId] = useState("");
  const [selectedDomicileProvinceId, setSelectedDomicileProvinceId] = useState("");
  const [selectedDomicileCityId, setSelectedDomicileCityId] = useState("");
  const [ktpCountry, setKtpCountry] = useState("Indonesia");
  const [domicileCountry, setDomicileCountry] = useState("Indonesia");

  // Load provinces on mount
  useEffect(() => {
    void loadRegions("provinces").then(setProvinces);
  }, []);

  // Fetch cities for KTP
  useEffect(() => {
    if (!selectedKtpProvinceId) {
      setKtpCities([]);
      return;
    }
    void loadRegions("regencies", selectedKtpProvinceId).then(setKtpCities);
  }, [selectedKtpProvinceId]);

  // Fetch districts for KTP
  useEffect(() => {
    if (!selectedKtpCityId) {
      setKtpDistricts([]);
      return;
    }
    void loadRegions("districts", selectedKtpCityId).then(setKtpDistricts);
  }, [selectedKtpCityId]);

  // Fetch cities for Domicile
  useEffect(() => {
    if (!selectedDomicileProvinceId) {
      setDomicileCities([]);
      return;
    }
    void loadRegions("regencies", selectedDomicileProvinceId).then(setDomicileCities);
  }, [selectedDomicileProvinceId]);

  // Fetch districts for Domicile
  useEffect(() => {
    if (!selectedDomicileCityId) {
      setDomicileDistricts([]);
      return;
    }
    void loadRegions("districts", selectedDomicileCityId).then(setDomicileDistricts);
  }, [selectedDomicileCityId]);

  // Find matching IDs when form is opened with an employee
  useEffect(() => {
    if (formOpen && selectedId && provinces.length > 0) {
      const ktpProv = provinces.find(p => p.name.toLowerCase() === ktpProvince.toLowerCase());
      if (ktpProv) {
        setSelectedKtpProvinceId(ktpProv.id);
        void loadRegions("regencies", ktpProv.id).then((cities) => {
          setKtpCities(cities);
          const ktpC = cities.find((c) => c.name.toLowerCase() === ktpCity.toLowerCase());
          if (!ktpC) return;
          setSelectedKtpCityId(ktpC.id);
          void loadRegions("districts", ktpC.id).then(setKtpDistricts);
        });
      }

      const domProv = provinces.find(p => p.name.toLowerCase() === domicileProvince.toLowerCase());
      if (domProv) {
        setSelectedDomicileProvinceId(domProv.id);
        void loadRegions("regencies", domProv.id).then((cities) => {
          setDomicileCities(cities);
          const domC = cities.find((c) => c.name.toLowerCase() === domicileCity.toLowerCase());
          if (!domC) return;
          setSelectedDomicileCityId(domC.id);
          void loadRegions("districts", domC.id).then(setDomicileDistricts);
        });
      }
    }
  }, [formOpen, selectedId, provinces]);

  const fetchMetadata = useCallback(async () => {
    try {
      const [rBranch, rDiv, rPos, rRole] = await Promise.all([
        fetch("/api/v1/branches"),
        fetch("/api/v1/divisions"),
        fetch("/api/v1/positions"),
        fetch("/api/v1/roles"),
      ]);
      const [dBranch, dDiv, dPos, dRole] = await Promise.all([
        rBranch.json(),
        rDiv.json(),
        rPos.json(),
        rRole.json(),
      ]);
      if (dBranch.success) setBranches(dBranch.data);
      if (dDiv.success) setDivisions(dDiv.data);
      if (dPos.success) setPositions(dPos.data);
      // /api/v1/roles now returns { roles, modules, actions, scopes } so the
      // Settings screen can render the permission matrix from the same call.
      if (dRole.success) setRoles(dRole.data.roles ?? dRole.data);
    } catch (err) {
      console.error("Gagal memuat meta:", err);
    }
  }, []);

  // Search runs on the server after a short pause, so it covers every
  // employee rather than only the page that happens to be loaded.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery((prev) => {
        if (prev !== searchQuery.trim()) setPage(1);
        return searchQuery.trim();
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (statusFilter) params.set("status", statusFilter);
      if (view === "new") params.set("newHire", "1");
      const [list, fresh] = await Promise.all([
        api.get<Employee[]>(`/api/v1/employees?${params.toString()}`),
        api.get<Employee[]>("/api/v1/employees?newHire=1&limit=1"),
      ]);
      setEmployees(list.data ?? []);
      setTotal(list.meta?.total ?? 0);
      setNewHireCount(fresh.meta?.total ?? 0);
    } catch (err) {
      toast.error("Gagal memuat karyawan", apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedQuery, statusFilter, view, toast]);

  // Supervisor pickers need every employee, not just the visible page.
  const fetchAllEmployees = useCallback(async () => {
    try {
      const res = await api.get<Array<{ _id: string; name: string; employeeId: string }>>("/api/v1/employees?limit=500");
      setAllEmployees(res.data ?? []);
    } catch {
      // Pickers stay empty; the rest of the form still works.
    }
  }, []);

  useEffect(() => {
    void fetchMetadata();
    void fetchAllEmployees();
  }, [fetchMetadata, fetchAllEmployees]);

  useEffect(() => {
    void fetchEmployees();
  }, [fetchEmployees]);

  const handleOpenForm = (emp?: Employee) => {
    setSelectedEmployee(emp ?? null);
    if (emp) {
      setSelectedId(emp._id || null);
      setName(emp.name);
      setNik(emp.nik || "");
      setPersonalEmail(emp.personalEmail);
      setOfficeEmail(emp.officeEmail);
      setPhone(emp.phone);
      setBirthPlace(emp.birthPlace);
      setBirthDate(emp.birthDate ? wibDateKey(new Date(emp.birthDate)) : "");
      setGender(emp.gender ?? "male");
      setReligion(emp.religion);
      setMaritalStatus(emp.maritalStatus);
      setKtpStreet(emp.ktpAddress.street);
      setKtpSubdistrict(emp.ktpAddress.subdistrict);
      setKtpCity(emp.ktpAddress.city);
      setKtpProvince(emp.ktpAddress.province);
      setKtpCountry(emp.ktpAddress.country || "Indonesia");
      setDomicileStreet(emp.domicileAddress.street);
      setDomicileSubdistrict(emp.domicileAddress.subdistrict);
      setDomicileCity(emp.domicileAddress.city);
      setDomicileProvince(emp.domicileAddress.province);
      setDomicileCountry(emp.domicileAddress.country || "Indonesia");
      setNpwp(emp.npwp || "");
      setTaxStatus(emp.taxStatus);
      setBankName(emp.bankAccount.bankName);
      setBankAccountNumber(emp.bankAccount.accountNumber || "");
      setBankAccountHolder(emp.bankAccount.accountHolder);
      setBranchId(refId(emp.branchId));
      setDivisionId(refId(emp.divisionId));
      setPositionId(refId(emp.positionId));
      setSupervisorId(refId(emp.supervisorId));
      setStoreManagerId(refId(emp.storeManagerId));
      setAreaManagerId(refId(emp.areaManagerId));
      setJoinDate(emp.joinDate ? wibDateKey(new Date(emp.joinDate)) : "");
      setEmploymentStatus(emp.employmentStatus);
      setStatus(emp.status);
      setRoleId(""); // roleId is only for creation or managed via users settings
      setPassword("");
    } else {
      setSelectedId(null);
      setName("");
      setNik("");
      setPersonalEmail("");
      setOfficeEmail("");
      setPhone("");
      setBirthPlace("");
      setBirthDate("");
      setGender("male");
      setReligion("Islam");
      setMaritalStatus("Belum Kawin");
      setKtpStreet("");
      setKtpSubdistrict("");
      setKtpCity("");
      setKtpProvince("");
      setKtpCountry("Indonesia");
      setDomicileStreet("");
      setDomicileSubdistrict("");
      setDomicileCity("");
      setDomicileProvince("");
      setDomicileCountry("Indonesia");
      setSelectedKtpProvinceId("");
      setSelectedKtpCityId("");
      setSelectedDomicileProvinceId("");
      setSelectedDomicileCityId("");
      setNpwp("");
      setTaxStatus("TK/0");
      setBankName("");
      setBankAccountNumber("");
      setBankAccountHolder("");
      setBranchId(branches[0]?._id || "");
      setDivisionId(divisions[0]?._id || "");
      setPositionId(positions[0]?._id || "");
      setSupervisorId("");
      setStoreManagerId("");
      setAreaManagerId("");
      setJoinDate(wibDateKey());
      setEmploymentStatus("probation");
      setStatus("onboarding");
      setRoleId(roles.find(r => r.name === "STAFF")?._id || "");
      setPassword("");
    }
    setErrorMessage("");
    setFormOpen(true);
  };

  const handleCloseForm = () => setFormOpen(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/v1/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          name,
          nik,
          personalEmail,
          officeEmail,
          phone,
          birthPlace,
          birthDate,
          gender,
          religion,
          maritalStatus,
          ktpAddress: { street: ktpStreet, subdistrict: ktpSubdistrict, city: ktpCity, province: ktpProvince, country: ktpCountry },
          domicileAddress: { street: domicileStreet, subdistrict: domicileSubdistrict, city: domicileCity, province: domicileProvince, country: domicileCountry },
          npwp,
          taxStatus,
          bankAccount: { bankName, accountNumber: bankAccountNumber, accountHolder: bankAccountHolder },
          branchId,
          divisionId,
          positionId,
          supervisorId: supervisorId || null,
          storeManagerId: storeManagerId || null,
          areaManagerId: areaManagerId || null,
          joinDate,
          employmentStatus,
          status,
          roleId: selectedId ? undefined : roleId,
          password: password || undefined,
        }),
      });

      const data = await response.json();
      if (data.success) {
        if (data.data?.generatedPassword) {
          setCredential({ email: officeEmail, password: data.data.generatedPassword, name });
        }
        void fetchEmployees();
        void fetchAllEmployees();
        setFormOpen(false);
        toast.success("Tersimpan", data.message);
      } else {
        setErrorMessage(data.error?.message || "Gagal menyimpan data karyawan");
      }
    } catch (err) {
      setErrorMessage("Terjadi kesalahan koneksi server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      const res = await api.delete(`/api/v1/employees/${id}`);
      toast.success("Karyawan dihapus", res.message);
      setDeleteTarget(null);
      void fetchEmployees();
      void fetchAllEmployees();
    } catch (err) {
      toast.error("Gagal menghapus", apiErrorMessage(err));
    }
  };

  const markComplete = async (emp: Employee) => {
    try {
      const res = await api.patch("/api/v1/employees", { id: emp._id });
      toast.success("Tanda baru dihapus", res.message);
      setSelectedEmployee(null);
      setFormOpen(false);
      void fetchEmployees();
    } catch (err) {
      toast.error("Gagal memperbarui", apiErrorMessage(err));
    }
  };

  const supervisorOptions = allEmployees
    .filter((emp) => emp._id !== selectedId)
    .map((emp) => ({ label: `${emp.name} (${emp.employeeId})`, value: emp._id }));

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <PageHeader
        eyebrow="Karyawan"
        title="Data karyawan"
        description="Registrasi karyawan, biodata, penempatan jabatan, dan rekening bank. Karyawan hasil rekrutmen ditandai Baru sampai datanya lengkap."
        actions={
          <Button icon={UserPlus} onClick={() => handleOpenForm()}>
            Tambah karyawan
          </Button>
        }
      />

      {employees.some((e) => e.piiUnreadable) && (
        <Alert tone="warning" title="Sebagian data terenkripsi tidak dapat dibuka" className="mb-5">
          NIK, NPWP, atau nomor rekening pada beberapa karyawan tampil kosong. Biasanya server ini memakai{" "}
          <code>ENCRYPTION_KEY</code> yang berbeda dari saat data dibuat (misalnya database lama dipasang di server baru).
          Pakai kembali kunci dari instalasi lama lalu restart aplikasi; jangan mengisi ulang data sebelum kunci dipastikan.
        </Alert>
      )}

      {newHireCount > 0 && view === "all" && (
        <Alert tone="info" title={`${newHireCount} karyawan baru perlu dilengkapi`} className="mb-5">
          Mereka dibuat otomatis saat pelamar diterima; NIK, rekening, dan data lain belum terisi.{" "}
          <button
            type="button"
            onClick={() => {
              setView("new");
              setPage(1);
            }}
            className="font-semibold underline underline-offset-2 cursor-pointer"
          >
            Tampilkan
          </button>
        </Alert>
      )}

      <div className="flex flex-col xl:flex-row xl:items-center gap-3 mb-4">
        <Tabs<"all" | "new">
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          tabs={[
            { id: "all", label: "Semua karyawan" },
            { id: "new", label: "Baru, perlu dilengkapi", icon: Sparkles, count: newHireCount },
          ]}
        />
        <div className="flex flex-col sm:flex-row gap-2.5 xl:ml-auto">
          <div className="relative sm:w-72">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
              strokeWidth={ICON_STROKE}
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, NIP, email kantor"
              className="pl-10"
              aria-label="Cari karyawan"
            />
          </div>
          <Combobox
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={STATUS_FILTERS}
            placeholder="Semua status"
            className="sm:w-48"
            aria-label="Status karyawan"
          />
        </div>
      </div>

      {loading && employees.length === 0 ? (
        <SkeletonList rows={6} />
      ) : employees.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={view === "new" ? "Tidak ada karyawan baru yang perlu dilengkapi" : "Karyawan tidak ditemukan"}
            description={
              view === "new"
                ? "Semua karyawan hasil rekrutmen sudah dilengkapi datanya."
                : "Sesuaikan pencarian atau filter, atau tambahkan karyawan baru."
            }
          />
        </Card>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Phones: cards instead of a wide table. */}
          <div className="md:hidden space-y-2.5">
            {employees.map((emp) => (
              <div key={emp._id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => handleOpenForm(emp)} className="min-w-0 text-left cursor-pointer">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-semibold text-heading">{emp.name}</span>
                      {emp.isNewHire && (
                        <Badge tone="accent" icon={Sparkles}>
                          Baru
                        </Badge>
                      )}
                    </span>
                    <span className="block text-label text-muted font-mono">{emp.employeeId}</span>
                  </button>
                  <StatusBadge status={emp.status} />
                </div>
                <p className="mt-2 text-label text-muted truncate">
                  {[refName(emp.branchId), refName(emp.positionId)].filter(Boolean).join(" · ") || "Penempatan belum diatur"}
                </p>
                {emp.isNewHire && !!emp.missingFields?.length && (
                  <p className="mt-2 text-label text-warning">Belum diisi: {emp.missingFields.join(", ")}</p>
                )}
              </div>
            ))}
          </div>

          <Card className="hidden md:block overflow-hidden">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Karyawan</Th>
                  <Th>Kontak</Th>
                  <Th>Penempatan</Th>
                  <Th>Status</Th>
                  <Th>Mulai kerja</Th>
                  <Th className="text-right">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <Tr key={emp._id}>
                    <Td>
                      <span className="block text-label text-muted font-mono">{emp.employeeId}</span>
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenForm(emp)}
                          className="text-body-sm font-semibold text-heading hover:text-primary transition-colors cursor-pointer text-left"
                        >
                          {emp.name}
                        </button>
                        {emp.isNewHire && (
                          <span title={emp.missingFields?.length ? `Belum diisi: ${emp.missingFields.join(", ")}` : "Data utama sudah lengkap"}>
                            <Badge tone="accent" icon={Sparkles}>
                              Baru
                            </Badge>
                          </span>
                        )}
                      </span>
                      {emp.isNewHire && !!emp.missingFields?.length && (
                        <span className="block text-caption text-warning mt-0.5">{emp.missingFields.length} data belum diisi</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 text-body-sm text-foreground">
                        <Mail className="w-3.5 h-3.5 text-subtle" strokeWidth={ICON_STROKE} />
                        {emp.officeEmail}
                      </span>
                      {emp.phone && (
                        <span className="flex items-center gap-1.5 text-label text-muted mt-0.5">
                          <Phone className="w-3.5 h-3.5 text-subtle" strokeWidth={ICON_STROKE} />
                          {emp.phone}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 text-body-sm text-foreground">
                        <Building2 className="w-3.5 h-3.5 text-subtle" strokeWidth={ICON_STROKE} />
                        {refName(emp.branchId) || "Tanpa cabang"}
                      </span>
                      <span className="flex items-center gap-1.5 text-label text-muted mt-0.5">
                        <Briefcase className="w-3.5 h-3.5 text-subtle" strokeWidth={ICON_STROKE} />
                        {refName(emp.divisionId) || "Tanpa divisi"} · {refName(emp.positionId) || "Tanpa jabatan"}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={emp.status} />
                    </Td>
                    <Td className="text-body-sm text-muted whitespace-nowrap">{formatDate(emp.joinDate as string)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" aria-label={`Ubah ${emp.name}`} onClick={() => handleOpenForm(emp)}>
                        <Edit className="w-4 h-4" strokeWidth={ICON_STROKE} />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Hapus ${emp.name}`} onClick={() => setDeleteTarget(emp)}>
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
            totalPages={totalPages}
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

      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?._id) void handleDeleteEmployee(deleteTarget._id);
        }}
        title={`Hapus ${deleteTarget?.name ?? "karyawan"}?`}
        message="Data karyawan dan akun login terkait akan dihapus. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Hapus"
      />

      {/* Slide-over Form Panel */}
      <AnimatePresence>
        {formOpen && (
          <Portal><div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseForm}
              className="absolute inset-0 bg-overlay"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-2xl h-full bg-surface border-l border-line shadow-[var(--shadow-pop)] relative z-10 p-6 flex flex-col justify-between overflow-y-auto"
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <h2 className="text-body-lg font-semibold text-foreground">
                    {selectedId ? "Edit Profil Karyawan" : "Registrasi Karyawan Baru"}
                  </h2>
                  <button
                    onClick={handleCloseForm}
                    className="p-1 rounded bg-surface border border-line text-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {selectedEmployee?.isNewHire && (
                  <Alert tone="info" title="Karyawan baru dari rekrutmen">
                    {selectedEmployee.missingFields?.length
                      ? `Belum diisi: ${selectedEmployee.missingFields.join(", ")}. Tanda "Baru" hilang otomatis setelah semuanya terisi dan disimpan.`
                      : "Data utama sudah terisi. Simpan sekali lagi atau hapus tanda baru."}
                    <div className="mt-2.5">
                      <Button type="button" size="sm" variant="secondary" icon={CheckCheck} onClick={() => markComplete(selectedEmployee)}>
                        Tandai sudah lengkap
                      </Button>
                    </div>
                  </Alert>
                )}

                <form id="employee-form" onSubmit={handleSubmit} className="space-y-6 text-label text-foreground">
                  {/* Bagian 1: Data Diri */}
                  <div className="space-y-3">
                    <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
                      <Users className="w-4 h-4" /> Data Diri Karyawan
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">Nama Lengkap (Sesuai KTP)</label>
                        <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John Doe" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Nomor NIK KTP (Enkripsi)</label>
                        <input type="text" required value={nik} onChange={e => setNik(e.target.value)} placeholder="16 digit NIK" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">Tempat Lahir</label>
                        <input type="text" required value={birthPlace} onChange={e => setBirthPlace(e.target.value)} placeholder="e.g. Jakarta" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Tanggal Lahir</label>
                        <DatePicker required value={birthDate} onChange={(value) => setBirthDate(value)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">Gender</label>
                        <Select value={gender} onChange={e => setGender(e.target.value as "male" | "female")} className="w-full">
                          <option value="male">Laki-Laki</option>
                          <option value="female">Perempuan</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Agama</label>
                        <input type="text" required value={religion} onChange={e => setReligion(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Status Pernikahan</label>
                        <input type="text" required value={maritalStatus} onChange={e => setMaritalStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                    </div>
                  </div>

                  {/* Bagian 2: Kontak */}
                  <div className="space-y-3">
                    <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
                      <Phone className="w-4 h-4" /> Kontak & Akun
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">No. HP / WhatsApp</label>
                        <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxxxxx" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Email Pribadi</label>
                        <input type="email" required value={personalEmail} onChange={e => setPersonalEmail(e.target.value)} placeholder="john@gmail.com" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div className="space-y-1">
                        <label className="font-semibold">Email Kantor (Email Login)</label>
                        <input type="email" required value={officeEmail} onChange={e => setOfficeEmail(e.target.value)} placeholder="john@perusahaan.com" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold flex items-center justify-between">
                          <span>{selectedId ? "Kata Sandi Baru" : "Kata Sandi Akun"}</span>
                          <span className="text-label text-muted dark:text-subtle font-normal">
                            {selectedId ? "(Kosongkan jika tidak diubah)" : "(Kosongkan untuk default)"}
                          </span>
                        </label>
                        <input
                          type="password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder={selectedId ? "Ubah kata sandi..." : "Tentukan kata sandi login..."}
                          className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bagian 3: Alamat */}
                  <div className="space-y-3">
                    <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
                      <MapPin className="w-4 h-4" /> Alamat Lengkap
                    </h3>
                    <div className="space-y-4">
                      <div className="p-3 bg-surface-2 rounded-[var(--radius)] border border-line space-y-3">
                        <span className="font-semibold text-foreground text-label uppercase tracking-wider block border-b border-line pb-1">Alamat Sesuai KTP</span>
                        <div className="space-y-1">
                          <label className="font-semibold block text-caption mb-1 text-foreground">Jalan / RT / RW</label>
                          <input type="text" required value={ktpStreet} onChange={e => setKtpStreet(e.target.value)} placeholder="Nama Jalan, No. Rumah, RT/RW" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <SearchSelect
                            label="Provinsi"
                            value={ktpProvince}
                            onChange={(val) => {
                              setKtpProvince(val);
                              const prov = provinces.find(p => p.name === val);
                              if (prov) {
                                setSelectedKtpProvinceId(prov.id);
                                setKtpCity("");
                                setSelectedKtpCityId("");
                                setKtpSubdistrict("");
                              }
                            }}
                            options={provinces.map(p => ({ label: p.name, value: p.name }))}
                            placeholder="Pilih Provinsi..."
                          />
                          <SearchSelect
                            label="Kota / Kabupaten"
                            value={ktpCity}
                            disabled={!selectedKtpProvinceId}
                            onChange={(val) => {
                              setKtpCity(val);
                              const reg = ktpCities.find(c => c.name === val);
                              if (reg) {
                                setSelectedKtpCityId(reg.id);
                                setKtpSubdistrict("");
                              }
                            }}
                            options={ktpCities.map(c => ({ label: c.name, value: c.name }))}
                            placeholder={selectedKtpProvinceId ? "Pilih Kota/Kab..." : "Pilih Provinsi Dulu"}
                          />
                          <SearchSelect
                            label="Kecamatan"
                            value={ktpSubdistrict}
                            disabled={!selectedKtpCityId}
                            onChange={(val) => setKtpSubdistrict(val)}
                            options={ktpDistricts.map(d => ({ label: d.name, value: d.name }))}
                            placeholder={selectedKtpCityId ? "Pilih Kecamatan..." : "Pilih Kota Dulu"}
                          />
                        </div>
                      </div>

                      <div className="p-3 bg-surface-2 rounded-[var(--radius)] border border-line space-y-3">
                        <span className="font-semibold text-foreground text-label uppercase tracking-wider block border-b border-line pb-1">Alamat Domisili Aktif</span>
                        <div className="space-y-1">
                          <label className="font-semibold block text-caption mb-1 text-foreground">Jalan / RT / RW</label>
                          <input type="text" required value={domicileStreet} onChange={e => setDomicileStreet(e.target.value)} placeholder="Nama Jalan, No. Rumah, RT/RW" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <SearchSelect
                            label="Provinsi"
                            value={domicileProvince}
                            onChange={(val) => {
                              setDomicileProvince(val);
                              const prov = provinces.find(p => p.name === val);
                              if (prov) {
                                setSelectedDomicileProvinceId(prov.id);
                                setDomicileCity("");
                                setSelectedDomicileCityId("");
                                setDomicileSubdistrict("");
                              }
                            }}
                            options={provinces.map(p => ({ label: p.name, value: p.name }))}
                            placeholder="Pilih Provinsi..."
                          />
                          <SearchSelect
                            label="Kota / Kabupaten"
                            value={domicileCity}
                            disabled={!selectedDomicileProvinceId}
                            onChange={(val) => {
                              setDomicileCity(val);
                              const reg = domicileCities.find(c => c.name === val);
                              if (reg) {
                                setSelectedDomicileCityId(reg.id);
                                setDomicileSubdistrict("");
                              }
                            }}
                            options={domicileCities.map(c => ({ label: c.name, value: c.name }))}
                            placeholder={selectedDomicileProvinceId ? "Pilih Kota/Kab..." : "Pilih Provinsi Dulu"}
                          />
                          <SearchSelect
                            label="Kecamatan"
                            value={domicileSubdistrict}
                            disabled={!selectedDomicileCityId}
                            onChange={(val) => setDomicileSubdistrict(val)}
                            options={domicileDistricts.map(d => ({ label: d.name, value: d.name }))}
                            placeholder={selectedDomicileCityId ? "Pilih Kecamatan..." : "Pilih Kota Dulu"}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bagian 4: Finansial */}
                  <div className="space-y-3">
                    <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
                      <CreditCard className="w-4 h-4" /> Akun Keuangan & Rekening Bank
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">NPWP (Enkripsi)</label>
                        <input type="text" required value={npwp} onChange={e => setNpwp(e.target.value)} placeholder="No. NPWP" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Status Pajak</label>
                        <input type="text" required value={taxStatus} onChange={e => setTaxStatus(e.target.value)} placeholder="TK/0, K/0, K/1" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">Nama Bank</label>
                        <input type="text" required value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Bank Mandiri" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">No Rekening (Enkripsi)</label>
                        <input type="text" required value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="No Rekening" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Atas Nama</label>
                        <input type="text" required value={bankAccountHolder} onChange={e => setBankAccountHolder(e.target.value)} placeholder="Sesuai buku tabungan" className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label" />
                      </div>
                    </div>
                  </div>

                  {/* Bagian 5: Penempatan */}
                  <div className="space-y-3">
                    <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
                      <Briefcase className="w-4 h-4" /> Penempatan Kerja & Jabatan
                    </h3>
                    <div className="grid grid-cols-3 gap-4 items-end">
                      <SearchSelect
                        label="Cabang Kantor"
                        value={branchId}
                        onChange={setBranchId}
                        options={branches.map(b => ({ label: b.name, value: b._id }))}
                        placeholder="Pilih Cabang..."
                      />
                      <SearchSelect
                        label="Divisi"
                        value={divisionId}
                        onChange={setDivisionId}
                        options={divisions.map(d => ({ label: d.name, value: d._id }))}
                        placeholder="Pilih Divisi..."
                      />
                      <SearchSelect
                        label="Jabatan"
                        value={positionId}
                        onChange={setPositionId}
                        options={positions.map(p => ({ label: p.name, value: p._id }))}
                        placeholder="Pilih Jabatan..."
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <SearchSelect
                        label="Supervisor (SPV) Langsung"
                        value={supervisorId}
                        onChange={(val) => setSupervisorId(val)}
                        options={supervisorOptions}
                        placeholder="Pilih SPV (Opsional)..."
                      />
                      <SearchSelect
                        label="Store Manager (SM) Atasan"
                        value={storeManagerId}
                        onChange={(val) => setStoreManagerId(val)}
                        options={supervisorOptions}
                        placeholder="Pilih SM (Opsional)..."
                      />
                      <SearchSelect
                        label="Area Manager (AM) Regional"
                        value={areaManagerId}
                        onChange={(val) => setAreaManagerId(val)}
                        options={supervisorOptions}
                        placeholder="Pilih AM (Opsional)..."
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="font-semibold">Tanggal Mulai Kerja (Join Date)</label>
                        <DatePicker required value={joinDate} onChange={(value) => setJoinDate(value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Status Kepegawaian</label>
                        <Select value={employmentStatus} onChange={e => setEmploymentStatus(e.target.value as "probation" | "pkwt" | "pkwtt" | "magang" | "harian_lepas" | "paruh_waktu" | "outsource" | "lainnya")} className="w-full">
                          <option value="probation">Masa percobaan</option>
                          <option value="pkwt">PKWT (kontrak)</option>
                          <option value="pkwtt">PKWTT (tetap)</option>
                          <option value="magang">Magang</option>
                          <option value="harian_lepas">Harian lepas</option>
                          <option value="paruh_waktu">Paruh waktu</option>
                          <option value="outsource">Outsource</option>
                          <option value="lainnya">Lainnya</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Status Aktivitas Karyawan</label>
                        <Select value={status} onChange={e => setStatus(e.target.value as "active" | "onboarding" | "suspended" | "resigned")} className="w-full">
                          <option value="onboarding">Onboarding</option>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="resigned">Resigned</option>
                        </Select>
                      </div>
                    </div>

                    {selectedId && (
                      <div className="mt-5">
                        <EmployeeFaceStatus employeeId={selectedId} />
                      </div>
                    )}

                    {!selectedId && (
                      <div className="space-y-1">
                        <h4 className="text-caption font-semibold text-muted uppercase tracking-wider mt-4 flex items-center gap-1.5 pb-1 border-b border-line">
                          <ShieldCheck className="w-4 h-4" /> Kredensial Login
                        </h4>
                        <div className="space-y-1 mt-2">
                          <SearchSelect
                            label="Role Akun Pengguna"
                            value={roleId}
                            onChange={setRoleId}
                            options={[
                              { label: "(Tanpa Akun Login)", value: "" },
                              ...roles.map(r => ({ label: r.name, value: r._id }))
                            ]}
                            placeholder="Pilih Role..."
                          />
                          <p className="text-label text-muted italic mt-1">
                            * Karyawan yang diberi role akan dibuatkan akun login dengan email kantor. Kata sandi awalnya mengikuti Pengaturan → Kata Sandi Awal untuk peran yang dipilih dan ditampilkan sekali setelah data disimpan.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </form>
              </div>

              <div className="border-t border-line pt-4 mt-6 flex items-center justify-end gap-3 bg-surface relative z-20">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-muted hover:text-foreground hover:bg-surface-2 hover:border-line-strong cursor-pointer transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="employee-form"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground border border-transparent text-label font-semibold cursor-pointer hover:bg-primary-hover disabled:opacity-50 active:scale-[0.98] transition-all flex items-center gap-1.5"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Simpan Karyawan
                </button>
              </div>
            </motion.div>
          </div></Portal>
        )}
      </AnimatePresence>
    </div>
  );
}
