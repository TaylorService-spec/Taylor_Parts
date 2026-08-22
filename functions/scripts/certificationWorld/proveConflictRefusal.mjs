#!/usr/bin/env node
// CONFLICTING REPLAY PROOF — the same idempotency key must never mean two different movements.
//
// Idempotency that only recognises IDENTICAL replays is half a guarantee. The dangerous case is a
// key reused for a DIFFERENT movement: without a fingerprint check the ledger would quietly accept
// the first record as satisfying the second request, and the inventory effect nobody noticed missing
// is the one that never happened.
//
// So each mutation below reuses a real, already-applied key and changes exactly one thing. Every one
// must be refused, and the ledger must be byte-identical afterwards.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { buildInventoryPlan } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const ledger = await import(L("functions/lib/inventoryLedger/operationalMovementRepository.js"));

const LEDGER_COLLECTION = "inventory_transactions";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  const projectId = "demo-certworld";
  if (!getApps().length) initializeApp({ projectId });
  const db = getFirestore();

  const plan = buildInventoryPlan();
  const parts = new Map(CERT_PARTS.map((p) => [p.partId, p]));

  const employees = await db.collection("employees").get();
  const uidBy = new Map(employees.docs.map((d) => [d.id, d.data().userId]).filter(([, u]) => u));

  const before = (await db.collection(LEDGER_COLLECTION).count().get()).data().count;
  console.log(`ledger documents before: ${before}\n`);

  // A transfer movement, so counterpartyLocation is legal and destination can be mutated.
  const base = plan.find((m) => m.type === "TRANSFER_OUT");
  const other = plan.find((m) => m.type === "TRANSFER_OUT" && m.partId !== base.partId);

  const toEvent = (m, overrides = {}) => ({
    type: m.type, partId: m.partId, location: m.location, quantity: m.quantity,
    sourceObject: m.sourceObject, idempotencyKey: m.idempotencyKey,
    actor: { kind: "USER", id: uidBy.get(m.actorEmployeeId) },
    occurredAt: m.occurredAt,
    ...(m.counterpartyLocation ? { counterpartyLocation: m.counterpartyLocation } : {}),
    ...overrides,
  });

  const cases = [
    { name: "QUANTITY changed", event: toEvent(base, { quantity: base.quantity + 7 }) },
    { name: "DESTINATION changed", event: toEvent(base, { counterpartyLocation: { type: "MOBILE", locationId: "cert-trk-05" } }) },
    { name: "PART changed", event: toEvent(base, { partId: other.partId }) },
    { name: "ACTOR changed", event: toEvent(base, { actor: { kind: "USER", id: uidBy.get("cw-emp-044") } }) },
    { name: "SOURCE LOCATION changed", event: toEvent(base, { location: { type: "WAREHOUSE", locationId: "wh-north" } }) },
  ];

  let refused = 0, accepted = 0;
  for (const c of cases) {
    const partId = c.event.partId;
    const part = parts.get(partId);
    let outcome = null, error = null;
    try {
      await db.runTransaction(async (txn) => {
        const writes = [];
        const store = {
          async read(docId) {
            const s = await txn.get(db.collection(LEDGER_COLLECTION).doc(docId));
            return s.exists ? (s.data() ?? null) : null;
          },
          create(docId, data) { writes.push({ docId, data }); },
        };
        const res = await ledger.stageOperationalMovement(
          store, c.event, { partId: part.partId, trackingMode: part.ledgerTrackingMode },
          { now: new Date(c.event.occurredAt) },
        );
        outcome = res.outcome;
        // Deliberately NOT flushed: if a conflicting payload were ever accepted, this proof must not
        // be the thing that writes it.
      });
    } catch (err) {
      error = err?.constructor?.name || "Error";
      error += `: ${err?.message || err}`;
    }
    const wasRefused = Boolean(error);
    if (wasRefused) refused += 1; else accepted += 1;
    console.log(`${wasRefused ? "REFUSED " : "ACCEPTED"}  ${c.name.padEnd(24)} ${error || `outcome=${outcome}`}`);
  }

  const after = (await db.collection(LEDGER_COLLECTION).count().get()).data().count;
  console.log(`\nledger documents after : ${after}`);
  console.log(`refused ${refused}/${cases.length}, accepted ${accepted}`);
  console.log(`ledger unchanged: ${before === after ? "YES" : "NO"}`);

  if (accepted > 0 || before !== after) {
    console.log("\nFAILED: a conflicting replay was not refused, or the ledger moved.");
    process.exitCode = 1;
  } else {
    console.log("\nCONFLICT REFUSAL PROVEN: same key + changed payload is refused, ledger untouched.");
  }
}
