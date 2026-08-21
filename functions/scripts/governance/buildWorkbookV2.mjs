#!/usr/bin/env node
// GOVERNANCE WORKBOOK V2 -- generated, so Summary can never drift from Detailed CRUD again.
//
// The original workbook maintained Role Object Summary and Detailed CRUD as two INDEPENDENT designs.
// They disagreed in 68 places, and Summary turned out to be stale copy-paste: General Manager's row
// was Admin's, Controller and Support Staff were Accounting Manager's, and the Parts and Shop rows
// were the Warehouse rows. Anyone reading Summary was reading a different permission model from
// anyone reading Detailed.
//
// So Summary stops being a document and becomes a projection. Edit Detailed CRUD; regenerate.
//
// Emits CSV per sheet rather than a binary .xlsx: CSV diffs in review, and a governance artifact
// whose changes cannot be read in a pull request is one nobody reviews. The sheets import unchanged.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OBJECT_CAPABILITY_MAP, governanceTypeFor } from "./objectCapabilityMap.mjs";
import { SOD_EXCLUSIVE_PAIRS, SOD_DISTINCT_AUTHORITIES } from "./functionalRoleComposition.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const OUT = path.join(REPO, "docs/governance/workbook-v2");
mkdirSync(OUT, { recursive: true });

const rows = JSON.parse(readFileSync(path.join(REPO, "docs/assessments/detailed-crud.json"), "utf8"));
const contract = JSON.parse(readFileSync(path.join(REPO, "docs/governance/role-capability-contract.json"), "utf8"));
const corrections = JSON.parse(readFileSync(path.join(REPO, "docs/assessments/canonical-corrections.json"), "utf8"));

const q = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (name, header, body) => {
  writeFileSync(path.join(OUT, name), [header.join(","), ...body.map((r) => r.map(q).join(","))].join("\n") + "\n");
  console.log(name.padEnd(34) + body.length + " rows");
};

// ACCESS CODE IS DERIVED, never transcribed. The original sheet had two rows where Read=Yes and the
// Access Code cell was blank -- a defect that becomes impossible once the code is computed.
const codeOf = (r) => ["C", "R", "E", "D"].filter((k) => (r[k] || "").trim().toLowerCase() === "yes").join("");

csv("3-detailed-crud.csv",
  ["Role", "Object", "Create", "Read", "Edit", "Delete", "Access Code", "Record Scope", "Design Status", "Control Notes"],
  rows.map((r) => [r.role, r.obj, r.C, r.R, r.E, r.D, codeOf(r), r.scope, r.status, r.notes]));

const objects = [...new Set(rows.map((r) => r.obj))];
const roleNames = [...new Set(rows.map((r) => r.role))];
const byRole = {};
for (const r of rows) (byRole[r.role] ??= {})[r.obj] = codeOf(r);
csv("2-role-object-summary-GENERATED.csv", ["Role", ...objects],
  roleNames.map((role) => [role, ...objects.map((o) => byRole[role][o] || "")]));

const roleIdOf = {};
for (const row of contract.rows) roleIdOf[row.businessRoleLabel] = row.businessRoleId;
const r2c = [];
for (const r of rows) {
  const code = codeOf(r);
  if (!code) continue;
  const m = OBJECT_CAPABILITY_MAP[r.obj] || {};
  const caps = [...new Set([...code].flatMap((L) => m[L] || []))];
  const gt = governanceTypeFor(r.obj);
  const just = caps.length
    ? "Capability governs the same business action this row describes."
    : gt === "RULE_GOVERNED"
      ? "No capability governs this object; authority is enforced by firestore.rules."
      : "Business intent recorded; the platform does not model this action.";
  r2c.push([roleIdOf[r.role] || "", r.role, r.obj, code, caps.join(" ") || "(none)", "", gt, r.scope, "",
            caps.length ? "YES" : "NO", "", "", "YES", "", just, ""]);
}
csv("4-role-to-capability.csv",
  ["Business Role Id", "Business Role", "Object", "CRUD Code", "Capability IDs", "Functional Role",
   "Governance Type", "Scope", "SoD Group", "Implemented", "Active", "Current Grant", "Intended",
   "Default Composition", "Semantic Mapping Justification", "Owner/Decision Reference"], r2c);

const sod = SOD_EXCLUSIVE_PAIRS.map(([a, b, why]) => ["MUTUALLY_EXCLUSIVE", a, b, why]);
for (const entry of SOD_DISTINCT_AUTHORITIES) {
  sod.push(["DISTINCT_BUT_COMBINABLE", entry.slice(0, -1).join(" | "), "", entry[entry.length - 1]]);
}
csv("5-segregation-of-duties.csv", ["Kind", "Authority A", "Authority B", "Rationale"], sod);

const gaps = [
  ["GM_ADMIN_OVERRIDE", "RESOLVED", "General Manager", "Users / Roles-Permissions",
   "Matrix grants CRED. Implementing it literally creates a non-privileged Role able to grant itself anything. Owner ruling 2026-08-21: GM is business operations, not security administration.", "No"],
  ...corrections.corrections.map((c) => ["CANONICAL_SOURCE_INTERNAL_CONTRADICTION", "RESOLVED", c.role, c.object,
    c.was.code + " granted while the row's own note said 'No business need identified'. 160 rows carry that note and grant nothing. Owner ruling: the NOTE WINS.", "No"]),
  ["MATRIX_OWNER_DECISION_CONFLICT", "OPEN", "Service Manager (fieldManager)", "Parts Catalog",
   "Canonical row says R; a recorded Owner ruling grants inventory.catalog.manage. Grant preserved. Should the reconciled matrix supersede that ruling and reduce Service Manager to catalog read?", "YES"],
  ["REJECTED_SEMANTIC_MAPPING", "GUARDED", "(all roles)", "Equipment / Installed Base",
   "Installed base is the customer's assets; equipment.model.manage administers the MODEL CATALOG. Mapping them would grant catalog administration to technicians and shop staff.", "No"],
  ["REJECTED_SEMANTIC_MAPPING", "GUARDED", "(all roles)", "Inventory Adjustments",
   "One CRUD cell must not yield cycle-count Counter AND Reconciler; that collapses DECISIONS 111 into a checkbox.", "No"],
  ["REJECTED_SEMANTIC_MAPPING", "GUARDED", "(all roles)", "Contacts",
   "crm.activity.* is activity LOGGING, confined to crmActivityContributor by Owner ruling 2026-08-19. The contact RECORD is Rules-governed.", "No"],
  ["RULE_GOVERNED", "ACCEPTED", "(all roles)", "Contacts / Customer Locations / Installed Base / Notifications / Technician Time",
   "Authority enforced by firestore.rules. No capability abstraction exists, and none was invented to make the grid symmetrical.", "No"],
  ["REPORTING_OWNERSHIP_UNRESOLVED", "OPEN", "(management roles)", "report.* (39 capabilities)",
   "The workbook does not model reporting. All 39 remain Owner/Admin-only. Recommendation prepared; no autonomous grant.", "YES"],
  ["COVERAGE_TERRITORY_AUTHORITY_GAP", "OPEN", "Sales and management roles", "coverage.read / coverage.write",
   "Matrix scopes and role descriptions assume own/team/territory visibility; no scope model exists. Not solvable by broad grants.", "YES"],
  ["FUNCTIONAL_GAP", "OPEN", "(returns)", "Return Disposition",
   "DECISIONS 118 separates intake from disposition. Disposition has no capability and no workflow, so the SoD currently holds by absence rather than by separation.", "YES"],
  ["LEGACY_COMPATIBILITY_ANOMALY", "OPEN", "dispatcher", "Sales Orders",
   "dispatcher holds salesOrder.write/fulfill/service from compatibility history, making it the de facto commercial writer. Left unchanged; reduction needs its own regression pass.", "YES"],
  ["LEGACY_COMPATIBILITY_ANOMALY", "OPEN", "technician", "Purchasing",
   "technician holds 9 of purchasingManager's capabilities including reorder.purchaseOrder.create. Left unchanged pending compatibility cleanup.", "YES"],
  ["RETIRE_CANDIDATE", "OPEN", "inventoryCreateExecutor", "(functional Role)",
   "Its own definition marks it temporary. Not removed here; removal needs proof that no workflow depends on it.", "YES"],
  ["INTENTIONAL_OVERLAP", "ACCEPTED", "Controller / Accounting Manager; Shop Manager / Shop Associate", "(capability sets)",
   "Identical sets today. The business runs these positions over the same responsibilities; differences are made through employee-level assignment rather than by splitting the Role.", "No"],
  ["EQUIPMENT_ADMIN_UNRESOLVED", "OPEN", "(management roles)", "equipment.model.manage / equipment.compatibility.*",
   "Five capabilities remain Owner/Admin-only. Deliberately NOT inferred from Installed Base CRUD, which governs a different object. Recommendation prepared.", "YES"],
];
csv("6-gaps-decisions.csv", ["Classification", "Status", "Role", "Object/Capability", "Detail", "Owner Decision Required"], gaps);

csv("1-user-to-role.csv", ["Note"], [[
  "Employee-to-business-role assignment. Represents ASSIGNMENT, not effective capability: effective " +
  "authority is the business Role plus any functional Roles, resolved through the governed access " +
  "contract. Populated from the certification workforce once grants are approved.",
]]);
console.log("\nworkbook v2 written to docs/governance/workbook-v2/");
