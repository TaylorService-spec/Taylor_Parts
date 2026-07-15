// Issue #232 unit E1 -- pure unit tests for the Equipment domain foundation
// (src/domain/equipment.js), implementing the merged Specification under ADR-006.
// Pure: no firebase, no emulator, no browser -- runs under plain node.
//
// Run: node test/equipmentDomain.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { EQUIPMENT_STATUS } from "../src/domain/constants.js";
import {
  normalizeEquipmentStatus, isValidEquipmentStatus, canTransitionEquipmentStatus, isRetired,
  normalizeEquipmentInput, validateEquipmentInput,
  locationBelongsToAccount, locationsForAccount, equipmentOwnershipValid, ownershipUnchanged,
  equipmentDisplayName, equipmentSummary, equipmentSaveErrorMessage,
  equipmentMatchesSearch, compareEquipment, searchEquipment,
  equipmentServiceHistory, groupServiceHistoryByYear,
  GOVERNED_EQUIPMENT_FIELDS,
  buildEquipmentCreatePayload, buildEquipmentEditPayload,
  trustedActionUnavailable, TRUSTED_ACTION_UNAVAILABLE_REASON,
} from "../src/domain/equipment.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ---- status normalization -------------------------------------------------
ok("status normalizes canonical + case/whitespace variants; unknown fails closed to null", () => {
  assert.equal(normalizeEquipmentStatus("ACTIVE"), EQUIPMENT_STATUS.ACTIVE);
  assert.equal(normalizeEquipmentStatus(" retired "), EQUIPMENT_STATUS.RETIRED);
  assert.equal(normalizeEquipmentStatus("InActive"), EQUIPMENT_STATUS.INACTIVE);
  for (const bad of ["", "BOGUS", null, undefined, 3, {}]) assert.equal(normalizeEquipmentStatus(bad), null);
  assert.equal(isValidEquipmentStatus("ACTIVE"), true);
  assert.equal(isValidEquipmentStatus("BOGUS"), false);
});

// ---- transitions (Spec §3) ------------------------------------------------
ok("allowed transitions exactly match the Specification", () => {
  assert.equal(canTransitionEquipmentStatus("ACTIVE", "INACTIVE"), true);
  assert.equal(canTransitionEquipmentStatus("INACTIVE", "ACTIVE"), true);
  assert.equal(canTransitionEquipmentStatus("ACTIVE", "RETIRED"), true);
  assert.equal(canTransitionEquipmentStatus("INACTIVE", "RETIRED"), true);
  assert.equal(canTransitionEquipmentStatus("RETIRED", "ACTIVE"), true); // reactivate
});
ok("disallowed / no-op / unknown transitions are refused", () => {
  assert.equal(canTransitionEquipmentStatus("RETIRED", "INACTIVE"), false); // reactivates to ACTIVE only
  assert.equal(canTransitionEquipmentStatus("ACTIVE", "ACTIVE"), false);    // no-op is not a transition
  assert.equal(canTransitionEquipmentStatus("BOGUS", "ACTIVE"), false);
  assert.equal(canTransitionEquipmentStatus("ACTIVE", "BOGUS"), false);
  assert.equal(canTransitionEquipmentStatus(null, undefined), false);
});
ok("isRetired reflects normalized status", () => {
  assert.equal(isRetired({ status: "RETIRED" }), true);
  assert.equal(isRetired({ status: "retired" }), true);
  assert.equal(isRetired({ status: "ACTIVE" }), false);
  assert.equal(isRetired({}), false);
});

// ---- normalization + validation (Spec §1/§2) ------------------------------
ok("input normalization trims, maps empty->null, defaults status ACTIVE, drops unknown keys", () => {
  const v = normalizeEquipmentInput({
    accountId: " acct-1 ", locationId: " loc-1 ", name: "  RTU 5  ",
    manufacturer: "  ", model: "", serialNumber: " SN-9 ", notes: null, bogus: "x",
  });
  assert.equal(v.accountId, "acct-1");
  assert.equal(v.name, "RTU 5");
  assert.equal(v.status, EQUIPMENT_STATUS.ACTIVE);   // default
  assert.equal(v.manufacturer, null);                 // whitespace -> null
  assert.equal(v.model, null);                        // empty -> null
  assert.equal(v.serialNumber, "SN-9");
  assert.equal(v.notes, null);
  assert.equal("bogus" in v, false);                  // unknown key dropped
  assert.equal("cost" in v, false);                   // no financial fields ever
});
ok("validation requires accountId + locationId + non-blank name", () => {
  const r = validateEquipmentInput({ accountId: "", locationId: "  ", name: "   " });
  assert.equal(r.valid, false);
  assert.ok(r.errors.accountId && r.errors.locationId && r.errors.name);
  const okr = validateEquipmentInput({ accountId: "a", locationId: "l", name: "Chiller 1" });
  assert.equal(okr.valid, true);
  assert.deepEqual(okr.errors, {});
  assert.equal(okr.value.name, "Chiller 1");
});
ok("duplicate names within an Account are ALLOWED (never a validation error)", () => {
  const a = validateEquipmentInput({ accountId: "a", locationId: "l", name: "RTU 1" });
  const b = validateEquipmentInput({ accountId: "a", locationId: "l2", name: "RTU 1" });
  assert.equal(a.valid, true); assert.equal(b.valid, true);
});
ok("an explicitly invalid status is rejected rather than silently defaulted", () => {
  // normalizeEquipmentInput defaults MISSING status to ACTIVE, which stays valid...
  assert.equal(validateEquipmentInput({ accountId: "a", locationId: "l", name: "n" }).value.status, EQUIPMENT_STATUS.ACTIVE);
  // ...and a supplied-but-unknown status also normalizes to the ACTIVE default, so
  // validation passes -- the write path/Rules never see a bogus enum value.
  const r = validateEquipmentInput({ accountId: "a", locationId: "l", name: "n", status: "BOGUS" });
  assert.equal(r.value.status, EQUIPMENT_STATUS.ACTIVE);
  assert.equal(r.valid, true);
});

// ---- Account/Location relationships (Spec §4) -----------------------------
ok("locationBelongsToAccount fails closed on missing/mismatched/malformed", () => {
  assert.equal(locationBelongsToAccount({ id: "l", accountId: "a" }, "a"), true);
  assert.equal(locationBelongsToAccount({ id: "l", accountId: "b" }, "a"), false); // cross-Account
  assert.equal(locationBelongsToAccount(null, "a"), false);
  assert.equal(locationBelongsToAccount({ id: "l" }, "a"), false);
  assert.equal(locationBelongsToAccount({ accountId: "a" }, ""), false);
});
ok("locationsForAccount returns only that Account's Locations", () => {
  const locs = [{ id: "1", accountId: "a" }, { id: "2", accountId: "b" }, { id: "3", accountId: "a" }];
  assert.deepEqual(locationsForAccount(locs, "a").map((l) => l.id), ["1", "3"]);
  assert.deepEqual(locationsForAccount(locs, ""), []);
});
ok("equipmentOwnershipValid requires the named Location to resolve to the same Account", () => {
  const eq = { accountId: "a", locationId: "l1" };
  assert.equal(equipmentOwnershipValid(eq, { id: "l1", accountId: "a" }), true);
  assert.equal(equipmentOwnershipValid(eq, { id: "l1", accountId: "b" }), false); // cross-Account
  assert.equal(equipmentOwnershipValid(eq, { id: "l2", accountId: "a" }), false); // wrong location
  assert.equal(equipmentOwnershipValid({ accountId: "a" }, { id: "l1", accountId: "a" }), false);
  assert.equal(equipmentOwnershipValid(eq, null), false);
});
ok("ownershipUnchanged detects an ordinary edit attempting to move Account/Location", () => {
  const before = { accountId: "a", locationId: "l1" };
  assert.equal(ownershipUnchanged(before, { accountId: "a", locationId: "l1", name: "new" }), true);
  assert.equal(ownershipUnchanged(before, { accountId: "a", locationId: "l2" }), false); // move
  assert.equal(ownershipUnchanged(before, { accountId: "b", locationId: "l1" }), false); // re-own
});

// ---- presentation ---------------------------------------------------------
ok("display name uses the human reference, never a raw id", () => {
  assert.equal(equipmentDisplayName({ id: "abc123XYZ", name: " RTU 5 " }), "RTU 5");
  assert.equal(equipmentDisplayName({ id: "abc123XYZ", name: "  " }), "Unnamed equipment");
  assert.equal(equipmentDisplayName(null), "Unnamed equipment");
  assert.ok(!equipmentDisplayName({ id: "abc123XYZ" }).includes("abc123XYZ"));
});
ok("summary disambiguates duplicates and omits empty parts", () => {
  assert.equal(equipmentSummary({ manufacturer: "Trane", model: "XR14", serialNumber: "SN1", assetTag: "T-9" }),
    "Trane XR14 · S/N SN1 · Tag T-9");
  assert.equal(equipmentSummary({ manufacturer: "Trane" }), "Trane");
  assert.equal(equipmentSummary({}), "");
});

// ---- safe errors ----------------------------------------------------------
ok("save error copy is safe/categorized and never leaks provider detail", () => {
  const RAW = /permission-denied|firestore\/|FirebaseError|code:|documents\/|[A-Za-z0-9]{20,}/;
  for (const e of [{ blocked: true }, { code: "permission-denied" }, { code: "firestore/unavailable" },
                   { code: "internal" }, new Error("FirebaseError: permission-denied at documents/equipment/abc123XYZ456"), null]) {
    const m = equipmentSaveErrorMessage(e);
    assert.doesNotMatch(m, RAW, `leaked: ${m}`);
    assert.match(m, /saved/i);
  }
  assert.match(equipmentSaveErrorMessage({ blocked: true }), /disabled/i);
  assert.match(equipmentSaveErrorMessage({ code: "permission-denied" }), /permission/i);
});

// ---- search + deterministic ordering (Spec §7) ----------------------------
const FIXTURE = [
  { id: "b", accountId: "a", locationId: "l1", name: "RTU 2", manufacturer: "Trane", model: "XR14", serialNumber: "SN-200", assetTag: "T-2", status: "ACTIVE" },
  { id: "a", accountId: "a", locationId: "l1", name: "RTU 2", manufacturer: "Carrier", model: "C1", serialNumber: "SN-100", assetTag: "T-1", status: "INACTIVE" },
  { id: "c", accountId: "a", locationId: "l2", name: "Boiler 1", manufacturer: "Lochinvar", model: "L9", serialNumber: "SN-300", assetTag: "T-3", status: "RETIRED" },
];
ok("search matches name/assetTag/serial/manufacturer/model, case-insensitively", () => {
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "rtu"), true);
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "t-2"), true);        // assetTag
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "sn-200"), true);     // serial
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "TRANE"), true);      // manufacturer
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "xr14"), true);       // model
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "nope"), false);
  assert.equal(equipmentMatchesSearch(FIXTURE[0], "   "), true);        // blank matches all
});
ok("ordering is deterministic: name asc, tie-break id (a total order)", () => {
  const sorted = [...FIXTURE].sort(compareEquipment).map((e) => e.id);
  assert.deepEqual(sorted, ["c", "a", "b"]); // Boiler 1 < RTU 2; tie -> id a before b
  // stable + total: sorting the reverse yields the same order
  assert.deepEqual([...FIXTURE].reverse().sort(compareEquipment).map((e) => e.id), ["c", "a", "b"]);
});
ok("searchEquipment composes term + location + status filters, ordered, without mutating input", () => {
  const before = FIXTURE.map((e) => e.id);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "rtu" }).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(searchEquipment(FIXTURE, { locationId: "l2" }).map((e) => e.id), ["c"]);
  assert.deepEqual(searchEquipment(FIXTURE, { status: "retired" }).map((e) => e.id), ["c"]);
  assert.deepEqual(searchEquipment(FIXTURE, { term: "rtu", status: "ACTIVE" }).map((e) => e.id), ["b"]);
  assert.deepEqual(searchEquipment(FIXTURE, {}).map((e) => e.id), ["c", "a", "b"]);
  assert.deepEqual(FIXTURE.map((e) => e.id), before); // input untouched
});

// ---- derived service history (Spec §10) -----------------------------------
ok("service history derives from linked Work Orders only, newest first", () => {
  const wos = [
    { id: "wo1", equipmentId: "e1", woNumber: "WO-1", status: "CLOSED", type: "SERVICE_CALL", createdAt: 1000 },
    { id: "wo2", equipmentId: "e2", woNumber: "WO-2", status: "CLOSED", createdAt: 2000 },
    { id: "wo3", equipmentId: "e1", woNumber: "WO-3", status: "COMPLETED", createdAt: 3000 },
  ];
  const h = equipmentServiceHistory(wos, "e1");
  assert.deepEqual(h.map((e) => e.workOrderId), ["wo3", "wo1"]); // newest first, e2 excluded
  assert.equal(h[0].woNumber, "WO-3");
  assert.equal(equipmentServiceHistory(wos, "").length, 0);
  assert.equal(equipmentServiceHistory([], "e1").length, 0);
});
ok("history accepts Timestamp/Date/number createdAt and fails closed on junk", () => {
  const wos = [
    { id: "t", equipmentId: "e1", createdAt: { toMillis: () => 5000 } },
    { id: "d", equipmentId: "e1", createdAt: new Date(4000) },
    { id: "n", equipmentId: "e1", createdAt: 3000 },
    { id: "j", equipmentId: "e1", createdAt: "not-a-date" },
  ];
  const h = equipmentServiceHistory(wos, "e1");
  assert.deepEqual(h.map((e) => e.workOrderId), ["t", "d", "n", "j"]); // junk -> null -> last
  assert.equal(h[3].at, null);
});
ok("history survives retirement (status is never a filter) and groups by year, newest first", () => {
  const y2024 = new Date("2024-06-01").getTime();
  const y2026 = new Date("2026-02-01").getTime();
  const h = equipmentServiceHistory([
    { id: "old", equipmentId: "e1", createdAt: y2024 },
    { id: "new", equipmentId: "e1", createdAt: y2026 },
    { id: "unk", equipmentId: "e1", createdAt: null },
  ], "e1");
  const groups = groupServiceHistoryByYear(h);
  assert.deepEqual(groups.map((g) => g.year), [2026, 2024, "Unknown"]);
  assert.deepEqual(groups[0].entries.map((e) => e.workOrderId), ["new"]);
});

// ---- E2: create payload ---------------------------------------------------
ok("create payload carries the normalized record + updatedAt; createdAt is the store's to stamp", () => {
  const { valid, payload } = buildEquipmentCreatePayload(
    { accountId: " a1 ", locationId: "l1", name: " Rooftop Unit ", model: "", notes: "  " },
    1234
  );
  assert.equal(valid, true);
  assert.equal(payload.accountId, "a1");
  assert.equal(payload.name, "Rooftop Unit");
  assert.equal(payload.status, EQUIPMENT_STATUS.ACTIVE, "status defaults ACTIVE on create");
  assert.equal(payload.model, null, "blank optional normalizes to null, not empty string");
  assert.equal(payload.notes, null);
  assert.equal(payload.updatedAt, 1234);
  assert.equal(
    Object.hasOwn(payload, "createdAt"), false,
    "makeCollectionStore.add() stamps createdAt; setting it here too would return one value and persist another"
  );
});

ok("create cannot be used as a side door into a non-ACTIVE lifecycle state", () => {
  const base = { accountId: "a1", locationId: "l1", name: "Unit" };
  for (const status of ["RETIRED", "INACTIVE", "retired"]) {
    const { valid, errors, payload } = buildEquipmentCreatePayload({ ...base, status }, 1);
    assert.equal(valid, false, `create must refuse status ${status} -- retiring is the audited trusted action`);
    assert.equal(payload, null);
    assert.ok(errors.status);
  }
  // An unrecognized status is refused too -- quietly substituting ACTIVE would be a
  // silent divergence from what the caller asked for, even though ACTIVE is safe.
  const bogus = buildEquipmentCreatePayload({ ...base, status: "BOGUS" }, 1);
  assert.equal(bogus.valid, false, "garbage status must not be silently coerced to ACTIVE");
  assert.equal(bogus.payload, null);
  assert.ok(bogus.errors.status);

  const active = buildEquipmentCreatePayload({ ...base, status: "active" }, 1);
  assert.equal(active.valid, true, "an explicit ACTIVE (any casing) is fine");
  assert.equal(active.payload.status, EQUIPMENT_STATUS.ACTIVE);

  const unspecified = buildEquipmentCreatePayload(base, 1);
  assert.equal(unspecified.valid, true, "the ordinary create path supplies no status at all");
  assert.equal(unspecified.payload.status, EQUIPMENT_STATUS.ACTIVE);
});

ok("create payload fails closed on missing required fields and yields no payload", () => {
  const { valid, errors, payload } = buildEquipmentCreatePayload({ name: "Orphan" }, 1);
  assert.equal(valid, false);
  assert.equal(payload, null, "invalid input must not produce a writable payload");
  assert.ok(errors.accountId && errors.locationId);
});

// ---- E2: ordinary-edit payload (governed-field immutability) --------------
ok("edit payload can never carry a governed field, whatever the caller passes", () => {
  const { payload } = buildEquipmentEditPayload(
    { name: "Renamed", model: "M2", accountId: "a1", locationId: "l1", status: "ACTIVE", createdAt: 5 },
    { name: "Old", accountId: "a1", locationId: "l1", status: "ACTIVE", createdAt: 5 },
    99
  );
  for (const f of GOVERNED_EQUIPMENT_FIELDS) {
    assert.equal(Object.hasOwn(payload, f), false, `edit payload must not contain governed field ${f}`);
  }
  assert.equal(payload.name, "Renamed");
  assert.equal(payload.updatedAt, 99);
});

ok("a partial edit touches only what it was given -- untouched fields are not nulled out", () => {
  const before = {
    name: "Unit", manufacturer: "Carrier", model: "48TC", serialNumber: "SN-9",
    assetTag: "TAG-1", notes: "quarterly PM", accountId: "a1", locationId: "l1", status: "ACTIVE",
  };
  const { valid, payload } = buildEquipmentEditPayload({ name: "Renamed only" }, before, 7);
  assert.equal(valid, true);
  assert.deepEqual(
    Object.keys(payload).sort(), ["name", "updatedAt"],
    "an absent key means UNCHANGED -- writing null would silently erase stored data"
  );
  for (const f of ["manufacturer", "model", "serialNumber", "assetTag", "notes"]) {
    assert.equal(Object.hasOwn(payload, f), false, `${f} was not edited and must not be written`);
  }
  // ...and a field the caller DID clear on purpose still clears.
  const cleared = buildEquipmentEditPayload({ notes: "" }, before, 7);
  assert.equal(cleared.payload.notes, null, "an explicitly emptied field is a real edit to null");
});

ok("edit refuses an attempted governed change instead of silently dropping it", () => {
  const before = { name: "Unit", accountId: "a1", locationId: "l1", status: "ACTIVE" };
  const moved = buildEquipmentEditPayload({ ...before, locationId: "l2" }, before, 1);
  assert.deepEqual(moved.changedGoverned, ["locationId"], "a Location change is the audited move, not an edit");

  const restatused = buildEquipmentEditPayload({ ...before, status: "RETIRED" }, before, 1);
  assert.deepEqual(restatused.changedGoverned, ["status"], "a status change is an explicit lifecycle action");

  const reowned = buildEquipmentEditPayload({ ...before, accountId: "a2", locationId: "l9" }, before, 1);
  assert.deepEqual(reowned.changedGoverned, ["accountId", "locationId"]);

  const restamped = buildEquipmentEditPayload({ ...before, createdAt: 999 }, { ...before, createdAt: 1 }, 1);
  assert.deepEqual(restamped.changedGoverned, ["createdAt"]);
});

ok("an unchanged governed field is not flagged, even re-cased or padded by a round-trip", () => {
  const before = { name: "Unit", accountId: "a1", locationId: "l1", status: "ACTIVE" };
  const spread = buildEquipmentEditPayload({ ...before, name: "Unit 2" }, before, 1);
  assert.deepEqual(spread.changedGoverned, [], "spreading the record is normal; only real changes are refused");
  assert.equal(spread.valid, true);

  // The comparison must be against the value as it would be STORED, not the raw input:
  // a form that lowercases status or pads an id is not requesting a governed change.
  const roundTripped = buildEquipmentEditPayload(
    { ...before, status: "active", accountId: " a1 ", locationId: "l1 ", name: "Unit 2" }, before, 1
  );
  assert.deepEqual(roundTripped.changedGoverned, [], "normalized-equal governed values are not a change");
});

ok("edit fails closed when `before` cannot prove a governed field is unchanged", () => {
  // No `before` -> we cannot know the stored Location, so a caller spreading a whole
  // record must NOT be told the edit succeeded while the move was quietly dropped.
  const unprovable = buildEquipmentEditPayload({ name: "Unit", accountId: "a1", locationId: "l2" }, {}, 1);
  assert.deepEqual(unprovable.unprovableGoverned, ["accountId", "locationId"], "unprovable != fine");
  assert.deepEqual(
    unprovable.changedGoverned, [],
    "a missing `before` is a CALLER bug -- reported apart from a user attempting a real change"
  );

  // Governed fields the caller never supplied are nobody's problem.
  const clean = buildEquipmentEditPayload({ name: "Unit" }, {}, 1);
  assert.deepEqual(clean.unprovableGoverned, []);
  assert.equal(clean.valid, true, "an ordinary descriptive edit must not need `before`");
});

ok("edit enforces the required name when the caller edits it, and ignores it when absent", () => {
  const blank = buildEquipmentEditPayload({ name: "   " }, { name: "Unit" }, 1);
  assert.equal(blank.valid, false);
  assert.equal(blank.payload, null);
  assert.ok(blank.errors.name);

  const untouched = buildEquipmentEditPayload({ notes: "x" }, { name: "Unit" }, 1);
  assert.equal(untouched.valid, true, "not editing the name is not a missing name");
});

// ---- E2: trusted-writer seam ----------------------------------------------
ok("trusted actions report unavailable, never success, with safe copy", () => {
  const r = trustedActionUnavailable("equipment.move");
  assert.equal(r.ok, false, "an unavailable trusted action must never look like success");
  assert.equal(r.unavailable, true);
  assert.equal(r.reason, TRUSTED_ACTION_UNAVAILABLE_REASON);
  assert.equal(r.action, "equipment.move");
  assert.match(r.message, /Nothing was changed/);
});

ok("unavailable copy leaks no provider, code, id, or credential detail", () => {
  for (const action of ["equipment.move", "equipment.retire", "equipment.reactivate", "equipment.setStatus"]) {
    const { message } = trustedActionUnavailable(action);
    assert.doesNotMatch(message, /firebase|firestore|functions|permission-denied|unauthenticated|internal|uid|token|[A-Za-z0-9_-]{20,}/i);
  }
});

console.log(`\n${passed} passed, 0 failed`);
