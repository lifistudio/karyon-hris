/**
 * Daily tasks that sit on top of clocking in and out, for the people whose work
 * is not proven by being at a desk (sales visits, store opening checklists).
 *
 * Shared by the server and the browser, so nothing here touches the database.
 */

export type ProofType = "text" | "file" | "link";
/** `any` needs one of the allowed kinds of proof, `all` needs every one of them. */
export type ProofMode = "any" | "all";
export type TaskStatus = "pending" | "submitted" | "approved" | "rejected" | "waived";

export interface PolicyTask {
  /** Stable id: daily copies are keyed on it, so renaming a task never duplicates it. */
  id: string;
  title: string;
  description: string;
  proofTypes: ProofType[];
  proofMode: ProofMode;
  required: boolean;
  /** 0 = Sunday … 6 = Saturday. Empty means every working day. */
  weekdays: number[];
}

export const PROOF_LABELS: Record<ProofType, string> = {
  text: "Teks",
  file: "Foto atau berkas",
  link: "Tautan (Drive, Sheets, dll.)",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Belum dikerjakan",
  submitted: "Terkirim",
  approved: "Disetujui",
  rejected: "Perlu diperbaiki",
  waived: "Dibebaskan",
};

export const WEEKDAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const PROOFS: ProofType[] = ["text", "file", "link"];

export const MAX_POLICY_TASKS = 30;
export const MAX_PROOF_ITEMS = 5;

/** Validates task definitions from a form. Tasks with no title are dropped. */
export function sanitizePolicyTasks(input: unknown): PolicyTask[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.slice(0, MAX_POLICY_TASKS).flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 150) : "";
    if (!title) return [];
    const raw = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : `t${index}-${Math.random().toString(36).slice(2, 10)}`;
    const id = seen.has(raw) ? `${raw}-${index}` : raw;
    seen.add(id);
    return [{
      id,
      title,
      description: typeof r.description === "string" ? r.description.trim().slice(0, 1000) : "",
      proofTypes: sanitizeProofTypes(r.proofTypes),
      proofMode: r.proofMode === "all" ? "all" as const : "any" as const,
      required: r.required !== false,
      weekdays: Array.isArray(r.weekdays) ? [...new Set(r.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
    }];
  });
}

export function sanitizeProofTypes(input: unknown): ProofType[] {
  return Array.isArray(input) ? PROOFS.filter((p) => input.includes(p)) : [];
}

/** Whether a task's proof rules are met. Returns the sentence to show when they are not. */
export function proofProblem(task: { proofTypes: ProofType[]; proofMode: ProofMode }, proof: { text: string; files: number; links: number }): string | null {
  const types = task.proofTypes ?? [];
  const has: Record<ProofType, boolean> = { text: proof.text.trim().length > 0, file: proof.files > 0, link: proof.links > 0 };
  if (!types.length) return null;
  const missing = types.filter((t) => !has[t]);
  if (task.proofMode === "all") return missing.length ? `Lengkapi bukti: ${missing.map((t) => PROOF_LABELS[t].toLowerCase()).join(", ")}.` : null;
  return missing.length === types.length ? `Sertakan bukti berupa ${types.map((t) => PROOF_LABELS[t].toLowerCase()).join(" atau ")}.` : null;
}

/** A task no longer holding the employee back. */
export function taskDone(task: { status: TaskStatus; requireReview?: boolean }): boolean {
  if (task.status === "approved" || task.status === "waived") return true;
  return task.status === "submitted" && !task.requireReview;
}

/** What the required tasks of a day add up to. */
export function summarizeTasks(tasks: Array<{ status: TaskStatus; required: boolean; requireReview?: boolean; blockClockOut?: boolean; countsAttendance?: boolean; title: string }>) {
  const required = tasks.filter((t) => t.required);
  const open = required.filter((t) => !taskDone(t));
  return {
    total: required.length,
    pending: open.length,
    done: required.length - open.length,
    blocking: open.filter((t) => t.blockClockOut),
    countsAttendance: required.some((t) => t.countsAttendance),
  };
}

export const MATCH_FIELDS = ["roleIds", "divisionIds", "positionIds", "employeeIds"] as const;

export interface PolicyTarget {
  roleIds?: unknown[];
  divisionIds?: unknown[];
  positionIds?: unknown[];
  employeeIds?: unknown[];
  branchIds?: unknown[];
}

/** Whether a policy covers an employee. Empty lists never match anybody. */
export function policyCovers(policy: PolicyTarget, employee: { id: string; roleId?: string | null; divisionId?: string | null; positionId?: string | null; branchId?: string | null }): boolean {
  const has = (list: unknown[] | undefined, value?: string | null) => Boolean(value) && (list ?? []).some((v) => String(v) === value);
  if (policy.branchIds?.length && !has(policy.branchIds, employee.branchId)) return false;
  return has(policy.roleIds, employee.roleId) || has(policy.divisionIds, employee.divisionId) || has(policy.positionIds, employee.positionId) || has(policy.employeeIds, employee.id);
}
