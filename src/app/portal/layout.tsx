"use client";

import { BookOpen, Boxes, CalendarRange, Cake, Fingerprint, MessageSquareWarning, ReceiptText, ScrollText, Repeat2, Target, UserRound } from "@/components/icons";
import { AppShell, type NavSection } from "@/components/shell/AppShell";

/**
 * Employee self-service navigation, grouped by what the person is trying to do
 * rather than by which module the feature belongs to. Icons match the ones used
 * for the same concept on the landing page and in the admin panel.
 */
const sections: NavSection[] = [
  {
    label: "Kehadiran",
    items: [
      { name: "Presensi mandiri", href: "/portal/attendance", icon: Fingerprint },
      { name: "Izin & cuti", href: "/portal/leave", icon: CalendarRange },
      { name: "Tukar libur", href: "/portal/holiday-swap", icon: Repeat2 },
    ],
  },
  {
    label: "Kepegawaian",
    items: [
      { name: "Slip gaji saya", href: "/portal/payroll", icon: ReceiptText },
      { name: "Ulang tahun", href: "/portal/birthdays", icon: Cake },
      { name: "Penilaian kinerja", href: "/portal/kpi", icon: Target },
      { name: "Inventaris saya", href: "/portal/inventory", icon: Boxes },
      { name: "Pengaduan", href: "/portal/complaints", icon: MessageSquareWarning },
      { name: "Disiplin & SP", href: "/admin/discipline", icon: ScrollText, permission: "discipline" },
    ],
  },
  {
    label: "Akun",
    items: [
      { name: "Profil & keamanan", href: "/portal/profile", icon: UserRound },
      { name: "Panduan penggunaan", href: "/portal/help", icon: BookOpen },
    ],
  },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      sections={sections}
      brand={{ title: "Portal", subtitle: "Ruang kerja karyawan" }}
      brandHref="/portal/attendance"
    >
      {children}
    </AppShell>
  );
}
