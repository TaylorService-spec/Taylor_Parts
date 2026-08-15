// Wave 7 extension, PART 4 (Operational-Role Condition Resolver) --
// tests for functions/src/access/operationalRoleContext.ts.
//
// Two layers, matching this repo's established convention for the two
// modules this one mirrors:
//  1. Pure-function checks against `evaluateOperationalRoleActive()`
//     (no Firestore at all) -- same style as resolveEffectivePermission.
//     test.mjs's pure-logic checks.
//  2. Emulator-backed checks against `buildOperationalRoleActiveResolver*`
//     -- same style as effectiveAccessFeed.test.mjs (live Firestore
//     emulator via firebase-admin, no @firebase/rules-unit-testing).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/operationalRoleContext.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  evaluateOperationalRoleActive,
  buildOperationalRoleActiveResolver,
  buildOperationalRoleActiveResolverFromEmployeeId,
} from "../lib/access/operationalRoleContext.js";

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

function baseFacts(overrides = {}) {
  return {
    uid: "user-1",
    userEmployeeId: "emp-1",
    employeeExists: true,
    employeeUserId: "user-1",
    employeeEmploymentStatus: "ACTIVE",
    employeeOperationalRoles: ["PARTS_MANAGER"],
    ...overrides,
  };
}

async function pureChecks() {
  await check("ALLOW: reciprocal link + ACTIVE + role present", () => {
    assert.equal(evaluateOperationalRoleActive(baseFacts(), "PARTS_MANAGER"), true);
  });

  await check("DENY: role not in operationalRoles", () => {
    assert.equal(evaluateOperationalRoleActive(baseFacts(), "WAREHOUSE_MANAGER"), false);
  });

  await check("DENY: employmentStatus not ACTIVE (every non-ACTIVE value)", () => {
    for (const status of ["ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR", "", null, undefined, 123]) {
      assert.equal(
        evaluateOperationalRoleActive(baseFacts({ employeeEmploymentStatus: status }), "PARTS_MANAGER"),
        false,
        `expected DENY for employmentStatus=${JSON.stringify(status)}`,
      );
    }
  });

  await check("DENY: no linked employeeId (missing/empty/non-string users.employeeId)", () => {
    for (const userEmployeeId of [undefined, null, "", 123, {}]) {
      assert.equal(
        evaluateOperationalRoleActive(baseFacts({ userEmployeeId }), "PARTS_MANAGER"),
        false,
      );
    }
  });

  await check("DENY: employees/{employeeId} does not exist (stale/deleted link)", () => {
    assert.equal(
      evaluateOperationalRoleActive(baseFacts({ employeeExists: false }), "PARTS_MANAGER"),
      false,
    );
  });

  await check("DENY: employee.userId does not match principal uid (linkage spoofing)", () => {
    assert.equal(
      evaluateOperationalRoleActive(baseFacts({ employeeUserId: "someone-else" }), "PARTS_MANAGER"),
      false,
    );
  });

  await check("DENY: operationalRoles missing / not a list / malformed", () => {
    for (const employeeOperationalRoles of [undefined, null, "PARTS_MANAGER", {}, 42]) {
      assert.equal(
        evaluateOperationalRoleActive(baseFacts({ employeeOperationalRoles }), "PARTS_MANAGER"),
        false,
      );
    }
  });

  await check("DENY: operationalRoles is a list but contains only wrong-typed entries", () => {
    assert.equal(
      evaluateOperationalRoleActive(baseFacts({ employeeOperationalRoles: [123, null, {}] }), "PARTS_MANAGER"),
      false,
    );
  });

  await check("ALLOW: operationalRoles contains multiple roles, requested one present among them", () => {
    assert.equal(
      evaluateOperationalRoleActive(
        baseFacts({ employeeOperationalRoles: ["TECHNICIAN", "WAREHOUSE_MANAGER", "PARTS_MANAGER"] }),
        "PARTS_MANAGER",
      ),
      true,
    );
  });

  await check("DENY: malformed role argument itself (not a non-empty string)", () => {
    for (const role of [undefined, null, "", 123, {}]) {
      assert.equal(evaluateOperationalRoleActive(baseFacts(), role), false);
    }
  });

  await check("DENY: malformed uid on the facts object", () => {
    for (const uid of [undefined, null, "", 123]) {
      assert.equal(evaluateOperationalRoleActive(baseFacts({ uid }), "PARTS_MANAGER"), false);
    }
  });
}

// === Emulator-backed checks (live Firestore, mirrors employeesRules.test.js's document shape) ===

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const now = Date.now();
let seq = 0;
function uid(prefix) {
  seq += 1;
  return `${prefix}-${now}-${seq}`;
}

async function seedUserAndEmployee({ employeeId, employmentStatus, operationalRoles, employeeUserId, noEmployeeDoc = false, noUserDoc = false } = {}) {
  const principalUid = uid("user");
  const empId = employeeId ?? uid("emp");
  if (!noUserDoc) {
    await db.collection("users").doc(principalUid).set({ employeeId: empId });
  }
  if (!noEmployeeDoc) {
    await db.collection("employees").doc(empId).set({
      displayName: "Test Employee",
      employmentStatus: employmentStatus ?? "ACTIVE",
      operationalRoles: operationalRoles ?? ["PARTS_MANAGER"],
      userId: employeeUserId !== undefined ? employeeUserId : principalUid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return { principalUid, empId };
}

async function emulatorChecks() {
  await check("EMULATOR ALLOW: ACTIVE employee with the required operational role", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER"] });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), true);
  });

  await check("EMULATOR DENY: ACTIVE employee WITHOUT the required role (second conditional capability's role)", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["PARTS_ASSOCIATE"] });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("WAREHOUSE_MANAGER"), false);
    // Proves the SAME resolver instance answers correctly per-role, not
    // just for a single hardcoded id -- exercising reuse across more
    // than one conditional capability (PARTS_ASSOCIATE vs WAREHOUSE_MANAGER).
    assert.equal(resolver("PARTS_ASSOCIATE"), true);
  });

  await check("EMULATOR DENY: employee INACTIVE/terminated despite having the role", async () => {
    const { principalUid } = await seedUserAndEmployee({ employmentStatus: "TERMINATED", operationalRoles: ["PARTS_MANAGER"] });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR DENY: no linked Employee (users/{uid}.employeeId absent)", async () => {
    const principalUid = uid("user-unlinked");
    await db.collection("users").doc(principalUid).set({ displayName: "No link" });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR DENY: no users/{uid} document at all", async () => {
    const principalUid = uid("user-nodoc");
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR DENY: employee.userId does not match the principal (linkage spoofing)", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER"], employeeUserId: "someone-else-entirely" });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR DENY: malformed operationalRoles on the live document (a string, not a list)", async () => {
    const { principalUid, empId } = await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER"] });
    await db.collection("employees").doc(empId).update({ operationalRoles: "PARTS_MANAGER" });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR DENY: stale/deleted employee doc (users still points at it)", async () => {
    const { principalUid, empId } = await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER"] });
    await db.collection("employees").doc(empId).delete();
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR: buildOperationalRoleActiveResolverFromEmployeeId matches the self-contained resolver given the SAME already-known employeeId", async () => {
    const { principalUid, empId } = await seedUserAndEmployee({ operationalRoles: ["WAREHOUSE_MANAGER"] });
    const resolver = await buildOperationalRoleActiveResolverFromEmployeeId(db, principalUid, empId);
    assert.equal(resolver("WAREHOUSE_MANAGER"), true);
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR: buildOperationalRoleActiveResolverFromEmployeeId DENIEs when the supplied employeeId is not a string", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["WAREHOUSE_MANAGER"] });
    const resolver = await buildOperationalRoleActiveResolverFromEmployeeId(db, principalUid, undefined);
    assert.equal(resolver("WAREHOUSE_MANAGER"), false);
  });

  await check("EMULATOR: a client-supplied operational role has NO effect -- the resolver ignores any 'role' argument not present on the SERVER-READ document", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["PARTS_ASSOCIATE"] });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    // A caller (e.g. a compromised/forged client payload) asserting a role
    // the server-side Employee document does not actually contain must
    // still DENY -- the resolver has no input channel for a client-
    // supplied role set at all, only the role NAME being checked, which
    // is always matched against the trusted Firestore-read list.
    assert.equal(resolver("ADMIN"), false);
    assert.equal(resolver("PARTS_MANAGER"), false);
    assert.equal(resolver("PARTS_ASSOCIATE"), true);
  });

  await check("EMULATOR fail-closed: a read failure never throws out of the builder, resolver denies every role", async () => {
    const brokenDb = {
      collection() {
        return {
          doc() {
            return { get: () => Promise.reject(new Error("simulated backend outage")) };
          },
        };
      },
    };
    const resolver = await buildOperationalRoleActiveResolver(brokenDb, "whoever");
    assert.equal(typeof resolver, "function");
    assert.equal(resolver("PARTS_MANAGER"), false);
    assert.equal(resolver("WAREHOUSE_MANAGER"), false);
  });

  await check("EMULATOR fail-closed: buildOperationalRoleActiveResolverFromEmployeeId also never throws on a read failure", async () => {
    const brokenDb = {
      collection() {
        return {
          doc() {
            return { get: () => Promise.reject(new Error("simulated backend outage")) };
          },
        };
      },
    };
    const resolver = await buildOperationalRoleActiveResolverFromEmployeeId(brokenDb, "whoever", "emp-x");
    assert.equal(resolver("PARTS_MANAGER"), false);
  });

  await check("EMULATOR: an unrelated update to a DIFFERENT employee's roles does not affect this principal's resolver", async () => {
    const { principalUid } = await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER"] });
    // A second, unrelated employee, ACTIVE, with a broader role set.
    await seedUserAndEmployee({ operationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"] });
    const resolver = await buildOperationalRoleActiveResolver(db, principalUid);
    assert.equal(resolver("WAREHOUSE_MANAGER"), false);
    assert.equal(resolver("PARTS_MANAGER"), true);
  });
}

async function main() {
  await pureChecks();
  await emulatorChecks();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
