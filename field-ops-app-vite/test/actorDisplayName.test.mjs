// F-UID-1 regression -- resolveActorDisplayName must NEVER return a raw
// Firebase UID on a non-Admin surface. Proves the fix for the confirmed
// defect: the resolver used to fall back to the raw uid while the
// directory was loading or when no linked Employee existed, leaking the
// uid into the inventory (non-Admin) DOM.
//
// Run: node test/actorDisplayName.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveActorDisplayName,
  resolveEmployeeIdentity,
  UNKNOWN_ACTOR_DISPLAY_NAME,
} from "../src/domain/actorDisplayName.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// A realistic Firebase Auth UID shape (28-char alphanumeric). The core
// assertion everywhere below is that THIS STRING never appears in output.
const RAW_UID = "aZ3kP9qXfL2mN7bV0cR5tY8wD1eH";

function assertNoRawUid(result) {
  assert.notStrictEqual(result, RAW_UID, "result must not equal the raw uid");
  assert.ok(
    typeof result !== "string" || !result.includes(RAW_UID),
    `result must not contain the raw uid, got: ${String(result)}`,
  );
}

ok("resolved Employee record -> recognizable name, no raw uid", () => {
  const byUserId = new Map([[RAW_UID, { userId: RAW_UID, displayName: "Dana Ruiz" }]]);
  const result = resolveActorDisplayName(RAW_UID, byUserId);
  assert.strictEqual(result, "Dana Ruiz");
  assertNoRawUid(result);
});

ok("directory still loading (empty map) -> neutral label, never the raw uid", () => {
  // useEmployeeDirectory initializes byUserId to an empty Map with
  // loading=true; the actor cell renders during that window.
  const result = resolveActorDisplayName(RAW_UID, new Map());
  assertNoRawUid(result);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
});

ok("missing Employee record -> neutral label, never the raw uid", () => {
  const byUserId = new Map([["someone-else", { userId: "someone-else", displayName: "Other Person" }]]);
  const result = resolveActorDisplayName(RAW_UID, byUserId);
  assertNoRawUid(result);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
});

ok("failed directory read (empty map / undefined) -> neutral label, never the raw uid", () => {
  // onSnapshot error handler resets byUserId to an empty Map; also guard
  // the defensive undefined-directory path.
  for (const dir of [new Map(), undefined]) {
    const result = resolveActorDisplayName(RAW_UID, dir);
    assertNoRawUid(result);
    assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  }
});

ok("legacy actor uid with no Employee link -> neutral label, never the raw uid", () => {
  const byUserId = new Map([["linked-user", { userId: "linked-user", displayName: "Linked User" }]]);
  const result = resolveActorDisplayName("legacy-actor-uid-9f3c2a1b7e", byUserId);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  assert.ok(!String(result).includes("legacy-actor-uid-9f3c2a1b7e"));
});

ok("null / undefined / blank actor -> existing empty-value convention (distinct from 'Unknown user')", () => {
  for (const empty of [null, undefined, ""]) {
    const result = resolveActorDisplayName(empty, new Map());
    // Absence of an actor stays visually empty -- NOT relabeled as an
    // unresolved actor -- preserving the meaningful distinction.
    assert.strictEqual(result, empty);
    assert.notStrictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  }
});

ok("no raw uid survives for ANY unresolved uid shape (fuzz over uid-like inputs)", () => {
  const emptyDir = new Map();
  for (const uid of [RAW_UID, "0123456789abcdef0123456789", "Xy", "uid_with_underscores_123", "UPPERCASEUID1234567890"]) {
    const result = resolveActorDisplayName(uid, emptyDir);
    assert.notStrictEqual(result, uid);
    assert.ok(!String(result).includes(uid));
  }
});

// resolveEmployeeIdentity -- Wave 7 completion (account-scoped Opportunity/Sales Order sections).
// Employee DOC ids (ownerEmployeeId), NOT Firebase uids -- but the same fail-closed/never-fabricate
// shape as commercialProfile.js's resolveOwnerIdentity applies: state stays distinct across
// unset/loading/error/resolved/unknown, and a raw employeeId never masquerades as a resolved name.

ok("resolveEmployeeIdentity: resolved Employee -> state=resolved with the current display name", () => {
  const byEmployeeId = new Map([["EMP-9", { id: "EMP-9", displayName: "Jamie Rivera" }]]);
  const result = resolveEmployeeIdentity("EMP-9", { byEmployeeId });
  assert.deepEqual(result, { state: "resolved", name: "Jamie Rivera" });
});

ok("resolveEmployeeIdentity: no employeeId -> state=unset, name=null (omit from UI)", () => {
  for (const empty of [null, undefined, ""]) {
    assert.deepEqual(resolveEmployeeIdentity(empty, { byEmployeeId: new Map() }), { state: "unset", name: null });
  }
});

ok("resolveEmployeeIdentity: still loading -> state=loading, never a guessed name", () => {
  const result = resolveEmployeeIdentity("EMP-9", { byEmployeeId: new Map(), loading: true });
  assert.deepEqual(result, { state: "loading", name: null });
});

ok("resolveEmployeeIdentity: directory read failed -> state=error, never silently 'unknown'", () => {
  const result = resolveEmployeeIdentity("EMP-9", { byEmployeeId: new Map(), error: new Error("boom") });
  assert.equal(result.state, "error");
});

ok("resolveEmployeeIdentity: employeeId with no directory match -> state=unknown, never the raw id as a name", () => {
  const result = resolveEmployeeIdentity("EMP-does-not-exist", { byEmployeeId: new Map() });
  assert.equal(result.state, "unknown");
  assert.notStrictEqual(result.name, "EMP-does-not-exist");
});

// ─── Financials credited-salesperson labelling (page 15) ───
//
// Three claims, because each fails differently: a name must appear where a person belongs, an
// unresolved id must NOT be shown as if it were a name, and the money must never be grouped by
// the label.
const FIN_DIRECTORY = new Map([
  ["cw-emp-034", { id: "cw-emp-034", displayName: "Lucian Brightwater" }],
  ["cw-emp-035", { id: "cw-emp-035", displayName: "Petra Lindqvist" }],
]);

ok("credited salesperson resolves to a name, and an unresolved id is never shown as one", () => {
  const opts = { byEmployeeId: FIN_DIRECTORY, noun: "salesperson" };
  assert.equal(resolveEmployeeIdentity("cw-emp-034", opts).name, "Lucian Brightwater");
  assert.equal(resolveEmployeeIdentity("cw-emp-035", opts).name, "Petra Lindqvist");
  // An id the directory cannot place stays a NAMED unknown — the row is not hidden (it is a real
  // financial fact) and the id is not dressed up as a person.
  const missing = resolveEmployeeIdentity("cw-emp-999", opts);
  assert.equal(missing.state, "unknown");
  assert.equal(missing.name, "Unknown salesperson");
  assert.ok(!String(missing.name).includes("cw-emp-999"), "an id must never be rendered as a name");
});

ok("the noun follows the relationship: a credited salesperson is not the account owner", () => {
  assert.equal(resolveEmployeeIdentity("nope", { byEmployeeId: FIN_DIRECTORY }).name, "Unknown owner");
  assert.equal(
    resolveEmployeeIdentity("nope", { byEmployeeId: FIN_DIRECTORY, noun: "salesperson" }).name,
    "Unknown salesperson",
  );
  assert.equal(
    resolveEmployeeIdentity("x", { byEmployeeId: FIN_DIRECTORY, error: new Error("e"), noun: "salesperson" }).name,
    "Salesperson name unavailable",
  );
  assert.equal(
    resolveEmployeeIdentity("x", { byEmployeeId: FIN_DIRECTORY, loading: true, noun: "salesperson" }).name,
    null,
  );
});

ok("page 15 groups money by creditedSalespersonId, never by the mutable display name", () => {
  const src = readFileSync(
    new URL("../src/modules/financials/FinancialsEmployeePerformance.jsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("byCreditedSalesperson"), "rows must come from the server credited-salesperson rollup");
  assert.ok(src.includes("<tr key={row.key}>"), "the row identity must remain the employeeId");
  // The grouping is the SERVER's rollup mapped by rollupRow, which is called with the row alone —
  // the directory is never an input to it, so a renamed employee cannot regroup money.
  assert.ok(/\.map\(rollupRow\)/.test(src), "rollupRow must receive only the server rollup row");
  assert.ok(!/rollupRow\([^)]*byEmployeeId/.test(src), "the directory must never be an input to grouping");
  // The name is derived FROM the key, never the other way round.
  assert.ok(/resolveEmployeeIdentity\(row\.key,/.test(src), "the label must be resolved from the credited id");
  // Credit is never DERIVED from ownership or record creation. The page names those fields in its
  // annotation copy on purpose — stating that creditedSalespersonId ≠ ownerEmployeeId is the
  // distinction the surface exists to keep — so this forbids READING them, not mentioning them.
  for (const f of ["ownerEmployeeId", "createdByUid", "commercialOwnerEmployeeId", "responsibleEmployeeId"]) {
    assert.ok(!new RegExp("\\.\\s*" + f).test(src), "page 15 must not read " + f + " off any record");
    assert.ok(!new RegExp("\\b" + f + "\\s*[,}]\\s*=").test(src), "page 15 must not destructure " + f);
  }
});

console.log(`\n${passed} passed, 0 failed`);
