// FINANCE MALFORMED-RECORD CENSUS -- the pre-activation gate required by Controller ruling DQ-019 (2026-09-28).
//
// Operator-run over an EXPORTED SNAPSHOT FILE. It reads no database and imports no Firebase or pg module: the
// Firestore export of `invoices`, `payments` and `payment_applications` belongs to the governed finance migration
// tooling (#1982 N10, the FIREBASE_EXIT_MIGRATION_ONLY export), and this census runs over what that export wrote.
// It is therefore safe to run anywhere, and it is the same check the live reads apply
// (functions/src/finance/financeRecordIntegrity.ts), so "malformed" means one thing at runtime and at activation.
//
// It REPAIRS NOTHING and INFERS NOTHING. Its evidence names record ids and defective FIELD NAMES only -- never a
// stored value. A MALFORMED_PRESENT verdict STOPS finance COPY/ACTIVATE; each listed record is an Owner data
// decision (ambiguous real-data repair is never automatic).
//
// Snapshot shape: { "invoices": [{ "id": "...", "data": {...} }], "payments": [...], "payment_applications": [...] }
//
// Usage (after `npm run build` in functions/):
//   node scripts/financeRecordCensusCli.js --snapshot ./finance-snapshot.json --out ./finance-census.json
//
// Exit: 0 CLEAN; 1 MALFORMED_PRESENT (activation gate closed); 2 refused or failed.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const EVIDENCE_FORMAT = "EOS_FINANCE_RECORD_CENSUS_EVIDENCE";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument '${a}'`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.snapshot || args.snapshot === "true") throw new Error("--snapshot <file> is required.");
  if (!args.out || args.out === "true") throw new Error("--out <file> is required.");
  const out = path.resolve(args.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.sha256`)) {
    throw new Error(`REFUSED: ${out} (or its .sha256) already exists; census evidence is never overwritten.`);
  }
  const raw = fs.readFileSync(path.resolve(args.snapshot), "utf8");
  const snapshot = JSON.parse(raw);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("the snapshot must be an object of collection arrays");
  }
  // Loaded only after every refusal above.
  const { censusFinanceRecords } = require("../lib/finance/financeRecordIntegrity.js");
  const result = censusFinanceRecords({
    invoices: snapshot.invoices,
    payments: snapshot.payments,
    payment_applications: snapshot.payment_applications,
  });
  const evidence = {
    format: EVIDENCE_FORMAT,
    snapshotSha256: createHash("sha256").update(raw).digest("hex"),
    ...result,
  };
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(out, body, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(`${out}.sha256`, `${createHash("sha256").update(body).digest("hex")}  ${path.basename(out)}\n`, { flag: "wx", mode: 0o600 });
  const m = result.malformed;
  process.stdout.write(
    `${result.verdict}: scanned invoices=${result.scanned.INVOICE} payments=${result.scanned.PAYMENT_RECEIPT} ` +
    `applications=${result.scanned.PAYMENT_APPLICATION}; malformed invoices=${m.INVOICE} payments=${m.PAYMENT_RECEIPT} ` +
    `applications=${m.PAYMENT_APPLICATION}. Evidence: ${out}\n`,
  );
  return result.verdict === "CLEAN" ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`financeRecordCensusCli: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main, EVIDENCE_FORMAT };
