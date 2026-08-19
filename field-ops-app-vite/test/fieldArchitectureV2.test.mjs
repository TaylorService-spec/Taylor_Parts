// Field Architecture v2 — architecture invariants.
//
// These assert INTENDED behavior, not current behavior. This program has already found
// three tests that pinned a defect as correct and made the fix fail CI, so each of these
// states a property the architecture must have and would fail if the implementation
// drifted toward the convenient answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSystemName, deriveSystemName, isProtectedSystemName, recordIdentity,
  validateReferencePolicy, makeReferencePolicy,
} from "../src/metadata/v2/identity.js";
import {
  makeNumericSemantics, validateNumericSemantics, formatForDisplay, applyRounding,
} from "../src/metadata/v2/numeric.js";
import { validateFormula, formulaDependencies, formulaResultType, op, field, literal } from "../src/metadata/v2/formula.js";
import {
  makeFieldV2, validateFieldV2, validateEntityFields, findDependencyCycles, fromV1, MIGRATION_UNKNOWN,
} from "../src/metadata/v2/fieldDefinitionV2.js";

const base = (over = {}) => makeFieldV2({
  label: "Customer Tier", systemName: "customerTier", entitySystemName: "account",
  fieldClass: "STANDARD", type: "STRING", ...over,
});

// --- identity ----------------------------------------------------------------

test("changing a LABEL does not change the systemName", () => {
  // The invariant the whole identity split exists for. A label is what a business changes
  // its mind about; every formula, report column and tool contract bound to it would
  // otherwise break on a wording change.
  const created = deriveSystemName("Preferred Service Window");
  assert.equal(created, "preferredServiceWindow");
  const renamed = base({ label: "Preferred Appointment Window", systemName: created });
  assert.equal(renamed.systemName, "preferredServiceWindow");
});

test("a systemName may not carry another platform's naming convention", () => {
  for (const name of ["customerTier__c", "account__r", "msdyn_workorder"]) {
    assert.ok(validateSystemName(name).length > 0, name);
  }
});

test("a label of only punctuation derives NO systemName rather than a guess", () => {
  assert.equal(deriveSystemName("—  ///  —"), null);
});

test("a leading digit is preserved rather than dropped", () => {
  // Dropping it would silently turn "2026 Target" into "target".
  assert.match(deriveSystemName("2026 Target"), /2026Target$/i);
});

test("storagePath is SEPARATE from systemName, even when they match", () => {
  // If systemName were the storage path, a legacy remap would break every formula and
  // report bound to it, and Firestore layout would become platform contract.
  const f = base({ storagePath: "legacy.customer_level" });
  assert.equal(f.systemName, "customerTier");
  assert.equal(f.storagePath, "legacy.customer_level");
  assert.deepEqual(validateFieldV2(f), []);
});

test("the record identity never falls back to the internal recordId for display", () => {
  // The defect corrected twice already: a document id reaching a user as a label.
  const anonymous = recordIdentity({ recordId: "abc123XYZ" });
  assert.equal(anonymous.display, null);
  assert.equal(anonymous.recordId, "abc123XYZ");

  const referenced = recordIdentity({ recordId: "abc123XYZ", businessReference: "WO-2026-000127" });
  assert.equal(referenced.display, "WO-2026-000127");

  const named = recordIdentity({ recordId: "abc", businessReference: "WO-1", humanName: "Replace compressor" });
  assert.equal(named.display, "Replace compressor");
});

test("a business reference policy is optional, but a malformed one is rejected", () => {
  assert.deepEqual(validateReferencePolicy(null), []);
  assert.deepEqual(validateReferencePolicy(makeReferencePolicy({ prefix: "WO" })), []);
  assert.ok(validateReferencePolicy(makeReferencePolicy({ prefix: "workorder" })).length > 0);
});

test("a CUSTOM field cannot shadow a protected systemName", () => {
  // A CUSTOM `status` makes every reference to `status` ambiguous, resolved by load order.
  assert.ok(isProtectedSystemName("status"));
  const f = base({ fieldClass: "CUSTOM", systemName: "status", label: "Status" });
  assert.ok(validateFieldV2(f).some((p) => /may not shadow/.test(p)));
});

// --- numeric -----------------------------------------------------------------

test("PERCENTAGE storage semantics must be EXPLICIT — never inferred", () => {
  // 0.15 and 15 both mean fifteen percent to somebody, and guessing differently is wrong
  // by 100x while still looking plausible.
  const missing = makeNumericSemantics({ numericKind: "PERCENTAGE", displayScale: 2 });
  assert.ok(validateNumericSemantics(missing).some((p) => /storageMode/.test(p)));

  const explicit = makeNumericSemantics({ numericKind: "PERCENTAGE", storageMode: "FRACTION", storageScale: 6, displayScale: 2 });
  assert.deepEqual(validateNumericSemantics(explicit), []);
});

test("DISPLAY rounding does not mutate the stored value", () => {
  // The rule the three scales exist for. Display returns a STRING, so the rounded figure
  // cannot re-enter arithmetic and quietly become the business truth.
  const semantics = makeNumericSemantics({ numericKind: "PERCENTAGE", storageMode: "FRACTION", storageScale: 6, displayScale: 2, roundingMode: "HALF_UP" });
  const stored = 0.126875;
  assert.equal(formatForDisplay(stored, semantics), "12.69");
  assert.equal(stored, 0.126875);
  assert.equal(typeof formatForDisplay(stored, semantics), "string");
});

test("displayScale may be coarser than storage, never finer", () => {
  // Finer display shows precision that was never captured — accuracy nobody has.
  const finer = makeNumericSemantics({ numericKind: "DECIMAL", storageScale: 2, displayScale: 4 });
  assert.ok(validateNumericSemantics(finer).some((p) => /never stored/.test(p)));
});

test("a QUANTITY without a unit is rejected — 12 of what?", () => {
  const bare = makeNumericSemantics({ numericKind: "QUANTITY" });
  assert.ok(validateNumericSemantics(bare).some((p) => /unit/.test(p)));
});

test("rounding modes are distinct and testable, not decorative", () => {
  assert.equal(applyRounding(2.5, 0, "HALF_UP"), 3);
  assert.equal(applyRounding(2.5, 0, "HALF_EVEN"), 2);
  assert.equal(applyRounding(3.5, 0, "HALF_EVEN"), 4);
  assert.equal(applyRounding(-2.5, 0, "HALF_UP"), -3);
  assert.equal(applyRounding(2.9, 0, "DOWN"), 2);
  assert.equal(applyRounding(-2.1, 0, "FLOOR"), -3);
  assert.equal(applyRounding(2.1, 0, "CEILING"), 3);
});

// --- formula -----------------------------------------------------------------

test("a formula may NEVER contain a function", () => {
  // §8, as the one rejection that is not a type error but a prohibition.
  const problems = validateFormula(op("ADD", field("a"), () => 1));
  assert.ok(problems.some((p) => /never contain a function/.test(p)));
});

test("an operator outside the approved vocabulary is rejected", () => {
  assert.ok(validateFormula(op("EVAL", literal(1))).some((p) => /not in the approved vocabulary/.test(p)));
});

test("a field reference may not traverse a path — that is what LOOKUP is for", () => {
  // Otherwise arbitrary property traversal crosses an entity boundary with no authority
  // check, which LOOKUP exists to make explicit.
  assert.ok(validateFormula(field("account.owner.email")).some((p) => /traverses a path/.test(p)));
});

test("same-record composition works without any code", () => {
  const fullName = op("CONCAT", field("firstName"), literal(" "), field("lastName"));
  assert.deepEqual(validateFormula(fullName), []);
  assert.deepEqual(formulaDependencies(fullName), ["firstName", "lastName"]);
  assert.equal(formulaResultType(fullName), "STRING");
});

test("a result type is reported only where it is statically knowable", () => {
  // COALESCE produces whatever its branches produce; asserting a type would be a
  // confident lie rather than an honest gap.
  assert.equal(formulaResultType(op("DIVIDE", field("a"), field("b"))), "DECIMAL");
  assert.equal(formulaResultType(op("COALESCE", field("a"), field("b"))), null);
});

// --- derived fields ----------------------------------------------------------

test("a LOOKUP cannot bypass the authority of the field it reads", () => {
  // A viewer who may read the Work Order but not the Account's financials must not
  // receive creditLimit merely because the Work Order is readable.
  const noAuthority = base({
    label: "Customer Credit Limit", systemName: "customerCreditLimit", type: "DECIMAL",
    numeric: makeNumericSemantics({ numericKind: "DECIMAL", storageScale: 2 }),
    fieldClass: "DERIVED", derivationType: "LOOKUP", relationship: "workOrder.account", sourceField: "creditLimit",
  });
  assert.ok(validateFieldV2(noAuthority).some((p) => /cannot launder the authority/.test(p)));

  const declared = base({
    label: "Customer Credit Limit", systemName: "customerCreditLimit", type: "DECIMAL",
    numeric: makeNumericSemantics({ numericKind: "DECIMAL", storageScale: 2 }),
    fieldClass: "DERIVED", derivationType: "LOOKUP", relationship: "workOrder.account",
    sourceField: "creditLimit", sourceAuthority: ["account.financial.read"],
  });
  assert.deepEqual(validateFieldV2(declared), []);
});

test("a ROLLUP must be an AGGREGATE — a partial list cannot satisfy a complete rollup", () => {
  const wrong = base({
    label: "Open Work Orders", systemName: "openWorkOrderCount", type: "INTEGER",
    numeric: makeNumericSemantics({ numericKind: "INTEGER" }),
    fieldClass: "DERIVED", derivationType: "ROLLUP", rollupOperator: "COUNT",
    relationship: "account.workOrders", sourceAuthority: ["workOrder.read"], queryability: "VIRTUAL",
  });
  assert.ok(validateFieldV2(wrong).some((p) => /must not depend on pagination/.test(p)));
});

test("DISPLAYABLE is not QUERYABLE — a VIRTUAL field cannot declare a filter", () => {
  const f = base({
    label: "Full Name", systemName: "fullName", fieldClass: "DERIVED", derivationType: "FORMULA",
    formula: op("CONCAT", field("firstName"), field("lastName")),
    queryability: "VIRTUAL", filterable: true, operators: ["EQUALS"],
  });
  assert.ok(validateFieldV2(f).some((p) => /not queryable/.test(p)));
});

test("derivationType on a non-DERIVED field is rejected", () => {
  assert.ok(validateFieldV2(base({ derivationType: "FORMULA" })).some((p) => /only meaningful on a DERIVED/.test(p)));
});

// --- dependency graph --------------------------------------------------------

const derived = (systemName, formula) => makeFieldV2({
  label: systemName, systemName, entitySystemName: "account", type: "STRING",
  fieldClass: "DERIVED", derivationType: "FORMULA", formula, queryability: "VIRTUAL",
});

test("a dependency CYCLE cannot validate", () => {
  const fields = [
    derived("fieldA", op("CONCAT", field("fieldB"))),
    derived("fieldB", op("CONCAT", field("fieldA"))),
  ];
  const cycles = findDependencyCycles(fields);
  assert.equal(cycles.length > 0, true);
  assert.ok(validateEntityFields(fields).some((p) => /circular derived dependency/.test(p)));
});

test("a LONGER cycle is caught too, not just a mutual pair", () => {
  const fields = [
    derived("a", op("CONCAT", field("b"))),
    derived("b", op("CONCAT", field("c"))),
    derived("c", op("CONCAT", field("a"))),
  ];
  assert.ok(validateEntityFields(fields).some((p) => /circular derived dependency/.test(p)));
});

test("a legitimate dependency CHAIN validates", () => {
  // fullName depends on two stored fields; displayName depends on fullName. A cycle
  // detector that rejected this would make derived fields useless.
  const fields = [
    makeFieldV2({ label: "First", systemName: "firstName", entitySystemName: "account", type: "STRING" }),
    makeFieldV2({ label: "Last", systemName: "lastName", entitySystemName: "account", type: "STRING" }),
    derived("fullName", op("CONCAT", field("firstName"), field("lastName"))),
    derived("displayName", op("CONCAT", field("fullName"))),
  ];
  assert.deepEqual(validateEntityFields(fields), []);
});

test("duplicate systemNames within one entity are rejected", () => {
  const fields = [base(), base({ label: "Tier again" })];
  assert.ok(validateEntityFields(fields).some((p) => /duplicate systemName/.test(p)));
});

// --- keys and behavior -------------------------------------------------------

test("an alternateKey must be unique — ambiguous matching is rejected at definition", () => {
  // Matching on a non-unique field produces ">1 match" on ordinary data, so approving it
  // as a key approves a guaranteed integrity failure.
  const f = base({ label: "ERP Customer Number", systemName: "erpCustomerNumber", alternateKey: true });
  assert.ok(validateFieldV2(f).some((p) => /must also be unique/.test(p)));

  const ok = base({ label: "ERP Customer Number", systemName: "erpCustomerNumber", unique: true, alternateKey: true });
  assert.deepEqual(validateFieldV2(ok), []);
});

test("unique does NOT imply alternateKey — one is data, the other is governance", () => {
  const f = base({ unique: true });
  assert.equal(f.alternateKey, false);
  assert.deepEqual(validateFieldV2(f), []);
});

test("an immutable field cannot be updateable", () => {
  assert.ok(validateFieldV2(base({ mutable: false, updateable: true })).some((p) => /cannot be updateable/.test(p)));
});

// --- v1 compatibility --------------------------------------------------------

test("a v1 field maps into v2 without inventing meaning v1 never recorded", () => {
  // Defaulting mutable:true because most fields are mutable would turn a missing decision
  // into a stated one that nobody revisits.
  const v1 = { id: "status", entityId: "account", label: "Status", type: "ENUM", enumValues: ["ACTIVE"], enumLabels: { ACTIVE: "Active" }, filterable: true, operators: ["EQUALS"] };
  const v2 = fromV1(v1);
  assert.equal(v2.systemName, "status");
  assert.equal(v2.storagePath, "status");
  assert.equal(v2.label, "Status");
  assert.ok(v2.migrationGaps.includes(MIGRATION_UNKNOWN.MUTABILITY));
  assert.ok(v2.migrationGaps.includes(MIGRATION_UNKNOWN.WRITE_CAPABILITY));
});

test("a v1 NUMBER records an UNKNOWN rounding policy rather than a default one", () => {
  const v2 = fromV1({ id: "amount", entityId: "invoice", label: "Amount", type: "NUMBER" });
  assert.ok(v2.migrationGaps.includes(MIGRATION_UNKNOWN.ROUNDING));
});

test("v1 CURRENCY_MINOR survives untouched — minor-unit integer storage stays authoritative", () => {
  const v2 = fromV1({ id: "totalMinor", entityId: "invoice", label: "Total", type: "CURRENCY_MINOR" });
  assert.equal(v2.type, "CURRENCY_MINOR");
  assert.ok(!v2.migrationGaps.includes(MIGRATION_UNKNOWN.ROUNDING));
});
