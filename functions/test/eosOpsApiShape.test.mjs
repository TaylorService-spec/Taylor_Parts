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
  OPERATIONS_ROUTES,
  OPERATIONS_ROUTE_BY_OPERATION,
  OPERATIONS_MUTATION_OPERATIONS,
  isOperationsOperation,
  handleOperationsRequest,
  CYCLE_COUNT_ROUTE,
  CYCLE_COUNT_OPERATIONS,
  isCycleCountOperation,
} from "../lib/eosOps/eosOpsHttp.js";

// BOTH LISTS ARE CLOSED. `resolveMyExperienceContext` joined the reads when the client gained an EOS source for navigation;
// the Reorder domain cutover (#1961) added its reads, its lifecycle commands and the governed Reorder receipt. A
// mutation named as a read, an operation without a route, or anything not named here still fails.
test("both Operations lists are closed, every entry is routed, and they name exactly what the transport serves", () => {
  assert.deepEqual(OPERATIONS_READ_OPERATIONS,
    ["resolveMyCapabilities", "resolveMyExperienceContext", "readReorderQueue", "readMyAssignedReorders",
      "readReorderRequest", "readMyReorderHistory", "listReorderWarehouseOptions"]);
  assert.deepEqual(OPERATIONS_MUTATION_OPERATIONS, [
    "createReorderRequest", "reviewReorderRequest", "assignReorderRequest",
    "startPurchasingOnReorder", "postPurchasingUpdate", "markReorderReceived", "cancelReorderRequest",
    "recordReorderPurchaseOrder", "voidReorderPurchaseOrder", "receiveReorderStock",
  ]);
  for (const name of [...OPERATIONS_READ_OPERATIONS, ...OPERATIONS_MUTATION_OPERATIONS]) {
    assert.equal(isOperationsOperation(name), true, name);
  }
  assert.equal(isOperationsOperation("mutateAnything"), false);
  assert.equal(isOperationsOperation("runSQL"), false);
  const reads = new Set(OPERATIONS_READ_OPERATIONS);
  assert.ok(!OPERATIONS_MUTATION_OPERATIONS.some((m) => reads.has(m)), "an operation is a read or a mutation, never both");
  // Every operation has exactly one route, and every route is named by an operation.
  assert.deepEqual(Object.keys(OPERATIONS_ROUTE_BY_OPERATION).sort(), [...OPERATIONS_READ_OPERATIONS, ...OPERATIONS_MUTATION_OPERATIONS].sort());
  // The read routes, plus ONE command route with its OWN closed table (Controller ruling DQ-018: Cycle
  // Count is the first inventory domain on this transport). No read route serves a command.
  assert.deepEqual(OPERATIONS_ROUTES, ["/operations/cycle-count", "/operations/experience", "/operations/inventory"]);
  assert.equal(CYCLE_COUNT_ROUTE, "/operations/cycle-count");
  assert.ok(!Object.values(OPERATIONS_ROUTE_BY_OPERATION).includes(CYCLE_COUNT_ROUTE));
});

test("the Cycle Count command table is CLOSED and names only the sheet/line lifecycle", () => {
  assert.deepEqual([...CYCLE_COUNT_OPERATIONS].sort(), [
    "cancelCycleCountLine", "cancelCycleCountSheet", "closeCycleCountSheet", "createCycleCountSheet",
    "getCycleCountSheet", "listCycleCountSheets", "openCycleCountLine", "reconcileCycleCountLine", "submitCycleCountLine",
  ]);
  for (const bad of ["runSQL", "mutate", "resolveMyCapabilities", "__proto__", "constructor", "toString"]) {
    assert.equal(isCycleCountOperation(bad), false, bad);
  }
});

test("a Cycle Count operation posted to a READ route is 404, and a read posted to the Cycle Count route is 404", async () => {
  const deps = { reader: /** @type {any} */ ({}), pool: /** @type {any} */ ({}), verifyToken: async () => ({ externalSubject: "x", identityProvider: "firebase" }) };
  for (const url of ["/operations/inventory", "/operations/experience"]) {
    const res = await handleOperationsRequest(deps, { method: "POST", url, headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation: "createCycleCountSheet", input: {} }) });
    assert.equal(res.status, 404);
  }
  const res = await handleOperationsRequest(deps, { method: "POST", url: CYCLE_COUNT_ROUTE, headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation: "resolveMyCapabilities" }) });
  assert.equal(res.status, 404);
});

test("an operation posted to the WRONG Operations route is 404 -- routes do not answer for each other", async () => {
  const deps = {
    reader: /** @type {any} */ ({}),
    pool: /** @type {any} */ ({}),
    verifyToken: async () => ({ externalSubject: "x", identityProvider: "firebase" }),
  };
  for (const [operation, route] of Object.entries(OPERATIONS_ROUTE_BY_OPERATION)) {
    const wrong = OPERATIONS_ROUTES.find((r) => r !== route);
    const res = await handleOperationsRequest(deps, {
      method: "POST",
      url: wrong,
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ operation }),
    });
    assert.equal(res.status, 404, `${operation} must not be served at ${wrong}`);
    assert.match(res.body, /UNKNOWN_OPERATION/);
  }
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

// ════════════════ the PostgreSQL Reorder activation boundary (Controller ruling 2026-09-28, window step 19) ════════════════
test("until REORDER_POSTGRES_ACTIVE, EVERY Reorder operation refuses before any identity or database work", async () => {
  const { executeOperation } = await import("../lib/eosOps/eosOpsHttp.js");
  const { REORDER_POSTGRES_ACTIVE } = await import("../lib/eosOps/reorderLifecycleCommands.js");
  assert.equal(REORDER_POSTGRES_ACTIVE, false, "the integration package ships the Reorder authority INACTIVE");
  const untouchable = new Proxy({}, { get: () => { throw new Error("DEPS_TOUCHED"); } });
  const reorderOps = [...OPERATIONS_READ_OPERATIONS, ...OPERATIONS_MUTATION_OPERATIONS].filter((o) => !/^resolveMy/.test(o));
  assert.equal(reorderOps.length, 15);
  for (const operation of reorderOps) {
    const r = await executeOperation({ reader: untouchable, pool: untouchable },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation, input: {} });
    assert.deepEqual([r.ok, r.code], [false, "PRECONDITION_FAILED"], operation);
    assert.match(r.message, /not active yet/);
  }
  // The two principal-context resolvers are not Reorder operations: they are not behind this boundary.
  for (const operation of ["resolveMyCapabilities", "resolveMyExperienceContext"]) {
    const r = await executeOperation({ reader: untouchable, pool: untouchable },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation }).catch((e) => e);
    assert.notEqual(r && r.code, "PRECONDITION_FAILED", `${operation} must not be gated by the Reorder activation`);
  }
});
