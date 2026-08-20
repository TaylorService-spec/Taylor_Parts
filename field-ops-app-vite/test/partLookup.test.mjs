// LOOKUP-ONLY SCANNING — the pure lookup contract. No emulator, no React, no network.
// Run: node --test test/partLookup.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildPartLookup, describePartLookup, trackingModeForDisplay,
  LOOKUP_STATE, FIELD_STATE, INERT_LOOKUP_CAPABILITIES,
} from "../src/domain/partLookup.js";

const part = (over = {}) => ({
  invalid: false,
  partId: "PRT-1001",
  internalPartNumber: "TS-1001",
  name: "Compressor relay",
  description: "Start relay, 240V",
  category: "Electrical",
  status: "ACTIVE",
  stockingUnit: "EACH",
  controlType: "STANDARD",
  stockingClass: "STOCKED",
  version: 3,
  ...over,
});

const ok = (...parts) => ({ ok: true, parts, invalid: [] });
const rowFor = (rows, label) => rows.find((r) => r.label === label);

// ─────────────────────────────────────────── resolution

test("a known part resolves by its PART ID", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED);
  assert.equal(r.part.partId, "PRT-1001");
});

test("a known part also resolves by its INTERNAL PART NUMBER — the code on the shelf label", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), token: "TS-1001" });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED);
  assert.equal(r.part.partId, "PRT-1001");
});

test("matching is case-insensitive but never fuzzy", () => {
  assert.equal(buildPartLookup({ catalogResult: ok(part()), token: "prt-1001" }).state, LOOKUP_STATE.RESOLVED);
  // one character off is NOT_FOUND, not a helpful guess
  assert.equal(buildPartLookup({ catalogResult: ok(part()), token: "PRT-1002" }).state, LOOKUP_STATE.NOT_FOUND);
});

test("an unknown identifier is NOT_FOUND, and the message does not deny existence beyond the catalog", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), token: "PRT-9999" });
  assert.equal(r.state, LOOKUP_STATE.NOT_FOUND);
  assert.match(r.message, /no governed record matches/i);
  assert.equal(r.part, null);
});

test("an AMBIGUOUS identifier resolves to nothing and lists what it hit", () => {
  // A real collision: one part's internal number is another part's id.
  const a = part({ partId: "PRT-1001", internalPartNumber: "TS-1001" });
  const b = part({ partId: "TS-1001", internalPartNumber: "TS-2002", name: "Other" });
  const r = buildPartLookup({ catalogResult: ok(a, b), token: "TS-1001" });
  assert.equal(r.state, LOOKUP_STATE.AMBIGUOUS);
  assert.equal(r.part, null, "an ambiguous scan must not pick one");
  assert.equal(r.candidates.length, 2);
});

test("an INVALID token is distinguished from a missing one", () => {
  // Empty input has not been asked yet; garbage has been asked and cannot be read.
  assert.equal(buildPartLookup({ catalogResult: ok(part()), token: "   " }).state, LOOKUP_STATE.IDLE);
  assert.equal(buildPartLookup({ catalogResult: ok(part()), token: "{}" }).state, LOOKUP_STATE.INVALID);
});

// ─────────────────────────────────────────── refusal is not absence

test("PERMISSION-DENIED is DENIED — never NOT_FOUND, never an empty result", () => {
  const r = buildPartLookup({ catalogResult: { ok: false, code: "permission-denied" }, token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.DENIED);
  assert.match(r.message, /not authorized/i);
  assert.doesNotMatch(r.message, /no.*match|not found/i, "a refusal must not be worded as an absence");
});

test("a FAILED read is READ_FAILED — never an empty catalog", () => {
  for (const bad of [{ ok: false, code: "unavailable" }, null, undefined, "nope"]) {
    const r = buildPartLookup({ catalogResult: bad, token: "PRT-1001" });
    assert.equal(r.state, LOOKUP_STATE.READ_FAILED, `${JSON.stringify(bad)} must not read as empty`);
    assert.equal(r.part, null);
  }
});

test("DENIED and READ_FAILED are different states with different words", () => {
  const denied = buildPartLookup({ catalogResult: { ok: false, code: "permission-denied" }, token: "X-1" });
  const failed = buildPartLookup({ catalogResult: { ok: false, code: "unavailable" }, token: "X-1" });
  assert.notEqual(denied.state, failed.state);
  assert.notEqual(denied.message, failed.message);
});

test("an EMPTY readable catalog is NOT_FOUND, not denied", () => {
  const r = buildPartLookup({ catalogResult: ok(), token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.NOT_FOUND);
});

test("a resolver hit the catalog cannot read back is READ_FAILED, not a part with blank fields", () => {
  // Incoherent rather than empty: reporting it as a resolved part would render a card of blanks.
  const r = buildPartLookup({ catalogResult: { ok: true, parts: [{ partId: "PRT-1001", internalPartNumber: "TS-1001" }] }, token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED, "a projection this shape is still a real part row");
  const broken = buildPartLookup({
    catalogResult: { ok: true, parts: [{ partId: null, internalPartNumber: "TS-1001" }] },
    token: "TS-1001",
  });
  assert.equal(broken.state, LOOKUP_STATE.READ_FAILED);
});

// ─────────────────────────────────────────── UNKNOWN is first-class

test("UNKNOWN is never rendered away — an absent value keeps its row and its reason", () => {
  const rows = describePartLookup(part({ description: "", category: "" }));
  for (const label of ["Description", "Category"]) {
    const row = rowFor(rows, label);
    assert.ok(row, `${label} row must still exist`);
    assert.equal(row.state, FIELD_STATE.UNKNOWN);
    assert.equal(row.value, null, "never a dash, a zero or an empty string standing in for a value");
    assert.ok(row.detail, `${label} must say why it is empty`);
  }
});

test("an unmappable control type is UNKNOWN tracking — never defaulted to LOT or NONE", () => {
  // The server's receiving wiring ends `default: return "LOT"` so its validator refuses. That is the
  // right shape for a command and the WRONG shape for a display: it would tell an operator an
  // unrecognized part is lot-tracked.
  assert.equal(trackingModeForDisplay("SERIALIZED_LOT"), null);
  assert.equal(trackingModeForDisplay("WHAT"), null);
  assert.equal(trackingModeForDisplay(undefined), null);

  const row = rowFor(describePartLookup(part({ controlType: "SERIALIZED_LOT" })), "Tracking");
  assert.equal(row.state, FIELD_STATE.UNKNOWN);
  assert.notEqual(row.value, "LOT");
  assert.notEqual(row.value, "NONE");
});

test("the mappings that ARE unambiguous are reported exactly", () => {
  assert.equal(trackingModeForDisplay("STANDARD"), "NONE");
  assert.equal(trackingModeForDisplay("SERIALIZED"), "SERIAL");
  assert.equal(trackingModeForDisplay("LOT"), "LOT");
  assert.equal(rowFor(describePartLookup(part({ controlType: "SERIALIZED" })), "Tracking").value, "SERIAL");
});

test("rows whose CAPABILITY IS INERT say so, and are not omitted", () => {
  const rows = describePartLookup(part());
  for (const label of ["Serialized units", "Location"]) {
    const row = rowFor(rows, label);
    assert.ok(row, `${label} must be present so its absence is not read as "none"`);
    assert.equal(row.state, FIELD_STATE.CAPABILITY_INACTIVE);
    assert.match(row.detail, /not switched on/i);
  }
});

test("stock balance is NO_GOVERNED_READ, which is a different fact from inert", () => {
  // Saying "not switched on" would imply a balance read exists behind a switch. None exists.
  const row = rowFor(describePartLookup(part()), "On hand");
  assert.equal(row.state, FIELD_STATE.NO_GOVERNED_READ);
  assert.notEqual(row.state, FIELD_STATE.CAPABILITY_INACTIVE);
  assert.equal(row.value, null, "never zero — an unreadable balance is not a balance of zero");
});

test("the inert capabilities are named exactly, and are the real catalog ids", () => {
  assert.equal(INERT_LOOKUP_CAPABILITIES.SERIALIZED_ASSET, "inventory.serializedAsset.read");
  assert.equal(INERT_LOOKUP_CAPABILITIES.LOCATION_DISPLAY, "inventory.location.display.read");
});

test("every authoritative field carries a real value, and every row is one or the other", () => {
  const rows = describePartLookup(part());
  assert.equal(rowFor(rows, "Part number").value, "TS-1001");
  assert.equal(rowFor(rows, "Catalog status").value, "ACTIVE");
  assert.equal(rowFor(rows, "Stocking unit").value, "EACH");
  for (const row of rows) {
    assert.ok(Object.values(FIELD_STATE).includes(row.state), `${row.label} has no field state`);
    if (row.state === FIELD_STATE.KNOWN) assert.ok(row.value, `${row.label} claims KNOWN with no value`);
    else assert.equal(row.value, null, `${row.label} carries a value it should not`);
  }
});

// ─────────────────────────────────────────── it moves nothing

test("the module imports NO command, service, writer or Firebase", () => {
  const src = readFileSync(new URL("../src/domain/partLookup.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/firebase/i, /firestore/i, /Command/, /Service/, /submit/i, /receive/i, /adjust/i, /transfer/i]) {
    assert.doesNotMatch(code, forbidden, `partLookup must not reference ${forbidden}`);
  }
});

test("no result shape can carry an action", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), token: "PRT-1001" });
  assert.equal(r.actions, undefined);
  assert.equal(r.part.quantity, undefined);
  // Phase G added matchedBy/matchedIdentifier — descriptions of HOW the part was reached, not
  // things to do with it. The exact key set stays pinned so an action field cannot appear quietly.
  assert.deepEqual(
    Object.keys(r).sort(),
    ["candidates", "matchedBy", "matchedIdentifier", "message", "part", "rows", "state", "token"],
  );
});

test("results are frozen — a caller cannot upgrade a denial into a result", () => {
  const denied = buildPartLookup({ catalogResult: { ok: false, code: "permission-denied" }, token: "X-1" });
  assert.throws(() => { denied.state = LOOKUP_STATE.RESOLVED; }, TypeError);
  const resolved = buildPartLookup({ catalogResult: ok(part()), token: "PRT-1001" });
  assert.throws(() => { resolved.rows.push({ label: "Made up" }); }, TypeError);
});
