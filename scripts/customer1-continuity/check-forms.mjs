#!/usr/bin/env node
// Checks that docs/customer-1/continuity/OUTAGE_PAPER_FORMS.md still carries every
// field the post-outage reconciliation procedure depends on, and that the files it
// cross-references exist. Read-only; touches nothing outside the repository.
//
// Each entry below is a field whose absence would leave a reconciliation step with
// nothing to enter from. If a field is dropped from a form, this fails loudly rather
// than waiting for a real outage to discover it.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const continuity = join(repoRoot, 'docs', 'customer-1', 'continuity');
const formsPath = join(continuity, 'OUTAGE_PAPER_FORMS.md');

const REQUIRED_FIELDS = [
  // header block — reconciliation §3.1 writes the WO number back onto the sheet
  ['header', 'Sheet ____ of ____'],
  ['header', 'EOS work order no.'],
  ['header', 'Entered by'],
  // dispatch master sheet — reconciliation §3.1 works from this and no other
  ['dispatch', 'WO no. (or NEW)'],
  ['dispatch', 'Time assigned'],
  ['dispatch', 'NEW CALLS RECEIVED DURING THE OUTAGE'],
  ['dispatch', 'Urgency'],
  // technician job sheet — reconciliation §3.2
  ['technician', 'Arrival time (write on arrival)'],
  ['technician', 'Departure time (write on leaving)'],
  ['technician', 'Equipment worked on — unit or serial no.'],
  ['technician', 'Return visit needed'],
  ['technician', 'If not collected, why not'],
  // parts used sheet — reconciliation §3.3
  ['parts', 'Part no.'],
  ['parts', 'Description (if no. unknown)'],
  ['parts', 'From truck/location'],
  ['parts', 'the equipment it went into'],
  // receiving annotation — reconciliation §3.4
  ['receiving', 'Date and time received'],
  ['receiving', 'Received by (name)'],
  ['receiving', 'Where the goods were physically put'],
];

// Companion documents the forms pack points at. A dead pointer here means an
// operator following the pack lands nowhere.
const REQUIRED_COMPANIONS = [
  'OUTAGE_FALLBACK_RUNBOOK.md',
  'POST_OUTAGE_RECONCILIATION.md',
];

const failures = [];

if (!existsSync(formsPath)) {
  failures.push('missing file: docs/customer-1/continuity/OUTAGE_PAPER_FORMS.md');
} else {
  const forms = readFileSync(formsPath, 'utf8');
  for (const [form, field] of REQUIRED_FIELDS) {
    if (!forms.includes(field)) {
      failures.push(`${form} form is missing the field: ${field}`);
    }
  }
  for (const companion of REQUIRED_COMPANIONS) {
    if (!forms.includes(companion)) {
      failures.push(`forms pack no longer references ${companion}`);
    }
    if (!existsSync(join(continuity, companion))) {
      failures.push(`referenced companion document does not exist: ${companion}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Outage paper forms check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Outage paper forms check passed: ${REQUIRED_FIELDS.length} fields, ${REQUIRED_COMPANIONS.length} companions.`);
