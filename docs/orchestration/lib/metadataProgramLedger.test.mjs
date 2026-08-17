// Tests for the metadata program execution ledger model.
//
// These target ONE property above all: the ledger must never be able to read as
// further along than the repository actually is. A status claiming a merge with no
// merge SHA, a blocker with no reason, an exemption with no justification — each of
// those would mislead a resuming session into skipping real work, which is the
// specific failure this program cannot afford across session boundaries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS, KIND, CLASSIFICATION, DEPLOY, GATE,
  makeEntry, validateEntry, validateLedger, selectExecutable, reconcile, conformance, renderMarkdown,
} from "./metadataProgramLedger.mjs";

const base = {
  id: "X-1", phase: "1", kind: "ARCHITECTURE", title: "t", domain: "d",
  entity: "e", status: "READY", nextAction: "do the thing",
};

test("enums are frozen and carry the states the program ruling requires", () => {
  for (const s of ["IMPLEMENTING", "READY", "REVIEW_QUEUED", "MERGE_QUEUED", "MERGED",
    "DEPLOY_QUEUED", "BLOCKED_PROTECTED", "BLOCKED_DEPENDENCY", "EXEMPT", "COMPLETE"]) {
    assert.ok(STATUS.includes(s), `${s} missing from STATUS`);
  }
  assert.throws(() => { STATUS.push("NOPE"); });
  assert.ok(Object.isFrozen(KIND) && Object.isFrozen(CLASSIFICATION) && Object.isFrozen(DEPLOY) && Object.isFrozen(GATE));
});

test("a valid entry produces no problems", () => {
  assert.deepEqual(validateEntry(makeEntry(base)), []);
});

test("unknown status, kind, deploy and gate values are rejected", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "DONE" })).some((p) => /not a known STATUS/.test(p)));
  assert.ok(validateEntry(makeEntry({ ...base, kind: "THING" })).some((p) => /not a known KIND/.test(p)));
  assert.ok(validateEntry(makeEntry({ ...base, deploy: "LIVE" })).some((p) => /not a known DEPLOY/.test(p)));
  assert.ok(validateEntry(makeEntry({ ...base, gate: "GATE_Z" })).some((p) => /not a known GATE/.test(p)));
});

test("a SURFACE without route or classification is rejected — conformance depends on both", () => {
  const p = validateEntry(makeEntry({ ...base, kind: "SURFACE" }));
  assert.ok(p.some((x) => /requires a route/.test(x)));
  assert.ok(p.some((x) => /requires a valid classification/.test(x)));
  assert.deepEqual(
    validateEntry(makeEntry({ ...base, kind: "SURFACE", route: "/customers", classification: "A_ENTITY_LIST" })),
    []
  );
});

test("MERGED without a mergeSha is rejected — never record a merge without proof", () => {
  const p = validateEntry(makeEntry({ ...base, status: "MERGED" }));
  assert.ok(p.some((x) => /requires a mergeSha/.test(x)));
  assert.deepEqual(validateEntry(makeEntry({ ...base, status: "MERGED", mergeSha: "d90db46e" })), []);
});

test("DEPLOY_QUEUED also requires a mergeSha — deploy queues only hold merged work", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "DEPLOY_QUEUED" })).some((x) => /requires a mergeSha/.test(x)));
});

test("MERGE_QUEUED requires both PR and exact head SHA", () => {
  const p = validateEntry(makeEntry({ ...base, status: "MERGE_QUEUED" }));
  assert.ok(p.some((x) => /requires a pr number/.test(x)));
  assert.ok(p.some((x) => /requires the exact headSha/.test(x)));
  assert.deepEqual(validateEntry(makeEntry({ ...base, status: "MERGE_QUEUED", pr: 1101, headSha: "abc123" })), []);
});

test("blocked entries must say why, and protected blocks must name the decision they await", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "BLOCKED_PROTECTED" }))
    .some((x) => /requires at least one blocker/.test(x)));

  const noDecision = validateEntry(makeEntry({
    ...base, status: "BLOCKED_PROTECTED", blockers: [{ reason: "needs a Rules change" }],
  }));
  assert.ok(noDecision.some((x) => /requires the requiredDecision/.test(x)));

  assert.deepEqual(validateEntry(makeEntry({
    ...base, status: "BLOCKED_PROTECTED",
    blockers: [{ reason: "needs a Rules change", requiredDecision: "Owner authorizes firestore.rules deploy" }],
  })), []);
});

test("BLOCKED_DEPENDENCY requires a dependsOn, and dependsOn must reference a real entry", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "BLOCKED_DEPENDENCY", blockers: [{ reason: "waiting" }] }))
    .some((x) => /requires at least one dependsOn/.test(x)));

  const ids = new Set(["X-1"]);
  assert.ok(validateEntry(makeEntry({ ...base, dependsOn: ["GHOST"] }), ids)
    .some((x) => /not a known entry id/.test(x)));
});

test("EXEMPT requires a stated reason — otherwise conformance counts skipped work as intentional", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "EXEMPT" })).some((x) => /requires notes/.test(x)));
  assert.deepEqual(validateEntry(makeEntry({ ...base, status: "EXEMPT", notes: "board, not a list" })), []);
});

test("REVIEW_QUEUED must name its gate", () => {
  assert.ok(validateEntry(makeEntry({ ...base, status: "REVIEW_QUEUED" })).some((x) => /requires gate/.test(x)));
  assert.deepEqual(validateEntry(makeEntry({ ...base, status: "REVIEW_QUEUED", gate: "GATE_A" })), []);
});

test("duplicate ids and dependency cycles are caught at ledger level", () => {
  const dup = validateLedger({ entries: [makeEntry(base), makeEntry(base)] });
  assert.ok(dup.some((p) => /duplicate entry id/.test(p)));

  const cyc = validateLedger({
    entries: [
      makeEntry({ ...base, id: "A", dependsOn: ["B"] }),
      makeEntry({ ...base, id: "B", dependsOn: ["A"] }),
    ],
  });
  assert.ok(cyc.some((p) => /dependency cycle/.test(p)));
});

test("selectExecutable never returns an item whose dependency is merely MERGE_QUEUED", () => {
  const ledger = {
    entries: [
      makeEntry({ ...base, id: "FOUNDATION", status: "MERGE_QUEUED", pr: 1, headSha: "aaa" }),
      makeEntry({ ...base, id: "CONSUMER", status: "READY", dependsOn: ["FOUNDATION"] }),
      makeEntry({ ...base, id: "INDEPENDENT", status: "READY" }),
    ],
  };
  const next = selectExecutable(ledger).map((e) => e.id);
  assert.deepEqual(next, ["INDEPENDENT"], "must not build on an unmerged architecture PR");
});

test("selectExecutable treats MERGED, COMPLETE and EXEMPT dependencies as satisfied", () => {
  for (const status of ["MERGED", "COMPLETE", "EXEMPT"]) {
    const dep = { ...base, id: "DEP", status };
    if (status === "MERGED") dep.mergeSha = "abc";
    if (status === "EXEMPT") dep.notes = "n/a";
    const ledger = {
      entries: [makeEntry(dep), makeEntry({ ...base, id: "C", status: "READY", dependsOn: ["DEP"] })],
    };
    assert.deepEqual(selectExecutable(ledger).map((e) => e.id), ["C"], `dependency ${status} should satisfy`);
  }
});

test("selectExecutable orders by phase numerically, not lexically", () => {
  const ledger = {
    entries: [
      makeEntry({ ...base, id: "P10", phase: "10" }),
      makeEntry({ ...base, id: "P2", phase: "2" }),
    ],
  };
  assert.deepEqual(selectExecutable(ledger).map((e) => e.id), ["P2", "P10"]);
});

test("reconcile reports a MERGE_QUEUED claim that GitHub says is already merged", () => {
  const ledger = { entries: [makeEntry({ ...base, status: "MERGE_QUEUED", pr: 1092, headSha: "aaa" })] };
  const out = reconcile(ledger, { prs: { 1092: { state: "MERGED", mergeCommit: "d90db46e" } } });
  assert.equal(out.length, 1);
  assert.match(out[0].observation, /is MERGED/);
});

test("reconcile reports a closed-without-merge PR as abandoned, not queued", () => {
  const ledger = { entries: [makeEntry({ ...base, status: "MERGE_QUEUED", pr: 7, headSha: "aaa" })] };
  const out = reconcile(ledger, { prs: { 7: { state: "CLOSED" } } });
  assert.match(out[0].observation, /abandoned/);
});

test("reconcile catches a moved head — recorded checks no longer describe the PR", () => {
  const ledger = { entries: [makeEntry({ ...base, status: "MERGE_QUEUED", pr: 7, headSha: "aaa" })] };
  const out = reconcile(ledger, { prs: { 7: { state: "OPEN", headSha: "bbb" } } });
  assert.match(out[0].observation, /head is now bbb/);
});

test("reconcile disproves a MERGED claim whose sha is absent from origin/main", () => {
  const ledger = { entries: [makeEntry({ ...base, status: "MERGED", mergeSha: "deadbeef" })] };
  const out = reconcile(ledger, { mainShas: ["d90db46e", "964d82a7"] });
  assert.equal(out.length, 1);
  assert.match(out[0].observation, /not found on origin\/main/);
});

test("reconcile stays silent when claims and observations agree", () => {
  const ledger = { entries: [makeEntry({ ...base, status: "MERGED", pr: 1092, mergeSha: "d90db46e" })] };
  assert.deepEqual(reconcile(ledger, { prs: { 1092: { state: "MERGED" } }, mainShas: ["d90db46e"] }), []);
});

test("conformance counts only surfaces, and blocked surfaces count as accounted for", () => {
  const ledger = {
    entries: [
      makeEntry({ ...base, id: "S1", kind: "SURFACE", route: "/a", classification: "A_ENTITY_LIST", status: "COMPLETE" }),
      makeEntry({ ...base, id: "S2", kind: "SURFACE", route: "/b", classification: "C_OPERATIONAL_COMPOSITE", status: "EXEMPT", notes: "board" }),
      makeEntry({ ...base, id: "S3", kind: "SURFACE", route: "/c", classification: "A_ENTITY_LIST", status: "READY" }),
      makeEntry({ ...base, id: "A1", kind: "ARCHITECTURE", status: "READY" }),
    ],
  };
  const c = conformance(ledger);
  assert.equal(c.totalSurfaces, 3, "architecture entries are not surfaces");
  assert.equal(c.accountedFor, 2);
  assert.equal(c.unaccountedFor, 1);
});

test("renderMarkdown states plainly that the ledger is a cache and the repo is truth", () => {
  const md = renderMarkdown({ baseline: "d90db46e", entries: [makeEntry(base)] });
  assert.match(md, /do not hand-edit/i);
  assert.match(md, /GitHub and `origin\/main` are truth/);
  assert.match(md, /## READY/);
});

test("renderMarkdown does not claim completion when nothing is executable", () => {
  const md = renderMarkdown({
    baseline: "x",
    entries: [makeEntry({ ...base, status: "BLOCKED_PROTECTED", blockers: [{ reason: "r", requiredDecision: "d" }] })],
  });
  assert.match(md, /Nothing executable/);
  assert.match(md, /before concluding the program is finished/);
});

test("BLOCKED_DEPENDENCY does not require a prose blocker — dependsOn already states the reason", () => {
  // Found by running the validator against the first real ledger: demanding both a
  // dependsOn and a restated prose blocker produced pure duplication on every row.
  assert.deepEqual(
    validateEntry(makeEntry({ ...base, status: "BLOCKED_DEPENDENCY", dependsOn: ["OTHER"] })),
    []
  );
});

test("authored JSON may omit defaulted fields; makeEntry normalizes before validation", () => {
  // The renderer maps raw JSON through makeEntry for exactly this reason — terse
  // authored JSON, strict model.
  const fromJson = { id: "J-1", phase: "1", kind: "ARCHITECTURE", title: "t", domain: "d", status: "READY" };
  assert.deepEqual(validateEntry(makeEntry(fromJson)), []);
});


// --- dependencies must be REAL, not chronological (Owner ruling 2026-08-17 §1) ---
//
// This is the defect that produced a false program-wide stop. A-CONTRACT-CORE declared
// dependsOn P0-LEDGER purely because the ledger was built first: a documentation
// artifact was recorded as blocking an independent code foundation on a disjoint path.
// The scheduler then correctly refused to run the contracts, correctly reported no
// executable work, and the whole program halted on an edge that described history
// rather than necessity.
//
// A dependency edge is a claim that one item CANNOT PROCEED until another lands. These
// guard the two properties that make that claim checkable.

test("§1 — a dependency edge is only satisfied by MERGED, COMPLETE or EXEMPT", () => {
  // The scheduler's meaning of "dependency" must stay strict, because the weaker the
  // edge, the more tempting it is to add edges that merely express ordering.
  for (const status of ["READY", "IMPLEMENTING", "MERGE_QUEUED", "REVIEW_QUEUED", "DEPLOY_QUEUED",
    "BLOCKED_PROTECTED", "BLOCKED_DEPENDENCY"]) {
    const dep = { ...base, id: "DEP", status };
    if (status === "MERGE_QUEUED") { dep.pr = 1; dep.headSha = "aaa"; }
    if (status === "DEPLOY_QUEUED") dep.mergeSha = "abc";
    if (status === "BLOCKED_PROTECTED") dep.blockers = [{ reason: "r", requiredDecision: "d" }];
    if (status === "BLOCKED_DEPENDENCY") dep.dependsOn = ["X-1"];
    const ledger = {
      entries: [
        makeEntry({ ...base, id: "X-1" }),
        makeEntry(dep),
        makeEntry({ ...base, id: "CONSUMER", status: "READY", dependsOn: ["DEP"] }),
      ],
    };
    assert.ok(
      !selectExecutable(ledger).some((e) => e.id === "CONSUMER"),
      `dependency in ${status} must not be treated as satisfied`
    );
  }
});

test("§1 — a docs-only entry never blocks a code entry, which is the exact false edge that stopped the program", () => {
  // Regression for the real incident, expressed as the shape rather than the instance:
  // an ARCHITECTURE code item that depends on a doc-shaped item is executable when that
  // is the ONLY thing holding it, because the two cannot technically block each other.
  const withFalseEdge = {
    entries: [
      makeEntry({ ...base, id: "LEDGER-DOC", status: "MERGE_QUEUED", pr: 1101, headSha: "aaa" }),
      makeEntry({ ...base, id: "CODE-FOUNDATION", status: "READY", dependsOn: ["LEDGER-DOC"] }),
    ],
  };
  assert.deepEqual(
    selectExecutable(withFalseEdge).map((e) => e.id),
    [],
    "with the false edge present the scheduler correctly refuses — the bug was the EDGE, not the scheduler"
  );

  const corrected = {
    entries: [
      makeEntry({ ...base, id: "LEDGER-DOC", status: "MERGE_QUEUED", pr: 1101, headSha: "aaa" }),
      makeEntry({ ...base, id: "CODE-FOUNDATION", status: "READY", dependsOn: [] }),
    ],
  };
  assert.deepEqual(
    selectExecutable(corrected).map((e) => e.id),
    ["CODE-FOUNDATION"],
    "removing a dependency that was never technically real must re-open the lane"
  );
});

test("§1 — the shipped ledger declares no dependency on the ledger's own docs entry", () => {
  // Guards the specific regression in the real data, not just in a fixture.
  const raw = JSON.parse(
    readFileSync(new URL("../metadata-program/ledger.json", import.meta.url), "utf8")
  );
  for (const e of raw.entries ?? []) {
    assert.ok(
      !(e.dependsOn ?? []).includes("P0-LEDGER"),
      `${e.id} depends on P0-LEDGER — the ledger is a docs artifact and cannot technically block code`
    );
  }
});
