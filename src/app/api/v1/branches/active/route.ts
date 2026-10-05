import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, BadRequest, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { getBranchAccess, setActiveBranch } from "@/lib/licensing/branch-access";
import Branch from "@/models/Branch";

const bodySchema = z.object({
  branchId: z.string().regex(/^[0-9a-fA-F]{24}$/, "ID cabang tidak valid"),
});

/** Chooses the one branch that stays usable while the multi-branch license is not active. */
export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const { branchId } = await parseBody(req, bodySchema);
  const branch = await Branch.findById(branchId).select("name").lean<{ name: string } | null>();
  if (!branch) throw NotFound("Cabang tidak ditemukan.");

  const before = await getBranchAccess();
  if (!before.limited) throw BadRequest("Semua cabang sedang aktif. Pilihan cabang hanya diperlukan saat lisensi multi-cabang tidak aktif.");

  await setActiveBranch(branchId);
  void logActivity({
    userId: ctx.user.id,
    action: "SET_ACTIVE_BRANCH",
    module: "settings",
    before: { activeBranchId: before.activeBranchId },
    after: { activeBranchId: branchId },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ activeBranchId: branchId }, `Cabang ${branch.name} sekarang menjadi satu-satunya cabang aktif.`);
});
