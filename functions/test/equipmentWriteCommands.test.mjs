// Equipment create and update — the last governed business writes, as pure decisions.
//
// Two properties carry most of the weight here, and both are the kind that pass review while being
// wrong:
//
//   1. CREATE proves a CROSS-DOCUMENT relationship from the STORED location, not from anything the
//      browser handed over.
//   2. UPDATE restricts the CHANGED KEYS, not the resulting document's key set. Confusing the two
//      bricks every record a trusted writer has ever touched.
import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_EDITABLE_KEYS,
  STATUS,
  buildEquipmentCreate,
  buildEquipmentUpdate,
  nameValid,
  optionalFieldsValid,
  transitionAllowed,
} from "../lib/equipment/equipmentWriteCommands.js";

const CTX = { actorUid: "uid-actor", nowMillis: 1_700_000_000_000 };
const OWNED = { accountId: "acct-1" };
const createCtx = (storedLocation) => ({ ...CTX, storedLocation });

const VALID_CREATE = { accountId: "acct-1", locationId: "loc-1", name: "Ice Machine" };

// ════════════════════ CREATE: THE CROSS-DOCUMENT OWNERSHIP PROOF ════════════════════

test("create proves ownership from the STORED location, and refuses before creating anything", () => {
  const built = buildEquipmentCreate(VALID_CREATE, createCtx(OWNED));
  assert.equal(built.accountId, "acct-1");
  assert.equal(built.locationId, "loc-1");

  // The location belongs to a DIFFERENT account.
  assert.throws(
    () => buildEquipmentCreate(VALID_CREATE, createCtx({ accountId: "acct-other" })),
    (e) => e.code === "OWNERSHIP_INVALID",
  );
  // The location does not exist.
  assert.throws(
    () => buildEquipmentCreate(VALID_CREATE, createCtx(null)),
    (e) => e.code === "OWNERSHIP_UNPROVABLE",
  );
});

test("a browser-supplied location object or ownership boolean is NOT evidence", () => {
  // There is no parameter for either, so the only way to smuggle one is as a payload field -- and
  // an unknown field denies the whole write. This is the anti-injection allowlist doing the work.
  for (const hostile of [
    { ...VALID_CREATE, location: { accountId: "acct-1" } },
    { ...VALID_CREATE, ownershipValid: true },
    { ...VALID_CREATE, auditEventId: "forged" },
    { ...VALID_CREATE, retiredAt: 1 },
  ]) {
    assert.throws(
      () => buildEquipmentCreate(hostile, createCtx({ accountId: "acct-other" })),
      (e) => e.code === "UNKNOWN_FIELD",
      JSON.stringify(Object.keys(hostile)),
    );
  }
});

test("create always yields ACTIVE -- it is chosen, not validated", () => {
  // The rule required `data.status == "ACTIVE"` precisely so create could not be a side door into a
  // non-ACTIVE state. Choosing it removes the question of what happens when a caller sends another.
  for (const attempt of [STATUS.RETIRED, STATUS.INACTIVE, "ANYTHING", undefined]) {
    const built = buildEquipmentCreate({ ...VALID_CREATE, status: attempt }, createCtx(OWNED));
    assert.equal(built.status, STATUS.ACTIVE);
  }
});

test("create stamps both timestamps from the server clock, and ignores supplied ones", () => {
  const built = buildEquipmentCreate({ ...VALID_CREATE, createdAt: 1, updatedAt: 2 }, createCtx(OWNED));
  assert.equal(built.createdAt, CTX.nowMillis);
  assert.equal(built.updatedAt, CTX.nowMillis);
});

test("create validates the name and the optional field types", () => {
  assert.throws(() => buildEquipmentCreate({ ...VALID_CREATE, name: "" }, createCtx(OWNED)), (e) => e.code === "INVALID");
  assert.throws(
    () => buildEquipmentCreate({ ...VALID_CREATE, manufacturer: 42 }, createCtx(OWNED)),
    (e) => e.code === "INVALID",
  );
  assert.throws(
    () => buildEquipmentCreate({ accountId: "acct-1", name: "x" }, createCtx(OWNED)),
    (e) => e.code === "MALFORMED",
  );
});

test("the name predicate rejects invisible-character names, which trim() alone does not", () => {
  // The Rules predicate negates a match on [\\p{Z}\\p{Cf}\\s]*. Format characters like U+200B
  // survive a trim, so a "name" made only of them would otherwise pass.
  assert.equal(nameValid("Ice Machine"), true);
  assert.equal(nameValid("   "), false);
  assert.equal(nameValid("​​"), false, "zero-width space is a format character, not a name");
  assert.equal(nameValid(" "), false, "non-breaking space is a separator");
  assert.equal(nameValid("x".repeat(201)), false);
  assert.equal(nameValid("x".repeat(200)), true);
});

// ════════════════════ UPDATE: CHANGED KEYS, NOT THE DOCUMENT'S KEY SET ════════════════════

test("REGRESSION: a stored trusted/audit field does not make ordinary editing impossible", () => {
  // THE INVARIANT THE RULING NAMES. `affectedKeys().hasOnly(editable)` restricts what CHANGES. A
  // record carrying an audit field stamped by a trusted writer must stay ordinarily editable --
  // requiring the resulting document's key set to be a subset of the editable list would brick
  // every record those writers have touched.
  const stored = {
    accountId: "acct-1",
    locationId: "loc-1",
    name: "Old Name",
    status: STATUS.ACTIVE,
    createdAt: 1,
    updatedAt: 2,
    // Trusted-writer territory. Not editable, not removable, and not a reason to refuse.
    auditEventId: "evt-9",
    retiredAt: null,
    lineageId: "lin-3",
  };

  const { patch, changed } = buildEquipmentUpdate(stored, { name: "New Name" }, CTX);
  assert.deepEqual(changed, ["name"]);
  assert.equal(patch.name, "New Name");
  assert.equal(patch.updatedAt, CTX.nowMillis);

  // THE TRUSTED FIELDS ARE NOT IN THE PATCH AT ALL -- so they are neither rewritten nor stripped.
  // `serialNumberKey` is named EXPLICITLY, not merely covered by the pattern: it is the
  // server-derived key the EOS Data Import writes and the client writer never does, and
  // functions/test/equipmentImportInteropRules.test.js used to be the only proof that an IMPORTED
  // record stays ordinarily editable because of it. That suite's positive cases are denials now
  // (there is no client-direct equipment write to make), so the invariant lives here.
  for (const trusted of ["auditEventId", "retiredAt", "lineageId", "accountId", "locationId", "createdAt", "serialNumberKey"]) {
    assert.equal(trusted in patch, false, `${trusted} must not appear in an ordinary edit patch`);
  }
});

test("REGRESSION: changing a trusted/audit field is REFUSED", () => {
  const stored = { name: "N", status: STATUS.ACTIVE, auditEventId: "evt-9", accountId: "acct-1", locationId: "loc-1" };
  for (const attempt of [
    { auditEventId: "evt-forged" },
    { accountId: "acct-other" },
    { locationId: "loc-other" },
    { createdAt: 999 },
    { retiredAt: 12345 },
  ]) {
    assert.throws(
      () => buildEquipmentUpdate(stored, attempt, CTX),
      (e) => e.code === "FIELD_NOT_EDITABLE",
      JSON.stringify(attempt),
    );
  }
});

test("re-sending an identical value is not a change", () => {
  // `diff().affectedKeys()` compared against the stored record, so an unchanged value was never in
  // the affected set. A patch echoing the whole form back must not read as editing governed fields.
  const stored = { name: "N", status: STATUS.ACTIVE, accountId: "acct-1", locationId: "loc-1" };
  assert.throws(
    () => buildEquipmentUpdate(stored, { accountId: "acct-1", locationId: "loc-1" }, CTX),
    (e) => e.code === "NOOP",
    "identical governed values are not a governed change -- they are no change at all",
  );
});

test("the editable set is exactly the retired rule's", () => {
  assert.deepEqual([...EQUIPMENT_EDITABLE_KEYS].sort(), [
    "assetTag",
    "installedDate",
    "manufacturer",
    "model",
    "name",
    "notes",
    "serialNumber",
    "status",
    "updatedAt",
    "warrantyExpiresDate",
  ]);
});

// ════════════════════ UPDATE: THE STATUS TRANSITION GUARD ════════════════════

test("ordinary update may move ACTIVE <-> INACTIVE and NOTHING else", () => {
  assert.equal(transitionAllowed(STATUS.ACTIVE, STATUS.INACTIVE), true);
  assert.equal(transitionAllowed(STATUS.INACTIVE, STATUS.ACTIVE), true);
  assert.equal(transitionAllowed(STATUS.ACTIVE, STATUS.ACTIVE), true);
  // RETIRE and REACTIVATE are trusted lifecycle actions. This command has no authority for either,
  // and wiring them here to finish the migration is exactly what must not happen.
  assert.equal(transitionAllowed(STATUS.ACTIVE, STATUS.RETIRED), false, "retire is not an ordinary edit");
  assert.equal(transitionAllowed(STATUS.RETIRED, STATUS.ACTIVE), false, "reactivate is not an ordinary edit");
  assert.equal(transitionAllowed(STATUS.RETIRED, STATUS.INACTIVE), false);
  // A record whose STORED status is malformed or absent is denied whatever it is given -- the
  // fail-closed direction, and deliberate: it is repairable only by the trusted writer.
  assert.equal(transitionAllowed(null, STATUS.ACTIVE), false);
  assert.equal(transitionAllowed("NONSENSE", STATUS.ACTIVE), false);
  // A RETIRED record may still be edited, as long as the status does not move.
  assert.equal(transitionAllowed(STATUS.RETIRED, STATUS.RETIRED), true);
});

test("a refused status change is its OWN answer, distinct from a validation failure", () => {
  // The surface says "Retiring or reactivating equipment isn't available here" rather than "check
  // the highlighted fields", because the status CAN change here -- just not that way.
  const active = { name: "N", status: STATUS.ACTIVE, accountId: "a", locationId: "l" };
  assert.throws(
    () => buildEquipmentUpdate(active, { status: STATUS.RETIRED }, CTX),
    (e) => e.code === "STATUS_REFUSED",
  );
  const retired = { name: "N", status: STATUS.RETIRED, accountId: "a", locationId: "l" };
  assert.throws(
    () => buildEquipmentUpdate(retired, { status: STATUS.ACTIVE }, CTX),
    (e) => e.code === "STATUS_REFUSED",
  );
  // And the legal one succeeds.
  assert.equal(buildEquipmentUpdate(active, { status: STATUS.INACTIVE }, CTX).patch.status, STATUS.INACTIVE);
});

test("a RETIRED record stays ordinarily editable as long as the status does not move", () => {
  const retired = { name: "Old", status: STATUS.RETIRED, accountId: "a", locationId: "l" };
  const { patch } = buildEquipmentUpdate(retired, { name: "New" }, CTX);
  assert.equal(patch.name, "New");
  assert.equal("status" in patch, false);
});

// ════════════════════ UPDATE: THE RESULTING VALUES ════════════════════

test("the CANDIDATE document is validated for VALUES -- no grandfathering", () => {
  // An ordinary update must leave the document compliant, so clearing the name is refused even
  // though `name` is editable.
  const stored = { name: "N", status: STATUS.ACTIVE, accountId: "a", locationId: "l" };
  assert.throws(() => buildEquipmentUpdate(stored, { name: "   " }, CTX), (e) => e.code === "INVALID");
  assert.throws(() => buildEquipmentUpdate(stored, { notes: 42 }, CTX), (e) => e.code === "INVALID");
});

test("a missing record and an empty patch are refused by their own codes", () => {
  assert.throws(() => buildEquipmentUpdate(null, { name: "x" }, CTX), (e) => e.code === "NOT_FOUND");
  assert.throws(
    () => buildEquipmentUpdate({ name: "N", status: STATUS.ACTIVE }, {}, CTX),
    (e) => e.code === "NOOP",
    "an empty patch must not land a bare { updatedAt } reported as a successful save",
  );
});

test("the patch carries ONLY the changed keys plus the server's updatedAt", () => {
  const stored = {
    name: "N",
    status: STATUS.ACTIVE,
    manufacturer: "Acme",
    notes: "old",
    accountId: "a",
    locationId: "l",
    auditEventId: "evt-1",
  };
  const { patch, changed } = buildEquipmentUpdate(stored, { notes: "new", manufacturer: "Acme" }, CTX);
  // `manufacturer` was re-sent unchanged, so it is not a change and not in the patch.
  assert.deepEqual(changed, ["notes"]);
  assert.deepEqual(Object.keys(patch).sort(), ["notes", "updatedAt"]);
  assert.equal(patch.updatedAt, CTX.nowMillis);
});

test("a caller cannot stamp updatedAt itself", () => {
  const stored = { name: "N", status: STATUS.ACTIVE, accountId: "a", locationId: "l" };
  const { patch } = buildEquipmentUpdate(stored, { name: "M", updatedAt: 1 }, CTX);
  assert.equal(patch.updatedAt, CTX.nowMillis);
});

// ============================ THE NAME CONTRACT, PORTED ============================
//
// These cases lived in functions/test/equipmentRules.test.js, where they proved the RULES
// predicate accepted a legitimate name in any script and rejected one made only of invisible
// characters. That predicate is retired along with the client-direct write, and the equivalent
// check is now `nameValid` in the command.
//
// They are ported rather than dropped, because the interesting half is not the happy path -- it
// is that `trim()` ALONE is not enough: U+200B and friends are format characters that survive a
// trim, so a name of invisible characters would otherwise pass. Deleting these with the Rules
// they were written against would have quietly retired the only test of that.

test("a legitimate name is accepted in any script", () => {
  for (const name of [
    "\u51b7\u5374\u5668",                 // CJK
    "\u200f\u062c\u0647\u0627\u0632",   // Arabic RTL behind a U+200F RLM prefix
    "\ud83e\uddca",                       // emoji only
    "e\u0301quipement",                    // a combining mark
    "Ice\u00a0Machine",                    // NBSP between words
    "A",                                    // a single visible character
    "\u200bUnit 7",                        // a zero-width space BESIDE visible text
  ]) {
    assert.equal(nameValid(name), true, `${JSON.stringify(name)} is a legitimate name`);
  }
});

test("a name of only invisible characters is REFUSED, which trim() alone would not catch", () => {
  for (const name of [
    "",
    "   ",
    "\u00a0",       // NBSP
    "\u200b",       // zero-width space -- survives trim()
    "\u200f",       // RLM on its own
    "\u2003\u200b", // em space + zero width
  ]) {
    assert.equal(nameValid(name), false, `${JSON.stringify(name)} is not a name`);
  }
  assert.equal(nameValid(undefined), false);
  assert.equal(nameValid(42), false);
  assert.equal(nameValid("x".repeat(201)), false, "the 200-character ceiling is kept");
  assert.equal(nameValid("x".repeat(200)), true, "and 200 itself is still a name");
});

test("an optional field is valid when absent or null, and invalid only when present-and-not-a-string", () => {
  // The other half of what the retired create/update rules validated.
  assert.equal(optionalFieldsValid({}), true, "absent is not invalid");
  assert.equal(optionalFieldsValid({ model: null }), true, "cleared is not invalid");
  assert.equal(optionalFieldsValid({ model: "CM-3" }), true);
  assert.equal(optionalFieldsValid({ model: 42 }), false);
});
