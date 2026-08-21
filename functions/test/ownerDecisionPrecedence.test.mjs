// RECORDED OWNER DECISIONS OUTRANK THE BUSINESS-INTENT MATRIX.
// Run: node --test test/ownerDecisionPrecedence.test.mjs
//
// ============================ WHY THIS EXISTS ============================
//
// During the reconciliation I granted inventory.stock.receive to General Manager, Warehouse Manager
// and Warehouse Associate, because the canonical matrix grants them Receiving CRE/RE. That mapping is
// semantically CORRECT -- "Receiving" really is inventory.stock.receive -- so none of the semantic
// mapping guards had anything to say about it.
//
// It was still wrong. An explicit governance gate confines that capability to admin + dispatcher
// (+ owner by composition), and the sandbox scanner scenarios verify the refusals it produces. The
// failure was one of PRECEDENCE, not semantics: a spreadsheet row silently overriding a decision.
//
// The semantic guards and this one catch different things, and the difference matters:
//   semantic  -- "this capability does not govern that business action"
//   precedence -- "that capability is correct for the action, and someone already decided who holds it"
//
// The precedence order (Owner ruling 2026-08-21):
//   1. explicit Owner governance decision
//   2. canonical reconciled business-intent matrix
//   3. historical/current implementation
//   4. stale or generated summaries
import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

const ALL = { ...GOVERNED_BUSINESS_ROLES, ...COMPATIBILITY_ROLES };
const holdersOf = (cap) =>
  Object.entries(ALL).filter(([, r]) => (r.permissions || []).includes(cap)).map(([id]) => id).sort();

// Capabilities whose holder set is fixed by a recorded decision rather than by the matrix. Each entry
// names the decision, so a future change has to argue with the decision instead of with this file.
const DECIDED_HOLDERS = [
  {
    capability: "inventory.stock.receive",
    holders: ["admin", "dispatcher", "owner"],
    decision:
      "EI Phase-2 Receiving capability grant gate. Granted to EXACTLY the admin and dispatcher " +
      "compatibility Roles, with owner inheriting by composition (OWNER_PERMISSIONS is a superset of " +
      "ADMIN_ROLE). No operational role, no wildcard, no PARTS_ASSOCIATE bypass. The canonical matrix " +
      "grants Receiving to General Manager, Warehouse Manager and Warehouse Associate; that conflict " +
      "is logged as MATRIX_OWNER_DECISION_CONFLICT and resolved in favour of the recorded decision.",
  },
  {
    capability: "crm.activity.create",
    holders: ["admin", "crmActivityContributor", "owner"],
    decision:
      "Owner ruling 2026-08-19 confining CRM activity to the purpose-built contributor Role plus " +
      "admin/owner. The matrix grants nearly every role Contacts CR; mapping that to crm.activity.* " +
      "would have reversed the ruling by spreadsheet column.",
  },
];

for (const entry of DECIDED_HOLDERS) {
  test(`${entry.capability} is held by exactly the roles a recorded decision names`, () => {
    assert.deepEqual(
      holdersOf(entry.capability), entry.holders.slice().sort(),
      `${entry.capability} holder set is fixed by a recorded Owner decision, not by the business-intent ` +
      `matrix.\n\nDECISION: ${entry.decision}\n\nIf the matrix should now supersede it, that is an Owner ` +
      `ruling to make explicitly -- change this entry and say why, rather than letting a regenerated ` +
      `role definition widen it silently.`,
    );
  });
}

test("the precedence list itself is not silently emptied", () => {
  // A guard whose data can be deleted is a guard that can be disabled without touching its logic.
  assert.ok(DECIDED_HOLDERS.length >= 2, "recorded-decision entries must not be removed to make a change pass");
  for (const e of DECIDED_HOLDERS) {
    assert.ok(e.decision && e.decision.length > 80, `${e.capability} must carry the decision it rests on`);
    assert.ok(e.holders.length > 0, `${e.capability} must name its holders`);
  }
});
