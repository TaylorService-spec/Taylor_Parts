// BIN REGISTRY — the pure identity contract. No emulator, no Firestore.
// Run: node --test test/binRegistry.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  normalizeBinCode,
  deriveBinId,
  deriveBinClaimId,
  fingerprintBinCreate,
  toBinCreateIdentity,
  formatBinCode,
  validateBinDraft,
  validateBinRenameDraft,
  resolveBinFromClaim,
  resolveBinFromToken,
  isSafeIdSegment,
  BIN_STATUSES,
  BIN_CLAIM_STATES,
  BIN_SCHEMA_VERSION,
  DEFAULT_BIN_CODE_FORMAT,
} from "../lib/inventoryLocation/binRegistry.js";

const warehouses = new Set(["WH-1", "WH-2"]);
const draft = (over = {}) => ({
  warehouseId: "WH-1", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3,
  idempotencyKey: "req-1", ...over,
});
const ok = (over) => {
  const r = validateBinDraft(draft(over), warehouses);
  assert.equal(r.valid, true, `expected valid, got ${r.reason}`);
  return r.value;
};

const BIN_ID = deriveBinId("req-1");
function storedBin(over = {}) {
  return { warehouseId: "WH-1", code: "A01-003", status: "ACTIVE", schemaVersion: BIN_SCHEMA_VERSION, ...over };
}
function storedClaim(over = {}) {
  return { binId: BIN_ID, warehouseId: "WH-1", code: "A01-003", claimState: "HELD", ...over };
}

// ─────────────────────────────────────────── a bin describes; the warehouse owns

test("a bin carries NO quantity, balance or reservation", () => {
  const code = readFileSync(new URL("../src/inventoryLocation/binRegistry.ts", import.meta.url), "utf8");
  // Field-shaped, not prose: this module discusses RESERVATIONS at length — of codes, never of stock.
  for (const forbidden of [/\bonHand\s*:/, /\breserved\s*:/, /\bbalance\s*:/, /\bquantity\s*:/]) {
    assert.doesNotMatch(code, forbidden, `a bin must not carry ${forbidden}`);
  }
});

test("the canonical BIN reference exists ONLY on the machine-token path", () => {
  // BIN-P1 deliberately produces `{ type: "BIN", locationId }` — but as a SCAN CANDIDATE for the
  // shared identity boundary, never from the human-code resolver, and never as custody.
  const found = resolveBinFromToken(BIN_ID, "WH-1", storedBin());
  assert.deepEqual(found.location, { type: "BIN", locationId: BIN_ID });
  const byCode = resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin());
  assert.equal("location" in byCode, false, "the human-code path emits no location reference");
});

test("BIN is still NOT an accepted movement location — the custody fence is untouched", () => {
  // The reference above must not leak into custody math. The one governed resolver every movement
  // command pins still refuses BIN outright.
  const resolver = readFileSync(new URL("../src/inventoryTransfer/transferLocationResolver.ts", import.meta.url), "utf8");
  assert.match(resolver, /location\.type === "WAREHOUSE"/);
  assert.match(resolver, /location\.type === "MOBILE"/);
  assert.doesNotMatch(resolver, /=== "BIN"/, "BIN must not become an accepted movement endpoint in P1");
});

// ─────────────────────────────────────────── stable identity

test("binId is opaque and contains NO business attribute", () => {
  assert.match(BIN_ID, /^bin_[0-9a-f]{40}$/);
  for (const attr of ["WH-1", "PARTS_ROOM", "A01-003"]) {
    assert.equal(BIN_ID.includes(attr), false, `${attr} must not appear in the identity`);
  }
});

test("binId is derived from the request nonce, so a retry addresses the SAME bin", () => {
  assert.equal(deriveBinId("req-1"), deriveBinId("req-1"));
  assert.notEqual(deriveBinId("req-1"), deriveBinId("req-2"));
});

test("a caller-supplied binId is REFUSED, never silently ignored", () => {
  assert.equal(validateBinDraft(draft({ binId: "bin_whatever" }), warehouses).reason, "bin_id_not_accepted");
});

test("a caller-supplied code is REFUSED — the code is derived, not chosen", () => {
  assert.equal(validateBinDraft(draft({ code: "Z99-999" }), warehouses).reason, "code_not_accepted");
});

// ─────────────────────────────────────────── create idempotency

const identityOf = (over) => toBinCreateIdentity(ok(over));

test("the same create identity fingerprints the same", () => {
  assert.equal(fingerprintBinCreate(identityOf()), fingerprintBinCreate(identityOf()));
  assert.match(fingerprintBinCreate(identityOf()), /^[0-9a-f]{16}$/);
});

test("a different warehouse or rack position is a DIFFERENT create identity", () => {
  const base = fingerprintBinCreate(identityOf());
  assert.notEqual(base, fingerprintBinCreate(identityOf({ warehouseId: "WH-2" })));
  assert.notEqual(base, fingerprintBinCreate(identityOf({ bay: 2 })));
  assert.notEqual(base, fingerprintBinCreate(identityOf({ position: 5 })));
  assert.notEqual(base, fingerprintBinCreate(identityOf({ aisle: "B" })));
  assert.notEqual(base, fingerprintBinCreate(identityOf({ area: "WAREHOUSE_STORAGE" })));
});

test("the FORMATTER is excluded — a width change must never invalidate a legitimate replay", () => {
  // This is the load-bearing exclusion. Including the derived code would couple replay detection to
  // formatter configuration, and the first bay-width change would turn every retry into a conflict.
  const wide = validateBinDraft(draft(), warehouses, { bayWidth: 4, positionWidth: 6, separator: "-" });
  assert.equal(wide.valid, true);
  assert.notEqual(wide.value.code, ok().code, "the rendered code really did change");
  assert.equal(
    fingerprintBinCreate(toBinCreateIdentity(wide.value)),
    fingerprintBinCreate(identityOf()),
    "but the create identity did not",
  );
});

test("NAME is excluded — fixing a typo in a description must not become a conflict", () => {
  assert.equal(
    fingerprintBinCreate(identityOf({ name: "Bulk rack" })),
    fingerprintBinCreate(identityOf({ name: "Bulk rack, north wall" })),
  );
});

// ─────────────────────────────────────────── structured racking

test("a valid bin is structure plus a DERIVED code — and no originalCode", () => {
  const v = ok();
  assert.deepEqual(Object.keys(v).sort(), [
    "aisle", "area", "bay", "code", "idempotencyKey", "name", "position", "status", "warehouseId",
  ]);
  assert.equal("originalCode" in v, false, "originalCode has no truthful source under structured create");
});

test("bay and position are INTEGERS — display width is never stored", () => {
  assert.equal(ok().bay, 1);
  assert.equal(ok().position, 3);
  for (const bad of ["01", "1", 1.5, -1, null, undefined]) {
    assert.equal(validateBinDraft(draft({ bay: bad }), warehouses).valid, false, `bay ${String(bad)}`);
    assert.equal(validateBinDraft(draft({ position: bad }), warehouses).valid, false, `position ${String(bad)}`);
  }
});

test("the canonical code renders from the injected policy", () => {
  assert.equal(ok().code, "A01-003");
  assert.equal(ok({ aisle: "AA" }).code, "AA01-003");
  assert.equal(formatBinCode({ aisle: "A", bay: 1, position: 3 }, { bayWidth: 1, positionWidth: 3, separator: "-" }).value, "A1-003");
  assert.deepEqual({ ...DEFAULT_BIN_CODE_FORMAT }, { bayWidth: 2, positionWidth: 3, separator: "-" });
});

test("EVEN positions are exactly as valid as odd ones — no generation policy in the schema", () => {
  // Reserved evens are a BIN-P3 generator concern. 002 must be storable the day it is activated.
  for (const position of [1, 2, 3, 4, 5]) {
    assert.equal(validateBinDraft(draft({ position }), warehouses).valid, true, `position ${position}`);
  }
  assert.equal(ok({ position: 2 }).code, "A01-002");
});

test("area is validated as SHAPE only — no site vocabulary is enforced", () => {
  assert.equal(ok({ area: "parts room" }).area, "PARTS_ROOM");
  assert.equal(ok({ area: "SOME_UNAPPROVED_AREA" }).area, "SOME_UNAPPROVED_AREA");
  for (const bad of ["", "1AREA", "a/b", 42, null]) {
    assert.equal(validateBinDraft(draft({ area: bad }), warehouses).valid, false, `area ${String(bad)}`);
  }
});

test("aisle is one or two letters", () => {
  assert.equal(ok({ aisle: "a" }).aisle, "A");
  assert.equal(ok({ aisle: "zz" }).aisle, "ZZ");
  for (const bad of ["", "AAA", "A1", 1, null]) {
    assert.equal(validateBinDraft(draft({ aisle: bad }), warehouses).valid, false, `aisle ${String(bad)}`);
  }
});

test("a bin in an UNKNOWN warehouse is refused — it would be a place nobody can go", () => {
  assert.equal(validateBinDraft(draft({ warehouseId: "WH-NOPE" }), warehouses).reason, "warehouse_unknown");
});

test("an unsafe warehouse id is refused before it can become part of a document id", () => {
  for (const bad of ["", " ", "a/b", "../x", 5, null, undefined]) {
    assert.equal(isSafeIdSegment(bad), false, `${String(bad)} must not be an id segment`);
    assert.equal(validateBinDraft(draft({ warehouseId: bad }), warehouses).valid, false);
  }
});

test("an idempotencyKey is required — it is what makes a retry safe", () => {
  for (const bad of ["", "   ", 5, null, undefined]) {
    assert.equal(validateBinDraft(draft({ idempotencyKey: bad }), warehouses).valid, false);
  }
});

test("a name is optional, trimmed, bounded, and never used for matching", () => {
  assert.equal(ok().name, null);
  assert.equal(ok({ name: "  Rack 4  " }).name, "Rack 4");
  assert.equal(ok({ name: "" }).name, null);
  assert.equal(validateBinDraft(draft({ name: "x".repeat(121) }), warehouses).valid, false);
  assert.equal(validateBinDraft(draft({ name: 42 }), warehouses).valid, false);
});

test("a new bin is always created ACTIVE", () => {
  assert.equal(ok({ status: "INACTIVE" }).status, "ACTIVE");
});

test("a non-object draft is refused", () => {
  for (const bad of [null, undefined, [], "bin", 3]) {
    assert.equal(validateBinDraft(bad, warehouses).valid, false);
  }
});

// ─────────────────────────────────────────── code normalization (unchanged truths)

test("codes differing only by case or spacing normalize to ONE code", () => {
  assert.equal(normalizeBinCode(" a01-003 ").value.code, "A01-003");
  assert.equal(normalizeBinCode("A 01-003").value.code, "A01-003");
});

test("an unsupported character is REFUSED, never stripped", () => {
  for (const bad of ["A/14", "A 14!", "A#14", "-A14"]) {
    assert.equal(normalizeBinCode(bad).valid, false, `${bad} must be refused`);
  }
});

test("an empty or missing code is refused", () => {
  for (const bad of ["", "   ", null, undefined, 5]) {
    assert.equal(normalizeBinCode(bad).valid, false);
  }
});

test("an over-long code is refused rather than truncated", () => {
  assert.equal(normalizeBinCode("A".repeat(33)).valid, false);
  assert.equal(normalizeBinCode("A".repeat(32)).valid, true);
});

// ─────────────────────────────────────────── rename

test("a rename may not move a warehouse, choose a code, or change status", () => {
  const attrs = { area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3 };
  assert.equal(validateBinRenameDraft({ ...attrs, warehouseId: "WH-2" }).reason, "warehouse_not_movable");
  assert.equal(validateBinRenameDraft({ ...attrs, code: "Z99-999" }).reason, "code_not_accepted");
  assert.equal(validateBinRenameDraft({ ...attrs, status: "INACTIVE" }).reason, "status_not_accepted");
});

test("a rename derives its new code the same way create does", () => {
  assert.equal(validateBinRenameDraft({ area: "PARTS_ROOM", aisle: "A", bay: 1, position: 5 }).value.code, "A01-005");
});

// ─────────────────────────────────────────── claims

test("a claim id is warehouse-scoped, so the same code in two warehouses is two claims", () => {
  assert.equal(deriveBinClaimId("WH-1", "A01-003"), deriveBinClaimId("WH-1", "A01-003"));
  assert.notEqual(deriveBinClaimId("WH-1", "A01-003"), deriveBinClaimId("WH-2", "A01-003"));
});

test("a claim is HELD or SUPERSEDED — there is no released state", () => {
  assert.deepEqual([...BIN_CLAIM_STATES], ["HELD", "SUPERSEDED"]);
});

// ─────────────────────────────────────────── resolving a HUMAN CODE

test("a real, active bin reached by its current code resolves", () => {
  const r = resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin());
  assert.equal(r.result, "FOUND");
  assert.equal(r.binId, BIN_ID);
  assert.equal(r.code, "A01-003");
});

test("a scanned code resolves regardless of case and spacing", () => {
  assert.equal(resolveBinFromClaim(" a01-003 ", "WH-1", storedClaim(), storedBin()).result, "FOUND");
});

test("a SUPERSEDED code reaches the SAME bin, and reports the current code", () => {
  const r = resolveBinFromClaim("A01-003", "WH-1", storedClaim({ claimState: "SUPERSEDED" }), storedBin({ code: "A01-005" }));
  assert.equal(r.result, "FOUND_SUPERSEDED_CODE");
  assert.equal(r.binId, BIN_ID, "a stale label still reaches the right shelf");
  assert.equal(r.code, "A01-005", "and the caller is told what the label should now read");
  assert.equal(r.supersededCode, "A01-003");
});

test("the HUMAN-CODE path can NEVER answer WRONG_WAREHOUSE", () => {
  // Seattle + A01-003 must resolve Seattle's bin and not be confused by Phoenix having one too. A
  // warehouse-scoped lookup cannot observe the other building, and must not pretend to.
  const outcomes = new Set();
  for (const claim of [storedClaim(), storedClaim({ claimState: "SUPERSEDED" }), null]) {
    for (const bin of [storedBin(), storedBin({ status: "INACTIVE" }), null]) {
      outcomes.add(resolveBinFromClaim("A01-003", "WH-1", claim, bin).result);
    }
  }
  assert.equal(outcomes.has("WRONG_WAREHOUSE"), false);
});

test("a RETIRED bin is INACTIVE, never NOT_FOUND", () => {
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin({ status: "INACTIVE" })).result, "INACTIVE");
});

test("an UNRECOGNIZED status fails closed as inactive, never as usable", () => {
  for (const status of ["SOMETHING", undefined, null, 5]) {
    assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin({ status })).result, "INACTIVE");
  }
});

test("an unreserved code is NOT_FOUND", () => {
  assert.equal(resolveBinFromClaim("Z99-999", "WH-1", null, null).result, "NOT_FOUND");
});

test("a malformed scanned code is MALFORMED before the store is even consulted", () => {
  assert.equal(resolveBinFromClaim("A/14", "WH-1", storedClaim(), storedBin()).result, "MALFORMED");
});

test("an unreadable claim or bin is MALFORMED, never treated as a usable bin", () => {
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim({ binId: 5 }), storedBin()).result, "MALFORMED");
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim({ claimState: "NONSENSE" }), storedBin()).result, "MALFORMED");
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim(), null).result, "MALFORMED");
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin({ code: null })).result, "MALFORMED");
});

test("a v1 bin fails closed — there is no dual-version reader", () => {
  assert.equal(resolveBinFromClaim("A01-003", "WH-1", storedClaim(), storedBin({ schemaVersion: 1 })).result, "MALFORMED");
  assert.equal(resolveBinFromToken(BIN_ID, "WH-1", storedBin({ schemaVersion: 1 })).result, "MALFORMED");
});

// ─────────────────────────────────────────── resolving a MACHINE TOKEN

test("a token resolves its bin at the operator's warehouse", () => {
  const r = resolveBinFromToken(BIN_ID, "WH-1", storedBin());
  assert.equal(r.result, "FOUND");
  assert.equal(r.binId, BIN_ID);
  assert.deepEqual(r.location, { type: "BIN", locationId: BIN_ID });
});

test("WRONG WAREHOUSE belongs to the TOKEN path — the operator is in the wrong building", () => {
  const r = resolveBinFromToken(BIN_ID, "WH-2", storedBin({ warehouseId: "WH-1" }));
  assert.equal(r.result, "WRONG_WAREHOUSE");
  assert.equal(r.warehouseId, "WH-1");
});

test("wrong building is answered BEFORE retired — they call for different fixes", () => {
  const r = resolveBinFromToken(BIN_ID, "WH-2", storedBin({ warehouseId: "WH-1", status: "INACTIVE" }));
  assert.equal(r.result, "WRONG_WAREHOUSE");
});

test("an unknown token is NOT_FOUND; a non-token is MALFORMED", () => {
  assert.equal(resolveBinFromToken(BIN_ID, "WH-1", null).result, "NOT_FOUND");
  for (const bad of ["A01-003", "notabin", "", null, 5, "bin_bad/id"]) {
    assert.equal(resolveBinFromToken(bad, "WH-1", storedBin()).result, "MALFORMED", String(bad));
  }
});

test("a rename does not change the machine token", () => {
  // The token is the binId, and a rename never touches it — so the printed barcode keeps working.
  const before = resolveBinFromToken(BIN_ID, "WH-1", storedBin({ code: "A01-003" }));
  const after = resolveBinFromToken(BIN_ID, "WH-1", storedBin({ code: "A01-005" }));
  assert.equal(before.binId, after.binId);
  assert.deepEqual(before.location, after.location);
});

test("there is NO superseded-LABEL outcome — P1 cannot know what is printed", () => {
  const code = readFileSync(new URL("../src/inventoryLocation/binRegistry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /result: "FOUND_SUPERSEDED_LABEL"/);
});

test("the status vocabulary is exactly two, and nothing is ever deleted", () => {
  assert.deepEqual([...BIN_STATUSES], ["ACTIVE", "INACTIVE"]);
});
