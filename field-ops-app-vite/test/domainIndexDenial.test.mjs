import assert from "node:assert/strict";
import test from "node:test";
import { NAV_DOMAINS, deniedDomainIndexItem, isNavItemVisible } from "../src/navigation/navConfig.js";

const inventory = NAV_DOMAINS.find((d) => d.key === "inventory");
const purchasing = NAV_DOMAINS.find((d) => d.key === "purchasing");

test("the domains three personas hit blank still have an index item", () => {
  for (const d of [inventory, purchasing]) {
    assert.ok(d, "domain must exist");
    assert.ok(d.subnav.some((i) => i.path === ""), `${d.key} must have an index item`);
  }
});

test("a role without the index item's legacy key gets a denial to render, not a blank page", () => {
  // The exact condition behind the reported blank pages: no legacy keys at all.
  const denied = deniedDomainIndexItem(inventory, "technician", [], undefined);
  assert.ok(denied, "an unauthorized session must yield a denial item");
  assert.equal(denied.path, "");
  assert.ok(denied.label, "the denial must be able to name the screen");
});

test("an authorized session yields NO denial — the real screen still renders", () => {
  const indexItem = inventory.subnav.find((i) => i.path === "");
  const allowed = [indexItem.legacyKey];
  assert.ok(isNavItemVisible(indexItem, "admin", allowed, undefined), "precondition: item visible");
  assert.equal(deniedDomainIndexItem(inventory, "admin", allowed, undefined), null);
});

test("the helper grants nothing — it never contradicts isNavItemVisible", () => {
  for (const domain of NAV_DOMAINS) {
    const indexItem = (domain.subnav ?? []).find((i) => i.path === "");
    if (!indexItem) continue;
    for (const role of ["admin", "dispatcher", "technician", "unknown-role"]) {
      for (const keys of [[], [indexItem.legacyKey].filter(Boolean)]) {
        const visible = isNavItemVisible(indexItem, role, keys, undefined);
        const denied = deniedDomainIndexItem(domain, role, keys, undefined);
        assert.equal(
          denied === null,
          visible,
          `${domain.key}/${role}: denial must be the exact complement of visibility`,
        );
      }
    }
  }
});

test("a domain with no index item is left alone", () => {
  assert.equal(deniedDomainIndexItem({ subnav: [{ key: "x", path: "x" }] }, "technician", [], undefined), null);
});

test("malformed input never throws", () => {
  for (const d of [undefined, null, {}, { subnav: null }]) {
    assert.equal(deniedDomainIndexItem(d, "technician", [], undefined), null);
  }
});
