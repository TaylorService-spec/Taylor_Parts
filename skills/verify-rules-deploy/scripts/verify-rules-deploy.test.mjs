// Unit tests for the pure parity-check core. Uses only node:test + node:assert.
// NEVER pushes, deploys, or hits the network. Exercises the deterministic core
// against in-memory fixtures and temp files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hashContent,
  compareRules,
  resolveDeploySource,
  parseArgs,
  buildReport,
  MIRROR_PATH,
} from './parity-check.mjs';

const RULES_A = "rules_version = '2';\nservice cloud.firestore { match /a {} }\n";
const RULES_B = "rules_version = '2';\nservice cloud.firestore { match /b {} }\n";

test('hashContent is deterministic and content-sensitive', () => {
  assert.equal(hashContent(RULES_A), hashContent(RULES_A));
  assert.notEqual(hashContent(RULES_A), hashContent(RULES_B));
  assert.match(hashContent(RULES_A), /^[0-9a-f]{64}$/);
});

test('compareRules reports MATCH for identical content', () => {
  const r = compareRules(RULES_A, RULES_A);
  assert.equal(r.match, true);
  assert.equal(r.sourceHash, r.mirrorHash);
});

test('compareRules reports MISMATCH for differing content', () => {
  const r = compareRules(RULES_A, RULES_B);
  assert.equal(r.match, false);
  assert.notEqual(r.sourceHash, r.mirrorHash);
});

test('resolveDeploySource reads path from firebase.json config', () => {
  assert.equal(
    resolveDeploySource({ firestore: { rules: 'custom.rules' } }),
    'custom.rules',
  );
});

test('resolveDeploySource falls back to firestore.rules when unset', () => {
  assert.equal(resolveDeploySource({}), 'firestore.rules');
  assert.equal(resolveDeploySource(null), 'firestore.rules');
  assert.equal(resolveDeploySource({ firestore: {} }), 'firestore.rules');
});

test('parseArgs handles defaults and all flags', () => {
  assert.deepEqual(parseArgs([]), { root: '.', json: false, dryRun: false });
  assert.deepEqual(parseArgs(['--root', '/tmp/x', '--json', '--dry-run']), {
    root: '/tmp/x',
    json: true,
    dryRun: true,
  });
});

test('buildReport labels PARITY OK / PARITY MISMATCH', () => {
  const ok = buildReport({
    sourcePath: 'firestore.rules',
    mirrorPath: MIRROR_PATH,
    comparison: compareRules(RULES_A, RULES_A),
  });
  assert.equal(ok.status, 'PARITY OK');
  assert.equal(ok.match, true);

  const bad = buildReport({
    sourcePath: 'firestore.rules',
    mirrorPath: MIRROR_PATH,
    comparison: compareRules(RULES_A, RULES_B),
  });
  assert.equal(bad.status, 'PARITY MISMATCH');
  assert.equal(bad.match, false);
});

// Integration over temp fixture files, exercising the same pure core the CLI
// uses -- identical copies then differing copies. No side effects escape tmp.
test('temp fixtures: identical files -> MATCH, differing -> MISMATCH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-parity-'));
  try {
    mkdirSync(join(dir, 'field-ops-app-vite'), { recursive: true });
    const rootRules = join(dir, 'firestore.rules');
    const mirrorRules = join(dir, MIRROR_PATH);

    writeFileSync(rootRules, RULES_A);
    writeFileSync(mirrorRules, RULES_A);
    let cmp = compareRules(readFileSync(rootRules, 'utf8'), readFileSync(mirrorRules, 'utf8'));
    assert.equal(cmp.match, true);

    writeFileSync(mirrorRules, RULES_B);
    cmp = compareRules(readFileSync(rootRules, 'utf8'), readFileSync(mirrorRules, 'utf8'));
    assert.equal(cmp.match, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
