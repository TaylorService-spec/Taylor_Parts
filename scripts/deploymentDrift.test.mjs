// C3/D2 — tests for the expected-vs-deployed pure core.
//
// Hermetic: no network, no filesystem beyond reading the registry, no git.
// Every fetch result is a fixture, so CI never depends on a live deployment.
//
// Run: node --test scripts/deploymentDrift.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  classifyManifest,
  commitsMatch,
  compareSurface,
  summarizeEnvironment,
  unobservableEnvironments,
  ManifestState,
  DriftVerdict,
} from './deploymentDrift.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(resolve(HERE, '../config/environments.json'), 'utf8'));

const validBody = JSON.stringify({
  commit: 'fef1ca3', base: '/', buildTime: '2026-08-06T23:12:49.495Z', schema: 1,
});

// --------------------------------------------------------------- classification

test('D2: a well-formed manifest classifies VALID', () => {
  const r = classifyManifest({ status: 200, body: validBody, contentType: 'application/json' });
  assert.equal(r.state, ManifestState.VALID);
  assert.equal(r.manifest.commit, 'fef1ca3');
});

test('D2: SPA catch-all (200 + text/html) is ABSENT, never VALID', () => {
  // THE CASE THAT MOTIVATED CONTENT-BASED CLASSIFICATION. Firebase Hosting
  // rewrites ** -> /index.html, so a missing /version.json returns HTTP 200
  // with HTML. Verified live against the real deployment. A status-only check
  // would call this "manifest present" and report a stale surface as healthy.
  const html = '<!doctype html>\n<html lang="en">\n  <head>...';
  const r = classifyManifest({ status: 200, body: html, contentType: 'text/html; charset=utf-8' });
  assert.equal(r.state, ManifestState.ABSENT_SPA_FALLBACK);
  assert.equal(r.manifest, null);
});

test('D2: HTML detected by body even when content-type lies', () => {
  const r = classifyManifest({
    status: 200, body: '  <!DOCTYPE HTML><html>', contentType: 'application/json',
  });
  assert.equal(r.state, ManifestState.ABSENT_SPA_FALLBACK);
});

test('D2: 404 is ABSENT_NOT_FOUND', () => {
  assert.equal(
    classifyManifest({ status: 404, body: 'Not Found', contentType: 'text/plain' }).state,
    ManifestState.ABSENT_NOT_FOUND,
  );
});

test('D2: unparseable or wrong-shaped JSON is MALFORMED, not VALID', () => {
  for (const body of ['{not json', '[]', 'null', '"a string"', JSON.stringify({ commit: 'abc' })]) {
    const r = classifyManifest({ status: 200, body, contentType: 'application/json' });
    assert.equal(r.state, ManifestState.MALFORMED, `expected MALFORMED for ${body}`);
  }
});

test('D2: an empty commit is MALFORMED — a manifest that identifies nothing is not valid', () => {
  const body = JSON.stringify({ commit: '', base: '/', buildTime: 'x', schema: 1 });
  assert.equal(
    classifyManifest({ status: 200, body, contentType: 'application/json' }).state,
    ManifestState.MALFORMED,
  );
});

test('D2: network failure is UNREACHABLE, distinct from absent', () => {
  assert.equal(
    classifyManifest({ status: 0, body: '', contentType: null }).state,
    ManifestState.UNREACHABLE,
  );
});

// ------------------------------------------------------------------ commit match

test('D2: short deployed sha matches its full expected sha', () => {
  assert.ok(commitsMatch('fef1ca3', 'fef1ca3a1b2c3d4e5f60718293a4b5c6d7e8f900'));
  assert.ok(commitsMatch('fef1ca3a1b2c3d4e5f60718293a4b5c6d7e8f900', 'fef1ca3'));
});

test('D2: different commits never match, and a prefix-only overlap is required', () => {
  assert.equal(commitsMatch('fef1ca3', 'abc1234'), false);
  assert.equal(commitsMatch('fef1ca3', 'fef1ca4'), false);
  assert.equal(commitsMatch('', 'fef1ca3'), false);
  assert.equal(commitsMatch(null, 'fef1ca3'), false);
});

// ------------------------------------------------------------------- comparison

const surface = { id: 'hosting', url: 'https://example.test/version.json', governed: true };

test('D2: deployed == expected is MATCH', () => {
  const r = compareSurface({
    surface, expectedSha: 'fef1ca3a1b2c3d4e5f60718293a4b5c6d7e8f900',
    fetched: { status: 200, body: validBody, contentType: 'application/json' },
  });
  assert.equal(r.verdict, DriftVerdict.MATCH);
  assert.equal(r.deployedCommit, 'fef1ca3');
});

test('D2: deployed != expected is DRIFT and reports both sides', () => {
  const r = compareSurface({
    surface, expectedSha: 'aaaaaaa1111111111111111111111111111111111',
    fetched: { status: 200, body: validBody, contentType: 'application/json' },
  });
  assert.equal(r.verdict, DriftVerdict.DRIFT);
  assert.equal(r.deployedCommit, 'fef1ca3');
  assert.equal(r.expectedCommit, 'aaaaaaa1111111111111111111111111111111111');
});

test('D2: a surface with no manifest is UNKNOWN — never silently DRIFT or MATCH', () => {
  // Fabricating a verdict from absent evidence is the failure mode this guards.
  const r = compareSurface({
    surface, expectedSha: 'fef1ca3',
    fetched: { status: 200, body: '<!doctype html><html>', contentType: 'text/html' },
  });
  assert.equal(r.verdict, DriftVerdict.UNKNOWN_NO_MANIFEST);
  assert.equal(r.deployedCommit, null);
});

test('D2: unreachable is its own verdict, distinct from missing manifest', () => {
  const r = compareSurface({
    surface, expectedSha: 'fef1ca3',
    fetched: { status: 0, body: '', contentType: null },
  });
  assert.equal(r.verdict, DriftVerdict.UNKNOWN_UNREACHABLE);
});

// ------------------------------------------------------------------ environment

const env = { id: 'e', role: 'production', deployment: 'x', status: 'live' };

test('D2: one drifted surface drifts the whole environment', () => {
  const s = summarizeEnvironment(env, [
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
    { verdict: DriftVerdict.DRIFT, deployedCommit: 'bbb2222' },
  ]);
  assert.equal(s.verdict, 'DRIFT');
});

test('D2: surfaces disagreeing WITH EACH OTHER is flagged separately', () => {
  // Higher severity than drift from expectation: different users are running
  // different code right now. Observed live between Pages and Hosting.
  const s = summarizeEnvironment(env, [
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
    { verdict: DriftVerdict.DRIFT, deployedCommit: 'bbb2222' },
  ]);
  assert.equal(s.surfacesDisagree, true);
});

test('D2: agreeing surfaces are not flagged as disagreeing', () => {
  const s = summarizeEnvironment(env, [
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
  ]);
  assert.equal(s.verdict, 'MATCH');
  assert.equal(s.surfacesDisagree, false);
});

test('D2: an environment with no observable surface is UNKNOWN, not MATCH', () => {
  const s = summarizeEnvironment(env, [{ verdict: DriftVerdict.UNKNOWN_NO_MANIFEST }]);
  assert.equal(s.verdict, 'UNKNOWN');
});

test('D2: an environment with no surfaces at all is NOT_OBSERVABLE', () => {
  assert.equal(summarizeEnvironment(env, []).verdict, 'NOT_OBSERVABLE');
});

// --------------------------------------------------------------------- registry

test('D2 registry: is valid and schema-versioned', () => {
  // schema 2 = O-3 extended the registry with per-environment Firebase identity
  // and readiness, making it the single source of truth rather than adding a
  // second mechanism alongside it.
  assert.equal(registry.schema, 2);
  assert.ok(Array.isArray(registry.environments) && registry.environments.length > 0);
});

test('D2 registry: every environment declares role, deployment and status', () => {
  for (const e of registry.environments) {
    assert.ok(e.id, 'environment missing id');
    assert.ok(['sandbox', 'integration', 'production'].includes(e.role), `bad role on ${e.id}`);
    assert.ok(e.deployment, `missing deployment on ${e.id}`);
    assert.ok(['live', 'not-provisioned'].includes(e.status), `bad status on ${e.id}`);
  }
});

test('D2 registry: role is INDEPENDENT of deployment — production is not synonymous with one customer', () => {
  // Guards the modelling decision directly. If a future edit collapses these,
  // the registry would encode "production means Taylor Parts" as permanent
  // architecture, contradicting DeploymentModeStrategy.md's multi-company
  // design objective.
  const roles = new Set(registry.environments.map((e) => e.role));
  const deployments = new Set(registry.environments.map((e) => e.deployment));
  assert.ok(roles.size > 1, 'registry must model more than one role');
  assert.ok(deployments.has('platform'), 'platform-operated environments must be representable');
  const production = registry.environments.filter((e) => e.role === 'production');
  for (const p of production) {
    assert.notEqual(p.deployment, 'platform',
      'a production environment belongs to a customer deployment, not to the platform itself');
  }
});

const BRAND_TOKENS = Object.freeze(['verenward']);
const LEGAL_TOKENS = Object.freeze(['llc', 'inc.', 'trademark', '™', '®']);

test('D2 registry: declares no company or brand identity outside a deployed address', () => {
  // Brand foundation is a separate workstream; this registry must not duplicate
  // or pre-empt it. `operator` is a neutral architectural placeholder.
  //
  // WAVE 14 / LANE AZ. This test used to scan the whole serialized registry for
  // brand tokens, and that blanket form was doing two jobs at once. The property
  // worth keeping is that the registry must not DECLARE a company identity as
  // architecture -- in `operator`, in ids, in purposes, in notes. A deployed
  // surface's hostname is not that: it is a measured address of a thing that
  // exists, and recording where each environment is served is this registry's
  // entire reason for existing. The blanket scan made the two indistinguishable,
  // so platform-sandbox's real EOS frontend could not be named here at all and
  // D2 measured drift against a surface no EOS persona uses.
  //
  // So the scan now runs over the registry with the ADDRESS fields lifted out,
  // which is a narrower door, not an open one: a brand token may enter through a
  // surface `url` or an `eosApi.baseUrl` and through nothing else. Everywhere
  // else it is refused exactly as before. Legal-entity markers are refused
  // EVERYWHERE, addresses included -- a hostname is an address, and 'LLC' in one
  // is a brand declaration wearing an address's clothes.
  assert.equal(registry.operator, 'platform-operator');

  const stripped = JSON.parse(JSON.stringify(registry));
  const addresses = [];
  for (const e of stripped.environments) {
    for (const s of e.surfaces ?? []) {
      if (typeof s.url === 'string') addresses.push(s.url);
      delete s.url;
    }
    if (e.eosApi && typeof e.eosApi.baseUrl === 'string') {
      addresses.push(e.eosApi.baseUrl);
      delete e.eosApi.baseUrl;
    }
  }

  const serialized = JSON.stringify(stripped).toLowerCase();
  for (const forbidden of [...BRAND_TOKENS, ...LEGAL_TOKENS]) {
    assert.ok(!serialized.includes(forbidden), `registry leaked brand/legal identity: ${forbidden}`);
  }
  for (const url of addresses) {
    for (const forbidden of LEGAL_TOKENS) {
      assert.ok(!url.toLowerCase().includes(forbidden),
        `deployment address leaked legal identity: ${url}`);
    }
  }
});

test('D2 registry: the address exemption is exactly one field per surface, and it is load-bearing', () => {
  // Guards the guard above. If a later edit widens the exemption -- lifting out
  // `notes`, or skipping the scan when an address is present -- the narrow door
  // becomes a hole and nothing would say so. Two fixtures prove the boundary is
  // where it is claimed to be.
  const leaked = JSON.parse(JSON.stringify(registry));
  leaked.environments[0].notes = `${leaked.environments[0].notes ?? ''} Verenward`;
  assert.ok(
    BRAND_TOKENS.some((t) => JSON.stringify(leaked).toLowerCase().includes(t)),
    'the fixture must actually contain the token it is testing for',
  );
  const strippedLeak = JSON.parse(JSON.stringify(leaked));
  for (const e of strippedLeak.environments) {
    for (const s of e.surfaces ?? []) delete s.url;
    if (e.eosApi) delete e.eosApi.baseUrl;
  }
  assert.ok(
    BRAND_TOKENS.some((t) => JSON.stringify(strippedLeak).toLowerCase().includes(t)),
    'a brand token in `notes` must still be visible after addresses are lifted out',
  );

  // And a legal marker inside an address is still caught, which is what stops the
  // exemption from being a general-purpose bypass.
  const badAddress = 'https://acme-llc.example.com';
  assert.ok(LEGAL_TOKENS.some((t) => badAddress.toLowerCase().includes(t)),
    'a legal-entity marker in a hostname must be detectable');
});

test('D2 registry: unobservable environments are enumerable', () => {
  const un = unobservableEnvironments(registry);
  const ids = un.map((e) => e.id);
  assert.ok(ids.includes('platform-integration'),
    'the missing integration environment must be visible as a declared gap');
  // platform-sandbox was provisioned 2026-08-06 and is now OBSERVABLE, so it is
  // deliberately no longer in this list. platform-integration remains the gap.
  assert.ok(!ids.includes('platform-sandbox'),
    'platform-sandbox is provisioned and should now be observable');
});

test('D2 registry: the governed/ungoverned distinction is recorded per surface', () => {
  const prod = registry.environments.find((e) => e.role === 'production');
  const governedFlags = prod.surfaces.map((s) => s.governed);
  assert.ok(governedFlags.includes(true), 'a governed surface must be identifiable');
  assert.ok(governedFlags.includes(false),
    'the ungoverned auto-publishing surface must be recorded as such (R-2)');
});

test('D2: MATCH_PARTIAL when some surfaces are unreadable — never a clean MATCH', () => {
  // The live case: one surface matches, a second (governed, known days stale)
  // predates D1 and cannot self-identify. Reporting MATCH would assert a
  // cleanliness that was never observed.
  const s = summarizeEnvironment(env, [
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
    { verdict: DriftVerdict.UNKNOWN_NO_MANIFEST, deployedCommit: null },
  ]);
  assert.equal(s.verdict, 'MATCH_PARTIAL');
  assert.equal(s.unobservableCount, 1);
});

test('D2: full coverage with agreement is a clean MATCH', () => {
  const s = summarizeEnvironment(env, [
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
    { verdict: DriftVerdict.MATCH, deployedCommit: 'aaa1111' },
  ]);
  assert.equal(s.verdict, 'MATCH');
  assert.equal(s.unobservableCount, 0);
});
