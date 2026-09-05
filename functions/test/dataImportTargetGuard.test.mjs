// EOS Data Import -- the sandbox-only boundary, proven in the BACKEND.
//
// Every case here calls the guard directly. No browser, no callable, no UI: if these
// pass, production is refused regardless of what any client sends.
//
// Run: node --test test/dataImportTargetGuard.test.mjs   (after `npm run build`)

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// House convention (see cycleCountCommand.test.mjs): import the compiled ../lib output
// by relative specifier. An absolute Windows path is not a valid ESM URL.
const {
  assertNonProductionImportTarget,
  describeImportTarget,
  ImportTargetRefusedError,
  PRODUCTION_PROJECT_ID,
} = await import("../lib/dataImport/importTargetGuard.js");

// The REAL registry -- these cases are about the environments this repository actually declares.
const REAL_REGISTRY = path.resolve(HERE, "..", "..", "config", "environments.json");

function refusal(fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImportTargetRefusedError) return e;
    throw e;
  }
  assert.fail("expected the guard to refuse, but it returned");
}

test("the real production project is refused by name", () => {
  const e = refusal(() => assertNonProductionImportTarget(PRODUCTION_PROJECT_ID, { registryPath: REAL_REGISTRY }));
  assert.equal(e.code, "TARGET_PRODUCTION_PROJECT");
});

test("a production-ROLE environment is refused even when it is not named taylor-parts", () => {
  // Deployment is independent of role (ADR-011): a differently-named production project
  // must be refused by role alone, with the by-name check removed from the picture.
  const dir = mkdtempSync(path.join(tmpdir(), "eos-import-guard-"));
  const p = path.join(dir, "environments.json");
  writeFileSync(
    p,
    JSON.stringify({
      environments: [
        { id: "someone-else-production", role: "production", firebase: { projectId: "another-customer-prod" } },
      ],
    }),
  );
  const e = refusal(() => assertNonProductionImportTarget("another-customer-prod", { registryPath: p }));
  assert.equal(e.code, "TARGET_PRODUCTION_ROLE");
});

test("an unknown project fails closed rather than defaulting to allowed", () => {
  const e = refusal(() => assertNonProductionImportTarget("not-a-real-project", { registryPath: REAL_REGISTRY }));
  assert.equal(e.code, "TARGET_UNKNOWN_ENVIRONMENT");
});

test("there is NO default target -- absence is a refusal", () => {
  for (const absent of [undefined, null, "", "   "]) {
    const e = refusal(() => assertNonProductionImportTarget(absent, { registryPath: REAL_REGISTRY }));
    assert.equal(e.code, "TARGET_MISSING", `expected TARGET_MISSING for ${JSON.stringify(absent)}`);
  }
});

test("a non-string target cannot smuggle past the string checks", () => {
  for (const weird of [0, 1, true, false, {}, [], { projectId: "eos-platform-sandbox" }]) {
    const e = refusal(() => assertNonProductionImportTarget(weird, { registryPath: REAL_REGISTRY }));
    assert.equal(e.code, "TARGET_MISSING");
  }
});

test("the sandbox IS allowed, and resolves to its registry identity", () => {
  const t = assertNonProductionImportTarget("eos-platform-sandbox", { registryPath: REAL_REGISTRY });
  assert.equal(t.projectId, "eos-platform-sandbox");
  assert.equal(t.environmentId, "platform-sandbox");
  assert.equal(t.role, "sandbox");
});

test("an unreadable registry refuses rather than allowing", () => {
  const e = refusal(() =>
    assertNonProductionImportTarget("eos-platform-sandbox", { registryPath: path.join(tmpdir(), "does-not-exist-eos.json") }),
  );
  assert.equal(e.code, "TARGET_REGISTRY_UNREADABLE");
});

test("every production-role environment in the REAL registry is refused", () => {
  // Data-driven: if a production environment is ever added to the registry, this test
  // covers it automatically rather than needing to be remembered.
  const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
  const productionProjects = registry.environments
    .filter((e) => e.role === "production" && e.firebase && e.firebase.projectId)
    .map((e) => e.firebase.projectId);
  assert.ok(productionProjects.length > 0, "the registry should declare at least one production environment");
  for (const p of productionProjects) {
    const e = refusal(() => assertNonProductionImportTarget(p, { registryPath: REAL_REGISTRY }));
    assert.ok(
      e.code === "TARGET_PRODUCTION_ROLE" || e.code === "TARGET_PRODUCTION_PROJECT",
      `expected ${p} to be refused as production, got ${e.code}`,
    );
  }
});

test("describeImportTarget reports refusals without throwing, and agrees with the throwing form", () => {
  const bad = describeImportTarget(PRODUCTION_PROJECT_ID, { registryPath: REAL_REGISTRY });
  assert.equal(bad.allowed, false);
  assert.equal(bad.code, "TARGET_PRODUCTION_PROJECT");

  const good = describeImportTarget("eos-platform-sandbox", { registryPath: REAL_REGISTRY });
  assert.equal(good.allowed, true);
  assert.equal(good.target.projectId, "eos-platform-sandbox");
});

// ---------------------------------------------------------------- the deployed shape

test("the guard resolves WITHOUT the repo-root registry file -- the deployed shape", () => {
  // THE DEFECT THIS PINS, and it reached the sandbox before any test saw it.
  //
  // The guard resolved config/environments.json by path from the repo root. That is correct
  // from a checkout and from the emulator, and WRONG from a deployed Function: only the
  // `functions/` directory is uploaded, so the file is not there. Deployed, the read failed,
  // the guard refused TARGET_REGISTRY_UNREADABLE, and every Data Import callable answered
  // "not available in this environment" -- in the one environment where it IS available.
  //
  // Every test ran from a checkout, where the file is exactly where the path says it is, so
  // nothing failed until a real call was made. This asserts the resolution the deployed
  // runtime actually performs: no registryPath, no file read, the bundled snapshot.
  const resolved = assertNonProductionImportTarget("eos-platform-sandbox");
  assert.equal(resolved.projectId, "eos-platform-sandbox");
  assert.equal(resolved.role, "sandbox");
});

test("the bundled path keeps every refusal -- production by name, unknown, and production role", () => {
  // The snapshot must not have bought reachability at the cost of the guard's whole point.
  assert.throws(
    () => assertNonProductionImportTarget("taylor-parts"),
    (err) => err instanceof ImportTargetRefusedError && err.code === "TARGET_PRODUCTION_PROJECT",
  );
  assert.throws(
    () => assertNonProductionImportTarget("some-project-nobody-provisioned"),
    (err) => err instanceof ImportTargetRefusedError && err.code === "TARGET_UNKNOWN_ENVIRONMENT",
  );
  for (const missing of ["", "   ", null, undefined, 42]) {
    assert.throws(
      () => assertNonProductionImportTarget(missing),
      (err) => err instanceof ImportTargetRefusedError && err.code === "TARGET_MISSING",
    );
  }
});

test("the bundled snapshot agrees with the canonical registry on every project's ROLE", () => {
  // The snapshot is what the deployed guard reads; config/environments.json is canonical. A
  // drift guard already compares the activation sets -- this compares the two facts THIS
  // module reads, so a snapshot that disagreed about a role could not pass unnoticed.
  const canonical = JSON.parse(
    readFileSync(new URL("../../config/environments.json", import.meta.url), "utf8"),
  ).environments;

  for (const env of canonical) {
    const projectId = env?.firebase?.projectId;
    if (typeof projectId !== "string" || projectId === "") continue;
    if (projectId === "taylor-parts") continue; // refused by name before any lookup

    if (env.role === "production") {
      assert.throws(
        () => assertNonProductionImportTarget(projectId),
        (err) => err instanceof ImportTargetRefusedError && err.code === "TARGET_PRODUCTION_ROLE",
        `${projectId} is role:production and must be refused`,
      );
    } else {
      const resolved = assertNonProductionImportTarget(projectId);
      assert.equal(resolved.role, env.role, `${projectId} role must match the canonical registry`);
    }
  }
});
