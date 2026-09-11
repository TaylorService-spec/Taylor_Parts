"use strict";
// ████████████████████████████ TEMPORARY, MIGRATION_ONLY ████████████████████████████
//
// THE INVENTORY-AUTHORITY CAPABILITY PARITY HARNESS. It exists to be DELETED.
//
// P1A, step 2 of docs/design/eos-operational-data-plane-inventory-authority-cutover.md: for a
// given tenant and principal, does the LEGACY Firestore-era authorization decision for one of the
// 8 inventory-authority writer operations equal what eos_policy's principal -> assignment -> role
// -> role_capabilities chain would decide.
//
// ════════════════════ WHY THIS FILE LIVES HERE, NOT UNDER functions/src ════════════════════
//
// scripts/firebaseExitGuard.mjs fences NEW `firebase-admin/firestore` dependencies added under
// functions/src (docs/architecture/firebase-exit-baseline.json is a floor that may only shrink --
// see the ratchet doc). This harness genuinely needs to read Firestore
// (`roleAssignments`, `users/{uid}.accessVersion`, `users/{uid}.role`) to prove migration parity
// against the SAME legacy data every writer's live authorization check reads today. Rather than
// adding a new baseline entry -- which the P1A brief explicitly forbids, to keep the ratchet's
// "no new business-runtime dependency" guarantee airtight -- this tool lives in functions/scripts/,
// which is operator-run tooling, is never bundled into the deployed Cloud Functions runtime, and is
// OUTSIDE both of the guard's scan roots (functions/src, field-ops-app-vite/src). It is INERT on
// require: nothing executes merely because this file is imported; only `main()` under
// `require.main === module` touches Firestore or PostgreSQL.
//
// ════════════════════ WHAT IT IS FOR ════════════════════
//
// Six of the eight writers check a capability string through `resolveEffectivePermission` against
// Firestore `roleAssignments` + `users/{uid}.accessVersion` -- the exact mechanism
// functions/src/adminPolicy/migration/firestorePolicyParityHarness.ts already proves for role
// ASSIGNMENTS; this harness proves the further step of CAPABILITY resolution for these particular
// operations. The other two (`inventory.workOrderConsumption.record`,
// `workOrder.lifecycle.{dispatch,cancel,complete}`) check a hardcoded `users/{uid}.role` string
// instead -- there is no legacy capability string for them at all, only a Role. Both legacy shapes
// are reproduced here exactly, by requiring the SAME compiled resolver/catalog modules the live
// writers themselves import (lib/access/resolveEffectivePermission.js,
// lib/access/compatibilityRoles.js, lib/access/governedBusinessRoles.js,
// lib/access/environmentCapabilityOverrides.js), so the "LEGACY RESULT" reported here is provably
// the same decision production makes today, not a re-derived approximation of it.
//
// ════════════════════ WHAT IT MUST NEVER BECOME ════════════════════
//
//   NOT a dual read. Nothing in the running system requires this file.
//   NOT a fallback. It never returns Firestore data AS eos_policy's answer.
//   NOT a writer. No write path into either store -- this module never calls .set/.add/.update/
//   .delete/.create against Firestore, and never writes to eos_policy.
//
// ════════════════════ ITS DELETION CONDITION ════════════════════
//
// Delete this file (and its test, test/inventoryCapabilityParityHarness.test.mjs) when:
//
//   1. every tenant reports CAPABILITY_PARITY_READY (buildInventoryCapabilityParityReport's
//      `capabilityParityReady`), and
//   2. the eight writers' authorization has been re-pointed at eos_policy (step 4/8 of the cutover
//      document -- NOT this packet's job), and
//   3. the legacy Firestore capability checks it reads (roleAssignments, users/{uid}.accessVersion,
//      users/{uid}.role) are no longer read by anything in production.
const { resolveEffectivePermission } = require("../lib/access/resolveEffectivePermission.js");
const { resolveRuntimeCapabilityOverrides } = require("../lib/access/environmentCapabilityOverrides.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const {
  resolvePrincipalContext,
  PrincipalContextError,
  FIREBASE_IDENTITY_PROVIDER,
} = require("../lib/adminPolicy/principalContext.js");
const { capabilitiesForRoleKeys, listCapabilityKeys } = require("../lib/eosOps/capabilityAuthority.js");
const { WRITER_CAPABILITY_CENSUS } = require("../lib/eosOps/migration/inventoryWriterCapabilityCensus.js");

// The legacy resolver's target is GLOBAL scope for every one of these writers -- none is scoped
// narrower (ownAssignment/location/businessUnit/etc). Confirmed by direct read of every wiring
// file's `makeResolve*PermissionThroughTxn` (functions/src/inventoryTransfer/
// transferCallableWiring.ts and its siblings), which all pass `{ scope: { type: "global" },
// condition: {} }`.
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const LEGACY_ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {object} op one entry of WRITER_CAPABILITY_CENSUS
 * @param {string} subject the Firebase UID
 * @returns {Promise<{allow: boolean}>}
 */
async function legacyDecisionForPrincipal(db, op, subject) {
  const userSnap = await db.collection("users").doc(subject).get();
  const userData = userSnap.exists ? userSnap.data() : undefined;

  if (op.kind === "HARDCODED_ROLE") {
    const role = typeof (userData && userData.role) === "string" ? userData.role : null;
    const allow = role !== null && (op.legacyRoles || []).includes(role);
    return { allow };
  }

  const accessVersion = typeof (userData && userData.accessVersion) === "number" ? userData.accessVersion : 0;
  const assignmentsSnap = await db
    .collection("roleAssignments")
    .where("principalUid", "==", subject)
    .where("status", "==", "active")
    .get();
  const assignments = assignmentsSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

  const capabilityKey = op.legacyCapabilityKey || op.capabilityKey;
  const result = resolveEffectivePermission({
    permissionId: capabilityKey,
    assignments,
    roles: LEGACY_ROLE_CATALOG,
    currentAccessVersion: accessVersion,
    target: GLOBAL_TARGET,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });
  return { allow: result.decision === "ALLOW" };
}

/**
 * @param {import("../lib/adminPolicy/policyRepository.js").PolicyReader} reader
 * @param {import("pg").Pool} pool
 * @param {string} tenantId
 * @param {string} subject
 * @param {string} capabilityKey
 * @param {ReadonlySet<string>} capabilityCatalogKeys
 */
async function targetDecisionForPrincipal(reader, pool, tenantId, subject, capabilityKey, capabilityCatalogKeys) {
  try {
    const ctx = await resolvePrincipalContext(reader, {
      identityProvider: FIREBASE_IDENTITY_PROVIDER,
      externalSubject: subject,
      requestedTenantId: tenantId,
    });
    const capabilities = await capabilitiesForRoleKeys(pool, ctx.tenantId, ctx.heldRoleKeys);
    return {
      allow: capabilities.has(capabilityKey),
      refusal: null,
      heldRoleKeys: ctx.heldRoleKeys,
      hadStaleAssignment: ctx.hadStaleAssignment,
      capabilityKnownInCatalog: capabilityCatalogKeys.has(capabilityKey),
    };
  } catch (err) {
    if (err instanceof PrincipalContextError) {
      return {
        allow: false,
        refusal: err.refusal,
        heldRoleKeys: [],
        hadStaleAssignment: false,
        capabilityKnownInCatalog: capabilityCatalogKeys.has(capabilityKey),
      };
    }
    throw err;
  }
}

function classify(legacyAllow, target) {
  // A stated foreign tenant MUST be refused regardless of what the tenant-agnostic legacy check
  // said -- this is the harness affirmatively proving the spoof attempt is refused, the desired
  // security property, never evidence of a migration gap.
  if (target.refusal === "TENANT_NOT_A_MEMBERSHIP") return { parity: "PASS", reason: "SPOOFED_TENANT_REFUSAL" };

  if (legacyAllow === target.allow) return { parity: "PASS", reason: "NONE" };

  if (target.refusal === "UNKNOWN_PRINCIPAL") return { parity: "FAIL", reason: "MISSING_PRINCIPAL_MAPPING" };
  if (target.refusal === "PRINCIPAL_DISABLED") return { parity: "FAIL", reason: "DISABLED_PRINCIPAL" };
  if (
    target.refusal === "NO_TENANT_MEMBERSHIP" ||
    target.refusal === "AMBIGUOUS_TENANT" ||
    target.refusal === "TENANT_NOT_ACTIVE"
  ) {
    return { parity: "FAIL", reason: "MISSING_ACTIVE_ASSIGNMENT" };
  }

  if (legacyAllow && !target.allow) {
    if (!target.capabilityKnownInCatalog) return { parity: "FAIL", reason: "MISSING_CAPABILITY_CATALOG_ENTRY" };
    if (target.hadStaleAssignment) return { parity: "FAIL", reason: "DISABLED_ASSIGNMENT" };
    if (target.heldRoleKeys.length === 0) return { parity: "FAIL", reason: "MISSING_ROLE" };
    return { parity: "FAIL", reason: "MISSING_ROLE_CAPABILITY_GRANT" };
  }

  if (!legacyAllow && target.allow) return { parity: "FAIL", reason: "EXTRA_POSTGRES_GRANT" };

  return { parity: "FAIL", reason: "CAPABILITY_KEY_MISMATCH" };
}

/**
 * Compare LEGACY vs eos_policy for one tenant, across every principal subject supplied and every
 * writer operation in the census. READ ONLY, both sides -- no write path exists in this function.
 *
 * @param {import("../lib/adminPolicy/policyRepository.js").PolicyReader} reader
 * @param {import("pg").Pool} pool
 * @param {string} tenantId
 * @param {readonly string[]} principalSubjects
 * @param {{db?: import("firebase-admin/firestore").Firestore}} [deps]
 */
async function buildInventoryCapabilityParityReport(reader, pool, tenantId, principalSubjects, deps) {
  const opts = deps || {};
  const db = opts.db || require("firebase-admin/firestore").getFirestore();
  const capabilityCatalogKeys = await listCapabilityKeys(pool);

  const rows = [];
  const sortedSubjects = [...principalSubjects].sort();
  for (const subject of sortedSubjects) {
    for (const op of WRITER_CAPABILITY_CENSUS) {
      const legacy = await legacyDecisionForPrincipal(db, op, subject);
      const target = await targetDecisionForPrincipal(reader, pool, tenantId, subject, op.capabilityKey, capabilityCatalogKeys);
      const { parity, reason } = classify(legacy.allow, target);
      rows.push({
        tenantId,
        principalSubject: subject,
        operationKey: op.operationKey,
        legacyCapability: op.legacyCapabilityKey || `(role: ${(op.legacyRoles || []).join("|")})`,
        legacyAllow: legacy.allow,
        eosPolicyCapability: op.capabilityKey,
        eosPolicyAllow: target.allow,
        parity,
        reason,
      });
    }
  }

  const passed = rows.filter((r) => r.parity === "PASS").length;
  const failed = rows.length - passed;
  const hasUnresolvedIdentity = rows.some((r) => r.reason === "MISSING_PRINCIPAL_MAPPING" || r.reason === "DISABLED_PRINCIPAL");
  const hasUnresolvedRoleOrCatalog = rows.some((r) => r.reason === "MISSING_ROLE" || r.reason === "MISSING_CAPABILITY_CATALOG_ENTRY");

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    rows,
    summary: { compared: rows.length, passed, failed },
    inParity: failed === 0,
    capabilityParityReady: failed === 0 && rows.length > 0 && !hasUnresolvedIdentity && !hasUnresolvedRoleOrCatalog,
  };
}

/** A short human summary, for an operator running this by hand. */
function describeCapabilityParity(report) {
  const s = report.summary;
  return [
    `tenant ${report.tenantId} @ ${report.generatedAt}`,
    `  operations compared     ${s.compared}`,
    `  passed                  ${s.passed}`,
    `  failed                  ${s.failed}`,
    `  => ${report.capabilityParityReady ? "CAPABILITY_PARITY_READY" : "NOT READY -- do not switch runtime authorization"}`,
    ...report.rows
      .filter((r) => r.parity === "FAIL")
      .map((r) => `    FAIL ${r.principalSubject} / ${r.operationKey}: ${r.reason} (legacy=${r.legacyAllow} eos_policy=${r.eosPolicyAllow})`),
  ].join("\n");
}

module.exports = {
  legacyDecisionForPrincipal,
  targetDecisionForPrincipal,
  classify,
  buildInventoryCapabilityParityReport,
  describeCapabilityParity,
};

if (require.main === module) {
  // Operator CLI: node scripts/inventoryCapabilityParityHarness.js --tenant <id> --subject <uid> [--subject <uid> ...]
  // Requires `npm run build` first (reads compiled lib/), POLICY_TEST_DATABASE_URL or an
  // equivalent connection string wired through the standard policyDatabase config, and a live
  // Firestore credential (GOOGLE_APPLICATION_CREDENTIALS / ADC).
  (async () => {
    const { getPolicyDatabasePool } = require("../lib/adminPolicy/policyDatabase.js");
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    const args = process.argv.slice(2);
    const tenantIndex = args.indexOf("--tenant");
    if (tenantIndex === -1 || !args[tenantIndex + 1]) throw new Error("--tenant <id> is required");
    const tenantId = args[tenantIndex + 1];
    const subjects = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--subject" && args[i + 1]) subjects.push(args[i + 1]);
    }
    if (subjects.length === 0) throw new Error("at least one --subject <uid> is required");

    const pool = getPolicyDatabasePool();
    const reader = new PostgresPolicyRepository(pool);
    const report = await buildInventoryCapabilityParityReport(reader, pool, tenantId, subjects);
    // eslint-disable-next-line no-console
    console.log(describeCapabilityParity(report));
    process.exitCode = report.capabilityParityReady ? 0 : 1;
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}

