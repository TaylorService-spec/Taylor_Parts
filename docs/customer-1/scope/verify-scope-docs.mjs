#!/usr/bin/env node
// Customer 1 Lane A documentation proof.
// Checks: the ledger parses and is internally sane; every relative link in the
// Customer 1 docs resolves on disk; the ledger and the readiness page agree.
// Exits 0 on success, 1 with a printed failure list otherwise.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const ledgerPath = resolve(repoRoot, 'docs/customer-1/CUSTOMER_1_LEDGER.json');
const readinessPath = resolve(repoRoot, 'docs/customer-1/CUSTOMER_1_READINESS.md');
const matrixPath = resolve(here, 'DAY_1_SCOPE_MATRIX.md');

const failures = [];
const fail = (msg) => failures.push(msg);

const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
const readiness = await readFile(readinessPath, 'utf8');
const matrix = await readFile(matrixPath, 'utf8');

// 1. Ledger shape.
const vocabulary = new Set(ledger.statusVocabulary);
const seen = new Set();
for (const gate of ledger.gates) {
  if (seen.has(gate.id)) fail(`duplicate gate id: ${gate.id}`);
  seen.add(gate.id);
  if (!vocabulary.has(gate.status)) fail(`${gate.id}: status "${gate.status}" is not in statusVocabulary`);
  if (!gate.closeWhen) fail(`${gate.id}: missing closeWhen`);
  if (!gate.authority) fail(`${gate.id}: missing authority`);
}

// 2. Every gate is described on the readiness page, and vice versa.
for (const gate of seen) {
  if (!readiness.includes(gate)) fail(`${gate} is in the ledger but not in CUSTOMER_1_READINESS.md`);
}
for (const gate of readiness.match(/C1-[A-Z]+-\d+/g) ?? []) {
  if (!seen.has(gate)) fail(`${gate} is named in CUSTOMER_1_READINESS.md but not in the ledger`);
}

// 3. Relative markdown links resolve.
for (const [file, text, base] of [
  ['CUSTOMER_1_READINESS.md', readiness, dirname(readinessPath)],
  ['scope/DAY_1_SCOPE_MATRIX.md', matrix, here],
]) {
  for (const [, target] of text.matchAll(/\]\((\.[^)#]+)[^)]*\)/g)) {
    if (!existsSync(resolve(base, target))) fail(`${file}: dead link ${target}`);
  }
}

// 4. Lane A's own gates must not be silently declared closed by a document.
for (const gate of ledger.gates) {
  if (['C1-SCOPE-01', 'C1-PRODUCT-01'].includes(gate.id) && gate.status === 'READY') {
    fail(`${gate.id} is READY; acceptance is Taylor's and the Owner's, not a document's`);
  }
}

if (failures.length) {
  console.error(`FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS — ${ledger.gates.length} gates, ledger/readiness consistent, links resolve.`);
