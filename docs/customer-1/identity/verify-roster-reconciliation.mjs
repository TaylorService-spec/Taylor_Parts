#!/usr/bin/env node
// Verifier for docs/customer-1/identity/PRODUCTION_ROSTER_RECONCILIATION.md
// (gate C1-IDENTITY-01).
//
// The document makes structural claims about the production identity chain and about what
// the committed instruments can and cannot see. Those claims decay in two directions:
//
//   1. A gap the document calls open quietly closes -- the census learns to read Firebase
//      Auth, the securityRole mirror becomes authorization -- and the document keeps
//      asserting a hole that is filled, or a safety property that is gone.
//   2. An instrument the document points a future authorized operator at is renamed,
//      loses its production pin, or grows a write path.
//
// Like the other two lane-C verifiers this is deliberately a NEGATIVE check: it asserts the
// doors the document calls shut are still shut. It connects to nothing and asserts nothing
// about production, because the document claims no production evidence either.
//
// Node stdlib only. Run: node docs/customer-1/identity/verify-roster-reconciliation.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const failures = [];
const check = (ok, claim) => {
  if (!ok) failures.push(claim);
};

const read = (rel) => {
  const abs = join(REPO, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
};

// These scripts document themselves at length and their headers quote the very verbs and
// identifiers the checks below hunt for -- provisionEmployeeAccess.js explains in prose
// that Firebase Auth owns the account email, and the census header explains why it has no
// writer. Matching raw source would read the explanation as the code it disclaims.
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const readCode = (rel) => stripJs(read(rel) ?? "");

// --- 1. Every instrument and artifact the document cites still exists ------------------
const CITED = [
  "firestore.rules",
  "functions/scripts/r32ProductionExposureCensus.js",
  "functions/scripts/auditSecurityRoleMirror.js",
  "functions/scripts/provisionEmployeeAccess.js",
  "functions/scripts/productionFoundationVerification.js",
  "field-ops-app-vite/src/access/governedBusinessRoles.ts",
  "field-ops-app-vite/src/access/compatibilityRoles.ts",
  "docs/customer-1/admin/DAY1_ADMIN_ACTION_CENSUS.md",
  "docs/customer-1/security/PRODUCTION_AUTHORITY_VERIFICATION_PLAN.md",
];
for (const rel of CITED) {
  check(existsSync(join(REPO, rel)), `cited path no longer exists: ${rel}`);
}

// --- 2. The gate still asks for the two obligations this procedure decomposes ----------
const ledger = read("docs/customer-1/CUSTOMER_1_LEDGER.json");
const gate = ledger === null ? null : JSON.parse(ledger).gates.find((g) => g.id === "C1-IDENTITY-01");
check(gate != null, "C1-IDENTITY-01 is no longer present in CUSTOMER_1_LEDGER.json");
if (gate) {
  for (const phrase of ["roster is reconciled", "least privilege", "persona"]) {
    check(
      gate.closeWhen.includes(phrase),
      `C1-IDENTITY-01 closeWhen no longer says "${phrase}" -- the procedure's decomposition is stale`,
    );
  }
}

const census = readCode("functions/scripts/r32ProductionExposureCensus.js");

// --- 3. The denominator problem still holds -------------------------------------------
// This is the document's central finding: the only production identity instrument that has
// been run enumerates principals from roleAssignments and never reads Firebase Auth. If
// either half changes, R1 is no longer the gap the document says it is.
check(
  /db\.collection\("roleAssignments"\)/.test(census),
  "r32ProductionExposureCensus.js no longer reads roleAssignments -- re-measure R4 and the denominator finding",
);
for (const authApi of ["firebase-admin/auth", "getAuth", "listUsers"]) {
  check(
    !census.includes(authApi),
    `r32ProductionExposureCensus.js now reaches Firebase Auth (${authApi}) -- the R1 "NONE" instrument claim is stale`,
  );
}
// byPrincipal -- the principal set -- must still be seeded from assignment documents only.
check(
  /for \(const d of assignmentsSnap\.docs\)[\s\S]{0,600}byPrincipal\.set/.test(census),
  "r32ProductionExposureCensus.js no longer builds its principal set from assignmentsSnap -- re-measure the denominator finding",
);

// --- 4. The join key is still users/{uid}.employeeId, not email ------------------------
check(
  /usersSnap\.docs\.map\(\(d\) => \[d\.id, \(d\.data\(\) \?\? \{\}\)\.employeeId\]\)/.test(census),
  "the census principal->employee join is no longer users/{uid}.employeeId -- the chain table is stale",
);
check(
  !/getUserByEmail|\.email\b/.test(census),
  "r32ProductionExposureCensus.js now joins on email -- the document states email is never the join key",
);

// --- 5. The census is still read-only and production-pinned ---------------------------
// Same three write signatures the security-plan verifier uses; the document points an
// authorized operator at this script for R4 on the strength of that property.
for (const [pattern, label] of [
  [/\.(doc|collection|collectionGroup)\([^)]*\)\s*\.(set|update|delete|create)\(/, "an inline Firestore write"],
  [/\.batch\(|bulkWriter|WriteBatch/, "a batch/bulk writer"],
  [/FieldValue\.(serverTimestamp|increment|arrayUnion|arrayRemove|delete)/, "a FieldValue write sentinel"],
]) {
  check(!pattern.test(census), `r32ProductionExposureCensus.js gained ${label} -- R4's read-only claim is false`);
}
check(
  /not the production project/.test(census),
  "r32ProductionExposureCensus.js lost its production-project refusal -- R4's target pinning is gone",
);

// --- 6. Every exception class the document says the census detects is still emitted ----
for (const kind of [
  "PRINCIPAL_HAS_NO_EMPLOYEE_LINK",
  "PRINCIPAL_JOIN_UNRESOLVED",
  "ASSIGNMENT_REFERENCES_MISSING_ROLE",
  "ASSIGNMENT_MALFORMED_SCOPE",
  "CONTRADICTORY",
]) {
  check(census.includes(kind), `census no longer produces "${kind}" -- the exception class table is stale`);
}
// ASSIGNMENT_UNKNOWN_STATUS / ASSIGNMENT_MALFORMED are emitted by interpolating
// assignmentState()'s return, so assert the states rather than the literal kind strings.
check(
  /return "UNKNOWN_STATUS"/.test(census) && /return "MALFORMED"/.test(census),
  "assignmentState() no longer distinguishes UNKNOWN_STATUS/MALFORMED -- the exception class table is stale",
);

// --- 7. R5: the mirror audit is still read-only by default and production-gated --------
// The --projectId/--confirmProduction contract is not spelled out here: this script
// imports assertProjectTarget from provisionEmployeeAccess.js and inherits it. Asserting
// the literal flag would only match the header comment, which stripJs has removed.
const mirror = readCode("functions/scripts/auditSecurityRoleMirror.js");
check(
  /repair/.test(mirror),
  "auditSecurityRoleMirror.js no longer implements a repair path -- re-measure R5's read-only-by-default claim",
);
check(
  /assertProjectTarget/.test(mirror),
  "auditSecurityRoleMirror.js lost its assertProjectTarget gate -- R5's production pinning is gone",
);
check(
  /if \(!repair\)/.test(mirror),
  "auditSecurityRoleMirror.js no longer short-circuits when repair is off -- R5 is no longer read-only by default",
);

// --- 8. R6: the four permitted claim fields are still exactly four ---------------------
const foundation = readCode("functions/scripts/productionFoundationVerification.js");
const permitted = foundation.match(/permittedKeys\s*=\s*new Set\(\[([^\]]*)\]\)/);
check(permitted != null, "productionFoundationVerification.js no longer declares permittedKeys -- re-measure R6");
if (permitted) {
  const fields = [...permitted[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  check(
    fields.join(",") === "accessVersion,companyAdmin,companyId,platformAdmin",
    `the permitted custom-claim fields changed to [${fields.join(", ")}] -- the identity chain table names four`,
  );
}

// --- 9. The authority properties of store 3 still hold ---------------------------------
// The document says securityRole is NEVER authorization but operationalRoles and
// assignedWarehouseIds ARE, via two named Rules helpers. Both halves matter: if
// securityRole becomes an authorization input, the mirror stops being a display
// convenience and drift becomes an access defect rather than a reporting one.
const rules = readFileSync(join(REPO, "firestore.rules"), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
check(
  !/securityRole/.test(rules),
  "firestore.rules now reads securityRole -- the mirror is authorization, and SECURITY_ROLE_MIRROR_DRIFT is an access defect",
);
for (const fn of ["isActiveOperationalRole", "isAssignedToWarehouse"]) {
  check(rules.includes(fn), `firestore.rules no longer defines ${fn}() -- re-measure the store-3 authority claim`);
}
check(
  /employee\.operationalRoles\s+is list/.test(rules) && /employee\.assignedWarehouseIds\s+is list/.test(rules),
  "firestore.rules no longer resolves access through employees.operationalRoles/assignedWarehouseIds -- LP3's reasoning is stale",
);

// --- 10. employees is still CLI-provisioned, so the roster has one writer --------------
const provision = readCode("functions/scripts/provisionEmployeeAccess.js");
check(
  /employeeId/.test(provision) && /userId/.test(provision),
  "provisionEmployeeAccess.js no longer writes the two-way employee/user link -- the chain table is stale",
);

// --- report -----------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`FAIL -- ${failures.length} roster-procedure claim(s) no longer hold:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nRe-measure docs/customer-1/identity/PRODUCTION_ROSTER_RECONCILIATION.md.");
  process.exit(1);
}

console.log(
  `PASS -- roster reconciliation procedure re-measured (${CITED.length} cited paths; R1 Auth-read gap, ` +
    `roleAssignments-only denominator, and securityRole non-authorization all still hold).`,
);
