"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileSignature, Printer } from "@/components/icons";
import { Badge, Card, EmptyState, ErrorState, ICON_STROKE, SkeletonList } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { CONTRACT_STATUS_LABELS, contractTypeLabel, type ContractStatus } from "@/lib/hr/contracts";
import { formatDate } from "@/lib/time";

interface MyContract {
  _id: string;
  contractNumber: string;
  type: string;
  customTypeLabel?: string;
  startDate: string;
  endDate?: string | null;
  positionName?: string;
  status: ContractStatus | "expired";
  signedFile: string;
  signedFileName?: string;
  daysLeft: number | null;
}

/** The employee's own contracts, current first, with the signed copy when HR has uploaded it. */
export function MyContracts() {
  const [rows, setRows] = useState<MyContract[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    api
      .get<MyContract[]>("/api/v1/contracts?view=mine")
      .then((r) => setRows(r.data ?? []))
      .catch((err) => setError(errorMessage(err)));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <SkeletonList rows={3} />;
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={FileSignature} title="Belum ada kontrak tercatat" description="Hubungi HRD bila kontrak kerja Anda belum muncul di sini." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((c) => (
        <Card key={c._id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-body-lg font-semibold text-heading">{contractTypeLabel(c.type, c.customTypeLabel)}</p>
              <p className="text-label text-muted">
                {c.contractNumber}
                {c.positionName ? ` · ${c.positionName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={c.status === "active" ? "success" : c.status === "terminated" ? "danger" : "neutral"}>
                {CONTRACT_STATUS_LABELS[(c.status === "expired" ? "ended" : c.status) as ContractStatus]}
              </Badge>
              {c.status === "active" && c.daysLeft !== null && c.daysLeft <= 60 && (
                <Badge tone="warning">Berakhir {c.daysLeft} hari lagi</Badge>
              )}
            </div>
          </div>
          <p className="mt-3 text-body-sm text-foreground">
            {formatDate(c.startDate)} – {c.endDate ? formatDate(c.endDate) : "tidak ditentukan (karyawan tetap)"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.signedFile ? (
              <a href={c.signedFile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline">
                <ExternalLink className="w-4 h-4" strokeWidth={ICON_STROKE} />
                Kontrak bertanda tangan
              </a>
            ) : (
              <Link href={`/print/contract/${c._id}`} className="inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline">
                <Printer className="w-4 h-4" strokeWidth={ICON_STROKE} />
                Lihat dokumen kontrak
              </Link>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
