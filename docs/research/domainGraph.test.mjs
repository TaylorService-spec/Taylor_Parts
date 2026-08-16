import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesClaimedBy, productsClaiming, painCoverage, unsolvedPains, unmappedPains,
  contradictions, vocabulary, exposure, opportunities, validate,
} from "./domainGraph.mjs";

const G = {
  products: [
    { id: "d365fs", name: "Dynamics 365 Field Service", vendor: "Microsoft" },
    { id: "servicetitan", name: "ServiceTitan", vendor: "ServiceTitan" },
    { id: "jobber", name: "Jobber", vendor: "Jobber" },
  ],
  capabilities: [
    { id: "fs-erp-sync", canonical: "Field service to ERP synchronisation",
      aliases: { d365fs: "Business Central integration", servicetitan: "Accounting sync" } },
    { id: "dispatch-board", canonical: "Dispatch board" },
    { id: "intercompany-transfer-pricing", canonical: "Intercompany transfer pricing" },
    { id: "unmapped-cap", canonical: "Something nobody mapped to a pain" },
  ],
  pains: [
    { id: "P1", label: "Two systems do not reconcile" },
    { id: "P5", label: "Two legal entities under one roof" },
    { id: "P9", label: "A pain with no capability mapped" },
  ],
  addresses: [
    { capabilityId: "fs-erp-sync", painId: "P1" },
    { capabilityId: "intercompany-transfer-pricing", painId: "P5" },
  ],
  claims: [
    { productId: "d365fs", capabilityId: "fs-erp-sync", source: "https://learn.microsoft.com/x", quote: "eliminates duplicate data entry" },
    { productId: "servicetitan", capabilityId: "dispatch-board", source: "https://servicetitan.com/x" },
  ],
  complaints: [
    { productId: "d365fs", capabilityId: "fs-erp-sync", theme: "sync silently drops records", frequency: 1, source: "https://reddit.com/a", segment: "SMB HVAC" },
    { productId: "d365fs", capabilityId: "fs-erp-sync", theme: "sync silently drops records", frequency: 1, source: "https://reddit.com/b", segment: "SMB HVAC" },
    { productId: "d365fs", capabilityId: "fs-erp-sync", theme: "sync silently drops records", frequency: 1, source: "https://reddit.com/c", segment: "commercial refrigeration" },
    { productId: "jobber", capabilityId: "dispatch-board", theme: "no week view", frequency: 1, source: "https://reddit.com/d" },
  ],
  barriers: [
    { productId: "d365fs", capabilityId: "fs-erp-sync", kind: "LICENCE", detail: "requires both products licensed", source: "https://microsoft.com/pricing" },
  ],
  ours: [
    { capabilityId: "intercompany-transfer-pricing", state: "PARTIAL" },
    { capabilityId: "dispatch-board", state: "BUILT" },
  ],
};

test("capabilitiesClaimedBy resolves the canonical name and keeps the source", () => {
  const c = capabilitiesClaimedBy(G, "d365fs");
  assert.equal(c.length, 1);
  assert.equal(c[0].canonical, "Field service to ERP synchronisation");
  assert.match(c[0].source, /learn\.microsoft/);
});

test("productsClaiming answers 'who else says they do this'", () => {
  assert.deepEqual(productsClaiming(G, "fs-erp-sync").map((p) => p.productId), ["d365fs"]);
});

test("painCoverage answers 'why not just buy X' for one pain", () => {
  const [cov] = painCoverage(G, "P1");
  assert.equal(cov.capabilityId, "fs-erp-sync");
  assert.equal(cov.claimedBy.length, 1);
  assert.equal(cov.complaints.length, 3, "the lived experience after buying");
  assert.equal(cov.barriers.length, 1, "and what it costs to get");
  assert.equal(cov.ourState, "NONE");
});

test("THE MOAT: a pain no researched product claims to solve", () => {
  const { unsolved } = unsolvedPains(G);
  assert.deepEqual(unsolved.map((u) => u.painId), ["P5"]);
});

test("DEFECT GUARD: a pain with NO capability mapped is unmapped, not a moat", () => {
  // Otherwise every unresearched pain would masquerade as a differentiator.
  const { unsolved } = unsolvedPains(G);
  assert.ok(!unsolved.some((u) => u.painId === "P9"));
  assert.deepEqual(unmappedPains(G).map((p) => p.painId), ["P9"]);
});

test("moat confidence is THIN until enough products are researched", () => {
  assert.equal(unsolvedPains(G).confidence, "USABLE");
  const thin = { ...G, products: G.products.slice(0, 2) };
  assert.equal(unsolvedPains(thin).confidence, "THIN");
});

test("THE WEDGE: a claim contradicted by its own users", () => {
  const c = contradictions(G);
  assert.equal(c.length, 1);
  assert.equal(c[0].productId, "d365fs");
  assert.match(c[0].claim.quote, /eliminates duplicate data entry/);
  assert.equal(c[0].complaints.length, 3);
});

test("vocabulary gives the words a buyer has already been trained in", () => {
  const v = vocabulary(G, "fs-erp-sync");
  assert.equal(v.aliases.d365fs, "Business Central integration");
  assert.equal(vocabulary(G, "nope"), null);
});

test("exposure ranks unbuilt capabilities competitors claim, by pains touched", () => {
  const e = exposure(G);
  assert.equal(e[0].capabilityId, "fs-erp-sync", "touches a pain, so it outranks");
  assert.ok(!e.some((x) => x.capabilityId === "dispatch-board"), "BUILT is not exposure");
});

test("opportunities cluster complaints and never surface individuals", () => {
  const o = opportunities(G, 3);
  assert.equal(o.length, 1, "only the 3x theme clusters; the 1x is anecdote");
  assert.equal(o[0].theme, "sync silently drops records");
  assert.equal(o[0].clusterSize, 3);
  assert.deepEqual(o[0].segments.sort(), ["SMB HVAC", "commercial refrigeration"]);
  assert.equal(o[0].status, "IDENTIFIED", "never authorization");
  // The hard boundary: segments only. No handles, names, or contact fields anywhere.
  const serialized = JSON.stringify(o);
  assert.ok(!/contact|handle|username|email/i.test(serialized));
});

test("a single complaint is anecdote and does not become an opportunity", () => {
  assert.equal(opportunities(G, 3).some((o) => o.theme === "no week view"), false);
});

test("validate enforces no source, no finding", () => {
  assert.equal(validate(G).ok, true);
  const bad = { ...G, claims: [{ productId: "d365fs", capabilityId: "fs-erp-sync" }] };
  const r = validate(bad);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no source, no finding/);
});

test("validate catches dangling references", () => {
  const bad = { ...G, claims: [{ productId: "ghost", capabilityId: "fs-erp-sync", source: "u" }] };
  assert.match(validate(bad).errors.join(" "), /unknown productId ghost/);
});

test("every query survives an empty or malformed graph", () => {
  for (const g of [{}, { products: null }, undefined]) {
    assert.doesNotThrow(() => {
      unsolvedPains(g ?? {});
      contradictions(g ?? {});
      opportunities(g ?? {});
      exposure(g ?? {});
      validate(g ?? {});
    });
  }
});
