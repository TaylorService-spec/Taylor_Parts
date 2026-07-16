// Issue #232 unit E8 -- the edit form's change detection, against the real E1 contract.
//
// This is the one piece of E8 with genuine failure modes rather than markup: the form
// holds strings where the record holds nulls, so "did the user change anything?" is not
// `!==`. Getting it wrong is invisible in a browser (everything still saves) and wrong
// in the database (untouched fields rewritten, updatedAt stamped on records nobody
// edited, and #287's "nothing was changed" answer made unreachable).
//
// Pure: no firebase, no emulator, no browser.
//
// Run: node test/equipmentEditDiff.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  EDITABLE_EQUIPMENT_FIELDS, buildEquipmentEditPayload, changedEquipmentFields, trimmedOrNull,
} from "../src/domain/equipment.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// THE function the form calls -- imported, never reimplemented. A local copy here
// would let the component drift away from it while this suite stayed green, proving
// things about the copy rather than about what the form actually sends.
const changedFields = changedEquipmentFields;

// The form's seed: every editable field as a string, null rendered as "".
// The form's seed, matching EquipmentEditModal exactly: trimmed, through the same
// normalizer the diff uses, so the two agree on what the record says.
function seed(equipment) {
  return Object.fromEntries(EDITABLE_EQUIPMENT_FIELDS.map((f) => [f, trimmedOrNull(equipment[f]) ?? ""]));
}

const STORED = Object.freeze({
  accountId: "acct-1", locationId: "loc-1", status: "ACTIVE", createdAt: 1000,
  name: "Rooftop Unit 1", manufacturer: "Carrier", model: null, serialNumber: "SN-9",
  assetTag: null, installedDate: "2024-03-01", warrantyExpiresDate: null, notes: null,
});

ok("E8 an untouched form changes nothing -- null and \"\" are not a difference", () => {
  // The trap: the record holds null, the control holds "". A raw !== comparison reports
  // a change on every optional field the user never touched, rewriting them all and
  // stamping updatedAt on an edit that never happened.
  assert.deepEqual(changedFields(seed(STORED), STORED), {});

  // ...and E1 agrees that is not an edit, rather than writing a bare timestamp (#287).
  const r = buildEquipmentEditPayload(changedFields(seed(STORED), STORED), STORED, 7);
  assert.equal(r.valid, false);
  assert.equal(r.noop, true);
  assert.equal(r.payload, null);
});

ok("E8 only the touched field is sent", () => {
  const values = { ...seed(STORED), name: "Rooftop Unit 2" };
  assert.deepEqual(changedFields(values, STORED), { name: "Rooftop Unit 2" });

  const r = buildEquipmentEditPayload(changedFields(values, STORED), STORED, 7);
  assert.equal(r.valid, true);
  // Untouched fields are absent, not nulled: E1 reads an absent key as unchanged, so a
  // full submit would rewrite Carrier/SN-9/2024-03-01 identically for no reason -- and
  // would silently restore them if another session had changed them meanwhile.
  assert.deepEqual(r.payload, { name: "Rooftop Unit 2", updatedAt: 7 });
});

ok("E8 whitespace-only typing is not a change, and trimming is not a change", () => {
  // Typing spaces into an empty optional field, then leaving: "" -> "   " -> null.
  assert.deepEqual(changedFields({ ...seed(STORED), model: "   " }, STORED), {});
  // Padding an existing value trims back to the same stored string.
  assert.deepEqual(changedFields({ ...seed(STORED), manufacturer: "  Carrier  " }, STORED), {});
  // But a real edit inside the padding IS a change, and is sent trimmed.
  assert.deepEqual(changedFields({ ...seed(STORED), manufacturer: "  Trane  " }, STORED), { manufacturer: "Trane" });
});

ok("E8 clearing an optional field sends null, and is a real edit", () => {
  // "" means the user cleared it -- distinct from "never touched it", which the seed
  // makes indistinguishable ONLY for fields that were already null.
  const values = { ...seed(STORED), manufacturer: "" };
  assert.deepEqual(changedFields(values, STORED), { manufacturer: null });

  const r = buildEquipmentEditPayload(changedFields(values, STORED), STORED, 7);
  assert.equal(r.valid, true);
  assert.deepEqual(r.payload, { manufacturer: null, updatedAt: 7 });
  assert.equal(r.noop, false);
});

ok("E8 filling a previously-null optional field is a change", () => {
  const values = { ...seed(STORED), model: "48TC" };
  assert.deepEqual(changedFields(values, STORED), { model: "48TC" });
  assert.deepEqual(buildEquipmentEditPayload(changedFields(values, STORED), STORED, 7).payload,
    { model: "48TC", updatedAt: 7 });
});

ok("E8 the form can never send a governed field, so the edit is never refused as one", () => {
  // The form has no control for these, but the guarantee must not rest on the markup:
  // the diff iterates EDITABLE_EQUIPMENT_FIELDS, so a governed key cannot enter the
  // payload even if a caller seeded the form with one.
  const polluted = { ...seed(STORED), accountId: "acct-2", locationId: "loc-2", status: "RETIRED", createdAt: 5 };
  const changed = changedFields(polluted, STORED);
  for (const governed of ["accountId", "locationId", "status", "createdAt"]) {
    assert.equal(governed in changed, false, `${governed} must never be diffed into the payload`);
  }

  // Editing the name alongside that pollution still succeeds -- proof the form's edits
  // are not silently refused by E1's governed guard.
  const r = buildEquipmentEditPayload(changedFields({ ...polluted, name: "New" }, STORED), STORED, 7);
  assert.equal(r.valid, true);
  assert.deepEqual(r.payload, { name: "New", updatedAt: 7 });
  assert.deepEqual(r.changedGoverned, []);
});

ok("E8 a RETIRED asset's descriptive edit is valid (Owner E3 decision 2)", () => {
  // Retiring never freezes the record: descriptive corrections stay allowed, while
  // status/accountId/locationId stay unchanged. A wrong serial number is still worth
  // fixing after the asset leaves service.
  const retired = { ...STORED, status: "RETIRED" };
  const values = { ...seed(retired), serialNumber: "SN-CORRECTED" };
  const r = buildEquipmentEditPayload(changedFields(values, retired), retired, 7);
  assert.equal(r.valid, true);
  assert.deepEqual(r.payload, { serialNumber: "SN-CORRECTED", updatedAt: 7 });
  // The status field is not in the payload at all, so Rules see it unchanged.
  assert.equal("status" in r.payload, false);
});

ok("E8 an absent control means unchanged, never 'clear this field'", () => {
  // A partial `values` is not a request to blank everything it omits. This matters for
  // any caller that submits a subset -- reading absent as "" would wipe manufacturer,
  // serialNumber and installedDate off the record while the user edited only the name.
  assert.deepEqual(changedFields({ name: "Rooftop Unit 2" }, STORED), { name: "Rooftop Unit 2" });
  assert.deepEqual(changedFields({}, STORED), {});
  // Explicitly clearing is still distinguishable from omitting.
  assert.deepEqual(changedFields({ manufacturer: "" }, STORED), { manufacturer: null });
});

ok("E8 the diff honours the #287 record contract instead of throwing", () => {
  // Same fail-closed answer as every other record helper: unreadable input yields no
  // changes -- so nothing is written -- rather than a TypeError or a plausible diff.
  for (const bad of [null, undefined, "garbage", 42, [], Object.assign([], { name: "Sneaky" })]) {
    assert.deepEqual(changedFields(bad, STORED), {}, `values=${String(bad)} yields no changes`);
    assert.deepEqual(changedFields(seed(STORED), bad), {}, `equipment=${String(bad)} yields no changes`);
  }
});

// A GENUINELY sparse record: optional fields ABSENT, not null -- exactly what the
// `equip-alpha-sparse` fixture is ("every optional field absent -- not null, ABSENT").
// STORED above declares every key explicitly, so it never exercises `undefined`, and
// that hole let `equipment[f] ?? null -> equipment[f]` survive mutation while being a
// REAL defect: over this record it makes an untouched form report all seven optionals
// as cleared, and write them.
const SPARSE = Object.freeze({ accountId: "acct-1", locationId: "loc-1", status: "ACTIVE", name: "Unlabeled Pump" });

ok("E8 an untouched form over a SPARSE record (fields absent, not null) changes nothing", () => {
  assert.deepEqual(changedFields(seed(SPARSE), SPARSE), {});
  const r = buildEquipmentEditPayload(changedFields(seed(SPARSE), SPARSE), SPARSE, 7);
  assert.equal(r.noop, true, "an absent field is not a cleared field");
  assert.equal(r.payload, null);
  // ...and filling one of those absent fields is still a real edit.
  assert.deepEqual(changedFields({ ...seed(SPARSE), model: "48TC" }, SPARSE), { model: "48TC" });
});

ok("E8 a PADDED stored value is not a change -- both sides normalize the same way", () => {
  // Rules permit padded strings (they only require a non-blank TRIMMED name), so such
  // records are legal -- from an import, a seed, or a trusted writer. Normalizing only
  // the form side made an untouched form rewrite the record on save.
  const padded = { ...STORED, manufacturer: "  Carrier  ", serialNumber: "SN-9 " };
  assert.deepEqual(changedFields(seed(padded), padded), {},
    "opening and saving an untouched padded record must write nothing");
  // A real edit against a padded record still registers, and is stored trimmed.
  assert.deepEqual(changedFields({ ...seed(padded), manufacturer: "Trane" }, padded), { manufacturer: "Trane" });
});

ok("E8 a non-string field value refuses the WHOLE diff -- never a partial success", () => {
  // Every editable field is a string (or null = cleared). Anything else is a caller bug.
  for (const bad of [5, true, {}, [], new Date()]) {
    assert.deepEqual(changedFields({ manufacturer: bad }, STORED), {},
      `a ${typeof bad} must not become an edit`);
    // THE MIXED CASE is the one that matters, and the one an isolated check cannot see:
    // dropping only the bad field would save the name and silently discard the
    // manufacturer edit while reporting success -- the shape #287 refused for governed
    // fields ("a dropped move reported as success is worse than a refused edit").
    const mixed = changedFields({ name: "RTU 2", manufacturer: bad }, STORED);
    assert.deepEqual(mixed, {}, `a ${typeof bad} beside a valid edit must refuse the whole diff`);
    const r = buildEquipmentEditPayload(mixed, STORED, 7);
    assert.equal(r.valid, false, "a refused diff must never report a successful save");
    assert.equal(r.payload, null);
  }
  // null IS a legitimate clear, and stays distinguishable from all of the above.
  assert.deepEqual(changedFields({ manufacturer: null }, STORED), { manufacturer: null });
});

ok("E8 a user CAN remove padding a record legitimately holds", () => {
  // Seeding raw would strand them: the input shows "  RTU 1  ", they delete the spaces,
  // the diff normalizes both sides to "RTU 1", and the app answers "Nothing was changed"
  // to a change they can see. Seeding trimmed means the padding is never shown.
  const padded = { ...STORED, name: "  RTU 1  " };
  assert.equal(seed(padded).name, "RTU 1", "the form never displays the stored padding");
  assert.deepEqual(changedFields(seed(padded), padded), {}, "and an untouched form still writes nothing");
  // A real edit off that trimmed seed lands normally.
  assert.deepEqual(changedFields({ ...seed(padded), name: "RTU 2" }, padded), { name: "RTU 2" });
});

ok("E8 EVERY editable field round-trips -- each one is behaviorally covered", () => {
  // Without this, a diff that silently dropped assetTag / installedDate /
  // warrantyExpiresDate / notes passed the whole suite: only name, manufacturer, model
  // and serialNumber were exercised, and the rest were pinned by nothing but the
  // field-list equality check.
  const VALUES = {
    name: "Edited Name", manufacturer: "Trane", model: "XR16", serialNumber: "SN-NEW",
    assetTag: "AT-NEW", installedDate: "2025-01-02", warrantyExpiresDate: "2035-01-02",
    notes: "Edited notes",
  };
  // A FULLY POPULATED record, so "clear it" is a real change for every optional field.
  // STORED leaves four of them null, where clearing is correctly a no-op -- which would
  // have made half of the clear assertions below vacuous.
  const FULL = Object.freeze({
    accountId: "acct-1", locationId: "loc-1", status: "ACTIVE", createdAt: 1000,
    name: "Rooftop Unit 1", manufacturer: "Carrier", model: "48TC", serialNumber: "SN-9",
    assetTag: "AT-1", installedDate: "2024-03-01", warrantyExpiresDate: "2034-03-01",
    notes: "Some notes",
  });
  for (const f of EDITABLE_EQUIPMENT_FIELDS) {
    const one = changedFields({ ...seed(FULL), [f]: VALUES[f] }, FULL);
    assert.deepEqual(one, { [f]: VALUES[f] }, `editing ${f} alone must send exactly ${f}`);
    const r = buildEquipmentEditPayload(one, FULL, 7);
    assert.equal(r.valid, true, `${f} must be a valid edit`);
    assert.deepEqual(r.payload, { [f]: VALUES[f], updatedAt: 7 }, `${f} must reach the payload`);
    // ...and clearing it, for the seven that are optional. `name` is required, so an
    // empty name is a validation error rather than a clear.
    if (f !== "name") {
      assert.deepEqual(changedFields({ ...seed(FULL), [f]: "" }, FULL), { [f]: null },
        `clearing ${f} must send null`);
    } else {
      assert.ok(buildEquipmentEditPayload({ name: "" }, FULL, 7).errors.name,
        "an empty name is refused, not treated as a clear");
    }
  }
});

ok("E8 the diff covers exactly the domain's editable fields", () => {
  // If E1 gains an editable field and this form does not, the control is missing and no
  // test would otherwise notice. The form seeds and diffs from the same imported list,
  // so this pins that the list is what E8 believes it is.
  assert.deepEqual([...EDITABLE_EQUIPMENT_FIELDS].sort(),
    ["assetTag", "installedDate", "manufacturer", "model", "name", "notes",
     "serialNumber", "warrantyExpiresDate"]);
  // ...and that no governed field leaked into it.
  for (const governed of ["accountId", "locationId", "status", "createdAt"]) {
    assert.equal(EDITABLE_EQUIPMENT_FIELDS.includes(governed), false);
  }
});

console.log(`\n${passed} passed, 0 failed`);
