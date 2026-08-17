// Bounded picker reads — offline tests.
//
// The defect: three surfaces load the ENTIRE accounts collection to populate a
// dropdown. At two accounts that is invisible; at 250k it is a quarter of a million
// reads to choose one.
//
// The subtler risk is in the fix rather than the defect. Bounding a picker WITHOUT
// disclosing the bound converts a performance problem into a correctness one: a dropdown
// silently showing the first N of 250k looks identical to one showing everything, so a
// user searching for a customer that exists concludes it does not. Most of these test
// the disclosure, not the limit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretPickerRead, pickerQueryShape, PICKER_READ_CAP, PICKER_STATE } from "../src/domain/pickerSource.js";

const docs = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `acct-${from + i}`, name: `Customer ${from + i}` }));

test("PICKER_STATE is frozen and keeps truncated distinct from ready and empty", () => {
  assert.ok(Object.isFrozen(PICKER_STATE));
  for (const s of ["READY", "TRUNCATED", "EMPTY", "UNAVAILABLE"]) assert.ok(PICKER_STATE.includes(s));
});

test("a read under the cap behaves exactly as before — this change is invisible at current scale", () => {
  const r = interpretPickerRead({ docs: docs(2) });
  assert.equal(r.state, "READY");
  assert.equal(r.options.length, 2);
  assert.equal(r.truncated, false);
  assert.equal(r.message, null, "no notice when nothing was withheld");
});

test("a read exactly AT the cap is not truncated", () => {
  const r = interpretPickerRead({ docs: docs(PICKER_READ_CAP) });
  assert.equal(r.state, "READY");
  assert.equal(r.options.length, PICKER_READ_CAP);
  assert.equal(r.truncated, false);
});

test("the probe row is dropped, never offered as a choice", () => {
  // An off-by-one in a picker shows an option the caller never intended to include.
  const r = interpretPickerRead({ docs: docs(PICKER_READ_CAP + 1) });
  assert.equal(r.options.length, PICKER_READ_CAP);
  assert.equal(r.options.at(-1).id, `acct-${PICKER_READ_CAP - 1}`);
});

// --- the disclosure IS the fix ----------------------------------------------

test("truncation is DISCLOSED — a silent subset is worse than the unbounded read", () => {
  // A dropdown quietly showing the first N of 250k is indistinguishable from one showing
  // all of them, so someone searching for a customer that exists concludes it does not.
  const r = interpretPickerRead({ docs: docs(PICKER_READ_CAP + 50) });
  assert.equal(r.state, "TRUNCATED");
  assert.equal(r.truncated, true);
  assert.match(r.message, new RegExp(`first ${PICKER_READ_CAP}`));
});

test("the truncation notice says what to DO, not only what happened", () => {
  // A notice with no next step just tells someone their tool is inadequate.
  const r = interpretPickerRead({ docs: docs(PICKER_READ_CAP + 1) });
  assert.match(r.message, /search/i);
});

test("EMPTY and TRUNCATED are never confused", () => {
  assert.equal(interpretPickerRead({ docs: [] }).state, "EMPTY");
  assert.equal(interpretPickerRead({ docs: docs(PICKER_READ_CAP + 1) }).state, "TRUNCATED");
});

test("a failed read is UNAVAILABLE and never reads as 'no customers'", () => {
  // Different facts: only one of them means the user should stop looking.
  const r = interpretPickerRead({ error: new Error("permission-denied") });
  assert.equal(r.state, "UNAVAILABLE");
  assert.deepEqual(r.options, []);
  assert.ok(!/^No customers/.test(r.message));
  assert.match(r.message, /could not be loaded/);
});

test("a missing result is UNAVAILABLE, not EMPTY — nothing fetched is not nothing there", () => {
  assert.equal(interpretPickerRead({ docs: null }).state, "UNAVAILABLE");
  assert.equal(interpretPickerRead({}).state, "UNAVAILABLE");
});

test("loading outranks everything and offers no options", () => {
  const r = interpretPickerRead({ loading: true, docs: docs(5) });
  assert.equal(r.state, "LOADING");
  assert.deepEqual(r.options, []);
});

test("no state except READY and TRUNCATED ever offers options", () => {
  for (const args of [{ loading: true, docs: docs(5) }, { error: new Error("x") }, { docs: [] }, { docs: null }]) {
    const r = interpretPickerRead(args);
    assert.deepEqual(r.options, [], `${r.state} must offer nothing`);
  }
});

// --- the query shape is bounded, and assertable without Firestore -----------

test("the query shape carries cap+1 so truncation is detected rather than assumed", () => {
  const shape = pickerQueryShape({ collection: "accounts" });
  assert.equal(shape.limit, PICKER_READ_CAP + 1);
  assert.equal(shape.cap, PICKER_READ_CAP);
});

test("a picker has no cursor — it narrows, it does not page", () => {
  // Paging a dropdown would be a worse answer than searching one: the user does not
  // want page 2 of their customers, they want the customer.
  const shape = pickerQueryShape({ collection: "accounts" });
  for (const k of ["cursor", "startAfter", "offset", "page"]) {
    assert.equal(k in shape, false, `${k} must not exist on a picker read`);
  }
});

test("the shape is ordered, so a truncated set is the first N by a stable rule", () => {
  // An unordered truncation would return an arbitrary subset that changes between reads,
  // which is a worse experience than a consistent one the user can reason about.
  const shape = pickerQueryShape({ collection: "accounts" });
  assert.deepEqual(shape.orderBy, [{ fieldPath: "name", direction: "ASC" }]);
});

test("a caller may lower the cap but the disclosure still applies", () => {
  const r = interpretPickerRead({ docs: docs(6), cap: 5 });
  assert.equal(r.state, "TRUNCATED");
  assert.equal(r.options.length, 5);
  assert.match(r.message, /first 5/);
});
