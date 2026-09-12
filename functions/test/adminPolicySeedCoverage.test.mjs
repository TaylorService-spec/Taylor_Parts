// THE POLICY SEED COVERAGE LEDGER — its proofs.
//
// ════════════════════ WHAT THIS EXISTS TO STOP ════════════════════
//
// A silent omission. The first version of this seed derived its objects from the CRUD matrix alone,
// and THIRTEEN entities carrying 166 fields -- Supplier, Warehouse, Truck, Reorder Request, Sales
// Agreement and eight more -- reached neither the policy model nor the Administration grid. Nothing
// failed. No count looked wrong, because nobody was comparing the two lists.
//
// So the ledger accounts for EVERY source entity and EVERY source field as SEEDED or EXCLUDED with
// a bounded reason, and these tests hold it to that. A future metadata field cannot enter the
// registry and quietly miss the policy model: it would be unaccounted for, and that fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import ledger from "../src/adminPolicy/seed/policySeedCoverage.json" with { type: "json" };
import snapshot from "../src/adminPolicy/seed/policySeedSnapshot.json" with { type: "json" };

// ============================ the reconciliation ============================

test("every source entity is SEEDED or EXCLUDED with a reason — nothing unaccounted for", () => {
  assert.equal(ledger.entities.length, ledger.source.entities, "the ledger covers every entity");
  for (const entity of ledger.entities) {
    assert.ok(
      entity.status === "SEEDED" || entity.status === "EXCLUDED",
      `${entity.entityId} has no status`,
    );
    if (entity.status === "EXCLUDED") {
      assert.ok(
        ledger.allowedExclusionReasons.includes(entity.exclusionReason),
        `${entity.entityId} is excluded for "${entity.exclusionReason}", which is not a permitted reason`,
      );
    }
  }
});

test("every source FIELD is SEEDED or EXCLUDED with a reason", () => {
  let counted = 0;
  for (const entity of ledger.entities) {
    assert.equal(entity.fields.length, entity.declaredFields, `${entity.entityId}: every field listed`);
    for (const field of entity.fields) {
      counted += 1;
      assert.ok(
        field.status === "SEEDED" || field.status === "EXCLUDED",
        `${entity.entityId}.${field.key} has no status`,
      );
      if (field.status === "EXCLUDED") {
        assert.ok(
          ledger.allowedExclusionReasons.includes(field.exclusionReason),
          `${entity.entityId}.${field.key} excluded for "${field.exclusionReason}", not a permitted reason`,
        );
      }
    }
  }
  assert.equal(counted, ledger.source.fields, "the ledger covers every field");
});

test("the reconciliation adds up: 29 entities and 395 fields, all seeded", () => {
  // The numbers the Owner asked to see reconciled, pinned so a change to either side is a
  // deliberate edit here rather than a drift nobody notices.
  //
  // 394 -> 395 at the W1 integration: PR 1881 declared `payment.paymentId`. That lane updated the
  // field-census literal in field-ops-app-vite/test/entityRegistry.test.mjs and did not know this
  // SECOND copy of the same census existed on the functions side, so the two disagreed the moment
  // the branches met. The delta is additive and there was exactly one of them; had several lanes
  // each declared a field, the deltas would SUM here rather than one lane's number winning.
  assert.equal(ledger.source.entities, 29);
  assert.equal(ledger.source.fields, 395);

  assert.equal(ledger.seeded.entities, 29, "every entity became an object");
  assert.equal(ledger.seeded.fields, 395, "every field was seeded");
  assert.equal(ledger.excluded.entities, 0);
  assert.equal(ledger.excluded.fields, 0);

  // 37 objects = 29 entity-backed + 8 the CRUD matrix names with no EntityDefinition behind them.
  assert.equal(ledger.seeded.objects, 37);
  assert.equal(ledger.seeded.objectsWithoutAnEntity, 8);
  assert.equal(
    ledger.seeded.entities + ledger.seeded.objectsWithoutAnEntity,
    ledger.seeded.objects,
    "objects are entity-backed ones plus matrix-only ones, with no third category",
  );
});

test("every exclusion reason is counted, and today every count is zero", () => {
  for (const reason of ledger.allowedExclusionReasons) {
    assert.ok(reason in ledger.excluded.fieldsByReason, `${reason} is not counted`);
    assert.equal(ledger.excluded.fieldsByReason[reason], 0, `${reason} should have no members yet`);
  }
});

test("the exclusion vocabulary is BOUNDED — a new reason cannot be invented in passing", () => {
  assert.deepEqual([...ledger.allowedExclusionReasons].sort(), [
    "ALIAS_DUPLICATE",
    "DERIVED_DISPLAY_ONLY",
    "LEGACY_RETIRED",
    "NON_GOVERNABLE_SYSTEM_FIELD",
    "NON_PERSISTED",
    "TECHNICAL_INTERNAL",
  ]);
});

// ============================ ledger vs snapshot ============================

test("the ledger and the snapshot agree about what was seeded", () => {
  // Two artifacts from one generator. If they could disagree, the ledger would be describing a seed
  // that does not exist -- which is worse than having no ledger, because it would be believed.
  assert.equal(snapshot.counts.objects, ledger.seeded.objects);
  assert.equal(snapshot.counts.fields, ledger.seeded.fields);

  const snapshotKeys = new Set(snapshot.objects.map((o) => o.key));
  for (const entity of ledger.entities) {
    if (entity.status !== "SEEDED") continue;
    assert.ok(snapshotKeys.has(entity.objectKey), `${entity.entityId} is in the ledger but not the snapshot`);
  }
});

test("every seeded field appears in the snapshot object it was attributed to", () => {
  const fieldsByObject = new Map(snapshot.objects.map((o) => [o.key, new Set(o.fields.map((f) => f.key))]));
  for (const entity of ledger.entities) {
    if (entity.status !== "SEEDED") continue;
    const seeded = fieldsByObject.get(entity.objectKey);
    for (const field of entity.fields) {
      if (field.status !== "SEEDED") continue;
      assert.ok(seeded?.has(field.key), `${entity.entityId}.${field.key} claims SEEDED but is absent from the snapshot`);
    }
  }
});

test("the thirteen previously-missed entities are now seeded, by name", () => {
  // Named individually rather than counted, so a regression that dropped one would say WHICH.
  const MISSED = [
    "equipmentModel", "manufacturer", "mobileLocation", "partAlias", "purchaseOrderVoid",
    "reorderRequest", "salesAgreement", "salesTerritory", "stockLocation", "supplier",
    "supplierCatalogItem", "truck", "warehouse",
  ];
  const seeded = new Set(ledger.entities.filter((e) => e.status === "SEEDED").map((e) => e.entityId));
  for (const id of MISSED) assert.ok(seeded.has(id), `${id} must be seeded`);

  // TWELVE registry-only, not thirteen: the Owner ruling gave Reorder Request its own CRUD matrix
  // row, so it is now MATRIX_AND_REGISTRY like any other first-class object. Its arrival in the
  // matrix is the ruling landing, not coverage being lost -- it is still seeded, which the loop
  // above asserts by name.
  const registryOnly = snapshot.objects.filter((o) => o.source === "REGISTRY_ONLY").map((o) => o.key).sort();
  assert.deepEqual(registryOnly, MISSED.filter((id) => id !== "reorderRequest").sort());
  assert.equal(
    snapshot.objects.find((o) => o.key === "reorderRequest").source, "MATRIX_AND_REGISTRY",
    "Reorder Request has a row of its own now",
  );
});

// ============================ D-2, at the object level ============================

test("an object no capability governs is SEEDED, with every verb ungrantable", () => {
  // The honest state for Supplier, Truck and the rest: the object exists and an administrator sees
  // it, and nothing can be granted on it until a capability names it. Seeding it with a fabricated
  // grant, or omitting it, would both be worse.
  const supplier = snapshot.objects.find((o) => o.key === "supplier");
  assert.ok(supplier, "supplier is seeded");
  for (const verb of ["C", "R", "E", "D"]) {
    assert.deepEqual(supplier.capabilitiesByVerb[verb], [], `${verb} is ungoverned`);
  }
});

test("the capability gaps that WERE fillable are filled", () => {
  // warehouse.record.read, warehouse.stockLocation.read and the four salesAgreement.* ids exist in
  // the catalog and the matrix claims none of them. Mapping them is a coverage fix, not a policy
  // decision.
  assert.deepEqual([...ledger.capabilityGapsFilled].sort(), ["salesAgreement", "stockLocation", "warehouse"]);

  const warehouse = snapshot.objects.find((o) => o.key === "warehouse");
  assert.deepEqual(warehouse.capabilitiesByVerb.R, ["warehouse.record.read"]);

  const agreement = snapshot.objects.find((o) => o.key === "salesAgreement");
  assert.deepEqual(agreement.capabilitiesByVerb.C, ["salesAgreement.create"]);
  assert.deepEqual(agreement.capabilitiesByVerb.E, ["salesAgreement.updateDraft", "salesAgreement.accept"]);
});

test("REORDER REQUEST owns its own data authority — the Owner decision, CLOSED", () => {
  // WAS: the twelve reorder.request.* ids all sat under the "Purchase Orders" matrix row, so this
  // object was seeded with every verb ungrantable and the ownership question was left open.
  //
  // NOW (Owner ruling, 2026-09-08): Reorder Request and Purchase Order are separate canonical
  // Objects. Reorder Request owns the reorder request DATA authority; the transitions are Parts /
  // Purchasing WORKFLOW actions and appear in no CRED row at all -- which is why Edit is still
  // empty here, and why that emptiness now means something different from before.
  const reorder = snapshot.objects.find((o) => o.key === "reorderRequest");
  assert.ok(reorder);
  assert.deepEqual(reorder.capabilitiesByVerb.C, ["reorder.request.create.manual", "reorder.request.create.system"]);
  assert.deepEqual(reorder.capabilitiesByVerb.R, ["reorder.request.read.queue", "reorder.request.read.own"]);
  assert.deepEqual(reorder.capabilitiesByVerb.E, [], "every edit-shaped reorder capability is a workflow action");
  assert.deepEqual(reorder.capabilitiesByVerb.D, []);

  // And the purchase order keeps only its own.
  const purchaseOrder = snapshot.objects.find((o) => o.key === "purchaseOrder");
  assert.deepEqual(purchaseOrder.capabilitiesByVerb.R, ["reorder.purchaseOrder.read"]);
  assert.equal(
    purchaseOrder.capabilitiesByVerb.R.some((id) => id.startsWith("reorder.request.")), false,
    "no reorder request authority survives on the purchase order",
  );
});

// ============================ drift ============================

test("DRIFT: the committed artifacts match the generator", () => {
  // The guard that makes all of the above mean something. A metadata field added tomorrow and not
  // re-snapshotted fails HERE, rather than silently missing the policy model.
  execFileSync(process.execPath, ["scripts/buildAdminPolicySeedSnapshot.mjs", "--check"], {
    cwd: "..",
    stdio: "pipe",
  });
});
