// Workstream 2A.1B — the bounded Warehouse root company assignment (Owner rulings R-19 … R-23).
//
// The ruling's test list, plus the two things it is easiest to get wrong: that an ALREADY-APPLIED
// assignment stays idempotent even when the company has since gone inactive, and that a failed
// preflight leaves ZERO partial assignments.
//
// OFFLINE. Pure functions and the real authored config; no emulator, no Firebase, no writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Timestamp } from "firebase-admin/firestore";

import {
  ASSIGNED_FIELD,
  ASSIGNMENT_OUTCOME,
  CERTIFICATION_PROJECT,
  EXPECTED_ASSIGNMENT_COUNT,
  EXPECTED_WAREHOUSE_ASSIGNMENTS,
  SOURCE_DECISION,
  TARGET_DECISION,
  assignmentHandoffInput,
  assignmentPatch,
  classifyWarehouseAssignment,
  planWarehouseRootCompanyAssignment,
  resolveAssignmentTarget,
  resolveAuthoredWarehouseAssignments,
} from "../lib/ownership/warehouseRootCompanyAssignment.js";
import { buildOwnershipHandoff } from "../lib/ownership/ownershipHandoffCommand.js";
import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";

const TS = Timestamp.fromMillis(1_756_000_000_000);

/** A §3A-complete governed warehouse. `over` deviates from a genuinely valid baseline, so a failure
 *  is always attributable to the deviation rather than to a fixture that was never valid. */
const warehouse = (id, over = {}) => ({
  id,
  name: `Warehouse ${id}`,
  location: "Phoenix, AZ",
  status: "ACTIVE",
  version: 1,
  updatedAt: TS,
  updatedBy: "seed",
  provenance: "MIGRATED",
  governanceInitializedAt: TS,
  governanceInitializedBy: "seed",
  ...over,
});
const candidate = (id, over) => ({ warehouseId: id, data: warehouse(id, over) });

// =========================== the per-warehouse contract (R-19, R-20) ===========================

test("unset + a governed ACTIVE company -> ASSIGN", () => {
  const d = classifyWarehouseAssignment(candidate("wh-main"), "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.ASSIGN);
  assert.equal(d.currentCompanyId, null);
});

test("same company -> IDEMPOTENT SUCCESS, and it is not an assignment", () => {
  const d = classifyWarehouseAssignment(candidate("wh-main", { operatingCompanyId: "taylor" }), "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.ALREADY_ASSIGNED);
  assert.equal(d.currentCompanyId, "taylor");
  // The two functions that produce a mutation refuse to act on it at all, so there is no way to
  // write or to audit a no-op even by mistake.
  assert.throws(() => assignmentPatch(d), /only defined for ASSIGN/);
  assert.throws(() => assignmentHandoffInput(d), /only defined for ASSIGN/);
});

test("a DIFFERENT company -> REFUSE. Reassignment is not invented here", () => {
  const d = classifyWarehouseAssignment(candidate("wh-main", { operatingCompanyId: "ventana" }), "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.REFUSED_COMPANY_MISMATCH);
  assert.equal(d.currentCompanyId, "ventana");
  assert.match(d.detail, /no governed warehouse company reassignment semantics exist/);
});

test("an unknown company -> REFUSE", () => {
  for (const bad of ["acme", "TAYLOR", "Taylor Freezer of Arizona", "", "   "]) {
    const d = classifyWarehouseAssignment(candidate("wh-main"), bad);
    assert.ok(
      d.outcome === ASSIGNMENT_OUTCOME.REFUSED_COMPANY_UNKNOWN,
      `${JSON.stringify(bad)} must be refused as unknown, got ${d.outcome}`,
    );
  }
});

test("R-20: an INACTIVE company is NOT assignable, even though storage tolerates it", () => {
  // The central R-20 refusal. No inactive company is seeded today, so the resolver is injected to
  // reach the branch -- otherwise this refusal would ship on reasoning alone, which is exactly how
  // an untested fail-closed path turns out not to be closed.
  const inactive = () => ({ state: "INACTIVE", company: { id: "dormant-co", code: "DORMANT", displayName: "Dormant Co", active: false } });
  const d = classifyWarehouseAssignment(candidate("wh-main"), "dormant-co", { resolveCompany: inactive });
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.REFUSED_COMPANY_NOT_ASSIGNABLE);
  assert.equal(d.detail, "INACTIVE");

  // UNKNOWN and INACTIVE are deliberately DIFFERENT refusals, so an operator learns which problem
  // they have: a company that does not exist, or one that exists and may not take new relationships.
  const unknown = classifyWarehouseAssignment(candidate("wh-main"), "dormant-co");
  assert.equal(unknown.outcome, ASSIGNMENT_OUTCOME.REFUSED_COMPANY_UNKNOWN);
  assert.equal(unknown.detail, "UNKNOWN");

  // And the whole batch blocks on it -- an inactive company cannot slip through as a partial run.
  const plan = planWarehouseRootCompanyAssignment({ "wh-main": "dormant-co" }, [candidate("wh-main")], { resolveCompany: inactive });
  assert.equal(plan.ok, false);
  assert.equal(plan.toAssign.length, 0);
});

test("R-20: an ALREADY-APPLIED assignment stays a no-op even if that company went inactive", () => {
  // Why the already-assigned check runs BEFORE company eligibility. History is not rewritten merely
  // because a company later became inactive, and a re-run must not start refusing what it applied.
  const inactive = () => ({ state: "INACTIVE", company: { id: "taylor", code: "TAYLOR", displayName: "Taylor", active: false } });
  const d = classifyWarehouseAssignment(candidate("wh-main", { operatingCompanyId: "taylor" }), "taylor", { resolveCompany: inactive });
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.ALREADY_ASSIGNED);
});

test("a malformed warehouse -> REFUSE, with the governed reason", () => {
  const d = classifyWarehouseAssignment({ warehouseId: "wh-x", data: { name: "half a document" } }, "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.REFUSED_WAREHOUSE_MALFORMED);
  assert.ok(typeof d.detail === "string" && d.detail.length > 0);
});

test("a missing warehouse -> REFUSE", () => {
  const d = classifyWarehouseAssignment({ warehouseId: "wh-ghost", data: undefined }, "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.REFUSED_WAREHOUSE_MISSING);
});

test("an unexpected key on the stored warehouse -> REFUSE (the §3A allow-list still bites)", () => {
  const d = classifyWarehouseAssignment(candidate("wh-main", { region: "south" }), "taylor");
  assert.equal(d.outcome, ASSIGNMENT_OUTCOME.REFUSED_WAREHOUSE_MALFORMED);
  assert.equal(d.detail, "unknown_field");
});

// =========================== the authored facts (R-23 bounded scope) ===========================

test("the REAL authored config yields exactly the five expected assignments", () => {
  const config = JSON.parse(readFileSync(new URL("../../config/ownership/operating-company-roots.sandbox.json", import.meta.url), "utf8"));
  const authored = resolveAuthoredWarehouseAssignments(config);
  assert.equal(authored.decision, SOURCE_DECISION.MATCHED, authored.detail ?? "");
  assert.deepEqual(authored.assignments, EXPECTED_WAREHOUSE_ASSIGNMENTS);
  assert.equal(Object.keys(authored.assignments).length, EXPECTED_ASSIGNMENT_COUNT);
});

test("drift in EITHER direction stops the run before any live read", () => {
  // A config that has drifted from the ruling is exactly as unsafe as a pinned list that has drifted
  // from the config, so both are refused and each says which kind of drift it is.
  const base = { roots: { warehouses: Object.entries(EXPECTED_WAREHOUSE_ASSIGNMENTS).map(([id, operatingCompanyId]) => ({ id, operatingCompanyId })) } };
  const rows = () => base.roots.warehouses.map((r) => ({ ...r }));

  assert.equal(resolveAuthoredWarehouseAssignments({ roots: { warehouses: rows().slice(1) } }).decision, SOURCE_DECISION.MISSING_FROM_CONFIG);
  assert.equal(
    resolveAuthoredWarehouseAssignments({ roots: { warehouses: [...rows(), { id: "wh-extra", operatingCompanyId: "taylor" }] } }).decision,
    SOURCE_DECISION.UNEXPECTED_IN_CONFIG,
  );
  const flipped = rows();
  flipped[0] = { ...flipped[0], operatingCompanyId: "ventana" };
  assert.equal(resolveAuthoredWarehouseAssignments({ roots: { warehouses: flipped } }).decision, SOURCE_DECISION.COMPANY_DISAGREES);

  for (const malformed of [null, {}, { roots: {} }, { roots: { warehouses: "no" } }, { roots: { warehouses: [{ id: "wh-main" }] } }]) {
    assert.equal(resolveAuthoredWarehouseAssignments(malformed).decision, SOURCE_DECISION.CONFIG_MALFORMED);
  }
});

test("the mapping is never derived -- it comes from the authored config alone", () => {
  // There is no code path that could reach a warehouse's name, location, region or any display text
  // to produce a company. Asserted against the source, because absence is the property.
  const src = readFileSync(new URL("../src/ownership/warehouseRootCompanyAssignment.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const forbidden of [/\.name\b/, /\.location\b/, /lineOfBusiness/, /region/i, /displayName/, /salesperson/i, /createdBy/]) {
    assert.doesNotMatch(src, forbidden, `the assignment module must not read ${forbidden}`);
  }
});

// =========================== the target guard ===========================

test("the target is proven by PROJECT ID, never by registry role", () => {
  assert.equal(resolveAssignmentTarget("eos-platform-sandbox").decision, TARGET_DECISION.ELIGIBLE);
  assert.equal(resolveAssignmentTarget("taylor-parts").decision, TARGET_DECISION.REFUSED_PRODUCTION);
  assert.equal(resolveAssignmentTarget("some-other-project").decision, TARGET_DECISION.REFUSED_UNKNOWN_TARGET);
  for (const nothing of [undefined, null, "", "   ", 7, {}]) {
    assert.equal(resolveAssignmentTarget(nothing).decision, TARGET_DECISION.REFUSED_UNKNOWN_TARGET);
  }
});

test("certification is refused unless separately authorized, BECAUSE it shares the sandbox role", () => {
  assert.equal(resolveAssignmentTarget(CERTIFICATION_PROJECT).decision, TARGET_DECISION.REFUSED_CERTIFICATION_NOT_AUTHORIZED);
  assert.equal(resolveAssignmentTarget(CERTIFICATION_PROJECT, { certificationAuthorized: true }).decision, TARGET_DECISION.ELIGIBLE);
  // And the module contains no role-based branch that could reintroduce the ambiguity.
  const src = readFileSync(new URL("../src/ownership/warehouseRootCompanyAssignment.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(src, /role\s*===\s*["']sandbox["']/);
});

// =========================== the batch (validate, THEN mutate) ===========================

const allUnset = () => Object.keys(EXPECTED_WAREHOUSE_ASSIGNMENTS).map((id) => candidate(id));

test("a complete, clean batch plans exactly five assignments", () => {
  const plan = planWarehouseRootCompanyAssignment(EXPECTED_WAREHOUSE_ASSIGNMENTS, allUnset());
  assert.equal(plan.ok, true);
  assert.equal(plan.toAssign.length, EXPECTED_ASSIGNMENT_COUNT);
  assert.equal(plan.refusals.length, 0);
  assert.equal(plan.blockedReason, null);
});

test("ONE refusal blocks the WHOLE batch -- zero partial assignments", () => {
  // The property that matters most. A partial run leaves the sandbox in a state no ruling describes,
  // and the next operator cannot tell an intended partial from an aborted one.
  const candidates = allUnset();
  candidates[3] = { warehouseId: candidates[3].warehouseId, data: { name: "broken" } };
  const plan = planWarehouseRootCompanyAssignment(EXPECTED_WAREHOUSE_ASSIGNMENTS, candidates);
  assert.equal(plan.ok, false);
  assert.equal(plan.refusals.length, 1);
  assert.match(plan.blockedReason, /REFUSED_WAREHOUSE_MALFORMED/);
  // Four rows would have been assignable. The plan still reports them, and the caller must write none.
  assert.equal(plan.toAssign.length, 4);
});

test("a second run over an already-applied world is a clean no-op", () => {
  const applied = Object.entries(EXPECTED_WAREHOUSE_ASSIGNMENTS).map(([id, company]) => candidate(id, { operatingCompanyId: company }));
  const plan = planWarehouseRootCompanyAssignment(EXPECTED_WAREHOUSE_ASSIGNMENTS, applied);
  assert.equal(plan.ok, true);
  assert.equal(plan.toAssign.length, 0, "idempotent: nothing to write");
  assert.equal(plan.alreadyAssigned.length, EXPECTED_ASSIGNMENT_COUNT);
});

test("a missing warehouse blocks the batch rather than being skipped", () => {
  const plan = planWarehouseRootCompanyAssignment(EXPECTED_WAREHOUSE_ASSIGNMENTS, allUnset().slice(1));
  assert.equal(plan.ok, false);
  assert.match(plan.blockedReason, /REFUSED_WAREHOUSE_MISSING/);
});

// =========================== the write and its audit ===========================

test("the patch is ONE field -- the document is never reconstructed", () => {
  const [d] = planWarehouseRootCompanyAssignment(EXPECTED_WAREHOUSE_ASSIGNMENTS, allUnset()).toAssign;
  const patch = assignmentPatch(d);
  assert.deepEqual(Object.keys(patch), [ASSIGNED_FIELD]);
  assert.equal(patch[ASSIGNED_FIELD], EXPECTED_WAREHOUSE_ASSIGNMENTS[d.warehouseId]);
});

test("a patched warehouse keeps every unrelated fact, and is still governed", () => {
  const before = warehouse("wh-main");
  const [d] = planWarehouseRootCompanyAssignment({ "wh-main": "taylor" }, [{ warehouseId: "wh-main", data: before }]).toAssign;
  const after = { ...before, ...assignmentPatch(d) };
  for (const key of Object.keys(before)) {
    assert.deepEqual(after[key], before[key], `${key} must survive the patch untouched`);
  }
  const governed = validateGovernedWarehouse(after, "wh-main");
  assert.equal(governed.valid, true);
  assert.equal(governed.value.operatingCompanyId, "taylor");
});

test("the audit event is the EXISTING ownership handoff, with previousOwner null", () => {
  // R-21: no WAREHOUSE_COMPANY_ASSIGNED, no ROOT_COMPANY_ASSIGNED, no parallel family. The handoff
  // authority already supports a null previousOwner and renders it "(none)".
  const [d] = planWarehouseRootCompanyAssignment({ "wh-north": "ventana" }, [candidate("wh-north")]).toAssign;
  const event = buildOwnershipHandoff(assignmentHandoffInput(d), { actorUid: "operator" });
  assert.equal(event.action, "OWNERSHIP_HANDOFF");
  assert.equal(event.targetType, "warehouse");
  assert.equal(event.targetId, "wh-north");
  assert.equal(event.previousOwner, null);
  assert.deepEqual(event.newOwner, { type: "COMPANY", id: "ventana" });
  assert.equal(event.actorUid, "operator");
  assert.match(event.summary, /handed off from \(none\) to COMPANY:ventana/);
});

test("no second audit family was introduced", () => {
  const src = readFileSync(new URL("../src/ownership/warehouseRootCompanyAssignment.ts", import.meta.url), "utf8");
  for (const invented of [/WAREHOUSE_COMPANY_ASSIGNED/, /ROOT_COMPANY_ASSIGNED/, /auditEvents/]) {
    assert.doesNotMatch(src, invented);
  }
});

// =========================== the operator path's own guards ===========================

const operatorSource = readFileSync(new URL("../scripts/assignWarehouseRootCompany.js", import.meta.url), "utf8");
const operatorCode = operatorSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("dry run is the default, and apply needs two more flags", () => {
  assert.match(operatorCode, /const apply = args\.apply === "true"/);
  assert.match(operatorCode, /confirm-warehouse-root-company-assignment/);
  assert.match(operatorCode, /functions-deployed-verified/);
  // The deployment precondition is a refusal, not a warning: a live pre-amendment receiving service
  // rejects a company-bearing warehouse outright.
  assert.match(operatorCode, /apply && args\[DEPLOY_FLAG\] !== "true"/);
});

test("the operator writes ONE field, through update, and never sets a whole document", () => {
  assert.match(operatorCode, /txn\.update\(refs\[i\], assignmentPatch\(d\)\)/);
  assert.doesNotMatch(operatorCode, /txn\.set\(/, "a whole-document set is how the erase path happened");
  assert.doesNotMatch(operatorCode, /buildMigratedRecord|executeMigration/, "assignment must never run a migration");
});

test("the operator re-reads in-transaction and refuses to overwrite a company that appeared", () => {
  assert.match(operatorCode, /gained a company/);
  assert.match(operatorCode, /disappeared between plan and commit/);
});

test("the operator did not extend the previously authorized backfill (R-23)", () => {
  // It reuses primitives; it must not import that applier's caps or rules, which were authorized as
  // an exact document count for a different, already-reviewed operation.
  assert.doesNotMatch(operatorCode, /ownershipBackfillRules|AUTHORIZED_WRITE_CAPS|ownershipSandboxBackfill/);
  const backfill = readFileSync(new URL("../scripts/ownershipSandboxBackfill.js", import.meta.url), "utf8");
  assert.doesNotMatch(backfill, /warehouseRootCompanyAssignment|EXPECTED_WAREHOUSE_ASSIGNMENTS/, "and the old applier was not widened");
});

test("mobile_locations is not in scope", () => {
  // Its writer is a full-document replace and would erase a company. Excluded by ruling, and there
  // is no code here that could reach it.
  assert.doesNotMatch(operatorCode, /mobile_locations/);
  const src = readFileSync(new URL("../src/ownership/warehouseRootCompanyAssignment.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /mobile_locations/);
});
