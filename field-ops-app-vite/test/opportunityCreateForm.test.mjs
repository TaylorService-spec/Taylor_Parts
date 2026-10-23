import test from "node:test";
import assert from "node:assert/strict";
import { validateOpportunityCreateInput, buildOpportunityCreatePayload } from "../src/domain/opportunityCreateForm.js";

const VALID = { accountId: "A1", ownerEmployeeId: "E1", salesChannel: "RETAIL", need: "", expectedValue: null, expectedCloseAt: null };

test("validateOpportunityCreateInput: a fully valid minimal draft is ok with no errors", () => {
  assert.deepEqual(validateOpportunityCreateInput(VALID), { ok: true, errors: {} });
});

test("validateOpportunityCreateInput: requires accountId and a valid channel; a blank owner is NOT an error (D-4)", () => {
  const r = validateOpportunityCreateInput({ ...VALID, accountId: "", ownerEmployeeId: "  ", salesChannel: "BOGUS" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.accountId);
  assert.ok(r.errors.salesChannel);
  assert.ok(!("ownerEmployeeId" in r.errors));
});

test("validateOpportunityCreateInput: owner may be blank or absent -- the server inherits the account owner or refuses", () => {
  assert.deepEqual(validateOpportunityCreateInput({ ...VALID, ownerEmployeeId: "" }), { ok: true, errors: {} });
  assert.deepEqual(validateOpportunityCreateInput({ ...VALID, ownerEmployeeId: "   " }), { ok: true, errors: {} });
  const { ownerEmployeeId, ...noOwner } = VALID;
  assert.deepEqual(validateOpportunityCreateInput(noOwner), { ok: true, errors: {} });
});

test("validateOpportunityCreateInput: an explicit owner override must look like one employee id", () => {
  assert.ok(validateOpportunityCreateInput({ ...VALID, ownerEmployeeId: "E 1" }).errors.ownerEmployeeId);
  assert.ok(validateOpportunityCreateInput({ ...VALID, ownerEmployeeId: 42 }).errors.ownerEmployeeId);
  assert.equal(validateOpportunityCreateInput({ ...VALID, ownerEmployeeId: "  E1  " }).ok, true);
});

test("validateOpportunityCreateInput: expectedValue must be a non-negative number when provided", () => {
  assert.equal(validateOpportunityCreateInput({ ...VALID, expectedValue: -1 }).ok, false);
  assert.equal(validateOpportunityCreateInput({ ...VALID, expectedValue: "12" }).ok, false);
  assert.equal(validateOpportunityCreateInput({ ...VALID, expectedValue: 500 }).ok, true);
});

test("validateOpportunityCreateInput: expectedCloseAt must be a finite number (epoch ms) when provided", () => {
  assert.equal(validateOpportunityCreateInput({ ...VALID, expectedCloseAt: NaN }).ok, false);
  assert.equal(validateOpportunityCreateInput({ ...VALID, expectedCloseAt: 1755000000000 }).ok, true);
});

test("validateOpportunityCreateInput: missing input object fails honestly, never throws", () => {
  const r = validateOpportunityCreateInput(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.form);
});

test("buildOpportunityCreatePayload: trims strings, drops a blank need, null-normalizes optional numerics", () => {
  const payload = buildOpportunityCreatePayload({
    accountId: "  A1  ", ownerEmployeeId: " E1 ", salesChannel: "NATIONAL_ACCOUNTS",
    need: "   ", expectedValue: undefined, expectedCloseAt: undefined,
  });
  assert.deepEqual(payload, {
    accountId: "A1", ownerEmployeeId: "E1", salesChannel: "NATIONAL_ACCOUNTS",
    expectedValue: null, expectedCloseAt: null,
  });
  assert.ok(!("need" in payload));
});

test("buildOpportunityCreatePayload: a blank owner is OMITTED, never defaulted to anyone (D-4)", () => {
  for (const blank of ["", "   ", undefined]) {
    const payload = buildOpportunityCreatePayload({ ...VALID, ownerEmployeeId: blank });
    assert.ok(!("ownerEmployeeId" in payload), `owner ${JSON.stringify(blank)} must not be sent`);
  }
});

test("buildOpportunityCreatePayload: keeps a non-blank need, trimmed", () => {
  const payload = buildOpportunityCreatePayload({ ...VALID, need: "  Freezer replacement  " });
  assert.equal(payload.need, "Freezer replacement");
});

test("buildOpportunityCreatePayload: never invents an accountId/contactId field beyond the ratified contract", () => {
  const payload = buildOpportunityCreatePayload(VALID);
  assert.deepEqual(Object.keys(payload).sort(), ["accountId", "expectedCloseAt", "expectedValue", "ownerEmployeeId", "salesChannel"]);
});
