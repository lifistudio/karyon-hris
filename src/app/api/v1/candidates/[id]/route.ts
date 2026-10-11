import { z } from "zod";
import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, parseBody, BadRequest, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { presentAnswers, resolveFormFields } from "@/lib/hr/applications";
import type { StoredAnswer } from "@/lib/hr/application-form";
import { notifyUsers, resolveRecipientsByUserIds } from "@/lib/notification/notify";
import Candidate from "@/models/Candidate";
import CandidateStageHistory from "@/models/CandidateStageHistory";
import JobVacancy from "@/models/JobVacancy";
import Employee from "@/models/Employee";
import User from "@/models/User";
import { timezoneName } from "@/lib/time";

type Ctx = RouteContext<{ id: string }>;

async function loadId(params: Ctx["params"]) {
  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID pelamar tidak valid.");
  return id;
}

/**
 * Everything about one applicant: their answers (files as short-lived signed
 * links), the vacancy's stages, the timeline, and any other applications made
 * with the same email or phone — HR wants to know someone applied before.
 */
export const GET = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "recruitment", "read");
  const id = await loadId(params);

  const candidate = await Candidate.findById(id).lean<Record<string, unknown> | null>();
  if (!candidate) throw NotFound("Pelamar tidak ditemukan.");

  const [vacancy, timeline, others, employee] = await Promise.all([
    candidate.vacancyId
      ? JobVacancy.findById(candidate.vacancyId).select("title slug status stages formFields openings positionId").lean<Record<string, unknown> | null>()
      : null,
    CandidateStageHistory.find({ candidateId: id })
      .populate("interviewerId", "name employeeId")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    Candidate.find({
      _id: { $ne: candidate._id },
      $or: [
        { email: candidate.email },
        ...(candidate.phone ? [{ phone: candidate.phone }] : []),
      ],
    })
      .select("vacancyId currentStage status createdAt employeeId")
      .populate("vacancyId", "title")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    candidate.employeeId
      ? Employee.findById(candidate.employeeId).select("employeeId name status isNewHire").lean()
      : null,
  ]);

  // Applications made before forms were configurable have no answers; their
  // few flat columns are shown in the same shape instead.
  let answers = (candidate.answers as StoredAnswer[] | undefined) ?? [];
  if (!answers.length) {
    answers = [
      { key: "name", label: "Nama lengkap", type: "short_text", section: "Data diri", system: "name", value: candidate.name, attachments: [] },
      { key: "email", label: "Email", type: "email", section: "Data diri", system: "email", value: candidate.email, attachments: [] },
      { key: "phone", label: "Nomor telepon", type: "phone", section: "Data diri", system: "phone", value: candidate.phone, attachments: [] },
      ...(candidate.cvUrl
        ? [{
            key: "cv", label: "CV", type: "file" as const, section: "Dokumen", system: "cv" as const, value: null,
            attachments: [String(candidate.cvUrl).startsWith("http")
              ? { kind: "link" as const, url: String(candidate.cvUrl) }
              : { kind: "file" as const, key: String(candidate.cvUrl), name: "CV", mime: "application/pdf", size: 0 }],
          }]
        : []),
      ...(candidate.coverLetter
        ? [{ key: "coverLetter", label: "Surat lamaran", type: "long_text" as const, section: "Lainnya", system: "coverLetter" as const, value: candidate.coverLetter, attachments: [] }]
        : []),
    ] as StoredAnswer[];
  }

  void logActivity({
    userId: ctx.user.id,
    action: "VIEW_CANDIDATE",
    module: "recruitment",
    after: { candidate: candidate.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const { formFields: _unused, ...vacancyPublic } = vacancy ?? {};
  void _unused;

  return apiSuccess({
    candidate: { ...candidate, answers: await presentAnswers(answers) },
    vacancy: vacancy ? { ...vacancyPublic, fieldCount: resolveFormFields(vacancy).filter((f) => f.enabled).length } : null,
    timeline,
    otherApplications: others,
    employee,
  });
});

/* ------------------------------------------------------------------ */
/* POST — note, interview, rating, tags                                 */
/* ------------------------------------------------------------------ */

const activitySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("note"),
    notes: z.string().trim().min(2, "Catatan terlalu pendek").max(2000),
  }),
  z.object({
    type: z.literal("interview"),
    scheduledAt: z.string().datetime({ offset: true, message: "Waktu wawancara tidak valid" }),
    location: z.string().trim().max(200).default(""),
    interviewerUserId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().or(z.literal("")),
    interviewerName: z.string().trim().max(120).default(""),
    notes: z.string().trim().max(2000).default(""),
  }),
  z.object({
    type: z.literal("rating"),
    rating: z.number().int().min(0).max(5),
    notes: z.string().trim().max(1000).default(""),
  }),
  z.object({
    type: z.literal("tags"),
    tags: z.array(z.string().trim().min(1).max(30)).max(12),
  }),
]);

export const POST = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const id = await loadId(params);
  const body = await parseBody(req, activitySchema);

  const candidate = await Candidate.findById(id);
  if (!candidate) throw NotFound("Pelamar tidak ditemukan.");

  const base = {
    candidateId: candidate._id,
    stage: candidate.currentStage,
    status: candidate.status,
    authorUserId: ctx.user.id,
    authorName: ctx.user.email,
  };
  let message = "Tersimpan.";

  switch (body.type) {
    case "note": {
      await CandidateStageHistory.create({ ...base, type: "note", notes: body.notes });
      message = "Catatan ditambahkan.";
      break;
    }
    case "interview": {
      const when = new Date(body.scheduledAt);
      let interviewerName = body.interviewerName;
      let interviewerEmployeeId = null;
      if (body.interviewerUserId) {
        const interviewer = await User.findById(body.interviewerUserId).select("email employeeId").populate("employeeId", "name").lean<{
          _id: unknown;
          email: string;
          employeeId?: { _id: unknown; name?: string } | null;
        } | null>();
        if (!interviewer) throw BadRequest("Pewawancara tidak ditemukan.");
        interviewerName = interviewerName || interviewer.employeeId?.name || interviewer.email;
        interviewerEmployeeId = interviewer.employeeId?._id ?? null;
      }
      await CandidateStageHistory.create({
        ...base,
        type: "interview",
        scheduledAt: when,
        location: body.location,
        interviewerName,
        interviewerId: interviewerEmployeeId,
        notes: body.notes,
      });
      // The list shows the soonest upcoming interview.
      const upcoming = await CandidateStageHistory.findOne({
        candidateId: candidate._id,
        type: "interview",
        scheduledAt: { $gte: new Date() },
      })
        .sort({ scheduledAt: 1 })
        .select("scheduledAt")
        .lean<{ scheduledAt?: Date } | null>();
      candidate.nextInterviewAt = upcoming?.scheduledAt ?? null;
      if (candidate.status === "pending") candidate.status = "in_progress";

      // The interviewer is told directly, with a link to the applicant; nobody
      // should learn about an interview from a calendar they never saw.
      if (body.interviewerUserId && body.interviewerUserId !== ctx.user.id) {
        const whenText = when.toLocaleString("id-ID", {
          timeZone: timezoneName(),
          dateStyle: "full",
          timeStyle: "short",
        });
        void resolveRecipientsByUserIds([body.interviewerUserId]).then((recipients) => notifyUsers(recipients, {
          kind: "recruitment",
          title: `Jadwal wawancara: ${candidate.name}`,
          body: `${whenText} WIB${body.location ? ` · ${body.location}` : ""}. Tahap ${candidate.currentStage}.`,
          href: `/admin/recruitment/${String(candidate._id)}`,
        })).catch(() => {});
      }
      message = "Jadwal wawancara disimpan.";
      break;
    }
    case "rating": {
      candidate.rating = body.rating;
      await CandidateStageHistory.create({
        ...base,
        type: "rating",
        notes: body.notes || (body.rating ? `Penilaian diubah menjadi ${body.rating} dari 5.` : "Penilaian dihapus."),
      });
      message = body.rating ? `Penilaian ${body.rating}/5 disimpan.` : "Penilaian dihapus.";
      break;
    }
    case "tags": {
      candidate.tags = Array.from(new Set(body.tags.map((t) => t.toLowerCase())));
      message = "Label diperbarui.";
      break;
    }
  }

  candidate.lastActivityAt = new Date();
  await candidate.save();

  void logActivity({
    userId: ctx.user.id,
    action: `CANDIDATE_${body.type.toUpperCase()}`,
    module: "recruitment",
    after: { candidate: candidate.name, ...body },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { rating: candidate.rating, tags: candidate.tags, nextInterviewAt: candidate.nextInterviewAt, status: candidate.status },
    message
  );
});
