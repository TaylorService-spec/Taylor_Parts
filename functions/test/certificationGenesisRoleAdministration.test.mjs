// HOLDING `owner` IS NOT THE SAME AS BEING ALLOWED TO ADMINISTER ROLES.
//
// ============================ THE LIVE CONDITION THIS REPRODUCES ============================
//
// eos-platform-certification, after genesis and before any other grant:
//
//   roleAssignments: exactly one -- cw-genesis-cw-emp-000-owner
//     principalUid oTugB4LFL6YS5pRa2FciBvh3XEL2, roleId "owner", scope global,
//     status active, genesis true, accessVersionAtGrant 1
//   users/{uid}.accessVersion: 1
//
// applyRoleGrants then called the trusted grantRole() service for its first
// non-privileged grant (cw-emp-001 / generalManager) and was refused:
//
//   actor is not authorized for "admin.roleAssignment.write" (noQualifyingGrant)
//   applied: 0
//
// ============================ WHY THAT REFUSAL IS CORRECT ============================
//
// grantRole -> verifyActorPermission -> resolvePrincipalPermission resolves against
// COMPATIBILITY_ROLES, and only those: { admin, dispatcher, technician }. The genesis assignment
// carries roleId "owner", which exists in GOVERNED_BUSINESS_ROLES and NOT in COMPATIBILITY_ROLES.
// So the qualification loop's `input.roles[candidate.roleId]` is undefined, the candidate is
// skipped, and nothing qualifies.
//
// This is a DELIBERATE two-catalog design, not an accident:
//
//   COMPATIBILITY_ROLES        the runtime authorization catalog the trusted writer enforces.
//                              `admin` carries admin.roleAssignment.write.
//   GOVERNED_BUSINESS_ROLES    the business role model the fixture and capability layer use.
//                              `owner` carries admin.roleAssignment.write.
//
// trustedWriterCommands' own header records the consequence in advance: "no principal in any
// environment yet holds the roleAssignments document every real call authorizes against (see
// bootstrapCompatibilityAdmin below) -- so every call still denies today, in every environment."
//
// These cases pin that refusal as INTENDED. They exist so that widening the trusted writer's
// authorization surface -- making `owner` globally sufficient as a convenience -- fails a test
// rather than passing review.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

/** Source with line endings normalized -- a CRLF checkout breaks boundary searches otherwise. */
function readSource(rel) {
  return readFileSync(path.resolve(REPO, rel), "utf8")
    .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
}

const { resolveEffectivePermission } =
  await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));

const ROLE_ADMIN_PERMISSION = "admin.roleAssignment.write";
const GENESIS_UID = "oTugB4LFL6YS5pRa2FciBvh3XEL2";

/** The live genesis assignment, exactly as it exists in Firestore (id injected by the loader). */
const genesisAssignment = (over = {}) => ({
  id: "cw-genesis-cw-emp-000-owner",
  principalUid: GENESIS_UID,
  roleId: "owner",
  scope: { type: "global" },
  status: "active",
  accessVersionAtGrant: 1,
  ...over,
});

/** Exactly what grantRole asks: global scope, empty condition, compatibility catalog. */
const askAsTrustedWriter = (assignments, roles = COMPATIBILITY_ROLES) =>
  resolveEffectivePermission({
    permissionId: ROLE_ADMIN_PERMISSION,
    assignments,
    roles,
    currentAccessVersion: 1,
    target: { scope: { type: "global" }, condition: {} },
  });

// ── THE EXACT LIVE CONDITION ──────────────────────────────────────────────────────────────────

test("ONE genesis owner, ZERO other assignments: the first non-privileged grant is REFUSED", () => {
  const r = askAsTrustedWriter([genesisAssignment()]);
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant",
    "this is the exact reason the live run reported, reproduced without Firestore");
});

test("the refusal is the ROLE CATALOG, not scope, status, or accessVersion", () => {
  // Every other gate passes. Isolating that is what turns "it denied" into a diagnosis: the
  // assignment is well-formed, active, in-version and globally scoped, and still does not qualify.
  const a = genesisAssignment();
  assert.equal(a.status, "active");
  assert.equal(a.scope.type, "global", "global scope matches any target");
  assert.ok(a.accessVersionAtGrant <= 1, "grant-time version is consistent with current");
  assert.equal(Object.hasOwn(COMPATIBILITY_ROLES, a.roleId), false,
    "the sole reason: the trusted writer's catalog does not contain this roleId");
});

test("the SAME assignment qualifies against the governed business catalog", () => {
  // Proof that the assignment itself is sound and the catalog is the whole difference. If this
  // ever failed, the diagnosis above would be wrong and the defect would be in the grant.
  const r = askAsTrustedWriter([genesisAssignment()], GOVERNED_BUSINESS_ROLES);
  assert.equal(r.decision, "ALLOW",
    "owner carries admin.roleAssignment.write in the business catalog");
});

// ── THE TWO CATALOGS SAY DIFFERENT THINGS, ON PURPOSE ─────────────────────────────────────────

test("role administration is carried by DIFFERENT roles in the two catalogs", () => {
  const holders = (cat) => Object.entries(cat)
    .filter(([, r]) => (r.permissions ?? []).includes(ROLE_ADMIN_PERMISSION))
    .map(([id]) => id);
  assert.deepEqual(holders(COMPATIBILITY_ROLES), ["admin"]);
  assert.deepEqual(holders(GOVERNED_BUSINESS_ROLES), ["owner"]);
  // And the catalogs are disjoint on these two ids, which is why one cannot stand in for the other.
  assert.equal(Object.hasOwn(COMPATIBILITY_ROLES, "owner"), false);
  assert.equal(Object.hasOwn(GOVERNED_BUSINESS_ROLES, "admin"), false);
});

test("the trusted writer resolves against COMPATIBILITY_ROLES only -- asserted, not assumed", () => {
  // The whole diagnosis rests on which catalog resolvePrincipalPermission passes. If a future
  // change widened it to ASSIGNABLE_ROLES (compatibility + governed), `owner` would silently become
  // sufficient to administer roles in EVERY environment including production. That is a material
  // security widening and must never happen as a side effect -- so it is pinned here.
  const src = readSource("functions/src/access/trustedWriterCommands.ts");
  const fn = src.slice(src.indexOf("async function resolvePrincipalPermission"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10)));
  assert.match(body, /roles: COMPATIBILITY_ROLES/,
    "the trusted writer must authorize against the compatibility catalog only");
  assert.equal(/roles: ASSIGNABLE_ROLES|roles: GOVERNED/.test(body), false,
    "widening this catalog makes business `owner` sufficient to administer roles everywhere");
});

// ── WHAT WOULD QUALIFY ────────────────────────────────────────────────────────────────────────

test("a compatibility admin assignment DOES authorize role administration", () => {
  // The shape bootstrapCompatibilityAdmin creates: roleId "admin", global, active. This is the
  // repository's stated first-administrator mechanism, and it is what the genesis owner is not.
  const r = askAsTrustedWriter([{
    id: `bootstrap-admin-${GENESIS_UID}`,
    principalUid: GENESIS_UID,
    roleId: "admin",
    scope: { type: "global" },
    status: "active",
    accessVersionAtGrant: 1,
  }]);
  assert.equal(r.decision, "ALLOW");
});

test("holding BOTH would authorize -- the owner grant is not in the way", () => {
  // Relevant to the decision this reproduces: adding a compatibility admin assignment alongside the
  // genesis owner is sufficient, and the existing owner assignment neither helps nor blocks.
  const r = askAsTrustedWriter([
    genesisAssignment(),
    { id: `bootstrap-admin-${GENESIS_UID}`, principalUid: GENESIS_UID, roleId: "admin",
      scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 },
  ]);
  assert.equal(r.decision, "ALLOW");
});

// ── NEIGHBOURING GATES STILL BEHAVE ───────────────────────────────────────────────────────────

test("a disabled or out-of-version compatibility admin still does not qualify", () => {
  const base = { id: "x", principalUid: GENESIS_UID, roleId: "admin", scope: { type: "global" } };
  assert.equal(askAsTrustedWriter([{ ...base, status: "disabled", accessVersionAtGrant: 1 }]).reason,
    "noQualifyingGrant");
  assert.equal(askAsTrustedWriter([{ ...base, status: "active", accessVersionAtGrant: 99 }]).reason,
    "noQualifyingGrant", "a grant from a future access version must not qualify");
});

test("no assignments at all denies for the same reason", () => {
  assert.equal(askAsTrustedWriter([]).reason, "noQualifyingGrant");
});


// =================================================================================================
// THE FULL TRANSITION -- owner -> admin -> first non-privileged grant.
//
// This is the authority test that should have existed before any live work. It walks the whole
// chain against the SAME COMPATIBILITY_ROLES path the trusted writer authorizes through, so a
// genesis that cannot administer roles fails here rather than in production of a live run.
// =================================================================================================
const { CERTIFICATION_GENESIS_ADMIN_ROLE_ID, CERTIFICATION_GENESIS_ROLE_ID, CERTIFICATION_GENESIS_ACTOR } =
  await import(L("functions/lib/access/trustedWriterCommands.js"));

const ownerHalf = () => genesisAssignment();
const adminHalf = (over = {}) => ({
  id: `cw-genesis-cw-emp-000-${CERTIFICATION_GENESIS_ADMIN_ROLE_ID}`,
  principalUid: GENESIS_UID,
  roleId: CERTIFICATION_GENESIS_ADMIN_ROLE_ID,
  scope: { type: "global" },
  status: "active",
  genesis: true,
  grantedBy: CERTIFICATION_GENESIS_ACTOR,
  accessVersionAtGrant: 2,
  ...over,
});

test("TRANSITION: the two halves are different Roles from different catalogs", () => {
  assert.equal(CERTIFICATION_GENESIS_ROLE_ID, "owner");
  assert.equal(CERTIFICATION_GENESIS_ADMIN_ROLE_ID, "admin");
  assert.equal(Object.hasOwn(GOVERNED_BUSINESS_ROLES, CERTIFICATION_GENESIS_ROLE_ID), true);
  assert.equal(Object.hasOwn(COMPATIBILITY_ROLES, CERTIFICATION_GENESIS_ADMIN_ROLE_ID), true);
});

test("TRANSITION: step 1 alone -- owner only -- still DENIES noQualifyingGrant", () => {
  const r = resolveEffectivePermission({
    permissionId: ROLE_ADMIN_PERMISSION,
    assignments: [ownerHalf()],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 2,
    target: { scope: { type: "global" }, condition: {} },
  });
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant", "the business half authorizes nothing here");
});

test("TRANSITION: step 2 -- adding the admin half qualifies admin.roleAssignment.write", () => {
  const r = resolveEffectivePermission({
    permissionId: ROLE_ADMIN_PERMISSION,
    assignments: [ownerHalf(), adminHalf()],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 2,
    target: { scope: { type: "global" }, condition: {} },
  });
  assert.equal(r.decision, "ALLOW", "this is what lets grantRole proceed at all");
});

test("TRANSITION: step 3 -- the first NON-PRIVILEGED governed role is grantable", () => {
  // grantRole's own gate for a non-privileged Role is verifyActorPermission ALONE -- one actor, no
  // approver. So the ALLOW above is the whole authorization for the first of the 86 grants.
  const target = GOVERNED_BUSINESS_ROLES.generalManager;
  assert.ok(target, "generalManager is the fixture's first non-privileged grant");
  assert.notEqual(target.privileged, true, "it must be non-privileged, or two-person rules apply");
});

test("TRANSITION: the admin half carries truthful genesis provenance, not a migration", () => {
  const a = adminHalf();
  assert.equal(a.genesis, true);
  assert.equal(a.grantedBy, CERTIFICATION_GENESIS_ACTOR);
  assert.notEqual(a.grantedBy, "bootstrap:legacy-admin-migration",
    "no legacy migration occurred; recording one would be false provenance");
});

test("TRANSITION: business owner is NEVER silently consulted by the trusted writer", () => {
  // The load-bearing negative. If the admin half were revoked, authority must fall away entirely --
  // the surviving owner assignment must not quietly keep role administration alive.
  const r = resolveEffectivePermission({
    permissionId: ROLE_ADMIN_PERMISSION,
    assignments: [ownerHalf(), adminHalf({ status: "disabled" })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 2,
    target: { scope: { type: "global" }, condition: {} },
  });
  assert.equal(r.decision, "DENY");
  assert.equal(r.reason, "noQualifyingGrant");
});

test("TRANSITION: privileged two-person rules are untouched by either half", () => {
  const src = readSource("functions/src/access/trustedWriterCommands.ts");
  const fn = src.slice(src.indexOf("export async function grantRole"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10)));
  assert.match(body, /verifyApproverIsPrivileged/, "privileged grants still need a distinct approver");
  assert.match(body, /SelfApprovalError/, "self-approval is still refused");
});

test("COMPLETION: refuses any admin assignment that did not come from genesis", () => {
  const body = functionBodyOf("export async function completeCertificationAuthorityGenesis");
  assert.match(body, /Refusing to bless it as genesis/,
    "an admin assignment from another source must not be relabelled as genesis");
  assert.match(body, /active\.size !== 1/, "it applies only to the exact partial state");
  assert.match(body, /role === "production"/, "production is refused");
  assert.match(body, /trustedRuntimeProjectId\(\)/, "runtime identity comes from the initialized app");
});

test("COMPLETION: takes no caller-supplied role, scope, or actor", () => {
  const body = functionBodyOf("export async function completeCertificationAuthorityGenesis");
  assert.equal(/input\.roleId|input\.scope|input\.actorUid|input\.projectId/.test(body), false,
    "every identity and role derives from governed authority, never from the caller");
  assert.match(body, /CERTIFICATION_GENESIS_ADMIN_ROLE_ID/, "the Role is fixed");
});

test("COMPLETION: writes through the shared access-mutation plumbing, with its own action", () => {
  const body = functionBodyOf("export async function completeCertificationAuthorityGenesis");
  assert.match(body, /runAccessMutationCommand/, "atomic assignment + accessVersion + one audit event");
  assert.match(body, /action: "completeCertificationAuthorityGenesis"/,
    "its own action -- the original genesis event is immutable and did not record this");
  assert.match(body, /actorUid: CERTIFICATION_GENESIS_ACTOR/);
});

test("COMPLETION: the audit action is registered in the union AND the runtime mirror", () => {
  assert.match(readSource("functions/src/types/access.ts"), /\| "completeCertificationAuthorityGenesis"/);
  assert.match(readSource("functions/src/access/auditEventWriter.ts"), /"completeCertificationAuthorityGenesis",/);
});

function functionBodyOf(signature) {
  const src = readSource("functions/src/access/trustedWriterCommands.ts");
  const fn = src.slice(src.indexOf(signature));
  return fn.slice(0, fn.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10)));
}
