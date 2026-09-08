// The CRM write commands — Account, Contact, Location — as pure decisions.
//
// The property that matters most here is the ACCOUNT GOVERNED-FIELD SPLIT. The retired rule
// treated paymentTerms and taxStatus differently from every other Account field, and that
// difference was the authority rather than a UI convention. Losing it would let a dispatcher set
// commercial terms, which nothing on screen would reveal.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_GOVERNED_FIELDS,
  buildAccountCreate,
  buildAccountUpdate,
  buildContactCreate,
  buildContactUpdate,
  buildLocationCreate,
  buildLocationUpdate,
  governedFieldsUnchanged,
  isGovernedCreateBaseline,
  stripReservedFields,
} from "../lib/crm/crmWriteCommands.js";

const CTX = { actorUid: "uid-actor", nowMillis: 1_700_000_000_000 };
const PRIVILEGED = { ...CTX, mayWriteGovernedFields: true };
const PLAIN = { ...CTX, mayWriteGovernedFields: false };

// ════════════════════ THE GOVERNED COMMERCIAL FIELDS ════════════════════

test("the create BASELINE predicate mirrors the retired rule exactly", () => {
  // accountGovernedCreateBaseline(): paymentTerms absent/null AND taxStatus absent/null/UNKNOWN.
  assert.equal(isGovernedCreateBaseline({}), true);
  assert.equal(isGovernedCreateBaseline({ paymentTerms: null, taxStatus: null }), true);
  assert.equal(isGovernedCreateBaseline({ taxStatus: "UNKNOWN" }), true);
  assert.equal(isGovernedCreateBaseline({ paymentTerms: "NET_30" }), false);
  assert.equal(isGovernedCreateBaseline({ taxStatus: "EXEMPT" }), false);
});

test("the update UNCHANGED predicate mirrors the retired rule, including absent == null", () => {
  // accountGovernedFieldsUnchanged() compared with data.get(field, null), so a patch that does not
  // MENTION the field is not changing it -- the single most likely thing to get wrong here, because
  // treating absent as "cleared to null" would refuse every ordinary edit.
  assert.equal(governedFieldsUnchanged({ name: "x" }, { paymentTerms: "NET_30" }), true);
  assert.equal(governedFieldsUnchanged({ paymentTerms: "NET_30" }, { paymentTerms: "NET_30" }), true);
  assert.equal(governedFieldsUnchanged({ paymentTerms: null }, {}), true);
  assert.equal(governedFieldsUnchanged({ paymentTerms: "NET_60" }, { paymentTerms: "NET_30" }), false);
  assert.equal(governedFieldsUnchanged({ taxStatus: "EXEMPT" }, { taxStatus: "UNKNOWN" }), false);
});

test("WITHOUT the governed-field capability a create is refused above the baseline, not silently reset", () => {
  // Quietly discarding the value would tell the caller the terms were saved. Refusing says what
  // happened.
  for (const attempt of [{ paymentTerms: "NET_30" }, { taxStatus: "EXEMPT" }]) {
    assert.throws(
      () => buildAccountCreate({ name: "Acme", ...attempt }, PLAIN),
      (e) => e.code === "GOVERNED_FIELD_DENIED",
      JSON.stringify(attempt),
    );
  }
  // At the baseline it succeeds -- a dispatcher could always create a Customer.
  const built = buildAccountCreate({ name: "Acme", taxStatus: "UNKNOWN" }, PLAIN);
  assert.equal(built.name, "Acme");
});

test("WITHOUT the capability an update is refused only when a governed field CHANGES", () => {
  const current = { name: "Acme", paymentTerms: "NET_30", taxStatus: "EXEMPT" };
  // An ordinary edit that leaves them alone is allowed -- the dispatcher keeps full edit rights on
  // every other field, exactly as the retired rule said.
  const patch = buildAccountUpdate({ name: "Acme Inc" }, current, PLAIN);
  assert.equal(patch.name, "Acme Inc");
  // Re-sending the SAME value is not a change.
  assert.ok(buildAccountUpdate({ paymentTerms: "NET_30" }, current, PLAIN));
  // Changing one is refused.
  assert.throws(
    () => buildAccountUpdate({ paymentTerms: "NET_60" }, current, PLAIN),
    (e) => e.code === "GOVERNED_FIELD_DENIED",
  );
});

test("WITH the capability both governed paths are open", () => {
  assert.equal(buildAccountCreate({ name: "Acme", paymentTerms: "NET_30" }, PRIVILEGED).paymentTerms, "NET_30");
  assert.equal(
    buildAccountUpdate({ paymentTerms: "NET_60" }, { paymentTerms: "NET_30" }, PRIVILEGED).paymentTerms,
    "NET_60",
  );
});

test("the governed-field comparison uses the SERVER's record, never a caller-supplied current", () => {
  // The whole reason the command reads the record first. A caller claiming the current value is
  // already NET_60 must not thereby be allowed to write NET_60.
  const current = { paymentTerms: "NET_30" };
  assert.throws(
    () => buildAccountUpdate({ paymentTerms: "NET_60", currentPaymentTerms: "NET_60" }, current, PLAIN),
    (e) => e.code === "GOVERNED_FIELD_DENIED",
  );
  assert.deepEqual([...ACCOUNT_GOVERNED_FIELDS], ["paymentTerms", "taxStatus"]);
});

// ════════════════════ PROVENANCE IS THE SERVER'S ════════════════════

test("a caller cannot author provenance or an id on ANY of the six paths", () => {
  const hostile = {
    name: "Ada",
    id: "id-i-chose",
    createdAt: 1,
    createdBy: "uid-someone-else",
    updatedAt: 2,
    updatedBy: "uid-someone-else",
  };
  const paths = [
    () => buildAccountCreate(hostile, PLAIN),
    () => buildAccountUpdate(hostile, {}, PLAIN),
    () => buildContactCreate("acct-1", hostile, CTX),
    () => buildContactUpdate(hostile, {}, CTX),
    () => buildLocationCreate("acct-1", hostile, CTX),
    () => buildLocationUpdate(hostile, {}, CTX),
  ];
  for (const build of paths) {
    const out = build();
    assert.equal(out.id, undefined, "an id must never survive from the payload");
    assert.equal(out.updatedBy, "uid-actor");
    assert.equal(out.updatedAt, CTX.nowMillis);
    if ("createdBy" in out) {
      assert.equal(out.createdBy, "uid-actor");
      assert.equal(out.createdAt, CTX.nowMillis);
    }
  }
});

test("an UPDATE never mints createdAt/createdBy -- not even from a payload that supplies them", () => {
  // The invariant the client-side test used to own. It lives here now, because here is where it can
  // actually be guaranteed.
  for (const patch of [
    buildAccountUpdate({ createdAt: 1, createdBy: "x" }, {}, PLAIN),
    buildContactUpdate({ createdAt: 1, createdBy: "x" }, {}, CTX),
    buildLocationUpdate({ createdAt: 1, createdBy: "x" }, {}, CTX),
  ]) {
    assert.equal("createdAt" in patch, false);
    assert.equal("createdBy" in patch, false);
  }
});

test("stripReservedFields removes exactly the five server-owned keys and nothing else", () => {
  const out = stripReservedFields({ id: 1, createdAt: 2, createdBy: 3, updatedAt: 4, updatedBy: 5, keep: "yes" });
  assert.deepEqual(out, { keep: "yes" });
});

// ════════════════════ MERGE SEMANTICS AND VALIDATION ════════════════════

test("an account update touches the search name ONLY when the patch touches the name", () => {
  // The client's rule, preserved: an absent `name` means this write is not touching the name, so
  // the stored derivation must not be clobbered with "" -- which would make the record unfindable.
  const untouched = buildAccountUpdate({ phone: "555" }, {}, PLAIN);
  assert.equal("nameLower" in untouched, false);
  const touched = buildAccountUpdate({ name: "  Acme Inc  " }, {}, PLAIN);
  assert.equal(touched.nameLower, "acme inc");
});

test("the create paths derive the search name, trimmed and lowercased", () => {
  assert.equal(buildAccountCreate({ name: "  Acme Inc  " }, PLAIN).nameLower, "acme inc");
});

test("the parent account is the COMMAND's argument, not a payload field", () => {
  const contact = buildContactCreate("acct-1", { name: "Ada", accountId: "acct-i-chose" }, CTX);
  assert.equal(contact.accountId, "acct-1");
  const location = buildLocationCreate("acct-1", { label: "Site", accountId: "acct-i-chose" }, CTX);
  assert.equal(location.accountId, "acct-1");
});

test("required fields and missing records are refused by their own codes", () => {
  assert.throws(() => buildAccountCreate({}, PLAIN), (e) => e.code === "NAME_REQUIRED");
  assert.throws(() => buildContactCreate("acct-1", {}, CTX), (e) => e.code === "NAME_REQUIRED");
  assert.throws(() => buildContactCreate("", { name: "Ada" }, CTX), (e) => e.code === "ACCOUNT_REQUIRED");
  assert.throws(() => buildLocationCreate(null, {}, CTX), (e) => e.code === "ACCOUNT_REQUIRED");
  for (const build of [buildAccountUpdate, buildContactUpdate, buildLocationUpdate]) {
    assert.throws(
      () => build({ name: "x" }, null, PLAIN),
      (e) => e.code === "NOT_FOUND",
      "an update against a record that does not exist must fail, not create one",
    );
  }
});
