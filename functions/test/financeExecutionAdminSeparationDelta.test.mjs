// D-2 (OWNER APPROVAL REQUIRED): the proposed Finance execution / Administration separation delta, offline. It revokes
// exactly admin x {refund, adjustment} and partsManager x adjustment, names the Roles that keep both keys, and carries an
// exact inverse for rollback. The PostgreSQL effect (540, decisions, holders kept) is in governedNonprodReplayPostgres.
//
// Prerequisite: `npm run build` in functions/ (imports lib/).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const d = require("../lib/adminPolicy/financeExecutionAdminSeparationDelta.js");

test("revokes exactly admin x refund/adjustment and partsManager x adjustment -- nothing else, no grant", () => {
  const ops = d.financeExecutionAdminSeparationOperations();
  assert.deepEqual(ops.map((o) => [o.operation, o.input.roleKey, `${o.input.objectKey}.${o.input.actionKey}`]), [
    ["revokeObjectActionFromRole", "admin", "invoice.recordAdjustment"],
    ["revokeObjectActionFromRole", "admin", "payment.recordRefund"],
    ["revokeObjectActionFromRole", "partsManager", "invoice.recordAdjustment"],
  ]);
  for (const o of ops) assert.match(o.input.reason, /OWNER APPROVAL REQUIRED/);
});

test("no Role that keeps the Finance execution authority is touched; owner and generalManager are among them", () => {
  const touched = new Set(d.FINANCE_EXECUTION_ADMIN_SEPARATION_DECISIONS.map((x) => x.roleKey));
  assert.deepEqual([...d.FINANCE_EXECUTION_HOLDER_ROLE_KEYS], ["owner", "generalManager", "controller", "accountingManager", "financeManager"]);
  for (const role of d.FINANCE_EXECUTION_HOLDER_ROLE_KEYS) assert.equal(touched.has(role), false, role);
});

test("the rollback plan is the exact inverse and is not loaded as a recorded delta", () => {
  const fwd = d.financeExecutionAdminSeparationOperations();
  const back = d.financeExecutionAdminSeparationRollbackPlan();
  assert.deepEqual(back.map((o) => [o.input.roleKey, o.input.objectKey, o.input.actionKey]), fwd.map((o) => [o.input.roleKey, o.input.objectKey, o.input.actionKey]));
  assert.ok(back.every((o) => o.operation === "grantObjectActionToRole" && /ROLLBACK/.test(o.input.reason)));
  // test/support/removalMatrix.mjs loads every exported *Operations function of a *Delta module as a RECORDED delta.
  assert.deepEqual(Object.keys(d).filter((n) => /Operations$/.test(n)), ["financeExecutionAdminSeparationOperations"]);
});
