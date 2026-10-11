import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider, themeInitScript } from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { OverflowTooltip } from "@/components/ui/OverflowTooltip";
import "./globals.css";
import { Inter } from "next/font/google";

// Self-hosted Inter at build time, so the website and HRIS render the same
// typeface on every device instead of whatever font the visitor has installed.
const inter = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });
import { ConfirmHost } from "@/components/ui/ConfirmHost";
import { BrandingProvider } from "@/components/brand/BrandLogo";
import { getBranding } from "@/lib/branding/server";
import { FAVICON } from "@/lib/branding/defaults";
import { TimezoneSync } from "@/components/TimezoneSync";
import { currentTimezoneOffset } from "@/lib/timezone-server";

export const metadata: Metadata = {
  title: {
    default: "HRIS — Sistem Informasi Kepegawaian",
    template: "%s · HRIS",
  },
  description:
    "Presensi bergeofence, pengajuan cuti berjenjang, rekrutmen ATS, slip gaji, dan KPI dalam satu sistem.",
  applicationName: "HRIS",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: FAVICON, type: "image/png" }], apple: [{ url: "/brand/karyon-apple-icon.png" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c12" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await getBranding();
  const timezoneOffset = await currentTimezoneOffset();
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`h-full antialiased font-sans ${inter.variable}`}
    >
      <head>
        {/* Applies the stored theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <TimezoneSync minutes={timezoneOffset} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-body focus:font-semibold"
        >
          Lewati ke konten utama
        </a>
        <SessionProvider>
          <ThemeProvider>
            <BrandingProvider value={branding}>
              <ToastProvider>{children}</ToastProvider>
            </BrandingProvider>
            <OverflowTooltip />
            <ConfirmHost />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
