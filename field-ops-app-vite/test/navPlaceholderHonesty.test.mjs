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

// FINANCIALS FRAME 0 EXEMPTION (Owner-approved). The Financials domain is the deliberate,
// governed exception to the visible-placeholder rule: its twenty sections are the APPROVED
// information architecture, made addressable so FIN-001+ can progressively compose governed
// authority into them (docs/financials/FINANCIALS_AUTHORITY_AND_REPORTING_BASELINE.md).
// Each placeholder's copy states plainly that no financial authority exists yet — the
// honesty this file protects is preserved in the copy rather than by hiding the section
// (financialsNavStructure.test.mjs asserts that copy never claims authority exists).
// Every OTHER domain remains bound by the rule.
check("no destination carrying a placeholderExplanation is visible in normal navigation (Financials Frame 0 excepted)", () => {
  const offenders = visible()
    .filter((d) => d.domain !== "financials")
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
    "vehicles", "regions", "companySettings",
    // "integrations" was REMOVED from this list deliberately, which is the act this
    // comment block asks for. It is no longer a placeholder: App.jsx routes
    // administration/integrations explicitly to IntegrationsFaq (a real, static
    // informational screen), so it does NOT fall through to PlaceholderPage and
    // hiding it made a built screen unreachable from the rail.
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

  // ADMINISTRATION USERS CONSOLIDATION (2026-09-04): the destination this checked is now called
  // Users and lives at its own named path. The regression it guards against is unchanged -- an
  // over-broad edit hiding a REAL people destination because a key collided with a Reporting
  // placeholder (Reporting still carries a navHidden "employees" key, which is exactly why this
  // check exists and why it now names the surviving destination explicitly).
  const adminUsers = destinations().find((d) => d.domain === "administration" && d.key === "users");
  assert.ok(adminUsers, "Administration users destination missing");
  assert.notEqual(adminUsers.navHidden, true, "Administration > Users is real and must stay visible");
  assert.equal(
    destinations().some((d) => d.domain === "administration" && d.key === "employees"),
    false,
    "Administration must expose ONE people destination, not two",
  );
});

console.log(`\n${passed} passed, 0 failed`);
