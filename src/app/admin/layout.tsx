"use client";

import { Boxes, Building2, BookOpen, CalendarClock, Cake, CalendarHeart, CalendarOff, ClipboardCheck, FileSignature, FileSpreadsheet, KeyRound, Palette, LayoutDashboard, Megaphone, MessageSquareWarning, Network, ReceiptText, ScrollText, ShieldCheck, SlidersHorizontal, SquareArrowOutUpRight, Target, UserRoundSearch, UsersRound, Workflow } from "@/components/icons";
import { AppShell, type NavSection } from "@/components/shell/AppShell";

/**
 * Admin navigation.
 *
 * Icons are chosen for what the screen actually does rather than for a loose
 * association: payroll is a receipt, not a credit card; divisions and positions
 * are an org network, not a clipboard. The same glyph is used for a concept
 * everywhere it appears, including on the public landing page.
 *
 * `roles` mirrors the section gate in `src/proxy.ts` so the menu never offers a
 * page the router will bounce the user away from.
 */
const sections: NavSection[] = [
  {
    label: "Ringkasan",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { name: "Ulang tahun", href: "/admin/birthdays", icon: Cake },
      { name: "Persetujuan", href: "/admin/approvals", icon: Workflow },
    ],
  },
  {
    label: "Operasional HR",
    items: [
      {
        name: "Kehadiran",
        href: "/admin/attendance",
        icon: ClipboardCheck,
        roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI", "SPV", "GA"],
      },
      {
        name: "Data karyawan",
        href: "/admin/employees",
        icon: UsersRound,
        roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"],
      },
      {
        name: "Kontrak kerja",
        href: "/admin/contracts",
        icon: FileSignature,
        roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"],
      },
      {
        name: "Jadwal & shift",
        href: "/admin/schedules",
        icon: CalendarClock,
        roles: ["SUPERADMIN", "HRD", "SPV"],
      },
      {
        name: "Slip gaji",
        href: "/admin/payroll",
        icon: ReceiptText,
        roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"],
      },
      { name: "KPI & kinerja", href: "/admin/kpi-dashboard", icon: Target },
      {
        name: "Lowongan kerja",
        href: "/admin/vacancies",
        icon: Megaphone,
        roles: ["SUPERADMIN", "HRD", "DIREKSI"],
      },
      {
        name: "Pelamar",
        href: "/admin/recruitment",
        icon: UserRoundSearch,
        roles: ["SUPERADMIN", "HRD", "DIREKSI"],
      },
      { name: "Pengaduan", href: "/admin/complaints", icon: MessageSquareWarning },
      { name: "Disiplin & SP", href: "/admin/discipline", icon: ScrollText, permission: "discipline" },
    ],
  },
  {
    label: "Master data",
    items: [
      {
        name: "Cabang kantor",
        href: "/admin/branches",
        icon: Building2,
        roles: ["SUPERADMIN", "HRD", "GA"],
      },
      {
        name: "Divisi & jabatan",
        href: "/admin/departments",
        icon: Network,
        roles: ["SUPERADMIN", "HRD"],
      },
      {
        name: "Jenis izin & cuti",
        href: "/admin/leave-types",
        icon: CalendarHeart,
        roles: ["SUPERADMIN", "HRD"],
      },
      {
        name: "Hari libur nasional",
        href: "/admin/holidays",
        icon: CalendarOff,
        roles: ["SUPERADMIN", "HRD"],
      },
      { name: "Inventaris aset", href: "/admin/inventory", icon: Boxes },
    ],
  },
  {
    label: "Sistem",
    items: [
      {
        name: "Pengaturan & peran",
        href: "/admin/settings",
        icon: SlidersHorizontal,
        roles: ["SUPERADMIN", "HRD"],
      },
      {
        name: "Jejak audit",
        href: "/admin/audit",
        icon: ScrollText,
        roles: ["SUPERADMIN", "AUDIT", "DIREKSI"],
      },
      { name: "Ekspor & impor", href: "/admin/data", icon: FileSpreadsheet, roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI", "GA", "SPV"] },
      { name: "Integrasi API", href: "/admin/integrations", icon: KeyRound, roles: ["SUPERADMIN", "HRD"] },
      { name: "Logo & tampilan", href: "/admin/branding", icon: Palette, roles: ["SUPERADMIN"] },
      { name: "Lisensi & paket", href: "/admin/license", icon: ShieldCheck, roles: ["SUPERADMIN", "DIREKSI"] },
      { name: "Portal karyawan", href: "/portal/attendance", icon: SquareArrowOutUpRight },
      { name: "Dokumentasi", href: "/docs", icon: BookOpen },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      sections={sections}
      brand={{ title: "Admin", subtitle: "Panel administrasi" }}
      brandHref="/admin"
    >
      {children}
    </AppShell>
  );
}
