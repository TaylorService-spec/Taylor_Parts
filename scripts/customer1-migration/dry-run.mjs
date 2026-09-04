#!/usr/bin/env node
// Migration dry-run harness for gate C1-DATA-01, objective 4.
//
// It reads a census / tiering / field-mapping chain and a set of source
// records, applies the mappings, and produces a DETERMINISTIC exception
// report: the same inputs always produce byte-identical output, so a rerun
// proves idempotency rather than merely "it ran again".
//
// It writes nothing anywhere. It has no notion of a target database and no
// credentials. A dry run is a rehearsal on paper.
//
// Fail-closed in three ways:
//   - the mapping chain must validate with zero errors before any record is
//     read; a dry run over an unvalidated chain proves nothing;
//   - a record is migrated only when EVERY mapped field for its domain
//     resolved cleanly. Any exception rejects the whole record. Half a
//     migrated part is worse than an absent one;
//   - a source field nobody dispositioned is an exception, not a silent drop.
//     The mapping table decides what is left behind, on the record, in words.
//
// SEEDED data proves this process. It does not prove Taylor's data.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateFieldMappings } from './validate-field-mappings.mjs';

const MOVES = new Set(['DAY_1', 'HISTORICAL_REFERENCE']);

/** The whole supported transform vocabulary. A mapping naming anything else is an exception. */
const TRANSFORMS = {
  trim: (v) => v.trim(),
  upper: (v) => v.trim().toUpperCase(),
  money: (v) => {
    const n = Number(v.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) throw new Error(`"${v}" is not a money amount`);
    return Math.round(n * 100) / 100;
  },
  integer: (v) => {
    const t = v.trim();
    if (!/^-?\d+$/.test(t)) throw new Error(`"${v}" is not a whole number`);
    return Number(t);
  },
};

const RECORD_FIELDS = ['domain', 'sourceSystemId', 'recordId', 'values'];

/**
 * @param {unknown} mappings parsed field-mapping document
 * @param {unknown} tiering parsed migration tiering
 * @param {unknown} census parsed source census
 * @param {unknown} source parsed source-record document ({ records: [...] })
 * @returns {{ errors: string[], report: object|null }}
 */
export function dryRun(mappings, tiering, census, source) {
  const chain = validateFieldMappings(mappings, tiering, census);
  if (chain.errors.length > 0) {
    return { errors: chain.errors.map((e) => `mapping chain: ${e}`), report: null };
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return { errors: ['source must be a JSON object'], report: null };
  }
  if (!Array.isArray(source.records)) {
    return { errors: ['source.records must be an array'], report: null };
  }

  // Which domains move, out of which systems, and under which field mappings.
  const tiers = new Map();
  const allowedSystems = new Map();
  for (const entry of tiering.domains) {
    tiers.set(entry.domain, entry.tier);
    if (MOVES.has(entry.tier)) allowedSystems.set(entry.domain, new Set(entry.sourceSystemIds));
  }
  const mapped = new Map(); // "domain|systemId" -> Map(sourceField -> mapping entry)
  for (const field of mappings.fields) {
    const key = `${field.domain}|${field.sourceSystemId}`;
    if (!mapped.has(key)) mapped.set(key, new Map());
    mapped.get(key).set(field.sourceField, field);
  }

  const errors = [];
  const exceptions = [];
  const records = [];
  const seenIds = new Set();
  const perDomain = new Map();
  const bump = (domain, counter) => {
    if (!perDomain.has(domain)) {
      perDomain.set(domain, {
        domain,
        tier: tiers.get(domain) ?? 'NOT_TIERED',
        read: 0,
        migrated: 0,
        rejected: 0,
        exceptions: 0,
      });
    }
    perDomain.get(domain)[counter] += 1;
  };

  for (const [index, record] of source.records.entries()) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`records[${index}] must be an object`);
      continue;
    }
    for (const field of RECORD_FIELDS) {
      if (!(field in record)) errors.push(`records[${index}] is missing required field "${field}"`);
    }
    const values = record.values;
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      errors.push(`records[${index}].values must be an object of source field -> raw string`);
      continue;
    }

    const { domain, sourceSystemId, recordId } = record;
    bump(domain, 'read');
    const raise = (sourceField, kind, detail) => {
      exceptions.push({ domain, sourceSystemId, recordId, sourceField, kind, detail });
      bump(domain, 'exceptions');
    };

    if (!allowedSystems.has(domain)) {
      raise(
        null,
        'DOMAIN_DOES_NOT_MOVE',
        `domain is tiered "${tiers.get(domain) ?? 'NOT_TIERED'}"; nothing in it migrates`
      );
      bump(domain, 'rejected');
      continue;
    }
    if (!allowedSystems.get(domain).has(sourceSystemId)) {
      raise(null, 'UNEXPECTED_SOURCE_SYSTEM', 'the tiering does not name this system for this domain');
      bump(domain, 'rejected');
      continue;
    }
    const identity = `${domain}|${recordId}`;
    if (seenIds.has(identity)) {
      raise(null, 'DUPLICATE_RECORD_ID', 'a record with this id was already read for this domain');
      bump(domain, 'rejected');
      continue;
    }
    seenIds.add(identity);

    const table = mapped.get(`${domain}|${sourceSystemId}`) ?? new Map();
    const target = {};
    let clean = true;

    for (const sourceField of Object.keys(values).sort()) {
      const mapping = table.get(sourceField);
      if (mapping === undefined) {
        raise(sourceField, 'UNMAPPED_SOURCE_FIELD', 'no mapping row dispositions this field');
        clean = false;
        continue;
      }
      if (mapping.disposition !== 'MAPPED') continue; // dispositioned as left behind, on purpose
      const raw = values[sourceField];
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        raise(sourceField, 'MISSING_VALUE', 'mapped field is absent, blank, or not a source string');
        clean = false;
        continue;
      }
      const transform = TRANSFORMS[mapping.transform];
      if (transform === undefined) {
        raise(sourceField, 'UNSUPPORTED_TRANSFORM', `transform "${mapping.transform}" is not implemented`);
        clean = false;
        continue;
      }
      try {
        target[mapping.targetField] = transform(raw);
      } catch (error) {
        raise(sourceField, 'TRANSFORM_FAILED', `${mapping.transform}: ${error.message}`);
        clean = false;
      }
    }

    for (const [sourceField, mapping] of table) {
      if (mapping.disposition === 'MAPPED' && !(sourceField in values)) {
        raise(sourceField, 'MISSING_VALUE', 'mapped field is absent, blank, or not a source string');
        clean = false;
      }
    }

    if (clean) {
      records.push({ domain, recordId, target: sortKeys(target) });
      bump(domain, 'migrated');
    } else {
      bump(domain, 'rejected');
    }
  }

  const byTuple = (a, b) =>
    `${a.domain}|${a.recordId}|${a.sourceField ?? ''}|${a.kind ?? ''}`.localeCompare(
      `${b.domain}|${b.recordId}|${b.sourceField ?? ''}|${b.kind ?? ''}`
    );
  exceptions.sort(byTuple);
  records.sort(byTuple);

  const report = {
    banner:
      'Migration dry run — a rehearsal, not a migration. Nothing was written. If the inputs are SEEDED, so is every number below.',
    inputStatus: {
      census: census.status,
      tiering: tiering.status,
      mappings: mappings.status,
      sourceBanner: typeof source.banner === 'string' ? source.banner : null,
    },
    counts: {
      recordsRead: source.records.length,
      recordsMigrated: records.length,
      recordsRejected: source.records.length - records.length,
      exceptions: exceptions.length,
    },
    perDomain: [...perDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain)),
    exceptions,
    records,
  };

  return { errors, report: errors.length > 0 ? null : report };
}

function sortKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((k) => [k, object[k]]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = 'docs/customer-1/data/seeded';
  const paths = [
    process.argv[2] ?? `${dir}/SEEDED-field-mappings.json`,
    process.argv[3] ?? `${dir}/SEEDED-migration-tiering.json`,
    process.argv[4] ?? `${dir}/SEEDED-source-census.json`,
    process.argv[5] ?? `${dir}/SEEDED-source-records.json`,
  ];
  let docs;
  try {
    docs = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  } catch (error) {
    console.error(`FAIL dry run: ${error.message}`);
    process.exit(1);
  }
  const { errors, report } = dryRun(...docs);
  for (const error of errors) console.error(`FAIL dry run: ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(JSON.stringify(report, null, 2));
}
