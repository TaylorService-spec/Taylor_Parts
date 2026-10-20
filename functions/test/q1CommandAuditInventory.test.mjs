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

// transport operation -> [file, exported function]; checked PER FUNCTION, so a mutation that loses its audit cannot hide behind a sibling's.
const CRM_FUNCTIONS = {
  createAccount: "accountAuthority.ts", updateAccount: "accountAuthority.ts",
  createContact: "contactAuthority.ts", importAccountContacts: "contactAuthority.ts", updateContact: "contactAuthority.ts",
  createAccountLocation: "accountLocationAuthority.ts", updateAccountLocation: "accountLocationAuthority.ts",
};

/** The source of ONE exported function: from its `export function name(` to the next top-level export (or the end of the file). */
function functionSource(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} is exported`);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

test("every CRM mutation function writes exactly one audit row of its own action", () => {
  assert.deepEqual(Object.keys(CRM_FUNCTIONS).sort(), CRM_MUTATIONS.filter((op) => op !== "createAccountActivity").sort());
  for (const [name, file] of Object.entries(CRM_FUNCTIONS)) {
    const body = functionSource(code(`eosCrm/${file}`), name);
    assert.equal(count(body, "recordCommandAudit("), 1, `${name}: exactly one recordCommandAudit call`);
    assert.ok(body.includes(`action: "crm.${name}"`), `${name}: its audit action is crm.${name}`);
  }
  // CRM activity predates Q-1 and writes its row inline, in the same transaction.
  const activity = functionSource(code("eosCrm/crmActivityAuthority.ts"), "createAccountActivity");
  assert.equal(count(activity, "INSERT INTO eos_policy.audit_events"), 1);
});

test("an audit row never carries free text or contact details: the CRM views and the Commercial helpers record a length or a flag", () => {
  const account = code("eosCrm/accountAuthority.ts");
  assert.match(account, /notesLength: textLength\(notes\), billingAddressPresent: billingAddress !== null/);
  assert.match(code("eosCrm/contactAuthority.ts"), /emailPresent: email !== null, phonePresent: phone !== null, contactRoleLength: textLength\(contactRole\)/);
  assert.match(code("eosCrm/accountLocationAuthority.ts"), /addressPresent: .*accessNotesLength: textLength\(accessNotes\)/);
  // No CRM audit call spreads a raw projection.
  for (const file of ["accountAuthority.ts", "contactAuthority.ts", "accountLocationAuthority.ts"]) {
    assert.doesNotMatch(code(`eosCrm/${file}`), /(before|after): \{ \.\.\.(created|was|updated|project\()/, `${file}: a raw projection is spread into an audit row`);
  }
  assert.match(code("eosCommercial/commands/opportunityCommandService.ts"), /FREE_TEXT = \["need", "nextAction"\]/);
  assert.match(code("eosCommercial/commands/salesAgreementCommandService.ts"), /FREE_TEXT = \["shippingInstructions", "specialInstructions", "shipVia"\]/);
});

test("wellFormed, pickFields and lineFacts: lone surrogates become U+FFFD; free text becomes a length; lines lose their text", () => {
  const { wellFormed, pickFields, lineFacts, textLength } = require("../lib/eosAudit/commandAuditEvent.js");
  assert.equal(wellFormed("a\uD800b"), "a�b");
  assert.equal(wellFormed("a\uDC00b"), "a�b");
  assert.equal(wellFormed("ok 😀 pair"), "ok 😀 pair", "a valid surrogate pair is untouched");
  assert.deepEqual(wellFormed({ "k\uD800": ["x\uD800", { y: "\uDFFF", n: 3, z: null }] }), { "k�": ["x�", { y: "�", n: 3, z: null }] });
  for (const s of [wellFormed("a\uD800b"), JSON.stringify(wellFormed({ v: "\uD800" }))]) assert.ok(!/\\ud[89ab]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/i.test(s));
  assert.deepEqual(pickFields({ need: "secret", n: 4 }, ["need", "n", "gone"], ["need"]), { needLength: 6, n: 4, gone: null });
  assert.equal(textLength(null), null);
  assert.deepEqual(lineFacts([{ kind: "PART", ref: "p", quantity: 2, unitPrice: 5, warranty: "12 months parts", description: "secret text" }]),
    [{ kind: "PART", ref: "p", quantity: 2, unitPrice: 5, warrantyLength: 15 }]);
});
