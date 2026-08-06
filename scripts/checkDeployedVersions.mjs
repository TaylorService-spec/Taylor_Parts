#!/usr/bin/env node
// C3/D2 — expected-vs-deployed comparison, CLI.
//
// Answers "what SHA should each environment be running, and does deployed ==
// expected?" by reading each declared surface's D1 version manifest and
// comparing it against an expected revision.
//
// STRICTLY READ-ONLY. Unauthenticated HTTP GETs against public URLs plus one
// local `git rev-parse`. No credentials, no writes, no deploys, no promotion,
// no infrastructure change. Safe to run at any time by anyone.
//
// Usage:
//   node scripts/checkDeployedVersions.mjs
//   node scripts/checkDeployedVersions.mjs --expected <sha> --json
//   node scripts/checkDeployedVersions.mjs --env taylor-parts-production
//
// Exit codes:  0 = no drift observed   1 = drift observed   2 = usage/config error
// UNKNOWN (surface predates D1, or unreachable) does NOT fail the run — it is
// reported honestly rather than being coerced into a pass or a failure.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  compareSurface,
  summarizeEnvironment,
  unobservableEnvironments,
  DriftVerdict,
  ManifestState,
} from './deploymentDrift.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../config/environments.json');
const TIMEOUT_MS = 20000;

function parseArgs(argv) {
  const args = { json: false, expected: null, env: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--expected') args.expected = argv[++i] ?? null;
    else if (argv[i] === '--env') args.env = argv[++i] ?? null;
  }
  return args;
}

function resolveExpected(explicit) {
  if (explicit) return { sha: explicit, source: 'explicit --expected' };
  try {
    const sha = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
    return { sha, source: 'origin/main (local ref — run `git fetch` first)' };
  } catch {
    return { sha: null, source: 'unresolved' };
  }
}

async function fetchManifest(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const body = await res.text();
    return { status: res.status, body, contentType: res.headers.get('content-type') };
  } catch {
    return { status: 0, body: '', contentType: null };
  } finally {
    clearTimeout(timer);
  }
}

const MANIFEST_NOTE = {
  [ManifestState.ABSENT_SPA_FALLBACK]:
    'no manifest — SPA catch-all served index.html (surface predates D1)',
  [ManifestState.ABSENT_NOT_FOUND]: 'no manifest — 404 (surface predates D1)',
  [ManifestState.MALFORMED]: 'manifest present but malformed',
  [ManifestState.UNREACHABLE]: 'surface unreachable',
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  } catch (err) {
    console.error(`Cannot read environment registry at ${REGISTRY}: ${err.message}`);
    process.exit(2);
  }

  const expected = resolveExpected(args.expected);
  if (!expected.sha) {
    console.error('Could not resolve an expected revision. Pass --expected <sha>.');
    process.exit(2);
  }

  const selected = (registry.environments ?? []).filter(
    (e) => !args.env || e.id === args.env,
  );
  if (selected.length === 0) {
    console.error(`No environment matched${args.env ? ` --env ${args.env}` : ''}.`);
    process.exit(2);
  }

  const results = [];
  for (const env of selected) {
    const surfaceResults = [];
    for (const surface of env.surfaces ?? []) {
      const url = `${surface.url}${surface.versionPath}`;
      const fetched = await fetchManifest(url);
      surfaceResults.push(compareSurface({ surface: { ...surface, url }, expectedSha: expected.sha, fetched }));
    }
    results.push(summarizeEnvironment(env, surfaceResults));
  }

  const drifted = results.some((r) => r.verdict === 'DRIFT');

  if (args.json) {
    console.log(JSON.stringify(
      { expected, generatedFrom: 'config/environments.json', results,
        unobservable: unobservableEnvironments(registry) },
      null, 2,
    ));
    process.exit(drifted ? 1 : 0);
  }

  console.log(`Expected revision: ${expected.sha}`);
  console.log(`Source:            ${expected.source}\n`);

  for (const env of results) {
    console.log(`${env.environmentId}  [role=${env.role} deployment=${env.deployment} status=${env.status}]  -> ${env.verdict}`);
    if (env.unobservableCount > 0 && env.verdict === 'MATCH_PARTIAL') {
      console.log(`  note: ${env.unobservableCount} surface(s) could not be read — coverage is PARTIAL, not a clean pass`);
    }
    if (env.surfacesDisagree) {
      console.log('  !! SURFACES DISAGREE WITH EACH OTHER — different users are running different code');
    }
    for (const s of env.surfaces) {
      const gov = s.governed === false ? ' (ungoverned surface)' : '';
      if (s.verdict === DriftVerdict.MATCH) {
        console.log(`  ok    ${s.surfaceId}${gov}: ${s.deployedCommit} == expected`);
      } else if (s.verdict === DriftVerdict.DRIFT) {
        console.log(`  DRIFT ${s.surfaceId}${gov}: deployed ${s.deployedCommit} != expected ${s.expectedCommit} (built ${s.buildTime})`);
      } else {
        console.log(`  ?     ${s.surfaceId}${gov}: ${MANIFEST_NOTE[s.manifestState] ?? s.manifestState}`);
      }
    }
    console.log('');
  }

  const unobservable = unobservableEnvironments(registry);
  if (unobservable.length) {
    console.log('Declared but not observable (no deployed surface):');
    for (const e of unobservable) console.log(`  - ${e.id} [${e.role}] ${e.status}`);
    console.log('');
  }

  console.log(drifted ? 'RESULT: drift observed.' : 'RESULT: no drift observed.');
  console.log('Note: UNKNOWN surfaces predate D1 and cannot self-identify until a build carrying');
  console.log('      the version manifest is deployed. Deployment is Owner-gated (R-2).');
  process.exit(drifted ? 1 : 0);
}

main().catch((err) => {
  console.error(`Unexpected failure: ${err?.message ?? err}`);
  process.exit(2);
});
