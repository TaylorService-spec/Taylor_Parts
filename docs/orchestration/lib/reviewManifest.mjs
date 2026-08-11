// Review MANIFEST/INDEX — conceptually resolves `review:<id>` → { request, facts, evidence, result,
// findings } as artifact REFERENCES. It is an index/resolver, NOT a second review ledger and NOT a
// second authority: the aiExchange lifecycle and review semantics are unchanged; this only maps a review
// id to the content-addressed artifacts (reviewArtifacts.mjs) that carry the substance. Pure.

const SINGLE_SLOTS = Object.freeze(["request", "facts", "result"]);
const LIST_SLOTS = Object.freeze(["evidence", "findings"]);

/** An in-memory manifest. Persist via toIndex()/fromIndex() into the injected durable store as needed. */
export function makeReviewManifest(index = {}) {
  const reviews = new Map();
  for (const [id, slots] of Object.entries(index || {})) reviews.set(id, cloneSlots(slots));

  function ensure(id) {
    if (!reviews.has(id)) reviews.set(id, { request: null, facts: null, result: null, evidence: [], findings: [] });
    return reviews.get(id);
  }
  return {
    /** Register an artifact ref under a review slot. List slots (evidence/findings) append + dedupe by hash. */
    register(reviewId, slot, ref) {
      if (!SINGLE_SLOTS.includes(slot) && !LIST_SLOTS.includes(slot)) throw new Error(`register: unknown slot ${slot}`);
      const r = ensure(reviewId);
      if (LIST_SLOTS.includes(slot)) {
        if (!r[slot].some((x) => x.sha256 === ref.sha256)) r[slot].push(ref); // content-hash dedup
      } else {
        r[slot] = ref;
      }
      return this;
    },
    /** Resolve `review:<id>` → its artifact references. Null/[] where a slot is not yet registered. */
    resolve(reviewId) {
      const r = reviews.get(reviewId);
      return r ? cloneSlots(r) : { request: null, facts: null, result: null, evidence: [], findings: [] };
    },
    has(reviewId) { return reviews.has(reviewId); },
    /** All refs across a review — the compact set a message carries INSTEAD of the substance. */
    refsFor(reviewId) {
      const r = this.resolve(reviewId);
      return [r.request, r.facts, r.result, ...r.evidence, ...r.findings].filter(Boolean);
    },
    toIndex() {
      const out = {};
      for (const [id, slots] of reviews.entries()) out[id] = cloneSlots(slots);
      return out;
    },
    reviewIds() { return [...reviews.keys()]; },
  };
}

function cloneSlots(s = {}) {
  return {
    request: s.request || null,
    facts: s.facts || null,
    result: s.result || null,
    evidence: Array.isArray(s.evidence) ? [...s.evidence] : [],
    findings: Array.isArray(s.findings) ? [...s.findings] : [],
  };
}
