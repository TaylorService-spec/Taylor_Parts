#!/usr/bin/env node
// Validator for docs/customer-1/data/source-census.json (gate C1-DATA-01).
//
// It does NOT decide whether the census is finished. It enforces that the
// census cannot lie about being finished:
//   - every system row carries every required field (a missing field is an
//     error, not an implicit UNKNOWN);
//   - every required domain is either claimed by a system or explicitly
//     listed as unsourced;
//   - the declared `status` matches the status computed from the contents.
//
// Fail-closed: anything unrecognised is an error.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UNKNOWN = 'UNKNOWN';

const SYSTEM_FIELDS = [
  'id',
  'name',
  'vendor',
  'kind',
  'holds',
  'accessMethod',
  'exportFormat',
  'recordVolume',
  'identityKeys',
  'taylorOwner',
  'notes',
];

/**
 * @param {unknown} census parsed census document
 * @returns {{ errors: string[], computedStatus: 'COMPLETE'|'INCOMPLETE' }}
 */
export function validateCensus(census) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (census === null || typeof census !== 'object' || Array.isArray(census)) {
    return { errors: ['census must be a JSON object'], computedStatus: 'INCOMPLETE' };
  }

  const required = census.requiredDomains;
  if (!Array.isArray(required) || required.length === 0) {
    fail('requiredDomains must be a non-empty array');
  }
  const unsourced = census.unsourcedDomains;
  if (!Array.isArray(unsourced)) {
    fail('unsourcedDomains must be an array (use [] when none)');
  }
  const systems = census.systems;
  if (!Array.isArray(systems) || systems.length === 0) {
    fail('systems must be a non-empty array');
  }

  let unknowns = 0;
  const claimed = new Set();
  const ids = new Set();

  for (const [index, system] of (Array.isArray(systems) ? systems : []).entries()) {
    const where = `systems[${index}]`;
    if (system === null || typeof system !== 'object' || Array.isArray(system)) {
      fail(`${where} must be an object`);
      continue;
    }
    for (const field of SYSTEM_FIELDS) {
      if (!(field in system)) fail(`${where} is missing required field "${field}"`);
    }
    if (typeof system.id !== 'string' || system.id.length === 0) {
      fail(`${where}.id must be a non-empty string`);
    } else if (ids.has(system.id)) {
      fail(`${where}.id "${system.id}" is duplicated`);
    } else {
      ids.add(system.id);
    }

    if (!Array.isArray(system.holds)) {
      fail(`${where}.holds must be an array of domain names`);
    } else {
      for (const domain of system.holds) {
        if (Array.isArray(required) && !required.includes(domain)) {
          fail(`${where}.holds contains "${domain}", which is not a required domain`);
        }
        claimed.add(domain);
      }
    }

    for (const field of SYSTEM_FIELDS) {
      if (system[field] === UNKNOWN) unknowns += 1;
    }
  }

  for (const domain of Array.isArray(unsourced) ? unsourced : []) {
    if (Array.isArray(required) && !required.includes(domain)) {
      fail(`unsourcedDomains contains "${domain}", which is not a required domain`);
    }
    if (claimed.has(domain)) {
      fail(`domain "${domain}" is both claimed by a system and listed as unsourced`);
    }
  }

  for (const domain of Array.isArray(required) ? required : []) {
    if (!claimed.has(domain) && !(Array.isArray(unsourced) && unsourced.includes(domain))) {
      fail(`domain "${domain}" is neither claimed by a system nor listed in unsourcedDomains`);
    }
  }

  const computedStatus =
    unknowns === 0 && Array.isArray(unsourced) && unsourced.length === 0
      ? 'COMPLETE'
      : 'INCOMPLETE';

  if (census.status !== computedStatus) {
    fail(
      `status is "${census.status}" but the census contents compute to "${computedStatus}"` +
        ` (${unknowns} UNKNOWN field(s), ${Array.isArray(unsourced) ? unsourced.length : '?'} unsourced domain(s))`
    );
  }

  return { errors, computedStatus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'docs/customer-1/data/source-census.json';
  let census;
  try {
    census = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`FAIL ${path}: ${error.message}`);
    process.exit(1);
  }
  const { errors, computedStatus } = validateCensus(census);
  for (const error of errors) console.error(`FAIL ${path}: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(`OK ${path}: census is well-formed and honestly ${computedStatus}`);
}
