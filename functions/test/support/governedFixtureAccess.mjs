// TEST HARNESS -- governed access for suites that drive a callable end to end (Pass 11 Fix Wave 1).
//
// In the governed environment (GCLOUD_PROJECT = eos-platform-sandbox) the runtime asks PostgreSQL Administration who a
// caller is. The Firestore-emulator suites have no policy database, so without this every governed decision would be
// UNAVAILABLE -> DENY, and a suite that seeds "this principal holds Security Role X" would silently start asserting an
// outage instead of the behaviour it was written for.
//
// This does NOT keep the legacy authority alive. It answers the governed question the way Administration would for the
// fixture: a principal whose fixture assigns Security Role X holds EXACTLY the pinned Administration baseline grants
// of Role X (src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json -- the 415 grants the PostgreSQL suites prove
// equal to nonprod), nothing from the code-defined compatibility Roles. The governed catalog is the baseline's
// capability keys plus the registered-but-unheld keys. A role key the baseline does not know grants nothing.
//
// It is installed through the test-only seam __setGovernedAccessResolverForTest, which changes where governed access
// is read from and never whether governed authority applies or how a decision is taken.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { __setGovernedAccessResolverForTest } = require("../../lib/access/governedRuntimeAuthority.js");

const BASELINE = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json"), "utf8"));

/** Registered in eos_policy.capabilities but granted to no Role (measured 2026-09-27: 82 = 74 granted + these 8). */
export const REGISTERED_UNHELD_CAPABILITY_KEYS = Object.freeze([
  "admin.employeeFunctionalRole.write",
  "inventory.workOrderConsumption.record",
  "reorder.request.read.queue",
  "workflowDefinition.bindRole",
  "workflowDefinition.create",
  "workflowDefinition.edit",
  "workflowDefinition.publish",
  "workflowDefinition.version",
]);

export const GOVERNED_CATALOG_KEYS = Object.freeze(new Set([
  ...BASELINE.grants.map((g) => g.capabilityKey),
  ...REGISTERED_UNHELD_CAPABILITY_KEYS,
]));

const grantsByRole = new Map();
for (const { roleKey, capabilityKey } of BASELINE.grants) {
  if (!grantsByRole.has(roleKey)) grantsByRole.set(roleKey, new Set());
  grantsByRole.get(roleKey).add(capabilityKey);
}

/** The governed flat set for a set of Security Role keys, from the pinned baseline only. */
export function baselineCapabilitiesFor(roleKeys) {
  const out = new Set();
  for (const k of roleKeys) for (const c of grantsByRole.get(k) ?? []) out.add(c);
  return out;
}

/**
 * A governed resolver over the fixture's own Security Role assignments (the `roleAssignments` documents the suite
 * seeds: principalUid + roleId + status "active"). Returns RESOLVED with the baseline grants of those Roles.
 */
export function fixtureGovernedAccessResolver(db) {
  return async (uid) => {
    const snap = await db.collection("roleAssignments").where("principalUid", "==", uid).where("status", "==", "active").get();
    const roleKeys = snap.docs.map((d) => d.get("roleId")).filter((r) => typeof r === "string");
    const capabilities = baselineCapabilitiesFor(roleKeys);
    return Object.freeze({
      status: "RESOLVED",
      tenantId: "fixture-tenant",
      principalId: `fixture-${uid}`,
      governedKeys: GOVERNED_CATALOG_KEYS,
      actor: Object.freeze({
        tenantId: "fixture-tenant",
        principalId: `fixture-${uid}`,
        capabilities,
        conditionallyHeld: new Set(),
        scopedHeld: [],
        entitlements: async () => Object.freeze([]),
      }),
      reader: {
        linkedEmployeeId: async () => null,
        hasWorkEligibility: async () => false,
        hasOperationalScope: async () => false,
        isAssignedEmployee: async () => false,
      },
    });
  };
}

/** Install for the current process; returns an uninstall function for `t.after`/`after`. */
export function installGovernedFixtureAccess(db) {
  __setGovernedAccessResolverForTest(fixtureGovernedAccessResolver(db));
  return () => __setGovernedAccessResolverForTest(null);
}
