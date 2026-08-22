#!/usr/bin/env node
// APPLY THE MOVEMENT PLAN — through the canonical ledger service, never around it.
//
// ============================ THE ONE RULE ============================
//
// Every movement goes through `stageOperationalMovement`. That function validates the envelope,
// derives the document id from the idempotency key, refuses a replay whose payload changed, and
// refuses a stored record whose fingerprint disagrees with its own contents.
//
// Writing the ledger documents directly would skip all four and produce a world the product could
// not have created -- a fixture more authoritative than the system it exists to test. The point of
// a certification world is that the application could have built it.
//
// ============================ VALIDATE EVERYTHING BEFORE MUTATING ANYTHING ============================
//
// The whole plan is staged against a dry store first. A plan that is going to fail on movement 140
// must fail before movement 1 is committed, because a half-applied inventory world is worse than an
// unapplied one: balances reconcile to nothing, and the failure looks like a data problem rather
// than a plan problem.
//
// ============================ SAFETY ============================
//
//   * DRY RUN BY DEFAULT. Writes only with --apply.
//   * SANDBOX OR EMULATOR ONLY. Production refused unconditionally; there is no override flag.
//   * NO DEFAULT PROJECT. A tool that picks a target when you forget to name one will eventually
//     pick the wrong one.
//   * IDEMPOTENT BY CONSTRUCTION. Keys are pure functions of intent, so a second run replays rather
//     than duplicating -- and the run reports `alreadyApplied` rather than pretending it did work.
//
// Usage:
//   node scripts/certificationWorld/applyInventoryPlan.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/applyInventoryPlan.mjs --projectId eos-platform-sandbox --apply
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildInventoryPlan, projectBalances } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const ledger = await import(L("functions/lib/inventoryLedger/operationalMovementRepository.js"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");
const PROJECT_ID = flag("--projectId");

/** The ledger collection the repository writes into. */
const LEDGER_COLLECTION = "inventory_transactions";

function assertSafeTarget(projectId) {
  if (!projectId) throw new Error("--projectId is required. There is no default target for inventory movements.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  // An emulator target is named explicitly rather than inferred, so a typo cannot resolve to a real
  // project by accident.
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!env && !isEmulator) throw new Error(`Unknown project "${projectId}" -- not in config/environments.json. Refusing.`);
  if (env?.role === "production") throw new Error(`"${projectId}" is PRODUCTION. This tool never writes production inventory.`);
  if (env && env.role !== "sandbox") throw new Error(`"${projectId}" has role "${env.role}". Sandbox or emulator only.`);
  return { projectId, role: env?.role ?? "emulator", isEmulator };
}

/**
 * The store stageOperationalMovement expects, backed by a real transaction.
 *
 * WRITES ARE BUFFERED, not issued as they are staged. Firestore requires every read in a
 * transaction to precede every write, and the service reads-then-creates per movement -- so
 * committing movement 1 before reading movement 2 fails the transaction outright:
 * "transactions require all reads to be executed before all writes".
 *
 * This is the same shape transferOrderCommand.ts uses for the same reason. Buffering keeps the
 * read/create protocol the service expects while satisfying the constraint the database imposes,
 * and the buffered writes are flushed once every read in the batch has happened.
 */
function bufferedTransactionStore(db, txn) {
  const coll = db.collection(LEDGER_COLLECTION);
  const writes = [];
  return {
    async read(docId) {
      const snap = await txn.get(coll.doc(docId));
      return snap.exists ? (snap.data() ?? null) : null;
    },
    create(docId, data) {
      writes.push({ ref: coll.doc(docId), data });
    },
    flush() {
      for (const w of writes) txn.create(w.ref, w.data);
      return writes.length;
    },
  };
}
/** A store that reads real state but discards writes -- for validating the plan before committing. */
function dryStore(db) {
  const coll = db.collection(LEDGER_COLLECTION);
  const wouldCreate = [];
  return {
    async read(docId) {
      const snap = await coll.doc(docId).get();
      return snap.exists ? snap.data() : null;
    },
    create(docId) { wouldCreate.push(docId); },
    wouldCreate,
  };
}

/**
 * The envelope the ledger accepts -- and ONLY that.
 *
 * The validator runs an unknown-field gate, so the event must not restate anything it derives or
 * takes from elsewhere. `direction` comes from MOVEMENT_DIRECTION[type]; `trackingMode` comes from
 * the `part` argument, not the event. Including either -- as the plan's own descriptor shape does,
 * for its own readability -- is rejected as unknown_field.
 *
 * `recordedAt` is never sent at all: it is reserved for the trusted server writer and is refused
 * outright.
 *
 * counterpartyLocation is permitted only on a transfer, which is why it is spread conditionally
 * rather than always present with an undefined value.
 */
const toEvent = (m, actor) => ({
  type: m.type,
  partId: m.partId,
  location: m.location,
  quantity: m.quantity,
  sourceObject: m.sourceObject,
  idempotencyKey: m.idempotencyKey,
  actor,
  occurredAt: m.occurredAt,
  ...(m.counterpartyLocation ? { counterpartyLocation: m.counterpartyLocation } : {}),
});

async function main() {
  const target = assertSafeTarget(PROJECT_ID);
  console.log(`target : ${target.projectId} (${target.isEmulator ? "EMULATOR" : `role=${target.role}`})`);
  console.log(`mode   : ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  const plan = buildInventoryPlan();

  // ── RESOLVE ACTORS. The plan names EMPLOYEES; the ledger wants principals.
  //
  // The fixture deliberately carries no Firebase UID -- a UID is environment state, and embedding
  // one would make the plan project-specific. The resolution happens here, against this
  // environment, and fails loudly if a named employee has no principal: attributing an inventory
  // movement to a person who cannot sign in would record an accountable act against nobody.
  const employeeSnap = await db.collection("employees").get();
  const uidByEmployee = new Map();
  for (const doc of employeeSnap.docs) {
    const uid = doc.data().userId;
    if (uid) uidByEmployee.set(doc.id, uid);
  }
  const unresolved = [...new Set(plan.map((m) => m.actorEmployeeId))].filter((e) => !uidByEmployee.has(e));
  if (unresolved.length) {
    console.error(`
FAILED: no principal for ${unresolved.length} actor(s): ${unresolved.join(", ")}`);
    console.error("Run the principal relink phase before applying inventory movements.");
    process.exitCode = 1;
    return;
  }
  const actorFor = (m) => ({ kind: "USER", id: uidByEmployee.get(m.actorEmployeeId) });
  const partIndex = new Map(CERT_PARTS.map((p) => [p.partId, p]));
  console.log(`planned movements: ${plan.length}`);

  // ── PHASE 1: validate the WHOLE plan before committing anything.
  const outcomes = { applied: 0, alreadyApplied: 0, refused: 0, failed: 0 };
  const refusals = [];
  const dry = dryStore(db);
  for (const m of plan) {
    const part = partIndex.get(m.partId);
    if (!part) { refusals.push({ key: m.idempotencyKey, reason: "unknown part" }); outcomes.refused += 1; continue; }
    try {
      const res = await ledger.stageOperationalMovement(
        dry, toEvent(m, actorFor(m)), { partId: part.partId, trackingMode: part.ledgerTrackingMode }, { now: new Date(m.occurredAt) },
      );
      if (res.outcome === "replayed") outcomes.alreadyApplied += 1; else outcomes.applied += 1;
    } catch (err) {
      refusals.push({ key: m.idempotencyKey, reason: err?.message || String(err) });
      outcomes.refused += 1;
    }
  }

  console.log(`validation: would apply ${outcomes.applied}, already applied ${outcomes.alreadyApplied}, refused ${outcomes.refused}`);
  if (refusals.length) {
    console.log("\nrefusals:");
    for (const r of refusals.slice(0, 15)) console.log(`  ${r.key}: ${r.reason}`);
    console.log("\nREFUSING TO APPLY -- the plan does not validate against current state.");
    process.exitCode = 1;
    return;
  }

  const balances = projectBalances(plan);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`\nplan implies: warehouse ${sum(balances.warehouse)}, `
    + `trucks ${[...balances.truck].filter(([k]) => !k.includes("@")).reduce((a, [, v]) => a + v, 0)}, `
    + `company ${sum(balances.company)}`);

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing written. Re-run with --apply to stage ${outcomes.applied} movement(s).`);
    return;
  }

  // ── PHASE 2: commit, in transaction-sized batches.
  //
  // Batched rather than one giant transaction: Firestore caps a transaction, and a plan that
  // outgrows it would fail at a size nobody tests at. Each batch is independently idempotent, so a
  // failure between batches leaves a partially applied plan that the NEXT run completes rather than
  // duplicates -- which is only true because the keys are deterministic.
  const BATCH = 20;
  let applied = 0, replayed = 0;
  for (let i = 0; i < plan.length; i += BATCH) {
    const slice = plan.slice(i, i + BATCH);
    await db.runTransaction(async (txn) => {
      const store = bufferedTransactionStore(db, txn);
      for (const m of slice) {
        const part = partIndex.get(m.partId);
        const res = await ledger.stageOperationalMovement(
          store, toEvent(m, actorFor(m)), { partId: part.partId, trackingMode: part.ledgerTrackingMode }, { now: new Date(m.occurredAt) },
        );
        if (res.outcome === "replayed") replayed += 1; else applied += 1;
      }
      // Every read in this batch is done; only now may anything be written.
      store.flush();
    });
    console.log(`  committed ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }

  console.log(`\napplied ${applied}, replayed ${replayed} (already present).`);
  const after = await db.collection(LEDGER_COLLECTION).count().get();
  console.log(`ledger documents now: ${after.data().count}`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\nFAILED: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
