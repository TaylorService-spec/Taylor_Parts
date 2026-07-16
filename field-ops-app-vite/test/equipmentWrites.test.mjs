// Issue #232 unit E2 -- unit tests for the Equipment write orchestration
// (src/domain/equipmentWrites.js). Pure: the store is injected, so these run under
// plain node with no firebase, no emulator, no browser.
//
// This is the seam the independent review of PR #282 found untested: the payload
// builders were covered, but nothing proved the RULES around them -- fail-closed
// ownership, refusing a governed change, blocked/thrown errors mapping to safe copy,
// and above all that no write is attempted when it must not be.
//
// Run: node test/equipmentWrites.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  createEquipmentWith, updateEquipmentWith,
  moveEquipment, retireEquipment, reactivateEquipment, setEquipmentStatus,
} from "../src/domain/equipmentWrites.js";

let passed = 0;
async function ok(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

// A store that records every call, so "no write was attempted" is provable rather than
// assumed. Each mode is one the real store can actually produce.
//
// This fake is the oracle the whole suite rests on, so it must model
// makeCollectionStore's REAL contract exactly:
//   add(data)       -> { id, ...data }   | { blocked: true } | throws
//   update(id, data)-> { id, ...data }   | { blocked: true } | throws
// (An earlier version of this fake spread `args[0]` for both ops -- for `update` that
// is the id STRING, so it returned {0:'e',1:'q',...}. It stayed green only because no
// test asserted the edit's success shape. A wrong oracle proves nothing.)
function fakeStore(mode = "ok") {
  const calls = [];
  const handler = async (op, args) => {
    calls.push({ op, args });
    if (mode === "blocked") return { blocked: true };          // demo/panic mode
    if (mode === "denied") throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    if (mode === "offline") throw Object.assign(new Error("backend unreachable"), { code: "unavailable" });
    if (mode === "raw") throw new Error("FIRESTORE (10.0.0) INTERNAL ASSERTION FAILED: doc equipment/abc123");
    const id = op === "add" ? "eq1" : args[0];
    const data = op === "add" ? args[0] : args[1];
    return { id, ...data };
  };
  return {
    calls,
    add: (data) => handler("add", [data]),
    update: (id, data) => handler("update", [id, data]),
  };
}

const LOCATION = { id: "l1", accountId: "a1" };
const VALID = { accountId: "a1", locationId: "l1", name: "Rooftop Unit" };

// ---- create: ownership fails closed ---------------------------------------
await ok("create writes once when the Location proves it belongs to the owning Account", async () => {
  const store = fakeStore();
  const res = await createEquipmentWith(store, VALID, { location: LOCATION }, 100);
  assert.equal(res.ok, true);
  assert.equal(res.equipment.id, "eq1");
  assert.equal(store.calls.length, 1, "exactly one write -- no retry, no per-record loop");
  assert.equal(store.calls[0].op, "add");
  assert.equal(store.calls[0].args[0].status, "ACTIVE");
});

await ok("create attempts NO write when the Account/Location relationship is unproven", async () => {
  for (const [label, location] of [
    ["no location supplied", undefined],
    ["location belongs to another Account", { id: "l1", accountId: "OTHER" }],
    ["location is not the one named by the record", { id: "l9", accountId: "a1" }],
  ]) {
    const store = fakeStore();
    const res = await createEquipmentWith(store, VALID, { location }, 1);
    assert.equal(res.ok, false, label);
    assert.equal(store.calls.length, 0, `${label}: must fail closed, not write and hope Rules catch it`);
    assert.ok(res.errors.locationId);
  }
});

await ok("create attempts NO write when the record is invalid", async () => {
  const store = fakeStore();
  const res = await createEquipmentWith(store, { name: "Orphan" }, { location: LOCATION }, 1);
  assert.equal(res.ok, false);
  assert.equal(store.calls.length, 0);
  assert.ok(res.errors.accountId && res.errors.locationId);
});

// ---- update: governed immutability ----------------------------------------
await ok("edit writes only the editable fields it was given", async () => {
  const store = fakeStore();
  const before = { name: "Unit", model: "48TC", accountId: "a1", locationId: "l1", status: "ACTIVE" };
  const res = await updateEquipmentWith(store, "eq1", { ...before, name: "Renamed" }, { before }, 55);
  assert.equal(res.ok, true);
  assert.equal(store.calls.length, 1);
  const [id, payload] = store.calls[0].args;
  assert.equal(id, "eq1");
  assert.equal(payload.name, "Renamed");
  assert.equal(payload.updatedAt, 55);
  for (const f of ["accountId", "locationId", "status", "createdAt"]) {
    assert.equal(Object.hasOwn(payload, f), false, `${f} must never be written by an ordinary edit`);
  }
  // Assert the SUCCESS SHAPE too -- without this the oracle can misreport what the
  // store returned and the suite would never notice.
  // `model` is here because the caller spread `before` in and so did supply it -- an
  // edit writes what it was given, governed fields excepted.
  assert.deepEqual(res.equipment, { id: "eq1", name: "Renamed", model: "48TC", updatedAt: 55 });
});

await ok("an attempted governed change attempts NO write and never reports success", async () => {
  const before = { name: "Unit", accountId: "a1", locationId: "l1", status: "ACTIVE" };
  for (const [label, values] of [
    ["move", { ...before, locationId: "l2" }],
    ["re-own", { ...before, accountId: "a2" }],
    ["retire via the edit form", { ...before, status: "RETIRED" }],
  ]) {
    const store = fakeStore();
    const res = await updateEquipmentWith(store, "eq1", values, { before }, 1);
    assert.equal(res.ok, false, `${label} must be refused`);
    assert.equal(store.calls.length, 0, `${label}: nothing may be written`);
    assert.ok(res.governedFields.length > 0);
    assert.match(res.message, /Nothing was saved/);
  }
});

await ok("a whole-record edit without `before` fails closed rather than reporting a false success", async () => {
  // The defect the review caught: with `before` defaulted away, a dropped move
  // returned ok:true and the UI would announce a move that never happened.
  const store = fakeStore();
  const res = await updateEquipmentWith(store, "eq1", { name: "Unit", accountId: "a1", locationId: "l2" }, {}, 1);
  assert.equal(res.ok, false, "unprovable governed state must not resolve to success");
  assert.equal(store.calls.length, 0);
  // ...and it is reported as OUR missing proof, not as the user attempting a move.
  assert.equal(res.unprovable, true);
  assert.doesNotMatch(res.message, /can't be changed here/, "don't accuse the user of a caller bug");
});

await ok("a partial edit that touches nothing governed still succeeds without `before`", async () => {
  // The fail-closed rule must only fire when a governed field was actually supplied --
  // otherwise every ordinary descriptive edit would be refused.
  const store = fakeStore();
  const res = await updateEquipmentWith(store, "eq1", { name: "Renamed", notes: "n" }, {}, 3);
  assert.equal(res.ok, true);
  assert.equal(store.calls.length, 1);
});

await ok("edit attempts NO write for a missing id or an invalid field", async () => {
  const store = fakeStore();
  assert.equal((await updateEquipmentWith(store, "", { name: "x" }, { before: {} }, 1)).ok, false);
  assert.equal((await updateEquipmentWith(store, null, { name: "x" }, { before: {} }, 1)).ok, false);
  assert.equal((await updateEquipmentWith(store, "eq1", { name: "  " }, { before: { name: "U" } }, 1)).ok, false);
  assert.equal(store.calls.length, 0);
});

// ---- safe errors -----------------------------------------------------------
await ok("a blocked write reports safe copy and never optimistic success", async () => {
  const create = await createEquipmentWith(fakeStore("blocked"), VALID, { location: LOCATION }, 1);
  assert.equal(create.ok, false, "a blocked write is NOT a success");
  assert.match(create.message, /no equipment was saved/i);

  const edit = await updateEquipmentWith(fakeStore("blocked"), "eq1", { name: "N" }, { before: { name: "O" } }, 1);
  assert.equal(edit.ok, false);
  assert.match(edit.message, /no equipment was saved/i);
});

await ok("a thrown Firebase error never escapes and never leaks provider detail", async () => {
  for (const mode of ["denied", "offline", "raw"]) {
    for (const res of [
      await createEquipmentWith(fakeStore(mode), VALID, { location: LOCATION }, 1),
      await updateEquipmentWith(fakeStore(mode), "eq1", { name: "N" }, { before: { name: "O" } }, 1),
    ]) {
      assert.equal(res.ok, false, `${mode} must resolve to a safe failure, not throw or succeed`);
      // Code-SHAPED tokens only. Matching bare English words would flag the safe copy
      // itself ("temporarily unavailable" is human text, not the `unavailable` code).
      assert.doesNotMatch(
        res.message,
        /firebase|firestore|permission-denied|INTERNAL ASSERTION|insufficient permissions|equipment\/|\beq1\b|\bcode\b/i,
        `${mode}: safe copy must not carry a code, path, id, or provider name`
      );
      assert.match(res.message, /Nothing was saved/);
    }
  }
});

// ---- trusted-writer seam: no unauthorized writes ---------------------------
await ok("every trusted action reports unavailable, performs no write, and is not success", async () => {
  for (const [fn, action] of [
    [moveEquipment, "equipment.move"],
    [retireEquipment, "equipment.retire"],
    [reactivateEquipment, "equipment.reactivate"],
    [setEquipmentStatus, "equipment.setStatus"],
  ]) {
    const res = await fn("eq1", { toLocationId: "l2", reason: "x" });
    assert.equal(res.ok, false, `${action} must never look like success while Issue #15 is unresolved`);
    assert.equal(res.unavailable, true);
    assert.equal(res.reason, "trusted-writer-unavailable");
    assert.equal(res.action, action);
    assert.match(res.message, /Nothing was changed/);
    assert.doesNotMatch(res.message, /firebase|firestore|functions|permission|uid|token/i);
  }
});

// ---- #287: malformed input and no-op edits never reach the store ------------

await ok("#287 malformed input attempts NO write and reports it as our bug, not the user's", async () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  for (const bad of [null, "garbage", [], 42, true]) {
    const cs = fakeStore();
    const c = await createEquipmentWith(cs, bad, { location: { id: "loc-1", accountId: "acct-1" } }, 5);
    assert.equal(c.ok, false);
    assert.equal(cs.calls.length, 0, `create(${String(bad)}) must attempt no write`);

    const us = fakeStore();
    const u = await updateEquipmentWith(us, "equip-1", bad, { before }, 5);
    assert.equal(u.ok, false);
    assert.equal(us.calls.length, 0, `update(${String(bad)}) must attempt no write`);

    // No field error, because no field can fix a caller bug -- INVALID_MESSAGE would
    // tell the user to check highlighted fields while nothing is highlighted.
    for (const res of [c, u]) {
      assert.deepEqual(res.errors, {}, "malformed input must blame no field");
      assert.doesNotMatch(res.message, /highlighted/i,
        "must not point at highlights that do not exist");
      assert.doesNotMatch(res.message, /firebase|firestore|permission-denied|uid|token|apiKey|[A-Za-z0-9_-]{20,}/i);
    }
  }
});

await ok("#287 a no-op edit attempts no write and is never reported as saved", async () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  const store = fakeStore();
  const res = await updateEquipmentWith(store, "equip-1", {}, { before }, 5);
  // The original defect end to end: this once wrote { updatedAt: 5 } and returned ok.
  assert.equal(res.ok, false);
  assert.equal(store.calls.length, 0, "no write -- there was nothing to write");
  assert.deepEqual(res.errors, {}, "the user did nothing wrong");
  assert.match(res.message, /Nothing was changed/);
});

await ok("#287 a governed attempt is reported as governed, never as 'nothing changed'", async () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  const store = fakeStore();
  // The user asked to move the Account and touched no editable field. Telling them
  // "Nothing was changed" would be the exact inverse of what they just did.
  const res = await updateEquipmentWith(store, "equip-1", { accountId: "acct-2" }, { before }, 5);
  assert.equal(res.ok, false);
  assert.equal(store.calls.length, 0);
  assert.deepEqual(res.governedFields, ["accountId"]);
  assert.match(res.message, /can't be changed here/);
  assert.doesNotMatch(res.message, /Nothing was changed/,
    "a governed refusal must not masquerade as an empty edit");
});

console.log(`\n${passed} passed, 0 failed`);
