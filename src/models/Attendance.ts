import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IAttendance extends Document {
  employeeId: RecordId;
  /** 00:00 WIB of the attendance day, stored as the UTC instant. */
  date: Date;
  clockIn?: Date;
  breakOut?: Date;
  breakIn?: Date;
  clockOut?: Date;
  /** Storage keys, not URLs — signed URLs are minted per request. */
  photoUrl: string[];
  gpsLat: number;
  gpsLng: number;
  /** Device-reported accuracy in meters; helps HRD judge an override claim. */
  gpsAccuracy?: number;
  /** The branch the tap actually matched (may differ from the posting). */
  branchId?: RecordId;
  distanceMeter?: number;
  /** Schedule in force that day, snapshotted so later roster edits don't rewrite history. */
  scheduleClockIn?: string;
  scheduleClockOut?: string;
  isLate: boolean;
  lateMinutes: number;
  isEarlyLeave: boolean;
  earlyLeaveMinutes: number;
  /** Face match failed and a plain selfie was accepted instead. */
  isManualFallback: boolean;
  /** At least one tap today passed face verification. */
  faceVerified: boolean;
  /** Distance of the most recent verified tap; lower is a closer match. */
  faceDistance: number | null;
  /** Clocked in at a branch other than the assigned posting. */
  isCrossBranch: boolean;
  /** Used the "Kendala Lokasi" escape hatch — outside radius, reason required. */
  isLocationOverride: boolean;
  /** Outside radius but covered by an approved WFH / dinas luar request. */
  isRemoteApproved: boolean;
  /** Fell on a national holiday — feeds overtime calculation. */
  isHoliday: boolean;
  /** Any of the flags above; the single field HRD filters their review queue on. */
  needsReview: boolean;
  /** Set once HRD has looked at a flagged entry. */
  reviewedBy?: RecordId;
  reviewedAt?: Date;
  reviewNote?: string;
  note: string;
  /** Required tasks for the day and how many are still open; kept in step by the task service. */
  tasksTotal: number;
  tasksPending: number;
  /** The employee's task policy says an unfinished day does not count as present. */
  tasksCountAttendance: boolean;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    date: { type: Date, required: true, index: true },
    clockIn: { type: Date },
    breakOut: { type: Date },
    breakIn: { type: Date },
    clockOut: { type: Date },
    photoUrl: [{ type: String }],
    gpsLat: { type: Number, required: true },
    gpsLng: { type: Number, required: true },
    gpsAccuracy: { type: Number },
    branchId: { type: Schema.Types.Id, ref: "Branch", index: true },
    distanceMeter: { type: Number },
    scheduleClockIn: { type: String },
    scheduleClockOut: { type: String },
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    isEarlyLeave: { type: Boolean, default: false },
    earlyLeaveMinutes: { type: Number, default: 0 },
    isManualFallback: { type: Boolean, default: false },
    faceVerified: { type: Boolean, default: false },
    faceDistance: { type: Number, default: null },
    isCrossBranch: { type: Boolean, default: false },
    isLocationOverride: { type: Boolean, default: false },
    isRemoteApproved: { type: Boolean, default: false },
    isHoliday: { type: Boolean, default: false },
    needsReview: { type: Boolean, default: false, index: true },
    reviewedBy: { type: Schema.Types.Id, ref: "User" },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
    note: { type: String, default: "" },
    tasksTotal: { type: Number, default: 0 },
    tasksPending: { type: Number, default: 0 },
    tasksCountAttendance: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One row per employee per day — the whole flow reads and updates this record,
// so the database, not application code, guarantees there is only ever one.
AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
// Supports the admin monthly/branch reports without a collection scan.
AttendanceSchema.index({ date: -1, branchId: 1 });

export default database.models.Attendance ||
  database.model<IAttendance>("Attendance", AttendanceSchema);
