// AUDIT READ PROJECTION -- static writer-kind coverage + registry/projector purity (PR 5a; no database).
//
// Every `target_kind` an audit writer in functions/src or functions/scripts produces must be registered in the closed
// per-kind registry (src/adminPolicy/auditReadProjection.ts). The registry decides what readPolicyAuditHistory may
// show; a writer that introduces an unregistered kind must fail CI here, not reach a reader unclassified.
//
// HOW: every file that writes eos_policy.audit_events is detected by its writer shape (a direct INSERT, the policy
// repository's appendAudit, the Workforce kernel's appendEmployeeAudit, the inbound writeAudit). A file not named in
// WRITERS fails. For each named file the kinds are EXTRACTED from the source (a `targetKind: "x"` literal, the
// target_kind position of an INSERT's VALUES -- literal, positional parameter or named constant -- and the kind
// argument of a local audit helper call) and must equal the file's WRITERS entry exactly; every kind must be
// registered, and every registered kind must have a writer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const projection = require("../lib/adminPolicy/auditReadProjection.js");

/**
 * Every audit writer file and the kinds it writes. SINK = it writes a kind its CALLER supplies (no literal of its
 * own). FIXED = it writes through a helper with a fixed kind (appendEmployeeAudit -> "employee").
 */
const SINK = "SINK";
const WRITERS = {
  "scripts/sampleCompany/loginActivation.js": ["tenantMembership"],
  "scripts/workOrderQuarantineCli.js": ["workOrderQuarantine"],
  "src/adminPolicy/adminPolicyApi.ts": ["role"],
  "src/adminPolicy/applyWorkflowSeed.ts": ["workflowVersion"],
  "src/adminPolicy/policyCommands.ts": ["grantCondition", "object", "objectField", "principal", "principalCapability", "role", "roleAssignment", "roleCapability", "roleFieldOverride", "roleObjectPermission", "tenantSalesChannel"],
  "src/adminPolicy/postgresPolicyRepository.ts": SINK,
  "src/adminPolicy/seed/policySeed.ts": ["tenant"],
  "src/adminPolicy/seed/roleCatalogReconcile.ts": ["tenant"],
  "src/adminPolicy/tenantBootstrap.ts": ["principal", "roleAssignment", "tenant"],
  "src/adminPolicy/workflowCommands.ts": ["workflowVersion"],
  "src/adminPolicy/workflowInstances.ts": ["workflowInstance", "workflowVersion"],
  "src/adminPolicy/workflowLifecycle.ts": ["workflowVersion"],
  "src/catalogMaster/catalogCutover.ts": ["catalog_snapshot"],
  "src/catalogMaster/catalogMasterKernel.ts": SINK,
  "src/catalogMaster/postgresEquipmentModelWriter.ts": ["equipment_model"],
  "src/catalogMaster/postgresManufacturerWriter.ts": ["manufacturer"],
  "src/catalogMaster/postgresPartAliasWriter.ts": ["part_alias"],
  "src/catalogMaster/postgresPartMasterWriter.ts": ["part"],
  "src/commercialMigration/commercialC5Target.ts": ["commercial_snapshot"],
  "src/crm/crmCutoverCopy.ts": ["crm_cutover"],
  "src/eosAudit/authorizationDenialAudit.ts": ["authorization"],
  "src/eosAuth/eosSessionIssuer.ts": ["eosSession"],
  "src/eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts": ["sales_order"],
  "src/eosFinance/billingPackage.ts": ["billing_package"],
  "src/eosFinance/financeConfigurationAdministration.ts": ["accounting_destination", "counterparty_company_profile"],
  "src/eosOps/administrationPreviewAudit.ts": ["principal"],
  "src/eosOps/binPlacementOperations.ts": ["binPlacement"],
  "src/eosOps/cycleCountOperations.ts": ["cycleCountLine", "cycleCountSheet"],
  "src/eosOps/inboundProviderRuntime.ts": ["inboundMailbox", "inboundProviderConnection", "inboundWorkRequest"],
  "src/eosOps/inboundWorkDecisions.ts": ["inboundWorkRequest", "workOrder"],
  "src/eosOps/inboundWorkIntake.ts": ["inboundMailbox", "inboundRoutingRule", "inboundWorkRequest"],
  "src/eosOps/inboundWorkRecovery.ts": ["inboundWorkRequest"],
  "src/eosOps/migration/inventoryBaselineCutover.ts": ["inventoryBaseline"],
  "src/eosOps/migration/reorderAssignmentMigrationCopy.ts": ["reorder_assignment_migration"],
  "src/eosOps/migration/reorderObjectMigrationCopy.ts": ["reorder_object_migration"],
  "src/eosOps/migration/reorderPurchaseOrderMigrationCopy.ts": ["reorder_purchase_order_migration"],
  "src/eosOps/mobileLocationScopeBindingAdministration.ts": ["mobileLocationScopeBinding"],
  "src/eosOps/partSupplierTerms.ts": ["part_supplier_item"],
  "src/eosOps/purchasingRepository.ts": ["purchase_order"],
  "src/eosOps/receiptCorrectionCommand.ts": ["receiving_order", "reorder_request"],
  "src/eosOps/receiveReorderStockCommand.ts": ["receiving_order"],
  "src/eosOps/reorderAssignmentAuthority.ts": ["reorderRequest"],
  "src/eosOps/reorderLifecycleCommands.ts": ["reorder_request"],
  "src/eosOps/selfScheduling.ts": ["selfSchedulingPolicy", "workOrder"],
  "src/eosOps/serializedAssetAcquireOperations.ts": ["serializedAsset"],
  "src/eosOps/stockRelocationOperations.ts": ["stockRelocation"],
  "src/eosOps/supplierAdministration.ts": ["supplier"],
  "src/eosOps/syntheticAcceptanceWarehouse.ts": ["warehouse"],
  "src/eosOps/systemConfigurationAdministration.ts": ["operating_company_setting"],
  "src/eosOps/transferOperations.ts": ["transferOrder"],
  "src/eosOps/truckRegistryAdministration.ts": ["mobileLocation", "truck"],
  "src/eosOps/warehouseBinAdministration.ts": ["bin", "warehouse"],
  "src/eosOps/workOrderScheduling.ts": ["workOrder"],
  "src/eosRental/rental.ts": ["rental_agreement", "rental_assignment", "rental_charge", "rental_fleet_unit"],
  "src/eosRental/rentalBilling.ts": ["billing_package"],
  "src/eosWorkforce/commands/employeeCommandKernel.ts": ["employee"],
  "src/eosWorkforce/commands/employeeCreationCommand.ts": ["employee"],
  "src/eosWorkforce/commands/employeeFunctionalRoleCommands.ts": ["employee", "functionalRole"],
  "src/eosWorkforce/commands/employeeJobRoleCommands.ts": ["employee", "jobRole"],
  "src/eosWorkforce/commands/employeeLifecycleCommand.ts": ["employee"],
  "src/eosWorkforce/commands/employeeOperationalScopeCommands.ts": ["employee"],
  "src/eosWorkforce/commands/employeePrincipalLinkCommands.ts": ["employee"],
  "src/eosWorkforce/commands/employeeProfileCommand.ts": ["employee"],
  "src/eosWorkforce/commands/employeeWorkEligibilityCommands.ts": ["employee"],
  "src/eosWorkforce/commands/reportingRelationshipCommands.ts": ["employee"],
  "src/eosWorkforce/migration/employeeProfileCutover.ts": ["employee_profile_snapshot"],
  "src/eosWorkforce/migration/jobRoleCatalogSeed.ts": ["tenant"],
  "src/eosWorkforce/migration/tenantOperatingCompanies.ts": ["tenant"],
  "src/salesAuthority/salesDiscountAuthority.ts": ["sales_discount_authority"],
};

/** The writer shapes. A file showing any of them writes audit events. */
const WRITER_SHAPES = [
  /INSERT INTO\s+(?:eos_policy|\$\{[^}]+\})\.audit_events/,
  /\.appendAudit\(/,
  /\bappendEmployeeAudit\b/,
  /\bwriteAudit\(/,
  /\btargetKind:\s*["'][A-Za-z_]+["']/, // an audit outcome handed to a kernel sink (catalog writers)
];
/** Local audit helpers whose call carries the kind as an argument (the definition itself is skipped). */
const HELPER_CALL = /\b(writeAudit|audit|auditBase)\(/g;

/** Source with line and block comments blanked (string and template literals kept), so prose never reads as code. */
function code(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  let out = ""; let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += src[i + 1] ?? ""; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i += 1; out += "\n"; continue; }
    if (ch === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); i = end < 0 ? src.length : end + 1; out += " "; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

function sourceFiles() {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p); continue; }
      if (/\.(ts|js|mjs|cjs)$/.test(n) && !/\.d\.ts$/.test(n) && !/\.test\./.test(n)) out.push(p.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "scripts"));
  return out.sort();
}

/** The balanced text after `open` (an index of "(" or "["), and the index just past its closing bracket. */
function balanced(src, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  let quote = null;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
      if (stack.length === 0) return { text: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Split on top-level commas. */
function topLevelArgs(text) {
  const out = [];
  let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === "\\") { i += 1; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const LITERAL = /^["'`]([A-Za-z_]+)["'`]$/;
/** Parameter names a sink helper passes the kind through as -- not a kind of THIS file. */
const PASSTHROUGH_NAMES = new Set(["targetKind", "kind", "outcome.audit.targetKind", "input.targetKind", "e.targetKind", "event.targetKind"]);

/** A kind expression -> a kind literal, null for a pass-through parameter, or throw for an unrecognised shape. */
function resolveKind(expr, src, where, rel = null) {
  const e = expr.trim();
  const lit = LITERAL.exec(e);
  if (lit) return lit[1];
  if (PASSTHROUGH_NAMES.has(e)) return null;
  const member = /^([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)$/.exec(e);
  if (member) {
    const def = new RegExp(`\\b${member[1]}\\s*=\\s*(?:Object\\.freeze\\()?\\{`).exec(src);
    if (def) {
      const body = balanced(src, src.indexOf("{", def.index));
      const m = body && new RegExp(`\\b${member[2]}\\s*:\\s*["']([A-Za-z_]+)["']`).exec(body.text);
      if (m) return m[1];
    }
  }
  const constant = /^[A-Z][A-Z0-9_]*$/.exec(e);
  if (constant) {
    const m = new RegExp(`\\b${e}\\s*(?::\\s*[^=]+)?=\\s*["']([A-Za-z_]+)["']`).exec(src);
    if (m) return m[1];
  }
  if (constant && rel) {
    // An imported constant: follow the relative import once.
    const imp = new RegExp(`import\\s*\\{[^}]*\\b${e}\\b[^}]*\\}\\s*from\\s*["'](\\.[^"']+)["']`).exec(src);
    if (imp) {
      const target = join(dirname(rel), imp[1]).replace(/\.js$/, "") + ".ts";
      const m = new RegExp(`\\b${e}\\s*(?::\\s*[^=]+)?=\\s*["']([A-Za-z_]+)["']`).exec(code(target));
      if (m) return m[1];
    }
  }
  throw new Error(`${where}: unrecognised target_kind expression \`${e}\` -- register the shape in this test`);
}

/** Helpers defined in another file, by the index of their kind parameter. */
const EXTERNAL_HELPER_KIND_INDEX = { writeAudit: 3 };

/** The index of a helper's kind parameter, from its definition in this source; null when it takes none. */
function kindParamIndex(src, name) {
  const def = new RegExp(`(?:function\\s+${name}\\s*(?:<[^>]*>)?\\(|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\()`).exec(src);
  if (!def) return EXTERNAL_HELPER_KIND_INDEX[name] ?? null;
  let text = balanced(src, def.index + def[0].length - 1).text;
  while (/<[^<>]*>/.test(text)) text = text.replace(/<[^<>]*>/g, ""); // generic arguments carry commas
  const params = topLevelArgs(text).map((p) => p.split(/[:=?]/)[0].trim());
  const at = params.findIndex((p) => p === "targetKind" || p === "kind");
  return at < 0 ? null : at;
}

/** Every kind literal this file writes, extracted from its source. */
function extractKinds(rel) {
  const src = code(rel);
  const kinds = new Set();
  // 1. `targetKind: "x"` -- appendAudit inputs and catalog writer outcomes.
  for (const m of src.matchAll(/\btargetKind:\s*["']([A-Za-z_]+)["'](?!\s*\|)/g)) kinds.add(m[1]);
  // 2. INSERT ... audit_events (cols) VALUES (vals) [, params]: the target_kind position.
  for (const m of src.matchAll(/INSERT INTO\s+(?:eos_policy|\$\{[^}]+\})\.audit_events\s*\(/g)) {
    const cols = balanced(src, m.index + m[0].length - 1);
    const at = topLevelArgs(cols.text).indexOf("target_kind");
    assert.ok(at >= 0, `${rel}: an audit INSERT without a target_kind column`);
    const valuesAt = cols.end + src.slice(cols.end).search(/\S/);
    let vals;
    if (src.startsWith("SELECT", valuesAt)) {
      // INSERT ... SELECT <list> [WHERE|FROM ...]: the select list lines up with the columns.
      const tplEnd = src.indexOf("`", valuesAt);
      const body = src.slice(valuesAt + 6, tplEnd);
      const stop = body.search(/\b(?:WHERE|FROM)\b/);
      vals = { text: stop < 0 ? body : body.slice(0, stop), end: tplEnd };
    } else {
      assert.ok(src.startsWith("VALUES", valuesAt), `${rel}: an audit INSERT not of the form (columns) VALUES|SELECT (values)`);
      vals = balanced(src, src.indexOf("(", valuesAt));
    }
    const v = topLevelArgs(vals.text)[at];
    assert.ok(v !== undefined, `${rel}: an audit INSERT whose VALUES do not line up with its columns`);
    const param = /^\$(\d+)/.exec(v);
    if (!param) { const k = resolveKind(v.replace(/::\w+$/, ""), src, rel, rel); if (k !== null) kinds.add(k); continue; }
    // A positional parameter: the params array follows the SQL template.
    const tail = src.slice(vals.end);
    const closeTpl = tail.indexOf("`");
    const arrayAt = vals.end + closeTpl + tail.slice(closeTpl).indexOf("[");
    const params = topLevelArgs(balanced(src, arrayAt).text);
    // Literal SQL values before the parameter do not consume a parameter slot; $n names the n-th array element.
    const k = resolveKind(params[Number(param[1]) - 1], src, rel, rel);
    if (k !== null) kinds.add(k);
  }
  // 3. Audit helper calls whose definition takes the kind as a parameter (`targetKind` / `kind`): that argument.
  //    A helper that fixes its kind in its own INSERT is covered by (2); its calls carry no kind.
  for (const m of src.matchAll(HELPER_CALL)) {
    if (/(?:function\s+|const\s+)$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const at = kindParamIndex(src, m[1]);
    if (at === null) continue;
    const args = topLevelArgs(balanced(src, m.index + m[0].length - 1).text);
    assert.ok(at < args.length, `${rel}: a ${m[1]} call without its kind argument`);
    const k = resolveKind(args[at], src, `${rel} (${m[1]} call)`, rel);
    if (k !== null) kinds.add(k);
  }
  // 4. The Workforce kernel's fixed-kind helper.
  if (/\bappendEmployeeAudit\b/.test(src)) kinds.add("employee");
  return [...kinds].sort();
}

test("every audit writer file is named, and every kind it writes is the kind recorded for it", () => {
  const writers = sourceFiles().filter((rel) => WRITER_SHAPES.some((re) => re.test(code(rel))));
  const unnamed = writers.filter((rel) => !(rel in WRITERS));
  assert.deepEqual(unnamed, [], "a new audit writer: register its target_kind in auditReadProjection.ts and name it in WRITERS");
  const stale = Object.keys(WRITERS).filter((rel) => !writers.includes(rel));
  assert.deepEqual(stale, [], "a WRITERS entry no longer writes audit events");
  const drift = [];
  for (const rel of writers) {
    let extracted;
    try { extracted = extractKinds(rel); } catch (err) { drift.push(`${rel}: ${err.message}`); continue; }
    const declared = WRITERS[rel] === SINK ? [] : [...WRITERS[rel]].sort();
    if (JSON.stringify(extracted) !== JSON.stringify(declared)) drift.push(`${rel}: writes [${extracted}] but WRITERS says [${declared}]`);
  }
  assert.deepEqual(drift, [], "an audit writer's kinds changed: register the kind, then update WRITERS");
  assert.ok(writers.length >= 69, `covered ${writers.length} writer files`);
});

test("the registry is closed over the written kinds: every written kind registered, no registered kind without a writer", () => {
  const written = new Set(Object.values(WRITERS).filter((v) => v !== SINK).flat());
  const registered = new Set(projection.REGISTERED_AUDIT_KINDS);
  assert.deepEqual([...written].filter((k) => !registered.has(k)).sort(), [], "an audit kind is written but not registered");
  assert.deepEqual([...registered].filter((k) => !written.has(k)).sort(), [], "a registered kind has no writer");
  assert.equal(registered.size, 66);
  for (const k of written) assert.notEqual(projection.classifyAuditKind(k), "UNKNOWN", k);
  assert.equal(projection.classifyAuditKind("zz_unregistered"), "UNKNOWN");
});

test("registry shape: each kind is exactly one class; only the verified-neutral gates are ENFORCED", () => {
  const counts = { PASS_THROUGH: 0, PASS_THROUGH_EVIDENCE: 0, VALUE_GATED: 0 };
  const enforced = [];
  for (const kind of projection.REGISTERED_AUDIT_KINDS) {
    const e = projection.AUDIT_KIND_REGISTRY[kind];
    assert.ok(Object.isFrozen(e), kind);
    counts[e.class] += 1;
    if (e.class !== "VALUE_GATED") { assert.equal(e.gate, undefined, kind); continue; }
    assert.ok(Array.isArray(e.gate.requires), kind);
    if (e.gate.decision === "D2") assert.deepEqual(e.gate.requires, [], `${kind}: a D2 gate is undecided`);
    else assert.ok(e.gate.requires.length > 0, `${kind}: a gate must name a capability`);
    if (e.gate.enforcement === "ENFORCED") enforced.push(kind);
    else assert.equal(e.gate.enforcement, "RECORDED_NOT_ENFORCED", kind);
  }
  assert.deepEqual(counts, { PASS_THROUGH: 20, PASS_THROUGH_EVIDENCE: 9, VALUE_GATED: 37 });
  // PR 5a: ONLY the kinds whose gate every audit.event.read role already holds. Anything more is PR 5b (Owner-HELD).
  assert.deepEqual(enforced, ["binPlacement", "stockRelocation"]);
  assert.deepEqual([...projection.CONTENT_FILTER_EXCLUDED_KINDS], ["binPlacement", "stockRelocation"]);
  for (const k of enforced) assert.deepEqual([...projection.AUDIT_KIND_REGISTRY[k].gate.requires], ["inventory.transaction.read"]);
});

const row = (targetKind, extra = {}) => Object.freeze({
  id: `audit_${targetKind}`, tenantId: "t", action: `${targetKind}.x`, actorUid: "p-1", targetKind, targetId: "r-1",
  before: null, after: { a: 1, authorizedBy: { standing: "PROTECTED_ADMINISTRATOR" } }, occurredAt: "2026-10-12T00:00:00.000Z", reason: null, ...extra,
});

test("projector: identity for a holder -- the SAME array, the same row objects, byte-identical", () => {
  const rows = Object.freeze(projection.REGISTERED_AUDIT_KINDS.concat(["zz_unregistered"]).map((k) => row(k)));
  const holder = { holds: (k) => k === "inventory.transaction.read" };
  const out = projection.projectAuditEvents(rows, holder);
  assert.equal(out, rows, "nothing withheld -> the input array itself");
  assert.equal(JSON.stringify(out), JSON.stringify(rows));
  // A reader holding nothing at all still sees every kind but the two enforced ones unchanged (UNKNOWN included).
  const none = projection.projectAuditEvents(rows, { holds: () => false });
  assert.equal(none.length, rows.length);
  none.forEach((r, i) => {
    if (["binPlacement", "stockRelocation"].includes(rows[i].targetKind)) return;
    assert.equal(r, rows[i], rows[i].targetKind);
  });
  assert.equal(projection.auditRowsNeedReader(rows.filter((r) => !["binPlacement", "stockRelocation"].includes(r.targetKind))), false);
  assert.equal(projection.auditRowsNeedReader([row("stockRelocation")]), true);
});

test("projector: a reader lacking an ENFORCED gate -- before/after ABSENT (not null), marker exact, nothing dropped", () => {
  const rows = [row("role"), row("binPlacement"), row("stockRelocation", { after: { quantity: 2 } }), row("employee")];
  const out = projection.projectAuditEvents(rows, { holds: () => false });
  assert.notEqual(out, rows);
  assert.deepEqual(out.map((r) => r.id), rows.map((r) => r.id), "same rows, same order");
  assert.equal(out[0], rows[0]);
  assert.equal(out[3], rows[3], "employee gate is RECORDED_NOT_ENFORCED in 5a");
  for (const i of [1, 2]) {
    assert.ok(!("before" in out[i]) && !("after" in out[i]), "absent, never null");
    assert.deepEqual(out[i].valuesWithheld, { reason: "RECORD_READ_REQUIRED", requires: ["inventory.transaction.read"] });
    for (const k of ["id", "action", "actorUid", "targetKind", "targetId", "occurredAt", "reason", "tenantId"]) assert.equal(out[i][k], rows[i][k]);
  }
  assert.deepEqual(out[1].authorizedBy, { standing: "PROTECTED_ADMINISTRATOR" }, "standing lifted");
  assert.ok(!("authorizedBy" in out[2]), "no standing, no key");
  // A null reader (no resolution) is the fail-closed direction for the enforced kinds only.
  assert.ok("valuesWithheld" in projection.projectAuditEvents([row("binPlacement")], null)[0]);
  assert.ok(!("valuesWithheld" in projection.projectAuditEvents([row("binPlacement")], { holds: () => true })[0]));
});

test("purity: the projection module imports nothing but types, no Firebase, no repository, no clock", () => {
  const src = code("src/adminPolicy/auditReadProjection.ts");
  const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*from\s+["']([^"']+)["']/gm)];
  assert.deepEqual(imports.map((m) => [Boolean(m[1]), m[2]]), [[true, "./types"]]);
  assert.doesNotMatch(src, /firebase|Date\.now|new Date\(|process\.env|\bpool\b|\.query\(/i);
});
