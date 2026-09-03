#!/usr/bin/env node
// ONE-TIME SANDBOX MAINTENANCE — remove the BIN scanner-scenario fixtures, and nothing else.
//
// ============================ WHY THIS EXISTS ============================
//
// BIN-P1 replaces the code-derived bin document id with a stable surrogate `binId`
// (Decision #160 / ADR-014, ruling O-3). The pre-implementation census found the live sandbox
// holding 63 `bins` and 42 `bin_placements`, all of them reproducible output from
// scripts/runSandboxScannerScenarios.mjs. The Owner ruled REGENERATE rather than build a
// v1 -> v2 migration whose only job would be to preserve disposable scenario artifacts.
//
// This is TEST-FIXTURE MAINTENANCE, not product behaviour. There is deliberately no delete-bin
// command, no callable, no capability and no Rules change: the product invariant that operational
// bins are RETAINED FOR HISTORY (binRegistry.ts -- "Retiring keeps history readable; nothing is
// ever deleted") is untouched by this script and must stay that way.
//
// ============================ WHY NOT A COLLECTION WIPE ============================
//
// Modelled on functions/scripts/certificationWorld/clearCertificationPurchasing.mjs: a wipe of
// `bins` would be simpler and would also be indistinguishable, in a log, from a wipe that took
// something it should not have. So this script NAMES every id it intends to remove before removing
// any of them, refuses outright if a single record fails the scenario proof, and re-measures
// afterwards.
//
// ============================ WHAT PROVES A RECORD DISPOSABLE ============================
//
// runSandboxScannerScenarios.mjs computes, once per run:
//
//     RUN        = `v${Date.now()}`                 e.g. v1787289290788
//     BIN        = `A14${RUN.slice(-5)}`            -> bins/bin_wh-main__A1490788
//     STAGE_BIN  = `ST${RUN.slice(-5)}`             -> bins/bin_wh-main__ST90788
//     other bin  = `NB${RUN.slice(-5)}` @ wh-north  -> bins/bin_wh-north__NB90788
//
// and two placements for PRT-1001, keyed `plc-${RUN}` (put-away) and `pick-${RUN}` (pick/stage):
//
//     bin_placements/plc_plc-v1787289290788__PRT-1001
//     bin_placements/plc_pick-v1787289290788__PRT-1001
//
// A record is eligible ONLY if its document id matches one of those exact shapes AND its stored
// warehouseId agrees with the shape. Anything else aborts the whole run.
//
// ============================ TARGETING ============================
//
// The refusal posture mirrors functions/scripts/certificationWorld/executionTarget.mjs -- the
// repository's one gate for live writes. It is mirrored rather than imported because that module
// resolves through functions/lib (a compiled build) and this script talks to the Firestore REST API
// with the operator's existing `gcloud` login instead. No credential is created, no ADC file is
// written, no IAM is touched, nothing is deployed.
//
//   --projectId is required; there is no default target
//   taylor-parts is refused BY NAME
//   any project other than eos-platform-sandbox is refused
//   dry run is the default; --apply AND --apply-live-sandbox are both required to delete
//
// Usage:
//   node scripts/clearSandboxBinScenarioFixtures.mjs --projectId eos-platform-sandbox
//   node scripts/clearSandboxBinScenarioFixtures.mjs --projectId eos-platform-sandbox --apply --apply-live-sandbox
//
// Exit codes: 0 clean, 1 refused or inconsistent.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SANDBOX_PROJECT = "eos-platform-sandbox";
const PRODUCTION_PROJECT = "taylor-parts";
const LIVE_FLAG = "--apply-live-sandbox";

const argv = process.argv;
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

// ── target ────────────────────────────────────────────────────────────────────────────────────
const projectId = flag("--projectId");
if (!projectId) refuse("--projectId is required. There is no default target.");
if (projectId === PRODUCTION_PROJECT) {
  refuse(`"${projectId}" is the customer production project. Refused by name.`);
}
if (projectId !== SANDBOX_PROJECT) {
  refuse(`This is one-time ${SANDBOX_PROJECT} maintenance. Refusing "${projectId}".`);
}
const apply = has("--apply");
if (apply && !has(LIVE_FLAG)) {
  refuse(`Writing to ${projectId} requires ${LIVE_FLAG} as well as --apply. --apply alone never deletes.`);
}

// ── auth: the operator's existing gcloud login, nothing new ───────────────────────────────────
let token;
try {
  // `gcloud` is a .cmd shim on Windows, and Node refuses to spawn .cmd without a shell.
  const win = process.platform === "win32";
  token = execFileSync(win ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    shell: win,
  }).trim();
} catch (err) {
  // Report the real cause. Swallowing it made a wrong binary name look like "not logged in".
  refuse(`No gcloud access token (${err?.message ?? err}). Run \`gcloud auth login\` first; this script creates no credentials.`);
}
if (!token) refuse("Empty gcloud access token.");

const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function listAll(collection, fieldPaths) {
  const out = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    for (const f of fieldPaths) params.append("mask.fieldPaths", f);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${BASE}/${collection}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) refuse(`GET ${collection} returned HTTP ${res.status}`);
    const body = await res.json();
    for (const d of body.documents ?? []) {
      out.push({ id: d.name.split("/").pop(), fields: d.fields ?? {} });
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  return out;
}

const str = (fields, key) => fields?.[key]?.stringValue ?? null;

// ── the scenario shapes, derived from the runner ──────────────────────────────────────────────
// `RUN.slice(-5)` is the last five characters of `v<epoch-ms>`, i.e. five digits.
const BIN_SHAPES = [
  { re: /^bin_wh-main__A14(\d{5})$/, warehouseId: "wh-main" },
  { re: /^bin_wh-main__ST(\d{5})$/, warehouseId: "wh-main" },
  { re: /^bin_wh-north__NB(\d{5})$/, warehouseId: "wh-north" },
];
const PLACEMENT_RE = /^plc_(plc|pick)-v(\d{13})__PRT-1001$/;

function classifyBin(doc) {
  for (const shape of BIN_SHAPES) {
    const m = shape.re.exec(doc.id);
    if (!m) continue;
    const stored = str(doc.fields, "warehouseId");
    if (stored !== shape.warehouseId) {
      return { eligible: false, why: `id shape says ${shape.warehouseId} but stored warehouseId is ${stored}` };
    }
    const code = str(doc.fields, "code");
    if (!code || !doc.id.endsWith(`__${code}`)) {
      return { eligible: false, why: `stored code ${code} does not derive the document id` };
    }
    return { eligible: true, run: m[1] };
  }
  return { eligible: false, why: "does not match any scanner-scenario bin shape" };
}

function classifyPlacement(doc) {
  const m = PLACEMENT_RE.exec(doc.id);
  if (!m) return { eligible: false, why: "does not match the scanner-scenario placement shape" };
  const wh = str(doc.fields, "warehouseId");
  if (wh !== "wh-main") return { eligible: false, why: `stored warehouseId is ${wh}, expected wh-main` };
  const part = str(doc.fields, "partId");
  if (part !== "PRT-1001") return { eligible: false, why: `stored partId is ${part}, expected PRT-1001` };
  return { eligible: true, run: m[2].slice(-5) };
}

// ── measure ───────────────────────────────────────────────────────────────────────────────────
console.log(`target   : ${projectId}`);
console.log(`mode     : ${apply ? "APPLY" : "DRY RUN"}\n`);

const bins = await listAll("bins", ["warehouseId", "code", "status"]);
const placements = await listAll("bin_placements", ["warehouseId", "partId", "binId"]);

const binVerdicts = bins.map((d) => ({ doc: d, ...classifyBin(d) }));
const placementVerdicts = placements.map((d) => ({ doc: d, ...classifyPlacement(d) }));

const eligibleBins = binVerdicts.filter((v) => v.eligible);
const eligiblePlacements = placementVerdicts.filter((v) => v.eligible);
const strayBins = binVerdicts.filter((v) => !v.eligible);
const strayPlacements = placementVerdicts.filter((v) => !v.eligible);

const runs = new Set([...eligibleBins.map((v) => v.run), ...eligiblePlacements.map((v) => v.run)]);

console.log(`bins                     : ${bins.length} total, ${eligibleBins.length} proven scenario, ${strayBins.length} other`);
console.log(`bin_placements           : ${placements.length} total, ${eligiblePlacements.length} proven scenario, ${strayPlacements.length} other`);
console.log(`distinct scenario runs   : ${runs.size}`);

// ── referential check: no surviving placement may point at a bin being removed ────────────────
const removedBinIds = new Set(eligibleBins.map((v) => v.doc.id));
const survivingPlacements = placementVerdicts.filter((v) => !v.eligible);
const wouldDangle = survivingPlacements.filter((v) => removedBinIds.has(str(v.doc.fields, "binId")));

if (strayBins.length > 0 || strayPlacements.length > 0) {
  console.error("\nREFUSED: records outside the proven scenario set are present. Nothing was deleted.");
  for (const v of [...strayBins, ...strayPlacements].slice(0, 20)) {
    console.error(`  ${v.doc.id}: ${v.why}`);
  }
  process.exit(1);
}
if (wouldDangle.length > 0) {
  console.error(`\nREFUSED: ${wouldDangle.length} surviving placement(s) reference a bin in the deletion set.`);
  process.exit(1);
}

if (eligibleBins.length === 0 && eligiblePlacements.length === 0) {
  console.log("\nNothing eligible. Sandbox holds no scanner-scenario bin fixtures.");
  process.exit(0);
}

// The audit manifest is written from the SAME classified set that would be deleted, so the record
// filed for review cannot drift from what the apply run actually removes.
const manifestPath = flag("--manifest");
if (manifestPath) {
  const lines = [
    ...eligiblePlacements.map((v) => `bin_placements/${v.doc.id}`),
    ...eligibleBins.map((v) => `bins/${v.doc.id}`),
  ].sort();
  writeFileSync(manifestPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`manifest : ${lines.length} id(s) -> ${manifestPath}`);
}

if (!apply) {
  console.log(`\nDRY RUN. Would delete ${eligiblePlacements.length} placement(s) then ${eligibleBins.length} bin(s).`);
  console.log(`Re-run with --apply ${LIVE_FLAG} to remove them.`);
  process.exit(0);
}

// ── delete: placements first, then bins ───────────────────────────────────────────────────────
async function del(collection, id) {
  const res = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`FAILED to delete ${collection}/${id}: HTTP ${res.status}`);
    return false;
  }
  return true;
}

let placementsRemoved = 0;
for (const v of eligiblePlacements) if (await del("bin_placements", v.doc.id)) placementsRemoved += 1;
let binsRemoved = 0;
for (const v of eligibleBins) if (await del("bins", v.doc.id)) binsRemoved += 1;

console.log(`\nremoved  : ${placementsRemoved} bin_placements, ${binsRemoved} bins`);

// ── verify ────────────────────────────────────────────────────────────────────────────────────
const binsAfter = await listAll("bins", ["code"]);
const placementsAfter = await listAll("bin_placements", ["partId"]);
console.log(`post     : bins ${binsAfter.length}, bin_placements ${placementsAfter.length}`);

const clean =
  placementsRemoved === eligiblePlacements.length &&
  binsRemoved === eligibleBins.length &&
  binsAfter.length === bins.length - eligibleBins.length &&
  placementsAfter.length === placements.length - eligiblePlacements.length;

if (!clean) {
  console.error("\nINCONSISTENT: removal counts do not reconcile with the post-state.");
  process.exit(1);
}
console.log("\nOK. Only the proven scanner-scenario fixtures were removed.");
