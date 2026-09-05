// A nav item's screen comes from renderSubnavItem, not from a second <Route>.
//
// THE BUG THIS PINS. Sales Orders shipped with a working list page, a nav entry, green
// typecheck, 188 passing suites, 1229 vitest tests and a clean production build -- and the
// deployed page said "This area isn't built yet."
//
// App.jsx generates one route per VISIBLE subnav item and renders whatever
// renderSubnavItem returns for it. An item with no explicit branch and no legacyKey falls
// through to PlaceholderPage. The list page had been wired as a SEPARATE <Route> at the
// same path instead, which never won: the generic loop is emitted first, React Router
// matched it, and the placeholder rendered over a screen that was fully built.
//
// Nothing in the existing suites could catch that, because none of them render the route
// table the way a browser resolves it. This test does not render either -- it asserts the
// two conditions that made the mismatch possible, both readable from source:
//
//   1. No <Route path="X"> duplicates a subnav item's path inside that item's own domain.
//      A duplicate is dead code at best and a silent override at worst.
//   2. An item that has a real screen is dispatched by renderSubnavItem.
//
// Run: node --test test/subnavRouteDispatch.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/App.jsx"), "utf8");

// Every explicit <Route path="..."> written by hand in App.jsx -- EXCEPT the ones that redirect.
//
// A <Route element={<Navigate .../>}> cannot cause the failure this file pins. That failure is a
// hand-written route SHADOWING a subnav item, so a placeholder renders over a built screen; a
// redirect renders no screen at all, and exists precisely to keep a RETIRED path working.
//
// The ADMINISTRATION USERS CONSOLIDATION is what surfaced the gap: it redirects
// /administration/employees, Administration has no employees item any more -- but REPORTING has one
// whose path is also "employees", and this comparison is path-only rather than domain-scoped
// (despite what the header says), so the retired-path redirect read as a collision with a different
// domain entirely. Excluding redirects keeps the check pointed at the thing that actually broke.
const explicitRoutePaths = [...APP.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z]+)/g)]
  .filter((m) => m[2] !== "Navigate")
  .map((m) => m[1]);

test("no hand-written <Route> duplicates a subnav item's path -- the generic loop emits that route already", () => {
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.subnav ?? []) {
      if (!item.path) continue; // the index item is emitted with `index`, not a path
      const duplicates = explicitRoutePaths.filter((p) => p === item.path);
      assert.equal(
        duplicates.length,
        0,
        `${domain.key} > ${item.key}: App.jsx declares <Route path="${item.path}"> while the subnav ` +
          "loop already emits a route for that item. The loop's route is emitted first and wins, so " +
          "the hand-written one is dead — this is how Sales Orders shipped rendering PlaceholderPage " +
          "over a completed screen. Dispatch the item in renderSubnavItem instead.",
      );
    }
  }
});

// Items that MUST resolve to a real screen. Deliberately a stated list rather than a
// derived one: "has a branch" is what the test checks, so deriving the expectation from
// the same source would make it assert nothing. Adding a screen here is a decision.
const MUST_DISPATCH = [
  { domain: "customers", item: "customers" },
  { domain: "customers", item: "opportunities" },
  { domain: "customers", item: "salesOrders" },
];

test("every item with a built screen is dispatched by renderSubnavItem, not left to PlaceholderPage", () => {
  for (const { domain, item } of MUST_DISPATCH) {
    const branch = new RegExp(
      `domain\\.key === "${domain}"\\s*&&\\s*item\\.key === "${item}"`,
    );
    assert.ok(
      branch.test(APP),
      `${domain} > ${item} has a built screen but renderSubnavItem has no branch for it, so it ` +
        "falls through to PlaceholderPage and the deployed page claims the area isn't built yet.",
    );
  }
});

test("the MUST_DISPATCH list only names items that actually exist in the nav", () => {
  // A stale entry here would assert against a screen nobody can reach, and would keep
  // passing forever while protecting nothing.
  for (const { domain, item } of MUST_DISPATCH) {
    const d = NAV_DOMAINS.find((x) => x.key === domain);
    assert.ok(d, `MUST_DISPATCH names domain "${domain}", which is not in NAV_DOMAINS`);
    assert.ok(
      (d.subnav ?? []).some((i) => i.key === item),
      `MUST_DISPATCH names ${domain} > ${item}, which is not a subnav item any more`,
    );
  }
});
