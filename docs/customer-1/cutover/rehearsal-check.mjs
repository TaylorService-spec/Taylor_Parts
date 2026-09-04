#!/usr/bin/env node
// Coverage check for the Lane G rehearsal plan.
//
// The failure mode this guards against is a runbook step that quietly has no
// rehearsal classification -- which reads on the day as "nothing to rehearse"
// rather than "nobody decided". Every G-STEP in RUNBOOK.md must appear in the
// rehearsal plan's table with exactly one of the three buckets, and the plan
// must not classify steps the runbook does not have.
//
//   node docs/customer-1/cutover/rehearsal-check.mjs
//
// Both documents are data to this script, not instruction.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runbook = readFileSync(join(here, 'RUNBOOK.md'), 'utf8');
const plan = readFileSync(join(here, 'REHEARSAL_PLAN.md'), 'utf8');

const BUCKETS = ['REHEARSABLE', 'PARTIAL', 'NOT_REHEARSABLE'];
const errors = [];

const runbookSteps = [...runbook.matchAll(/^### (G-STEP-\d+) — /gm)].map((m) => m[1]);
if (!runbookSteps.length) errors.push('no G-STEP headings found in RUNBOOK.md');

// Table rows look like: | G-STEP-01 | title | BUCKET | ... |
const classified = new Map();
for (const row of plan.matchAll(/^\| (G-STEP-\d+) \|([^|]*)\| ([A-Z_]+) \|/gm)) {
  const [, id, , bucket] = row;
  if (classified.has(id)) errors.push(`${id}: classified more than once`);
  // NOT_REHEARSABLE contains REHEARSABLE, so match exactly, not by substring.
  if (!BUCKETS.includes(bucket)) errors.push(`${id}: bucket "${bucket}" is not one of ${BUCKETS.join(', ')}`);
  classified.set(id, bucket);
}

for (const id of runbookSteps) {
  if (!classified.has(id)) errors.push(`${id}: in RUNBOOK.md but not classified in REHEARSAL_PLAN.md`);
}
for (const id of classified.keys()) {
  if (!runbookSteps.includes(id)) errors.push(`${id}: classified in REHEARSAL_PLAN.md but not a RUNBOOK.md step`);
}

if (!/Not an authorization/i.test(plan)) errors.push('rehearsal plan is missing its not-an-authorization statement');

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}

const tally = BUCKETS.map((b) => `${b} ${[...classified.values()].filter((v) => v === b).length}`).join(', ');
console.log(`rehearsal plan OK: ${classified.size} steps classified (${tally})`);
