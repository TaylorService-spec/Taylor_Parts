#!/usr/bin/env node
// Validator for docs/customer-1/data/migration-tiering.json (gate C1-DATA-01).
//
// Tiering says, per domain, whether data is required for Day 1, kept as
// historical reference, or explicitly not migrated. This validator does not
// make that call — Taylor does. It enforces that the record cannot lie:
//   - every domain the census requires is tiered exactly once;
//   - a tier is a declared tier or the literal UNDECIDED;
//   - a domain that moves (DAY_1 / HISTORICAL_REFERENCE) names at least one
//     source system, and every named source exists in the census;
//   - a domain that does not move (NOT_MIGRATED) names no source;
//   - the declared `status` matches the status computed from the contents,
//     including the census it rests on — tiering cannot be ACCEPTED while the
//     census it was derived from is still INCOMPLETE.
//
// Fail-closed: anything unrecognised is an error.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateCensus } from './validate-source-census.mjs';

const UNKNOWN = 'UNKNOWN';
const UNDECIDED = 'UNDECIDED';
const MOVES = new Set(['DAY_1', 'HISTORICAL_REFERENCE']);

const DOMAIN_FIELDS = ['domain', 'tier', 'sourceSystemIds', 'rationale', 'taylorAcceptance'];

/**
 * @param {unknown} tiering parsed tiering document
 * @param {unknown} census parsed source census, the authority for domains and system ids
 * @returns {{ errors: string[], computedStatus: 'ACCEPTED'|'PROPOSED' }}
 */
export function validateTiering(tiering, census) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (tiering === null || typeof tiering !== 'object' || Array.isArray(tiering)) {
    return { errors: ['tiering must be a JSON object'], computedStatus: 'PROPOSED' };
  }
  if (census === null || typeof census !== 'object' || Array.isArray(census)) {
    return { errors: ['census must be a JSON object'], computedStatus: 'PROPOSED' };
  }

  const tiers = tiering.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    fail('tiers must be a non-empty array');
  }
  const entries = tiering.domains;
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('domains must be a non-empty array');
  }

  const requiredDomains = Array.isArray(census.requiredDomains) ? census.requiredDomains : [];
  const censusSystemIds = new Set(
    (Array.isArray(census.systems) ? census.systems : [])
      .filter((s) => s !== null && typeof s === 'object')
      .map((s) => s.id)
  );

  let unresolved = 0;
  const tiered = new Set();

  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const where = `domains[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${where} must be an object`);
      continue;
    }
    for (const field of DOMAIN_FIELDS) {
      if (!(field in entry)) fail(`${where} is missing required field "${field}"`);
    }

    if (!requiredDomains.includes(entry.domain)) {
      fail(`${where}.domain "${entry.domain}" is not a domain the census requires`);
    } else if (tiered.has(entry.domain)) {
      fail(`domain "${entry.domain}" is tiered more than once`);
    } else {
      tiered.add(entry.domain);
    }

    const tier = entry.tier;
    if (tier !== UNDECIDED && !(Array.isArray(tiers) && tiers.includes(tier))) {
      fail(`${where}.tier "${tier}" is not a declared tier or ${UNDECIDED}`);
    }
    if (tier === UNDECIDED) unresolved += 1;

    const sources = entry.sourceSystemIds;
    if (!Array.isArray(sources)) {
      fail(`${where}.sourceSystemIds must be an array (use [] when none)`);
    } else {
      for (const id of sources) {
        if (!censusSystemIds.has(id)) {
          fail(`${where}.sourceSystemIds references "${id}", which is not a system in the census`);
        }
      }
      if (MOVES.has(tier) && sources.length === 0) {
        fail(`${where} is tiered "${tier}" but names no source system`);
      }
      if (tier === 'NOT_MIGRATED' && sources.length > 0) {
        fail(`${where} is tiered "NOT_MIGRATED" but names source systems`);
      }
    }

    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length === 0) {
      fail(`${where}.rationale must say why, in words`);
    }
    if (entry.taylorAcceptance === UNKNOWN) unresolved += 1;
  }

  for (const domain of requiredDomains) {
    if (!tiered.has(domain)) fail(`domain "${domain}" is required by the census but is not tiered`);
  }

  const censusResult = validateCensus(census);
  for (const error of censusResult.errors) fail(`census: ${error}`);

  const computedStatus =
    unresolved === 0 && censusResult.computedStatus === 'COMPLETE' ? 'ACCEPTED' : 'PROPOSED';

  if (tiering.status !== computedStatus) {
    fail(
      `status is "${tiering.status}" but the contents compute to "${computedStatus}"` +
        ` (${unresolved} undecided/unaccepted field(s), census is ${censusResult.computedStatus})`
    );
  }

  return { errors, computedStatus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tieringPath = process.argv[2] ?? 'docs/customer-1/data/migration-tiering.json';
  const censusPath = process.argv[3] ?? 'docs/customer-1/data/source-census.json';
  let tiering;
  let census;
  try {
    tiering = JSON.parse(readFileSync(tieringPath, 'utf8'));
    census = JSON.parse(readFileSync(censusPath, 'utf8'));
  } catch (error) {
    console.error(`FAIL ${tieringPath}: ${error.message}`);
    process.exit(1);
  }
  const { errors, computedStatus } = validateTiering(tiering, census);
  for (const error of errors) console.error(`FAIL ${tieringPath}: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(`OK ${tieringPath}: tiering is well-formed and honestly ${computedStatus}`);
}
