import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import database from "../postgres";
import "../postgres-models";
import { setupSchema } from "../../../packages/database/schema-setup";
import type { GuardContext } from "../guard";
import Employee from "../../models/Employee";
import User from "../../models/User";
import Role from "../../models/Role";
import Inventory from "../../models/Inventory";
import InventoryAssignment from "../../models/InventoryAssignment";
import AuditReport from "../../models/AuditReport";
import { assignAsset, cancelHandover, disputeHandover, recordCheck, returnAsset, signHandover, getCategorySettings, saveCategorySettings } from "./server";
import { compareCheck } from "./templates";

const SIGNATURE = "data:image/png;base64,iVBORw0KGgo=";

test("inventory: baseline, handover, signature, monthly check and return", async () => {
  const pg = new PGlite(); database.connection.testDriver = pg;
  try {
    await setupSchema(database, "hris");
    const role = await Role.create({ name: "GA" });
    const user = await User.create({ email: "ga@test.local", roleId: role._id });
    const employee = await Employee.create({ name: "Rina Ayu", officeEmail: "rina@test.local", employeeId: "EMP-001", status: "active" });
    const ga: GuardContext = { user: { id: String(user._id), email: "ga@test.local", role: "GA", employeeId: null, branchId: null, divisionId: null }, permission: { allowed: true, scope: "all" } as never, ip: "127.0.0.1", userAgent: "test" };
    const self = { ...ga, user: { ...ga.user, employeeId: String(employee._id) }, employeeId: String(employee._id) };

    // Category templates fall back to built-in defaults and can be edited.
    const cats = await getCategorySettings();
    assert.ok(cats.templates.laptop.checklist.includes("Layar"));
    await saveCategorySettings(ga, { categories: ["laptop", "Furnitur"], templates: { Furnitur: { specs: ["Bahan"], checklist: ["Rangka", ""], reading: "" } } });
    assert.deepEqual((await getCategorySettings()).templates.Furnitur.checklist, ["Rangka"]);

    const asset = await Inventory.create({
      code: "AST-LAP-001", name: "Laptop", category: "laptop", condition: "good",
      specs: [{ label: "Nomor seri", value: "SN-1" }],
      initialCheck: { condition: "good", checklist: [{ label: "Layar", result: "ok" }], notes: "", recordedAt: new Date() },
    });
    const id = String(asset._id);

    // Handover → employee signs → asset is held.
    const asg = await assignAsset(ga, { inventoryId: id, employeeId: String(employee._id), checklist: [{ label: "Layar", result: "ok" }] });
    assert.equal(asg.status, "pending_handover");
    await assert.rejects(assignAsset(ga, { inventoryId: id, employeeId: String(employee._id) }), /proses serah terima/);
    await assert.rejects(returnAsset(ga, { inventoryId: id }), /belum ditandatangani/);
    const signed = await signHandover(self, { assignmentId: String(asg._id), signatureData: SIGNATURE });
    assert.equal(signed.status, "active");
    await assert.rejects(assignAsset(ga, { inventoryId: id, employeeId: String(employee._id) }), /masih dipegang/);

    // Monthly check: an issue against the baseline flags the report; a second monthly check is refused.
    const report = await recordCheck(ga, { inventoryId: id, type: "monthly", condition: "damaged", checklist: [{ label: "Layar", result: "issue", note: "retak" }], specChecks: [{ label: "Nomor seri", expected: "SN-1", matches: true }] });
    assert.equal(report.status, "flagged");
    assert.equal(report.previousCondition, "good");
    assert.ok(report.findings.some((f: string) => f.includes("Layar bermasalah: retak")));
    assert.equal(String(report.holderEmployeeId), String(employee._id));
    await assert.rejects(recordCheck(ga, { inventoryId: id, type: "monthly", condition: "damaged" }), /sudah dicek/);
    assert.equal((await Inventory.findById(id)).condition, "damaged");

    // Return records the condition at return and frees the asset.
    const returned = await returnAsset(ga, { inventoryId: id, condition: "damaged", notes: "layar retak" });
    assert.equal(returned.status, "returned");
    assert.equal(returned.returnCondition, "damaged");

    // A second handover can be disputed by the employee and cancelled by GA.
    const second = await assignAsset(ga, { inventoryId: id, employeeId: String(employee._id) });
    await disputeHandover(self, { assignmentId: String(second._id), note: "Charger tidak ada" });
    await cancelHandover(ga, { inventoryId: id, reason: "dicek ulang" });
    assert.equal((await InventoryAssignment.findById(second._id)).status, "cancelled");

    // An edit through the API layer must not wipe the code (regression: assign sent no code).
    await Inventory.findByIdAndUpdate(id, { $set: { name: "Laptop Kantor" } }, { new: true });
    assert.equal((await Inventory.findById(id)).code, "AST-LAP-001");
    assert.equal(await AuditReport.countDocuments({ inventoryId: id }), 1);
  } finally { database.connection.testDriver = undefined; await pg.close(); }
});

test("inventory: compareCheck reports changes against the baseline", () => {
  const labels = { good: "Baik", damaged: "Rusak", lost: "Hilang" };
  assert.deepEqual(compareCheck({ condition: "good", checklist: [{ label: "Ban", result: "ok" }] }, { condition: "good", checklist: [] }, labels), []);
  const f = compareCheck({ condition: "good", checklist: [{ label: "Ban", result: "issue" }] }, { condition: "damaged", checklist: [{ label: "Ban", result: "issue" }] }, labels);
  assert.deepEqual(f, ["Kondisi berubah dari Rusak menjadi Baik", "Ban masih bermasalah"]);
});
