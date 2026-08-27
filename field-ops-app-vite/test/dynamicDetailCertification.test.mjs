// THE CERTIFICATION GATE CAN SEE RECORD PAGES.
// Run: node --test test/dynamicDetailCertification.test.mjs
//
// ════════════════════ THE GAP THIS CLOSES ════════════════════
//
// certify.mjs sweeps .certification/routes.json — 54 NAV destinations. A record page has no URL
// until a record exists, so not one of them is in that file. The sweep reported ZERO raw-id
// findings across 270 visits while SalesOrderDetail was rendering a Firestore document id as
// visible content, which a targeted probe found in seconds.
//
// A clean sweep and a broken page looked identical from the outside. The browser sweep that closes
// it needs a deployed app and a signed-in persona, so it belongs to the post-deploy regression gate
// — and THIS file is what runs unconditionally in CI: it holds the harness itself to the contract,
// and mutation-proves the detector can still fail.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PROBE } from "../.claude/skills/run-field-ops-app-vite/probe.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const read = (...p) => readFileSync(path.join(app, ...p), "utf8");
const manifest = JSON.parse(read(".certification", "dynamicRoutes.json"));

// ═════════════════════════════════════════ the coverage contract

test("THE FIVE REQUIRED ENTITIES HAVE DYNAMIC DETAIL COVERAGE", () => {
  const keys = manifest.entities.map((e) => e.key);
  for (const required of ["account", "contact", "opportunity", "salesOrder", "workOrder"]) {
    assert.ok(keys.includes(required), `${required} detail must be certified`);
  }
  // The other governed record pages that resolve trivially from a list.
  for (const also of ["equipment", "part"]) assert.ok(keys.includes(also), `${also} detail should be covered too`);
});

test("NO RECORD IS REACHED BY A HARDCODED DOCUMENT ID", () => {
  // A pinned Firestore id would rot the first time the sandbox is reseeded, and would do it
  // silently — the sweep would pass on a page that no longer exists, or fail for a reason that has
  // nothing to do with the build. Every entity resolves through a governed LIST instead.
  const RAW_ID = /\b[A-Za-z0-9]{20}\b/;
  for (const e of manifest.entities) {
    assert.ok(e.listRoute?.startsWith("/"), `${e.key} must name a list route to resolve from`);
    assert.ok(e.rowSelector, `${e.key} must say how to reach a row`);
    assert.doesNotMatch(JSON.stringify(e), RAW_ID, `${e.key} must not pin a document id`);
  }
});

test("the Opportunity entity reaches CLOSED work, and now certifies the RECORD PAGE", () => {
  // The sandbox has 0 OPEN opportunities. Resolving from the default view would have found no row
  // and reported a fixture precondition failure forever — truthfully, but uselessly. That half is
  // unchanged.
  const opp = manifest.entities.find((e) => e.key === "opportunity");
  assert.match(opp.listRoute, /view=all/, "must open a view that includes closed opportunities");

  // INVERTED 2026-08-26. This asserted `navigates: false` with the reason "it is a master-detail
  // pane, not its own route" — true until the Opportunity got one. The consequence of leaving it
  // true was a Quick Gate that reported `RESOLVED opportunity /customers/opportunities?view=all`
  // and never opened the record page the release shipped: green on the workspace, blind on the
  // surface under test. That is the failure `.certification/dynamicRoutes.json`'s own header was
  // written about, one entity over.
  assert.equal(opp.navigates, true, "the record page has a route; certifying the pane is not coverage");
  const re = new RegExp(opp.expectRoutePattern);
  assert.ok(re.test("/customers/opportunities/opp_1"), "must accept a record page");
  assert.ok(!re.test("/customers/opportunities"), "must REFUSE the workspace — that was the defect");
  assert.ok(
    !re.test("/customers/opportunities/sales-order/so_1"),
    "must refuse the Sales Order route, which shares this prefix one segment deeper",
  );

  // RESOLUTION NO LONGER DEPENDS ON A PANE — updated 2026-08-27 (North Star P1v4, DECISIONS #135).
  //
  // This asserted `/fo-sales-detail__open-record/`: the WORKSPACE PANE's own "Open OPP-…" link,
  // chosen because the workspace auto-selected the first row on load, so the link was in the DOM
  // before any click. P1v4 retired that pane and its auto-selection deliberately, and the selector
  // went with it — the deployed gate then reported "no rows at /customers/opportunities?view=all"
  // against a list rendering fourteen. A harness assumption wearing a fixture failure's clothes.
  //
  // The row ANCHOR is the better anchor, not merely the working one: it is what a user clicks, it
  // is a real <a> to the record route, and it presumes no auto-selection behaviour. So this now
  // pins the class AND forbids the whole family of pane-shaped selectors, because the way this
  // breaks again is somebody reaching for a container that only exists when something is
  // pre-selected for them.
  assert.match(opp.rowSelector, /ns-row__ref/, "resolve through the row anchor a user would click");
  assert.doesNotMatch(
    opp.rowSelector,
    /fo-sales-detail|__open-record|aside|is-selected|\[aria-selected/,
    "must not depend on a pre-selected detail pane — that surface is retired",
  );
});

test("a NAVIGATING entity states the route it must land on", () => {
  // A row click that lands somewhere unexpected is a RESOLUTION FAILURE. Measuring whatever page
  // happened to load would certify the wrong screen and call it coverage.
  for (const e of manifest.entities.filter((x) => x.navigates)) {
    assert.ok(e.expectRoutePattern, `${e.key} must declare the route pattern it expects`);
    assert.doesNotThrow(() => new RegExp(e.expectRoutePattern), `${e.key}'s pattern must compile`);
  }
});

// ═════════════════════════════════════════ one detector, not two

test("BOTH SWEEPS RUN THE SAME DETECTOR", () => {
  // A copied probe would drift, and one sweep would start tolerating what the other rejects —
  // including the intentional tolerated classes, whose whole value is meaning the same thing
  // everywhere.
  const certify = read(".claude", "skills", "run-field-ops-app-vite", "certify.mjs");
  const dynamic = read(".claude", "skills", "run-field-ops-app-vite", "certifyDynamic.mjs");
  for (const [name, text] of [["certify.mjs", certify], ["certifyDynamic.mjs", dynamic]]) {
    assert.match(text, /import \{ PROBE \} from "\.\/probe\.mjs"/, `${name} must import the shared detector`);
    assert.doesNotMatch(text, /const PROBE = /, `${name} must not define its own`);
  }
});

test("the tolerated classes are preserved, and nothing else is", () => {
  const dynamic = read(".claude", "skills", "run-field-ops-app-vite", "certifyDynamic.mjs");
  assert.match(dynamic, /OFFSCREEN_IN_SCROLLER/);
  assert.match(dynamic, /TINY_TARGET_DESKTOP_SURFACE/);
  // TINY_TARGET (the real handheld violation) and RAW_ID must NOT be tolerated.
  const tolerated = dynamic.match(/const TOLERATED = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  assert.doesNotMatch(tolerated, /"RAW_ID"/, "a raw id can never be tolerated");
  assert.doesNotMatch(tolerated, /"TINY_TARGET"/, "the handheld touch floor can never be tolerated");
});

test("AN UNRESOLVABLE RECORD FAILS RATHER THAN SKIPPING", () => {
  // "No record to open" is exactly the state that hid the Opportunity defect. A gate that shrugs at
  // it certifies nothing.
  const dynamic = read(".claude", "skills", "run-field-ops-app-vite", "certifyDynamic.mjs");
  assert.match(dynamic, /FIXTURE_PRECONDITION/);
  assert.match(dynamic, /preconditionFailures\.length > 0[\s\S]{0,200}process\.exit\(1\)/);
});

// ═════════════════════════════════════════ MUTATION PROOF: the detector can still fail

/** The minimal DOM the probe reads, so it can be exercised without a browser. */
function fakeDocument(mainText) {
  const el = {
    innerText: mainText,
    querySelectorAll: () => [],
    offsetParent: {},
  };
  return {
    documentElement: { clientWidth: 1440, scrollWidth: 1440, clientHeight: 900 },
    querySelector: () => el,
    body: el,
  };
}
function runProbe(mainText) {
  const savedDoc = globalThis.document;
  const savedStyle = globalThis.getComputedStyle;
  globalThis.document = fakeDocument(mainText);
  globalThis.getComputedStyle = () => ({ overflowX: "visible", position: "static" });
  try {
    return PROBE(false);
  } finally {
    globalThis.document = savedDoc;
    globalThis.getComputedStyle = savedStyle;
  }
}

test("MUTATION PROOF: a fake raw document id on a detail page IS detected", () => {
  // The detector reported zero across 270 visits. Before trusting that number anywhere else, prove
  // it is capable of a non-zero one. This is the exact id observed live on SO-2026-000007.
  const found = runProbe("Service / Work Order lineage\nFkA7SbwObO2tkORMgpCl\nsome other content");
  const rawId = found.find((f) => f.kind === "RAW_ID");
  assert.ok(rawId, `the detector must catch an injected raw id; got ${JSON.stringify(found.map((f) => f.kind))}`);
  assert.equal(rawId.detail, "FkA7SbwObO2tkORMgpCl");
});

test("and it does NOT fire on the vocabulary this app exists to display", () => {
  // The counter-proof. An earlier version flagged "postPurchasingUpdate" — a capability id, the
  // subject matter of the Roles & Permissions screen — and telling somebody to delete the content
  // their page exists to show is worse than missing a defect.
  const clean = runProbe("Roles & Permissions\npostPurchasingUpdate\nWO-2026-000042\nPRT-1001\nSO-2026-000007");
  assert.equal(clean.find((f) => f.kind === "RAW_ID"), undefined, `false positive: ${JSON.stringify(clean)}`);
});

test("the page the fix produces is clean", () => {
  // What SalesOrderDetail renders now: a governed reference, or a truthful sentence.
  for (const text of [
    "Service / Work Order lineage\nWO-2026-000042",
    "Service / Work Order lineage\nWork order reference unavailable",
    "Service / Work Order lineage\nNo Work Orders linked yet.",
  ]) {
    assert.equal(runProbe(text).find((f) => f.kind === "RAW_ID"), undefined, `false positive on: ${text}`);
  }
});

// ═════════════════════════════════════════ it is actually wired into the gate

test("A SIGNED-OUT SWEEP MUST FAIL, NOT REPORT CLEAN", () => {
  // The worst result a harness can produce. Session establishment fails intermittently against the
  // deployed origin, and every goto then lands on the sign-in screen -- which has no tables, no raw
  // ids, no overflow and no crashes. A 54-route sweep reports "54/54 measured, 0 findings",
  // indistinguishable from a genuinely clean run.
  //
  // It happened during this certification: a RAW_ID sweep returned zero across every route while
  // /service/job-assignments was still rendering six document ids. The result was not slightly
  // wrong -- it was measuring a different application.
  const session = read(".claude", "skills", "run-field-ops-app-vite", "deployedSession.mjs");
  assert.match(session, /export async function assertSignedIn/);
  assert.match(session, /NOT SIGNED IN as/);
  assert.ok(session.includes("Sign in to continue"), "it must recognise the login screen by its own copy");
  assert.ok(session.includes("Work email"), "and by its field labels");
  // And every lane must inherit it, which means establishSession itself calls it.
  assert.ok(session.includes("await assertSignedIn(page, accountKey)"), "establishSession must call it");
});

test("THE GATE HARD-FAILS ON EVERY CRASH SIGNAL, not only the boundary text", () => {
  // The certification that missed a user-reproducible crash measured ROUTE LOADS. These are the
  // signals that catch the rest, and each one must be fatal.
  const stress = read(".claude", "skills", "run-field-ops-app-vite", "crashStress.mjs");
  for (const signal of ["pageerror", "unhandledrejection", "UI Crash:", "console.error", "Something went wrong"]) {
    assert.ok(stress.includes(signal), `${signal} must be a watched crash signal`);
  }
  // A crashing step must fail the process — a log line nobody reads is not a gate.
  assert.match(stress, /if \(failures > 0\) process\.exit\(1\)/);
  // And navigation succeeding must not count as a pass when the boundary rendered afterwards.
  assert.match(stress, /boundary \|\| bad\.length/);
});

test("THE STRESS LANE EXERCISES INTERACTIONS AND RACES, not route loads", () => {
  const stress = read(".claude", "skills", "run-field-ops-app-vite", "crashStress.mjs");
  for (const behaviour of [
    "navigate away instantly", "rapid switch", "view filters", "switch filter under it",
    "back/forward", "hard reload", "consecutive records", "open edit then cancel",
    "bounce between heavy lists", "mobile",
  ]) {
    assert.ok(stress.includes(behaviour), `the stress suite must cover: ${behaviour}`);
  }
  // The throttled pass is the point of the exercise — a race that needs latency to appear is
  // invisible without it.
  assert.match(stress, /emulateNetworkConditions/);
});

test("THE REGRESSION GATE RUNS THE CRASH STRESS, both passes", () => {
  const gate = readFileSync(path.join(app, "..", "scripts", "_sandboxRegressionGate.sh"), "utf8");
  assert.match(gate, /crashStress\.mjs" admin\s*\)/, "a normal pass");
  assert.match(gate, /crashStress\.mjs" admin slow\s*\)/, "and a throttled one");
});

test("THE REGRESSION GATE RUNS THE DYNAMIC SWEEP", () => {
  // A harness nothing invokes is documentation. The gate must fail if this step fails, which
  // `set -e` gives it.
  const gate = readFileSync(path.join(app, "..", "scripts", "_sandboxRegressionGate.sh"), "utf8");
  assert.match(gate, /certifyDynamic\.mjs/, "the gate must run the dynamic detail sweep");
  assert.match(gate, /set -euo pipefail/, "and must stop on its failure");
});
