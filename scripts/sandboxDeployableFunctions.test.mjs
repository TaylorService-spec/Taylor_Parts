// =================================================================================================
// THE DEPLOYABLE FUNCTION SET FOR A GENERAL platform-sandbox REFRESH
//
// The invariant under test:
//
//   A general platform-sandbox refresh deploys every Function APPLICABLE to platform-sandbox, and
//   is never forced to deploy a Function whose governed deployment prerequisites are intentionally
//   absent in that environment.
//
// Two ways to get this wrong, and the tests are weighted accordingly:
//
//   FAIL OPEN (worse) -- the derivation quietly drops functions it should have deployed, and the
//   symptom is stale code nobody redeployed. Guarded by the round-trip tests (7, 8) and by the
//   refusal to accept an ungoverned secret binding (3).
//
//   FAIL CLOSED (recoverable) -- the derivation refuses and the release stops with a name. That is
//   the designed behaviour for every ambiguity: tests 3, 4 and 5.
//
// Run: node --test scripts/sandboxDeployableFunctions.test.mjs
// =================================================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SANDBOX_REFRESH_EXCLUDED_FUNCTIONS,
  loadFunctionManifest,
  assertManifestGoverned,
  deployableFunctionNames,
  deployFilterBatches,
} from "./sandboxDeployableFunctions.mjs";

const REPO = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const LIB_INDEX = join(REPO, "functions", "lib", "index.js");

const KEYSTONE = "interpretWorkOrderReadinessContext";

/** A manifest entry, in the shape loadFunctionManifest returns. */
const fn = (name, secrets = []) => ({ name, secrets });

// -- 1 --------------------------------------------------------------------------------------------
// Needs functions/lib. Skipped rather than failed when it is absent: an unbuilt tree is an
// environment fact, and the runbook builds at step [1/5] before it ever calls this.
const built = existsSync(LIB_INDEX) ? test : test.skip;

built("the real manifest yields every export but the governed exclusions", async () => {
  const manifest = await loadFunctionManifest(LIB_INDEX);
  const names = deployableFunctionNames(manifest);
  const excluded = Object.keys(SANDBOX_REFRESH_EXCLUDED_FUNCTIONS);

  assert.ok(manifest.length > 100, `manifest looks truncated: ${manifest.length} entries`);
  assert.equal(names.length, manifest.length - excluded.length);
  for (const name of excluded) {
    assert.ok(!names.includes(name), `${name} must not be in the deployable set`);
  }
  // Its non-secret sibling is NOT collateral damage -- the exclusion is one function, not a module.
  assert.ok(names.includes("getWorkOrderReadinessContext"));
});

// -- 2 --------------------------------------------------------------------------------------------

built("the only secret-bound Function in the estate is the one that is excluded", async () => {
  const manifest = await loadFunctionManifest(LIB_INDEX);
  const bound = manifest.filter((entry) => entry.secrets.length > 0).map((entry) => entry.name);
  assert.deepEqual(bound, [KEYSTONE]);

  // ...and it still requires all five. The fix filters the DEPLOY; it does not weaken the binding.
  const keystone = manifest.find((entry) => entry.name === KEYSTONE);
  assert.deepEqual(keystone.secrets, [
    "KEYSTONE_ACCESS_CLIENT_ID",
    "KEYSTONE_ACCESS_CLIENT_SECRET",
    "KEYSTONE_GATEWAY_API_KEY",
    "KEYSTONE_GATEWAY_TENANT_ID",
    "KEYSTONE_GATEWAY_URL",
  ]);
});

// -- 3 --------------------------------------------------------------------------------------------

test("a NEW secret-bound Function stops the release; it is never silently skipped", () => {
  // The rule is not "has a secret means skip in sandbox". A secret platform-sandbox genuinely has
  // is a perfectly good reason to deploy. So an unrecognised binding is a question for a human.
  const manifest = [fn("createWorkOrder"), fn("newThing", ["SOME_NEW_SECRET"])];
  assert.throws(
    () => deployableFunctionNames(manifest, {}),
    (error) => {
      assert.match(error.message, /newThing/);
      assert.match(error.message, /SOME_NEW_SECRET/);
      assert.match(error.message, /Do NOT create the secrets merely to satisfy a deployment command/);
      return true;
    },
  );
});

// -- 4 --------------------------------------------------------------------------------------------

test("a STALE exclusion refuses rather than quietly doing nothing", () => {
  // An exclusion for a function that no longer exists is not harmless -- it is a governance record
  // that has stopped describing the system, and the next reader trusts it.
  assert.throws(
    () => assertManifestGoverned([fn("createWorkOrder")], { goneFunction: "reason" }),
    /no longer exported: goneFunction/,
  );
});

// -- 5 --------------------------------------------------------------------------------------------

test("an empty manifest refuses instead of deriving an empty deploy", () => {
  // A broken build must not read as "nothing needs deploying". That is the fail-open shape.
  assert.throws(() => deployableFunctionNames([]), /manifest is empty/);
});

// -- 6 --------------------------------------------------------------------------------------------

test("exclusion is by EXACT id -- never a prefix, suffix or pattern", () => {
  const manifest = [
    fn("interpret"),
    fn("interpretWorkOrderReadinessContextV2"),
    fn(KEYSTONE, ["KEYSTONE_GATEWAY_URL"]),
  ];
  const names = deployableFunctionNames(manifest, { [KEYSTONE]: "reason" });
  assert.deepEqual(names, ["interpret", "interpretWorkOrderReadinessContextV2"]);
});

// -- 7 --------------------------------------------------------------------------------------------

test("the emitted batches contain every deployable name exactly once, and nothing else", () => {
  const manifest = Array.from({ length: 95 }, (_, i) => fn(`fn${i}`)).concat(fn(KEYSTONE, ["S"]));
  const names = deployableFunctionNames(manifest, { [KEYSTONE]: "reason" });
  const emitted = deployFilterBatches(names).join(",").split(",");

  assert.equal(emitted.length, names.length, "a name was dropped or duplicated");
  assert.deepEqual([...emitted].sort(), names.map((n) => `functions:${n}`).sort());
  assert.ok(!emitted.includes(`functions:${KEYSTONE}`));
});

// -- 8 --------------------------------------------------------------------------------------------

built("no single batch approaches the command-line length limit", async () => {
  // 142 filters in one argument is ~5.7KB, close enough to Windows' 8KB limit to be a bad surprise
  // during a release. Batching is also this repository's existing answer to a large batch failing
  // partway and leaving the estate half-new.
  const names = deployableFunctionNames(await loadFunctionManifest(LIB_INDEX));
  const batches = deployFilterBatches(names);
  assert.ok(batches.length > 1, "expected the estate to be split across batches");
  for (const batch of batches) {
    assert.ok(batch.length < 2000, `batch is ${batch.length} chars -- too close to the limit`);
    assert.ok(batch.length > 0);
  }
});

// -- 9 --------------------------------------------------------------------------------------------

test("every exclusion carries a reason naming the absent prerequisite", () => {
  // A bare list of names decays into folklore. The reason is the governance.
  const entries = Object.entries(SANDBOX_REFRESH_EXCLUDED_FUNCTIONS);
  assert.ok(entries.length > 0);
  for (const [name, reason] of entries) {
    assert.equal(typeof reason, "string", `${name} has no reason`);
    assert.ok(reason.length > 80, `${name}'s reason is too thin to be useful: ${reason}`);
  }
});

// -- 10 -------------------------------------------------------------------------------------------

test("the exclusion's stated premise is true: platform-sandbox has private AI OFF", () => {
  // If someone activates the capability in platform-sandbox, the reason recorded in the exclusion
  // stops being true and this function becomes applicable again. This is where that is noticed.
  const config = JSON.parse(readFileSync(join(REPO, "config", "environments.json"), "utf8"));
  const sandbox = config.environments.find((env) => env.id === "platform-sandbox");
  assert.ok(sandbox, "could not find the platform-sandbox environment in config/environments.json");
  assert.equal(
    sandbox.privateAiSyntheticOperationalInterpretation,
    false,
    "platform-sandbox now activates private AI -- re-decide the exclusion in " +
      "scripts/sandboxDeployableFunctions.mjs; it may no longer be correct.",
  );
});
