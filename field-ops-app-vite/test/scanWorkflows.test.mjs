// SHARED SCAN WORKSPACE — workflow availability. Pure; no emulator, no React.
// Run: node --test test/scanWorkflows.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveScanWorkflows, SCAN_WORKFLOW, UNAVAILABLE_REASON, RECEIVE_CAPABILITY,
  SCAN_WORKFLOW_LABEL, SCAN_WORKFLOW_DESCRIPTION, UNAVAILABLE_TEXT,
} from "../src/access/scanWorkflows.js";

const gate = (...held) => (id) => held.includes(id);
const has = (r, w) => r.available.some((a) => a.workflow === w);
const reasonFor = (r, w) => r.unavailable.find((u) => u.workflow === w)?.reason;

// ─────────────────────────────────────────── authority, not role name

test("supplier receiving needs the RECEIVING CAPABILITY, not a role name", () => {
  const denied = deriveScanWorkflows({ hasCapability: gate(), receivingReady: true });
  assert.equal(has(denied, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
  assert.equal(reasonFor(denied, SCAN_WORKFLOW.SUPPLIER_RECEIVING), UNAVAILABLE_REASON.NO_CAPABILITY);

  const allowed = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true });
  assert.equal(has(allowed, SCAN_WORKFLOW.SUPPLIER_RECEIVING), true);
});

test("a GOVERNED BUSINESS ROLE is served by capability alone — no legacy role is consulted", () => {
  // The decisive case. A Parts Associate has no legacy role that ROLE_NAV_ACCESS understands, so if
  // availability depended on one they could never receive. Holding the capability is sufficient.
  const partsAssociate = deriveScanWorkflows({
    hasCapability: gate(RECEIVE_CAPABILITY),
    receivingReady: true,
    role: null,          // no legacy role at all
    technicianId: null,
  });
  assert.equal(has(partsAssociate, SCAN_WORKFLOW.SUPPLIER_RECEIVING), true);
});

// CODE, not prose. The module's comments deliberately NAME ROLE_NAV_ACCESS and the governed personas
// in order to explain why it does not consult them — that explanation is the most useful thing in the
// file. So these assertions strip comments first and check what the module actually executes.
function codeOf(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

test("the module never reads ROLE_NAV_ACCESS or a business-role list", () => {
  // Structural, so a later change cannot quietly reintroduce role-name authority for warehouse work.
  const code = codeOf("../src/access/scanWorkflows.js");
  assert.doesNotMatch(code, /ROLE_NAV_ACCESS/);
  assert.doesNotMatch(code, /GOVERNED_BUSINESS_ROLES/);
  assert.doesNotMatch(code, /partsAssociate|warehouseManager|partsManager/);
});

test("no scanner-specific capability was invented", () => {
  const code = codeOf("../src/access/scanWorkflows.js");
  assert.doesNotMatch(code, /scanner\.access|scan\.access|scanner\.use/);
  assert.equal(RECEIVE_CAPABILITY, "inventory.stock.receive", "receiving is gated on the capability that already governs it");
});

test("the nav item adds NO business role to the legacy map", () => {
  // The other half of the same property, checked where it could actually be violated.
  const nav = codeOf("../src/navigation/navConfig.js");
  assert.match(nav, /key: "scan"[\s\S]{0,200}capabilityAccess: RECEIVING_SURFACE_CAPABILITIES/,
    "Scan must reach governed personas through capabilityAccess");
  const constants = codeOf("../src/domain/constants.js");
  const map = constants.slice(constants.indexOf("ROLE_NAV_ACCESS"));
  assert.doesNotMatch(map.slice(0, 600), /partsAssociate|warehouseManager|partsManager|inventoryTransferOperator/,
    "ROLE_NAV_ACCESS must still contain only the three legacy roles");
});

// ─────────────────────────────────────────── readiness is not permission

test("AUTHORIZED but NOT READY is reported as readiness, never as a denial", () => {
  // Telling someone they lack permission when the truth is that nothing is switched on sends them to
  // request access they may already hold.
  const r = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: false });
  assert.equal(has(r, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
  assert.equal(reasonFor(r, SCAN_WORKFLOW.SUPPLIER_RECEIVING), UNAVAILABLE_REASON.NOT_READY);
  assert.match(UNAVAILABLE_TEXT[UNAVAILABLE_REASON.NOT_READY], /not switched on/i);
});

test("readiness defaults to FALSE — a caller that forgets it gets the closed answer", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY) });
  assert.equal(has(r, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
});

// ─────────────────────────────────────────── fail closed

test("a MISSING gate denies, and a THROWING gate denies", () => {
  for (const bad of [undefined, null, "nope", () => { throw new Error("feed down"); }]) {
    const r = deriveScanWorkflows({ hasCapability: bad, receivingReady: true });
    assert.equal(has(r, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false, `gate ${String(bad)} must deny`);
  }
});

test("a gate returning a TRUTHY non-true value denies", () => {
  const r = deriveScanWorkflows({ hasCapability: () => "yes", receivingReady: true });
  assert.equal(has(r, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
});

// ─────────────────────────────────────────── technician journey

test("technician scanning mirrors the server rule: role, identity, and assigned work", () => {
  const ok = deriveScanWorkflows({ hasCapability: gate(), role: "technician", technicianId: "T1", assignedWorkOrderCount: 2 });
  assert.equal(has(ok, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), true);

  const noRole = deriveScanWorkflows({ hasCapability: gate(), role: "admin", technicianId: "T1", assignedWorkOrderCount: 2 });
  assert.equal(reasonFor(noRole, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY);

  const noIdentity = deriveScanWorkflows({ hasCapability: gate(), role: "technician", technicianId: null, assignedWorkOrderCount: 2 });
  assert.equal(reasonFor(noIdentity, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY);
});

test("NO ASSIGNED WORK is a state, not a permission — and gets its own message", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(), role: "technician", technicianId: "T1", assignedWorkOrderCount: 0 });
  assert.equal(reasonFor(r, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), UNAVAILABLE_REASON.NO_ASSIGNED_WORK);
  assert.match(UNAVAILABLE_TEXT[UNAVAILABLE_REASON.NO_ASSIGNED_WORK], /no assigned work/i);
  assert.notEqual(
    UNAVAILABLE_TEXT[UNAVAILABLE_REASON.NO_ASSIGNED_WORK],
    UNAVAILABLE_TEXT[UNAVAILABLE_REASON.NO_TECHNICIAN_IDENTITY],
    "being unassigned and not being a technician need different fixes",
  );
});

test("a receiving capability does NOT grant technician scanning, and vice versa", () => {
  const warehouse = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true, role: null });
  assert.equal(has(warehouse, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), false);

  const tech = deriveScanWorkflows({ hasCapability: gate(), role: "technician", technicianId: "T1", assignedWorkOrderCount: 1 });
  assert.equal(has(tech, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
});

// ─────────────────────────────────────────── absent, not disabled

test("ONLY the two workflows that exist can ever appear", () => {
  // Put-away, pick, stage, transfer, return, cycle count and truck handoff have no command. Listing
  // one — even disabled — would say it exists and that access is the only obstacle.
  const everything = deriveScanWorkflows({
    hasCapability: () => true, receivingReady: true, role: "technician", technicianId: "T1", assignedWorkOrderCount: 5,
  });
  assert.deepEqual(
    [...everything.available.map((a) => a.workflow)].sort(),
    [SCAN_WORKFLOW.SUPPLIER_RECEIVING, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER].sort(),
  );
  assert.deepEqual(everything.unavailable, []);
  assert.equal(Object.keys(SCAN_WORKFLOW).length, 2);
});

test("no put-away, transfer, pick, count or lookup workflow is even nameable", () => {
  for (const absent of ["PUT_AWAY", "PICK", "STAGE", "TRANSFER", "RETURN", "CYCLE_COUNT", "TRUCK_HANDOFF", "LOOKUP"]) {
    assert.equal(SCAN_WORKFLOW[absent], undefined, `${absent} must not exist as a workflow`);
  }
});

// ─────────────────────────────────────────── the empty state

test("a caller with nothing available is EMPTY, and every reason is stated", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(), receivingReady: false, role: null });
  assert.equal(r.empty, true);
  assert.equal(r.available.length, 0);
  assert.equal(r.unavailable.length, 2, "both workflows explain themselves rather than vanishing");
  for (const u of r.unavailable) assert.ok(UNAVAILABLE_TEXT[u.reason], `${u.reason} has no text`);
});

test("empty is false as soon as anything is available", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true });
  assert.equal(r.empty, false);
});

test("every workflow has a plain-language label and description — never an enum", () => {
  for (const w of Object.values(SCAN_WORKFLOW)) {
    assert.ok(SCAN_WORKFLOW_LABEL[w] && SCAN_WORKFLOW_LABEL[w] !== w);
    assert.ok(SCAN_WORKFLOW_DESCRIPTION[w]);
  }
});

test("the result is frozen — a caller cannot add an availability it was not given", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(), receivingReady: false });
  assert.throws(() => { r.available.push({ workflow: "ANYTHING" }); }, TypeError);
});
