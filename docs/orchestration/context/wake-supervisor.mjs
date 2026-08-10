// EOS Wake Supervisor — bounded local RUNNER. DRY-RUN by default; --execute runs ONE guarded, bounded
// Claude via the token-free gate (never a second mechanism).
//
//   default        : decide + PRINT the guardrailed `claude -p` invocation. SPAWNS NOTHING.
//   --execute      : after assessReadiness returns TRIGGER and every guard passes, acquire the lease
//                    and run exactly one bounded `claude -p` (guardrails: dontAsk + allowlist +
//                    max-turns + max-budget + wall-clock; model from the shared resolver). All refusal
//                    and failure paths are captured truthfully (wakeExecute.mjs); a spawn is never
//                    reinterpreted as completed work. bypassPermissions is NEVER used.
//
// The --execute path is BUILT + TESTED (wakeExecute.test.mjs / wakeLease.test.mjs, mock runner+lease).
// Running it live against real state is the SUPERVISED PILOT — an operator/runtime activation, not
// done here. See wake-supervisor-design.md.
//
// Usage:  node wake-supervisor.mjs --state <work-state.json> [--manual] [--execute]
//   work-state.json: { item:{id,status,authorized,protectedBoundary,scope[],sha,workstream,modelTier},
//                      governor:{remoteAiUsed,remoteAiMax}, network, budgetRemainingUsd, lastRun,
//                      sourceCommit, sourceFreshness }

import { readFileSync, mkdirSync, writeFileSync, readFileSync as rf, rmSync, rmdirSync } from "node:fs";
import { assessReadiness, buildClaudeInvocation } from "../lib/wakeSupervisor.mjs";
import { executeWake } from "../lib/wakeExecute.mjs";
import { makeLease } from "../lib/wakeLease.mjs";
import { contextPackageFor } from "./build-package.mjs";

function arg(name, fb = null) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; }
const flag = (name) => process.argv.includes(`--${name}`);

// DRY-RUN: decide + show the invocation. Spawns nothing.
export function runSupervisor(state, { manual = false } = {}) {
  const ctx = {
    governor: state.governor || {}, network: state.network || "UNKNOWN",
    budgetRemainingUsd: state.budgetRemainingUsd ?? null, lastRun: state.lastRun || null,
    overnight: state.overnight === true, triggerKind: manual ? "MANUAL_RUNTIME_TRIGGER" : "AUTOMATIC_TRIGGER",
  };
  const decision = assessReadiness(state.item, ctx);
  const out = { mode: "DRY_RUN", decision: decision.decision, reason: decision.reason, triggerMechanism: decision.triggerMechanism, triggerKind: decision.triggerKind };
  if (decision.decision === "TRIGGER") {
    const pkg = contextPackageFor({ id: decision.item.id, scope: decision.item.scope || [], role: "wake-triggered worker", sourceCommit: decision.item.sha });
    out.contextPackage = { assignmentId: pkg.assignmentId, governingAuthority: pkg.governingAuthority, required: pkg.required, sufficiency: pkg.sufficiency };
    out.wouldInvoke = buildClaudeInvocation({ contextPackage: pkg, guardrails: decision.guardrails });
    out.note = "DRY_RUN — spawns nothing; pass --execute (supervised pilot) to run it guarded.";
  }
  return out;
}

// --execute (supervised pilot): a REAL bounded spawn behind the token-free gate.
export function executeSupervisor(state, { manual = false, eosDir } = {}) {
  const ctx = {
    governor: state.governor || {}, network: state.network || "UNKNOWN",
    budgetRemainingUsd: state.budgetRemainingUsd ?? null, lastRun: state.lastRun || null,
    overnight: state.overnight === true, triggerKind: manual ? "MANUAL_RUNTIME_TRIGGER" : "AUTOMATIC_TRIGGER",
  };
  // REAL bounded process runner: spawnSync claude -p with a hard wall-clock timeout (kills the tree).
  const realProcessRunner = {
    run({ bin, argv, wallClockSec }) {
      const { spawnSync } = require("node:child_process");
      const r = spawnSync(bin, argv, { timeout: Math.max(1, wallClockSec) * 1000, encoding: "utf8", windowsHide: true });
      if (r.error) return (r.error.code === "ETIMEDOUT") ? { timedOut: true, exitCode: null } : { spawnError: r.error.message };
      if (r.signal) return { timedOut: r.signal === "SIGTERM", exitCode: null, stdout: r.stdout };
      return { exitCode: r.status, stdout: r.stdout };
    },
  };
  // REAL atomic-mkdir lease under the EOS runtime dir.
  const os = require("node:os");
  const lease = makeLease({ dir: `${eosDir}/wake.lock`, fs: { mkdirSync, writeFileSync, readFileSync: rf, rmSync, rmdirSync }, host: os.hostname(), pid: process.pid, now: () => Date.now() });
  // Durable runtime evidence (outside the repo).
  const persistResult = ({ item, wake, result, cost, model }) => {
    const dir = `${eosDir}/wake-runs`; try { mkdirSync(dir, { recursive: true }); } catch {}
    writeFileSync(`${dir}/${item.id}.json`, JSON.stringify({ workId: item.id, wakeState: wake.wakeState, selectedModel: model, cost, result, at: Date.now() }, null, 2));
  };
  return executeWake({
    item: state.item, ctx, contextPackageFn: contextPackageFor, processRunner: realProcessRunner, lease,
    persistResult, sourceCommit: state.sourceCommit ?? state.item?.sha ?? null, sourceFreshness: state.sourceFreshness ?? null,
  });
}

import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const statePath = arg("state");
  if (!statePath) { process.stderr.write("usage: wake-supervisor.mjs --state <work-state.json> [--manual] [--execute]\n"); process.exit(2); }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (flag("execute")) {
    const eosDir = arg("eos-dir", `${require("node:os").homedir()}/AppData/Local/EOS`);
    const r = executeSupervisor(state, { manual: flag("manual"), eosDir });
    process.stdout.write(JSON.stringify({ mode: "EXECUTE", ...r }, null, 2) + "\n");
    process.exit(r.outcome === "SPAWNED_COMPLETED" ? 0 : 1);
  }
  process.stdout.write(JSON.stringify(runSupervisor(state, { manual: flag("manual") }), null, 2) + "\n");
}
