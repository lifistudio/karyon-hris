import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { parseBody, BadRequest, Forbidden, NotFound, enforceIpRateLimit, HttpError } from "@/lib/guard";
import { RATE_RULES, clientIp } from "@/lib/rate-limit";
import { connectToDatabase } from "@/lib/db";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider, decodeDataUrl } from "@/lib/storage";
import { optimizeImage } from "@/lib/storage/image";
import { safeEqual } from "@/lib/crypto";
import { notifyUsers, resolveRecipientsByRole } from "@/lib/notification/notify";
import { buildAnswersSchema } from "@/lib/hr/application-form";
import { ingestAnswers, referenceFor, resolveFormFields } from "@/lib/hr/applications";
import Candidate from "@/models/Candidate";
import CandidateStageHistory from "@/models/CandidateStageHistory";
import JobVacancy from "@/models/JobVacancy";

/**
 * Public job-application intake — this app's career page and, with an
 * `x-api-key` header, external company sites.
 *
 * The answers are validated against the vacancy's own form definition, rebuilt
 * from the database on every request: a field HR switched off is dropped, a
 * required field cannot be skipped by posting to the API directly, and options
 * outside the configured list are refused.
 *
 * Everything else here is untrusted input as well: rate limited per address,
 * bot-checked with Turnstile when configured, and answered with one neutral
 * message so the endpoint cannot be used to learn whether an address applied.
 */

const schema = z.object({
  /** Preferred: the vacancy slug from the public listing. */
  vacancySlug: z.string().trim().min(3).max(120).optional(),
  /** Accepted for older integrations that still post a vacancy id. */
  vacancyId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  /** Answers keyed by form field key. */
  answers: z.record(z.string(), z.unknown()).optional(),

  /* Pre-form payload, still accepted from external integrations. */
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  cv: z.string().optional(),
  coverLetter: z.string().optional(),
  portfolioUrl: z.string().optional(),

  turnstileToken: z.string().optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ip = clientIp(req);
  enforceIpRateLimit("public-candidate", req, RATE_RULES.publicWrite);

  // External integrations authenticate with a shared key; the career page on
  // this origin does not need one.
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.PUBLIC_API_KEY;
  if (apiKey && (!expectedKey || !safeEqual(apiKey, expectedKey))) {
    throw Forbidden("API key tidak dikenali.");
  }

  const body = await parseBody(req, schema);
  await verifyTurnstile(body.turnstileToken, ip);
  if (!body.vacancySlug && !body.vacancyId) throw BadRequest("Lowongan yang dilamar wajib disertakan.");

  await connectToDatabase();
  const now = new Date();
  const vacancy = await JobVacancy.findOne({
    ...(body.vacancySlug ? { slug: body.vacancySlug } : { _id: body.vacancyId }),
    status: "open",
    $or: [{ closesAt: null }, { closesAt: { $gte: now } }],
  }).lean<{
    _id: RecordId;
    title: string;
    slug: string;
    positionId?: unknown;
    stages?: string[];
    formFields?: unknown;
  } | null>();
  if (!vacancy) throw NotFound("Lowongan yang Anda pilih tidak ditemukan atau sudah ditutup.");

  const fields = resolveFormFields(vacancy);
  const legacy = !body.answers;

  // An integration still posting the old flat payload is mapped onto the
  // system fields, so it keeps working against a configurable form. Its CV
  // arrives inline and is stored further down, outside the upload flow.
  const rawAnswers: Record<string, unknown> = legacy
    ? {
        name: body.name ?? "",
        email: body.email ?? "",
        phone: body.phone ?? "",
        ...(body.coverLetter ? { coverLetter: body.coverLetter } : {}),
        ...(body.portfolioUrl ? { portfolio: [{ kind: "link", url: body.portfolioUrl }] } : {}),
      }
    : body.answers!;

  // Required fields a legacy payload cannot supply are relaxed for it only.
  const effectiveFields = legacy
    ? fields.map((f) => (["name", "email", "phone"].includes(f.system ?? "") ? f : { ...f, required: false }))
    : fields;

  const parsed = buildAnswersSchema(effectiveFields).safeParse(rawAnswers);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, "VALIDATION_ERROR", first?.message ?? "Isian lamaran belum lengkap.", {
      fields: parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })),
    });
  }
  const answers = parsed.data as Record<string, unknown>;

  const neutralMessage =
    "Terima kasih. Lamaran Anda sudah kami terima dan akan ditinjau tim rekrutmen. " +
    "Kami menghubungi pelamar yang profilnya sesuai melalui email atau telepon.";

  // A repeat application to the same opening is answered exactly like a new
  // one, rather than with a conflict that would confirm the address is on file.
  const email = String(answers.email ?? "").toLowerCase();
  const existing = await Candidate.exists({ email, vacancyId: vacancy._id });
  if (existing) return apiSuccess(null, neutralMessage);

  const candidateId = new RecordId();
  const { stored, columns } = await ingestAnswers(effectiveFields, answers, {
    vacancyId: String(vacancy._id),
    candidateId: String(candidateId),
    ownerUserId: null,
    scope: vacancy.slug,
  });

  if (legacy && body.cv) {
    const decoded = decodeDataUrl(body.cv, ["application/pdf", "image/jpeg", "image/png"]);
    // A photographed CV is stored as WebP like every other image; a PDF is kept as is.
    const { buffer, ext, mime } = decoded.mime === "application/pdf" ? decoded : await optimizeImage(decoded.buffer);
    const key = await storageProvider.upload(buffer, `candidates/${String(vacancy._id)}/${String(candidateId)}/cv${ext}`, mime);
    const cvAnswer = stored.find((a) => a.system === "cv");
    const attachment = { kind: "file" as const, key, name: `cv${ext}`, mime, size: buffer.byteLength };
    if (cvAnswer) cvAnswer.attachments = [attachment];
    else stored.push({ key: "cv", label: "CV", type: "file", section: "Dokumen", system: "cv", value: null, attachments: [attachment] });
    columns.hasCv = true;
    columns.cvUrl = key;
  }

  const firstStage = vacancy.stages?.[0] ?? "Lamaran Masuk";
  const reference = referenceFor(candidateId);

  let candidate;
  try {
    candidate = await Candidate.create({
      _id: candidateId,
      ...columns,
      vacancyId: vacancy._id,
      positionId: vacancy.positionId ?? null,
      source: apiKey ? "api" : "career_page",
      currentStage: firstStage,
      status: "pending",
      answers: stored,
      reference,
      lastActivityAt: now,
    });
  } catch (err) {
    // Two submissions racing past the duplicate check: the unique index lets
    // one through, and the other gets the same neutral answer.
    if ((err as { code?: number }).code === 11000) return apiSuccess(null, neutralMessage);
    throw err;
  }

  await CandidateStageHistory.create({
    candidateId: candidate._id,
    stage: firstStage,
    status: "pending",
    type: "applied",
    notes: apiKey ? "Lamaran masuk melalui Public API eksternal" : "Lamaran masuk melalui halaman karier",
  });

  void JobVacancy.updateOne({ _id: vacancy._id }, { $inc: { applicantCount: 1 } }).catch(() => {});

  // The notification carries no contact details, only enough to go and look.
  void resolveRecipientsByRole("HRD")
    .then((recipients) =>
      notifyUsers(recipients, {
        kind: "recruitment",
        title: `Pelamar baru: ${vacancy.title}`,
        body: `${columns.name} melamar posisi ${vacancy.title}${columns.city ? ` dari ${columns.city}` : ""}.`,
        href: `/admin/recruitment/${String(candidate._id)}`,
        emailOptOut: true,
      })
    )
    .catch(() => {});

  void logActivity({
    userId: null,
    action: "PUBLIC_CANDIDATE_APPLY",
    module: "recruitment",
    after: { vacancy: vacancy.title, source: apiKey ? "api" : "career_page", reference },
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
  });

  // Only a reference is echoed back — never the stored record, which would leak
  // internal ids and pipeline state to an anonymous caller.
  return apiSuccess({ reference }, neutralMessage, undefined, 201);
});

async function verifyTurnstile(token: string | undefined, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return; // not configured: rate limiting is the only gate
  if (!token) throw BadRequest("Verifikasi keamanan belum diselesaikan. Muat ulang halaman lalu coba lagi.");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  if (!data?.success) throw BadRequest("Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.");
}
