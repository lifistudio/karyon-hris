import database, { Schema, Document, RecordId } from "@/lib/postgres";
import type { CheckItem, SpecValue } from "@/lib/inventory/templates";

export type InventoryCondition = "good" | "damaged" | "lost";

export interface IInventory extends Document {
  code: string; // Asset code, e.g. AST-LAP-001
  name: string; // e.g. "MacBook Pro M1"
  category: string; // a key from Setting "inventory_categories" (defaults: laptop, phone, vehicle, other)
  /** Current condition: the result of the most recent check, handover or return. */
  condition: InventoryCondition;
  /** Specification fields from the category template, kept in the order they were filled. */
  specs: SpecValue[];
  location?: string;
  acquiredAt?: Date;
  notes?: string;
  /**
   * The baseline recorded when the asset was registered. Every later check is
   * compared against it, so it is written once and never edited afterwards.
   */
  initialCheck?: {
    condition: InventoryCondition;
    checklist: CheckItem[];
    reading?: number | null;
    notes?: string;
    recordedAt: Date;
    recordedBy?: RecordId | string | null;
  } | null;
}

const InventorySchema = new Schema<IInventory>({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, default: "other", required: true, trim: true },
  condition: {
    type: String,
    enum: ["good", "damaged", "lost"],
    default: "good",
    required: true
  },
  specs: { type: Schema.Types.Mixed, default: () => [] },
  location: { type: String, default: "" },
  acquiredAt: { type: Date },
  notes: { type: String, default: "" },
  initialCheck: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });

export default database.models.Inventory || database.model<IInventory>("Inventory", InventorySchema);
