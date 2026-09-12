// Operational reference numbering — LEGACY BACKFILL tool (OPERATOR-RUN, DRY-RUN BY DEFAULT).
//
// Covers every per-year business-number family in the system: Work Order (WO-YYYY-######,
// fieldops_wos.woNumber), Opportunity (OPP-), Sales Order (SO-), Sales Agreement (SA-), Transfer Order
// (TO-), Receiving Order (RO-) and Reorder Request (RR-). The three TO/RO/RR families came from this
// lane's original Owner ruling; Sales Order was added by the full-site certification; Work Order,
// Opportunity and Sales Agreement were added by P3-0B, which found they had been left out for scope
// reasons rather than because they were safe. Invoice (INV-) is deliberately NOT here: its counter is
// keyed per COMPANY, not per year, so it does not fit this tool's (family, year) shape -- see the
// Owner question in P3-0B's handoff before adding it.
//
// WHAT THIS DOES NOT DO. It never runs at create time — new records get their reference from
// transferOrderNumbering.ts / receivingOrderNumbering.ts / reorderRequestNumbering.ts, inside the SAME
// transaction as their own creation (transferOrderCommand.ts, receiveInventoryStockCommand.ts). This tool
// exists only to give legacy records (created before this field existed) a reference too, on an operator's
// explicit say-so — it is NEVER invoked automatically, has no callable, and nothing in functions/src imports
// it. It reuses the SAME format functions and the SAME per-year `counters` collection the live allocators
// use (imported from the compiled lib/, never reimplemented here) — a backfilled number and a live-allocated
// number are drawn from the identical sequence, so they can never collide with each other by construction
// (both increment the one authoritative counter doc for that (family, year)).
//
// SAFETY MODEL:
//   - DEFAULT: read-only report. Detects legacy records (missing the reference field), previews what each
//     WOULD receive, and checks the preview for collisions against numbers already in use. Writes nothing.
//   - --write is required to persist anything, and even then:
//       * refuses immediately unless the target project is either the Firestore emulator
//         (FIRESTORE_EMULATOR_HOST set) or a registry-known NON-production environment
//         (config/environments.json role !== "production"), OR
//       * for a registry-known PRODUCTION project, refuses unless BOTH `--confirm-production-write` is
//         passed AND the environment variable BACKFILL_PRODUCTION_OVERRIDE is set to the EXACT project id
//         being targeted -- a CLI flag alone is not a "separate protected authorization"; a second,
//         differently-sourced confirmation (an operator-set env var, not scriptable from the same command
//         line by accident) is required to ever write to production through this tool.
//       * refuses unconditionally for any project id NOT found in config/environments.json at all
//         (unknown target -> fail closed, never assume it's safe).
//   - IDEMPOTENT: each write is preceded, INSIDE its own transaction, by a fresh re-read of the target
//     record. If it already carries a reference (a prior run, or a live create that landed in the meantime),
//     the record is skipped -- never overwritten, never re-allocated. Running this tool twice in a row (or
//     concurrently with normal traffic) allocates each legacy record's number AT MOST ONCE.
//   - COLLISION-CHECKED: (1) at report time, every candidate number is checked against every reference value
//     already present in the collection (legacy or live); (2) at write time, immediately before assigning,
//     the exact candidate is re-queried live inside the same transaction -- if anything already carries it,
//     that single record is skipped and logged as a collision, and the run continues with the rest (a
//     collision on one record never blocks the batch).
//   - NEVER derived from the record's own document id, a Work Order number, a sibling family's number, or
//     an inventory transaction id -- exactly like the live allocators, every backfilled number comes only
//     from reading and incrementing the shared per-year counter doc.
//
// USAGE:
//   cd functions && npm run build          # this script imports the compiled lib/, same as the tests do
//   node scripts/backfillOperationalNumbering.mjs --project <id> [--family transferOrder|receivingOrder|reorderRequest] [--write] [--confirm-production-write] [--limit 500]
//
// Not executed against any real project by this lane -- verified against the local Firestore emulator only
// (see the handoff for the exact commands run and their output).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { formatTransferOrderNumber, transferOrderCounterDocId } = await import("../lib/inventoryTransfer/transferOrderNumbering.js");
const { formatReceivingOrderNumber, receivingOrderCounterDocId } = await import("../lib/inventoryReceiving/receivingOrderNumbering.js");
const { formatReorderRequestNumber, reorderRequestCounterDocId } = await import("../lib/reorderRequest/reorderRequestNumbering.js");
const { formatSalesOrderNumber, salesOrderCounterDocId } = await import("../lib/salesOrder/salesOrderNumbering.js");
const { formatWorkOrderNumber, workOrderCounterDocId } = await import("../lib/woNumbering.js");
const { formatOpportunityNumber, opportunityCounterDocId } = await import("../lib/opportunity/opportunityNumbering.js");
const { formatSalesAgreementNumber, salesAgreementCounterDocId } = await import("../lib/salesAgreement/salesAgreementNumbering.js");
const { COUNTERS_COLLECTION } = await import("../lib/constants/collections.js");
const { BUSINESS_NUMBER_CLAIMS_COLLECTION, claimDocId } = await import("../lib/numbering/businessNumber.js");

// ---- family registry: the one place that ties a collection to its field/format/counter -----------------
const FAMILIES = {
  // SALES ORDER. Added by the full-site certification. salesOrderReadService.ts documents that
  // Firestore's .orderBy() excludes any document missing the ordered field, so a Sales Order created
  // before the numbering rollout carries no `salesOrderNumber` and is INVISIBLE to the global list
  // read -- not filtered out after projection, but never returned by the query at all. It is the same
  // rule behind the Prospect regression that certification fixed on the write side.
  //
  // The WRITE path is already correct and is not what this addresses: salesOrderCallables.ts allocates
  // the number inside the SAME transaction as the document write, so a Sales Order can never appear
  // without one. Only records predating that rollout are affected, and the count can only be measured
  // against a real dataset -- run this tool with no flags to get it, which writes nothing.
  //
  // Added HERE rather than as a second migration script, so it inherits this tool's whole safety model
  // unchanged: dry-run by default, an idempotent per-record re-read inside the write transaction,
  // collision checks at both report and write time, and the production double-confirmation gate.
  salesOrder: {
    collection: "sales_orders",
    field: "salesOrderNumber",
    counterDocId: salesOrderCounterDocId,
    format: formatSalesOrderNumber,
  },
  // WORK ORDER. Added by P3-0B. Work Orders were the one family this tool did not cover, even though
  // WO-YYYY-###### is the most-spoken business number in the system and woNumbering.ts had the same
  // counter-loss defect as every other allocator. Nothing about the tool needed to change to accept it:
  // it is a per-year counter and a PREFIX-YYYY-###### format like the rest, and the format/counter-id
  // authorities are imported from the compiled lib/ so there is still exactly ONE definition of what a
  // Work Order number looks like.
  //
  // WHY IT WAS EXCLUDED BEFORE (established, not guessed): this tool was written by the lane that
  // introduced the Transfer Order / Receiving Order / Reorder Request families -- its own header says
  // "covers all three families this lane's Owner ruling introduced" -- and Sales Order was added later
  // by the full-site certification for a DIFFERENT reason (an unnumbered Sales Order is invisible to an
  // .orderBy() list read). Work Orders were never in either lane's scope. The exclusion was scope, not
  // a judgement that Work Orders were safe.
  workOrder: {
    collection: "fieldops_wos",
    field: "woNumber",
    counterDocId: workOrderCounterDocId,
    format: formatWorkOrderNumber,
  },
  opportunity: {
    collection: "opportunities",
    field: "opportunityNumber",
    counterDocId: opportunityCounterDocId,
    format: formatOpportunityNumber,
  },
  salesAgreement: {
    collection: "sales_agreements",
    field: "salesAgreementNumber",
    counterDocId: salesAgreementCounterDocId,
    format: formatSalesAgreementNumber,
  },
  transferOrder: {
    collection: "transfer_orders",
    field: "transferOrderNumber",
    counterDocId: transferOrderCounterDocId,
    format: formatTransferOrderNumber,
  },
  receivingOrder: {
    collection: "receiving_orders",
    field: "receivingOrderNumber",
    counterDocId: receivingOrderCounterDocId,
    format: formatReceivingOrderNumber,
  },
  reorderRequest: {
    // Not wired into any create path in functions/src today (see reorderRequestNumbering.ts's module
    // header) -- included here anyway so an operator can still ask "how many legacy records are there"
    // and preview what a future backfill would assign, without this tool inventing a create path it
    // has no authorization to build. --write against this family is fully supported (the field is just
    // a normal document field from Firestore's point of view), but nothing today CREATES a new
    // reorder_requests record with the field already set, so every reorder_requests record is "legacy"
    // until either a governed create path is built or this tool is run.
    collection: "reorder_requests",
    field: "reorderRequestNumber",
    counterDocId: reorderRequestCounterDocId,
    format: formatReorderRequestNumber,
  },
};
const UNKNOWN_YEAR_SENTINEL = 0; // never a real calendar year; used when createdAt isn't a real Timestamp

// ---- CLI args ---------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { write: false, confirmProductionWrite: false, limit: 2000, families: Object.keys(FAMILIES) };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project") args.project = argv[++i];
    else if (a === "--write") args.write = true;
    else if (a === "--confirm-production-write") args.confirmProductionWrite = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--family") args.families = [argv[++i]];
    else throw new Error(`unrecognized argument: ${a}`);
  }
  if (!args.project) throw new Error("--project is required (no default -- never accidentally target the default project)");
  for (const f of args.families) {
    if (!FAMILIES[f]) throw new Error(`unknown --family '${f}'; must be one of: ${Object.keys(FAMILIES).join(", ")}`);
  }
  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer");
  return args;
}

// ---- fail-closed production guard (read-only registry lookup; never mutates config/environments.json) ---
function loadRegistry() {
  return JSON.parse(readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
}
export function resolveEnvironmentRole(projectId, registry) {
  const env = (registry.environments || []).find((e) => e.firebase && e.firebase.projectId === projectId);
  return env ? env.role : null; // null = unknown project, never assumed safe
}
export function assertWriteAuthorized({ projectId, isEmulator, confirmProductionWrite, registry, productionOverrideEnv }) {
  if (isEmulator) return; // local Firestore emulator -- never production data, always authorized to write
  const role = resolveEnvironmentRole(projectId, registry);
  if (role === null) {
    throw new Error(`Refusing --write: '${projectId}' is not a registry-known environment (config/environments.json). Unknown target is never assumed safe.`);
  }
  if (role !== "production") return; // registry-known non-production (sandbox/integration) -- authorized
  // PRODUCTION requires BOTH the CLI flag AND a separately-sourced env var naming this exact project.
  if (!confirmProductionWrite) {
    throw new Error(`Refusing --write against PRODUCTION project '${projectId}': pass --confirm-production-write AND set BACKFILL_PRODUCTION_OVERRIDE='${projectId}'.`);
  }
  if (productionOverrideEnv !== projectId) {
    throw new Error(`Refusing --write against PRODUCTION project '${projectId}': BACKFILL_PRODUCTION_OVERRIDE is '${productionOverrideEnv ?? "(unset)"}', must exactly equal '${projectId}'.`);
  }
}

// ---- pure planning helpers (exported for tests) --------------------------------------------------------
export function classifyRecord(id, data, field) {
  const value = data[field];
  if (typeof value === "string" && value.trim() !== "") return { id, category: "ALREADY_NUMBERED" };
  const createdAt = data.createdAt;
  if (createdAt instanceof Timestamp) {
    return { id, category: "NEEDS_ASSIGNMENT", year: createdAt.toDate().getUTCFullYear(), createdAtMillis: createdAt.toMillis() };
  }
  return { id, category: "NEEDS_ASSIGNMENT", year: UNKNOWN_YEAR_SENTINEL, createdAtMillis: null };
}

function sortKey(c) {
  const yearPart = String(c.year).padStart(6, "0");
  const millisPart = c.createdAtMillis === null ? "9".repeat(20) : String(c.createdAtMillis).padStart(20, "0");
  return `${yearPart}:${millisPart}:${c.id}`;
}

// Deterministic plan: given every record + the CURRENT counter sequence per year + every reference value
// already in use, compute what each unnumbered record WOULD receive, sorted oldest-createdAt-first within
// each year (UNKNOWN_YEAR_SENTINEL records sort after every real year, ordered only by doc id -- there is
// no chronology to infer for them). A candidate that would collide with an existing value blocks the REST
// of that (family, year) -- same policy salesOrderNumberBackfill.ts established: once a year's sequence is
// in doubt, stop guessing for that year rather than silently skip ahead.
export function planBackfill(records, field, format, readCounterSequence) {
  const classified = records.map((r) => classifyRecord(r.id, r.data, field));
  const alreadyNumbered = classified.filter((c) => c.category === "ALREADY_NUMBERED");
  const existing = new Set();
  for (const r of records) {
    const v = r.data[field];
    if (typeof v === "string" && v.trim() !== "") existing.add(v);
  }
  const needsAssignment = classified
    .filter((c) => c.category === "NEEDS_ASSIGNMENT")
    .slice()
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  const runningSequence = new Map();
  const blockedYears = new Set();
  const assignments = [];
  const collisions = [];
  const blocked = [];

  for (const c of needsAssignment) {
    if (blockedYears.has(c.year)) { blocked.push({ id: c.id, year: c.year, reason: "YEAR_BLOCKED_BY_EARLIER_COLLISION" }); continue; }
    if (!runningSequence.has(c.year)) runningSequence.set(c.year, readCounterSequence(c.year));
    const nextSeq = runningSequence.get(c.year) + 1;
    const candidate = format(c.year, nextSeq);
    if (existing.has(candidate)) {
      collisions.push({ id: c.id, year: c.year, candidate, reason: "DUPLICATES_EXISTING_NUMBER" });
      blockedYears.add(c.year);
      continue;
    }
    runningSequence.set(c.year, nextSeq);
    existing.add(candidate);
    assignments.push({ id: c.id, year: c.year, sequence: nextSeq, number: candidate });
  }

  return {
    assignments,
    collisions,
    blocked,
    alreadyNumbered: alreadyNumbered.map((c) => c.id),
    counts: { total: classified.length, alreadyNumbered: alreadyNumbered.length, toAssign: assignments.length, collisions: collisions.length, blocked: blocked.length },
  };
}

// ---- sanitized reporting (doc ids only -- never any business field: no partId, no supplier, no location) -
function sanitizeId(id) {
  // Report-safe: first 8 chars + length, enough to cross-reference a specific record in Firestore console
  // without printing anything that could itself be a customer/supplier-identifying string.
  return `${id.slice(0, 8)}…(${id.length} chars)`;
}
function printReport(familyKey, family, plan) {
  console.log(`\n=== ${familyKey} (${family.collection}.${family.field}) ===`);
  console.log(`  total records scanned:     ${plan.counts.total}`);
  console.log(`  already numbered:          ${plan.counts.alreadyNumbered}`);
  console.log(`  legacy -> would assign:    ${plan.counts.toAssign}`);
  console.log(`  collisions (blocked):      ${plan.counts.collisions}`);
  console.log(`  blocked by year collision: ${plan.counts.blocked}`);
  for (const a of plan.assignments.slice(0, 20)) {
    console.log(`    ${sanitizeId(a.id)} -> ${a.number}${a.year === UNKNOWN_YEAR_SENTINEL ? " (no createdAt Timestamp -- sentinel year)" : ""}`);
  }
  if (plan.assignments.length > 20) console.log(`    ... and ${plan.assignments.length - 20} more`);
  for (const c of plan.collisions) {
    console.log(`    COLLISION: ${sanitizeId(c.id)} candidate ${c.candidate} already exists -- year ${c.year} blocked, resolve before --write`);
  }
}

// ---- Firestore I/O (paginated fetch; execute) ------------------------------------------------------------
async function fetchAll(db, collectionName, limit) {
  const out = [];
  let last = null;
  const PAGE = 500;
  while (out.length < limit) {
    let q = db.collection(collectionName).orderBy("__name__").limit(Math.min(PAGE, limit - out.length));
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) out.push({ id: doc.id, data: doc.data() });
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out;
}

async function readCounterSequenceOnce(db, family, year) {
  const snap = await db.collection(COUNTERS_COLLECTION).doc(family.counterDocId(year)).get();
  return snap.exists ? (snap.data().sequence ?? 0) : 0;
}

// Idempotent, collision-checked single-record assignment. Re-reads the target INSIDE its own transaction
// (never trusts the report's snapshot) -- so a record numbered by ANY means since the report was printed
// (a live create, a concurrent run of this same tool) is skipped, never overwritten.
async function assignOne(db, family, id) {
  return db.runTransaction(async (txn) => {
    const ref = db.collection(family.collection).doc(id);
    const snap = await txn.get(ref);
    if (!snap.exists) return { id, outcome: "SKIPPED_MISSING" };
    const data = snap.data();
    const existingValue = data[family.field];
    if (typeof existingValue === "string" && existingValue.trim() !== "") {
      return { id, outcome: "SKIPPED_ALREADY_NUMBERED", number: existingValue };
    }
    const createdAt = data.createdAt;
    const year = createdAt instanceof Timestamp ? createdAt.toDate().getUTCFullYear() : UNKNOWN_YEAR_SENTINEL;
    const counterRef = db.collection(COUNTERS_COLLECTION).doc(family.counterDocId(year));
    const counterSnap = await txn.get(counterRef);
    const sequence = counterSnap.exists ? (counterSnap.data().sequence ?? 0) + 1 : 1;
    const candidate = family.format(year, sequence);

    // Live collision guard: even though planBackfill already checked the report-time snapshot, re-check
    // right before assigning -- a bounded equality query on the field, participating in this transaction.
    const collisionSnap = await txn.get(db.collection(family.collection).where(family.field, "==", candidate).limit(1));
    if (!collisionSnap.empty) {
      return { id, outcome: "SKIPPED_COLLISION", candidate };
    }

    // CLAIM LEDGER (functions/src/numbering/businessNumber.ts). The live allocators claim every number
    // they issue, which is what makes a counter loss unable to reissue one. A number this tool assigns
    // must be claimed too -- otherwise a backfilled WO-2026-000001 would be invisible to the live
    // allocator's probe and could be handed out a second time. Read first (this transaction has not
    // written yet), so an already-claimed candidate SKIPS this one record instead of aborting the batch.
    const claimRef = db.collection(BUSINESS_NUMBER_CLAIMS_COLLECTION).doc(claimDocId(candidate));
    const claimSnap = await txn.get(claimRef);
    if (claimSnap.exists) {
      return { id, outcome: "SKIPPED_COLLISION", candidate };
    }

    txn.create(claimRef, {
      businessNumber: candidate,
      counterPath: `${COUNTERS_COLLECTION}/${family.counterDocId(year)}`,
      sequence,
      claimedAt: FieldValue.serverTimestamp(),
      claimedBy: "backfillOperationalNumbering",
    });
    txn.set(counterRef, { year, sequence, updatedAt: FieldValue.serverTimestamp() });
    txn.update(ref, { [family.field]: candidate });
    return { id, outcome: "ASSIGNED", number: candidate };
  });
}

// ---- main -------------------------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (args.write) {
    const registry = loadRegistry();
    assertWriteAuthorized({
      projectId: args.project,
      isEmulator,
      confirmProductionWrite: args.confirmProductionWrite,
      registry,
      productionOverrideEnv: process.env.BACKFILL_PRODUCTION_OVERRIDE,
    });
  }

  if (getApps().length === 0) initializeApp({ projectId: args.project });
  const db = getFirestore();

  console.log(`backfillOperationalNumbering.mjs -- project=${args.project} mode=${args.write ? "WRITE" : "DRY-RUN"} emulator=${isEmulator} families=${args.families.join(",")}`);

  for (const familyKey of args.families) {
    const family = FAMILIES[familyKey];
    const records = await fetchAll(db, family.collection, args.limit);
    const yearsSeen = new Set(records.map((r) => (r.data.createdAt instanceof Timestamp ? r.data.createdAt.toDate().getUTCFullYear() : UNKNOWN_YEAR_SENTINEL)));
    const counterCache = new Map();
    for (const y of yearsSeen) counterCache.set(y, await readCounterSequenceOnce(db, family, y));
    const plan = planBackfill(records, family.field, family.format, (y) => counterCache.get(y) ?? 0);
    printReport(familyKey, family, plan);

    if (!args.write) continue;
    if (plan.assignments.length === 0) { console.log(`  nothing to write for ${familyKey}.`); continue; }

    console.log(`  --write set: assigning ${plan.assignments.length} record(s) for ${familyKey}, one transaction each...`);
    const results = { ASSIGNED: 0, SKIPPED_ALREADY_NUMBERED: 0, SKIPPED_COLLISION: 0, SKIPPED_MISSING: 0 };
    for (const a of plan.assignments) {
      const r = await assignOne(db, family, a.id);
      results[r.outcome] = (results[r.outcome] ?? 0) + 1;
      if (r.outcome === "SKIPPED_COLLISION") console.log(`    COLLISION at write time: ${sanitizeId(a.id)} candidate ${r.candidate} already exists -- skipped, not overwritten`);
    }
    console.log(`  ${familyKey} write summary:`, results);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("backfillOperationalNumbering.mjs failed:", err.message);
    process.exitCode = 1;
  });
}
