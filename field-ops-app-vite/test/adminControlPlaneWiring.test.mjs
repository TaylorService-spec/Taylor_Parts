// THE ADMINISTRATION CONTROL PLANE, CLIENT WIRING (lane CP-C) -- source-level proofs.
//
// The rendered behaviour is proved in adminControlPlane.test.jsx and administrationUsersSurfaces.test.jsx.
// These assert the wiring a component test cannot see: which screens mount the enforced surfaces, that
// the Employee page's Security Role control no longer reaches Firebase, and that no C/R/E/D mutation
// control survives anywhere in Administration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
// Comments explain the retired paths by name; the proofs are about CODE.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("the Employee page's Security Role control is PostgreSQL assignRole / revokeRole -- never assignApprovedRole", () => {
  const actions = code(read("src/modules/administration/UserAccessActions.jsx"));
  assert.equal(/assignApprovedRole/.test(actions), false, "UserAccessActions no longer calls the Firebase assign callable");
  assert.equal(/statusClient\.revokeRole/.test(actions), false, "nor the Firebase revoke callable");
  assert.equal(/ASSIGNABLE_ROLE_OPTIONS/.test(actions), false, "nor offers the client Role registry");

  const roles = code(read("src/modules/administration/EmployeeSecurityRoles.jsx"));
  assert.match(roles, /api\.assignRole\(\{ principalId, roleId, reason: reasonText \}\)/);
  assert.match(roles, /api\.revokeRole\(\{ assignmentId: removing\.id, reason: reasonText \}\)/);
  assert.equal(/firebase|assignApprovedRole|administrationUsersClient/.test(roles), false);

  const detail = code(read("src/modules/administration/UserDetail.jsx"));
  assert.match(detail, /<EmployeeSecurityRoles api=\{controlPlane\} principalId=\{principalId\}/);
  assert.match(detail, /<EmployeeEffectiveAccess api=\{controlPlane\} principalId=\{principalId\}/);
  assert.match(detail, /<WorkEligibilitySection /);
  assert.match(detail, /<OperationalScopeSection /);
  assert.match(detail, /<EmployeeAccessAudit api=\{controlPlane\} principalId=\{principalId\}/);
});

test("Effective Access consumes explainEffectiveAccess only -- never the older preview read", () => {
  const panel = code(read("src/modules/administration/EmployeeEffectiveAccess.jsx"));
  assert.match(panel, /api\.explainEffectiveAccess\(principalId\)/);
  assert.equal(/getPrincipalEffectiveAccess|usePrincipalAccessReadModel/.test(panel), false);
});

test("the enforced surfaces are MOUNTED: Object Security Actions on Objects, Security Role detail on Roles", () => {
  const objects = code(read("src/modules/administration/AdminObjects.jsx"));
  // The deep link (?object=, lane WR) only pre-selects the Object; the panel is still mounted unconditionally.
  assert.match(objects, /<ObjectActionSecurityPanel(?: initialObjectKey=\{readAdminQueryParam\("object"\)\})? \/>/);
  const view = code(read("src/modules/administration/ObjectActionSecurity.jsx"));
  assert.match(view, /import \{ ObjectSecurityActionList \} from "\.\/ObjectSecurityActionList\.jsx";/, "reuses the existing action list");
  assert.match(view, /api\.getObjectActionGrantMatrix\(objectKey\)/);
  const surfaces = code(read("src/modules/administration/AdminPolicySurfaces.jsx"));
  assert.match(surfaces, /<SecurityRoleDetail roleKey=\{selected\.key\} \/>/);
});

test("NO C/R/E/D mutation is sent from any Administration screen", () => {
  const dir = "src/modules/administration";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsx") || f.endsWith(".js"))) {
    const src = code(read(`${dir}/${file}`));
    for (const retired of ["setObjectPermission", "setFieldPermissionOverride", "removeFieldPermissionOverride"]) {
      assert.equal(src.includes(`"${retired}"`), false, `${file} sends ${retired}`);
    }
  }
});

test("the control-plane seam is the one Administration endpoint -- no second transport", () => {
  const client = code(read("src/services/adminControlPlaneClient.js"));
  assert.match(client, /import \{ callPolicyApi \} from "\.\/adminPolicyApiClient\.js";/);
  assert.equal(/fetch\(|firebase|httpsCallable/.test(client), false);
});
