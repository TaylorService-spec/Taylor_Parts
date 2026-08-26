// THE ACCOUNT NORTH STAR CONTRACT, AS ASSERTIONS.
//
// The load-bearing ones here are unusual for this programme, because the Account's problem was not
// that facts were missing. It was that they were DUPLICATED, and that the grammar's central
// requirement — a visible lifecycle spine — asks for something this record does not have.
//
// So these assert two things above all: that no vocabulary is forked (NS-P4), and that no
// progression is asserted that nothing enforces (ND-11).
//
// Run: node --test test/accountNorthStar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountLifecycle,
  accountStatusWords,
  accountStatusSentence,
  accountClassification,
  accountHeader,
  accountTermsDigest,
} from "../src/domain/accountNorthStar.js";
import { ACCOUNT_STATUS, ACCOUNT_STATUS_LABEL } from "../src/domain/constants.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { accountStatusTone } from "../src/domain/accountPortfolio.js";

const ALL_STATUSES = Object.values(ACCOUNT_STATUS);

function account(overrides = {}) {
  return {
    id: "acct_doc_secret",
    name: "Harbor Grill Restaurant Group",
    status: "ACTIVE",
    relationshipTypes: ["CUSTOMER"],
    lineOfBusiness: ["TAYLOR"],
    ...overrides,
  };
}

// ───────────────────────────────── ND-11: no lifecycle may be asserted

test("the Account declares that it has NO lifecycle spine, and says why", () => {
  const lifecycle = accountLifecycle();
  assert.equal(lifecycle.hasSpine, false);
  assert.match(lifecycle.reason, /status is a field someone sets/i);
});

test("the premise of ND-11 still holds: status is an editable FIELD, not a transition output", () => {
  // THIS IS THE TEST THAT MATTERS. The decision not to draw a spine rests entirely on the claim
  // that nothing enforces an ordering. If a governed transition is ever introduced, `status` leaves
  // `editableFieldIds` — and this assertion fails, forcing ND-11 to be revisited rather than
  // quietly outliving its reason.
  assert.ok(
    accountRecordPage.editableFieldIds.includes("status"),
    "status is no longer a directly editable field — ND-11's premise has changed and the decision must be re-taken",
  );
});

test("no spine ordering is exported for anything to draw", async () => {
  const module = await import("../src/domain/accountNorthStar.js");
  for (const name of Object.keys(module)) {
    assert.ok(!/spine|steps|stage/i.test(name), `${name} looks like a spine this record does not have`);
  }
});

// ───────────────────────────────── NS-P4: the vocabulary is not forked

test("status words come from the canonical metadata definition, not a second copy", () => {
  const canonical = accountEntity.fields.find((f) => f.id === "status").enumLabels;
  for (const status of ALL_STATUSES) {
    assert.equal(accountStatusWords(status), canonical[status]);
    // ...and the constants map agrees, so there is genuinely one vocabulary rather than two that
    // happen to match today.
    assert.equal(accountStatusWords(status), ACCOUNT_STATUS_LABEL[status]);
  }
});

test("classification labels come from the same definition, for both fields", () => {
  const rel = accountEntity.fields.find((f) => f.id === "relationshipTypes").enumLabels;
  const lob = accountEntity.fields.find((f) => f.id === "lineOfBusiness").enumLabels;
  const c = accountClassification(account({ relationshipTypes: ["VENDOR", "CUSTOMER"], lineOfBusiness: ["VENTANA", "TAYLOR"] }));
  assert.deepEqual(c.relationships.map((r) => r.label), [rel.CUSTOMER, rel.VENDOR]);
  assert.deepEqual(c.linesOfBusiness.map((r) => r.label), [lob.TAYLOR, lob.VENTANA]);
});

test("the tone is delegated, so the record and the portfolio list cannot disagree", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(accountHeader(account({ status })).statusTone, accountStatusTone(status));
  }
});

// ───────────────────────────────── R04: words, never enums

test("no status renders as its raw machine value", () => {
  for (const status of ALL_STATUSES) {
    const words = accountStatusWords(status);
    assert.ok(words, `${status} must have words`);
    assert.notEqual(words, status);
    assert.ok(!/[A-Z]{2,}/.test(accountStatusSentence(status)), `${status} sentence leaks an enum`);
  }
});

test("an unknown status produces no words rather than a prettified guess", () => {
  assert.equal(accountStatusWords("ON_CREDIT_HOLD"), null);
  assert.equal(accountStatusSentence("ON_CREDIT_HOLD"), null);
});

test("the sentence extends the same word it is built from", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(accountStatusSentence(status).startsWith(accountStatusWords(status)));
  }
});

test("no clause implies a transition, because there is none to wait on", () => {
  for (const status of ALL_STATUSES) {
    const sentence = accountStatusSentence(status);
    assert.ok(
      !/awaiting|pending|next|will become|moves to/i.test(sentence),
      `"${sentence}" implies a progression nothing enforces (ND-11)`,
    );
  }
});

// ───────────────────────────────── classification is informational and never defaulted

test("an account with no classification gets no badges — never a silent default", () => {
  const c = accountClassification(account({ relationshipTypes: [], lineOfBusiness: [] }));
  assert.deepEqual(c.relationships, []);
  assert.deepEqual(c.linesOfBusiness, []);
  const missing = accountClassification({ name: "x" });
  assert.deepEqual(missing.relationships, []);
  assert.deepEqual(missing.linesOfBusiness, []);
});

test("classification order follows the definition, not the stored array order", () => {
  const forwards = accountClassification(account({ relationshipTypes: ["CUSTOMER", "VENDOR"] }));
  const backwards = accountClassification(account({ relationshipTypes: ["VENDOR", "CUSTOMER"] }));
  assert.deepEqual(forwards.relationships, backwards.relationships);
});

test("a stored value outside the vocabulary is REPORTED, not silently dropped", () => {
  const c = accountClassification(account({ relationshipTypes: ["CUSTOMER", "PARTNER"], lineOfBusiness: ["ACME"] }));
  assert.deepEqual(c.relationships.map((r) => r.key), ["CUSTOMER"]);
  assert.deepEqual(c.unrecognised.sort(), ["ACME", "PARTNER"]);
});

// ───────────────────────────────── identity

test("the title is the account's NAME — an Account has no governed reference", () => {
  assert.equal(accountHeader(account()).name, "Harbor Grill Restaurant Group");
  assert.equal(accountHeader(account({ name: "  Padded Co  " })).name, "Padded Co");
});

test("a nameless account is reported as unnamed and NEVER falls back to the document id", () => {
  for (const name of [null, "", "   ", undefined]) {
    const header = accountHeader(account({ name }));
    assert.equal(header.name, null, `name ${JSON.stringify(name)} must not resolve`);
    assert.equal(header.unnamed, true);
    assert.ok(!JSON.stringify(header).includes("acct_doc_secret"), "the document id leaked into the header");
  }
});

test("the header derives its status once, and every derived field agrees with it", () => {
  for (const status of ALL_STATUSES) {
    const header = accountHeader(account({ status }));
    assert.equal(header.rawStatus, status);
    assert.equal(header.statusWords, accountStatusWords(status));
    assert.equal(header.statusSentence, accountStatusSentence(status));
    assert.equal(header.isArchived, status === "ARCHIVED");
  }
});

test("no account at all yields no header rather than an empty one", () => {
  assert.equal(accountHeader(null), null);
  assert.equal(accountHeader(undefined), null);
});

test("hostile input does not throw", () => {
  assert.doesNotThrow(() => accountClassification(null));
  assert.doesNotThrow(() => accountClassification({ relationshipTypes: "CUSTOMER", lineOfBusiness: 7 }));
  assert.equal(accountHeader({ name: 42 }).unnamed, true);
});

// ═══════════════════════════ THE TERMS DIGEST (Account North Star P1)
//
// The header states the commercial terms in one fact. It is the SAME derivation the rail reads,
// not a second one -- every word comes from the metadata definition's own enumLabels -- and it
// carries three rules that protect real money decisions.

test("the digest reads the vocabulary, never a local label copy", () => {
  assert.equal(
    accountTermsDigest({ paymentTerms: "NET_30", taxStatus: "TAXABLE", purchaseOrderRequired: true }),
    "Net 30 · Taxable · PO required",
  );
  assert.equal(
    accountTermsDigest({ paymentTerms: "COD", taxStatus: "EXEMPT", purchaseOrderRequired: false }),
    "Cash on Delivery · Exempt · No PO required",
  );
});

test("AN ABSENT TAX STATUS IS UNKNOWN, NEVER TAXABLE", () => {
  // The mutation this guards: defaulting to TAXABLE puts a tax claim on a customer nobody made a
  // tax decision about, in the same line an invoice would be built from.
  for (const account of [{}, { taxStatus: null }, { taxStatus: "" }, { taxStatus: undefined }]) {
    const digest = accountTermsDigest(account);
    assert.equal(digest, "Unknown");
    assert.ok(!/Taxable/.test(digest));
  }
});

test("payment terms and PO required appear only when the record actually holds them", () => {
  // A malformed PO value is left to the edit form to surface -- never shown here as a confident
  // Yes or No, which would be the page asserting a term nobody set.
  assert.equal(accountTermsDigest({ purchaseOrderRequired: "yes" }), "Unknown");
  assert.equal(accountTermsDigest({ purchaseOrderRequired: 1 }), "Unknown");
  assert.equal(accountTermsDigest({ paymentTerms: "NOT_A_TERM" }), "Unknown");
});

test("hostile input does not throw the digest", () => {
  assert.doesNotThrow(() => accountTermsDigest(null));
  assert.doesNotThrow(() => accountTermsDigest(undefined));
  assert.doesNotThrow(() => accountTermsDigest({ taxStatus: 7 }));
});
