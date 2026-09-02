// FINANCIALS NORTH STAR P1 — surface vocabulary + page-level source contracts (Wave UX-1).
//
// Two jobs:
//   1. Pin the pure surface vocabulary (domain/financialsSurface.js): slot order, one aging
//      grammar, governed company keys, and the read-state mapping every page renders through.
//   2. Enforce the family's page-level contracts AT THE SOURCE LEVEL for every file under
//      src/modules/financials/: no specimen fixture numbers as runtime fallbacks, no raw
//      Firestore reads, no client-side money arithmetic primitives.
//
// Run: node --test test/financialsSurface.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  LIFECYCLE_SCORECARD_SLOTS,
  AR_AGING_BUCKETS,
  COMPANY_FILTER_OPTIONS,
  BUSINESS_UNIT_FILTER_OPTIONS,
  FACT_CLASS,
  financialsReadHonestState,
  unwiredReadHonestState,
  READ_STATE_DETAIL,
} from "../src/domain/financialsSurface.js";
import { OPERATING_COMPANY_IDS } from "../src/domain/operatingCompanyAuthority.js";

const MODULE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/modules/financials");
const SRC_DIR = path.join(MODULE_DIR, "../..");

const relativeLuminance = (hex) => {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (first, second) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

test("lifecycle scorecard: six slots, lifecycle order, Unbilled is the one derived figure", () => {
  assert.deepEqual(
    LIFECYCLE_SCORECARD_SLOTS.map((s) => s.key),
    ["booked", "billable", "billed", "collected", "arOutstanding", "unbilled"],
  );
  for (const slot of LIFECYCLE_SCORECARD_SLOTS) {
    if (slot.key === "unbilled") {
      assert.equal(slot.factClass, FACT_CLASS.DERIVED);
      assert.equal(slot.derivation, "booked − billed");
    } else {
      assert.equal(slot.factClass, FACT_CLASS.OPERATIONAL_ACTUAL, `${slot.key} is an operational actual`);
      assert.equal(slot.derivation, undefined);
    }
  }
});

test("one canonical aging grammar — 61+ terminal bucket, no divergent 60+/90+ labels", () => {
  assert.deepEqual(
    AR_AGING_BUCKETS.map((b) => b.label),
    ["Total A/R", "Current", "1–30 days", "31–60 days", "61+ days"],
  );
});

test("company filter keys are the governed operating-company ids plus consolidated", () => {
  assert.deepEqual(
    COMPANY_FILTER_OPTIONS.map((o) => o.key),
    ["consolidated", OPERATING_COMPANY_IDS.TAYLOR, OPERATING_COMPANY_IDS.VENTANA],
  );
});

test("business-unit filter keys mirror the canonical BUSINESS_UNITS tokens", () => {
  assert.deepEqual(
    BUSINESS_UNIT_FILTER_OPTIONS.map((o) => o.key),
    ["all", "SERVICE", "EQUIPMENT_SALES", "PARTS", "INSTALLATION"],
  );
});

test("read-state mapping: loading, denied, unavailable, unactivated and ready are five different facts", () => {
  assert.equal(financialsReadHonestState({ loading: true }).state, "LOADING");
  assert.equal(financialsReadHonestState({ loading: false, errorStatus: "denied" }).state, "DENIED");
  assert.equal(financialsReadHonestState({ loading: false, errorStatus: "unavailable" }).state, "UNAVAILABLE");
  const inactive = financialsReadHonestState({ loading: false, errorStatus: null, result: null });
  assert.equal(inactive.state, "NOT_ENABLED");
  assert.equal(inactive.detail, READ_STATE_DETAIL.noReadOnSurface);
  const ready = financialsReadHonestState({ loading: false, errorStatus: null, result: { status: "ready" } });
  assert.equal(ready.state, null);
  assert.deepEqual(ready.result, { status: "ready" });
});

test("unwired fact families state that no read surface exists — not an error, not empty", () => {
  const honest = unwiredReadHonestState();
  assert.equal(honest.state, "NOT_ENABLED");
  assert.equal(honest.detail, READ_STATE_DETAIL.notWired);
});

// ─── Page-level source contracts ───

const sources = readdirSync(MODULE_DIR)
  .filter((f) => f.endsWith(".jsx") || f.endsWith(".js"))
  .map((f) => ({ file: f, text: readFileSync(path.join(MODULE_DIR, f), "utf8") }));

test("the financials module actually contains the Wave UX-1 pages", () => {
  const files = sources.map((s) => s.file);
  for (const expected of [
    "FinancialsOverview.jsx",
    "FinancialsInvoices.jsx",
    "FinancialsAccountsReceivable.jsx",
    "FinancialsPayments.jsx",
    "FinancialsCustomerFinancials.jsx",
    "FinancialsPrimitives.jsx",
  ]) {
    assert.ok(files.includes(expected), `${expected} must exist`);
  }
});

test("no specimen fixture value from the design package appears in product code", () => {
  // The design's .dc.html files carry Certification World specimen figures. None may leak
  // into runtime as fallback truth — a dollar-digit literal in this module is a defect.
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /\$\d/, `${file} contains a hardcoded dollar amount`);
  }
});

test("no raw Firestore or Firebase import inside the financials module", () => {
  // Financial collections are deny-all to clients; every read goes through an existing
  // governed hook/service (useAccountSearch, useAccountAr → listAccountInvoiceAr).
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /from ["']firebase\//, `${file} imports firebase directly`);
    assert.doesNotMatch(text, /firebase\/firebase/, `${file} touches the firebase client directly`);
    assert.doesNotMatch(text, /\bcollection\(|\bgetDocs\(|\bonSnapshot\(/, `${file} issues a raw collection read`);
  }
});

test("no client-side money arithmetic — money is composed and formatted, never recalculated", () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /parseFloat|toFixed\(|Number\.EPSILON/, `${file} smells of float money arithmetic`);
  }
});

test("the family's honest-state sentences never claim an error, and never assert a capability's state", () => {
  assert.match(READ_STATE_DETAIL.noReadOnSurface, /Nothing failed/);
  assert.match(READ_STATE_DETAIL.notWired, /No governed read surface/);
  // THE DEFECT THESE PIN (Owner visual review, 2026-09-01). These sentences used to say
  // "finance.read is inactive" / "not activated in this environment" -- a claim the page
  // never resolved, and one that was FALSE in platform-sandbox, where the governed read
  // answers. A surface may say what IT does; it may not diagnose a capability.
  for (const [key, sentence] of Object.entries(READ_STATE_DETAIL)) {
    assert.doesNotMatch(sentence, /finance\.[a-zA-Z.]+/, `${key} names a capability id`);
    assert.doesNotMatch(
      sentence,
      /\b(not activated|inactive|is active)\b/i,
      `${key} asserts a capability's activation state`,
    );
  }
});

test("no Financials page asserts a capability's activation state in rendered copy", () => {
  // OWNER VISUAL REVIEW, 2026-09-01 (finding F1). Pages rendered sentences like
  // "finance.read is inactive", "finance.visibility.* inactive" and "no financial
  // visibility scope granted". Those are authority facts the page never resolved — and in
  // platform-sandbox they were FALSE: the governed read answers there, which the callable
  // only reaches when the fact-family gate AND a visibility scope both allow.
  //
  // The error ran conservative (it under-claimed reach, so nothing leaked), but a surface
  // stating an authority fact it has not resolved is the same defect class as one
  // inventing a number. A page may say what IT does; the server says what you may see.
  //
  // Comments are stripped first: the reasoning above must remain sayable in source.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const CLAIM = /(finance\.[a-zA-Z.*]+\s*(is\s+)?(inactive|not activated))|(\bno financial visibility scope granted\b)|(financial visibility is not activated)/i;
  for (const { file, text } of sources) {
    assert.doesNotMatch(
      stripComments(text),
      CLAIM,
      `${file} asserts a capability/visibility activation state in rendered copy`,
    );
  }
});

test("the high-contrast refresh is a Financials-only shell pilot over shared semantic tokens", () => {
  const shell = readFileSync(path.join(SRC_DIR, "navigation/AppShell.jsx"), "utf8");
  const css = readFileSync(path.join(SRC_DIR, "index.css"), "utf8");

  assert.match(
    shell,
    /activeDomainPath === "financials" \? " fo-main--financials-pilot" : ""/,
    "the shell must scope the pilot to the Financials domain",
  );

  const tokenRule = css.match(/\.fo-main--financials-pilot \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const declaration of [
    "--color-surface-page: #FFFFFF",
    "--color-surface-card: #FFFFFF",
    "--color-text-primary: #111111",
    "--color-text-secondary: #3F4542",
    "--color-text-muted: #626A66",
    "--color-brand-secondary: #005A3C",
    "--color-border: #87938D",
    "--color-border-strong: #5F6C66",
  ]) {
    assert.ok(tokenRule.includes(declaration), `pilot token missing: ${declaration}`);
  }

  for (const color of ["#111111", "#3F4542", "#626A66", "#005A3C"]) {
    assert.ok(contrastRatio(color, "#FFFFFF") >= 4.5, `${color} must pass WCAG AA for body text on white`);
  }
  assert.ok(
    contrastRatio("#87938D", "#FFFFFF") >= 3,
    "the normal pilot border must remain visible as a non-text boundary on white",
  );
  assert.ok(
    contrastRatio("#5F6C66", "#FFFFFF") >= 3,
    "the strong pilot border must remain visible as a non-text boundary on white",
  );

  // The Owner asked for a semantic step, with display headings left alone unless undersized.
  // These assertions pin the representative operational tiers instead of allowing a blind
  // global font-size bump or a handful of page-specific overrides.
  for (const rule of [
    ".fo-main--financials-pilot .ns-state { font-size: 16px",
    ".fo-main--financials-pilot .ns-table { font-size: 15px",
    ".fo-main--financials-pilot .ns-view { font-size: 15px",
    ".fo-main--financials-pilot .fo-filter-btn { font-size: 15px",
    ".fo-main--financials-pilot .fin-figure__value",
  ]) {
    assert.ok(css.includes(rule), `semantic pilot rule missing: ${rule}`);
  }
  assert.doesNotMatch(tokenRule, /--font-size-display-/, "the pilot must not inflate established display headings");
});
