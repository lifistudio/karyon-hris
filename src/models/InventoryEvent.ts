import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { InventoryEventType, StoredPhoto } from "@/lib/inventory/templates";
import type { InventoryCondition } from "./Inventory";

/**
 * Something that happened to an asset between checks: a repair, a replaced
 * part, a corrected specification, or damage reported by whoever holds it.
 * Rows are appended and never edited, so the asset's history stays reliable.
 */
export interface IInventoryEvent extends Document {
  inventoryId: RecordId;
  type: InventoryEventType;
  eventDate: Date;
  /** The part or specification concerned, e.g. "RAM". */
  component: string;
  fromValue: string;
  toValue: string;
  description: string;
  vendor: string;
  cost: number | null;
  photos: StoredPhoto[];
  conditionBefore?: InventoryCondition | null;
  conditionAfter?: InventoryCondition | null;
  /** The check that recorded this change, when it came from one. */
  checkId?: RecordId | null;
  actorUserId?: RecordId | null;
  employeeId?: RecordId | null;
  /** Employee reports stay open until GA follows up. */
  resolvedAt?: Date | null;
}

const InventoryEventSchema = new Schema<IInventoryEvent>(
  {
    inventoryId: { type: Schema.Types.Id, ref: "Inventory", required: true, index: true },
    type: { type: String, enum: ["repair", "replacement", "spec_update", "employee_report"], required: true, index: true },
    eventDate: { type: Date, required: true, default: Date.now },
    component: { type: String, default: "" },
    fromValue: { type: String, default: "" },
    toValue: { type: String, default: "" },
    description: { type: String, default: "" },
    vendor: { type: String, default: "" },
    cost: { type: Number, default: null },
    photos: { type: Schema.Types.Mixed, default: () => [] },
    conditionBefore: { type: String, enum: ["good", "damaged", "lost"], default: null },
    conditionAfter: { type: String, enum: ["good", "damaged", "lost"], default: null },
    checkId: { type: Schema.Types.Id, ref: "AuditReport", default: null },
    actorUserId: { type: Schema.Types.Id, ref: "User", default: null },
    employeeId: { type: Schema.Types.Id, ref: "Employee", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default database.models.InventoryEvent || database.model<IInventoryEvent>("InventoryEvent", InventoryEventSchema);
