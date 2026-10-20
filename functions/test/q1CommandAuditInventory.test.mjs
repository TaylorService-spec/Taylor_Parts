// Q-1, offline -- the inventory of Commercial and CRM commands that must write ONE audit row, pinned against the operations
// the two transports actually serve. A new mutation added to either transport fails here until it is audited and listed.
// The real-database proof is functions/test/q1CommercialCrmAuditPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");
const require = createRequire(import.meta.url);
const commercial = require("../lib/eosCommercial/commercialHttp.js");
const crm = require("../lib/eosCrm/crmHttp.js");
const code = (file) => readFileSync(join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const count = (haystack, needle) => haystack.split(needle).length - 1;

// transport operation -> the audit action (the command's operation name) it writes
const COMMERCIAL = {
  createOpportunity: ["eosCommercial/commands/opportunityCommandService.ts", "opportunity.create"],
  updateOpportunity: ["eosCommercial/commands/opportunityCommandService.ts", "opportunity.update"],
  transitionOpportunity: ["eosCommercial/commands/opportunityCommandService.ts", "opportunity.transition"],
  closeOpportunityAsWon: ["eosCommercial/commands/opportunityCommandService.ts", "opportunity.closeAsWon"],
  createSalesAgreement: ["eosCommercial/commands/salesAgreementCommandService.ts", "salesAgreement.create"],
  updateSalesAgreementDraft: ["eosCommercial/commands/salesAgreementCommandService.ts", "salesAgreement.updateDraft"],
  acceptSalesAgreement: ["eosCommercial/commands/salesAgreementCommandService.ts", "salesAgreement.accept"],
  approveSalesAgreementTradeIn: ["eosCommercial/commands/salesAgreementCommandService.ts", "salesAgreement.approveTradeIn"],
  declineSalesAgreementTradeIn: ["eosCommercial/commands/salesAgreementCommandService.ts", "salesAgreement.declineTradeIn"],
  createSalesOrder: ["eosCommercial/commands/salesOrderCommandService.ts", "salesOrder.create"],
  createSalesOrderFromOpportunity: ["eosCommercial/commands/salesOrderCommandService.ts", "salesOrder.createFromOpportunity"],
  transitionSalesOrder: ["eosCommercial/commands/salesOrderCommandService.ts", "salesOrder.transition"],
  authorizeSalesOrderServiceProvider: ["eosCommercial/commands/salesOrderCommandService.ts", "salesOrder.authorizeServiceProvider"],
  revokeSalesOrderServiceProvider: ["eosCommercial/commands/salesOrderCommandService.ts", "salesOrder.revokeServiceProvider"],
};
const CRM_MUTATIONS = ["createAccount", "updateAccount", "createContact", "importAccountContacts", "updateContact", "createAccountLocation", "updateAccountLocation", "createAccountActivity"];

test("the Commercial mutation operations served are exactly the audited inventory", () => {
  assert.deepEqual([...commercial.COMMERCIAL_MUTATION_OPERATIONS].sort(), Object.keys(COMMERCIAL).sort());
});

test("each Commercial command's operation name is also its audit action, in its own service", () => {
  for (const [operation, [file, action]] of Object.entries(COMMERCIAL)) {
    // once as the runCommercialCommand operation, once as the audit action
    assert.ok(count(code(file), `"${action}"`) >= 2, `${operation}: "${action}" must name both the operation and the audit action in ${file}`);
  }
  const kernel = code("eosCommercial/commands/commercialCommandKernel.ts");
  assert.match(kernel, /recordCommandAudit\(client, actor\.tenantId, actor\.principalId, outcome\.audit\)/, "the kernel writes the audit in the command's transaction");
  assert.ok(kernel.indexOf("recordCommandAudit(") < kernel.indexOf("INSERT INTO eos_commercial.command_receipts"), "the audit precedes the receipt, inside the same transaction");
  assert.ok(kernel.indexOf("recordCommandAudit(") > kernel.indexOf("await body(client, now, scope)"), "a replay returns before the body, so it never audits");
});

test("the CRM mutation operations served are exactly the audited inventory", () => {
  const mutations = crm.CRM_OPERATIONS.filter((op) => !/^(get|list)/.test(op));
  assert.deepEqual([...mutations].sort(), [...CRM_MUTATIONS].sort());
});

test("every CRM mutation call site writes its audit row", () => {
  for (const file of ["accountAuthority.ts", "contactAuthority.ts", "accountLocationAuthority.ts"]) {
    const src = code(`eosCrm/${file}`);
    const sites = count(src, "runCrmCreate(") + count(src, "runCrmCommand(");
    assert.ok(sites > 0);
    assert.equal(count(src, "recordCommandAudit("), sites, `${file}: one recordCommandAudit per mutation`);
  }
  // CRM activity predates Q-1 and writes its row inline, in the same transaction.
  assert.equal(count(code("eosCrm/crmActivityAuthority.ts"), "INSERT INTO eos_policy.audit_events"), 1);
});
