"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, DatabaseBackup, History, RefreshCw, Server, Webhook } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

type Overview = {
  current: string;
  latest: { version: string; image: string; notes: string; publishedAt: string | null } | null;
  updateAvailable: boolean;
  method: "manager" | "dokploy" | "webhook" | "legacy-manager" | "manual";
  manager: { available: boolean; supportsUpdate: boolean; stage: string; code?: string; previousImage?: string | null; backups?: Array<{ name: string; size: number; createdAt: string }> };
  target: { mode: "dokploy"; url: string; composeId: string; apiKeySet: boolean } | { mode: "webhook"; url: string } | null;
  previousImage: string | null;
};

const RUNNING = ["validating", "backing_up", "downloading", "restarting", "checking", "rolling_back"];
const STAGE: Record<string, string> = {
  validating: "Memeriksa versi…", backing_up: "Mencadangkan database…", downloading: "Mengunduh versi baru. Aplikasi tetap dapat digunakan.",
  restarting: "Memulai ulang aplikasi. Halaman akan tersambung kembali sebentar lagi.", checking: "Memastikan aplikasi sehat…", rolling_back: "Versi baru gagal dijalankan, mengembalikan versi sebelumnya…",
};
const FAILURE: Record<string, string> = {
  UPDATE_ROLLED_BACK: "Versi baru tidak sehat, jadi aplikasi otomatis kembali ke versi sebelumnya. Data tetap aman.",
  BACKUP_FAILED: "Cadangan database gagal dibuat, pembaruan dibatalkan sebelum ada perubahan.",
  IMAGE_NOT_ALLOWED: "Versi yang diminta bukan image resmi HRIS.",
  ROLLBACK_FAILED: "Aplikasi belum berhasil dipulihkan otomatis. Periksa server (docker compose logs app manager).",
};
const version = (image?: string | null) => (image ? (image.startsWith("sha256:") ? `${image.slice(0, 19)}…` : image.split(":").pop()) : "—");
const size = (bytes: number) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Version, update and rollback for the superadmin (Lisensi & Paket). */
export function AppUpdatePanel() {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<"update" | "rollback" | null>(null), [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"dokploy" | "webhook">("dokploy"), [url, setUrl] = useState(""), [apiKey, setApiKey] = useState(""), [composeId, setComposeId] = useState("");

  const load = useCallback(async () => {
    try { const res = await api.get<Overview>("/api/v1/system/update", { cache: "no-store" }); setData(res.data ?? null); setError(""); }
    catch (err) { setError(errorMessage(err)); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const running = !!data && RUNNING.includes(data.manager.stage);
  useEffect(() => {
    if (!running) return;
    // The app restarts during an update; keep polling quietly until it answers again.
    const timer = setInterval(() => { void api.get<Overview>("/api/v1/system/update", { cache: "no-store" }).then((res) => res.data && setData(res.data)).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [running]);

  const act = async (action: "update" | "rollback") => {
    setBusy(action); setConfirm(null);
    try { const res = await api.post("/api/v1/system/update", { action }); toast.success(action === "update" ? "Pembaruan dimulai" : "Mengembalikan versi", res.message ?? ""); await load(); }
    catch (err) { toast.error("Tidak dapat dimulai", errorMessage(err)); }
    finally { setBusy(""); }
  };
  const saveTarget = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy("target");
    try {
      await api.put("/api/v1/system/update", mode === "dokploy" ? { mode, url: url.trim(), composeId: composeId.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } : { mode, url: url.trim() });
      toast.success("Tersimpan", "Tombol Perbarui sekarang memakai platform ini."); setEditing(false); setApiKey(""); await load();
    } catch (err) { toast.error("Gagal menyimpan", errorMessage(err)); }
    finally { setBusy(""); }
  };
  const removeTarget = async () => {
    setBusy("target");
    try { await api.delete("/api/v1/system/update"); setEditing(false); await load(); } catch (err) { toast.error("Gagal", errorMessage(err)); } finally { setBusy(""); }
  };

  if (error) return <Card><CardHeader icon={ArrowUpCircle} title="Versi & pembaruan" /><CardBody><Alert tone="warning">{error}</Alert></CardBody></Card>;
  if (!data) return null;
  const canUpdate = data.method === "manager" || data.method === "dokploy" || data.method === "webhook";
  const canRollback = (data.method === "manager" || data.method === "dokploy") && !!data.previousImage;
  const editTarget = () => {
    setEditing(true);
    if (data.target?.mode === "dokploy") { setMode("dokploy"); setUrl(data.target.url); setComposeId(data.target.composeId); }
    else { setMode(data.target?.mode === "webhook" ? "webhook" : "dokploy"); setUrl(""); setComposeId(""); }
  };

  return (
    <Card>
      <CardHeader icon={ArrowUpCircle} title="Versi & pembaruan" description="Perbarui HRIS tanpa terminal. Database disesuaikan otomatis saat aplikasi mulai: tabel dan kolom baru ditambahkan, data lama tidak dihapus."
        actions={data.updateAvailable ? <Badge tone="warning" dot>Versi baru tersedia</Badge> : <Badge tone="success" dot>Terbaru</Badge>} />
      <CardBody className="space-y-5">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Versi berjalan</dt><dd className="mt-1 text-body-lg font-semibold text-heading font-mono">{data.current}</dd></div>
          <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Versi terbaru</dt><dd className="mt-1 text-body-lg font-semibold text-heading font-mono">{data.latest?.version ?? "—"}</dd></div>
          <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Cara pembaruan</dt><dd className="mt-1 text-body font-semibold text-heading">{({ manager: "Pengelola installer", dokploy: "Dokploy", webhook: "Webhook deploy", "legacy-manager": "Installer lama", manual: "Belum terhubung" } as Record<string, string>)[data.method]}</dd></div>
        </dl>

        {running && <Alert title="Pembaruan berjalan"><span role="status" aria-live="polite">{STAGE[data.manager.stage] ?? "Memproses…"} Data Anda tetap tersimpan.</span></Alert>}
        {data.manager.stage === "failed" && data.manager.code && <Alert tone="warning" title="Pembaruan terakhir tidak selesai">{FAILURE[data.manager.code] ?? "Pembaruan gagal. Coba lagi beberapa saat atau periksa log server."}</Alert>}
        {data.manager.stage === "complete" && !data.updateAvailable && <Alert tone="success">Pembaruan terakhir selesai. Aplikasi berjalan pada versi {data.current}.</Alert>}
        {data.latest?.notes && data.updateAvailable && <div className="rounded-[var(--radius-control)] border border-line p-4"><p className="text-label font-semibold text-heading mb-1">Catatan versi {data.latest.version}</p><p className="text-body-sm text-muted whitespace-pre-line">{data.latest.notes}</p></div>}

        {data.method === "legacy-manager" && <Alert tone="warning" title="Perbarui pengelola sekali">Jalankan perintah instalasi dari website lisensi satu kali lagi di folder instalasi yang sama. Setelah itu tombol Perbarui dapat dipakai langsung dari sini.</Alert>}
        {data.method === "manual" && !editing && <Alert>Instalasi ini belum terhubung ke platform deploy. Untuk Dokploy, isi alamat Dokploy, API key, dan Compose ID di bawah. Untuk platform lain (Coolify, Portainer, CapRover), tempel URL webhook deploy. Instalasi dengan installer resmi tidak perlu pengaturan ini.</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button icon={ArrowUpCircle} loading={busy === "update" || running} disabled={!canUpdate || !data.latest || !!busy || running} onClick={() => setConfirm("update")}>
            {data.updateAvailable ? `Perbarui ke ${data.latest?.version}` : "Pasang ulang versi terbaru"}
          </Button>
          {canRollback && <Button variant="secondary" icon={History} loading={busy === "rollback"} disabled={!!busy || running} onClick={() => setConfirm("rollback")}>Kembali ke versi {version(data.previousImage)}</Button>}
          <Button variant="ghost" icon={RefreshCw} disabled={!!busy} onClick={() => void load()}>Periksa lagi</Button>
          {data.method !== "manager" && <Button variant="ghost" icon={data.target?.mode === "webhook" ? Webhook : Server} disabled={!!busy} onClick={editTarget}>{data.target ? "Ubah platform deploy" : "Hubungkan platform deploy"}</Button>}
        </div>

        {editing && (
          <form className="space-y-4 rounded-[var(--radius-control)] border border-line p-4" onSubmit={saveTarget}>
            <Field label="Platform"><Select value={mode} onChange={(event) => setMode(event.target.value as "dokploy" | "webhook")}><option value="dokploy">Dokploy (API)</option><option value="webhook">Webhook deploy (Coolify, Portainer, CapRover, dll.)</option></Select></Field>
            {mode === "dokploy" ? (<>
              <Field label="Alamat Dokploy" hint="Contoh https://dokploy.perusahaan.co.id"><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://dokploy.perusahaan.co.id" required /></Field>
              <Field label="API key Dokploy" hint={data.target?.mode === "dokploy" ? "Kosongkan untuk tetap memakai key tersimpan." : "Dokploy → Settings → Profile → API/CLI → Generate. Disimpan terenkripsi."}><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required={data.target?.mode !== "dokploy"} /></Field>
              <Field label="Compose ID" hint="Buka layanan Compose HRIS di Dokploy; ID ada di alamat halaman (…/services/compose/<ID>)."><Input value={composeId} onChange={(event) => setComposeId(event.target.value)} required /></Field>
              <Alert tone="warning">API key Dokploy memberi akses ke akun Dokploy Anda. Buat akun Dokploy khusus bila memungkinkan, dan jangan bagikan akses Superadmin HRIS.</Alert>
            </>) : (
              <Field label="URL webhook deploy" hint="Webhook memicu deploy ulang dengan tag yang terpasang. Pakai HRIS_IMAGE=ghcr.io/lifistudio/hris:latest dan pull_policy: always agar selalu mengambil versi terbaru."><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" required /></Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "target"}>Simpan</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Batal</Button>
              {data.target && <Button type="button" variant="ghost" onClick={() => void removeTarget()}>Putuskan</Button>}
            </div>
          </form>
        )}

        {!!data.manager.backups?.length && (
          <div>
            <p className="flex items-center gap-2 text-label font-semibold text-heading mb-2"><DatabaseBackup className="w-4 h-4" /> Cadangan database otomatis (sebelum setiap pembaruan)</p>
            <ul className="text-body-sm text-muted space-y-1">{data.manager.backups.map((backup) => <li key={backup.name} className="font-mono">{backup.name} · {size(backup.size)}</li>)}</ul>
            <p className="text-caption text-subtle mt-2">Tersimpan di folder <code className="font-mono">backups/</code> instalasi; 5 terbaru disimpan. Cara memulihkan ada di dokumentasi (Cadangan data).</p>
          </div>
        )}
      </CardBody>
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm && void act(confirm)} loading={busy === confirm}
        title={confirm === "rollback" ? `Kembali ke versi ${version(data.previousImage)}?` : `Perbarui ke versi ${data.latest?.version ?? "terbaru"}?`}
        message={confirm === "rollback" ? "Aplikasi dimulai ulang dengan versi sebelumnya. Data tetap; kolom yang ditambahkan versi baru dibiarkan dan tidak mengganggu versi lama." : `Aplikasi dimulai ulang beberapa menit.${data.method === "manager" ? " Database dicadangkan dulu," : ""} Bila versi baru gagal berjalan, aplikasi otomatis kembali ke versi sekarang.`}
        confirmLabel={confirm === "rollback" ? "Kembalikan" : "Perbarui sekarang"} />
    </Card>
  );
}
