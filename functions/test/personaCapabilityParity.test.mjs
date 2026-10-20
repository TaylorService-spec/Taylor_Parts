// Firebase exit F1-0 -- the persona capability parity harness classifies honestly. Run after `npm run build`.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATES, classify, eosKeysFromMigrations, gateInputs, loadCaptures, makeRolePreview, measure, shellIds, toMarkdown,
} from "../scripts/firebaseExit/personaCapabilityParity.mjs";

test("classify: same-named keys are EQUAL / WIDEN / NARROW; no same-named EOS key is UNMAPPED, never guessed", () => {
  assert.equal(classify(true, true, true), "EQUAL");
  assert.equal(classify(false, true, false), "EQUAL");
  assert.equal(classify(false, true, true), "WIDEN");
  assert.equal(classify(true, true, false), "NARROW");
  assert.equal(classify(true, false, false), "UNMAPPED_ALLOW");
  assert.equal(classify(false, false, false), "UNMAPPED_DENY");
});

test("the 66 ids come from the shell itself (58 + the five P-1 supplier purchase order keys + inventory.catalog.part.activate, GRANT-1 A1 + reorder.purchaseOrder.read, the recorded-orders view gate + finance.accountBalance.read, A6), and the EOS key census sees real migration keys", async () => {
  const ids = await shellIds();
  assert.equal(ids.length, 66);
  const keys = eosKeysFromMigrations();
  assert.ok(keys.has("workOrder.create") && keys.has("reorder.request.read.queue"));
  for (const g of GATES) for (const k of g.candidate ?? []) assert.ok(keys.has(k), `${g.id} candidate ${k} is a real EOS key`);
});

test("the role preview is the client's: an unknown role takes the fallback; a compatibility role is resolved", () => {
  const preview = makeRolePreview([]);
  assert.equal(preview("workOrder.create", undefined, false), false);
  assert.equal(preview("workOrder.create", "not-a-role", true), true);
  assert.equal(typeof preview("workOrder.create", "admin", false), "boolean");
});

test("a capture reads usersDoc as users, and a failed side is refused rather than read as 'denies everything'", () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-parity-"));
  try {
    writeFileSync(join(dir, "a.json"), JSON.stringify({ persona: "a", usersDoc: { role: "admin" }, old: { status: 200, decisions: {} }, new: { status: 200, capabilities: [] } }));
    assert.equal(loadCaptures(dir)[0].users.role, "admin");
    writeFileSync(join(dir, "c.json"), JSON.stringify({ persona: "c", usersDoc: {}, old: { status: 200, decisions: {} }, new: { status: 200, capabilities: [] } }));
    assert.equal(loadCaptures(dir)[1].users, null, "an empty usersDoc is no users doc");
    rmSync(join(dir, "c.json"));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ persona: "b", old: { status: 403, error: "denied", decisions: {} }, new: { status: 200, capabilities: [] } }));
    assert.throws(() => loadCaptures(dir), /did not succeed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("measure + report over two captures: every difference is named", async () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-parity-"));
  try {
    const ids = ["customer.record.read", "finance.read", "admin.securityPolicy.read"];
    writeFileSync(join(dir, "dispatcher.json"), JSON.stringify({
      persona: "dispatcher", users: { role: "dispatcher" },
      old: { decisions: { "customer.record.read": true, "finance.read": true, "admin.securityPolicy.read": false } },
      new: { heldRoleKeys: ["dispatcher"], capabilities: ["admin.securityPolicy.read", "workOrder.lifecycle.schedule"] },
    }));
    writeFileSync(join(dir, "generalEmployee.json"), JSON.stringify({
      persona: "generalEmployee", users: null, old: { decisions: { "customer.record.read": false, "finance.read": false, "admin.securityPolicy.read": false } },
      new: { capabilities: [] },
    }));
    writeFileSync(join(dir, "_summary.json"), "[]"); // ignored
    const report = measure({ ids, eosKeys: new Set(["customer.record.read", "admin.securityPolicy.read"]), captures: loadCaptures(dir),
      preview: () => false });
    const d = report.personas.find((p) => p.persona === "dispatcher");
    assert.equal(d.cells["customer.record.read"].class, "NARROW");
    assert.equal(d.cells["finance.read"].class, "UNMAPPED_ALLOW");
    assert.equal(d.cells["admin.securityPolicy.read"].class, "WIDEN");
    assert.deepEqual(d.gates.G1, { old: true, new: true, class: "EQUAL" });
    assert.equal(d.gates.G5.class, "NO_CANDIDATE");
    assert.equal(d.gates.G7.class, "UNVERIFIED", "a users doc without a captured technicianId is not read as DENY");
    const g = report.personas.find((p) => p.persona === "generalEmployee");
    assert.equal(g.legacyRole, null);
    assert.ok(Object.values(g.gates).every((r) => r.old === false));
    const md = toMarkdown(report);
    assert.match(md, /\*\*dispatcher\*\* `customer\.record\.read`: NARROW/);
    assert.match(md, /\*\*dispatcher\*\* `admin\.securityPolicy\.read`: WIDEN/);
    assert.match(md, /\*\*dispatcher\*\* `finance\.read`: UNMAPPED_ALLOW/);
    assert.match(md, /\*\*dispatcher\*\* gate G7: UNVERIFIED \(old UNVERIFIED \(input not captured\)/);
    // A missing answer for one id is refused, not counted as DENY.
    const partial = loadCaptures(dir).map((c) => (c.persona === "dispatcher" ? { ...c, old: { decisions: {} } } : c));
    assert.throws(() => measure({ ids, eosKeys: new Set(), captures: partial, preview: () => false }), /no answer for customer\.record\.read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gate inputs are the Firebase session's: operationalRoles from the employee doc, technicianId from the users doc", () => {
  assert.deepEqual(gateInputs({ users: null }), { role: null, operationalRoles: [], technicianId: null });
  const withEmployee = { users: { role: "dispatcher", employeeId: "e1" }, employeeDoc: { status: 200, operationalRoles: ["PARTS_MANAGER"] }, usersDocTechnicianId: null };
  assert.deepEqual(gateInputs(withEmployee), { role: "dispatcher", operationalRoles: ["PARTS_MANAGER"], technicianId: null });
  assert.equal(GATES.find((g) => g.id === "G6").old(gateInputs(withEmployee)), true);
  assert.equal(gateInputs({ users: { role: "dispatcher", employeeId: "e1" } }).operationalRoles, undefined, "uncaptured employee doc = unverified");
  assert.equal(gateInputs({ ...withEmployee, employeeDoc: { status: 404, error: "x" } }).operationalRoles, undefined, "a failed employee read = unverified");
});
