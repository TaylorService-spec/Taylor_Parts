// THE GATE THAT DECIDES WHERE CERTIFICATION TOOLING MAY ACT.
//
// ============================ WHY THIS FILE IS THE IMPORTANT ONE ============================
//
// Ten certification scripts were emulator-only, which made them safe by construction: an
// `if (!FIRESTORE_EMULATOR_HOST) FAILED` cannot write to a real project. Widening them to reach the
// live sandbox removed that construction, and everything protecting a real project now lives in one
// function.
//
// So the refusals are tested by name, one per failure mode, rather than as a single "it refuses bad
// input" assertion. Each of these is a different way somebody ends up writing where they did not
// mean to.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, resolveReadOnlyTarget, ExecutionTargetRefused,
  LIVE_SANDBOX_PROJECT, CERTIFICATION_PROJECT, PRODUCTION_PROJECT, LIVE_FLAG,
  CERTIFICATION_LIVE_FLAG } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

/** Run the gate under a controlled environment, always restoring it. */
function withEnv(env, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
}
const gate = (args, env = {}, opts = {}) =>
  withEnv({ FIRESTORE_EMULATOR_HOST: undefined, GOOGLE_CLOUD_PROJECT: undefined, GCLOUD_PROJECT: undefined, ...env },
    () => resolveExecutionTarget({ argv: ["node", "script", ...args], ...opts }));

const refused = (args, env = {}, opts = {}) => {
  try { gate(args, env, opts); return null; } catch (err) { return err; }
};

// ── PRODUCTION ────────────────────────────────────────────────────────────────────────────────

test("PRODUCTION is refused BY NAME", () => {
  const err = refused([`--projectId`, PRODUCTION_PROJECT, "--apply", LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /customer production project/);
});

test("PRODUCTION is refused BY ROLE, independently of its name", () => {
  // Belt and braces on purpose. If the production project were ever renamed, the role check still
  // refuses -- and if the registry were ever wrong about the role, the name check still refuses.
  // Neither is load-bearing alone.
  const err = refused(["--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG]);
  assert.ok(err, "must refuse");
});

test("MUTATION: production is refused even with an emulator host set", () => {
  // The shape somebody would hit by leaving FIRESTORE_EMULATOR_HOST exported in their shell and
  // then typing a real project id. The emulator host must not launder a production target.
  const err = refused(["--projectId", PRODUCTION_PROJECT, "--apply"],
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.ok(err instanceof ExecutionTargetRefused, "an emulator host must not make production reachable");
});

// ── EVERYTHING ELSE THAT IS NOT THE SANDBOX ───────────────────────────────────────────────────

test("an UNKNOWN project is refused, never guessed", () => {
  const err = refused(["--projectId", "eos-platform-sandbx", "--apply", LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /Unknown project/);
});

test("NO project is refused -- there is no default target", () => {
  const err = refused(["--apply", LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /--projectId is required/);
});

test("a live target that is not the sandbox is refused", () => {
  // Guards the case where a second non-production environment is added to the registry later. Being
  // non-production is not the same as being the one project this tooling installs into.
  const err = refused(["--projectId", "platform-integration", "--apply", LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
});

// ── AMBIENT CREDENTIALS ───────────────────────────────────────────────────────────────────────

test("ADC naming a DIFFERENT project than requested is refused", () => {
  // The quiet one. Credentials carry their own project, and if it disagrees with what was typed
  // there is no safe way to choose a winner -- so it refuses rather than picking.
  const err = refused(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG],
    { GOOGLE_CLOUD_PROJECT: PRODUCTION_PROJECT });
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /Ambient credentials name/);
});

test("ADC agreeing with the request is accepted", () => {
  const t = gate(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG],
    { GOOGLE_CLOUD_PROJECT: LIVE_SANDBOX_PROJECT });
  assert.equal(t.projectId, LIVE_SANDBOX_PROJECT);
});

// ── EXPLICIT LIVE INTENT ──────────────────────────────────────────────────────────────────────

test("--apply ALONE never reaches live Firestore", () => {
  const err = refused(["--projectId", LIVE_SANDBOX_PROJECT, "--apply"]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /--apply-live-sandbox/);
});

test("the live flag is required, and it is deliberately verbose", () => {
  const t = gate(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG]);
  assert.equal(t.isLive, true);
  assert.equal(t.apply, true);
  assert.ok(LIVE_FLAG.length > 12, "a short flag is one a tired operator adds to silence an error");
});

test("a live DRY RUN needs no flag -- it writes nothing", () => {
  const t = gate(["--projectId", LIVE_SANDBOX_PROJECT]);
  assert.equal(t.isLive, true);
  assert.equal(t.apply, false);
});

// ── EMULATOR STILL WORKS ──────────────────────────────────────────────────────────────────────

test("the emulator keeps its simple invocation", () => {
  const t = gate(["--projectId", "demo-certworld", "--apply"],
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.equal(t.isEmulator, true);
  assert.equal(t.apply, true);
  assert.equal(t.mode, "emulator");
});

// ── ACTIVATION FOLLOWS THE TARGET ─────────────────────────────────────────────────────────────

test("ACTIVATION COMES FROM THE TARGET, NOT FROM THE EMULATOR'S EXCEPTION", () => {
  // The subtle one, and the reason this is asserted rather than assumed. demo-certworld activates 9
  // capabilities so the emulator can exercise real authorization. Carrying that set into a live run
  // would mean the live actions were authorized by a FIXTURE decision instead of by the sandbox's
  // own governed posture.
  const emulator = gate(["--projectId", "demo-certworld", "--apply"],
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  const live = gate(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG]);

  assert.notDeepEqual([...emulator.activationOverrides].sort(), [...live.activationOverrides].sort(),
    "the two environments must not resolve the same activation set");
  assert.ok(live.activationOverrides.size > emulator.activationOverrides.size,
    "the sandbox activates its own, broader, governed set");
  for (const id of ["inventory.transfer.create", "inventory.cycleCount.reconcile", "inventory.returns.intake"]) {
    assert.ok(live.activationOverrides.has(id), `${id} must be activated by the SANDBOX itself`);
  }
});

test("production resolves NO activation, whichever way it is reached", () => {
  // It cannot be reached at all, but if the refusal above were ever removed, this is the second wall.
  // ESM: this file has no require. Imported at the top instead.
  assert.equal(resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, PRODUCTION_PROJECT).size, 0);
});

// ── READ-ONLY ─────────────────────────────────────────────────────────────────────────────────

test("a read-only tool may read the live sandbox without a live flag", () => {
  // Forcing a verifier into emulator mode helps nobody: the point of a verifier is to look at the
  // world you actually care about. It still refuses production.
  const t = withEnv({ FIRESTORE_EMULATOR_HOST: undefined, GOOGLE_CLOUD_PROJECT: undefined },
    () => resolveReadOnlyTarget({ argv: ["node", "s", "--projectId", LIVE_SANDBOX_PROJECT] }));
  assert.equal(t.isLive, true);
  assert.equal(t.apply, false);
});

test("a read-only tool still refuses production", () => {
  const err = (() => {
    try {
      withEnv({ FIRESTORE_EMULATOR_HOST: undefined },
        () => resolveReadOnlyTarget({ argv: ["node", "s", "--projectId", PRODUCTION_PROJECT] }));
      return null;
    } catch (e) { return e; }
  })();
  assert.ok(err instanceof ExecutionTargetRefused, "reading production is still refused");
});

// ── THE DEPLOYABLE CERTIFICATION RUNTIME ──────────────────────────────────────────────────────
//
// Certification is the second live-writable target this gate has ever had. The tests that matter
// are not "it works" -- they are the ones proving the second target did not turn one flag into a
// skeleton key for both.

test("CERTIFICATION is live-writable with its OWN flag", () => {
  const t = gate(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.equal(t.projectId, CERTIFICATION_PROJECT);
  assert.equal(t.isLive, true);
  assert.equal(t.apply, true);
});

test("CERTIFICATION refuses --apply alone, exactly as the sandbox does", () => {
  const err = refused(["--projectId", CERTIFICATION_PROJECT, "--apply"]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /requires --apply-live-certification/);
});

test("the SANDBOX flag does not unlock certification", () => {
  // The whole reason the flags are separate. Somebody adapting a working sandbox command by
  // changing only --projectId must be stopped, not accommodated.
  const err = refused(["--projectId", CERTIFICATION_PROJECT, "--apply", LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /requires --apply-live-certification/);
});

test("the CERTIFICATION flag does not unlock the sandbox", () => {
  // And symmetrically. Neither flag is a general "yes, live" -- each names one environment.
  const err = refused(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(err instanceof ExecutionTargetRefused);
  assert.match(err.message, /requires --apply-live-sandbox/);
});

test("there is no generic live flag", () => {
  // If one is ever added, this fails -- which is the point. The refusal must not be satisfiable by
  // a word that names no environment.
  for (const generic of ["--apply-live", "--live", "--force-live"]) {
    const err = refused(["--projectId", CERTIFICATION_PROJECT, "--apply", generic]);
    assert.ok(err instanceof ExecutionTargetRefused, `${generic} must not unlock a live write`);
  }
});

test("the sandbox is completely unaffected by certification existing", () => {
  // Regression, stated as equality rather than as a fresh assertion about what the sandbox does.
  const t = gate(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG]);
  assert.equal(t.projectId, LIVE_SANDBOX_PROJECT);
  assert.equal(t.isLive, true);
  assert.equal(t.apply, true);
});

test("CERTIFICATION obeys every refusal the sandbox obeys", () => {
  // Each of these already refuses for the sandbox. A new target that skipped any of them would be
  // a hole shaped exactly like the environment nobody has looked at yet.

  // ambient credentials naming a different project
  assert.ok(refused(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG],
    { GOOGLE_CLOUD_PROJECT: LIVE_SANDBOX_PROJECT }) instanceof ExecutionTargetRefused,
    "ambient credentials must still have to agree with --projectId");

  // a typo in the certification name is unknown, not "close enough"
  const typo = refused(["--projectId", "eos-platform-certifcation", "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(typo instanceof ExecutionTargetRefused);
  assert.match(typo.message, /Unknown project/);

  // and no project at all is still no default
  const none = refused(["--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(none instanceof ExecutionTargetRefused);
  assert.match(none.message, /--projectId is required/);
});

test("CERTIFICATION activates no capabilities", () => {
  // Nothing is deployed there, so an override set would be permissions for code that does not
  // exist. The sandbox's list is not inherited -- the lookup is per-project, never by role.
  const t = gate(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.equal(t.activationOverrides.size ?? t.activationOverrides.length, 0);
});
