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

// Content hash over LINE-ENDING-NORMALISED text, with every CR stripped by character code.
//
// This field used to be a byte COUNT, which made the artifact irreproducible: a Windows checkout
// with CRLF measures DECISIONS.md at 372,668 bytes and CI's LF measures 370,799, for a file nobody
// had edited. The drift guard caught it on its first live run.
//
// The FIRST fix was also wrong -- it normalised by splitting on an escape sequence that did not
// survive being written to disk, so it silently hashed the raw bytes and CI failed again with a
// different pair of hashes. String.fromCharCode(13) cannot be mangled in transit, which is the
// whole reason it is used here instead of the obvious escape.
const sha256Normalised = (text) =>
  "sha256:" + createHash("sha256").update(text.split(String.fromCharCode(13)).join("")).digest("hex");

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
  "reorder.purchaseOrder.read": "#114", "customer.governedField.write": "#114",
  "customer.record.create": "#114", "customer.record.read": "#114",
  "inventory.catalog.manage": "OWNER-2026-08-21 (restored; MATRIX_OWNER_CONFLICT resolved to the decision)",
  "crm.activity.read": "OWNER-2026-08-19", "crm.activity.create": "OWNER-2026-08-19",
  "inventory.stock.receive": "EI Phase-2 grant gate",
  // Slice 4. Granted to exactly the three roles that already hold opportunity.createSalesOrder,
  // because that capability became UNREACHABLE without these: a Sales Order is now created only
  // from an ACCEPTED Sales Agreement, so a role that can create the order but not the commitment it
  // comes from holds an authority it cannot exercise. There is no CRUD row because the Agreement is
  // a new object; the decision is recorded rather than the gate bypassed.
  "salesAgreement.create": "#121", "salesAgreement.updateDraft": "#121",
  "salesAgreement.accept": "#121", "salesAgreement.read": "#121",
  // FIN-004 financial reach. There is no CRUD row because the matrix models OBJECTS and these
  // model REACH -- how far a holder of the finance.read fact-family gate may see. The Owner ruled
  // the carrier of each scope explicitly (#159), which is precisely the case this map exists for.
  // Keyed by capability, like every entry above: the decision fixes WHO holds each scope, and the
  // per-Role assignment is asserted in fin004ReachComposition.test.mjs's approved matrix.
  "finance.visibility.consolidated": "#159",
  "finance.visibility.team": "#159",
  "finance.visibility.self": "#159",
  // Performance Goal Authority. No CRUD row exists because the matrix models OBJECTS and a goal is
  // a TARGET on a metric -- the same shape of gap the FIN-004 reach entries above describe. The
  // Owner's direction fixed the carrier of each verb by Role (#162), which is exactly what this map
  // is for. Keyed by capability, like every entry above.
  //
  // NOTE the sweep will also list admin and owner as holders, and that is not an ungoverned grant:
  // admin's set is DERIVED as ADMIN_CURATED_PERMISSIONS plus the entire PERMISSION_CATALOG by Owner
  // ruling (2026-08-19), so every registered capability is admin's by construction.
  "performance.goal.read": "#162",
  "performance.goal.create": "#162",
  "performance.goal.approve": "#162",
  "performance.goal.supersede": "#162",
  "performance.goal.retire": "#162",
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

// AN EQUALITY AGAIN, as of DECISIONS #159 (2026-09-02).
//
// History, because this pair has moved three times: #114's parity said "FOR NOW"; the 2026-08-19
// "Purchasing falls under accounting" ruling ended it and left an ORDERING (accounting retains
// everything finance holds, and may hold more); the 2026-08-20 roster then moved purchasing to
// purchasingManager, which removed the only thing the ordering was protecting -- but the ordering
// was left in place, and financeManager silently drifted DOWN to five permissions with no
// `finance.*` id at all. A one-directional check cannot see a subset shrinking.
//
// #159 restores equality and both Roles are now built from one shared constant, so the drift is
// structurally impossible rather than merely detected. This reverse-sweep entry is KEPT rather
// than deleted: it still answers "does accounting hold LESS than a decision requires", which is
// the direction every guard here was blind to until 2026-08-21, and equality means it now also
// catches the shrink that actually happened. Exact equality in BOTH directions is asserted by
// governedBusinessRoles.test.mjs; this is the governance-artifact half of the same claim.
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
  { cap: "customer.governedField.write", holders: ["accountingManager"], ref: "#114" },
  { cap: "customer.record.create", holders: ["operationsManager"], ref: "#114" },
  { cap: "customer.record.read", holders: BUSINESS.filter((r) => r.endsWith("Manager")), ref: "#114 every manager Role" },
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
  decisionsFileSha: sha256Normalised(decisions),
};
writeFileSync(path.join(REPO, "docs/governance/precedence-sweep.json"), JSON.stringify(out, null, 1));
console.log("roles swept:", BUSINESS.length, "| pairs:", rows.length);
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(" ", k.padEnd(26), v);
console.log("REVERSE SWEEP missing decided mappings:", missing.length);
for (const m of missing) console.log("   MISSING", m.roleId, m.capability, `(${m.decision})`);
const unjust = rows.filter((r) => r.classification === CLASS.UNJUSTIFIED);
console.log("UNJUSTIFIED:", unjust.length);
for (const u of unjust) console.log("   ", u.roleId, u.capability);
