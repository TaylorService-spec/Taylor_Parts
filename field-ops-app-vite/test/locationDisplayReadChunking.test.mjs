// The getLocationDisplay client splits a large id set into server-sized requests (the server refuses
// more than 50 ids per call) and fails closed as a whole if any chunk fails. PURE: an injected invoker.
import assert from "node:assert/strict";
import test from "node:test";
import { fetchLocationDisplay, chunkLocationIds, MAX_LOCATION_IDS_PER_REQUEST } from "../src/services/locationDisplayReadCallableClient.js";

const ids = (n) => Array.from({ length: n }, (_, i) => `loc-${String(i).padStart(3, "0")}`);
const ready = (chunk) => ({ status: "ready", locations: chunk.map((locationId) => ({ locationId, type: "WAREHOUSE", label: locationId.toUpperCase() })) });

test("the bound matches the server's MAX_LOCATION_IDS and chunks preserve every id in order", () => {
  assert.equal(MAX_LOCATION_IDS_PER_REQUEST, 50);
  const chunks = chunkLocationIds(ids(121));
  assert.deepEqual(chunks.map((c) => c.length), [50, 50, 21]);
  assert.deepEqual(chunks.flat(), ids(121));
  assert.deepEqual(chunkLocationIds([]), []);
});

test("<= 50 ids is one request, exactly as before", async () => {
  const calls = [];
  const out = await fetchLocationDisplay(ids(50), async (c) => { calls.push(c.length); return ready(c); });
  assert.deepEqual(calls, [50]);
  assert.equal(out.result.locations.length, 50);
});

test("> 50 ids: every request is within the server bound, and the answer covers every id", async () => {
  const calls = [];
  const out = await fetchLocationDisplay(ids(130), async (c) => {
    assert.ok(c.length <= 50, "a request over the bound would be refused as invalid-argument");
    calls.push(c.length); return ready(c);
  });
  assert.deepEqual(calls, [50, 50, 30]);
  assert.equal(out.result.status, "ready");
  assert.equal(out.result.locations.length, 130);
});

test("any failed chunk fails the whole read -- denied wins -- never a partial set presented as complete", async () => {
  let n = 0;
  const denied = await fetchLocationDisplay(ids(120), async (c) => { n += 1; if (n === 2) throw Object.assign(new Error("x"), { code: "functions/permission-denied" }); return ready(c); });
  assert.deepEqual(denied, { errorStatus: "denied" });
  const down = await fetchLocationDisplay(ids(120), async (c) => { if (c[0] === "loc-050") throw Object.assign(new Error("x"), { code: "functions/internal" }); return ready(c); });
  assert.deepEqual(down, { errorStatus: "unavailable" });
  const malformed = await fetchLocationDisplay(ids(60), async (c) => (c.length === 10 ? { status: "weird" } : ready(c)));
  assert.deepEqual(malformed, { errorStatus: "unavailable" });
});
