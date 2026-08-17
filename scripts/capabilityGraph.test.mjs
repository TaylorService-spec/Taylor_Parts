// Regression tests for scripts/buildCapabilityGraph.mjs.
//
// The graph's first version asserted that `active:false` meant "hard-denied", which is false in this
// repo — `functions/src/access/environmentCapabilityOverrides.ts` activates selected catalog-inactive
// capabilities in configured non-production environments. These tests pin the corrected model, whose
// central rule is that three dimensions stay separate:
//
//     catalog declaration  !=  implementation evidence  !=  environment activation
//
// Most cases run against small fixtures rather than the live catalog, so a legitimate catalog edit does
// not fail the suite. The few that do read live files assert *invariants* (parity, parser completeness,
// production fail-closed), not counts.
//
// Run: node --test scripts/capabilityGraph.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCatalog,
  assertCatalogCount,
  parseExports,
  parseEligibleIds,
  resolveActivation,
  findReferenceSites,
  classifyImplementation,
  effectiveState,
  resolveFlows,
  buildGraph,
} from "./buildCapabilityGraph.mjs";

// ------------------------------------------------------------------ fixtures

const CATALOG_FIXTURE = `
export const CATALOG = Object.freeze([
  Object.freeze({
    id: "alpha.thing.read",
    description: "Read a thing.",
    resource: "alpha.thing",
    action: "read",
    active: true,
  }),
  // A long body, to prove the parser does not lose entries whose description runs past a fixed window.
  Object.freeze({
    id: "beta.thing.write",
    description:
      "${"Write a thing. ".repeat(80)}",
    resource: "beta.thing",
    action: "write",
    active: false,
  }),
  Object.freeze({ id: "gamma.thing.list", description: "List.", resource: "gamma.thing", action: "list", active: false }),
]);
`;

const OVERRIDES_FIXTURE = `
export const SPINE_OVERRIDE_ELIGIBLE_IDS: ReadonlySet<PermissionId> = new Set<PermissionId>([
  "beta.thing.write",
  "gamma.thing.list",
]);
`;

const REGISTRY_FIXTURE = {
  environments: [
    { id: "sandbox-a", role: "sandbox", firebase: { projectId: "proj-sandbox" },
      capabilityActivationOverrides: ["beta.thing.write", "not.eligible.id"] },
    { id: "prod", role: "production", firebase: { projectId: "proj-prod" },
      // Deliberately present and non-empty: the code block must ignore it entirely.
      capabilityActivationOverrides: ["beta.thing.write", "gamma.thing.list"] },
  ],
};

// ------------------------------------------------------------------ catalog parsing

test("parses every catalog entry, including bodies longer than any fixed window", () => {
  const caps = parseCatalog(CATALOG_FIXTURE);
  assert.deepEqual(caps.map((c) => c.id), ["alpha.thing.read", "beta.thing.write", "gamma.thing.list"]);
  assert.equal(caps[0].catalogActive, true);
  assert.equal(caps[1].catalogActive, false);
  assert.equal(caps[0].resource, "alpha.thing");
  assert.equal(caps[0].action, "read");
});

test("catalog count assertion detects parser under-reporting", () => {
  const caps = parseCatalog(CATALOG_FIXTURE);
  assert.equal(assertCatalogCount(CATALOG_FIXTURE, caps).ok, true);
  // Simulate the exact historical failure: a parser that silently drops entries.
  assert.equal(assertCatalogCount(CATALOG_FIXTURE, caps.slice(0, 2)).ok, false);
});

test("non-capability frozen objects are not mistaken for capabilities", () => {
  const caps = parseCatalog(`Object.freeze({ id: "NotACapability", role: "admin" });`);
  assert.deepEqual(caps, []);
});

// ------------------------------------------------------------------ eligibility + activation

test("eligibility allow-list is read from the resolver source", () => {
  assert.deepEqual(parseEligibleIds(OVERRIDES_FIXTURE), ["beta.thing.write", "gamma.thing.list"]);
});

test("declared overrides are intersected with the eligibility allow-list", () => {
  const a = resolveActivation(REGISTRY_FIXTURE, "sandbox-a", ["beta.thing.write", "gamma.thing.list"]);
  assert.deepEqual(a.activated, ["beta.thing.write"]);
  assert.deepEqual(a.declaredNotEligible, ["not.eligible.id"]);
});

test("production role activates nothing, even when the registry declares overrides", () => {
  const a = resolveActivation(REGISTRY_FIXTURE, "prod", ["beta.thing.write", "gamma.thing.list"]);
  assert.equal(a.blockedByProductionRole, true);
  assert.deepEqual(a.activated, []);
});

test("unknown environment is fail-closed", () => {
  const a = resolveActivation(REGISTRY_FIXTURE, "does-not-exist", ["beta.thing.write"]);
  assert.equal(a.found, false);
  assert.deepEqual(a.activated, []);
});

test("an environment may be selected by id or by firebase projectId", () => {
  const byId = resolveActivation(REGISTRY_FIXTURE, "sandbox-a", ["beta.thing.write"]);
  const byProject = resolveActivation(REGISTRY_FIXTURE, "proj-sandbox", ["beta.thing.write"]);
  assert.deepEqual(byId.activated, byProject.activated);
});

// ------------------------------------------------------------------ implementation evidence

test("a matched exported callable outranks a plain server reference", () => {
  assert.equal(
    classifyImplementation({ exportedCallables: ["issueInvoice"], serverReferences: ["a.ts"], clientReferences: [] }),
    "EXPORTED",
  );
  assert.equal(
    classifyImplementation({ exportedCallables: [], serverReferences: ["a.ts"], clientReferences: [] }),
    "SERVER_REFERENCED",
  );
});

test("client-only references are labelled as such, never as server implementation", () => {
  assert.equal(
    classifyImplementation({ exportedCallables: [], serverReferences: [], clientReferences: ["ui.jsx"] }),
    "CLIENT_ONLY",
  );
});

test("an id reached only by indirection yields NO_IMPLEMENTATION_EVIDENCE, not a false positive", () => {
  // The known false-negative class: the id is assembled at runtime, so no literal appears in source.
  const files = ["a.ts"];
  const read = () => `const id = PREFIX + ".thing.read"; enforce(id);`;
  const sites = findReferenceSites(files, ["alpha.thing.read"], read);
  assert.equal(sites.has("alpha.thing.read"), false);
  assert.equal(
    classifyImplementation({ exportedCallables: [], serverReferences: [], clientReferences: [] }),
    "NO_IMPLEMENTATION_EVIDENCE",
  );
});

test("the catalog and the eligibility list are excluded from enforcement evidence", () => {
  const read = () => `"alpha.thing.read"`;
  const sites = findReferenceSites(
    ["functions/src/access/permissionCatalog.ts", "functions/src/access/environmentCapabilityOverrides.ts"],
    ["alpha.thing.read"],
    read,
  );
  assert.equal(sites.size, 0, "declaring a capability is not implementing it");
});

// ------------------------------------------------------------------ effective state

const capWith = (over = {}) => ({
  id: "beta.thing.write",
  catalogActive: false,
  implementation: { evidence: "EXPORTED" },
  ...over,
});

test("catalog-inactive but environment-activated is ENABLED, not inert", () => {
  const s = effectiveState(capWith(), new Set(["beta.thing.write"]));
  assert.equal(s.basis, "ENVIRONMENT_ACTIVATED");
  assert.equal(s.enabled, true);
  assert.equal(s.builtInert, false, "this is the exact error the rewrite exists to prevent");
});

test("catalog-active is ENABLED regardless of environment overrides", () => {
  const s = effectiveState(capWith({ catalogActive: true }), new Set());
  assert.equal(s.basis, "CATALOG_ACTIVE");
  assert.equal(s.enabled, true);
});

// The distinction the second review round required: activation is a GATE, not a GRANT. This graph
// answers the middle term of `eligibility != activation != authorization` and must never report the
// third. If a future change reintroduces an `authorized` field, this test fails.
test("enablement is activation only — the graph never asserts principal authorization", () => {
  const s = effectiveState(capWith(), new Set(["beta.thing.write"]));
  assert.equal(s.enabled, true, "the activation gate is open");
  assert.equal("authorized" in s, false, "no authorization claim may be emitted");
  assert.deepEqual(Object.keys(s).sort(), ["basis", "builtInert", "enabled"]);
});

test("BUILT_INERT requires implementation evidence AND the activation gate closed in this environment", () => {
  const withImpl = effectiveState(capWith(), new Set());
  assert.equal(withImpl.builtInert, true);
  const withoutImpl = effectiveState(
    capWith({ implementation: { evidence: "NO_IMPLEMENTATION_EVIDENCE" } }),
    new Set(),
  );
  assert.equal(withoutImpl.builtInert, false, "nothing was built, so nothing is inert");
});

// ------------------------------------------------------------------ flows

const FLOW_FIXTURE = [
  {
    id: "f",
    name: "Fixture flow",
    source: "test",
    steps: [
      { name: "unmapped step", match: [] },
      { name: "authorized step", match: ["alpha.thing.read"] },
      { name: "unauthorized step", match: ["gamma.thing.list"] },
    ],
  },
];
const FLOW_CAPS = [
  { id: "alpha.thing.read", catalogActive: true, implementation: { evidence: "EXPORTED" } },
  { id: "gamma.thing.list", catalogActive: false, implementation: { evidence: "SERVER_REFERENCED" } },
];

test("an UNMAPPED step never closes a chain", () => {
  const [f] = resolveFlows(FLOW_FIXTURE, FLOW_CAPS, new Set(["alpha.thing.read"]));
  assert.equal(f.steps[0].coverage, "UNMAPPED");
  assert.equal(f.steps[0].enablement, null);
  assert.equal(f.firstNotEnabledIndex, 2, "the closed gate is the mapped step, not the unmapped one");
  assert.equal(f.firstNotEnabledAt, "unauthorized step");
});

test("flow steps report enablement, never authorization", () => {
  const [f] = resolveFlows(FLOW_FIXTURE, FLOW_CAPS, new Set(["alpha.thing.read"]));
  assert.deepEqual(f.steps.map((s) => s.enablement), [null, "ENABLED", "NOT_ENABLED"]);
  for (const s of f.steps) assert.equal("authorized" in s, false);
});

test("no enablement is computed without an environment", () => {
  const [f] = resolveFlows(FLOW_FIXTURE, FLOW_CAPS, null);
  assert.equal(f.evaluated, false);
  assert.equal(f.firstNotEnabledAt, null);
  for (const s of f.steps) assert.equal(s.enablement, null);
});

test("environment activation can open a gate the catalog leaves closed", () => {
  const [closed] = resolveFlows(FLOW_FIXTURE, FLOW_CAPS, new Set());
  assert.equal(closed.firstNotEnabledAt, "unauthorized step");
  const [open] = resolveFlows(FLOW_FIXTURE, FLOW_CAPS, new Set(["gamma.thing.list"]));
  assert.equal(open.firstNotEnabledAt, null, "activation is what opens the gate");
});

test("a flow step naming an id absent from the catalog is reported, not silently skipped", () => {
  const [f] = resolveFlows(
    [{ id: "x", name: "x", source: "t", steps: [{ name: "s", match: ["ghost.id.here"] }] }],
    FLOW_CAPS,
    new Set(),
  );
  assert.equal(f.steps[0].coverage, "MAPPED_ID_NOT_IN_CATALOG");
  assert.deepEqual(f.steps[0].missingIds, ["ghost.id.here"]);
});

// ------------------------------------------------------------------ live-repo invariants

test("live catalog parses completely and mirrors agree", () => {
  const g = buildGraph({});
  assert.equal(g.catalogCountCheck.ok, true, `parser drift: ${JSON.stringify(g.catalogCountCheck)}`);
  assert.deepEqual(g.parityIssues, [], "server and client permission catalogs must agree");
});

test("the environment-neutral graph asserts no effective state at all", () => {
  const g = buildGraph({});
  assert.equal(g.environmentEvaluated, null);
  for (const c of g.capabilities) assert.equal(c.effective, undefined);
  for (const f of g.flows) assert.equal(f.firstNotEnabledAt, null);
});

test("live production environment is fail-closed", () => {
  const g = buildGraph({ environment: "taylor-parts" });
  assert.equal(g.environmentEvaluated.blockedByProductionRole, true);
  assert.equal(g.environmentEvaluated.activatedCount, 0);
  const activatedHere = g.capabilities.filter((c) => c.effective?.basis === "ENVIRONMENT_ACTIVATED");
  assert.deepEqual(activatedHere, [], "no capability may be environment-activated in production");
});

test("live sandbox enables strictly more than the catalog baseline", () => {
  const neutral = buildGraph({});
  const sandbox = buildGraph({ environment: "eos-platform-sandbox" });
  assert.equal(sandbox.environmentEvaluated.found, true);
  assert.ok(
    sandbox.counts.effectiveEnabled > neutral.counts.catalogActive,
    "sandbox activation must lift catalog-inactive capabilities",
  );
  assert.equal(
    sandbox.counts.effectiveEnabled,
    sandbox.counts.effectiveEnabledByCatalog + sandbox.counts.effectiveEnabledByEnvironment,
    "enabled must decompose into its two bases, so neither is ever implied by the other",
  );
  const activated = sandbox.capabilities.filter((c) => c.effective?.basis === "ENVIRONMENT_ACTIVATED");
  assert.ok(activated.length > 0);
  for (const c of activated) {
    assert.equal(c.catalogActive, false);
    assert.equal(c.environmentActivation.eligible, true, "activation requires eligibility");
  }
});
