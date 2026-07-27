// INV-CONVERGENCE-E C2 Hosting gate -- tests for scripts/c2LiveParity.mjs, the fresh
// live pre-deploy parity check. This script decides whether a production deployment
// proceeds, so its PASS path and (more importantly) every fail-closed path must be
// provable in CI rather than trusted.
//
// Fully offline: the "live" canonical payload is synthesized into Firestore REST shape
// from the committed production zero-write read-back (190) + the static catalog (200).
// No Firebase, no credentials, no network, no production access.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const SCRIPT = new URL("../scripts/c2LiveParity.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("c2LiveParity.test.mjs");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c2parity-"));

// ---- synthesize a Firestore REST capture from committed fixtures ------------
const catRe = /\{\s*sku:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)",\s*category:\s*"([^"]+)"/g;
const catBySku = {};
for (let m; (m = catRe.exec(CATALOG_SRC)); ) catBySku[m[1]] = m[3];
const reSummary = /^(TST-\d{4})\s+"(.*)"\s+unit=(\S+)\s+status=(\S+)$/;
const DOCS = POSTWRITE.map((r) => {
  const m = reSummary.exec(r.currentSummary || "");
  return {
    name: `projects/taylor-parts/databases/(default)/documents/parts/${r.proposedPartId}`,
    fields: {
      partId: { stringValue: r.proposedPartId },
      internalPartNumber: { stringValue: r.proposedPartId },
      name: { stringValue: m ? m[2] : "" },
      category: { stringValue: catBySku[r.proposedPartId] || "" },
      status: { stringValue: m ? m[4] : "ACTIVE" },
      stockingUnit: { stringValue: m ? m[3] : "EACH" },
      controlType: { stringValue: "STANDARD" },
      stockingClass: { stringValue: "STOCKED" },
      version: { integerValue: "1" },
    },
  };
});

let n = 0;
function write(obj) {
  const p = path.join(TMP, `capture-${n++}.json`);
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}
/** Run the script; return { code, out, resultJson }. Never throws on nonzero exit. */
function run(capturePath) {
  const outDir = path.join(TMP, `out-${n++}`);
  let code = 0, out = "";
  try {
    out = execFileSync(process.execPath, [SCRIPT, capturePath, outDir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  const resultPath = path.join(outDir, "c2-live-parity.json");
  const resultJson = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
  return { code, out, resultJson };
}

check("fixture sanity: 190 canonical docs synthesized", () => {
  assert.equal(DOCS.length, 190);
});

// ---- PASS path --------------------------------------------------------------
check("PASS on a complete live capture -- exit 0, 200 details ready, 190+10", () => {
  const { code, resultJson } = run(write({ documents: DOCS }));
  assert.equal(code, 0, "a complete capture must exit 0");
  assert.equal(resultJson.status, "PASS");
  assert.equal(resultJson.counts.canonicalValid, 190);
  assert.equal(resultJson.counts.staticCatalog, 200);
  assert.equal(resultJson.counts.detailReady, 200);
  assert.equal(resultJson.counts.canonicalMatch, 190);
  assert.equal(resultJson.counts.staticOnlyExcluded, 10);
  assert.deepEqual(resultJson.divergences, []);
  assert.equal(resultJson.exclusionSetMatchesApproved, true);
  assert.equal(resultJson.listMeta.unitDivergenceCount, 0);
  assert.equal(resultJson.listMeta.nameDivergenceCount, 0);
});

check("PASS is deterministic: same capture -> same runId and same result", () => {
  const p = write({ documents: DOCS });
  const a = run(p), b = run(p);
  assert.equal(a.resultJson.runId, b.resultJson.runId, "runId must derive from the capture, not a clock/random");
  assert.deepEqual(a.resultJson, b.resultJson);
});

check("capture provenance is recorded (payload + static catalog hashes)", () => {
  const { resultJson } = run(write({ documents: DOCS }));
  assert.match(resultJson.capture.payloadSha256, /^[0-9a-f]{64}$/);
  assert.match(resultJson.capture.staticCatalogSha256, /^[0-9a-f]{64}$/);
  assert.ok(resultJson.runId.startsWith("c2-live-"));
});

// ---- FAIL-CLOSED paths: every one must exit NONZERO --------------------------
check("BLOCKED_PERMISSION on a denied canonical read -- never an empty list as success", () => {
  const { code, resultJson } = run(write({ error: { status: "PERMISSION_DENIED", code: 403 } }));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_PERMISSION");
});

check("BLOCKED_UNAVAILABLE on a non-permission read error", () => {
  const { code, resultJson } = run(write({ error: { status: "UNAVAILABLE", code: 503 } }));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_UNAVAILABLE");
});

check("BLOCKED_INCOMPLETE_INPUT on a paginated (truncated) capture", () => {
  const { code, resultJson } = run(write({ documents: DOCS, nextPageToken: "more" }));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.match(resultJson.reason, /paginated|incomplete/i);
});

check("BLOCKED_INCOMPLETE_INPUT on malformed JSON", () => {
  const { code, resultJson } = run(write("this is not json"));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
});

check("BLOCKED_INCOMPLETE_INPUT on an unexpected payload shape", () => {
  const { code, resultJson } = run(write({ unexpected: true }));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
});

check("an EMPTY canonical capture BLOCKS -- it is never reported as a successful parity", () => {
  const { code, resultJson } = run(write({ documents: [] }));
  assert.equal(code, 1);
  assert.notEqual(resultJson.status, "PASS");
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
});

check("omitting a single canonical Part BLOCKS the deploy (no silent partial cutover)", () => {
  const short = DOCS.slice(0, DOCS.length - 1);
  const { code, resultJson } = run(write({ documents: short }));
  assert.equal(code, 1);
  assert.notEqual(resultJson.status, "PASS");
});

// ---- P1 regression (PR #447 Codex review): a malformed canonical RECORD -----
// Without this gate, 190 valid records + 1 corrupt document still composed
// 190 + 10 = 200 with zero divergences and returned PASS while merely *reporting*
// canonicalInvalid: 1 -- i.e. it would have deployed over an unreadable canonical record.
check("190 valid + 1 MALFORMED canonical record -> BLOCKED_INCOMPLETE_INPUT, exit nonzero", () => {
  const malformed = {
    name: "projects/taylor-parts/databases/(default)/documents/parts/TST-BROKEN",
    fields: {
      partId: { stringValue: "TST-BROKEN" },
      // internalPartNumber missing, status not a PART_STATUS, stockingUnit not a UNIT_CODE
      name: { stringValue: "Structurally invalid record" },
      status: { stringValue: "NOT_A_REAL_STATUS" },
      stockingUnit: { stringValue: "furlong" },
      controlType: { stringValue: "STANDARD" },
      stockingClass: { stringValue: "STOCKED" },
    },
  };
  const { code, resultJson } = run(write({ documents: [...DOCS, malformed] }));
  assert.equal(code, 1, "a malformed canonical record must stop the deploy");
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.match(resultJson.reason, /malformed Part record/i);
  assert.equal(resultJson.counts.canonicalInvalid, 1);
  assert.equal(resultJson.counts.canonicalValid, 190, "the 190 valid records are still counted");
  assert.notEqual(resultJson.status, "PASS");
});

check("malformed-record evidence is sanitized -- count only, no document contents", () => {
  const malformed = {
    name: "projects/taylor-parts/databases/(default)/documents/parts/TST-SECRETish",
    fields: {
      partId: { stringValue: "TST-SECRETish" },
      name: { stringValue: "UNIQUE-MARKER-SHOULD-NOT-APPEAR-IN-EVIDENCE" },
      status: { stringValue: "BOGUS" },
      stockingUnit: { stringValue: "bogus" },
    },
  };
  const { resultJson } = run(write({ documents: [...DOCS, malformed] }));
  const serialized = JSON.stringify(resultJson);
  assert.ok(!serialized.includes("UNIQUE-MARKER-SHOULD-NOT-APPEAR-IN-EVIDENCE"),
    "raw document field values must never enter the evidence");
  assert.ok(!serialized.includes("TST-SECRETish"),
    "the malformed record's document id must not be echoed into the evidence");
  assert.equal(resultJson.counts.canonicalInvalid, 1, "only the count is recorded");
});

check("multiple malformed records are all counted and still BLOCK", () => {
  const bad = (id) => ({
    name: `projects/taylor-parts/databases/(default)/documents/parts/${id}`,
    fields: { partId: { stringValue: id }, name: { stringValue: id }, status: { stringValue: "X" }, stockingUnit: { stringValue: "x" } },
  });
  const { code, resultJson } = run(write({ documents: [...DOCS, bad("B1"), bad("B2"), bad("B3")] }));
  assert.equal(code, 1);
  assert.equal(resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(resultJson.counts.canonicalInvalid, 3);
});

check("a malformed record BLOCKS even when the 200-record composition would otherwise be complete", () => {
  // the decisive property: full expected composition + one corrupt record must NOT pass
  const malformed = {
    name: "projects/taylor-parts/databases/(default)/documents/parts/TST-EXTRA-BROKEN",
    fields: { partId: { stringValue: "TST-EXTRA-BROKEN" }, name: { stringValue: "x" }, status: { stringValue: "?" }, stockingUnit: { stringValue: "?" } },
  };
  const clean = run(write({ documents: DOCS }));
  assert.equal(clean.resultJson.status, "PASS", "control: the same 190 pass without the corrupt record");
  const dirty = run(write({ documents: [...DOCS, malformed] }));
  assert.notEqual(dirty.resultJson.status, "PASS", "adding one corrupt record must flip PASS -> BLOCKED");
  assert.equal(dirty.resultJson.status, "BLOCKED_INCOMPLETE_INPUT");
});

check("a duplicated canonical Part BLOCKS (ambiguous identity never deploys)", () => {
  const { code, resultJson } = run(write({ documents: [...DOCS, DOCS[0]] }));
  assert.equal(code, 1);
  assert.notEqual(resultJson.status, "PASS");
});

check("a canonical name change from the static catalog is reported, not silently accepted", () => {
  // canonical is authoritative, so this is not an error -- but it MUST surface as a
  // counted divergence in the evidence rather than passing invisibly.
  const mutated = DOCS.map((d, i) =>
    i === 0 ? { ...d, fields: { ...d.fields, name: { stringValue: "DIVERGENT NAME FOR PARITY TEST" } } } : d);
  const { resultJson } = run(write({ documents: mutated }));
  assert.ok(resultJson.listMeta.nameDivergenceCount >= 1, "a name divergence must be counted in the evidence");
});

check("a canonical stocking-unit change is caught as a UNIT_DIVERGENCE and BLOCKS", () => {
  const mutated = DOCS.map((d, i) =>
    i === 0 ? { ...d, fields: { ...d.fields, stockingUnit: { stringValue: "BOX" } } } : d);
  const { code, resultJson } = run(write({ documents: mutated }));
  assert.equal(code, 1, "a unit divergence must stop the deploy");
  assert.ok(resultJson.divergences.some((x) => x.kind === "UNIT_DIVERGENCE"));
});

check("every non-PASS status writes evidence AND exits nonzero (no silent stop-failure)", () => {
  for (const capture of [
    { error: { status: "PERMISSION_DENIED" } },
    { documents: [] },
    { documents: DOCS, nextPageToken: "x" },
  ]) {
    const { code, resultJson } = run(write(capture));
    assert.equal(code, 1, "must exit nonzero so the runbook's set -e stops the deploy");
    assert.ok(resultJson && resultJson.status !== "PASS", "must still write a result file for evidence");
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
