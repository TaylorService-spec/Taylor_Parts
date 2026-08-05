#!/usr/bin/env node
// Deterministic Firestore Rules dual-copy parity check.
//
// Compares the deploy-source rules file (root `firestore.rules`, per
// `firebase.json`) against the app-tree copy (`field-ops-app-vite/firestore.rules`)
// by SHA-256 hash and reports MATCH / MISMATCH.
//
// The PURE core (hashContent, compareRules, resolveDeploySource, parseArgs) has
// NO side effects and is exported for unit testing. Only `main()` touches the
// filesystem. No network, no git, no deploy -- this script never mutates
// anything (there is nothing to mutate; --dry-run is accepted as a no-op for
// interface symmetry with mutating skill scripts).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// ----- Pure core (no side effects) -----------------------------------------

/** SHA-256 hex digest of a string. Deterministic. */
export function hashContent(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compare two rules file contents by hash.
 * Returns { match, sourceHash, mirrorHash }.
 */
export function compareRules(sourceContent, mirrorContent) {
  const sourceHash = hashContent(sourceContent);
  const mirrorHash = hashContent(mirrorContent);
  return { match: sourceHash === mirrorHash, sourceHash, mirrorHash };
}

/**
 * Given the parsed contents of firebase.json, return the deploy-source rules
 * path relative to repo root. Falls back to "firestore.rules" when the config
 * does not specify one. Pure -- takes the already-parsed object.
 */
export function resolveDeploySource(firebaseConfig) {
  const fromConfig = firebaseConfig?.firestore?.rules;
  return typeof fromConfig === 'string' && fromConfig.length > 0
    ? fromConfig
    : 'firestore.rules';
}

/** The fixed second (mirror) copy path relative to repo root. */
export const MIRROR_PATH = 'field-ops-app-vite/firestore.rules';

/** Parse argv (array of strings after the script name). Pure. */
export function parseArgs(argv) {
  const opts = { root: '.', json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

/**
 * Build the final report object from resolved paths + compare result. Pure.
 */
export function buildReport({ sourcePath, mirrorPath, comparison }) {
  return {
    status: comparison.match ? 'PARITY OK' : 'PARITY MISMATCH',
    match: comparison.match,
    source: { path: sourcePath, hash: comparison.sourceHash },
    mirror: { path: mirrorPath, hash: comparison.mirrorHash },
  };
}

// ----- Side-effecting shell (filesystem only) ------------------------------

function readFirebaseConfig(root) {
  const p = join(root, 'firebase.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function abs(root, rel) {
  return isAbsolute(rel) ? rel : join(root, rel);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root;

  const config = readFirebaseConfig(root);
  const sourceRel = resolveDeploySource(config);
  const sourceAbs = abs(root, sourceRel);
  const mirrorAbs = abs(root, MIRROR_PATH);

  for (const [label, p] of [['deploy-source', sourceAbs], ['mirror', mirrorAbs]]) {
    if (!existsSync(p)) {
      const msg = `MISSING ${label} rules file: ${p}`;
      if (opts.json) console.log(JSON.stringify({ status: 'ERROR', error: msg }));
      else console.error(msg);
      process.exit(2);
    }
  }

  const comparison = compareRules(
    readFileSync(sourceAbs, 'utf8'),
    readFileSync(mirrorAbs, 'utf8'),
  );
  const report = buildReport({
    sourcePath: sourceRel,
    mirrorPath: MIRROR_PATH,
    comparison,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.status}`);
    console.log(`  deploy-source: ${report.source.path}  ${report.source.hash}`);
    console.log(`  mirror:        ${report.mirror.path}  ${report.mirror.hash}`);
    if (!report.match) {
      console.log(`  Resolve parity before deploy: diff ${sourceRel} ${MIRROR_PATH}`);
    }
  }

  process.exit(report.match ? 0 : 1);
}

// Only run main when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
