// THE INBOUND WORK CLIENT -- the browser's route to the governed PostgreSQL Inbound Work intake
// (POST /operations/inbound-work; Owner ruling W9, 2026-09-30).
//
// Proved through injected fetch / token / transport (no network, no Firebase): the closed operation list mirrors the
// server's EOS_INBOUND_WORK_OPERATIONS EXACTLY (read from the server source text), 503 NOT_ACTIVATED is its own
// category, the client never throws, the review source maps reads and writes honestly, and the review surface no
// longer reaches a Firebase Inbound Work callable.
//
// Run: node --test test/inboundWorkApiClient.test.mjs   (also `npm test`)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INBOUND_SOURCE_STATUS,
  INBOUND_WORK_COMMAND_OPERATIONS,
  INBOUND_WORK_READ_OPERATIONS,
  INBOUND_WORK_ROUTE,
  callInboundWorkApi,
  createEosInboundWorkSource,
  isInboundWorkOperation,
  mapInboundRead,
  mapInboundWrite,
} from "../src/services/inboundWorkApiClient.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
function spy(impl = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl(...args);
  };
  fn.calls = [];
  return fn;
}
const respond = (status, body) => spy(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const opts = (fetchImpl, extra = {}) => ({ baseUrl: "https://eos.example.test/", getIdToken: async () => "tok-in", fetchImpl, ...extra });

describe("the closed operation list", () => {
  it("mirrors the server's EOS_INBOUND_WORK_OPERATIONS and INBOUND_WORK_READ_OPERATIONS exactly", () => {
    const server = read("../functions/src/eosOps/inboundWorkOperations.ts");
    const start = server.indexOf("export const EOS_INBOUND_WORK_OPERATIONS");
    const block = server.slice(start, server.indexOf("});", start));
    const keys = [...block.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 10, `parsed ${keys.length} server operations`);
    const serverReads = server.match(/INBOUND_WORK_READ_OPERATIONS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1]
      .match(/"([a-zA-Z]+)"/g).map((s) => s.slice(1, -1));
    assert.deepEqual([...INBOUND_WORK_READ_OPERATIONS].sort(), [...serverReads].sort());
    assert.deepEqual([...INBOUND_WORK_READ_OPERATIONS, ...INBOUND_WORK_COMMAND_OPERATIONS].sort(), [...keys].sort());
    for (const name of keys) assert.equal(isInboundWorkOperation(name), true, name);
    // The Firebase-only callable names are not operations the browser can send.
    for (const name of ["attachInboundWorkToWorkOrder", "getInboundWorkRequest", "getInboundWorkAttachment", "createWorkOrder", "", null]) {
      assert.equal(isInboundWorkOperation(name), false, String(name));
    }
  });

  it("posts to the server's route", () => {
    assert.match(read("../functions/src/eosOps/inboundWorkOperations.ts"), /INBOUND_WORK_ROUTE = "\/operations\/inbound-work"/);
    assert.equal(INBOUND_WORK_ROUTE, "/operations/inbound-work");
  });
});

describe("callInboundWorkApi", () => {
  it("sends { operation, input } with the bearer and the stated tenant", async () => {
    const fetchImpl = respond(200, { ok: true, operation: "listInboundWork", result: { rows: [], truncated: false } });
    const out = await callInboundWorkApi("listInboundWork", { limit: 5 }, opts(fetchImpl, { tenantId: "t1" }));
    assert.deepEqual(out, { ok: true, operation: "listInboundWork", result: { rows: [], truncated: false } });
    const [url, init] = fetchImpl.calls[0];
    assert.equal(url, "https://eos.example.test/operations/inbound-work");
    assert.equal(init.headers.authorization, "Bearer tok-in");
    assert.equal(init.headers["x-eos-tenant"], "t1");
    assert.deepEqual(JSON.parse(init.body), { operation: "listInboundWork", input: { limit: 5 } });
  });

  it("maps 503 NOT_ACTIVATED to its own category and keeps the server's specific code", async () => {
    const na = await callInboundWorkApi("listInboundWork", {}, opts(respond(503, { ok: false, code: "NOT_ACTIVATED", message: "x" })));
    assert.deepEqual([na.code, na.reason, na.status], ["NOT_ACTIVATED", "NOT_ACTIVATED", 503]);
    const decided = await callInboundWorkApi("acceptInboundWork", {}, opts(respond(412, { ok: false, code: "ALREADY_DECIDED", message: "decided" })));
    assert.deepEqual([decided.code, decided.reason], ["PRECONDITION_FAILED", "ALREADY_DECIDED"]);
  });

  it("never throws: unknown operation, no base URL, no token, a thrown fetch, a non-JSON body", async () => {
    assert.equal((await callInboundWorkApi("acceptInboundWorkLegacy", {}, opts(respond(200, {})))).code, "UNKNOWN_OPERATION");
    assert.equal((await callInboundWorkApi("listInboundWork", {}, { baseUrl: "", getIdToken: async () => "t" })).code, "NOT_CONFIGURED");
    assert.equal((await callInboundWorkApi("listInboundWork", {}, { baseUrl: "https://x", getIdToken: async () => null })).code, "NOT_SIGNED_IN");
    assert.equal((await callInboundWorkApi("listInboundWork", {}, opts(spy(async () => { throw new Error("offline"); })))).code, "UNREACHABLE");
    const html = await callInboundWorkApi("listInboundWork", {}, opts(spy(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }))));
    assert.deepEqual([html.ok, html.code], [false, "INTERNAL"]);
  });
});

describe("the review source", () => {
  it("maps reads: READY, DENIED, NOT_ACTIVATED and UNAVAILABLE stay distinct; a malformed success is not an empty result", () => {
    assert.equal(mapInboundRead({ ok: true, result: { rows: [] } }).status, INBOUND_SOURCE_STATUS.READY);
    assert.equal(mapInboundRead({ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_MISSING" }).status, INBOUND_SOURCE_STATUS.DENIED);
    assert.equal(mapInboundRead({ ok: false, code: "NOT_ACTIVATED" }).status, INBOUND_SOURCE_STATUS.NOT_ACTIVATED);
    assert.equal(mapInboundRead({ ok: false, code: "UNREACHABLE" }).status, INBOUND_SOURCE_STATUS.UNAVAILABLE);
    assert.equal(mapInboundRead({ ok: true, result: null }).status, INBOUND_SOURCE_STATUS.UNAVAILABLE);
  });

  it("maps writes: the server's reason and message survive; NOT_ACTIVATED says so", () => {
    assert.deepEqual(mapInboundWrite({ ok: true, result: { workItemId: "wo_1" } }), { ok: true, data: { workItemId: "wo_1" }, code: null, message: null });
    const refused = mapInboundWrite({ ok: false, code: "PRECONDITION_FAILED", reason: "ALREADY_DECIDED", message: "this request is DECLINED" });
    assert.deepEqual([refused.ok, refused.code, refused.message], [false, "ALREADY_DECIDED", "this request is DECLINED"]);
    assert.match(mapInboundWrite({ ok: false, code: "NOT_ACTIVATED" }).message, /NOT_YET_ACTIVATED/);
  });

  it("every member is an EOS call: the decisions go to /operations/inbound-work, the company list to the Work Order route", async () => {
    const client = { call: spy(async (operation) => ({ ok: true, operation, result: { ok: 1 } })) };
    const workOrderCall = spy(async () => ({ ok: true, result: { items: [{ operatingCompanyId: "taylor" }] } }));
    const source = createEosInboundWorkSource({ client, workOrderCall });
    const accept = { requestId: "r1", operatingCompanyId: "taylor", customerId: "a", locationId: "l" };
    await source.readAccess();
    await source.listQueue({ statuses: ["AWAITING_DECISION"] });
    await source.getRequest("r1");
    await source.accept(accept);
    await source.decline({ requestId: "r1", reason: "OTHER" });
    await source.attach({ requestId: "r1", workOrderId: "wo_1" });
    assert.deepEqual(client.call.calls.map((c) => c[0]),
      ["readInboundWorkAccess", "listInboundWork", "readInboundWorkRequest", "acceptInboundWork", "declineInboundWork", "attachInboundWork"]);
    assert.deepEqual(client.call.calls[3][1], accept, "Accept sends exactly the reviewer's values -- the company is STATED");
    assert.deepEqual(client.call.calls[2][1], { requestId: "r1" });
    const companies = await source.listOperatingCompanies();
    assert.deepEqual([workOrderCall.calls[0][0], companies.payload.items[0].operatingCompanyId], ["listWorkOrderOperatingCompanies", "taylor"]);
    assert.equal("getAttachment" in source, false, "attachment bytes are the provider boundary; the EOS source has no download");
  });
});

describe("the review surface no longer reaches Firebase", () => {
  it("InboundWorkWorkspace imports no Firebase module, no capability feed and no Firebase inbound source", () => {
    const src = read("src/modules/service/InboundWorkWorkspace.jsx");
    for (const forbidden of ["firebase/", "useGovernedCapabilities", "access/inboundWorkSource", "httpsCallable"]) {
      assert.equal(src.includes(forbidden), false, `the workspace must not use ${forbidden}`);
    }
    assert.match(src, /services\/inboundWorkApiClient\.js/);
  });

  it("no client file names a Firebase Work Order-acting Inbound Work callable any more", () => {
    const seam = read("src/access/inboundWorkSource.js");
    for (const retired of ['"listInboundWork"', '"getInboundWorkRequest"', '"acceptInboundWork"', '"declineInboundWork"',
      '"attachInboundWorkToWorkOrder"', '"getInboundWorkAttachment"']) {
      assert.equal(seam.includes(`governedRead(${retired}`) || seam.includes(`governedWrite(${retired}`), false, `${retired} is still a callable`);
    }
    assert.doesNotMatch(read("src/services/inboundWorkApiClient.js"), /from ["']firebase/);
  });
});
