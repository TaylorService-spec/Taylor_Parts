// THE TECHNICIAN IDENTITY TRAP, made executable WITHOUT the Firestore emulator.
//
// ============================ THE DEFECT, IN ONE SENTENCE ============================
//
// `users/{uid}.technicianId` is a `fieldops_technicians` DOC ID
// (`field-ops-app-vite/src/domain/actorDisplayName.js:61` says so in as many words), and four
// server files spend it as `trucks.assignedDriverEmployeeId` -- a field whose declared authority is
// an EMPLOYEE id, queried with an `employeeId` at
// `functions/src/truckRegistry/truckRegistryRepository.ts:211`.
//
// Two different key spaces, one field. `functions/test/employeePrincipalLinkPlan.test.mjs` measures
// the live overlap: 13 technicians, 11 whose id coincides with an employee id, 2 that do not. So the
// read is right about 85% of the time for reasons no code states, which is the worst shape a defect
// can take -- it looks fine in every environment where the ids happen to line up.
//
// ============================ WHY THIS FILE EXISTS ============================
//
// The suites covering the deployed callables that spend it --
// `test/cycleCountAssignedMobileLocation.test.mjs`, `test/transferReceivableRead.test.mjs` and
// siblings -- are Firestore-emulator suites. They hard-default `FIRESTORE_EMULATOR_HOST` to
// 127.0.0.1:8080 and cannot run in every environment, so the defect has been carried forward
// repeatedly as "verified by suites nobody here can execute". That is not verification.
//
// `readAssignedMobileLocation()` takes its `Firestore` as a PARAMETER and touches it only through
// `collection().where().get()`. That is a seam, and a seam is all this needs: the cases below drive
// the real compiled resolver against a stub and prove the trap as BEHAVIOUR, offline, in
// milliseconds. Nothing here needs an emulator, a network, or a credential.
//
// ============================ WHAT THIS FILE IS NOT ============================
//
// It is a CHARACTERISATION of a defect that is still live, not a fix. The fix is to resolve the
// caller's Employee id through `resolveEmployeeIdForPrincipal()`
// (`src/employeeIdentity/employeePrincipalLinkRepository.ts`), which has no fallback chain -- null
// is a complete answer -- and it is a change to a deployed authorization path that has to be
// sequenced with `firestore.rules:363` and `:406-409`. When that lands, the two "documents the
// trap" cases below must be REWRITTEN, not deleted: they are the proof that the wrong id is no
// longer spent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { readAssignedMobileLocation } = await import(
  "../lib/workOrderConsumption/consumptionSourceService.js"
);

/**
 * The narrowest Firestore stub that can answer this query, so the assertions are about the
 * resolver's rule and not about a mock's cleverness. It records the field it was asked for, which
 * is itself one of the things under test.
 */
function stubTrucksDb(trucks) {
  const seen = [];
  return {
    seen,
    collection(name) {
      return {
        where(field, op, value) {
          seen.push({ collection: name, field, op, value });
          const docs = trucks
            .filter((t) => t[field] === value)
            .map((t) => ({ id: t.id, data: () => ({ ...t, id: undefined }) }));
          return { get: async () => ({ empty: docs.length === 0, docs }) };
        },
      };
    },
  };
}

// The live shape, from the census in employeePrincipalLinkPlan.test.mjs: most technicians' ids
// coincide with their employee id, and some do not.
const COINCIDING = "EMP-101";               // technicianId === employeeId — the common case
const ORPHAN_TECH = "tech-legacy-7";        // a technician doc id that is nobody's employee id
const ORPHAN_EMPLOYEE = "EMP-777";          // ...belonging to this Employee

const FLEET = [
  { id: "truck-a", assignedDriverEmployeeId: COINCIDING, locationId: "loc-a", status: "ACTIVE", displayLabel: "Van A" },
  { id: "truck-b", assignedDriverEmployeeId: ORPHAN_EMPLOYEE, locationId: "loc-b", status: "ACTIVE", displayLabel: "Van B" },
];

test("the resolver spends the value it is given as an EMPLOYEE id — that is the whole trap", async () => {
  // Not an implementation detail: this is the assertion that the two key spaces meet. The callable
  // boundary hands in users/{uid}.technicianId (cycleCountSheetCallables.ts:221-225,
  // transferReceivableRead.ts:92-96) and the field it lands in is the Truck Registry's driver
  // EMPLOYEE id (truckRegistryRepository.ts:211 queries the same field with an employeeId).
  const db = stubTrucksDb(FLEET);
  await readAssignedMobileLocation(db, COINCIDING);
  assert.deepEqual(db.seen, [
    { collection: "trucks", field: "assignedDriverEmployeeId", op: "==", value: COINCIDING },
  ]);
});

test("when the two ids COINCIDE the read is correct — which is why nobody has seen this fail", async () => {
  const { mobile, ambiguous } = await readAssignedMobileLocation(stubTrucksDb(FLEET), COINCIDING);
  assert.equal(ambiguous, false);
  assert.equal(mobile.truckId, "truck-a");
  assert.equal(mobile.locationId, "loc-a");
});

test("DOCUMENTS THE TRAP: a technician whose id is not an employee id cannot see their own truck", async () => {
  // ORPHAN_TECH drives truck-b. The truck says so — under their EMPLOYEE id. The callable hands in
  // their TECHNICIAN id, matches nothing, and the technician is told they have no assigned truck.
  // Fail-closed, and wrong: a Cycle Count counter is refused their own van
  // (cycleCountSheetCallables.ts:225), and Transfer receiving finds nothing to receive
  // (transferReceivableRead.ts:96).
  const { mobile, ambiguous } = await readAssignedMobileLocation(stubTrucksDb(FLEET), ORPHAN_TECH);
  assert.equal(mobile, null);
  assert.equal(ambiguous, false, "not ambiguous — the system is CONFIDENT there is no truck");

  // The same person, resolved by the authority the field actually declares, gets their van.
  const correct = await readAssignedMobileLocation(stubTrucksDb(FLEET), ORPHAN_EMPLOYEE);
  assert.equal(correct.mobile.truckId, "truck-b");
});

test("DOCUMENTS THE TRAP: a collision hands one person ANOTHER person's truck", async () => {
  // The failure that is not fail-closed, and the reason this is not merely cosmetic. Nothing
  // constrains the two key spaces to be disjoint: `fieldops_technicians` doc ids are legacy strings
  // and employee ids are minted elsewhere. Let one technician's DOC ID equal a different person's
  // EMPLOYEE id and the resolver answers confidently with the wrong van — and then Cycle Count will
  // count it, and Work Order consumption will decrement stock from it (planPhysicalConsumption.ts:87,
  // consumptionSourceService.ts:184). A misattributed inventory movement, with no error anywhere.
  const collidingFleet = [
    { id: "truck-c", assignedDriverEmployeeId: "SHARED-ID", locationId: "loc-c", status: "ACTIVE", displayLabel: "Someone else's van" },
  ];
  const caller = "SHARED-ID"; // this caller's users/{uid}.technicianId, NOT their employee id
  const { mobile, ambiguous } = await readAssignedMobileLocation(stubTrucksDb(collidingFleet), caller);
  assert.equal(ambiguous, false);
  assert.equal(mobile.truckId, "truck-c", "the wrong truck is returned as if it were governed truth");
});

test("two trucks for one id is refused rather than guessed — the one place it does fail closed", async () => {
  const twoVans = [
    { id: "truck-d", assignedDriverEmployeeId: COINCIDING, locationId: "loc-d", status: "ACTIVE" },
    { id: "truck-e", assignedDriverEmployeeId: COINCIDING, locationId: "loc-e", status: "ACTIVE" },
  ];
  const { mobile, ambiguous } = await readAssignedMobileLocation(stubTrucksDb(twoVans), COINCIDING);
  assert.equal(mobile, null);
  assert.equal(ambiguous, true);
});

test("the callable boundary really does hand a users/{uid}.technicianId straight to the resolver", async () => {
  // The behaviour above only matters if that is what the deployed code passes. This reads the two
  // sources rather than trusting the comment, so the characterisation cannot quietly become fiction
  // if the boundary is rewired. (The file-level census of every such site is
  // employeePrincipalLinkPlan.test.mjs's USER_TECHNICIAN_ID_READERS /
  // TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID ratchet; this is the wiring, not the census.)
  for (const file of ["src/cycleCount/cycleCountSheetCallables.ts", "src/inventoryTransfer/transferReceivableRead.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /\.technicianId/, `${file} no longer reads users/{uid}.technicianId`);
    assert.match(
      src,
      /readAssignedMobileLocation\(\s*db,\s*technicianId/,
      `${file} no longer passes that technician id into readAssignedMobileLocation`,
    );
  }
});

test("the replacement authority exists and answers with null rather than a fallback", async () => {
  // `resolveEmployeeIdForPrincipal()` is the correct question — "which Employee is this principal" —
  // and its whole point is that it has no second source to fall back to. Asserted at the source,
  // because the module is Postgres-backed and a live query is not available offline.
  const repo = readFileSync("src/employeeIdentity/employeePrincipalLinkRepository.ts", "utf8");
  assert.match(repo, /export async function resolveEmployeeIdForPrincipal/);
  // Comment lines stripped the way employeePrincipalLinkPlan.test.mjs strips them: both names DO
  // appear in this file's prose, and that is deliberate — `:218` names them to say it will never
  // read either. Naming a thing in order to refuse it is not a fallback.
  const code = repo
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");
  assert.ok(
    !/\.technicianId\b/.test(code),
    "the replacement authority must never read a technicianId — a fallback is the defect, restated",
  );
  assert.ok(
    !/fieldops_technicians/.test(code),
    "the replacement authority must not dereference the compatibility collection",
  );
});
