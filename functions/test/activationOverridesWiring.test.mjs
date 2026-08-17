// Per-environment activation must reach the COMMAND authorization path, not just the read feed.
//
// THE DEFECT THIS PINS. Every inventory.transfer.* and inventory.cycleCount.* id is registered
// active:false, which resolveEffectivePermission treats as an unconditional DENY *ahead of* any Role
// grant. The transfer and cycle-count callable wirings called that resolver WITHOUT passing
// activationOverrides, so both command families were permanently unreachable: a principal could hold
// the governed Role, the environment could activate the capability, the effective-access FEED could
// answer ALLOW -- and the command would still refuse with inactivePermission.
//
// Live evidence: warehouseManager held inventoryTransferOperator, resolveEffectiveAccessCallable
// returned inventory.transfer.create = true, and createTransferOrder answered PERMISSION_DENIED.
//
// The feed and the command must agree. A capability the feed says you have, and the command says you
// do not, is worse than either answer alone -- the UI offers an action that always fails.
//
// Run: node --test functions/test/activationOverridesWiring.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import {
  resolveCapabilityOverrides,
  ENVIRONMENT_ACTIVATION_REGISTRY,
} from "../lib/access/environmentCapabilityOverrides.js";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const SANDBOX = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

const assignment = (roleId) => [{
  id: `a-${roleId}`, principalUid: "p1", roleId,
  scope: { type: "global" }, status: "active", accessVersionAtGrant: 1,
}];

const decide = (permissionId, roleId, overrides) =>
  resolveEffectivePermission({
    permissionId,
    assignments: assignment(roleId),
    roles: ROLES,
    currentAccessVersion: 1,
    target: GLOBAL_TARGET,
    activationOverrides: overrides,
  });

// ---- the behaviour the wiring depends on ------------------------------------------------------
test("WITHOUT activation overrides a granted transfer capability still DENIES -- the bug's mechanism", () => {
  const r = decide("inventory.transfer.create", "inventoryTransferOperator", undefined);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "inactivePermission");
});

test("WITH the sandbox overrides the same grant ALLOWS", () => {
  const r = decide("inventory.transfer.create", "inventoryTransferOperator", SANDBOX);
  assert.equal(r.decision, "ALLOW");
});

test("cycle count behaves identically -- both halves of the split", () => {
  assert.equal(decide("inventory.cycleCount.submit", "inventoryCycleCountCounter", undefined).reason, "inactivePermission");
  assert.equal(decide("inventory.cycleCount.submit", "inventoryCycleCountCounter", SANDBOX).decision, "ALLOW");
  assert.equal(decide("inventory.cycleCount.reconcile", "inventoryCycleCountReconciler", SANDBOX).decision, "ALLOW");
});

// ---- activation is not authorization ----------------------------------------------------------
test("activation alone grants nothing -- a principal without the Role is still denied", () => {
  // This is the property that makes passing overrides safe: it lifts the blanket active:false gate
  // and nothing else. Every Role/Scope check still runs.
  const r = decide("inventory.transfer.create", "technician", SANDBOX);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

test("segregation of duties survives activation -- counter still cannot reconcile", () => {
  const r = decide("inventory.cycleCount.reconcile", "inventoryCycleCountCounter", SANDBOX);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

test("activation does not bleed across families", () => {
  assert.equal(decide("inventory.cycleCount.create", "inventoryTransferOperator", SANDBOX).reason, "noQualifyingGrant");
  assert.equal(decide("inventory.transfer.create", "inventoryCycleCountCounter", SANDBOX).reason, "noQualifyingGrant");
});

// ---- the wiring actually passes it ------------------------------------------------------------
// A source assertion rather than a behavioural one: these resolvers run inside a Firestore
// transaction against live collections, so the cheap, honest guard against the regression coming
// back is to require the argument to be present at the call site at all.
for (const file of [
  "src/inventoryTransfer/transferCallableWiring.ts",
  "src/cycleCount/cycleCountCallableWiring.ts",
]) {
  test(`${file} passes activationOverrides into resolveEffectivePermission`, () => {
    const src = readFileSync(resolvePath(ROOT, file), "utf8");
    assert.match(src, /resolveEffectivePermission\(\{[\s\S]*?activationOverrides:\s*resolveRuntimeCapabilityOverrides\(\)[\s\S]*?\}\)/);
  });
}
