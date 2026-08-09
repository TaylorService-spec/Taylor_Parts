// Owner Roadmap Projection — deterministic markdown renderer.
//
// Renders the 8 pure views (roadmapProjection.mjs) into a single committed,
// read-only snapshot: docs/orchestration/roadmap/ROADMAP.md. Deterministic —
// stamped from the model's lastVerifiedRepoState, never the wall clock — so
// re-running produces no spurious diff. Run:
//   node docs/orchestration/lib/generateRoadmapViews.mjs
import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { roadmapModel } from "./roadmapModel.mjs";
import { projectAll, statusToSymbol, projectAgentOperations } from "./roadmapProjection.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "roadmap", "ROADMAP.md");
const LEDGER = join(here, "..", "agent-requests");

// Load the durable Agent Request/Result ledger (deterministic: sorted by filename).
function loadLedger() {
  if (!existsSync(LEDGER)) return { requests: [], results: [] };
  const files = readdirSync(LEDGER).filter((f) => f.endsWith(".json")).sort();
  const requests = [], results = [];
  for (const f of files) {
    const obj = JSON.parse(readFileSync(join(LEDGER, f), "utf8"));
    if (f.endsWith(".request.json")) requests.push(obj);
    else if (f.endsWith(".result.json")) results.push(obj);
  }
  return { requests, results };
}

const dimCols = (d) => `${d.implementationState} | ${d.activationState} | ${d.backendState} | ${d.userOperable} | ${d.uxState} | ${d.deployState}`;
const ms = (m) => (m ? `${m.complete}/${m.total}` : "—");
const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|");

function render(model) {
  const v = projectAll(model);
  const L = [];
  L.push(`# EOS — Owner Roadmap (generated snapshot)`);
  L.push("");
  L.push(`> **Read-only projection** of the durable roadmap model (\`lib/roadmapModel.mjs\`), rendered by`);
  L.push(`> \`lib/generateRoadmapViews.mjs\`. Do not hand-edit — change the model and regenerate. Contract:`);
  L.push(`> [\`roadmap-projection.md\`](../roadmap-projection.md).`);
  L.push("");
  L.push(`**Last verified repository state:** \`${esc(model.lastVerifiedRepoState)}\``);
  L.push("");
  L.push(`**Distinctions preserved** (each is a separate field, never one number): IMPLEMENTED ≠ ACTIVATED · MERGED ≠ DEPLOYED · BACKEND COMPLETE ≠ USER-OPERABLE · UX COMPLETE ≠ BACKEND ACTIVE · PERSONA FINDING ≠ PRODUCT DECISION. No invented percentages — the only number is a milestone count.`);
  L.push("");

  // 1. Executive Roadmap
  L.push(`## 1. Executive Roadmap`);
  L.push("");
  for (const d of v.executiveRoadmap) {
    L.push(`### ${esc(d.domainName)} _(${d.domainKind.toLowerCase()})_`);
    L.push("");
    L.push(`| Capability | Owner | Status | Impl | Activation | Backend | UserOp | UX | Deploy | Milestones |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const c of d.capabilities) {
      L.push(`| ${esc(c.name)} | ${esc(c.workstreamOwner)} | ${esc(c.status)} | ${dimCols(c.dimensions)} | ${ms(c.milestones)} |`);
    }
    L.push("");
  }

  // 2. Active Work
  L.push(`## 2. Active Work (RUNNING / READY)`);
  L.push("");
  L.push(v.activeWork.length ? v.activeWork.map((c) => `- **${esc(c.name)}** _(${esc(c.domain)})_ — ${c.status}${c.milestones ? ` · ${ms(c.milestones)} milestones` : ""}`).join("\n") : "_None._");
  L.push("");

  // 3. Blocked / Dependencies
  L.push(`## 3. Blocked / Dependencies`);
  L.push("");
  if (v.blocked.length) {
    L.push(`| Capability | Blocked reason | Dependencies | Routed to |`);
    L.push(`|---|---|---|---|`);
    for (const c of v.blocked) L.push(`| ${esc(c.name)} | ${esc(c.blockedReason)} | ${esc((c.dependencies || []).join(", "))} | ${esc(c.routedTo || "")} |`);
  } else L.push("_None._");
  L.push("");

  // 4. Owner Decisions
  L.push(`## 4. Owner Decisions`);
  L.push("");
  if (v.ownerDecisions.length) {
    L.push(`| Capability | Decision | Blocking? |`);
    L.push(`|---|---|---|`);
    for (const c of v.ownerDecisions) L.push(`| ${esc(c.name)} | ${esc(c.decision)} | ${c.blocking ? "**yes**" : "recorded/deferred"} |`);
  } else L.push("_None._");
  L.push("");

  // 5. Protected / Awaiting Operator
  L.push(`## 5. Protected / Awaiting Operator`);
  L.push("");
  if (v.protected.length) {
    L.push(`| Capability | Protected boundary |`);
    L.push(`|---|---|`);
    for (const c of v.protected) L.push(`| ${esc(c.name)} | ${esc(c.protectedBoundary)} |`);
  } else L.push("_None._");
  L.push("");

  // 6 & 7. Boards
  const board = (rows) => rows.length ? rows.map((r) => `- [${r.symbol}] ${esc(r.name)} _(${esc(r.domain)})_${r.note ? ` — ${esc(r.note)}` : ""}`).join("\n") : "_None modeled yet._";
  L.push(`## 6. Design execution board`);
  L.push("");
  L.push("Legend: `[x]` done · `[>]` in progress · `[ ]` planned/ready · `[!]` owner decision · `[P]` protected · `[B]` blocked · `[R]` routed · `[-]` at rest.");
  L.push("");
  L.push(board(v.designBoard));
  L.push("");
  L.push(`## 7. UX execution board`);
  L.push("");
  L.push(board(v.uxBoard));
  L.push("");

  // 8. Detailed Roadmap
  L.push(`## 8. Detailed Roadmap`);
  L.push("");
  const dr = v.detailedRoadmap;
  for (const d of dr.domains) {
    L.push(`### ${esc(d.name)} _(${d.kind.toLowerCase()})_`);
    L.push("");
    for (const c of d.capabilities) {
      L.push(`#### ${esc(c.name)} — \`${esc(c.status)}\``);
      L.push("");
      L.push(`- Owner: ${esc(c.workstreamOwner)} · Milestones: ${ms(c.milestones)} · Last verified: \`${esc(c.lastVerifiedRepoState)}\``);
      L.push(`- Dimensions — Impl: ${c.dimensions.implementationState} · Activation: ${c.dimensions.activationState} · Backend: ${c.dimensions.backendState} · UserOperable: ${c.dimensions.userOperable} · UX: ${c.dimensions.uxState} · Deploy: ${c.dimensions.deployState}`);
      if ((c.dependencies || []).length) L.push(`- Dependencies: ${esc(c.dependencies.join(", "))}`);
      if (c.blockedReason) L.push(`- Blocked: ${esc(c.blockedReason)}`);
      if (c.routedTo) L.push(`- Routed to: ${esc(c.routedTo)}`);
      if (c.ownerDecision) L.push(`- Owner decision: ${esc(c.ownerDecision)}`);
      if (c.protectedBoundary) L.push(`- Protected boundary: ${esc(c.protectedBoundary)}`);
      if (c.roadmapTrigger) L.push(`- Roadmap trigger: ${esc(c.roadmapTrigger)}`);
      for (const m of c.milestoneDetail) {
        L.push(`  - ${m.complete ? "☑" : "☐"} **${esc(m.name)}**${m.completionCriteria.length ? ` — criteria: ${esc(m.completionCriteria.join("; "))}` : ""}`);
        for (const w of m.workItems) {
          const ev = (w.evidence || []).map((e) => `${e.kind}:${e.ref}${e.note ? `(${e.note})` : ""}`).join(", ");
          L.push(`    - ${esc(w.name)} — \`${esc(w.status)}\`${(w.prEvidence || []).length ? ` · PRs: ${esc(w.prEvidence.join(" "))}` : ""}${w.tests ? ` · tests: ${esc(w.tests)}` : ""}${ev ? ` · evidence: ${esc(ev)}` : ""}`);
        }
      }
      L.push("");
    }
  }

  // 9. Agent Operations (Phase 3) — read-only over the durable ledger.
  const { requests, results } = loadLedger();
  const ops = projectAgentOperations(requests, results, { networkState: "NORMAL", allocations: [] });
  L.push(`## 9. Agent Operations`);
  L.push("");
  L.push(`Read-only over the durable [Agent Request/Result ledger](../agent-requests/) + governor/network state. See [\`agent-manager.md\`](../agent-manager.md). AGENT OUTPUT ≠ PRODUCT AUTHORITY.`);
  L.push("");
  L.push(`- **Network state:** ${ops.networkState}`);
  L.push(`- **Remote slots:** REMOTE_AI ${ops.capacity.remoteAi.used}/${ops.capacity.remoteAi.total} · BROWSER ${ops.capacity.browser.used}/${ops.capacity.browser.total} · NETWORK_HEAVY ${ops.capacity.networkHeavy.used}/${ops.capacity.networkHeavy.total} · MUTATING ${ops.capacity.mutating.used}/${ops.capacity.mutating.total}`);
  L.push(`- **Efficiency:** requests ${ops.metrics.requestsCreated} · executed ${ops.metrics.executed} · deduped/reused ${ops.metrics.dedupedOrReused} · waiting(resource/net) ${ops.metrics.waitingResource}/${ops.metrics.waitingNetwork} · retries ${ops.metrics.retries} · accepted findings ${ops.metrics.acceptedFindings} · results-with-token-metrics ${ops.metrics.tokensReported}`);
  L.push("");
  L.push(`**Queued requests:** ${ops.queued.length ? "" : "_none_"}`);
  for (const q of ops.queued) L.push(`- ${esc(q.requestId)} — ${esc(q.workstream)} · ${esc(q.mode)} · ${esc(q.status)} — ${esc(q.purpose)}`);
  L.push("");
  L.push(`**Running agents:** ${ops.running.length ? "" : "_none_"}`);
  for (const r of ops.running) L.push(`- ${esc(r.requestId)} — ${esc(r.workstream)} · ${esc(r.mode)} — ${esc(r.purpose)}`);
  L.push("");
  L.push(`**Recent results:** ${ops.recentResults.length ? "" : "_none_"}`);
  if (ops.recentResults.length) {
    L.push(`| Result | Request | Routed to | Status | Verdict | Findings | Retries |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const r of ops.recentResults) L.push(`| ${esc(r.resultId)} | ${esc(r.requestId)} | ${esc(r.routedBackTo)} | ${esc(r.status)} | ${esc(r.verdict)} | ${r.findings} | ${r.retries} |`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

const out = render(roadmapModel);
writeFileSync(OUT, out);
// eslint-disable-next-line no-console
console.log(`wrote ${OUT} (${out.length} bytes)`);
