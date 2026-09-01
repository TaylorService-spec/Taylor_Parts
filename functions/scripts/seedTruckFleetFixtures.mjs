// Sandbox-only fixture seed: two governed warehouses + two trucks, so the live Truck Inventory
// workspace (field-ops-app-vite/src/modules/inventory/TruckInventory.jsx) has something to render
// as a peer-object card. Retention-audit finding, 2026-08-14: the workspace/card code has always
// been correct; the sandbox has simply never had a truck or a warehouse in it.
//
// Structurally sandbox-only (never taylor-parts), following the SAME guard shape as
// scripts/_sandboxDeployGuard.mjs and the SAME persona/callable-invocation pattern already
// established by functions/_e2e.mjs (REST sign-in via loadSandboxPersona, REST-invoke the Gen2
// callable's Cloud Run URL with a bearer ID token) -- no new invocation mechanism invented here.
// Lives in functions/scripts/ (not scripts/) because it needs firebase-admin, which is only a
// dependency of functions/package.json -- there is no root package.json in this repo.
//
// Warehouses are written directly via the Admin SDK because that IS the documented write path
// (field-ops-app-vite/src/modules/inventory/Warehouses.jsx: "warehouses is Admin-SDK-write-only;
// no client/deployed write path") -- this is not a bypass of a governed writer, there isn't one.
// Trucks are created through the REAL createTruckCallable trusted callable (never a raw Firestore
// write), so the created records carry the exact same server-derived MOBILE location + shape the
// app's own Add Truck flow produces.
//
// Run from functions/: `node scripts/seedTruckFleetFixtures.mjs`
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import admin from "firebase-admin";
import { loadSandboxPersona } from "../../scripts/sandboxCredentials.mjs";
import { resolveEnvironment, isProductionEnvironment } from "../../scripts/resolveEnvironment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const registry = JSON.parse(fs.readFileSync(resolve(ROOT, "config/environments.json"), "utf8"));
const TARGET_ENV = "platform-sandbox";
const TARGET_PROJECT = "eos-platform-sandbox";
const FORBIDDEN_PROJECT = "taylor-parts";

const env = resolveEnvironment(registry, TARGET_ENV);
const fail = (m) => { console.error("ABORT:", m); process.exit(1); };
if (isProductionEnvironment(env)) fail(`role is production (${env.role})`);
if (env.role === "production") fail("role === production");
if (env.firebase.projectId !== TARGET_PROJECT) fail(`projectId ${env.firebase.projectId} != ${TARGET_PROJECT}`);
if (env.firebase.projectId === FORBIDDEN_PROJECT) fail(`projectId is ${FORBIDDEN_PROJECT}`);
console.log(`GUARD OK: env=${env.id} role=${env.role} projectId=${env.firebase.projectId} (!= ${FORBIDDEN_PROJECT})`);

const PROJECT = TARGET_PROJECT;
const API_KEY = env.firebase.apiKey;
// Same Gen2 Cloud Run URL derivation already established and working for this project in
// functions/_e2e.mjs -- the hash is per-project/region, not per-function, so it is reused as-is.
const FN_HASH = "2duvac43ba";
const CALLABLE = (name) => `https://${name.toLowerCase()}-${FN_HASH}-uc.a.run.app`;

const app = admin.initializeApp({ projectId: PROJECT });
if (app.options.projectId !== PROJECT) fail("admin project guard");
const db = admin.firestore();

const RUN = `seed${Date.now()}`;
const key = (s) => `${RUN}-${s}`.slice(0, 200);

const tokenCache = {};
async function idTokenFor(personaKey) {
  if (tokenCache[personaKey]) return tokenCache[personaKey];
  const { email, password } = loadSandboxPersona(personaKey);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok || !j.idToken) throw new Error(`AUTH_FAILED persona=${personaKey} status=${r.status} code=${j.error?.message ?? "unknown"}`);
  tokenCache[personaKey] = j.idToken;
  return j.idToken;
}

async function call(name, personaKey, data) {
  const token = await idTokenFor(personaKey);
  const r = await fetch(CALLABLE(name), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(`${name} FAILED: ${j.error?.status ?? r.status} ${j.error?.message ?? ""}`); e.code = j.error?.status; throw e; }
  return j.result;
}

// Governed warehouse shape -- functions/src/types/warehouse.ts GovernedWarehouse, provenance NATIVE
// (created fresh, not migrated), no legacy `active` key.
//
// `id` IS PART OF THE GOVERNED SHAPE, AND THIS OMITTED IT. The §3A validator binds the STORED `id`
// to the document id, so a record without one fails `id_invalid` and is not a governed warehouse at
// all. Two sandbox warehouses seeded by this function -- wh-sandbox-central and wh-sandbox-north --
// were in exactly that state: Receiving and Transfers already refused them as a destination and an
// endpoint, and the Ownership root-company assignment refused to touch them.
//
// Nothing else about this function changes. The invariant it now keeps is the narrow one:
//
//     a seeded warehouse's STORED id equals its DOCUMENT id
async function seedWarehouse(id, name, location) {
  const ref = db.collection("warehouses").doc(id);
  const existing = await ref.get();
  if (existing.exists) { console.log(`warehouse ${id}: already exists, skipping`); return; }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({
    id,
    name, location, status: "ACTIVE", version: 1,
    updatedAt: now, updatedBy: "seed-script",
    createdAt: now, createdBy: "seed-script",
    provenance: "NATIVE",
  });
  console.log(`warehouse ${id}: created ("${name}")`);
}

async function seedTruck({ truckId, vehicleNumber, displayLabel, locationId, homeWarehouseId, status }) {
  const existing = await db.collection("trucks").doc(truckId).get();
  if (existing.exists) { console.log(`truck ${truckId}: already exists, skipping`); return; }
  const r = await call("createTruckCallable", "admin", {
    idempotencyKey: key(truckId),
    truckId, locationId, homeWarehouseId, status,
    assignedDriverEmployeeId: null,
    displayLabel, vehicleNumber,
  });
  console.log(`truck ${truckId}: created via createTruckCallable`, r?.truckId ? `(confirmed truckId=${r.truckId})` : "");
}

async function main() {
  console.log(`== seeding truck fleet fixtures :: project=${PROJECT} run=${RUN} ==`);

  await seedWarehouse("wh-sandbox-central", "Central Distribution", "1200 Industrial Pkwy");
  await seedWarehouse("wh-sandbox-north", "North Satellite", "88 Harbor Rd");

  await seedTruck({
    truckId: "TRK-SEED-101", vehicleNumber: "SEED-101", displayLabel: "Truck 101 (seed)",
    locationId: `mobile-${key("101")}`, homeWarehouseId: "wh-sandbox-central", status: "ACTIVE",
  });
  await seedTruck({
    truckId: "TRK-SEED-102", vehicleNumber: "SEED-102", displayLabel: "Truck 102 (seed)",
    locationId: `mobile-${key("102")}`, homeWarehouseId: "wh-sandbox-north", status: "IDLE",
  });

  console.log("\nDone. Verify at Inventory > Truck Inventory and Inventory > Warehouses in the sandbox app.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n[FAIL] ${e.message}`);
  process.exit(1);
});
