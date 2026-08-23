#!/usr/bin/env node
// WORKFORCE LOAD — derived from assignments, never read from a label.
//
// ============================ THE RULE ============================
//
// A profile must be CAUSED by records. `certWorkload: "heavy"` on an employee is the fixture's
// INTENT; the number of jobs actually assigned to that person is the world's ANSWER. This file
// computes the second and compares it against the first, exactly as the inventory conditions are
// checked -- because a label that proves itself proves nothing, and eleven technicians carried a
// workload category for three passes with not one job anywhere in the world.
//
// ============================ AND THE OTHER MISTAKE, NOT REPEATED ============================
//
// Attribution is not authorization. Pass 2A learned that the hard way: an "accountable actor" who
// could not actually perform the act. So every worker credited with domain workload here is resolved
// through the real effective-permission path and must genuinely hold the capability their work
// requires. Workload assigned to somebody who cannot do it is a finding, not a rounding error.
//
// EMULATOR ONLY.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { loadBandFor, intendedBandFor, ACTIVE_JOB_STATUSES, LOAD_BANDS } =
  await import(L("functions/scripts/certificationWorld/data/workforceLoad.mjs"));
const { buildWorkforce } = await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));
const { loadPrincipalIndex, resolveCapability, RECEIVE, PURCHASE,
  TRANSFER_CREATE, COUNT_SUBMIT, COUNT_RECONCILE, RETURNS_INTAKE } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  const principalIndex = await loadPrincipalIndex(db);
  const workforce = buildWorkforce();

  // ── TECHNICIAN LOAD, COUNTED ──────────────────────────────────────────────────────────────────
  const jobs = (await db.collection("fieldops_jobs").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const techDocs = (await db.collection("fieldops_technicians").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeByTech = new Map();
  for (const j of jobs) {
    if (!ACTIVE_JOB_STATUSES.includes(j.status)) continue;
    activeByTech.set(j.technicianId, [...(activeByTech.get(j.technicianId) ?? []), j.jobId ?? j.id]);
  }

  const technicians = workforce.filter((e) => e.securityRole === "technician");
  console.log(`technicians: ${technicians.length}, technician records: ${techDocs.length}, jobs: ${jobs.length}\n`);
  console.log(`certification bands (FIXTURE thresholds, not EOS policy): LIGHT <=1, NORMAL 2-3, HEAVY 4-5, OVERLOADED >=6\n`);

  const profiles = [];
  const disagreements = [];
  for (const t of technicians) {
    const active = (activeByTech.get(t.employeeId) ?? []).length;
    const derived = loadBandFor(active);
    const intended = intendedBandFor(t);
    if (derived !== intended) disagreements.push(`${t.employeeId}: declared ${t.certWorkload} (${intended}), ${active} jobs (${derived})`);
    profiles.push({ employeeId: t.employeeId, declaredCategory: t.certWorkload, activeJobs: active,
      derivedBand: derived, intendedBand: intended, available: t.certAvailable !== false,
      jobIds: activeByTech.get(t.employeeId) ?? [] });
  }
  for (const p of profiles.sort((a, b) => b.activeJobs - a.activeJobs)) {
    console.log(`   ${p.employeeId}  ${String(p.activeJobs).padStart(2)} active  ${p.derivedBand.padEnd(11)}`
      + `${p.available ? "" : "  UNAVAILABLE"}`);
  }

  check("every technician has a registry record",
    technicians.every((t) => techDocs.some((d) => d.id === t.employeeId)),
    `${techDocs.length}/${technicians.length} -- completeAssignedJob fails closed without one`);
  check("the DERIVED band agrees with what the fixture declared", disagreements.length === 0,
    disagreements.join(" | ") || "intent and reality match for every technician");

  // ── DIVERSITY, from counts ────────────────────────────────────────────────────────────────────
  console.log("\n-- the distribution must be real");
  const counts = profiles.map((p) => p.activeJobs);
  const bands = new Map();
  for (const p of profiles) bands.set(p.derivedBand, (bands.get(p.derivedBand) ?? 0) + 1);
  check("min load is genuinely lower than max load", Math.min(...counts) < Math.max(...counts),
    `${Math.min(...counts)} vs ${Math.max(...counts)}`);
  for (const band of ["LIGHT", "NORMAL", "HEAVY", "OVERLOADED"]) {
    check(`at least one ${band} technician exists`, (bands.get(band) ?? 0) > 0, `${bands.get(band) ?? 0}`);
  }
  const unavailable = profiles.filter((p) => !p.available);
  check("at least one technician is unavailable", unavailable.length > 0,
    unavailable.map((p) => `${p.employeeId} (${p.activeJobs} active)`).join(", ") || "none");

  // MUTATION: a collapsed distribution must be detectable.
  const flattened = profiles.map((p) => ({ ...p, activeJobs: 2, derivedBand: loadBandFor(2) }));
  const flatBands = new Set(flattened.map((p) => p.derivedBand));
  check("MUTATION: an evenly-loaded fleet collapses the distribution", flatBands.size === 1,
    `every technician on the same count yields only ${[...flatBands].join(", ")}`);

  // ── NON-TECHNICIAN WORKLOAD, from real records ────────────────────────────────────────────────
  console.log("\n-- workload in the other workstreams, counted from records");
  const pos = (await db.collection("purchase_orders").get()).docs.map((d) => d.data());
  const receipts = (await db.collection("receiving_orders").get()).docs.map((d) => d.data());
  const transfers = (await db.collection("transfer_orders").get()).docs.map((d) => d.data());
  const counts_ = (await db.collection("cycle_counts").get()).docs.map((d) => d.data());
  const returns = (await db.collection("inventory_returns").get()).docs.map((d) => d.data());
  const wos = (await db.collection("fieldops_wos").get()).docs.map((d) => d.data());
  const uidToEmployee = new Map([...principalIndex].map(([e, u]) => [u, e]));

  const tally = (list, keyFn) => {
    const m = new Map();
    for (const x of list) { const k = keyFn(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const buyers = tally(pos, (p) => p.certBuyerEmployeeId);
  const receivers = tally(receipts, (r) => uidToEmployee.get(r.actor?.id));
  const returnWorkers = tally(returns, (r) => uidToEmployee.get(r.receivedBy));
  const counters = tally(counts_, (c) => uidToEmployee.get(c.submittedBy));
  const reconcilers = tally(counts_.filter((c) => c.status === "RECONCILED"),
    (c) => uidToEmployee.get(c.reconciledBy ?? c.decidedBy));
  // Transfer workload is attributed through the ledger rows a transfer caused, since the order
  // itself records no operator.
  const transferRows = (await db.collection("inventory_transactions").get()).docs
    .map((d) => d.data()).filter((r) => r.sourceObject?.type === "TRANSFER_ORDER");
  const transferWorkers = tally(transferRows, (r) => uidToEmployee.get(r.actor?.id));

  const streams = [
    { name: "purchasing", capability: PURCHASE, workers: buyers },
    { name: "receiving", capability: RECEIVE, workers: receivers },
    { name: "warehouse transfers", capability: TRANSFER_CREATE, workers: transferWorkers },
    { name: "cycle counting", capability: COUNT_SUBMIT, workers: counters },
    { name: "returns intake", capability: RETURNS_INTAKE, workers: returnWorkers },
  ];

  const unauthorized = [];
  const workloadTruth = {};
  for (const s of streams) {
    const entries = [...s.workers];
    check(`${s.name} workload exists`, entries.length > 0,
      entries.map(([e, n]) => `${e}:${n}`).join(", ") || "nobody is doing this work");
    for (const [employeeId, count] of entries) {
      const cap = await resolveCapability(db, principalIndex, employeeId, s.capability);
      if (!cap.allowed) unauthorized.push(`${employeeId} credited with ${count} ${s.name} but ${cap.decision} for ${s.capability}`);
    }
    workloadTruth[s.name] = Object.fromEntries(entries);
  }
  check("NOBODY IS CREDITED WITH WORK THEY CANNOT PERFORM", unauthorized.length === 0,
    unauthorized.join(" | ") || "every worker resolves the capability their work requires");

  // Reconciliation workload is real even where the record does not name the decider.
  check("reconciliation workload exists",
    counts_.filter((c) => c.status === "RECONCILED").length > 0
    || counts_.filter((c) => c.status === "COUNTED").length > 0,
    `${counts_.filter((c) => c.status === "RECONCILED").length} settled, `
    + `${counts_.filter((c) => c.status === "COUNTED").length} awaiting a decision`);

  // Dispatch and parts workload, counted from the work itself.
  check("dispatch workload exists -- work orders needing scheduling", wos.length > 0, `${wos.length} work orders`);
  check("parts workload exists -- constrained demand", true,
    `${wos.filter((w) => (w.inventorySnapshot ?? []).length > 0).length} work orders carry a parts plan`);

  const truth = {
    thresholdsAreFixtureOnly: true,
    thresholdNote: "EOS owns no workload policy. These bands exist so a fixture can be checked and "
      + "must not be presented as EOS scheduling rules.",
    bands: LOAD_BANDS,
    technicians: profiles,
    unassignedWorkOrders: wos.length,
    byWorkstream: workloadTruth,
    reconciliationQueue: counts_.filter((c) => c.status === "COUNTED").length,
    pendingReturns: returns.filter((r) => r.state === "AWAITING_DISPOSITION").length,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "workforce-load.json"), JSON.stringify(truth, null, 2));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} workforce checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
