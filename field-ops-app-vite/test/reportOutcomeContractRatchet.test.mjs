// RPT-CLIENT -- THE DRIFT RATCHET for the reporting server <-> client contract.
// Baseline: rpt/false-empty-and-audit @ 8521cd88 (chain 92db1d19 -> 64008d5a).
//
// ======================= THE CONTRACT: SUBSET, NOT EQUALITY =========================
//
// OWNER RULING (supersedes this suite's original design, which asserted SET EQUALITY
// in both directions):
//
//   * The client and the trusted Function are INDEPENDENTLY DEPLOYABLE and may
//     temporarily run at different versions, so equality is NOT a legitimate
//     requirement.
//   * The required contract is DIRECTIONAL:
//         CURRENT_SUPPORTED_SERVER_KINDS  subset of  CLIENT_RECOGNIZED_KINDS
//   * A client-only kind is permitted ONLY when explicitly classified as a
//     COMPATIBILITY ENTRY (reportRunOutcome.js's SERVER_KIND_COMPATIBILITY), with a
//     reason. An UNDECLARED client-only kind still fails, so the mirror cannot rot in
//     the other direction either.
//   * An UNKNOWN server kind must resolve to a TRUTHFUL GENERIC BLOCKING REFUSAL:
//     never success, never a proven empty, never "nothing was read" unless that is
//     established, never a raw internal error. Proven here BY INJECTION.
//
// The equality version of this guard FAILED on a configuration that is real on this
// estate: the last RECORDED production Functions deploy pins commit fb45e6ee, whose
// RunReportOutcomeKind union has FIVE members and no "company-unresolved". Pointed at
// that server the equality assertion demanded the client DELETE "company-unresolved"
// and its render branch -- i.e. a passing test would have re-introduced the exact
// ENG-E tenancy defect this lane was opened to fix. Captured before the change:
//   RPT_CLIENT_RATCHET_SELFTEST_DIR=<server minus company-unresolved> \
//     node test/reportOutcomeContractRatchet.test.mjs   -> EXIT 1,
//     "The client recognises kinds the server can no longer return."
//
// ======================= THE DEFECT CLASS THIS EXISTS TO CATCH =======================
//
// The client mirrors two CLOSED server vocabularies by hand:
//
//   1. RunReportOutcomeKind          -> reportRunOutcome.js's CLIENT_RECOGNIZED_KINDS
//   2. the HttpsError codes that     -> reportRunOutcome.js's CALLABLE_ERROR_OUTCOMES
//      runReportDefinitionCallable.ts
//      can throw
//
// Both mirrors were BROKEN at 8521cd88, and in both cases the breakage was
// fail-safe, silent, and user-facing:
//
//   * ENG-E added kind "company-unresolved" -- a TENANCY refusal, deliberately
//     distinct from "permission-denied". The client's kind set is closed, so the new
//     kind fell through mapServiceOutcome() to a generic failure and a tenancy
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
  CLIENT_RECOGNIZED_KINDS, SERVER_KIND_COMPATIBILITY, SCAN_COMPLETENESS_VALUES,
  CALLABLE_ERROR_OUTCOMES, mapServiceOutcome, mapCallableError,
} from "../src/domain/reporting/reportRunOutcome.js";
import {
  describeRunOutcome, RENDERABLE_KINDS, CLIENT_ORIGIN_KINDS,
} from "../src/domain/reporting/reportResultState.js";

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

// ---- 1. THE COMPATIBILITY CONTRACT ---------------------------------------------
// The set the CURRENT server source can emit. Named as the ruling names it.
function currentSupportedServerKinds() {
  return parseUnion(readServer("reportExecutionService.ts"), "RunReportOutcomeKind");
}

ok("CURRENT_SUPPORTED_SERVER_KINDS is a SUBSET of CLIENT_RECOGNIZED_KINDS", () => {
  const server = currentSupportedServerKinds();
  const missing = server.filter((k) => !CLIENT_RECOGNIZED_KINDS.includes(k));
  assert.deepEqual(missing, [],
    "The server can return these kinds and the client does not recognise them. mapServiceOutcome()\n" +
    "fails them closed to the generic unrecognized-outcome refusal, which is SAFE and HONEST but\n" +
    "DISCARDS the explanation -- exactly how a tenancy refusal came to render as \"the engine is\n" +
    "unreachable\". Add each to CLIENT_RECOGNIZED_KINDS in reportRunOutcome.js AND give it\n" +
    "user-facing copy in reportResultState.js:\n  " + missing.join("\n  "));
});

ok("every client-only kind is an EXPLICITLY DECLARED compatibility entry, with a reason", () => {
  // The other direction, which the ruling permits but only under declaration. This is
  // what stops the mirror rotting silently once equality is gone.
  const server = currentSupportedServerKinds();
  const clientOnly = CLIENT_RECOGNIZED_KINDS.filter((k) => !server.includes(k));
  const undeclared = clientOnly.filter(
    (k) => !Object.prototype.hasOwnProperty.call(SERVER_KIND_COMPATIBILITY, k));
  assert.deepEqual(undeclared, [],
    "These kinds are accepted off the wire but the CURRENT server source cannot emit them, and they\n" +
    "are not declared compatibility entries. Either the parse is stale (the server really does emit\n" +
    "them -- fix the parse) or they are compatibility carry-overs, in which case declare each in\n" +
    "SERVER_KIND_COMPATIBILITY with the reason the client still accepts it:\n  " + undeclared.join("\n  "));
  for (const [kind, entry] of Object.entries(SERVER_KIND_COMPATIBILITY)) {
    assert.ok(CLIENT_RECOGNIZED_KINDS.includes(kind),
      `compatibility entry "${kind}" is not in CLIENT_RECOGNIZED_KINDS, so it does nothing at all`);
    assert.equal(typeof entry?.reason, "string",
      `compatibility entry "${kind}" has no reason -- an undocumented exemption is indistinguishable from drift`);
    assert.ok(entry.reason.trim().length >= 20,
      `compatibility entry "${kind}" has an empty/stub reason: ${JSON.stringify(entry.reason)}`);
    assert.ok(!server.includes(kind),
      `compatibility entry "${kind}" IS in the current server union -- the declaration is STALE. ` +
      "Remove it so the table cannot accumulate kinds that came back.");
  }
});

ok("every server kind has a REAL branch in describeRunOutcome -- not the generic failure", () => {
  // Recognising a kind in the mapper and then rendering it as "something went wrong"
  // is the same defect one layer down. Asserted over the SERVER's current set (the
  // ruling's requirement) rather than over the client's, so a compatibility entry
  // cannot be used to smuggle in an unrendered kind either.
  for (const kind of [...new Set([...currentSupportedServerKinds(), ...CLIENT_RECOGNIZED_KINDS])]) {
    const d = describeRunOutcome({ kind, rows: null, completeness: "proven-complete", scanTruncated: false });
    assert.equal(d.kind, kind,
      `describeRunOutcome() has no branch for the server kind "${kind}" -- it fell through to "${d.kind}"`);
  }
});

ok("the render vocabulary is exactly the wire kinds UNION the declared client-origin states", () => {
  // Union pattern, verified BY COUNT, in both directions -- so neither layer can gain
  // a kind the other has never heard of, and no kind can be unclassified.
  const clientOrigin = Object.keys(CLIENT_ORIGIN_KINDS);
  const overlap = clientOrigin.filter((k) => CLIENT_RECOGNIZED_KINDS.includes(k));
  assert.deepEqual(overlap, [],
    "A CLIENT-ORIGIN state is also accepted off the wire. That lets a server claim a state the client\n" +
    "owns (e.g. \"unavailable\", \"idle\"), which is a trust inversion, not a mirror problem:\n  " +
    overlap.join("\n  "));
  assert.equal(RENDERABLE_KINDS.length, CLIENT_RECOGNIZED_KINDS.length + clientOrigin.length,
    `renderable=${RENDERABLE_KINDS.length} but wire=${CLIENT_RECOGNIZED_KINDS.length} + ` +
    `client-origin=${clientOrigin.length} -- a kind is unclassified or counted twice`);
  for (const k of [...CLIENT_RECOGNIZED_KINDS, ...clientOrigin]) {
    assert.ok(RENDERABLE_KINDS.includes(k), `declared kind "${k}" is not renderable`);
  }
  for (const [k, entry] of Object.entries(CLIENT_ORIGIN_KINDS)) {
    assert.equal(typeof entry?.reason, "string", `client-origin state "${k}" has no reason`);
    assert.ok(entry.reason.trim().length >= 20, `client-origin state "${k}" has a stub reason`);
  }
});

// ---- 1b. UNKNOWN-KIND SAFETY, PROVEN BY INJECTION -----------------------------
// The ruling's four prohibitions, asserted against kinds NO version of the server has
// ever emitted. This is the half that equality could never test: under equality an
// unknown kind was, by assumption, impossible.
const INJECTED_UNKNOWN_KINDS = Object.freeze([
  "scope-unresolved",          // the kind the brief invented; the server has NEVER had it
  "a-kind-from-a-newer-server",
  "COMPANY-UNRESOLVED",        // case skew must not be coerced into the real kind
  "results ",                  // whitespace skew likewise
  "",
]);

ok("an injected UNKNOWN server kind is never accepted as a kind", () => {
  const known = new Set([...currentSupportedServerKinds(), ...CLIENT_RECOGNIZED_KINDS]);
  for (const kind of INJECTED_UNKNOWN_KINDS) {
    assert.ok(!known.has(kind), `"${kind}" is a REAL kind -- pick an injection the contract does not cover`);
    const out = mapServiceOutcome({ kind, rows: [{ id: "doc-1" }], rowCount: 1, completeness: "proven-complete" });
    assert.equal(out.kind, "unrecognized-outcome",
      `an unknown kind resolved to "${out.kind}" instead of the generic blocking refusal`);
  }
});

ok("PROHIBITION 1 -- an unknown kind NEVER renders success", () => {
  for (const kind of INJECTED_UNKNOWN_KINDS) {
    // rows are supplied deliberately: a payload that LOOKS successful must still be refused.
    const out = mapServiceOutcome({ kind, rows: [{ id: "doc-1" }], rowCount: 1, aggregates: [{ n: 1 }] });
    assert.equal(out.ok, false, `unknown kind "${kind}" produced ok:true`);
    assert.equal(out.rows, null, `unknown kind "${kind}" carried rows through`);
    assert.equal(out.aggregates, null, `unknown kind "${kind}" carried aggregates through`);
    const d = describeRunOutcome(out);
    assert.notEqual(d.kind, "results", `unknown kind "${kind}" rendered as a result`);
    // BLOCKING: error tone is what routes ReportBuilder's ResultArea to FailureState
    // (no rows table, no EmptyState path).
    assert.equal(d.tone, "error", `unknown kind "${kind}" is not rendered as a blocking refusal`);
    assert.equal(d.role, "alert");
    assert.doesNotMatch([d.title, d.message, ...d.notes].filter(Boolean).join(" | "),
      /ran successfully|showing the first|complete result/i);
  }
});

ok("PROHIBITION 2 -- an unknown kind NEVER renders a proven empty", () => {
  for (const kind of INJECTED_UNKNOWN_KINDS) {
    // the shape of a proven-complete zero-row answer, which is the trap
    const d = describeRunOutcome(mapServiceOutcome({
      kind, rows: [], rowCount: 0, completeness: "proven-complete", scanTruncated: false,
    }));
    assert.ok(d.kind !== "empty" && d.kind !== "empty-unproven",
      `unknown kind "${kind}" rendered as an absence ("${d.kind}")`);
    const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
    assert.doesNotMatch(text, /no matching records|no records matched|no matches|nothing matched|didn't match/i,
      `unknown kind "${kind}" asserted an absence: ${text}`);
  }
});

ok("PROHIBITION 3 -- an unknown kind NEVER claims nothing was read", () => {
  // The client CANNOT know what an unparseable answer read. Saying "nothing was read"
  // is as much an invention as saying the population was empty, and it is the exact
  // false sentence this lane's predecessor removed from the scan-bound refusal.
  for (const kind of INJECTED_UNKNOWN_KINDS) {
    const d = describeRunOutcome(mapServiceOutcome({ kind }));
    const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
    assert.doesNotMatch(text, /nothing was read|no records were read|nothing was checked|no data was read/i,
      `unknown kind "${kind}" claimed nothing was read: ${text}`);
    // ...and it must not claim the opposite either -- it asserts NOTHING about the read.
    assert.doesNotMatch(text, /records were read|read records|we could read/i,
      `unknown kind "${kind}" claimed records WERE read, which is equally unknown: ${text}`);
  }
});

ok("PROHIBITION 4 -- an unknown kind leaks no raw code, kind string, or server prose", () => {
  const LEAK = /permission-denied|resource-exhausted|failed-precondition|invalid-argument|unauthenticated|firestore\/|functions\/|HttpsError|FirebaseError|maxScanDocs|stack|undefined|null/i;
  for (const kind of INJECTED_UNKNOWN_KINDS) {
    const out = mapServiceOutcome({
      kind, message: "Scan exceeded 20000 documents in \"customer\"", companyBoundRefusal: "companies/abc123",
      rows: [{ secret: "row-data" }],
    });
    const d = describeRunOutcome(out);
    for (const str of [out.message, d.title, d.message, ...d.notes].filter(Boolean)) {
      assert.doesNotMatch(str, LEAK, `unknown kind "${kind}" leaked: ${str}`);
      if (kind.trim() !== "") {
        assert.ok(!str.includes(kind), `unknown kind "${kind}" was echoed into user-facing copy: ${str}`);
      }
    }
    // and nothing from the payload survives anywhere on the outcome
    assert.doesNotMatch(JSON.stringify(out), /20000|customer|abc123|row-data/);
  }
});

ok("company-unresolved stays FAIL CLOSED -- no override, no inference, no client-supplied company", () => {
  // The Owner's standing constraint, asserted at the render layer where the invitation
  // to self-serve would appear. An authorized user resolves this through the ordinary
  // authority path, not by typing a company into a report.
  const d = describeRunOutcome(mapServiceOutcome({
    kind: "company-unresolved", rows: null, completeness: "not-attempted",
    // a hostile/compat payload trying to supply the answer it was refused for
    companyId: "cmp-999", companyName: "Acme Holdings", operatingCompany: "cmp-999",
  }));
  const text = [d.title, d.message, ...d.notes].filter(Boolean).join(" | ");
  assert.equal(d.tone, "error");
  assert.doesNotMatch(text, /cmp-999|Acme Holdings/, "a client-supplied company must never be echoed as authority");
  assert.doesNotMatch(text, /choose|select|pick|enter|switch to|specify|set the (operating )?company/i,
    `the copy invites a self-service override: ${text}`);
  assert.doesNotMatch(text, /role|permission|access denied|not allowed/i,
    `a tenancy refusal must carry NO permission language: ${text}`);
  assert.match(text, /administrator/i, "it must point at the ordinary authority path");
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
  const collision = completeness.filter((c) => kinds.includes(c) || CLIENT_RECOGNIZED_KINDS.includes(c));
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
