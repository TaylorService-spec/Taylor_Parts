#!/usr/bin/env node
// Capability graph — evidence about capability declaration, implementation, and activation.
//
// WHY THIS EXISTS. `docs/architecture/repo-graph.json` maps structure — who imports whom. It says so
// itself: "Structural, not semantic." That leaves the recurring question unanswered:
//
//     "Do we already have X?"
//
// Answering it by grep produced repeatedly wrong answers in one direction: capabilities that exist in
// code and are switched off were reported as MISSING. This graph exists to make that distinction
// legible.
//
// WHAT THE FIRST VERSION GOT WRONG (corrected here after independent review). It collapsed three
// independent things into a single verdict — catalog declaration, implementation evidence, and
// effective runtime authorization — and then asserted `active:false` meant "hard-denied". That is not
// true in this repo. `functions/src/access/environmentCapabilityOverrides.ts` activates selected
// `active:false` capabilities in configured non-production environments. A capability can be
// catalog-inactive and genuinely usable in `eos-platform-sandbox` at the same time.
//
// The repo's own rule, which this graph now respects:
//
//     eligibility  !=  activation  !=  authorization
//
// So the dimensions stay separate and are never fused into one label:
//
//   catalogActive          the catalog's `active` flag, nothing more
//   implementation         where the id is referenced, and whether a callable was actually matched
//   environmentActivation  which environments declare it, and whether it is even eligible
//   effective              capability-level ENABLEMENT, computed ONLY when an environment is named
//
// The default run is environment-neutral and reports no enablement at all, because without an
// environment there is no such fact. Sandbox is not the implicit universal truth.
//
// AND NOTHING HERE IS AUTHORIZATION. Activation is a gate that lets a capability be considered; a
// principal still needs the applicable Role grant. This graph never evaluates principal grants, so
// "enabled" must never be read as "someone can do this".
//
// SOURCES (each already authoritative for its own layer; none invented here)
//   functions/src/access/permissionCatalog.ts             capability ids + active flags
//   field-ops-app-vite/src/access/permissionCatalog.ts    client mirror, checked for parity
//   functions/src/index.ts                                exported callables
//   functions/src/access/environmentCapabilityOverrides.ts eligibility allow-list
//   config/environments.json                              canonical per-environment activation
//   field-ops-app-vite/src/navigation/navConfig.js        destinations, navHidden, placeholders
//   docs/user-guide/README.md                             guides with honest status tags
//   docs/roadmaps/business-capability-register.md         recorded business capabilities
//
// USAGE
//   node scripts/buildCapabilityGraph.mjs                              regenerate (environment-neutral)
//   node scripts/buildCapabilityGraph.mjs --environment eos-platform-sandbox   add effective state
//   node scripts/buildCapabilityGraph.mjs --check                      fail on drift; writes nothing
//
// LIMITS, STATED PLAINLY. Regex parsing, not an AST — `scripts/capabilityGraph.test.mjs` pins the
// shapes it depends on. A literal-id scan is evidence of reference, never proof of a callable;
// capabilities reached through indirection (ids assembled from constants) produce false negatives and
// land in NO_IMPLEMENTATION_EVIDENCE. "Exported" is not "deployed" — nothing here observes a running
// environment. Per `docs/architecture/repo-graph.md`: if the graph disagrees with the repository,
// the repository wins.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readAt = (root, p) => {
  try {
    return readFileSync(resolve(root, p), "utf8");
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ parsers (pure, exported for tests)

// Catalog entries are `Object.freeze({ id: "...", description: "...", resource, action, active })`.
// Split on the entry delimiter, then read fields inside. An earlier single-regex version with a bounded
// look-ahead silently dropped ~30% of entries whose bodies ran long — and a parser that under-reports is
// worse than none, because its gaps look exactly like absences. `assertCatalogCount` guards that class
// of failure by comparing against a raw `id:` count.
export function parseCatalog(src) {
  if (!src) return [];
  const out = [];
  for (const chunk of src.split(/Object\.freeze\(\{/).slice(1)) {
    const body = chunk.split(/\}\)/)[0];
    const id = (/id:\s*"([^"]+)"/.exec(body) || [])[1];
    if (!id || !/^[a-z][a-zA-Z]*\./.test(id)) continue; // capability ids are dotted lower-camel
    const desc = /description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(body);
    out.push({
      id,
      catalogActive: /\bactive:\s*true/.test(body),
      resource: (/resource:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      action: (/action:\s*"([^"]+)"/.exec(body) || [])[1] ?? null,
      description: desc ? desc[1].replace(/\\"/g, '"').slice(0, 400) : null,
    });
  }
  return out;
}

// Guard against silent parser drift: every capability-shaped `id: "..."` must have been captured.
// Deliberately NOT anchored to line start — entries are written both multi-line and on one line, and an
// anchored count under-reports the single-line form, which would defeat the purpose of the guard.
export function assertCatalogCount(src, parsed) {
  const raw = (src.match(/\bid:\s*"[a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+"/g) || []).length;
  return { raw, parsed: parsed.length, ok: raw === parsed.length };
}

// `export { issueInvoice } from "./finance/invoiceCallables";` plus the comment block above it, which by
// convention names the governing capability.
export function parseExports(src) {
  if (!src) return [];
  const lines = src.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    const m = /^export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/.exec(line.trim());
    if (!m) return;
    const note = [];
    for (let j = i - 1; j >= 0 && lines[j].trim().startsWith("//"); j--)
      note.unshift(lines[j].trim().replace(/^\/\/\s?/, ""));
    const comment = note.join(" ");
    out.push({
      names: m[1].split(",").map((s) => s.trim()).filter(Boolean),
      module: m[2],
      capabilityHints: [...comment.matchAll(/`([a-z][a-zA-Z]*(?:\.[a-zA-Z]+){1,3})`/g)].map((x) => x[1]),
      comment: comment.slice(0, 300) || null,
    });
  });
  return out;
}

export function parseNav(src) {
  if (!src) return [];
  const out = [];
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

export function parseGuides(src) {
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

export function parseRegister(src) {
  if (!src) return [];
  const out = [];
  const re = /^###\s+(\d+)\.\s+(.+)$/gm;
  let m;
  while ((m = re.exec(src))) out.push({ number: Number(m[1]), name: m[2].trim() });
  return out;
}

// The eligibility allow-list bounds what ANY environment may activate. Parsed from the resolver so the
// graph cannot drift from the code that enforces it.
// ANCHOR ON `export const`, NOT on the bare name. The file opens with a prose comment naming
// SPINE_OVERRIDE_ELIGIBLE_IDS, and #1779 later inserted PRODUCTION_ACTIVATION_ELIGIBLE_IDS -- a
// SECOND, deliberately narrower set -- between that comment and the declaration. A non-greedy
// match from the comment then captured the PRODUCTION list, and the graph reported 25 sandbox-
// eligible ids instead of the real spine set. Silent, and wrong in the under-reporting direction.
export function parseEligibleIds(src) {
  if (!src) return [];
  const block = /export const SPINE_OVERRIDE_ELIGIBLE_IDS[\s\S]*?\[([\s\S]*?)\]\s*\)/.exec(src);
  if (!block) return [];
  return [...block[1].matchAll(/"([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)"/g)].map((m) => m[1]);
}

// ------------------------------------------------------------------ activation (pure)

/**
 * Mirror of `resolveCapabilityOverrides` in the backend resolver, over the canonical registry.
 * Fail-closed identically: unknown environment -> none; role "production" -> none unconditionally,
 * ignoring registry data; otherwise declared ∩ eligible.
 *
 * This is a READ of the same rule, not a second authority. `functions/test/environmentCapabilityOverrides.test.mjs`
 * remains the guard that resolver and registry agree.
 */
export function resolveActivation(registry, environmentSelector, eligibleIds) {
  const eligible = new Set(eligibleIds);
  const envs = Array.isArray(registry?.environments) ? registry.environments : [];
  const env = envs.find(
    (e) => e?.id === environmentSelector || e?.firebase?.projectId === environmentSelector,
  );
  if (!env) return { found: false, environment: null, activated: [], blockedByProductionRole: false };
  // Production hard-block: role-keyed, does not trust the data.
  if (env.role === "production")
    return {
      found: true,
      environment: { id: env.id, role: env.role, projectId: env.firebase?.projectId ?? null },
      activated: [],
      blockedByProductionRole: true,
    };
  const declared = Array.isArray(env.capabilityActivationOverrides) ? env.capabilityActivationOverrides : [];
  return {
    found: true,
    environment: { id: env.id, role: env.role, projectId: env.firebase?.projectId ?? null },
    activated: declared.filter((id) => eligible.has(id)),
    declaredNotEligible: declared.filter((id) => !eligible.has(id)),
    blockedByProductionRole: false,
  };
}

// ------------------------------------------------------------------ implementation evidence

// Where does each capability id literally appear? Evidence of reference — never proof of a callable.
export function findReferenceSites(files, ids, readFile) {
  const sites = new Map();
  for (const f of files) {
    if (/access[\\/]permissionCatalog\.(ts|js)$/.test(f)) continue; // declaration, not enforcement
    if (/environmentCapabilityOverrides\.ts$/.test(f)) continue; // eligibility list, not enforcement
    const src = readFile(f);
    if (!src) continue;
    for (const id of ids)
      if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) {
        if (!sites.has(id)) sites.set(id, new Set());
        sites.get(id).add(f);
      }
  }
  return sites;
}

/**
 * Classify implementation evidence ONLY. Says nothing about activation — that separation is the whole
 * point of this rewrite.
 *
 *   EXPORTED                    an exported callable in index.ts names this capability
 *   SERVER_REFERENCED           referenced under functions/src, no callable matched
 *   CLIENT_ONLY                 referenced only under the client app
 *   NO_IMPLEMENTATION_EVIDENCE  no literal reference found (may be a false negative — see LIMITS)
 */
export function classifyImplementation({ exportedCallables, serverReferences, clientReferences }) {
  if (exportedCallables.length) return "EXPORTED";
  if (serverReferences.length) return "SERVER_REFERENCED";
  if (clientReferences.length) return "CLIENT_ONLY";
  return "NO_IMPLEMENTATION_EVIDENCE";
}

/**
 * Capability-level ACTIVATION state for ONE named environment. Requires an environment; there is no
 * environment-free answer and the caller must not invent one.
 *
 *   CATALOG_ACTIVE          active in the catalog baseline
 *   ENVIRONMENT_ACTIVATED   catalog-inactive, activated by this environment's overrides
 *   NOT_ACTIVATED           neither
 *
 * ⚠️ `enabled` IS NOT AUTHORIZATION. It means only that the capability-level activation gate permits
 * the capability to be *considered* in this environment. A principal still needs the applicable Role
 * grant before anything is permitted. Nothing in this graph evaluates principal grants, so no output
 * here may be read as "someone can do this" — the repo's rule is
 * `eligibility != activation != authorization`, and this function answers the middle term only.
 *
 * `builtInert` is derived and returned separately: implementation evidence exists AND the capability is
 * not enabled in the evaluated environment. It is never the default state of an `active:false`
 * capability, because that capability may be activated elsewhere — and it likewise says nothing about
 * whether any principal is granted the capability.
 */
export function effectiveState(cap, activatedIds) {
  const basis = cap.catalogActive
    ? "CATALOG_ACTIVE"
    : activatedIds.has(cap.id)
      ? "ENVIRONMENT_ACTIVATED"
      : "NOT_ACTIVATED";
  const enabled = basis !== "NOT_ACTIVATED";
  const hasImplementation = cap.implementation.evidence !== "NO_IMPLEMENTATION_EVIDENCE";
  return { basis, enabled, builtInert: hasImplementation && !enabled };
}

// ------------------------------------------------------------------ flows

// Chains transcribed from the repository's own process documentation, cited per flow. Steps map to
// capability ids; a step with no mapping is UNMAPPED, which explicitly does NOT stop a flow — it may be
// ordinary UI, legacy role-gated authorization, non-capability logic, or genuinely absent, and the
// evidence here cannot tell those apart.
export const FLOWS = [
  {
    id: "service-to-cash",
    name: "Service call → cash",
    source: "docs/PlatformCapabilityModel.md (Work Order lifecycle); docs/assessments/completion-to-finance-and-billing-ar-assessment.md",
    steps: [
      { name: "Intake — customer reports a problem", match: [] },
      { name: "Create work order", match: ["workOrder.create"] },
      { name: "Plan parts", match: ["workOrder.parts.plan"] },
      { name: "Schedule / dispatch", match: [] },
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
    source: "docs/user-guide/inventory/*.md — guides tag every step through 'Place the order' as live",
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

/**
 * Resolve flows. Without an environment (`activatedIds === null`) this reports governance coverage only
 * and deliberately computes NO stopping point, because capability enablement is not a fact that exists
 * environment-free. With an environment, a step's `enablement` is one of:
 *
 *   ENABLED                  at least one mapped capability is catalog-active or environment-activated
 *   NOT_ENABLED              mapped capabilities exist and none are enabled here
 *   null                     UNMAPPED or MAPPED_ID_NOT_IN_CATALOG — not evaluable
 *
 * ⚠️ ENABLED DOES NOT MEAN EXECUTABLE. It reports the capability-level activation gate only; a
 * principal still needs the applicable Role grant, which this graph never evaluates. `firstNotEnabledAt`
 * is therefore "the first step the activation gate closes", not "where a user gets stuck".
 *
 * UNMAPPED steps never close a chain: an unmapped step may be ordinary UI, legacy role-gated
 * authorization, non-capability logic, or genuinely absent, and this evidence cannot distinguish them.
 */
export function resolveFlows(flows, capabilities, activatedIds) {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  return flows.map((f) => {
    const steps = f.steps.map((s) => {
      const mapped = s.match.map((id) => byId.get(id)).filter(Boolean);
      const missingIds = s.match.filter((id) => !byId.has(id));
      if (!s.match.length) return { ...s, coverage: "UNMAPPED", capabilities: [], enablement: null };
      if (!mapped.length)
        return { ...s, coverage: "MAPPED_ID_NOT_IN_CATALOG", capabilities: [], missingIds, enablement: null };
      const coverage = mapped.some((c) => c.implementation.evidence !== "NO_IMPLEMENTATION_EVIDENCE")
        ? "IMPLEMENTATION_EVIDENCE"
        : "DECLARED_ONLY";
      const enablement =
        activatedIds === null
          ? null
          : mapped.some((c) => c.catalogActive || activatedIds.has(c.id))
            ? "ENABLED"
            : "NOT_ENABLED";
      return { ...s, coverage, capabilities: mapped.map((c) => c.id), enablement };
    });
    if (activatedIds === null)
      return { ...f, steps, firstNotEnabledAt: null, firstNotEnabledIndex: -1, evaluated: false };
    const stopIndex = steps.findIndex((s) => s.enablement === "NOT_ENABLED");
    return {
      ...f,
      steps,
      evaluated: true,
      firstNotEnabledAt: stopIndex === -1 ? null : steps[stopIndex].name,
      firstNotEnabledIndex: stopIndex,
      enabledSteps: steps.filter((s) => s.enablement === "ENABLED").length,
      unmappedSteps: steps.filter((s) => s.enablement === null).length,
      totalSteps: steps.length,
    };
  });
}

// ------------------------------------------------------------------ build

export function buildGraph({ root = ROOT, environment = null, gitFiles = null } = {}) {
  const read = (p) => readAt(root, p);
  const catalogSrc = read("functions/src/access/permissionCatalog.ts");
  const serverCaps = parseCatalog(catalogSrc);
  const clientCaps = parseCatalog(read("field-ops-app-vite/src/access/permissionCatalog.ts"));
  const countCheck = assertCatalogCount(catalogSrc ?? "", serverCaps);

  const clientById = new Map(clientCaps.map((c) => [c.id, c]));
  const parityIssues = [];
  for (const c of serverCaps) {
    const mirror = clientById.get(c.id);
    if (!mirror) parityIssues.push({ id: c.id, issue: "missing from client mirror" });
    else if (mirror.catalogActive !== c.catalogActive)
      parityIssues.push({
        id: c.id,
        issue: `active mismatch: server=${c.catalogActive} client=${mirror.catalogActive}`,
      });
  }
  for (const c of clientCaps)
    if (!serverCaps.some((s) => s.id === c.id)) parityIssues.push({ id: c.id, issue: "client-only entry" });

  const callables = parseExports(read("functions/src/index.ts"));
  const destinations = parseNav(read("field-ops-app-vite/src/navigation/navConfig.js"));
  const guides = parseGuides(read("docs/user-guide/README.md"));
  const register = parseRegister(read("docs/roadmaps/business-capability-register.md"));
  const eligibleIds = parseEligibleIds(read("functions/src/access/environmentCapabilityOverrides.ts"));

  let registry = null;
  try {
    registry = JSON.parse(read("config/environments.json") ?? "null");
  } catch {
    registry = null;
  }

  // Which environments activate each id (production excluded by the resolver's own rule).
  const activationByEnv = (registry?.environments ?? []).map((e) =>
    resolveActivation(registry, e.id, eligibleIds),
  );
  const envsActivating = new Map();
  for (const a of activationByEnv)
    for (const id of a.activated) {
      if (!envsActivating.has(id)) envsActivating.set(id, []);
      envsActivating.get(id).push(a.environment.id);
    }

  let files = gitFiles;
  if (!files) {
    files = [];
    for (const r of ["functions/src", "field-ops-app-vite/src"]) {
      try {
        files = files.concat(
          execSync(`git ls-files ${r}`, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 })
            .split("\n")
            .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f)),
        );
      } catch {
        /* git unavailable — every capability reports NO_IMPLEMENTATION_EVIDENCE, stated in output */
      }
    }
  }
  const sites = findReferenceSites(files, serverCaps.map((c) => c.id), read);

  const hintedCallables = new Map();
  for (const c of serverCaps) hintedCallables.set(c.id, []);
  for (const e of callables)
    for (const hint of e.capabilityHints)
      if (hintedCallables.has(hint)) hintedCallables.get(hint).push(...e.names);

  const capabilities = serverCaps.map((c) => {
    const where = [...(sites.get(c.id) ?? [])];
    const serverReferences = where.filter((f) => f.startsWith("functions/"));
    const clientReferences = where.filter((f) => f.startsWith("field-ops-app-vite/"));
    const exportedCallables = [...new Set(hintedCallables.get(c.id) ?? [])];
    const implementation = {
      exportedCallables,
      serverReferences: serverReferences.slice(0, 12),
      clientReferences: clientReferences.slice(0, 12),
      serverReferenceCount: serverReferences.length,
      clientReferenceCount: clientReferences.length,
      evidence: classifyImplementation({ exportedCallables, serverReferences, clientReferences }),
    };
    return {
      id: c.id,
      resource: c.resource,
      action: c.action,
      description: c.description,
      catalogActive: c.catalogActive,
      implementation,
      environmentActivation: {
        eligible: eligibleIds.includes(c.id),
        environments: envsActivating.get(c.id) ?? [],
      },
    };
  });

  // Effective state ONLY when an environment was explicitly named.
  let evaluated = null;
  let activatedIds = null;
  if (environment) {
    const a = resolveActivation(registry, environment, eligibleIds);
    activatedIds = new Set(a.activated);
    evaluated = {
      requested: environment,
      found: a.found,
      environment: a.environment,
      blockedByProductionRole: a.blockedByProductionRole,
      activatedCount: a.activated.length,
    };
    for (const c of capabilities) c.effective = effectiveState(c, activatedIds);
  }

  const tally = (arr, fn) => arr.reduce((a, x) => ((a[fn(x)] = (a[fn(x)] ?? 0) + 1), a), {});

  return {
    schema: "capability-graph/2",
    environmentEvaluated: evaluated,
    generatedFrom: [
      "functions/src/access/permissionCatalog.ts",
      "field-ops-app-vite/src/access/permissionCatalog.ts",
      "functions/src/index.ts",
      "functions/src/access/environmentCapabilityOverrides.ts",
      "config/environments.json",
      "field-ops-app-vite/src/navigation/navConfig.js",
      "docs/user-guide/README.md",
      "docs/roadmaps/business-capability-register.md",
    ],
    counts: {
      capabilities: capabilities.length,
      catalogActive: capabilities.filter((c) => c.catalogActive).length,
      catalogInactive: capabilities.filter((c) => !c.catalogActive).length,
      eligibleForEnvironmentActivation: capabilities.filter((c) => c.environmentActivation.eligible).length,
      activatedInSomeEnvironment: capabilities.filter((c) => c.environmentActivation.environments.length).length,
      callableExports: callables.length,
      destinations: destinations.length,
      destinationsHidden: destinations.filter((d) => d.navHidden).length,
      guides: guides.length,
      registerEntries: register.length,
      parityIssues: parityIssues.length,
      ...(evaluated
        ? {
            effectiveEnabled: capabilities.filter((c) => c.effective?.enabled).length,
            effectiveEnabledByCatalog: capabilities.filter((c) => c.effective?.basis === "CATALOG_ACTIVE").length,
            effectiveEnabledByEnvironment: capabilities.filter(
              (c) => c.effective?.basis === "ENVIRONMENT_ACTIVATED",
            ).length,
            effectiveBuiltInert: capabilities.filter((c) => c.effective?.builtInert).length,
          }
        : {}),
    },
    catalogCountCheck: countCheck,
    implementationEvidence: tally(capabilities, (c) => c.implementation.evidence),
    guideStatuses: tally(guides, (g) => g.status),
    flows: resolveFlows(FLOWS, capabilities, activatedIds),
    capabilities,
    callables,
    destinations,
    guides,
    register,
    eligibleIds,
    parityIssues,
  };
}

// ------------------------------------------------------------------ markdown

export function renderMarkdown(g) {
  const ev = g.environmentEvaluated;
  const L = [
    "# Capability graph — declaration, implementation, activation",
    "",
    "**Generated. Do not edit by hand.** `node scripts/buildCapabilityGraph.mjs`",
    "",
    "`repo-graph.json` maps *structure*. This reports *evidence* about capabilities: what the catalog",
    "declares, what the code references, and what each environment activates. These are three separate",
    "things and this document never fuses them into one verdict.",
    "",
    "> **`active: false` does not mean unusable.** `functions/src/access/environmentCapabilityOverrides.ts`",
    "> activates selected catalog-inactive capabilities in configured non-production environments. The",
    "> repo's rule holds throughout: **eligibility != activation != authorization**.",
    "",
    "> **Nothing in this document is authorization.** Enablement means the capability-level activation",
    "> gate permits the capability to be considered in that environment. A principal still needs the",
    "> applicable Role grant, which this graph never evaluates. Read every count below as a statement",
    "> about gates, never about what any person can do.",
    "",
    "## Dimensions reported",
    "",
    "| Dimension | Source | What it does NOT tell you |",
    "| --- | --- | --- |",
    "| Catalog declaration + `active` flag | `permissionCatalog.ts` | Whether any environment activates it |",
    "| Implementation evidence | literal id references; callables from `index.ts` | Whether it is deployed or reachable |",
    "| Environment activation | `environmentCapabilityOverrides.ts` + `config/environments.json` | Whether a principal holds a qualifying grant |",
    "| Capability enablement | computed **only** with `--environment` | **Whether any principal is granted it** |",
    "",
    "## Counts",
    "",
    ...Object.entries(g.counts).map(([k, v]) => `- **${k}**: ${v}`),
    "",
    `Catalog parse check: ${g.catalogCountCheck.parsed}/${g.catalogCountCheck.raw} entries ${g.catalogCountCheck.ok ? "(ok)" : "(**MISMATCH — parser drift**)"}`,
    "",
    "## Implementation evidence",
    "",
    "Evidence of reference. **Not** proof that a callable exists, except where stated.",
    "",
    "| Class | Count | Means |",
    "| --- | ---: | --- |",
    `| EXPORTED | ${g.implementationEvidence.EXPORTED ?? 0} | An exported callable in \`index.ts\` names this capability |`,
    `| SERVER_REFERENCED | ${g.implementationEvidence.SERVER_REFERENCED ?? 0} | Referenced under \`functions/src\`; no callable matched |`,
    `| CLIENT_ONLY | ${g.implementationEvidence.CLIENT_ONLY ?? 0} | Referenced only in the client app |`,
    `| NO_IMPLEMENTATION_EVIDENCE | ${g.implementationEvidence.NO_IMPLEMENTATION_EVIDENCE ?? 0} | No literal reference found — **may be a false negative** for ids assembled indirectly |`,
    "",
    "## Environment activation",
    "",
    `Eligible for activation (allow-list in the resolver): **${g.counts.eligibleForEnvironmentActivation}**.`,
    `Activated by at least one environment: **${g.counts.activatedInSomeEnvironment}**.`,
    "",
    "Production is hard-blocked by role in the resolver and carries no override declaration.",
    "",
    ev
      ? [
          `## Capability enablement — \`${ev.requested}\``,
          "",
          ev.found
            ? `Environment \`${ev.environment.id}\` (role \`${ev.environment.role}\`, project \`${ev.environment.projectId}\`).` +
              (ev.blockedByProductionRole
                ? " **Production role — activation returns empty unconditionally.**"
                : ` Activates ${ev.activatedCount} capabilities.`)
            : "**Environment not found in the registry — treated as activating nothing (fail-closed).**",
          "",
          `- **Enabled: ${g.counts.effectiveEnabled}** — ${g.counts.effectiveEnabledByCatalog} catalog-active, ${g.counts.effectiveEnabledByEnvironment} environment-activated`,
          `- Built but not enabled here (\`BUILT_INERT\`): **${g.counts.effectiveBuiltInert}** — implementation evidence exists and the activation gate is closed. Says nothing about principal grants.`,
          "",
          "_Enabled is a gate, not a grant._",
          "",
        ].join("\n")
      : [
          "## Capability enablement",
          "",
          "**Not computed.** No environment was named, and enablement is not a fact that exists",
          "environment-free. Run with `--environment <id|projectId>` to evaluate one.",
          "",
        ].join("\n"),
    "## Flows — governance coverage per business chain",
    "",
    "Chains transcribed from our own process docs. A step with no mapped capability is `UNMAPPED` and",
    "**never closes a chain** — it may be ordinary UI, legacy role-gated authorization, non-capability",
    "logic, or genuinely absent, and this evidence cannot distinguish those. Step enablement reports the",
    "capability activation gate only; principal Role grants are not evaluated anywhere in this document.",
    "",
    ...g.flows.flatMap((f) => [
      `### ${f.name}`,
      "",
      `Source: \`${f.source}\``,
      "",
      f.evaluated
        ? f.firstNotEnabledAt
          ? `**Under \`${ev.requested}\`, the activation gate first closes at step ${f.firstNotEnabledIndex + 1} of ${f.totalSteps} — ${f.firstNotEnabledAt}.** ${f.unmappedSteps} step(s) unmapped and not evaluated. This is a gate, not a statement that a user gets stuck here.`
          : `**Under \`${ev.requested}\`, no mapped step has its activation gate closed.** ${f.unmappedSteps} step(s) unmapped and not evaluated. Principal grants are not evaluated.`
        : "_Governance coverage only — no enablement computed without an environment._",
      "",
      "| # | Step | Coverage | " + (f.evaluated ? "Enablement | " : "") + "Capabilities |",
      "| ---: | --- | --- | " + (f.evaluated ? "--- | " : "") + "--- |",
      ...f.steps.map(
        (s, i) =>
          `| ${i + 1} | ${s.name} | ${s.coverage} | ` +
          (f.evaluated ? `${s.enablement ?? "n/a"} | ` : "") +
          `${s.capabilities.length ? s.capabilities.map((c) => "`" + c + "`").join(", ") : "—"} |`,
      ),
      "",
    ]),
    ...(g.parityIssues.length
      ? [
          "## ⚠️ Permission-catalog parity issues",
          "",
          ...g.parityIssues.map((p) => `- \`${p.id}\` — ${p.issue}`),
          "",
        ]
      : ["## Permission-catalog parity", "", "Server and client mirrors agree.", ""]),
    "## How to use it",
    "",
    "Before claiming a capability is missing:",
    "",
    "1. Find it in `capabilities[]`. Read `catalogActive`, `implementation.evidence`, and",
    "   `environmentActivation` as **three separate facts**.",
    "2. `catalogActive: false` with a non-empty `environmentActivation.environments` means the activation",
    "   gate is **open in those environments** — not missing, and not inert. It does not mean any",
    "   principal holds a grant for it.",
    "3. `NO_IMPLEMENTATION_EVIDENCE` is a lead, not a verdict — indirect references are invisible here.",
    "4. Check `destinations[]` for a `navHidden` entry whose `placeholderExplanation` states, in its own",
    "   words, why it is unreachable; and `guides[]` for a status tag naming what is missing beneath a",
    "   screen that exists.",
    "5. Only when all of those are silent is something plausibly absent — and confirm by reading.",
    "",
    "Structural questions (who imports whom, is a cited path real) belong to `repo-graph.json`.",
    "",
  ];
  return L.join("\n");
}

// ------------------------------------------------------------------ CLI

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes("--check");
  const environment = argOf("--environment");
  const graph = buildGraph({ environment });
  const json = JSON.stringify(graph, null, 2) + "\n";
  const md = renderMarkdown(graph);
  const jsonPath = "docs/architecture/capability-graph.json";
  const mdPath = "docs/architecture/capability-graph.md";

  if (check) {
    // Drift detection: regenerate in memory and compare. Never writes.
    const problems = [];
    if (!graph.catalogCountCheck.ok)
      problems.push(
        `catalog parser drift: parsed ${graph.catalogCountCheck.parsed} of ${graph.catalogCountCheck.raw} entries`,
      );
    if (graph.parityIssues.length) problems.push(`${graph.parityIssues.length} catalog parity issue(s)`);
    for (const [p, expected] of [
      [jsonPath, json],
      [mdPath, md],
    ]) {
      const actual = readAt(ROOT, p);
      if (actual === null) problems.push(`${p} is missing`);
      else if (actual.replace(/\r\n/g, "\n") !== expected.replace(/\r\n/g, "\n"))
        problems.push(`${p} is stale — regenerate with \`node scripts/buildCapabilityGraph.mjs\``);
    }
    if (problems.length) {
      console.error("capability-graph --check FAILED:");
      for (const p of problems) console.error("  - " + p);
      process.exit(1);
    }
    console.log("capability-graph --check ok (artifacts current, parity clean, parser complete)");
  } else {
    writeFileSync(resolve(ROOT, jsonPath), json);
    writeFileSync(resolve(ROOT, mdPath), md);
    console.log("counts:  " + JSON.stringify(graph.counts));
    console.log("evidence:" + JSON.stringify(graph.implementationEvidence));
    if (graph.environmentEvaluated)
      console.log("env:     " + JSON.stringify(graph.environmentEvaluated));
    else console.log("env:     none evaluated (environment-neutral graph)");
    if (!graph.catalogCountCheck.ok)
      console.error(`WARNING: catalog parser drift — ${JSON.stringify(graph.catalogCountCheck)}`);
  }
}
