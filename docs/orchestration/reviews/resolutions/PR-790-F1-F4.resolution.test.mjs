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

// Evidence-hash derivation (authoritative): each `evidenceRefs` entry is `<name>@<sha256>`, where the digest is
// the SHA-256 of the referenced file's CONTENT with line endings normalized to LF (CRLF → LF before hashing).
// Content — not on-disk bytes — is what the evidence pins: a Windows checkout smudges LF→CRLF, so hashing raw
// working-tree bytes would drift by platform (green on CI/LF, red on a Windows dev machine) for identical content.
// Normalizing makes the assertion deterministic on every platform. Regenerate after an intentional source change
// with the same normalization (see docs/orchestration/reviews/resolutions/README derivation note).
const lfNormalizedHash = (absPath) => {
  const raw = readFileSync(absPath);
  const lf = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  return createHash("sha256").update(lf).digest("hex");
};

test("every file-hash evidence reference matches current bytes", () => {
  let checked = 0;
  for (const finding of artifact.findings) for (const ref of finding.evidenceRefs) {
    const split = ref.lastIndexOf("@"); if (split < 0) continue;
    const name = ref.slice(0, split), expected = ref.slice(split + 1);
    const path = [...new Set([`docs/orchestration/lib/${name}`, `integrations/chatgpt-eos-intake/test/${name}`, ...finding.codeRefs])].find((p) => { try { readFileSync(resolve(root, p)); return true; } catch { return false; } });
    assert.ok(path, `resolve ${name}`);
    assert.equal(lfNormalizedHash(resolve(root, path)), expected, ref);
    checked++;
  }
  // Regression guard: the loop must actually verify evidence — a refactor that silently stops resolving refs
  // would otherwise make this test vacuously pass. F1–F4 carry ten evidence references.
  assert.equal(checked, 10, "every F1–F4 evidence reference is verified, none silently skipped");
});

test("prior token section attribution is honest and classified as broad feed, not instrumentation defect", () => {
  const s = artifact.tokenFinding.priorSections;
  assert.equal(s.question + s.facts + s.authority + s.deterministicEvidence + s.rawSource + s.provenance + s.protocol + s.schema, s.estimatedTotal);
  assert.equal(artifact.tokenFinding.classification, "B"); assert.ok(s.rawSource > s.estimatedTotal * 0.8);
});
