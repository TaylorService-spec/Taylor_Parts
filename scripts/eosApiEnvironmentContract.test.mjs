// THE EOS TRUSTED API CONNECTIVITY CONTRACT — can the frontend reach the right API, and only that one?
//
// ════════════════════ THE FAILURE THIS EXISTS TO STOP ════════════════════
//
// The address of the deployed non-production EOS API lived in exactly two places, and the repository
// was neither of them: a Vercel project variable no test can read, and one paragraph of prose. The
// prose went stale — `docs/architecture/eos-policy-nonprod-activation.md` still said
// `VITE_EOS_API_BASE_URL` was "absent ... which is the current state everywhere" long after the Owner
// had set it and Vite had inlined `https://eos-api-nonprod.onrender.com` into the shipped bundle.
//
// A wrong answer to "is the API configured?" is expensive in both directions. Believing it absent
// blocks work that is not actually blocked. Believing it present when it is not turns a readiness
// flip into NOT_CONFIGURED -> UNAVAILABLE and every persona loses navigation. So the address is now
// DECLARED in the one registry, and this file is what keeps the declaration honest.
//
// ════════════════════ WHAT IT DOES NOT DO ════════════════════
//
// It configures nothing. `eosApi` is validated by resolveEnvironment.mjs and never returned by it,
// so no build, bundle or runtime reads it — asserted below, because a declaration that could quietly
// become a transport would be a second source for the one value the frontend must have exactly one
// source for.
//
// It enables nothing. `EOS_NAVIGATION_AUTHORITY_READY` is false in every environment, production
// included, and knowing where the API is has no bearing on that. Asserted below, because the two are
// easy to conflate and only one of them is safe to move.
//
// Hermetic: reads the registry and render.yaml. No network, no build, no credentials — the live
// `/health` probe belongs in a report, not in CI, where it would make this suite fail on an outage
// that says nothing about the contract.
//
// Run: node --test scripts/eosApiEnvironmentContract.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  resolveEnvironment,
  EnvironmentResolutionError,
  REQUIRED_EOS_API_KEYS,
} from './resolveEnvironment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const registry = JSON.parse(read('config/environments.json'));

const environmentsWithApi = registry.environments.filter((e) => e.eosApi !== null);

// render.yaml is read with the same tiny flat reader functions/test/eosApiBlueprint.test.mjs uses,
// and for the same reason: this repository declares no YAML parser, and the file's shape is ours.
const BLUEPRINT = read('render.yaml')
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line));
const blueprintScalar = (key) => {
  const prefix = `${key}:`;
  const hit = BLUEPRINT.find((l) => l.trim().startsWith(prefix) && l.trim().length > prefix.length);
  return hit === undefined ? undefined : hit.trim().slice(prefix.length).replace(/\s+#.*$/, '').trim();
};
const blueprintEnvValue = (key) => {
  const at = BLUEPRINT.findIndex((l) => new RegExp(`^\\s*- key:\\s*${key}\\s*$`).test(l));
  if (at === -1) return undefined;
  for (let i = at + 1; i < BLUEPRINT.length; i += 1) {
    const value = /^\s*value:\s*(.+)$/.exec(BLUEPRINT[i]);
    if (value) return value[1].trim();
    if (/^\s*- key:/.test(BLUEPRINT[i])) return undefined;
  }
  return undefined;
};

// ------------------------------------------------- the declaration is explicit and fails closed

test('CONTRACT: every environment states whether it has an EOS API — silence is not an answer', () => {
  for (const e of registry.environments) {
    assert.ok('eosApi' in e, `environment '${e.id}' does not declare eosApi`);
  }
});

test('CONTRACT: an environment that FORGETS eosApi is a build error, not a silent "there is none"', () => {
  const broken = JSON.parse(JSON.stringify(registry));
  const sandbox = broken.environments.find((e) => e.id === 'platform-sandbox');
  delete sandbox.eosApi;
  assert.throws(
    () => resolveEnvironment(broken, 'platform-sandbox'),
    (err) => err instanceof EnvironmentResolutionError && err.code === 'INCOMPLETE_EOS_API',
  );
});

test('CONTRACT: a half-declared EOS API fails closed — every field or none', () => {
  for (const key of REQUIRED_EOS_API_KEYS) {
    const broken = JSON.parse(JSON.stringify(registry));
    const sandbox = broken.environments.find((e) => e.id === 'platform-sandbox');
    delete sandbox.eosApi[key];
    assert.throws(
      () => resolveEnvironment(broken, 'platform-sandbox'),
      (err) => err instanceof EnvironmentResolutionError && err.code === 'INCOMPLETE_EOS_API',
      `a missing eosApi.${key} was accepted`,
    );
  }
});

test('CONTRACT: a plaintext EOS API base URL is refused — the browser sends a bearer token on every call', () => {
  const broken = JSON.parse(JSON.stringify(registry));
  const sandbox = broken.environments.find((e) => e.id === 'platform-sandbox');
  sandbox.eosApi.baseUrl = 'http://eos-api-nonprod.onrender.com';
  assert.throws(
    () => resolveEnvironment(broken, 'platform-sandbox'),
    (err) => err instanceof EnvironmentResolutionError && err.code === 'INSECURE_EOS_API',
  );
});

// ---------------------------------------------------------------- exactly one, and which one

test('CONTRACT: exactly ONE environment has an EOS API, and it is platform-sandbox', () => {
  assert.deepEqual(environmentsWithApi.map((e) => e.id), ['platform-sandbox']);
});

test('CONTRACT: NO production-role environment declares an EOS API — production has nowhere to send a policy read', () => {
  // The fence. A production frontend with an API address would be one Vercel variable away from
  // pointing the customer's live application at a non-production policy store.
  for (const e of registry.environments) {
    if (e.role !== 'production') continue;
    assert.equal(e.eosApi, null, `production environment '${e.id}' declares an EOS API`);
  }
});

test('CONTRACT: the non-production API address is the measured one, and says non-production in its own name', () => {
  const api = environmentsWithApi[0].eosApi;
  assert.equal(api.baseUrl, 'https://eos-api-nonprod.onrender.com');
  assert.equal(api.baseUrl.endsWith('/'), false, 'a trailing slash would double the separator in every built URL');
  assert.match(api.baseUrl, /nonprod/, 'the non-production API must say so in its own hostname');
  assert.equal(api.frontendEnvironmentVariable, 'VITE_EOS_API_BASE_URL');
});

// -------------------------------------------- the registry and the Blueprint have to agree

test('CONTRACT: the declared service and health path are the ones render.yaml actually deploys', () => {
  const api = environmentsWithApi[0].eosApi;
  assert.equal(blueprintScalar('name'), api.service, 'render.yaml deploys a differently named service');
  assert.equal(blueprintScalar('healthCheckPath'), api.healthPath);
});

test('CONTRACT: the browser origin has exactly ONE home, and the registry points at it rather than copying it', () => {
  // The API compares a browser's Origin header against EOS_ALLOWED_ORIGINS, so a value that has
  // drifted from the frontend's real hostname does not degrade -- it refuses every call the
  // application makes, with a CORS error naming neither side. The temptation is to mirror it into
  // the registry for cross-checking; that was tried and it is wrong twice over. The hostname carries
  // brand identity, which deploymentDrift.test.mjs guards this registry against, and a second copy
  // of an origin is how one of them goes stale -- the exact failure mode being defended against.
  const api = environmentsWithApi[0].eosApi;
  assert.equal(api.allowedBrowserOriginAuthority, 'render.yaml EOS_ALLOWED_ORIGINS');
  const allowed = blueprintEnvValue('EOS_ALLOWED_ORIGINS');
  assert.ok(allowed, 'render.yaml must declare the allowed origin with its value, not prompt for it');
  assert.doesNotMatch(allowed, /[*,]/, 'one stable origin, never a wildcard and never a list that has grown');
  assert.match(allowed, /^https:\/\//, 'the frontend origin is HTTPS');
  // And it is not the production application. The API is non-production and must never name the
  // customer's live frontend as a caller it trusts.
  assert.doesNotMatch(allowed, /taylor-parts/, 'the non-production API must not trust a production origin');
});

test('CONTRACT: the API verifies tokens from the SAME Firebase project the frontend signs into', () => {
  // Otherwise every authenticated call fails at verifyIdToken with an audience mismatch, and the
  // frontend would be "configured" in the sense that matters least.
  const env = environmentsWithApi[0];
  assert.equal(blueprintEnvValue('GOOGLE_CLOUD_PROJECT'), env.firebase.projectId);
  assert.equal(blueprintEnvValue('EOS_ENVIRONMENT'), 'nonprod');
  assert.notEqual(env.role, 'production');
});

// ---------------------------------------------- declaring an address enables nothing

test('CONTRACT: EOS_NAVIGATION_AUTHORITY_READY is FALSE in every environment, production included', () => {
  // Knowing where the API is and switching navigation authority to it are two decisions. This file
  // makes the first one; the second is the Owner's, and it is not made here.
  for (const e of registry.environments) {
    assert.equal(
      e.readiness.EOS_NAVIGATION_AUTHORITY_READY,
      false,
      `environment '${e.id}' enabled the EOS navigation authority seam`,
    );
  }
});

test('CONTRACT: eosApi is NOT projected into the resolved environment — nothing can build a transport from it', () => {
  // The frontend reads its base URL from VITE_EOS_API_BASE_URL and from nowhere else. If this key
  // ever appeared in the resolved object, vite.config.js could define it into the bundle and the
  // registry would silently become a second way to configure the one transport that must have one.
  for (const id of ['platform-sandbox', 'taylor-parts-production']) {
    const resolved = resolveEnvironment(registry, id);
    assert.ok(!('eosApi' in resolved), `resolveEnvironment projected eosApi for '${id}'`);
  }
  const viteConfig = read('field-ops-app-vite/vite.config.js');
  assert.ok(!viteConfig.includes('eosApi'), 'the Vite build must not define the registry address into the bundle');
  assert.ok(
    !viteConfig.includes('VITE_EOS_API_BASE_URL'),
    'the base URL reaches the bundle through Vite env inlining, not through a define',
  );
});

test('CONTRACT: the EOS API declaration carries an address and never a credential', () => {
  // A service URL is public. An API key, a token or a connection string is not, and none of the
  // three has any business in a file that ships in git history.
  for (const e of environmentsWithApi) {
    const raw = JSON.stringify(e.eosApi).toLowerCase();
    for (const forbidden of ['apikey', 'secret', 'token', 'password', 'postgres://', 'postgresql://', 'bearer ']) {
      assert.ok(!raw.includes(forbidden), `eosApi on '${e.id}' leaked '${forbidden}'`);
    }
  }
});
