// Supplier Master (S2) -- offline unit tests for the pure governed-Supplier validator
// (functions/src/supplierMaster/supplierMasterValidation.ts). PURE: no Firebase app, no emulator,
// no network -- a plain Node assert test against the compiled lib/ output, matching this repo's
// pure-logic convention (governedWarehouseValidation.test.mjs). `Timestamp` is constructed offline
// via firebase-admin/firestore (no initializeApp needed). Prerequisite: `npm run build` in functions/.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  validateGovernedSupplier,
  normalizeSupplierName,
  GOVERNED_SUPPLIER_REASONS,
} from "../lib/supplierMaster/supplierMasterValidation.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("supplierMasterValidation.test.mjs");

const TS = Timestamp.fromMillis(1_700_000_000_000);
const governed = (over = {}) => ({
  id: "sup-acme",
  name: "Acme Supply Co.",
  normalizedKey: "acme supply co",
  status: "ACTIVE",
  version: 1,
  createdAt: TS,
  createdBy: "uid-admin",
  updatedAt: TS,
  updatedBy: "uid-admin",
  ...over,
});

check("valid governed supplier round-trips; result is rebuilt from validated fields", () => {
  const r = validateGovernedSupplier(governed(), "sup-acme");
  assert.equal(r.valid, true);
  assert.equal(r.value.id, "sup-acme");
  assert.equal(r.value.status, "ACTIVE");
  assert.equal(r.value.version, 1);
  assert.equal(r.reason, null);
});

check("expected id must be a non-blank string", () => {
  assert.equal(validateGovernedSupplier(governed(), "").reason, GOVERNED_SUPPLIER_REASONS.EXPECTED_ID_INVALID);
  assert.equal(validateGovernedSupplier(governed(), null).reason, GOVERNED_SUPPLIER_REASONS.EXPECTED_ID_INVALID);
});
check("non-object input fails closed", () => {
  assert.equal(validateGovernedSupplier(null, "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.NOT_OBJECT);
  assert.equal(validateGovernedSupplier("x", "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.NOT_OBJECT);
  assert.equal(validateGovernedSupplier([], "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.NOT_OBJECT);
});

check("legacy `active` field is FORBIDDEN regardless of value", () => {
  for (const v of [true, false, null, undefined]) {
    assert.equal(validateGovernedSupplier(governed({ active: v }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.ACTIVE_FORBIDDEN);
  }
});
check("unknown field fails closed (no field can ride along)", () => {
  assert.equal(validateGovernedSupplier(governed({ leadTimeDays: 5 }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.UNKNOWN_FIELD);
});

check("id: invalid / pattern-invalid / mismatch", () => {
  assert.equal(validateGovernedSupplier(governed({ id: "" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.ID_INVALID);
  assert.equal(validateGovernedSupplier(governed({ id: "has space" }), "has space").reason, GOVERNED_SUPPLIER_REASONS.ID_PATTERN_INVALID);
  assert.equal(validateGovernedSupplier(governed({ id: "sup-acme" }), "sup-other").reason, GOVERNED_SUPPLIER_REASONS.ID_MISMATCH);
});
check("name + normalizedKey must be non-blank strings", () => {
  assert.equal(validateGovernedSupplier(governed({ name: "" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.NAME_INVALID);
  assert.equal(validateGovernedSupplier(governed({ normalizedKey: "" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.NORMALIZED_KEY_INVALID);
});
check("status must be ACTIVE/INACTIVE", () => {
  assert.equal(validateGovernedSupplier(governed({ status: "PENDING" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.STATUS_INVALID);
  assert.equal(validateGovernedSupplier(governed({ status: "INACTIVE" }), "sup-acme").valid, true);
});
check("version must be a whole number >= 1", () => {
  for (const v of [0, -1, 1.5, NaN, "1", null]) {
    assert.equal(validateGovernedSupplier(governed({ version: v }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.VERSION_INVALID);
  }
});
check("governed metadata: createdAt/updatedAt must be real Timestamps; actors non-blank", () => {
  assert.equal(validateGovernedSupplier(governed({ createdAt: { toMillis: () => 1 } }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.CREATED_AT_INVALID);
  assert.equal(validateGovernedSupplier(governed({ createdBy: "" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.CREATED_BY_INVALID);
  assert.equal(validateGovernedSupplier(governed({ updatedAt: 1700000000000 }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.UPDATED_AT_INVALID);
  assert.equal(validateGovernedSupplier(governed({ updatedBy: "  " }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.UPDATED_BY_INVALID);
});

check("optional business fields: present-valid accepted + preserved; present-blank rejected; absent fine", () => {
  const withOpt = validateGovernedSupplier(governed({ vendorNumber: "V-100", email: "a@b.co" }), "sup-acme");
  assert.equal(withOpt.valid, true);
  assert.equal(withOpt.value.vendorNumber, "V-100");
  assert.equal(withOpt.value.email, "a@b.co");
  assert.equal("phone" in withOpt.value, false); // absent optional not fabricated
  assert.equal(validateGovernedSupplier(governed({ notes: "" }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.OPTIONAL_FIELD_INVALID);
  assert.equal(validateGovernedSupplier(governed({ phone: 5551234 }), "sup-acme").reason, GOVERNED_SUPPLIER_REASONS.OPTIONAL_FIELD_INVALID);
});

check("normalizeSupplierName: deterministic dedup key (lowercase, strip punctuation, collapse ws)", () => {
  assert.equal(normalizeSupplierName("Acme Supply Co."), "acme supply co");
  assert.equal(normalizeSupplierName("  ACME   supply,  CO  "), "acme supply co");
  assert.equal(normalizeSupplierName("Acme-Supply Co"), "acme supply co");
  assert.equal(normalizeSupplierName(123), "");
  // dedup DETECTION only: two differently-punctuated/spaced names collide on the key (a suspected
  // duplicate), which the writer FLAGS for human review -- it never auto-merges.
  assert.equal(normalizeSupplierName("Acme Supply, Co."), normalizeSupplierName("acme   supply co"));
  // but distinct words stay distinct (periods separate tokens, they don't fuse): "A.C.M.E" != "acme"
  assert.notEqual(normalizeSupplierName("A.C.M.E Supply Co"), normalizeSupplierName("Acme Supply Co"));
});

console.log(`\n${passed} passed, 0 failed`);
