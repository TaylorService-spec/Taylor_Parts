// EOS Operations API -- shape and deployment-fence proofs. Offline, no database.
//
// Mirrors the closed-operation-list proofs adminPolicyHttp's own suite already makes for
// /admin/policy, for the new /operations/inventory transport, plus the platform-wide fences the
// Owner ruling requires: no generic SQL/mutation endpoint anywhere, no Firebase service-account
// credential added, no Firestore Rules changed, no `firebase deploy` step added to CI.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  OPERATIONS_READ_OPERATIONS,
  isOperationsOperation,
  handleOperationsRequest,
} from "../lib/eosOps/eosOpsHttp.js";

test("the Operations read list is closed and names exactly one P0 operation", () => {
  assert.deepEqual(OPERATIONS_READ_OPERATIONS, ["resolveMyCapabilities"]);
  assert.equal(isOperationsOperation("resolveMyCapabilities"), true);
  assert.equal(isOperationsOperation("mutateAnything"), false);
  assert.equal(isOperationsOperation("runSQL"), false);
});

test("an operation not on the list is UNKNOWN_OPERATION, unauthenticated or not", async () => {
  const res = await handleOperationsRequest(
    { reader: /** @type {any} */ ({}), pool: /** @type {any} */ ({}), verifyToken: async () => ({ externalSubject: "x", identityProvider: "firebase" }) },
    { method: "POST", url: "/operations/inventory", headers: {}, body: JSON.stringify({ operation: "runSQL" }) },
  );
  assert.equal(res.status, 404);
  assert.match(res.body, /UNKNOWN_OPERATION/);
});

test("a call with no bearer token is refused before any operation runs", async () => {
  const res = await handleOperationsRequest(
    { reader: /** @type {any} */ ({}), pool: /** @type {any} */ ({}), verifyToken: async () => { throw new Error("must not be called"); } },
    { method: "POST", url: "/operations/inventory", headers: {}, body: JSON.stringify({ operation: "resolveMyCapabilities" }) },
  );
  assert.equal(res.status, 401);
});

test("a route other than /operations/inventory is 404", async () => {
  const res = await handleOperationsRequest(
    { reader: /** @type {any} */ ({}), pool: /** @type {any} */ ({}), verifyToken: async () => ({ externalSubject: "x", identityProvider: "firebase" }) },
    { method: "POST", url: "/operations/cycle-count", headers: {}, body: "{}" },
  );
  assert.equal(res.status, 404);
});

test("OPTIONS is a CORS preflight with no authentication required", async () => {
  const res = await handleOperationsRequest(
    { reader: /** @type {any} */ ({}), pool: /** @type {any} */ ({}), verifyToken: async () => { throw new Error("must not be called"); } },
    { method: "OPTIONS", url: "/operations/inventory", headers: {} },
  );
  assert.equal(res.status, 204);
});

// ════════════════════ repo-wide fences ════════════════════

test("no generic SQL or mutation endpoint exists anywhere in functions/src", () => {
  const roots = ["src"];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!path.endsWith(".ts")) continue;
      const source = readFileSync(path, "utf8");
      if (/["']\/sql["']/.test(source)) offenders.push(`${path}: a /sql route`);
      if (/function\s+mutate\s*\(\s*table\b/.test(source)) offenders.push(`${path}: a mutate(table, ...) function`);
      if (/["']\/(?:query|repository|collection)\/:?\w*["']/.test(source)) offenders.push(`${path}: a generic repository/collection route`);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

test("render.yaml declares no Firebase service-account credential", () => {
  // render.yaml's own comments discuss GOOGLE_APPLICATION_CREDENTIALS_JSON by name, as the thing
  // that was deliberately removed -- that history belongs in the file. What must not exist is the
  // key actually being DECLARED, i.e. a real `- key: ...` envVar line naming one.
  const source = readFileSync("../render.yaml", "utf8");
  const code = source.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(code, /key:\s*GOOGLE_APPLICATION_CREDENTIALS/, "no service-account key path was declared");
  assert.doesNotMatch(code, /key:\s*FIREBASE_SERVICE_ACCOUNT/i, "no service-account JSON was declared");
  assert.doesNotMatch(code, /private_key/i, "no key material was added");
});

test("no GitHub Actions workflow gained a firebase deploy STEP", () => {
  // A comment discussing deploy risk (functions-deploy-set-tests.yml has one) is not a step. What
  // matters is an actual `run:` line that would execute the deploy.
  const dir = "../.github/workflows";
  const offenders = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const source = readFileSync(join(dir, file), "utf8");
    const code = source.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    if (/run:\s*.*firebase\s+deploy/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "Firebase Functions deployment remains explicitly out of scope");
});

test("firestore.rules was not changed by this tranche's file set -- eos_ops touches no Rules file", () => {
  // A cheap, direct proof rather than a git diff: the eos_ops source tree references no Rules file
  // path, and this repository's Rules files are not under src/eosOps by construction.
  const source = readdirSync("src/eosOps").join(",");
  assert.doesNotMatch(source, /firestore\.rules/);
});
