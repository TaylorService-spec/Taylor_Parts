import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFinding, validateFindings, normalizeFinding, SEVERITIES } from "./findingSchema.mjs";

const good = {
  file: "functions/src/transitionWorkOrder.ts",
  symbol: "transitionWorkOrder",
  discriminator: "no-technician-availability-check",
  severity: "HIGH",
  category: "concurrency",
  evidence: "No availability/conflict check anywhere in the file; Dispatch assigns assignedTechId unconditionally.",
  line: 64,
};

test("a complete structured finding is valid and normalizes to the canonical shape", () => {
  const r = validateFinding(good);
  assert.equal(r.ok, true, r.errors.join("; "));
  const n = normalizeFinding(good);
  assert.equal(n.discriminator, "no-technician-availability-check");
  assert.equal(n.symbol, "transitionWorkOrder");
  assert.equal(n.file, "functions/src/transitionWorkOrder.ts");
});

test("missing discriminator fails closed (the load-bearing identity)", () => {
  const r = validateFinding({ ...good, discriminator: undefined });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /discriminator must be a stable/);
});

test("a non-slug discriminator is rejected (must be stable kebab, not free prose)", () => {
  for (const bad of ["No Availability Check", "UPPER", "has_underscore", "-leading", "x", "a".repeat(90)]) {
    assert.equal(validateFinding({ ...good, discriminator: bad }).ok, false, `rejected: ${bad}`);
  }
});

test("evidence is required — a finding must be verifiable", () => {
  assert.equal(validateFinding({ ...good, evidence: "" }).ok, false);
  assert.match(validateFinding({ ...good, evidence: undefined }).errors.join(" "), /evidence is required/);
});

test("file must be repo-relative — no absolute path, no traversal", () => {
  assert.equal(validateFinding({ ...good, file: "/etc/passwd" }).ok, false);
  assert.equal(validateFinding({ ...good, file: "../../secret" }).ok, false);
  assert.equal(validateFinding({ ...good, file: "src/ok.ts" }).ok, true);
});

test("bad severity is rejected", () => {
  assert.equal(validateFinding({ ...good, severity: "URGENT" }).ok, false);
  assert.ok(SEVERITIES.includes("CRITICAL"));
});

test("symbol is optional; a file-level finding (no symbol) is still valid", () => {
  const { symbol, ...noSymbol } = good;
  assert.equal(validateFinding(noSymbol).ok, true);
  assert.equal(normalizeFinding(noSymbol).symbol, null);
});

test("validateFindings separates valid (normalized) from invalid (with errors) — fail closed", () => {
  const out = validateFindings([
    good,
    { file: "a.ts", severity: "LOW", category: "x", evidence: "y" }, // no discriminator → invalid
    { ...good, discriminator: "another-issue-here" },
  ]);
  assert.equal(out.valid.length, 2, "only fully-contracted findings pass");
  assert.equal(out.invalid.length, 1);
  assert.match(out.invalid[0].errors.join(" "), /discriminator/);
  assert.ok(Object.isFrozen(out.valid[0]), "valid findings are normalized + frozen");
});

import { extractFindings, childFromResult } from "./findingSchema.mjs";

const WORKER_OUTPUT = `# Sector audit: work-order lifecycle

Some human-readable analysis here...

\`\`\`eos-findings
[
  { "file": "functions/src/transitionWorkOrder.ts", "symbol": "transitionWorkOrder", "discriminator": "no-technician-availability-check", "severity": "HIGH", "category": "concurrency", "evidence": "No availability check anywhere in the file.", "line": 64 },
  { "file": "functions/src/x.ts", "discriminator": "vague", "severity": "NOPE", "category": "", "evidence": "" }
]
\`\`\`

More prose after.`;

test("extractFindings pulls the eos-findings block, validates, and separates invalid", () => {
  const ex = extractFindings(WORKER_OUTPUT);
  assert.equal(ex.found, true);
  assert.equal(ex.findings.length, 1, "only the valid finding passes the contract");
  assert.equal(ex.findings[0].discriminator, "no-technician-availability-check");
  assert.equal(ex.invalid.length, 1, "the malformed one is separated, not accepted");
});

test("extractFindings fail-closed: no block / bad JSON → found:false, no findings", () => {
  assert.equal(extractFindings("just markdown, no block").found, false);
  assert.equal(extractFindings("```eos-findings\n{not json\n```").found, false);
  assert.equal(extractFindings("```eos-findings\n{\"a\":1}\n```").found, false, "must be a JSON array");
  assert.deepEqual(extractFindings("nope").findings, []);
});

test("childFromResult wires worker output → dedup-able consolidation child", () => {
  const c = childFromResult({ requestId: "EOS-ISSUE-852-C02", sector: "work-orders", content: WORKER_OUTPUT });
  assert.equal(c.requestId, "EOS-ISSUE-852-C02");
  assert.equal(c.disposition, "COMPLETE");
  assert.equal(c.findings.length, 1);
  assert.equal(c.findingsExtraction.found, true);
  assert.equal(c.findingsExtraction.invalidCount, 1);
  // a worker that emitted nothing structured → empty findings (fail-closed downstream)
  const empty = childFromResult({ requestId: "X", content: "no findings block" });
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.findingsExtraction.found, false);
});
