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
