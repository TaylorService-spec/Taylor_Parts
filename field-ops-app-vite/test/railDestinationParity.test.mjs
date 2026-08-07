import test from "node:test";
import assert from "node:assert/strict";

import {
  NAV_DOMAINS,
  isDomainVisible,
  isNavItemVisible,
  buildServiceNavGroups,
} from "../src/navigation/navConfig.js";
import { ROLE_NAV_ACCESS } from "../src/domain/constants.js";

/**
 * Gate 2 replaced two horizontal navigation axes with one vertical rail. The
 * risk of that change is silent LOSS: a destination that the old shell rendered
 * and the rail does not. These tests reconstruct, for every role, the exact set
 * of destinations the OLD shell produced and assert the rail's model yields the
 * same set — so a regression shows up here rather than as a route a user can no
 * longer reach.
 *
 * Both models are pure functions of navConfig, which is why this is a unit test
 * rather than a browser check.
 */

const ROLES = Object.keys(ROLE_NAV_ACCESS);

// The OLD shell: for each visible domain, the flat filtered subnav (Service was
// grouped for DISPLAY only — the destination set was identical).
function legacyDestinations(role, allowedLegacyKeys, operationalContext) {
  const out = new Set();
  for (const domain of NAV_DOMAINS) {
    if (!isDomainVisible(domain, role, allowedLegacyKeys, operationalContext)) continue;
    if (domain.future) {
      out.add(`/${domain.path}`);
      continue;
    }
    for (const item of domain.subnav ?? []) {
      if (!isNavItemVisible(item, role, allowedLegacyKeys, operationalContext)) continue;
      out.add(`/${domain.path}${item.path ? `/${item.path}` : ""}`);
    }
  }
  return out;
}

// The RAIL: same visibility calls, then grouped/ungrouped exactly as AppRail
// renders them. A `future` domain has no children, so its row is the link.
function railDestinations(role, allowedLegacyKeys, operationalContext) {
  const out = new Set();
  for (const domain of NAV_DOMAINS) {
    if (!isDomainVisible(domain, role, allowedLegacyKeys, operationalContext)) continue;
    const visible = domain.future
      ? []
      : (domain.subnav ?? []).filter((i) => isNavItemVisible(i, role, allowedLegacyKeys, operationalContext));
    if (visible.length === 0) {
      out.add(`/${domain.path}`);
      continue;
    }
    const model = domain.key === "service"
      ? buildServiceNavGroups(visible)
      : { groups: [], ungrouped: visible };
    const emit = (item) => out.add(`/${domain.path}${item.path ? `/${item.path}` : ""}`);
    model.ungrouped.forEach(emit);
    model.groups.forEach((g) => g.items.forEach(emit));
  }
  return out;
}

for (const role of ROLES) {
  test(`rail preserves every destination for role '${role}'`, () => {
    const allowed = ROLE_NAV_ACCESS[role];
    const legacy = legacyDestinations(role, allowed, undefined);
    const rail = railDestinations(role, allowed, undefined);
    const missing = [...legacy].filter((d) => !rail.has(d));
    const added = [...rail].filter((d) => !legacy.has(d));
    assert.deepEqual(missing, [], `destinations lost by the rail: ${missing.join(", ")}`);
    assert.deepEqual(added, [], `destinations invented by the rail: ${added.join(", ")}`);
  });
}

test("Service's grouped model loses no destination", () => {
  const svc = NAV_DOMAINS.find((d) => d.key === "service");
  const all = svc.subnav;
  const { groups, ungrouped } = buildServiceNavGroups(all);
  const seen = new Set([...ungrouped, ...groups.flatMap((g) => g.items)].map((i) => i.key));
  assert.equal(seen.size, all.length, "every Service item appears exactly once");
  for (const item of all) assert.ok(seen.has(item.key), `missing ${item.key}`);
});

test("group labels never become destinations of their own", () => {
  const svc = NAV_DOMAINS.find((d) => d.key === "service");
  const { groups } = buildServiceNavGroups(svc.subnav);
  assert.ok(groups.length > 0);
  for (const g of groups) {
    // The landing is a real child, not a separate route the rail must render.
    assert.ok(g.items.some((i) => i.key === g.landing.key),
      `${g.key}'s landing must be one of its own children`);
  }
});
