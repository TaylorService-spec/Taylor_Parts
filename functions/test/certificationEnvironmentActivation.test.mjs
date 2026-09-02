// THE demo-certworld ACTIVATION ENTRY, AND EVERYTHING IT MUST NOT REACH.
//
// ============================ WHAT WAS APPROVED, AND WHAT WAS NOT ============================
//
// Owner-approved 2026-08-22: the Certification World emulator may activate the capability families
// Pass 3 exercises, so the suite runs the REAL authorization path instead of a stub.
//
// What was NOT approved, and what these guards exist to keep true forever:
//   - production inheriting anything from this entry
//   - an unknown project inheriting anything
//   - `demo-anything-else` inheriting it by prefix
//   - the entry silently widening to capabilities Pass 3 does not exercise
//
// ============================ THE TWO SENTENCES THAT MATTER ============================
//
//   ENVIRONMENT ACTIVATION IS NOT A ROLE GRANT
//   AUTHORIZATION STILL REQUIRES ACTIVE CAPABILITY + EMPLOYEE EFFECTIVE AUTHORITY
//
// Activation only lifts the blanket `active:false` deny. A principal with no qualifying
// roleAssignment is still denied, and a test below proves it rather than asserting it.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY, SPINE_OVERRIDE_ELIGIBLE_IDS } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { PERMISSION_CATALOG } = await import(L("functions/lib/access/permissionCatalog.js"));

const CANONICAL = JSON.parse(readFileSync(path.resolve(REPO, "config/environments.json"), "utf8"));
const CERT_PROJECT = "demo-certworld";
const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

const PASS3_IDS = [
  "inventory.transfer.create", "inventory.transfer.dispatch",
  "inventory.transfer.receive", "inventory.transfer.cancel",
  "inventory.cycleCount.create", "inventory.cycleCount.submit",
  "inventory.cycleCount.reconcile", "inventory.cycleCount.cancel",
  "inventory.returns.intake",
];

// Serialized equipment forward lifecycle, Owner-authorized 2026-08-23. Kept as its own list rather
// than appended to PASS3_IDS: these are not Pass 3 capabilities, and folding them in would erase
// which decision authorized what. The exact-set assertion below is the UNION, so adding an id to
// either environment without adding it here still fails -- which is the property that matters.
const SERIALIZED_EQUIPMENT_IDS = [
  "inventory.serializedAsset.acquire",
  "equipment.install",
];

const CERT_ACTIVATED_IDS = [...PASS3_IDS, ...SERIALIZED_EQUIPMENT_IDS];

const sorted = (s) => [...s].sort();
const certOverrides = () => resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_PROJECT);

// ── The entry itself ──────────────────────────────────────────────────────────────────────────

test("demo-certworld activates exactly the authorized ids, and nothing else", () => {
  // An EXACT-SET assertion on purpose. A subset check would let a future edit quietly widen the
  // certification emulator's authority, and an emulator holding more than the sandbox models is a
  // worse model of the sandbox rather than a more capable one.
  assert.deepEqual(sorted(certOverrides()), [...CERT_ACTIVATED_IDS].sort());
});

test("the serialized equipment ids are activated in the SANDBOX too, and in production never", () => {
  // demo-certworld and eos-platform-sandbox are the two environments the Owner authorized, and no
  // others. Asserted here rather than only in the station suite because this file is where the
  // certification environment's activation set is pinned.
  const sandbox = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
  for (const id of SERIALIZED_EQUIPMENT_IDS) {
    assert.ok(certOverrides().has(id), `${id} not activated in ${CERT_PROJECT}`);
    assert.ok(sandbox.has(id), `${id} not activated in eos-platform-sandbox`);
  }
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts").size, 0);
});

test("the DEPLOYMENT registry deliberately does not know it", () => {
  // config/environments.json lists provisioned Firebase environments, and its project allow-list
  // is asserted to be exactly those -- on the stated grounds that each addition is a real project
  // that was really created. demo-certworld was not created and cannot be: the demo- prefix is
  // reserved by the emulator suite. Listing it there would make that invariant assert a falsehood,
  // so the entry lives in the runtime snapshot alone, exactly as local-emulator carries
  // firebase: null for the same reason.
  assert.equal(resolveCapabilityOverrides(CANONICAL, CERT_PROJECT).size, 0,
    "the deployment registry must not carry an unprovisioned project");
  assert.equal(CANONICAL.environments.some((e) => e.firebase?.projectId === CERT_PROJECT), false);
});

test("...which is precisely why the runtime snapshot is the one that carries it", () => {
  // The other half. If neither registry knew it, the certification suite would be back to a world
  // where every transfer, count and return denies for everyone.
  assert.ok(certOverrides().size > 0, "the snapshot must resolve it");
  assert.ok(ENVIRONMENT_ACTIVATION_REGISTRY.environments.some((e) => e.firebase?.projectId === CERT_PROJECT));
});

test("every activated id is genuinely eligible -- activation cannot invent authority", () => {
  // The third hard-block: declared ∩ eligible. An id that is not on the eligible allow-list is
  // dropped even when an environment declares it.
  for (const id of PASS3_IDS) {
    assert.ok(SPINE_OVERRIDE_ELIGIBLE_IDS.has(id), `${id} is not eligible for environment activation`);
  }
});

test("it is NARROWER than the sandbox, deliberately", () => {
  // The sandbox activates 33 ids across Sales, Finance, CRM and the scanner. A certification
  // environment holding broader authority than it exercises would be a worse model, not a safer one.
  const sandbox = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
  const cert = certOverrides();
  assert.ok(cert.size < sandbox.size, `cert ${cert.size} should be smaller than sandbox ${sandbox.size}`);
  for (const id of cert) {
    assert.ok(sandbox.has(id), `${id} is activated in certification but NOT in the sandbox it models`);
  }
});

// ── Everything it must not reach ──────────────────────────────────────────────────────────────

test("PRODUCTION inherits nothing", () => {
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts").size, 0);
  assert.equal(resolveCapabilityOverrides(CANONICAL, "taylor-parts").size, 0);
});

test("an UNKNOWN project inherits nothing", () => {
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "not-a-real-project").size, 0);
});

test("PREFIX MATCHING DOES NOT EXIST -- demo-foo inherits nothing", () => {
  // The failure mode a careless implementation would have: treating `demo-` as a trusted namespace.
  for (const near of ["demo-foo", "demo-certworld-2", "certworld", "demo", "demo-certworl", "Demo-Certworld"]) {
    assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, near).size, 0,
      `${near} must not inherit demo-certworld's activation`);
  }
});

test("a MISSING environment fails closed", () => {
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, null).size, 0);
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, undefined).size, 0);
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "").size, 0);
  assert.equal(resolveCapabilityOverrides(null, CERT_PROJECT).size, 0);
  assert.equal(resolveCapabilityOverrides({}, CERT_PROJECT).size, 0);
});

test("MUTATION: a production entry declaring these ids is STILL empty", () => {
  // The guard does not trust the data. Even if somebody pasted the certification override list onto
  // the production environment, the role-keyed block returns EMPTY without reading it.
  const poisoned = {
    environments: [
      { role: "production", firebase: { projectId: "taylor-parts" }, capabilityActivationOverrides: PASS3_IDS },
    ],
  };
  assert.equal(resolveCapabilityOverrides(poisoned, "taylor-parts").size, 0,
    "production activation must be impossible by CODE, not merely absent from the DATA");
});

test("MUTATION: removing the entry denies the certification environment again", () => {
  // Proves the entry is what is doing the work -- and shows exactly what Pass 3 looked like before it.
  const without = {
    environments: ENVIRONMENT_ACTIVATION_REGISTRY.environments.filter(
      (e) => e?.firebase?.projectId !== CERT_PROJECT),
  };
  assert.equal(resolveCapabilityOverrides(without, CERT_PROJECT).size, 0);
});

// ── Activation is not a grant ─────────────────────────────────────────────────────────────────

const permission = (id) => PERMISSION_CATALOG.find((p) => p.id === id);
const decide = (permissionId, roleIds, overrides) => resolveEffectivePermission({
  permissionId,
  assignments: roleIds.map((roleId, i) => ({
    id: `a${i}`, principalUid: "u1", roleId, status: "active",
    scope: { type: "global" }, accessVersionAtGrant: 1,
  })),
  roles: ROLE_CATALOG,
  currentAccessVersion: 1,
  target: GLOBAL_TARGET,
  activationOverrides: overrides,
});

test("the Pass 3 capabilities really are active:false -- activation is doing real work", () => {
  for (const id of PASS3_IDS) {
    assert.equal(permission(id)?.active, false, `${id} is not active:false; this entry would be pointless`);
  }
});

test("ENVIRONMENT ACTIVATION IS NOT A ROLE GRANT", () => {
  // Activated, and held by nobody. A principal with no qualifying role is denied for a DIFFERENT
  // reason than before -- noQualifyingGrant rather than inactivePermission -- and denied all the same.
  const out = decide("inventory.transfer.create", [], certOverrides());
  assert.equal(out.decision, "DENY");
  assert.notEqual(out.reason, "inactivePermission", "activation did lift the blanket deny...");
  assert.equal(out.reason, "noQualifyingGrant", "...and the grant requirement stands on its own");
});

test("a role that does not carry the capability is still denied", () => {
  // Holding SOME role is not holding THE role.
  const out = decide("inventory.transfer.create", ["salesperson"], certOverrides());
  assert.equal(out.decision, "DENY");
});

test("AUTHORIZATION STILL REQUIRES ACTIVE CAPABILITY + EMPLOYEE EFFECTIVE AUTHORITY", () => {
  // Both halves, each proven necessary by removing it.
  const withBoth = decide("inventory.transfer.create", ["inventoryTransferOperator"], certOverrides());
  assert.equal(withBoth.decision, "ALLOW");

  const noActivation = decide("inventory.transfer.create", ["inventoryTransferOperator"], undefined);
  assert.equal(noActivation.decision, "DENY");
  assert.equal(noActivation.reason, "inactivePermission", "the right role with no activation is still denied");

  const noGrant = decide("inventory.transfer.create", [], certOverrides());
  assert.equal(noGrant.decision, "DENY", "activation with no role is still denied");
});

test("MUTATION: dropping the transfer overrides denies a valid transfer operator", () => {
  const partial = new Set([...certOverrides()].filter((id) => !id.startsWith("inventory.transfer.")));
  const out = decide("inventory.transfer.create", ["inventoryTransferOperator"], partial);
  assert.equal(out.decision, "DENY");
  assert.equal(out.reason, "inactivePermission");
});

test("MUTATION: dropping the cycle-count overrides denies a valid counter and reconciler", () => {
  const partial = new Set([...certOverrides()].filter((id) => !id.startsWith("inventory.cycleCount.")));
  assert.equal(decide("inventory.cycleCount.submit", ["inventoryCycleCountCounter"], partial).decision, "DENY");
  assert.equal(decide("inventory.cycleCount.reconcile", ["inventoryCycleCountReconciler"], partial).decision, "DENY");
});

test("MUTATION: dropping the returns override denies a valid intake clerk", () => {
  const partial = new Set([...certOverrides()].filter((id) => id !== "inventory.returns.intake"));
  assert.equal(decide("inventory.returns.intake", ["inventoryReturnsIntakeClerk"], partial).decision, "DENY");
});

// ── Separation of duties, at the ROLE level ───────────────────────────────────────────────────

test("the counter role cannot reconcile, and the reconciler role cannot count", () => {
  // Structural, and therefore true of whoever holds them. Reconciling is what turns a claimed
  // variance into a real ledger adjustment; letting one principal do both means the person who
  // reports the discrepancy also approves the correction.
  const o = certOverrides();
  assert.equal(decide("inventory.cycleCount.submit", ["inventoryCycleCountCounter"], o).decision, "ALLOW");
  assert.equal(decide("inventory.cycleCount.reconcile", ["inventoryCycleCountCounter"], o).decision, "DENY");

  assert.equal(decide("inventory.cycleCount.reconcile", ["inventoryCycleCountReconciler"], o).decision, "ALLOW");
  assert.equal(decide("inventory.cycleCount.submit", ["inventoryCycleCountReconciler"], o).decision, "DENY");
});

test("the transfer role carries transfers and nothing adjacent", () => {
  const o = certOverrides();
  assert.equal(decide("inventory.transfer.create", ["inventoryTransferOperator"], o).decision, "ALLOW");
  assert.equal(decide("inventory.stock.receive", ["inventoryTransferOperator"], o).decision, "DENY");
  assert.equal(decide("inventory.cycleCount.reconcile", ["inventoryTransferOperator"], o).decision, "DENY");
});

// ============================================================================================
// CERT-CYCLE-11 — THE CYCLE-COUNT ACTIVATION, AND ITS DELIBERATE NARROWNESS.
//
// The G07 ceremony was blocked because inventory.cycleCount.* is registered active:false and the
// live certification environment activated nothing — the resolver answered "inactivePermission"
// ahead of any Role grant, so correctly-granted Counter and Reconciler principals were both DENIED.
//
// Owner ruling: activate THREE ids, not the family. The ceremony opens, submits and reconciles a
// count; it never cancels one. These tests pin the narrowness, because an activation list that
// quietly grows is how an environment ends up holding authority nobody approved.
// ============================================================================================
const CERT_LIVE_PROJECT = "eos-platform-certification";  // the LIVE project, not demo-certworld above
const CYCLE = {
  create: "inventory.cycleCount.create",
  submit: "inventory.cycleCount.submit",
  reconcile: "inventory.cycleCount.reconcile",
  cancel: "inventory.cycleCount.cancel",
};

test("CERT-CYCLE-11: certification activates EXACTLY the three ceremony capabilities", () => {
  const active = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_LIVE_PROJECT);
  const ids = [...active].sort();
  assert.deepEqual(ids, [CYCLE.create, CYCLE.reconcile, CYCLE.submit].sort(),
    "exactly three — an activation list is not a wish list");
});

test("CERT-CYCLE-11: cancel stays INACTIVE in certification", () => {
  const active = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_LIVE_PROJECT);
  assert.ok(!active.has(CYCLE.cancel),
    "the ceremony never cancels a count, so the authority to cancel one was not granted");
});

test("CERT-CYCLE-11: transfer and returns stay INACTIVE in certification", () => {
  const active = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_LIVE_PROJECT);
  for (const id of ["inventory.transfer.create", "inventory.transfer.dispatch",
    "inventory.transfer.receive", "inventory.transfer.cancel", "inventory.returns.intake"]) {
    assert.ok(!active.has(id), `${id} is a separate future decision and must not ride along`);
  }
  // The emulator DOES activate all three families; certification deliberately does not.
  const emulator = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "demo-certworld");
  assert.ok(emulator.has("inventory.transfer.create"),
    "the emulator entry is the contrast that makes certification's narrowness a choice");
});

test("CERT-CYCLE-11: production resolves EMPTY regardless of registry contents", () => {
  const prod = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");
  assert.equal(prod.size, 0, "no environment override may ever reach the customer project");
});

test("CERT-CYCLE-11: canonical config and embedded snapshot stay exact-parity", () => {
  const canonical = JSON.parse(readFileSync(path.resolve(REPO, "config/environments.json"), "utf8"));
  const list = canonical.environments ?? canonical;
  const cert = list.find((e) => e?.firebase?.projectId === CERT_LIVE_PROJECT);
  assert.ok(cert, "certification must exist in the canonical registry");
  assert.deepEqual([...(cert.capabilityActivationOverrides ?? [])].sort(),
    [...resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_LIVE_PROJECT)].sort(),
    "the JSON and the embedded TS registry must agree id for id");
});

test("CERT-CYCLE-11: the catalog posture is UNCHANGED — activation is the seam, not a catalog edit", () => {
  // permissionCatalog must still register every cycle-count id inactive. The override opens it for
  // ONE environment; flipping the catalog would open it everywhere at once.
  const byId = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));
  for (const id of Object.values(CYCLE)) {
    assert.equal(byId.get(id)?.active, false, `${id} must remain active:false in the catalog`);
  }
});

test("CERT-CYCLE-11: activation opens the family; ROLE still decides who may act", () => {
  // The load-bearing distinction. With the environment activating submit, a principal holding NO
  // qualifying Role is still DENIED — and the reason is no longer inactivePermission.
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const active = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_LIVE_PROJECT);
  const target = { scope: { type: "global" }, condition: {} };

  const noRole = resolveEffectivePermission({
    permissionId: CYCLE.submit, assignments: [], roles,
    currentAccessVersion: 1, target, activationOverrides: active,
  });
  assert.equal(noRole.decision, "DENY", "activation is not authorization");
  assert.notEqual(noRole.reason, "inactivePermission",
    "the denial must now come from the absence of a grant, not from the catalog");

  // And WITHOUT the activation the same holder of a correct Role is denied for the other reason.
  const counter = [{ id: "a1", principalUid: "u1", roleId: "inventoryCycleCountCounter",
    status: "active", accessVersion: 1 }];
  const unactivated = resolveEffectivePermission({
    permissionId: CYCLE.submit, assignments: counter, roles,
    currentAccessVersion: 1, target, activationOverrides: new Set(),
  });
  assert.equal(unactivated.decision, "DENY");
  assert.equal(unactivated.reason, "inactivePermission",
    "this is exactly the state that blocked the ceremony before this activation");
});

test("CERT-CYCLE-11: the Counter / Reconciler split is untouched by the activation", () => {
  const roles = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const counter = roles.inventoryCycleCountCounter;
  const reconciler = roles.inventoryCycleCountReconciler;
  assert.ok(counter && reconciler);
  // The person who reports a variance may not be the person who approves the adjustment.
  assert.ok(counter.permissions.includes(CYCLE.create) && counter.permissions.includes(CYCLE.submit));
  assert.ok(!counter.permissions.includes(CYCLE.reconcile), "a counter may not settle its own count");
  assert.deepEqual([...reconciler.permissions], [CYCLE.reconcile],
    "a reconciler may only reconcile — it cannot open or submit a count of its own");
});
