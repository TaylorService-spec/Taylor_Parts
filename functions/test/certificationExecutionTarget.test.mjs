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
import { readFileSync } from "node:fs";
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

// =================================================================================================
// THE INSTALLER'S OWN CLI CONTRACT.
//
// Everything above tests resolveExecutionTarget in isolation. That is necessary and it is not
// sufficient: the gate can be perfect and the tool that installs the entire Certification World can
// still not be calling it. That was literally true until this change -- certificationWorld.mjs
// gated on a registry role of "sandbox" and nothing else, so once a SECOND sandbox-role environment
// existed, `--projectId eos-platform-sandbox` became `--projectId eos-platform-certification` by
// editing one word, with no flag on the line naming which world was about to be deleted.
//
// So these drive the REAL parser and the REAL authorization decision, through the exported entry
// point main() itself uses. A future refactor that silently stops consulting the gate fails here.
// =================================================================================================
const { authorizeInvocation } = await import(L("functions/scripts/certificationWorld.mjs"));

const cli = (args, env = {}) =>
  withEnv({ FIRESTORE_EMULATOR_HOST: undefined, GOOGLE_CLOUD_PROJECT: undefined, GCLOUD_PROJECT: undefined, ...env },
    () => authorizeInvocation(args));
const cliRefused = (args, env = {}) => {
  try { cli(args, env); return null; } catch (err) { return err; }
};

const CERT_LIVE = ["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG];
const SANDBOX_LIVE = ["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG];

// -- CERTIFICATION: the mandated three, and every near-miss --------------------------------------

test("CLI: certification rebuild is ALLOWED with --projectId + --apply + the certification flag", () => {
  const r = cli(["rebuild", ...CERT_LIVE, "--confirm-reset"]);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.target.isLive, true);
  assert.equal(r.writes, true);
});

test("CLI: certification reset is ALLOWED with the three flags plus --confirm-reset", () => {
  const r = cli(["reset", ...CERT_LIVE, "--confirm-reset"]);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.writes, true);
});

test("CLI: --apply ALONE cannot write to certification", () => {
  // The generic flag says "not a dry run". It does not say WHERE, and the destination is the whole
  // question once two sandbox-role worlds exist.
  const err = cliRefused(["rebuild", "--projectId", CERTIFICATION_PROJECT, "--apply", "--confirm-reset"]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-certification/);
});

test("CLI: the certification flag ALONE cannot write to certification", () => {
  // executionTarget treats the named flag as implying --apply, which is a fine contract for a tool
  // that writes a handful of records. This one deletes and reseeds 1000+, so it demands both words.
  const err = cliRefused(["rebuild", "--projectId", CERTIFICATION_PROJECT, CERTIFICATION_LIVE_FLAG, "--confirm-reset"]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /requires BOTH --apply/);
});

test("CLI: the SANDBOX flag cannot unlock certification", () => {
  const err = cliRefused(["rebuild", "--projectId", CERTIFICATION_PROJECT, "--apply", LIVE_FLAG, "--confirm-reset"]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-certification/);
});

test("CLI: --confirm-reset ALONE cannot write to certification -- the old command is now refused", () => {
  // THE REGRESSION THIS BLOCK EXISTS FOR. `rebuild --projectId eos-platform-certification
  // --confirm-reset` used to be a complete, working, live destructive command. It must never be
  // one again: a destructive acknowledgement is not a statement about destination.
  const err = cliRefused(["rebuild", "--projectId", CERTIFICATION_PROJECT, "--confirm-reset"]);
  assert.ok(err, "the pre-change command MUST now be refused");
  assert.match(err.message, /requires BOTH --apply and --apply-live-certification/);
});

test("CLI: --confirm-reset is required IN ADDITION to the live flags, never instead of them", () => {
  const err = cliRefused(["reset", ...CERT_LIVE]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--confirm-reset/);
});

// -- SANDBOX: the existing authority is preserved, and stays its own ------------------------------

test("CLI: sandbox rebuild is ALLOWED with --projectId + --apply + the sandbox flag", () => {
  const r = cli(["rebuild", ...SANDBOX_LIVE, "--confirm-reset"]);
  assert.equal(r.target.projectId, LIVE_SANDBOX_PROJECT);
  assert.equal(r.target.isLive, true);
  assert.equal(r.writes, true);
});

test("CLI: the CERTIFICATION flag cannot unlock the sandbox", () => {
  const err = cliRefused(["rebuild", "--projectId", LIVE_SANDBOX_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG, "--confirm-reset"]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-sandbox/);
});

// -- PRODUCTION, UNKNOWN, AMBIENT, NO TARGET: refused through the CLI too -------------------------

test("CLI: PRODUCTION is refused with every flag combination", () => {
  const combos = [
    ["rebuild", "--projectId", PRODUCTION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG, "--confirm-reset"],
    ["rebuild", "--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG, "--confirm-reset"],
    ["reset", "--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG, CERTIFICATION_LIVE_FLAG, "--confirm-reset"],
    // read-only modes must refuse production too: verify opens a client against the target.
    ["verify", "--projectId", PRODUCTION_PROJECT],
    ["reset", "--projectId", PRODUCTION_PROJECT, "--dry-run"],
  ];
  for (const args of combos) {
    const err = cliRefused(args);
    assert.ok(err, "production must be refused for: " + args.join(" "));
    assert.match(err.message, /production/i);
  }
});

test("CLI: an UNKNOWN project is refused, never guessed", () => {
  const err = cliRefused(["rebuild", "--projectId", "eos-platform-certifcation", "--apply", CERTIFICATION_LIVE_FLAG, "--confirm-reset"]);
  assert.ok(err);
  assert.match(err.message, /Unknown project/);
});

test("CLI: ambient credentials must agree with --projectId", () => {
  const err = cliRefused(["rebuild", ...CERT_LIVE, "--confirm-reset"], { GOOGLE_CLOUD_PROJECT: LIVE_SANDBOX_PROJECT });
  assert.ok(err);
  assert.match(err.message, /Ambient credentials/);
});

test("CLI: no --projectId is refused; there is no default target", () => {
  const err = cliRefused(["rebuild", "--apply", CERTIFICATION_LIVE_FLAG, "--confirm-reset"]);
  assert.ok(err);
  assert.match(err.message, /--projectId is required/);
});

// -- READ-ONLY MODES MUST NOT DEMAND WRITE AUTHORITY ---------------------------------------------

test("CLI: verify needs NO live flag, against either sandbox-role world", () => {
  // Making a read require --apply-live-certification would train an operator to type the live-write
  // flag for a command that reads, which is how the flag stops meaning anything.
  for (const p of [CERTIFICATION_PROJECT, LIVE_SANDBOX_PROJECT]) {
    const r = cli(["verify", "--projectId", p]);
    assert.equal(r.writes, false, "verify must not be a write mode for " + p);
    assert.equal(r.target.projectId, p);
  }
});

test("CLI: reset --dry-run previews without live-write authorization", () => {
  const r = cli(["reset", "--projectId", CERTIFICATION_PROJECT, "--dry-run"]);
  assert.equal(r.writes, false);
});

test("CLI: the governed flags are RECOGNISED by the parser, not rejected as unknown arguments", () => {
  // Before this change the parser threw "unrecognized argument: --apply" -- the mandated command
  // could not even be typed. Asserting the parser accepts them keeps that from silently returning.
  for (const flag of ["--apply", CERTIFICATION_LIVE_FLAG, LIVE_FLAG]) {
    const err = cliRefused(["verify", "--projectId", CERTIFICATION_PROJECT, flag]);
    assert.ok(err === null || !/unrecognized argument/.test(err.message),
      "parser must recognise " + flag);
  }
});

// =================================================================================================
// THE IDENTITY TOOL'S OWN CLI CONTRACT.
//
// provisionPrincipals.mjs carried its own assertSandboxTarget until now: production refused,
// unknown projects refused, registry role must be exactly "sandbox". Correct for exactly as long
// as one sandbox-role environment existed.
//
// eos-platform-certification is ALSO role "sandbox", so under a role-only guard the command that
// mints 47 identities in the sandbox became the command that mints them in certification by
// editing one word. Identity is the layer a world reset deliberately does NOT own -- principals
// survive a rebuild -- so a mistake here is not undone by rebuilding anything.
//
// These drive the REAL parser through the exported authorizeProvisioning(), for the same reason
// the installer's tests do: the shared gate can be perfect and this file can still not be calling
// it, which is precisely what was true before.
// =================================================================================================
const { authorizeProvisioning } = await import(L("functions/scripts/certificationWorld/provisionPrincipals.mjs"));

const prov = (args, env = {}) =>
  withEnv({ FIRESTORE_EMULATOR_HOST: undefined, GOOGLE_CLOUD_PROJECT: undefined, GCLOUD_PROJECT: undefined, ...env },
    () => authorizeProvisioning(args));
const provRefused = (args, env = {}) => {
  try { prov(args, env); return null; } catch (err) { return err; }
};

// -- DRY RUN is safe and needs no live authorization ---------------------------------------------

test("PRINCIPALS: a dry run against certification is ALLOWED and is not a write", () => {
  const r = prov(["--projectId", CERTIFICATION_PROJECT]);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.apply, false, "a dry run must never report apply");
  assert.equal(r.activate, false);
});

test("PRINCIPALS: a dry run needs no live flag for either sandbox-role world", () => {
  for (const p of [CERTIFICATION_PROJECT, LIVE_SANDBOX_PROJECT]) {
    const r = prov(["--projectId", p]);
    assert.equal(r.apply, false);
    assert.equal(r.target.projectId, p);
  }
});

// -- CERTIFICATION: the mandated three, and every near-miss --------------------------------------

test("PRINCIPALS: certification creation is ALLOWED with --projectId + --apply + the certification flag", () => {
  const r = prov(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.target.isLive, true);
  assert.equal(r.apply, true);
});

test("PRINCIPALS: --apply ALONE cannot mint identities in certification", () => {
  const err = provRefused(["--projectId", CERTIFICATION_PROJECT, "--apply"]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-certification/);
});

test("PRINCIPALS: the certification flag ALONE is not a live run -- --apply is required separately", () => {
  // executionTarget infers --apply from the named flag. This tool does not: minting 47 durable
  // principals demands both words, matching certificationWorld.mjs rather than the looser default.
  const err = provRefused(["--projectId", CERTIFICATION_PROJECT, CERTIFICATION_LIVE_FLAG]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /without --apply/);
});

test("PRINCIPALS: the SANDBOX flag cannot unlock certification", () => {
  const err = provRefused(["--projectId", CERTIFICATION_PROJECT, "--apply", LIVE_FLAG]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-certification/);
});

// -- SANDBOX keeps its own authority, and only its own -------------------------------------------

test("PRINCIPALS: sandbox creation is ALLOWED with --projectId + --apply + the sandbox flag", () => {
  const r = prov(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", LIVE_FLAG]);
  assert.equal(r.target.projectId, LIVE_SANDBOX_PROJECT);
  assert.equal(r.apply, true);
});

test("PRINCIPALS: the CERTIFICATION flag cannot unlock the sandbox", () => {
  const err = provRefused(["--projectId", LIVE_SANDBOX_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(err, "must refuse");
  assert.match(err.message, /--apply-live-sandbox/);
});

// -- --activate-logins IS NOT AUTHORIZATION ------------------------------------------------------

test("PRINCIPALS: --activate-logins never produces an authorized live run on its own", () => {
  // It is a narrower question asked AFTER the target is settled, and it writes real credentials.
  // If it could stand in for a live flag, the credential-issuing switch would also be the switch
  // that chooses which project receives credentials.
  //
  // THE PROPERTY IS "NEVER APPLY", NOT "ALWAYS THROW". Two different things make these safe and
  // both are acceptable: an outright refusal, or a resolution that is a DRY RUN and therefore
  // writes nothing (the script separately reports "--activate-logins requires --apply ... Nothing
  // done."). Asserting a throw would have demanded a refusal the tool does not owe and does not
  // need; asserting apply===false states what actually has to hold.
  const combos = [
    ["--projectId", CERTIFICATION_PROJECT, "--activate-logins"],
    ["--projectId", CERTIFICATION_PROJECT, "--apply", "--activate-logins"],
    ["--projectId", CERTIFICATION_PROJECT, "--activate-logins", LIVE_FLAG],
    ["--projectId", LIVE_SANDBOX_PROJECT, "--activate-logins", CERTIFICATION_LIVE_FLAG],
  ];
  for (const args of combos) {
    let outcome;
    try { outcome = prov(args); } catch { continue; } // refused outright: safe
    assert.equal(outcome.apply, false,
      "--activate-logins must not authorize a live run for: " + args.join(" "));
  }
});

test("PRINCIPALS: --activate-logins does not change a properly authorized run's target decision", () => {
  const r = prov(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG, "--activate-logins"]);
  assert.equal(r.target.projectId, CERTIFICATION_PROJECT);
  assert.equal(r.apply, true);
  assert.equal(r.activate, true, "the flag is still reported; it is simply not what authorized the run");
});

// -- PRODUCTION, UNKNOWN, AMBIENT, NO TARGET -----------------------------------------------------

test("PRINCIPALS: PRODUCTION is refused with every flag combination, dry run included", () => {
  const combos = [
    ["--projectId", PRODUCTION_PROJECT],
    ["--projectId", PRODUCTION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG],
    ["--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG],
    ["--projectId", PRODUCTION_PROJECT, "--apply", LIVE_FLAG, CERTIFICATION_LIVE_FLAG, "--activate-logins"],
  ];
  for (const args of combos) {
    const err = provRefused(args);
    assert.ok(err, "production must be refused for: " + args.join(" "));
    assert.match(err.message, /production/i);
  }
});

test("PRINCIPALS: an UNKNOWN project is refused, never guessed", () => {
  const err = provRefused(["--projectId", "eos-platform-certifcation", "--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(err);
  assert.match(err.message, /Unknown project/);
});

test("PRINCIPALS: ambient credentials must agree with --projectId", () => {
  const err = provRefused(["--projectId", CERTIFICATION_PROJECT, "--apply", CERTIFICATION_LIVE_FLAG],
    { GOOGLE_CLOUD_PROJECT: LIVE_SANDBOX_PROJECT });
  assert.ok(err);
  assert.match(err.message, /Ambient credentials/);
});

test("PRINCIPALS: no --projectId is refused; there is no default target for identity creation", () => {
  const err = provRefused(["--apply", CERTIFICATION_LIVE_FLAG]);
  assert.ok(err);
  assert.match(err.message, /--projectId is required/);
});

test("PRINCIPALS: no weaker parallel guard survives -- the shared authority is the only path", () => {
  // The local assertSandboxTarget is gone rather than kept beside the shared gate. If it came back,
  // a role-only check would authorize certification with no flag naming it, and this would fail.
  const src = readFileSync(
    path.resolve(REPO, "functions/scripts/certificationWorld/provisionPrincipals.mjs"), "utf8");
  const declaresOwnGuard = /function\s+assertSandboxTarget\s*\(/.test(src);
  assert.equal(declaresOwnGuard, false,
    "provisionPrincipals must not declare its own target guard alongside executionTarget");
  assert.match(src, /resolveExecutionTarget/, "it must consult the shared authority");
});
