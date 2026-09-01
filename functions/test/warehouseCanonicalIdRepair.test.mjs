// R-27 — the bounded warehouse canonical-id repair.
//
// The defect is narrow and so is the authority: two named records, one named field, one exact
// expected state. Most of this file is refusals, because a repair tool's value is what it declines
// to touch.
//
// OFFLINE. Pure functions; no emulator, no Firebase, no writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Timestamp } from "firebase-admin/firestore";

import {
  EXPECTED_REPAIR_COUNT,
  REPAIRABLE_WAREHOUSE_IDS,
  REPAIRED_FIELD,
  REPAIR_OUTCOME,
  canonicalIdPatch,
  classifyCanonicalIdRepair,
  planCanonicalIdRepair,
} from "../lib/ownership/warehouseCanonicalIdRepair.js";
import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";

const TS = Timestamp.fromMillis(1_755_000_000_000);

/** The EXACT live shape of the two defective records: a NATIVE seed record missing only `id`. */
const seeded = (over = {}) => ({
  name: "Central Distribution",
  location: "1200 Industrial Pkwy",
  status: "ACTIVE",
  version: 1,
  updatedAt: TS,
  updatedBy: "seed-script",
  createdAt: TS,
  createdBy: "seed-script",
  provenance: "NATIVE",
  ...over,
});
const candidate = (id, over) => ({ warehouseId: id, data: seeded(over) });
const ID_A = REPAIRABLE_WAREHOUSE_IDS[0];
const ID_B = REPAIRABLE_WAREHOUSE_IDS[1];

// =========================== the expected defect ===========================

test("the fixture really is the defect -- it fails ONLY on id_invalid", () => {
  // If this fixture were valid, or failed for another reason, every case below would be testing
  // something other than the thing that is broken in sandbox.
  const before = validateGovernedWarehouse(seeded(), ID_A);
  assert.equal(before.valid, false);
  assert.equal(before.reason, "id_invalid");
  const after = validateGovernedWarehouse({ ...seeded(), id: ID_A }, ID_A);
  assert.equal(after.valid, true, "one field must be sufficient, or the repair is the wrong shape");
});

test("the expected defect -> REPAIR, changing exactly one key", () => {
  const d = classifyCanonicalIdRepair(candidate(ID_A));
  assert.equal(d.outcome, REPAIR_OUTCOME.REPAIR);
  assert.equal(d.currentId, null);
  assert.equal(d.validatorBefore, "id_invalid");
  assert.equal(d.validatorAfter, null, "the patched record validates");
  assert.deepEqual(d.plannedChangedKeys, ["id"]);
  assert.deepEqual(Object.keys(canonicalIdPatch(d)), [REPAIRED_FIELD]);
  assert.equal(canonicalIdPatch(d).id, ID_A);
});

test("an already-correct id -> IDEMPOTENT, and it cannot produce a patch", () => {
  const d = classifyCanonicalIdRepair(candidate(ID_A, { id: ID_A }));
  assert.equal(d.outcome, REPAIR_OUTCOME.ALREADY_CORRECT);
  assert.throws(() => canonicalIdPatch(d), /only defined for REPAIR/);
});

test("a DIFFERENT stored id -> REFUSE. An id is never overwritten", () => {
  // A record whose stored id disagrees with its path is a data-integrity fault of another kind, and
  // silently rewriting it would destroy the evidence of whatever produced it.
  const d = classifyCanonicalIdRepair(candidate(ID_A, { id: "wh-something-else" }));
  assert.equal(d.outcome, REPAIR_OUTCOME.REFUSED_ID_MISMATCH);
  assert.equal(d.currentId, "wh-something-else");
});

test("a missing document -> REFUSE", () => {
  const d = classifyCanonicalIdRepair({ warehouseId: ID_A, data: undefined });
  assert.equal(d.outcome, REPAIR_OUTCOME.REFUSED_MISSING);
});

// =========================== everything that is NOT this defect ===========================

test("any deviation from the exact expected state is refused, with its reason", () => {
  const deviations = {
    "provenance MIGRATED": { provenance: "MIGRATED", governanceInitializedAt: TS, governanceInitializedBy: "op" },
    "governance metadata present": { governanceInitializedAt: TS, governanceInitializedBy: "op" },
    "an operating company already set": { operatingCompanyId: "taylor" },
    "a second defect (unknown field)": { region: "south" },
    "a second defect (legacy active)": { active: true },
  };
  for (const [label, over] of Object.entries(deviations)) {
    const d = classifyCanonicalIdRepair(candidate(ID_A, over));
    assert.equal(d.outcome, REPAIR_OUTCOME.REFUSED_UNEXPECTED_STATE, label);
    assert.ok(typeof d.detail === "string" && d.detail.length > 0, `${label} must say why`);
    assert.deepEqual(d.plannedChangedKeys, [], `${label} must plan no change`);
  }
});

test("a record that adding an id would NOT repair is refused rather than patched", () => {
  // The check that stops this becoming "add an id and hope". A record broken in a second way stays
  // broken after the patch, so the patch is not the repair and must not be applied.
  const d = classifyCanonicalIdRepair(candidate(ID_A, { status: "DECOMMISSIONED" }));
  assert.equal(d.outcome, REPAIR_OUTCOME.REFUSED_UNEXPECTED_STATE);
  assert.match(d.detail, /different reason|does not make the record governed/);
});

// =========================== the batch ===========================

test("a clean batch plans exactly the two authorized repairs", () => {
  const plan = planCanonicalIdRepair([candidate(ID_A), candidate(ID_B)]);
  assert.equal(plan.ok, true);
  assert.equal(plan.toRepair.length, EXPECTED_REPAIR_COUNT);
  assert.equal(plan.refusals.length, 0);
  for (const d of plan.decisions) assert.deepEqual(d.plannedChangedKeys, ["id"]);
});

test("ONE refusal blocks BOTH -- no partial identity repair", () => {
  const plan = planCanonicalIdRepair([candidate(ID_A), candidate(ID_B, { operatingCompanyId: "taylor" })]);
  assert.equal(plan.ok, false);
  assert.equal(plan.refusals.length, 1);
  assert.equal(plan.toRepair.length, 1, "one WOULD have been repairable, and must not be");
  assert.match(plan.blockedReason, /REFUSED_UNEXPECTED_STATE/);
});

test("a second run over repaired records is a clean no-op", () => {
  const plan = planCanonicalIdRepair([candidate(ID_A, { id: ID_A }), candidate(ID_B, { id: ID_B })]);
  assert.equal(plan.ok, true);
  assert.equal(plan.toRepair.length, 0);
  assert.equal(plan.alreadyCorrect.length, EXPECTED_REPAIR_COUNT);
});

test("the scope is exactly two records, and a caller cannot widen it", () => {
  assert.deepEqual([...REPAIRABLE_WAREHOUSE_IDS].sort(), ["wh-sandbox-central", "wh-sandbox-north"]);
  // An unrelated warehouse handed in is simply not planned -- the plan is driven by the constant,
  // not by the input.
  const plan = planCanonicalIdRepair([candidate(ID_A), candidate(ID_B), { warehouseId: "wh-main", data: seeded() }]);
  assert.equal(plan.decisions.length, EXPECTED_REPAIR_COUNT);
  assert.ok(!plan.decisions.some((d) => d.warehouseId === "wh-main"));
});

// =========================== the operator path ===========================

const operator = readFileSync(new URL("../scripts/repairSandboxWarehouseCanonicalIds.js", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("dry run is the default and apply needs a purpose-named flag", () => {
  assert.match(operator, /const apply = args\.apply === "true"/);
  assert.match(operator, /confirm-warehouse-canonical-id-repair/);
  // Never a generic force flag: a purpose-named one cannot be reused for a different mutation.
  assert.doesNotMatch(operator, /--force|args\.force/);
});

test("the operator patches ONE field and never sets a document", () => {
  assert.match(operator, /txn\.update\(refs\[i\], canonicalIdPatch\(/);
  assert.doesNotMatch(operator, /txn\.set\(/, "a whole-document set is the reconstruction this repair exists to avoid");
  assert.doesNotMatch(operator, /buildMigratedRecord|executeMigration/, "the migration was refused for this repair");
});

test("no business event is emitted -- nothing changed hands", () => {
  assert.doesNotMatch(operator, /OWNERSHIP_HANDOFF|stageOwnershipHandoff|auditEvents/);
});

test("it shares ONE target authority with the assignment operator", () => {
  // Not a second opinion about which project is safe: the same resolver, plus the same registry gate.
  assert.match(operator, /resolveAssignmentTarget/);
  assert.match(operator, /assertNotProductionByRegistry/);
  assert.match(operator, /taylor-parts is the customer production project/);
  assert.match(operator, /config\/environments\.json/);
  assert.match(operator, /--projectId is required/);
  assert.match(operator, /fail closed/i);
});

test("it re-reads in-transaction and refuses to overwrite an id that appeared", () => {
  assert.match(operator, /gained an id/);
  assert.match(operator, /disappeared between plan and commit/);
});
