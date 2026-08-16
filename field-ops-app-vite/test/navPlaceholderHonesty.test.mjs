// Sandbox production-fidelity -- normal navigation must not present an unbuilt destination as usable
// product. Every normal nav destination must be REAL or HIDDEN; "clickable placeholder because we may
// build it later" is not an acceptable staging experience.
//
// The discriminator used here is deliberately structural rather than a hand-maintained list: a
// destination that carries `placeholderExplanation` is, by the repo's own convention, a stub that
// explains why it has no content. Any such entry still visible in normal navigation is the defect.
//
// This does NOT assert that hidden routes are unreachable. Direct routes are deliberately preserved
// for development, and PlaceholderPage is honest about being unbuilt when reached that way. The
// property under test is only what NORMAL navigation offers.
import assert from "node:assert/strict";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("navPlaceholderHonesty.test.mjs");

// Flatten every leaf destination with the domain it belongs to.
function destinations() {
  const out = [];
  for (const domain of NAV_DOMAINS) {
    if (Array.isArray(domain.subnav) && domain.subnav.length > 0) {
      for (const item of domain.subnav) out.push({ domain: domain.key, ...item });
    } else {
      out.push({ domain: domain.key, ...domain });
    }
  }
  return out;
}

const visible = () => destinations().filter((d) => d.navHidden !== true);

check("no destination carrying a placeholderExplanation is visible in normal navigation", () => {
  const offenders = visible()
    .filter((d) => typeof d.placeholderExplanation === "string" && d.placeholderExplanation.length > 0)
    .map((d) => `${d.domain}/${d.key}`);
  assert.deepEqual(offenders, [], `placeholder destinations still visible: ${offenders.join(", ")}`);
});

check("no `future` top-level domain is visible in normal navigation", () => {
  // A future domain has no landing of its own; showing it presents intent as product.
  const offenders = NAV_DOMAINS.filter((d) => d.future === true && d.navHidden !== true).map((d) => d.key);
  assert.deepEqual(offenders, [], `future domains still visible: ${offenders.join(", ")}`);
});

check("the specific destinations audited as having no real route are hidden", () => {
  // Each of these was verified against App.jsx as having NO explicit route -- they all fall through
  // to the generic PlaceholderPage. Listed explicitly so that making one REAL is a deliberate act
  // (delete it from this list) rather than something that silently regresses.
  const mustBeHidden = [
    "warranty",        // no warranty authority exists; only an equipment date FIELD
    "quotes",          // no governed RFQ / supplier-quote authority exists
    "demandPlanning",  // buildable from existing signals, but not built
    "notifications",   // notification HISTORY is unbuilt (the bell is the real surface)
    "vehicles", "regions", "companySettings", "integrations",
  ];
  const byKey = new Map(destinations().map((d) => [d.key, d]));
  for (const key of mustBeHidden) {
    const entry = byKey.get(key);
    assert.ok(entry, `expected nav entry '${key}' to exist`);
    assert.equal(entry.navHidden, true, `'${key}' must be hidden from normal navigation`);
  }
});

check("the REAL reporting surfaces are NOT hidden", () => {
  // Report Builder and Saved Reports are genuinely built and capability-gated. Hiding them would be
  // the opposite failure -- removing real product.
  const byKey = new Map(destinations().map((d) => [d.key, d]));
  for (const key of ["builder", "savedReports"]) {
    const entry = byKey.get(key);
    assert.ok(entry, `expected reporting entry '${key}'`);
    assert.notEqual(entry.navHidden, true, `'${key}' is real and must stay visible`);
  }
});

check("real index destinations were not hidden by mistake", () => {
  // Regression: an over-broad edit hid the CRM/Sales and Administration index routes (both `path: ""`)
  // because their keys collided with placeholder keys in the Reporting domain. Both are real.
  const crmIndex = destinations().find((d) => d.domain === "customers" && d.key === "customers");
  assert.ok(crmIndex, "CRM/Sales index destination missing");
  assert.notEqual(crmIndex.navHidden, true, "the CRM/Sales index route is real and must stay visible");

  const adminEmployees = destinations().find((d) => d.domain === "administration" && d.key === "employees");
  assert.ok(adminEmployees, "Administration employees destination missing");
  assert.notEqual(adminEmployees.navHidden, true, "Administration > Employees is real and must stay visible");
});

console.log(`\n${passed} passed, 0 failed`);
