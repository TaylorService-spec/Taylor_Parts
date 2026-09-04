import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readExport, parseDelimited, loadDirectory } from './read-export.mjs';
import { dryRun } from './dry-run.mjs';

const data = (name) => fileURLToPath(new URL(`../../docs/customer-1/data/${name}`, import.meta.url));
const load = (name) => JSON.parse(readFileSync(data(name), 'utf8'));

const contract = load('export-intake-contract.json');
const mappings = load('seeded/SEEDED-field-mappings.json');

const run = () => readExport(loadDirectory(data('seeded/export')), contract, mappings);

/** Build a one-file intake out of literal text, for the defects too corrupt to commit. */
const readText = (fileName, text) =>
  readExport([{ fileName, bytes: new TextEncoder().encode(text) }], contract, mappings);

test('the seeded export directory reads and the intake report completes', () => {
  const { errors, intake } = run();
  assert.deepEqual(errors, []);
  assert.equal(intake.counts.recordsAccepted, 5); // 3 parts + 2 inventory
});

test('rerunning the same directory produces byte-identical output (idempotent)', () => {
  assert.equal(JSON.stringify(run().intake), JSON.stringify(run().intake));
});

test('every seeded file defect surfaces as its own exception', () => {
  const { intake } = run();
  const kinds = (fileName) =>
    intake.exceptions.filter((e) => e.fileName === fileName).map((e) => `${e.row ?? ''}:${e.kind}`);

  assert.deepEqual(kinds('parts__SEEDED-PARTSDB.csv'), []);
  assert.deepEqual(kinds('inventory__SEEDED-PARTSDB.csv'), ['4:RAGGED_ROW', '5:BLANK_RECORD_ID']);
  assert.deepEqual(kinds('customers__SEEDED-SERVICE-XLS.csv'), [':MISSING_COLUMN']);
  assert.deepEqual(kinds('equipment__SEEDED-SERVICE-XLS.csv'), [':UNEXPECTED_COLUMN']);
  assert.deepEqual(kinds('serviceHistory__SEEDED-SERVICE-XLS.csv'), [':UNDECLARED_SOURCE']);
  assert.deepEqual(kinds('SEEDED-loose-export.csv'), [':UNPARSEABLE_FILE_NAME']);
  assert.deepEqual(kinds('SEEDED-README.md'), [':UNSUPPORTED_FORMAT']);
});

test('a file-level exception yields zero records from that file', () => {
  const { intake } = run();
  const rejected = intake.perFile.filter((f) => f.status === 'REJECTED');
  assert.equal(rejected.length, 5);
  assert.ok(rejected.every((f) => f.recordsAccepted === 0));
  assert.ok(!intake.source.records.some((r) => r.domain === 'equipment'));
});

test('a row-level exception rejects only that row', () => {
  const { intake } = run();
  const inventory = intake.source.records.filter((r) => r.domain === 'inventory').map((r) => r.recordId);
  assert.deepEqual(inventory, ['INV-1', 'INV-2']); // INV-3 ragged, the blank-id row dropped
});

test('the record-id column is stripped and never reaches the mapping stage', () => {
  const { intake } = run();
  const part = intake.source.records.find((r) => r.recordId === 'PART-1');
  assert.deepEqual(Object.keys(part.values).sort(), ['DESCR', 'LIST_PRICE', 'OBSOLETE_FLAG', 'PART_NO']);
});

test('quoting, embedded commas, doubled quotes, and padding survive intake verbatim', () => {
  const { intake } = run();
  const values = (id) => intake.source.records.find((r) => r.recordId === id).values;
  assert.equal(values('PART-1').PART_NO, ' SEED-001 ');
  assert.equal(values('PART-1').LIST_PRICE, '1,250.00');
  assert.equal(values('PART-3').DESCR, 'Seeded gasket, 2" bore');
});

test('a UTF-8 byte order mark is rejected before parsing', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
  const { intake } = readExport([{ fileName: 'parts__SEEDED-PARTSDB.csv', bytes }], contract, mappings);
  assert.equal(intake.exceptions[0].kind, 'ENCODING_NOT_UTF8');
});

test('bytes that are not valid UTF-8 are rejected before parsing', () => {
  const bytes = new Uint8Array([0x52, 0xff, 0xfe, 0x0a]);
  const { intake } = readExport([{ fileName: 'parts__SEEDED-PARTSDB.csv', bytes }], contract, mappings);
  assert.equal(intake.exceptions[0].kind, 'ENCODING_NOT_UTF8');
});

test('structural file defects each raise their own kind', () => {
  const cases = [
    ['', 'EMPTY_FILE'],
    ['RECORD_ID,PART_NO,DESCR,"LIST_PRICE\nPART-1,a,b,c\n', 'MALFORMED_DELIMITED'],
    ['PART_NO,DESCR,LIST_PRICE\nA,B,C\n', 'MISSING_RECORD_ID_COLUMN'],
    ['RECORD_ID,PART_NO,PART_NO,DESCR,LIST_PRICE\n', 'DUPLICATE_COLUMN'],
  ];
  for (const [text, kind] of cases) {
    const { intake } = readText('parts__SEEDED-PARTSDB.csv', text);
    assert.equal(intake.exceptions[0]?.kind, kind, `expected ${kind} for ${JSON.stringify(text)}`);
    assert.equal(intake.counts.recordsAccepted, 0);
  }
});

test('an unreadable file is an exception, not a crash', () => {
  const { intake } = readExport(
    [{ fileName: 'parts__SEEDED-PARTSDB.csv', bytes: null, readError: 'EACCES' }],
    contract,
    mappings
  );
  assert.equal(intake.exceptions[0].kind, 'UNREADABLE_FILE');
});

test('a contract the reader cannot honour is a hard error, not a silent default', () => {
  const xlsx = { ...contract, file: { ...contract.file, format: 'XLSX' } };
  const { errors, intake } = readExport([], xlsx, mappings);
  assert.equal(intake, null);
  assert.match(errors[0], /XLSX/);
});

test('parseDelimited handles CRLF, quoted newlines, and a trailing blank line', () => {
  const rows = parseDelimited('a,b\r\n"x\ny",z\n\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['x\ny', 'z'], ['']]);
});

test('intake output feeds the dry-run harness unchanged', () => {
  const census = load('seeded/SEEDED-source-census.json');
  const tiering = load('seeded/SEEDED-migration-tiering.json');
  const { errors, report } = dryRun(mappings, tiering, census, run().intake.source);
  assert.deepEqual(errors, []);
  assert.equal(report.counts.recordsRead, 5);
  assert.equal(report.counts.recordsMigrated, 2); // PART-1 and INV-1; the rest fail at mapping
});
