#!/usr/bin/env node
// WORLD FINGERPRINT — the cheap proof that a bounded change stayed bounded.
//
// Counts and content hashes for every collection the purchasing correction must NOT touch. Run it
// before and after; anything that moves that was not supposed to move shows up as a changed digest
// rather than as an unnoticed side effect.
//
// Hashes are over sorted, stringified content, so a reordering of query results is not mistaken for
// a change and an actual edit cannot hide inside one.
//
// EMULATOR ONLY.
import crypto from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const GROUPS = {
  inventory_transactions: null,
  fieldops_wos: null,
  parts: null,
  equipment: null,
  accounts: null,
  employees: null,
  roleAssignments: null,
  users: null,
  purchase_orders: null,
  receiving_orders: null,
};

const stable = (v) => JSON.stringify(v, (k, x) =>
  (x && typeof x === "object" && !Array.isArray(x))
    ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]]))
    : x);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  const out = {};
  for (const name of Object.keys(GROUPS)) {
    const snap = await db.collection(name).get();
    const rows = snap.docs.map((d) => `${d.id}|${stable(d.data())}`).sort();
    out[name] = { count: snap.size, digest: crypto.createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16) };
  }
  // The parts-plan fingerprint specifically: demand must survive purchasing changes untouched.
  const wos = await db.collection("fieldops_wos").get();
  const plans = wos.docs.map((d) => `${d.data().woNumber}|${stable(d.data().inventorySnapshot ?? [])}`).sort();
  out.__partsPlans = { count: plans.length, digest: crypto.createHash("sha256").update(plans.join("\n")).digest("hex").slice(0, 16) };

  const label = process.argv[2] ?? "fingerprint";
  console.log(`== ${label}`);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(24)} ${String(v.count).padStart(5)}  ${v.digest}`);
  console.log(`JSON ${JSON.stringify(out)}`);
}
