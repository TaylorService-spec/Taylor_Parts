import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const artifact = JSON.parse(readFileSync(resolve(root, "docs/orchestration/reviews/resolutions/PR-790-F1-F4.resolution.json"), "utf8"));

test("resolution artifact maps exactly F1-F4 with deterministic evidence and no provider call", () => {
  assert.deepEqual(artifact.findings.map((f) => f.findingId), ["F1", "F2", "F3", "F4"]);
  for (const finding of artifact.findings) { assert.equal(finding.disposition, "RESOLVED"); assert.ok(finding.codeRefs.length && finding.tests.length && finding.evidenceRefs.length); }
  assert.equal(artifact.verification.providerCallsDuringResolution, 0);
});

test("every file-hash evidence reference matches current bytes", () => {
  for (const finding of artifact.findings) for (const ref of finding.evidenceRefs) {
    const split = ref.lastIndexOf("@"); if (split < 0) continue;
    const name = ref.slice(0, split), expected = ref.slice(split + 1);
    const path = [...new Set([`docs/orchestration/lib/${name}`, `integrations/chatgpt-eos-intake/test/${name}`, ...finding.codeRefs])].find((p) => { try { readFileSync(resolve(root, p)); return true; } catch { return false; } });
    assert.ok(path, `resolve ${name}`);
    assert.equal(createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"), expected, ref);
  }
});

test("prior token section attribution is honest and classified as broad feed, not instrumentation defect", () => {
  const s = artifact.tokenFinding.priorSections;
  assert.equal(s.question + s.facts + s.authority + s.deterministicEvidence + s.rawSource + s.provenance + s.protocol + s.schema, s.estimatedTotal);
  assert.equal(artifact.tokenFinding.classification, "B"); assert.ok(s.rawSource > s.estimatedTotal * 0.8);
});
