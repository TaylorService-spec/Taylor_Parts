// Shared setup for the two Bin-conversion scripts: flags, the production refusal, and Firestore init
// through the emulator or the operator's existing `gcloud auth` login. Creates no credential.

import { execFileSync } from "node:child_process";
import admin from "firebase-admin";

const PRODUCTION_PROJECT = "taylor-parts";
const SANDBOX_PROJECT = "eos-platform-sandbox";

export function refuse(message) { console.error(`REFUSED: ${message}`); process.exit(1); }

function gcloud(args) {
  const win = process.platform === "win32";
  return execFileSync(win ? "gcloud.cmd" : "gcloud", args, { encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function openBinConversionContext(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const warehouseId = flag("--warehouse");
  const startIso = flag("--start");
  const endIso = flag("--end");
  const projectId = flag("--projectId");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (!warehouseId) refuse("--warehouse is required.");
  if (!startIso || Number.isNaN(Date.parse(startIso))) refuse("--start must be an ISO timestamp (when putting-away began).");
  if (endIso !== undefined && Number.isNaN(Date.parse(endIso))) refuse("--end must be an ISO timestamp.");
  if (projectId === PRODUCTION_PROJECT) refuse(`"${PRODUCTION_PROJECT}" is the customer production project. Refused by name.`);
  if (!emulator && projectId !== SANDBOX_PROJECT) refuse(`Without an emulator, only --projectId ${SANDBOX_PROJECT} is accepted.`);

  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (end < start) refuse("--end is before --start.");

  let operator = "emulator-operator";
  if (emulator) {
    admin.initializeApp({ projectId: projectId ?? "taylor-parts-emulator" });
  } else {
    try {
      operator = gcloud(["config", "get-value", "account"]) || "unknown-operator";
    } catch (err) {
      refuse(`No gcloud account (${err?.message ?? err}). Run \`gcloud auth login\`; this script creates no credentials.`);
    }
    // The operator's Application Default Credentials -- the login every governed sandbox script uses.
    // (A bare {getAccessToken} object is refused by the Firestore client; this was emulator-only proven.)
    admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
  }
  return { db: admin.firestore(), admin, warehouseId, start, end, operator, flag };
}

export function printReport({ report, binCount, rowsRead, malformedRows, reportSha256 }) {
  console.log(`Warehouse ${report.warehouseId}   window ${new Date(report.start).toISOString()} .. ${new Date(report.end).toISOString()}`);
  console.log(`Bins: ${binCount}   ledger rows read: ${rowsRead}   malformed rows skipped: ${malformedRows}`);
  console.log("");
  console.log("part".padEnd(28), "before".padStart(8), "after".padStart(8), "reloc".padStart(7), "other".padStart(7), "binned".padStart(8), "direct".padStart(8), "  ok");
  for (const p of report.parts) {
    console.log(p.partId.padEnd(28), String(p.aggregateBefore).padStart(8), String(p.aggregateAfter).padStart(8),
      String(p.relocationNet).padStart(7), String(p.otherNet).padStart(7), String(p.binnedAfter).padStart(8),
      String(p.directAfter).padStart(8), p.balanced ? "  yes" : "  NO");
  }
  if (report.unresolvedBinIds.length) console.log(`\nUnresolved bin ids (NOT assumed): ${report.unresolvedBinIds.join(", ")}`);
  console.log(`\n${report.balanced ? "BALANCED" : "NOT BALANCED"} -- ${report.parts.filter((p) => !p.balanced).length} part(s) unexplained, ${malformedRows} malformed row(s).`);
  console.log(`report sha256: ${reportSha256}`);
}
