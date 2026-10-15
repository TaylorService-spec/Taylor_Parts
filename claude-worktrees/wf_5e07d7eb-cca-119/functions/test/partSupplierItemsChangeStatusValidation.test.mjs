// Regression test: changePartSupplierItemStatus must validate itemId (and
// expectedVersion) BEFORE it is used as the audit targetId for the
// capability-denial path. Without that validation, an omitted/empty itemId
// reaches __pm_internal_requireCapabilityOrAudit -> recordStandaloneAuditEvent
// with targetId=undefined, and auditEventWriter's assertValid throws
// AuditEventValidationError("targetId is required") instead of the intended
// UnauthorizedActorError -- the denied-access attempt is never audited, and
// the caller gets a generic "internal" error.
//
// This test needs no Firestore/emulator: with the fix, the InvalidInputError
// is thrown before any db access, so a "poisoned" db (throws if touched)
// proves both (a) the correct error type and (b) that Firestore was never
// reached on the invalid-input path.
import assert from "node:assert/strict";
const { changePartSupplierItemStatus } = await import("../lib/partMaster/partSupplierItems.js");
const { InvalidInputError } = await import("../lib/partMaster/partMasterCommands.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const poisonDb = new Proxy({}, {
  get(_t, prop) {
    throw new Error(`db must not be touched before itemId/expectedVersion are validated (accessed .${String(prop)})`);
  },
});
const DEPS = { db: poisonDb, roles: {}, now: () => new Date(1750000000000) };

console.log("partSupplierItemsChangeStatusValidation.test.mjs");

await check("changeStatus: missing itemId rejected with InvalidInputError before any db access", async () => {
  await assert.rejects(
    changePartSupplierItemStatus({ actorUid: "actor-1", idempotencyKey: "key-12345678", itemId: undefined, expectedVersion: 1, newStatus: "INACTIVE" }, DEPS),
    InvalidInputError,
  );
});
await check("changeStatus: empty-string itemId rejected with InvalidInputError before any db access", async () => {
  await assert.rejects(
    changePartSupplierItemStatus({ actorUid: "actor-1", idempotencyKey: "key-12345678", itemId: "", expectedVersion: 1, newStatus: "INACTIVE" }, DEPS),
    InvalidInputError,
  );
});
await check("changeStatus: non-integer expectedVersion rejected with InvalidInputError before any db access", async () => {
  await assert.rejects(
    changePartSupplierItemStatus({ actorUid: "actor-1", idempotencyKey: "key-12345678", itemId: "P-1__SUP-A", expectedVersion: 0, newStatus: "INACTIVE" }, DEPS),
    InvalidInputError,
  );
});

console.log(`\npartSupplierItemsChangeStatusValidation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
