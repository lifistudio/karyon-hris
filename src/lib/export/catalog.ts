/**
 * Every exportable dataset, its RBAC module (checked for the `export` action)
 * and what it needs. Rows are capped so one request cannot exhaust memory.
 */
export const EXPORT_DATASETS = {
  employees: { label: "Data karyawan", module: "employees", needs: "none", description: "Biodata kerja, unit, status, kontak. NPWP/rekening lengkap hanya untuk izin seluruh perusahaan." },
  attendance: { label: "Presensi bulanan", module: "attendance", needs: "period", description: "Semua catatan presensi dalam satu bulan beserta keterlambatan dan penanda tinjauan." },
  attendance_daily: { label: "Status kehadiran harian", module: "attendance", needs: "date", description: "Hadir, terlambat, izin, libur, belum absen, dan alpha pada satu tanggal." },
  corrections: { label: "Koreksi absen", module: "attendance", needs: "period", description: "Pengajuan koreksi absen dan statusnya." },
  leave: { label: "Izin & cuti", module: "leave", needs: "period", description: "Pengajuan izin/cuti yang beririsan dengan bulan terpilih." },
  payroll: { label: "Slip gaji", module: "payroll", needs: "period", description: "Rekap slip gaji per karyawan: penghasilan, potongan, gaji bersih." },
  kpi: { label: "KPI & kinerja", module: "kpi", needs: "kpiPeriod", description: "Nilai akhir, predikat, dan status penilaian kinerja." },
  contracts: { label: "Kontrak kerja", module: "contracts", needs: "none", description: "Nomor, jenis, masa berlaku, dan status kontrak." },
  inventory: { label: "Inventaris aset", module: "inventory", needs: "none", description: "Daftar aset, kondisi, dan pemegang saat ini." },
  inventory_checks: { label: "Audit inventaris bulanan", module: "inventory", needs: "period", description: "Hasil pengecekan setiap aset dalam satu bulan: kondisi, temuan, perbaikan, dan pemeriksa. Aset yang belum dicek ikut tercantum." },
  attendance_tasks: { label: "Task harian karyawan", module: "attendance", needs: "period", description: "Task harian per karyawan dalam satu bulan beserta status dan buktinya." },
  candidates: { label: "Pelamar", module: "recruitment", needs: "none", description: "Kandidat rekrutmen, sumber, tahap, dan status." },
} as const;

export type ExportDataset = keyof typeof EXPORT_DATASETS;
