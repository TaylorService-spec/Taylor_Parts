// BOUNDED ACTIONABLE PREVIEWS -- Owner Decision #172, and the line it draws.
//
//     A LIST OF REAL WORK IS ALLOWED.
//     A TOTAL DERIVED FROM THAT LIST IS NOT.
//
// The failure this guards is specific and seductive: a dashboard tile wants a number, the read hands
// back rows, and `rows.length` is right there. It would be wrong every time the read is bounded, and
// wrong in the direction that flatters -- "5 reorder requests" when there are forty.
//
// The second failure is quieter and worse: rendering "nothing waiting" from a read that FAILED. A
// clear queue and an unreadable queue look identical if EMPTY and UNKNOWN are collapsed, and only
// one of them means the person can go home.
//
// Run: node --test test/dashboardPreview.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { boundedPreview, reachableHref, PREVIEW_STATE, PREVIEW_ROW_LIMIT } from "../src/domain/dashboardPreview.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

// ── the three outcomes are three ────────────────────────────────────────────────────────────────

test("an unresolved read is UNKNOWN and carries NO rows", () => {
  // Not "nothing waiting", and not a partial list either -- showing some rows beside "could not
  // read" invites a reader to treat what they can see as what there is.
  for (const p of [
    boundedPreview({ rows: rows(3), resolved: false }),
    boundedPreview({ rows: null }),
    boundedPreview({ rows: undefined }),
    boundedPreview(),
  ]) {
    assert.equal(p.state, PREVIEW_STATE.UNKNOWN);
    assert.deepEqual(p.rows, []);
    assert.equal(p.hasMore, false);
  }
});

test("a resolved read with no rows is EMPTY -- a real, earned claim", () => {
  const p = boundedPreview({ rows: [], resolved: true });
  assert.equal(p.state, PREVIEW_STATE.EMPTY);
});

test("EMPTY and UNKNOWN are never the same state", () => {
  // The whole point. One means the queue is clear; the other means nobody could look.
  assert.notEqual(
    boundedPreview({ rows: [], resolved: true }).state,
    boundedPreview({ rows: [], resolved: false }).state,
  );
});

// ── no counts, by construction ──────────────────────────────────────────────────────────────────

test("the preview exposes NO count of any kind", () => {
  const p = boundedPreview({ rows: rows(40) });
  for (const forbidden of ["count", "total", "length", "size", "remaining", "more", "percent"]) {
    assert.ok(!(forbidden in p), `preview exposes "${forbidden}" -- a tile could render it as a total`);
  }
  assert.deepEqual(Object.keys(p).sort(), ["hasMore", "rows", "state"]);
  assert.equal(typeof p.hasMore, "boolean", "hasMore must be a boolean, never a remainder");
});

test("forty rows show five and say only that more exist", () => {
  const p = boundedPreview({ rows: rows(40) });
  assert.equal(p.state, PREVIEW_STATE.READY);
  assert.equal(p.rows.length, PREVIEW_ROW_LIMIT);
  assert.equal(p.hasMore, true);
  // The rows shown are the FIRST five in the domain's order -- nothing re-sorted or sampled.
  assert.deepEqual(p.rows.map((r) => r.id), ["r0", "r1", "r2", "r3", "r4"]);
});

test("exactly the limit does not claim more exist", () => {
  const p = boundedPreview({ rows: rows(PREVIEW_ROW_LIMIT) });
  assert.equal(p.rows.length, PREVIEW_ROW_LIMIT);
  assert.equal(p.hasMore, false);
});

test("the READ may assert more exist even when it returned few", () => {
  // A read that asked for limit+1 and got it knows more exist without the rows proving it.
  const p = boundedPreview({ rows: rows(2), hasMore: true });
  assert.equal(p.hasMore, true);
  assert.equal(p.rows.length, 2);
});

// ── ordering is the domain's, never the dashboard's ─────────────────────────────────────────────

test("row order is preserved exactly -- the dashboard never ranks", () => {
  // #172 s3: no invented priority, urgency or score. Whatever the workspace shows, this shows.
  const ordered = [{ id: "z" }, { id: "a" }, { id: "m" }];
  assert.deepEqual(boundedPreview({ rows: ordered }).rows.map((r) => r.id), ["z", "a", "m"]);
});

// ── View all is proven reachable, never plausible ───────────────────────────────────────────────

const GROUPS = [
  { domain: { key: "customers", path: "customers" }, items: [{ key: "opportunities", path: "opportunities" }] },
  { domain: { key: "inventory", path: "inventory" }, items: [{ key: "parts", path: "" }] },
];

test("a reachable destination resolves to its real href", () => {
  assert.equal(reachableHref(GROUPS, "customers", "opportunities"), "/customers/opportunities");
  // An item with an empty path is the domain root, not "/inventory/".
  assert.equal(reachableHref(GROUPS, "inventory", "parts"), "/inventory");
});

test("an UNREACHABLE destination returns null, so no CTA is fabricated", () => {
  // The prior defect: a plausible-looking URL fell through to Dashboard and nothing failed. This
  // asks the same function the nav rail asks, so a door that is not open is not offered.
  assert.equal(reachableHref(GROUPS, "financials", "invoices"), null);
  assert.equal(reachableHref(GROUPS, "customers", "salesOrders"), null);
  assert.equal(reachableHref([], "customers", "opportunities"), null);
  assert.equal(reachableHref(null, "customers", "opportunities"), null);
});

// ── the component cannot render a count either ──────────────────────────────────────────────────

test("PreviewList has no code path that renders a row count", () => {
  // Structural, because the temptation is at the call site rather than in the data. If a tile ever
  // interpolates rows.length, this is where it gets caught.
  const src = readFileSync(new URL("../src/modules/dashboard/PreviewList.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/rows\.length/.test(src), "PreviewList reads rows.length");
  assert.ok(!/\{[^}]*\.length[^}]*\}/.test(src), "PreviewList interpolates a length into the output");
  assert.match(src, /More items available/, "the only permitted statement about what is not shown");
});

test("the dashboard never renders a count from any preview", () => {
  const src = readFileSync(new URL("../src/modules/dashboard/MyDashboard.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/previews\.\w+\.rows\.length/.test(src), "a preview's row count reaches the screen");
});

test("opportunities are read through the GOVERNED source, never the synthetic default", () => {
  // useOpportunities() with no argument resolves to syntheticOpportunitySource -- sample rows on a
  // real person's dashboard. This is the assertion that keeps the explicit argument in place.
  // COMMENTS STRIPPED FIRST. The file explains this hazard in prose that necessarily contains the
  // very call it forbids, and a guard that matches its own documentation is a guard that gets
  // deleted the first time it fires.
  const src = readFileSync(new URL("../src/modules/dashboard/MyDashboard.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // Two-armed now: the governed source when the module resolves, an INERT one when it does not, so
  // a principal without opportunity.read stops issuing a read the server refuses. Neither arm may
  // be the synthetic default, which is what this guard is actually about.
  assert.ok(src.includes(`moduleKeys.has("myOpportunities") ? governedOpportunitySource : INERT_OPPORTUNITY_SOURCE`), "the governed arm is gone");
  // The coordinated read needs the SAME gate, and had none: a principal without
  // fulfillment.coordinatedVisit.read called listCoordinatedOperations on every dashboard load and
  // took a 403. The preview already discarded the result, so the call bought nothing but an error.
  assert.ok(src.includes(`moduleKeys.has("ordersRequiringAction") ? undefined : INERT_COORDINATED_SOURCE`), "the coordinated read is ungated again");
  assert.ok(!src.includes("useCoordinatedOperations()"), "an unqualified coordinated call fetches for everyone");
  assert.ok(src.includes("const INERT_OPPORTUNITY_SOURCE = () => ({ status: \"unavailable\""), "the inert source is gone");
  assert.ok(!/synthetic[A-Za-z]*Source/.test(src), "a synthetic source reached the dashboard");
  assert.ok(!/useOpportunities\(\s*\)/.test(src), "an unqualified call would resolve to the synthetic source");
  // ...and synthetic rows are refused even if a source ever hands them over.
  assert.match(src, /!opportunityFeed\.synthetic/);
  assert.match(src, /!coordinated\.synthetic/);
});
