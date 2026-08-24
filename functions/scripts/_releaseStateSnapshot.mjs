#!/usr/bin/env node
// RELEASE STATE SNAPSHOT — read-only, sandbox-only, for before/after comparison around a deploy.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md. Lives under functions/scripts/ beside
// certificationWorld.mjs because that is where firebase-admin is installed.
//
// ============================ WHY THIS EXISTS ============================
//
// A runtime release must leave the data exactly as it found it. "Exactly" is a claim, and a claim
// needs a measurement taken twice — before and after — from the same code, or the comparison is a
// memory of what somebody thought the numbers were.
//
// So this prints a stable, diffable block. Run it before the deploy, run it after, and diff the two.
// Anything that moves is either explained or the release stops.
//
// ============================ WRITES NOTHING ============================
//
// Reads only. No create, update, delete, batch or transaction anywhere in this file, and a test
// asserts that by reading this source. A snapshot that could alter what it measures would be worse
// than no snapshot: it would make the before and after agree for the wrong reason.
//
// ============================ MARKER-AWARE ============================
//
// Certification records carry `certificationWorld`. Legitimate sandbox records do not. Counting them
// together would make a normal, correct sandbox look like a dirty one — and the standing rule that
// certification Purchase Orders and receipts stay at zero is a claim about MARKED records, not about
// every purchase order in the estate. Pre-existing legitimate records are never a cleanup target.

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const MARKER_FIELD = "certificationWorld";

const args = process.argv.slice(2);
const projectIdIndex = args.indexOf("--projectId");
const projectId = projectIdIndex >= 0 ? args[projectIdIndex + 1] : null;

// NO DEFAULT, and production refused by name. A snapshot is harmless; pointing tooling at the
// customer project by accident is the habit that stops being harmless one script later.
if (!projectId) {
  console.error("--projectId is required (no default).");
  process.exit(2);
}
if (projectId === "taylor-parts" || /prod/i.test(projectId)) {
  console.error(`Refusing to read ${projectId}: this tool is sandbox-only.`);
  process.exit(2);
}

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

/** Every document in a collection, as plain data. Bounded only by the collection itself. */
async function all(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const marked = (rows) => rows.filter((r) => r[MARKER_FIELD] !== undefined);
const count = (rows, predicate) => rows.filter(predicate).length;

/** A number that is genuinely a number. Anything else is not silently treated as zero. */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function main() {
  const [accounts, equipment, serialized, ledger, roleAssignments, purchaseOrders, receiving, parts] =
    await Promise.all([
      all("accounts"),
      all("equipment"),
      all("serialized_assets"),
      all("inventory_transactions"),
      all("roleAssignments"),
      all("purchase_orders"),
      all("receiving_orders"),
      all("parts"),
    ]);

  // THE AVAILABLE POOL IS A serialized_assets FACT, not an `equipment` one. An earlier draft of this
  // script counted `currentEquipmentId == null` on `equipment`, which has no such field -- so every
  // row matched and it reported the entire installed base as "available". A snapshot that reports a
  // false alarm is worse than none, because the next real change gets read as noise.
  //
  // The line of business is resolved through the PART, which is where it is actually recorded.
  const lineByPartId = new Map(parts.map((p) => [p.partId ?? p.id, p.lineOfBusiness ?? null]));
  const lineOf = (asset) => {
    const line = lineByPartId.get(asset.partId);
    if (Array.isArray(line)) return line.join("+") || "(unrecorded)";
    return line ?? "(unrecorded)";
  };
  const availableAssets = serialized.filter((a) => a.currentEquipmentId == null);
  const availableByLine = {};
  for (const a of availableAssets) availableByLine[lineOf(a)] = (availableByLine[lineOf(a)] ?? 0) + 1;

  // ── inventory, BY SCOPE. Warehouse and mobile are never added into one "stock" figure: a
  // warehouse shortage coexisting with stock on trucks is a real state, and one number hides it.
  let warehouseQty = 0;
  let mobileQty = 0;
  const netByPart = new Map();
  for (const row of ledger) {
    const q = num(row.quantity);
    if (q === null) continue;
    const type = typeof row.type === "string" ? row.type : "";
    // Only physical movement counts toward a position; RESERVED/RELEASED/CONSUMED are commitments.
    const physical = !["RESERVED", "RELEASED", "CONSUMED"].includes(type);
    const sign = /_OUT$|^ISSUED$|^TRANSFER_OUT$/.test(type) ? -1 : 1;
    if (!physical) continue;
    const where = row.location?.type;
    if (where === "MOBILE") mobileQty += sign * q;
    else warehouseQty += sign * q;
    const partId = typeof row.partId === "string" ? row.partId : null;
    if (partId) netByPart.set(partId, (netByPart.get(partId) ?? 0) + sign * q);
  }

  const out = {
    projectId,
    takenAt: new Date().toISOString(),

    certificationWorld: {
      note: "run `node functions/scripts/certificationWorld.mjs verify` for version + COMPLETE state",
      markedRecordsFound: [accounts, equipment, parts, purchaseOrders, receiving]
        .reduce((sum, rows) => sum + marked(rows).length, 0),
    },

    accounts: {
      total: accounts.length,
      prospect: count(accounts, (a) => a.status === "PROSPECT"),
      active: count(accounts, (a) => a.status === "ACTIVE"),
      certificationMarked: marked(accounts).length,
    },

    equipment: {
      installedTotal: equipment.length,
      certificationMarked: marked(equipment).length,
      byLineOfBusiness: equipment.reduce((acc, e) => {
        const key = Array.isArray(e.lineOfBusiness) ? (e.lineOfBusiness.join("+") || "(unrecorded)") : (e.lineOfBusiness ?? "(unrecorded)");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },

    serializedAssets: {
      total: serialized.length,
      // currentEquipmentId is the INSTALL LINK: null means the unit is in the available pool, which
      // is a normal state and not a broken record.
      availablePool: availableAssets.length,
      installed: serialized.length - availableAssets.length,
      availableByLineOfBusiness: availableByLine,
    },

    inventory: {
      warehouseQuantity: warehouseQty,
      mobileQuantity: mobileQty,
      // COMPANY OWNED is the sum of the two SCOPES, stated as such rather than as "stock".
      companyOwned: warehouseQty + mobileQty,
      negativePartPositions: [...netByPart.values()].filter((v) => v < 0).length,
      ledgerRows: ledger.length,
    },

    governedAccess: {
      roleAssignmentsTotal: roleAssignments.length,
      // The stored value is lowercase "active". An earlier draft compared against "ACTIVE" and
      // reported ZERO active grants on a healthy sandbox -- the most alarming possible false alarm,
      // and the reason this comparison is case-insensitive and the raw breakdown is printed too.
      byStatus: roleAssignments.reduce((acc, r) => {
        const key = String(r.status ?? "(none)").toLowerCase();
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },

    purchasing: {
      // THE STANDING RULE is about MARKED records. Legitimate sandbox purchase orders are not a
      // cleanup target and are counted separately so the two can never be confused.
      certificationPurchaseOrders: marked(purchaseOrders).length,
      certificationReceipts: marked(receiving).length,
      legitimatePurchaseOrders: purchaseOrders.length - marked(purchaseOrders).length,
      legitimateReceipts: receiving.length - marked(receiving).length,
    },

    parts: { total: parts.length },
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("snapshot failed:", err?.message ?? err);
  process.exit(1);
});
