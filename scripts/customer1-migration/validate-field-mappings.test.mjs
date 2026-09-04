import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFieldMappings } from './validate-field-mappings.mjs';

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

const mapped = (domain, sourceField) => ({
  domain,
  sourceSystemId: 'legacy-erp',
  sourceField,
  disposition: 'MAPPED',
  targetField: `parts.${sourceField}`,
  transform: 'trim, uppercase',
  rationale: 'Direct equivalent.',
  taylorAcceptance: '2026-09-04 Operations Manager',
});

const mappings = () => ({
  schemaVersion: 1,
  gate: 'C1-DATA-01',
  status: 'ACCEPTED',
  dispositions: ['MAPPED', 'NOT_MIGRATED', 'NO_TARGET', 'UNRESOLVED'],
  fields: [mapped('parts', 'part_number'), mapped('inventory', 'qty_on_hand')],
  domainsWithoutMappings: [],
});

test('a fully dispositioned mapping over an accepted tiering is ACCEPTED', () => {
  const { errors, computedStatus } = validateFieldMappings(mappings(), tiering(), census());
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'ACCEPTED');
});

test('mappings cannot be ACCEPTED over a PROPOSED tiering', () => {
  const t = tiering();
  t.domains[0].taylorAcceptance = 'UNKNOWN';
  t.status = 'PROPOSED';
  const { errors, computedStatus } = validateFieldMappings(mappings(), t, census());
  assert.equal(computedStatus, 'PROPOSED');
  assert.ok(errors.some((e) => /tiering is PROPOSED/.test(e)));
});

test('an UNRESOLVED field keeps the record PROPOSED', () => {
  const m = mappings();
  m.fields[0] = {
    ...m.fields[0],
    disposition: 'UNRESOLVED',
    targetField: null,
    transform: null,
    rationale: 'Two systems disagree on the part number; raised to Taylor.',
  };
  const { errors, computedStatus } = validateFieldMappings(m, tiering(), census());
  assert.equal(computedStatus, 'PROPOSED');
  assert.ok(errors.some((e) => /compute to "PROPOSED"/.test(e)));
});

test('a MAPPED field must name a target and a transform', () => {
  const m = mappings();
  m.fields[0].targetField = '  ';
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /targetField must be named for a MAPPED field/.test(e)));
});

test('a non-MAPPED field may not name a target', () => {
  const m = mappings();
  m.fields[0].disposition = 'NOT_MIGRATED';
  m.fields[0].transform = null;
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /targetField must be null when the disposition is/.test(e)));
});

test('a field cannot belong to a domain the tiering does not move', () => {
  const t = tiering();
  t.domains[0].tier = 'NOT_MIGRATED';
  t.domains[0].sourceSystemIds = [];
  const { errors } = validateFieldMappings(mappings(), t, census());
  assert.ok(errors.some((e) => /"parts" is not a domain the tiering says moves/.test(e)));
});

test('a field cannot cite a system the tiering does not name for that domain', () => {
  const m = mappings();
  m.fields[0].sourceSystemId = 'some-other-system';
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /is not a source the tiering names for domain "parts"/.test(e)));
});

test('a moving domain must be mapped or explicitly listed as unmapped', () => {
  const m = mappings();
  m.fields.pop();
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(
    errors.some((e) => /"inventory" moves but has no field mappings and is not listed/.test(e))
  );

  const listed = mappings();
  listed.fields.pop();
  listed.domainsWithoutMappings = ['inventory'];
  const result = validateFieldMappings(listed, tiering(), census());
  assert.equal(result.computedStatus, 'PROPOSED');
  assert.ok(!result.errors.some((e) => /moves but has no field mappings/.test(e)));
});

test('a domain cannot be both mapped and listed as unmapped', () => {
  const m = mappings();
  m.domainsWithoutMappings = ['parts'];
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /both mapped and listed in domainsWithoutMappings/.test(e)));
});

test('the same source field cannot be dispositioned twice', () => {
  const m = mappings();
  m.fields.push({ ...m.fields[0] });
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /a second time for the same source/.test(e)));
});

test('a missing field is an error, not an implicit UNKNOWN', () => {
  const m = mappings();
  delete m.fields[0].taylorAcceptance;
  const { errors } = validateFieldMappings(m, tiering(), census());
  assert.ok(errors.some((e) => /missing required field "taylorAcceptance"/.test(e)));
});

test('non-object input is rejected', () => {
  assert.equal(validateFieldMappings(null, tiering(), census()).errors.length, 1);
  assert.equal(validateFieldMappings(mappings(), [], census()).errors.length, 1);
  assert.equal(validateFieldMappings(mappings(), tiering(), null).errors.length, 1);
});

test('the committed mappings are well-formed and honestly PROPOSED', () => {
  const m = JSON.parse(readFileSync('docs/customer-1/data/field-mappings.json', 'utf8'));
  const t = JSON.parse(readFileSync('docs/customer-1/data/migration-tiering.json', 'utf8'));
  const c = JSON.parse(readFileSync('docs/customer-1/data/source-census.json', 'utf8'));
  const { errors, computedStatus } = validateFieldMappings(m, t, c);
  assert.deepEqual(errors, []);
  assert.equal(computedStatus, 'PROPOSED');
});
