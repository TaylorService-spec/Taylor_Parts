// Domain knowledge graph -- PURE CORE.
//
// WHY: a register of topic documents is a filing cabinet. It stores what was learned and
// answers nothing. The questions that actually decide what we build and what we claim are
// relational:
//
//   - which products CLAIM to solve this pain, and what do users say AFTER buying?
//   - which of our pains does NOBODY solve?            <- the moat
//   - where does a vendor's claim contradict its users? <- the wedge
//   - what does every vendor CALL this concept?         <- the buyer's vocabulary
//
// None of those are answerable by reading files one at a time. They need edges.
//
// The graph is written by the field-service-domain-researcher agent as it learns, and read
// by the next run before it searches -- so knowledge compounds instead of being re-bought.
//
// PURE: no filesystem, network, or clock. Callers supply the graph.

/**
 * Graph shape (all arrays; every claim/complaint/barrier carries a `source` URL):
 *
 *   products     [{ id, name, vendor, url }]
 *   capabilities [{ id, canonical, aliases: { [productId]: "vendor's name for it" } }]
 *   pains        [{ id, label }]                     // P1..P8 from the Taylor pain register
 *   addresses    [{ capabilityId, painId }]          // capability -> pain it would solve
 *   claims       [{ productId, capabilityId, source, quote }]
 *   complaints   [{ productId, capabilityId, theme, frequency, source }]
 *   barriers     [{ productId, capabilityId, kind, detail, source }]  // kind: LICENCE|PRICE|CONFIG|TIER
 *   ours         [{ capabilityId, state }]           // state: BUILT|PARTIAL|NONE
 */

const list = (g, k) => (Array.isArray(g?.[k]) ? g[k] : []);
const byId = (arr) => new Map(arr.map((x) => [x.id, x]));

/** Every capability a product claims, with the source that proves the claim. */
export function capabilitiesClaimedBy(graph, productId) {
  const caps = byId(list(graph, "capabilities"));
  return list(graph, "claims")
    .filter((c) => c.productId === productId)
    .map((c) => ({
      capabilityId: c.capabilityId,
      canonical: caps.get(c.capabilityId)?.canonical ?? c.capabilityId,
      source: c.source,
      quote: c.quote ?? null,
    }));
}

/** Every product claiming a capability. "Who else says they do this?" */
export function productsClaiming(graph, capabilityId) {
  const prods = byId(list(graph, "products"));
  return list(graph, "claims")
    .filter((c) => c.capabilityId === capabilityId)
    .map((c) => ({ productId: c.productId, name: prods.get(c.productId)?.name ?? c.productId, source: c.source }));
}

/**
 * Full picture for one pain: which capabilities would address it, who claims them, what
 * users complain about afterwards, what it costs to get, and whether WE have it.
 *
 * This is the answer to "why not just buy X?" for a specific pain.
 */
export function painCoverage(graph, painId) {
  const capIds = list(graph, "addresses")
    .filter((a) => a.painId === painId)
    .map((a) => a.capabilityId);
  const ours = new Map(list(graph, "ours").map((o) => [o.capabilityId, o.state]));

  return capIds.map((capabilityId) => ({
    capabilityId,
    claimedBy: productsClaiming(graph, capabilityId),
    complaints: list(graph, "complaints").filter((x) => x.capabilityId === capabilityId),
    barriers: list(graph, "barriers").filter((x) => x.capabilityId === capabilityId),
    ourState: ours.get(capabilityId) ?? "NONE",
  }));
}

/**
 * THE MOAT: pains that no researched product claims to solve.
 *
 * Deliberately conservative -- "no product in this graph claims it" is a statement about what
 * we have RESEARCHED, never about the market. An empty graph would call everything a moat,
 * which is why `researchedProducts` is returned alongside: a moat computed from two products
 * is close to worthless and the caller must be able to see that.
 */
export function unsolvedPains(graph) {
  const claimedCaps = new Set(list(graph, "claims").map((c) => c.capabilityId));
  const researchedProducts = list(graph, "products").length;

  const unsolved = list(graph, "pains")
    .filter((p) => {
      const caps = list(graph, "addresses").filter((a) => a.painId === p.id).map((a) => a.capabilityId);
      // A pain with no capability mapped to it is UNMAPPED, not unsolved -- do not claim it.
      if (caps.length === 0) return false;
      return caps.every((c) => !claimedCaps.has(c));
    })
    .map((p) => ({ painId: p.id, label: p.label }));

  return { unsolved, researchedProducts, confidence: researchedProducts >= 3 ? "USABLE" : "THIN" };
}

/** Pains with no capability mapped at all -- research gaps, not moats. */
export function unmappedPains(graph) {
  const mapped = new Set(list(graph, "addresses").map((a) => a.painId));
  return list(graph, "pains").filter((p) => !mapped.has(p.id)).map((p) => ({ painId: p.id, label: p.label }));
}

/**
 * THE WEDGE: a product claims a capability AND its users complain about that same capability.
 * The gap between the pitch and the experience is the most useful thing in the graph.
 */
export function contradictions(graph) {
  const prods = byId(list(graph, "products"));
  const out = [];
  for (const claim of list(graph, "claims")) {
    const against = list(graph, "complaints").filter(
      (x) => x.productId === claim.productId && x.capabilityId === claim.capabilityId,
    );
    if (against.length) {
      out.push({
        productId: claim.productId,
        product: prods.get(claim.productId)?.name ?? claim.productId,
        capabilityId: claim.capabilityId,
        claim: { source: claim.source, quote: claim.quote ?? null },
        complaints: against,
      });
    }
  }
  return out;
}

/** What each vendor CALLS a concept -- the vocabulary a buyer has already been trained in. */
export function vocabulary(graph, capabilityId) {
  const cap = byId(list(graph, "capabilities")).get(capabilityId);
  if (!cap) return null;
  return { canonical: cap.canonical, aliases: cap.aliases ?? {} };
}

/**
 * Where we are exposed: a capability a competitor claims that we do not have.
 * Sorted so the pains it touches are visible -- an unbuilt capability nobody's pain maps to
 * is not urgent, whatever a competitor claims.
 */
export function exposure(graph) {
  const ours = new Map(list(graph, "ours").map((o) => [o.capabilityId, o.state]));
  const caps = byId(list(graph, "capabilities"));
  const seen = new Set();
  const out = [];
  for (const claim of list(graph, "claims")) {
    if (seen.has(claim.capabilityId)) continue;
    const state = ours.get(claim.capabilityId) ?? "NONE";
    if (state === "BUILT") continue;
    seen.add(claim.capabilityId);
    out.push({
      capabilityId: claim.capabilityId,
      canonical: caps.get(claim.capabilityId)?.canonical ?? claim.capabilityId,
      ourState: state,
      claimedBy: productsClaiming(graph, claim.capabilityId).map((p) => p.name),
      pains: list(graph, "addresses").filter((a) => a.capabilityId === claim.capabilityId).map((a) => a.painId),
    });
  }
  return out.sort((a, b) => b.pains.length - a.pains.length);
}

/**
 * OPPORTUNITIES: a problem that products in this graph do not solve, felt by an identifiable
 * SEGMENT. This is the `SIGNAL -> PROBLEM_CLUSTER -> ... -> OPPORTUNITY` step of the company
 * capability register's C-3 lifecycle.
 *
 * HARD BOUNDARY, enforced in the shape of the output rather than left to good intentions:
 * this returns SEGMENTS, never individuals. Complaint sources are counted and cited so a human
 * can verify the cluster is real; the complainants themselves are never surfaced as contacts.
 *
 * The company register states the rule plainly: "No spam; an individual's complaint is never
 * authorization to target that individual." A person describing a problem in public has not
 * asked to be sold to. Clustering tells you which segment to speak to and what words to use --
 * it is not a lead list, and treating it as one would cost more reputationally than it returns.
 *
 * Discovery also grants no authority to build, spend, market, or contact. Everything here is
 * evidence for a recommendation, never a decision.
 *
 * @param {number} minCluster complaints required before a theme counts as a cluster, not anecdote
 */
export function opportunities(graph, minCluster = 3) {
  const { unsolved } = unsolvedPains(graph);
  const unsolvedIds = new Set(unsolved.map((u) => u.painId));
  const capToPains = new Map();
  for (const a of list(graph, "addresses")) {
    if (!capToPains.has(a.capabilityId)) capToPains.set(a.capabilityId, []);
    capToPains.get(a.capabilityId).push(a.painId);
  }

  // Cluster complaints by theme. One comment is anecdote; a repeated theme is signal.
  const themes = new Map();
  for (const c of list(graph, "complaints")) {
    const key = `${c.capabilityId}::${c.theme}`;
    if (!themes.has(key)) {
      themes.set(key, { capabilityId: c.capabilityId, theme: c.theme, count: 0, sources: [], segments: new Set() });
    }
    const t = themes.get(key);
    t.count += 1;
    if (c.source) t.sources.push(c.source);
    if (c.segment) t.segments.add(c.segment);
  }

  return [...themes.values()]
    .filter((t) => t.count >= minCluster)
    .map((t) => ({
      capabilityId: t.capabilityId,
      theme: t.theme,
      clusterSize: t.count,
      sources: t.sources,
      // SEGMENTS only. Never individuals, never handles, never contact details.
      segments: [...t.segments],
      painsTouched: (capToPains.get(t.capabilityId) ?? []).filter((p) => unsolvedIds.has(p)),
      status: "IDENTIFIED", // never OPPORTUNITY-as-authorization; the Owner decides
    }))
    .sort((a, b) => b.painsTouched.length - a.painsTouched.length || b.clusterSize - a.clusterSize);
}

/** Structural integrity: every claim/complaint/barrier must carry a source. No source, no finding. */
export function validate(graph) {
  const errors = [];
  const capIds = new Set(list(graph, "capabilities").map((c) => c.id));
  const prodIds = new Set(list(graph, "products").map((p) => p.id));
  const painIds = new Set(list(graph, "pains").map((p) => p.id));

  for (const kind of ["claims", "complaints", "barriers"]) {
    for (const [i, e] of list(graph, kind).entries()) {
      if (!e.source) errors.push(`${kind}[${i}] has no source — no source, no finding`);
      if (e.productId && !prodIds.has(e.productId)) errors.push(`${kind}[${i}] unknown productId ${e.productId}`);
      if (e.capabilityId && !capIds.has(e.capabilityId)) errors.push(`${kind}[${i}] unknown capabilityId ${e.capabilityId}`);
    }
  }
  for (const [i, a] of list(graph, "addresses").entries()) {
    if (!capIds.has(a.capabilityId)) errors.push(`addresses[${i}] unknown capabilityId ${a.capabilityId}`);
    if (!painIds.has(a.painId)) errors.push(`addresses[${i}] unknown painId ${a.painId}`);
  }
  return { ok: errors.length === 0, errors };
}
