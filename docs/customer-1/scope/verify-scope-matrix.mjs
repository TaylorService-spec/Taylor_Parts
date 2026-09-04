#!/usr/bin/env node
// Verifies the Customer 1 Day-1 scope matrix against the gate ledger.
// Charter proof for Lane A documentation items: JSON parse of the ledger,
// internal link resolution, and ledger/readiness consistency.
// Exits 0 on success, 1 with one line per failure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scopeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scopeDir, '../../..');
const rel = (p) => resolve(repoRoot, p);

const MATRIX = 'docs/customer-1/scope/DAY_1_SCOPE_MATRIX.md';
const LEDGER = 'docs/customer-1/CUSTOMER_1_LEDGER.json';
const READINESS = 'docs/customer-1/CUSTOMER_1_READINESS.md';
const VOCAB = ['DAY_1', 'POST_DAY_1', 'PILOT', 'EXCLUDED', 'UNDETERMINED'];

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. The ledger is valid JSON and carries the gates this lane owns.
const ledger = JSON.parse(readFileSync(rel(LEDGER), 'utf8'));
const gates = new Map(ledger.gates.map((g) => [g.id, g]));
for (const id of ['C1-SCOPE-01', 'C1-PRODUCT-01']) {
  if (!gates.has(id)) fail(`ledger: gate ${id} missing`);
}

// 2. C1-SCOPE-01 points at the matrix, and is still OPEN: a proposal is not an acceptance.
const scope = gates.get('C1-SCOPE-01');
if (scope) {
  if (!scope.evidence.some((e) => e.includes(MATRIX))) {
    fail(`ledger: C1-SCOPE-01 evidence does not reference ${MATRIX}`);
  }
  if (scope.status !== 'OPEN') {
    fail(`ledger: C1-SCOPE-01 is ${scope.status}; proposals alone cannot move it off OPEN`);
  }
}

// 3. Every matrix row carries a vocabulary token, and every UNDETERMINED row names a blocker.
const matrix = readFileSync(rel(MATRIX), 'utf8');
const table = matrix.split('## Proposed classification matrix')[1]?.split('\n##')[0] ?? '';
const rows = table
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length === 5 && c[0] !== 'Row' && !c[0].startsWith('---'));

if (rows.length < 10) fail(`matrix: only ${rows.length} classification rows parsed; expected the full family universe`);

for (const [row, , , proposed, blocker] of rows) {
  const token = proposed.replace(/`/g, '');
  if (!VOCAB.includes(token)) fail(`matrix: row "${row}" has non-vocabulary classification "${token}"`);
  if (token === 'UNDETERMINED' && (blocker === '' || blocker === '—')) {
    fail(`matrix: row "${row}" is UNDETERMINED but names no blocker`);
  }
  if (token !== 'UNDETERMINED' && blocker !== '—') {
    fail(`matrix: row "${row}" is classified ${token} but still names blocker "${blocker}"`);
  }
}

// 4. Every relative link in the matrix resolves on disk.
for (const [, target] of matrix.matchAll(/\]\(([^)]+)\)/g)) {
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(scopeDir, target.split('#')[0]);
  if (!existsSync(path)) fail(`matrix: broken link ${target}`);
}

// 5. The readiness page's gate table agrees with the ledger.
const readiness = readFileSync(rel(READINESS), 'utf8');
const norm = (s) => s.replace(/[\s_]+/g, '_').toUpperCase();
for (const line of readiness.split('\n')) {
  const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map((c) => c.trim()) : [];
  if (cells.length !== 4) continue;
  const id = cells[0].split('—')[0].trim();
  const gate = gates.get(id);
  if (!gate) continue;
  if (norm(cells[1]) !== norm(gate.status)) {
    fail(`readiness: ${id} says ${cells[1]}, ledger says ${gate.status}`);
  }
  const critical = cells[2].toLowerCase() === 'yes';
  if (critical !== gate.launchCritical) {
    fail(`readiness: ${id} launch-critical ${cells[2]}, ledger says ${gate.launchCritical}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log(`PASS — ${rows.length} matrix rows, ${gates.size} gates, ledger and readiness agree`);
