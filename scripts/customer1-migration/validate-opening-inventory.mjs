#!/usr/bin/env node
// Validator for docs/customer-1/data/opening-inventory-reconciliation.json (gate C1-INV-01).
//
// Opening inventory is Taylor's acceptance, not Verenward's. This validator
// cannot count anything and does not try to. It enforces that the record
// cannot lie about where the count stands:
//   - every required custody scope (warehouse, bin, truck, serialized) is
//     covered exactly once, and no others are smuggled in;
//   - UNKNOWN is a value; a missing field is an error, not an implicit UNKNOWN;
//   - a system balance source, when named, exists in the source census;
//   - nobody on the Verenward/automation side can appear as the accepting
//     party — the tooling produces the reconciliation, Taylor accepts the count;
//   - the declared `status` matches the status computed from the contents,
//     including the census it rests on.
//
// Fail-closed: anything unrecognised is an error.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateCensus } from './validate-source-census.mjs';

const UNKNOWN = 'UNKNOWN';

const SCOPE_FIELDS = [
  'scope',
  'inScope',
  'countMethod',
  'countPerformedBy',
  'systemBalanceSourceIds',
  'varianceDisposition',
  'taylorAcceptance',
];
const SCOPE_UNKNOWNABLE = [
  'inScope',
  'countMethod',
  'countPerformedBy',
  'varianceDisposition',
  'taylorAcceptance',
];
const ACCEPTANCE_FIELDS = ['acceptedBy', 'acceptedOn', 'statement'];

// Acceptance by the party building the system is not acceptance.
const NOT_TAYLOR = /verenward|claude|orchestrator|automation|lane\s*b/i;

/**
 * @param {unknown} record parsed opening-inventory reconciliation document
 * @param {unknown} census parsed source census, the authority for system ids
 * @returns {{ errors: string[], computedStatus: 'ACCEPTED'|'DRAFT' }}
 */
export function validateOpeningInventory(record, census) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { errors: ['record must be a JSON object'], computedStatus: 'DRAFT' };
  }
  if (census === null || typeof census !== 'object' || Array.isArray(census)) {
    return { errors: ['census must be a JSON object'], computedStatus: 'DRAFT' };
  }

  const required = record.requiredScopes;
  if (!Array.isArray(required) || required.length === 0) {
    fail('requiredScopes must be a non-empty array');
  }
  const entries = record.scopes;
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('scopes must be a non-empty array');
  }

  const censusSystemIds = new Set(
    (Array.isArray(census.systems) ? census.systems : [])
      .filter((s) => s !== null && typeof s === 'object')
      .map((s) => s.id)
  );

  let unresolved = 0;
  const covered = new Set();

  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const where = `scopes[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${where} must be an object`);
      continue;
    }
    for (const field of SCOPE_FIELDS) {
      if (!(field in entry)) fail(`${where} is missing required field "${field}"`);
    }

    if (!(Array.isArray(required) && required.includes(entry.scope))) {
      fail(`${where}.scope "${entry.scope}" is not a required custody scope`);
    } else if (covered.has(entry.scope)) {
      fail(`scope "${entry.scope}" is reconciled more than once`);
    } else {
      covered.add(entry.scope);
    }

    for (const field of SCOPE_UNKNOWNABLE) {
      const value = entry[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        fail(`${where}.${field} must be a non-empty string (use "${UNKNOWN}" when unanswered)`);
      } else if (value === UNKNOWN) {
        unresolved += 1;
      }
    }

    if (typeof entry.taylorAcceptance === 'string' && NOT_TAYLOR.test(entry.taylorAcceptance)) {
      fail(`${where}.taylorAcceptance names the building party — Taylor accepts the count, not Verenward`);
    }

    const sources = entry.systemBalanceSourceIds;
    if (!Array.isArray(sources)) {
      fail(`${where}.systemBalanceSourceIds must be an array (use [] when none)`);
    } else {
      for (const id of sources) {
        if (!censusSystemIds.has(id)) {
          fail(`${where}.systemBalanceSourceIds references "${id}", which is not a system in the census`);
        }
      }
      if (entry.taylorAcceptance !== UNKNOWN && sources.length === 0) {
        fail(`${where} is accepted but names no system balance to have reconciled against`);
      }
    }
  }

  for (const scope of Array.isArray(required) ? required : []) {
    if (!covered.has(scope)) fail(`required custody scope "${scope}" is not reconciled`);
  }

  const acceptance = record.acceptance;
  if (acceptance === null || typeof acceptance !== 'object' || Array.isArray(acceptance)) {
    fail('acceptance must be an object');
  } else {
    for (const field of ACCEPTANCE_FIELDS) {
      if (!(field in acceptance)) fail(`acceptance is missing required field "${field}"`);
      const value = acceptance[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        fail(`acceptance.${field} must be a non-empty string (use "${UNKNOWN}" when unanswered)`);
      } else if (value === UNKNOWN) {
        unresolved += 1;
      }
    }
    if (typeof acceptance.acceptedBy === 'string' && NOT_TAYLOR.test(acceptance.acceptedBy)) {
      fail('acceptance.acceptedBy names the building party — Verenward cannot accept Taylor\'s count');
    }
  }

  const censusResult = validateCensus(census);
  for (const error of censusResult.errors) fail(`census: ${error}`);

  const computedStatus =
    unresolved === 0 && censusResult.computedStatus === 'COMPLETE' ? 'ACCEPTED' : 'DRAFT';

  if (record.status !== computedStatus) {
    fail(
      `status is "${record.status}" but the contents compute to "${computedStatus}"` +
        ` (${unresolved} unanswered field(s), census is ${censusResult.computedStatus})`
    );
  }

  return { errors, computedStatus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const recordPath = process.argv[2] ?? 'docs/customer-1/data/opening-inventory-reconciliation.json';
  const censusPath = process.argv[3] ?? 'docs/customer-1/data/source-census.json';
  let record;
  let census;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
    census = JSON.parse(readFileSync(censusPath, 'utf8'));
  } catch (error) {
    console.error(`FAIL ${recordPath}: ${error.message}`);
    process.exit(1);
  }
  const { errors, computedStatus } = validateOpeningInventory(record, census);
  for (const error of errors) console.error(`FAIL ${recordPath}: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(`OK ${recordPath}: reconciliation is well-formed and honestly ${computedStatus}`);
}
