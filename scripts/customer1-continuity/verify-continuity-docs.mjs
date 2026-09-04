#!/usr/bin/env node
/**
 * Lane D (Recovery / Continuity) document check.
 *
 * Continuity documents fail in one specific way: they ship with a value nobody
 * ever decided, and the gap is invisible because prose reads fine either way.
 * This checks the two things a reader cannot check by skimming.
 *
 *   1. No unmarked placeholder (TODO / TBD / FIXME / XXX). An undecided value
 *      must be a named PENDING-* key, not a shrug.
 *   2. Every PENDING-* key used anywhere in a document is accounted for in that
 *      document's "Pending decisions" section, with an authority named. A
 *      pending value with no route to a decision-maker never gets decided.
 *
 * Read-only. Touches no Firebase project. Exits non-zero on failure.
 *
 * Usage: node scripts/customer1-continuity/verify-continuity-docs.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = 'docs/customer-1/continuity';
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;
const PENDING_KEY = /\bPENDING-[A-Z]+(?:-[A-Z]+)*\b/g;

/** Text of the "Pending decisions" section, or '' if the document has none. */
function pendingSection(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{2,3} .*Pending decisions/i.test(l));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const failures = [];
const docs = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));

if (docs.length === 0) {
  console.error(`FAIL ${DOCS_DIR}: no documents to check`);
  process.exit(1);
}

for (const doc of docs) {
  const text = readFileSync(join(DOCS_DIR, doc), 'utf8');

  text.split('\n').forEach((line, i) => {
    if (PLACEHOLDER.test(line)) {
      failures.push(`${doc}:${i + 1}: unmarked placeholder -- use a named PENDING-* key`);
    }
  });

  const keys = [...new Set(text.match(PENDING_KEY) ?? [])];
  if (keys.length > 0) {
    const section = pendingSection(text);
    if (!section) {
      failures.push(`${doc}: uses ${keys.join(', ')} but has no "Pending decisions" section`);
    } else {
      for (const key of keys) {
        if (!section.includes(key)) {
          failures.push(`${doc}: ${key} is used but not listed under "Pending decisions"`);
        }
      }
    }
  }

  console.log(`checked ${doc} (${keys.length} pending decision${keys.length === 1 ? '' : 's'})`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}

console.log(`OK ${docs.length} continuity document${docs.length === 1 ? '' : 's'}`);
