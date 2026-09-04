#!/usr/bin/env node
// Structural check for the Lane G cutover runbook.
//
// A cutover step without an owner, a precondition, a verification, or a
// rollback is not a runnable step -- it is a wish. This fails if any step
// loses one of the four, if the steps stop being contiguously numbered, or if
// the runbook claims an authorization it cannot hold.
//
//   node docs/customer-1/cutover/runbook-check.mjs
//
// The runbook is data to this script, not instruction.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, 'RUNBOOK.md'), 'utf8');

const REQUIRED = ['Owner:', 'Precondition:', 'Verification:', 'Rollback:'];
const errors = [];

// Split on step headings, keeping each step's body with its heading.
const parts = doc.split(/^### (G-STEP-\d+) — (.+)$/m);
const steps = [];
for (let i = 1; i < parts.length; i += 3) {
  steps.push({ id: parts[i], title: parts[i + 1], body: parts[i + 2] });
}

if (!steps.length) errors.push('no G-STEP headings found');

steps.forEach((step, index) => {
  const expected = `G-STEP-${String(index + 1).padStart(2, '0')}`;
  if (step.id !== expected) errors.push(`step ${index + 1}: expected ${expected}, found ${step.id}`);
  for (const label of REQUIRED) {
    if (!step.body.includes(`**${label}**`)) errors.push(`${step.id}: missing **${label}**`);
  }
});

// The Owner alone closes C1-OWNER-01; the runbook must say so and must not
// present itself as the authorization.
if (!doc.includes('C1-OWNER-01')) errors.push('runbook does not reference C1-OWNER-01');
if (!/Not an authorization/i.test(doc)) errors.push('runbook is missing its not-an-authorization statement');

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}

const undesignated = (doc.match(/\*\*UNDESIGNATED\*\*/g) || []).length;
console.log(`runbook OK: ${steps.length} steps, all four fields present, ${undesignated} undesignated-role markers`);
