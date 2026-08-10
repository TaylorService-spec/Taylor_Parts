// EOS Wake Supervisor — bounded local prototype RUNNER (DRY-RUN by default).
//
// Reads cheap durable work-state, decides via the token-free core (wakeSupervisor.mjs), and — when a
// wake is warranted — bootstraps the worker with a C-7 context package (the SAME package mechanism,
// per the Owner's directive) and PRINTS the fully-guardrailed `claude -p` invocation it WOULD run.
//
// IT SPAWNS NOTHING. Actually invoking Claude is the SUPERVISED PILOT step (operator-launched,
// short bounded window, no overnight) and is intentionally NOT enabled here — a repo-safe prototype
// must never cross the autonomy boundary on its own. `--execute` is refused unless the operator
// explicitly supervises (documented in wake-supervisor-design.md); this file never wires the spawn.
//
// Usage:  node docs/orchestration/context/wake-supervisor.mjs --state <work-state.json> [--manual]
//   work-state.json: { item: { id, status, authorized, protectedBoundary, scope[], sha },
//                      governor: { remoteAiUsed, remoteAiMax }, network, budgetRemainingUsd, lastRun }

import { readFileSync } from "node:fs";
import { assessReadiness, buildClaudeInvocation } from "../lib/wakeSupervisor.mjs";
import { contextPackageFor } from "./build-package.mjs";

function arg(name, fb = null) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; }
const flag = (name) => process.argv.includes(`--${name}`);

export function runSupervisor(state, { manual = false } = {}) {
  const ctx = {
    governor: state.governor || {}, network: state.network || "UNKNOWN",
    budgetRemainingUsd: state.budgetRemainingUsd ?? null, lastRun: state.lastRun || null,
    overnight: state.overnight === true, triggerKind: manual ? "MANUAL_RUNTIME_TRIGGER" : "AUTOMATIC_TRIGGER",
  };
  const decision = assessReadiness(state.item, ctx);
  const out = { decision: decision.decision, reason: decision.reason, triggerMechanism: decision.triggerMechanism, triggerKind: decision.triggerKind };

  if (decision.decision === "TRIGGER") {
    // Bootstrap via the shared C-7 package mechanism — NOT a bespoke bootstrap.
    const pkg = contextPackageFor({ id: decision.item.id, scope: decision.item.scope || [], role: "wake-triggered worker", sourceCommit: decision.item.sha });
    out.contextPackage = { assignmentId: pkg.assignmentId, governingAuthority: pkg.governingAuthority, required: pkg.required, sufficiency: pkg.sufficiency };
    out.wouldInvoke = buildClaudeInvocation({ contextPackage: pkg, guardrails: decision.guardrails });
    out.mode = "DRY_RUN — spawns nothing; live invocation is the supervised pilot step (see wake-supervisor-design.md).";
  }
  return out;
}

// CLI (dry-run only)
import { fileURLToPath } from "node:url";
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const statePath = arg("state");
  if (!statePath) { process.stderr.write("usage: wake-supervisor.mjs --state <work-state.json> [--manual]\n"); process.exit(2); }
  if (flag("execute")) { process.stderr.write("REFUSED: --execute (live Claude invocation) is the SUPERVISED PILOT step and is not wired in this repo-safe prototype.\n"); process.exit(3); }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  process.stdout.write(JSON.stringify(runSupervisor(state, { manual: flag("manual") }), null, 2) + "\n");
}
