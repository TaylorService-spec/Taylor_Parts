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
// It enables nothing. Declaring `eosApi` never moves `EOS_NAVIGATION_AUTHORITY_READY`; the flag is
// moved only by an Owner ruling, and as of Wave 11 / Lane AS exactly one has been moved --
// platform-sandbox. The two are easy to conflate and only one of them is ever safe to move, so what
// is asserted below is the PAIR's invariants: no seam without an API, and never in production.
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

test('CONTRACT: the browser origin has exactly ONE AUTHORITY, and every other copy of it is pinned equal', () => {
  // The API compares a browser's Origin header against EOS_ALLOWED_ORIGINS, so a value that has
  // drifted from the frontend's real hostname does not degrade -- it refuses every call the
  // application makes, with a CORS error naming neither side. render.yaml is that value's one
  // AUTHORITY and still is; nothing below moves it.
  //
  // WAVE 14 / LANE AZ -- WHAT CHANGED AND WHY. This test used to say the origin had exactly one
  // HOME, and gave two reasons for refusing to record it anywhere else: brand identity, which
  // deploymentDrift.test.mjs guarded the registry against, and staleness, because a second copy is
  // how one of them goes wrong. The first was a rule about the registry, and it has been moved
  // there: an address field is now the one narrow place a brand token may appear.
  //
  // The second is a real and permanent hazard, and it is answered rather than avoided. The cost of
  // the avoidance was concrete: config/environments.json, whose declared job is to record where each
  // environment is served, named the Firebase Hosting review site as platform-sandbox's only
  // surface. That is not the EOS application and its origin is not admitted by this API, so D2
  // measured drift against a surface no EOS persona uses, and nothing in the repository said where
  // the EOS frontend actually was.
  //
  // So the application surface is now declared, and the copy is made incapable of drifting instead
  // of being trusted not to: the assertion below fails the moment the registry's application-surface
  // url and EOS_ALLOWED_ORIGINS stop being byte-identical, in EITHER direction. That is strictly
  // more than the old arrangement checked, which was nothing.
  const api = environmentsWithApi[0].eosApi;
  assert.equal(api.allowedBrowserOriginAuthority, 'render.yaml EOS_ALLOWED_ORIGINS');
  const allowed = blueprintEnvValue('EOS_ALLOWED_ORIGINS');
  assert.ok(allowed, 'render.yaml must declare the allowed origin with its value, not prompt for it');
  assert.doesNotMatch(allowed, /[*,]/, 'one stable origin, never a wildcard and never a list that has grown');
  assert.match(allowed, /^https:\/\//, 'the frontend origin is HTTPS');
  // And it is not the production application. The API is non-production and must never name the
  // customer's live frontend as a caller it trusts.
  assert.doesNotMatch(allowed, /taylor-parts/, 'the non-production API must not trust a production origin');

  // THE PIN. Exactly one surface of the environment that has an API is the EOS application, and its
  // recorded address IS the origin that API admits. Property-based, not id-based: no environment id
  // and no hostname is written here, so this keeps holding when either moves.
  const env = environmentsWithApi[0];
  const appSurfaces = (env.surfaces ?? []).filter((s) => s.eosApplication === true);
  assert.equal(appSurfaces.length, 1,
    `environment '${env.id}' declares an EOS API but ${appSurfaces.length} application surfaces -- ` +
    'the frontend that reaches it must be identifiable, and identifiable as one thing');
  assert.equal(appSurfaces[0].url, allowed,
    "the registry's EOS application surface and render.yaml EOS_ALLOWED_ORIGINS have drifted apart; " +
    'a browser served from the recorded surface would be refused by CORS on every EOS call');
  assert.equal(appSurfaces[0].versionPath, '/version.json',
    'the application surface must be able to identify itself to D2');
});

test('CONTRACT: an environment with no EOS API declares no EOS application surface', () => {
  // The other direction of the same pair, and the production fence restated as a surface property:
  // an environment with nowhere to send an EOS call has no EOS application, so a surface claiming to
  // be one would be a frontend pointed at an API that does not exist for it. Production declares
  // `eosApi: null`, so this forbids marking either of its surfaces as the EOS application.
  for (const e of registry.environments) {
    if (e.eosApi !== null) continue;
    const claimed = (e.surfaces ?? []).filter((s) => s.eosApplication === true).map((s) => s.id);
    assert.deepEqual(claimed, [],
      `environment '${e.id}' declares no eosApi but marks ${claimed.join(', ')} as the EOS application`);
  }
});

test('CONTRACT: the EOS application surface is not the legacy Firebase Hosting review site', () => {
  // WAVE 14 / LANE AZ, the defect this lane corrected, pinned so it cannot come back by a later edit
  // that reduces platform-sandbox to one surface again. Stated as a property of the surface KIND
  // rather than as a hostname, because the hostname belongs to render.yaml and is pinned to it above.
  const env = environmentsWithApi[0];
  const app = (env.surfaces ?? []).find((s) => s.eosApplication === true);
  assert.notEqual(app.kind, 'firebase-hosting',
    'the Firebase Hosting review surface is not the EOS application -- its origin is not admitted by ' +
    'EOS_ALLOWED_ORIGINS, so every EOS call from it is refused by CORS');
  // And the review surface is still RECORDED. Reclassified, never deleted: it is still deployed and
  // still the target of scripts/_sandboxRefresh.run.sh, and a registry that forgot it would hide
  // infrastructure that exists.
  const review = (env.surfaces ?? []).filter((s) => s.kind === 'firebase-hosting');
  assert.equal(review.length, 1, 'the Firebase Hosting surface must remain declared, not erased');
  assert.notEqual(review[0].eosApplication, true);
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

// ════════════════════ WAVE 11 / LANE AS: THE SECOND DECISION HAS NOW BEEN MADE, ONCE ═════════════
//
// This test used to assert the flag was false in EVERY environment. That was a statement of FACT
// about a pre-activation world, not a safety property, and repeating it would now be false. The
// Owner activated the seam in non-production, in exactly one environment.
//
// What replaces it is the two invariants the old assertion was standing in for, each of which is a
// real safety property and neither of which this activation touches:
//
//   1. NO SEAM WITHOUT AN API. An environment that enables the flag with `eosApi: null` has no
//      governed source to ask, so every persona's navigation resolves NOT_CONFIGURED -> UNAVAILABLE
//      and nobody can navigate at all. That is the exact failure this file's header names, and it is
//      now REFUSED rather than merely described.
//   2. PRODUCTION NEVER. A production-role environment may not enable it, full stop -- and because
//      production declares `eosApi: null`, rule 1 already forbids it a second time, independently.
//
// The activation is therefore pinned by its PROPERTIES, not by a hard-coded id list: the one
// environment that may be on is the one that has an API and is not production.

test('CONTRACT: no environment enables the EOS navigation seam without an eosApi to ask', () => {
  // Rule 1. The flag and the address are separate decisions, but the flag is meaningless -- worse
  // than meaningless -- without the address, so this direction of the pair IS enforced.
  for (const e of registry.environments) {
    if (e.readiness.EOS_NAVIGATION_AUTHORITY_READY !== true) continue;
    assert.notEqual(
      e.eosApi,
      null,
      `environment '${e.id}' enabled the EOS navigation authority seam with no eosApi configured — `
        + 'every persona there would resolve NOT_CONFIGURED -> UNAVAILABLE and lose navigation',
    );
  }
});

test('CONTRACT: EOS_NAVIGATION_AUTHORITY_READY is FALSE in every production-role environment', () => {
  // Rule 2, and it is absolute. Nothing about a non-production activation may reach production.
  for (const e of registry.environments) {
    if (e.role !== 'production') continue;
    assert.equal(
      e.readiness.EOS_NAVIGATION_AUTHORITY_READY,
      false,
      `production-role environment '${e.id}' enabled the EOS navigation authority seam`,
    );
    assert.equal(e.eosApi, null, `production-role environment '${e.id}' declares an EOS API`);
  }
});

test('CONTRACT: exactly one environment has the seam enabled, and it is platform-sandbox', () => {
  // The activation is ONE environment wide. A second one appearing here is a change nobody ruled on,
  // whether it arrives by edit or by copy-paste from the entry above it.
  const enabled = registry.environments
    .filter((e) => e.readiness.EOS_NAVIGATION_AUTHORITY_READY === true)
    .map((e) => e.id);
  assert.deepEqual(enabled, ['platform-sandbox'],
    `the EOS navigation authority seam is enabled in ${enabled.length} environments: ${enabled.join(', ')}`);

  // platform-certification is frozen by standing ruling; naming it keeps the freeze checkable here
  // rather than only in a memory of the ruling.
  const certification = registry.environments.find((e) => e.id === 'platform-certification');
  assert.equal(certification.readiness.EOS_NAVIGATION_AUTHORITY_READY, false,
    'platform-certification is frozen by standing ruling and must not be activated');
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
