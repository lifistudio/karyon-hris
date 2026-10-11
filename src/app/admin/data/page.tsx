"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, KeyRound, TriangleAlert, Upload } from "@/components/icons";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, PageHeader, Select, SkeletonList, Tabs, TableWrap, Td, Th,
} from "@/components/ui";
import { DatePicker, MonthPicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/export/catalog";
import { IMPORT_DATASETS, type ImportDataset } from "@/lib/import/catalog";
import { wibDateKey, wibPeriodKey } from "@/lib/time";

type Preview = {
  rows: Array<{ line: number; action: "create" | "update"; label: string; errors: string[]; warnings: string[] }>;
  counts: { create: number; update: number; invalid: number };
  missingColumns: string[];
  created?: number;
  updated?: number;
  credentials?: Array<{ nip: string; name: string; email: string; password: string }>;
};

/** Downloads through fetch so a permission error shows a message instead of a JSON page. */
async function download(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Gagal mengunduh (${res.status}).`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ExportPanel() {
  const toast = useToast();
  const [period, setPeriod] = useState(wibPeriodKey());
  const [date, setDate] = useState(wibDateKey());
  const [busy, setBusy] = useState("");
  const run = async (dataset: ExportDataset, format: "xlsx" | "csv") => {
    const meta = EXPORT_DATASETS[dataset];
    const params = new URLSearchParams({ dataset, format });
    if (meta.needs === "period" || meta.needs === "kpiPeriod") params.set("period", period);
    if (meta.needs === "date") params.set("date", date);
    setBusy(`${dataset}:${format}`);
    try { await download(`/api/v1/reports/export?${params}`, `${dataset}.${format}`); toast.success("Ekspor siap", meta.label); }
    catch (err) { toast.error("Ekspor gagal", errorMessage(err)); }
    finally { setBusy(""); }
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1.5 text-body-sm font-semibold text-foreground">Periode bulanan
            <MonthPicker value={period} onChange={(v) => setPeriod(v || wibPeriodKey())} className="w-48" aria-label="Periode bulanan" />
          </label>
          <label className="grid gap-1.5 text-body-sm font-semibold text-foreground">Tanggal (kehadiran harian)
            <DatePicker value={date} onChange={(v) => setDate(v || wibDateKey())} max={wibDateKey()} className="w-48" aria-label="Tanggal kehadiran" />
          </label>
          <p className="text-body-sm text-muted max-w-xl">Data mengikuti lingkup izin Anda. NIK, NPWP, dan nomor rekening lengkap hanya untuk izin seluruh perusahaan; selain itu disamarkan. Setiap ekspor tercatat di log audit.</p>
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(EXPORT_DATASETS) as ExportDataset[]).map((id) => {
          const meta = EXPORT_DATASETS[id];
          return (
            <Card key={id} className="flex flex-col">
              <CardHeader icon={FileSpreadsheet} title={meta.label} description={meta.description} />
              <CardBody className="mt-auto flex flex-wrap items-center gap-2">
                <Badge>{meta.needs === "period" ? `Periode ${period}` : meta.needs === "kpiPeriod" ? `Periode KPI ${period}` : meta.needs === "date" ? `Tanggal ${date}` : "Semua data"}</Badge>
                <span className="flex-1" />
                <Button size="sm" variant="secondary" icon={Download} loading={busy === `${id}:csv`} onClick={() => void run(id, "csv")}>CSV</Button>
                <Button size="sm" icon={Download} loading={busy === `${id}:xlsx`} onClick={() => void run(id, "xlsx")}>Excel</Button>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ImportPanel() {
  const toast = useToast();
  const [dataset, setDataset] = useState<ImportDataset>("employees");
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "commit" | "template">("");
  const meta = IMPORT_DATASETS[dataset];

  const reset = (next?: ImportDataset) => { if (next) setDataset(next); setFile(null); setCsv(""); setPreview(null); setDone(null); };
  const pick = async (picked: File | null) => {
    setPreview(null); setDone(null);
    if (!picked) { setFile(null); setCsv(""); return; }
    if (picked.size > 1_000_000) { toast.error("Berkas terlalu besar", "Maksimal 1 MB. Pecah menjadi beberapa berkas."); return; }
    setFile(picked); setCsv(await picked.text());
  };
  const send = async (commit: boolean) => {
    setBusy(commit ? "commit" : "check");
    try {
      const res = await api.post<Preview>("/api/v1/imports", { dataset, csv, commit });
      if (commit) { setDone(res.data ?? null); setPreview(null); toast.success("Impor selesai", res.message ?? ""); }
      else setPreview(res.data ?? null);
    } catch (err) { toast.error(commit ? "Impor dibatalkan" : "Pemeriksaan gagal", errorMessage(err)); }
    finally { setBusy(""); }
  };
  const credentialsCsv = useMemo(() => {
    if (!done?.credentials?.length) return "";
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [["NIP", "Nama", "Email", "Kata sandi awal"], ...done.credentials.map((c) => [c.nip, c.name, c.email, c.password])].map((r) => r.map(cell).join(",")).join("\r\n");
  }, [done]);
  const valid = preview && !preview.counts.invalid && !preview.missingColumns.length && preview.rows.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card>
        <CardHeader icon={FileUp} title="Impor CSV" description="Unggah → periksa → konfirmasi. Tidak ada data yang berubah sebelum Anda menekan Impor sekarang." />
        <CardBody className="space-y-4">
          <label className="grid gap-1.5 text-body-sm font-semibold text-foreground">Jenis data
            <Select value={dataset} onChange={(e) => reset(e.target.value as ImportDataset)} aria-label="Jenis data impor">
              {(Object.keys(IMPORT_DATASETS) as ImportDataset[]).map((id) => <option key={id} value={id}>{IMPORT_DATASETS[id].label}</option>)}
            </Select>
          </label>
          <p className="text-body-sm text-muted leading-relaxed">{meta.description}</p>
          <Button variant="secondary" icon={Download} loading={busy === "template"} className="w-full justify-center"
            onClick={async () => { setBusy("template"); try { await download(`/api/v1/imports?dataset=${dataset}`, `template-impor-${dataset}.csv`); } catch (err) { toast.error("Gagal", errorMessage(err)); } finally { setBusy(""); } }}>
            Unduh template CSV
          </Button>
          <label className="grid gap-1.5 text-body-sm font-semibold text-foreground">Berkas CSV (maks. 1 MB)
            <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              className="block w-full text-body-sm text-muted file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-2 file:font-semibold file:text-foreground" />
          </label>
          <div className="flex gap-2">
            <Button className="flex-1 justify-center" variant="secondary" disabled={!csv} loading={busy === "check"} onClick={() => void send(false)}>Periksa</Button>
            <Button className="flex-1 justify-center" icon={Upload} disabled={!valid} loading={busy === "commit"} onClick={() => void send(true)}>Impor sekarang</Button>
          </div>
          <div>
            <p className="eyebrow mb-2">Kolom</p>
            <ul className="space-y-1.5 text-body-sm">
              {meta.fields.map((f) => (
                <li key={f.key} className="flex flex-wrap gap-x-2"><span className="font-semibold text-foreground">{f.label}{"required" in f && f.required ? " *" : ""}</span>{"hint" in f && f.hint && <span className="text-muted">{f.hint}</span>}</li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4 min-w-0">
        {!preview && !done && (
          <Alert title="Tips impor aman">
            Gunakan template agar nama kolom cocok. Untuk instalasi baru impor berurutan: cabang, divisi, jabatan, lalu karyawan. CSV dengan pemisah koma atau titik koma (Excel Indonesia) sama-sama diterima. Nilai tersamarkan (••••) dari berkas ekspor tidak mengubah data.
          </Alert>
        )}
        {done && (
          <Card>
            <CardHeader icon={CheckCircle2} tone="success" title="Impor selesai" description={`${done.created ?? 0} data ditambahkan, ${done.updated ?? 0} diperbarui.`} />
            {credentialsCsv && (
              <CardBody className="space-y-3">
                <Alert tone="warning" title="Kata sandi awal hanya ditampilkan sekali">
                  {done.credentials!.length} akun login dibuat dengan kata sandi acak. Unduh sekarang dan sampaikan lewat saluran aman; karyawan wajib menggantinya saat login pertama bila pengaturan mewajibkan.
                </Alert>
                <Button icon={KeyRound} onClick={() => {
                  const href = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + credentialsCsv], { type: "text/csv" }));
                  Object.assign(document.createElement("a"), { href, download: "kredensial-awal.csv" }).click();
                  setTimeout(() => URL.revokeObjectURL(href), 1000);
                }}>Unduh kredensial awal</Button>
              </CardBody>
            )}
          </Card>
        )}
        {preview && (
          <Card>
            <CardHeader
              icon={preview.counts.invalid || preview.missingColumns.length ? TriangleAlert : CheckCircle2}
              tone={preview.counts.invalid || preview.missingColumns.length ? "warning" : "success"}
              title={`Pratinjau ${file?.name ?? ""}`}
              description={`${preview.counts.create} baru · ${preview.counts.update} diperbarui · ${preview.counts.invalid} bermasalah`}
            />
            {preview.missingColumns.length > 0 && <CardBody><Alert tone="danger" title="Kolom wajib tidak ditemukan">{preview.missingColumns.join(", ")}. Gunakan template agar nama kolom cocok.</Alert></CardBody>}
            <TableWrap>
              <thead><tr><Th>Baris</Th><Th>Data</Th><Th>Aksi</Th><Th>Hasil pemeriksaan</Th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 500).map((r) => (
                  <tr key={r.line} className="border-b border-line last:border-0 align-top">
                    <Td className="tabular-nums text-muted">{r.line}</Td>
                    <Td className="font-semibold text-foreground min-w-40">{r.label}</Td>
                    <Td><Badge tone={r.action === "create" ? "primary" : "info"}>{r.action === "create" ? "Baru" : "Perbarui"}</Badge></Td>
                    <Td className="text-body-sm min-w-64">
                      {r.errors.length ? <ul className="text-danger space-y-0.5">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="text-success">Valid</span>}
                      {r.warnings.length > 0 && <ul className="text-warning space-y-0.5 mt-1">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {preview.rows.length > 500 && <CardBody className="text-body-sm text-muted">Menampilkan 500 dari {preview.rows.length} baris.</CardBody>}
          </Card>
        )}
      </div>
    </div>
  );
}

function DataPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"export" | "import">(params.get("tab") === "import" ? "import" : "export");
  return (
    <div>
      <PageHeader eyebrow="Sistem" title="Ekspor & impor data" description="Unduh data ke Excel atau CSV untuk laporan dan arsip, atau pindahkan data dari spreadsheet ke HRIS dengan pemeriksaan per baris sebelum disimpan." />
      <div className="mb-5"><Tabs tabs={[{ id: "export", label: "Ekspor", icon: Download }, { id: "import", label: "Impor", icon: Upload }]} value={tab} onChange={setTab} /></div>
      {tab === "export" ? <ExportPanel /> : <ImportPanel />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<SkeletonList rows={4} />}><DataPage /></Suspense>;
}
