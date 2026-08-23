#!/usr/bin/env node
// G03 INBOUND RECOVERY — the ordered lifecycle, executed once, against the real service.
//
// BEFORE -> refusal -> partial -> reread -> identical retry -> conflicting retry -> completion ->
// reread -> over-receipt refusal.
//
// Every step reads the world back through the authoritative projection rather than assuming its own
// write landed the way it intended. A lifecycle that trusts its own inputs proves the fixture is
// self-consistent and nothing else.
//
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { captureG03, renderG03, G03_PART_ID } =
  await import(L("functions/scripts/certificationWorld/g03Snapshot.mjs"));
const { receiveAs, pickReceiver, buildReceiptRequest } =
  await import(L("functions/scripts/certificationWorld/executeG03Receipt.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const LINE_ID = "L1";                 // the single canonical line, per the normalizer ordinal fallback
const PUT_AWAY_ONLY = "cw-emp-025";   // holds warehouse work, does NOT hold receive

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};
const save = (name, data) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));
};

// THE ONE GATE. Emulator and eos-platform-sandbox only; production refused two ways; a live
// write additionally requires --apply-live-sandbox. See executionTarget.mjs.
let __target;
try {
  __target = resolveExecutionTarget();
  setExecutionTarget(__target);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}
if (!__target) {
  // refused above
} else {
  console.log(describeTarget(__target));
  // Credentials follow the TARGET, not a hardcoded project. An emulator needs none; a live
  // project needs application-default credentials, and naming the project explicitly means the
  // app cannot silently initialize against whatever ADC happens to prefer.
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
  const db = getFirestore();

  // ══ BEFORE ═══════════════════════════════════════════════════════════════════════════════════
  const before = await captureG03(db, "BEFORE");
  console.log(renderG03(before) + "\n");
  if (before.received !== 0 || before.receiptCount !== 0) {
    console.error("REFUSING: G03 already has receipts. The lifecycle runs once against a clean baseline.");
    process.exitCode = 1;
  } else {
    save("g03-before.json", before);
    const PO = before.purchaseOrderId;

    // ══ THE ACTORS ═════════════════════════════════════════════════════════════════════════════
    const receiver = await pickReceiver(db);
    console.log(`receiving clerk on duty: ${receiver.employeeId} (${receiver.uid}) via ${receiver.roles.join("/")}\n`);

    // ══ NEGATIVE: warehouse work is not receiving authority ════════════════════════════════════
    //
    // Run FIRST, and against the same order and quantity the authorized receipt will use. A denial
    // proven on some other payload would leave open the possibility that the request, not the
    // person, was what the service objected to.
    console.log("-- a put-away operator attempts the receipt");
    const denied = await receiveAs(db, PUT_AWAY_ONLY, buildReceiptRequest({
      purchaseOrderId: PO, lineId: LINE_ID, partId: G03_PART_ID, quantity: 8,
      idempotencyKey: "cw-g03-denied-attempt",
    }));
    check(`${PUT_AWAY_ONLY} is REFUSED by the real service`, !denied.ok && denied.code === "PERMISSION_DENIED",
      `${denied.code}: ${denied.message ?? "accepted!"}`);
    const afterDenial = await captureG03(db, "AFTER_DENIAL");
    check("the refused attempt changed nothing",
      afterDenial.received === 0 && afterDenial.receiptCount === 0
      && afterDenial.warehouse === before.warehouse && afterDenial.onOrder === before.onOrder,
      `received ${afterDenial.received}, receipts ${afterDenial.receiptCount}, warehouse ${afterDenial.warehouse}, onOrder ${afterDenial.onOrder}`);

    // ══ Q, DERIVED ═════════════════════════════════════════════════════════════════════════════
    //
    // Two business constraints, both from the world own numbers:
    //   the job must still be short afterwards   ->  warehouse + Q < planned
    //   the shortage must move materially        ->  Q >= ceil(shortage * 2/3)
    // The window that satisfies both is reported, and Q is its lower bound -- the smallest receipt
    // that is unambiguously material, rather than the largest that still leaves the job short.
    const shortageBefore = before.warehouseShortage;
    const qMax = before.planned - before.warehouse - 1;
    const qMin = Math.ceil(shortageBefore * 2 / 3);
    const Q = qMin;
    console.log(`\n-- partial quantity, derived`);
    console.log(`   planned ${before.planned}, warehouse ${before.warehouse}, shortage ${shortageBefore}, PO remaining ${before.remaining}`);
    console.log(`   constraint  Q < remaining              -> Q <= ${before.remaining - 1}`);
    console.log(`   constraint  warehouse + Q < planned    -> Q <= ${qMax}`);
    console.log(`   constraint  Q reduces shortage by 2/3+ -> Q >= ${qMin}`);
    console.log(`   window [${qMin}, ${Math.min(qMax, before.remaining - 1)}]  chosen Q = ${Q}`);
    console.log(`   shortage expected after Q: ${shortageBefore - Q}`);
    check("Q is positive", Q > 0, `${Q}`);
    check("Q is less than the PO remaining", Q < before.remaining, `${Q} < ${before.remaining}`);
    check("the job is still short after Q", before.warehouse + Q < before.planned,
      `${before.warehouse} + ${Q} < ${before.planned}`);

    // ══ PARTIAL RECEIPT ════════════════════════════════════════════════════════════════════════
    console.log("\n-- partial receipt, by the authorized clerk");
    const partialKey = "cw-g03-partial-001";
    const partialReq = buildReceiptRequest({ purchaseOrderId: PO, lineId: LINE_ID, partId: G03_PART_ID, quantity: Q, idempotencyKey: partialKey });
    const partialRes = await receiveAs(db, receiver.employeeId, partialReq);
    console.log(`   actor        ${partialRes.actorEmployeeId} (${partialRes.actorUid})`);
    console.log(`   request      ${JSON.stringify(partialReq)}`);
    console.log(`   result       ${JSON.stringify(partialRes.ok ? partialRes.outcome : partialRes)}`);
    check("the partial receipt is ACCEPTED", partialRes.ok, partialRes.ok ? "committed" : `${partialRes.code}: ${partialRes.message}`);

    if (!partialRes.ok) {
      process.exitCode = 1;
    } else {
      const partial = await captureG03(db, "PARTIAL");
      console.log("\n" + renderG03(partial));
      save("g03-partial.json", partial);
      save("g03-partial-result.json", partialRes);

      check("PO remains SENT -- no persisted PARTIALLY_RECEIVED", partial.poStatus === "SENT", partial.poStatus);
      check("received increased by exactly Q", partial.received === before.received + Q, `${before.received} -> ${partial.received}`);
      check("remaining decreased by exactly Q", partial.remaining === before.remaining - Q, `${before.remaining} -> ${partial.remaining}`);
      check("onOrder decreased by exactly Q", partial.onOrder === before.onOrder - Q, `${before.onOrder} -> ${partial.onOrder}`);
      check("warehouse increased by exactly Q", partial.warehouse === before.warehouse + Q, `${before.warehouse} -> ${partial.warehouse}`);
      check("mobile is unchanged", partial.mobile === before.mobile, `${before.mobile} -> ${partial.mobile}`);
      check("the parts plan is untouched", partial.planFingerprint === before.planFingerprint, partial.planFingerprint);
      check("the work order is STILL constrained", partial.fulfillable === false && partial.warehouseShortage > 0,
        `shortage ${partial.warehouseShortage}`);
      check("the shortage moved by exactly Q", partial.warehouseShortage === shortageBefore - Q,
        `${shortageBefore} -> ${partial.warehouseShortage}`);

      // ══ IDENTICAL RETRY ══════════════════════════════════════════════════════════════════════
      console.log("\n-- identical retry (same key, same payload)");
      const replay = await receiveAs(db, receiver.employeeId, partialReq);
      const afterReplay = await captureG03(db, "AFTER_REPLAY");
      console.log(`   result ${JSON.stringify(replay.ok ? replay.outcome : { code: replay.code, message: replay.message })}`);
      check("the replay produced no second receipt", afterReplay.receiptCount === partial.receiptCount,
        `${partial.receiptCount} -> ${afterReplay.receiptCount}`);
      check("the replay moved no stock", afterReplay.warehouse === partial.warehouse, `${afterReplay.warehouse}`);
      check("the replay reduced no further inbound", afterReplay.onOrder === partial.onOrder, `${afterReplay.onOrder}`);
      check("the replay added no PO progress", afterReplay.received === partial.received, `${afterReplay.received}`);
      check("the replay left the plan alone", afterReplay.planFingerprint === partial.planFingerprint, afterReplay.planFingerprint);
      save("g03-replay-result.json", replay);

      // ══ CONFLICTING RETRY ════════════════════════════════════════════════════════════════════
      console.log("\n-- conflicting retry (same key, different quantity)");
      const conflictReq = buildReceiptRequest({ purchaseOrderId: PO, lineId: LINE_ID, partId: G03_PART_ID, quantity: Q + 1, idempotencyKey: partialKey });
      const conflict = await receiveAs(db, receiver.employeeId, conflictReq);
      const afterConflict = await captureG03(db, "AFTER_CONFLICT");
      console.log(`   result ${JSON.stringify(conflict.ok ? conflict.outcome : { code: conflict.code, message: conflict.message })}`);
      check("a changed payload under the same key is REFUSED", !conflict.ok,
        conflict.ok ? "ACCEPTED -- idempotency is not protecting the payload" : `${conflict.code}: ${conflict.message}`);
      check("the refused conflict mutated nothing",
        afterConflict.received === partial.received && afterConflict.warehouse === partial.warehouse
        && afterConflict.receiptCount === partial.receiptCount,
        `received ${afterConflict.received}, warehouse ${afterConflict.warehouse}, receipts ${afterConflict.receiptCount}`);
      save("g03-conflict-result.json", conflict);

      // ══ COMPLETION ═══════════════════════════════════════════════════════════════════════════
      console.log(`\n-- completion receipt: the remaining ${partial.remaining}`);
      const completeReq = buildReceiptRequest({
        purchaseOrderId: PO, lineId: LINE_ID, partId: G03_PART_ID,
        quantity: partial.remaining, idempotencyKey: "cw-g03-complete-001",
      });
      const completeRes = await receiveAs(db, receiver.employeeId, completeReq);
      console.log(`   actor  ${completeRes.actorEmployeeId} (${completeRes.actorUid})`);
      console.log(`   result ${JSON.stringify(completeRes.ok ? completeRes.outcome : completeRes)}`);
      check("the completion receipt is ACCEPTED", completeRes.ok,
        completeRes.ok ? "committed" : `${completeRes.code}: ${completeRes.message}`);

      const complete = await captureG03(db, "COMPLETE");
      console.log("\n" + renderG03(complete));
      save("g03-complete.json", complete);
      save("g03-complete-result.json", completeRes);

      check("the PO is RECEIVED", complete.poStatus === "RECEIVED", complete.poStatus);
      check("received equals ordered", complete.received === complete.ordered, `${complete.received} / ${complete.ordered}`);
      check("remaining is zero", complete.remaining === 0, `${complete.remaining}`);
      check("the order contributes no further inbound", complete.onOrder === 0 || complete.onOrderState !== "KNOWN",
        `${complete.onOrderState === "KNOWN" ? complete.onOrder : "UNKNOWN"}`);
      check("warehouse holds the full ordered quantity", complete.warehouse === before.warehouse + complete.ordered,
        `${before.warehouse} -> ${complete.warehouse}`);
      check("the parts plan never changed", complete.planFingerprint === before.planFingerprint, complete.planFingerprint);

      // ══ THE POINT OF THE SCENARIO ════════════════════════════════════════════════════════════
      check("G03 ends with NO warehouse shortage", complete.warehouseShortage === 0, `${complete.warehouseShortage}`);
      check("G03 ends FULFILLABLE", complete.fulfillable === true, `${complete.fulfillable}`);

      // ══ OVER-RECEIPT ═════════════════════════════════════════════════════════════════════════
      console.log("\n-- one more unit, against a fully received order");
      const overReq = buildReceiptRequest({ purchaseOrderId: PO, lineId: LINE_ID, partId: G03_PART_ID, quantity: 1, idempotencyKey: "cw-g03-over-001" });
      const over = await receiveAs(db, receiver.employeeId, overReq);
      const afterOver = await captureG03(db, "AFTER_OVER");
      console.log(`   result ${JSON.stringify(over.ok ? over.outcome : { code: over.code, message: over.message })}`);
      check("the over-receipt is REFUSED", !over.ok, over.ok ? "ACCEPTED" : `${over.code}: ${over.message}`);
      check("no receipt was written", afterOver.receiptCount === complete.receiptCount, `${afterOver.receiptCount}`);
      check("no stock moved", afterOver.warehouse === complete.warehouse, `${afterOver.warehouse}`);
      check("received never exceeds ordered", afterOver.received <= afterOver.ordered, `${afterOver.received} <= ${afterOver.ordered}`);
      check("inbound stays at zero", afterOver.onOrder === 0 || afterOver.onOrderState !== "KNOWN",
        `${afterOver.onOrderState === "KNOWN" ? afterOver.onOrder : "UNKNOWN"}`);
      save("g03-overreceipt-result.json", over);

      // ══ expectedQuantity, as stored ══════════════════════════════════════════════════════════
      //
      // ORDERED, not remaining -- and the reason is idempotency, not description. Remaining changes
      // the moment a receipt commits, so a fingerprint covering it would make an identical retry
      // compute a different fingerprint and be rejected as a payload conflict. The mechanism would
      // become the thing that breaks the property it exists to provide.
      console.log("\n-- stored expectedQuantity");
      const receipts = await db.collection("receiving_orders").where("source.purchaseOrderId", "==", PO).get();
      for (const doc of receipts.docs) {
        const line = (doc.data().lines ?? [])[0] ?? {};
        console.log(`   ${doc.id}  received ${line.receivedQuantity}  expectedQuantity ${line.expectedQuantity}`);
        check(`${doc.id}: expectedQuantity is the ORDERED quantity, not the remaining`,
          line.expectedQuantity === complete.ordered,
          `${line.expectedQuantity} vs ordered ${complete.ordered}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lifecycle checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
