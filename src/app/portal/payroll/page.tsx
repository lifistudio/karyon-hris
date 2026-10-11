"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { CreditCard, FileText, Printer, ShieldCheck, TrendingDown, TrendingUp } from "@/components/icons";
import Link from "next/link";
import { DecisionEvidence } from "@/components/portal/DecisionEvidence";
import type { DecisionEvidence as Evidence } from "@/lib/hr/policy-evidence";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  SkeletonList,
  StatCard,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatPeriod, formatRupiah } from "@/lib/time";

interface PayrollLine {
  name: string;
  amount: number;
}

interface Payroll {
  decisionEvidence?: Evidence | null;
  _id: string;
  period: string;
  basicSalary: number;
  allowances: PayrollLine[];
  deductions: PayrollLine[];
  overtimeSalary: number;
  overtimeHours: number;
  lateMinutes: number;
  absentDays: number;
  presentDays: number;
  workingDays: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  fileUrl: string;
  generatedAt?: string;
  status: string;
  source?: "generated" | "uploaded";
  uploadedFile?: string;
  uploadedFileName?: string;
}

export default function PortalPayrollPage() {
  const [items, setItems] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Payroll | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 12;

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Payroll[]>(`/api/v1/payroll?page=${page}&limit=${limit}`);
      setItems(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = page === 1 ? items[0] : undefined;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-44" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Slip gaji saya</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          Riwayat slip gaji Anda tersimpan permanen dan hanya dapat diakses oleh Anda.
        </p>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="Belum ada slip gaji"
            description="Slip gaji akan muncul di sini setelah diterbitkan oleh HRD/Finance. Anda juga akan menerima notifikasi."
          />
        </Card>
      ) : (
        <>
          {latest && latest.source !== "uploaded" && (
            <section>
              <h2 className="eyebrow mb-3">
                Periode terakhir — {formatPeriod(latest.period)}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Gaji bersih"
                  value={formatRupiah(latest.netSalary)}
                  hint="diterima setelah potongan"
                  icon={CreditCard}
                  tone="success"
                />
                <StatCard
                  label="Total penghasilan"
                  value={formatRupiah(latest.totalEarnings)}
                  hint={latest.overtimeHours ? `termasuk ${latest.overtimeHours} jam lembur` : "gaji pokok + tunjangan"}
                  icon={TrendingUp}
                  tone="primary"
                />
                <StatCard
                  label="Total potongan"
                  value={formatRupiah(latest.totalDeductions)}
                  hint="BPJS, pajak, dan lainnya"
                  icon={TrendingDown}
                  tone={latest.totalDeductions > 0 ? "warning" : "neutral"}
                />
                <StatCard
                  label="Kehadiran"
                  value={`${latest.presentDays}/${latest.workingDays}`}
                  hint={
                    latest.absentDays
                      ? `${latest.absentDays} hari alpha · ${latest.lateMinutes} menit telat`
                      : `${latest.lateMinutes} menit keterlambatan`
                  }
                  icon={FileText}
                  tone={latest.absentDays ? "danger" : "neutral"}
                />
              </div>
            </section>
          )}

          <Card>
            <CardHeader
              title="Riwayat slip gaji"
              description={`${total} periode tersedia.`}
              icon={FileText}
            />
            <CardBody className="p-0">
              <ul className="divide-y divide-[var(--border)]">
                {items.map((p) => (
                  <li
                    key={p._id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-semibold">{formatPeriod(p.period)}</p>
                      <p className="text-caption text-subtle mt-0.5">
                        Diterbitkan {formatDateTime(p.generatedAt)}
                      </p>
                    </div>
                    {p.source === "uploaded" ? (
                      <div className="flex items-center gap-3 shrink-0">
                        {p.netSalary > 0 && <span className="text-body font-semibold tabular-nums">{formatRupiah(p.netSalary)}</span>}
                        <a href={p.uploadedFile} target="_blank" rel="noreferrer">
                          <Button variant="secondary" size="sm" icon={FileText}>
                            Buka slip (PDF)
                          </Button>
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-body font-semibold tabular-nums">{formatRupiah(p.netSalary)}</span>
                        <Button variant="secondary" size="sm" onClick={() => setDetail(p)}>
                          Rincian
                        </Button>
                        <Link href={`/print/payslip/${p._id}`} target="_blank">
                          <Button variant="ghost" size="sm" icon={Printer}>
                            Cetak / PDF
                          </Button>
                        </Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {total > limit && (
            <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPage={setPage} />
          )}

          <Alert tone="info" title="Tentang kerahasiaan slip gaji">
            <span className="flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Setiap kali slip dibuka atau dicetak, aktivitas itu tercatat di log audit. Jika ada
                selisih perhitungan, ajukan keberatan ke HRD paling lambat 7 hari sejak slip terbit.
              </span>
            </span>
          </Alert>
        </>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Rincian gaji ${formatPeriod(detail.period)}` : ""}
        size="md"
        footer={
          detail ? (
            <Link href={`/print/payslip/${detail._id}`} target="_blank">
              <Button size="sm" icon={Printer}>
                Cetak / simpan PDF
              </Button>
            </Link>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-5">
            <DecisionEvidence evidence={detail.decisionEvidence} />
            <Section title="Penghasilan">
              <Line label="Gaji pokok" amount={detail.basicSalary} />
              {detail.allowances.map((a) => (
                <Line key={a.name} label={a.name} amount={a.amount} />
              ))}
              {detail.overtimeSalary > 0 && (
                <Line label={`Lembur (${detail.overtimeHours} jam)`} amount={detail.overtimeSalary} />
              )}
              <Line label="Total penghasilan" amount={detail.totalEarnings} strong />
            </Section>

            <Section title="Potongan">
              {detail.deductions.length === 0 ? (
                <p className="text-label text-muted py-2">Tidak ada potongan pada periode ini.</p>
              ) : (
                detail.deductions.map((d) => <Line key={d.name} label={d.name} amount={d.amount} />)
              )}
              <Line label="Total potongan" amount={detail.totalDeductions} strong />
            </Section>

            <div className="flex items-center justify-between gap-4 rounded-lg bg-primary-soft text-primary px-4 py-3.5">
              <span className="text-label font-semibold">Gaji bersih</span>
              <span className="text-title-sm font-semibold tabular-nums">{formatRupiah(detail.netSalary)}</span>
            </div>

            <p className="text-caption text-subtle leading-relaxed">
              Dasar perhitungan: {detail.presentDays} kehadiran dari {detail.workingDays} hari kerja,
              {" "}
              {detail.lateMinutes} menit keterlambatan
              {detail.absentDays ? `, ${detail.absentDays} hari tanpa keterangan` : ""}.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-1.5">{title}</h3>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </div>
  );
}

function Line({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-2 ${strong ? "font-semibold" : ""}`}>
      <span className="text-label text-foreground/90">{label}</span>
      <span className="text-label tabular-nums shrink-0">{formatRupiah(amount)}</span>
    </div>
  );
}
