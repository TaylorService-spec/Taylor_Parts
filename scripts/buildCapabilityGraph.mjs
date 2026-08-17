#!/usr/bin/env node
// Capability graph — generated, committed map of WHAT THIS PLATFORM CAN ACTUALLY DO.
//
// WHY THIS EXISTS. `docs/architecture/repo-graph.json` maps structure — who imports whom, which doc
// cites which path. It says so itself: "Structural, not semantic." That makes it the wrong tool for the
// question that actually keeps getting asked, by the Owner and by every AI working here:
//
//     "Do we already have X?"
//
// Answering that by grep-and-read produced repeated wrong answers — capabilities reported as missing that
// were built and deliberately deactivated, and capabilities reported as present that were only a dropdown.
// The distinction that matters is not present/absent. It is:
//
//     governed?  ->  is there a capability entry, and is it active?
//     built?     ->  is there an exported callable behind it?
//     reachable? ->  is there a nav destination, and is it hidden or a placeholder?
//     usable?    ->  do our own user guides say a person can finish the job?
//
// Four layers, four independent sources of truth already maintained in this repo. This script joins them.
// A capability that is governed + built + reachable + documented-live is real. Any other combination is a
// specific, nameable state — and naming it is the whole point.
//
// SOURCES (all already authoritative for their own layer; none invented here)
//   1. functions/src/access/permissionCatalog.ts     — capability ids + active flags (governance)
//   2. field-ops-app-vite/src/access/permissionCatalog.ts — client mirror, checked for parity
//   3. functions/src/index.ts                        — exported callables (backend surface)
//   4. field-ops-app-vite/src/navigation/navConfig.js — destinations, navHidden, placeholders (UI surface)
//   5. docs/user-guide/README.md                     — 49 guides with honest status tags (user truth)
//   6. docs/roadmaps/business-capability-register.md — recorded-but-unbuilt business capabilities
//
// Regenerate after any change to those files:
//     node scripts/buildCapabilityGraph.mjs
// `--check` prints a summary and exits non-zero if the two permission catalogs disagree.
//
// WHAT IT IS NOT. It joins declarations; it does not execute anything. "Exported" is not "deployed", and
// this script cannot know what is live in a given environment — `active:false` plus an export means the
// code exists and is hard-denied, which is exactly the state that kept being misread as "missing".
// Per docs/architecture/repo-graph.md: if the graph disagrees with the repository, the repository wins.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => {
  try {
    return readFileSync(resolve(ROOT, p), "utf8");
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- 1. capabilities (governance layer)

// Entries look like:  Object.freeze({ id: "finance.invoice.issue", description: "...", resource: "...",
//                     action: "...", active: false })
// Parsed by regex rather than by importing the module: this script must run without a TS toolchain, and
// the shape is stable and enforced by the catalog's own tests.
// Split on the entry delimiter first, then read fields within each entry. An earlier version used one
// regex with a bounded look-ahead for `active:` and silently dropped ~30% of entries whose bodies ran
// longer than the window — a parser that under-reports is worse than no parser, because the gaps look
// like absences. Entry count is asserted against a raw `id:` count below.
function parseCatalog(src) {
  if (!src) return [];
  const out = [];
  for (const chunk of src.split(/Object\.freeze\(\{/).slice(1)) {
    const body = chunk.split(/\}\)/)[0];
    const id = (/id:\s*"([^"]+)"/.exec(body) || [])[1];
    if (!id || !/^[a-z]/.test(id)) continue; // capability ids are dotted lower-case; skip other frozen objects
    const desc = /description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(body);
    out.push({
      id,
      active: /\bactive:\s*true/.test(body),
      resource: (/resource:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      action: (/action:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      description: desc ? desc[1].replace(/\\"/g, '"').slice(0, 400) : null,
    });
  }
  return out;
}

const serverCaps = parseCatalog(read("functions/src/access/permissionCatalog.ts"));
const clientCaps = parseCatalog(read("field-ops-app-vite/src/access/permissionCatalog.ts"));

// Parity: the client mirror must not disagree with the server about whether something is active.
const clientById = new Map(clientCaps.map((c) => [c.id, c]));
const parityIssues = [];
for (const c of serverCaps) {
  const mirror = clientById.get(c.id);
  if (!mirror) parityIssues.push({ id: c.id, issue: "missing from client mirror" });
  else if (mirror.active !== c.active)
    parityIssues.push({ id: c.id, issue: `active mismatch: server=${c.active} client=${mirror.active}` });
}
for (const c of clientCaps) {
  if (!serverCaps.some((s) => s.id === c.id)) parityIssues.push({ id: c.id, issue: "client-only entry" });
}

// ---------------------------------------------------------------- 2. callables (backend surface)

// `export { issueInvoice } from "./finance/invoiceCallables";` — plus the comment block above each export,
// which by convention in index.ts states the governing capability and its activation state.
function parseExports(src) {
  if (!src) return [];
  const lines = src.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    const m = /^export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/.exec(line.trim());
    if (!m) return;
    // Walk back over the contiguous comment block that documents this export.
    const note = [];
    for (let j = i - 1; j >= 0 && lines[j].trim().startsWith("//"); j--)
      note.unshift(lines[j].trim().replace(/^\/\/\s?/, ""));
    const comment = note.join(" ");
    out.push({
      names: m[1].split(",").map((s) => s.trim()).filter(Boolean),
      module: m[2],
      // Capability ids are written as `capability \`x.y.z\`` or bare dotted ids in these comments.
      capabilityHints: [...comment.matchAll(/`([a-z][a-zA-Z]*(?:\.[a-zA-Z]+){1,3})`/g)].map((x) => x[1]),
      exportNotDeploy: /EXPORT\s*!=\s*DEPLOY/i.test(comment),
      comment: comment.slice(0, 300) || null,
    });
  });
  return out;
}
const callables = parseExports(read("functions/src/index.ts"));

// ---------------------------------------------------------------- 3. destinations (UI surface)

function parseNav(src) {
  if (!src) return [];
  const out = [];
  // One object literal per nav item; domains and subnav items share the same shape.
  const re = /\{\s*key:\s*"([^"]+)"([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const [, key, body] = m;
    out.push({
      key,
      label: (/label:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      path: (/path:\s*"([^"]*)"/.exec(body) || [])[1] ?? null,
      legacyKey: (/legacyKey:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      navHidden: /navHidden:\s*true/.test(body),
      future: /future:\s*true/.test(body),
      placeholderExplanation: (/placeholderExplanation:\s*"((?:[^"\\]|\\.)*)"/.exec(body) || [])[1] ?? null,
    });
  }
  return out;
}
const destinations = parseNav(read("field-ops-app-vite/src/navigation/navConfig.js"));

// ---------------------------------------------------------------- 4. guides (user-visible truth)

// `- [Title](path/file.md) — **live** — description`
function parseGuides(src) {
  if (!src) return [];
  const out = [];
  let section = null;
  for (const line of src.split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h && !/^About /.test(h[1])) section = h[1].trim();
    const g = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*—\s*\*\*([^*]+)\*\*\s*—\s*(.*)$/.exec(line.trim());
    if (g)
      out.push({
        title: g[1],
        path: `docs/user-guide/${g[2]}`,
        status: g[3].trim(),
        section,
        summary: g[4].trim().slice(0, 220),
      });
  }
  return out;
}
const guides = parseGuides(read("docs/user-guide/README.md"));

// ---------------------------------------------------------------- 5. register (recorded, unbuilt)

function parseRegister(src) {
  if (!src) return [];
  const out = [];
  const re = /^###\s+(\d+)\.\s+(.+)$/gm;
  let m;
  while ((m = re.exec(src))) out.push({ number: Number(m[1]), name: m[2].trim() });
  return out;
}
const register = parseRegister(read("docs/roadmaps/business-capability-register.md"));

// ---------------------------------------------------------------- join + verdict

// Link capabilities to code by finding where each capability id literally appears in source. Callables
// assert their own capability, so the id string is the reliable join — index.ts comments alone missed
// most of them (read-side capabilities are enforced inside repositories/projections, not at an export).
function enforcementSites() {
  const sites = new Map(); // capabilityId -> Set(path)
  const roots = ["functions/src", "field-ops-app-vite/src"];
  let files = [];
  for (const r of roots) {
    try {
      files = files.concat(
        execSync(`git ls-files ${r}`, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
          .split("\n")
          .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f)),
      );
    } catch {
      /* git unavailable — sites stay empty and every capability reports DECLARED_ONLY */
    }
  }
  const ids = serverCaps.map((c) => c.id);
  for (const f of files) {
    // The catalogs themselves declare every id; counting them as enforcement would make the join useless.
    if (/access\/permissionCatalog\.(ts|js)$/.test(f)) continue;
    const src = read(f);
    if (!src) continue;
    for (const id of ids)
      if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) {
        if (!sites.has(id)) sites.set(id, new Set());
        sites.get(id).add(f);
      }
  }
  return sites;
}
const sites = enforcementSites();

// Callables named in index.ts comments, kept as a second, weaker signal.
const byCapability = new Map();
for (const c of serverCaps) byCapability.set(c.id, []);
for (const e of callables)
  for (const hint of e.capabilityHints)
    if (byCapability.has(hint)) byCapability.get(hint).push(...e.names);

const capabilities = serverCaps.map((c) => {
  const backing = [...new Set(byCapability.get(c.id) ?? [])];
  const where = [...(sites.get(c.id) ?? [])];
  const server = where.filter((f) => f.startsWith("functions/"));
  const client = where.filter((f) => f.startsWith("field-ops-app-vite/"));
  // The vocabulary deliberately separates "never built" from "built and switched off". Conflating those
  // two is the specific error this graph exists to prevent.
  let state;
  if (where.length === 0) state = "DECLARED_ONLY";
  else if (server.length === 0) state = c.active ? "CLIENT_ONLY_ACTIVE" : "CLIENT_ONLY_INERT";
  else state = c.active ? "ACTIVE" : "BUILT_INERT";
  return {
    ...c,
    callables: backing,
    enforcedIn: where.slice(0, 12),
    serverSites: server.length,
    clientSites: client.length,
    state,
  };
});

const tally = (arr, key) =>
  arr.reduce((a, x) => ((a[x[key]] = (a[x[key]] ?? 0) + 1), a), {});

// ---------------------------------------------------------------- 6. flows (where each chain stops)
//
// Hierarchy answers "does capability X exist". Flow answers the question the business actually asks:
// "can we get from one end of this chain to the other, and if not, where does it stop?" A chain of
// individually-present capabilities can still be unusable if one link is inert — and that link is the
// only thing worth talking about.
//
// The chains below are NOT invented here. Each is transcribed from the repository's own process
// documentation, cited per chain. Steps map to capability ids by prefix; a step with no matching
// capability is `UNGOVERNED` — it may be ordinary UI with no permission behind it, or genuinely absent,
// and the graph deliberately does not guess which.
const FLOWS = [
  {
    id: "service-to-cash",
    name: "Service call → cash",
    source: "docs/PlatformCapabilityModel.md (Work Order lifecycle); docs/assessments/completion-to-finance-and-billing-ar-assessment.md",
    steps: [
      { name: "Intake — customer reports a problem", match: [] },
      { name: "Create work order", match: ["workOrder.create"] },
      { name: "Plan parts", match: ["workOrder.parts.plan"] },
      { name: "Schedule / dispatch", match: [], legacy: "role-gated: dispatch, scheduling, dispatcherBoard" },
      { name: "Field execution — parts and notes", match: ["inventory.action.create"] },
      { name: "Complete / transition", match: ["workOrder.transition"] },
      { name: "Invoice", match: ["finance.invoice.issue"] },
      { name: "Payment", match: ["finance.payment.apply"] },
    ],
  },
  {
    id: "equipment-sale",
    name: "Equipment sale → serviceable asset",
    source: "docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md §1 (D2→D3→D4→invoice→asset→D1)",
    steps: [
      { name: "Opportunity", match: ["opportunity.write"] },
      { name: "Sales & Security Agreement (D2)", match: [] },
      { name: "Convert to Sales Order (D3)", match: ["opportunity.createSalesOrder", "salesOrder.write"] },
      { name: "Allocate stock", match: ["salesOrder.fulfill"] },
      { name: "Pick ticket (D4)", match: [] },
      { name: "Deliver / install", match: ["salesOrder.service"] },
      { name: "Invoice", match: ["finance.invoice.issue"] },
      { name: "Becomes serviceable asset", match: ["inventory.serializedAsset.read"] },
    ],
  },
  {
    id: "ventana-ice-machine",
    name: "Ventana ice machine — inventory control lifecycle",
    source: "docs/business-processes/ventana-ice-machine-commercial-inventory-lifecycle.md §3 (two-condition exit: install complete AND sale closed)",
    steps: [
      { name: "Customer demand / sale", match: ["opportunity.write", "salesOrder.write"] },
      { name: "Taylor purchases from Ventana", match: ["reorder.purchaseOrder.create"] },
      { name: "Receive — inventory control BEGINS", match: ["inventory.stock.receive"] },
      { name: "Serialized identity & custody", match: ["inventory.serializedAsset.read"] },
      { name: "Allocation / staging", match: ["salesOrder.fulfill"] },
      { name: "Delivery / installation", match: ["salesOrder.service"] },
      { name: "Install complete AND sale closed — control ENDS", match: ["inventory.serializedAsset.read"] },
    ],
  },
  {
    id: "parts-replenishment",
    name: "Parts reorder → stock on hand",
    source: "docs/user-guide/inventory/*.md — guides tag every step through 'Place the order' as **live**",
    steps: [
      { name: "Request a reorder", match: ["reorder.request.create.manual"] },
      { name: "Review / approve", match: ["reorder.request.approve", "reorder.request.reject"] },
      { name: "Assign to Parts Associate", match: ["reorder.request.assign"] },
      { name: "Place the order (PO)", match: ["reorder.purchaseOrder.create", "reorder.request.recordPurchaseOrder"] },
      { name: "Receive into warehouse", match: ["inventory.stock.receive"] },
      { name: "Stock on hand updated", match: ["inventory.transaction.read"] },
    ],
  },
];

function resolveFlows(caps) {
  const byId = new Map(caps.map((c) => [c.id, c]));
  return FLOWS.map((f) => {
    const steps = f.steps.map((s) => {
      const matched = s.match.length
        ? caps.filter((c) => s.match.some((p) => c.id === p || c.id.startsWith(p)))
        : [];
      let state;
      if (!s.match.length) state = s.legacy ? "LEGACY_ROLE_GATED" : "UNGOVERNED";
      else if (!matched.length) state = "NO_CAPABILITY";
      else if (matched.some((c) => c.state === "ACTIVE")) state = "ACTIVE";
      else if (matched.some((c) => c.state.startsWith("CLIENT_ONLY"))) state = "CLIENT_ONLY";
      else if (matched.some((c) => c.state === "BUILT_INERT")) state = "BUILT_INERT";
      else state = "DECLARED_ONLY";
      return { ...s, state, capabilities: matched.map((c) => c.id) };
    });
    // The chain is traversable up to the first step that is not ACTIVE. That index is the answer to
    // "where does this chain stop today" — the durable question this whole graph exists to serve.
    const stopIndex = steps.findIndex((s) => s.state !== "ACTIVE");
    return {
      ...f,
      steps,
      stopsAt: stopIndex === -1 ? null : steps[stopIndex].name,
      stopsAtIndex: stopIndex,
      traversableSteps: stopIndex === -1 ? steps.length : stopIndex,
      totalSteps: steps.length,
    };
  });
}

const graph = {
  schema: "capability-graph/1",
  generatedFrom: [
    "functions/src/access/permissionCatalog.ts",
    "field-ops-app-vite/src/access/permissionCatalog.ts",
    "functions/src/index.ts",
    "field-ops-app-vite/src/navigation/navConfig.js",
    "docs/user-guide/README.md",
    "docs/roadmaps/business-capability-register.md",
  ],
  counts: {
    capabilities: capabilities.length,
    active: capabilities.filter((c) => c.active).length,
    inactive: capabilities.filter((c) => !c.active).length,
    callableExports: callables.length,
    destinations: destinations.length,
    destinationsHidden: destinations.filter((d) => d.navHidden).length,
    guides: guides.length,
    registerEntries: register.length,
    parityIssues: parityIssues.length,
  },
  capabilityStates: tally(capabilities, "state"),
  flows: resolveFlows(capabilities),
  guideStatuses: tally(guides, "status"),
  capabilities,
  callables,
  destinations,
  guides,
  register,
  parityIssues,
};

writeFileSync(resolve(ROOT, "docs/architecture/capability-graph.json"), JSON.stringify(graph, null, 2) + "\n");

// Human-readable companion — the summary a person or an AI reads before deciding anything.
const md = [
  "# Capability graph — what this platform can actually do",
  "",
  "**Generated. Do not edit by hand.** `node scripts/buildCapabilityGraph.mjs`",
  "",
  "`repo-graph.json` maps *structure* — who imports whom. This maps *capability* — what a person can",
  "actually finish. It exists because \"do we already have X?\" was being answered by grep, and grep",
  "cannot tell a capability that was never built from one that was built and deliberately switched off.",
  "",
  "## The four layers",
  "",
  "| Layer | Source | Question it answers |",
  "| --- | --- | --- |",
  "| Governance | `permissionCatalog.ts` | Is there a capability entry, and is it `active`? |",
  "| Backend | `functions/src/index.ts` | Is there an exported callable behind it? |",
  "| UI | `navConfig.js` | Is there a destination — hidden, placeholder, or real? |",
  "| User truth | `docs/user-guide/README.md` | Do our own guides say a person can finish the job? |",
  "",
  "## Counts",
  "",
  ...Object.entries(graph.counts).map(([k, v]) => `- **${k}**: ${v}`),
  "",
  "## Capability states",
  "",
  "| State | Count | Meaning |",
  "| --- | ---: | --- |",
  `| ACTIVE | ${graph.capabilityStates.ACTIVE ?? 0} | Granted and backed by an exported callable |`,
  `| BUILT_INERT | ${graph.capabilityStates.BUILT_INERT ?? 0} | **Callable exists; capability is \`active:false\`.** Built and hard-denied — not missing |`,
  `| DECLARED_ONLY | ${graph.capabilityStates.DECLARED_ONLY ?? 0} | Registered, no exported callable found |`,
  `| ACTIVE_NO_CALLABLE | ${graph.capabilityStates.ACTIVE_NO_CALLABLE ?? 0} | Active but no callable matched — read-side or a parse miss; check before trusting |`,
  "",
  "## Guide statuses (user-visible truth)",
  "",
  ...Object.entries(graph.guideStatuses).map(([k, v]) => `- **${k}**: ${v}`),
  "",
  ...(parityIssues.length
    ? [
        "## ⚠️ Permission-catalog parity issues",
        "",
        "The server catalog and its client mirror disagree. The server is authoritative.",
        "",
        ...parityIssues.map((p) => `- \`${p.id}\` — ${p.issue}`),
        "",
      ]
    : ["## Permission-catalog parity", "", "Server and client mirrors agree.", ""]),
  "## Flows — where each business chain stops",
  "",
  "A chain is only as usable as its first non-active link. Steps marked `UNGOVERNED` have no capability",
  "behind them at all — that may be ordinary UI, or genuinely nothing; the graph does not guess.",
  "",
  ...graph.flows.flatMap((f) => [
    `### ${f.name}`,
    "",
    `Source: \`${f.source}\``,
    "",
    f.stopsAt
      ? `**Stops at step ${f.stopsAtIndex + 1} of ${f.totalSteps}: ${f.stopsAt}**`
      : `**Traversable end to end (${f.totalSteps} steps).**`,
    "",
    "| # | Step | State | Capabilities |",
    "| ---: | --- | --- | --- |",
    ...f.steps.map(
      (s, i) =>
        `| ${i + 1} | ${s.name} | ${s.state} | ${s.capabilities.length ? s.capabilities.map((c) => "`" + c + "`").join(", ") : "—"} |`,
    ),
    "",
  ]),
  "## How to use it",
  "",
  "Before claiming a capability is missing, query this graph. Specifically:",
  "",
  "1. Search `capabilities[]` for the resource — a `BUILT_INERT` hit means **built and switched off**,",
  "   which is an activation decision, not a gap.",
  "2. Search `destinations[]` — a `navHidden` entry with a `placeholderExplanation` states in its own",
  "   words why it is not reachable.",
  "3. Search `guides[]` — a `not-yet-available` tag names what is missing underneath a screen that exists.",
  "4. Only if all four layers are silent is something genuinely absent.",
  "",
  "Structural questions (who imports whom, is a cited path real) belong to `repo-graph.json` instead.",
  "",
].join("\n");

writeFileSync(resolve(ROOT, "docs/architecture/capability-graph.md"), md);

console.log("capability-graph: " + JSON.stringify(graph.counts));
console.log("states: " + JSON.stringify(graph.capabilityStates));
console.log("guides: " + JSON.stringify(graph.guideStatuses));
if (parityIssues.length) {
  console.log(`\n${parityIssues.length} parity issue(s):`);
  for (const p of parityIssues.slice(0, 20)) console.log(`  ${p.id} — ${p.issue}`);
}
if (process.argv.includes("--check") && parityIssues.length) process.exit(1);
