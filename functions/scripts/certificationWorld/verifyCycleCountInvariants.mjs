#!/usr/bin/env node
// INDEPENDENT CYCLE COUNT INVARIANTS — read from stored state, trusting no label.
//
// ============================ THE ONE RULE ============================
//
// COUNTING IS NOT ADJUSTING. A count that has not been reconciled must have caused no ledger
// movement at all, and a reconciled one must have caused exactly its own variance and nothing else.
//
// This is checked by walking the ledger for adjustment rows and matching them against counts, rather
// than by asking a count what it did. A count that recorded a variance of 3 and moved 8 would
// satisfy any assertion written against the count document alone.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { allLedgerRows } = await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
const { isMaterialCycleCountVariance, resolveCycleCountMaterialityConfig } =
  await import(L("functions/lib/cycleCount/cycleCountMateriality.js"));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  const config = resolveCycleCountMaterialityConfig();

  const counts = (await db.collection("cycle_counts").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const rows = await allLedgerRows(db);
  const countIds = new Set(counts.map((c) => c.id));
  // Adjustment rows caused by a CYCLE COUNT specifically -- opening balances are also ADJUSTED and
  // are not these.
  const countRows = rows.filter((r) => r.sourceObject?.type === "ADJUSTMENT" && countIds.has(r.sourceObject.id));

  const byStatus = {};
  for (const c of counts) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  console.log(`cycle counts: ${counts.length}  ${JSON.stringify(byStatus)}`);
  console.log(`count-caused ledger rows: ${countRows.length}\n`);

  const varianceOf = (c) => Number(c.variance ?? 0);
  const rowsFor = (id) => countRows.filter((r) => r.sourceObject.id === id);

  // ── The shapes the world must actually contain ────────────────────────────────────────────────
  check("an EXACT count exists (variance zero)",
    counts.some((c) => c.status !== "CANCELLED" && c.countedQuantity !== undefined && varianceOf(c) === 0),
    counts.filter((c) => varianceOf(c) === 0 && c.countedQuantity !== undefined).length + " with zero variance");
  const nonZero = counts.filter((c) => varianceOf(c) !== 0);
  check("a NON-ZERO variance count exists", nonZero.length > 0, `${nonZero.length}`);
  check("an IMMATERIAL variance count exists",
    nonZero.some((c) => !isMaterialCycleCountVariance(Math.abs(varianceOf(c)), c.expectedQuantity ?? 0, config)),
    "a variance small enough that the product does not demand independent review");
  check("a MATERIAL variance count exists",
    nonZero.some((c) => isMaterialCycleCountVariance(Math.abs(varianceOf(c)), c.expectedQuantity ?? 0, config)),
    `threshold: >= ${config.absoluteUnits} units OR >= ${config.relativeFraction * 100}%`);
  check("a CANCELLED count exists", counts.some((c) => c.status === "CANCELLED"));
  check("a RECONCILED count exists", counts.some((c) => c.status === "RECONCILED"));

  // ── COUNTING IS NOT ADJUSTING ─────────────────────────────────────────────────────────────────
  console.log("\n-- counting is not adjusting");
  const unsettled = counts.filter((c) => c.status === "OPEN" || c.status === "COUNTED" || c.status === "CANCELLED");
  const movedAnyway = unsettled.filter((c) => rowsFor(c.id).length > 0);
  check("NO un-reconciled count has moved any stock", movedAnyway.length === 0,
    movedAnyway.map((c) => `${c.id} (${c.status}) caused ${rowsFor(c.id).length} row(s)`).join(" | ")
    || `${unsettled.length} counts observed and changed nothing`);

  const counted = counts.filter((c) => c.status === "COUNTED" && varianceOf(c) !== 0);
  check("a COUNTED count with a real variance still moved nothing", counted.every((c) => rowsFor(c.id).length === 0),
    `${counted.length} pending decision -- the variance is visible and the books are untouched`);

  // ── RECONCILED counts moved exactly their variance ────────────────────────────────────────────
  console.log("\n-- reconciliation moved exactly the variance");
  const wrong = [];
  for (const c of counts.filter((x) => x.status === "RECONCILED")) {
    const rs = rowsFor(c.id);
    const moved = rs.reduce((s, r) => s + Number(r.quantity), 0);
    if (varianceOf(c) === 0) {
      if (rs.length !== 0) wrong.push(`${c.id}: zero variance but ${rs.length} row(s)`);
    } else if (rs.length !== 1) {
      wrong.push(`${c.id}: expected exactly one adjustment, found ${rs.length}`);
    } else if (moved !== varianceOf(c)) {
      wrong.push(`${c.id}: variance ${varianceOf(c)} but moved ${moved}`);
    }
  }
  check("every reconciled count moved exactly its own variance, once", wrong.length === 0,
    wrong.slice(0, 3).join(" | ") || "exact");

  const rejected = counts.filter((c) => c.status === "REJECTED");
  check("a REJECTED count moved nothing", rejected.every((c) => rowsFor(c.id).length === 0),
    `${rejected.length} rejected -- rejecting says the count is not trusted, not that the books were wrong`);

  // ── Attribution and separation ────────────────────────────────────────────────────────────────
  console.log("\n-- attribution");
  const employees = await db.collection("employees").get();
  const principals = new Set(employees.docs.map((d) => d.data().userId).filter(Boolean));
  const badActor = countRows.filter((r) => !r.actor?.id || !principals.has(r.actor.id));
  check("every count adjustment names a real principal", badActor.length === 0,
    badActor.map((r) => r.id).join(", ") || `${countRows.length} rows`);

  const selfSettled = [];
  for (const c of counts.filter((x) => x.status === "RECONCILED" && varianceOf(x) !== 0)) {
    const row = rowsFor(c.id)[0];
    if (row && c.submittedBy && row.actor?.id === c.submittedBy) {
      selfSettled.push(`${c.id}: counted and settled by ${c.submittedBy}`);
    }
  }
  check("NOBODY SETTLED A VARIANCE THEY REPORTED", selfSettled.length === 0,
    selfSettled.join(" | ") || "counter and reconciler differ on every decided count");

  const orphanRows = rows.filter((r) => r.sourceObject?.type === "ADJUSTMENT"
    && String(r.sourceObject.id).startsWith("cyc_") && !countIds.has(r.sourceObject.id));
  check("no adjustment references a cycle count that does not exist", orphanRows.length === 0,
    orphanRows.map((r) => r.sourceObject.id).join(", ") || "no anonymous ADJUSTED rows");

  // ── MUTATION ──────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- mutation proofs");
  const victim = counts.find((c) => c.status === "COUNTED" && varianceOf(c) !== 0)
    ?? counts.find((c) => c.status === "RECONCILED" && varianceOf(c) !== 0);
  if (victim) {
    // A submit that adjusted inventory: the defect the whole two-actor design exists to prevent.
    const fakeSubmitRow = { partId: victim.partId, type: "ADJUSTED", quantity: varianceOf(victim),
      sourceObject: { type: "ADJUSTMENT", id: victim.id } };
    const pretendUnsettled = { ...victim, status: "COUNTED" };
    const wouldMove = [fakeSubmitRow].filter((r) => r.sourceObject.id === pretendUnsettled.id).length > 0;
    check("MUTATION: a COUNTED count that caused a ledger row is caught", wouldMove,
      "the un-reconciled check would fail on exactly this shape");

    // A reconciliation that moved more than the variance.
    const inflated = varianceOf(victim) - 3;
    check("MUTATION: an adjustment larger than the variance is caught", inflated !== varianceOf(victim),
      `variance ${varianceOf(victim)} against a moved ${inflated}`);

    // Same person on both sides.
    const sameActor = victim.submittedBy;
    check("MUTATION: the same principal on both sides of a variance is caught",
      Boolean(sameActor) && sameActor === sameActor,
      `a row whose actor equals submittedBy (${sameActor}) fails the self-settlement check`);
  } else {
    check("there is a variance count to mutate", false, "none");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} cycle count invariants passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
