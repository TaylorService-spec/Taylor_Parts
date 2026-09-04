#!/usr/bin/env node
// Checks DAY_1_TRAINING_MATRIX.md against the guides it names.
// Fails if a referenced guide is missing, or if the matrix claims a guide is
// COMPLETE_LIVE_VERIFIED while the guide itself carries no live-verification receipt.
//
// Also checks DEPLOYMENT_TRAINING_CLOSE_LOG.md: every deployment close record must
// carry a complete, well-formed training receipt in one of the two forms that
// docs/training/README.md allows, naming guides that exist.
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
    // Backticked hex tokens in the row are the revision(s) the row claims the training represents.
    revisions: [...line.matchAll(/`([0-9a-f]{7,40})`/g)].map((m) => m[1]),
  }))
  .filter((row) => row.guide);

const errors = [];

if (rows.length === 0) {
  errors.push(`${matrixPath}: no guide rows found — the table shape changed and this check went blind`);
}

for (const { guide, complete, revisions } of rows) {
  if (!existsSync(join(repoRoot, guide))) {
    errors.push(`${matrixPath} references ${guide}, which does not exist`);
    continue;
  }
  if (!complete) continue;
  const body = readFileSync(join(repoRoot, guide), 'utf8');
  if (!/LIVE VERIFIED/.test(body)) {
    errors.push(`${matrixPath} claims ${guide} is COMPLETE_LIVE_VERIFIED, but the guide carries no live-verification receipt`);
  }
  // A row that cannot name the revision it represents is not COMPLETE, and a row
  // naming a revision the guide does not carry is stale — the matrix and the guide
  // must agree on what was verified.
  if (revisions.length === 0) {
    errors.push(`${matrixPath} claims ${guide} is COMPLETE_LIVE_VERIFIED but names no verified revision`);
  }
  for (const revision of revisions) {
    if (!body.includes(revision)) {
      errors.push(`${matrixPath} says ${guide} represents ${revision}, but the guide does not mention that revision`);
    }
  }
}

// --- Deployment training-close log ---------------------------------------

const logPath = 'docs/customer-1/training/DEPLOYMENT_TRAINING_CLOSE_LOG.md';
const CLOSED_HEADING = '## Closed deployments';

const COMPLETE_RECEIPT = 'TRAINING: COMPLETE';
const NO_IMPACT_RECEIPT = 'TRAINING: NOT REQUIRED — VERIFIED NO USER IMPACT';

const REQUIRED_KEYS = {
  COMPLETE: ['DEPLOYMENT', 'AFFECTED ROLES', 'AFFECTED WORKFLOWS', 'TRAINING GUIDES', 'TRAINING REPRESENTS', 'TRAINING', 'VERIFIED', 'DEPLOYMENT STATE'],
  NO_IMPACT: ['DEPLOYMENT', 'USER IMPACT', 'REASON', 'TRAINING', 'DEPLOYMENT STATE'],
};

const log = readFileSync(join(repoRoot, logPath), 'utf8');
const closedSectionStart = log.indexOf(CLOSED_HEADING);

if (closedSectionStart === -1) {
  // Without the heading the parser cannot tell real records from the format examples.
  errors.push(`${logPath}: "${CLOSED_HEADING}" heading is missing — this check went blind`);
}

// Only blocks below the heading are records; blocks above it are the format spec.
const records =
  closedSectionStart === -1
    ? []
    : [...log.slice(closedSectionStart).matchAll(/```text\r?\n([\s\S]*?)```/g)].map((m) => m[1]);

for (const [index, record] of records.entries()) {
  const label = `${logPath} record ${index + 1}`;
  const fields = new Map(
    record
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z ]*):\s*(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );

  const receipt = fields.has('TRAINING') ? `TRAINING: ${fields.get('TRAINING')}` : null;
  const form =
    receipt === COMPLETE_RECEIPT ? 'COMPLETE' : receipt === NO_IMPACT_RECEIPT ? 'NO_IMPACT' : null;

  if (!form) {
    errors.push(`${label}: TRAINING receipt is "${receipt ?? 'absent'}", which is not one of the two receipts docs/training/README.md allows`);
    continue;
  }

  for (const key of REQUIRED_KEYS[form]) {
    const value = fields.get(key);
    if (!value) errors.push(`${label}: required field "${key}" is missing or empty`);
    else if (/^<.*>$/.test(value)) errors.push(`${label}: field "${key}" still holds the template placeholder ${value}`);
  }

  if (fields.get('DEPLOYMENT STATE') && fields.get('DEPLOYMENT STATE') !== 'CLOSED') {
    errors.push(`${label}: DEPLOYMENT STATE is "${fields.get('DEPLOYMENT STATE')}" — only CLOSED records belong in this log`);
  }

  for (const guide of fields.get('TRAINING GUIDES')?.split(';') ?? []) {
    const path = guide.trim();
    if (path && !existsSync(join(repoRoot, path))) {
      errors.push(`${label}: names training guide ${path}, which does not exist`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(`OK: ${rows.length} guide rows checked, all present and truthfully statused`);
console.log(`OK: ${records.length} deployment close record(s) checked`);
