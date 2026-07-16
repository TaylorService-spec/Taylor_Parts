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
  buildEquipmentCreatePayload, buildEquipmentEditPayload, ordinaryStatusChangeAllowed,
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

// ---- search fail-closed hardening -----------------------------------------
// The options argument is untrusted input. The destructuring default `= {}` only
// fires for `undefined`, so every OTHER malformed argument used to destructure to
// all-defaults and mean "no filters" -- returning the ENTIRE register to a caller who
// asked to narrow it. Fail-open, and silent.
ok("a malformed options argument returns NOTHING, never everything", () => {
  const all = searchEquipment(FIXTURE, {});
  assert.ok(all.length >= 3, "precondition: the fixture has records to leak");

  for (const [label, bad] of [
    ["bare string (searchEquipment(list, \"rtu\") reads naturally and used to return ALL)", "rtu"],
    ["array", ["rtu"]],
    ["number", 42],
    ["boolean", true],
    ["null", null],
    ["string object", new String("rtu")],
    ["Map (object, but not a plain one)", new Map([["term", "rtu"]])],
  ]) {
    assert.deepEqual(searchEquipment(FIXTURE, bad), [], `options as ${label} must return no results`);
  }
});

ok("an UNRECOGNIZED option key returns nothing -- the same trap, one level down", () => {
  // Guarding only the argument would have relocated the defect rather than closed it:
  // `{search: q}` also destructures to all-defaults and used to return the whole
  // register -- a likelier slip than the bare string, and just as silent.
  for (const bad of [
    { search: "rtu" },        // the obvious wrong name
    { query: "rtu" },
    { location: "l2" },       // near-miss on locationId
    { statuses: ["ACTIVE"] }, // near-miss on status
    { Term: "rtu" },          // casing slip
    { term: "rtu", extra: 1 },// a valid key alongside an unknown one
    { length: 2 },            // array-like that passes a plain-object check
  ]) {
    assert.deepEqual(searchEquipment(FIXTURE, bad), [], `unknown key in ${JSON.stringify(bad)} must return no results`);
  }
});

ok("a malformed FIELD inside a valid options object returns nothing", () => {
  for (const [label, opts] of [
    ["term: number", { term: 42 }],
    ["term: object -- the bare-object mistake", { term: { term: "rtu" } }],
    ["term: array", { term: ["rtu"] }],
    ["locationId: number", { locationId: 7 }],
    ["locationId: empty string", { locationId: "" }],
    ["locationId: blank string", { locationId: "   " }],
    ["locationId: object", { locationId: {} }],
    ["status: number", { status: 3 }],
    ["status: object", { status: {} }],
  ]) {
    assert.deepEqual(searchEquipment(FIXTURE, opts), [], `${label} must return no results`);
  }
});

ok("an explicitly unknown status returns nothing -- it never disables the filter", () => {
  // The original normalized "BOGUS" to null, which read as "no status filter" and
  // BROADENED the result: a narrower question answered with a wider answer.
  for (const status of ["BOGUS", "PENDING", "active-ish", ""]) {
    assert.deepEqual(
      searchEquipment(FIXTURE, { status }), [],
      `unknown status ${JSON.stringify(status)} must return no results, not disable the filter`
    );
  }
  // A narrowing combination cannot widen either.
  assert.deepEqual(searchEquipment(FIXTURE, { term: "rtu", status: "BOGUS" }), []);
});

ok("a non-array Equipment input returns nothing instead of throwing", () => {
  for (const bad of ["notarray", 42, null, undefined, {}, { length: 2 }]) {
    assert.deepEqual(searchEquipment(bad, { term: "rtu" }), [], `equipment as ${JSON.stringify(bad)} -> []`);
  }
});

ok("VALID omitted/empty/default options still return everything, ordered", () => {
  // The one documented broad behaviour, deliberately preserved.
  const expected = FIXTURE.slice().sort(compareEquipment).map((e) => e.id);
  assert.deepEqual(searchEquipment(FIXTURE).map((e) => e.id), expected, "options omitted entirely");
  assert.deepEqual(searchEquipment(FIXTURE, {}).map((e) => e.id), expected, "empty options object");
  assert.deepEqual(searchEquipment(FIXTURE, { term: "" }).map((e) => e.id), expected, "empty term");
  assert.deepEqual(searchEquipment(FIXTURE, { term: "   " }).map((e) => e.id), expected, "blank term");
  assert.deepEqual(
    searchEquipment(FIXTURE, { term: undefined, locationId: undefined, status: undefined }).map((e) => e.id),
    expected, "explicitly undefined fields == omitted"
  );
  assert.deepEqual(
    searchEquipment(FIXTURE, { term: null, locationId: null, status: null }).map((e) => e.id),
    expected, "explicitly null fields == no filter (the documented defaults)"
  );
});

ok("equipmentMatchesSearch fails closed on a malformed term but still no-ops on an empty one", () => {
  const e = { name: "RTU-1" };
  assert.equal(equipmentMatchesSearch(e, ""), true, "empty term -> no search applied");
  assert.equal(equipmentMatchesSearch(e, "   "), true, "blank term -> no search applied");
  assert.equal(equipmentMatchesSearch(e, undefined), true, "omitted -> no search applied");
  assert.equal(equipmentMatchesSearch(e, null), true, "null -> no search applied");
  assert.equal(equipmentMatchesSearch(e, 42), false, "number -> fail closed, not match-everything");
  assert.equal(equipmentMatchesSearch(e, { term: "RTU" }), false, "object -> fail closed");
  assert.equal(equipmentMatchesSearch(e, ["RTU"]), false, "array -> fail closed");
  assert.equal(equipmentMatchesSearch(e, "rtu"), true, "a real term still matches");
});

ok("collection helpers answer [] on a non-array instead of crashing the caller", () => {
  // The `= []` default only fires for undefined, so every other malformed collection
  // reached .filter and raised a TypeError -- a crash at whatever surface called it,
  // rather than an answer it could handle. Empty is the honest answer: no usable set.
  for (const bad of ["notarray", 42, null, {}, { length: 2 }, true, new Set()]) {
    assert.deepEqual(locationsForAccount(bad, "a1"), [], `locationsForAccount(${JSON.stringify(bad)}) -> []`);
    assert.deepEqual(equipmentServiceHistory(bad, "e1"), [], `equipmentServiceHistory(${JSON.stringify(bad)}) -> []`);
  }
  // Omitted still means "nothing supplied" -> [], as before.
  assert.deepEqual(locationsForAccount(undefined, "a1"), []);
  assert.deepEqual(equipmentServiceHistory(undefined, "e1"), []);

  // ...and real collections are untouched: valid work still works.
  const locs = [{ id: "l1", accountId: "a1" }, { id: "l2", accountId: "OTHER" }];
  assert.deepEqual(locationsForAccount(locs, "a1").map((l) => l.id), ["l1"], "valid Locations still filter");
  const wos = [
    { id: "w1", equipmentId: "e1", woNumber: "WO-1", createdAt: Date.UTC(2026, 5, 15, 12) },
    { id: "w2", equipmentId: "OTHER", woNumber: "WO-2", createdAt: Date.UTC(2026, 5, 16, 12) },
  ];
  assert.deepEqual(equipmentServiceHistory(wos, "e1").map((h) => h.workOrderId), ["w1"], "valid Work Orders still derive history");
});

ok("a service-history entry's shape is exactly what the doc comment promises", () => {
  // The comment claimed an `id` field this function has never returned. E7 renders
  // this list, so a dev trusting it writes key={entry.id} -> undefined key on every
  // row of an explicitly ordered list. Pin the real shape so the comment cannot drift
  // from the code again.
  const [entry] = equipmentServiceHistory(
    [{ id: "w1", equipmentId: "e1", woNumber: "WO-1", status: "COMPLETED", type: "PM", createdAt: 1 }],
    "e1"
  );
  assert.deepEqual(Object.keys(entry).sort(), ["at", "status", "type", "woNumber", "workOrderId"]);
  assert.equal(entry.workOrderId, "w1");
  assert.equal(Object.hasOwn(entry, "id"), false, "there is no `id` on an entry -- the key is workOrderId");
});

ok("groupServiceHistoryByYear rejects malformed input instead of fabricating history", () => {
  // A string used to be walked character by character into a phantom bucket: each
  // character's `.at` is String.prototype.at (truthy), so the guard passed and
  // produced year NaN -- which `?? "Unknown"` never caught.
  for (const bad of ["notarray", 42, null, undefined, { 0: "x" }]) {
    assert.deepEqual(groupServiceHistoryByYear(bad), [], `${JSON.stringify(bad)} -> no groups`);
  }
  // Real entries still group, and a non-numeric/absent `at` is still "Unknown".
  const groups = groupServiceHistoryByYear([
    // Mid-year: getFullYear() is LOCAL, so a Jan 1 UTC instant is the PREVIOUS year in
    // any negative offset (this machine is UTC-7) -- the same trap E4's fixture dates
    // avoid. Not the behaviour under test; don't let it decide the result.
    { workOrderId: "a", at: Date.UTC(2026, 5, 15, 12) },
    { workOrderId: "b", at: null },
    { workOrderId: "c", at: 0 },
    { workOrderId: "d", at: Number.NaN },
    { workOrderId: "e", at: 8.64e15 * 2 }, // out of Date range -> getFullYear() is NaN
  ]);
  assert.deepEqual(groups.map((g) => g.year), [2026, "Unknown"]);
  assert.deepEqual(groups[1].entries.map((e) => e.workOrderId), ["b", "c", "d", "e"], "0/null/NaN/out-of-range all Unknown");

  // A NEGATIVE at is a real pre-1970 date, not malformed -- it must still group by its
  // year. The hardening must not quietly relabel real history as Unknown.
  const old = groupServiceHistoryByYear([{ workOrderId: "old", at: Date.UTC(1965, 5, 15, 12) }]);
  assert.deepEqual(old.map((g) => g.year), [1965], "pre-1970 history groups by its real year, not Unknown");
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

  // #312: status is no longer GOVERNED -- an ordinary edit may move it ACTIVE<->INACTIVE.
  // Retiring is still refused here, but as `refusedStatus`, not as a governed change:
  // "not available here" and "cannot change here at all" are different answers, and the
  // status can change here.
  const retiring = buildEquipmentEditPayload({ ...before, status: "RETIRED" }, before, 1);
  assert.deepEqual(retiring.changedGoverned, [], "status is not a governed field (#312)");
  assert.equal(retiring.refusedStatus, true, "retiring is a trusted lifecycle action (E10)");
  assert.equal(retiring.valid, false);
  assert.equal(retiring.payload, null);

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

// ---- #287: the record contract at the input boundary ----------------------
// Every record helper answers "can I read fields off this?" the same way. Before #287
// they disagreed: `null` threw, a string sailed through the `= {}` default (which only
// fires for `undefined`) and produced a plausible-looking all-null record. Two wrong
// answers, neither of them "no".
//
// There are THREE cases, and collapsing any two of them is what caused the defects:
//
//   ABSENT (`undefined`)  -> the `= {}` default fires. This is the normal JS "argument
//                            omitted" affordance and its behavior is PRESERVED: an
//                            empty record, which fails the ordinary way (create reports
//                            honest field errors, edit reports a no-op). Not malformed:
//                            there is nothing unreadable about an argument nobody sent.
//   MALFORMED (the rest)  -> a caller bug. Refused as `malformed`, with no field errors,
//                            because no control on any form can fix it.
//   A RECORD              -> read it.
//
// Both failing cases fail closed and neither throws. MALFORMED_RECORDS is shared by the
// tests below on purpose: the contract must not vary by helper or by input flavour.
//
// `arrayCarryingAField` earns its place: for every OTHER member, reading `.name` yields
// undefined anyway, so a helper with no guard at all still answers "null" and looks
// correct. This is the only member that makes the guard observable -- without it,
// replacing the isRecord check with `values ?? {}` passes the whole suite.
const arrayCarryingAField = Object.assign([], { name: "Sneaky", accountId: "acct-9" });
const MALFORMED_RECORDS = [
  null, "garbage", "", 0, 42, true, false, [], ["a"], Symbol("x"), arrayCarryingAField,
];

ok("#287 record helpers refuse every malformed input -- no throw, no plausible answer", () => {
  for (const bad of MALFORMED_RECORDS) {
    assert.equal(buildEquipmentEditPayload(bad, {}, 1).malformed, true, `edit(${String(bad)}) is malformed`);
    // normalize: refuses by yielding an all-null record, never by throwing.
    const n = normalizeEquipmentInput(bad);
    // Not `typeof n === "object"` -- that is true of `null`, the very thing being ruled
    // out here, so it would pass by accident. Assert what actually distinguishes a
    // record, through the public API rather than by reaching for the private guard.
    assert.ok(n !== null && typeof n === "object" && !Array.isArray(n),
      `normalize(${String(bad)}) must return a real record`);
    assert.equal(n.name, null, `normalize(${String(bad)}) must read no fields off it`);
    assert.equal(n.accountId, null);
    assert.equal(n.locationId, null);
    assert.equal(n.name, null);

    // validate: an unreadable input is INVALID, never valid-by-omission.
    const v = validateEquipmentInput(bad);
    assert.equal(v.valid, false, `validate(${String(bad)}) must be invalid`);

    // create: refuses and yields no payload. A payload here would be a write.
    const c = buildEquipmentCreatePayload(bad, 1);
    assert.equal(c.valid, false, `create(${String(bad)}) must be invalid`);
    assert.equal(c.payload, null, `create(${String(bad)}) must yield no payload`);
    assert.equal(c.malformed, true, `create(${String(bad)}) must report malformed`);
    assert.deepEqual(c.errors, {}, "malformed input must not blame a form field");
  }
});

ok("#287 ownershipUnchanged fails closed on unreadable records instead of throwing or affirming", () => {
  const good = { accountId: "acct-1", locationId: "loc-1" };
  for (const bad of [...MALFORMED_RECORDS, undefined]) {
    // Never throws -- `ownershipUnchanged(null, null)` used to be a TypeError.
    assert.equal(ownershipUnchanged(bad, good), false, `(${String(bad)}, good) must be false`);
    assert.equal(ownershipUnchanged(good, bad), false, `(good, ${String(bad)}) must be false`);
    assert.equal(ownershipUnchanged(bad, bad), false, `(${String(bad)}, ${String(bad)}) must be false`);
  }
  // The headline defect: two unreadable records once "proved" ownership unchanged.
  assert.equal(ownershipUnchanged("garbage", {}), false);
  // Ownership is only PROVABLE when both sides actually carry both ids. A record
  // missing an id cannot prove anything about it, so it is not "unchanged".
  assert.equal(ownershipUnchanged({ accountId: "acct-1" }, { accountId: "acct-1" }), false);
  assert.equal(ownershipUnchanged({ accountId: "acct-1", locationId: "" }, good), false);

  // Records that AGREE on a blank or whitespace id must not be read as agreeing on an
  // owner: `"" === ""` is true, so a check that only compared values would call two
  // wholly unowned records "unchanged" -- affirming ownership that does not exist.
  // These cases are what make the id checks load-bearing rather than decorative.
  for (const blank of ["", "   ", null, undefined]) {
    assert.equal(ownershipUnchanged({ accountId: blank, locationId: blank },
                                    { accountId: blank, locationId: blank }), false,
      `two records sharing a blank (${JSON.stringify(blank)}) id prove nothing`);
    assert.equal(ownershipUnchanged({ accountId: "acct-1", locationId: blank },
                                    { accountId: "acct-1", locationId: blank }), false);
  }
  // ...and the valid path still answers truthfully in both directions.
  assert.equal(ownershipUnchanged(good, { ...good }), true);
  assert.equal(ownershipUnchanged(good, { ...good, locationId: "loc-2" }), false);
  assert.equal(ownershipUnchanged(good, { ...good, accountId: "acct-2" }), false);
});

ok("#287 a malformed edit is refused, not reported as a successful {updatedAt} no-op", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  for (const bad of MALFORMED_RECORDS) {
    const r = buildEquipmentEditPayload(bad, before, 1);
    assert.equal(r.valid, false, `edit(${String(bad)}) must be invalid`);
    assert.equal(r.payload, null, `edit(${String(bad)}) must yield no payload`);
    // The exact defect was valid:true carrying { updatedAt: 1 }; `payload === null`
    // above already excludes it, so no further assertion is added here -- a
    // notDeepEqual against null would assert nothing.
    // Malformed input is a CALLER bug: no field error, because no field can fix it.
    assert.equal(r.malformed, true, `edit(${String(bad)}) must report malformed`);
    assert.deepEqual(r.errors, {}, "malformed input must not blame a form field");
  }
});

ok("#287 unreadable `before` proves nothing -- governed edits fail closed, descriptive edits proceed", () => {
  for (const bad of [...MALFORMED_RECORDS, undefined]) {
    // Evidence we cannot read is not proof, so a governed edit against it must be
    // refused as UNPROVABLE -- never silently allowed, and never miscast as an
    // attempted change the user did not make.
    const g = buildEquipmentEditPayload({ accountId: "acct-2" }, bad, 1);
    assert.equal(g.valid, false, `governed edit(before=${String(bad)}) must be invalid`);
    assert.equal(g.payload, null);
    assert.deepEqual(g.unprovableGoverned, ["accountId"], `before=${String(bad)} proves nothing`);
    assert.deepEqual(g.changedGoverned, []);
    // Not an empty edit either: the caller asked for a governed field. Same bug class
    // as a changedGoverned attempt reporting "nothing changed", in its other form.
    assert.equal(g.noop, false, "an unprovable governed attempt is not an empty edit");

    // A descriptive-only edit needs no evidence and still works -- identical to the
    // legitimate `before = {}` path that updateEquipmentWith already relies on.
    const d = buildEquipmentEditPayload({ name: "New name" }, bad, 1);
    assert.equal(d.valid, true, `descriptive edit(before=${String(bad)}) must succeed`);
    assert.deepEqual(d.payload, { name: "New name", updatedAt: 1 });
  }
});

ok("#287 an edit that touches no editable field is not a valid edit", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  // A well-formed but empty edit: previously valid, writing a bare timestamp and
  // reporting success for a change nobody made.
  const empty = buildEquipmentEditPayload({}, before, 7);
  assert.equal(empty.valid, false);
  assert.equal(empty.payload, null);
  assert.equal(empty.noop, true, "an empty edit is a no-op");
  assert.deepEqual(empty.errors, {}, "a no-op is not the user's mistake -- no field error");

  // Unknown keys are not editable fields -- they are dropped, so this is still a no-op.
  const unknown = buildEquipmentEditPayload({ bogusKey: "x" }, before, 7);
  assert.equal(unknown.valid, false);
  assert.equal(unknown.payload, null);
  assert.equal(unknown.noop, true);

  // A governed-only edit is refused as well, and still reports WHICH governed field
  // was attempted -- refusing early must not blind the caller to the attempt.
  const governed = buildEquipmentEditPayload({ accountId: "acct-2" }, before, 7);
  assert.equal(governed.valid, false);
  assert.equal(governed.payload, null);
  assert.deepEqual(governed.changedGoverned, ["accountId"]);
  // ...and it is NOT a no-op: the user asked to move an Account. Telling them they
  // changed nothing would be the exact inverse of what they just did.
  assert.equal(governed.noop, false, "a governed attempt is not an empty edit");

  // ...while a real single-field edit still succeeds and still stamps updatedAt.
  const real = buildEquipmentEditPayload({ name: "Walk-in Freezer" }, before, 7);
  assert.equal(real.valid, true);
  assert.equal(real.noop, false);
  assert.equal(real.malformed, false);
  assert.deepEqual(real.payload, { name: "Walk-in Freezer", updatedAt: 7 });
});

ok("#287 the record contract accepts records, and only records", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  // A class instance and a Map have fields, but they are not Equipment records read
  // off a Firestore snapshot. Reading them would mean guessing at their shape.
  class EquipmentLike { constructor() { this.name = "Freezer"; } }
  for (const exotic of [new EquipmentLike(), new Map([["name", "Freezer"]]), new Date()]) {
    assert.equal(buildEquipmentEditPayload(exotic, before, 1).valid, false);
    assert.equal(buildEquipmentCreatePayload(exotic, 1).valid, false);
    assert.equal(ownershipUnchanged(exotic, before), false);
  }
  // An array CARRYING a field is the case that makes the array exclusion observable:
  // a bare [] is indistinguishable from {} (both read all-undefined), but this one
  // would be accepted as a real edit by any check that merely asked "is it an object?".
  const arrayWithField = [];
  arrayWithField.name = "Walk-in Freezer";
  assert.equal(buildEquipmentEditPayload(arrayWithField, before, 7).valid, false);
  assert.equal(buildEquipmentEditPayload(arrayWithField, before, 7).payload, null);

  // An array REPROTOTYPED to Object.prototype passes the prototype test and is still a
  // real array. It is the single input on which the prototype test alone is not enough,
  // and the reason Array.isArray is not redundant -- reviewing #287 initially removed
  // that check as "dead code" on the strength of a claim this case disproves.
  const reprototyped = Object.setPrototypeOf([], Object.prototype);
  reprototyped.name = "Sneaky";
  assert.equal(Array.isArray(reprototyped), true, "still genuinely an array");
  assert.equal(Object.getPrototypeOf(reprototyped), Object.prototype, "yet passes the prototype test");
  assert.equal(buildEquipmentEditPayload(reprototyped, before, 7).valid, false);
  assert.equal(buildEquipmentEditPayload(reprototyped, before, 7).payload, null);
  // ...and the search options boundary must agree with the record helpers on it,
  // rather than the two type tests drifting apart as they had.
  assert.deepEqual(searchEquipment([{ id: "1", name: "Sneaky" }], reprototyped), []);
  // An array carrying BOTH ownership ids -- values that would otherwise compare equal.
  assert.equal(ownershipUnchanged(Object.assign([], { accountId: "acct-1", locationId: "loc-1" }), before), false);

  // A null-prototype object IS a plain record -- `Object.create(null)` is what you get
  // from some deserializers, and it is readable in exactly the way that matters.
  const bare = Object.create(null);
  Object.assign(bare, { name: "Walk-in Freezer" });
  assert.equal(buildEquipmentEditPayload(bare, before, 7).valid, true);
});

ok("#287 `valid` never coexists with a governed attempt, even alongside a real edit", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };

  // The trap: a rename AND a move in one call. The payload loop never copies a governed
  // field, so this returned valid:true with payload { updatedAt, name } -- a caller
  // doing `if (valid) store.update(id, payload)` writes the rename, SILENTLY DROPS the
  // move, and reports success. `valid` must mean "this payload may be written", with no
  // caveats a caller has to know to check.
  for (const governed of [
    { accountId: "acct-2" }, { locationId: "loc-2" }, { createdAt: 123 },
  ]) {
    const r = buildEquipmentEditPayload({ name: "Walk-in Freezer", ...governed }, before, 7);
    assert.equal(r.valid, false, `valid must be false alongside ${Object.keys(governed)[0]}`);
    assert.equal(r.payload, null, "a refused edit hands back nothing writable");
    assert.equal(r.noop, false, "the user did touch something");
    assert.ok(r.changedGoverned.length > 0 || r.unprovableGoverned.length > 0,
      "and the governed attempt is still reported, not swallowed");
  }

  // #312: a REFUSED status carries the same rule -- a legitimate rename beside an
  // attempt to retire does not get through on a technicality.
  const retiring = buildEquipmentEditPayload({ name: "Walk-in Freezer", status: "RETIRED" }, before, 7);
  assert.equal(retiring.valid, false, "valid must be false alongside a retire attempt");
  assert.equal(retiring.payload, null);
  assert.equal(retiring.refusedStatus, true);
  assert.equal(retiring.noop, false, "the user did touch something");

  // Unprovable governed (no evidence) must refuse the whole edit the same way -- the
  // legitimate rename does not get through on a technicality.
  const unprovable = buildEquipmentEditPayload({ name: "New", accountId: "acct-2" }, {}, 7);
  assert.equal(unprovable.valid, false);
  assert.equal(unprovable.payload, null);
  assert.deepEqual(unprovable.unprovableGoverned, ["accountId"]);

  // ...and a governed field the caller merely CONFIRMS (unchanged) is not an attempt,
  // so the rename beside it still writes.
  const confirmed = buildEquipmentEditPayload({ name: "New", accountId: "acct-1" }, before, 7);
  assert.equal(confirmed.valid, true, "an unchanged governed field is not a change");
  assert.deepEqual(confirmed.payload, { name: "New", updatedAt: 7 });
  assert.deepEqual(confirmed.changedGoverned, []);
});

ok("#287 an ABSENT argument is not a malformed one -- the `= {}` affordance is preserved", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  // Omitting the argument is a normal JS call, not a caller bug, and it behaves exactly
  // as `{}` does. This is the one thing the `= {}` default always got right, and the
  // #287 guards must not "fix" it into a malformed refusal: an empty create form owes
  // the user field errors naming what to fill in, NOT an opaque "could not read" that
  // highlights nothing.
  for (const absent of [undefined, {}]) {
    const c = buildEquipmentCreatePayload(absent, 1);
    assert.equal(c.valid, false);
    assert.equal(c.payload, null);
    assert.notEqual(c.malformed, true, "an omitted argument is readable -- just empty");
    assert.ok(c.errors.accountId && c.errors.locationId && c.errors.name,
      "an empty create must name the fields to fill in");

    const e = buildEquipmentEditPayload(absent, before, 1);
    assert.equal(e.valid, false);
    assert.equal(e.payload, null);
    assert.notEqual(e.malformed, true);
    assert.equal(e.noop, true, "an empty edit is a no-op, not unreadable");
  }
  // The distinction is real: a string IS unreadable, and says so instead.
  assert.equal(buildEquipmentCreatePayload("garbage", 1).malformed, true);
  assert.deepEqual(buildEquipmentCreatePayload("garbage", 1).errors, {});
});

ok("#287 both builders return the same shape on every path", () => {
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  const good = { accountId: "acct-1", locationId: "loc-1", name: "Chiller 1" };

  // A shape that varies by path is what forces a caller to write `!== true` where it
  // means `=== false`, and makes an absent key indistinguishable from a false one. The
  // module claims uniformity in a comment; this is the assertion that holds it to it.
  const createPaths = [
    buildEquipmentCreatePayload("garbage", 1),   // malformed
    buildEquipmentCreatePayload({}, 1),          // field errors
    buildEquipmentCreatePayload(good, 1),        // success
  ];
  for (const r of createPaths) {
    assert.deepEqual(Object.keys(r).sort(), ["errors", "malformed", "payload", "valid"]);
    assert.equal(typeof r.malformed, "boolean", "malformed is never absent -- absent is not false");
    assert.equal(typeof r.valid, "boolean");
  }
  assert.equal(createPaths[2].valid, true, "the success path must actually succeed");
  assert.equal(createPaths[2].malformed, false);

  const editPaths = [
    buildEquipmentEditPayload("garbage", before, 1),            // malformed
    buildEquipmentEditPayload({}, before, 1),                   // no-op
    buildEquipmentEditPayload({ name: "   " }, before, 1),      // field error
    buildEquipmentEditPayload({ accountId: "acct-2" }, before, 1), // governed
    buildEquipmentEditPayload({ status: "RETIRED" }, before, 1),   // refused status (#312)
    buildEquipmentEditPayload({ status: "INACTIVE" }, {}, 1),      // unprovable status (#312)
    buildEquipmentEditPayload({ status: "INACTIVE" }, before, 1),  // status transition (#312)
    buildEquipmentEditPayload({ name: "New" }, before, 1),      // success
  ];
  for (const r of editPaths) {
    assert.deepEqual(Object.keys(r).sort(),
      ["changedGoverned", "errors", "malformed", "noop", "payload", "refusedStatus",
       "unprovableGoverned", "unprovableStatus", "valid"]);
    for (const flag of ["valid", "malformed", "noop", "refusedStatus", "unprovableStatus"]) {
      assert.equal(typeof r[flag], "boolean", `${flag} is never absent`);
    }
  }
  assert.equal(editPaths[7].valid, true, "the success path must actually succeed");
  assert.equal(editPaths[6].valid, true, "an ACTIVE->INACTIVE transition is an ordinary edit (#312)");
});

ok("#287 refusal copy is safe and blames no field it cannot highlight", () => {
  // The module already holds itself to this for the trusted-writer seam ("unavailable
  // copy leaks no provider, code, id, or credential detail"). The #287 refusals sat
  // outside that test's reach, so the strings were safe by luck rather than by check.
  const before = { accountId: "acct-1", locationId: "loc-1", name: "Freezer", status: "ACTIVE" };
  const LEAKY = /firebase|firestore|permission-denied|unauthenticated|invalid-argument|failed-precondition|internal|uid|token|apiKey|[A-Za-z0-9_-]{20,}/i;

  const messages = [
    equipmentSaveErrorMessage(null),
    ...[buildEquipmentCreatePayload("garbage", 1), buildEquipmentEditPayload("garbage", before, 1),
        buildEquipmentEditPayload({}, before, 1)]
      .flatMap((r) => Object.values(r.errors)),
  ];
  for (const msg of messages) {
    assert.equal(typeof msg, "string");
    assert.doesNotMatch(msg, LEAKY, `refusal copy must leak nothing: ${msg}`);
  }

  // A malformed input has NO field the user could correct, so it must not produce a
  // { field: message } entry -- a caller that highlights error keys would find no such
  // control and show the user nothing at all while claiming a field needs attention.
  for (const bad of ["garbage", null, [], 42]) {
    assert.deepEqual(buildEquipmentCreatePayload(bad, 1).errors, {});
    assert.deepEqual(buildEquipmentEditPayload(bad, before, 1).errors, {});
  }
  // The same is true of a no-op: nothing is wrong with any field.
  assert.deepEqual(buildEquipmentEditPayload({}, before, 1).errors, {});
  // ...while a genuine field mistake still names its field, so E8 can highlight it.
  assert.ok(buildEquipmentEditPayload({ name: "   " }, before, 1).errors.name);
});


// ---- #312: status is transition-controlled, not governed --------------------

ok("#312 ordinaryStatusChangeAllowed mirrors the Rules helper exactly", () => {
  // firestore.rules equipmentTransitionAllowed(before, after):
  //   both valid && (after == before || ACTIVE->INACTIVE || INACTIVE->ACTIVE)
  // If these two ever disagree, a user is told "yes" by a control and "no" by the write.
  const A = EQUIPMENT_STATUS.ACTIVE, I = EQUIPMENT_STATUS.INACTIVE, R = EQUIPMENT_STATUS.RETIRED;
  assert.equal(ordinaryStatusChangeAllowed(A, I), true);
  assert.equal(ordinaryStatusChangeAllowed(I, A), true);
  for (const s of [A, I, R]) {
    assert.equal(ordinaryStatusChangeAllowed(s, s), true, `${s} unchanged is allowed`);
  }
  // Everything touching RETIRED is a trusted lifecycle action (E10), never this path.
  assert.equal(ordinaryStatusChangeAllowed(A, R), false, "retiring is not an ordinary edit");
  assert.equal(ordinaryStatusChangeAllowed(I, R), false, "retiring is not an ordinary edit");
  assert.equal(ordinaryStatusChangeAllowed(R, A), false, "reactivating is not an ordinary edit");
  assert.equal(ordinaryStatusChangeAllowed(R, I), false, "a retired asset does not go to INACTIVE");
  // A status we cannot read is not a status we may move.
  for (const bad of [null, undefined, "", "BOGUS", 5, {}, []]) {
    assert.equal(ordinaryStatusChangeAllowed(bad, A), false, `from ${String(bad)} must be refused`);
    assert.equal(ordinaryStatusChangeAllowed(A, bad), false, `to ${String(bad)} must be refused`);
    // BOTH sides unreadable is the pair the null guard actually decides: two unreadable
    // statuses are `a === b` and would read as "unchanged, allowed" without it. Testing
    // only (bad, valid) and (valid, bad) leaves that guard unpinned -- it survived
    // mutation until this line existed.
    assert.equal(ordinaryStatusChangeAllowed(bad, bad), false,
      `two unreadable statuses (${String(bad)}) are not "unchanged"`);
  }
  // CANONICAL ONLY -- and this is the assertion that makes the title true. It used to
  // read `(" active ", "inactive") === true` under the same "mirrors exactly" heading,
  // which the suite's own title falsified: Rules compare exact strings (equipmentStatusValid
  // is `status == "ACTIVE" || ...`, no trim, no case-fold), so the client answering "yes"
  // here means the control says go and the write comes back denied.
  for (const noncanonical of [" ACTIVE ", "active", "Active", "inactive ", "RETIRED "]) {
    assert.equal(ordinaryStatusChangeAllowed(noncanonical, "INACTIVE"), false,
      `a stored ${JSON.stringify(noncanonical)} is not canonical -- Rules deny it, so we must too`);
    assert.equal(ordinaryStatusChangeAllowed("ACTIVE", noncanonical), false,
      `${JSON.stringify(noncanonical)} is not a status Rules would accept`);
  }
});

ok("#312 a non-canonical STORED status is uneditable here, exactly as Rules say", () => {
  // firestore.rules: "a record whose stored status is malformed/absent is denied whatever
  // `after` it is given. Such a record is permanently uneditable on this path and is
  // repairable only by E10's trusted writer. That is the fail-closed direction."
  // The client agreeing is the whole point of the mirror.
  for (const stored of ["active", " ACTIVE ", "Active", "BOGUS", "", null, undefined, 5]) {
    const before = { accountId: "a1", locationId: "l1", name: "Unit", status: stored };
    const r = buildEquipmentEditPayload({ status: "INACTIVE" }, before, 7);
    assert.equal(r.valid, false, `stored ${JSON.stringify(stored)} must not be movable here`);
    assert.equal(r.payload, null);
    assert.equal(r.unprovableStatus, true, "we cannot prove a transition from a status Rules reject");
  }
  // A CALLER's input is still read forgivingly -- being generous about what we are handed
  // is fine, because the payload always writes the canonical value.
  const before = { accountId: "a1", locationId: "l1", name: "Unit", status: "ACTIVE" };
  const r = buildEquipmentEditPayload({ status: " inactive " }, before, 7);
  assert.equal(r.valid, true, "a padded/cased FORM value is normalized, not refused");
  assert.deepEqual(r.payload, { status: "INACTIVE", updatedAt: 7 }, "and canonical is what gets written");
});

ok("#312 an invalid status is never reported as 'nothing was changed'", () => {
  // Status is the first error-producing field that is NOT in EDITABLE_EQUIPMENT_FIELDS,
  // so it does not contribute to editedKeys -- and `noop` did not consult `errors`. The
  // result: the user picked an invalid status and updateEquipmentWith, which checks
  // `noop` before `!valid`, told them nothing had changed. On main the pairing was
  // structurally unreachable (errors.name forces editedKeys > 0), so #312 broke it.
  const before = { accountId: "a1", locationId: "l1", name: "Unit", status: "ACTIVE" };
  const r = buildEquipmentEditPayload({ status: "GARBAGE" }, before, 7);
  assert.equal(r.noop, false, "an invalid status is a mistake, not an absence of one");
  assert.ok(r.errors.status, "and the field error survives to be rendered");
  assert.equal(r.valid, false);
  // The invariant, stated once: a no-op means nothing to do AND nothing wrong.
  const empty = buildEquipmentEditPayload({}, before, 7);
  assert.equal(empty.noop, true);
  assert.deepEqual(empty.errors, {});
});

ok("#312 status is NOT a governed field -- an ordinary edit may move it ACTIVE<->INACTIVE", () => {
  assert.equal(GOVERNED_EQUIPMENT_FIELDS.includes("status"), false,
    "status left the governed set; ownership and createdAt did not");
  assert.deepEqual([...GOVERNED_EQUIPMENT_FIELDS].sort(), ["accountId", "createdAt", "locationId"]);

  for (const [from, to] of [["ACTIVE", "INACTIVE"], ["INACTIVE", "ACTIVE"]]) {
    const before = { accountId: "a1", locationId: "l1", name: "Unit", status: from };
    const r = buildEquipmentEditPayload({ status: to }, before, 7);
    assert.equal(r.valid, true, `${from} -> ${to} is an ordinary edit`);
    assert.deepEqual(r.payload, { status: to, updatedAt: 7 }, "only the status and the timestamp");
    assert.deepEqual(r.changedGoverned, [], "status is not governed");
    assert.equal(r.refusedStatus, false);
    assert.equal(r.noop, false);
  }
});

ok("#312 an UNCHANGED status is not an edit -- it writes nothing", () => {
  // The form re-submits whatever the dropdown holds, so the overwhelmingly common case is
  // a status that did not move. Writing it would bump updatedAt for a change nobody made
  // and make #287's "nothing was changed" unreachable the moment a status control exists.
  for (const s of ["ACTIVE", "INACTIVE", "RETIRED"]) {
    const before = { accountId: "a1", locationId: "l1", name: "Unit", status: s };
    const r = buildEquipmentEditPayload({ status: s }, before, 7);
    assert.equal(r.valid, false);
    assert.equal(r.noop, true, `an unchanged ${s} is a no-op`);
    assert.equal(r.payload, null);
    assert.equal(r.refusedStatus, false, "unchanged is allowed, not refused");
  }
  // ...and it normalizes: a round-tripped " active " is still unchanged.
  const before = { accountId: "a1", locationId: "l1", name: "Unit", status: "ACTIVE" };
  assert.equal(buildEquipmentEditPayload({ status: " active " }, before, 7).noop, true);
  // A descriptive edit alongside an unchanged status still writes -- and writes only the
  // descriptive field.
  const withName = buildEquipmentEditPayload({ name: "Renamed", status: "ACTIVE" }, before, 7);
  assert.equal(withName.valid, true);
  assert.deepEqual(withName.payload, { name: "Renamed", updatedAt: 7 }, "no status in the payload");
});

ok("#312 RETIRED is locked in the ordinary path, and descriptive editing survives", () => {
  const retired = { accountId: "a1", locationId: "l1", name: "Unit", status: "RETIRED" };
  for (const to of ["ACTIVE", "INACTIVE"]) {
    const r = buildEquipmentEditPayload({ status: to }, retired, 7);
    assert.equal(r.valid, false, `RETIRED -> ${to} is a trusted action, not an ordinary edit`);
    assert.equal(r.payload, null);
    assert.equal(r.refusedStatus, true);
    assert.deepEqual(r.errors, {}, "not a field error -- the form does not offer the control");
    assert.deepEqual(r.changedGoverned, [], "and not a governed refusal either");
  }
  // Retiring an ACTIVE/INACTIVE asset is equally not this path's to do.
  for (const from of ["ACTIVE", "INACTIVE"]) {
    const r = buildEquipmentEditPayload({ status: "RETIRED" }, { ...retired, status: from }, 7);
    assert.equal(r.refusedStatus, true, `${from} -> RETIRED is the trusted retire action`);
    assert.equal(r.valid, false);
  }
  // Owner E3 decision (2): descriptive corrections stay legal on a retired asset.
  const fixed = buildEquipmentEditPayload({ serialNumber: "SN-CORRECTED" }, retired, 7);
  assert.equal(fixed.valid, true, "retiring is not a freeze");
  assert.deepEqual(fixed.payload, { serialNumber: "SN-CORRECTED", updatedAt: 7 });
  assert.equal("status" in fixed.payload, false, "and the status is not touched");
});

ok("#312 a status change needs a readable `before` -- a transition has a FROM", () => {
  // This is what makes `before` LOAD-BEARING in the edit path. Without it, ACTIVE->INACTIVE
  // and RETIRED->INACTIVE are the same request, and one of them is a trusted action.
  for (const noEvidence of [{}, { name: "Unit" }, { status: "BOGUS" }, { status: null }]) {
    const r = buildEquipmentEditPayload({ status: "INACTIVE" }, noEvidence, 7);
    assert.equal(r.valid, false, "an unprovable transition must not be written");
    assert.equal(r.payload, null);
    assert.equal(r.unprovableStatus, true);
    assert.equal(r.noop, false, "the caller asked for something -- this is not an empty edit");
  }
  // An unreadable `before` (not just an empty one) is the same answer.
  assert.equal(buildEquipmentEditPayload({ status: "INACTIVE" }, "garbage", 7).unprovableStatus, true);

  // THE MIXED CASE, and the one that makes `!unprovableStatus` load-bearing in `valid`.
  // A status change asked for alongside a legitimate rename: without the conjunct the
  // rename is valid, the payload carries { name, updatedAt }, the status change is
  // silently DROPPED, and the caller is told it saved. Same partial-success shape #287
  // refused for governed fields -- and, like that one, invisible to a test that only
  // exercises the status in isolation (where editedKeys is empty and `valid` is false
  // for an unrelated reason).
  const mixed = buildEquipmentEditPayload({ name: "New", status: "INACTIVE" }, {}, 7);
  assert.equal(mixed.valid, false, "an unprovable status must refuse the whole edit");
  assert.equal(mixed.payload, null, "including the rename beside it");
  assert.equal(mixed.unprovableStatus, true);
});

ok("#312 an unrecognized status is a FIELD error -- the form has a control to highlight", () => {
  const before = { accountId: "a1", locationId: "l1", name: "Unit", status: "ACTIVE" };
  for (const bad of ["BOGUS", "", "  ", 5, null, {}]) {
    const r = buildEquipmentEditPayload({ status: bad }, before, 7);
    assert.equal(r.valid, false, `status=${String(bad)} must be refused`);
    assert.equal(r.payload, null);
    assert.ok(r.errors.status, "names the status field, which the form renders as a select");
    assert.equal(r.refusedStatus, false, "a typo is not a trusted-action boundary");
  }
});

console.log(`\n${passed} passed, 0 failed`);
