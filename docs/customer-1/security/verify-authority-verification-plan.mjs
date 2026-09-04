#!/usr/bin/env node
// Verifier for docs/customer-1/security/PRODUCTION_AUTHORITY_VERIFICATION_PLAN.md
// (gate C1-SECURITY-01).
//
// The plan names, for each of the seven domains in the gate's close condition, a
// committed read-only procedure or a stated gap. Those claims decay in exactly two
// dangerous directions:
//
//   1. A procedure the plan calls READ-ONLY grows a write path, or loses the gate that
//      keeps it from running against production by accident. The plan then vouches for
//      safety it no longer has.
//   2. A procedure the plan cites disappears or is renamed, so the plan points an
//      authorized operator at nothing.
//
// This script re-measures both. It is deliberately a NEGATIVE check: it asserts that the
// safety properties still hold and that the doors the plan calls shut are still shut.
// It asserts nothing about production -- it never connects to anything, and the plan
// claims no production evidence either.
//
// Node stdlib only. Run: node docs/customer-1/security/verify-authority-verification-plan.mjs

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

// These files explain themselves at length, and their headers quote the very verbs the
// checks below hunt for -- the R-32 census has a whole section titled "WHY THERE IS NO
// --apply" that names set/update/delete. Matching raw source would read the explanation
// as the code it disclaims and report the exact opposite of the truth.
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const stripSh = (src) => src.replace(/^[ \t]*#.*$/gm, "");

// --- 1. Every procedure and artifact the plan cites still exists ----------------------
const CITED = [
  "firestore.rules",
  "scripts/audit/verify-production-functions-live-state.sh",
  "functions/scripts/verifyIssue100ProductionRules.js",
  "functions/scripts/productionFoundationVerification.js",
  "functions/scripts/r32ProductionExposureCensus.js",
  "functions/scripts/auditSecurityRoleMirror.js",
  "functions/test/firestoreRulesSourceHash.test.mjs",
  "functions/test/auditReadConfinement.test.mjs",
  "field-ops-app-vite/src/access/permissionCatalog.ts",
  "docs/customer-1/admin/DAY1_ADMIN_ACTION_CENSUS.md",
];
for (const rel of CITED) {
  check(existsSync(join(REPO, rel)), `cited path no longer exists: ${rel}`);
}

// --- 2. The gate's close condition still names the seven domains the plan decomposes ---
// If the Owner rewords the gate, this plan's seven-domain structure is stale and must be
// re-derived rather than quietly kept.
const ledger = read("docs/customer-1/CUSTOMER_1_LEDGER.json");
const gate = ledger === null ? null : JSON.parse(ledger).gates.find((g) => g.id === "C1-SECURITY-01");
check(gate != null, "C1-SECURITY-01 is no longer present in CUSTOMER_1_LEDGER.json");
if (gate) {
  for (const domain of [
    "Rules",
    "Functions",
    "capabilities",
    "roles",
    "protected actions",
    "tenant boundaries",
    "audit behavior",
  ]) {
    check(
      gate.closeWhen.includes(domain),
      `C1-SECURITY-01 closeWhen no longer names "${domain}" -- the plan's domain decomposition is stale`,
    );
  }
}

// --- 3. V4: the R-32 production census is still structurally read-only -----------------
// Its own header is the claim; this is the check. Firestore write verbs, any writer
// import, and any consultation of .firebaserc (which defaults to PRODUCTION) are all
// disqualifying.
// The census legitimately uses Map.set() for its in-memory grouping, so a bare `.set(`
// scan would be a false positive. These patterns are Firestore-write-specific instead:
// an inline write on a doc/collection ref, a batch/bulk writer, or a FieldValue sentinel
// -- none of which has any read-side use.
const r32 = stripJs(read("functions/scripts/r32ProductionExposureCensus.js") ?? "");
const WRITE_SIGNATURES = [
  [/\.(doc|collection|collectionGroup)\([^)]*\)\s*\.(set|update|delete|create)\(/, "an inline Firestore write"],
  [/\.batch\(|bulkWriter|WriteBatch/, "a batch/bulk writer"],
  [/FieldValue\.(serverTimestamp|increment|arrayUnion|arrayRemove|delete)/, "a FieldValue write sentinel"],
];
for (const [pattern, label] of WRITE_SIGNATURES) {
  check(
    !pattern.test(r32),
    `r32ProductionExposureCensus.js gained ${label} -- the plan's READ-ONLY claim for V4 is false`,
  );
}
check(/\.get\(|\.count\(/.test(r32), "r32ProductionExposureCensus.js no longer performs any Firestore read");
check(/--projectId/.test(r32), "r32ProductionExposureCensus.js no longer requires an explicit --projectId");
check(
  /not the production project/.test(r32),
  "r32ProductionExposureCensus.js lost its production-project mismatch refusal -- target pinning is gone",
);

// --- 4. V5/V7: the foundation verification still carries all three production gates ----
// This is the one procedure in the plan that exercises refusal paths, so it is the one
// whose gates matter most. Dry-run must stay the default.
const foundation = stripJs(read("functions/scripts/productionFoundationVerification.js") ?? "");
for (const gateFlag of ["--confirmProduction", "--ownerAuthorization", "--execute"]) {
  check(
    foundation.includes(gateFlag),
    `productionFoundationVerification.js no longer implements ${gateFlag} -- plan V5/V7 authority claim is stale`,
  );
}

// --- 5. V2: the Functions live-state audit is still read-only and project-pinned --------
const liveState = stripSh(read("scripts/audit/verify-production-functions-live-state.sh") ?? "");
for (const mutation of ["firebase deploy", "functions:delete", "gcloud functions deploy", "iam add-iam-policy-binding"]) {
  check(
    !liveState.includes(mutation),
    `verify-production-functions-live-state.sh issues "${mutation}" -- the plan's READ-ONLY claim for V2 is false`,
  );
}
check(
  liveState.includes("--confirm-project"),
  "verify-production-functions-live-state.sh lost its --confirm-project pin -- plan V2 is stale",
);

// --- 6. V6: the tenant boundary the plan describes is still enforced --------------------
// The plan asserts that no retained client update branch lets a client touch
// operatingCompanyId or warehouseId, because no affectedKeys().hasOnly([...]) list names
// them. If one ever does, a retained client update becomes a company transfer and the
// plan's V6 description is not merely stale -- it is describing a boundary that is gone.
const rules = readFileSync(join(REPO, "firestore.rules"), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
const updateAllowLists = [...rules.matchAll(/affectedKeys\(\)\s*\.hasOnly\(\s*\[([\s\S]*?)\]\s*\)/g)];
check(
  updateAllowLists.length > 0,
  "firestore.rules no longer contains any affectedKeys().hasOnly([...]) update allow-list -- re-measure plan V6",
);
for (const [, list] of updateAllowLists) {
  for (const field of ["operatingCompanyId", "warehouseId"]) {
    check(
      !list.includes(`"${field}"`) && !list.includes(`'${field}'`),
      `firestore.rules: an update affectedKeys().hasOnly list now names "${field}" -- the V6 tenant boundary is gone`,
    );
  }
}

// --- report -----------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`FAIL -- ${failures.length} plan claim(s) no longer hold:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nRe-measure docs/customer-1/security/PRODUCTION_AUTHORITY_VERIFICATION_PLAN.md.");
  process.exit(1);
}

console.log(
  `PASS -- production authority verification plan re-measured (${CITED.length} cited paths, ` +
    `${updateAllowLists.length} update allow-lists checked for tenant-boundary leakage).`,
);
