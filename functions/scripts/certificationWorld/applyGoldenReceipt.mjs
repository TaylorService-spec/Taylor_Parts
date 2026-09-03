#!/usr/bin/env node
// ONE BOUNDED GOVERNED RECEIPT against ONE named purchase-order line.
//
// ============================ WHY THIS FILE EXISTS ============================
//
// The Certification program had every piece of a governed receipt and no way to perform one
// against a live project. executeG03Receipt.mjs holds the real machinery -- receiveAs() drives
// receiveInventoryStockProduction with real authorization, the real Part authority and the real
// audit stager -- but it is a SCENARIO script: it says "EMULATOR ONLY" in a comment, enforces
// nothing, resolves no execution target, and pins its clock to a fixed instant. Running it at a
// live project would have written a receipt stamped with a date the receipt did not happen on.
//
// The alternative was an ad-hoc Admin-SDK write, which is not a ceremony -- it is a document that
// looks like one, with no capability check, no warehouse validation and no audit event.
//
// So this adds the ONE thing that was missing: a bounded entry point. It contains no receiving
// logic of its own. Every decision -- may this actor receive, does this warehouse exist, is this
// order receivable, how much is still outstanding, what the ledger movement looks like -- is made
// by the product, exactly as it is for a receiving clerk with a scanner.
//
// ============================ WHAT BOUNDED MEANS HERE ============================
//
// One purchase order. One line. One quantity, stated explicitly and never inferred. Anything else
// present in the world is not read: only the named order is fetched, so no other order can be
// touched by this invocation.
//
// WHAT THIS DOES NOT DO, stated because the opposite would be easy to assume: it does not refuse
// the APPROVED trap order. APPROVED is genuinely receivable -- that is precisely what
// APPROVED_TRAP_NOT_INBOUND exists to demonstrate, an order that IS receivable and is deliberately
// NOT inbound. A tool that refused it on status would contradict the domain it is meant to
// exercise, and a tool that refused it by hardcoded id would carry fixture knowledge that rots.
// The protection is instead that the scope block prints the order's certIntent before any write,
// so a mistyped id is caught by a human reading one line.
//
// DRY RUN BY DEFAULT, and the dry run PROVES its scope rather than describing it -- it resolves the
// order through the canonical normalizer, names the exact line it would affect, and reports the
// outstanding quantity the SERVER will derive. A dry run that cannot prove all of that REFUSES.
//
// A live write requires BOTH --apply and the target's own live flag, the same rule the world
// rebuild and the additive upgrade carry, because a receipt moves real stock.
//
// Usage:
//   node scripts/certificationWorld/applyGoldenReceipt.mjs --projectId eos-platform-certification \
//     --purchaseOrderId <id> --partId <id> --quantity 10
//   ... --apply --apply-live-certification        (adds the live write)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused, assertBothLiveFlags } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } = await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { normalizeCanonicalPurchaseOrder, deriveReceiptState } =
  await import(L("functions/lib/purchasing/purchaseOrderNormalization.js"));
const { RECEIVABLE_CANONICAL_STATUSES } =
  await import(L("functions/lib/inventoryReceiving/receivingSourceResolver.js"));
const { receiveAs, pickReceiver, buildReceiptRequest, RECEIVING_LOCATION } =
  await import(L("functions/scripts/certificationWorld/executeG03Receipt.mjs"));

const RECEIVING_ORDERS = "receiving_orders";
const PURCHASE_ORDERS = "purchase_orders";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");

/**
 * The receipt this invocation is allowed to perform. PURE.
 *
 * Every value is STATED. Nothing is defaulted, and nothing is derived from "the only PO that looks
 * ready" -- a tool that picks its own target is a tool that can pick the wrong one.
 */
export function parseReceiptRequest(args) {
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const purchaseOrderId = get("--purchaseOrderId");
  const partId = get("--partId");
  const raw = get("--quantity");
  if (!purchaseOrderId) throw new Error("--purchaseOrderId is required. There is no default order.");
  if (!partId) throw new Error("--partId is required. A line is named, never inferred.");
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`--quantity must be a positive whole number, got ${JSON.stringify(raw)}`);
  }
  return { purchaseOrderId, partId, quantity };
}

/**
 * Deterministic per (order, line, quantity, attempt-free) so a rerun is recognised as a REPLAY by
 * the service rather than committing a second receipt. The quantity is part of the key on purpose:
 * two different partial receipts of the same line are different events and must not collide.
 */
export function receiptIdempotencyKey({ purchaseOrderId, lineId, quantity }) {
  return `cw_recv_${purchaseOrderId}_${lineId}_${quantity}`;
}

/**
 * Resolve the exact line, and prove the receipt is possible, WITHOUT writing.
 *
 * Returns a plan or throws. The throw is the point: an unprovable scope must refuse rather than
 * proceed on a guess.
 */
export function planReceipt({ purchaseOrderId, partId, quantity }, poData, receipts) {
  const canonical = normalizeCanonicalPurchaseOrder(purchaseOrderId, poData);
  if (!RECEIVABLE_CANONICAL_STATUSES.includes(canonical.status)) {
    throw new Error(`purchase order ${purchaseOrderId} is ${canonical.status}, which is not receivable `
      + `(receivable: ${RECEIVABLE_CANONICAL_STATUSES.join(", ")})`);
  }
  const matching = canonical.lines.filter((l) => l.partId === partId);
  if (matching.length === 0) throw new Error(`no line on ${purchaseOrderId} carries part ${partId}`);
  if (matching.length > 1) {
    throw new Error(`${matching.length} lines on ${purchaseOrderId} carry part ${partId} -- ambiguous, refusing`);
  }
  const line = matching[0];
  const derived = deriveReceiptState(canonical, receipts);
  const state = derived.lines.find((l) => l.lineId === line.lineId);
  const outstanding = state?.remainingQuantity ?? line.quantity;
  if (quantity > outstanding) {
    throw new Error(`receiving ${quantity} exceeds the ${outstanding} still outstanding on line ${line.lineId}`);
  }
  return {
    purchaseOrderId, lineId: line.lineId, partId, quantity,
    orderedQuantity: line.quantity,
    outstandingBefore: outstanding,
    outstandingAfter: outstanding - quantity,
    partial: quantity < outstanding,
    status: canonical.status,
    destination: { ...RECEIVING_LOCATION },
    idempotencyKey: receiptIdempotencyKey({ purchaseOrderId, lineId: line.lineId, quantity }),
  };
}

let target = null;
try {
  target = resolveExecutionTarget();
  setExecutionTarget(target);
} catch (err) {
  if (!(err instanceof ExecutionTargetRefused)) throw err;
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}

if (target) {
  console.log(describeTarget(target));
  // A receipt moves real stock. Same both-flags rule the world rebuild and the additive upgrade
  // carry -- neither word alone reaches live inventory.
  if (target.apply || APPLY) {
    try {
      assertBothLiveFlags({ target, argv: process.argv, act: "A governed receipt that writes" });
    } catch (err) {
      if (!(err instanceof ExecutionTargetRefused)) throw err;
      console.error(`REFUSED: ${err.message}`);
      process.exitCode = 1;
      target = null;
    }
  }
}

if (target) {
  const request = parseReceiptRequest(argv);
  if (!getApps().length) {
    initializeApp(target.isEmulator
      ? { projectId: target.projectId }
      : { credential: applicationDefault(), projectId: target.projectId });
  }
  const db = getFirestore();
  console.log(`mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const poSnap = await db.collection(PURCHASE_ORDERS).doc(request.purchaseOrderId).get();
  if (!poSnap.exists) throw new Error(`purchase order ${request.purchaseOrderId} does not exist`);

  // Committed receipts for THIS order only -- the outstanding quantity the server will derive.
  const receiptSnap = await db.collection(RECEIVING_ORDERS)
    .where("source.purchaseOrderId", "==", request.purchaseOrderId).get();
  const receipts = receiptSnap.docs.map((d) => {
    const data = d.data() ?? {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    return {
      receivingId: d.id,
      lines: lines.map((l) => ({
        lineId: String(l?.lineId ?? ""),
        receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
      })),
    };
  });

  const plan = planReceipt(request, poSnap.data(), receipts);
  console.log("SCOPE -- exactly what this invocation would affect, and nothing else:");
  console.log(`  purchase order   ${plan.purchaseOrderId}  (status ${plan.status})`);
  // THE INTENT IS PRINTED, and it is not decoration. APPROVED is genuinely receivable -- that is
  // the whole point of the APPROVED_TRAP_NOT_INBOUND order, which is receivable and deliberately
  // not inbound. So this tool CANNOT refuse it on status without contradicting the domain. What it
  // can do is say out loud which order the operator is about to receive, before they add --apply.
  // A mistyped id is caught by a human reading one line, not by a hardcoded fixture id in a tool.
  console.log(`  intent           ${poSnap.data()?.certIntent ?? "(none recorded)"}`);
  console.log(`  line             ${plan.lineId}  part ${plan.partId}`);
  console.log(`  ordered          ${plan.orderedQuantity}`);
  console.log(`  outstanding      ${plan.outstandingBefore} -> ${plan.outstandingAfter}`);
  console.log(`  receiving        ${plan.quantity}  (${plan.partial ? "PARTIAL" : "COMPLETES THE LINE"})`);
  console.log(`  destination      ${plan.destination.type} ${plan.destination.locationId}`);
  console.log(`  idempotency key  ${plan.idempotencyKey}`);
  console.log(`  other orders     UNREAD and UNTOUCHED -- only ${plan.purchaseOrderId} was fetched\n`);

  const receiver = await pickReceiver(db);
  console.log(`receiver : ${receiver.employeeId} (${receiver.uid}) via ${receiver.roles.join("/")}\n`);

  if (!APPLY) {
    console.log("DRY RUN -- nothing written.");
  } else {
    const result = await receiveAs(db, receiver.employeeId,
      buildReceiptRequest({ ...plan, idempotencyKey: plan.idempotencyKey }),
      { now: () => new Date() });
    console.log(result.ok
      ? `RECEIVED: ${JSON.stringify(result.outcome)}`
      : `REFUSED BY THE SERVICE: ${result.code} -- ${result.message}`);
    if (!result.ok) process.exitCode = 1;
  }
}
