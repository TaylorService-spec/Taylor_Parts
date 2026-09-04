// Lane A proof: ledger parses, ledger/readiness agree, every relative link in the
// Customer 1 scope docs resolves to a real file, and every PROPOSED Day-1 row in the
// scope matrix has exactly one reconciliation row (and vice versa). Exits non-zero on failure.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const c1 = resolve(here, '..');
const fail = (m) => { console.error(`FAIL ${m}`); process.exitCode = 1; };

const ledger = JSON.parse(readFileSync(resolve(c1, 'CUSTOMER_1_LEDGER.json'), 'utf8'));
const readiness = readFileSync(resolve(c1, 'CUSTOMER_1_READINESS.md'), 'utf8');

for (const gate of ledger.gates) {
  if (!ledger.statusVocabulary.includes(gate.status)) fail(`${gate.id}: status ${gate.status} not in statusVocabulary`);
  if (!readiness.includes(gate.id)) fail(`${gate.id}: present in ledger JSON but missing from CUSTOMER_1_READINESS.md`);
}
for (const id of readiness.match(/C1-[A-Z]+-\d+/g) ?? []) {
  if (!ledger.gates.some((g) => g.id === id)) fail(`${id}: cited in readiness but absent from ledger JSON`);
}

for (const file of ['CUSTOMER_1_READINESS.md', 'scope/DAY_1_SCOPE_MATRIX.md', 'acceptance/DAY_1_GATE_RECONCILIATION.md']) {
  const path = resolve(c1, file);
  const text = readFileSync(path, 'utf8');
  for (const [, target] of text.matchAll(/\]\((?!https?:)([^)#]+)/g)) {
    if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) fail(`${file}: broken link ${target}`);
  }
}

// Row identity = the first table cell, minus any parenthetical qualifier ("Purchasing (purchase
// orders, price entry)" and "Purchasing" are the same row).
const rowKey = (line) => line.split('|')[1].split('(')[0].trim();
const isRow = (line) => line.startsWith('|') && !/^\|\s*[-:` ]+\|/.test(line);

const matrix = readFileSync(resolve(c1, 'scope/DAY_1_SCOPE_MATRIX.md'), 'utf8');
const proposed = new Set(
  matrix.split('\n').filter((l) => isRow(l) && l.includes('`DAY_1`')).map(rowKey).filter((k) => !k.includes('`')),
);

const recon = readFileSync(resolve(c1, 'acceptance/DAY_1_GATE_RECONCILIATION.md'), 'utf8');
const reconTable = recon.split(/^## /m).find((s) => s.startsWith('Reconciliation')) ?? '';
const reconciled = new Set(
  reconTable.split('\n').filter(isRow).map(rowKey).filter((k) => k && k !== 'Proposed Day-1 row'),
);

for (const key of proposed) if (!reconciled.has(key)) fail(`proposed DAY_1 row "${key}" has no reconciliation row`);
for (const key of reconciled) if (!proposed.has(key)) fail(`reconciliation row "${key}" is not a proposed DAY_1 row`);

// Acceptance evidence index: an ACCEPTED row must name the deployed build it was accepted
// against, or cite a recorded gap explaining why no build is recorded.
for (const line of reconTable.split('\n').filter(isRow)) {
  const cells = line.split('|');
  if (!/^\s*ACCEPTED/.test(cells[5] ?? '')) continue;
  const against = (cells[6] ?? '').trim();
  const gap = against.match(/G-\d+/);
  if (gap) {
    if (!recon.includes(`**${gap[0]} —`)) fail(`${rowKey(line)}: cites gap ${gap[0]}, which has no entry under Recorded gaps`);
  } else if (!/`[0-9a-f]{8}`/.test(against)) {
    fail(`${rowKey(line)}: ACCEPTED but names no deployed build and no recorded gap`);
  }
}

// Census completeness: every numbered entry in the business capability register must carry a
// CAP-<n> classification row in the matrix. A new register entry fails until it is classified.
const register = readFileSync(resolve(c1, '../roadmaps/business-capability-register.md'), 'utf8');
const capabilities = [...register.matchAll(/^### (\d+)\./gm)].map(([, n]) => n);
if (capabilities.length === 0) fail('business capability register: no `### N.` entries found');
for (const n of capabilities) {
  if (!matrix.includes(`CAP-${n} —`)) fail(`capability register entry #${n} has no CAP-${n} row in the scope matrix`);
}

if (!process.exitCode) {
  console.log(
    `OK ${ledger.gates.length} gates, links resolve, ${proposed.size} Day-1 rows reconciled, ` +
      `${capabilities.length} capability register entries classified`,
  );
}
