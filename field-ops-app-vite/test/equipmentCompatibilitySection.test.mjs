// D6 — deterministic OFFLINE tests for the "Used In Equipment" pure view-model, the capability read-gate
// / zero-read behavior, sanitization, pagination + later-page degradation, no-fallback, and the exact
// capability prop path (source-scanned, house convention). No Firebase, no DOM, no network: rendering is
// proven separately by the browser gate. Fixtures are plain objects.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VIEW_CAPABILITY,
  SECTION_STATES,
  canViewCompatibility,
  shouldAttemptRead,
  loadCompatibilityPage,
  buildCompatibilitySectionPage,
  accumulateCompatibilityPages,
  isWholeQueryComplete,
} from "../src/domain/equipmentCompatibilitySection.js";
import { inertEquipmentCompatibilitySource } from "../src/services/equipmentCompatibilitySource.js";

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok - ${name}`); };
const acheck = async (name, fn) => { await fn(); passed += 1; console.log(`  ok - ${name}`); };
console.log("equipmentCompatibilitySection.test.mjs");

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const grant = () => true; // hasCapability that grants the view capability

// ---- fixtures ----
const model = (o = {}) => ({ manufacturerName: "Taylor", modelNumber: "C713", displayName: "Taylor C713", family: null, subtype: null, ...o });
const ev = (o = {}) => ({ status: "OK", windowComplete: true, strongestSupportingAuthority: "MANUFACTURER", boundedSupportsCount: 2, boundedContradictsCount: 0, windowSize: 2, ...o });
const item = (o = {}) => ({
  compatibilityId: "cmp_" + "a".repeat(64), equipmentModelId: "TAYLOR--C713", partId: "TST-1001",
  model: model(), compatibilityType: "DIRECT_FIT", assembly: null, installationPosition: null, quantityRequired: 1,
  serialApplicabilitySummary: "Applies to all serial numbers", verificationStatus: "VERIFIED",
  applicabilityResolved: true, confidenceLevel: "HIGH", operational: true, evidence: ev(), ...o,
});
const resp = (o = {}) => ({ pageDisposition: "AVAILABLE", items: [item()], nextCursor: null, windowCounts: { returned: 1, operational: 1, excludedRejected: 0, malformedOmitted: 0, evidenceIncomplete: 0 }, ...o });
const okResult = (response) => ({ ok: true, response });

// ============================ A. capability gate + ZERO reads ============================
check("canViewCompatibility is true ONLY for an exact hasCapability(view)===true", () => {
  assert.equal(canViewCompatibility((c) => c === VIEW_CAPABILITY), true);
  // every fail-closed input
  assert.equal(canViewCompatibility(undefined), false);
  assert.equal(canViewCompatibility(null), false);
  assert.equal(canViewCompatibility(42), false);
  assert.equal(canViewCompatibility({}), false);
  assert.equal(canViewCompatibility(() => { throw new Error("boom"); }), false);
  assert.equal(canViewCompatibility(() => false), false);
  assert.equal(canViewCompatibility(() => "true"), false); // truthy but not === true
  assert.equal(canViewCompatibility((c) => c === "report.view"), false); // true for another id
});

await acheck("loadCompatibilityPage attempts ZERO reads for every fail-closed capability / missing part", async () => {
  const cases = [
    ["missing", undefined, "TST-1001"], ["null", null, "TST-1001"], ["non-function", 7, "TST-1001"],
    ["throwing", () => { throw new Error("x"); }, "TST-1001"], ["false", () => false, "TST-1001"],
    ["wrong-id-true", (c) => c === "other", "TST-1001"], ["granted-but-no-part", grant, ""], ["granted-null-part", grant, null],
  ];
  for (const [label, hasCapability, partId] of cases) {
    let calls = 0;
    const spy = { readForPart: async () => { calls += 1; return okResult(resp()); } };
    assert.equal(shouldAttemptRead(hasCapability, partId), false, `${label}: gate closed`);
    const r = await loadCompatibilityPage(spy, { hasCapability, partId, cursor: null, limit: 10 });
    assert.equal(r.skipped, true, `${label}: skipped`);
    assert.equal(calls, 0, `${label}: ZERO reads`);
  }
});

await acheck("loadCompatibilityPage reads EXACTLY once when granted + a part is selected, threading cursor/limit", async () => {
  let seen = null, calls = 0;
  const spy = { readForPart: async (input) => { calls += 1; seen = input; return okResult(resp()); } };
  const r = await loadCompatibilityPage(spy, { hasCapability: grant, partId: "TST-1001", cursor: "CUR", limit: 10 });
  assert.equal(calls, 1);
  assert.deepEqual(seen, { partId: "TST-1001", cursor: "CUR", limit: 10 });
  assert.equal(r.skipped, false);
  assert.equal(r.page.state, SECTION_STATES.AVAILABLE);
});

await acheck("a throwing/rejecting source is a fail-closed UNAVAILABLE (never a crash, never a skip)", async () => {
  const boom = { readForPart: async () => { throw new Error("network"); } };
  const r = await loadCompatibilityPage(boom, { hasCapability: grant, partId: "TST-1001", limit: 10 });
  assert.equal(r.skipped, false);
  assert.equal(r.page.state, SECTION_STATES.UNAVAILABLE);
});

// ============================ B. disposition mapping ============================
check("source result → state: LOADING / DENIED / UNAVAILABLE / EMPTY", () => {
  assert.equal(buildCompatibilitySectionPage(null).state, SECTION_STATES.LOADING);
  assert.equal(buildCompatibilitySectionPage({ ok: false, code: "permission-denied" }).state, SECTION_STATES.DENIED);
  assert.equal(buildCompatibilitySectionPage({ ok: false, code: "unavailable" }).state, SECTION_STATES.UNAVAILABLE);
  assert.equal(buildCompatibilitySectionPage(42).state, SECTION_STATES.UNAVAILABLE);
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ pageDisposition: "EMPTY", items: [] }))).state, SECTION_STATES.EMPTY);
});
check("response disposition maps; unknown disposition and malformed response fail closed to UNAVAILABLE", () => {
  assert.equal(buildCompatibilitySectionPage(okResult(resp())).state, SECTION_STATES.AVAILABLE);
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ pageDisposition: "DEGRADED" }))).state, SECTION_STATES.DEGRADED);
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ pageDisposition: "WEIRD" }))).state, SECTION_STATES.UNAVAILABLE);
  assert.equal(buildCompatibilitySectionPage(okResult({ pageDisposition: "AVAILABLE" })).state, SECTION_STATES.UNAVAILABLE); // no items array
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ pageDisposition: "DENIED", items: [] }))).state, SECTION_STATES.DENIED);
});
check("operational ONLY for VERIFIED + applicabilityResolved + model + OK evidence; else non-operational with reasons", () => {
  const one = (o) => buildCompatibilitySectionPage(okResult(resp({ items: [item(o)] }))).items[0];
  assert.equal(one({}).operational, true);
  assert.equal(one({ verificationStatus: "CONFLICT", operational: false }).operational, false);
  assert.ok(one({ verificationStatus: "CONFLICT", operational: false }).reasons.includes("conflict"));
  assert.equal(one({ verificationStatus: "IN_REVIEW", operational: false }).operational, false);
  assert.equal(one({ applicabilityResolved: false, operational: false }).operational, false);
  assert.ok(one({ applicabilityResolved: false, operational: false }).reasons.includes("applicability-unresolved"));
  assert.equal(one({ model: null, operational: false }).operational, false);
  assert.ok(one({ model: null, operational: false }).reasons.includes("model-unavailable"));
  assert.equal(one({ evidence: ev({ status: "INCOMPLETE", windowComplete: false }), operational: false }).evidence.complete, false);
  assert.equal(one({ evidence: ev({ status: "INCOMPLETE", windowComplete: false }), operational: false }).operational, false);
  assert.ok(one({ evidence: ev({ status: "INCOMPLETE", windowComplete: false }), operational: false }).reasons.includes("evidence-incomplete"));
  // defence in depth: even a lying operational:true is re-guarded to false when preconditions fail
  assert.equal(one({ verificationStatus: "CONFLICT", operational: true }).operational, false);
});
check("nextCursor drives hasMore", () => {
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ nextCursor: "C" }))).hasMore, true);
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ nextCursor: "C" }))).nextCursor, "C");
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ nextCursor: null }))).hasMore, false);
  assert.equal(buildCompatibilitySectionPage(okResult(resp({ nextCursor: "" }))).hasMore, false);
});

// ============================ C. sanitization / no-leak ============================
check("the projected view NEVER carries ids or raw provenance/serials/notes/fingerprints", () => {
  const hostile = item({
    // forbidden fields a hostile/extended response might carry:
    sourceReference: "Service Manual SECRET", capturedBy: "admin-secret-uid", contentFingerprint: "f".repeat(64),
    notes: "internal note", uniquenessKey: "UNIQ", rawSerials: ["SN123", "SN456"],
    model: { ...model(), sourceReference: "x", capturedBy: "y" },
    evidence: { ...ev(), sourceReference: "z", capturedBy: "w", contentFingerprint: "d".repeat(64) },
  });
  const view = buildCompatibilitySectionPage(okResult(resp({ items: [hostile] })));
  const blob = JSON.stringify(view);
  for (const forbidden of [
    "Service Manual SECRET", "admin-secret-uid", "internal note", "UNIQ", "SN123", "SN456",
    "f".repeat(64), "d".repeat(64), "sourceReference", "capturedBy", "contentFingerprint", "notes", "uniquenessKey",
    "cmp_" + "a".repeat(64), "TAYLOR--C713", "compatibilityId", "equipmentModelId",
  ]) {
    assert.equal(blob.includes(forbidden), false, `must not leak ${forbidden}`);
  }
  // it DOES carry the allowlisted display fields
  assert.equal(view.items[0].model.displayName, "Taylor C713");
  assert.equal(view.items[0].evidence.strongestSupportingAuthority, "MANUFACTURER");
});

// ============================ D. pagination + later-page degradation ============================
check("first page AVAILABLE+hasMore is incomplete; a later DEGRADED page makes the whole section DEGRADED (sticky)", () => {
  const p1 = buildCompatibilitySectionPage(okResult(resp({ items: [item({ assembly: "A" })], nextCursor: "C1" })));
  const a1 = accumulateCompatibilityPages(null, p1);
  assert.equal(a1.state, SECTION_STATES.AVAILABLE);
  assert.equal(a1.hasMore, true);
  assert.equal(isWholeQueryComplete(a1), false, "hasMore ⇒ NOT complete");
  const p2 = buildCompatibilitySectionPage(okResult(resp({ pageDisposition: "DEGRADED", items: [item({ assembly: "B", operational: false, verificationStatus: "CONFLICT" })], nextCursor: null })));
  const a2 = accumulateCompatibilityPages(a1, p2);
  assert.equal(a2.state, SECTION_STATES.DEGRADED, "later degradation is sticky, never upgraded");
  assert.equal(a2.items.length, 2, "items appended, none discarded");
  assert.equal(isWholeQueryComplete(a2), true, "no next page now");
});
check("a failed 'load more' keeps prior items + surfaces loadMoreError, never discards, never claims complete", () => {
  const a1 = accumulateCompatibilityPages(null, buildCompatibilitySectionPage(okResult(resp({ nextCursor: "C1" }))));
  const a2 = accumulateCompatibilityPages(a1, buildCompatibilitySectionPage({ ok: false, code: "unavailable" }));
  assert.equal(a2.items.length, 1, "prior items kept");
  assert.equal(a2.loadMoreError, SECTION_STATES.UNAVAILABLE);
  assert.equal(a2.hasMore, true, "still retryable");
  assert.equal(isWholeQueryComplete(a2), false, "a load-more error is never 'complete'");
});
check("isWholeQueryComplete only when no next page and no load-more error", () => {
  const done = accumulateCompatibilityPages(null, buildCompatibilitySectionPage(okResult(resp({ nextCursor: null }))));
  assert.equal(isWholeQueryComplete(done), true);
});

// ============================ E. no-fallback (source scan) ============================
check("the view-model imports NOTHING and references no fallback data source", () => {
  const src = fs.readFileSync(rel("src/domain/equipmentCompatibilitySection.js"), "utf8");
  assert.equal(/^\s*import\s/m.test(src), false, "the view-model must import nothing");
  // Scan CODE only (strip comments) — the header legitimately NAMES the forbidden fallbacks to say it
  // uses none of them; the ban is on actual references.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [/partsCatalog/i, /staticCatalog/i, /partMaster/i, /workOrder/i, /reseller/i, /freeText/i, /firebase/i, /getDocs/i]) {
    assert.equal(forbidden.test(code), false, `no fallback reference in code: ${forbidden}`);
  }
});

// ============================ F. capability prop path (source scan) ============================
check("App → PartDetail passes hasCapability; PartDetail → UsedInEquipmentSection passes it through unchanged", () => {
  const app = fs.readFileSync(rel("src/App.jsx"), "utf8");
  assert.ok(/<PartDetail\s+hasCapability=\{operationalContext\?\.hasCapability\}\s*\/>/.test(app), "App mounts PartDetail with the hasCapability prop");
  const pd = fs.readFileSync(rel("src/modules/inventory/PartDetail.jsx"), "utf8");
  assert.ok(/function PartDetail\(\{\s*hasCapability\b/.test(pd), "PartDetail accepts the hasCapability prop");
  assert.ok(/<UsedInEquipmentSection\s+hasCapability=\{hasCapability\}\s+partId=\{resolvedPartId\}/.test(pd), "PartDetail forwards hasCapability + resolvedPartId unchanged");
  assert.equal(/resolveEffectivePermission|COMPATIBILITY_ROLES|role\s*===/.test(pd.split("UsedInEquipmentSection")[0].split("PartDetail")[0] || ""), false);
  const sec = fs.readFileSync(rel("src/modules/inventory/UsedInEquipmentSection.jsx"), "utf8");
  assert.ok(/if \(!canView\) return null;/.test(sec), "the section returns null (HIDDEN) when the capability is not granted");
  // No independent client resolver / role inference in the section.
  for (const forbidden of [/resolveEffectivePermission/, /COMPATIBILITY_ROLES/, /operationalRoles/, /\brole\b\s*===/]) {
    assert.equal(forbidden.test(sec), false, `section must not resolve permission or infer from roles: ${forbidden}`);
  }
});

// ============================ G. inert source ============================
await acheck("the inert source performs no backend call and returns a safe unavailable", async () => {
  const r = await inertEquipmentCompatibilitySource.readForPart({ partId: "TST-1001", cursor: null, limit: 10 });
  assert.deepEqual(r, { ok: false, code: "unavailable" });
  const src = fs.readFileSync(rel("src/services/equipmentCompatibilitySource.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.equal(/^\s*import\s/m.test(code), false, "the inert source must import nothing");
  for (const forbidden of [/firebase/i, /getDocs/i, /httpsCallable/i, /fetch\(/]) {
    assert.equal(forbidden.test(code), false, `inert source must not call a backend: ${forbidden}`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
