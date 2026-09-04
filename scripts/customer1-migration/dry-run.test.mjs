import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dryRun } from './dry-run.mjs';

const load = (name) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../docs/customer-1/data/seeded/${name}`, import.meta.url)), 'utf8')
  );

const census = load('SEEDED-source-census.json');
const tiering = load('SEEDED-migration-tiering.json');
const mappings = load('SEEDED-field-mappings.json');
const source = load('SEEDED-source-records.json');

const run = () => dryRun(mappings, tiering, census, source);

test('the seeded chain validates and the dry run completes', () => {
  const { errors, report } = run();
  assert.deepEqual(errors, []);
  assert.equal(report.counts.recordsRead, source.records.length);
});

test('rerunning the same inputs produces byte-identical output (idempotent)', () => {
  assert.equal(JSON.stringify(run().report), JSON.stringify(run().report));
});

test('every seeded defect surfaces as its own exception', () => {
  const { report } = run();
  const kinds = (recordId) =>
    report.exceptions.filter((e) => e.recordId === recordId).map((e) => `${e.sourceField}:${e.kind}`);

  assert.deepEqual(kinds('PART-2'), ['DESCR:MISSING_VALUE']);
  assert.deepEqual(kinds('PART-3'), ['LIST_PRICE:TRANSFORM_FAILED', 'SUPERSEDED_BY:UNMAPPED_SOURCE_FIELD']);
  assert.deepEqual(kinds('INV-2'), ['QTY_ON_HAND:TRANSFORM_FAILED']);
  assert.deepEqual(kinds('SVC-1'), ['null:DOMAIN_DOES_NOT_MOVE']);
  assert.deepEqual(kinds('EQ-9'), ['null:UNEXPECTED_SOURCE_SYSTEM']);
  assert.deepEqual(kinds('CUST-1'), ['null:DUPLICATE_RECORD_ID']);
});

test('a record with any exception is rejected whole, never half-migrated', () => {
  const { report } = run();
  const migrated = report.records.map((r) => r.recordId);
  assert.deepEqual(migrated.sort(), ['CUST-1', 'EQ-1', 'INV-1', 'PART-1']);
  assert.equal(report.counts.recordsRejected, source.records.length - migrated.length);
  for (const recordId of migrated) {
    assert.equal(report.exceptions.some((e) => e.recordId === recordId && e.kind !== 'DUPLICATE_RECORD_ID'), false);
  }
});

test('transforms normalise the values that do land', () => {
  const { report } = run();
  const part = report.records.find((r) => r.recordId === 'PART-1');
  assert.deepEqual(part.target, {
    'parts.description': 'Seeded compressor',
    'parts.listPrice': 1250,
    'parts.partNumber': 'SEED-001',
  });
  const equipment = report.records.find((r) => r.recordId === 'EQ-1');
  assert.equal(equipment.target['equipment.modelNumber'], 'TF-200');
});

test('an unvalidated mapping chain refuses to run at all', () => {
  const broken = { ...mappings, status: 'ACCEPTED', fields: [...mappings.fields, mappings.fields[0]] };
  const { errors, report } = dryRun(broken, tiering, census, source);
  assert.equal(report, null);
  assert.ok(errors.every((e) => e.startsWith('mapping chain: ')));
});

test('a mapping naming an unimplemented transform is an exception, not a crash', () => {
  const patched = {
    ...mappings,
    fields: mappings.fields.map((f) =>
      f.sourceField === 'MODEL' ? { ...f, transform: 'soundex' } : f
    ),
  };
  const { report } = dryRun(patched, tiering, census, source);
  assert.ok(
    report.exceptions.some((e) => e.recordId === 'EQ-1' && e.kind === 'UNSUPPORTED_TRANSFORM')
  );
});
