import test from "node:test";
import assert from "node:assert/strict";
import { detectUnextracted } from "./unextractedResults.mjs";

const COMPLETE = { status: "COMPLETE", findings: [] };

test("the EOS-ISSUE-852 case: COMPLETE/0 findings but severity-ranked prose → UNEXTRACTED", () => {
  const content = `## Sector 03 — Dispatch

### Findings

**1. MEDIUM — assignedTechId written with no server-side availability check**
- evidence here

**2. MEDIUM — dead but rules-authorized legacy path**
`;
  const r = detectUnextracted({ result: COMPLETE, content });
  assert.equal(r.unextracted, true);
  assert.ok(r.signalCount > 0);
  assert.match(r.reason, /UNEXTRACTED/);
});

test("a genuine clean verdict is NOT flagged", () => {
  const content = `## Sector 06 — Cloud Functions

### Findings

No security-relevant findings. This is an unusually well-defended surface.
`;
  assert.equal(detectUnextracted({ result: COMPLETE, content }).unextracted, false);
});

test("an eos-findings block means the empty result is trustworthy", () => {
  const content = "## Report\n\n**HIGH** something\n\n```eos-findings\n[]\n```";
  const r = detectUnextracted({ result: COMPLETE, content });
  assert.equal(r.unextracted, false);
  assert.match(r.reason, /block present/);
});

test("a result that already carries findings is not re-flagged", () => {
  const r = detectUnextracted({ result: { status: "COMPLETE", findings: [{ file: "a.ts" }] }, content: "**HIGH** x" });
  assert.equal(r.unextracted, false);
});

test("non-COMPLETE results are out of scope — already visible as a problem", () => {
  assert.equal(detectUnextracted({ result: { status: "EXTRACTION_INVALID", findings: [] }, content: "**HIGH** x" }).unextracted, false);
  assert.equal(detectUnextracted({ result: { status: "BLOCKED_EXECUTION", findings: [] }, content: "**HIGH** x" }).unextracted, false);
});

test("empty content is not flagged — nothing to re-read", () => {
  assert.equal(detectUnextracted({ result: COMPLETE, content: "   " }).unextracted, false);
});

test("accepts disposition as an alias for status", () => {
  const r = detectUnextracted({ result: { disposition: "COMPLETE", findings: [] }, content: "### Findings\n\n**1. HIGH — x**" });
  assert.equal(r.unextracted, true);
});

test("missing/garbage input does not throw", () => {
  assert.doesNotThrow(() => detectUnextracted());
  assert.doesNotThrow(() => detectUnextracted({}));
  assert.equal(detectUnextracted({ result: {}, content: "" }).unextracted, false);
});
