// FIN-BLOCK-003A ACTIVATION — price is mandatory on NEW commitments, and legacy stays legacy.
//
// Two populations now exist in one collection and must never be confused: purchase orders written
// under the price authority, which always carry a price, and the ones already in Firestore, which
// carry no money at all and are legitimately unpriced forever.
//
// The whole activation rests on how those are told apart. This suite exists mainly to pin that the
// distinction is a SERVER-STAMPED VERSION and not the tempting alternatives — "missing price means
// legacy" (which hands any future caller a way to skip the requirement) or a deployment date (a wall
// clock is not authority).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const code = (rel) => readFileSync(join(SRC, rel), "utf8");
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const { PRICE_AUTHORITY_VERSION, isPriceGovernedPurchase } = await import("../lib/finance/acquisitionCost.js");
const { buildRecordReorderPurchaseOrder } = await import("../lib/reorderRequest/reorderCommands.js");
const { normalizeLegacyPurchaseOrder } = await import("../lib/purchasing/purchaseOrderNormalization.js");

const REQUEST = { status: "PURCHASING_IN_PROGRESS", operatingCompanyId: "taylor", partId: "PRT-1" };
const CTX = { actorUid: "u1", nowMillis: 1_700_000_000_000, purchaseOrderExists: false };
const record = (over = {}) =>
  buildRecordReorderPurchaseOrder(
    {
      reorderRequestId: "REQ-1",
      supplierName: "ACME",
      externalPoNumber: "PO-9",
      orderedQuantity: 10,
      orderedDate: "2026-09-01",
      unitPriceMinor: 10000,
      currency: "USD",
      ...over,
    },
    REQUEST,
    CTX,
  );
const throwsReorderCode = (fn, expected) => assert.throws(fn, (e) => e.code === expected, `expected ${expected}`);

// ══════════════════════════ NEW COMMITMENTS REQUIRE A PRICE ══════════════════════════

test("a new purchase commitment REQUIRES unitPriceMinor and currency", () => {
  throwsReorderCode(() => record({ unitPriceMinor: undefined, currency: undefined }), "PO_PRICE_REQUIRED");
});

test("the refusal has its OWN code, so activation is distinguishable from a bad payload", () => {
  // A purchasing user told "enter the price" and a caller sending a malformed field are different
  // situations; collapsing them into one code would force a UI to parse prose to tell them apart.
  try {
    record({ unitPriceMinor: undefined, currency: undefined });
    assert.fail("should have refused");
  } catch (e) {
    assert.equal(e.code, "PO_PRICE_REQUIRED");
    assert.notEqual(e.code, "PO_FIELD_INVALID");
    assert.match(e.message, /enter 0 for a no-charge line/i, "the refusal must say what to do about it");
  }
});

test("a PARTIAL price is refused — an amount with no currency is not a smaller fact", () => {
  throwsReorderCode(() => record({ currency: undefined }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ unitPriceMinor: undefined }), "PO_FIELD_INVALID");
});

test("float money is refused at the commitment, not rounded", () => {
  throwsReorderCode(() => record({ unitPriceMinor: 19.99 }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ unitPriceMinor: 0.1 + 0.2 }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ unitPriceMinor: NaN }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ unitPriceMinor: Infinity }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ unitPriceMinor: "10000" }), "PO_FIELD_INVALID");
});

test("EXPLICIT ZERO is a legal committed price, and is NOT the same as absent", () => {
  // A no-charge line is a real commercial fact. Refusing it would push exactly that case into the
  // UNKNOWN bucket, where it becomes indistinguishable from a price nobody entered.
  const built = record({ unitPriceMinor: 0 });
  assert.equal(built.purchaseOrder.unitPriceMinor, 0);
  assert.equal(built.purchaseOrder.currency, "USD");
  assert.notEqual(built.purchaseOrder.unitPriceMinor, null);
  assert.equal(built.purchaseOrder.priceAuthorityVersion, PRICE_AUTHORITY_VERSION);
  // And absent is still refused, so the two can never be confused at the door.
  throwsReorderCode(() => record({ unitPriceMinor: undefined, currency: undefined }), "PO_PRICE_REQUIRED");
});

test("negative money is refused — direction is carried by TYPE in this repo, never by sign", () => {
  throwsReorderCode(() => record({ unitPriceMinor: -1 }), "PO_FIELD_INVALID");
});

test("currency must be a real 3-letter code and is never defaulted", () => {
  throwsReorderCode(() => record({ currency: "usd" }), "PO_FIELD_INVALID");
  throwsReorderCode(() => record({ currency: "DOLLARS" }), "PO_FIELD_INVALID");
  assert.equal(record({ currency: "CAD" }).purchaseOrder.currency, "CAD", "a non-USD purchase keeps its own currency");
});

// ══════════════════════════ THE LEGACY CUTOFF ══════════════════════════

test("a new commitment is STAMPED by the server with the price-authority version", () => {
  assert.equal(record().purchaseOrder.priceAuthorityVersion, PRICE_AUTHORITY_VERSION);
  assert.ok(PRICE_AUTHORITY_VERSION >= 2, "version 1 / absent is the pre-authority population");
});

test("the stamp is SERVER-AUTHORED — a caller cannot choose its own version", () => {
  const built = record({ priceAuthorityVersion: 1 });
  assert.equal(
    built.purchaseOrder.priceAuthorityVersion,
    PRICE_AUTHORITY_VERSION,
    "a caller-supplied version must not survive — that would be a way to masquerade as legacy",
  );
});

test("a CURRENT caller cannot masquerade as legacy", () => {
  // The two doors are closed together, which is the whole design: the command that stamps the
  // version is the same one that requires the price, so a record cannot have one without the other.
  throwsReorderCode(() => record({ unitPriceMinor: undefined, currency: undefined }), "PO_PRICE_REQUIRED");
  assert.equal(record().purchaseOrder.priceAuthorityVersion, PRICE_AUTHORITY_VERSION);
});

test("legacy is identified by the STAMP, never by the missing price", () => {
  assert.equal(isPriceGovernedPurchase({}), false, "no stamp = legacy");
  assert.equal(isPriceGovernedPurchase({ priceAuthorityVersion: 1 }), false);
  assert.equal(isPriceGovernedPurchase({ priceAuthorityVersion: PRICE_AUTHORITY_VERSION }), true);
  // A stamped document is governed EVEN IF its price were somehow absent — which is what makes the
  // normalizer able to refuse it as corrupt instead of reading it as free.
  assert.equal(isPriceGovernedPurchase({ priceAuthorityVersion: PRICE_AUTHORITY_VERSION, unitPriceMinor: undefined }), true);
});

test("the cutoff consults no clock and no deployment date", () => {
  const src = code("finance/acquisitionCost.ts");
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["Date.now", "new Date", "ACTIVATION_DATE", "CUTOFF_DATE", "deployedAt"]) {
    assert.ok(!stripped.includes(forbidden), `the legacy cutoff must not depend on ${forbidden}`);
  }
});

// ══════════════════════════ LEGACY GRANDFATHERING ══════════════════════════

const legacyDoc = (over = {}) => ({
  reorderRequestId: "REQ-OLD",
  partId: "PRT-1",
  orderedQuantity: 5,
  status: "ORDERED",
  operatingCompanyId: "taylor",
  ...over,
});

test("a LEGACY unpriced purchase order still normalizes, and stays receivable", () => {
  const po = normalizeLegacyPurchaseOrder("REQ-OLD", legacyDoc());
  assert.equal(po.lines[0].unitPriceMinor, null, "UNKNOWN");
  assert.equal(po.lines[0].currency, null);
  assert.notEqual(po.lines[0].unitPriceMinor, 0, "an unpriced legacy purchase is not a free one");
  assert.equal(po.operatingCompanyId, "taylor", "and it keeps its governed company");
});

test("legacy is NOT backfilled from anything", () => {
  // No supplier quote, no catalog price, no later PO, no average. The absence stays an absence.
  const po = normalizeLegacyPurchaseOrder("REQ-OLD", legacyDoc());
  assert.equal(po.lines[0].unitPriceMinor, null);
  // Structural, and stated as CODE rather than as vocabulary: a backfill needs either a source to
  // copy a price from or a write to put one back. Neither exists. (An earlier version of this
  // assertion grepped for the words "backfill|migrate" and fired on comments that say there is no
  // migration — a guard that cannot tell a denial from an admission.)
  for (const rel of ["purchasing/purchaseOrderNormalization.ts", "finance/acquisitionCost.ts"]) {
    const stripped = code(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/partSupplierItem|partsCatalog/.test(stripped), `${rel} must have no price source to backfill FROM`);
    // No I/O at all, which is a stronger and simpler claim than enumerating write verbs — and does
    // not fire on `Map.set`, which is what an earlier version of this line did.
    assert.ok(!/firebase-admin|\bcollection\(|\.doc\(/.test(stripped), `${rel} must be pure — no I/O to backfill WITH`);
  }
});

test("a STAMPED purchase order with no price is REFUSED as corrupt, not read as free", () => {
  // The command cannot produce this. Anything else that could — an import, a fixture, a hand-edit —
  // must not be able to make a corrupt record look like a free purchase.
  assert.throws(
    () => normalizeLegacyPurchaseOrder("REQ-1", legacyDoc({ priceAuthorityVersion: PRICE_AUTHORITY_VERSION })),
    (e) => e.code === "PO_PRICE_MISSING",
  );
});

test("a stamped purchase order WITH a price normalizes to a governed price", () => {
  const po = normalizeLegacyPurchaseOrder(
    "REQ-1",
    legacyDoc({ priceAuthorityVersion: PRICE_AUTHORITY_VERSION, unitPriceMinor: 10000, currency: "USD" }),
  );
  assert.equal(po.lines[0].unitPriceMinor, 10000);
  assert.equal(po.lines[0].currency, "USD");
});

test("a stamped ZERO price normalizes as zero, not as UNKNOWN", () => {
  const po = normalizeLegacyPurchaseOrder(
    "REQ-1",
    legacyDoc({ priceAuthorityVersion: PRICE_AUTHORITY_VERSION, unitPriceMinor: 0, currency: "USD" }),
  );
  assert.equal(po.lines[0].unitPriceMinor, 0);
  assert.notEqual(po.lines[0].unitPriceMinor, null, "zero is a known price; null is an unknown one");
});

// ══════════════════════════ NOTHING ELSE MOVED ══════════════════════════

test("activation granted no capability and touched no visibility", () => {
  const catalog = code("access/permissionCatalog.ts");
  for (const invented of ["cost.read", "cost.manage", "acquisitionCost", "purchase.price"]) {
    assert.ok(!catalog.includes(invented), `${invented} must not appear`);
  }
  assert.ok(!/acquisition/i.test(code("finance/financialVisibility.ts")), "FIN-004 reach is unchanged");
});

test("salesOrder.fulfill is still INACTIVE — this activation does not reach it", () => {
  const catalog = code("access/permissionCatalog.ts");
  const idx = catalog.indexOf("salesOrder.fulfill");
  assert.ok(idx > 0, "the capability must still be registered");
  // Read the entry's own active flag rather than grepping the file globally.
  const entry = catalog.slice(idx, idx + 400);
  assert.match(entry, /active:\s*false/, "salesOrder.fulfill must remain inactive");
});

test("the cost collection still has NO Rules match block", () => {
  const rules = readFileSync(join(HERE, "..", "..", "firestore.rules"), "utf8");
  assert.ok(!/inventory_acquisition_costs/.test(rules), "raw cost documents stay unreadable by any client");
});

test("no production capability override was added", () => {
  const overrides = code("access/environmentCapabilityOverrides.ts");
  const stripped = overrides.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/acquisitionCost|purchase\.price/.test(stripped), "no cost capability override exists");
});

test("valuation, COGS, margin, turns and carrying cost all remain blocked", async () => {
  const { PERFORMANCE_METRICS, metricsActiveForGoals } = await import("../lib/performance/performanceMetricRegistry.js");
  assert.equal(PERFORMANCE_METRICS.length, 37);
  assert.equal(metricsActiveForGoals().length, 12, "activation activated NO metric");
  for (const id of [
    "inventory.value.amount",
    "inventory.turns.ratio",
    "inventory.carryingCost.amount",
    "inventory.wasteAvoided.amount",
  ]) {
    assert.equal(PERFORMANCE_METRICS.find((m) => m.metricId === id).activeForGoals, false, `${id} stays blocked`);
  }
  // And no COGS implementation appeared alongside the activation.
  for (const file of walk(SRC)) {
    const stripped = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"[^"]*"|'[^']*'/g, '""');
    assert.ok(!/\b(costOfGoodsSold|costOfSales)\b/.test(stripped), `no COGS concept: ${file}`);
  }
});
