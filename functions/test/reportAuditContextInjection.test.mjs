// RPT-FIX TASK 2 -- VERIFYING (not trusting) the report audit-context fix, and
// closing the six call sites it missed.
//
// Baseline: branch post/eng-e-report-scope @ 92db1d19, parent main
// @ 64008d5ae0bdd9532909671b15a91122400accf1 (ATLAS-BASE-2026-09-12-A).
//
// ENG-E reported: "the service never passed its injected `db` to
// recordStandaloneAuditEvent (which already accepts one), so report-run audit
// events went to the ambient Firestore -- and the path was untestable without an
// emulator. Fixed at all three call sites."
//
// VERIFIED TRUE for reportExecutionService.ts -- :547 (refuse), :721 (aggregate
// refusal), :826 (applied) all pass `db` as the second argument, and the
// assertions below prove no ambient Firestore is reachable on any of those paths.
//
// INCOMPLETE FOR THE MODULE FAMILY. functions/src/reporting/** holds NINE audit
// writer call sites, not three. The other six are all in
// savedDefinitionCommands.ts and ALL of them reached the ambient Firestore at
// this baseline:
//
//   :222  recordStandaloneAuditEvent  (capability denial)   -- no db argument
//   :269  recordStandaloneAuditEvent  (ownership denial)     -- no db argument
//   :339  stageAuditEvent(txn, {...})  (create applied)      -- no db argument
//   :447  stageAuditEvent(txn, {...})  (rename applied)      -- no db argument
//   :511  stageAuditEvent(txn, {...})  (duplicate applied)   -- no db argument
//   :561  stageAuditEvent(txn, {...})  (delete applied)      -- no db argument
//
// `stageAuditEvent(writer, input, database?)` resolves `database ?? getFirestore()`
// to build the Audit Event's DocumentReference, so a staged event in a
// caller-supplied transaction still MINTS ITS REF ON THE AMBIENT INSTANCE. The
// same defect, one seam further in, and the reason savedDefinitionCommands.test.mjs
// cannot run without an emulator either.
//
// ================== THE PROOF MECHANISM, AND A CORRECTION ==================
//
// The brief proposed "a Module._load hook that fails if the module under test
// ever RESOLVES firebase-admin -- an assertion that the SDK was never loaded".
// That proof shape is NOT available here, and asserting it would fail vacuously:
// tsconfig emits CommonJS (module NodeNext, target ES2022), so
// `import { getFirestore } from "firebase-admin/firestore"` compiles to an
// unconditional top-level `require("firebase-admin/firestore")`. Both
// lib/reporting/reportExecutionService.js and lib/access/auditEventWriter.js
// resolve the SDK at import time, by construction, purely to have
// `getFirestore` available as a DEFAULT. Recorded below as an observation
// (`resolutions`) so the correction is evidence, not an opinion.
//
// The mechanism used instead is strictly stronger for this defect. The loader
// hook returns the REAL module wrapped so that `getFirestore` is POISONED: any
// call throws AMBIENT_FIRESTORE_REACHED. That converts "an ambient instance was
// used" from something a test must remember to look for into something that
// cannot happen silently, and -- unlike a spy on the service -- it holds across
// the WHOLE TRANSITIVE GRAPH, including auditEventWriter.ts, which is where the
// `?? getFirestore()` fallback actually lives.
//
// The trap is proved LIVE by its own negative control below (a trap never shown
// to fire is not evidence).
//
// NO EMULATOR REQUIRED. reportExecutionService.test.mjs and
// savedDefinitionCommands.test.mjs still need one (no JRE here, port 8080 held)
// and are recorded UNPROVEN in the lane verdict.
//
// Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeRecordingDb,
  queriesOf,
  world,
  EQUIPMENT_DEF,
  EQUIPMENT_RETIRED_DEF,
  EQUIPMENT_COUNT_DEF,
  PRODUCTION_ACTIVATED_REPORT_CAPS,
} from "./support/reportEngineHarness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTING_SRC = join(HERE, "..", "src", "reporting");

// The sandbox project activates all 25 production report.* ids PLUS the
// report.definition.* mutation family, which is what makes the
// savedDefinitionCommands paths reachable at all. Resolved at cold start and
// cached, so it must be set before the modules under test are imported.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

// ---------------------------------------------------------------------------
// The ambient-Firestore trap
// ---------------------------------------------------------------------------

const AMBIENT_MARKER = "AMBIENT_FIRESTORE_REACHED";
const resolutions = [];
let ambientAttempts = [];
let poisonedFirestoreModule = null;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const real = originalLoad.call(this, request, parent, isMain);
  if (request !== "firebase-admin/firestore" && request !== "firebase-admin") return real;
  resolutions.push({ request, by: parent?.filename ?? "(unknown)" });
  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "getFirestore") {
        return function poisonedGetFirestore() {
          const err = new Error(AMBIENT_MARKER);
          ambientAttempts.push(new Error(AMBIENT_MARKER).stack ?? AMBIENT_MARKER);
          throw err;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  if (request === "firebase-admin/firestore") poisonedFirestoreModule = wrapped;
  return wrapped;
};

function resetAmbient() {
  ambientAttempts = [];
}
function assertNoAmbient(label) {
  assert.equal(
    ambientAttempts.length,
    0,
    `${label}: the ambient Firestore was reached ${ambientAttempts.length} time(s).\n` +
      (ambientAttempts[0] ?? ""),
  );
}

// Imported AFTER the trap is installed.
const service = await import("../lib/reporting/reportExecutionService.js");
const saved = await import("../lib/reporting/savedDefinitionCommands.js");

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const DEFINITION_CAPS = [
  "report.definition.create",
  "report.definition.read",
  "report.definition.rename",
  "report.definition.duplicate",
  "report.definition.delete",
];

const ROLES = Object.freeze({
  synthReportRunner: Object.freeze({
    id: "synthReportRunner",
    name: "Synthetic report runner",
    description: "test-only",
    permissions: Object.freeze([...PRODUCTION_ACTIVATED_REPORT_CAPS, ...DEFINITION_CAPS]),
  }),
});

function savedWorld() {
  const w = world({ taylorRows: 4 });
  // NOTE: savedDefinitionCommands.ts's hasCapability() resolves against a
  // GLOBAL target (its own GLOBAL_TARGET constant), so an operatingCompany-scoped
  // assignment can never satisfy it -- the saved-definition family is NOT
  // company-scoped the way ENG-E made report EXECUTION. The actor here is
  // therefore u-global, whose assignment is { type: "global" }. (Recorded as an
  // observation for the lane verdict, not changed: savedDefinitionCommands.ts's
  // own tenancy posture is a separate question from this lane's.)
  w.reportDefinitions = {
    "def-owned-by-other": {
      id: "def-owned-by-other",
      name: "Someone else's report",
      ownerUid: "u-ventana",
      definition: { objectId: "equipment", fields: ["equipment.name"] },
    },
    "def-mine": {
      id: "def-mine",
      name: "My report",
      ownerUid: "u-global",
      definition: { objectId: "equipment", fields: ["equipment.name"] },
    },
  };
  return w;
}

// ===========================================================================
// 0 -- THE TRAP'S OWN NEGATIVE CONTROL. A trap never shown to fire proves
//      nothing, so prove it fires.
// ===========================================================================

test("NEGATIVE CONTROL: the trap is live -- any getFirestore() call throws and is counted", () => {
  resetAmbient();
  assert.ok(poisonedFirestoreModule, "firebase-admin/firestore was never resolved at all");
  assert.throws(() => poisonedFirestoreModule.getFirestore(), new RegExp(AMBIENT_MARKER));
  assert.equal(ambientAttempts.length, 1, "the attempt was recorded");
  resetAmbient();
});

test("OBSERVATION (brief correction): the SDK IS resolved at import time, so 'never loaded' is not the available proof", () => {
  const by = resolutions.map((r) => r.by.replace(/^.*\/lib\//, "lib/"));
  assert.ok(
    by.some((f) => f === "lib/reporting/reportExecutionService.js"),
    `expected the service to resolve firebase-admin at import; saw ${JSON.stringify(by)}`,
  );
  assert.ok(
    by.some((f) => f === "lib/access/auditEventWriter.js"),
    "auditEventWriter is where the `?? getFirestore()` fallback lives; it resolves the SDK too",
  );
});

// ===========================================================================
// 1 -- reportExecutionService.ts, PER CALL SITE.
// ===========================================================================

test("CALL SITE :547 (refuse -> permission-denied): the injected db carries the Audit Event; no ambient Firestore", async () => {
  resetAmbient();
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  const outcome = await service.runReportDefinition(
    { runnerUid: "u-none", definition: EQUIPMENT_DEF, definitionId: "d-547a" },
    { db, roles: ROLES, maxScanDocs: 50, maxResultRows: 50 },
  );
  assert.equal(outcome.kind, "permission-denied");
  assertNoAmbient(":547 permission-denied");
  assert.equal(db.auditWrites.length, 1, "the Audit Event landed on the INJECTED db");
  assert.equal(db.auditWrites[0].outcome, "denied");
  assert.equal(queriesOf(db, "equipment").length, 0, "the reported collection is never read");
});

test("CALL SITE :547 (refuse -> company-unresolved): same seam, ENG-E's other refusal kind", async () => {
  resetAmbient();
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  const outcome = await service.runReportDefinition(
    { runnerUid: "u-location", definition: EQUIPMENT_DEF, definitionId: "d-547b" },
    { db, roles: ROLES, maxScanDocs: 50, maxResultRows: 50 },
  );
  assert.equal(outcome.kind, "company-unresolved");
  assertNoAmbient(":547 company-unresolved");
  assert.equal(db.auditWrites.length, 1);
});

test("CALL SITE :721 (aggregate refusal, census X-9): the injected db carries the Audit Event", async () => {
  resetAmbient();
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  await assert.rejects(
    () =>
      service.runReportDefinition(
        { runnerUid: "u-taylor", definition: EQUIPMENT_COUNT_DEF, definitionId: "d-721" },
        { db, roles: ROLES, maxScanDocs: 2, maxResultRows: 50 },
      ),
    service.IncompleteAggregateScanError,
  );
  assertNoAmbient(":721 aggregate refusal");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "denied");
  assert.equal(db.auditWrites[0].truncated, true);
});

test("CALL SITE :826 (applied): the injected db carries the Audit Event", async () => {
  resetAmbient();
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  const outcome = await service.runReportDefinition(
    { runnerUid: "u-taylor", definition: EQUIPMENT_DEF, definitionId: "d-826" },
    { db, roles: ROLES, maxScanDocs: 50, maxResultRows: 50 },
  );
  assert.equal(outcome.rowCount, 4);
  assertNoAmbient(":826 applied");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "applied");
});

test("CALL SITE (RPT-FIX, unproven absence): the new refusal's Audit Event also uses the injected db", async () => {
  resetAmbient();
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  await assert.rejects(
    () =>
      service.runReportDefinition(
        { runnerUid: "u-taylor", definition: EQUIPMENT_RETIRED_DEF, definitionId: "d-abs" },
        { db, roles: ROLES, maxScanDocs: 2, maxResultRows: 50 },
      ),
    service.UnprovenAbsenceError,
  );
  assertNoAmbient("unproven-absence refusal");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "denied");
});

// ===========================================================================
// 2 -- savedDefinitionCommands.ts, THE SIX MISSED SITES.
// ===========================================================================

test("CALL SITE :222 (capability denial): the injected db carries the Audit Event", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  await assert.rejects(
    () =>
      saved.createSavedDefinition(
        { actorUid: "u-none", name: "N", definition: { objectId: "equipment", fields: ["equipment.name"] } },
        { db, roles: ROLES },
      ),
    saved.UnauthorizedActorError,
  );
  assertNoAmbient(":222 capability denial");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "denied");
});

test("CALL SITE :269 (ownership denial): the injected db carries the Audit Event", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  await assert.rejects(
    () =>
      saved.renameSavedDefinition(
        { actorUid: "u-global", definitionId: "def-owned-by-other", name: "Renamed" },
        { db, roles: ROLES },
      ),
    saved.NotOwnerError,
  );
  assertNoAmbient(":269 ownership denial");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "denied");
});

test("CALL SITE :339 (create applied, stageAuditEvent in a transaction): the ref is minted on the injected db", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  const rec = await saved.createSavedDefinition(
    { actorUid: "u-global", name: "Fresh", definition: { objectId: "equipment", fields: ["equipment.name"] } },
    { db, roles: ROLES },
  );
  assert.equal(rec.name, "Fresh");
  assertNoAmbient(":339 create applied");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "applied");
});

test("CALL SITE :447 (rename applied): the ref is minted on the injected db", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  await saved.renameSavedDefinition(
    { actorUid: "u-global", definitionId: "def-mine", name: "Renamed" },
    { db, roles: ROLES },
  );
  assertNoAmbient(":447 rename applied");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "applied");
});

test("CALL SITE :511 (duplicate applied): the ref is minted on the injected db", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  await saved.duplicateSavedDefinition(
    { actorUid: "u-global", definitionId: "def-mine", name: "Copy" },
    { db, roles: ROLES },
  );
  assertNoAmbient(":511 duplicate applied");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "applied");
});

test("CALL SITE :561 (delete applied): the ref is minted on the injected db", async () => {
  resetAmbient();
  const db = makeRecordingDb(savedWorld());
  await saved.deleteSavedDefinition({ actorUid: "u-global", definitionId: "def-mine" }, { db, roles: ROLES });
  assertNoAmbient(":561 delete applied");
  assert.equal(db.auditWrites.length, 1);
  assert.equal(db.auditWrites[0].outcome, "applied");
});

// ===========================================================================
// 3 -- THE CENSUS RATCHET. The runtime tests above cover the paths that are
//      reachable without an emulator; this covers EVERY call site in the
//      family, including any added later, by reading the source.
// ===========================================================================

/** Split a call's argument list on TOP-LEVEL commas, respecting nesting and strings. */
function splitTopLevelArgs(src, openParenIdx) {
  let depth = 0;
  let i = openParenIdx;
  const args = [];
  let start = openParenIdx + 1;
  let quote = null;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0 && c === ")") {
        args.push(src.slice(start, i));
        return { args, end: i };
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error("unbalanced call expression");
}

const AUDIT_CALLS = [
  // [callee, index of the `database` parameter in its signature]
  ["recordStandaloneAuditEvent", 1],
  ["stageAuditEvent", 2],
  ["stageAuditEventWithId", 3],
  ["auditEventDocRef", 1],
];

function censusAuditCalls() {
  const findings = [];
  for (const file of readdirSync(REPORTING_SRC).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(REPORTING_SRC, file), "utf8");
    const lineAt = (idx) => src.slice(0, idx).split("\n").length;
    for (const [callee, dbIndex] of AUDIT_CALLS) {
      const re = new RegExp(`(?<![A-Za-z0-9_$.])${callee}\\s*\\(`, "g");
      let m;
      while ((m = re.exec(src)) !== null) {
        const open = m.index + m[0].length - 1;
        // Skip the import statement / re-export forms.
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(import|export)\b/.test(src.slice(lineStart, m.index))) continue;
        const { args } = splitTopLevelArgs(src, open);
        findings.push({
          file,
          line: lineAt(m.index),
          callee,
          argCount: args.length,
          dbArg: (args[dbIndex] ?? "").trim(),
        });
      }
    }
  }
  return findings;
}

test("CENSUS: EVERY audit-writer call under functions/src/reporting/** passes an explicit data context", () => {
  const findings = censusAuditCalls();
  assert.ok(findings.length >= 9, `expected >= 9 call sites, found ${findings.length}`);
  const ambient = findings.filter((f) => !/^(db|database)$/.test(f.dbArg));
  assert.deepEqual(
    ambient,
    [],
    "these audit-writer calls omit the data context and therefore write to the AMBIENT Firestore:\n" +
      ambient.map((f) => `  ${f.file}:${f.line} ${f.callee}(...) argCount=${f.argCount} dbArg=${JSON.stringify(f.dbArg)}`).join("\n"),
  );
});

test("CENSUS: the count is pinned, so a NEW call site cannot be added without being censused", () => {
  const findings = censusAuditCalls();
  const byFile = {};
  for (const f of findings) byFile[f.file] = (byFile[f.file] ?? 0) + 1;
  assert.deepEqual(
    byFile,
    { "reportExecutionService.ts": 4, "savedDefinitionCommands.ts": 6 },
    "the audit-writer call-site census changed. Re-derive it, and make sure every new site " +
      "passes its injected db (that is the whole defect this file exists for).",
  );
});

test("no reporting module resolves the ambient Firestore for anything but the DEFAULT parameter", () => {
  // A structural companion to the runtime proof: getFirestore() may appear ONLY
  // as `options.db ?? getFirestore()` / `database ?? getFirestore()`. Any other
  // use is an ambient read or write that no injected context can displace.
  const offenders = [];
  for (const file of readdirSync(REPORTING_SRC).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(REPORTING_SRC, file), "utf8");
    const re = /getFirestore\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/\?\?\s*$/.test(before)) continue;
      if (/^\s*(import|export)\b/.test(src.slice(src.lastIndexOf("\n", m.index) + 1, m.index))) continue;
      offenders.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, [], `ambient getFirestore() outside a `?? ` default: ${offenders.join(", ")}`);
});

test.after(() => {
  Module._load = originalLoad;
});
