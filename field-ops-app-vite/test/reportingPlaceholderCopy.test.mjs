import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

const reporting = NAV_DOMAINS.find((d) => d.key === "reporting");
const REAL = new Set(["builder", "savedReports"]);
const placeholders = reporting.subnav.filter((i) => !REAL.has(i.key));

test("the governed report builder and saved reports are real destinations, not placeholders", () => {
  for (const key of REAL) {
    assert.ok(reporting.subnav.some((i) => i.key === key), `${key} must exist`);
  }
});

test("every Reporting placeholder states the true situation, not \"isn't built yet\"", () => {
  assert.ok(placeholders.length > 0, "precondition: reporting has placeholder domains");
  for (const item of placeholders) {
    assert.ok(
      item.placeholderExplanation,
      `${item.key} must override the default copy — Reporting IS built, so the default sentence is false here`,
    );
    assert.doesNotMatch(item.placeholderExplanation, /isn't built yet/i);
    assert.match(item.placeholderExplanation, /report definitions/i, "must name what is actually missing");
    assert.match(item.placeholderExplanation, /Report Builder/, "must point at the capability that exists");
  }
});

test("the override reaches the rendered page, and the default survives for everyone else", () => {
  const src = fs.readFileSync(new URL("../src/navigation/PlaceholderPage.jsx", import.meta.url), "utf8");
  assert.match(src, /explanation \?\?/, "explanation must replace the default, not append to it");
  assert.match(src, /isn't built yet/, "the default must remain for genuinely unbuilt areas");

  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /explanation=\{item\.placeholderExplanation\}/, "the fallback must pass the override through");
});

test("domains that ARE genuinely unbuilt keep the honest default", () => {
  // Warranty and Demand Planning were classified as honest placeholders; they must
  // not be swept into this correction.
  const service = NAV_DOMAINS.find((d) => d.key === "service");
  const purchasing = NAV_DOMAINS.find((d) => d.key === "purchasing");
  const warranty = service?.subnav.find((i) => i.key === "warranty");
  const demand = purchasing?.subnav.find((i) => i.key === "demandPlanning");
  assert.ok(warranty && demand, "precondition: both destinations exist");
  assert.equal(warranty.placeholderExplanation, undefined);
  assert.equal(demand.placeholderExplanation, undefined);
});

test("the Notifications stub distinguishes itself from the working bell", () => {
  // Two destinations were named "Notifications" — one functional (the header bell,
  // which shows a live count), one an empty stub. A persona reported the pair as a
  // dead badge; the badge was real, the collision was the defect. The stub must point
  // at the working surface rather than implying notifications do not exist.
  const dashboard = NAV_DOMAINS.find((d) => d.key === "dashboard");
  const item = dashboard?.subnav.find((i) => i.key === "notifications");
  assert.ok(item, "the Notifications destination must still exist — this is not a removal");
  assert.ok(item.placeholderExplanation, "it must not claim the area simply isn't built");
  assert.match(item.placeholderExplanation, /bell/i, "must point at the surface that works today");
  assert.match(item.placeholderExplanation, /history/i, "must say what this destination is for");
});
