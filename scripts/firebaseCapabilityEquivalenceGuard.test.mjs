// Contract tests for the Firebase retirement business-capability equivalence gate.
// See scripts/firebaseCapabilityEquivalenceGuard.mjs and docs/architecture/firebase-capability-equivalence-gate.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORICAL_BASELINE_SHA,
  HISTORICAL_RETIREMENTS,
  INDEX_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  decisionNumbers,
  evaluateEquivalence,
  parseIndexExports,
  run,
} from "./firebaseCapabilityEquivalenceGuard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "fceg-"));
  const files = {
    "functions/test/thing.test.mjs": 'test("creates a thing", ...)\ntest("refuses a thing without the capability", ...)\n',
    "functions/src/thingHttp.ts": 'case "createThing":\n',
    "field-ops-app-vite/src/ThingPage.jsx": "createThing(\n",
    "docs/uat/thing-uat.md": "UAT: Retail Sales created a thing through the EOS screen\n",
    "field-ops-app-vite/src/ThingPage.ui.test.jsx": 'test("Retail Sales creates a thing")\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const src = { kind: "source", path: "functions/src/thingHttp.ts", contains: 'case "createThing"' };
const pos = { kind: "test", path: "functions/test/thing.test.mjs", contains: "creates a thing", polarity: "positive" };
const neg = { kind: "test", path: "functions/test/thing.test.mjs", contains: "refuses a thing without the capability", polarity: "negative" };
const uat = { kind: "uat", path: "docs/uat/thing-uat.md", contains: "Retail Sales created a thing" };
const uiTest = { kind: "ui-test", path: "field-ops-app-vite/src/ThingPage.ui.test.jsx", contains: "Retail Sales creates a thing", polarity: "positive" };

function verifiedRecord(overrides = {}) {
  return {
    legacyOperation: "createThing",
    capabilityId: "things.thing.create",
    domain: "things",
    era: "GATED",
    retiredIn: { pr: 9999, commit: "deadbeef" },
    disposition: "REPLACED",
    verificationStatus: "VERIFIED",
    materialBehaviorChange: false,
    eosReplacement: "POST /operations/things createThing",
    entryPoint: "ThingPage",
    postgresImplementation: "postgresThingWriter.createThing",
    personas: ["retailSales"],
    requiredCapabilities: ["things.thing.write"],
    ownerDecision: null,
    gates: {
      A: { status: "VERIFIED", evidence: [src, pos] },
      B: { status: "VERIFIED", evidence: [uiTest, uat] },
      C: { status: "VERIFIED", evidence: [neg] },
      D: { status: "VERIFIED", evidence: [pos] },
      E: { status: "VERIFIED", evidence: [pos, neg] },
    },
    audit: { status: "VERIFIED", evidence: [pos] },
    gaps: [],
    ...overrides,
  };
}

function evaluate({ records, current = ["keepMe"], previous = ["keepMe", "createThing"], previousRecords, decisions = [], historical = [] }) {
  return evaluateEquivalence({
    manifest: { records },
    currentExports: current,
    previousExports: previous,
    previousManifest: previousRecords ? { records: previousRecords } : null,
    decisions: new Set(decisions),
    repoRoot: fixtureRepo(),
    historicalRetirements: historical,
  });
}

function assertBlocked(result, pattern) {
  assert.ok(result.errors.some((e) => pattern.test(e)),
    `expected an error matching ${pattern}, got:\n${result.errors.join("\n")}`);
}

// ---------------------------------------------------------------------------------------------------
// Export enumeration
// ---------------------------------------------------------------------------------------------------

test("parses single-line, multi-line, aliased and declared exports", () => {
  const source = `
    export { a } from "./a";
    export {
      b,
      c as cee, // trailing comment
    } from "./bc";
    export const d = 1;
    export async function e() {}
    export type { NotDeployed } from "./types";
    export { type AlsoNot, f } from "./f";
  `;
  assert.deepEqual(parseIndexExports(source), ["a", "b", "cee", "d", "e", "f"]);
});

test("an export inside a comment or a brace inside a string is not misread", () => {
  const source = `
    // export { ghost } from "./ghost";
    /* export { ghost2 } from "./ghost2"; */
    export { real } from "./weird}path";
  `;
  assert.deepEqual(parseIndexExports(source), ["real"]);
});

test("export * and export default are refused, not skipped (an under-count would hide a retirement)", () => {
  assert.throws(() => parseIndexExports('export * from "./all";'), /unsupported export form/);
  assert.throws(() => parseIndexExports("export default thing;"), /unsupported export form/);
});

test("the live index enumerates every export (agrees with the compiled manifest when it is built)", () => {
  const exports = parseIndexExports(readFileSync(join(REPO_ROOT, INDEX_RELATIVE_PATH), "utf8"));
  assert.ok(exports.length >= 50, `only ${exports.length} exports found -- the parser is under-counting`);
  const compiled = join(REPO_ROOT, "functions/lib/index.js");
  if (existsSync(compiled)) {
    const output = execFileSync(process.execPath,
      ["-e", `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(compiled)}))))`],
      { cwd: join(REPO_ROOT, "functions"), env: { ...process.env, GCLOUD_PROJECT: "demo-fceg", FIREBASE_CONFIG: "{}" } });
    assert.deepEqual(exports, JSON.parse(output.toString()).sort());
  }
});

// ---------------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------------

test("a removed export with no equivalence record is a blocked retirement", () => {
  const result = evaluate({ records: [] });
  assert.deepEqual(result.newlyRetired, ["createThing"]);
  assertBlocked(result, /RETIREMENT BLOCKED: createThing was removed .* with no capability-equivalence record/);
});

test("a fully verified REPLACED record lets the retirement through", () => {
  const result = evaluate({ records: [verifiedRecord()] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.report[0].complete, true);
});

test("employee accessibility proven only by a static route/grant reading is not VERIFIED", () => {
  const record = verifiedRecord();
  record.gates.B = { status: "VERIFIED", evidence: [{ kind: "source", path: "field-ops-app-vite/src/ThingPage.jsx", contains: "createThing(" }] };
  assertBlocked(evaluate({ records: [record] }), /employee accessibility is VERIFIED only by BOTH/);
});

test("employee accessibility needs the screen test AND the live persona run; either alone is not enough", () => {
  const screenOnly = verifiedRecord();
  screenOnly.gates.B = { status: "VERIFIED", evidence: [uiTest] };
  assertBlocked(evaluate({ records: [screenOnly] }), /employee accessibility is VERIFIED only by BOTH/);
  const liveOnly = verifiedRecord();
  liveOnly.gates.B = { status: "VERIFIED", evidence: [uat] };
  assertBlocked(evaluate({ records: [liveOnly] }), /employee accessibility is VERIFIED only by BOTH/);
});

test("regression evidence needs a positive and a negative executable test, not a source citation", () => {
  const onlyPositive = verifiedRecord();
  onlyPositive.gates.E = { status: "VERIFIED", evidence: [pos] };
  assertBlocked(evaluate({ records: [onlyPositive] }), /at least one positive AND one negative/);
  const onlySource = verifiedRecord();
  onlySource.gates.E = { status: "VERIFIED", evidence: [src] };
  assertBlocked(evaluate({ records: [onlySource] }), /at least one positive AND one negative/);
});

test("an unsupported REPLACED claim is rejected and names the open gates", () => {
  const record = verifiedRecord();
  record.gates.B = { status: "PARTIAL", evidence: [src], limitation: "no live UI run" };
  const result = evaluate({ records: [record] });
  assertBlocked(result, /REPLACED is an unsupported claim -- gate B \(employee accessibility\) is PARTIAL/);
  assertBlocked(result, /verificationStatus VERIFIED is unsupported/);
  assertBlocked(result, /RETIREMENT BLOCKED: createThing is not retirement-complete/);
});

test("a non-VERIFIED gate must state its limitation", () => {
  const record = verifiedRecord({ verificationStatus: "UNVERIFIED", disposition: "GAP" });
  record.gates.A = { status: "UNVERIFIED", evidence: [] };
  assertBlocked(evaluate({ records: [record] }), /must say what is missing/);
});

test("gate A, C and E can never be NOT_APPLICABLE; B and D can, with a reason", () => {
  const a = verifiedRecord();
  a.gates.A = { status: "NOT_APPLICABLE", reason: "x" };
  assertBlocked(evaluate({ records: [a] }), /gate A \(functional equivalence\) can never be NOT_APPLICABLE/);
  const d = verifiedRecord();
  d.gates.D = { status: "NOT_APPLICABLE" };
  assertBlocked(evaluate({ records: [d] }), /NOT_APPLICABLE needs a "reason"/);
  const ok = verifiedRecord();
  ok.gates.D = { status: "NOT_APPLICABLE", reason: "read-only operation with no downstream consumer" };
  assert.deepEqual(evaluate({ records: [ok] }).errors, []);
});

test("stale evidence fails: a missing file, or a test name that no longer exists", () => {
  const missing = verifiedRecord();
  missing.gates.A.evidence = [{ kind: "source", path: "functions/src/gone.ts" }];
  assertBlocked(evaluate({ records: [missing] }), /STALE -- functions\/src\/gone.ts does not exist/);
  const renamed = verifiedRecord();
  renamed.gates.E.evidence = [pos, { ...neg, contains: "an old test name" }];
  assertBlocked(evaluate({ records: [renamed] }), /STALE -- functions\/test\/thing.test.mjs no longer contains "an old test name"/);
});

test("evidence may not point outside the repository", () => {
  const record = verifiedRecord();
  record.gates.A.evidence = [{ kind: "source", path: "../../etc/passwd" }];
  assertBlocked(evaluate({ records: [record] }), /does not exist in this tree/);
});

test("a GAP retires only with an Owner decision that exists in DECISIONS.md", () => {
  const gap = verifiedRecord({ disposition: "GAP", verificationStatus: "UNVERIFIED" });
  gap.gates.B = { status: "GAP", evidence: [], limitation: "no screen exists" };
  assertBlocked(evaluate({ records: [gap] }), /it is a GAP the Owner has not accepted/);
  const invented = { ...gap, ownerDecision: "DECISIONS #9999" };
  assertBlocked(evaluate({ records: [invented] }), /has no "## #9999" heading/);
  const malformed = { ...gap, ownerDecision: "Owner said yes" };
  assertBlocked(evaluate({ records: [malformed] }), /must look like "DECISIONS #NNN"/);
  const accepted = { ...gap, ownerDecision: "DECISIONS #229" };
  assert.deepEqual(evaluate({ records: [accepted], decisions: ["229"] }).errors, []);
});

test("SUPERSEDED with a material behaviour change needs the Owner; without one it does not", () => {
  const material = verifiedRecord({ disposition: "SUPERSEDED", materialBehaviorChange: true });
  const blocked = evaluate({ records: [material] });
  assertBlocked(blocked, /needs the Owner's acceptance/);
  assertBlocked(blocked, /the material behaviour change has no Owner decision/);
  assert.deepEqual(evaluate({ records: [{ ...material, ownerDecision: "DECISIONS #230" }], decisions: ["230"] }).errors, []);
  assert.deepEqual(evaluate({ records: [verifiedRecord({ disposition: "SUPERSEDED" })] }).errors, []);
});

test("REPLACED may not carry a material behaviour change", () => {
  assertBlocked(evaluate({ records: [verifiedRecord({ materialBehaviorChange: true })] }),
    /a material behaviour change is SUPERSEDED/);
});

test("UNVERIFIED is historical-only; a new retirement cannot land unverified", () => {
  const record = verifiedRecord({ disposition: "UNVERIFIED", verificationStatus: "UNVERIFIED" });
  record.gates.B = { status: "PARTIAL", evidence: [src], limitation: "static only" };
  assertBlocked(evaluate({ records: [record] }), /UNVERIFIED is a historical-only disposition/);
});

test("a new retirement cannot be filed as HISTORICAL to dodge the gate", () => {
  const record = verifiedRecord({ era: "HISTORICAL", disposition: "UNVERIFIED", verificationStatus: "UNVERIFIED" });
  record.gates.B = { status: "PARTIAL", evidence: [src], limitation: "static only" };
  const result = evaluate({ records: [record], historical: ["somethingElse"] });
  assertBlocked(result, /era HISTORICAL is reserved/);
  assertBlocked(result, /RETIREMENT BLOCKED: createThing is a new retirement and must be recorded as era GATED/);
});

test("a historical record may stay open (reported) but may not over-claim", () => {
  const open = verifiedRecord({ era: "HISTORICAL", disposition: "UNVERIFIED", verificationStatus: "UNVERIFIED" });
  open.gates.B = { status: "PARTIAL", evidence: [src], limitation: "static only" };
  const ok = evaluate({ records: [open], current: ["keepMe"], previous: ["keepMe"], historical: ["createThing"] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.report[0].complete, false);
  const overClaim = { ...open, disposition: "REPLACED" };
  assertBlocked(evaluate({ records: [overClaim], current: ["keepMe"], previous: ["keepMe"], historical: ["createThing"] }),
    /REPLACED is an unsupported claim/);
});

test("every historical retirement must be recorded, and none may be exported again", () => {
  assertBlocked(evaluate({ records: [], current: ["keepMe"], previous: ["keepMe"], historical: ["createThing"] }),
    /historical retirement has no equivalence record/);
  const record = verifiedRecord({ era: "HISTORICAL" });
  assertBlocked(evaluate({ records: [record], current: ["keepMe", "createThing"], previous: ["keepMe", "createThing"], historical: ["createThing"] }),
    /exported again/);
});

test("records are append-only against the previously accepted manifest", () => {
  const result = evaluate({ records: [], current: ["keepMe"], previous: ["keepMe"], previousRecords: [verifiedRecord()] });
  assertBlocked(result, /deleted -- equivalence records may be improved, never removed/);
});

test("malformed and duplicate records are rejected", () => {
  assertBlocked(evaluate({ records: [{ legacyOperation: "createThing" }] }), /"capabilityId" is required/);
  assertBlocked(evaluate({ records: [verifiedRecord(), verifiedRecord()] }), /duplicate record/);
  assertBlocked(evaluate({ records: [verifiedRecord({ disposition: "MOVED" })] }), /disposition "MOVED" is not one of/);
  assert.deepEqual(evaluateEquivalence({ manifest: {}, currentExports: [], previousExports: null, previousManifest: null,
    decisions: new Set(), repoRoot: REPO_ROOT }).errors.length, 1);
});

test("bootstrap (no previous commit) checks records but finds no newly retired export", () => {
  const result = evaluate({ records: [], previous: null });
  assert.deepEqual(result.newlyRetired, []);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------------------------------
// The committed manifest and the historical baseline
// ---------------------------------------------------------------------------------------------------

test("the historical baseline is exactly the 22 retirements audited at main acc65f2e", () => {
  assert.equal(HISTORICAL_BASELINE_SHA, "acc65f2efe4e68cca563f43fe81a3ef4f43f2722");
  assert.deepEqual([...HISTORICAL_RETIREMENTS].sort(), [
    "activateSupplier", "changePartStatus", "changePartSupplierItemStatus", "correctWorkOrderLabor",
    "createPart", "createPartAlias", "createPartSupplierItem", "createSupplier", "deactivatePartAlias",
    "deactivateSupplier", "getWorkOrderLabor", "listPartAliases", "lookupScannedPart", "probePartAlias",
    "reactivatePartAlias", "recordPutAway", "recordWorkOrderLabor", "resolveScannedPartIdentifier",
    "setPreferredSupplier", "updatePart", "updatePartSupplierItem", "updateSupplier",
  ]);
});

test("decision headings are read from DECISIONS.md", () => {
  const numbers = decisionNumbers("## #12 — a\ntext\n## #227 — b\n### #999 not a heading\n");
  assert.deepEqual([...numbers].sort(), ["12", "227"]);
});

test("the committed manifest passes the gate on the current tree", () => {
  const { errors, report } = run([], REPO_ROOT);
  assert.deepEqual(errors, []);
  assert.equal(report.length, HISTORICAL_RETIREMENTS.length);
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_RELATIVE_PATH), "utf8"));
  assert.equal(manifest.historicalBaselineSha, HISTORICAL_BASELINE_SHA);
});

test("CLI: a supplied previous file that is missing fails closed", () => {
  assert.throws(() => run(["--previous-index", "/nonexistent/index.ts"], REPO_ROOT), /ENOENT/);
  assert.throws(() => run(["--previous-manifest", "/nonexistent/manifest.json"], REPO_ROOT), /unreadable or malformed JSON/);
});
