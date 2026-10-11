import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import Inventory from "@/models/Inventory";
import InventoryAssignment from "@/models/InventoryAssignment";
import Employee from "@/models/Employee";
import { connectToDatabase } from "@/lib/db";

// Force load models to prevent Mongoose populate errors
import "@/models/Employee";

/**
 * The handler only reads `_id` off an asset and `inventoryId` off an assignment;
 * everything else is passed straight through to the client, so the rest of each
 * document stays untyped rather than being mirrored here and drifting.
 */
interface LeanAsset extends Record<string, unknown> {
  _id: { toString(): string };
}

interface LeanAssignment extends Record<string, unknown> {
  inventoryId?: { toString(): string } | null;
}

export const GET = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  // Check RBAC permission for inventory read
  const perm = await checkPermission(session.user.id, "inventory", "read");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk melihat inventaris", null, 403);
  }

  await connectToDatabase();

  // Paged, searchable on the server; `code` is an exact lookup for the barcode scanner.
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const assetFilter: Record<string, unknown> = {};
  const code = sp.get("code")?.trim();
  const q = sp.get("q")?.trim();
  const category = sp.get("category")?.trim();
  if (code) {
    assetFilter.code = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  } else {
    if (q) {
      const rx = new RegExp(q.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      assetFilter.$or = [{ name: rx }, { code: rx }];
    }
    if (category) assetFilter.category = category;
  }
  const [assets, total] = await Promise.all([
    Inventory.find(assetFilter).sort({ code: 1 }).skip((page - 1) * limit).limit(limit).lean<LeanAsset[]>(),
    Inventory.countDocuments(assetFilter),
  ]);

  // For each asset, find the most recent assignment (pending or active or returned)
  const assetIds = assets.map(a => a._id);
  const assignments = await InventoryAssignment.find({ inventoryId: { $in: assetIds } })
    .populate({
      path: "employeeId",
      select: "name NIK divisionId positionId officeEmail",
      populate: [
        { path: "divisionId", select: "name" },
        { path: "positionId", select: "name" }
      ]
    })
    .sort({ handoverDate: -1 })
    .lean<LeanAssignment[]>();

  // Group assignments by inventoryId (most recent first)
  const assignmentMap = new Map<string, LeanAssignment>();
  for (const asg of assignments) {
    if (asg.inventoryId) {
      const invIdStr = asg.inventoryId.toString();
      if (!assignmentMap.has(invIdStr)) {
        assignmentMap.set(invIdStr, asg);
      }
    }
  }

  const mappedAssets = assets.map(asset => {
    const recentAsg = assignmentMap.get(asset._id.toString()) || null;
    return {
      ...asset,
      assignment: recentAsg
    };
  });

  return apiSuccess(mappedAssets, "Berhasil memuat data inventaris", { page, limit, total });
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  // Check RBAC permission for inventory write
  const perm = await checkPermission(session.user.id, "inventory", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk mengelola inventaris", null, 403);
  }

  const body = await req.json();
  const { id, code, name, category, condition, employeeId, action } = body;
  if (category !== undefined && (typeof category !== "string" || !category.trim() || category.length > 40)) {
    return apiError("BAD_REQUEST", "Kategori aset tidak valid");
  }

  await connectToDatabase();

  let asset;
  let oldData = null;

  if (id) {
    // 1. Update existing asset details
    oldData = await Inventory.findById(id);
    if (!oldData) {
      return apiError("NOT_FOUND", "Aset tidak ditemukan");
    }

    asset = await Inventory.findByIdAndUpdate(
      id,
      { code, name, category, condition },
      { new: true }
    );

    // Audit log
    await logActivity({
      userId: session.user.id,
      action: "UPDATE_INVENTORY",
      module: "inventory",
      before: oldData.toObject ? oldData.toObject() : oldData,
      after: asset.toObject ? asset.toObject() : asset,
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || ""
    });
  } else {
    // 2. Create new asset
    if (!code || !name || !category) {
      return apiError("BAD_REQUEST", "Data kode aset, nama, dan kategori wajib diisi");
    }

    // Check unique code
    const existing = await Inventory.findOne({ code });
    if (existing) {
      return apiError("BAD_REQUEST", `Aset dengan kode ${code} sudah terdaftar`);
    }

    asset = await Inventory.create({
      code,
      name,
      category,
      condition: condition || "good"
    });

    await logActivity({
      userId: session.user.id,
      action: "CREATE_INVENTORY",
      module: "inventory",
      before: null,
      after: asset.toObject ? asset.toObject() : asset,
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || ""
    });
  }

  // 3. Handle penugasan (Assignment) / Pengembalian (Return)
  if (action === "return") {
    // Return asset: mark active assignments as returned
    const activeAsg = await InventoryAssignment.findOne({
      inventoryId: asset._id,
      status: { $in: ["pending_handover", "active"] }
    });

    if (activeAsg) {
      const oldAsg = { ...activeAsg.toObject() };
      activeAsg.status = "returned";
      await activeAsg.save();

      await logActivity({
        userId: session.user.id,
        action: "RETURN_INVENTORY",
        module: "inventory",
        before: oldAsg,
        after: activeAsg.toObject(),
        ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
        userAgent: req.headers.get("user-agent") || ""
      });
    }
  } else if (employeeId) {
    // Assign asset to employee
    // Check if the employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return apiError("NOT_FOUND", "Karyawan tidak ditemukan");
    }

    // Check if there is already an active assignment for this asset
    const activeAsg = await InventoryAssignment.findOne({
      inventoryId: asset._id,
      status: { $in: ["pending_handover", "active"] }
    });

    if (activeAsg) {
      if (activeAsg.employeeId.toString() !== employeeId) {
        // Mark previous as returned
        const oldAsg = { ...activeAsg.toObject() };
        activeAsg.status = "returned";
        await activeAsg.save();

        // Create new assignment
        const newAsg = await InventoryAssignment.create({
          inventoryId: asset._id,
          employeeId,
          status: "pending_handover",
          handoverDate: new Date()
        });

        await logActivity({
          userId: session.user.id,
          action: "REASSIGN_INVENTORY",
          module: "inventory",
          before: oldAsg,
          after: newAsg.toObject(),
          ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
          userAgent: req.headers.get("user-agent") || ""
        });
      }
    } else {
      // Create new assignment
      const newAsg = await InventoryAssignment.create({
        inventoryId: asset._id,
        employeeId,
        status: "pending_handover",
        handoverDate: new Date()
      });

      await logActivity({
        userId: session.user.id,
        action: "ASSIGN_INVENTORY",
        module: "inventory",
        before: null,
        after: newAsg.toObject(),
        ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
        userAgent: req.headers.get("user-agent") || ""
      });
    }
  }

  return apiSuccess(asset, "Berhasil memproses data inventaris");
});
