// WHO HOLDS WHAT -- the guarded answer, resolved rather than grepped.
//
// ============================ WHY THIS SUITE EXISTS ============================
//
// On the night of 2026-09-11 six independent workstreams tripped over the same wrong belief,
// written as an authoritative comment in shipped code: that some capability was "granted to NO
// Role". Across 147 catalogued capabilities and 48 Roles, ZERO are held by no Role at all. Every
// one of those comments was false, several of them by more than a year of drift, and at least
// three lanes nearly filed a finding that repeated the error rather than correcting it.
//
// THE TRAP THAT PRODUCED ALL OF IT. `compatibilityRoles.ts`'s ADMIN_ALL_PERMISSIONS spreads
// `PERMISSION_CATALOG.map(p => p.id)` onto the admin Role, and OWNER_PERMISSIONS composes from
// admin. So admin and owner hold every id the moment it is registered, and no amount of grepping
// `permissions: [...]` arrays will show it. A grant audit that reads source text gets the wrong
// answer for all 147. This file therefore IMPORTS the compiled modules and resolves the mapping by
// execution. (Prerequisite: `npm run build` in functions/ first, like every other suite here.)
//
// WHAT IS GUARDED, AND WHY THESE TWO SETS
//
//   NEVER_HELD      capabilities held by no Role whatsoever. Expected to stay EMPTY. A registered
//                   id that nothing can ever resolve is either an oversight or a claim somebody
//                   will write a comment about.
//
//   DERIVED_ONLY    capabilities held ONLY through admin/owner's derived whole-catalogue grant and
//                   by no governed business Role. For these, "granted to no Role" is false but
//                   "granted to no job anyone actually does" is TRUE -- which is the distinction
//                   the false comments were groping for, and the one worth pinning.
//
// WHAT THIS CATCHES, STATED HONESTLY. It catches the DRIFT EVENT: the commit in which a capability
// gains or loses its first governed-business-Role holder. That is the moment every comment
// describing it as ungranted becomes wrong, so the failure lands on the author who can still fix
// both. It does NOT read comments, and it cannot: see the note at the foot of this file for why no
// honest mechanism does.
//
// WHY NOT A GENERATED ARTIFACT. docs/architecture/capability-graph.json already carries all 147
// capabilities under a drift guard (capabilityGraphDrift.test.mjs) -- with `catalogActive` and
// `environmentActivation` and NO holder information at all. Adding holders there would mean
// teaching scripts/buildCapabilityGraph.mjs, which PARSES the catalog source, to resolve a spread
// operator. That is the grep bug, rebuilt. An executing test is the honest shape.
//
// Run: node --test test/capabilityHolderRegister.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";

// admin holds all 147 by construction (ADMIN_ALL_PERMISSIONS); owner composes from admin. Holding
// an id through either is therefore NEVER evidence that the id was deliberately granted, which is
// exactly why they are excluded when asking "does any real job carry this?".
const DERIVED_WHOLE_CATALOGUE_ROLES = new Set(["admin", "owner"]);

const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

/** capability id -> every Role id whose `permissions` array resolves to include it. */
function resolveHolders() {
  const holders = new Map(PERMISSION_CATALOG.map((p) => [p.id, []]));
  for (const [roleId, role] of Object.entries(ALL_ROLES)) {
    for (const permissionId of role.permissions ?? []) {
      const list = holders.get(permissionId);
      // A Role naming an id the catalog does not register is its own defect, asserted below.
      if (list) list.push(roleId);
    }
  }
  return holders;
}

// ============================ THE REGISTER ============================
//
// Captured 2026-09-12 by resolving the modules below, as part of the sweep that corrected the false
// comments. Every entry is a deliberate state, not a backlog: changing one of these is a governed
// decision, and this list is where that decision becomes visible to a reviewer.
//
// IF THIS TEST FAILS, THE CODE IS PROBABLY RIGHT AND THIS LIST IS STALE. Update it -- and then
// search for the comments that describe the id you just moved. A capability leaving DERIVED_ONLY
// means some header, service comment or screen copy now says something false about it.
const NEVER_HELD = Object.freeze([]);

const DERIVED_ONLY = Object.freeze([
  // Administration authority: deliberately the administrator's own, with no operational Role
  // carrying it. admin.accessRequest.decide / employeeProfile.write / principalAccess.read /
  // roleAssignment.write / userStatus.write are the access-administration surface itself.
  "admin.accessRequest.decide",
  "admin.credentialReset.initiate",
  "admin.dataImport.execute",
  "admin.dataImport.stage",
  "admin.employeeProfile.write",
  "admin.principalAccess.read",
  "admin.roleAssignment.write",
  "admin.userStatus.write",
  // Commercial Coverage & Territory (#15): trusted-backend/Admin-SDK-only by design.
  "coverage.read",
  "coverage.write",
  // D4 Part-Equipment Compatibility: registered ahead of the D5/D10 gates, activated nowhere.
  "equipment.compatibility.correct",
  "equipment.compatibility.import",
  "equipment.compatibility.verify",
  "equipment.compatibility.view",
  // Finance visibility scopes above team level, and the policy write that locks a company.
  "finance.visibility.businessUnit",
  "finance.visibility.company",
  "financialPolicy.profile.configure",
  // Saved-definition delete, and the three security-text/employee-sensitivity report fields that
  // permissionCatalog.ts excludes from Owner's own derived report grant.
  "report.customer.field.accountOwner.read",
  "report.customer.field.notes.read",
  "report.definition.delete",
  "report.location.field.accessNotes.read",
]);

test("every Role names only capabilities the catalog registers", () => {
  const registered = new Set(PERMISSION_CATALOG.map((p) => p.id));
  const unknown = [];
  for (const [roleId, role] of Object.entries(ALL_ROLES)) {
    for (const permissionId of role.permissions ?? []) {
      if (!registered.has(permissionId)) unknown.push(`${roleId} -> ${permissionId}`);
    }
  }
  assert.deepEqual(unknown, [], "Role(s) grant an unregistered capability id");
});

test("NO catalogued capability is held by no Role at all", () => {
  const holders = resolveHolders();
  const neverHeld = [...holders.entries()].filter(([, rs]) => rs.length === 0).map(([id]) => id).sort();
  assert.deepEqual(
    neverHeld,
    [...NEVER_HELD],
    "a capability is now held by NOTHING. Either grant it, or record it here deliberately -- and " +
      "check what the comments around it claim.",
  );
});

test("the set held ONLY through admin/owner's derived grant is exactly the register", () => {
  const holders = resolveHolders();
  const derivedOnly = [...holders.entries()]
    .filter(([, rs]) => rs.length > 0 && rs.every((r) => DERIVED_WHOLE_CATALOGUE_ROLES.has(r)))
    .map(([id]) => id)
    .sort();
  assert.deepEqual(
    derivedOnly,
    [...DERIVED_ONLY].sort(),
    "the set of capabilities no governed business Role carries has changed. Update the register " +
      "above, THEN grep the tree for comments describing the moved id as ungranted/inert -- that " +
      "is the drift this suite exists to surface.",
  );
});

test("admin holds the entire catalogue, which is why holder counts alone prove nothing", () => {
  // Pinned deliberately: this is the property that makes a grep-based grant audit wrong, and if it
  // ever stops being true the reasoning in the register above has to be revisited rather than
  // silently inherited.
  const adminPermissions = new Set(COMPATIBILITY_ROLES.admin.permissions);
  const missing = PERMISSION_CATALOG.map((p) => p.id).filter((id) => !adminPermissions.has(id));
  assert.deepEqual(missing, [], "ADMIN_ALL_PERMISSIONS no longer spreads the whole catalogue");
});

// ============================ WHAT THIS CANNOT DO ============================
//
// It cannot catch a comment that is ALREADY stale. Consider and reject, in order:
//
//   A regex for the claim phrasings. They vary without limit -- "granted to NO Role", "carried by
//   no standing role", "registered-but-ungranted", "INERT and granted to nobody", "not grantable",
//   "granted to no default Role" -- so it would under-match by construction. It would also
//   FALSE-FIRE on the corrected comments, which deliberately quote the sentence they replaced
//   ("this used to say granted to NO Role") so a reader can see what changed. A guard that fires on
//   the fix is worse than no guard: it teaches people to delete the history.
//
//   Requiring every comment naming a capability id to carry a machine-checkable grant assertion.
//   That is a documentation format imposed on prose, enforced nowhere, and it rots the same way.
//
// So the honest division is: this suite guards the FACT, and review guards the SENTENCE. The
// register above is what makes that division work -- a diff to it is a reviewer's cue to go and
// read the comments.
