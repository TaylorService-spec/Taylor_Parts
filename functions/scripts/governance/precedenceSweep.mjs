#!/usr/bin/env node
// PRECEDENCE SWEEP. For every capability held by a governed business Role, WHY does it hold it?
//
// The reconciliation asked whether each mapping was SEMANTICALLY right -- does this capability
// govern this object. This asks the different, later question: even where the mapping is correct,
// did someone already decide who holds it? A correct mapping applied over a recorded decision is
// still a governance regression, and no semantic guard can see it.
//
// PRECEDENCE ORDER (Owner, 2026-08-21), highest first:
//   1. explicit Owner governance decision
//   2. canonical reconciled business-intent matrix (Detailed CRUD)
//   3. historical / current implementation
//   4. stale or generated summaries
//
// Run: node scripts/governance/precedenceSweep.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const gb = await import(pathToFileURL(path.resolve(REPO, "functions/lib/access/governedBusinessRoles.js")).href);
const cr = await import(pathToFileURL(path.resolve(REPO, "functions/lib/access/compatibilityRoles.js")).href);
const { composedFor } = await import(pathToFileURL(path.resolve(__dirname, "functionalRoleComposition.mjs")).href);

const contract = JSON.parse(readFileSync(path.join(REPO, "docs/governance/role-capability-contract.json"), "utf8"));
const decisions = readFileSync(path.join(REPO, "docs/DECISIONS.md"), "utf8");

export const CLASS = Object.freeze({
  EXPLICIT_OWNER_DECISION: "EXPLICIT_OWNER_DECISION",
  CANONICAL_MATRIX: "CANONICAL_MATRIX",
  WORKFLOW_REQUIRED: "WORKFLOW_REQUIRED",
  INTENTIONAL_OVERLAP: "INTENTIONAL_OVERLAP",
  RULE_GOVERNED: "RULE_GOVERNED",
  LEGACY_COMPATIBILITY_ONLY: "LEGACY_COMPATIBILITY_ONLY",
  MATRIX_OWNER_CONFLICT: "MATRIX_OWNER_CONFLICT",
  UNJUSTIFIED: "UNJUSTIFIED",
  UNMODELLED: "UNMODELLED",
});

// Capability -> the recorded decision that fixes WHO holds it. Sourced from docs/DECISIONS.md, not
// from the role file, so a role file edit cannot also edit its own justification.
const DECIDED = {
  "fulfillment.coordinatedVisit.read": "#113",
  "salesOrder.read": "#114", "inventory.transaction.read": "#114",
  "reorder.purchaseOrder.read": "#114", "account.governedField.write": "#114",
  "account.record.create": "#114", "account.record.read": "#114",
  "inventory.catalog.manage": "OWNER-2026-08-21 (restored; MATRIX_OWNER_CONFLICT resolved to the decision)",
  "crm.activity.read": "OWNER-2026-08-19", "crm.activity.create": "OWNER-2026-08-19",
  "inventory.stock.receive": "EI Phase-2 grant gate",
};
// WORKFLOW GRANTS. A capability with no matrix row and no composition, held because a recorded
// Owner direction describes the SEQUENCE the Role performs. A workflow is not one write, and the
// matrix models objects rather than sequences, so these will never appear as a CRUD cell.
const WORKFLOW_GRANTS = {
  "purchasingManager|reorder.request.read.queue": "Owner roster 2026-08-20 + ruling 2026-08-19 'Purchasing falls under accounting': the buyer must see what needs buying",
  "purchasingManager|reorder.request.startPurchasing": "Owner roster 2026-08-20: take a request into purchasing",
  "purchasingManager|reorder.request.recordPurchaseOrder": "Owner roster 2026-08-20: record the resulting Purchase Order",
  "fieldManager|workOrder.cancel": "Spec 26.2 Owner direction: Service Manager holds the FULL Work Order lifecycle; cancel is part of that lifecycle",
};

// NOT an equality. DECISIONS #114's parity said "FOR NOW" and the Owner ruling of 2026-08-19 ended
// it, leaving an ORDERING (accounting retains everything finance holds, and may hold more). The
// sweep must not derive capability for the subset Role from the superset -- doing so would raise
// Finance into the purchasing workflow on the authority of a superseded decision.
const ASSERTED_ORDERING = { superset: "accountingManager", subset: "financeManager" };

// The 15 governed BUSINESS Roles the sweep covers. The functional Roles are per-employee grants and
// the compatibility Roles are explicitly out of scope by Owner ruling.
const BUSINESS = Object.keys(contract.roles);
const rows = [];
for (const roleId of BUSINESS) {
  const role = gb.GOVERNED_BUSINESS_ROLES[roleId];
  if (!role) {
    // dispatcher and technician have workbook rows but are COMPATIBILITY Roles, not governed
    // business Roles. The Owner ruled they are not to be reduced, so they are out of scope here.
    rows.push({ roleId, capability: null, classification: CLASS.LEGACY_COMPATIBILITY_ONLY,
      basis: "workbook Role implemented as a compatibility Role; Owner ruling: do not reduce" });
    continue;
  }
  const summary = contract.roles[roleId];
  const fromMatrix = new Set(summary.directCapabilities);
  const composed = composedFor(roleId);
  const fromComposed = new Set(composed.flatMap((f) => gb.GOVERNED_BUSINESS_ROLES[f]?.permissions || []));
  const otherHolders = (cap) => BUSINESS.filter((r) => r !== roleId &&
    (gb.GOVERNED_BUSINESS_ROLES[r]?.permissions || []).includes(cap));

  for (const cap of role.permissions) {
    let classification, basis;
    if (DECIDED[cap]) { classification = CLASS.EXPLICIT_OWNER_DECISION; basis = `DECISIONS ${DECIDED[cap]}`; }
    else if (fromMatrix.has(cap)) { classification = CLASS.CANONICAL_MATRIX; basis = "Detailed CRUD row"; }
    else if (fromComposed.has(cap)) { classification = CLASS.WORKFLOW_REQUIRED; basis = `composed: ${composed.join(", ")}`; }
    else if (WORKFLOW_GRANTS[`${roleId}|${cap}`]) { classification = CLASS.WORKFLOW_REQUIRED; basis = WORKFLOW_GRANTS[`${roleId}|${cap}`]; }
    else { classification = CLASS.UNJUSTIFIED; basis = "no matrix row, no composition, no recorded decision"; }
    rows.push({ roleId, capability: cap, classification, basis, alsoHeldBy: otherHolders(cap) });
  }
}

// REVERSE SWEEP. Not "does a Role hold too much" but "does a Role hold LESS than a decision requires".
// This is the direction every guard in this repository was blind to until 2026-08-21.
const missing = [];
const decidedHolderClaims = [
  { cap: "fulfillment.coordinatedVisit.read", holders: ["operationsManager", "fieldManager"], ref: "#113" },
  { cap: "salesOrder.read", holders: ["salesManager", "financeManager", "accountingManager"], ref: "#114" },
  { cap: "inventory.transaction.read", holders: ["salesManager"], ref: "#114" },
  { cap: "reorder.purchaseOrder.read", holders: ["financeManager", "accountingManager"], ref: "#114" },
  { cap: "account.governedField.write", holders: ["accountingManager"], ref: "#114" },
  { cap: "account.record.create", holders: ["operationsManager"], ref: "#114" },
  { cap: "account.record.read", holders: BUSINESS.filter((r) => r.endsWith("Manager")), ref: "#114 every manager Role" },
];
for (const claim of decidedHolderClaims) {
  for (const r of claim.holders) {
    if (!(gb.GOVERNED_BUSINESS_ROLES[r]?.permissions || []).includes(claim.cap)) {
      missing.push({ roleId: r, capability: claim.cap, decision: claim.ref });
    }
  }
}
{
  const { superset, subset } = ASSERTED_ORDERING;
  const sup = new Set(gb.GOVERNED_BUSINESS_ROLES[superset]?.permissions || []);
  for (const c of gb.GOVERNED_BUSINESS_ROLES[subset]?.permissions || []) {
    if (!sup.has(c)) missing.push({ roleId: superset, capability: c, decision: `#114 as superseded 2026-08-19: ${superset} retains everything ${subset} holds` });
  }
}

const byClass = {};
for (const r of rows) byClass[r.classification] = (byClass[r.classification] || 0) + 1;
const out = {
  precedenceOrder: ["explicit Owner governance decision", "canonical reconciled business-intent matrix",
    "historical/current implementation", "stale or generated summaries"],
  totals: byClass, rows,
  reverseSweep: { missingDecidedMappings: missing },
  // A real content hash, over LINE-ENDING-NORMALISED text.
  //
  // This field was a byte COUNT, and it made the artifact irreproducible: a Windows checkout with
  // CRLF and CI's LF produce different lengths for identical content, so the drift guard failed on
  // its first live run against a file nobody had edited. Caught by the guard itself, which is the
  // only reason it is not still there.
  decisionsFileSha: `sha256:${createHash("sha256").update(decisions.split("' + chr(92) + 'r' + chr(92) + 'n").join("' + chr(92) + 'n")).digest("hex")}`,
};
writeFileSync(path.join(REPO, "docs/governance/precedence-sweep.json"), JSON.stringify(out, null, 1));
console.log("roles swept:", BUSINESS.length, "| pairs:", rows.length);
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(" ", k.padEnd(26), v);
console.log("REVERSE SWEEP missing decided mappings:", missing.length);
for (const m of missing) console.log("   MISSING", m.roleId, m.capability, `(${m.decision})`);
const unjust = rows.filter((r) => r.classification === CLASS.UNJUSTIFIED);
console.log("UNJUSTIFIED:", unjust.length);
for (const u of unjust) console.log("   ", u.roleId, u.capability);
