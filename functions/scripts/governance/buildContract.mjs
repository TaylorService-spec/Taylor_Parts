#!/usr/bin/env node
// ROLE -> CAPABILITY GOVERNANCE CONTRACT. Generated, never hand-maintained.
//
// The workbook is the human-editable BUSINESS INTENT. This artifact is the machine-readable
// reconciliation of that intent against what the platform actually implements. Excel is a governance
// document; the repository stays executable truth.
//
// Generated so the two cannot drift: change the workbook, regenerate, and the guard tells you what
// moved. A hand-maintained contract would become a third independent design, which is the problem
// this whole reconciliation exists to end.
//
// Run: node scripts/governance/buildContract.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OBJECT_CAPABILITY_MAP, governanceTypeFor, GOVERNANCE_TYPE } from "./objectCapabilityMap.mjs";
import { FUNCTIONAL_ROLE_DECISIONS, COMPOSITION, composedFor, SOD_EXCLUSIVE_PAIRS } from "./functionalRoleComposition.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
// pathToFileURL, not a hand-rolled regex: on Windows a bare "D:\..." import is rejected, and the
// escaped replacement kept losing a backslash in transit and silently becoming a different pattern.
const gb = await import(pathToFileURL(path.resolve(REPO, "functions/lib/access/governedBusinessRoles.js")).href);
const cr = await import(pathToFileURL(path.resolve(REPO, "functions/lib/access/compatibilityRoles.js")).href);

// Workbook business-role label -> canonical Role id. Labels vary for humans; ids must not.
export const ROLE_ID = Object.freeze({
  "Owner": "owner", "Admin": "admin", "General Manager": "generalManager",
  "Sales Manager": "salesManager", "Salesperson": "salesperson", "Marketing Manager": "marketingManager",
  "Service Manager": "fieldManager", "Dispatcher": "dispatcher", "Technician": "technician",
  "Warehouse Manager": "warehouseManager", "Warehouse Associate": "warehouseAssociate",
  "Purchasing Manager": "purchasingManager", "Controller": "controller",
  "Accounting Manager": "accountingManager", "Support Staff": "supportStaff",
  "Parts Associate": "partsAssociate", "Parts Manager": "partsManager",
  "Shop Manager": "shopManager", "Shop Associate": "shopAssociate",
});

const rows = JSON.parse(readFileSync(path.join(REPO, "docs/assessments/detailed-crud.json"), "utf8"));
const allCaps = new Set();
for (const r of Object.values({ ...gb.GOVERNED_BUSINESS_ROLES, ...cr.COMPATIBILITY_ROLES })) {
  for (const p of r.permissions || []) allCaps.add(p);
}

const code = (r) => ["C", "R", "E", "D"].filter((k) => (r[k] || "").trim().toLowerCase() === "yes").join("");
const contract = [];
for (const r of rows) {
  const roleId = ROLE_ID[r.role];
  const c = code(r);
  const m = OBJECT_CAPABILITY_MAP[r.obj] || { C: [], R: [], E: [], D: [] };
  const caps = [...new Set([...c].flatMap((L) => m[L] || []))].sort();
  contract.push({
    businessRoleId: roleId ?? null,
    businessRoleLabel: r.role,
    object: r.obj,
    accessCode: c,
    accessCodeInWorkbook: (r.code || "").trim(),
    accessCodeAgrees: c === (r.code || "").trim(),
    capabilityIds: caps,
    governanceType: governanceTypeFor(r.obj),
    scope: r.scope || "",
    designStatus: r.status || "",
    unknownCapability: caps.filter((x) => !allCaps.has(x)),
  });
}

const roleSummary = {};
for (const [label, id] of Object.entries(ROLE_ID)) {
  if (label === "Owner" || label === "Admin") continue;
  const mine = contract.filter((x) => x.businessRoleLabel === label);
  const direct = [...new Set(mine.flatMap((x) => x.capabilityIds))].sort();
  const composed = composedFor(id);
  const fromComposed = [...new Set(composed.flatMap((f) => (gb.GOVERNED_BUSINESS_ROLES[f] || {}).permissions || []))];
  roleSummary[id] = {
    label, directCapabilities: direct, composedFunctionalRoles: composed,
    effectiveBaseline: [...new Set([...direct, ...fromComposed])].sort(),
    ruleGovernedObjects: mine.filter((x) => x.accessCode && x.governanceType === GOVERNANCE_TYPE.RULE_GOVERNED).map((x) => x.object),
    unmodelledObjects: mine.filter((x) => x.accessCode && x.governanceType === GOVERNANCE_TYPE.UNMODELLED).map((x) => x.object),
  };
}

const out = {
  generatedFrom: "docs/assessments/detailed-crud.json (canonical business intent, Detailed CRUD sheet)",
  ownerDecisions: [
    "2026-08-21 General Manager is the highest BUSINESS role and is NOT security administration. The workbook's CRED on Users and Roles/Permissions is deliberately NOT mapped to admin.* capabilities. Owner/Admin retain privileged access administration.",
  ],
  functionalRoleDecisions: FUNCTIONAL_ROLE_DECISIONS,
  sodExclusivePairs: SOD_EXCLUSIVE_PAIRS,
  roles: roleSummary,
  rows: contract,
};
mkdirSync(path.join(REPO, "docs/governance"), { recursive: true });
writeFileSync(path.join(REPO, "docs/governance/role-capability-contract.json"), JSON.stringify(out, null, 1));

const badCode = contract.filter((x) => !x.accessCodeAgrees);
const unknown = contract.filter((x) => x.unknownCapability.length);
console.log("contract rows:", contract.length, "| roles:", Object.keys(roleSummary).length);
console.log("access-code disagreements:", badCode.length, badCode.map((b) => b.businessRoleLabel + "/" + b.object).join(", ") || "");
console.log("unknown capabilities referenced:", unknown.length);
console.log("composed-by-default:", Object.entries(FUNCTIONAL_ROLE_DECISIONS).filter(([, d]) => d.decision === COMPOSITION.COMPOSE_BY_DEFAULT).map(([i]) => i).join(", "));
console.log("kept standalone:", Object.entries(FUNCTIONAL_ROLE_DECISIONS).filter(([, d]) => d.decision === COMPOSITION.KEEP_STANDALONE).map(([i]) => i).join(", "));
