// RPT-CLIENT -- THE DRIFT RATCHET for the reporting server <-> client contract.
// Baseline: rpt/false-empty-and-audit @ 8521cd88 (chain 92db1d19 -> 64008d5a).
//
// ======================= THE DEFECT CLASS THIS EXISTS TO CATCH =======================
//
// The client mirrors two CLOSED server vocabularies by hand:
//
//   1. RunReportOutcomeKind          -> reportRunOutcome.js's SERVICE_KINDS
//   2. the HttpsError codes that     -> reportRunOutcome.js's CALLABLE_ERROR_OUTCOMES
//      runReportDefinitionCallable.ts
//      can throw
//
// Both mirrors were BROKEN at 8521cd88, and in both cases the breakage was
// fail-safe, silent, and user-facing:
//
//   * ENG-E added kind "company-unresolved" -- a TENANCY refusal, deliberately
//     distinct from "permission-denied". SERVICE_KINDS is a closed set, so the new
//     kind fell through mapServiceOutcome() to reportRunFailure() and a tenancy
//     refusal rendered as "the engine is unreachable"/"something went wrong".
//   * RPT-FIX's UnprovenAbsenceError and the pre-existing
//     IncompleteAggregateScanError both throw "resource-exhausted".
//     mapCallableError() had no branch for it, so both landed in `default:` and the
//     user was told "Nothing was read or changed." -- FACTUALLY FALSE for an
//     unproven absence (documents WERE read, which is the entire reason the answer
//     could not be proven) and it hid the one actionable instruction.
//
// Nothing failed. Both mirrors were recorded as prose in three separate source
// comments, and prose does not fail a build. So the mirrors are now MEASURED: this
// suite PARSES the server's TypeScript and compares it with the client's exported
// tables.
//
// It is deliberately a TEXT parse, not a type check or an import: the client cannot
// import .ts, the server's unions are erased at runtime, and a parse is the only
// thing that keeps working when the two trees are built by different toolchains.
//
// ======================= WHAT IS DELIBERATELY *NOT* RATCHETED =======================
//
// `completeness` and `scanTruncated` are ORTHOGONAL FIELDS on every outcome, not
// kinds. That is a load-bearing design choice: the kind ladder is SINGLE-WINNER and
// has already collapsed once (an understated total arrived labelled "empty" or
// "partially-authorized", never "incomplete"), so completeness must never be put
// back into that ranking contest -- on the server OR on the client. This suite
// asserts the two vocabularies stay DISJOINT, which is the structural form of that
// rule.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SERVICE_KINDS, SCAN_COMPLETENESS_VALUES, CALLABLE_ERROR_OUTCOMES, mapServiceOutcome, mapCallableError,
} from "../src/domain/reporting/reportRunOutcome.js";
import { describeRunOutcome } from "../src/domain/reporting/reportResultState.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_SERVER_DIR = path.resolve(here, "../../functions/src/reporting");

// The ONLY reason this is overridable: the negative control for this very suite has
// to simulate a SERVER that gained a kind, and functions/** is another lane's
// surface that must not be written to even transiently. The override points at a
// COPY of the server tree in a scratch directory. CI sets neither variable, and the
// first test below asserts the real files exist regardless of the override, so this
// suite can never pass by being pointed at nothing.
const SERVER_DIR = process.env.RPT_CLIENT_RATCHET_SELFTEST_DIR || REAL_SERVER_DIR;

/** Strip `//` line comments. The server's comments QUOTE the very literals we parse
 *  (e.g. `// "permission-denied" so an operator cannot mistake it...`), so parsing
 *  without this would silently invent vocabulary that is only documentation. */
function stripLineComments(text) {
  return text.split("\n").filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, "")).join("\n");
}

function readServer(file) {
  const p = path.join(SERVER_DIR, file);
  assert.ok(existsSync(p), `the ratchet cannot read the server contract at ${p}`);
  return stripLineComments(readFileSync(p, "utf8"));
}

/** The string literals of an `export type X = "a" | "b";` union, in source order. */
function parseUnion(text, typeName) {
  const start = text.indexOf(`export type ${typeName} =`);
  assert.ok(start >= 0, `${typeName} not found in the server source -- the ratchet's parse is stale`);
  const end = text.indexOf(";", start);
  assert.ok(end > start, `${typeName} has no terminating ';'`);
  const body = text.slice(start, end);
  const values = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.length > 0, `${typeName} parsed to zero members -- the parse is broken, not the contract`);
  return values;
}

// ---- 0. the parse itself is load-bearing, so prove it is reading the real thing --
ok("the real server contract files exist and parse to non-trivial vocabularies", () => {
  for (const f of ["reportExecutionService.ts", "runReportDefinitionCallable.ts"]) {
    assert.ok(existsSync(path.join(REAL_SERVER_DIR, f)), `missing server file: ${f}`);
  }
  const real = stripLineComments(readFileSync(path.join(REAL_SERVER_DIR, "reportExecutionService.ts"), "utf8"));
  assert.ok(parseUnion(real, "RunReportOutcomeKind").length >= 6);
  assert.ok(parseUnion(real, "ScanCompleteness").length >= 3);
});

// ---- 1. the kind mirror --------------------------------------------------------
ok("SERVICE_KINDS matches the server's RunReportOutcomeKind union EXACTLY", () => {
  const server = parseUnion(readServer("reportExecutionService.ts"), "RunReportOutcomeKind");
  const missing = server.filter((k) => !SERVICE_KINDS.includes(k));
  const extra = SERVICE_KINDS.filter((k) => !server.includes(k));
  assert.deepEqual(missing, [],
    "The server can return these kinds and the client does not recognise them. mapServiceOutcome()\n" +
    "fails them closed to a generic `failure`, which is SAFE but DISCARDS the explanation -- exactly\n" +
    "how a tenancy refusal came to render as \"the engine is unreachable\". Add each to SERVICE_KINDS\n" +
    "in reportRunOutcome.js AND give it user-facing copy in reportResultState.js:\n  " + missing.join("\n  "));
  assert.deepEqual(extra, [],
    "The client recognises kinds the server can no longer return. A stale mirror is how the next\n" +
    "drift hides: remove each, and the branch in reportResultState.js with it:\n  " + extra.join("\n  "));
});

ok("every server kind has a REAL branch in describeRunOutcome -- not the generic failure", () => {
  // Recognising a kind in the mapper and then rendering it as "something went wrong"
  // is the same defect one layer down.
  for (const kind of SERVICE_KINDS) {
    const d = describeRunOutcome({ kind, rows: null, completeness: "proven-complete", scanTruncated: false });
    assert.equal(d.kind, kind,
      `describeRunOutcome() has no branch for the server kind "${kind}" -- it fell through to "${d.kind}"`);
  }
});

// ---- 2. the refusal-code mirror -----------------------------------------------
/** Every code the run callable can throw, parsed from its own `new HttpsError(...)` calls. */
function serverCallableCodes() {
  const text = readServer("runReportDefinitionCallable.ts");
  const codes = [...text.matchAll(/new\s+HttpsError\(\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5, "parsed suspiciously few HttpsError codes -- the parse is stale");
  return [...new Set(codes)];
}

ok("every HttpsError code the run callable can throw has an EXPLICIT client branch", () => {
  const uncovered = serverCallableCodes().filter(
    (c) => !Object.prototype.hasOwnProperty.call(CALLABLE_ERROR_OUTCOMES, c));
  assert.deepEqual(uncovered, [],
    "The server throws these codes and mapCallableError() has no entry for them, so each falls to the\n" +
    "`unavailable` fallback -- whose copy says \"Nothing was read or changed.\" That sentence is TRUE\n" +
    "only for an engine that never ran. For a refusal it is FALSE, and a tool that misreports whether\n" +
    "data was read is worse than one that errors, because the reader acts on it. Give each its own\n" +
    "entry in CALLABLE_ERROR_OUTCOMES and its own honest copy:\n  " + uncovered.join("\n  "));
});

ok("no refusal code renders the \"nothing was read\" copy", () => {
  // The specific false statement, asserted against every code the server can throw.
  // "internal" is exempt BY NAME because the engine genuinely produced no answer and
  // is indistinguishable at the code level from an unreachable one -- the exemption is
  // listed here so it stays a decision rather than an oversight.
  const READ_NOTHING = /Nothing was read/i;
  for (const code of serverCallableCodes()) {
    if (code === "internal") continue;
    const out = mapCallableError({ code });
    const d = describeRunOutcome(out);
    const text = [out.message, d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
    assert.doesNotMatch(text, READ_NOTHING, `code "${code}" renders the "nothing was read" claim`);
  }
});

ok("no user-facing string produced from any server code carries a raw code or transport detail", () => {
  const RAW = /permission-denied|resource-exhausted|failed-precondition|invalid-argument|unauthenticated|firestore\/|functions\/|HttpsError|FirebaseError|maxScanDocs|stack/i;
  for (const code of [...serverCallableCodes(), "not-found", "unknown", ""]) {
    const out = mapCallableError({ code, message: "raw server prose: scan exceeded 20000 documents in \"customer\"" });
    const d = describeRunOutcome(out);
    for (const s of [out.message, d.title, d.message, ...d.notes].filter(Boolean)) {
      assert.doesNotMatch(s, RAW, `code "${code}" leaked: ${s}`);
    }
    assert.doesNotMatch(JSON.stringify(out), /20000|customer/);
  }
});

// ---- 3. the orthogonality rule, enforced rather than described -----------------
ok("the client's completeness vocabulary matches the server's ScanCompleteness union", () => {
  const server = parseUnion(readServer("reportExecutionService.ts"), "ScanCompleteness");
  assert.deepEqual([...SCAN_COMPLETENESS_VALUES].sort(), [...server].sort());
  // "not-attempted" means INAPPLICABLE (a refusal that read nothing), not "complete".
  assert.ok(server.includes("not-attempted"));
});

ok("completeness is NEVER a kind -- on the server or on the client", () => {
  const text = readServer("reportExecutionService.ts");
  const kinds = parseUnion(text, "RunReportOutcomeKind");
  const completeness = parseUnion(text, "ScanCompleteness");
  const collision = completeness.filter((c) => kinds.includes(c) || SERVICE_KINDS.includes(c));
  assert.deepEqual(collision, [],
    "A completeness value became an outcome kind. The kind ladder is SINGLE-WINNER and has already\n" +
    "collapsed once; a completeness kind would have to out-rank \"partially-authorized\" to be seen at\n" +
    "all. Completeness travels as its own field on every outcome, by design:\n  " + collision.join("\n  "));
  // and the axis must actually survive the mapper, or reading it is impossible
  const out = mapServiceOutcome({ kind: "results", rows: [{ a: 1 }], completeness: "bounded-page", scanTruncated: true });
  assert.equal(out.completeness, "bounded-page");
  assert.equal(out.scanTruncated, true);
});

ok("the server states completeness on EVERY outcome it builds, including its refusals", () => {
  // If a server return path omitted it, the client's conservative fallback would be
  // the only thing standing between a refusal and a "complete" reading.
  const text = readServer("reportExecutionService.ts");
  const returns = (text.match(/completeness:\s*/g) || []).length;
  assert.ok(returns >= 2,
    `only ${returns} outcome path(s) state completeness -- a path that omits it can be misread as complete`);
  assert.match(text, /completeness:\s*"not-attempted"/,
    "the refusal path must state completeness \"not-attempted\" rather than leaving it to be inferred");
});

console.log(`\n${passed} passed`);
