// Enterprise Access & Administration Platform (Issue #226) -- tests for
// the trusted, read-only effective-access feed
// (functions/src/access/effectiveAccessFeed.ts). Same firebase-admin-
// against-a-live-Firestore-emulator convention as this repo's other
// emulator test files (no @firebase/rules-unit-testing, no test
// runner). Malformed-input checks don't strictly need the emulator
// (they throw before any Firestore read), but live in this same file
// per this repo's established one-file-per-module convention
// (auditEventWriter.test.mjs mixes format-only and atomicity checks
// the same way).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/effectiveAccessFeed.test.mjs
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below)
// -- never touches the live "taylor-parts" project.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  resolveEffectiveAccess,
  InvalidInputError,
  MalformedAccessDataError,
  MAX_PERMISSION_IDS,
} from "../lib/access/effectiveAccessFeed.js";
import { __resetRuntimeCapabilityOverridesCacheForTest } from "../lib/access/environmentCapabilityOverrides.js";

// --- Per-environment activation override regressions (spec 2026-08-14) ---
// These use a FAKE db (like the backend-outage test) so they exercise the feed's
// activation wiring WITHOUT the emulator and independently of any seeded data.

// A fake Firestore returning one user (accessVersion) + a fixed assignment set.
function fakeDb({ accessVersion = 1, assignments = [] } = {}) {
  return {
    collection(name) {
      if (name === "users") {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ accessVersion }) }) }) };
      }
      return {
        where() {
          return this;
        },
        get: async () => ({ docs: assignments.map((a) => ({ id: a.id, data: () => a })) }),
      };
    },
  };
}

// An active, well-formed, global-scoped assignment for a synthetic role that
// grants a spine capability -- so ONLY the active:false gate stands between it
// and ALLOW. Whether that gate lifts depends solely on the runtime override.
function spineAssignment() {
  return {
    id: "a-spine",
    principalUid: "p1",
    roleId: "syntheticSpine",
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: { toMillis: () => 0 },
    status: "active",
    accessVersionAtGrant: 1,
  };
}
const SPINE_ROLES = { syntheticSpine: { id: "syntheticSpine", permissions: ["opportunity.write"] } };

// Run `fn` with GCLOUD_PROJECT pinned (or cleared) and the cold-start override
// cache reset before and after, so each case sees a fresh runtime resolution.
async function withProject(projectId, fn) {
  const prevG = process.env.GCLOUD_PROJECT;
  const prevGG = process.env.GOOGLE_CLOUD_PROJECT;
  try {
    __resetRuntimeCapabilityOverridesCacheForTest();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    if (projectId === null) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = projectId;
    await fn();
  } finally {
    if (prevG === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prevG;
    if (prevGG === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = prevGG;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
}

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

const now = Date.now();
let seq = 0;
function uid(prefix) {
  seq += 1;
  return `${prefix}-${now}-${seq}`;
}

async function seedUser(accessVersionOrRaw) {
  const principalUid = uid("user");
  if (accessVersionOrRaw === undefined) {
    // Bootstrap case: no users/{uid} doc at all.
    return principalUid;
  }
  await db.collection("users").doc(principalUid).set({ accessVersion: accessVersionOrRaw });
  return principalUid;
}

async function grantRole(principalUid, roleId, overrides = {}) {
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({
    id,
    principalUid,
    roleId,
    scope: { type: "global" },
    grantedBy: "test-fixture",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
    ...overrides,
  });
  return id;
}

async function main() {
  // === Malformed input -- fail closed, never a partial/best-effort result ===

  await check("rejects non-object input", async () => {
    await assert.rejects(() => resolveEffectiveAccess(null), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess("nope"), InvalidInputError);
  });

  await check("rejects a missing/non-array permissionIds", async () => {
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1" }), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: "not-an-array" }), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: {} }), InvalidInputError);
  });

  await check("rejects an empty permissionIds array", async () => {
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: [] }), InvalidInputError);
  });

  await check("rejects a permissionIds array exceeding MAX_PERMISSION_IDS", async () => {
    const tooMany = Array.from({ length: MAX_PERMISSION_IDS + 1 }, (_, i) => `account.record.read${i}`);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: tooMany }), InvalidInputError);
  });

  await check("accepts exactly MAX_PERMISSION_IDS entries (boundary)", async () => {
    const principalUid = await seedUser(1);
    const exactly = Array.from({ length: MAX_PERMISSION_IDS }, () => "account.record.read");
    // All identical -- also proves de-duplication doesn't affect acceptance.
    await assert.doesNotReject(() => resolveEffectiveAccess({ principalUid, permissionIds: exactly }));
  });

  await check("rejects a non-string or empty-string entry in permissionIds", async () => {
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: [123] }), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: [""] }), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "u1", permissionIds: [null] }), InvalidInputError);
  });

  await check("rejects a missing/empty principalUid", async () => {
    await assert.rejects(() => resolveEffectiveAccess({ permissionIds: ["account.record.read"] }), InvalidInputError);
    await assert.rejects(() => resolveEffectiveAccess({ principalUid: "", permissionIds: ["account.record.read"] }), InvalidInputError);
  });

  // === Unassigned user -- fail closed to DENY on everything, accessVersion bootstraps to 0 ===

  await check("an unassigned user (no roleAssignment at all) denies every requested capability", async () => {
    const principalUid = await seedUser(); // no users/{uid} doc
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["account.record.read", "workOrder.transition", "report.customer.read"],
    });
    assert.equal(result.accessVersion, 0);
    assert.deepEqual(result.decisions, {
      "account.record.read": false,
      "workOrder.transition": false,
      "report.customer.read": false,
    });
  });

  // === Compatibility roles (real, production catalog) ===

  await check("admin: real grants ALLOW, report.* still DENY (Owner-only, admin unaffected by Issue #325 W1)", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["account.record.read", "workOrder.create", "report.customer.read"],
    });
    assert.equal(result.decisions["account.record.read"], true);
    assert.equal(result.decisions["workOrder.create"], true);
    assert.equal(result.decisions["report.customer.read"], false);
  });

  await check("technician: unconditional grant ALLOWs, admin-only capability DENIEs", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["workOrder.transition", "account.record.read", "admin.userStatus.write"],
    });
    assert.equal(result.decisions["workOrder.transition"], true);
    assert.equal(result.decisions["account.record.read"], false);
    assert.equal(result.decisions["admin.userStatus.write"], false);
  });

  // === Owner (governed business Role) -- Issue #325 W1's real report.* grant ===

  await check("Owner: mirrors admin AND additionally ALLOWs every active wave-1 report.* id", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "owner");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["account.record.read", "report.customer.read", "report.customer.field.name.read", "report.equipment.field.location.read"],
    });
    assert.equal(result.decisions["account.record.read"], true);
    assert.equal(result.decisions["report.customer.read"], true);
    assert.equal(result.decisions["report.customer.field.name.read"], true);
    assert.equal(result.decisions["report.equipment.field.location.read"], true);
  });

  await check("Owner: inactive (active:false) report fields still DENY despite the real grant -- fail closed", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "owner");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["report.customer.field.notes.read", "report.customer.field.accountOwner.read", "report.location.field.accessNotes.read"],
    });
    assert.deepEqual(result.decisions, {
      "report.customer.field.notes.read": false,
      "report.customer.field.accountOwner.read": false,
      "report.location.field.accessNotes.read": false,
    });
  });

  // === Stale / inconsistent accessVersion -- fail closed ===

  await check("an assignment whose accessVersionAtGrant EXCEEDS the current accessVersion is excluded (stale/inconsistent), denying despite an otherwise-valid grant", async () => {
    const principalUid = await seedUser(1); // current accessVersion = 1
    await grantRole(principalUid, "admin", { accessVersionAtGrant: 5 }); // > current -- impossible under a correct writer, treated as stale
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.equal(result.decisions["account.record.read"], false);
  });

  await check("an assignment whose accessVersionAtGrant is CONSISTENT with (<=) the current accessVersion still grants normally", async () => {
    const principalUid = await seedUser(5);
    await grantRole(principalUid, "admin", { accessVersionAtGrant: 1 }); // <= current -- legitimately older, still valid
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.equal(result.decisions["account.record.read"], true);
  });

  // === Inactive assignment -- fail closed ===

  await check("an assignment with status 'disabled' is excluded, denying despite an otherwise-valid grant", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin", { status: "disabled" });
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.equal(result.decisions["account.record.read"], false);
  });

  // === Broken/malformed assignment shape -- excluded, never thrown ===

  await check("a malformed assignment (missing required fields) is excluded fail-closed, without throwing", async () => {
    const principalUid = await seedUser(1);
    const brokenId = uid("assignment");
    await db.collection("roleAssignments").doc(brokenId).set({
      id: brokenId,
      principalUid,
      // roleId, scope, grantedBy, grantedAt, status, accessVersionAtGrant all missing
    });
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.equal(result.decisions["account.record.read"], false);
  });

  await check("a malformed accessVersion on users/{uid} throws MalformedAccessDataError (never silently treated as 0 or as ALLOW)", async () => {
    const principalUid = await seedUser();
    await db.collection("users").doc(principalUid).set({ accessVersion: "not-a-number" });
    await assert.rejects(
      () => resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] }),
      MalformedAccessDataError,
    );
  });

  // === Unknown/unregistered permission id -- denies, does not throw the whole call ===

  await check("an unknown/unregistered permission id resolves to false without throwing or failing the whole request", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["account.record.read", "not.a.realPermission"],
    });
    assert.equal(result.decisions["account.record.read"], true);
    assert.equal(result.decisions["not.a.realPermission"], false);
  });

  // === De-duplication ===

  await check("duplicate permissionIds in the request produce exactly one decision entry each", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["account.record.read", "account.record.read", "account.record.read"],
    });
    assert.deepEqual(Object.keys(result.decisions), ["account.record.read"]);
  });

  // === Cross-principal isolation ===

  await check("a principal's decisions are never influenced by ANOTHER principal's assignments, even for a shared roleId", async () => {
    const grantedPrincipal = await seedUser(1);
    await grantRole(grantedPrincipal, "admin");
    const ungrantedPrincipal = await seedUser(1); // separate principal, no assignment of their own

    const grantedResult = await resolveEffectiveAccess({ principalUid: grantedPrincipal, permissionIds: ["account.record.read"] });
    const ungrantedResult = await resolveEffectiveAccess({ principalUid: ungrantedPrincipal, permissionIds: ["account.record.read"] });

    assert.equal(grantedResult.decisions["account.record.read"], true);
    assert.equal(ungrantedResult.decisions["account.record.read"], false);
  });

  await check("re-resolving the granted principal AFTER the ungranted one is unaffected by call order (no shared/cached state)", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin");
    const other = await seedUser(1);

    await resolveEffectiveAccess({ principalUid: other, permissionIds: ["account.record.read"] });
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.equal(result.decisions["account.record.read"], true);
  });

  // === Response shape -- never leaks internal detail ===

  await check("the response contains ONLY accessVersion and decisions -- no assignment/role/condition/reason detail", async () => {
    const principalUid = await seedUser(1);
    await grantRole(principalUid, "admin");
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["account.record.read"] });
    assert.deepEqual(Object.keys(result).sort(), ["accessVersion", "decisions"]);
    assert.equal(typeof result.decisions["account.record.read"], "boolean");
  });

  // === Unavailable backend -- fails closed (rejects), never a bogus/partial ALLOW ===

  await check("a Firestore read failure REJECTS the whole call, never resolves with a partial or ALLOW-defaulted result", async () => {
    const brokenDb = {
      collection() {
        return {
          doc() {
            return { get: () => Promise.reject(new Error("simulated backend outage")) };
          },
          where() {
            return this;
          },
          // FIX (pre-existing latent bug, surfaced by later awaits added for
          // Wave 7 extension PART 4): without this, `.where().where().get()`
          // throws synchronously (no `get` on the object `where()` returns),
          // which happens WHILE building the Promise.all() array -- AFTER the
          // sibling `doc().get()` rejected promise above has already been
          // constructed but BEFORE Promise.all() ever attaches a handler to
          // it, leaving it an unhandled rejection that crashes the process on
          // a later tick. assert.rejects() below still observed the intended
          // synchronous-throw rejection either way, masking this until enough
          // subsequent awaits gave the unhandled rejection a tick to fire.
          get: () => Promise.reject(new Error("simulated backend outage")),
        };
      },
    };
    await assert.rejects(() =>
      resolveEffectiveAccess(
        { principalUid: "whoever", permissionIds: ["account.record.read"] },
        { db: brokenDb },
      ),
    );
  });

  // === Per-environment activation override -- AUTH-CORE non-widening ===

  await check("AUTH-CORE: a caller-supplied activationOverrides option is IGNORED -- the normal path cannot be widened", async () => {
    // Production identity => runtime override EMPTY. A caller that tries to inject
    // an activation set via options must have NO effect: the spine capability
    // stays denied even though a role grants it. (Proves the removed options seam
    // is genuinely gone -- an extra prop is inert.)
    await withProject("taylor-parts", async () => {
      const result = await resolveEffectiveAccess(
        { principalUid: "p1", permissionIds: ["opportunity.write"] },
        { db: fakeDb({ assignments: [spineAssignment()] }), roles: SPINE_ROLES, activationOverrides: new Set(["opportunity.write"]) },
      );
      assert.equal(result.decisions["opportunity.write"], false, "a caller override must never activate a spine capability");
    });
  });

  await check("the feed FORWARDS the trusted runtime override: a sandbox projectId activates the spine when a role grants it", async () => {
    // Sandbox identity => runtime override contains the spine. With a granting
    // role, the feed must ALLOW -- proving it actually threads the runtime set
    // into the resolver (not an empty set).
    await withProject("eos-platform-sandbox", async () => {
      const result = await resolveEffectiveAccess(
        { principalUid: "p1", permissionIds: ["opportunity.write"] },
        { db: fakeDb({ assignments: [spineAssignment()] }), roles: SPINE_ROLES },
      );
      assert.equal(result.decisions["opportunity.write"], true);
    });
  });

  await check("activation alone never grants: sandbox projectId but NO qualifying role still DENIES the spine", async () => {
    await withProject("eos-platform-sandbox", async () => {
      const result = await resolveEffectiveAccess(
        { principalUid: "p1", permissionIds: ["opportunity.write"] },
        { db: fakeDb({ assignments: [] }), roles: SPINE_ROLES },
      );
      assert.equal(result.decisions["opportunity.write"], false);
    });
  });

  await check("production projectId keeps the spine DENY even with a granting role (runtime override EMPTY)", async () => {
    await withProject("taylor-parts", async () => {
      const result = await resolveEffectiveAccess(
        { principalUid: "p1", permissionIds: ["opportunity.write"] },
        { db: fakeDb({ assignments: [spineAssignment()] }), roles: SPINE_ROLES },
      );
      assert.equal(result.decisions["opportunity.write"], false);
    });
  });

  // === Wave 7 extension PART 4 -- operationalRoleActive Conditions now
  // resolve through this canonical feed (functions/src/access/
  // operationalRoleContext.ts wired into effectiveAccessFeed.ts). Exercises
  // TECHNICIAN_ROLE's real, unmodified Condition declarations
  // (compatibilityRoles.ts) against a real users/employees linkage, proving
  // reuse across MORE THAN ONE conditional capability id and role. ===

  async function seedEmployeeLinkedUser({ employmentStatus = "ACTIVE", operationalRoles = [] } = {}) {
    const principalUid = uid("techuser");
    const employeeId = uid("emp");
    await db.collection("users").doc(principalUid).set({ accessVersion: 1, employeeId });
    await db.collection("employees").doc(employeeId).set({
      displayName: "Test Technician",
      employmentStatus,
      operationalRoles,
      userId: principalUid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { principalUid, employeeId };
  }

  await check("operationalRoleActive: technician with PARTS_MANAGER ALLOWs reorder.request.read.queue (Condition params.role)", async () => {
    const { principalUid } = await seedEmployeeLinkedUser({ operationalRoles: ["PARTS_MANAGER"] });
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["reorder.request.read.queue"] });
    assert.equal(result.decisions["reorder.request.read.queue"], true);
  });

  await check("operationalRoleActive: technician with PARTS_ASSOCIATE (not PARTS_MANAGER) DENIEs reorder.request.read.queue -- wrong role", async () => {
    const { principalUid } = await seedEmployeeLinkedUser({ operationalRoles: ["PARTS_ASSOCIATE"] });
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["reorder.request.read.queue"] });
    assert.equal(result.decisions["reorder.request.read.queue"], false);
  });

  await check("operationalRoleActive: a SECOND, distinct conditioned capability (inventory.transaction.read, params.roles ANY-of) also resolves via the same shared resolver", async () => {
    const { principalUid } = await seedEmployeeLinkedUser({ operationalRoles: ["WAREHOUSE_MANAGER"] });
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({
      principalUid,
      // One call, multiple conditioned ids -- proves the SAME resolver
      // instance answers correctly for a params.role id AND a params.roles
      // (ANY-of) id in the same response.
      permissionIds: ["inventory.transaction.read", "reorder.request.read.own"],
    });
    assert.equal(result.decisions["inventory.transaction.read"], true, "WAREHOUSE_MANAGER qualifies via MANAGER_OR_WAREHOUSE");
    assert.equal(result.decisions["reorder.request.read.own"], false, "WAREHOUSE_MANAGER does not satisfy PARTS_ASSOCIATE_ONLY");
  });

  await check("operationalRoleActive: technician whose Employee is INACTIVE DENIEs despite having the role", async () => {
    const { principalUid } = await seedEmployeeLinkedUser({ employmentStatus: "TERMINATED", operationalRoles: ["PARTS_MANAGER"] });
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["reorder.request.read.queue"] });
    assert.equal(result.decisions["reorder.request.read.queue"], false);
  });

  await check("operationalRoleActive: technician with NO linked Employee DENIEs every operationalRoleActive-conditioned id", async () => {
    const principalUid = await seedUser(1); // users doc, but no employeeId at all
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({
      principalUid,
      permissionIds: ["reorder.request.read.queue", "inventory.catalog.read", "reorder.purchaseOrder.read"],
    });
    assert.deepEqual(result.decisions, {
      "reorder.request.read.queue": false,
      "inventory.catalog.read": false,
      "reorder.purchaseOrder.read": false,
    });
  });

  await check("operationalRoleActive: unconditional technician grant (workOrder.transition) is UNCHANGED by this wiring -- resolves ALLOW with no Employee link at all", async () => {
    const principalUid = await seedUser(1); // no employeeId
    await grantRole(principalUid, "technician");
    const result = await resolveEffectiveAccess({ principalUid, permissionIds: ["workOrder.transition"] });
    assert.equal(result.decisions["workOrder.transition"], true, "unconditional capabilities must resolve identically before/after this change");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
