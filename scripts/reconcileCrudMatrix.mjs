#!/usr/bin/env node
// CRUD MATRIX RECONCILIATION -- what the business access design says, next to what the
// permission catalog actually enforces.
//
// WHY THIS EXISTS. Taylor_Freezer_User_to_Role_CRUD_Matrix.xlsx is a good business-access
// design and it cannot be RECONCILED: no cell links to a capability id, so a divergence
// between the design and the system is invisible until someone goes looking. That is
// exactly how the admin Role came to hold 50 of 110 capabilities without anyone revoking
// anything -- the catalog grew, the hand-kept list did not, and nothing compared them.
//
// This reads the matrix's role/object grid from MATRIX below and the live access
// contracts from functions/src/access, and reports one row per (role, object):
//
//   IMPLEMENTED     the design's access exists as capabilities the Role holds
//   PARTIAL         some of it exists; the rest does not
//   NOT GRANTED     capabilities exist for this object, the Role holds none of them
//   NO CAPABILITY   nothing in the catalog governs this object at all
//   RULES ONLY      governed by firestore.rules, outside the capability engine
//
// WHAT IT IS NOT. It does not decide who SHOULD have what -- every difference it prints is
// a question for the Owner, not a defect. A NOT GRANTED row can mean the grant is missing
// or the matrix is wrong, and this cannot tell which. It also reports GRANTS, not
// ACTIVATION: an id registered active:false denies for everyone regardless, so an
// IMPLEMENTED row still says nothing about whether the capability is live in any
// environment.
//
//   node scripts/reconcileCrudMatrix.mjs            # readable report
//   node scripts/reconcileCrudMatrix.mjs --csv      # one row per cell, for the workbook
//   node scripts/reconcileCrudMatrix.mjs --gaps     # only the rows that disagree

import { pathToFileURL } from "node:url";
import { statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (f) => pathToFileURL(join(HERE, "..", "functions", "lib", "access", f)).href;

// STALENESS GUARD. This reads functions/lib -- the COMPILED contracts -- because they are
// plain JS this script can import directly. That means a lib older than its source would
// have it report YESTERDAY every bit as confidently as today.
//
// For a reconciliation tool that is the worst failure available: the entire purpose is to
// be the thing that notices drift, and quietly comparing the matrix against a stale build
// would manufacture exactly the false all-clear it exists to prevent. So it refuses to run
// rather than print a number nobody can trust.
const SOURCES = ["governedBusinessRoles", "compatibilityRoles", "permissionCatalog"];
const stale = [];
for (const name of SOURCES) {
  const src = join(HERE, "..", "functions", "src", "access", `${name}.ts`);
  const out = join(HERE, "..", "functions", "lib", "access", `${name}.js`);
  let srcStat, outStat;
  try { srcStat = statSync(src); } catch { continue; }
  try { outStat = statSync(out); } catch { stale.push(`${name}: never compiled`); continue; }
  if (srcStat.mtimeMs > outStat.mtimeMs) stale.push(`${name}: source is newer than the build`);
}
if (stale.length > 0) {
  console.error("REFUSING: the compiled access contracts are behind their source.");
  console.error("");
  for (const s of stale) console.error(`  ${s}`);
  console.error("");
  console.error("This report would describe the previous build, not the current contracts.");
  console.error("Rebuild first:");
  console.error("");
  console.error("  cd functions && npm run build");
  console.error("");
  process.exit(1);
}

const { GOVERNED_BUSINESS_ROLES } = await import(lib("governedBusinessRoles.js"));
const { COMPATIBILITY_ROLES } = await import(lib("compatibilityRoles.js"));
const { PERMISSION_CATALOG } = await import(lib("permissionCatalog.js"));

const ALL_ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const CATALOG = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));

// --- the matrix, transcribed -------------------------------------------------------
// Role labels are the workbook's; `roleId` is the access-contract id it maps to. A null
// roleId means the matrix names a role the system does not have -- itself a finding.
const MATRIX_ROLES = [
  { label: "Owner", roleId: "owner" },
  { label: "Administrator", roleId: "admin" },
  { label: "Sales Manager", roleId: "salesManager" },
  { label: "Salesperson", roleId: "salesperson" },
  // Owner ruling 2026-08-19: a top-level Marketing position, peer to Sales Manager.
  { label: "Marketing", roleId: "marketingManager" },
  // Owner ruling 2026-08-19: "service Manager is fieldManager".
  { label: "Service Manager", roleId: "fieldManager" },
  { label: "Dispatcher", roleId: "dispatcher" },
  { label: "Technician", roleId: "technician" },
  { label: "Warehouse Manager", roleId: "warehouseManager" },
  { label: "Warehouse Associate", roleId: "warehouseAssociate" },
  // Owner ruling 2026-08-19: "Purchasing falls under accounting" -- no standalone Role.
  { label: "Purchasing", roleId: "accountingManager", note: "folded into Accounting" },
  { label: "Controller / Accounting", roleId: "accountingManager" },
];

// Each object maps to the capability ids that govern it. `null` means the catalog has
// nothing for it. Verbs are grouped so a C/R/E claim can be checked against real ids.
const OBJECTS = [
  { object: "Accounts", domain: "CRM", C: ["account.record.create"], R: ["account.record.read"], E: ["account.record.update", "account.governedField.write"] },
  { object: "Contacts", domain: "CRM", rulesOnly: "firestore.rules /contacts/{contactId}" },
  { object: "Customer Locations", domain: "CRM", rulesOnly: "firestore.rules /locations/{locationId}" },
  { object: "Opportunities", domain: "Sales", C: [], R: ["opportunity.read"], E: ["opportunity.write"] },
  { object: "Marketing Initiatives", domain: "Marketing", missing: true },
  { object: "Sales Orders", domain: "Sales", C: ["opportunity.createSalesOrder"], R: ["salesOrder.read"], E: ["salesOrder.write", "salesOrder.fulfill", "salesOrder.service"] },
  { object: "Commissions", domain: "Sales / Finance", missing: true },
  { object: "Work Orders", domain: "Service", C: ["workOrder.create"], R: [], E: ["workOrder.transition", "workOrder.cancel", "workOrder.parts.plan"] },
  { object: "Dispatch Schedule", domain: "Service", C: [], R: ["fulfillment.coordinatedVisit.read"], E: [] },
  { object: "Technician Time / Non-work", domain: "Service", missing: true },
  { object: "Parts Catalog", domain: "Inventory", C: [], R: ["inventory.catalog.read"], E: ["inventory.catalog.manage", "inventory.catalog.activate"] },
  { object: "Inventory Stock", domain: "Inventory", C: [], R: ["inventory.transaction.read", "inventory.analytics.read"], E: ["inventory.stock.receive"] },
  { object: "Inventory Adjustments", domain: "Inventory", C: ["inventory.action.create"], R: ["inventory.action.read"], E: ["inventory.cycleCount.reconcile"] },
  { object: "Purchase Orders", domain: "Procurement", C: ["reorder.purchaseOrder.create"], R: ["reorder.purchaseOrder.read"], E: ["reorder.purchaseOrder.void"] },
  { object: "Receiving", domain: "Inventory", C: [], R: [], E: ["inventory.stock.receive"] },
  { object: "Transfer Orders", domain: "Inventory", C: ["inventory.transfer.create"], R: ["warehouse.transferOrder.read"], E: ["inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"] },
  { object: "Serialized Assets", domain: "Inventory", C: [], R: ["inventory.serializedAsset.read"], E: [] },
  { object: "Equipment / Installed Base", domain: "Service", rulesOnly: "firestore.rules /equipment/{equipmentId}" },
  { object: "Invoices / AR", domain: "Finance", C: ["finance.invoice.issue"], R: ["finance.read"], E: ["finance.adjustment.record"] },
  { object: "Payments", domain: "Finance", C: ["finance.payment.apply"], R: ["finance.read"], E: ["finance.refund.record"] },
  { object: "Notifications", domain: "Platform", missing: true },
  { object: "Users", domain: "Administration", C: [], R: [], E: ["admin.userStatus.write", "admin.credentialReset.initiate"] },
  { object: "Roles / Permissions", domain: "Administration", C: [], R: [], E: ["admin.roleAssignment.write", "admin.accessRequest.decide"] },
  { object: "Audit Log", domain: "Administration", C: [], R: ["audit.event.read"], E: [] },
];

// The workbook's Role x Object grid, verbatim. "" = no access.
const MATRIX = {
  "Owner":                   ["CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRED","CRED","R"],
  "Administrator":           ["CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRE","CRED","CRE","R"],
  "Sales Manager":           ["CRE","CRE","CRE","CRE","R","CRE","R","R","R","","R","R","","","","","","R","R","","R","","","R"],
  "Salesperson":             ["CRE","CRE","CRE","CRE","R","CRE","R","R","","","R","R","","","","","","R","R","","R","","",""],
  "Marketing":               ["R","R","R","R","CRED","R","","","","","","","","","","","","","","","R","","",""],
  "Service Manager":         ["R","R","R","","","R","","CRE","CRE","CRE","R","R","","","","","R","CRE","R","","R","","","R"],
  "Dispatcher":              ["R","R","R","","","R","","CRE","CRE","R","R","R","","R","R","R","R","R","","","R","","",""],
  "Technician":              ["","","R","","","","","RE","R","RE","R","R","","","","","R","RE","","","R","","",""],
  "Warehouse Manager":       ["R","","R","","","R","","R","R","","CRE","CRE","CRE","R","CRE","CRE","CRE","R","","","R","","","R"],
  "Warehouse Associate":     ["","","R","","","R","","R","","","R","RE","R","R","RE","RE","RE","R","","","R","","",""],
  "Purchasing":              ["","","","","","R","","R","","","R","R","R","CRE","R","R","R","R","R","","R","","",""],
  "Controller / Accounting": ["R","R","R","R","","R","CRE","R","","","R","R","R","R","R","R","R","R","CRE","CRE","R","","","R"],
};

const VERB = { C: "Create", R: "Read", E: "Edit" };

function classify(roleEntry, obj, code) {
  const wants = ["C", "R", "E"].filter((v) => code.includes(v));
  if (wants.length === 0) return { status: "no access asked", detail: "" };
  if (obj.missing) return { status: "NO CAPABILITY", detail: "no id in the catalog governs this object" };
  if (obj.rulesOnly) return { status: "RULES ONLY", detail: obj.rulesOnly };

  const role = roleEntry.roleId ? ALL_ROLES[roleEntry.roleId] : null;
  if (!role) return { status: "NO ROLE", detail: `no access-contract role for "${roleEntry.label}"` };
  const held = new Set(role.permissions);

  const met = [];
  const unmet = [];
  for (const v of wants) {
    const ids = obj[v] ?? [];
    if (ids.length === 0) { unmet.push(`${VERB[v]} (no capability exists for this verb)`); continue; }
    const have = ids.filter((id) => held.has(id));
    if (have.length > 0) met.push(`${VERB[v]}: ${have.join(", ")}`);
    else unmet.push(`${VERB[v]}: none of ${ids.join(", ")}`);
  }
  if (unmet.length === 0) return { status: "IMPLEMENTED", detail: met.join(" | ") };
  if (met.length === 0) return { status: "NOT GRANTED", detail: unmet.join(" | ") };
  return { status: "PARTIAL", detail: `HAS ${met.join(" | ")} — MISSING ${unmet.join(" | ")}` };
}

const rows = [];
for (const roleEntry of MATRIX_ROLES) {
  const codes = MATRIX[roleEntry.label];
  if (!codes) continue;
  OBJECTS.forEach((obj, i) => {
    const code = (codes[i] ?? "").trim();
    const { status, detail } = classify(roleEntry, obj, code);
    if (status === "no access asked") return;
    rows.push({ role: roleEntry.label, roleId: roleEntry.roleId ?? "-", object: obj.object, domain: obj.domain, code, status, detail });
  });
}

const args = new Set(process.argv.slice(2));
const GAPS = new Set(["NOT GRANTED", "NO CAPABILITY", "RULES ONLY", "PARTIAL", "NO ROLE"]);
const shown = args.has("--gaps") ? rows.filter((r) => GAPS.has(r.status)) : rows;

if (args.has("--csv")) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  console.log(["Role", "Role Id", "Object", "Domain", "Matrix Code", "Status", "Detail"].map(esc).join(","));
  for (const r of shown) console.log([r.role, r.roleId, r.object, r.domain, r.code, r.status, r.detail].map(esc).join(","));
} else {
  const tally = {};
  for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
  console.log("CRUD MATRIX RECONCILIATION");
  console.log("=".repeat(78));
  console.log(`${rows.length} cells where the matrix asks for access.\n`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  let currentRole = null;
  for (const r of shown) {
    if (r.role !== currentRole) { currentRole = r.role; console.log(`\n--- ${r.role}  [${r.roleId}] ---`); }
    console.log(`  ${r.status.padEnd(14)} ${r.object.padEnd(28)} matrix=${r.code.padEnd(5)} ${r.detail}`);
  }
  console.log("\nGRANTS, NOT ACTIVATION: an IMPLEMENTED row means the Role holds the id.");
  console.log("A capability registered active:false still denies for everyone, everywhere.");
}
