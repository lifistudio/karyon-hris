"use client";

import React, { useCallback, useEffect, useState } from "react";
import { EyeOff, MessageSquarePlus, MessageSquareWarning, Paperclip, ShieldCheck } from "@/components/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  StatusBadge,
  Textarea,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { Pagination } from "@/components/ui/Pagination";
import {
  FileOrLinkInput,
  attachmentProblem,
  toAttachmentInputs,
  type AttachmentItem,
} from "@/components/ui/FileOrLinkInput";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/time";
import { COMPLAINT_TARGET_LABELS } from "@/lib/hr/labels";

const CATEGORIES: Record<string, string> = {
  etik: "Pelanggaran etik / kecurangan",
  pelecehan: "Pelecehan atau diskriminasi",
  keselamatan: "Keselamatan & kesehatan kerja",
  fasilitas: "Fasilitas kantor",
  atasan: "Hubungan dengan atasan/rekan",
  lainnya: "Lainnya",
};

interface ComplaintResponse {
  _id?: string;
  message: string;
  createdAt: string;
}

interface Complaint {
  _id: string;
  ticketCode: string;
  subject: string;
  description: string;
  category: string;
  target: string;
  isAnonymous: boolean;
  status: string;
  createdAt: string;
  attachments?: string;
  responses: ComplaintResponse[];
}

export default function PortalComplaintsPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<Complaint | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{ items: Complaint[] }>(`/api/v1/complaints?mine=1&page=${page}&limit=${limit}`);
      setItems(res.data?.items ?? []);
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Pengaduan</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">
            Sampaikan keluhan atau laporan, termasuk secara anonim.
          </p>
        </div>
        <Button icon={MessageSquarePlus} onClick={() => setFormOpen(true)}>
          Buat pengaduan
        </Button>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}

      <Alert tone="info" title="Bagaimana anonimitas bekerja di sini">
        <span className="flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Pengaduan anonim <strong>tidak menampilkan identitas Anda kepada atasan</strong>. Identitas
            tetap tersimpan terbatas untuk HRD dan Audit agar laporan dapat dipertanggungjawabkan dan
            Anda tetap bisa memantau tindak lanjutnya di halaman ini.
          </span>
        </span>
      </Alert>

      <Card>
        <CardHeader title="Pengaduan saya" description={`${total} tiket.`} icon={MessageSquareWarning} />
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={MessageSquareWarning}
              title="Belum ada pengaduan"
              description="Setiap laporan yang Anda kirim akan tercatat dengan nomor tiket dan dapat dipantau statusnya."
              action={
                <Button size="sm" icon={MessageSquarePlus} onClick={() => setFormOpen(true)}>
                  Buat pengaduan
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {items.map((c) => (
                <li key={c._id}>
                  <button
                    onClick={() => setDetail(c)}
                    className="w-full text-left px-5 py-4 hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-label font-mono text-subtle">{c.ticketCode}</span>
                          {c.isAnonymous && (
                            <Badge tone="neutral" icon={EyeOff}>
                              Anonim
                            </Badge>
                          )}
                          <Badge tone="primary">{COMPLAINT_TARGET_LABELS[c.target] ?? c.target}</Badge>
                        </div>
                        <p className="text-body font-semibold mt-1.5 truncate">{c.subject}</p>
                        <p className="text-caption text-subtle mt-0.5">
                          {CATEGORIES[c.category] ?? c.category} · {formatDateTime(c.createdAt)}
                          {c.responses.length > 0 && ` · ${c.responses.length} tanggapan`}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {total > limit && (
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPage={setPage} />
      )}

      <ComplaintForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onDone={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.ticketCode} — ${detail.subject}` : ""}
        size="md"
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="primary">{COMPLAINT_TARGET_LABELS[detail.target] ?? detail.target}</Badge>
              <Badge tone="neutral">{CATEGORIES[detail.category] ?? detail.category}</Badge>
              {detail.isAnonymous && (
                <Badge tone="neutral" icon={EyeOff}>
                  Anonim
                </Badge>
              )}
            </div>

            <div>
              <h3 className="eyebrow mb-1.5">
                Uraian yang Anda kirim
              </h3>
              <p className="text-body text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {detail.description}
              </p>
              {detail.attachments && (
                <a
                  href={detail.attachments}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-label text-primary hover:underline"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Lihat lampiran
                </a>
              )}
            </div>

            <div>
              <h3 className="eyebrow mb-1.5">
                Tindak lanjut
              </h3>
              {detail.responses.length === 0 ? (
                <p className="text-label text-muted">
                  Belum ada tanggapan. Anda akan menerima notifikasi begitu ada perkembangan.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {detail.responses.map((r, i) => (
                    <li key={r._id ?? i} className="rounded-lg bg-surface-2 border border-line p-3">
                      <p className="text-label leading-relaxed whitespace-pre-wrap">{r.message}</p>
                      <p className="text-caption text-subtle mt-1.5">{formatDateTime(r.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ComplaintForm({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [target, setTarget] = useState("hrd");
  const [category, setCategory] = useState("lainnya");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentItem[]>([]);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget("hrd");
    setCategory("lainnya");
    setSubject("");
    setDescription("");
    setIsAnonymous(false);
    setAttachment([]);
    setFileError("");
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = attachmentProblem(attachment);
    setFileError(problem ?? "");
    if (problem) return;
    setSaving(true);
    try {
      const res = await api.post("/api/v1/complaints", {
        target,
        category,
        subject: subject.trim(),
        description: description.trim(),
        isAnonymous,
        attachmentInput: toAttachmentInputs(attachment)[0],
      });
      toast.success("Pengaduan terkirim", res.message);
      onDone();
    } catch (err) {
      toast.error("Pengiriman gagal", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat pengaduan"
      description="Laporan Anda diteruskan ke pihak yang Anda pilih dan tercatat dengan nomor tiket."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="complaint-form" loading={saving}>
            Kirim pengaduan
          </Button>
        </>
      }
    >
      <form id="complaint-form" onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Ditujukan kepada" required htmlFor="cp-target">
            <Select id="cp-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(COMPLAINT_TARGET_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kategori" required htmlFor="cp-category">
            <Select id="cp-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORIES).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Judul singkat" required htmlFor="cp-subject">
          <Input
            id="cp-subject"
            required
            maxLength={150}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Contoh: AC ruang rapat lantai 2 tidak berfungsi"
          />
        </Field>

        <Field
          label="Uraian kejadian"
          required
          htmlFor="cp-desc"
          hint={`${description.trim().length}/30 karakter minimum. Sertakan waktu, tempat, dan pihak yang terlibat bila relevan.`}
          error={
            description.length > 0 && description.trim().length < 30
              ? "Uraian masih terlalu singkat untuk dapat ditindaklanjuti."
              : undefined
          }
        >
          <Textarea
            id="cp-desc"
            required
            maxLength={5000}
            className="min-h-36"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ceritakan kronologinya selengkap mungkin…"
          />
        </Field>

        <Field label="Lampiran bukti (opsional)" htmlFor="cp-file" error={fileError} hint="Foto, tangkapan layar, PDF, atau tautan ke berkas pendukung.">
          <FileOrLinkInput
            id="cp-file"
            value={attachment}
            onChange={(next) => {
              setAttachment(next);
              setFileError("");
            }}
            context="complaint"
            invalid={Boolean(fileError)}
            disabled={saving}
          />
        </Field>

        <div className="rounded-lg border border-line p-3">
          <Toggle
            checked={isAnonymous}
            onChange={setIsAnonymous}
            label="Kirim sebagai anonim"
            description="Nama Anda disembunyikan dari penerima laporan. HRD dan Audit tetap dapat melihatnya bila diperlukan untuk investigasi."
          />
        </div>
      </form>
    </Modal>
  );
}
