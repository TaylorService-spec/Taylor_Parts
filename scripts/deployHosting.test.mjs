import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { resolveDeployTarget, assertManifestMatchesTarget } from "./deployHosting.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(resolvePath(HERE, "../config/environments.json"), "utf8"),
);

// The Gate 1 slip: an omitted environment resolved to the registry default,
// which is production, and the sandbox got an artifact stamped "production".
test("an omitted environment is an error, never an implicit production target", () => {
  assert.throws(() => resolveDeployTarget(REGISTRY, null), /REFUSING.*required/s);
  assert.throws(() => resolveDeployTarget(REGISTRY, ""), /REFUSING.*required/s);
});

// These two are already refused upstream by resolveEnvironment itself, which
// throws EnvironmentResolutionError before this script's own checks run. The
// assertions match that real behaviour rather than this script's wording --
// what matters is that neither can reach a deploy.
test("unknown environments fail closed", () => {
  assert.throws(
    () => resolveDeployTarget(REGISTRY, "not-a-real-env"),
    /Unknown environment.*Refusing to fall back to a default/s,
  );
});

test("unprovisioned environments cannot be deployed to", () => {
  // platform-integration is declared but not provisioned; it has no project.
  assert.throws(
    () => resolveDeployTarget(REGISTRY, "platform-integration"),
    /has no Firebase identity|not been provisioned/,
  );
});

test("sandbox resolves without extra confirmation", () => {
  const t = resolveDeployTarget(REGISTRY, "platform-sandbox");
  assert.equal(t.id, "platform-sandbox");
  assert.equal(t.role, "sandbox");
  assert.equal(t.projectId, "eos-platform-sandbox");
});

test("a production target requires explicit --allow-production", () => {
  assert.throws(
    () => resolveDeployTarget(REGISTRY, "taylor-parts-production"),
    /role 'production'.*--allow-production/s,
  );
  const t = resolveDeployTarget(REGISTRY, "taylor-parts-production", { allowProduction: true });
  assert.equal(t.role, "production");
  assert.equal(t.projectId, "taylor-parts");
});

// This is the assertion that would have stopped the Gate 1 deploy.
test("an artifact that misidentifies its environment is refused before deploy", () => {
  const target = { id: "platform-sandbox", role: "sandbox", projectId: "eos-platform-sandbox" };
  const wrong = { environmentId: "taylor-parts-production", environmentRole: "production", commit: "abc1234" };
  assert.throws(() => assertManifestMatchesTarget(wrong, target), /misreports its own environment/);

  const roleOnlyMismatch = { environmentId: "platform-sandbox", environmentRole: "production" };
  assert.throws(() => assertManifestMatchesTarget(roleOnlyMismatch, target), /REFUSING/);
});

test("a matching artifact passes", () => {
  const target = { id: "platform-sandbox", role: "sandbox", projectId: "eos-platform-sandbox" };
  const good = { environmentId: "platform-sandbox", environmentRole: "sandbox", commit: "abc1234" };
  assert.equal(assertManifestMatchesTarget(good, target), true);
});
