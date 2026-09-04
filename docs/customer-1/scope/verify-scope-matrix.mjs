// Lane A proof: ledger parses, ledger/readiness agree, and every relative link in the
// Customer 1 scope docs resolves to a real file. Exits non-zero on the first failure.
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

for (const file of ['CUSTOMER_1_READINESS.md', 'scope/DAY_1_SCOPE_MATRIX.md']) {
  const path = resolve(c1, file);
  const text = readFileSync(path, 'utf8');
  for (const [, target] of text.matchAll(/\]\((?!https?:)([^)#]+)/g)) {
    if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) fail(`${file}: broken link ${target}`);
  }
}

if (!process.exitCode) console.log(`OK ${ledger.gates.length} gates, links resolve`);
