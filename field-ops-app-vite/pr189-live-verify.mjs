// PR #189 live Rules verification (commit ba7c429). HARDENED, reversible.
// RUN YOURSELF from field-ops-app-vite/ with your own dispatcher credential
// (e.g. via the PowerShell wrapper that Read-Host's the secrets and clears
// them in finally). Secrets/IDs come from env and are NEVER printed.
//   DISPATCHER_EMAIL, DISPATCHER_PASSWORD, TEST_ACCOUNT_ID,
//   EXPECTED_ACCOUNT_NAME, UNRELATED_FIELD=notes
//
// It: (1) refuses any project but taylor-parts; (2) requires the signed-in
// role to be EXACTLY 'dispatcher' (blocks admin/other, and thus any accidental
// admin mutation of governed fields); (3) confirms the resolved test-Account
// name; (4) tracks value AND presence per field; attempts paymentTerms/taxStatus
// changes (expected DENIED, values unchanged) and one 'notes' change (expected
// allowed); (5) in finally restores every attempted field, deleteField() for
// originally-absent ones; (6) prints only the resolved name + statuses -- no
// secrets, raw IDs, or original field contents; (7) re-reads and proves exact
// value+presence restoration before PASS, exiting 2 if restoration isn't proven.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, updateDoc, deleteField } from "firebase/firestore";

// Public client config (same values as src/firebase/firebase.js; client apiKey
// is a public identifier, not a secret).
const firebaseConfig = {
  apiKey: "AIzaSyATXIiI5C1mLmsvS0k-x3i7ZxAbAPtRpSY",
  authDomain: "taylor-parts.firebaseapp.com",
  projectId: "taylor-parts",
  storageBucket: "taylor-parts.firebasestorage.app",
  messagingSenderId: "664399427363",
  appId: "1:664399427363:web:de29dd9ae77bf548907e96",
};

// (1) Project guard.
if (firebaseConfig.projectId !== "taylor-parts") { console.error("STOP: projectId is not exactly 'taylor-parts'."); process.exit(1); }

const env = process.env, UNRELATED = env.UNRELATED_FIELD || "notes";
// Only 'notes' is authorized as the harmless unrelated field.
if (UNRELATED !== "notes") { console.error("STOP: only notes is authorized."); process.exit(1); }
for (const k of ["DISPATCHER_EMAIL", "DISPATCHER_PASSWORD", "TEST_ACCOUNT_ID", "EXPECTED_ACCOUNT_NAME"])
  if (!env[k]) { console.error(`STOP: missing env ${k}`); process.exit(1); }

const PT = ["COD", "NET_30", "NET_60", "NET_90"], TS = ["UNKNOWN", "TAXABLE", "EXEMPT", "RESELLER"];
const has = (o, f) => Object.prototype.hasOwnProperty.call(o, f);
const eq = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);
const { user } = await signInWithEmailAndPassword(auth, env.DISPATCHER_EMAIL, env.DISPATCHER_PASSWORD);

// (2) Require role EXACTLY 'dispatcher'.
const role = (await getDoc(doc(db, "users", user.uid))).data()?.role ?? null;
if (role !== "dispatcher") { console.error(`STOP: authenticated role must be exactly 'dispatcher' (got '${role}').`); process.exit(1); }

const ref = doc(db, "accounts", env.TEST_ACCOUNT_ID);
const snap0 = await getDoc(ref);
if (!snap0.exists()) { console.error("STOP: test Account not found."); process.exit(1); }
const d0 = snap0.data();
// (3) Confirm the resolved dedicated test-Account name.
if (d0.name !== env.EXPECTED_ACCOUNT_NAME) { console.error("STOP: resolved Account name != EXPECTED_ACCOUNT_NAME."); process.exit(1); }
const acctName = d0.name;

// (4) Track value AND presence separately for every field we may touch.
const orig = {};
for (const f of ["paymentTerms", "taxStatus", UNRELATED]) orig[f] = { present: has(d0, f), value: d0[f] };
const restoreOp = (f) => (orig[f].present ? orig[f].value : deleteField());

const attempted = new Set(), R = {};
const tryChange = async (f, list) => {
  attempted.add(f);
  const v = list.find((x) => x !== orig[f].value) ?? list[0];
  try { await updateDoc(ref, { [f]: v }); return "ALLOWED (unexpected)"; }
  catch (e) { return e.code === "permission-denied" ? "denied" : `error:${e.code}`; }
};

const restoreErrors = [];
try {
  R.paymentTerms = await tryChange("paymentTerms", PT);
  R.taxStatus = await tryChange("taxStatus", TS);
  const mid = (await getDoc(ref)).data();
  R.ptUnchanged = eq(mid.paymentTerms, orig.paymentTerms.value) && has(mid, "paymentTerms") === orig.paymentTerms.present;
  R.tsUnchanged = eq(mid.taxStatus, orig.taxStatus.value) && has(mid, "taxStatus") === orig.taxStatus.present;

  attempted.add(UNRELATED);
  try { await updateDoc(ref, { [UNRELATED]: `verify-${Date.now()}` }); R.unrelated = "succeeded"; }
  catch (e) { R.unrelated = `denied:${e.code}`; }
} finally {
  // (5) Restore ALL attempted fields (governed too, if unexpectedly changed);
  //     deleteField() for originally-absent fields.
  for (const f of attempted) { try { await updateDoc(ref, { [f]: restoreOp(f) }); } catch { restoreErrors.push(f); } }
}

// (7) Re-read and PROVE exact restoration (value + presence).
const after = (await getDoc(ref)).data();
const restoredExactly = [...attempted].every((f) => has(after, f) === orig[f].present && (!orig[f].present || eq(after[f], orig[f].value)));
const restorationOk = restoreErrors.length === 0 && restoredExactly;

// (6) Report: resolved NAME + statuses only. No secrets, no raw IDs, no original contents.
console.log(`Account: "${acctName}"  (authenticated role: dispatcher)`);
console.log(`  paymentTerms change -> ${R.paymentTerms} | value+presence unchanged: ${R.ptUnchanged}`);
console.log(`  taxStatus    change -> ${R.taxStatus} | value+presence unchanged: ${R.tsUnchanged}`);
console.log(`  unrelated 'notes' write -> ${R.unrelated}`);
console.log(`  restoration -> ${restorationOk ? "exact (value+presence) confirmed" : `FAILED${restoreErrors.length ? ` [${restoreErrors.length} field(s) not restored]` : ""}`}`);
if (!restorationOk) { console.error("\nSTOP: restoration not proven -- an ADMIN may be needed to restore. Do NOT ignore."); process.exit(2); }
const pass = R.paymentTerms === "denied" && R.taxStatus === "denied" && R.ptUnchanged && R.tsUnchanged && R.unrelated === "succeeded" && restorationOk;
console.log(`\n${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
