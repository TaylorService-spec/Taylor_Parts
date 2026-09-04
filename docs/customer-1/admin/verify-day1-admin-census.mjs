#!/usr/bin/env node
// Verifier for docs/customer-1/admin/DAY1_ADMIN_ACTION_CENSUS.md (gate C1-ADMIN-01).
//
// The census is a set of claims about what a Taylor administrator can and cannot do in
// the product. Those claims decay silently: a capability gets activated, a protected
// button gets wired, a screen gets a create action, and the census keeps asserting a
// closed door that is now open. This script re-measures every claim that can be
// measured from the repository and exits non-zero when one no longer holds.
//
// It is deliberately a NEGATIVE check. It asserts that the doors the census calls shut
// are still shut. If a door opens, this fails -- which is the correct outcome: the
// census must be re-measured, not quietly trusted. It never asserts that anything is
// deployed, activated in production, or accepted by Taylor; the census claims none of
// those and neither does this.
//
// Node stdlib only. Run: node docs/customer-1/admin/verify-day1-admin-census.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = "field-ops-app-vite/src";

const failures = [];
const check = (ok, claim) => {
  if (!ok) failures.push(claim);
};

const read = (rel) => {
  const abs = join(REPO, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
};

// This codebase documents itself heavily, and its comments quote the very tokens these
// checks look for -- EmployeesList.jsx explains "No onRowClick", AdminDuplicateRules.jsx
// explains that its controls are `variant="protected"`. Matching raw source would read
// those explanations as the code they describe and report the opposite of the truth. So
// every source assertion below runs against comment-stripped text.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const readCode = (rel) => {
  const src = read(rel);
  return src === null ? "" : stripComments(src);
};

// --- 1. Every file the census cites still exists -------------------------------------
const CITED = [
  "functions/scripts/provisionEmployeeAccess.js",
  `${APP}/App.jsx`,
  `${APP}/access/permissionCatalog.ts`,
  `${APP}/access/governedBusinessRoles.ts`,
  `${APP}/access/compatibilityRoles.ts`,
  `${APP}/access/adminPasswordResetClient.js`,
  `${APP}/services/privilegedApprovalClient.js`,
  `${APP}/modules/administration/README.md`,
  `${APP}/modules/administration/AdministrationOverview.jsx`,
  `${APP}/modules/administration/AdministrationUnavailable.jsx`,
  `${APP}/modules/administration/AdminUsers.jsx`,
  `${APP}/modules/administration/AdminRolesPermissions.jsx`,
  `${APP}/modules/administration/AdminObjects.jsx`,
  `${APP}/modules/administration/AdminWarehouseRacking.jsx`,
  `${APP}/modules/administration/AdminFinancialPolicy.jsx`,
  `${APP}/modules/administration/AdminDuplicateRules.jsx`,
  `${APP}/modules/administration/ApprovalRequests.jsx`,
  `${APP}/modules/administration/EmployeesList.jsx`,
  `${APP}/modules/administration/IntegrationsFaq.jsx`,
];
for (const rel of CITED) {
  check(existsSync(join(REPO, rel)), `cited path no longer exists: ${rel}`);
}

// --- 2. Capability activation state ---------------------------------------------------
// The catalog is a list of frozen literals. Slice the text of one entry by finding its
// `id:` and stopping at the next entry's `id:`, then look for the `active` property.
// ponytail: text slice, not a TS parse -- the catalog is a flat literal list and a
// parser here would be a build dependency for one boolean. Revisit if the shape changes.
const catalog = readCode(`${APP}/access/permissionCatalog.ts`);
function catalogEntryIsInactive(id) {
  const start = catalog.indexOf(`id: "${id}"`);
  if (start === -1) return null; // not registered at all
  const next = catalog.indexOf('id: "', start + 5);
  const entry = catalog.slice(start, next === -1 ? catalog.length : next);
  return /\bactive:\s*false\b/.test(entry);
}

// Census PARTIAL claims: these are built but inert. If one activates, the census is stale.
for (const id of [
  "admin.credentialReset.initiate", // A3
  "inventory.location.bin.read", // B3
  "inventory.location.bin.manage", // B3
  "financialPolicy.profile.read", // B4
  "financialPolicy.profile.configure", // B4
]) {
  const inactive = catalogEntryIsInactive(id);
  check(inactive !== null, `census cites capability ${id}, which is no longer registered`);
  check(inactive !== false, `${id} is no longer active:false -- census PARTIAL classification is stale`);
}

// Census A2/A4 claim the OPPOSITE for these: the capability is live, and the blocker is
// the missing target read rather than activation. Assert that too, so the census cannot
// drift in either direction.
for (const id of ["admin.userStatus.write", "admin.roleAssignment.write"]) {
  const inactive = catalogEntryIsInactive(id);
  check(inactive !== null, `census cites capability ${id}, which is no longer registered`);
  check(inactive !== true, `${id} became active:false -- census A2/A4 reasoning is stale`);
}

// --- 3. A2: user enable/disable is still unreachable ----------------------------------
const adminUsers = readCode(`${APP}/modules/administration/AdminUsers.jsx`);
for (const label of ["Enable user", "Disable user"]) {
  const at = adminUsers.indexOf(label);
  check(at !== -1, `AdminUsers.jsx no longer renders "${label}" -- re-measure census A2`);
  if (at === -1) continue;
  // The control's own <Button ...> opening tag precedes its label.
  const tagStart = adminUsers.lastIndexOf("<Button", at);
  const tag = adminUsers.slice(tagStart, at);
  check(
    /variant="protected"/.test(tag),
    `AdminUsers.jsx "${label}" is no longer variant="protected" -- census A2 (MISSING) is stale`,
  );
  check(
    !/onClick/.test(tag),
    `AdminUsers.jsx "${label}" gained an onClick handler -- census A2 (MISSING) is stale`,
  );
}

// --- 4. A9/A10: Permission Preview and Audit Logs still route to the unavailable screen -
const app = readCode(`${APP}/App.jsx`);
check(
  /permissionPreview[\s\S]{0,200}AdministrationUnavailable|AdministrationUnavailable[\s\S]{0,200}permissionPreview/.test(
    app,
  ),
  "App.jsx no longer routes permissionPreview to AdministrationUnavailable -- census A9 is stale",
);
check(
  /auditLogs[\s\S]{0,200}AdministrationUnavailable|AdministrationUnavailable[\s\S]{0,200}auditLogs/.test(app),
  "App.jsx no longer routes auditLogs to AdministrationUnavailable -- census A10 is stale",
);

// --- 5. A1/B2: employees is still CLI-provisioned, with no in-app create ---------------
const employees = readCode(`${APP}/modules/administration/EmployeesList.jsx`);
check(
  !/\b(onCreate|primaryAction|createAction)\s*=/.test(employees),
  "EmployeesList.jsx gained a create/primary action -- census A1 (MISSING) is stale",
);
check(
  !/\bonRowClick\s*=/.test(employees),
  "EmployeesList.jsx gained onRowClick, implying an employee record page -- re-measure census B2",
);

// --- 6. B5: duplicate rules are still uneditable ---------------------------------------
const dupRules = readCode(`${APP}/modules/administration/AdminDuplicateRules.jsx`);
check(
  /variant="protected"/.test(dupRules),
  "AdminDuplicateRules.jsx no longer renders protected controls -- census B5 (MISSING) is stale",
);

// --- report ----------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`FAIL -- ${failures.length} census claim(s) no longer hold:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nRe-measure docs/customer-1/admin/DAY1_ADMIN_ACTION_CENSUS.md against the repository.");
  process.exit(1);
}

console.log(`PASS -- all Day-1 admin census claims re-measured against the repository (${CITED.length} cited paths).`);
