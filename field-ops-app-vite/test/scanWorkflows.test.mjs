// SHARED SCAN WORKSPACE — workflow availability. Pure; no emulator, no React.
// Run: node --test test/scanWorkflows.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveScanWorkflows, SCAN_WORKFLOW, UNAVAILABLE_REASON, RECEIVE_CAPABILITY,
  TRANSFER_DISPATCH_CAPABILITY, TRANSFER_RECEIVE_CAPABILITY,
  CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY,
  PLACEMENT_RECORD_CAPABILITY, BIN_READ_CAPABILITY,
  SCAN_WORKFLOW_LABEL, SCAN_WORKFLOW_DESCRIPTION, UNAVAILABLE_TEXT, unavailableText,
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

test("ONLY the eight workflows that exist can ever appear", () => {
  // Listing a workflow that has no command — even disabled — would say it exists and that access is
  // the only obstacle. Each id here earned its place when a real governed authority was found behind
  // it: LOOKUP in Phase F, TRANSFER in J1, CYCLE_COUNT in J2, PUT_AWAY in L, PICK in M, and
  // RETURN_INTAKE when recordReturnIntake was deployed, activated and granted in the sandbox.
  //
  // RETURN_INTAKE records an ARRIVAL only. It carries no disposition authority, because disposition
  // does not exist (DECISIONS #118) — so adding it did not add a way to restore sellable stock.
  const everything = deriveScanWorkflows({
    hasCapability: () => true, receivingReady: true, role: "technician", technicianId: "T1", assignedWorkOrderCount: 5,
  });
  assert.deepEqual(
    [...everything.available.map((a) => a.workflow)].sort(),
    [SCAN_WORKFLOW.LOOKUP, SCAN_WORKFLOW.SUPPLIER_RECEIVING, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER, SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT, SCAN_WORKFLOW.PUT_AWAY, SCAN_WORKFLOW.PICK, SCAN_WORKFLOW.RETURN_INTAKE].sort(),
  );
  assert.deepEqual(everything.unavailable, []);
  assert.equal(Object.keys(SCAN_WORKFLOW).length, 8);
});

test("no stage, disposition or truck-handoff workflow is even nameable", () => {
  // RETURN_INTAKE left this list when recordReturnIntake became a deployed, granted authority. Note
  // what did NOT: DISPOSITION. Taking a return in and deciding what becomes of it are separate
  // authorities (#118), and only the first exists — so a workflow that could put stock back on the
  // shelf must remain unnameable.
  //
  // STAGE is absent because staging is not a separate workflow: it is how a pick ends.
  // TRUCK_HANDOFF is absent because a handoff IS a transfer with a mobile endpoint, not a second
  // state machine.
  for (const absent of ["STAGE", "DISPOSITION", "RETURN_DISPOSITION", "TRUCK_HANDOFF"]) {
    assert.equal(SCAN_WORKFLOW[absent], undefined, `${absent} must not exist as a workflow`);
  }
});

// ─────────────────────────────────────────── the empty state

test("the least-authorized caller still gets LOOKUP, and every other absence is explained", () => {
  // Phase F changed this. Lookup needs no capability and no readiness, so the workspace now always
  // has something to offer — but the workflows the caller CANNOT use still explain themselves
  // rather than silently vanishing.
  const r = deriveScanWorkflows({ hasCapability: gate(), receivingReady: false, role: null });
  assert.equal(r.empty, false);
  assert.deepEqual(r.available.map((a) => a.workflow), [SCAN_WORKFLOW.LOOKUP]);
  assert.equal(r.unavailable.length, 7, "receiving, transfer, counting, put-away, picking, returns and technician scanning each explain themselves");
  for (const u of r.unavailable) assert.ok(UNAVAILABLE_TEXT[u.reason], `${u.reason} has no text`);
});

test("NO caller can currently reach the empty workspace, because lookup is unconditional", () => {
  // The empty branch is KEPT as a guard rather than deleted: it becomes reachable again the moment
  // any future gating is put on lookup. This records that it is unreachable TODAY, deliberately, so
  // the guard is not mistaken for a state someone has actually seen.
  for (const ctx of [
    {},
    { hasCapability: null },
    { hasCapability: () => { throw new Error("feed down"); } },
    { hasCapability: gate(), receivingReady: false, role: null, technicianId: null, assignedWorkOrderCount: 0 },
  ]) {
    assert.equal(deriveScanWorkflows(ctx).empty, false, `${JSON.stringify(Object.keys(ctx))} must still offer lookup`);
  }
});

test("empty stays false when more becomes available", () => {
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

// ─────────────────────────────────────────── transfers (Phase J1)

test("EITHER transfer capability offers the workflow — one end of a transfer is useful work", () => {
  for (const held of [TRANSFER_DISPATCH_CAPABILITY, TRANSFER_RECEIVE_CAPABILITY]) {
    const r = deriveScanWorkflows({ hasCapability: gate(held) });
    assert.equal(has(r, SCAN_WORKFLOW.TRANSFER), true, `holding ${held} should offer transfers`);
  }
});

test("neither transfer capability means no transfer workflow, with a stated reason", () => {
  const r = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true });
  assert.equal(has(r, SCAN_WORKFLOW.TRANSFER), false);
  assert.equal(reasonFor(r, SCAN_WORKFLOW.TRANSFER), UNAVAILABLE_REASON.NO_CAPABILITY);
});

test("transfers need NO readiness constant — the capability is the only gate", () => {
  // The transfer transport has never had a readiness flag, and adding a second gate in front of a
  // capability that already denies would be belt-and-braces around an inert command.
  const r = deriveScanWorkflows({ hasCapability: gate(TRANSFER_DISPATCH_CAPABILITY), receivingReady: false });
  assert.equal(has(r, SCAN_WORKFLOW.TRANSFER), true);
});

test("the transfer capabilities are the REAL catalog ids, not invented ones", () => {
  assert.equal(TRANSFER_DISPATCH_CAPABILITY, "inventory.transfer.dispatch");
  assert.equal(TRANSFER_RECEIVE_CAPABILITY, "inventory.transfer.receive");
});

test("receiving stock and moving a transfer are separate authorities", () => {
  const receiver = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true });
  assert.equal(has(receiver, SCAN_WORKFLOW.TRANSFER), false);

  const mover = deriveScanWorkflows({ hasCapability: gate(TRANSFER_DISPATCH_CAPABILITY), receivingReady: true });
  assert.equal(has(mover, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
});

test("a shared REASON does not force a shared SENTENCE", () => {
  // Receiving and transfers both fail with NO_CAPABILITY, but they send the reader to ask for
  // different grants. Collapsing them into "you are not authorized" drops the only useful word.
  const receiving = unavailableText(SCAN_WORKFLOW.SUPPLIER_RECEIVING, UNAVAILABLE_REASON.NO_CAPABILITY);
  const transfer = unavailableText(SCAN_WORKFLOW.TRANSFER, UNAVAILABLE_REASON.NO_CAPABILITY);
  assert.match(receiving, /receive stock/i);
  assert.match(transfer, /transfers/i);
  assert.notEqual(receiving, transfer);
});

test("a workflow with no wording of its own falls back to the reason's general sentence", () => {
  const generic = unavailableText(SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER, UNAVAILABLE_REASON.NO_ASSIGNED_WORK);
  assert.equal(generic, UNAVAILABLE_TEXT[UNAVAILABLE_REASON.NO_ASSIGNED_WORK]);
});

test("every reason a workflow can actually produce resolves to a sentence", () => {
  const contexts = [
    { hasCapability: gate() },
    { hasCapability: gate(RECEIVE_CAPABILITY) },
    { hasCapability: gate(), role: "technician", technicianId: "T1", assignedWorkOrderCount: 0 },
  ];
  for (const ctx of contexts) {
    for (const u of deriveScanWorkflows(ctx).unavailable) {
      assert.ok(unavailableText(u.workflow, u.reason), `${u.workflow}/${u.reason} has no words`);
    }
  }
});

// ─────────────────────────────────────────── cycle counting (Phase J2)

test("counting needs BOTH create and submit — one without the other is a dead end", () => {
  // Create-only produces an open count nobody can close; submit-only has nothing to submit to.
  for (const held of [[CYCLE_COUNT_CREATE_CAPABILITY], [CYCLE_COUNT_SUBMIT_CAPABILITY]]) {
    const r = deriveScanWorkflows({ hasCapability: gate(...held) });
    assert.equal(has(r, SCAN_WORKFLOW.CYCLE_COUNT), false, `${held.join()} alone must not offer counting`);
  }
  const both = deriveScanWorkflows({ hasCapability: gate(CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY) });
  assert.equal(has(both, SCAN_WORKFLOW.CYCLE_COUNT), true);
});

test("RECONCILE is deliberately not consulted — approving is a manager's separate authority", () => {
  // DECISIONS #111: a counter cannot approve their own material variance. Offering counting on the
  // strength of the reconcile grant would put it behind the wrong authority entirely.
  const reconcilerOnly = deriveScanWorkflows({ hasCapability: gate("inventory.cycleCount.reconcile") });
  assert.equal(has(reconcilerOnly, SCAN_WORKFLOW.CYCLE_COUNT), false);

  const code = codeOf("../src/access/scanWorkflows.js");
  assert.doesNotMatch(code, /cycleCount\.reconcile/, "counting eligibility must not consult reconcile");
});

test("the cycle count capabilities are the REAL catalog ids", () => {
  assert.equal(CYCLE_COUNT_CREATE_CAPABILITY, "inventory.cycleCount.create");
  assert.equal(CYCLE_COUNT_SUBMIT_CAPABILITY, "inventory.cycleCount.submit");
});

test("counting has its OWN refusal sentence, not the generic one", () => {
  const text = unavailableText(SCAN_WORKFLOW.CYCLE_COUNT, UNAVAILABLE_REASON.NO_CAPABILITY);
  assert.match(text, /count stock/i);
  assert.notEqual(text, unavailableText(SCAN_WORKFLOW.TRANSFER, UNAVAILABLE_REASON.NO_CAPABILITY));
});

test("counting, transferring and receiving are three separate authorities", () => {
  const counter = deriveScanWorkflows({
    hasCapability: gate(CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY),
    receivingReady: true,
  });
  assert.equal(has(counter, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
  assert.equal(has(counter, SCAN_WORKFLOW.TRANSFER), false);
});

// ─────────────────────────────────────────── put-away (Phase L)

test("put-away needs BOTH the placement authority and the bin CHECK", () => {
  // Without the read an operator could only stow into an unvalidated code, which is how stock gets
  // recorded onto racking that does not exist.
  for (const held of [[PLACEMENT_RECORD_CAPABILITY], [BIN_READ_CAPABILITY]]) {
    const r = deriveScanWorkflows({ hasCapability: gate(...held) });
    assert.equal(has(r, SCAN_WORKFLOW.PUT_AWAY), false, `${held.join()} alone must not offer put-away`);
  }
  const both = deriveScanWorkflows({ hasCapability: gate(PLACEMENT_RECORD_CAPABILITY, BIN_READ_CAPABILITY) });
  assert.equal(has(both, SCAN_WORKFLOW.PUT_AWAY), true);
});

test("stowing all day does NOT confer the authority to retire racking", () => {
  const code = codeOf("../src/access/scanWorkflows.js");
  assert.doesNotMatch(code, /bin\.manage/, "put-away eligibility must not consult the write capability");
  const stower = deriveScanWorkflows({ hasCapability: gate("inventory.location.bin.manage") });
  assert.equal(has(stower, SCAN_WORKFLOW.PUT_AWAY), false, "the manage grant alone is not a stow grant");
});

test("put-away is NOT gated on receiving — stowing is not accepting stock", () => {
  const receiver = deriveScanWorkflows({ hasCapability: gate(RECEIVE_CAPABILITY), receivingReady: true });
  assert.equal(has(receiver, SCAN_WORKFLOW.PUT_AWAY), false);
  assert.equal(PLACEMENT_RECORD_CAPABILITY, "inventory.placement.record");
  assert.notEqual(PLACEMENT_RECORD_CAPABILITY, RECEIVE_CAPABILITY);
});

test("put-away has its own refusal sentence", () => {
  const text = unavailableText(SCAN_WORKFLOW.PUT_AWAY, UNAVAILABLE_REASON.NO_CAPABILITY);
  assert.match(text, /put stock away/i);
  assert.notEqual(text, unavailableText(SCAN_WORKFLOW.CYCLE_COUNT, UNAVAILABLE_REASON.NO_CAPABILITY));
});

test("the put-away description says counts do not change", () => {
  // An operator could reasonably assume a stow "moved" something. It does not.
  assert.match(SCAN_WORKFLOW_DESCRIPTION[SCAN_WORKFLOW.PUT_AWAY], /counts do not change|not what there is/i);
});
