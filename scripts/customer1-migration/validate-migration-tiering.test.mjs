import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTiering } from './validate-migration-tiering.mjs';

const census = () => ({
  schemaVersion: 1,
  gate: 'C1-DATA-01',
  status: 'COMPLETE',
  requiredDomains: ['parts', 'inventory'],
  unsourcedDomains: [],
  systems: [
    {
      id: 'legacy-erp',
      name: 'Example ERP',
      vendor: 'Example Co',
      kind: 'on-prem database',
      holds: ['parts', 'inventory'],
      accessMethod: 'nightly CSV export',
      exportFormat: 'CSV',
      recordVolume: '41000 parts',
      identityKeys: 'part_number',
      taylorOwner: 'Operations Manager',
      notes: '',
    },
  ],
});

const tiering = () => ({
  schemaVersion: 1,
  gate: 'C1-DATA-01',
  status: 'ACCEPTED',
  tiers: ['DAY_1', 'HISTORICAL_REFERENCE', 'NOT_MIGRATED'],
  domains: [
    {
      domain: 'parts',
      tier: 'DAY_1',
      sourceSystemIds: ['legacy-erp'],
      rationale: 'Techs cannot quote without the catalogue.',
      taylorAcceptance: '2026-09-04 Operations Manager',
    },
    {
      domain: 'inventory',
      tier: 'DAY_1',
      sourceSystemIds: ['legacy-erp'],
      rationale: 'Opening balances are needed to sell.',
      taylorAcceptance: '2026-09-04 Operations Manager',
    },
  ],
});

test('a fully decided tiering over a complete census is ACCEPTED', () => {
  const { errors, computedStatus } = validateTiering(tiering(), census());
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'ACCEPTED');
});

test('an UNDECIDED tier cannot be declared ACCEPTED', () => {
  const t = tiering();
  t.domains[0].tier = 'UNDECIDED';
  t.domains[0].sourceSystemIds = [];
  const { errors, computedStatus } = validateTiering(t, census());
  assert.equal(computedStatus, 'PROPOSED');
  assert.ok(errors.some((e) => /compute to "PROPOSED"/.test(e)));
});

test('tiering cannot be ACCEPTED while the census is INCOMPLETE', () => {
  const c = census();
  c.systems[0].exportFormat = 'UNKNOWN';
  c.status = 'INCOMPLETE';
  const { errors, computedStatus } = validateTiering(tiering(), c);
  assert.equal(computedStatus, 'PROPOSED');
  assert.ok(errors.some((e) => /census is INCOMPLETE/.test(e)));
});

test('a moving domain must name a source system', () => {
  const t = tiering();
  t.domains[0].sourceSystemIds = [];
  const { errors } = validateTiering(t, census());
  assert.ok(errors.some((e) => /tiered "DAY_1" but names no source system/.test(e)));
});

test('a source system must exist in the census', () => {
  const t = tiering();
  t.domains[0].sourceSystemIds = ['ghost-system'];
  const { errors } = validateTiering(t, census());
  assert.ok(errors.some((e) => /"ghost-system", which is not a system in the census/.test(e)));
});

test('NOT_MIGRATED cannot name source systems', () => {
  const t = tiering();
  t.domains[0].tier = 'NOT_MIGRATED';
  const { errors } = validateTiering(t, census());
  assert.ok(errors.some((e) => /"NOT_MIGRATED" but names source systems/.test(e)));
});

test('every census-required domain must be tiered exactly once', () => {
  const missing = tiering();
  missing.domains.pop();
  assert.ok(
    validateTiering(missing, census()).errors.some((e) => /"inventory".*is not tiered/.test(e))
  );

  const duplicated = tiering();
  duplicated.domains.push({ ...duplicated.domains[0] });
  assert.ok(
    validateTiering(duplicated, census()).errors.some((e) => /tiered more than once/.test(e))
  );
});

test('a rationale is mandatory', () => {
  const t = tiering();
  t.domains[0].rationale = '   ';
  const { errors } = validateTiering(t, census());
  assert.ok(errors.some((e) => /rationale must say why/.test(e)));
});

test('a missing field is an error, not an implicit UNKNOWN', () => {
  const t = tiering();
  delete t.domains[0].taylorAcceptance;
  const { errors } = validateTiering(t, census());
  assert.ok(errors.some((e) => /missing required field "taylorAcceptance"/.test(e)));
});

test('non-object input is rejected', () => {
  assert.equal(validateTiering(null, census()).errors.length, 1);
  assert.equal(validateTiering(tiering(), []).errors.length, 1);
});

test('the committed tiering is well-formed and honestly PROPOSED', () => {
  const t = JSON.parse(readFileSync('docs/customer-1/data/migration-tiering.json', 'utf8'));
  const c = JSON.parse(readFileSync('docs/customer-1/data/source-census.json', 'utf8'));
  const { errors, computedStatus } = validateTiering(t, c);
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'PROPOSED');
});
