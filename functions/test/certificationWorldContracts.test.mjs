// THE WORLD MUST CONFORM TO THE DOMAIN, AND MUST BE VISIBLE TO THE QUERIES THAT LIST IT.
//
// ============================ TWO DEFECTS, TWO GUARDS ============================
//
// 1. INVALID ENUM. Five customers were seeded with `status: "DORMANT"`. That is not a customer
//    status -- the canonical set is ACTIVE/INACTIVE/PROSPECT/ARCHIVED. The portfolio summary
//    refused to bucket them (correctly; it never invents a status a record does not have), so the
//    Customers screen reported that its own categories did not add up. The UI was right and the
//    fixture was wrong, and nothing in the repository compared the two.
//
// 2. QUERY INVISIBILITY. Firestore's `orderBy` FILTERS: a document missing the ordered field is
//    silently excluded, with no error. The Customers list sorts `updatedAt DESC` and the seeder
//    wrote no timestamps, so 101 of 103 customers were absent from their own list while the
//    portfolio header -- an unsorted read -- still counted all 103.
//
// The second is the harder idea and the reason this file is not just an enum check: a field the
// SCHEMA treats as optional can still be mandatory for a record to be VISIBLE. Optional schema does
// not imply optional query participation.
//
// ============================ WHY IT CANNOT DRIFT ============================
//
// The allowed values are not restated here or in domainContracts.mjs. They are imported from
// `field-ops-app-vite/src/domain/constants.js`, the domain layer itself. A fixture validator with
// its own copy of an enum is just a second place for DORMANT to be legal.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildWorld } = await import(L("functions/scripts/certificationWorld/build.mjs"));
const {
  validateWorldRecords, describeFinding, ENUM_FIELD_CONTRACTS, QUERY_REQUIRED_FIELDS,
  ACCOUNT_STATUS_VALUES, ACCOUNT_RELATIONSHIP_VALUES,
} = await import(L("functions/scripts/certificationWorld/domainContracts.mjs"));
const { stampedForWrite } = await import(L("functions/scripts/certificationWorld/seedWrite.mjs"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));

const world = buildWorld();
const allRecords = [
  ...world.accounts, ...world.locations, ...world.contacts,
  ...world.equipmentModels, ...world.trucks, ...world.employees,
];

test("the built world violates no canonical enum", () => {
  const findings = validateWorldRecords(allRecords);
  assert.deepEqual(findings.map(describeFinding), [], "the world contains values the domain does not define");
});

test("DORMANT specifically is gone, and INACTIVE took its place", () => {
  // Named explicitly rather than left to the general check: this is the regression, and a test that
  // only says "no findings" would not tell a future reader what was actually wrong here.
  const statuses = new Set(world.accounts.map((a) => a.data.status));
  assert.equal(statuses.has("DORMANT"), false, "DORMANT is not a customer status and must not be seeded");
  assert.ok(statuses.has(ACCOUNT_STATUS_VALUES.INACTIVE), "the dormant fixtures should now be INACTIVE");
  for (const s of statuses) {
    assert.ok(Object.values(ACCOUNT_STATUS_VALUES).includes(s), `${s} is not a canonical status`);
  }
});

test("MUTATION: an invalid enum value is caught, not shrugged off", () => {
  // A validator that cannot fail is decoration. This is the exact record that shipped.
  const poisoned = [{ collection: "accounts", id: "cw-acct-9999", data: { name: "Regression", status: "DORMANT", nameLower: "regression" } }];
  const findings = validateWorldRecords(poisoned);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "INVALID_ENUM_VALUE");
  assert.equal(findings[0].field, "status");
  assert.equal(findings[0].value, "DORMANT");
  assert.match(describeFinding(findings[0]), /is not one of ACTIVE\/INACTIVE\/PROSPECT\/ARCHIVED/);
});

test("MUTATION: an invalid RELATIONSHIP value is caught inside the array", () => {
  // The multi-valued case fails differently: the field is present and is an array, and only one
  // element is wrong. A check that only validated the field's presence would pass this.
  const poisoned = [{ collection: "accounts", id: "x", data: { name: "N", nameLower: "n", status: "ACTIVE", relationshipTypes: ["CUSTOMER", "PARTNER"] } }];
  const findings = validateWorldRecords(poisoned);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].value, "PARTNER");
});

test("an UNSET optional enum is not a finding -- the domain permits it", () => {
  // relationshipTypes is explicitly optional: an Account with no value renders no badge and must
  // never silently default to Customer. Flagging absence would push fixtures toward populating a
  // field the domain says may be empty, and would delete the only coverage of that state.
  const findings = validateWorldRecords([{ collection: "accounts", id: "x", data: { name: "N", nameLower: "n", status: "ACTIVE" } }]);
  assert.deepEqual(findings, []);
  const unset = world.accounts.filter((a) => a.data.relationshipTypes === undefined);
  assert.ok(unset.length > 0, "the world must retain records with relationship UNSET, to exercise that state");
});

test("the relationship fixtures are representative, not uniform", () => {
  // A world where every record is CUSTOMER cannot prove the Vendor filter works, and one where
  // every record is populated cannot prove the unset case is handled.
  const shape = (a) => {
    const r = a.data.relationshipTypes;
    if (!r) return "UNSET";
    const c = r.includes(ACCOUNT_RELATIONSHIP_VALUES.CUSTOMER), v = r.includes(ACCOUNT_RELATIONSHIP_VALUES.VENDOR);
    return c && v ? "BOTH" : c ? "CUSTOMER" : "VENDOR";
  };
  const tally = world.accounts.reduce((m, a) => { const k = shape(a); m[k] = (m[k] || 0) + 1; return m; }, {});
  for (const k of ["CUSTOMER", "VENDOR", "BOTH", "UNSET"]) {
    assert.ok(tally[k] > 0, `the world has no ${k} customers, so that filter arm cannot be verified (${JSON.stringify(tally)})`);
  }
});

// --- query participation -----------------------------------------------------

test("every customer carries the fields its list and search ORDER BY", () => {
  // The invisibility bug, stated as a property. `updatedAt` is stamped by the seeder at write time
  // rather than by the builder, so it is asserted on the SEEDED shape below.
  for (const a of world.accounts) {
    assert.equal(typeof a.data.name, "string", `${a.id} has no name to render`);
    assert.equal(typeof a.data.nameLower, "string", `${a.id} has no nameLower -- invisible to customer search`);
    assert.equal(a.data.nameLower, a.data.name.toLowerCase(), `${a.id}: nameLower must be the folded name`);
  }
});

test("the SEEDED shape carries every query-required field, including the stamped ones", () => {
  // Built record + seeder stamping = what actually lands in Firestore. Checking only the builder
  // would miss the timestamps; checking only the seeder would miss nameLower. The union is the
  // document a query will see.
  for (const [collection, fields] of Object.entries(QUERY_REQUIRED_FIELDS)) {
    const sample = allRecords.find((r) => r.collection === collection);
    assert.ok(sample, `no ${collection} record exists in the world to check`);
    const seeded = stampedForWrite(sample.data, () => "SERVER_TIMESTAMP");
    for (const f of fields) {
      assert.ok(
        seeded[f.field] !== undefined && seeded[f.field] !== null,
        `${collection}/${sample.id} would be seeded without ${f.field} -- invisible on ${f.surface} (${f.why})`,
      );
    }
  }
});

test("MUTATION: a record missing a query-required field is reported as invisible", () => {
  // Removing nameLower is exactly what the world looked like before this batch.
  const findings = validateWorldRecords([{ collection: "accounts", id: "cw-acct-0001", data: { name: "Novel Ice Cream", status: "ACTIVE" } }]);
  const invisible = findings.filter((f) => f.kind === "QUERY_INVISIBLE");
  assert.equal(invisible.length, 1);
  assert.equal(invisible[0].field, "nameLower");
  assert.match(describeFinding(invisible[0]), /invisible on \/customers search/);
});

test("the contracts are not vacuous -- both tables have real entries", () => {
  // An empty contract table passes every check above while asserting nothing. This is the guard on
  // the guard: the same failure as an allowlist that has quietly swallowed its own subject.
  assert.ok(ENUM_FIELD_CONTRACTS.accounts.length >= 2, "the enum contract table has been gutted");
  assert.ok(QUERY_REQUIRED_FIELDS.accounts.length >= 2, "the query-required table has been gutted");
  assert.ok(
    QUERY_REQUIRED_FIELDS.accounts.some((f) => f.field === "updatedAt"),
    "updatedAt must stay query-required: it is the field whose absence hid 101 of 103 customers",
  );
});

// --- group coverage ----------------------------------------------------------

test("EVERY collection buildWorld() produces is registered for seeding and verification", () => {
  // THE SILENT OMISSION. expectedRecords() flattens the world through a hand-written table of
  // groups. A collection the builder produces but the table omits is built, never seeded, never
  // verified -- and the sandbox reports COMPLETE while missing every record of it. That already
  // happened once with employees, which is why the table carries a warning comment.
  //
  // A comment is not a guard. This compares the two mechanically, so the next collection cannot
  // be added to the builder and quietly left out of the world.
  const arrays = Object.entries(world)
    .filter(([, v]) => Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "collection" in v[0])
    .map(([k]) => k);
  assert.ok(arrays.length >= 6, `buildWorld exposes only ${arrays.length} record groups -- this check is not reading the world`);

  const seededCollections = new Set(expectedRecords().records.map((r) => r.collection));
  const missing = [];
  for (const key of arrays) {
    const collection = world[key][0].collection;
    if (!seededCollections.has(collection)) missing.push(`${key} -> ${collection}`);
  }
  assert.deepEqual(missing, [],
    "These collections are BUILT but never seeded or verified. A sandbox missing every one of "
      + "them would still report COMPLETE. Register each in expectedRecords():\n  "
      + missing.join("\n  "));
});

test("the installed base is present, varied, and internally consistent", () => {
  // A fixture set of 278 identical units would satisfy a count check and test nothing.
  const eq = world.equipment;
  assert.ok(eq.length >= 200 && eq.length <= 300, `expected 200-300 equipment assets, got ${eq.length}`);

  const serials = new Set(eq.map((e) => e.data.serialNumber));
  assert.equal(serials.size, eq.length, "duplicate serial numbers");
  const ids = new Set(eq.map((e) => e.id));
  assert.equal(ids.size, eq.length, "duplicate equipment ids");

  // Every unit sits at a location its OWN account owns. Inventing a locationId would create the
  // dangling reference the world's invariant check exists to catch.
  const locationOwner = new Map(world.locations.map((l) => [l.id, l.data.accountId]));
  const dangling = eq.filter((e) => locationOwner.get(e.data.locationId) !== e.data.accountId);
  assert.deepEqual(dangling.map((e) => e.id), [], "equipment placed at a location its account does not own");

  // Both lines represented, or the Taylor/Ventana reporting separation cannot be measured.
  const lines = new Set(eq.map((e) => e.data.lineOfBusiness));
  assert.ok(lines.has("TAYLOR") && lines.has("VENTANA"), `only ${[...lines].join("/")} represented`);

  // Customers owning NOTHING must exist: the empty state is a real state, and a world where
  // everyone owns something cannot prove it renders honestly.
  const owners = new Set(eq.map((e) => e.data.accountId));
  assert.ok(owners.size < world.accounts.length, "every customer owns equipment -- the empty state is untested");

  // Warranty is DERIVED from install date, so a unit can never be newer than its own warranty.
  for (const e of eq) {
    assert.ok(e.data.warrantyExpiresDate > e.data.installedDate,
      `${e.id} expires its warranty before it was installed`);
  }

  // A retired unit is an old one. A brand-new retired asset is a record contradicting itself.
  for (const e of eq.filter((x) => x.data.status === "RETIRED")) {
    assert.ok(e.data.certAgeMonths > 24, `${e.id} is RETIRED at ${e.data.certAgeMonths} months old`);
  }
});
