// THE ROLE CATALOG THE CHANGE-HISTORY READ USES **IN PRODUCTION**, under test.
//
// ============================ WHAT WENT WRONG ============================
//
// `listRecordChangeHistory` took its Role catalog from `deps.roles ?? COMPATIBILITY_ROLES`, and
// administrationUsersCallables.listRecordChangeHistory -- the only caller that runs deployed --
// passes no `deps` at all. COMPATIBILITY_ROLES has exactly three entries: admin, dispatcher,
// technician. So every one of the ELEVEN governed management Roles the Owner approved for
// `audit.event.read` on 2026-08-21 (test/auditReadConfinement.test.mjs) resolved
// `noQualifyingGrant` on a well-formed, active, in-version, globally scoped assignment -- because
// its roleId was simply absent from the catalog being consulted. Owner included.
//
// ============================ WHY NO EXISTING TEST CAUGHT IT ============================
//
// Every test in test/recordChangeHistoryRead.test.mjs injects `{ db, roles: ROLES }` with a
// purpose-built two-Role map. Injecting the dependency under test is what made the defect
// invisible: the suite proved the resolver is consulted correctly and never once proved WHICH
// catalog production hands it. So these tests deliberately pass **only `db`** and let the module
// choose its own default -- that omission is the entire point of the file, and restoring a `roles:`
// key here would restore the blind spot.
//
// Prerequisite: npm run build (this imports from ../lib).
import assert from "node:assert/strict";
import test from "node:test";

const { listRecordChangeHistory, AUDIT_READ_CAPABILITY, UnauthorizedActorError } = await import(
  "../lib/access/recordChangeHistoryReadService.js"
);
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");

// The holders are RESOLVED from the shipped Role objects, never listed here. A hand-copied list of
// eleven ids would pass on the day it was written and stop tracking the Owner decision the moment
// auditReadConfinement.test.mjs's approved set legitimately changes.
const GOVERNED_AUDIT_READERS = Object.values(GOVERNED_BUSINESS_ROLES)
  .filter((r) => (r.permissions || []).includes(AUDIT_READ_CAPABILITY))
  .map((r) => r.id)
  .sort();

const GOVERNED_NON_READERS = Object.values(GOVERNED_BUSINESS_ROLES)
  .filter((r) => !(r.permissions || []).includes(AUDIT_READ_CAPABILITY))
  .map((r) => r.id)
  .sort();

/**
 * A Firestore double narrowed to what the authorization step reads, plus empty results for the
 * event queries that follow an ALLOW.
 *
 * The assignment is deliberately IMPECCABLE -- active, accessVersionAtGrant equal to the principal's
 * current accessVersion, global scope, every required field present and correctly typed. Only the
 * roleId varies between cases, so any DENY below is attributable to the Role catalog and to nothing
 * else. There is no batch() and no set(): a write attempt would throw rather than pass quietly.
 */
function dbFor(roleId) {
  const uid = "actor-1";
  const emptyQuery = () => {
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      get: async () => ({ docs: [], empty: true }),
    };
    return q;
  };
  return {
    collection(name) {
      if (name === "users") {
        return {
          ...emptyQuery(),
          doc: (id) => ({
            id,
            async get() {
              return { id, exists: id === uid, data: () => (id === uid ? { accessVersion: 4 } : undefined) };
            },
          }),
        };
      }
      if (name === "roleAssignments") {
        const q = {
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          get: async () => ({
            docs: [
              {
                id: "assignment-1",
                data: () => ({
                  id: "assignment-1",
                  principalUid: uid,
                  roleId,
                  scope: { type: "global" },
                  status: "active",
                  accessVersionAtGrant: 4,
                }),
              },
            ],
          }),
        };
        return { ...q, doc: (id) => ({ id, get: async () => ({ id, exists: false, data: () => undefined }) }) };
      }
      return {
        ...emptyQuery(),
        doc: (id) => ({ id, get: async () => ({ id, exists: false, data: () => undefined }) }),
      };
    },
    async getAll() {
      return [];
    },
  };
}

const INPUT = { actorUid: "actor-1", targetType: "employee", targetId: "emp-1" };

// NOTE the second argument: `{ db }` and nothing else. No `roles`.
const call = (roleId) => listRecordChangeHistory(INPUT, { db: dbFor(roleId) });

test("the eleven approved governed Roles are ALLOWED through the module's own default catalog", async () => {
  assert.ok(
    GOVERNED_AUDIT_READERS.length >= 8,
    "the governed audit-read holder set collapsed; this test would be asserting almost nothing",
  );
  const denied = [];
  for (const roleId of GOVERNED_AUDIT_READERS) {
    try {
      const rows = await call(roleId);
      assert.ok(Array.isArray(rows), `${roleId} was allowed but returned no array`);
    } catch (err) {
      if (err instanceof UnauthorizedActorError) denied.push(roleId);
      else throw err;
    }
  }
  assert.deepEqual(
    denied,
    [],
    `governed Role(s) ${denied.join(", ")} DECLARE ${AUDIT_READ_CAPABILITY} and were still denied by `
      + `listRecordChangeHistory's default Role catalog. The Owner approved these Roles for audit `
      + `oversight on 2026-08-21 (test/auditReadConfinement.test.mjs); defaulting the resolver to `
      + `COMPATIBILITY_ROLES alone -- three entries, none of them governed -- revokes that decision `
      + `silently, at the only call site that actually deploys.`,
  );
});

test("the compatibility Role that holds audit read is still ALLOWED", async () => {
  // The fix must not trade one holder set for the other. `admin` holds audit.event.read by
  // derivation (ADMIN_ALL_PERMISSIONS spreads the whole catalog), and it must keep holding it.
  assert.ok(COMPATIBILITY_ROLES.admin.permissions.includes(AUDIT_READ_CAPABILITY));
  assert.ok(Array.isArray(await call("admin")));
});

test("a principal whose Role does not declare audit read is still DENIED", async () => {
  // The direction that proves the fix widened the CATALOG CONSULTED and not the authorization rule.
  // dispatcher and technician are the Roles most workers actually carry, and auditReadConfinement
  // asserts they must never hold audit read.
  for (const roleId of ["dispatcher", "technician"]) {
    assert.equal((COMPATIBILITY_ROLES[roleId].permissions || []).includes(AUDIT_READ_CAPABILITY), false);
    await assert.rejects(() => call(roleId), UnauthorizedActorError, `${roleId} must be denied`);
  }
});

test("every governed Role that does NOT declare audit read is still DENIED", async () => {
  // The whole complement, resolved -- not a sample. This is what makes "the catalog is wider" and
  // "everyone in the wider catalog is allowed" different statements. Associates and individual
  // contributors live here (shopAssociate, partsAssociate, warehouseAssociate, salesperson ...).
  assert.ok(GOVERNED_NON_READERS.length >= 20, "the non-reader complement collapsed");
  const wronglyAllowed = [];
  for (const roleId of GOVERNED_NON_READERS) {
    try {
      await call(roleId);
      wronglyAllowed.push(roleId);
    } catch (err) {
      if (!(err instanceof UnauthorizedActorError)) throw err;
    }
  }
  assert.deepEqual(
    wronglyAllowed,
    [],
    `${wronglyAllowed.join(", ")} do NOT declare ${AUDIT_READ_CAPABILITY} and were allowed anyway. `
      + `Widening the Role catalog must never become a grant: resolveEffectivePermission still `
      + `requires a Role that declares the capability.`,
  );
});

test("an unknown roleId is DENIED -- a catalog miss is not an allow", async () => {
  await assert.rejects(() => call("no-such-role-id"), UnauthorizedActorError);
  await assert.rejects(() => call(""), UnauthorizedActorError);
});

test("a disabled, future-version or narrow-scoped assignment naming an approved Role is still DENIED", async () => {
  // Proves the fix did not bypass the rest of the resolver on its way to the Role lookup. Same
  // impeccable assignment, same approved Role, one field wrong each time.
  //
  // MEASURED, NOT ASSUMED: the accessVersion rule is `accessVersionAtGrant <= current`, so a grant
  // from an EARLIER version is legitimate (it is the ordinary steady state) and only a grant
  // claiming a FUTURE version is stale/malformed data. An earlier draft of this test asserted the
  // opposite direction and failed, which is the correct outcome for a wrong assertion.
  const approved = GOVERNED_AUDIT_READERS[0];
  const mutate = (patch) => {
    const base = dbFor(approved);
    return {
      ...base,
      collection(name) {
        const col = base.collection(name);
        if (name !== "roleAssignments") return col;
        const q = {
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          get: async () => ({
            docs: [
              {
                id: "assignment-1",
                data: () => ({
                  id: "assignment-1",
                  principalUid: "actor-1",
                  roleId: approved,
                  scope: { type: "global" },
                  status: "active",
                  accessVersionAtGrant: 4,
                  ...patch,
                }),
              },
            ],
          }),
        };
        return { ...q, doc: col.doc };
      },
    };
  };
  await assert.rejects(
    () => listRecordChangeHistory(INPUT, { db: mutate({ status: "disabled" }) }),
    UnauthorizedActorError,
    "a disabled assignment must not authorize",
  );
  await assert.rejects(
    () => listRecordChangeHistory(INPUT, { db: mutate({ accessVersionAtGrant: 99 }) }),
    UnauthorizedActorError,
    "an assignment claiming a FUTURE accessVersion is stale/malformed and must not authorize",
  );
  await assert.rejects(
    () => listRecordChangeHistory(INPUT, { db: mutate({ scope: { type: "location", value: "loc-1" } }) }),
    UnauthorizedActorError,
    "a location-scoped assignment must not satisfy this read's global-scoped target",
  );
  await assert.rejects(
    () => listRecordChangeHistory(INPUT, { db: mutate({ roleId: 123 }) }),
    UnauthorizedActorError,
    "a malformed assignment must be excluded fail-closed, not coerced to a catalog key",
  );
  // The control: with nothing mutated, this same Role and assignment DO authorize -- so each
  // rejection above is attributable to the one field that changed and not to a broken double.
  assert.ok(Array.isArray(await listRecordChangeHistory(INPUT, { db: mutate({}) })));
});
