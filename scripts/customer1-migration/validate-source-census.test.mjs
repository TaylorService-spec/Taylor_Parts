import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCensus } from './validate-source-census.mjs';

const base = () => ({
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

test('a fully answered census validates as COMPLETE', () => {
  const { errors, computedStatus } = validateCensus(base());
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'COMPLETE');
});

test('an UNKNOWN field cannot be declared COMPLETE', () => {
  const census = base();
  census.systems[0].exportFormat = 'UNKNOWN';
  const { errors, computedStatus } = validateCensus(census);
  assert.equal(computedStatus, 'INCOMPLETE');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /compute to "INCOMPLETE"/);
});

test('an unsourced domain cannot be declared COMPLETE', () => {
  const census = base();
  census.systems[0].holds = ['parts'];
  census.unsourcedDomains = ['inventory'];
  census.status = 'COMPLETE';
  const { errors } = validateCensus(census);
  assert.ok(errors.some((e) => /compute to "INCOMPLETE"/.test(e)));
});

test('a missing field is an error, not an implicit UNKNOWN', () => {
  const census = base();
  delete census.systems[0].identityKeys;
  const { errors } = validateCensus(census);
  assert.ok(errors.some((e) => /missing required field "identityKeys"/.test(e)));
});

test('a required domain must be claimed or explicitly unsourced', () => {
  const census = base();
  census.systems[0].holds = ['parts'];
  const { errors } = validateCensus(census);
  assert.ok(errors.some((e) => /"inventory" is neither claimed/.test(e)));
});

test('a domain cannot be both claimed and unsourced', () => {
  const census = base();
  census.unsourcedDomains = ['parts'];
  const { errors } = validateCensus(census);
  assert.ok(errors.some((e) => /both claimed by a system and listed as unsourced/.test(e)));
});

test('duplicate system ids are rejected', () => {
  const census = base();
  census.systems.push({ ...census.systems[0] });
  const { errors } = validateCensus(census);
  assert.ok(errors.some((e) => /is duplicated/.test(e)));
});

test('non-object input is rejected', () => {
  assert.equal(validateCensus(null).errors.length, 1);
  assert.equal(validateCensus([]).errors.length, 1);
});

test('the committed census is well-formed and honestly INCOMPLETE', () => {
  const census = JSON.parse(readFileSync('docs/customer-1/data/source-census.json', 'utf8'));
  const { errors, computedStatus } = validateCensus(census);
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'INCOMPLETE');
});
