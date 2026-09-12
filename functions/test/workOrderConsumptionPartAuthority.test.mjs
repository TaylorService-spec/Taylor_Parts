// THE PART DECIDES HOW WORK ORDER USAGE IS COUNTED.
// Run: node --test test/workOrderConsumptionPartAuthority.test.mjs   (pure — no emulator, no Postgres)
//
// WHAT THIS PINS, AND WHY IT IS NOT A STYLE CHECK.
//
// Work Order usage capture used to answer "what tracking mode is this part?" twice, and neither
// answer came from the Part:
//
//   · the WRITE path hardcoded `const trackingMode = "NONE"` (planPhysicalConsumption.ts)
//   · the READ path took `trackingMode` off the callable REQUEST (consumptionSourceCallables.ts)
//
// `trackingMode` is not decoration. inventoryLedger/locationOnHand.ts skips every ledger row whose
// mode is not "NONE", and mobileLocationPresenceProbe.ts skips them because serialized custody is
// authoritative via serialized_assets. So a SERIALIZED part consumed on a Work Order posted a NONE
// row that WAS counted as quantity on-hand while serialized_assets still showed the unit where it
// had been — one physical unit, two authorities, disagreeing.
//
// These tests exercise the real planner against a fake Firestore, so they measure the DECISION, not
// the wording of the code that makes it. The last test is the only structural one, and it exists to
// stop the hardcode coming back under a different name.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "src", rel), "utf8");
/** Comments and string literals removed — a guard that fires on prose is a guard that gets deleted. */
const codeOnly = (rel) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');

const { planPhysicalConsumption } = await import("../lib/workOrderConsumption/planPhysicalConsumption.js");
// The READ lives with the workflow's other reads; the RULE is pure and imports no persistence.
const { readConsumptionTrackingModes } = await import("../lib/workOrderConsumption/consumptionSourceService.js");
const {
  consumptionTrackingModeFor,
  isQuantityTracked,
  WORK_ORDER_CONSUMPTION_TRACKING_MODE,
  PART_NOT_QUANTITY_TRACKED,
} = await import("../lib/workOrderConsumption/consumptionPartTracking.js");

// ══════════════════════════ a fake Firestore, only as deep as the reads go ══════════════════════════
const at = (row, path) => path.split(".").reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), row);

function fakeFirestore(data) {
  const query = (coll, filters) => ({
    __coll: coll,
    __filters: filters,
    where: (field, _op, value) => query(coll, [...filters, [field, value]]),
  });
  const db = {
    collection: (coll) => ({ ...query(coll, []), doc: (id) => ({ __coll: coll, __doc: id }) }),
  };
  const rows = (coll) => data[coll] ?? [];
  const resolve = (ref) => {
    if (ref.__doc !== undefined) {
      const row = rows(ref.__coll).find((r) => r.id === ref.__doc);
      return row
        ? { exists: true, id: row.id, data: () => ({ ...row }) }
        : { exists: false, id: ref.__doc, data: () => undefined };
    }
    const matched = rows(ref.__coll).filter((r) => ref.__filters.every(([field, value]) => at(r, field) === value));
    return { empty: matched.length === 0, docs: matched.map((r) => ({ id: r.id, data: () => ({ ...r }) })) };
  };
  const tx = { get: async (ref) => resolve(ref) };
  return { db, tx };
}

const WO = "wo-1";
const TECH = "tech-1";
const PART = "part-a";
const SKU = "SKU-A";
const WAREHOUSE = { id: "wh-1", status: "ACTIVE", name: "Main" };

const baseInput = (overrides = {}) => ({
  workOrderId: WO,
  actorId: TECH,
  technicianId: TECH,
  snapshot: [{ sku: SKU, partId: PART, qtyPlanned: 5, qtyUsed: 0 }],
  qtyUsedUpdates: [{ sku: SKU, delta: 2 }],
  consumptionSources: [{ sku: SKU, locationId: WAREHOUSE.id }],
  occurredAt: 1_700_000_000_000,
  commandKey: "cmd-1",
  ...overrides,
});

const world = (parts) => fakeFirestore({ warehouses: [WAREHOUSE], parts, trucks: [], bin_placements: [], inventory_transactions: [] });

// ══════════════════════════ THE PART'S ANSWER REACHES THE LEDGER ROW ══════════════════════════

test("a STANDARD part consumes as a quantity, and the movement carries the Part's own mode", async () => {
  const { db, tx } = world([{ id: PART, controlType: "STANDARD" }]);
  const movements = await planPhysicalConsumption(tx, db, baseInput());
  assert.equal(movements.length, 1);
  assert.equal(movements[0].part.partId, PART);
  assert.equal(movements[0].part.trackingMode, "NONE", "a STANDARD part IS quantity stock");
  assert.equal(movements[0].event.quantity, -2, "a consumption is negative");
  assert.deepEqual(movements[0].event.location, { type: "WAREHOUSE", locationId: WAREHOUSE.id });
});

test("a SERIALIZED part is REFUSED, instead of posting a NONE-mode quantity row", async () => {
  // THE DEFECT, INVERTED. Before this change the identical call returned a movement whose
  // trackingMode was "NONE" — counted against quantity on-hand for a unit serialized_assets still
  // held elsewhere. A refusal is the honest answer: this workflow captures no serial identity.
  const { db, tx } = world([{ id: PART, controlType: "SERIALIZED" }]);
  await assert.rejects(
    () => planPhysicalConsumption(tx, db, baseInput()),
    (err) => {
      assert.equal(err.code, "failed-precondition");
      assert.equal(err.details?.code, PART_NOT_QUANTITY_TRACKED);
      assert.equal(err.details?.trackingMode, "SERIAL");
      assert.equal(err.details?.sku, SKU);
      assert.match(err.message, /SERIAL-tracked/, "the technician is told what is actually wrong");
      return true;
    },
  );
});

test("a LOT part is refused too — the rule is 'quantity-tracked', not 'not serialized'", async () => {
  const { db, tx } = world([{ id: PART, controlType: "LOT" }]);
  await assert.rejects(
    () => planPhysicalConsumption(tx, db, baseInput()),
    (err) => err.details?.code === PART_NOT_QUANTITY_TRACKED && err.details?.trackingMode === "LOT",
  );
});

test("an UNRECOGNIZED controlType is refused, never silently treated as countable stock", async () => {
  // controlTypeToTrackingMode fails closed to LOT by design. This proves that failure actually
  // reaches a refusal here rather than being flattened back to NONE on the way.
  const { db, tx } = world([{ id: PART, controlType: "SOMETHING_NOBODY_TAUGHT_US" }]);
  await assert.rejects(
    () => planPhysicalConsumption(tx, db, baseInput()),
    (err) => err.details?.code === PART_NOT_QUANTITY_TRACKED,
  );
});

test("a stored Part with NO controlType is ordinary stock, matching the existing Part reader", async () => {
  const { db, tx } = world([{ id: PART, name: "Widget" }]);
  const movements = await planPhysicalConsumption(tx, db, baseInput());
  assert.equal(movements.length, 1);
  assert.equal(movements[0].part.trackingMode, "NONE");
});

test("NO Part document means today's behaviour, NOT a new existence requirement", async () => {
  // Deliberate scope fence. Whether a planned line must resolve to a real Part is the planning
  // producer's question; answering it here would be this change quietly becoming another one — and
  // it would break every Work Order whose snapshot predates canonical partId.
  const { db, tx } = world([]);
  const movements = await planPhysicalConsumption(tx, db, baseInput());
  assert.equal(movements.length, 1);
  assert.equal(movements[0].part.trackingMode, "NONE");
});

// ══════════════════════════ CORRECTIONS ARE NOT RE-CLASSIFIED ══════════════════════════

test("a DECREASE still reverses a SERIALIZED part's pre-existing consumption", async () => {
  // The pre-authority ruling planPhysicalConsumption.ts already makes: historical usage must stay
  // editable. A part reclassified to SERIALIZED after its NONE rows were written must not have those
  // rows become unreversible — the refusal guards ADDING consumption, and nothing else.
  const prior = {
    id: "mv-1",
    type: "WORK_ORDER_CONSUMPTION",
    partId: PART,
    quantity: -3,
    location: { type: "WAREHOUSE", locationId: WAREHOUSE.id },
    sourceObject: { type: "WORK_ORDER", id: WO },
  };
  const { db, tx } = fakeFirestore({
    warehouses: [WAREHOUSE],
    parts: [{ id: PART, controlType: "SERIALIZED" }],
    trucks: [],
    bin_placements: [],
    inventory_transactions: [prior],
  });
  const movements = await planPhysicalConsumption(
    tx,
    db,
    baseInput({ qtyUsedUpdates: [{ sku: SKU, delta: -2 }], consumptionSources: [] }),
  );
  assert.equal(movements.length, 1, "the correction is planned, not refused");
  assert.equal(movements[0].event.quantity, 2, "and it gives the quantity back");
  assert.equal(movements[0].part.trackingMode, "NONE", "matching the lineage it reverses");
});

// ══════════════════════════ THE AUTHORITY READER ══════════════════════════

test("readConsumptionTrackingModes reports the Part's mode, and reports SILENCE as absence", async () => {
  const { db, tx } = fakeFirestore({
    parts: [
      { id: "p-standard", controlType: "STANDARD" },
      { id: "p-serial", controlType: "SERIALIZED" },
      { id: "p-lot", controlType: "LOT" },
    ],
  });
  const modes = await readConsumptionTrackingModes(db, ["p-standard", "p-serial", "p-lot", "p-missing"], tx);
  assert.equal(modes.get("p-standard"), "NONE");
  assert.equal(modes.get("p-serial"), "SERIAL");
  assert.equal(modes.get("p-lot"), "LOT");
  assert.equal(modes.has("p-missing"), false, "absent means NO PART FOUND — distinct from 'found, quantity-tracked'");
  // ...and the caller turns that silence into today's behaviour, explicitly rather than by accident.
  assert.equal(consumptionTrackingModeFor(modes, "p-missing"), WORK_ORDER_CONSUMPTION_TRACKING_MODE);
  assert.equal(isQuantityTracked(consumptionTrackingModeFor(modes, "p-serial")), false);
  assert.equal(isQuantityTracked(consumptionTrackingModeFor(modes, "p-standard")), true);
});

test("the reader de-duplicates and ignores blanks, so one part is never read twice per command", async () => {
  let reads = 0;
  const { db } = fakeFirestore({ parts: [{ id: PART, controlType: "STANDARD" }] });
  const counting = {
    get: async (ref) => {
      reads += 1;
      return { exists: ref.__doc === PART, id: ref.__doc, data: () => ({ controlType: "STANDARD" }) };
    },
  };
  const modes = await readConsumptionTrackingModes(db, [PART, PART, "  ", "", PART], counting);
  assert.equal(reads, 1);
  assert.equal(modes.size, 1);
});

// ══════════════════════════ NEITHER ANSWER MAY COME BACK ══════════════════════════

test("the hardcode is gone from the writer, and the caller-supplied mode is gone from the reader", async () => {
  const writer = codeOnly("workOrderConsumption/planPhysicalConsumption.ts");
  assert.ok(
    !/\btrackingMode\s*=\s*""/.test(writer),
    "planPhysicalConsumption must not assign trackingMode a literal — the Part decides",
  );
  assert.match(writer, /consumptionTrackingModeFor\(trackingModes, partId\)/, "it asks the Part authority instead");

  const reader = codeOnly("workOrderConsumption/consumptionSourceCallables.ts");
  assert.ok(
    !/data\.trackingMode/.test(reader),
    "the callable must not take trackingMode off the request — that is the Part's fact, not the caller's",
  );
  assert.ok(!/data\.serialNo/.test(reader), "nor serialNo, for the same reason");
  assert.match(reader, /readConsumptionTrackingModes/, "it asks the SAME authority the writer asks");

  // One mapping, not a second copy. If this fails, someone re-derived controlType -> trackingMode.
  const authority = codeOnly("workOrderConsumption/consumptionPartTracking.ts");
  assert.match(authority, /controlTypeToTrackingMode/);
  assert.ok(!/case ""/.test(authority), "the mapping is imported, never restated");
  // And the RULE stays free of persistence, so it adds no Firebase dependency and needs no emulator.
  assert.ok(
    !/firebase/i.test(src("workOrderConsumption/consumptionPartTracking.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")),
    "the rule module must import no Firebase persistence — the read belongs in consumptionSourceService.ts",
  );
});
