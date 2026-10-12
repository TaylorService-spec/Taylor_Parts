// GOVERNED FIELD GROUPS -- the generic Object-level field-permission evaluator (functions/src/eosOps/governedFieldGroups.ts).
// Pure: no database, no network. Prerequisite: `npm run build` (imports the compiled lib/ output).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fg = require("../lib/eosOps/governedFieldGroups.js");

// A neutral Object -- nothing supplier-specific: the evaluator must not know what it governs.
const DEF = fg.defineFieldGroups({
  objectKey: "widget",
  groups: [
    { key: "BASIC", label: "Basic", fields: ["id", "name"], read: null, create: null, edit: null, sensitive: false },
    { key: "OPS", label: "Operations", fields: ["leadTime"], read: "w.ops.read", create: "w.ops.create", edit: "w.ops.edit", sensitive: false },
    { key: "MONEY", label: "Money", fields: ["price", "currency"], read: ["w.read", "w.money.read"], create: "w.money.create", edit: "w.money.edit", sensitive: true },
  ],
});
const caps = (...keys) => new Set(keys);
const RECORD = Object.freeze({ id: "w1", name: "Widget", leadTime: 3, price: "9.5", currency: "USD" });

test("defineFieldGroups refuses an ambiguous or malformed definition", () => {
  const g = (key, fields, extra = {}) => ({ key, label: key, fields, read: null, create: null, edit: null, sensitive: false, ...extra });
  assert.throws(() => fg.defineFieldGroups({ objectKey: "x", groups: [g("A", ["f"]), g("A", ["h"])] }), /group A twice/);
  assert.throws(() => fg.defineFieldGroups({ objectKey: "x", groups: [g("A", ["f"]), g("B", ["f"])] }), /field f is in both A and B/);
  assert.throws(() => fg.defineFieldGroups({ objectKey: "x", groups: [g("A", ["f"], { read: [] })] }), /non-empty list/);
  assert.throws(() => fg.defineFieldGroups({ objectKey: "x", groups: [g("A", ["f"], { edit: "" })] }), /non-empty list/);
  assert.throws(() => fg.defineFieldGroups({ objectKey: "", groups: [] }), /objectKey/);
});

test("fieldAccessFor: null = the record gate; a key must be held; a list is ALL-OF", () => {
  assert.deepEqual(fg.fieldAccessFor(DEF, caps()), {
    BASIC: { read: true, create: true, edit: true },
    OPS: { read: false, create: false, edit: false },
    MONEY: { read: false, create: false, edit: false },
  });
  assert.deepEqual(fg.fieldAccessFor(DEF, caps("w.money.read")).MONEY, { read: false, create: false, edit: false }, "half of an all-of is nothing");
  assert.deepEqual(fg.fieldAccessFor(DEF, caps("w.read", "w.money.read")).MONEY, { read: true, create: false, edit: false });
  assert.deepEqual(fg.fieldAccessFor(DEF, caps("w.money.create", "w.money.edit")).MONEY, { read: false, create: true, edit: true }, "write without read is representable");
  assert.deepEqual(fg.fieldAccessFor(DEF, "not a set").OPS, { read: false, create: false, edit: false }, "a non-Set fails closed");
});

test("capabilities are ADDITIVE: the union of two Roles' keys never grants less than either alone", () => {
  const roleA = ["w.ops.read", "w.read"];
  const roleB = ["w.money.read", "w.money.edit"];
  const a = fg.fieldAccessFor(DEF, caps(...roleA));
  const b = fg.fieldAccessFor(DEF, caps(...roleB));
  const ab = fg.fieldAccessFor(DEF, caps(...roleA, ...roleB));
  for (const g of Object.keys(ab)) for (const m of ["read", "create", "edit"]) {
    assert.equal(ab[g][m], ab[g][m] || a[g][m] || b[g][m], `${g}.${m} never narrows`);
    if (a[g][m] || b[g][m]) assert.equal(ab[g][m], true, `${g}.${m} kept`);
  }
  assert.equal(ab.MONEY.read, true, "the all-of is met across two Roles");
  assert.equal(a.MONEY.read || b.MONEY.read, false, "but by neither alone");
});

test("projectForCaller REMOVES an unreadable group's fields, names it in `withheld`, and never carries a value", () => {
  const p = fg.projectForCaller(DEF, caps("w.ops.read"), RECORD);
  assert.deepEqual(p, { id: "w1", name: "Widget", leadTime: 3, withheld: [{ group: "MONEY", fields: ["price", "currency"], requires: ["w.read", "w.money.read"] }] });
  assert.equal(Object.prototype.hasOwnProperty.call(p, "price"), false, "absent, not null");
  assert.equal(JSON.stringify(p).includes("9.5"), false);
  assert.equal(JSON.stringify(p).includes("USD"), false);
  const full = fg.projectForCaller(DEF, caps("w.ops.read", "w.read", "w.money.read"), RECORD);
  assert.deepEqual(full, { ...RECORD, withheld: [] });
});

test("projectForCaller fails closed on undeclared fields and never fabricates", () => {
  const p = fg.projectForCaller(DEF, caps("w.ops.read", "w.read", "w.money.read"), { id: "w2", secretNote: "x" });
  assert.deepEqual(p, { id: "w2", withheld: [] }, "an undeclared field is dropped; absent fields are not invented");
  const q = fg.projectForCaller(DEF, caps(), { id: "w3", name: "n" });
  assert.deepEqual(q, { id: "w3", name: "n", withheld: [] }, "a group the record does not carry is not reported withheld");
  const r = fg.projectForCaller(DEF, caps(), { id: "w4", price: null });
  assert.deepEqual(r.withheld.map((w) => w.group), ["MONEY"], "a null in an unreadable group is still withheld (its presence is information)");
  assert.equal(Object.prototype.hasOwnProperty.call(r, "price"), false);
  assert.deepEqual(fg.projectForCaller(DEF, caps(), null), { withheld: [] });
});

test("assertWritable: per mode, naming the group and the key -- never a value; unknown fields fail closed", () => {
  fg.assertWritable(DEF, caps(), "create", ["id", "name"]);
  fg.assertWritable(DEF, caps("w.money.create"), "create", ["name", "price"]);
  fg.assertWritable(DEF, caps(), "edit", []);
  const refusal = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a refusal"); };
  const e1 = refusal(() => fg.assertWritable(DEF, caps("w.money.create"), "edit", ["price"]));
  assert.ok(e1 instanceof fg.GovernedFieldGroupError);
  assert.deepEqual([e1.code, e1.category, e1.details.group, e1.details.requires, e1.details.fields], ["FIELD_GROUP_FORBIDDEN", "FORBIDDEN", "MONEY", ["w.money.edit"], ["price"]]);
  assert.match(e1.message, /FIELD_GROUP_FORBIDDEN: changing Money \(price\) requires w\.money\.edit/);
  const e2 = refusal(() => fg.assertWritable(DEF, caps("w.money.edit", "w.money.read", "w.read"), "create", ["currency"]));
  assert.match(e2.message, /setting Money \(currency\) requires w\.money\.create/, "read + edit do not imply create");
  const e3 = refusal(() => fg.assertWritable(DEF, caps("w.money.create", "w.money.edit", "w.ops.create", "w.ops.edit"), "edit", ["name", "mystery"]));
  assert.deepEqual([e3.code, e3.details.fields, e3.details.group], ["FIELD_NOT_GOVERNED", ["mystery"], null]);
});

test("auditSafe replaces every SENSITIVE value (null included) and lists the names; sensitiveFieldsChanged names only", () => {
  const safe = fg.auditSafe(DEF, { ...RECORD, currency: null });
  assert.deepEqual(safe, { id: "w1", name: "Widget", leadTime: 3, price: { withheld: true }, currency: { withheld: true }, sensitiveFieldsWithheld: ["currency", "price"] });
  assert.equal(JSON.stringify(safe).includes("9.5"), false);
  assert.equal(fg.auditSafe(DEF, null), null);
  assert.deepEqual(fg.auditSafe(DEF, { id: "w5" }), { id: "w5", sensitiveFieldsWithheld: [] }, "nothing is fabricated");
  assert.deepEqual(fg.sensitiveFieldsChanged(DEF, RECORD, { ...RECORD, price: "10", leadTime: 4 }), ["price"], "non-sensitive changes are not listed here");
  assert.deepEqual(fg.sensitiveFieldsChanged(DEF, null, RECORD), ["currency", "price"]);
  assert.deepEqual(fg.sensitiveFieldsChanged(DEF, RECORD, RECORD), []);
});

test("the evaluator is generic: no persona, Role, title or supplier vocabulary, no I/O", () => {
  const src = readFileSync(new URL("../src/eosOps/governedFieldGroups.ts", import.meta.url), "utf8")
    .replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const word of [/supplier/i, /owner/i, /administrator/i, /generalManager/i, /\bimport\b/, /firebase/i, /\bpg\b/]) {
    assert.equal(word.test(src), false, `${word} is not in the evaluator's code`);
  }
});

test("the RECORD doorway: recordAccessFor reports each named record action, fail closed; a malformed one is refused", () => {
  const withRecord = fg.defineFieldGroups({
    objectKey: "widget", record: { read: "w.read", edit: "w.edit", changeStatus: "w.status" },
    groups: [{ key: "BASIC", label: "Basic", fields: ["id"], read: "w.read", create: null, edit: "w.edit", sensitive: false }],
  });
  assert.deepEqual(fg.recordAccessFor(withRecord, caps("w.read")), { read: true, edit: false, changeStatus: false });
  assert.deepEqual(fg.recordAccessFor(withRecord, caps("w.read", "w.status")), { read: true, edit: false, changeStatus: true }, "additive");
  assert.deepEqual(fg.recordAccessFor(DEF, caps("w.read")), {}, "no record actions declared, none reported");
  assert.deepEqual(fg.recordAccessFor(withRecord, null), { read: false, edit: false, changeStatus: false }, "no capability set is no access");
  assert.throws(() => fg.defineFieldGroups({ objectKey: "x", record: { read: "" }, groups: [] }), /record action read/);
  assert.ok(Object.isFrozen(withRecord.record));
});

test("canReadAllGroups: true only when EVERY group is readable (the gate for answers decided by stored values)", () => {
  assert.equal(fg.canReadAllGroups(DEF, caps("w.ops.read", "w.read", "w.money.read")), true);
  assert.equal(fg.canReadAllGroups(DEF, caps("w.ops.read")), false);
  assert.equal(fg.canReadAllGroups(DEF, caps("w.read", "w.money.read")), false);
});
