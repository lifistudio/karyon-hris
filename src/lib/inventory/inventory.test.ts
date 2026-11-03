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
import InventoryEvent from "../../models/InventoryEvent";
import { assignAsset, cancelHandover, disputeHandover, recordCheck, recordMaintenance, reportAssetIssue, returnAsset, signHandover, getCategorySettings, saveCategorySettings } from "./server";
import { compareCheck, describeChanges, diffSpecs } from "./templates";

process.env.ENCRYPTION_KEY ??= "test-key-0123456789abcdef0123456789abcdef";

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

test("inventory: replacements move the record, repairs leave a trace, a signed BAST stays as signed", async () => {
  const pg = new PGlite(); database.connection.testDriver = pg;
  try {
    await setupSchema(database, "hris");
    const role = await Role.create({ name: "GA" });
    const user = await User.create({ email: "ga2@test.local", roleId: role._id });
    const first = await Employee.create({ name: "Budi", officeEmail: "budi@test.local", employeeId: "EMP-010", status: "active" });
    const second = await Employee.create({ name: "Sari", officeEmail: "sari@test.local", employeeId: "EMP-011", status: "active" });
    const ga: GuardContext = { user: { id: String(user._id), email: "ga2@test.local", role: "GA", employeeId: null, branchId: null, divisionId: null }, permission: { allowed: true, scope: "all" } as never, ip: "127.0.0.1", userAgent: "test" };
    const self = { ...ga, ip: "10.0.0.9", user: { ...ga.user, employeeId: String(first._id) }, employeeId: String(first._id) };
    const asset = await Inventory.create({ code: "AST-LAP-002", name: "Laptop", category: "laptop", condition: "good", specs: [{ label: "RAM", value: "8 GB" }], initialCheck: { condition: "good", checklist: [], specs: [{ label: "RAM", value: "8 GB" }], recordedAt: new Date() } });
    const id = String(asset._id);

    const handover = await assignAsset(ga, { inventoryId: id, employeeId: String(first._id) });
    const signed = await signHandover(self, { assignmentId: String(handover._id), signatureData: SIGNATURE });
    assert.equal(signed.signedVia, "portal");
    assert.equal(signed.signedIp, "10.0.0.9");
    assert.match(signed.signatureHash, /^[a-f0-9]{64}$/);
    assert.ok(!signed.signatureUrl.startsWith("data:"));
    await assert.rejects(signHandover(self, { assignmentId: String(handover._id), signatureData: "data:image/png;base64,PHN2Zz4=" }), /Serah terima tidak ditemukan|tidak sesuai|Tanda tangan harus/);

    // A known replacement is a change, not a finding, and updates the record.
    const report = await recordCheck(ga, {
      inventoryId: id, type: "monthly", condition: "good",
      checklist: [{ label: "Layar", result: "repaired", note: "ganti panel" }],
      specChecks: [{ label: "RAM", expected: "8 GB", matches: false, replaced: true, actual: "16 GB" }],
    });
    assert.equal(report.status, "changed");
    assert.equal(report.changes.length, 2);
    assert.deepEqual((await Inventory.findById(id)).specs, [{ label: "RAM", value: "16 GB" }]);
    assert.equal((await InventoryAssignment.findById(handover._id)).handoverSpecs[0].value, "8 GB");
    assert.equal(await InventoryEvent.countDocuments({ inventoryId: id, checkId: report._id }), 2);

    // An unexplained difference still flags the check.
    const odd = await recordCheck(ga, { inventoryId: id, type: "incidental", condition: "good", specChecks: [{ label: "RAM", expected: "16 GB", matches: false }] });
    assert.equal(odd.status, "flagged");

    // The holder's report stays open until GA records the work.
    await reportAssetIssue(self, { assignmentId: String(handover._id), note: "Layar berkedip" });
    await assert.rejects(reportAssetIssue({ ...self, employeeId: String(second._id) }, { assignmentId: String(handover._id), note: "Bukan aset saya" }), /tidak tercatat/);
    await recordMaintenance(ga, { inventoryId: id, type: "replacement", component: "RAM", toValue: "32 GB", description: "Upgrade RAM", condition: "good" });
    assert.deepEqual((await Inventory.findById(id)).specs, [{ label: "RAM", value: "32 GB" }]);
    assert.equal(await InventoryEvent.countDocuments({ inventoryId: id, type: "employee_report", resolvedAt: null }), 0);

    // Direct transfer closes the current handover; the same holder cannot receive it again.
    await assert.rejects(assignAsset(ga, { inventoryId: id, employeeId: String(first._id), transfer: true }), /sudah dipegang/);
    const moved = await assignAsset(ga, { inventoryId: id, employeeId: String(second._id), transfer: true });
    assert.equal((await InventoryAssignment.findById(handover._id)).status, "returned");
    assert.equal(moved.status, "pending_handover");

    // The previous holder can receive it again after it comes back.
    await cancelHandover(ga, { inventoryId: id });
    const again = await assignAsset(ga, { inventoryId: id, employeeId: String(first._id) });
    assert.equal(String(again.employeeId), String(first._id));
  } finally {
    database.connection.testDriver = undefined;
    await pg.close();
  }
});

test("inventory: change descriptions and spec diffs", () => {
  assert.deepEqual(describeChanges({ checklist: [{ label: "Baterai", result: "replaced", note: "baru" }, { label: "Layar", result: "ok" }] }), ["Baterai diganti: baru"]);
  assert.deepEqual(diffSpecs([{ label: "RAM", value: "8" }], [{ label: "RAM", value: "16" }, { label: "SSD", value: "1 TB" }]), [{ label: "RAM", from: "8", to: "16" }, { label: "SSD", from: "", to: "1 TB" }]);
});

test("inventory: compareCheck reports changes against the baseline", () => {
  const labels = { good: "Baik", damaged: "Rusak", lost: "Hilang" };
  assert.deepEqual(compareCheck({ condition: "good", checklist: [{ label: "Ban", result: "ok" }] }, { condition: "good", checklist: [] }, labels), []);
  const f = compareCheck({ condition: "good", checklist: [{ label: "Ban", result: "issue" }] }, { condition: "damaged", checklist: [{ label: "Ban", result: "issue" }] }, labels);
  assert.deepEqual(f, ["Kondisi berubah dari Rusak menjadi Baik", "Ban masih bermasalah"]);
});
