"use client";

import React, { use, useEffect, useState } from "react";
import { PrintShell } from "@/components/print/PrintShell";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateTime } from "@/lib/time";
import { CHECK_RESULT_LABELS } from "@/lib/inventory/templates";
import { categoryLabel, conditionLabel } from "@/components/inventory/parts";
import type { AssetDetail } from "@/components/inventory/AssetDrawer";

/**
 * The BAST as a paper document: for an employee who signs by hand, and for an
 * auditor who wants the signed record in a file. The specification shown is the
 * one handed over, not the asset's current one.
 */
export default function BastPrintPage({ params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { id, assignmentId } = use(params);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<AssetDetail>(`/api/v1/inventory/${id}`)
      .then((res) => setDetail(res.data ?? null))
      .catch((err) => setError(errorMessage(err, "BAST gagal dimuat.")));
  }, [id]);

  const handover = detail?.assignments.find((a) => a._id === assignmentId);

  return (
    <PrintShell backHref="/admin/inventory" backLabel="Kembali ke inventaris" title="Berita acara serah terima" subtitle={detail?.asset.code}>
      <div className="paper mx-auto max-w-[210mm] bg-white p-[18mm] text-[11pt] leading-relaxed text-black">
        {error && <p>{error}</p>}
        {!error && !handover && <p>Memuat…</p>}
        {detail && handover && (
          <>
            <h1 className="text-center text-[15pt] font-bold">Berita Acara Serah Terima Aset</h1>
            <p className="mt-1 text-center">{formatDate(handover.handoverDate)}</p>

            <table className="mt-6 w-full border-collapse">
              <tbody>
                {[
                  ["Kode aset", detail.asset.code],
                  ["Nama aset", detail.asset.name],
                  ["Kategori", categoryLabel(detail.asset.category)],
                  ["Penerima", `${handover.employeeId?.name ?? "-"}${handover.employeeId?.employeeId ? ` (${handover.employeeId.employeeId})` : ""}`],
                  ["Kondisi saat diserahkan", conditionLabel(handover.handoverCondition)],
                  ...(handover.handoverReading != null ? [["Pembacaan", handover.handoverReading.toLocaleString("id-ID")]] : []),
                  ...((handover.handoverSpecs?.length ? handover.handoverSpecs : detail.asset.specs ?? []).map((s) => [s.label, s.value])),
                ].map(([label, value]) => (
                  <tr key={label} className="border-b border-neutral-300">
                    <th scope="row" className="w-[38%] py-1.5 pe-3 text-start font-medium">{label}</th>
                    <td className="py-1.5">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {handover.handoverChecklist && handover.handoverChecklist.length > 0 && (
              <>
                <h2 className="mt-6 font-bold">Hasil pemeriksaan</h2>
                <table className="mt-1 w-full border-collapse">
                  <tbody>
                    {handover.handoverChecklist.map((item) => (
                      <tr key={item.label} className="border-b border-neutral-300">
                        <th scope="row" className="w-[38%] py-1.5 pe-3 text-start font-medium">{item.label}</th>
                        <td className="py-1.5">{CHECK_RESULT_LABELS[item.result]}{item.note ? `: ${item.note}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {handover.handoverNotes && <p className="mt-4">Kelengkapan: {handover.handoverNotes}</p>}

            <p className="mt-6">
              Penerima menyatakan telah menerima aset di atas dalam kondisi sesuai catatan ini dan bertanggung jawab atas pemeliharaannya sampai aset dikembalikan.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-8 text-center">
              <div>
                <p>Yang menyerahkan</p>
                <div className="h-24" />
                <p className="border-t border-black pt-1">{handover.assignedBy?.email ?? ""}</p>
              </div>
              <div>
                <p>Yang menerima</p>
                <div className="grid h-24 place-items-center">
                  {handover.signature && !handover.signature.pdf && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
                    <img src={handover.signature.href} alt="Tanda tangan penerima" className="max-h-24 object-contain" />
                  )}
                </div>
                <p className="border-t border-black pt-1">{handover.employeeId?.name ?? ""}</p>
              </div>
            </div>

            {handover.signedAt && (
              <p className="mt-6 break-all text-[9pt]">
                Ditandatangani {formatDateTime(handover.signedAt)}{handover.signedVia === "paper" ? " (BAST kertas)" : " melalui portal"}
                {handover.signatureHash ? `. Kode verifikasi ${handover.signatureHash}` : ""}
              </p>
            )}
          </>
        )}
      </div>
    </PrintShell>
  );
}
