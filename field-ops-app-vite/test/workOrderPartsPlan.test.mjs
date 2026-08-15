// WO Parts Plan (client pure core) -- OFFLINE tests. Proves the business-intent validation + the
// removal invariants (PLAN != RESERVE != USE): planning only sets planned quantities, never reserves, and
// never erases a part that already has recorded usage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildPartsPlanInput,
  planRemovals,
  planRemovalBlocked,
  isPlanEditableStatus,
  planLinesFromSnapshot,
  planHasUnresolvedLines,
  PLAN_TERMINAL_STATUSES,
} from "../src/domain/workOrderPartsPlan.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("workOrderPartsPlan.test.mjs");

check("buildPartsPlanInput: normalizes valid lines (partId identity, positive int qty)", () => {
  const r = buildPartsPlanInput([
    { partId: " P-1 ", name: " Filter ", qtyPlanned: 2 },
    { partId: "P-2", qtyPlanned: 1 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, [
    { partId: "P-1", name: "Filter", qtyPlanned: 2 },
    { partId: "P-2", name: null, qtyPlanned: 1 },
  ]);
});

check("buildPartsPlanInput: an empty plan is valid input (clear the plan)", () => {
  assert.deepEqual(buildPartsPlanInput([]), { ok: true, value: [] });
});

check("buildPartsPlanInput: honest failures (no partial output)", () => {
  assert.deepEqual(buildPartsPlanInput("nope"), { ok: false, error: "PLAN_MUST_BE_LIST" });
  assert.equal(buildPartsPlanInput([null]).error, "LINE_INVALID");
  assert.equal(buildPartsPlanInput([{ qtyPlanned: 1 }]).error, "PART_REQUIRED");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 0 }]).error, "QTY_INVALID");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 1.5 }]).error, "QTY_INVALID");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 2 }, { partId: "P-1", qtyPlanned: 1 }]).error, "DUPLICATE_PART");
});

check("planRemovals: lists currently-planned parts dropped from the proposed plan", () => {
  const current = [{ partId: "A", qtyPlanned: 1 }, { partId: "B", qtyPlanned: 2 }, { partId: "C", qtyPlanned: 1 }];
  const proposed = [{ partId: "A", qtyPlanned: 3 }]; // B and C dropped
  assert.deepEqual(planRemovals(current, proposed).sort(), ["B", "C"]);
});

check("planRemovalBlocked: cannot un-plan a part that already has recorded usage (qtyUsed > 0)", () => {
  const current = [
    { partId: "A", qtyPlanned: 1, qtyUsed: 0 },
    { partId: "B", qtyPlanned: 2, qtyUsed: 1 }, // used -> blocked if removed
    { partId: "C", qtyPlanned: 1 },             // no usage -> removable
  ];
  const proposed = [{ partId: "A", qtyPlanned: 1 }]; // drops B and C
  assert.deepEqual(planRemovalBlocked(current, proposed), ["B"]); // only B is blocked
  // Keeping B in the plan clears the block.
  assert.deepEqual(planRemovalBlocked(current, [{ partId: "A", qtyPlanned: 1 }, { partId: "B", qtyPlanned: 2 }]), []);
});

// === plannability (client mirror of the server guard) ===

check("isPlanEditableStatus: terminal Work Order statuses are not editable", () => {
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    assert.equal(isPlanEditableStatus(status), false, status);
  }
});

check("isPlanEditableStatus: live statuses are editable", () => {
  for (const status of ["CREATED", "READY", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"]) {
    assert.equal(isPlanEditableStatus(status), true, status);
  }
});

check("isPlanEditableStatus: an absent/unknown status is NOT assumed terminal (the server decides)", () => {
  for (const status of [undefined, null, "", "   ", "SOME_FUTURE_STATUS"]) {
    assert.equal(isPlanEditableStatus(status), true, String(status));
  }
});

check("PLAN_TERMINAL_STATUSES stays in lockstep with the server's canonical TERMINAL_STATUSES", () => {
  // The client set is a MIRROR, not a second authority. Read the server source and assert the two
  // agree, so a change to functions/src/transitionEngine.ts fails HERE instead of silently letting
  // the UI offer an edit the command would refuse.
  const src = readFileSync(resolve(REPO_ROOT, "functions/src/transitionEngine.ts"), "utf8");
  const block = src.match(/TERMINAL_STATUSES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "could not locate TERMINAL_STATUSES in functions/src/transitionEngine.ts");
  const serverStatuses = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...PLAN_TERMINAL_STATUSES].sort(), serverStatuses);
});

// === snapshot projection ===

check("planLinesFromSnapshot: keeps PLANNED and USED distinct (never flattens one into the other)", () => {
  const lines = planLinesFromSnapshot([
    { partId: "A", sku: "SKU-A", name: "Filter", qtyPlanned: 3, qtyUsed: 1 },
    { partId: "B", sku: "SKU-B", name: "Belt", qtyPlanned: 2 },
  ]);
  assert.equal(lines[0].partId, "A");
  assert.equal(lines[0].qtyPlanned, 3);
  assert.equal(lines[0].qtyUsed, 1);
  assert.equal(lines[0].editable, true);
  assert.equal(lines[1].qtyUsed, 0);
  assert.equal(lines[1].qtyPlanned, 2);
});

check("planLinesFromSnapshot: a used-but-unplanned row survives (real consumption stays visible)", () => {
  const lines = planLinesFromSnapshot([{ partId: "A", sku: "SKU-A", qtyUsed: 2 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qtyPlanned, 0);
  assert.equal(lines[0].qtyUsed, 2);
});

check("planLinesFromSnapshot: rows without a canonical partId are KEPT but marked non-editable", () => {
  // They must never be hidden: the command replaces the whole plan, so a payload that quietly
  // omitted a legacy row would DELETE a real planned part.
  const lines = planLinesFromSnapshot([
    { sku: "LEGACY-ONLY", qtyPlanned: 5 },
    { partId: "   ", qtyPlanned: 1 },
    { partId: "A", qtyPlanned: 1 },
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.editable), [false, false, true]);
  assert.deepEqual(lines.map((l) => l.partId), [null, null, "A"]);
});

check("planHasUnresolvedLines: true when a PLANNED row has no canonical identity", () => {
  const legacyPlanned = planLinesFromSnapshot([{ sku: "LEGACY", qtyPlanned: 5 }]);
  assert.equal(planHasUnresolvedLines(legacyPlanned), true);

  // A legacy row with no planned quantity does not block planning -- there is nothing to lose.
  const legacyUsedOnly = planLinesFromSnapshot([{ sku: "LEGACY", qtyUsed: 2 }]);
  assert.equal(planHasUnresolvedLines(legacyUsedOnly), false);

  const clean = planLinesFromSnapshot([{ partId: "A", qtyPlanned: 1 }]);
  assert.equal(planHasUnresolvedLines(clean), false);
  assert.equal(planHasUnresolvedLines([]), false);
});

check("planLinesFromSnapshot: malformed input never throws and never fabricates a quantity", () => {
  assert.deepEqual(planLinesFromSnapshot(undefined), []);
  assert.deepEqual(planLinesFromSnapshot("not-an-array"), []);
  assert.equal(planLinesFromSnapshot([null, 42, "x"]).length, 0);
  const [line] = planLinesFromSnapshot([{ partId: "A", qtyPlanned: -3, qtyUsed: "2" }]);
  assert.equal(line.qtyPlanned, 0);
  assert.equal(line.qtyUsed, 0);
});

console.log(`\n${passed} passed, 0 failed`);
