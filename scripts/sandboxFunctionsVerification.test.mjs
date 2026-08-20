// EOS-ISSUE-1062 -- tests for the sandbox Functions verification pure core.
//
// Hermetic: no network, no filesystem, no `gcloud`. Every payload is a
// fixture, so CI never depends on a live deployment.
//
// Run: node --test scripts/sandboxFunctionsVerification.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_STATE,
  REQUIRED_RUNTIME,
  parseArgs,
  parseFunctionsListPayload,
  evaluateFunction,
  evaluateAll,
  formatResults,
  overallExitCode,
} from './sandboxFunctionsVerification.mjs';

// --------------------------------------------------------------- parseArgs

test('parseArgs: accepts --project plus positional function names', () => {
  const { project, functions, errors } = parseArgs(['--project', 'eos-platform-sandbox', 'createSupplier', 'grantRole']);
  assert.equal(project, 'eos-platform-sandbox');
  assert.deepEqual(functions, ['createSupplier', 'grantRole']);
  assert.deepEqual(errors, []);
});

test('parseArgs: accepts repeated --function flags', () => {
  const { project, functions, errors } = parseArgs([
    '--project', 'eos-platform-sandbox',
    '--function', 'createSupplier',
    '--function', 'grantRole',
  ]);
  assert.equal(project, 'eos-platform-sandbox');
  assert.deepEqual(functions, ['createSupplier', 'grantRole']);
  assert.deepEqual(errors, []);
});

test('parseArgs: missing --project fails closed', () => {
  const { errors } = parseArgs(['createSupplier']);
  assert.ok(errors.some((e) => /--project/.test(e)));
});

test('parseArgs: missing function names fails closed', () => {
  const { errors } = parseArgs(['--project', 'eos-platform-sandbox']);
  assert.ok(errors.some((e) => /callable name/.test(e)));
});

test('parseArgs: both missing fails closed with both reasons', () => {
  const { errors } = parseArgs([]);
  assert.equal(errors.length, 2);
});

test('parseArgs: unrecognized flag is reported', () => {
  const { errors } = parseArgs(['--project', 'p', 'fn', '--bogus']);
  assert.ok(errors.some((e) => /Unrecognized flag/.test(e)));
});

// -------------------------------------------------- parseFunctionsListPayload

const LIST_PAYLOAD = JSON.stringify([
  { id: 'createSupplier', state: 'ACTIVE', runtime: 'nodejs22' },
  { id: 'grantRole', state: 'ACTIVE', runtime: 'nodejs20' },
  { id: 'deactivateSupplier', state: 'DEPLOYING', runtime: 'nodejs22' },
]);

test('parseFunctionsListPayload: parses a well-formed gcloud --v2 array', () => {
  const r = parseFunctionsListPayload(LIST_PAYLOAD);
  assert.equal(r.ok, true);
  assert.equal(r.functions.get('createSupplier').state, 'ACTIVE');
  assert.equal(r.functions.get('createSupplier').runtime, 'nodejs22');
});

test('parseFunctionsListPayload: falls back to the last segment of `name`', () => {
  const r = parseFunctionsListPayload(JSON.stringify([
    { name: 'projects/p/locations/us-central1/functions/createSupplier', state: 'ACTIVE', buildConfig: { runtime: 'nodejs22' } },
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.functions.get('createSupplier').state, 'ACTIVE');
  assert.equal(r.functions.get('createSupplier').runtime, 'nodejs22');
});

test('parseFunctionsListPayload: malformed JSON fails closed', () => {
  const r = parseFunctionsListPayload('{not json');
  assert.equal(r.ok, false);
});

test('parseFunctionsListPayload: non-array JSON fails closed', () => {
  const r = parseFunctionsListPayload(JSON.stringify({ status: 'success' }));
  assert.equal(r.ok, false);
});

// --------------------------------------------------------------- evaluation

test('evaluateFunction: ACTIVE + nodejs22 evaluates PASS', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const r = evaluateFunction('createSupplier', functions);
  assert.equal(r.verdict, 'PASS');
});

test('evaluateFunction: missing function evaluates FAIL', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const r = evaluateFunction('doesNotExist', functions);
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /not found/);
});

test('evaluateFunction: wrong runtime evaluates FAIL', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const r = evaluateFunction('grantRole', functions);
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /runtime/);
});

test('evaluateFunction: non-ACTIVE state evaluates FAIL', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const r = evaluateFunction('deactivateSupplier', functions);
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /state/);
});

test('evaluateAll: mixed results preserve requested order', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const results = evaluateAll(['createSupplier', 'doesNotExist', 'grantRole'], functions);
  assert.deepEqual(results.map((r) => r.name), ['createSupplier', 'doesNotExist', 'grantRole']);
  assert.deepEqual(results.map((r) => r.verdict), ['PASS', 'FAIL', 'FAIL']);
});

test('overallExitCode: 0 only when every result is PASS', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  assert.equal(overallExitCode(evaluateAll(['createSupplier'], functions)), 0);
  assert.equal(overallExitCode(evaluateAll(['createSupplier', 'grantRole'], functions)), 1);
});

test('formatResults: one PASS/FAIL line per callable', () => {
  const { functions } = parseFunctionsListPayload(LIST_PAYLOAD);
  const results = evaluateAll(['createSupplier', 'doesNotExist'], functions);
  const text = formatResults(results);
  assert.match(text, /PASS {2}createSupplier:/);
  assert.match(text, /FAIL {2}doesNotExist:/);
});

test('constants: required state and runtime match the mandate', () => {
  assert.equal(REQUIRED_STATE, 'ACTIVE');
  assert.equal(REQUIRED_RUNTIME, 'nodejs22');
});
