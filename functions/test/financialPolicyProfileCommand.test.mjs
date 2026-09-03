// CERT-FIN-02 -- the trusted financial policy command, against the Firestore emulator.
//
// The point of this file is ONE claim: the lock is enforced by the BACKEND, not by a disabled
// button. Every test here sends a well-formed request from an already-authorized caller and proves
// the command refuses it because of stored state, which is the only kind of protection that survives
// a crafted request, a stale tab or a direct callable invocation.
//
// Run: npm run test:financialPolicyCommand   (needs the Firestore emulator)
import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= "taylor-parts";

const {
  configureFinancialPolicyProfile,
  activateFinancialPolicyProfile,
  readFinancialPolicyProfile,
  FINANCIAL_POLICY_PROFILES_COLLECTION,
} = await import("../lib/finance/financialPolicyProfileCommand.js");
const { FinancialPolicyError } = await import("../lib/finance/financialPolicyProfile.js");

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore(app);

const deps = (over = {}) => ({ db, now: new Date("2026-09-03T12:00:00Z"), actorUid: "uid-deployer", ...over });

const APPROVAL = {
  approvedBy: "A. Accountant",
  approvedOn: "2026-09-03",
  reference: "deployment packet 7",
  recordedByUid: "uid-deployer",
};

function draft(companyId, over = {}) {
  return {
    operatingCompanyId: companyId,
    status: "DRAFT",
    inventoryCostMethod: "WEIGHTED_AVERAGE",
    serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION",
    cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT",
    freightTreatment: "EXCLUDED",
    landedCostTreatment: "EXCLUDED",
    approval: null,
    ...over,
  };
}

let seq = 0;
const nextCompany = () => `test-co-${Date.now()}-${seq++}`;

test.after(async () => {
  await deleteApp(app);
});

test("a draft profile is created, then read back exactly as configured", async () => {
  const co = nextCompany();
  const out = await configureFinancialPolicyProfile(draft(co), deps());
  assert.equal(out.outcome, "applied");
  assert.equal(out.profile.version, 1);

  const stored = await readFinancialPolicyProfile(co, db);
  assert.equal(stored.status, "DRAFT");
  assert.equal(stored.inventoryCostMethod, "WEIGHTED_AVERAGE");
  assert.equal(stored.serializedInventoryCostMethod, "SPECIFIC_IDENTIFICATION");
  assert.equal(stored.updatedByUid, "uid-deployer");
});

test("an unconfigured company reads as null -- never a fabricated default policy", async () => {
  assert.equal(await readFinancialPolicyProfile(nextCompany(), db), null);
});

test("a draft can be revised, and each revision increments the version", async () => {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co), deps());
  const second = await configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "FIFO" }), deps());
  assert.equal(second.profile.version, 2);
  assert.equal((await readFinancialPolicyProfile(co, db)).inventoryCostMethod, "FIFO");
});

test("DRAFT -> APPROVED requires recorded accounting approval", async () => {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co), deps());
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { status: "APPROVED", approval: null }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "APPROVAL_REQUIRED",
  );
  const ok = await configureFinancialPolicyProfile(draft(co, { status: "APPROVED", approval: APPROVAL }), deps());
  assert.equal(ok.profile.status, "APPROVED");
});

test("activation is refused while the profile is still a DRAFT", async () => {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co), deps());
  await assert.rejects(
    () => activateFinancialPolicyProfile({ operatingCompanyId: co }, deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "TRANSITION_ILLEGAL",
  );
});

test("activating a company that has no profile is refused, not silently created", async () => {
  await assert.rejects(
    () => activateFinancialPolicyProfile({ operatingCompanyId: nextCompany() }, deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_MALFORMED",
  );
});

// ============================ THE LOCK ============================

async function lockedCompany() {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co, { status: "APPROVED", approval: APPROVAL }), deps());
  const activated = await activateFinancialPolicyProfile({ operatingCompanyId: co }, deps());
  assert.equal(activated.profile.status, "LOCKED");
  return co;
}

test("APPROVED -> LOCKED activates, and the stored status says so", async () => {
  const co = await lockedCompany();
  assert.equal((await readFinancialPolicyProfile(co, db)).status, "LOCKED");
});

test("BACKEND ENFORCEMENT: a locked profile refuses a well-formed configure request", async () => {
  const co = await lockedCompany();
  // Exactly the request an authorized deployer would send, from the same code path the screen uses.
  // Nothing about it is malformed. It is refused purely because of the stored status.
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "FIFO" }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
    "a disabled button is not the protection -- the command is",
  );
  assert.equal(
    (await readFinancialPolicyProfile(co, db)).inventoryCostMethod,
    "WEIGHTED_AVERAGE",
    "the refused write must have staged nothing",
  );
});

test("BACKEND ENFORCEMENT: a locked profile cannot be walked back to DRAFT or APPROVED", async () => {
  const co = await lockedCompany();
  for (const status of ["DRAFT", "APPROVED"]) {
    await assert.rejects(
      () => configureFinancialPolicyProfile(draft(co, { status, approval: APPROVAL }), deps()),
      (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
      `LOCKED -> ${status} must not exist`,
    );
  }
});

test("there is no unlock command in the module's surface", async () => {
  const surface = await import("../lib/finance/financialPolicyProfileCommand.js");
  const names = Object.keys(surface).join(" ").toLowerCase();
  for (const forbidden of ["unlock", "reopen", "force", "override", "reset"]) {
    assert.equal(names.includes(forbidden), false, `the command surface must not export anything named "${forbidden}"`);
  }
});

test("re-activating an already-locked profile is idempotent, not an error and not an edit", async () => {
  const co = await lockedCompany();
  const again = await activateFinancialPolicyProfile({ operatingCompanyId: co }, deps());
  assert.equal(again.outcome, "unchanged");
  assert.equal(again.profile.status, "LOCKED");
  // A retried activation must not bump the version -- nothing was written.
  const stored = await readFinancialPolicyProfile(co, db);
  assert.equal(stored.version, again.profile.version);
});

test("configure cannot be used as a back door to activation", async () => {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co, { status: "APPROVED", approval: APPROVAL }), deps());
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { status: "LOCKED", approval: APPROVAL }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "TRANSITION_ILLEGAL",
    "locking is its own governed act, not a status somebody types into a config form",
  );
});

// ============================ COMPANY PARTITION ============================

test("profiles are per operating company and never leak across the boundary", async () => {
  const a = nextCompany();
  const b = nextCompany();
  await configureFinancialPolicyProfile(draft(a, { inventoryCostMethod: "WEIGHTED_AVERAGE" }), deps());
  await configureFinancialPolicyProfile(draft(b, { inventoryCostMethod: "FIFO" }), deps());
  assert.equal((await readFinancialPolicyProfile(a, db)).inventoryCostMethod, "WEIGHTED_AVERAGE");
  assert.equal((await readFinancialPolicyProfile(b, db)).inventoryCostMethod, "FIFO");

  // Locking one company must not lock the other.
  await configureFinancialPolicyProfile(draft(a, { status: "APPROVED", approval: APPROVAL }), deps());
  await activateFinancialPolicyProfile({ operatingCompanyId: a }, deps());
  assert.equal((await readFinancialPolicyProfile(a, db)).status, "LOCKED");
  assert.equal((await readFinancialPolicyProfile(b, db)).status, "DRAFT");
  const stillEditable = await configureFinancialPolicyProfile(draft(b, { inventoryCostMethod: "WEIGHTED_AVERAGE" }), deps());
  assert.equal(stillEditable.outcome, "applied");
});

// ============================ POLICY NEVER TOUCHES THE FACTS ============================

test("configuring a policy writes only the profile document -- no cost fact is touched", async () => {
  const co = nextCompany();
  const before = (await db.collection("inventory_acquisition_costs").limit(5).get()).docs.map((d) => d.id).sort();
  await configureFinancialPolicyProfile(draft(co), deps());
  await configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "FIFO" }), deps());
  const after = (await db.collection("inventory_acquisition_costs").limit(5).get()).docs.map((d) => d.id).sort();
  assert.deepEqual(after, before, "selecting an accounting policy must not mutate the historical facts it applies to");

  const profileDocs = await db.collection(FINANCIAL_POLICY_PROFILES_COLLECTION).doc(co).get();
  assert.equal(profileDocs.exists, true);
});

test("an unsupported method is refused before anything is written", async () => {
  const co = nextCompany();
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "LIFO" }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "METHOD_UNSUPPORTED",
  );
  assert.equal(await readFinancialPolicyProfile(co, db), null, "a refused configure stages nothing");
});

test("a blocked COGS recognition point is refused before anything is written", async () => {
  const co = nextCompany();
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "RECOGNITION_UNAVAILABLE",
  );
  assert.equal(await readFinancialPolicyProfile(co, db), null);
});

// ============================ THE LOCK BEATS ADMIN AND OWNER ============================
//
// Owner ruling (financial-policy authority): once LOCKED, the ordinary configuration command MUST
// refuse everyone, admin and owner included. That is not a limit on Admin authority -- it is a
// governed financial boundary, and the distinction only means anything if it is enforced on stored
// state rather than in a UI.
//
// The command deliberately takes no principal: authorization happens at the callable boundary, and
// by the time a request reaches here the caller has ALREADY been authorized. So these cases are the
// strongest form of the claim available -- a fully authorized caller, a well-formed request, and a
// refusal that comes only from what is stored.

test("LOCK: an already-authorized caller (admin/owner) is still refused on a locked profile", async () => {
  const co = await lockedCompany();
  for (const actorUid of ["uid-admin", "uid-owner"]) {
    await assert.rejects(
      () => configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "FIFO" }), deps({ actorUid })),
      (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
      `${actorUid}: holding financialPolicy.profile.configure must not reach a locked policy`,
    );
  }
  const stored = await readFinancialPolicyProfile(co, db);
  assert.equal(stored.inventoryCostMethod, "WEIGHTED_AVERAGE", "no refused write may have landed");
  assert.equal(stored.status, "LOCKED");
});

test("LOCK: the refusal is on STORED state -- locking between read and write still refuses", async () => {
  const co = nextCompany();
  await configureFinancialPolicyProfile(draft(co, { status: "APPROVED", approval: APPROVAL }), deps());
  // The operator opened an editable profile. It is activated underneath them, exactly as a second
  // administrator finishing a deployment would do.
  await activateFinancialPolicyProfile({ operatingCompanyId: co }, deps());
  // Their save now arrives against a locked profile. A client-side check made before activation
  // would have let this through; the transaction re-read does not.
  await assert.rejects(
    () => configureFinancialPolicyProfile(draft(co, { inventoryCostMethod: "FIFO", status: "APPROVED", approval: APPROVAL }), deps()),
    (e) => e instanceof FinancialPolicyError && e.code === "PROFILE_LOCKED",
    "a stale tab must not be able to edit a policy that locked while it was open",
  );
});

test("LOCK: there is no argument, flag or field through which a caller can claim a bypass", async () => {
  const co = await lockedCompany();
  for (const attempt of [
    { force: true },
    { override: true },
    { unlock: true },
    { admin: true },
    { bypassLock: true },
  ]) {
    await assert.rejects(
      () => configureFinancialPolicyProfile({ ...draft(co), ...attempt }, deps()),
      (e) =>
        e instanceof FinancialPolicyError &&
        // Refused either as an unknown field (the validator) or as a locked profile (the command).
        // Both are correct; what must never happen is that one of these words does something.
        (e.code === "PROFILE_MALFORMED" || e.code === "PROFILE_LOCKED"),
      `"${Object.keys(attempt)[0]}" must not be a bypass`,
    );
  }
  assert.equal((await readFinancialPolicyProfile(co, db)).inventoryCostMethod, "WEIGHTED_AVERAGE");
});
