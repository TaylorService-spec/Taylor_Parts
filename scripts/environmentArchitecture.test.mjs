// O-3 — environment configuration ARCHITECTURE INVARIANTS.
//
// These are not unit tests of convenience. Each one locks a property that, if it
// silently regressed, would reintroduce a defect this program already paid to
// find: production hard-coding, wildcard project acceptance, "production means
// Taylor Parts", or a weakened production guard.
//
// Hermetic: reads repository source and the registry. No network, no build, no
// credentials.
//
// Run: node --test scripts/environmentArchitecture.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  resolveEnvironment,
  isProductionEnvironment,
  isKnownProjectId,
  knownProjectIds,
  knownEnvironmentIds,
  EnvironmentResolutionError,
  REQUIRED_FIREBASE_KEYS,
  READINESS_KEYS,
  SPINE_OVERRIDE_ELIGIBLE_IDS,
  resolveCapabilityActivationOverrides,
} from './resolveEnvironment.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
/**
 * Source with comments stripped. Invariants must assert about CODE, not prose —
 * a comment that legitimately quotes an old literal (e.g. explaining what was
 * removed and why) must not trip the guard. This program has already made the
 * inverse mistake once, miscounting Rules call sites by grepping comments.
 */
const readCode = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
const registry = JSON.parse(read('config/environments.json'));

// ---------------------------------------------- no production hard-coding

test('INVARIANT: the client Firebase module contains NO hard-coded project identity', () => {
  // The S-1 defect: `projectId: "taylor-parts"` in source meant the app could
  // not point anywhere but the customer's production project.
  const src = readCode('field-ops-app-vite/src/firebase/firebase.js');
  assert.ok(src.includes('__APP_FIREBASE_CONFIG__'),
    'firebase.js must consume injected identity from the registry');
  for (const forbidden of ['projectId: "taylor-parts"', 'taylor-parts.firebaseapp.com', 'taylor-parts.firebasestorage.app']) {
    assert.ok(!src.includes(forbidden), `firebase.js re-hard-coded production identity: ${forbidden}`);
  }
  assert.ok(!/getFunctions\(app,\s*["']us-central1["']\)/.test(src),
    'Functions region must be environment-resolved, not a literal');
});

test('INVARIANT: readiness flags are registry-resolved, not compiled-in literals', () => {
  // The S-3 defect: build-time constants would force a sandbox to be a
  // materially different artifact from the production-intended build.
  const files = {
    'field-ops-app-vite/src/config/receivingReadiness.js': 'RECEIVING_TRANSPORT_READY',
    'field-ops-app-vite/src/config/truckManagementReadiness.js': 'TRUCK_MANAGEMENT_WRITE_READY',
    'field-ops-app-vite/src/config/trustedCompletion.js': 'TRUSTED_COMPLETION_ENABLED',
    'field-ops-app-vite/src/config/partMasterWriteReadiness.js': 'PART_MASTER_WRITE_READY',
  };
  for (const [file, flag] of Object.entries(files)) {
    const src = readCode(file);
    assert.ok(src.includes(`__APP_READINESS__.${flag}`), `${file} must resolve ${flag} from the registry`);
    assert.ok(!new RegExp(`export const ${flag} = (true|false);`).test(src),
      `${file} re-introduced a compiled-in literal for ${flag}`);
  }
});

test('INVARIANT: PART_MASTER_WRITE_READY is enabled in the sandbox ONLY — never in a production-role environment', () => {
  // Wave 7 activation: platform-sandbox may attempt the Part Master write
  // callables so the governed create/edit/status UX is exercisable there.
  // Readiness is NOT authorization -- a principal still needs the deployed
  // callables plus a governed roleAssignment carrying inventory.catalog.manage
  // / .activate. This asserts the blast radius of the flag itself, which is the
  // part a repo edit can widen by accident.
  const enabled = registry.environments
    .filter((e) => e.readiness.PART_MASTER_WRITE_READY === true)
    .map((e) => e.id);
  assert.deepEqual(enabled, ['platform-sandbox']);
  for (const e of registry.environments) {
    if (e.role !== 'production') continue;
    assert.equal(
      e.readiness.PART_MASTER_WRITE_READY,
      false,
      `production environment '${e.id}' must not enable Part Master write`,
    );
  }
});

// ---------------------------------------------------------- fails closed

test('INVARIANT: an unknown environment id FAILS CLOSED — never falls back', () => {
  // A silent fallback would let a typo point a sandbox build at live customer data.
  assert.throws(
    () => resolveEnvironment(registry, 'does-not-exist'),
    (err) => err instanceof EnvironmentResolutionError && err.code === 'UNKNOWN_ENVIRONMENT',
  );
});

test('INVARIANT: a declared-but-unprovisioned environment FAILS CLOSED', () => {
  // platform-sandbox was provisioned 2026-08-06, so platform-integration is now
  // the unprovisioned example. The property under test is unchanged.
  assert.throws(
    () => resolveEnvironment(registry, 'platform-integration'),
    (err) => err instanceof EnvironmentResolutionError && err.code === 'ENVIRONMENT_NOT_PROVISIONED',
  );
});

test('INVARIANT: an absent readiness flag FAILS CLOSED — never defaults to enabled', () => {
  const broken = JSON.parse(JSON.stringify(registry));
  const prod = broken.environments.find((e) => e.role === 'production');
  delete prod.readiness.RECEIVING_TRANSPORT_READY;
  assert.throws(
    () => resolveEnvironment(broken, prod.id),
    (err) => err.code === 'INCOMPLETE_READINESS',
  );
});

test('INVARIANT: an incomplete Firebase identity FAILS CLOSED', () => {
  const broken = JSON.parse(JSON.stringify(registry));
  const prod = broken.environments.find((e) => e.role === 'production');
  delete prod.firebase.projectId;
  assert.throws(
    () => resolveEnvironment(broken, prod.id),
    (err) => err.code === 'INCOMPLETE_FIREBASE_IDENTITY',
  );
});

// ------------------------------------------------- unknown project rejection

test('INVARIANT: unknown project ids are NOT accepted — the allow-list is not a wildcard', () => {
  // S-4: production guards may become allow-list based, never project-agnostic.
  assert.equal(isKnownProjectId(registry, 'taylor-parts'), true);
  for (const hostile of ['some-other-project', '', 'taylor-parts-evil', '*']) {
    assert.equal(isKnownProjectId(registry, hostile), false, `accepted unknown project '${hostile}'`);
  }
});

test('INVARIANT: existing production guards remain hard and un-weakened', () => {
  // These are deliberate fail-closed safety controls (S-4). O-3 established an
  // allow-list mechanism but must NOT have loosened them; no sandbox project
  // exists yet, so relaxing a guard now would be risk with no benefit.
  const codec = read('functions/src/warehouseGovernance/warehouseBackupCodec.ts');
  assert.ok(codec.includes('projectId must be taylor-parts'),
    'warehouseBackupCodec production guard was weakened');
  const trusted = read('functions/src/access/trustedWriterCommands.ts');
  // #973 replaced the former hard-coded `BOOTSTRAP_ADMIN_PROJECT = "taylor-parts"`
  // literal with a stronger cross-project fail-closed check: the confirmed target
  // project must equal the runtime project the Admin SDK actually writes to, for
  // ANY known project (not just "taylor-parts"). Assert the structural guard that
  // replaced it is still present and still refuses on mismatch.
  assert.ok(trusted.includes('runtimeProject !== input.projectId'),
    'bootstrapCompatibilityAdmin cross-project fail-closed guard was weakened');
  assert.ok(trusted.includes('project mismatch:') && trusted.includes('fail closed; bootstrap provenance must match the write target'),
    'bootstrapCompatibilityAdmin no longer fails closed on a project mismatch');
});

// ------------------------------------------- role/deployment not conflated

test('INVARIANT: production is keyed on ROLE, never on project or deployment name', () => {
  const prod = resolveEnvironment(registry, 'taylor-parts-production');
  assert.equal(isProductionEnvironment(prod), true);
  // A hypothetical second customer must also be production without any code change.
  assert.equal(isProductionEnvironment({ role: 'production', deployment: 'other-customer' }), true);
  assert.equal(isProductionEnvironment({ role: 'sandbox', deployment: 'taylor-parts' }), false);
});

test('INVARIANT: no production environment belongs to the platform deployment', () => {
  for (const e of registry.environments) {
    if (e.role === 'production') {
      assert.notEqual(e.deployment, 'platform',
        'a production environment belongs to a customer deployment, not the platform itself');
    }
  }
});

test('INVARIANT: platform environments do not inherit Taylor Parts identity', () => {
  // Naming/identity leakage guard: sandbox/integration are platform-owned and
  // must not adopt the first customer as the permanent platform identity.
  for (const e of registry.environments) {
    if (e.deployment !== 'platform') continue;
    assert.ok(!e.id.includes('taylor'), `platform environment '${e.id}' inherited customer identity`);
    if (e.firebase?.projectId) {
      assert.ok(!e.firebase.projectId.includes('taylor'),
        `platform environment '${e.id}' uses a Taylor Parts project id`);
    }
  }
});

// -------------------------------------------------------- secrets + shape

test('INVARIANT: the registry contains no credentials or secrets', () => {
  // A Firebase Web apiKey is a PUBLIC project identifier and is expected here.
  // Anything that is an actual credential is not.
  const raw = read('config/environments.json').toLowerCase();
  for (const forbidden of [
    'private_key', 'begin private key', 'client_secret', 'refresh_token',
    'service_account', 'serviceaccount', 'bearer ',
  ]) {
    assert.ok(!raw.includes(forbidden), `registry leaked a credential: ${forbidden}`);
  }
});

test('INVARIANT: registry is schema-versioned and every environment is well-formed', () => {
  assert.equal(registry.schema, 2);
  assert.ok(registry.defaultEnvironmentId, 'registry must declare a default environment');
  assert.ok(knownEnvironmentIds(registry).includes(registry.defaultEnvironmentId));
  for (const e of registry.environments) {
    assert.ok(['sandbox', 'integration', 'production'].includes(e.role), `bad role on ${e.id}`);
    assert.ok(['platform', 'taylor-parts'].includes(e.deployment) || e.deployment.length > 0);
    for (const key of READINESS_KEYS) {
      assert.equal(typeof e.readiness?.[key], 'boolean', `${e.id} missing readiness ${key}`);
    }
    if (e.firebase) {
      for (const key of REQUIRED_FIREBASE_KEYS) {
        assert.ok(e.firebase[key], `${e.id} missing firebase.${key}`);
      }
    }
  }
});

test('INVARIANT: the default environment reproduces the current production identity', () => {
  // Guards against an accidental change to what an un-parameterised build targets.
  const resolved = resolveEnvironment(registry, null);
  assert.equal(resolved.id, 'taylor-parts-production');
  assert.equal(resolved.firebase.projectId, 'taylor-parts');
  assert.equal(resolved.firebase.functionsRegion, 'us-central1');
  assert.equal(resolved.readiness.RECEIVING_TRANSPORT_READY, false);
  assert.equal(resolved.readiness.TRUCK_MANAGEMENT_WRITE_READY, true);
  assert.equal(resolved.readiness.TRUSTED_COMPLETION_ENABLED, true);
});

test('INVARIANT: the known-project allow-list is exactly the provisioned projects', () => {
  // Updated DELIBERATELY on 2026-08-06 when O-1 provisioned the sandbox — which
  // is exactly what the previous single-project assertion existed to force. The
  // allow-list must never grow silently; each addition is a real project that
  // was really created.
  assert.deepEqual(knownProjectIds(registry).sort(), ['eos-platform-sandbox', 'taylor-parts']);
});

// ------------------------------ per-environment capability activation (spec 2026-08-14)

test('INVARIANT: NO production-role environment may declare capabilityActivationOverrides', () => {
  // Hard-block #1 (data). Production must NEVER be activatable via this path;
  // absence of the key (not an empty array) is the contract.
  for (const e of registry.environments) {
    if (e.role === 'production') {
      assert.ok(
        !('capabilityActivationOverrides' in e),
        `production environment '${e.id}' must not carry capabilityActivationOverrides`,
      );
    }
  }
});

test('INVARIANT: every declared activation override is a spine-eligible id (no unrelated active:false sweep-in)', () => {
  const eligible = new Set(SPINE_OVERRIDE_ELIGIBLE_IDS);
  for (const e of registry.environments) {
    if (!('capabilityActivationOverrides' in e)) continue;
    assert.ok(Array.isArray(e.capabilityActivationOverrides), `${e.id} overrides must be an array`);
    for (const id of e.capabilityActivationOverrides) {
      assert.ok(eligible.has(id), `${e.id} declares non-eligible activation override '${id}'`);
    }
  }
});

test('INVARIANT: platform-sandbox activates exactly the eligible capability set (nothing more)', () => {
  // Was "the 11 spine capabilities". Wave 7 added three Owner-authorized ids
  // (workOrder.parts.plan, crm.activity.create, crm.activity.read), so a hard-coded count would
  // now be a number to maintain rather than a property. The property that actually matters is
  // unchanged and asserted below: sandbox activates the eligible set EXACTLY -- never a superset,
  // and never a stale subset that would leave a shipped capability silently denied.
  const sandbox = registry.environments.find((e) => e.id === 'platform-sandbox');
  assert.deepEqual(
    [...sandbox.capabilityActivationOverrides].sort(),
    [...SPINE_OVERRIDE_ELIGIBLE_IDS].sort(),
  );
});

test('INVARIANT: the resolved projection is role-keyed — production resolves to [] even if data is poisoned', () => {
  // Hard-block #2 (code). Mirrors environmentCapabilityOverrides.ts: role wins
  // over registry data, so a mis-edit cannot leak activation into production.
  const poisonedProd = { role: 'production', capabilityActivationOverrides: [...SPINE_OVERRIDE_ELIGIBLE_IDS] };
  assert.deepEqual(resolveCapabilityActivationOverrides(poisonedProd), []);
  // And the real production entry projects [].
  const resolvedProd = resolveEnvironment(registry, 'taylor-parts-production');
  assert.deepEqual(resolvedProd.capabilityActivationOverrides, []);
});

test('INVARIANT: resolveCapabilityActivationOverrides intersects with the eligible allow-list', () => {
  const sneaky = { role: 'sandbox', capabilityActivationOverrides: ['opportunity.write', 'admin.credentialReset.initiate'] };
  assert.deepEqual(resolveCapabilityActivationOverrides(sneaky), ['opportunity.write']);
});

test('INVARIANT: the sandbox build bakes in the full spine override set', () => {
  const resolvedSandbox = resolveEnvironment(registry, 'platform-sandbox');
  assert.deepEqual(
    [...resolvedSandbox.capabilityActivationOverrides].sort(),
    [...SPINE_OVERRIDE_ELIGIBLE_IDS].sort(),
  );
});

test('INVARIANT: the frontend eligible allow-list matches the backend resolver mirror (no drift)', () => {
  // Source-based parity: the two hardcoded eligible lists (scripts/resolveEnvironment.mjs
  // and functions/src/access/environmentCapabilityOverrides.ts) must agree.
  const backendSrc = readCode('functions/src/access/environmentCapabilityOverrides.ts');
  const backendIds = new Set(
    [...backendSrc.matchAll(/"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)].map((m) => m[1]),
  );
  for (const id of SPINE_OVERRIDE_ELIGIBLE_IDS) {
    assert.ok(backendIds.has(id), `backend mirror is missing eligible id '${id}'`);
  }
});
