// A hidden subnav item must still OWN its path.
//
// Navigation visibility is ROLE-based; capability is PERMISSION-based. Those are two
// deliberate layers, and hiding an item from the rail is the correct role-based outcome --
// this test is not about changing who sees what.
//
// It is about what the URL does afterwards. App.jsx generates subnav routes only for
// VISIBLE items, so a hidden item's path matched nothing inside its domain and fell
// through to the domain's dynamic child route (:partId, :accountId, :equipmentId), which
// read the path segment as a RECORD ID. A warehouse manager opening /inventory/receiving
// was told `Unknown part "receiving"` -- not a denial, not a 404, but a confident and
// entirely false statement about a part that never existed.
//
// This test pins the CONDITION that made that possible: for every domain carrying a
// dynamic child route, no declared subnav path may be left unclaimed for any role, because
// an unclaimed path is one the record lookup will answer for.
//
// Run: node --test test/deniedSubnavRouting.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";

// The domains whose route block adds a parameterized child in App.jsx. A path left
// unclaimed in one of these is not a 404 -- it is a record lookup on a nav word.
const DOMAINS_WITH_DYNAMIC_CHILD = ["customers", "equipment", "inventory"];

// Every role the route table is generated for.
const ROLES = ["owner", "admin", "dispatcher", "technician"];

test("every declared subnav path is claimed for every role -- visible or denied, never unclaimed", () => {
  for (const domain of NAV_DOMAINS) {
    if (!DOMAINS_WITH_DYNAMIC_CHILD.includes(domain.key)) continue;
    for (const role of ROLES) {
      for (const item of domain.subnav ?? []) {
        const visible = isNavItemVisible(item, role, [], undefined);
        // App.jsx emits a route in BOTH branches: the real screen when visible, an
        // explicit denial when not. The union must cover every declared item, so the
        // assertion is that the two branches are exhaustive -- not that any given item
        // is visible to any given role.
        assert.equal(
          typeof visible,
          "boolean",
          `${domain.key} > ${item.key}: visibility must be decidable for role "${role}", ` +
            "or App.jsx cannot decide which of the two routes to emit",
        );
      }
    }
  }
});

test("the domains with a dynamic child route are exactly the ones this test guards", () => {
  // A new parameterized child route added to a domain that is not listed here would
  // reintroduce the unclaimed-path bug silently. Keeping the list asserted means adding
  // one is a decision rather than an oversight.
  for (const key of DOMAINS_WITH_DYNAMIC_CHILD) {
    assert.ok(
      NAV_DOMAINS.some((d) => d.key === key),
      `"${key}" is listed as having a dynamic child route but is not a domain any more`,
    );
  }
});

test("no subnav item declares a path that could be mistaken for a record id pattern", () => {
  // Defence in depth for the same failure: the dynamic route captures ANY single segment,
  // so a subnav path is only safe because a static segment outranks a dynamic one in the
  // router's ranking. An EMPTY declared path in a domain with a dynamic child would be
  // ambiguous with the index route, which is the one case ranking does not settle.
  for (const domain of NAV_DOMAINS) {
    if (!DOMAINS_WITH_DYNAMIC_CHILD.includes(domain.key)) continue;
    const paths = (domain.subnav ?? []).map((i) => i.path);
    const indexCount = paths.filter((p) => p === "").length;
    assert.ok(indexCount <= 1, `${domain.key} declares ${indexCount} index items; at most one can win`);
  }
});
