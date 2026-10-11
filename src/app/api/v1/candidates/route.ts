import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import bcrypt from "bcryptjs";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, pagination, BadRequest, Conflict, NotFound, HttpError } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { notifyUsers, resolveRecipientsByRole } from "@/lib/notification/notify";
import { buildAnswersSchema, type AddressValue, type StoredAnswer } from "@/lib/hr/application-form";
import { ingestAnswers, referenceFor, resolveFormFields } from "@/lib/hr/applications";
import type { StoredAttachment } from "@/lib/attachments";
import Candidate from "@/models/Candidate";
import CandidateStageHistory from "@/models/CandidateStageHistory";
import JobVacancy from "@/models/JobVacancy";
import Employee from "@/models/Employee";
import User from "@/models/User";
import Counter from "@/models/Counter";
import { initialPasswordFor } from "@/lib/auth/initial-password";
import { isoOffset } from "@/lib/time";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Status groups as HR thinks about them, rather than the raw enum. */
const STATUS_GROUPS: Record<string, Record<string, unknown>> = {
  active: { status: { $in: ["pending", "in_progress", "on_hold"] } },
  hired: { employeeId: { $ne: null } },
  passed: { status: "passed", employeeId: null },
  rejected: { status: "rejected" },
};

/* ------------------------------------------------------------------ */
/* GET — every applicant, filterable                                    */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "recruitment", "read");
  const sp = new URL(req.url).searchParams;
  const { page, limit, skip } = pagination(req, 25, 100);

  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  const q = sp.get("q")?.trim();
  if (q) {
    // Partial matches on the things people actually type: part of a name, a
    // phone number without its prefix, the reference code from an email.
    const rx = new RegExp(escapeRegex(q.slice(0, 80)), "i");
    and.push({ $or: [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }, { reference: rx }] });
  }

  const vacancyId = sp.get("vacancyId");
  if (vacancyId && /^[0-9a-fA-F]{24}$/.test(vacancyId)) filter.vacancyId = new RecordId(vacancyId);

  const stage = sp.get("stage");
  if (stage) filter.currentStage = stage;

  const group = sp.get("status");

  const source = sp.get("source");
  if (source && ["career_page", "api", "manual"].includes(source)) filter.source = source;

  const education = sp.get("education");
  if (education) filter.lastEducation = education;

  if (sp.get("hasCv") === "1") filter.hasCv = true;

  const minRating = Number(sp.get("minRating"));
  if (minRating > 0) filter.rating = { $gte: Math.min(5, minRating) };

  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    filter.createdAt = {
      ...(from ? { $gte: new Date(`${from}T00:00:00${isoOffset()}`) } : {}),
      ...(to ? { $lte: new Date(`${to}T23:59:59.999${isoOffset()}`) } : {}),
    };
  }

  const availableBy = sp.get("availableBy");
  if (availableBy) filter.availableFrom = { $lte: new Date(`${availableBy}T23:59:59.999${isoOffset()}`) };

  if (sp.get("interview") === "upcoming") filter.nextInterviewAt = { $gte: new Date() };

  const statusCond = group && STATUS_GROUPS[group] ? STATUS_GROUPS[group] : null;
  const withAnd = (extra: Record<string, unknown>[]) => {
    const all = [...and, ...extra];
    return all.length ? { ...filter, $and: all } : { ...filter };
  };
  const listFilter = withAnd(statusCond ? [statusCond] : []);

  const SORTS: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    rating: { rating: -1, createdAt: -1 },
    name: { name: 1 },
    activity: { lastActivityAt: -1 },
    available: { availableFrom: 1, createdAt: -1 },
    interview: { nextInterviewAt: 1 },
  };
  const sort = SORTS[sp.get("sort") ?? "newest"] ?? SORTS.newest;

  // Counts per status group ignore the status filter itself, so the tabs above
  // the list always show how many are in each.
  const [rows, total, facetCounts] = await Promise.all([
    Candidate.find(listFilter)
      .select("name email phone city lastEducation currentStage status rating hasCv source reference availableFrom expectedSalary nextInterviewAt employeeId createdAt lastActivityAt vacancyId tags")
      .populate("vacancyId", "title stages")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Candidate.countDocuments(listFilter),
    Promise.all(
      Object.entries(STATUS_GROUPS).map(async ([key, cond]) => [
        key,
        await Candidate.countDocuments(withAnd([cond])),
      ])
    ),
  ]);

  return apiSuccess(
    { rows, counts: Object.fromEntries(facetCounts) },
    `${total} pelamar ditemukan`,
    { page, limit, total }
  );
});

/* ------------------------------------------------------------------ */
/* POST — add a candidate by hand                                       */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  vacancyId: objectId,
  answers: z.record(z.string(), z.unknown()),
  note: z.string().trim().max(1000).optional(),
});

/**
 * For applicants who came through another channel — a referral, a walk-in, a
 * job fair. HR fills the same form a candidate would, so every applicant has
 * the same shape of record regardless of how they arrived.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const body = await parseBody(req, createSchema);

  const vacancy = await JobVacancy.findById(body.vacancyId).lean<{
    _id: RecordId;
    title: string;
    stages?: string[];
    positionId?: RecordId;
    formFields?: unknown;
  } | null>();
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan.");

  // Staff adding someone by hand often have only a name and a phone number.
  // Beyond the contact fields, nothing is required of them.
  const fields = resolveFormFields(vacancy).map((f) =>
    ["name", "email", "phone"].includes(f.system ?? "") ? f : { ...f, required: false }
  );
  const parsed = buildAnswersSchema(fields).safeParse(body.answers);
  if (!parsed.success) {
    throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Isian belum lengkap.", {
      fields: parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })),
    });
  }
  const answers = parsed.data as Record<string, unknown>;

  const email = String(answers.email ?? "");
  if (await Candidate.exists({ email, vacancyId: vacancy._id })) {
    throw Conflict(`${email} sudah terdaftar sebagai pelamar pada lowongan ini.`);
  }

  const candidateId = new RecordId();
  const { stored, columns } = await ingestAnswers(fields, answers, {
    vacancyId: String(vacancy._id),
    candidateId: String(candidateId),
    ownerUserId: ctx.user.id,
  });

  const firstStage = vacancy.stages?.[0] ?? "Lamaran Masuk";
  const candidate = await Candidate.create({
    _id: candidateId,
    ...columns,
    vacancyId: vacancy._id,
    positionId: vacancy.positionId ?? null,
    source: "manual",
    currentStage: firstStage,
    status: "pending",
    answers: stored,
    reference: referenceFor(candidateId),
    lastActivityAt: new Date(),
  });

  await CandidateStageHistory.create({
    candidateId: candidate._id,
    stage: firstStage,
    status: "pending",
    type: "applied",
    notes: body.note || "Ditambahkan manual oleh tim rekrutmen",
    authorUserId: ctx.user.id,
    authorName: ctx.user.email,
  });

  void JobVacancy.updateOne({ _id: vacancy._id }, { $inc: { applicantCount: 1 } }).catch(() => {});
  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_CANDIDATE",
    module: "recruitment",
    after: { name: columns.name, vacancy: vacancy.title },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ _id: candidate._id }, `${columns.name} ditambahkan ke tahap "${firstStage}".`, undefined, 201);
});

/* ------------------------------------------------------------------ */
/* PATCH — move stage, reject, reopen                                   */
/* ------------------------------------------------------------------ */

const moveSchema = z.object({
  id: objectId,
  stage: z.string().trim().min(2).max(60).optional(),
  status: z.enum(["pending", "in_progress", "passed", "rejected", "on_hold"]).optional(),
  notes: z.string().trim().max(2000).optional(),
  rejectionReason: z.string().trim().max(600).optional(),
  offeringSalary: z.number().int().min(0).optional(),
});

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const body = await parseBody(req, moveSchema);

  const candidate = await Candidate.findById(body.id);
  if (!candidate) throw NotFound("Pelamar tidak ditemukan.");
  if (candidate.employeeId) {
    throw Conflict("Pelamar ini sudah menjadi karyawan. Perubahan dilakukan di data karyawannya.");
  }
  if (!body.stage && !body.status && !body.notes && body.offeringSalary === undefined) {
    throw BadRequest("Tidak ada perubahan yang dikirim.");
  }

  // A stage must exist on the vacancy, otherwise the candidate lands in a
  // column the board cannot render.
  if (body.stage && candidate.vacancyId) {
    const vacancy = await JobVacancy.findById(candidate.vacancyId).lean<{ stages?: string[] } | null>();
    if (vacancy?.stages?.length && !vacancy.stages.includes(body.stage)) {
      throw BadRequest(`Tahap "${body.stage}" tidak terdaftar pada lowongan ini.`);
    }
  }

  if (body.status === "rejected" && !body.rejectionReason?.trim()) {
    throw BadRequest("Alasan penolakan wajib diisi agar keputusan dapat ditelusuri kembali di kemudian hari.");
  }

  const before = { stage: candidate.currentStage, status: candidate.status };
  const reopened = before.status === "rejected" && body.status && body.status !== "rejected";

  if (body.stage) candidate.currentStage = body.stage;
  if (body.status) candidate.status = body.status;
  // Moving to a later stage implies the candidate is actively in process.
  if (body.stage && !body.status && candidate.status === "pending") candidate.status = "in_progress";
  if (body.rejectionReason !== undefined) candidate.rejectionReason = body.rejectionReason;
  if (reopened) candidate.rejectionReason = "";
  // A decided application has no interview coming, whatever was scheduled.
  if (candidate.status === "rejected") candidate.nextInterviewAt = null;
  if (body.offeringSalary !== undefined) candidate.offeringSalary = body.offeringSalary;
  candidate.lastActivityAt = new Date();
  await candidate.save();

  await CandidateStageHistory.create({
    candidateId: candidate._id,
    stage: candidate.currentStage,
    status: candidate.status,
    type: candidate.status === "rejected" ? "rejected" : "stage",
    notes:
      body.notes ??
      (candidate.status === "rejected" ? body.rejectionReason : reopened ? "Pelamar dibuka kembali untuk diproses." : ""),
    authorUserId: ctx.user.id,
    authorName: ctx.user.email,
  });

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_CANDIDATE_STAGE",
    module: "recruitment",
    before,
    after: { stage: candidate.currentStage, status: candidate.status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { id: candidate._id, stage: candidate.currentStage, status: candidate.status },
    candidate.status === "rejected"
      ? `${candidate.name} ditandai tidak lolos. Datanya tetap tersimpan sebagai riwayat.`
      : reopened
        ? `${candidate.name} dibuka kembali di tahap "${candidate.currentStage}".`
        : `${candidate.name} dipindahkan ke tahap "${candidate.currentStage}".`
  );
});

/* ------------------------------------------------------------------ */
/* PUT — hire: turn an accepted candidate into an employee              */
/* ------------------------------------------------------------------ */

const hireSchema = z.object({
  id: objectId,
  branchId: objectId,
  divisionId: objectId,
  positionId: objectId,
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal mulai kerja tidak valid"),
  officeEmail: z.string().trim().toLowerCase().email("Email kantor tidak valid"),
  employmentStatus: z.enum(["probation", "pkwt", "pkwtt", "magang", "harian_lepas", "paruh_waktu", "outsource", "lainnya"]).default("probation"),
  roleId: z.union([objectId, z.literal("")]).optional(),
});

const DOCUMENT_CATEGORY: Record<string, string> = {
  cv: "CV",
  portfolio: "Portofolio",
  documents: "Dokumen lamaran",
};

/**
 * Carries a candidate's files onto the employee.
 *
 * Files are copied into the employee's own folder rather than referenced where
 * they are: the storage rules let an employee open files under their own id,
 * and a candidate folder is not theirs. Links are carried as links.
 */
async function carryDocuments(answers: StoredAnswer[], employeeId: string) {
  const docs: Array<{ category: string; fileUrl: string; fileName: string }> = [];
  for (const answer of answers) {
    const category = (answer.system && DOCUMENT_CATEGORY[answer.system]) || (answer.type === "file" ? answer.label : null);
    if (!category) continue;
    for (const att of (answer.attachments ?? []) as StoredAttachment[]) {
      if (att.kind === "link") {
        docs.push({ category, fileUrl: att.url, fileName: att.url });
        continue;
      }
      try {
        const { buffer } = await storageProvider.read(att.key);
        const ext = att.key.slice(att.key.lastIndexOf("."));
        const key = await storageProvider.upload(
          buffer,
          `employees/${employeeId}/lamaran-${Date.now()}-${docs.length}${ext}`,
          att.mime
        );
        docs.push({ category, fileUrl: key, fileName: att.name });
      } catch {
        // A missing source file must not block the hire; the candidate record
        // still shows what was submitted.
      }
    }
  }
  return docs;
}

export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const body = await parseBody(req, hireSchema);
  const settings = await getSettings();

  const candidate = await Candidate.findById(body.id);
  if (!candidate) throw NotFound("Pelamar tidak ditemukan.");
  if (candidate.employeeId) throw Conflict("Pelamar ini sudah dijadikan karyawan.");
  if (candidate.status === "rejected") {
    throw Conflict("Pelamar ini ditandai tidak lolos. Buka kembali pelamarnya lebih dulu sebelum merekrut.");
  }

  const emailTaken = await User.exists({ email: body.officeEmail });
  if (emailTaken) throw Conflict(`Email kantor ${body.officeEmail} sudah dipakai akun lain.`);
  const officeTaken = await Employee.exists({ officeEmail: body.officeEmail });
  if (officeTaken) throw Conflict(`Email kantor ${body.officeEmail} sudah dipakai karyawan lain.`);

  // Atomic sequence, same as the employees module — deriving the NIP from a
  // document count produced duplicates whenever two hires were saved together.
  const year = Number(body.joinDate.slice(0, 4));
  const counter = await Counter.findOneAndUpdate(
    { key: `employee:${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const nip = `EMP-${year}-${String(counter.seq).padStart(4, "0")}`;

  // The personal address is unique among employees; a returning ex-employee
  // must be reactivated rather than duplicated.
  if (candidate.email && (await Employee.exists({ personalEmail: candidate.email.toLowerCase() }))) {
    throw Conflict(
      `Email pribadi ${candidate.email} sudah tercatat pada data karyawan lain. Periksa apakah pelamar ini mantan karyawan.`
    );
  }

  const answers = (candidate.answers ?? []) as StoredAnswer[];
  const answerOf = (key: string) => answers.find((a) => a.system === key)?.value;
  const address = answerOf("address") as Partial<AddressValue> | undefined;
  const birthDate = answerOf("birthDate");
  const gender = answerOf("gender");

  const employeeObjectId = new RecordId();
  const documents = await carryDocuments(answers, String(employeeObjectId));

  // Only what the candidate actually told us is carried over. Everything else
  // stays empty and the record is flagged as a new hire until HR completes it,
  // instead of being padded with placeholder values that look like real data.
  const employee = await Employee.create({
    _id: employeeObjectId,
    employeeId: nip,
    name: candidate.name,
    personalEmail: candidate.email,
    officeEmail: body.officeEmail,
    phone: candidate.phone,
    ...(typeof birthDate === "string" && birthDate ? { birthDate: new Date(`${birthDate}T00:00:00${isoOffset()}`) } : {}),
    ...(gender === "male" || gender === "female" ? { gender } : {}),
    ktpAddress: {
      street: address?.street ?? "",
      subdistrict: "",
      city: address?.city ?? "",
      province: address?.province ?? "",
      country: "Indonesia",
    },
    branchId: body.branchId,
    divisionId: body.divisionId,
    positionId: body.positionId,
    joinDate: new Date(`${body.joinDate}T00:00:00${isoOffset()}`),
    employmentStatus: body.employmentStatus,
    status: "onboarding",
    documents,
    isNewHire: true,
    hiredFromCandidateId: candidate._id,
  });

  let generatedPassword: string | null = null;
  if (body.roleId) {
    const pwd = (await initialPasswordFor(body.roleId)).password;
    generatedPassword = pwd;
    await User.create({
      email: body.officeEmail,
      passwordHash: await bcrypt.hash(pwd, 12),
      roleId: body.roleId,
      employeeId: employee._id,
      phone: candidate.phone,
      mustChangePassword: Boolean(settings.force_password_change_on_first_login),
    });
  }

  const vacancy = candidate.vacancyId
    ? await JobVacancy.findById(candidate.vacancyId).select("title stages openings status")
    : null;
  const lastStage = vacancy?.stages?.[vacancy.stages.length - 1] ?? candidate.currentStage;

  candidate.status = "passed";
  candidate.currentStage = lastStage;
  candidate.employeeId = employee._id;
  candidate.hiredAt = new Date();
  candidate.nextInterviewAt = null;
  candidate.lastActivityAt = new Date();
  await candidate.save();

  await CandidateStageHistory.create({
    candidateId: candidate._id,
    stage: lastStage,
    status: "passed",
    type: "hired",
    notes: `Diterima sebagai karyawan dengan NIP ${nip}. Data karyawan ditandai "baru" sampai dilengkapi HRD.`,
    authorUserId: ctx.user.id,
    authorName: ctx.user.email,
  });

  // Once the openings are filled the vacancy stops taking applications.
  let vacancyClosed = false;
  if (vacancy && vacancy.status === "open") {
    const hired = await Candidate.countDocuments({ vacancyId: vacancy._id, employeeId: { $ne: null } });
    if (hired >= (vacancy.openings ?? 1)) {
      vacancy.status = "closed";
      await vacancy.save();
      vacancyClosed = true;
    }
  }

  void resolveRecipientsByRole("HRD")
    .then((recipients) =>
      notifyUsers(recipients, {
        kind: "recruitment",
        title: `Lengkapi data karyawan baru: ${candidate.name}`,
        body: `${candidate.name} diterima dengan NIP ${nip}. NIK, NPWP, rekening, dan kontrak masih kosong.${
          vacancyClosed ? ` Lowongan ${vacancy?.title} otomatis ditutup karena kuota terpenuhi.` : ""
        }`,
        href: `/admin/employees?baru=1`,
      })
    )
    .catch(() => {});

  void logActivity({
    userId: ctx.user.id,
    action: "HIRE_CANDIDATE",
    module: "recruitment",
    after: { candidate: candidate.name, employeeId: nip, documents: documents.length, vacancyClosed },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { employeeId: nip, employee: employee._id, generatedPassword, vacancyClosed },
    `${candidate.name} dibuat sebagai karyawan dengan NIP ${nip} dan ditandai "baru" di Data Karyawan.` +
      (documents.length ? ` ${documents.length} dokumen lamaran ikut dipindahkan.` : "") +
      (generatedPassword ? " Akun login dibuat; kata sandi awalnya ditampilkan di layar." : " Akun login belum dibuat karena peran belum dipilih.") +
      (vacancyClosed ? " Lowongan ditutup otomatis karena kuota terpenuhi." : "")
  );
});
