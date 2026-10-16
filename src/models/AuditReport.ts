import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { CheckItem, SpecCheck } from "@/lib/inventory/templates";

/**
 * One physical check of an asset.
 *
 * `initial` is the baseline written when the asset is registered; `monthly`
 * is the routine check (at most one per asset per period); `incidental` is any
 * extra check (a complaint, an audit visit). Each report keeps what the asset
 * looked like before so a timeline reads without joining older rows.
 */
export type CheckType = "initial" | "monthly" | "incidental";

export interface IAuditReport extends Document {
  auditorId: RecordId;
  inventoryId: RecordId;
  auditDate: Date;
  type: CheckType;
  /** `YYYY-MM` the check counts toward (monthly checks only, but set on all). */
  period: string;
  previousCondition?: "good" | "damaged" | "lost" | null;
  condition: "good" | "damaged" | "lost";
  checklist: CheckItem[];
  specChecks: SpecCheck[];
  reading?: number | null;
  holderEmployeeId?: RecordId | null;
  notes: string;
  /** `flagged` when anything got worse than the baseline or a spec no longer matches. */
  status: "verified" | "flagged";
  findings: string[];
}

const AuditReportSchema: Schema = new Schema(
  {
    auditorId: { type: Schema.Types.Id, ref: "User", required: true },
    inventoryId: { type: Schema.Types.Id, ref: "Inventory", required: true, index: true },
    auditDate: { type: Date, default: Date.now },
    type: { type: String, enum: ["initial", "monthly", "incidental"], default: "incidental" },
    period: { type: String, default: "", index: true },
    previousCondition: { type: String, enum: ["good", "damaged", "lost"], default: null },
    condition: { type: String, enum: ["good", "damaged", "lost"], required: true },
    checklist: { type: Schema.Types.Mixed, default: () => [] },
    specChecks: { type: Schema.Types.Mixed, default: () => [] },
    reading: { type: Number, default: null },
    holderEmployeeId: { type: Schema.Types.Id, ref: "Employee", default: null },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["verified", "flagged"], default: "verified" },
    findings: { type: [String], default: () => [] },
  },
  { timestamps: true }
);

export default database.models.AuditReport || database.model<IAuditReport>("AuditReport", AuditReportSchema);
