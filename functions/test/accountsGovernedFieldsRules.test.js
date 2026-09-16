// CRM NONPROD CUTOVER — legacy direct Firestore CRM mutation authority retirement proof.
// Exactly 18 emulator assertions so the canonical Rules runner registration stays unchanged.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = "http://127.0.0.1:8080";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function proveStaticRetirement() {
  const root = fs.readFileSync(path.resolve(__dirname, "..", "..", "firestore.rules"), "utf8");
  const vite = fs.readFileSync(path.resolve(__dirname, "..", "..", "field-ops-app-vite", "firestore.rules"), "utf8");
  if (root !== vite) throw new Error("root and Vite Firestore Rules must remain byte-identical");
  for (const dead of [
    "accountPaymentTermsValid",
    "accountTaxStatusValid",
    "accountGovernedFieldsValid",
    "accountGovernedFieldsUnchanged",
    "accountGovernedCreateBaseline",
  ]) {
    if (root.includes(dead)) throw new Error(`dead CRM Rules business helper still present: ${dead}`);
  }
  const checks = [
    ["accounts", "match /locations/{locationId}"],
    ["locations", "// Equipment & Installed Asset Management"],
    ["contacts", "// Issue #325 / ADR-007"],
  ];
  for (const [collection, next] of checks) {
    const i = root.indexOf(`match /${collection}/{`);
    const j = root.indexOf(next, i);
    if (i < 0 || j < 0) throw new Error(`cannot locate ${collection} Rules block`);
    const block = root.slice(i, j);
    if (!block.includes("allow read: if isAdminOrDispatcher();")) throw new Error(`${collection}: read posture missing`);
    if (!block.includes("allow create, update, delete: if false;")) throw new Error(`${collection}: direct writes not retired`);
  }
}

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}`);
  return body.idToken;
}

function headers(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function readDoc(collection, id, token) {
  return (await fetch(`${DOC_BASE}/${collection}/${id}`, { headers: headers(token) })).status;
}

async function createDoc(collection, id, token) {
  return (await fetch(`${DOC_BASE}/${collection}/${id}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ fields: { name: { stringValue: "blocked create" } } }),
  })).status;
}

async function updateDoc(collection, id, token) {
  return (await fetch(`${DOC_BASE}/${collection}/${id}?updateMask.fieldPaths=name`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ fields: { name: { stringValue: "blocked update" } } }),
  })).status;
}

async function deleteDoc(collection, id, token) {
  return (await fetch(`${DOC_BASE}/${collection}/${id}`, {
    method: "DELETE",
    headers: headers(token),
  })).status;
}

async function seed() {
  await db.doc("users/crm-retire-admin").set({ role: "admin" });
  await db.doc("users/crm-retire-dispatcher").set({ role: "dispatcher" });
  await db.doc("users/crm-retire-technician").set({ role: "technician" });
  await db.doc("accounts/crm-retire-account").set({ name: "Account" });
  await db.doc("locations/crm-retire-location").set({ name: "Location" });
  await db.doc("contacts/crm-retire-contact").set({ name: "Contact" });
}

async function main() {
  proveStaticRetirement();
  await seed();
  const [adminToken, dispatcherToken, technicianToken] = await Promise.all([
    idTokenFor("crm-retire-admin"),
    idTokenFor("crm-retire-dispatcher"),
    idTokenFor("crm-retire-technician"),
  ]);

  for (const [collection, id] of [
    ["accounts", "crm-retire-account"],
    ["locations", "crm-retire-location"],
    ["contacts", "crm-retire-contact"],
  ]) {
    report(`${collection}: admin READ retained`, (await readDoc(collection, id, adminToken)) === 200);
    report(`${collection}: dispatcher READ retained`, (await readDoc(collection, id, dispatcherToken)) === 200);
    report(`${collection}: technician READ remains denied`, (await readDoc(collection, id, technicianToken)) === 403);
    report(`${collection}: admin CREATE denied`, (await createDoc(collection, `${id}-create`, adminToken)) === 403);
    report(`${collection}: dispatcher UPDATE denied`, (await updateDoc(collection, id, dispatcherToken)) === 403);
    report(`${collection}: admin DELETE denied`, (await deleteDoc(collection, id, adminToken)) === 403);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
