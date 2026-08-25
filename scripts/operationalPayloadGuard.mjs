// OPERATIONAL PAYLOAD GUARD. Refuses committed files that are operational record snapshots.
//
// ============================ WHY NOT A FILENAME CHECK ============================
//
// Because the filename is exactly what survives a mistake untouched. `production-parts-export.csv`
// announced itself; the next one will be called `data.csv`, or `export-final.csv`, or the name of
// the ticket somebody was working on. A guard that reads names catches the honest cases and misses
// every careless one.
//
// So this reads SHAPE. A record snapshot has a recognisable form: a header row of record-ish field
// names, and many rows underneath it. That is what is being detected -- not a word in a path.
//
// ============================ WHY DOCS MUST NOT TRIP IT ============================
//
// `evidence-review.md` discusses `production-parts-export.csv` by name, at length, because that is
// what an audit narrative does. A guard that fired on prose describing an export would be deleted
// by the first person it inconvenienced, and it would deserve to be. Only STRUCTURED payload files
// are inspected; prose is not scanned at all.
//
// ============================ HOW SOMETHING IS ALLOWED ============================
//
// By carrying explicit synthetic provenance, or by being registered in the allowlist below with a
// reason. Not by being renamed. A file that declares `SYNTHETIC` and then carries production rows
// is a different problem, and not one a shape check can solve -- but a file that declares nothing
// and carries two hundred record rows is the case that actually happens.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();

/** File types that can carry a record payload. Prose is deliberately absent. */
const STRUCTURED_EXTENSIONS = [".csv", ".ndjson", ".tsv"];

const SKIP_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", "lib",
  ".claude", ".codex", "worktrees", "tmp", "__pycache__",
]);

/**
 * Field names that indicate a row is an operational RECORD rather than a table of analysis.
 *
 * Deliberately identity-shaped: the question is "does a row here refer to a specific real thing in
 * the operating system" -- an account, a work order, a person, an invoice -- not "is this file
 * about inventory".
 */
const RECORD_FIELD_MARKERS = [
  "accountid", "customerid", "clientid", "contactid",
  "workorderid", "workordernumber", "wonumber",
  "employeeid", "userid", "uid", "email",
  "invoiceid", "invoicenumber", "paymentid",
  "serialnumber", "assetid", "equipmentid",
  "partid", "sku", "internalpartnumber",
  "salesorderid", "purchaseorderid", "ponumber",
];

/** A file is a payload only if it has BOTH record-ish fields and enough rows to be a snapshot. */
const ROW_THRESHOLD = 25;

/**
 * Markers a file may carry to declare itself synthetic.
 *
 * Checked in the file's own bytes, not in its name. A CSV cannot hold a comment, so a synthetic
 * fixture declares itself with a provenance column or a `SYNTHETIC` token in the header.
 */
const SYNTHETIC_MARKERS = ["synthetic", "syn-", "fixture", "sample_only"];

/**
 * Files that are structured, record-shaped, and legitimately committed.
 *
 * Every entry needs a reason. An allowlist without reasons becomes a place to put things.
 */
export const ALLOWLIST = new Map([
  ["docs/audits/inv-convergence-b/static-catalog-population.csv",
    "Repository PARTS_CATALOG population. Generated from synthetic_parts_test_data.csv; no operational read."],
  ["docs/audits/inv-convergence-b/canonical-operational-join.csv",
    "Analysis output joining the (now removed) read-back against the static catalog. Reported as a " +
    "removal candidate with the same provenance; retained pending Owner decision, not by default."],
  ["docs/audits/inv-convergence-b/excluded-ten-part-manifest.csv",
    "Ten static SKUs absent from production. Static descriptive fields only; the absence is the finding."],
  ["functions/test/fixtures/part-master-migration-fixture.csv",
    "Test fixture. Synthetic by construction and consumed by the migration tests."],
  ["docs/governance/workbook-v2/3-detailed-crud.csv",
    "Role-to-CRUD governance matrix. Capability rows, not records about people."],
  ["docs/governance/workbook-v2/4-role-to-capability.csv",
    "Role-to-capability governance matrix. Capability rows, not records about people."],
  ["docs/governance/workbook-v2/2-role-object-summary-GENERATED.csv",
    "Generated governance summary over roles and objects."],
  ["docs/governance/workbook-v2/1-user-to-role.csv",
    "Assignment contract note, not an employee roster."],
  ["docs/governance/workbook-v2/5-segregation-of-duties.csv",
    "Segregation-of-duties matrix over roles."],
  ["docs/governance/workbook-v2/6-gaps-decisions.csv",
    "Governance gaps and the decisions taken against them. Analysis rows, no operational records."],
  ["docs/assessments/crud-matrix-reconciliation-2026-08-19.csv",
    "CRUD matrix reconciliation over roles and objects."],
  ["docs/assessments/role-object-matrix-2026-08-18.csv",
    "Role-to-object permission matrix. Rows are roles and object types, not records about anyone."],
  ["docs/audits/inv1-phase1/migration-readiness/conflicts.csv",
    "Migration analyzer output: malformed identifier diagnostics, below the row threshold."],
  ["docs/audits/inv1-phase1/migration-readiness/invalid-rows.csv",
    "Migration analyzer output: rejected-row diagnostics, below the row threshold."],
  ["docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/conflicts.csv",
    "Migration analyzer output."],
  ["docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/invalid-rows.csv",
    "Migration analyzer output."],
  ["docs/audits/inv1-phase1/production-dryrun-20260723-01/conflicts.csv",
    "Dry-run analyzer output."],
  ["docs/audits/inv1-phase1/production-dryrun-20260723-01/invalid-rows.csv",
    "Dry-run analyzer output."],
]);

function walk(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, found);
    else if (STRUCTURED_EXTENSIONS.some((extension) => entry.toLowerCase().endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

export function classifyFile(text, relativePath) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { payload: false, reason: "empty" };

  const header = lines[0].toLowerCase();
  const rows = lines.length - 1;

  const fields = header.split(/[,;\t]/).map((field) => field.trim().replace(/[^a-z0-9_]/g, ""));
  const recordFields = fields.filter((field) => RECORD_FIELD_MARKERS.includes(field));

  if (recordFields.length === 0) {
    return { payload: false, reason: "no record-identity fields in the header", rows };
  }
  if (rows < ROW_THRESHOLD) {
    return { payload: false, reason: `only ${rows} row(s); below the snapshot threshold`, rows };
  }

  // Synthetic provenance is checked in the CONTENT, never in the name.
  const sample = lines.slice(0, 40).join("\n").toLowerCase();
  const synthetic = SYNTHETIC_MARKERS.some((marker) => sample.includes(marker));
  if (synthetic) {
    return { payload: false, reason: "declares synthetic provenance in its own content", rows };
  }

  return {
    payload: true,
    rows,
    recordFields,
    reason: `${rows} rows keyed by ${recordFields.join(", ")} with no synthetic provenance`,
  };
}

export function scanRepository(root = REPO_ROOT) {
  const violations = [];
  for (const file of walk(root)) {
    const relativePath = relative(root, file).split(sep).join("/");
    if (ALLOWLIST.has(relativePath)) continue;

    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const verdict = classifyFile(text, relativePath);
    if (verdict.payload) violations.push({ path: relativePath, ...verdict });
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]?.split(sep).join("/")}` ||
    process.argv[1]?.endsWith("operationalPayloadGuard.mjs")) {
  const violations = scanRepository();
  if (violations.length) {
    for (const violation of violations) {
      console.error(`::error file=${violation.path}::operational payload: ${violation.reason}`);
    }
    console.error(
      `\n${violations.length} committed file(s) look like operational record snapshots.\n` +
      "Remove the payload and commit a metadata evidence artifact instead, or -- if the file is " +
      "genuinely synthetic -- make that visible in its own content and add it to ALLOWLIST with a reason.");
    process.exit(1);
  }
  console.log("no committed operational payloads found");
}
