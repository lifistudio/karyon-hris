import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { ProofMode, ProofType, TaskStatus } from "@/lib/hr/attendance-tasks";
import type { StoredAttachment } from "@/lib/attachments";

/**
 * One task for one employee on one day. Title and proof rules are copied from
 * the policy (or the supervisor's form), so editing a policy never rewrites
 * what somebody was asked to do on an earlier day.
 *
 *   pending → submitted → approved (when the policy needs a review)
 *                       ↘ rejected → submitted again
 *   any open state → waived (a supervisor excused it, with a reason)
 */
export interface IDailyTask extends Document {
  employeeId: RecordId;
  /** `YYYY-MM-DD` of the work day in the company timezone. */
  dateKey: string;
  /** Stable per day: the policy task id, or a random id for an assigned task. */
  taskKey: string;
  source: "fixed" | "assigned";
  policyId?: RecordId | null;
  title: string;
  description: string;
  proofTypes: ProofType[];
  proofMode: ProofMode;
  required: boolean;
  blockClockOut: boolean;
  countsAttendance: boolean;
  requireReview: boolean;
  status: TaskStatus;
  assignedBy?: RecordId | null;
  proofText: string;
  proofItems: StoredAttachment[];
  submittedAt?: Date | null;
  reviewedBy?: RecordId | null;
  reviewedAt?: Date | null;
  reviewNote: string;
}

const DailyTaskSchema = new Schema<IDailyTask>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    taskKey: { type: String, required: true },
    source: { type: String, enum: ["fixed", "assigned"], default: "fixed" },
    policyId: { type: Schema.Types.Id, ref: "AttendanceTaskPolicy", default: null },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    proofTypes: { type: Schema.Types.Mixed, default: () => [] },
    proofMode: { type: String, enum: ["any", "all"], default: "any" },
    required: { type: Boolean, default: true },
    blockClockOut: { type: Boolean, default: true },
    countsAttendance: { type: Boolean, default: true },
    requireReview: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "submitted", "approved", "rejected", "waived"], default: "pending", index: true },
    assignedBy: { type: Schema.Types.Id, ref: "User", default: null },
    proofText: { type: String, default: "" },
    proofItems: { type: Schema.Types.Mixed, default: () => [] },
    submittedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.Id, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// Fixed tasks are created on first read; this makes that safe to repeat.
DailyTaskSchema.index({ employeeId: 1, dateKey: 1, taskKey: 1 }, { unique: true });

export default database.models.DailyTask || database.model<IDailyTask>("DailyTask", DailyTaskSchema);
