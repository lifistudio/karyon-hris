import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { claimAttachments, presentAttachment } from "@/lib/uploads";
import type { AttachmentInput, StoredAttachment } from "@/lib/attachments";
import {
  defaultFormFields,
  normaliseFields,
  type AddressValue,
  type FormField,
  type StoredAnswer,
} from "@/lib/hr/application-form";
import { isoOffset } from "@/lib/time";

/** The form a vacancy uses: its own, or the default for older vacancies. */
export function resolveFormFields(vacancy: { formFields?: unknown }): FormField[] {
  const stored = Array.isArray(vacancy.formFields) ? (vacancy.formFields as FormField[]) : [];
  return normaliseFields(stored.length ? stored : defaultFormFields());
}

/** Only what a candidate needs to render the form — no internal flags. */
export function publicFormFields(fields: FormField[]) {
  return fields
    .filter((f) => f.enabled)
    .map(({ key, label, type, required, section, placeholder, helpText, options, maxFiles, allowLink }) => ({
      key,
      label,
      type,
      required,
      section,
      placeholder,
      helpText,
      options,
      maxFiles,
      allowLink,
    }));
}

export interface CandidateColumns {
  name: string;
  email: string;
  phone: string;
  addressText: string;
  city: string;
  lastEducation: string;
  availableFrom: Date | null;
  expectedSalary: number | null;
  hasCv: boolean;
  cvUrl: string;
  portfolioUrl: string;
  coverLetter: string;
}

/**
 * Turns validated answers into what is stored on the candidate.
 *
 * Uploaded files are claimed and moved under the candidate's own folder here,
 * so a file is attached to exactly one application and lands where the storage
 * rules expect candidate files to be.
 */
export async function ingestAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  {
    vacancyId,
    candidateId,
    ownerUserId,
    scope,
  }: { vacancyId: string; candidateId: string; ownerUserId?: string | null; scope?: string }
): Promise<{ stored: StoredAnswer[]; columns: CandidateColumns }> {
  const stored: StoredAnswer[] = [];

  for (const f of fields) {
    if (!f.enabled || !(f.key in answers)) continue;
    const value = answers[f.key];

    let attachments: StoredAttachment[] = [];
    let plain: unknown = value;
    if (f.type === "file") {
      const inputs = (value as AttachmentInput[] | undefined) ?? [];
      attachments = inputs.length
        ? await claimAttachments(inputs, {
            context: "application",
            ownerUserId: ownerUserId ?? null,
            scope,
            destination: `candidates/${vacancyId}/${candidateId}`,
          })
        : [];
      plain = null;
    }

    stored.push({
      key: f.key,
      label: f.label,
      type: f.type,
      section: f.section,
      system: f.system,
      value: plain,
      attachments,
    });
  }

  const bySystem = (key: string) => stored.find((a) => a.system === key);
  const text = (key: string) => {
    const v = bySystem(key)?.value;
    return typeof v === "string" ? v : "";
  };
  const address = bySystem("address")?.value as Partial<AddressValue> | undefined;
  const cv = bySystem("cv")?.attachments ?? [];
  const portfolio = bySystem("portfolio")?.attachments ?? [];
  const availableFrom = text("availableFrom");
  const salary = bySystem("expectedSalary")?.value;

  return {
    stored,
    columns: {
      name: text("name"),
      email: text("email"),
      phone: text("phone"),
      addressText: address ? [address.street, address.city, address.province, address.postalCode].filter(Boolean).join(", ") : "",
      city: address?.city ?? "",
      lastEducation: text("lastEducation"),
      availableFrom: availableFrom ? new Date(`${availableFrom}T00:00:00${isoOffset()}`) : null,
      expectedSalary: typeof salary === "number" ? salary : null,
      hasCv: cv.length > 0,
      // The first CV is kept in the legacy column too, which older screens read.
      cvUrl: cv[0] ? (cv[0].kind === "file" ? cv[0].key : cv[0].url) : "",
      portfolioUrl: portfolio[0]?.kind === "link" ? portfolio[0].url : "",
      coverLetter: text("coverLetter"),
    },
  };
}

/** Answers with every file turned into a short-lived signed link. */
export async function presentAnswers(answers: StoredAnswer[]) {
  return Promise.all(
    answers.map(async (a) => ({
      ...a,
      attachments: await Promise.all((a.attachments ?? []).map((att) => presentAttachment(att))),
    }))
  );
}

/** Short, unambiguous code for a candidate to quote when they get in touch. */
export function referenceFor(id: RecordId | string): string {
  return String(id).slice(-8).toUpperCase();
}
