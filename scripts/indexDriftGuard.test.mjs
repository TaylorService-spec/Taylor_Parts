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
const PENDING_DEPLOY_INDEX_KEYS = new Set([
  // Declared by the Account metadata definition (#1137), NOT yet deployed. Index
  // deployment is a separate authorized action, so account.index's declared filters are
  // a promise the repository keeps and the environment does not yet -- and listing the
  // key here states that gap rather than letting the guard read as drift.
  'accounts|COLLECTION|status:ASCENDING,updatedAt:DESCENDING',
  'accounts|COLLECTION|relationshipTypes:CONTAINS,updatedAt:DESCENDING',
  'accounts|COLLECTION|status:ASCENDING,relationshipTypes:CONTAINS,updatedAt:DESCENDING',
  // Declared by the Work Order metadata definition (Gate B). The other two shapes it
  // demands were already live before the definition existed.
  'fieldops_wos|COLLECTION|status:ASCENDING,customerId:ASCENDING,createdAt:DESCENDING',
  // Declared by the operational board scope contract: all three of its queries filter
  // status IN (an equality) plus a scheduledStart range or equality.
  'fieldops_wos|COLLECTION|status:ASCENDING,scheduledStart:ASCENDING',
  // Declared by the Contact and Opportunity definitions (first Account related-list
  // dependencies). Opportunities are CALLABLE-read, so this serves the server's own query.
  'contacts|COLLECTION|accountId:ASCENDING,name:ASCENDING',
  'opportunities|COLLECTION|stage:ASCENDING,expectedCloseAt:ASCENDING',
  // Declared by the Sales Order definition (S-CRM-SALES-ORDER-DEFINITION). Sales Orders are
  // CALLABLE-read like Opportunities, so this serves the server's own listSalesOrdersForAccount
  // query shape, not a client-direct read.
  'sales_orders|COLLECTION|state:ASCENDING,salesOrderNumber:DESCENDING',
  //
  // The Cycle Count serialized_assets(partId, currentLocationId, inventoryState) composite was the
  // last pending entry; the sandbox convergence deployment shipped it, so it was removed here. That
  // removal is the point of this list -- it is what turns the assertion below back into a strict
  // declared == live check. Leaving a deployed key listed would let a genuinely undeclared index
  // hide behind it, which is the drift this guard exists to catch.
]);

test('O-4: every declared index is either live or explicitly listed as pending deploy', () => {
  const pending = declared.filter((i) => PENDING_DEPLOY_INDEX_KEYS.has(indexKey(i)));
  const expectedLive = declared.length - pending.length;

  // The live estate is EIGHT indexes as of the sandbox convergence deployment, which shipped the
  // serialized_assets(partId, currentLocationId, inventoryState) composite. This number only moves
  // when a deployment really happens -- it moved from seven to eight because one did, verified
  // against `firebase firestore:indexes --project eos-platform-sandbox` (8 live, 8 declared).
  assert.equal(expectedLive, 8, 'declared-minus-pending must match the live index count');
  assert.equal(pending.length, PENDING_DEPLOY_INDEX_KEYS.size, 'a pending key was listed but not declared');
  assert.ok(declared.some((i) => i.collectionGroup === 'fieldops_jobs'));
});
