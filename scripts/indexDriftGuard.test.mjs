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

test('O-4: repo declares the six indexes that exist live', () => {
  assert.equal(declared.length, 6);
  assert.ok(declared.some((i) => i.collectionGroup === 'fieldops_jobs'));
});
