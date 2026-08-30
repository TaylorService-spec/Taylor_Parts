// THE ONE GATE EVERY CERTIFICATION TOOL PASSES THROUGH.
//
// ============================ WHY ONE, AND NOT TEN ============================
//
// Widening ten scripts from emulator-only to live-capable by pasting a target check into each is how
// nine of them end up correct and the tenth ends up subtly different. The tenth is the one that
// writes to production.
//
// So there is exactly one gate. Every script that can touch a real project calls it, it is tested
// once, and a change to the safety posture happens in one place or not at all.
//
// ============================ WHAT IT REFUSES, AND WHY EACH ONE ============================
//
//   production                a role of "production" refuses unconditionally, ahead of any data
//   the customer project      taylor-parts refuses BY NAME as well as by role -- belt and braces
//   an unknown project        a typo must not resolve to something; unknown is refused, not guessed
//   no project                there is no default target for a write
//   ambient credentials       ADC that resolves a DIFFERENT project than the one asked for is
//                             refused: the caller's intent and the runtime's identity must agree
//   live without saying so    --apply alone can never reach live Firestore
//
// ============================ THE FLAGS ARE DELIBERATELY UGLY ============================
//
// `--apply-live-sandbox` and `--apply-live-certification` are long and specific because a person
// typing one has decided something. A short flag is one a tired operator adds to make an error
// message go away.
//
// They are also SEPARATE, and there is no generic `--apply-live`. Each live target is bound to its
// own flag, so the command an operator types names the environment it writes to; a single flag
// covering both would mean the same line hits a different project depending on an argument
// elsewhere on it.
import { pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { ENVIRONMENT_ACTIVATION_REGISTRY, resolveCapabilityOverrides } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

/** The live sandbox. */
export const LIVE_SANDBOX_PROJECT = "eos-platform-sandbox";
/** The deployable synthetic certification runtime, provisioned 2026-08-30. */
export const CERTIFICATION_PROJECT = "eos-platform-certification";
/** Refused by name as well as by role. */
export const PRODUCTION_PROJECT = "taylor-parts";
/** The flag that must be typed for a live sandbox write. Long on purpose. */
export const LIVE_FLAG = "--apply-live-sandbox";
/** Certification's own flag. Deliberately NOT a second spelling of the sandbox one. */
export const CERTIFICATION_LIVE_FLAG = "--apply-live-certification";

/**
 * Every live-writable project, each bound to the ONE flag that unlocks it.
 *
 * A MAP RATHER THAN A SET, AND THAT IS THE WHOLE POINT. A set of permitted projects plus a single
 * "--apply-live" flag would mean the sentence an operator types no longer names where the write
 * lands: the same command would hit the sandbox or the certification runtime depending on a
 * --projectId argument somewhere else on the line. Binding each target to its own flag keeps the
 * two facts adjacent, so a command written for one environment cannot be re-pointed at the other
 * by editing one word.
 *
 * Adding an entry here is a deliberate act. It is the only place a project becomes live-writable,
 * and everything else about the gate -- production by name, production by role, unknown projects,
 * ambient-credential agreement -- applies to it unchanged.
 */
export const LIVE_TARGET_FLAGS_BY_PROJECT = new Map([
  [LIVE_SANDBOX_PROJECT, LIVE_FLAG],
  [CERTIFICATION_PROJECT, CERTIFICATION_LIVE_FLAG],
]);

export class ExecutionTargetRefused extends Error {
  constructor(message) { super(message); this.name = "ExecutionTargetRefused"; }
}

const refuse = (why) => { throw new ExecutionTargetRefused(why); };

/**
 * Resolve, and validate, where this invocation is allowed to act.
 *
 * @param {object} opts
 * @param {string[]} opts.argv            process.argv
 * @param {boolean} opts.writes           does this tool mutate anything?
 * @returns {{projectId, mode, isEmulator, isLive, apply, activationOverrides}}
 */
export function resolveExecutionTarget({ argv = process.argv, writes = true } = {}) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const has = (name) => argv.includes(name);

  const projectId = flag("--projectId");
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? null;
  const isEmulator = Boolean(emulatorHost);

  if (!projectId) refuse("--projectId is required. There is no default target.");

  // ── Production, refused two independent ways ─────────────────────────────────────────────────
  if (projectId === PRODUCTION_PROJECT) {
    refuse(`"${projectId}" is the customer production project. Refused by name.`);
  }
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || [])
    .find((e) => e?.firebase?.projectId === projectId);
  if (env?.role === "production") {
    refuse(`"${projectId}" has role "production". Refused by role, regardless of its data.`);
  }

  // ── Unknown projects ─────────────────────────────────────────────────────────────────────────
  //
  // An emulator may run under a project the registry has never heard of -- that is what an emulator
  // is for -- but a LIVE target must be a project somebody deliberately registered.
  if (!env && !isEmulator) {
    refuse(`Unknown project "${projectId}" and no emulator host. A typo must not resolve to something.`);
  }

  // ── Live targets are named, and each has its own flag ────────────────────────────────────────
  const isLive = !isEmulator;
  const liveFlag = LIVE_TARGET_FLAGS_BY_PROJECT.get(projectId) ?? null;
  if (isLive && !liveFlag) {
    refuse(`Live execution is limited to ${[...LIVE_TARGET_FLAGS_BY_PROJECT.keys()].join(", ")}. `
      + `Refusing "${projectId}".`);
  }

  // ── Ambient credentials must agree with stated intent ────────────────────────────────────────
  //
  // ADC can carry its own project. If it names a DIFFERENT one than the caller asked for, the
  // caller's intent and the runtime's identity disagree and there is no safe way to pick a winner.
  if (isLive) {
    const ambient = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
    if (ambient && ambient !== projectId) {
      refuse(`Ambient credentials name "${ambient}" but --projectId says "${projectId}". Refusing rather than choosing.`);
    }
  }

  // ── Explicit live intent, for THIS target ────────────────────────────────────────────────────
  //
  // The flag checked is the one bound to the resolved project, so the sandbox flag cannot unlock
  // certification and certification's cannot unlock the sandbox. A command carrying the wrong
  // environment's flag is refused rather than quietly accepted as "some live intent was expressed".
  const apply = has("--apply") || (liveFlag !== null && has(liveFlag));
  if (isLive && writes && apply && !has(liveFlag)) {
    refuse(`Writing to ${projectId} requires ${liveFlag} as well as --apply. `
      + "--apply alone never reaches live Firestore.");
  }

  // ── Capability activation comes from the TARGET, never from the emulator's exception ─────────
  //
  // demo-certworld activates the Pass 3 families so the emulator can exercise real authorization.
  // That exception is emulator-only and must not follow the tooling into the sandbox: the live
  // sandbox has its own governed activation, and using the emulator's would mean the live run was
  // authorized by a fixture decision rather than by the environment's own posture.
  const activationOverrides = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);

  return {
    projectId,
    mode: isEmulator ? "emulator" : "live",
    isEmulator,
    isLive,
    apply,
    emulatorHost,
    role: env?.role ?? "emulator",
    activationOverrides,
  };
}

/**
 * A verifier's gate. Reads only, so it needs no live flag -- but still refuses production.
 *
 * Forcing a read-only check into emulator mode helps nobody: the whole point of a verifier is to
 * look at the world you actually care about.
 */
export function resolveReadOnlyTarget({ argv = process.argv } = {}) {
  return resolveExecutionTarget({ argv, writes: false });
}

/** One line, so every tool announces the same thing in the same shape. */
export function describeTarget(t) {
  return `target : ${t.projectId} (${t.mode}${t.isEmulator ? ` ${t.emulatorHost}` : `, role=${t.role}`})`
    + `  mode: ${t.apply ? (t.isLive ? "APPLY LIVE" : "APPLY") : "DRY RUN"}`;
}
