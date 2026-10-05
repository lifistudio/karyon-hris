import "server-only";
import { getEntitlements } from "./server";
import { connectToDatabase } from "@/lib/db";
import Branch from "@/models/Branch";
import Employee from "@/models/Employee";
import Setting from "@/models/Setting";

/**
 * Without the multi-branch feature (Community, or a Pro license that lapsed) only
 * one branch stays usable. Nothing is deleted or flagged in the database: the
 * limit is derived from the license on every check, so renewing the license
 * reactivates every branch immediately.
 */
export const ACTIVE_BRANCH_SETTING_KEY = "license_active_branch";

export interface BranchAccess {
  /** True when there are more branches than the license allows. */
  limited: boolean;
  /** The one branch that stays usable while limited (null when not limited). */
  activeBranchId: string | null;
}

export async function getBranchAccess(): Promise<BranchAccess> {
  const entitlements = await getEntitlements();
  if (entitlements.features.includes("organization.multi_branch")) return { limited: false, activeBranchId: null };
  await connectToDatabase();
  const branches = await Branch.find({}).select("_id").lean<Array<{ _id: unknown }>>();
  if (branches.length <= 1) return { limited: false, activeBranchId: null };

  const ids = branches.map((b) => String(b._id));
  const chosen = await Setting.findOne({ key: ACTIVE_BRANCH_SETTING_KEY }).lean<{ value?: unknown } | null>();
  const chosenId = typeof chosen?.value === "string" ? chosen.value : "";
  if (ids.includes(chosenId)) return { limited: true, activeBranchId: chosenId };

  // Nothing chosen yet: keep the branch with the most active employees running.
  const counts = await Employee.aggregate<{ _id: unknown; count: number }>([
    { $match: { status: { $in: ["active", "onboarding"] } } },
    { $group: { _id: "$branchId", count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.count]));
  const busiest = [...ids].sort((a, b) => (countOf.get(b) ?? 0) - (countOf.get(a) ?? 0) || a.localeCompare(b))[0];
  return { limited: true, activeBranchId: busiest };
}

export function isBranchUsable(access: BranchAccess, branchId: unknown): boolean {
  return !access.limited || !branchId || String(branchId) === access.activeBranchId;
}

export async function setActiveBranch(branchId: string) {
  await connectToDatabase();
  await Setting.findOneAndUpdate(
    { key: ACTIVE_BRANCH_SETTING_KEY },
    { value: branchId, description: "Cabang yang tetap aktif saat lisensi multi-cabang tidak aktif." },
    { upsert: true }
  );
}

export const INACTIVE_BRANCH_MESSAGE =
  "Cabang ini sedang nonaktif karena lisensi multi-cabang (HRIS Pro) tidak aktif. Hanya satu cabang yang dapat dipakai; administrator dapat memilihnya di menu Cabang.";
