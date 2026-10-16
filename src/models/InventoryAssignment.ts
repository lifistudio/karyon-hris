import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { CheckItem } from "@/lib/inventory/templates";
import type { InventoryCondition } from "./Inventory";

/**
 * One handover of an asset to an employee (BAST), from the moment GA hands it
 * over until it comes back.
 *
 *   pending_handover → active (employee signed) → returned
 *          ↘ disputed (employee reported a mismatch) → cancelled by GA
 *          ↘ cancelled (GA withdrew before signing)
 */
export type AssignmentStatus = "pending_handover" | "active" | "returned" | "disputed" | "cancelled";

export interface IInventoryAssignment extends Document {
  employeeId: RecordId;
  inventoryId: RecordId;
  handoverDate: Date;
  assignedBy?: RecordId | null;
  /** Condition and checklist as handed over — what the employee signs for. */
  handoverCondition?: InventoryCondition;
  handoverChecklist?: CheckItem[];
  handoverReading?: number | null;
  handoverNotes?: string;
  signatureUrl?: string; // canvas draw signature or a scan of the signed paper BAST
  signedAt?: Date | null;
  employeeNote?: string;
  disputeNote?: string;
  returnDate?: Date | null;
  returnCondition?: InventoryCondition;
  returnChecklist?: CheckItem[];
  returnReading?: number | null;
  returnNotes?: string;
  receivedBy?: RecordId | null;
  cancelReason?: string;
  status: AssignmentStatus;
}

const InventoryAssignmentSchema = new Schema<IInventoryAssignment>({
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
  inventoryId: { type: Schema.Types.Id, ref: "Inventory", required: true, index: true },
  handoverDate: { type: Date, required: true, default: Date.now },
  assignedBy: { type: Schema.Types.Id, ref: "User", default: null },
  handoverCondition: { type: String, enum: ["good", "damaged", "lost"] },
  handoverChecklist: { type: Schema.Types.Mixed, default: () => [] },
  handoverReading: { type: Number, default: null },
  handoverNotes: { type: String, default: "" },
  signatureUrl: { type: String },
  signedAt: { type: Date, default: null },
  employeeNote: { type: String, default: "" },
  disputeNote: { type: String, default: "" },
  returnDate: { type: Date, default: null },
  returnCondition: { type: String, enum: ["good", "damaged", "lost"] },
  returnChecklist: { type: Schema.Types.Mixed, default: () => [] },
  returnReading: { type: Number, default: null },
  returnNotes: { type: String, default: "" },
  receivedBy: { type: Schema.Types.Id, ref: "User", default: null },
  cancelReason: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending_handover", "active", "returned", "disputed", "cancelled"],
    default: "pending_handover",
    required: true,
    index: true
  },
}, { timestamps: true });

export default database.models.InventoryAssignment || database.model<IInventoryAssignment>("InventoryAssignment", InventoryAssignmentSchema);
