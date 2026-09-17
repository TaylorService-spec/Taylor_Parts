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
// functions/src/adminPolicy/migration/roleAssignmentCensus.ts (successor to the former parity harness) censuses for role
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
// ════════════════════ DENY/DENY IS NOT READINESS (vacuity fix) ════════════════════
//
// `classify()` once compared `legacyAllow === target.allow` BEFORE inspecting any refusal, so
// "denied by both sides" scored a PASS with reason "NONE", and the unresolved-identity guards only
// read reasons that are set on FAIL rows. MEASURED at baseline 64008d5ae0bdd9532909671b15a91122400accf1:
// a principal holding NONE of the eighteen census capabilities reported 18/18 PASS ->
// CAPABILITY_PARITY_READY = true; so did a principal ABSENT FROM eos_policy ENTIRELY; so did a
// tenant in which NOT ONE capability was even DEFINED. Since `capabilityParityReady` is documented
// condition 1 below for deleting this harness and re-pointing eight writers' authorization, a
// principal with no permissions at all could certify the cutover.
//
// It is not a corner case. Thirteen of the fourteen CAPABILITY_CATALOG census capabilities are
// registered `active: false`, so with no environment activation override in force the legacy
// resolver refuses them for EVERY principal -- every one of those rows is a deny/deny by default.
// `inventory.stock.receive` is the ONE census capability carrying no `active:false` flag; resolved
// through the shipped resolver it is held by exactly four Roles -- admin, dispatcher, owner and the
// purpose-built inventoryReceivingClerk -- which is why it, with a NON-ADMIN principal, is the
// capability the reachability proofs use.
//
// Per Owner ruling G0-2 there are now THREE verdicts (PASS / FAIL / OBSERVATION) and TWO separately
// visible axes on the report (`inParity` and `reachabilityProven`), and readiness requires at least
// one NON-VACUOUS pass. See `classify` below.
//
// A LATENT DISCREPANCY THE VACUOUS PASS WAS HIDING, surfaced by this fix and left BLOCKING on
// purpose: `inventory.cycleCount.close` -- a census capability this harness compares, recorded as
// "already migrated (migration 004, P0)" -- does NOT EXIST in the legacy access/permissionCatalog.ts
// at all, so the legacy resolver answers `unknownPermission` (DENY) for every principal forever.
// Measured over the full census with a fully-provisioned admin and eos_policy granted exactly what
// legacy allows: 3 PASS, 0 FAIL, 15 OBSERVATION, and the only readiness blocker is that one row
// (DENY_DENY_CAPABILITY_NOT_DEFINED_IN_LEGACY). Under the old logic that same tenant read 18/18 PASS
// -> CAPABILITY_PARITY_READY, with fifteen of the eighteen rows carrying no evidence at all. Until
// either the legacy catalog gains the id or the census entry is corrected, no tenant reports
// CAPABILITY_PARITY_READY over the full census -- which is the correct, conservative answer to an
// unreconciled DEFINITION-layer discrepancy, not a regression.
//
// ════════════════════ OWNER QUESTION (open, implemented CONSERVATIVELY) ════════════════════
//
// Owner ruling G0-2 sets the readiness bar at: explicit activation, explicit role grant, explicit
// principal assignment, expected ALLOW demonstrated, expected DENY demonstrated, environment
// isolation, no production inheritance. THREE of those are not observable from the contents of the
// two stores this harness compares, and "expected DENY" needs a per-row EXPECTATION this harness's
// input shape (tenant + subject list) does not carry. TWO QUESTIONS FOR THE OWNER:
//
//   Q1. EVIDENCE STANDARD. Should `capabilityParityReady` mean "every readiness requirement in G0-2
//       is met" -- which requires giving this harness expected ALLOW/DENY inputs per row, and an
//       out-of-band attestation for isolation and production non-inheritance -- or should it keep
//       meaning only "the parity evidence this harness can produce is clean and non-vacuous"?
//   Q2. WHAT THE PREDICATE GATES. Condition 1 below spends `capabilityParityReady` as the authority
//       to DELETE this harness and re-point eight writers. If Q1 is answered "parity evidence only",
//       condition 1 must name the out-of-band evidence too, rather than resting on this boolean.
//
// IMPLEMENTED PENDING THAT RULING, the conservative reading of both: the predicate gates on what
// the harness can actually prove (parity clean, reachability demonstrated, identity and definitions
// resolved) and the report carries `readinessEvidenceGaps`, which NAMES every G0-2 requirement it
// does not evidence, so the boolean cannot be mistaken for the whole bar. Nothing was decided
// silently and nothing was loosened.
//
// ════════════════════ ITS DELETION CONDITION ════════════════════
//
// Delete this file (and its tests, test/inventoryCapabilityParityHarness.test.mjs and
// test/inventoryCapabilityParityHarnessVacuity.test.mjs) when:
//
//   1. every tenant reports CAPABILITY_PARITY_READY (buildInventoryCapabilityParityReport's
//      `capabilityParityReady`) AND the `readinessEvidenceGaps` that report names have been
//      satisfied out of band -- the boolean alone is NOT the whole of G0-2's bar (Owner Q1/Q2
//      above, unanswered), and
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
    return { allow, reason: allow ? null : role === null ? "noLegacyRole" : "roleNotAccepted" };
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
  // The resolver's own DENY reason is CARRIED, not discarded. It is the only thing that can tell
  // "denied because the capability is not ACTIVATED in this environment" (`inactivePermission`,
  // which resolveEffectivePermission decides BEFORE it ever looks at a grant) apart from "denied
  // because no Role grants it" (`noQualifyingGrant`). Owner ruling G0-2 requires those two to be
  // separately named; without this reason they are indistinguishable downstream.
  return { allow: result.decision === "ALLOW", reason: result.decision === "ALLOW" ? null : result.reason || null };
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

// ════════════════════ PARITY OBSERVATION vs PROOF OF REACHABILITY ════════════════════
//
// Owner ruling G0-2 (the specification for this classifier): keep CAPABILITY DEFINITION,
// ENVIRONMENT/TENANT ACTIVATION, ROLE GRANT, PRINCIPAL ASSIGNMENT and CONTEXTUAL BUSINESS
// AUTHORITY distinct, because
//
//     DEFINED + ACTIVATED + ROLE GRANTED + PRINCIPAL ASSIGNED + CONTEXT AUTHORITY = AUTHORIZED USE
//
// and therefore: **DENY on both sides MAY be recorded as a PARITY OBSERVATION. It is NOT proof of
// reachability.** Both stores agreeing that nobody may do something is a true statement about
// parity and says NOTHING about whether the migrated capability works. A principal holding none of
// the census capabilities agrees with eos_policy on every row; so does a principal that does not
// exist; so does a tenant in which no capability is even DEFINED. Scoring those as PASS -- which
// this function did until the vacuity fix -- let a wholly unprovisioned tenant certify the cutover.
//
// So there are THREE verdicts, not two:
//
//   PASS        an ALLOW on both sides (reachability DEMONSTRATED), or an affirmative refusal the
//               harness itself provoked and expected (the spoofed-tenant proof).
//   FAIL        the two stores disagree.
//   OBSERVATION both sides DENY. Recorded, reported, and DELIBERATELY INERT for readiness.
//
// `demonstrates` is the second, separately-visible axis: which readiness evidence this row actually
// supplies. OBSERVATION rows supply NONE of it, by construction.
const PARITY_PASS = "PASS";
const PARITY_FAIL = "FAIL";
const PARITY_OBSERVATION = "OBSERVATION";

/** Reasons that name an UNRESOLVED IDENTITY, on ANY verdict -- not only on FAIL rows. */
const UNRESOLVED_IDENTITY_REASONS = new Set([
  "MISSING_PRINCIPAL_MAPPING",
  "DISABLED_PRINCIPAL",
  "DENY_DENY_TARGET_PRINCIPAL_UNKNOWN",
  "DENY_DENY_TARGET_PRINCIPAL_DISABLED",
]);

/**
 * Reasons that name an unresolved ROLE or ROLE ASSIGNMENT, or an absent CAPABILITY DEFINITION, on
 * ANY verdict. The deny/deny members matter as much as the FAIL ones: a principal whose only
 * qualifying assignment was excluded as STALE denies on both sides, so before the vacuity fix its
 * row was a PASS and no guard ever saw it.
 */
const UNRESOLVED_ROLE_OR_CATALOG_REASONS = new Set([
  "MISSING_ROLE",
  "MISSING_CAPABILITY_CATALOG_ENTRY",
  "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_TARGET",
  "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_LEGACY",
  "DENY_DENY_NO_ROLE_HELD",
  "DENY_DENY_TARGET_NO_ACTIVE_ASSIGNMENT",
  "DENY_DENY_TARGET_ASSIGNMENT_STALE",
]);

/**
 * Why did BOTH sides deny? Named in G0-2's own layer order -- DEFINED, then ACTIVATED, then
 * PRINCIPAL ASSIGNED, then ROLE GRANTED -- so the reason always names the OUTERMOST unmet layer,
 * the one an operator must fix first. ACTIVATION and GRANT absence are separate names, never one
 * pooled failure: the legacy resolver refuses an `active:false` capability BEFORE it inspects any
 * grant, so "not activated here" and "no Role grants it" are different facts with different fixes.
 */
function classifyDenyDeny(legacyReason, target) {
  // LAYER 1 -- CAPABILITY DEFINITION.
  if (!target.capabilityKnownInCatalog) return "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_TARGET";
  if (legacyReason === "unknownPermission") return "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_LEGACY";
  // LAYER 2 -- ENVIRONMENT / TENANT ACTIVATION. eos_policy has NO representation of activation at
  // all (eos_policy.capabilities is id/key/description/origin/created_at -- no active column, no
  // activation table), so this fact is only ever visible from the legacy side's reason.
  if (legacyReason === "inactivePermission") return "DENY_DENY_CAPABILITY_NOT_ACTIVATED";
  // LAYER 3 -- PRINCIPAL ASSIGNMENT / identity.
  if (target.refusal === "UNKNOWN_PRINCIPAL") return "DENY_DENY_TARGET_PRINCIPAL_UNKNOWN";
  if (target.refusal === "PRINCIPAL_DISABLED") return "DENY_DENY_TARGET_PRINCIPAL_DISABLED";
  if (
    target.refusal === "NO_TENANT_MEMBERSHIP" ||
    target.refusal === "AMBIGUOUS_TENANT" ||
    target.refusal === "TENANT_NOT_ACTIVE"
  ) {
    return "DENY_DENY_TARGET_NO_ACTIVE_ASSIGNMENT";
  }
  if (target.hadStaleAssignment) return "DENY_DENY_TARGET_ASSIGNMENT_STALE";
  if (target.heldRoleKeys.length === 0) return "DENY_DENY_NO_ROLE_HELD";
  // LAYER 4 -- ROLE GRANT. Both stores agree this Role simply is not granted this capability.
  return "DENY_DENY_NO_ROLE_CAPABILITY_GRANT";
}

/**
 * @param {boolean | {allow: boolean, reason?: string|null}} legacy the legacy decision. A bare
 *   boolean is still accepted (the shape this took before legacy DENY reasons were carried), but
 *   passing the whole `legacyDecisionForPrincipal` result is what lets ACTIVATION absence be named.
 * @param {{allow: boolean, refusal: string|null, heldRoleKeys: readonly string[],
 *          hadStaleAssignment: boolean, capabilityKnownInCatalog: boolean}} target
 * @returns {{parity: "PASS"|"FAIL"|"OBSERVATION", reason: string,
 *            demonstrates: "EXPECTED_ALLOW"|"EXPECTED_DENY"|"NONE"}}
 */
function classify(legacy, target) {
  const legacyAllow = typeof legacy === "boolean" ? legacy : Boolean(legacy && legacy.allow);
  const legacyReason = typeof legacy === "boolean" ? null : (legacy && legacy.reason) || null;

  // A stated foreign tenant MUST be refused regardless of what the tenant-agnostic legacy check
  // said -- this is the harness affirmatively proving the spoof attempt is refused, the desired
  // security property, never evidence of a migration gap. Unlike an ordinary deny/deny this IS a
  // demonstration: the harness chose a tenant the principal is not a member of and the refusal it
  // EXPECTED is the refusal it got.
  if (target.refusal === "TENANT_NOT_A_MEMBERSHIP") {
    return { parity: PARITY_PASS, reason: "SPOOFED_TENANT_REFUSAL", demonstrates: "EXPECTED_DENY" };
  }

  // ALLOW on both sides. The ONLY row shape that proves the migrated capability is reachable.
  if (legacyAllow && target.allow) {
    return { parity: PARITY_PASS, reason: "NONE", demonstrates: "EXPECTED_ALLOW" };
  }

  // DENY on both sides. A parity OBSERVATION, never a pass, never readiness evidence.
  if (!legacyAllow && !target.allow) {
    return { parity: PARITY_OBSERVATION, reason: classifyDenyDeny(legacyReason, target), demonstrates: "NONE" };
  }

  if (target.refusal === "UNKNOWN_PRINCIPAL") return { parity: PARITY_FAIL, reason: "MISSING_PRINCIPAL_MAPPING", demonstrates: "NONE" };
  if (target.refusal === "PRINCIPAL_DISABLED") return { parity: PARITY_FAIL, reason: "DISABLED_PRINCIPAL", demonstrates: "NONE" };
  if (
    target.refusal === "NO_TENANT_MEMBERSHIP" ||
    target.refusal === "AMBIGUOUS_TENANT" ||
    target.refusal === "TENANT_NOT_ACTIVE"
  ) {
    return { parity: PARITY_FAIL, reason: "MISSING_ACTIVE_ASSIGNMENT", demonstrates: "NONE" };
  }

  if (legacyAllow && !target.allow) {
    if (!target.capabilityKnownInCatalog) return { parity: PARITY_FAIL, reason: "MISSING_CAPABILITY_CATALOG_ENTRY", demonstrates: "NONE" };
    if (target.hadStaleAssignment) return { parity: PARITY_FAIL, reason: "DISABLED_ASSIGNMENT", demonstrates: "NONE" };
    if (target.heldRoleKeys.length === 0) return { parity: PARITY_FAIL, reason: "MISSING_ROLE", demonstrates: "NONE" };
    return { parity: PARITY_FAIL, reason: "MISSING_ROLE_CAPABILITY_GRANT", demonstrates: "NONE" };
  }

  if (!legacyAllow && target.allow) {
    // eos_policy would allow what legacy refuses. When legacy refused because the capability is
    // NOT ACTIVATED, this is not a stray grant row -- it is eos_policy having no activation concept
    // to refuse by, which is exactly how applying the grant migration to an `active:false`
    // capability moves a tenant AWAY from parity. Named separately so that cause is legible.
    if (legacyReason === "inactivePermission") {
      return { parity: PARITY_FAIL, reason: "TARGET_IGNORES_CAPABILITY_ACTIVATION", demonstrates: "NONE" };
    }
    return { parity: PARITY_FAIL, reason: "EXTRA_POSTGRES_GRANT", demonstrates: "NONE" };
  }

  return { parity: PARITY_FAIL, reason: "CAPABILITY_KEY_MISMATCH", demonstrates: "NONE" };
}

/**
 * Compare LEGACY vs eos_policy for one tenant, across every principal subject supplied and every
 * writer operation in the census. READ ONLY, both sides -- no write path exists in this function.
 *
 * @param {import("../lib/adminPolicy/policyRepository.js").PolicyReader} reader
 * @param {import("pg").Pool} pool
 * @param {string} tenantId
 * @param {readonly string[]} principalSubjects
 * @param {{db?: import("firebase-admin/firestore").Firestore,
 *          operations?: readonly object[]}} [deps] `operations` narrows the comparison to a SUBSET
 *   of WRITER_CAPABILITY_CENSUS (one writer family at a time, say). It defaults to the whole
 *   census and CANNOT manufacture readiness: the predicate still demands a non-vacuous pass, and
 *   `summary.compared` always states how many comparisons the verdict rests on.
 */
async function buildInventoryCapabilityParityReport(reader, pool, tenantId, principalSubjects, deps) {
  const opts = deps || {};
  const db = opts.db || require("firebase-admin/firestore").getFirestore();
  const operations = opts.operations || WRITER_CAPABILITY_CENSUS;
  const capabilityCatalogKeys = await listCapabilityKeys(pool);

  const rows = [];
  const sortedSubjects = [...principalSubjects].sort();
  for (const subject of sortedSubjects) {
    for (const op of operations) {
      const legacy = await legacyDecisionForPrincipal(db, op, subject);
      const target = await targetDecisionForPrincipal(reader, pool, tenantId, subject, op.capabilityKey, capabilityCatalogKeys);
      const { parity, reason, demonstrates } = classify(legacy, target);
      rows.push({
        tenantId,
        principalSubject: subject,
        operationKey: op.operationKey,
        legacyCapability: op.legacyCapabilityKey || `(role: ${(op.legacyRoles || []).join("|")})`,
        legacyAllow: legacy.allow,
        legacyDenyReason: legacy.reason || null,
        eosPolicyCapability: op.capabilityKey,
        eosPolicyAllow: target.allow,
        parity,
        reason,
        demonstrates,
      });
    }
  }

  // THREE tallies, because there are three verdicts. `failed` is counted DIRECTLY -- it used to be
  // `rows.length - passed`, which silently reclassified anything that was not a PASS as a failure
  // and would have turned every deny/deny observation into one the moment PASS stopped covering it.
  const passed = rows.filter((r) => r.parity === "PASS").length;
  const failed = rows.filter((r) => r.parity === "FAIL").length;
  const observations = rows.filter((r) => r.parity === "OBSERVATION").length;

  // The two axes Owner ruling G0-2 requires to stay SEPARATELY VISIBLE, never merged into one
  // boolean: PARITY (do the stores agree) and REACHABILITY (was the capability shown to work).
  const demonstratedAllow = rows.filter((r) => r.demonstrates === "EXPECTED_ALLOW").length;
  const demonstratedExpectedDeny = rows.filter((r) => r.demonstrates === "EXPECTED_DENY").length;

  // Guards now read reasons on EVERY row, not only on FAIL rows. That restriction was the second
  // half of the vacuity defect: an unknown or disabled principal denies on both sides, so its row
  // was a PASS and these guards never saw it.
  const hasUnresolvedIdentity = rows.some((r) => UNRESOLVED_IDENTITY_REASONS.has(r.reason));
  const hasUnresolvedRoleOrCatalog = rows.some((r) => UNRESOLVED_ROLE_OR_CATALOG_REASONS.has(r.reason));

  const inParity = failed === 0;
  // REACHABILITY is a separate fact from parity, and deny/deny contributes NOTHING to it.
  const reachabilityProven = demonstratedAllow > 0;

  const blockers = [];
  if (rows.length === 0) blockers.push("NOTHING_COMPARED");
  if (!inParity) blockers.push("PARITY_FAILURES_PRESENT");
  if (!reachabilityProven) blockers.push("NO_NON_VACUOUS_PASS: every comparison was deny/deny or a refusal; reachability was never demonstrated");
  if (hasUnresolvedIdentity) blockers.push("UNRESOLVED_PRINCIPAL_IDENTITY");
  if (hasUnresolvedRoleOrCatalog) blockers.push("UNRESOLVED_ROLE_OR_CAPABILITY_DEFINITION");

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      compared: rows.length,
      passed,
      failed,
      observations,
      demonstratedAllow,
      demonstratedExpectedDeny,
      vacuousDenyDeny: observations,
    },
    // PARITY OBSERVATION axis: the stores do not disagree anywhere. True of a wholly empty tenant.
    inParity,
    // REACHABILITY axis, deliberately separate: at least one row where both stores ALLOWED.
    reachabilityProven,
    readinessBlockers: Object.freeze(blockers),
    // What this harness STRUCTURALLY CANNOT evidence, named so that `capabilityParityReady` is
    // never mistaken for the whole of G0-2's readiness bar. CONSERVATIVE READING, pending an Owner
    // ruling (see OWNER QUESTION in this file's header): the predicate below gates on what the
    // harness can actually prove and this list states, in the artefact itself, what it cannot.
    readinessEvidenceGaps: Object.freeze([
      "EXPECTED_DENY_AGAINST_A_STATED_EXPECTATION: the harness compares two stores, it is given no per-row expectation, so it cannot tell a correctly-refused principal from an unprovisioned one. The spoofed-tenant row is the only expected-DENY it provokes itself.",
      "ENVIRONMENT_ISOLATION: not observable from either store's contents.",
      "NO_PRODUCTION_INHERITANCE: not observable from either store's contents.",
      "CONTEXTUAL_BUSINESS_AUTHORITY: requiresOwnAssignment / separation-of-duties guards are instance-level and out of capability-parity scope by census design.",
    ]),
    capabilityParityReady: blockers.length === 0,
  };
}

/**
 * A short human summary, for an operator running this by hand. It prints the PARITY axis and the
 * REACHABILITY axis on separate lines on purpose: an operator must be able to see "the stores
 * agree everywhere" and "nothing was ever shown to work" at the same time, which is precisely the
 * state a wholly unprovisioned tenant is in.
 */
function describeCapabilityParity(report) {
  const s = report.summary;
  const byReason = new Map();
  for (const r of report.rows.filter((x) => x.parity === "OBSERVATION")) {
    byReason.set(r.reason, (byReason.get(r.reason) || 0) + 1);
  }
  return [
    `tenant ${report.tenantId} @ ${report.generatedAt}`,
    `  operations compared     ${s.compared}`,
    `  PASS (agreed ALLOW)     ${s.passed}`,
    `  FAIL (disagreed)        ${s.failed}`,
    `  OBSERVATION (deny/deny) ${s.observations}   <- parity observation only; NOT proof of reachability`,
    `  parity in agreement     ${report.inParity}`,
    `  reachability proven     ${report.reachabilityProven}   (${s.demonstratedAllow} row(s) where BOTH stores allowed)`,
    `  expected-DENY proven    ${s.demonstratedExpectedDeny} row(s) (spoofed-tenant refusals)`,
    `  => ${report.capabilityParityReady ? "CAPABILITY_PARITY_READY" : "NOT READY -- do not switch runtime authorization"}`,
    ...report.readinessBlockers.map((b) => `    BLOCKER ${b}`),
    ...report.rows
      .filter((r) => r.parity === "FAIL")
      .map((r) => `    FAIL ${r.principalSubject} / ${r.operationKey}: ${r.reason} (legacy=${r.legacyAllow} eos_policy=${r.eosPolicyAllow})`),
    ...[...byReason.entries()].sort().map(([reason, n]) => `    OBSERVED ${reason} x${n}`),
    "  NOT EVIDENCED BY THIS HARNESS (must be shown out of band before any cutover):",
    ...report.readinessEvidenceGaps.map((g) => `    - ${g}`),
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

