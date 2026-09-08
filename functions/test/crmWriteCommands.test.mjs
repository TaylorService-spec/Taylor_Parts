// The CRM write commands — Account, Contact, Location — as pure decisions.
//
// The property that matters most here is the ACCOUNT GOVERNED-FIELD SPLIT. The retired rule
// treated paymentTerms and taxStatus differently from every other Account field, and that
// difference was the authority rather than a UI convention. Losing it would let a dispatcher set
// commercial terms, which nothing on screen would reveal.
import test from "node:test";
import assert from "node:assert/strict";
import {
  governedValuesValid,
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
// ACCOUNTS take a typed `nowValue` rather than a number: their governed type is TIMESTAMP, and a
// number sorts below every Timestamp under `updatedAt DESC`. A sentinel object stands in for the
// Firestore Timestamp the callable supplies -- what these prove is that the builder passes the
// value THROUGH rather than minting a number of its own.
const NOW_VALUE = { __timestamp: CTX.nowMillis };
const PRIVILEGED = { actorUid: CTX.actorUid, nowValue: NOW_VALUE, mayWriteGovernedFields: true };
const PLAIN = { actorUid: CTX.actorUid, nowValue: NOW_VALUE, mayWriteGovernedFields: false };

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
    // Accounts carry the typed Timestamp value, the other two carry epoch millis. Both are the
    // SERVER's, which is the property under test — not the representation.
    assert.ok(out.updatedAt === CTX.nowMillis || out.updatedAt === NOW_VALUE, "the server stamps updatedAt");
    if ("createdBy" in out) {
      assert.equal(out.createdBy, "uid-actor");
      assert.ok(out.createdAt === CTX.nowMillis || out.createdAt === NOW_VALUE, "the server stamps createdAt");
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

// ════════════════════ THE ACCOUNT TIMESTAMP TYPE ════════════════════

test("an account stamps the TYPED value it is given, never a number of its own", () => {
  // THE REGRESSION THIS PINS, and it was shipped by this very migration before being caught.
  //
  // metadata/definitions/account.js governs createdAt/updatedAt as TIMESTAMP. Firestore orders
  // ACROSS TYPES BY TYPE FIRST, so an epoch NUMBER sorts BELOW every Timestamp: a Customer created
  // with millis lands LAST under `updatedAt DESC`, which on a paged list is indistinguishable from
  // invisible. It has been shipped once before, from the shared store, and again from here.
  //
  // Contacts, Locations and Equipment govern these as NUMBER and keep millis -- the type belongs to
  // the entity definition, and each command must agree with the one it writes to.
  const created = buildAccountCreate({ name: "Acme" }, PLAIN);
  assert.equal(created.createdAt, NOW_VALUE);
  assert.equal(created.updatedAt, NOW_VALUE);
  assert.notEqual(typeof created.updatedAt, "number", "an account timestamp must not be a bare number");

  const patch = buildAccountUpdate({ name: "Acme Inc" }, {}, PLAIN);
  assert.equal(patch.updatedAt, NOW_VALUE);
});

test("contacts and locations keep EPOCH MILLIS, because that is what their definitions govern", () => {
  for (const build of [
    () => buildContactCreate("acct-1", { name: "Ada" }, CTX),
    () => buildLocationCreate("acct-1", { label: "Site" }, CTX),
  ]) {
    const out = build();
    assert.equal(out.createdAt, CTX.nowMillis);
    assert.equal(typeof out.updatedAt, "number");
  }
});

// ============================ THE GOVERNED VALUE SETS, PORTED ============================
//
// These lived ONLY in `firestore.rules`:
//
//   paymentTerms in ['COD', 'NET_30', 'NET_60', 'NET_90']
//   taxStatus    in ['UNKNOWN', 'TAXABLE', 'EXEMPT', 'RESELLER']
//
// Nothing server-side re-checked them. Retiring the client-direct write would have retired the only
// enforcement of what these fields may CONTAIN, leaving a capability holder able to stamp
// `paymentTerms: "whenever"` on a customer -- because the capability says WHO may set a governed
// field and never said WHAT it may say. Ported from
// functions/test/accountsGovernedFieldsRules.test.js before those assertions became denials.

test("every governed value the retired rule accepted is still accepted", () => {
  for (const paymentTerms of ["COD", "NET_30", "NET_60", "NET_90"]) {
    assert.equal(governedValuesValid({ paymentTerms }), true, paymentTerms);
  }
  for (const taxStatus of ["UNKNOWN", "TAXABLE", "EXEMPT", "RESELLER"]) {
    assert.equal(governedValuesValid({ taxStatus }), true, taxStatus);
  }
  assert.equal(governedValuesValid({ paymentTerms: "NET_30", taxStatus: "EXEMPT" }), true);
});

test("unset and null stay legitimate states, exactly as the rule's null branch allowed", () => {
  assert.equal(governedValuesValid({}), true, "absent is not invalid");
  assert.equal(governedValuesValid({ paymentTerms: null, taxStatus: null }), true, "cleared is not invalid");
  assert.equal(governedValuesValid({ name: "Acme" }), true, "a patch that mentions neither is fine");
});

test("a value outside the governed set is REFUSED, whoever the caller is", () => {
  for (const bad of ["whenever", "net_30", "NET_45", "", " ", "COD "]) {
    assert.equal(governedValuesValid({ paymentTerms: bad }), false, JSON.stringify(bad));
  }
  for (const bad of ["taxable", "NONE", "EXEMPT_2"]) {
    assert.equal(governedValuesValid({ taxStatus: bad }), false, JSON.stringify(bad));
  }
  // A non-string is not a governed value either -- the rule compared against a list of strings.
  assert.equal(governedValuesValid({ paymentTerms: 30 }), false);
  assert.equal(governedValuesValid({ taxStatus: { forged: true } }), false);
});

test("the value check runs on CREATE and on UPDATE, and the capability does not excuse it", () => {
  // The important case: a caller who legitimately HOLDS customer.governedField.write still cannot
  // put an ungoverned value in a governed field. Authority over a field is not authorship of its
  // vocabulary.
  const ctx = { actorUid: "uid-1", nowValue: 1, mayWriteGovernedFields: true };
  assert.throws(
    () => buildAccountCreate({ name: "Acme", paymentTerms: "whenever" }, ctx),
    /GOVERNED_VALUE_INVALID|governed values/i,
  );
  assert.throws(
    () => buildAccountUpdate({ taxStatus: "NONE" }, { name: "Acme" }, ctx),
    /GOVERNED_VALUE_INVALID|governed values/i,
  );
  // And the legitimate paths still work, including adding a term to a legacy account with none.
  assert.ok(buildAccountCreate({ name: "Acme", paymentTerms: "NET_30" }, ctx));
  assert.ok(buildAccountUpdate({ paymentTerms: "NET_60" }, { name: "Acme" }, ctx));
});
