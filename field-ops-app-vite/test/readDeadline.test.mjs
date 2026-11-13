// READ DEADLINE (RCV-02) follow-ups: the client read lists cannot drift from the server's, the caller-signal listener is
// released when a read settles, and a real read caller surfaces a timeout as an honest error.
//
// Run: node --test test/readDeadline.test.mjs   (also `npm test`)
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readDeadline, READ_TIMED_OUT_REASON, READ_WAIT_MS } from "../src/services/readDeadline.js";

// The API clients reach src/firebase/firebase.js (for the signed-in token), which needs Vite build constants and
// initializes Firebase at import. Stub only that module so the real clients load offline; nothing else is mocked.
registerHooks({
  resolve(spec, ctx, next) {
    const stub = "data:text/javascript,export const auth = { currentUser: null }; export const APP_ENVIRONMENT = \"test\";";
    return spec.endsWith("firebase/firebase.js") ? { url: stub, shortCircuit: true } : next(spec, ctx);
  },
});
const { CATALOG_READ_OPERATIONS, CATALOG_MUTATION_OPERATIONS, callCatalogApi } = await import("../src/services/catalogApiClient.js");
const { REORDER_READ_OPERATIONS, REORDER_COMMAND_OPERATIONS } = await import("../src/services/reorderApiClient.js");
const { fetchSupplierList } = await import("../src/services/partsOperationsReads.js");

const readServer = (rel) => readFileSync(path.resolve(process.cwd(), "..", rel), "utf8");

/** The quoted names in `export const NAME = Object.freeze([ ... ] as const)` of a server source file. */
function serverList(rel, name) {
  const m = readServer(rel).match(new RegExp(`export const ${name}\\b[^=]*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} not found in ${rel}`);
  const names = [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(names.length > 0, `${name} parsed empty`);
  return names;
}

describe("a client read list is a subset of the server's read list (a write filed as a read would get a timer)", () => {
  const cases = [
    ["catalog", CATALOG_READ_OPERATIONS, CATALOG_MUTATION_OPERATIONS, "functions/src/catalogMaster/catalogHttp.ts", "CATALOG_READ_OPERATIONS", "CATALOG_MUTATION_OPERATIONS"],
    ["reorder", REORDER_READ_OPERATIONS, REORDER_COMMAND_OPERATIONS, "functions/src/eosOps/eosOpsHttp.ts", "OPERATIONS_READ_OPERATIONS", "OPERATIONS_MUTATION_OPERATIONS"],
  ];
  for (const [label, clientReads, clientWrites, file, serverReadName, serverWriteName] of cases) {
    it(`${label}: every client read is a server read and no client write is on the read list`, () => {
      const serverReads = new Set(serverList(file, serverReadName));
      const serverWrites = new Set(serverList(file, serverWriteName));
      for (const op of clientReads) {
        assert.ok(serverReads.has(op), `client read "${op}" is not in the server's ${serverReadName}`);
        assert.ok(!serverWrites.has(op), `client read "${op}" is a server mutation`);
      }
      for (const op of clientWrites) assert.ok(!clientReads.includes(op), `client command "${op}" is on the read list`);
    });
  }
  it("the parser is not vacuous: it sees a known server read and a known server mutation", () => {
    assert.ok(serverList("functions/src/catalogMaster/catalogHttp.ts", "CATALOG_READ_OPERATIONS").includes("searchParts"));
    assert.ok(serverList("functions/src/catalogMaster/catalogHttp.ts", "CATALOG_MUTATION_OPERATIONS").includes("createPart"));
  });
});

describe("readDeadline releases the caller's abort listener", () => {
  const spied = () => {
    const signal = new AbortController().signal;
    const live = new Set();
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, fn, opts) => { live.add(fn); add(type, fn, opts); };
    signal.removeEventListener = (type, fn, opts) => { live.delete(fn); remove(type, fn, opts); };
    return { signal, live };
  };

  it("clear() removes the listener it added", () => {
    const { signal, live } = spied();
    const d = readDeadline(true, signal);
    assert.equal(live.size, 1);
    d.clear();
    assert.equal(live.size, 0);
  });

  it("a read that settles through callCatalogApi leaves no listener on a long-lived signal", async () => {
    const { signal, live } = spied();
    const res = await callCatalogApi("countParts", {}, {
      baseUrl: "https://eos.test", getIdToken: async () => "t", signal,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { count: 1 } }) }),
    });
    assert.equal(res.ok, true);
    assert.equal(live.size, 0);
  });

  it("a write is untouched: the caller's own signal, no listener, no timer", () => {
    const { signal, live } = spied();
    const d = readDeadline(false, signal);
    assert.equal(d.signal, signal);
    assert.equal(live.size, 0);
  });
});

describe("a read caller shows a timeout as an honest error, never a stuck wait or an empty list", () => {
  it("fetchSupplierList rejects with UNREACHABLE / READ_TIMED_OUT when the server never answers", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      // A fetch that only ever ends by being aborted -- the shape of a hung connection.
      const fetchImpl = (_url, init) => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
      let outcome = "pending";
      const settled = fetchSupplierList({ baseUrl: "https://eos.test", getIdToken: async () => "t", fetchImpl })
        .then((rows) => { outcome = { resolved: rows }; }, (err) => { outcome = { rejected: err }; });
      await new Promise((r) => setImmediate(r)); // let the token resolve and the fetch start, then the clock runs
      assert.equal(outcome, "pending", "still waiting before the deadline");
      mock.timers.tick(READ_WAIT_MS);
      await settled;
      assert.ok(outcome.rejected, `must reject, not resolve an empty list: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.rejected.code, "UNREACHABLE");
      assert.equal(outcome.rejected.reason, READ_TIMED_OUT_REASON);
      assert.match(outcome.rejected.message, /did not finish in time/);
    } finally {
      mock.timers.reset();
    }
  });
});
