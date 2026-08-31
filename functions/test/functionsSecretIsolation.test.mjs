// =================================================================================================
// SECRET OWNERSHIP IS LOCAL TO THE FUNCTION THAT USES IT (ND-33)
//
// A secret-backed function may require its own secrets. It may not make every OTHER function in the
// shared codebase require them too.
//
// The distinction is not stylistic. `defineSecret(...)` binds a secret AND declares a codebase-wide
// deployment parameter, and firebase-tools resolves every declared param for the whole codebase
// during `functions:prepare` -- BEFORE `--only` filters endpoints -- prompting to create any secret
// that does not exist yet. Secret *bindings*, by contrast, are validated against the FILTERED
// backend. So a param is a claim on every deploy of the codebase; a binding is a claim on deploys
// of one function.
//
// The observed consequence: `firebase deploy --only functions:acquireSerializedAsset` prompted for
// KEYSTONE_GATEWAY_URL, a secret that function has no relationship to whatsoever.
//
// These tests hold the narrower arrangement in place. They are structural on purpose -- they read
// the compiled endpoint the SDK actually emits, not the source that produced it.
// =================================================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const LIB = join(HERE, "..", "lib");

const KEYSTONE_SECRETS = [
  "KEYSTONE_GATEWAY_URL",
  "KEYSTONE_GATEWAY_API_KEY",
  "KEYSTONE_GATEWAY_TENANT_ID",
  "KEYSTONE_ACCESS_CLIENT_ID",
  "KEYSTONE_ACCESS_CLIENT_SECRET",
];

const read = (relative) => readFileSync(join(SRC, relative), "utf8");

/** Source with comments removed, so a test never passes or fails on prose ABOUT the code. */
function code(text) {
  return text.replace(/^[ \t]*\/\*\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const { declaredParams, defineSecret } = await import("firebase-functions/params");
const keystone = await import(`file://${join(LIB, "ai", "workOrderReadinessContext.js").replace(/\\/g, "/")}`);
const acquire = await import(`file://${join(LIB, "serializedAsset", "acquireCallables.js").replace(/\\/g, "/")}`);

// -- 1. The unrelated function has no relationship to the Keystone secrets ------------------------

test("acquireSerializedAsset does not reference KEYSTONE_GATEWAY_URL, in source or in effect", () => {
  const source = read("serializedAsset/acquireCallables.ts");
  for (const secret of KEYSTONE_SECRETS) {
    assert.equal(source.includes(secret), false, `acquireCallables.ts mentions ${secret}`);
  }
  // Not just the adapter -- nothing it pulls in, either. `secretEnvironmentVariables` is the whole
  // truth about what a deployed function will be handed.
  const bound = acquire.acquireSerializedAssetCallable.__endpoint.secretEnvironmentVariables;
  assert.ok(
    bound === undefined || bound.length === 0,
    `acquireSerializedAsset unexpectedly binds secrets: ${JSON.stringify(bound)}`,
  );
});

test("acquireSerializedAsset declares no secret binding of any kind", () => {
  const source = code(read("serializedAsset/acquireCallables.ts"));
  assert.equal(/\bsecrets\s*:/.test(source), false, "acquireCallables.ts declares a secrets option");
  assert.equal(/defineSecret/.test(source), false, "acquireCallables.ts calls defineSecret");
});

// -- 2. The Keystone function still owns and requires its secrets ---------------------------------

test("the Keystone interpretation function still requires all five secrets", () => {
  const endpoint = keystone.interpretWorkOrderReadinessContext.__endpoint;
  const keys = (endpoint.secretEnvironmentVariables ?? []).map((entry) => entry.key);
  assert.deepEqual(
    [...keys].sort(),
    [...KEYSTONE_SECRETS].sort(),
    "the Keystone function's secret binding changed",
  );
});

test("no plaintext fallback exists for any Keystone secret", () => {
  // The seam reads process.env and nothing else. A default, a literal, or a `??` fallback next to
  // one of these names would be the exact failure this whole arrangement is meant to prevent: a
  // server-only value that quietly acquires a non-secret source.
  for (const relative of ["ai/workOrderReadinessContext.ts", "ai/provider.ts"]) {
    const source = code(read(relative));
    for (const secret of KEYSTONE_SECRETS) {
      const withFallback = new RegExp(`${secret}[^\\n]*(\\?\\?|\\|\\||=\\s*["'\`])`);
      assert.equal(
        withFallback.test(source),
        false,
        `${relative} gives ${secret} a fallback or literal value`,
      );
    }
  }
});

// -- 3. The mechanism itself: a binding is not a codebase-wide parameter --------------------------

test("loading the Keystone function declares no codebase-wide deployment parameter", () => {
  // This is the fix, observed rather than asserted. Both modules are already imported above, so if
  // either declared a param, it would be sitting in this array now.
  assert.deepEqual(
    declaredParams.map((param) => param.name),
    [],
    "a declared param would be resolved -- and prompted for -- on EVERY targeted deploy",
  );
});

test("defineSecret is what would have declared it, so the distinction is real and not incidental", () => {
  // Guards the test above from passing vacuously if the SDK ever stopped tracking params here.
  const before = declaredParams.length;
  defineSecret("ND33_PROOF_ONLY_NOT_A_REAL_SECRET");
  assert.equal(declaredParams.length, before + 1, "defineSecret no longer declares a param");
  declaredParams.pop();
});

test("the deploy entrypoint itself declares no parameter, which is what the CLI reads", async () => {
  // The closest thing to the real thing without a live deploy. `firebase deploy` discovers this
  // codebase by loading the built entrypoint in a child process and reading the manifest it
  // produces; the params in that manifest are exactly `declaredParams` at that moment. Zero here
  // means there is nothing for `functions:prepare` to resolve, and so nothing to prompt for --
  // whatever `--only` filter the deploy carries.
  const { declaredParams: live } = await import("firebase-functions/params");
  await import(`file://${join(LIB, "index.js").replace(/\\/g, "/")}`);
  assert.deepEqual(live.map((param) => param.name), [], "the deploy manifest would carry params");
});

test("nothing in the Functions codebase declares a deployment parameter", () => {
  // The general rule, stated once. If a future secret-backed function reaches for defineSecret, it
  // re-creates ND-33 for every unrelated targeted deploy, and this is where that gets caught.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && /defineSecret|defineString|defineInt|defineBoolean/.test(code(readFileSync(path, "utf8")))) {
        offenders.push(path.slice(SRC.length + 1));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "these files declare codebase-wide deploy params");
});
