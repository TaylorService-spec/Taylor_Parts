import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOpeningInventory } from './validate-opening-inventory.mjs';

const census = () => ({
  schemaVersion: 1,
  gate: 'C1-DATA-01',
  status: 'COMPLETE',
  requiredDomains: ['inventory'],
  unsourcedDomains: [],
  systems: [
    {
      id: 'legacy-erp',
      name: 'Example ERP',
      vendor: 'Example Co',
      kind: 'on-prem database',
      holds: ['inventory'],
      accessMethod: 'nightly CSV export',
      exportFormat: 'CSV',
      recordVolume: '9000 stock lines',
      identityKeys: 'part_number',
      taylorOwner: 'Operations Manager',
      notes: '',
    },
  ],
});

const scope = (name) => ({
  scope: name,
  inScope: 'Phoenix warehouse',
  countMethod: 'full physical count, trucks grounded',
  countPerformedBy: 'Taylor warehouse staff',
  systemBalanceSourceIds: ['legacy-erp'],
  varianceDisposition: 'variances over 2 units written off with Operations Manager sign-off',
  taylorAcceptance: '2026-09-04 Operations Manager',
  notes: '',
});

const record = () => ({
  schemaVersion: 1,
  gate: 'C1-INV-01',
  status: 'ACCEPTED',
  requiredScopes: ['warehouse', 'bin', 'truck', 'serialized'],
  scopes: ['warehouse', 'bin', 'truck', 'serialized'].map(scope),
  acceptance: {
    acceptedBy: 'Operations Manager, Taylor Freezer of Arizona',
    acceptedOn: '2026-09-04',
    statement: 'The opening balances above are the operational baseline.',
  },
});

test('a fully reconciled and accepted record over a complete census is ACCEPTED', () => {
  const { errors, computedStatus } = validateOpeningInventory(record(), census());
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'ACCEPTED');
});

test('an UNKNOWN field cannot be declared ACCEPTED', () => {
  const r = record();
  r.scopes[0].countMethod = 'UNKNOWN';
  const { errors, computedStatus } = validateOpeningInventory(r, census());
  assert.equal(computedStatus, 'DRAFT');
  assert.ok(errors.some((e) => /compute to "DRAFT"/.test(e)));
});

test('acceptance cannot be ACCEPTED while the census is INCOMPLETE', () => {
  const c = census();
  c.systems[0].exportFormat = 'UNKNOWN';
  c.status = 'INCOMPLETE';
  const { errors, computedStatus } = validateOpeningInventory(record(), c);
  assert.equal(computedStatus, 'DRAFT');
  assert.ok(errors.some((e) => /census is INCOMPLETE/.test(e)));
});

test('Verenward cannot accept the count on Taylor\'s behalf', () => {
  const r = record();
  r.acceptance.acceptedBy = 'Verenward, on behalf of Taylor';
  assert.ok(
    validateOpeningInventory(r, census()).errors.some((e) => /Verenward cannot accept/.test(e))
  );

  const s = record();
  s.scopes[2].taylorAcceptance = 'accepted by the lane B automation';
  assert.ok(
    validateOpeningInventory(s, census()).errors.some((e) => /names the building party/.test(e))
  );
});

test('every required custody scope is reconciled exactly once', () => {
  const missing = record();
  missing.scopes.pop();
  assert.ok(
    validateOpeningInventory(missing, census()).errors.some((e) =>
      /"serialized" is not reconciled/.test(e)
    )
  );

  const duplicated = record();
  duplicated.scopes.push({ ...duplicated.scopes[0] });
  assert.ok(
    validateOpeningInventory(duplicated, census()).errors.some((e) =>
      /reconciled more than once/.test(e)
    )
  );
});

test('a system balance source must exist in the census', () => {
  const r = record();
  r.scopes[0].systemBalanceSourceIds = ['ghost-system'];
  const { errors } = validateOpeningInventory(r, census());
  assert.ok(errors.some((e) => /"ghost-system", which is not a system in the census/.test(e)));
});

test('an accepted scope must name what it reconciled against', () => {
  const r = record();
  r.scopes[1].systemBalanceSourceIds = [];
  const { errors } = validateOpeningInventory(r, census());
  assert.ok(errors.some((e) => /names no system balance/.test(e)));
});

test('a missing field is an error, not an implicit UNKNOWN', () => {
  const r = record();
  delete r.scopes[0].countPerformedBy;
  assert.ok(
    validateOpeningInventory(r, census()).errors.some((e) =>
      /missing required field "countPerformedBy"/.test(e)
    )
  );

  const a = record();
  delete a.acceptance.acceptedOn;
  assert.ok(
    validateOpeningInventory(a, census()).errors.some((e) =>
      /missing required field "acceptedOn"/.test(e)
    )
  );
});

test('non-object input is rejected', () => {
  assert.equal(validateOpeningInventory(null, census()).errors.length, 1);
  assert.equal(validateOpeningInventory(record(), []).errors.length, 1);
});

test('the committed reconciliation is well-formed and honestly DRAFT', () => {
  const r = JSON.parse(
    readFileSync('docs/customer-1/data/opening-inventory-reconciliation.json', 'utf8')
  );
  const c = JSON.parse(readFileSync('docs/customer-1/data/source-census.json', 'utf8'));
  const { errors, computedStatus } = validateOpeningInventory(r, c);
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'DRAFT');
});
