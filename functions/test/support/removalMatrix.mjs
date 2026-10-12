// THE REMOVAL-MATRIX REGRESSION GATE -- generator (field permissions PR 1: tests and tooling only).
//
// Ported from the architecture lane's read-only tool (arch/tools/removal_matrix.py + removal_specs.py), WITHOUT its
// operational inputs: that tool read a nonprod census (principals, names, assignments). This one reads only what the
// REPOSITORY produces, so nothing operational is committed:
//
//   Role grants   functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json (via the compiled
//                 roleCapabilityAuthorityBaseline module): GLOBAL (MIGRATION_BACKED + CANONICAL_CATALOG) plus the recorded
//                 NONPROD_ACTIVATION rows. That file is the repository's authority statement: Ruling E makes a
//                 grant-bearing migration land with its baseline row in ONE change, and
//                 roleCapabilityAuthorityBaselinePostgres.test.mjs proves a clean rebuild equals it (EXTRA = MISSING = 0).
//   PA standing   the protected Administrator's standing, evaluated by the REAL isImpliedForProtectedAdministrator
//                 (protectedAdministrator.ts) over CAPABILITY_METADATA below. A PA exclusion is itself a code-deploy
//                 removal for admin (independent review finding 6), so it is part of the pin.
//   Metadata      CAPABILITY_METADATA is literal here and proved equal to eos_policy.capabilities after a full migrate by
//                 removalMatrixMetadataPostgres.test.mjs (which also proves every PROPOSED key is still unregistered).
//
// OUT OF SCOPE BY CONSTRUCTION: grants made through Administration at runtime (ADMIN_GRANTED rows, recorded deltas,
// conditions such as RECORD_ASSIGNMENT, assignment scopes) are operational state, not code; the mandatory grant preview
// (PRs 2-3) governs those. This gate answers one question: does THIS change to the repository move who holds a key a
// removal spec names?
//
//   npm run build && node test/support/removalMatrix.mjs --check   # exit 1 on any difference
//   npm run build && node test/support/removalMatrix.mjs --write   # deliberate re-pin only (and move the digest)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PIN_RELATIVE_PATH = "test/fixtures/removalMatrix.pinned.json";
export const PIN_PATH = resolve(FUNCTIONS_DIR, PIN_RELATIVE_PATH);

/** Writer-side auditSafe: no caller ever reads the value again. Never a capability; never satisfiable. */
export const NOBODY = "__no_reader__";
export const ADMIN_ROLE_KEY = "admin";

/**
 * One entry per proposed REMOVAL (arch/removal-matrix.md). before / after = any-of list of all-of lists of keys.
 * proposedKeys = keys that do NOT exist yet (PLACEHOLDER names), with the metadata the proposal would register.
 * Compensating grants ("b") are proposals, not authority, and are deliberately not modelled.
 */
export const REMOVAL_SPECS = Object.freeze([
  {"id": "PO-1", "title": "Purchase Order unit price (unitPriceMinor, currency) withheld from non-price holders", "before": [["reorder.request.read"]], "after": [["reorder.request.read", "reorder.purchaseOrder.price.read"]], "proposedKeys": {"reorder.purchaseOrder.price.read": {"objectKey": "purchaseOrder", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "PO-1x", "title": "VARIANT: PO unit price gated by REUSED inventory.catalog.cost.read (no new key)", "before": [["reorder.request.read"]], "after": [["reorder.request.read", "inventory.catalog.cost.read"]]},
  {"id": "PO-2", "title": "Analysis measure purchasing.orders.placed (PO qty x unit price money)", "before": [["reorder.request.read"], ["reorder.purchaseOrder.read"]], "after": [["reorder.request.read", "reorder.purchaseOrder.price.read"], ["reorder.purchaseOrder.read", "reorder.purchaseOrder.price.read"]], "proposedKeys": {"reorder.purchaseOrder.price.read": {"objectKey": "purchaseOrder", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "SUP-E", "title": "Supplier detail (contact, phone, email, address, paymentTermsRef, notes) no longer echoed to non-readers", "before": [["supplier.record.read"], ["inventory.catalog.manage"], ["inventory.catalog.activate"]], "after": [["supplier.record.read"]]},
  {"id": "SUP-W1", "title": "Supplier CREATE re-keyed inventory.catalog.manage -> NEW supplier.record.create", "before": [["inventory.catalog.manage"]], "after": [["supplier.record.create"]], "proposedKeys": {"supplier.record.create": {"objectKey": "supplier", "actionKind": "CREATE", "excludedFromProtectedAdministrator": true}}},
  {"id": "SUP-W2", "title": "Supplier EDIT re-keyed inventory.catalog.manage -> NEW supplier.record.edit", "before": [["inventory.catalog.manage"]], "after": [["supplier.record.edit"]], "proposedKeys": {"supplier.record.edit": {"objectKey": "supplier", "actionKind": "EDIT", "excludedFromProtectedAdministrator": true}}},
  {"id": "SUP-W3", "title": "Supplier STATUS re-keyed inventory.catalog.activate -> NEW supplier.record.changeStatus", "before": [["inventory.catalog.activate"]], "after": [["supplier.record.changeStatus"]], "proposedKeys": {"supplier.record.changeStatus": {"objectKey": "supplier", "actionKind": "BUSINESS_ACTION", "excludedFromProtectedAdministrator": true}}},
  {"id": "RENT-E", "title": "Rental write echo minimal (writers without rental.agreement.read stop receiving the full agreement)", "before": [["rental.agreement.read"], ["rental.agreement.manage"], ["rental.unit.assign"], ["rental.unit.return"]], "after": [["rental.agreement.read"]]},
  {"id": "RENT-T", "title": "Rental COMMERCIAL_TERMS read (rateMinor, delivery/install charge, termsHistory)", "before": [["rental.agreement.read"]], "after": [["rental.agreement.read", "rental.terms.read"]], "proposedKeys": {"rental.terms.read": {"objectKey": "rentalAgreement", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "RENT-TW", "title": "Rental COMMERCIAL_TERMS write (rates set on create / amend)", "before": [["rental.agreement.manage"]], "after": [["rental.agreement.manage", "rental.terms.create", "rental.terms.edit"]], "proposedKeys": {"rental.terms.create": {"objectKey": "rentalAgreement", "actionKind": "CREATE", "excludedFromProtectedAdministrator": true}, "rental.terms.edit": {"objectKey": "rentalAgreement", "actionKind": "EDIT", "excludedFromProtectedAdministrator": true}}},
  {"id": "RENT-C", "title": "Rental CHARGES group (unit/amount, tax evidence, billing package total) on REUSED finance.invoice.read", "before": [["rental.agreement.read"]], "after": [["rental.agreement.read", "finance.invoice.read"]]},
  {"id": "RENT-R", "title": "Rental RECEIVABLE group (obligation status, outstandingMinor) on REUSED finance.payment.read", "before": [["rental.agreement.read"]], "after": [["rental.agreement.read", "finance.payment.read"]]},
  {"id": "RENT-M", "title": "Analysis measure rental.charges.billed (money) gated like the CHARGES group", "before": [["rental.agreement.read"]], "after": [["rental.agreement.read", "finance.invoice.read"]]},
  {"id": "FIN-P1", "title": "Finance payables amount (Σ acquisition extended cost) on REUSED inventory.catalog.cost.read", "before": [["finance.payment.read"]], "after": [["finance.payment.read", "inventory.catalog.cost.read"]]},
  {"id": "FIN-P2", "title": "Finance payables amount on NEW finance.payables.read", "before": [["finance.payment.read"]], "after": [["finance.payment.read", "finance.payables.read"]], "proposedKeys": {"finance.payables.read": {"objectKey": "payment", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "SALES-M", "title": "Analysis sales.discounts.granted + sales.tradeIns.consideration (money) behind a pricing key", "before": [["salesOrder.read"]], "after": [["salesOrder.read", "salesOrder.pricing.read"]], "proposedKeys": {"salesOrder.pricing.read": {"objectKey": "salesOrder", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}, "scopedBefore": true},
  {"id": "AUD-EMP", "title": "Audit values of target_kind employee withheld from audit readers without employee.record.read", "before": [["audit.event.read"]], "after": [["audit.event.read", "employee.record.read"]]},
  {"id": "AUD-SUP", "title": "Audit values of supplier.* events", "before": [["audit.event.read"]], "after": [["audit.event.read", "supplier.record.read"]]},
  {"id": "AUD-RCH", "title": "Audit values of rental.charge.record (amountMinor)", "before": [["audit.event.read"]], "after": [["audit.event.read", "rental.agreement.read", "finance.invoice.read"]]},
  {"id": "AUD-SDA", "title": "Audit values of sales discount authority limits", "before": [["audit.event.read"]], "after": [["audit.event.read", "sales.discountAuthority.manage"]]},
  {"id": "AUD-BPK", "title": "Audit values of billing package totals / finance events", "before": [["audit.event.read"]], "after": [["audit.event.read", "finance.payment.read"]]},
  {"id": "AUD-ACC", "title": "Audit values of account payment terms / CRM events", "before": [["audit.event.read"]], "after": [["audit.event.read", "customer.record.read"]]},
  {"id": "AUD-CAT", "title": "Audit values of catalog records", "before": [["audit.event.read"]], "after": [["audit.event.read", "inventory.catalog.read"]]},
  {"id": "EMP-A1", "title": "Employee PERSONAL_CONTACT direct read — Option A (reuse employee.record.read)", "before": [["employee.record.read"]], "after": [["employee.record.read"]]},
  {"id": "EMP-B1", "title": "Employee PERSONAL_CONTACT direct read — Option B (NEW employee.personalContact.read, PA-EXCLUDED)", "before": [["employee.record.read"]], "after": [["employee.record.read", "employee.personalContact.read"]], "proposedKeys": {"employee.personalContact.read": {"objectKey": "employee", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "EMP-B1i", "title": "Employee PERSONAL_CONTACT direct read — Option B with the key NOT excluded (Admin standing implies it)", "before": [["employee.record.read"]], "after": [["employee.record.read", "employee.personalContact.read"]], "proposedKeys": {"employee.personalContact.read": {"objectKey": "employee", "actionKind": "READ", "excludedFromProtectedAdministrator": false}}},
  {"id": "EMP-CH", "title": "Employee Change History VALUES for PERSONAL_CONTACT (writer-side auditSafe, rule 7) — A and B alike", "before": [["employee.record.read"]], "after": [["__no_reader__"]]},
  {"id": "CON-P", "title": "Contact PII (email, phone) behind a contact-detail key — IF the Owner rules contact PII confidential", "before": [["customer.record.read"]], "after": [["customer.record.read", "customer.contactDetail.read"]], "proposedKeys": {"customer.contactDetail.read": {"objectKey": "contact", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "LOC-A1", "title": "Location accessNotes (gate/alarm codes) via CRM location reads", "before": [["customer.record.read"]], "after": [["customer.record.read", "customer.siteAccess.read"]], "proposedKeys": {"customer.siteAccess.read": {"objectKey": "location", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "LOC-A2", "title": "Location accessNotes copied into Work Order detail + field context", "before": [["workOrder.record.read"]], "after": [["workOrder.record.read", "customer.siteAccess.read"]], "proposedKeys": {"customer.siteAccess.read": {"objectKey": "location", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}, "condBefore": true},
  {"id": "TECH-ABS", "title": "Technician absence reason / end_reason (PTO, medical free text)", "before": [["workOrder.lifecycle.schedule"], ["workOrder.lifecycle.dispatch"]], "after": [["workOrder.lifecycle.schedule", "technicianTime.absenceDetail.read"], ["workOrder.lifecycle.dispatch", "technicianTime.absenceDetail.read"]], "proposedKeys": {"technicianTime.absenceDetail.read": {"objectKey": "technicianTimeNonWork", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
  {"id": "ACC-T", "title": "Account COMMERCIAL_TERMS {paymentTerms, taxStatus} — #210 re-expressed as a field group", "before": [["customer.record.read"]], "after": [["customer.record.read"]]},
]);

/**
 * Registered capability metadata for every EXISTING key a spec names (eos_policy.capabilities object_key / action_kind).
 * Proved against a migrated database by removalMatrixMetadataPostgres.test.mjs.
 */
export const CAPABILITY_METADATA = Object.freeze({
  "audit.event.read": { objectKey: "auditLog", actionKind: "READ" },
  "customer.record.read": { objectKey: "account", actionKind: "READ" },
  "employee.record.read": { objectKey: "employee", actionKind: "READ" },
  "finance.invoice.read": { objectKey: "invoice", actionKind: "READ" },
  "finance.payment.read": { objectKey: "payment", actionKind: "READ" },
  "inventory.catalog.activate": { objectKey: "part", actionKind: "BUSINESS_ACTION" },
  "inventory.catalog.cost.read": { objectKey: "supplierCatalogItem", actionKind: "READ" },
  "inventory.catalog.manage": { objectKey: "part", actionKind: "EDIT" },
  "inventory.catalog.read": { objectKey: "part", actionKind: "READ" },
  "rental.agreement.manage": { objectKey: "rentalAgreement", actionKind: "BUSINESS_ACTION" },
  "rental.agreement.read": { objectKey: "rentalAgreement", actionKind: "READ" },
  "rental.unit.assign": { objectKey: "rentalEquipment", actionKind: "BUSINESS_ACTION" },
  "rental.unit.return": { objectKey: "rentalEquipment", actionKind: "BUSINESS_ACTION" },
  "reorder.purchaseOrder.read": { objectKey: "purchaseOrder", actionKind: "READ" },
  "reorder.request.read": { objectKey: "reorderRequest", actionKind: "READ" },
  "sales.discountAuthority.manage": { objectKey: "salesDiscountAuthority", actionKind: "ADMIN_ACTION" },
  "salesOrder.read": { objectKey: "salesOrder", actionKind: "READ" },
  "supplier.record.read": { objectKey: "supplier", actionKind: "READ" },
  "workOrder.lifecycle.dispatch": { objectKey: "workOrder", actionKind: "BUSINESS_ACTION" },
  "workOrder.lifecycle.schedule": { objectKey: "workOrder", actionKind: "BUSINESS_ACTION" },
  "workOrder.record.read": { objectKey: "workOrder", actionKind: "READ" },
});

const keysOf = (req) => req.flat().filter((k) => k !== NOBODY);

/** Every key the specs name, split into EXISTING (must have metadata) and PROPOSED (must not exist yet). */
export function specKeys(specs = REMOVAL_SPECS) {
  const proposed = new Set();
  const all = new Set();
  for (const s of specs) {
    for (const k of [...keysOf(s.before), ...keysOf(s.after)]) all.add(k);
    for (const k of Object.keys(s.proposedKeys ?? {})) proposed.add(k);
  }
  return { existing: [...all].filter((k) => !proposed.has(k)).sort(), proposed: [...proposed].sort() };
}

const sat = (req, held) => req.some((all) => all.every((k) => k !== NOBODY && held.has(k)));

/** The pin as a plain object. `lib` defaults to the compiled modules under lib/ (npm run build first). */
export function computeMatrix(lib = {
  baseline: require("../../lib/adminPolicy/roleCapabilityAuthorityBaseline.js"),
  pa: require("../../lib/adminPolicy/protectedAdministrator.js"),
}, specs = REMOVAL_SPECS, metadata = CAPABILITY_METADATA) {
  const { baseline, pa } = lib;
  const { existing, proposed } = specKeys(specs);
  const missing = existing.filter((k) => !metadata[k]);
  if (missing.length > 0) throw new Error(`removalMatrix: no CAPABILITY_METADATA for ${missing.join(", ")}`);

  const global = baseline.globalAuthorityGrants();
  const activation = baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS;
  const roles = [...new Set([ADMIN_ROLE_KEY, ...global.map((g) => g.roleKey), ...activation.map((g) => g.roleKey)])].sort();
  const holdersOf = (pairs, key) => [...new Set(pairs.filter((p) => p.capabilityKey === key).map((p) => p.roleKey))].sort();
  const standing = (key, objectKey, actionKind) => pa.isImpliedForProtectedAdministrator({ key, objectKey, actionKind });

  const keys = {};
  for (const key of existing) {
    const m = metadata[key];
    keys[key] = {
      objectKey: m.objectKey,
      actionKind: m.actionKind,
      globalRoles: holdersOf(global, key),
      nonprodActivationRoles: holdersOf(activation, key),
      protectedAdministratorStanding: standing(key, m.objectKey, m.actionKind),
    };
  }
  /** Role-level holding: repository grants (global + recorded nonprod activation) plus admin's standing. */
  const heldBy = (role, extraForAdmin = []) => {
    const held = new Set([...global, ...activation].filter((p) => p.roleKey === role).map((p) => p.capabilityKey));
    if (role === ADMIN_ROLE_KEY) {
      for (const key of existing) if (keys[key].protectedAdministratorStanding) held.add(key);
      for (const key of extraForAdmin) held.add(key);
    }
    return held;
  };

  const specRows = specs.map((s) => {
    // AFTER: a proposed key is held by nobody, except admin when the proposal leaves it implied by standing.
    const impliedProposed = Object.entries(s.proposedKeys ?? {})
      .filter(([k, m]) => !m.excludedFromProtectedAdministrator && standing(k, m.objectKey, m.actionKind)).map(([k]) => k);
    const beforeRoles = roles.filter((r) => sat(s.before, heldBy(r)));
    const afterRoles = roles.filter((r) => sat(s.after, heldBy(r, impliedProposed)));
    return {
      id: s.id,
      before: s.before,
      after: s.after,
      beforeRoles,
      afterRoles,
      loseRoles: beforeRoles.filter((r) => !afterRoles.includes(r)),
      gainRoles: afterRoles.filter((r) => !beforeRoles.includes(r)),
    };
  });
  return {
    $comment: "GENERATED by functions/test/support/removalMatrix.mjs from the repository's own authority baseline and code -- no census, "
      + "no principal, no record. Role -> holding of every key a removal spec names. Pinned by SHA-256 in "
      + "functions/test/removalMatrixGate.test.mjs: a change that moves who holds one of these keys fails until re-pinned deliberately.",
    version: 1,
    proposedKeys: proposed,
    keys,
    specs: specRows,
  };
}

/** Deterministic bytes: one key per line, one spec per line. */
export function renderMatrix(m) {
  const lines = ["{"];
  lines.push(`  "$comment": ${JSON.stringify(m.$comment)},`);
  lines.push(`  "version": ${JSON.stringify(m.version)},`);
  lines.push(`  "proposedKeys": ${JSON.stringify(m.proposedKeys)},`);
  lines.push('  "keys": {');
  lines.push(Object.keys(m.keys).sort().map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(m.keys[k])}`).join(",\n"));
  lines.push("  },");
  lines.push('  "specs": [');
  lines.push(m.specs.map((s) => `    ${JSON.stringify(s)}`).join(",\n"));
  lines.push("  ]");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = renderMatrix(computeMatrix());
  if (process.argv.includes("--write")) {
    writeFileSync(PIN_PATH, rendered);
    console.log(`wrote ${PIN_RELATIVE_PATH} (${rendered.length} bytes)`);
  } else {
    const onDisk = readFileSync(PIN_PATH, "utf8");
    if (onDisk !== rendered) { console.error(`${PIN_RELATIVE_PATH} differs from the repository's authority`); process.exit(1); }
    console.log(`${PIN_RELATIVE_PATH} matches`);
  }
}
