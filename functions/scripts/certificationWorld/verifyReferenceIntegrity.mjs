#!/usr/bin/env node
// REFERENCE INTEGRITY — every pointer in the world must land on something.
//
// ============================ WHY THIS IS ITS OWN SWEEP ============================
//
// A dangling reference does not throw. It renders as a blank, an id, or a plausible-looking empty
// list, and every count in the system still adds up. This program has already shipped one of those:
// a Sales Order list showing raw document ids where a customer name belonged, because the reference
// resolved to nothing and nothing said so.
//
// So this walks every reference the certification world creates and asserts the target exists. It
// reports the ORPHANS, not a percentage -- a sweep that says "99% intact" is describing a broken
// world in a reassuring voice.
//
// ============================ ONE KNOWN, DOCUMENTED EXCEPTION ============================
//
// 32 seeded opening-balance movements are typed RECEIVED, which the ledger contract binds to a
// RECEIVING_ORDER source, and they name receiving orders that were never created. An opening
// balance is not a receipt; the correct model is ADJUSTED/ADJUSTMENT.
//
// It is REPORTED, not suppressed. Adding an exemption here would make the sweep agree with the
// defect, and the number this tool exists to show is the number of broken pointers -- not the
// number of broken pointers nobody has an excuse for.
//
// See docs/assessments/seeded-opening-balances-claim-receipts-that-never-existed.md. Scheduled for
// Pass 3, where the inventory baseline is rebuilt anyway.
//
// Expected dangling references: 0, except those 32.
//
// EMULATOR ONLY.
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const results = [];
const check = (name, orphans, detail) => {
  const ok = orphans.length === 0;
  results.push({ name, ok, orphans: orphans.length });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${orphans.length} dangling${detail ? "  -- " + detail : ""}`);
  if (!ok) for (const o of orphans.slice(0, 5)) console.log(`        ${o}`);
};

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  const idsOf = async (c) => new Set((await db.collection(c).get()).docs.map((d) => d.id));
  const [parts, accounts, locations, equipment, employees, warehouses, trucks, purchaseOrders] =
    await Promise.all(["parts", "accounts", "locations", "equipment", "employees", "warehouses",
      "mobile_locations", "purchase_orders"].map(idsOf));

  // Trucks are MOBILE inventory locations and live in mobile_locations. An earlier version of this
  // sweep looked in inventory_trucks -- a collection that does not exist -- and reported all 55
  // truck movements as dangling. A sweep can be wrong in the alarming direction too, and an
  // integrity report nobody can trust is worse than none.
  const mobileIds = new Set([...trucks, ...locations]);
  const principals = new Set((await db.collection("users").get()).docs.map((d) => d.id));
  const employeePrincipals = new Set((await db.collection("employees").get()).docs
    .map((d) => d.data().userId).filter(Boolean));

  // ── Work Orders ───────────────────────────────────────────────────────────────────────────────
  const wos = (await db.collection("fieldops_wos").get()).docs;
  check("work order -> customer", wos.filter((d) => d.data().customerId && !accounts.has(d.data().customerId))
    .map((d) => `${d.data().woNumber} -> ${d.data().customerId}`), `${wos.length} work orders`);
  check("work order -> location", wos.filter((d) => d.data().locationId && !locations.has(d.data().locationId))
    .map((d) => `${d.data().woNumber} -> ${d.data().locationId}`));
  check("work order -> equipment", wos.filter((d) => d.data().equipmentId && !equipment.has(d.data().equipmentId))
    .map((d) => `${d.data().woNumber} -> ${d.data().equipmentId}`));
  const planOrphans = [];
  for (const d of wos) for (const row of d.data().inventorySnapshot ?? []) {
    if (!parts.has(row.partId)) planOrphans.push(`${d.data().woNumber} plans ${row.partId}`);
  }
  check("work order parts plan -> part", planOrphans);

  // ── Equipment ─────────────────────────────────────────────────────────────────────────────────
  const equip = (await db.collection("equipment").get()).docs;
  check("equipment -> account", equip.filter((d) => d.data().accountId && !accounts.has(d.data().accountId))
    .map((d) => `${d.id} -> ${d.data().accountId}`), `${equip.length} equipment`);
  check("equipment -> location", equip.filter((d) => d.data().locationId && !locations.has(d.data().locationId))
    .map((d) => `${d.id} -> ${d.data().locationId}`));

  // ── Locations ─────────────────────────────────────────────────────────────────────────────────
  const locs = (await db.collection("locations").get()).docs;
  check("location -> account", locs.filter((d) => d.data().accountId && !accounts.has(d.data().accountId))
    .map((d) => `${d.id} -> ${d.data().accountId}`), `${locs.length} locations`);

  // ── Purchase orders ───────────────────────────────────────────────────────────────────────────
  const pos = (await db.collection("purchase_orders").get()).docs;
  const poLineOrphans = [];
  for (const d of pos) for (const item of d.data().items ?? []) {
    if (!parts.has(item.partId)) poLineOrphans.push(`${d.id} orders ${item.partId}`);
  }
  check("purchase order line -> part", poLineOrphans, `${pos.length} orders`);
  check("purchase order -> buyer employee", pos.filter((d) => d.data().certBuyerEmployeeId
    && !employees.has(d.data().certBuyerEmployeeId)).map((d) => `${d.id} -> ${d.data().certBuyerEmployeeId}`));
  check("purchase order -> buyer principal", pos.filter((d) => d.data().certBuyerPrincipalUid
    && !employeePrincipals.has(d.data().certBuyerPrincipalUid)).map((d) => `${d.id} -> ${d.data().certBuyerPrincipalUid}`));

  // ── Receipts ──────────────────────────────────────────────────────────────────────────────────
  const receipts = (await db.collection("receiving_orders").get()).docs;
  check("receipt -> purchase order", receipts.filter((d) => {
    const po = d.data().source?.purchaseOrderId;
    return po && !purchaseOrders.has(po);
  }).map((d) => `${d.id} -> ${d.data().source?.purchaseOrderId}`), `${receipts.length} receipts`);
  const receiptLineOrphans = [];
  for (const d of receipts) for (const l of d.data().lines ?? []) {
    if (!parts.has(l.partId)) receiptLineOrphans.push(`${d.id} receives ${l.partId}`);
  }
  check("receipt line -> part", receiptLineOrphans);
  check("receipt -> receiving warehouse", receipts.filter((d) => {
    const loc = d.data().receivingLocation;
    return loc?.type === "WAREHOUSE" && !warehouses.has(loc.locationId);
  }).map((d) => `${d.id} -> ${d.data().receivingLocation?.locationId}`));
  check("receipt -> acting principal", receipts.filter((d) => {
    const id = d.data().actor?.id;
    return id && !employeePrincipals.has(id);
  }).map((d) => `${d.id} -> ${d.data().actor?.id}`));

  // ── Ledger ────────────────────────────────────────────────────────────────────────────────────
  const ledger = (await db.collection("inventory_transactions").get()).docs;
  check("movement -> part", ledger.filter((d) => !parts.has(d.data().partId))
    .map((d) => `${d.id} -> ${d.data().partId}`), `${ledger.length} movements`);
  check("movement -> warehouse", ledger.filter((d) => {
    const l = d.data().location;
    return l?.type === "WAREHOUSE" && !warehouses.has(l.locationId);
  }).map((d) => `${d.id} -> ${d.data().location?.locationId}`));
  check("movement -> truck", ledger.filter((d) => {
    const l = d.data().location;
    return l?.type === "MOBILE" && !mobileIds.has(l.locationId);
  }).map((d) => `${d.id} -> ${d.data().location?.locationId}`));
  check("movement -> receipt (where one is named)", ledger.filter((d) => {
    const s = d.data().sourceObject;
    return s?.type === "RECEIVING_ORDER" && !receipts.some((r) => r.id === s.id);
  }).map((d) => `${d.id} -> ${d.data().sourceObject?.id}`));

  // ── Authority ─────────────────────────────────────────────────────────────────────────────────
  const assignments = (await db.collection("roleAssignments").get()).docs;
  check("role assignment -> principal", assignments.filter((d) => !principals.has(d.data().principalUid))
    .map((d) => `${d.id} -> ${d.data().principalUid}`), `${assignments.length} assignments`);
  check("employee -> principal", (await db.collection("employees").get()).docs
    .filter((d) => d.data().userId && !principals.has(d.data().userId))
    .map((d) => `${d.id} -> ${d.data().userId}`));

  const total = results.reduce((s, r) => s + r.orphans, 0);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} reference checks passed, ${total} dangling references`);
  if (failed.length) process.exitCode = 1;
}
