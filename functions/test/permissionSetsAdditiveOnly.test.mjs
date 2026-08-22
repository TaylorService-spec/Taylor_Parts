// PERMISSION SETS ARE ADDITIVE ONLY -- they can grant, never revoke.
//
// Owner ruling 2026-08-20: "Permission sets can only give more access not take access
// away." An employee holds one Role as their baseline and any number of additional
// assignments as exceptions; the effective answer is the UNION.
//
// This is true today by construction rather than by rule: resolveEffectivePermission
// collects QUALIFYING assignments and allows if any one of them qualifies. There is no
// deny-list, no negative grant, and no precedence by which one assignment cancels
// another's. That is a security property worth pinning, because the natural-seeming
// "fix" the first time someone wants to withhold one capability from one person is to add
// a deny mechanism -- and a deny that can be attached per-principal is how an
// authorization model stops being auditable. If access must be removed, the Role or the
// set changes, and that change is visible to everyone holding it.
//
// Run: node --test test/permissionSetsAdditiveOnly.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";

const assignment = (roleId) => ({
  id: `assignment-${roleId}`,
  principalUid: "principal-1",
  roleId,
  scope: { type: "global" },
  grantedBy: "seed",
  grantedAt: { toMillis: () => 0 },
  status: "active",
  accessVersionAtGrant: 1,
});

const resolve = (permissionId, assignments, overrides = []) =>
  resolveEffectivePermission({
    permissionId,
    assignments,
    roles: GOVERNED_BUSINESS_ROLES,
    currentAccessVersion: 1,
    target: { scope: { type: "global" } },
    activationOverrides: new Set(overrides),
  });

// inventoryTransferOperator is a purpose-built bundle -- a permission set in all but
// name. salesperson is an ordinary job Role that holds none of its capabilities.
const TRANSFER = "inventory.transfer.create";
const BASELINE = "customer.record.read";

test("a permission set GRANTS what the baseline Role lacks", () => {
  assert.equal(resolve(TRANSFER, [assignment("salesperson")], [TRANSFER]).decision, "DENY");
  assert.equal(
    resolve(TRANSFER, [assignment("salesperson"), assignment("inventoryTransferOperator")], [TRANSFER]).decision,
    "ALLOW",
    "adding a set must grant its capabilities on top of the baseline Role",
  );
});

test("a permission set never REMOVES what the baseline Role holds", () => {
  const baselineAlone = resolve(BASELINE, [assignment("salesperson")]);
  assert.equal(baselineAlone.decision, "ALLOW");
  const withSet = resolve(BASELINE, [assignment("salesperson"), assignment("inventoryTransferOperator")]);
  assert.equal(
    withSet.decision,
    "ALLOW",
    "attaching a set that does not include a capability must not withdraw it from the baseline Role",
  );
});

test("order of assignments cannot change the answer -- union, not precedence", () => {
  // If any subtractive or precedence rule ever appeared, ordering would start to matter.
  // It must not: a union is commutative and an authorization answer that depends on the
  // order rows came back from a query is not auditable.
  const a = resolve(TRANSFER, [assignment("salesperson"), assignment("inventoryTransferOperator")], [TRANSFER]);
  const b = resolve(TRANSFER, [assignment("inventoryTransferOperator"), assignment("salesperson")], [TRANSFER]);
  assert.equal(a.decision, b.decision);
  assert.equal(a.decision, "ALLOW");
});

test("an INACTIVE set assignment contributes nothing, and still removes nothing", () => {
  const inactive = { ...assignment("inventoryTransferOperator"), status: "revoked" };
  assert.equal(
    resolve(TRANSFER, [assignment("salesperson"), inactive], [TRANSFER]).decision,
    "DENY",
    "a revoked set must stop granting",
  );
  assert.equal(
    resolve(BASELINE, [assignment("salesperson"), inactive]).decision,
    "ALLOW",
    "a revoked set must not disturb the baseline Role's own grants",
  );
});

test("stacking sets never produces a DENY that neither assignment would produce alone", () => {
  // The union property stated exhaustively over a sample of real ids: for every id, if
  // either assignment allows alone, the pair must allow. A single counter-example would
  // mean some subtractive path had been introduced.
  const SETS = ["inventoryTransferOperator", "inventoryCatalogAdministrator", "workOrderPartsPlanner", "crmActivityContributor"];
  const IDS = [BASELINE, TRANSFER, "inventory.catalog.manage", "workOrder.parts.plan", "crm.activity.read"];
  const overrides = IDS;
  for (const setId of SETS) {
    for (const id of IDS) {
      const alone = resolve(id, [assignment("salesperson")], overrides).decision;
      const setAlone = resolve(id, [assignment(setId)], overrides).decision;
      const together = resolve(id, [assignment("salesperson"), assignment(setId)], overrides).decision;
      if (alone === "ALLOW" || setAlone === "ALLOW") {
        assert.equal(together, "ALLOW", `${setId} + salesperson must ALLOW ${id} — one of them allows it alone`);
      }
    }
  }
});
