// O-4 — index drift guard invariants.
//
// Hermetic: fixtures + the repo's own firestore.indexes.json. No network.
// Run: node --test scripts/indexDriftGuard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { indexKey, compareIndexes, evaluateDeploy, normalizeGcloudIndexes } from './indexDriftGuard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const declared = JSON.parse(readFileSync(resolve(ROOT, 'firestore.indexes.json'), 'utf8')).indexes;

const liveJobsIndex = {
  collectionGroup: 'fieldops_jobs',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'technicianId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};

test('O-4: __name__ is ignored — Firestore appends it, declarations never carry it', () => {
  // Without this, EVERY live index would look undeclared and the guard would
  // cry wolf on every comparison.
  const withName = indexKey(liveJobsIndex);
  const withoutName = indexKey({
    collectionGroup: 'fieldops_jobs', queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'technicianId', order: 'ASCENDING' }, { fieldPath: 'status', order: 'ASCENDING' }],
  });
  assert.equal(withName, withoutName);
});

test('O-4: an undeclared live index is reported as a DESTRUCTIVE deletion', () => {
  const c = compareIndexes({ declared: [], live: [liveJobsIndex] });
  assert.equal(c.destructive, true);
  assert.equal(c.wouldDelete.length, 1);
  assert.equal(c.wouldDelete[0].index.collectionGroup, 'fieldops_jobs');
});

test('O-4: a destructive deploy is BLOCKED without explicit acknowledgement', () => {
  const c = compareIndexes({ declared: [], live: [liveJobsIndex] });
  const d = evaluateDeploy(c);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'DESTRUCTIVE_UNACKNOWLEDGED');
  assert.equal(d.unacknowledged.length, 1);
});

test('O-4: acknowledgement must NAME the exact index — no blanket force', () => {
  const c = compareIndexes({ declared: [], live: [liveJobsIndex] });
  assert.equal(evaluateDeploy(c, { acknowledgedDeletions: ['something-else'] }).allowed, false);
  assert.equal(evaluateDeploy(c, { acknowledgedDeletions: [indexKey(liveJobsIndex)] }).allowed, true);
});

test('O-4: an additive-only deploy is non-destructive and allowed', () => {
  const c = compareIndexes({ declared: [liveJobsIndex], live: [] });
  assert.equal(c.destructive, false);
  assert.equal(c.wouldCreate.length, 1);
  assert.equal(evaluateDeploy(c).allowed, true);
});

test('O-4: the repo now DECLARES the live fieldops_jobs index — deploy is non-destructive', () => {
  // The actual remediation: repo == live, so the silent-deletion path is closed.
  const c = compareIndexes({ declared, live: [liveJobsIndex] });
  assert.equal(c.destructive, false, 'fieldops_jobs index is still undeclared — a deploy would delete it');
});

test('O-4: gcloud output normalizes into comparable shape', () => {
  const raw = [{
    name: 'projects/p/databases/(default)/collectionGroups/fieldops_jobs/indexes/X',
    queryScope: 'COLLECTION', state: 'READY',
    fields: [{ fieldPath: 'technicianId', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }],
  }];
  const n = normalizeGcloudIndexes(raw);
  assert.equal(n[0].collectionGroup, 'fieldops_jobs');
  assert.equal(indexKey(n[0]), 'fieldops_jobs|COLLECTION|technicianId:ASCENDING');
});

// Previously "repo declares the six indexes that exist live" — declared and live were equal, so one
// number said both things. Wave 7 added an index that is declared but NOT yet deployed, so that
// sentence is no longer true and bumping 6 to 7 would have made the assertion assert a falsehood.
//
// The two facts are now pinned separately. `PENDING_DEPLOY_INDEX_KEYS` is the explicit, reviewable
// list of declarations that have not reached the live estate; everything else is expected live. An
// index added without being listed here fails this test, which is the drift this guard exists to
// catch. When a pooled deployment lands, the deployed key is REMOVED from this list, which is what
// turns it back into an assertion that declared == live.
// DECLARED BUT NOT LIVE — REGENERATED FROM A MEASUREMENT, 2026-08-24.
//
// This list previously named THIRTY-FIVE indexes as pending. Thirty-five of the declared indexes
// are LIVE. The list had it almost exactly inverted: it was written when the estate held eight
// composites and was never updated as the estate grew to thirty-eight, so it described a database
// that had not existed for months.
//
// It still PASSED, because the assertion below compared declared-minus-pending against the same
// stale eight. Two wrong numbers agreeing is not a check. This is the guard that produced this
// programme's most dangerous wrong claim -- that an index deploy would be "purely additive" when
// it would in fact have deleted three live indexes.
//
// Re-measured with `firebase firestore:indexes --project eos-platform-sandbox`:
//
//     38 live  ·  43 declared  ·  35 declared AND live  ·  8 declared and NOT live
//     3 live and NOT declared:  equipment_models × 3
//
// THE THREE UNDECLARED equipment_models COMPOSITES STAY UNDECLARED. D4 governs that collection and
// declares no compound index for it (functions/test/equipmentCompatibilityRegistry.test.mjs
// asserts exactly that), the collection is deny-all in Rules, and nothing queries it -- so those
// three serve no query at all. A deploy removing them is reconciliation clearing dead indexes, not
// a loss. That is the OPPOSITE of what this programme previously recorded, and the correction
// matters: "a deploy would delete three live indexes" was the stated reason index deploys stayed
// blocked.
//
// When a deploy really lands, the deployed key is REMOVED from this list, which is what turns it
// back into an assertion that declared == live.
const PENDING_DEPLOY_INDEX_KEYS = new Set([
  // The Line of Business filter on the Customers list. Firestore serves ONE array filter per
  // query, so this adds its own index family rather than combining with relationshipTypes -- there
  // is deliberately no relationshipTypes+lineOfBusiness index, because no index can serve it.
  'accounts|COLLECTION|lineOfBusiness:CONTAINS,updatedAt:DESCENDING',
  'accounts|COLLECTION|status:ASCENDING,lineOfBusiness:CONTAINS,updatedAt:DESCENDING',
  // Priority and Type filters on Work Orders. Every list offered exactly as many filters as its
  // collection had LIVE composites, so "+ Add Filter" opened onto almost nothing. Each needs a
  // composite with the list's default sort, and one with status too, because a dispatcher filters
  // status AND one more thing far more often than either alone.
  'fieldops_wos|COLLECTION|priority:ASCENDING,createdAt:DESCENDING',
  'fieldops_wos|COLLECTION|status:ASCENDING,priority:ASCENDING,createdAt:DESCENDING',
  'fieldops_wos|COLLECTION|type:ASCENDING,createdAt:DESCENDING',
  'fieldops_wos|COLLECTION|status:ASCENDING,type:ASCENDING,createdAt:DESCENDING',
  // "This customer's orders" is the first question anybody asks of a Sales Order list and has never
  // been answerable: sales_orders had exactly ONE live composite.
  'sales_orders|COLLECTION|accountId:ASCENDING,salesOrderNumber:DESCENDING',
  'sales_orders|COLLECTION|state:ASCENDING,accountId:ASCENDING,salesOrderNumber:DESCENDING',
]);

test('O-4: every declared index is either live or explicitly listed as pending deploy', () => {
  const pending = declared.filter((i) => PENDING_DEPLOY_INDEX_KEYS.has(indexKey(i)));
  const expectedLive = declared.length - pending.length;

  // THE LIVE COUNT WAS WRONG, AND THAT IS WHY THIS GUARD COULD NOT SEE DRIFT.
  //
  // It said EIGHT, describing an estate from the sandbox convergence deployment. Re-measured
  // 2026-08-24 against `firebase firestore:indexes --project eos-platform-sandbox`:
  //
  //     38 live  -  43 declared  -  35 declared AND live  -  8 declared, not live
  //     3 live and NOT declared: equipment_models x3
  //
  // The stale 8 passed only because declared-minus-pending happened to equal it, so the guard
  // asserted a coincidence rather than the estate. It is the guard that produced this programme's
  // most dangerous wrong claim -- that an index deploy was "purely additive" when it would have
  // deleted three live indexes.
  //
  // THE THREE UNDECLARED equipment_models COMPOSITES ARE LEFT UNDECLARED, deliberately. D4 governs
  // that collection and declares no compound index for it (functions/test/
  // equipmentCompatibilityRegistry.test.mjs asserts exactly that); the collection is deny-all in
  // Rules and nothing queries it, so those three serve no query. A deploy removing them is
  // reconciliation clearing dead indexes, not a loss -- which is the opposite of what this
  // programme previously recorded, and the correction matters because it was the stated reason
  // index deploys stayed blocked.
  //
  // A comparison against a MEASURED number, not a remembered one. When a deploy really lands,
  // both sides move together and the pending list shrinks.
  assert.equal(expectedLive, 35, 'declared-minus-pending must match the live index count (35 declared AND live of 38 live)');
  assert.equal(pending.length, PENDING_DEPLOY_INDEX_KEYS.size, 'a pending key was listed but not declared');
  assert.ok(declared.some((i) => i.collectionGroup === 'fieldops_jobs'));
});
