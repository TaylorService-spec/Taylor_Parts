#!/usr/bin/env node
// Checks DAY_1_TRAINING_MATRIX.md against the guides it names.
// Fails if a referenced guide is missing, or if the matrix claims a guide is
// COMPLETE_LIVE_VERIFIED while the guide itself carries no live-verification receipt.
//
// Run: node docs/customer-1/training/verify-training-index.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const matrixPath = 'docs/customer-1/training/DAY_1_TRAINING_MATRIX.md';
const matrix = readFileSync(join(repoRoot, matrixPath), 'utf8');

// Only table rows: a guide path and a status in the same row.
const rows = matrix
  .split('\n')
  .filter((line) => line.startsWith('|') && line.includes('docs/training/'))
  .map((line) => ({
    guide: line.match(/docs\/training\/[A-Z0-9_]+\.md/)?.[0],
    complete: line.includes('COMPLETE_LIVE_VERIFIED'),
  }))
  .filter((row) => row.guide);

const errors = [];

if (rows.length === 0) {
  errors.push(`${matrixPath}: no guide rows found — the table shape changed and this check went blind`);
}

for (const { guide, complete } of rows) {
  if (!existsSync(join(repoRoot, guide))) {
    errors.push(`${matrixPath} references ${guide}, which does not exist`);
    continue;
  }
  if (!complete) continue;
  const body = readFileSync(join(repoRoot, guide), 'utf8');
  if (!/LIVE VERIFIED/.test(body)) {
    errors.push(`${matrixPath} claims ${guide} is COMPLETE_LIVE_VERIFIED, but the guide carries no live-verification receipt`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(`OK: ${rows.length} guide rows checked, all present and truthfully statused`);
