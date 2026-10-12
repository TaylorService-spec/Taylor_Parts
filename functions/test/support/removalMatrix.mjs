// THE REMOVAL-MATRIX REGRESSION GATE -- generator (field permissions PR 1: tests and tooling only).
//
// PROVENANCE. The architecture lane's read-only removal matrix (a design-time BEFORE/AFTER access matrix for every
// proposed field-permission removal) was computed from a nonprod census of principals and assignments. This is its
// repository-only port: the same removal specs and the same any-of / all-of requirement model, but every input is
// repository CODE, so nothing operational (no census, principal, name or record) is read or committed.
//
// SOURCES -- each reported as its own column, so a reviewer sees WHERE a holding comes from:
//   baselineRoles              roleCapabilityAuthorityBaseline.json GLOBAL rows (MIGRATION_BACKED + CANONICAL_CATALOG).
//                              Ruling E lands a grant-bearing migration with its baseline row in ONE change, and
//                              roleCapabilityAuthorityBaselinePostgres.test.mjs proves a clean rebuild equals the file.
//   baselineNonprodActivationRoles  the same file's NONPROD_ACTIVATION rows (the recorded Wave 6 activation).
//   recordedDelta*Roles        the recorded nonprod Administration decisions in src/adminPolicy/*Delta.ts (grants,
//                              revokes and grant conditions), imported from the REAL compiled modules by calling every
//                              exported `*Operations()` -- never copied -- so a change to a delta module moves the pin.
//                              They are repository code that nonprod applies through the Administration API.
//   protectedAdministratorStanding  the real isImpliedForProtectedAdministrator (protectedAdministrator.ts) over
//                              CAPABILITY_METADATA below; a PA exclusion is itself a code-deploy removal for admin.
//   CAPABILITY_METADATA        literal here; removalMatrixMetadataPostgres.test.mjs proves it equals
//                              eos_policy.capabilities after a full migrate (and that every PROPOSED key is unregistered).
// heldRoles = (baseline + activation + delta grants) - delta revokes, minus conditionedRoles (held only under a grant
// condition), plus admin when standing implies the key.
//
// OUT OF SCOPE BY CONSTRUCTION (state no repository change produces): grants, revokes and conditions made at RUNTIME
// through Administration (ADMIN_GRANTED rows not recorded in a delta module), assignment SCOPES (e.g. salesChannel-scoped
// Role assignments), direct Principal capability grants, and Role assignments themselves. The mandatory grant preview
// (field permissions PRs 2-3) governs those.
//
//   npm run build && node test/support/removalMatrix.mjs --check   # exit 1 on any difference
//   npm run build && node test/support/removalMatrix.mjs --write   # deliberate re-pin only (and move the digest)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * One entry per proposed REMOVAL. before / after = any-of list of all-of lists of keys.
 * proposedKeys = keys that do NOT exist yet (PLACEHOLDER names), with the metadata the proposal would register.
 * condBefore = today's route honours a grant CONDITION (e.g. technician RECORD_ASSIGNMENT), so a conditioned holder
 * counts in `before`; `after` is a governed field group and admits unconditioned holders only.
 * Compensating grants are proposals, not authority, and are deliberately not modelled.
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
  {"id": "SALES-M", "title": "Analysis sales.discounts.granted + sales.tradeIns.consideration (money) behind a pricing key", "before": [["salesOrder.read"]], "after": [["salesOrder.read", "salesOrder.pricing.read"]], "proposedKeys": {"salesOrder.pricing.read": {"objectKey": "salesOrder", "actionKind": "READ", "excludedFromProtectedAdministrator": true}}},
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
 * Registered capability metadata for every EXISTING key a spec names (eos_policy.capabilities object_key / action_key /
 * action_kind). Proved against a migrated database by removalMatrixMetadataPostgres.test.mjs.
 */
export const CAPABILITY_METADATA = Object.freeze({
  "audit.event.read": { objectKey: "auditLog", actionKey: "read", actionKind: "READ" },
  "customer.record.read": { objectKey: "account", actionKey: "read", actionKind: "READ" },
  "employee.record.read": { objectKey: "employee", actionKey: "read", actionKind: "READ" },
  "finance.invoice.read": { objectKey: "invoice", actionKey: "read", actionKind: "READ" },
  "finance.payment.read": { objectKey: "payment", actionKey: "read", actionKind: "READ" },
  "inventory.catalog.activate": { objectKey: "part", actionKey: "activate", actionKind: "BUSINESS_ACTION" },
  "inventory.catalog.cost.read": { objectKey: "supplierCatalogItem", actionKey: "readCost", actionKind: "READ" },
  "inventory.catalog.manage": { objectKey: "part", actionKey: "edit", actionKind: "EDIT" },
  "inventory.catalog.read": { objectKey: "part", actionKey: "read", actionKind: "READ" },
  "rental.agreement.manage": { objectKey: "rentalAgreement", actionKey: "manage", actionKind: "BUSINESS_ACTION" },
  "rental.agreement.read": { objectKey: "rentalAgreement", actionKey: "read", actionKind: "READ" },
  "rental.unit.assign": { objectKey: "rentalEquipment", actionKey: "assign", actionKind: "BUSINESS_ACTION" },
  "rental.unit.return": { objectKey: "rentalEquipment", actionKey: "return", actionKind: "BUSINESS_ACTION" },
  "reorder.purchaseOrder.read": { objectKey: "purchaseOrder", actionKey: "read", actionKind: "READ" },
  "reorder.request.read": { objectKey: "reorderRequest", actionKey: "read", actionKind: "READ" },
  "sales.discountAuthority.manage": { objectKey: "salesDiscountAuthority", actionKey: "manage", actionKind: "ADMIN_ACTION" },
  "salesOrder.read": { objectKey: "salesOrder", actionKey: "read", actionKind: "READ" },
  "supplier.record.read": { objectKey: "supplier", actionKey: "read", actionKind: "READ" },
  "workOrder.lifecycle.dispatch": { objectKey: "workOrder", actionKey: "dispatch", actionKind: "BUSINESS_ACTION" },
  "workOrder.lifecycle.schedule": { objectKey: "workOrder", actionKey: "schedule", actionKind: "BUSINESS_ACTION" },
  "workOrder.record.read": { objectKey: "workOrder", actionKey: "read", actionKind: "READ" },
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

/** The recorded delta modules: every compiled lib/adminPolicy/*Delta.js, each exported `*Operations` function. */
export function loadRecordedDeltas() {
  const dir = resolve(FUNCTIONS_DIR, "lib/adminPolicy");
  const sources = [];
  for (const file of readdirSync(dir).filter((f) => /Delta\.js$/.test(f)).sort()) {
    const mod = require(resolve(dir, file));
    for (const name of Object.keys(mod).filter((n) => /Operations$/.test(n) && typeof mod[n] === "function").sort()) {
      sources.push({ source: `${file.replace(/\.js$/, "")}.${name}`, operations: mod[name]() });
    }
  }
  return sources;
}

const sat = (req, held) => req.some((all) => all.every((k) => k !== NOBODY && held.has(k)));
const sorted = (xs) => [...new Set(xs)].sort();

/** The pin as a plain object. `lib` defaults to the compiled modules under lib/ (npm run build first). */
export function computeMatrix(lib = {
  baseline: require("../../lib/adminPolicy/roleCapabilityAuthorityBaseline.js"),
  pa: require("../../lib/adminPolicy/protectedAdministrator.js"),
  deltas: loadRecordedDeltas(),
}, specs = REMOVAL_SPECS, metadata = CAPABILITY_METADATA) {
  const { baseline, pa, deltas } = lib;
  const { existing, proposed } = specKeys(specs);
  const missing = existing.filter((k) => !metadata[k]);
  if (missing.length > 0) throw new Error(`removalMatrix: no CAPABILITY_METADATA for ${missing.join(", ")}`);

  // (objectKey, actionKey) -> spec key: how an Administration operation names a capability.
  const byAction = new Map(existing.map((k) => [`${metadata[k].objectKey}\u0000${metadata[k].actionKey}`, k]));
  const deltaGrant = new Set();
  const deltaRevoke = new Set();
  const deltaCondition = new Map(); // pair -> sorted condition kinds
  const pair = (r, k) => `${r}\u0000${k}`;
  for (const { source, operations } of deltas) {
    for (const { operation, input } of operations) {
      if (operation === "createRole") continue;
      if (!["grantObjectActionToRole", "revokeObjectActionFromRole", "setGrantCondition"].includes(operation)) {
        throw new Error(`removalMatrix: ${source} uses ${operation}, which this gate does not model`);
      }
      if (typeof input?.roleKey !== "string" || typeof input.objectKey !== "string" || typeof input.actionKey !== "string") {
        throw new Error(`removalMatrix: ${source} ${operation} does not name roleKey / objectKey / actionKey`);
      }
      const key = byAction.get(`${input.objectKey}\u0000${input.actionKey}`);
      if (key === undefined) continue; // a capability no spec names
      const p = pair(input.roleKey, key);
      if (operation === "grantObjectActionToRole") deltaGrant.add(p);
      else if (operation === "revokeObjectActionFromRole") deltaRevoke.add(p);
      else {
        const kinds = JSON.stringify(input.condition ?? null).match(/"kind":"[A-Z_]+"/g) ?? ["UNSPECIFIED"];
        deltaCondition.set(p, sorted([...(deltaCondition.get(p) ?? []), ...kinds.map((m) => m.slice(8, -1))]));
      }
    }
  }
  for (const p of deltaGrant) if (deltaRevoke.has(p)) throw new Error(`removalMatrix: a delta both grants and revokes ${p.replace("\u0000", " ")}`);

  const global = baseline.globalAuthorityGrants();
  const activation = baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS;
  const granted = new Set([...global, ...activation].map((g) => pair(g.roleKey, g.capabilityKey)));
  for (const p of deltaGrant) granted.add(p);
  for (const p of deltaRevoke) granted.delete(p);
  const roleOf = (p) => p.split("\u0000")[0];
  const keyOf = (p) => p.split("\u0000")[1];
  const roles = sorted([ADMIN_ROLE_KEY, ...[...granted, ...deltaRevoke].map(roleOf)]);
  const standing = (key, objectKey, actionKind) => pa.isImpliedForProtectedAdministrator({ key, objectKey, actionKind });
  const rolesFor = (pairs, key) => sorted([...pairs].filter((p) => keyOf(p) === key).map(roleOf));
  const conditioned = (p) => deltaCondition.has(p);

  const keys = {};
  for (const key of existing) {
    const m = metadata[key];
    const pas = standing(key, m.objectKey, m.actionKind);
    const heldPairs = [...granted].filter((p) => keyOf(p) === key);
    keys[key] = {
      objectKey: m.objectKey,
      actionKey: m.actionKey,
      actionKind: m.actionKind,
      baselineRoles: rolesFor(global.map((g) => pair(g.roleKey, g.capabilityKey)), key),
      baselineNonprodActivationRoles: rolesFor(activation.map((g) => pair(g.roleKey, g.capabilityKey)), key),
      recordedDeltaGrantRoles: rolesFor(deltaGrant, key),
      recordedDeltaRevokeRoles: rolesFor(deltaRevoke, key),
      conditionedRoles: Object.fromEntries(heldPairs.filter(conditioned).map((p) => [roleOf(p), deltaCondition.get(p)]).sort()),
      protectedAdministratorStanding: pas,
      heldRoles: sorted([...heldPairs.filter((p) => !conditioned(p)).map(roleOf), ...(pas ? [ADMIN_ROLE_KEY] : [])]),
    };
  }
  /** Role-level holding: unconditioned (flat) keys, and keys held only under a condition. */
  const flatOf = (role, extraForAdmin = []) => {
    const held = new Set(existing.filter((k) => keys[k].heldRoles.includes(role)));
    if (role === ADMIN_ROLE_KEY) for (const k of extraForAdmin) held.add(k);
    return held;
  };
  const condOf = (role) => new Set(existing.filter((k) => role in keys[k].conditionedRoles));

  const specRows = specs.map((s) => {
    // AFTER: a proposed key is held by nobody, except admin when the proposal leaves it implied by standing.
    const impliedProposed = Object.entries(s.proposedKeys ?? {})
      .filter(([k, m]) => !m.excludedFromProtectedAdministrator && standing(k, m.objectKey, m.actionKind)).map(([k]) => k);
    const beforeRoles = roles.filter((r) => sat(s.before, s.condBefore ? new Set([...flatOf(r), ...condOf(r)]) : flatOf(r)));
    const afterRoles = roles.filter((r) => sat(s.after, flatOf(r, impliedProposed)));
    return {
      id: s.id,
      before: s.before,
      after: s.after,
      ...(s.condBefore ? { beforeCountsConditionedGrants: true } : {}),
      beforeRoles,
      afterRoles,
      loseRoles: beforeRoles.filter((r) => !afterRoles.includes(r)),
      gainRoles: afterRoles.filter((r) => !beforeRoles.includes(r)),
    };
  });
  return {
    $comment: "GENERATED by functions/test/support/removalMatrix.mjs from repository code only: the authority baseline, the recorded "
      + "Administration delta modules and protected Administrator standing -- no census, no principal, no record. Pinned by SHA-256 in "
      + "functions/test/removalMatrixGate.test.mjs: a change that moves who holds one of these keys fails until re-pinned deliberately.",
    version: 2,
    recordedDeltaSources: deltas.map((d) => d.source),
    proposedKeys: proposed,
    keys,
    specs: specRows,
  };
}

/** Deterministic bytes: one key per line, one spec per line. */
export function renderMatrix(m) {
  const lines = ["{"];
  for (const k of ["$comment", "version", "recordedDeltaSources", "proposedKeys"]) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(m[k])},`);
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
