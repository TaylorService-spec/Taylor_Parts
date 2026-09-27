// Administration → Workflows — the PURE view model over the SERVER's answers.
//
// The screen no longer carries a client copy of the seeded workflow definitions: every workflow,
// version, binding and validation finding comes from the EOS API. What is proved here is that the
// view model reads the server's shapes faithfully, offers only lifecycle actions that are not certain
// refusals, round-trips a draft into exactly the definition the server accepts, and that NO copy of
// the seed has crept back into the client.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as view from "../src/domain/adminWorkflowView.js";

const {
  WORKFLOW_AREAS,
  WORKFLOW_GUARD_OPTIONS,
  areaForMachine,
  buildWorkflowVersionView,
  definitionForServer,
  editableDefinition,
  groupWorkflowsByArea,
  lifecycleActions,
  lifecycleLabel,
  summarizeWorkflow,
  validationSummary,
} = view;

// listWorkflows / readWorkflowVersion / validateWorkflowVersion, as the server shapes them.
const LIST_ENTRY = {
  workflow: { id: "wf-so", key: "salesOrder", name: "Sales — Order", description: "d", objectKey: "salesOrder", activeVersionId: "v2" },
  versions: [
    { id: "v2", version: 2, status: "PUBLISHED", publishedAt: "2026-09-26T00:00:00Z" },
    { id: "v1", version: 1, status: "RETIRED", publishedAt: "2026-09-25T00:00:00Z" },
    { id: "v3", version: 3, status: "DRAFT", publishedAt: null },
  ],
};
const VERSION_VIEW = {
  workflow: LIST_ENTRY.workflow,
  version: { id: "v3", version: 3, status: "DRAFT" },
  active: false,
  steps: [
    { key: "CONFIRMED", label: "Confirmed", initial: true, terminal: false },
    { key: "CLOSED", label: "Closed", initial: false, terminal: true },
  ],
  actions: [
    { key: "close", label: "Close", from: "CONFIRMED", to: "CLOSED", requiresOwnAssignment: false,
      capabilityKey: "salesOrder.write", guardKind: null, roleKeys: ["admin", "salesManager"],
      bindings: [{ roleKey: "admin", bindingKind: "SECURITY_ROLE" }, { roleKey: "salesManager", bindingKind: "SECURITY_ROLE" }] },
  ],
};

test("NO client copy of any workflow definition remains", () => {
  assert.equal("SEED_WORKFLOW_FAMILIES" in view, false, "the duplicate seed export is gone");
  const source = readFileSync("src/domain/adminWorkflowView.js", "utf8");
  for (const seeded of ["PENDING_REVIEW", "READY_TO_DISPATCH", "IN_FULFILLMENT", "CUSTOMER_REVIEW", "roleKeys: ["]) {
    assert.equal(source.includes(seeded), false, `the client still carries seed data (${seeded})`);
  }
  const screen = readFileSync("src/modules/administration/AdminWorkflows.jsx", "utf8");
  assert.equal(screen.includes("SEED_WORKFLOW_FAMILIES"), false);
  assert.match(screen, /api\.listWorkflows\(\)/, "the list is read from the server");
});

test("summarizeWorkflow reads the active pointer and the lifecycle counts", () => {
  const s = summarizeWorkflow(LIST_ENTRY);
  assert.equal(s.activeVersion, 2);
  assert.deepEqual(s.versions.map((v) => `${v.version}:${v.status}:${v.active}`), ["1:RETIRED:false", "2:PUBLISHED:true", "3:DRAFT:false"]);
  assert.deepEqual({ ...s.counts }, { draft: 1, published: 1, retired: 1 });
  assert.equal(summarizeWorkflow({}), null, "an unreadable entry is null, not a guess");
});

test("lifecycle labels and the lifecycle actions worth offering", () => {
  assert.equal(lifecycleLabel({ status: "PUBLISHED", active: true }), "Published · ACTIVE");
  assert.equal(lifecycleLabel({ status: "PUBLISHED", active: false }), "Published · not active");
  assert.deepEqual([...lifecycleActions({ status: "DRAFT" })], ["publish", "retire", "newVersion"]);
  assert.deepEqual([...lifecycleActions({ status: "PUBLISHED", active: true })], ["newVersion"], "the ACTIVE version cannot be retired");
  assert.deepEqual([...lifecycleActions({ status: "PUBLISHED", active: false })], ["activate", "retire", "newVersion"]);
  assert.deepEqual([...lifecycleActions({ status: "RETIRED" })], ["newVersion"]);
});

test("buildWorkflowVersionView carries capability, guard and binding kind, and derives outgoing actions", () => {
  const v = buildWorkflowVersionView(VERSION_VIEW);
  assert.deepEqual(v.steps.map((s) => [s.key, [...s.outgoing]]), [["CONFIRMED", ["Close"]], ["CLOSED", []]]);
  assert.equal(v.actions[0].capabilityKey, "salesOrder.write");
  assert.deepEqual(v.actions[0].bindings.map((b) => b.bindingKind), ["SECURITY_ROLE", "SECURITY_ROLE"]);
  assert.equal(v.bindingCount, 2);
  assert.equal(buildWorkflowVersionView({}), null);
});

test("a draft round-trips into exactly the definition the server accepts", () => {
  const editable = editableDefinition(VERSION_VIEW);
  assert.equal(editable.actions[0].roleKeys, "admin, salesManager");
  editable.actions[0].guardKind = "RECORD_ASSIGNMENT";
  editable.actions[0].roleKeys = "admin,  salesManager ,technician";
  editable.actions.push({ key: "x", label: "X", from: "CONFIRMED", to: "CLOSED", capabilityKey: "  ", guardKind: "", roleKeys: "" });
  const def = definitionForServer(editable);
  assert.deepEqual(def.actions[0], {
    key: "close", label: "Close", from: "CONFIRMED", to: "CLOSED", capabilityKey: "salesOrder.write",
    guardKind: "RECORD_ASSIGNMENT", requiresOwnAssignment: true, roleKeys: ["admin", "salesManager", "technician"],
    functionalRoleKeys: [],
  });
  assert.deepEqual([def.actions[1].capabilityKey, def.actions[1].guardKind, def.actions[1].roleKeys], [null, null, []],
    "blank is none -- the server reports ACTION_WITHOUT_CAPABILITY, the browser does not decide");
  assert.deepEqual(WORKFLOW_GUARD_OPTIONS.map((o) => o.value), ["", "RECORD_ASSIGNMENT"], "the server's closed guard list");
});

test("validation results are grouped by code, errors before warnings, verbatim", () => {
  const s = validationSummary({
    valid: false,
    errors: [
      { code: "BINDING_WITHOUT_CAPABILITY", message: "a" }, { code: "BINDING_WITHOUT_CAPABILITY", message: "b" },
      { code: "NO_TERMINAL_STATE", message: "c" },
    ],
    warnings: [{ code: "CAPABILITY_HOLDER_NOT_BOUND", message: "d" }],
  });
  assert.equal(s.valid, false);
  assert.deepEqual(s.errors.map((g) => [g.code, g.items.length]), [["BINDING_WITHOUT_CAPABILITY", 2], ["NO_TERMINAL_STATE", 1]]);
  assert.equal(s.warningCount, 1);
  assert.equal(validationSummary({}), null);
});

test("THREE business areas group the server's machines; an unnamed workflow is shown, not hidden", () => {
  assert.equal(WORKFLOW_AREAS.length, 3);
  assert.deepEqual([...areaForMachine("salesOrder").machineKeys], ["salesOpportunity", "salesAgreement", "salesOrder"],
    "Sales is one AREA over three machines, not one machine");
  const groups = groupWorkflowsByArea([summarizeWorkflow(LIST_ENTRY), summarizeWorkflow({ ...LIST_ENTRY, workflow: { ...LIST_ENTRY.workflow, id: "wf-x", key: "custom" } })]);
  assert.deepEqual(groups.map((g) => [g.key, g.workflows.map((w) => w.key)]), [["sales", ["salesOrder"]], ["other", ["custom"]]]);
});
