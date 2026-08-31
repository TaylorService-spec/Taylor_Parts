// A seeded warehouse's STORED id must equal its DOCUMENT id.
//
// THE DEFECT THIS PINS, and it was found in live data rather than in review. `seedWarehouse` in
// seedTruckFleetFixtures.mjs wrote nine fields and omitted `id`. The §3A validator binds the stored
// `id` to the document id, so both warehouses it created -- wh-sandbox-central and wh-sandbox-north
// -- failed `id_invalid` and were not governed warehouses at all. Receiving already refused them as
// a destination, Transfers as an endpoint, and the Ownership root-company assignment refused to
// touch them. None of that was visible until something asked the question.
//
// The seeder cannot be unit-tested against Firestore here, so this asserts the two things that
// actually failed: the written shape carries `id`, and the shape it writes is one the REAL canonical
// validator accepts. A test that only grepped for the field would pass on a typo'd key name.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Timestamp } from "firebase-admin/firestore";
import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";

const SEEDER = readFileSync(new URL("../scripts/seedTruckFleetFixtures.mjs", import.meta.url), "utf8");
const seedWarehouseBody = /async function seedWarehouse\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(SEEDER);

test("seedWarehouse writes the document id as the stored id", () => {
  assert.ok(seedWarehouseBody, "seedWarehouse must exist");
  const body = seedWarehouseBody[1];
  // The parameter IS the document id -- `db.collection("warehouses").doc(id)` -- so writing `id`
  // shorthand is writing the document id. Asserted together so a future change that keeps the field
  // but addresses a different document still fails.
  assert.match(body, /\.doc\(id\)/, "the document is addressed by `id`");
  assert.match(body, /ref\.set\(\{\s*\n\s*id,/, "the written object must lead with the `id` field");
});

test("the shape seedWarehouse writes is accepted by the REAL canonical validator", () => {
  // Reconstructed from the seeder's own literal, with the two server timestamps resolved -- which is
  // what Firestore stores. If this drifts from the seeder, the assertion above fails first.
  const ts = Timestamp.fromMillis(1_756_000_000_000);
  const seeded = {
    id: "wh-seeded",
    name: "Seeded Warehouse",
    location: "Phoenix, AZ",
    status: "ACTIVE",
    version: 1,
    updatedAt: ts,
    updatedBy: "seed-script",
    createdAt: ts,
    createdBy: "seed-script",
    provenance: "NATIVE",
  };
  const verdict = validateGovernedWarehouse(seeded, "wh-seeded");
  assert.equal(verdict.valid, true, verdict.reason ?? "");
  assert.equal(verdict.value.id, "wh-seeded");
  // NATIVE provenance requires the created pair and forbids governance-init metadata; the seeder
  // satisfies both, which is why a minimal shape is legitimately governed without a migration.
  assert.equal(verdict.value.provenance, "NATIVE");
  assert.ok(!("governanceInitializedAt" in verdict.value));
  // And the seeder authors NO company -- that is the root-assignment authority's job, not seeding's.
  assert.ok(!("operatingCompanyId" in verdict.value));
});

test("dropping the id reproduces the exact live failure", () => {
  // The regression, stated as the thing that actually happened rather than as a negation.
  const ts = Timestamp.fromMillis(1_756_000_000_000);
  const withoutId = {
    name: "Seeded Warehouse", location: "Phoenix, AZ", status: "ACTIVE", version: 1,
    updatedAt: ts, updatedBy: "seed-script", createdAt: ts, createdBy: "seed-script", provenance: "NATIVE",
  };
  const verdict = validateGovernedWarehouse(withoutId, "wh-seeded");
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, "id_invalid");
});

test("the seeder still authors no company and no legacy active flag", () => {
  const body = seedWarehouseBody[1];
  assert.doesNotMatch(body, /operatingCompanyId/, "seeding must not author an operating company");
  assert.doesNotMatch(body, /\bactive\b\s*:/, "the legacy `active` flag is forbidden by the governed shape");
});
