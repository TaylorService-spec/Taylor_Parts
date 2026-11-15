// OFFLINE proof for docs/uat/tools/service-dispatch-fixture.mjs. No network, no Postgres, synthetic secrets only.
// Run: node --test docs/uat/tools/test/service-dispatch-fixture.test.mjs
// The EOS API is a mocked fetch behind the test-only loopback persona client (createLoopbackTestEosPersonaClient).
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const session = await import(pathToFileURL(join(REPO, "scripts", "eosPersonaSession.mjs")).href);
const tool = await import(pathToFileURL(join(REPO, "docs", "uat", "tools", "service-dispatch-fixture.mjs")).href);

const CREDENTIAL = "synthetic-issuer-credential-zz9";
const TOKEN = "tok.synthetic.zz9";
const TECH = "synthetic-np-emp-service-technician-a";
const lb = session.createLoopbackTestEosPersonaClient("http://127.0.0.1:8787");
test.beforeEach(() => session.clearEosPersonaSessionCache());

/** A mocked EOS API: records every governed call; models the one Work Order the fixture creates. */
function mockApi({ initialStatus = "CREATED", capabilities, refuse = {}, conflicts = 0 } = {}) {
  const calls = [];
  const wo = { id: "wo_fixture", status: initialStatus, assignee: initialStatus === "CREATED" ? null : TECH, start: null, end: null };
  let conflictsLeft = conflicts;
  const allCaps = Object.values(tool.NEEDS).flat();
  const fetch = async (url, init) => {
    const u = String(url);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.endsWith("/auth/nonprod/persona-session")) {
      const { personaKey } = JSON.parse(init.body);
      return reply(200, { ok: true, token: TOKEN, expiresAt: "2099-01-01T00:00:00Z", personaKey, principalId: `p-${personaKey}` });
    }
    const { operation, input } = JSON.parse(init.body);
    calls.push({ operation, route: new URL(u).pathname, input });
    if (refuse[operation]) return reply(403, { ok: false, operation, code: refuse[operation] });
    const ok = (result) => reply(200, { ok: true, operation, result });
    switch (operation) {
      case "readMyWorkOrderCapabilities": return ok({ capabilities: capabilities ?? allCaps });
      case "createAccount": return ok({ accountId: "acct_1" });
      case "createAccountLocation": return ok({ accountLocationId: "site_1" });
      case "createWorkOrder": return ok({ workOrderId: wo.id, workOrderNumber: "WO-2026-999999", replayed: initialStatus !== "CREATED" });
      case "readWorkOrder": return ok({ workOrderId: wo.id, status: wo.status, assigneeEmployeeId: wo.assignee, scheduledStart: wo.start, scheduledEnd: wo.end });
      case "markWorkOrderReady": wo.status = "READY_TO_DISPATCH"; return ok({});
      case "scheduleWorkOrder":
        if (conflictsLeft-- > 0) return reply(412, { ok: false, operation, code: "SCHEDULE_CONFLICT" });
        wo.status = "SCHEDULED"; wo.assignee = input.employeeId; wo.start = input.scheduledStart; wo.end = input.scheduledEnd; return ok({});
      default: return reply(404, { ok: false, operation, code: "UNKNOWN_OPERATION" });
    }
  };
  return { fetch, calls, wo };
}

async function runTool(api, argv, { env = { EOS_PERSONA_ISSUER_CREDENTIAL: CREDENTIAL }, now = () => new Date("2026-10-22T12:00:00Z") } = {}) {
  const lines = [];
  const callAs = (persona, route, payload) => lb.callEosApiAsPersona(persona, route, payload, { env: {}, credential: CREDENTIAL, fetch: api.fetch });
  const code = await tool.run({ argv, env, callAs, now, out: (o) => lines.push(o) });
  return { code, lines };
}
const writes = (api) => api.calls.map((c) => c.operation).filter((o) => !o.startsWith("read"));

test("dry run is offline: plan only, no call, no credential needed", async () => {
  const api = mockApi();
  const { code, lines } = await runTool(api, [], { env: {} });
  assert.equal(code, 0);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(lines.filter((l) => l.step).map((l) => l.step), ["D1", "D2", "D3", "D4", "D5"]);
  assert.ok(lines.some((l) => /dispatchWorkOrder/.test(JSON.stringify(l.leftForCodex))), "dispatch is named as left for Codex");
});

test("target fence: an unregistered, production or overridden API is refused before any call", async () => {
  for (const url of ["https://evil.example", "https://taylor-parts.web.app", "http://127.0.0.1:8787"]) {
    const api = mockApi();
    const { code, lines } = await runTool(api, ["--apply"], { env: { EOS_PERSONA_ISSUER_CREDENTIAL: CREDENTIAL, EOS_API_BASE_URL: url } });
    assert.equal(code, 2, url);
    assert.equal(lines[0].outcome, "STOPPED");
    assert.equal(api.calls.length, 0, url);
  }
});

test("apply without a credential, and --apply with --preview, refuse", async () => {
  assert.equal((await runTool(mockApi(), ["--apply"], { env: {} })).lines[0].code, "NO_ISSUER_CREDENTIAL");
  assert.equal((await runTool(mockApi(), ["--apply", "--preview"])).lines[0].code, "MODE_CONFLICT");
});

test("apply: governed commands in order, ending SCHEDULED for technician-a; dispatch is NOT performed", async () => {
  const api = mockApi();
  const { code, lines } = await runTool(api, ["--apply"]);
  assert.equal(code, 0);
  assert.deepEqual(writes(api), ["createAccount", "createAccountLocation", "createWorkOrder", "markWorkOrderReady", "scheduleWorkOrder"]);
  assert.ok(!api.calls.some((c) => /dispatch|accept|Travel|arrive|StartWork|Execution|complete|close|cancel/i.test(c.operation)), "nothing past SCHEDULED");
  const create = api.calls.find((c) => c.operation === "createWorkOrder");
  assert.equal(create.route, "/operations/work-orders");
  assert.equal(create.input.operatingCompanyId, "taylor");
  assert.match(create.input.complaint, /SYNTHETIC-UAT-R2/);
  assert.ok(api.calls.filter((c) => c.operation.startsWith("create")).every((c) => /^synthetic-uat-r2-svc-/.test(c.input.idempotencyKey)));
  const sched = api.calls.find((c) => c.operation === "scheduleWorkOrder");
  assert.equal(sched.input.employeeId, TECH);
  assert.equal(sched.input.workOrderId, "wo_fixture", "only the Work Order this run created is ever named");
  assert.ok(new Date(sched.input.scheduledStart) > new Date("2026-10-22T12:00:00Z"), "window starts in the future");
  const done = lines.at(-1);
  assert.equal(done.outcome, "DISPATCH_READY");
  assert.equal(done.status, "SCHEDULED");
  assert.equal(done.assigneeEmployeeId, TECH);
  const text = JSON.stringify(lines);
  assert.ok(![CREDENTIAL, TOKEN].some((s) => text.includes(s)), "no secret in the output");
});

test("re-run on a SCHEDULED Work Order is idempotent: no ready, no schedule", async () => {
  const api = mockApi({ initialStatus: "SCHEDULED" });
  const { code, lines } = await runTool(api, ["--apply"]);
  assert.equal(code, 0);
  assert.ok(!writes(api).includes("markWorkOrderReady") && !writes(api).includes("scheduleWorkOrder"));
  assert.equal(lines.at(-1).outcome, "DISPATCH_READY");
});

test("a Work Order already past SCHEDULED (Codex dispatched it) is never rewound", async () => {
  const api = mockApi({ initialStatus: "DISPATCHED" });
  const { code, lines } = await runTool(api, ["--apply"]);
  assert.equal(code, 2);
  assert.equal(lines.at(-1).code, "BEYOND_FIXTURE");
  assert.ok(!writes(api).includes("markWorkOrderReady") && !writes(api).includes("scheduleWorkOrder"));
});

test("SCHEDULE_CONFLICT retries the same governed command on a later day; any other refusal stops", async () => {
  const api = mockApi({ conflicts: 2 });
  const { code } = await runTool(api, ["--apply"]);
  assert.equal(code, 0);
  const days = api.calls.filter((c) => c.operation === "scheduleWorkOrder").map((c) => c.input.scheduledStart.slice(0, 10));
  assert.deepEqual(days, ["2026-10-24", "2026-10-25", "2026-10-26"]);

  const refusedApi = mockApi({ refuse: { markWorkOrderReady: "CAPABILITY_MISSING" } });
  const r = await runTool(refusedApi, ["--apply"]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.lines.at(-1), { step: "D4", outcome: "REFUSED", code: "CAPABILITY_MISSING" });
  assert.ok(!writes(refusedApi).includes("scheduleWorkOrder"), "stops at the first refusal");
});

test("preview is read-only: OK when the personas hold the capabilities, MISSING_CAPABILITY (exit 2) when not", async () => {
  const good = mockApi();
  const ok = await runTool(good, ["--preview"]);
  assert.equal(ok.code, 0);
  assert.deepEqual([...new Set(good.calls.map((c) => c.operation))], ["readMyWorkOrderCapabilities"]);

  const none = mockApi({ capabilities: ["workOrder.record.read"] });
  const r = await runTool(none, ["--preview"]);
  assert.equal(r.code, 2);
  assert.deepEqual([...new Set(none.calls.map((c) => c.operation))], ["readMyWorkOrderCapabilities"]);
  assert.ok(r.lines.some((l) => l.outcome === "MISSING_CAPABILITY" && l.missing.includes("workOrder.lifecycle.dispatch")));
});
