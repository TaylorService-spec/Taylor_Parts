// Contract tests for the Firebase retirement business-capability equivalence gate.
// See scripts/firebaseCapabilityEquivalenceGuard.mjs and docs/architecture/firebase-capability-equivalence-gate.md.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORICAL_BASELINE_SHA,
  EXPORT_BASELINE_DIGEST,
  baselineDigest,
  checkDeployEntry,
  entrySource,
  parseIndexEntries,
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

// ONE fixture repository for every scenario (nothing writes to it), removed when the file finishes.
let FIXTURE_ROOT = null;
after(() => { if (FIXTURE_ROOT) rmSync(FIXTURE_ROOT, { recursive: true, force: true }); });
function fixtureRepo() {
  if (FIXTURE_ROOT) return FIXTURE_ROOT;
  const root = mkdtempSync(join(tmpdir(), "fceg-"));
  FIXTURE_ROOT = root;
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

// `decisions`: numbers whose section RULES ON createThing, or [number, sectionText] pairs.
function evaluate({
  records, current = ["keepMe"], previous = ["keepMe", "createThing"], previousRecords, decisions = [], historical = [],
  baseline, previousBaseline,
}) {
  const names = baseline ?? [...new Set([...(previous ?? []), ...current])];
  const asEntries = (list) => Object.fromEntries(list.map((n) => [n, `./${n}#${n}`]));
  const exportBaseline = { sha: "base", entries: asEntries(names) };
  return evaluateEquivalence({
    manifest: { records, exportBaseline },
    currentExports: current,
    currentEntries: current.map((n) => ({ name: n, module: `./${n}`, original: n })),
    previousExports: previous,
    previousManifest: previousRecords || previousBaseline
      ? { records: previousRecords ?? [], exportBaseline: previousBaseline ? { sha: previousBaseline.sha, entries: asEntries(previousBaseline.exports) } : exportBaseline } : null,
    decisions: new Map(decisions.map((d) => (Array.isArray(d) ? d : [d, `## #${d} -- OWNER: createThing is accepted`]))),
    repoRoot: fixtureRepo(),
    historicalRetirements: historical,
    pinnedBaselineDigest: null,
  });
}

function assertBlocked(result, pattern) {
  assert.ok(result.errors.some((e) => pattern.test(e)),
    `expected an error matching ${pattern}, got:\n${result.errors.join("\n")}`);
}

// ---------------------------------------------------------------------------------------------------
// Export enumeration
// ---------------------------------------------------------------------------------------------------

test("parses the index grammar: comments, the firebase-admin initialization, single- and multi-line export blocks", () => {
  const source = `
    import { initializeApp } from "firebase-admin/app";
    initializeApp();
    export { a } from "./a";
    export {
      b,
      c as cee, // trailing comment
    } from "./bc";
    /* block comment with \`backticks\` and /slashes/ */
    export { default as d } from "./d";
  `;
  assert.deepEqual(parseIndexExports(source), ["a", "b", "cee", "d"]);
});

test("an export inside a comment or a brace inside a string is not misread", () => {
  const source = `
    // export { ghost } from "./ghost";
    /* export { ghost2 } from "./ghost2"; */
    export { real } from "./weird}path";
  `;
  assert.deepEqual(parseIndexExports(source), ["real"]);
});

test("B1 regression: a regex or template literal cannot desynchronize the scan and fake a commented-out export", () => {
  // The adversarial review's exact repro (#2057): a removed export made to look present. Refused, not misread.
  const regex = 'const retiredMarker = /\'/; void retiredMarker; // \' ; export { listRecordChangeHistory } from "./access/administrationUsersCallables";';
  assert.throws(() => parseIndexExports(regex), /:1: a `\/` outside a comment/);
  const template = 'const t = `${"`"}`; void t; // " ; export { x } from "./x";';
  assert.throws(() => parseIndexExports(template), /:1: a template literal/);
});

test("every form the guard cannot prove is refused, with its line -- never skipped or guessed", () => {
  for (const [source, why] of [
    ['export * from "./all";', /unsupported statement/],
    ['export * as ns from "./all";', /unsupported statement/],
    ["export default thing;", /unsupported statement/],
    ["export const d = 1;", /unsupported statement/],
    ["export const a = x, b = y;", /unsupported statement/],
    ["export const { a, b } = o;", /unsupported statement/],
    ["export async function e() {}", /unsupported statement/],
    ["export = o;", /unsupported statement/],
    ["exports.a = 1;", /unsupported statement/],
    ["module.exports.b = 2;", /unsupported statement/],
    ["export namespace N { }", /unsupported statement/],
    ['export type { T } from "./t";', /unsupported statement/],
    ['export { type T } from "./t";', /cannot parse export specifier/],
    ['export { a } from "./a";\nexport { a } from "./b";', /"a" is exported twice/],
    ['export { a } from "./a\n";', /string that crosses a line/],
    ["/* never closed", /unterminated block comment/],
    ["const half = 1 / 2;", /outside a comment/],
  ]) {
    assert.throws(() => parseIndexExports(source), why, source);
  }
  assert.throws(() => parseIndexExports('\n\nexport const late = 1;'), /index\.ts:3:/);
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

test("a GAP retires only with an Owner decision that exists in DECISIONS.md and rules on this capability", () => {
  const gap = verifiedRecord({ disposition: "GAP", verificationStatus: "UNVERIFIED" });
  gap.gates.B = { status: "GAP", evidence: [], limitation: "no screen exists" };
  assertBlocked(evaluate({ records: [gap] }), /it is a GAP the Owner has not accepted/);
  const invented = { ...gap, ownerDecision: "DECISIONS #9999" };
  assertBlocked(evaluate({ records: [invented] }), /has no "## #9999" heading/);
  const malformed = { ...gap, ownerDecision: "Owner said yes" };
  assertBlocked(evaluate({ records: [malformed] }), /must look like "DECISIONS #NNN"/);
  const accepted = { ...gap, ownerDecision: "DECISIONS #229" };
  assert.deepEqual(evaluate({ records: [accepted], decisions: ["229"] }).errors, []);
  // An existing but UNRELATED decision accepts nothing (adversarial review N1).
  assertBlocked(evaluate({ records: [accepted], decisions: [["229", "## #229 -- Phantom Sales Order links"]] }),
    /does not name this capability/);
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
  const nameless = evaluate({ records: [{ disposition: "GAP" }, { disposition: "REPLACED" }] });
  assertBlocked(nameless, /records\[0\]: "legacyOperation" is required/);
  assertBlocked(nameless, /records\[1\]: "legacyOperation" is required/);
  assertBlocked(evaluate({ records: [verifiedRecord({ candidateDisposition: "DONE" })] }), /candidateDisposition must be one of/);
  assert.ok(evaluateEquivalence({ manifest: {}, currentExports: [], previousExports: null, previousManifest: null,
    decisions: new Map(), repoRoot: REPO_ROOT }).errors.length >= 1);
});

test("evidence may not cite the gate itself, a non-test file as a test, a trivial fragment, or a path outside the repo", () => {
  const self = verifiedRecord();
  self.gates.A.evidence = [{ kind: "source", path: "docs/architecture/firebase-capability-equivalence.json", contains: "createThing proven" }];
  assertBlocked(evaluate({ records: [self] }), /gate's own machinery or the decision register/);
  const decisions = verifiedRecord();
  decisions.gates.A.evidence = [{ kind: "doc", path: "docs/DECISIONS.md", contains: "createThing proven" }];
  assertBlocked(evaluate({ records: [decisions] }), /gate's own machinery or the decision register/);
  const notATest = verifiedRecord();
  notATest.gates.E.evidence = [pos, { kind: "test", path: "functions/src/thingHttp.ts", contains: 'case "createThing"', polarity: "negative" }];
  assertBlocked(evaluate({ records: [notATest] }), /must point at a test file/);
  const fragment = verifiedRecord();
  fragment.gates.A.evidence = [{ kind: "source", path: "functions/src/thingHttp.ts", contains: "e" }];
  assertBlocked(evaluate({ records: [fragment] }), /must quote at least 12 characters/);
  const sibling = verifiedRecord();
  const root = fixtureRepo();
  sibling.gates.A.evidence = [{ kind: "source", path: `../${root.split("/").pop()}-evil/x.ts` }];
  assertBlocked(evaluate({ records: [sibling] }), /does not exist in this tree/);
});

test("a material behaviour change without an Owner decision is a GAP, in either era", () => {
  const unruled = verifiedRecord({ era: "HISTORICAL", disposition: "UNVERIFIED", verificationStatus: "UNVERIFIED", materialBehaviorChange: true });
  unruled.gates.B = { status: "PARTIAL", evidence: [src], limitation: "static only" };
  assertBlocked(evaluate({ records: [unruled], current: ["keepMe"], previous: ["keepMe"], historical: ["createThing"] }),
    /a material business-behaviour change without an Owner decision is a GAP/);
  assert.deepEqual(evaluate({ records: [{ ...unruled, disposition: "GAP" }], current: ["keepMe"], previous: ["keepMe"], historical: ["createThing"] }).errors, []);
});

test("a GATED retirement must STAY complete: a later change cannot weaken it (adversarial review N2)", () => {
  // No diff against the previous commit -- the retirement merged earlier -- but the record is weakened now.
  const weakened = verifiedRecord({ disposition: "GAP", verificationStatus: "UNVERIFIED" });
  weakened.gates.B = { status: "GAP", evidence: [], limitation: "removed later" };
  assertBlocked(evaluate({ records: [weakened], current: ["keepMe"], previous: ["keepMe"] }),
    /RETIREMENT BLOCKED: createThing is not retirement-complete/);
});

test("a GATED record's operation may not stay or come back exported, and nothing new may be exported", () => {
  assertBlocked(evaluate({ records: [verifiedRecord()], current: ["keepMe", "createThing"], previous: ["keepMe", "createThing"] }),
    /a GATED record describes a retirement, but createThing is still exported/);
  assertBlocked(evaluate({ records: [], current: ["keepMe", "brandNew"], previous: ["keepMe"], baseline: ["keepMe"] }),
    /brandNew is exported from .* but is not in the export baseline/);
  assertBlocked(evaluate({ records: [], current: ["keepMe", "brandNew"], previous: ["keepMe"], baseline: ["keepMe", "brandNew"] }),
    /brandNew is newly exported/);
});

test("the export baseline makes the gate independent of the comparison commit (adversarial review N3)", () => {
  // A cancelled main run, a direct push or a dispatch: the previous commit already lacks the export. Still caught.
  const result = evaluate({ records: [], current: ["keepMe"], previous: ["keepMe"], baseline: ["keepMe", "createThing"] });
  assertBlocked(result, /RETIREMENT BLOCKED: createThing \(export baseline base\) is no longer exported and has no capability-equivalence record/);
  assertBlocked(evaluate({ records: [], current: ["keepMe"], previous: ["keepMe"], baseline: ["keepMe"],
    previousBaseline: { sha: "base", exports: ["keepMe", "createThing"] } }), /exportBaseline changed/);
  const missing = evaluateEquivalence({ manifest: { records: [] }, currentExports: ["keepMe"], previousExports: null,
    previousManifest: null, decisions: new Map(), repoRoot: fixtureRepo(), historicalRetirements: [] });
  assertBlocked(missing, /"exportBaseline" \{ sha, entries/);
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

test("decision headings are read from DECISIONS.md, each with its own section text", () => {
  const sections = decisionNumbers("## #12 — a\ntext about createThing\n## #227 — b\n### #999 not a heading\n");
  assert.deepEqual([...sections.keys()].sort(), ["12", "227"]);
  assert.match(sections.get("12"), /createThing/);
  assert.doesNotMatch(sections.get("227"), /createThing/);
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

test("the export baseline is the 82 exports of main acc65f2e, frozen", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_RELATIVE_PATH), "utf8"));
  assert.equal(manifest.exportBaseline.sha, HISTORICAL_BASELINE_SHA);
  const names = Object.keys(manifest.exportBaseline.entries);
  assert.equal(names.length, 82);
  for (const name of HISTORICAL_RETIREMENTS) assert.ok(!names.includes(name), `${name} predates the baseline`);
  // The pinned digest IS this baseline, and it is exactly what acc65f2e exported, module by module.
  assert.equal(baselineDigest(manifest.exportBaseline), EXPORT_BASELINE_DIGEST);
  let atBaseline = null;
  try { atBaseline = execFileSync("git", ["show", `${HISTORICAL_BASELINE_SHA}:${INDEX_RELATIVE_PATH}`], { cwd: REPO_ROOT }).toString(); } catch { /* shallow clone */ }
  if (atBaseline !== null) {
    assert.deepEqual(manifest.exportBaseline.entries, Object.fromEntries(parseIndexEntries(atBaseline).map((e) => [e.name, entrySource(e)])));
  }
});

test("CLI end to end: an export removed since the previous commit, with no record, blocks the run", () => {
  const dir = mkdtempSync(join(tmpdir(), "fceg-cli-"));
  try {
    const previous = join(dir, "previous-index.ts");
    writeFileSync(previous, `${readFileSync(join(REPO_ROOT, INDEX_RELATIVE_PATH), "utf8")}\nexport { ghostExport } from "./ghost";\n`);
    const { errors, newlyRetired } = run(["--previous-index", previous], REPO_ROOT);
    assert.deepEqual(newlyRetired, ["ghostExport"]);
    assert.ok(errors.some((e) => /RETIREMENT BLOCKED: ghostExport was removed .* with no capability-equivalence record/.test(e)), errors.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------
// Second adversarial review of #2057 (head 82620da3): B3, N1-N4, N6.
// ---------------------------------------------------------------------------------------------------

test("B3: the deploy entry point is pinned -- the guard must be reading the file the deploy loads", () => {
  const good = { packageJson: { main: "lib/index.js" }, firebaseJson: { functions: { source: "functions", codebase: "default" } }, tsconfigText: '{ "compilerOptions": { "rootDir": "src" } }' };
  assert.deepEqual(checkDeployEntry(good), []);
  assert.match(checkDeployEntry({ ...good, packageJson: { main: "lib/retired.js" } }).join(), /"main" is "lib\/retired.js"/);
  assert.match(checkDeployEntry({ ...good, firebaseJson: { functions: { source: "functions-v2" } } }).join(), /exactly one functions codebase/);
  assert.match(checkDeployEntry({ ...good, firebaseJson: { functions: [{ source: "functions" }, { source: "other" }] } }).join(), /exactly one functions codebase/);
  assert.match(checkDeployEntry({ ...good, tsconfigText: '{ "compilerOptions": { "rootDir": "." } }' }).join(), /"rootDir" must be "src"/);
  // And the live repository passes it (run() applies it on every run).
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "functions/package.json"), "utf8"));
  const fb = JSON.parse(readFileSync(join(REPO_ROOT, "firebase.json"), "utf8"));
  assert.deepEqual(checkDeployEntry({ packageJson: pkg, firebaseJson: fb, tsconfigText: readFileSync(join(REPO_ROOT, "functions/tsconfig.json"), "utf8") }), []);
});

test("N1: a line terminator TypeScript honours but the blanker would not (lone CR, U+2028, U+2029) is refused", () => {
  for (const t of ["\r", "\u2028", "\u2029"]) {
    assert.throws(() => parseIndexExports(`// note${t}export { brandNewFn } from "./brandNewFn";`), /line terminator other than/, JSON.stringify(t));
  }
  assert.deepEqual(parseIndexExports('export { a } from "./a";\r\nexport { b } from "./b";\r\n'), ["a", "b"], "CRLF is fine");
});

test("N3: an export re-pointed at another module or function is caught, even though the name survives", () => {
  const base = (over = {}) => evaluateEquivalence({
    manifest: { records: [], exportBaseline: { sha: "base", entries: { keepMe: "./keepMe#keepMe" } } },
    currentExports: ["keepMe"], currentEntries: [{ name: "keepMe", module: "./keepMe", original: "keepMe", ...over }],
    previousExports: ["keepMe"], previousManifest: null, decisions: new Map(), repoRoot: fixtureRepo(),
    historicalRetirements: [], pinnedBaselineDigest: null,
  });
  assert.deepEqual(base().errors, []);
  assertBlocked(base({ module: "./stubDoesNothing" }), /keepMe now comes from \.\/stubDoesNothing#keepMe, not \.\/keepMe#keepMe/);
  assertBlocked(base({ original: "somethingElse" }), /keepMe now comes from \.\/keepMe#somethingElse/);
  const entries = parseIndexEntries('export { transitionWorkOrder as createWorkOrder } from "./transitionWorkOrder";');
  assert.deepEqual(entries, [{ name: "createWorkOrder", module: "./transitionWorkOrder", original: "transitionWorkOrder" }]);
});

test("N2: the baseline is frozen by the digest pinned in the guard, even with no previous manifest", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_RELATIVE_PATH), "utf8"));
  const edited = { ...manifest.exportBaseline, entries: { ...manifest.exportBaseline.entries } };
  delete edited.entries.createWorkOrder;
  const result = evaluateEquivalence({ manifest: { ...manifest, exportBaseline: edited }, currentExports: [], currentEntries: [],
    previousExports: null, previousManifest: null, decisions: new Map(), repoRoot: REPO_ROOT });
  assertBlocked(result, /does not match the frozen baseline pinned in the guard/);
});

test("N4: a decision accepting a GAP or a material change must name the retired operation itself", () => {
  const gap = verifiedRecord({ disposition: "GAP", verificationStatus: "UNVERIFIED", ownerDecision: "DECISIONS #158",
    eosReplacement: "see securityRole" });
  gap.gates.B = { status: "GAP", evidence: [], limitation: "no screen" };
  // The section mentions a word of the record's own replacement text but not the operation.
  const borrowed = evaluate({ records: [gap], decisions: [["158", "## #158 -- securityRole ruling"]] });
  assertBlocked(borrowed, /must name createThing itself to accept its gap/);
  assertBlocked(borrowed, /RETIREMENT BLOCKED: createThing is not retirement-complete/);
  assert.deepEqual(evaluate({ records: [gap], decisions: [["158", "## #158 -- OWNER: the createThing gap is accepted"]] }).errors, []);
});

test("N6: initializeApp may be imported only from firebase-admin/app", () => {
  assert.deepEqual(parseIndexExports('import { initializeApp } from "firebase-admin/app";\ninitializeApp();'), []);
  assert.throws(() => parseIndexExports('import { initializeApp } from "./evil";'), /may be imported only from "firebase-admin\/app"/);
});

