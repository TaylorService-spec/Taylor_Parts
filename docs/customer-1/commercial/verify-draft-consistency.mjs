#!/usr/bin/env node
// Lane E proof: every commercial/support draft names its status, its open
// issues, and its decision owner. A draft with no open-issues list is
// incomplete (lane charter, "Proofs").
//
// Run: node docs/customer-1/commercial/verify-draft-consistency.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['docs/customer-1/commercial', 'docs/customer-1/support'];

const REQUIRED = [
  { label: 'status declaration', re: /^\*\*Status:/m },
  { label: 'decision owner', re: /^\*\*Decision owner:/m },
  { label: 'open-issues list', re: /^#+ Open issues$/m },
];

function markdownFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // a lane path that does not exist yet is not a failure
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const files = ROOTS.flatMap(markdownFiles);
const failures = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const missing = REQUIRED.filter((r) => !r.re.test(text)).map((r) => r.label);
  if (missing.length) failures.push(`${file}: missing ${missing.join(', ')}`);
}

if (!files.length) {
  console.error('no drafts found under', ROOTS.join(' or '));
  process.exit(1);
}

for (const failure of failures) console.error(failure);
console.log(`${files.length - failures.length}/${files.length} drafts consistent`);
process.exit(failures.length ? 1 : 0);
