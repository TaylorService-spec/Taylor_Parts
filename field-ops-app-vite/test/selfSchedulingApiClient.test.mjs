// CUSTOMER SELF-SCHEDULING -- the public client (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
// No login, no Firebase, no bearer: the token travels in the BODY, credentials are omitted, and the only thing the
// page can send is { token } or { token, slotStart }. Refusals are plain language; the link path is parsed strictly.
//
// Run: node --test test/selfSchedulingApiClient.test.mjs   (also `npm test`)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SELF_SCHEDULING_ROUTE, callSelfScheduling, customerMessageFor, customerSchedulingToken, groupSlotsByDay, selfSchedulingClient,
} from "../src/services/selfSchedulingApiClient.js";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";

describe("the public self-scheduling client", () => {
  it("sends the token in the body -- no auth header, no cookies, no referrer", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: "OPEN", slots: [] } }) };
    };
    const r = await selfSchedulingClient.readOffer(TOKEN, { baseUrl: "https://api.example/", fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(seen[0].url, `https://api.example${SELF_SCHEDULING_ROUTE}`);
    assert.deepEqual(JSON.parse(seen[0].init.body), { operation: "readSchedulingOffer", input: { token: TOKEN } });
    assert.deepEqual(Object.keys(seen[0].init.headers), ["content-type"]);
    assert.equal(seen[0].init.credentials, "omit");
    assert.equal(seen[0].init.referrerPolicy, "no-referrer");
    assert.equal(seen[0].url.includes(TOKEN), false, "never in the URL");
  });

  it("a selection sends exactly the token and the offered time", async () => {
    let body;
    const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; };
    await selfSchedulingClient.select(TOKEN, "2026-10-05T16:00:00.000Z", { baseUrl: "https://api.example", fetchImpl });
    assert.deepEqual(body, { operation: "selectSchedulingSlot", input: { token: TOKEN, slotStart: "2026-10-05T16:00:00.000Z" } });
  });

  it("a stale refusal carries the refreshed choices; nothing throws", async () => {
    const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: "SLOT_NO_LONGER_AVAILABLE", message: "taken", refreshed: { slots: [{ slotStart: "x" }] } }) });
    const r = await callSelfScheduling("selectSchedulingSlot", { token: TOKEN, slotStart: "y" }, { baseUrl: "https://api.example", fetchImpl });
    assert.deepEqual([r.ok, r.code, r.status, r.refreshed.slots.length], [false, "SLOT_NO_LONGER_AVAILABLE", 409, 1]);
    const down = await callSelfScheduling("readSchedulingOffer", { token: TOKEN }, { baseUrl: "https://api.example", fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(down.code, "UNREACHABLE");
    assert.equal((await callSelfScheduling("readSchedulingOffer", {}, { baseUrl: "", fetchImpl })).code, "NOT_CONFIGURED");
  });

  it("parses the link path strictly, under a basename", () => {
    assert.equal(customerSchedulingToken(`/schedule/${TOKEN}`), TOKEN);
    assert.equal(customerSchedulingToken(`/Taylor_Parts/field-ops/schedule/${TOKEN}/`, "/Taylor_Parts/field-ops"), TOKEN);
    assert.equal(customerSchedulingToken("/schedule/short"), null);
    assert.equal(customerSchedulingToken(`/schedule/${TOKEN}/extra`), null);
    assert.equal(customerSchedulingToken(`/service/schedule/${TOKEN}`), null);
  });

  it("groups slots by the customer's day and speaks plainly", () => {
    const days = groupSlotsByDay([{ dateLabel: "Mon", slotStart: "a" }, { dateLabel: "Mon", slotStart: "b" }, { dateLabel: "Tue", slotStart: "c" }]);
    assert.deepEqual(days.map((d) => [d.dateLabel, d.slots.length]), [["Mon", 2], ["Tue", 1]]);
    for (const code of ["SESSION_EXPIRED", "SESSION_REVOKED", "SLOT_NO_LONGER_AVAILABLE", "SESSION_ALREADY_USED", "anything"]) {
      assert.doesNotMatch(customerMessageFor(code), /[A-Z]{2,}_[A-Z]/, `${code} is not an enum on the page`);
    }
  });

  it("imports no Firebase and no signed-in identity", () => {
    for (const f of ["src/services/selfSchedulingApiClient.js", "src/modules/selfScheduling/CustomerSchedulingPage.jsx"]) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      assert.doesNotMatch(src, /firebase|useAuth|AuthContext|getIdToken/, f);
    }
  });
});
