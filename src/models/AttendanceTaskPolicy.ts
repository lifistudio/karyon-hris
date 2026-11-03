import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { PolicyTask } from "@/lib/hr/attendance-tasks";

/**
 * Who has daily tasks on top of clocking in and out, and what those tasks are.
 *
 * An employee is covered when they match any of the role, division, position or
 * employee lists; `branchIds`, when set, narrows that to those branches. A
 * policy with every list empty covers nobody, so a half-finished form can never
 * lock the whole company out of clocking out.
 */
export interface IAttendanceTaskPolicy extends Document {
  name: string;
  isActive: boolean;
  roleIds: RecordId[];
  divisionIds: RecordId[];
  positionIds: RecordId[];
  employeeIds: RecordId[];
  branchIds: RecordId[];
  /** Fixed tasks repeated on their weekdays. Supervisors can add more per day. */
  tasks: PolicyTask[];
  /** Open required tasks stop the employee from clocking out. */
  blockClockOut: boolean;
  /** A day with open required tasks is not counted as a present day. */
  countsAttendance: boolean;
  /** Proof must be approved by a supervisor before a task counts as done. */
  requireReview: boolean;
  createdBy?: RecordId | null;
}

const AttendanceTaskPolicySchema = new Schema<IAttendanceTaskPolicy>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    roleIds: { type: Schema.Types.Mixed, default: () => [] },
    divisionIds: { type: Schema.Types.Mixed, default: () => [] },
    positionIds: { type: Schema.Types.Mixed, default: () => [] },
    employeeIds: { type: Schema.Types.Mixed, default: () => [] },
    branchIds: { type: Schema.Types.Mixed, default: () => [] },
    tasks: { type: Schema.Types.Mixed, default: () => [] },
    blockClockOut: { type: Boolean, default: true },
    countsAttendance: { type: Boolean, default: true },
    requireReview: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.Id, ref: "User", default: null },
  },
  { timestamps: true }
);

export default database.models.AttendanceTaskPolicy ||
  database.model<IAttendanceTaskPolicy>("AttendanceTaskPolicy", AttendanceTaskPolicySchema);
