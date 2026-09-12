// THE GOVERNABLE OBJECT REGISTRY — the union of the CRUD matrix and the metadata registry.
//
// ════════════════════ THE GAP THIS CLOSES ════════════════════
//
// Two lists described "the business objects", and neither was complete:
//
//   objectPermissionMap.js   24 rows. The Owner's CRUD matrix -- which OBJECT x VERB pairs a
//                            capability governs. Hand-maintained, and it predates several entities:
//                            there is no Suppliers row and no Warehouses row, even though
//                            `supplier.record.read` and `warehouse.record.read` both exist.
//   entityRegistry.js        28 entities, 389 fields. The shipped object/field model.
//
// Sixteen entities appear in both. THIRTEEN ENTITIES CARRYING 166 FIELDS APPEARED IN NEITHER the
// policy seed nor the Administration grid -- Supplier, Warehouse, Truck, Reorder Request, Sales
// Agreement and eight more. Not excluded for a reason; simply never reached, because the seed was
// derived from the matrix alone.
//
// This module is the union, stated once, so the seed and the Administration surfaces cannot answer
// "which objects can policy govern?" differently.
//
// ════════════════════ WHAT AN ENTITY-ONLY OBJECT GETS ════════════════════
//
// A real, governable object with NO capability governing most of its verbs. That is honest rather
// than a placeholder: the object exists and an administrator should see it, and until the catalog
// or the matrix names a capability for a verb, no Role can be granted it (Owner ruling D-2 --
// refuse, never persist a grant the engine cannot enforce). The UI already draws that as a dash.
//
// Where an entity declares its own `readCapability`, R IS governed by it. Three do.
import { ENTITY_REGISTRY } from "../metadata/entityRegistry.js";
import { OBJECT_PERMISSIONS } from "./objectPermissionMap.js";

/**
 * Business object name in the CRUD matrix -> metadata entity id.
 *
 * STATED ONCE, HERE. It used to live in two places -- the Administration grid and the seed
 * generator -- which is how the two came to disagree about which objects had fields.
 */
export const ENTITY_BY_MATRIX_OBJECT = Object.freeze({
  Accounts: "account",
  Contacts: "contact",
  "Customer Locations": "location",
  Opportunities: "opportunity",
  "Sales Orders": "salesOrder",
  "Work Orders": "workOrder",
  "Parts Catalog": "part",
  "Inventory Stock": "inventoryTransaction",
  "Inventory Adjustments": "inventoryAction",
  "Purchase Orders": "purchaseOrder",
  // Its OWN row since the Owner ruling separating it from Purchase Orders. Both are canonical
  // EOS Objects and each owns its own data authority.
  "Reorder Requests": "reorderRequest",
  Receiving: "receivingOrder",
  "Transfer Orders": "transferOrder",
  "Equipment / Installed Base": "equipment",
  "Invoices / AR": "invoice",
  Payments: "payment",
  Users: "employee",
});

const VERBS = Object.freeze(["C", "R", "E", "D"]);

/** A stable key from a business object name: "Invoices / AR" -> "invoicesAr". */
export function matrixObjectKey(name) {
  const mapped = ENTITY_BY_MATRIX_OBJECT[name];
  if (mapped) return mapped;
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

/** Which verbs any capability governs for a matrix row. An empty list means "nobody can hold it". */
function matrixCapabilities(entry) {
  return { C: [...(entry.C ?? [])], R: [...(entry.R ?? [])], E: [...(entry.E ?? [])], D: [...(entry.D ?? [])] };
}

/**
 * An entity that has no matrix row.
 *
 * Its READ verb is governed by the entity's own declared `readCapability` when it has one; every
 * other verb is ungoverned until the matrix names a capability. Nothing is invented -- an object
 * with no governing capability is drawn as ungovernable rather than as merely ungranted.
 */
function entityCapabilities(entity) {
  const declared = { C: [], R: entity.readCapability ? [entity.readCapability] : [], E: [], D: [] };
  const gap = MATRIX_GAP_CAPABILITIES[entity.id];
  if (!gap) return declared;
  return {
    C: [...new Set([...declared.C, ...(gap.C ?? [])])],
    R: [...new Set([...declared.R, ...(gap.R ?? [])])],
    E: [...new Set([...declared.E, ...(gap.E ?? [])])],
    D: [...new Set([...declared.D, ...(gap.D ?? [])])],
  };
}

/**
 * Capabilities that plainly govern a registry-only object and that THE MATRIX DOES NOT CLAIM.
 *
 * ════════════════════ THE ONE RULE THIS TABLE OBEYS ════════════════════
 *
 * Every id here is UNUSED by `objectPermissionMap.js`. That is what makes this an extension rather
 * than a second opinion: no capability is attributed to two objects, and
 * `policyObjectRegistry.test.mjs` fails if one ever is. Without that rule this would be the
 * two-tables-of-one-fact defect the codebase keeps re-learning.
 *
 * Each id also UNAMBIGUOUSLY NAMES its object -- `warehouse.record.read` is described in the
 * catalog as "Read a warehouses record". Nothing is inferred from a family resemblance.
 *
 * ════════════════════ WHAT IS DELIBERATELY ABSENT ════════════════════
 *
 * REORDER REQUEST WAS LISTED HERE, and no longer is. The Owner ruled (D-5, 2026-09-08) that
 * authority follows the RECORD: Reorder Request has its OWN matrix row carrying its create and
 * read capabilities, its transitions are Parts / Purchasing workflow ACTIONS rather than CRED
 * cells, and Purchase Order keeps only purchase order data authority. So it is not a gap this
 * table fills -- it is an ordinary matrix object, and adding it here would be the two-owners
 * defect this table exists to avoid.
 *
 * STOCK LOCATION WAS LISTED HERE, and no longer is. The Owner ruled (2026-09-12) that
 * `stock_locations` is RETIRED as an operational authority, so `stockLocationEntity` is no longer in
 * ENTITY_REGISTRY and there is no object for this row to extend. `warehouse.stockLocation.read`
 * remains in the capability catalog, labelled there as a retired authority -- it is historical
 * evidence, and mapping it onto a governable object here is exactly how historical evidence becomes
 * a live runtime dependency.
 *
 * SUPPLIER, TRUCK, MOBILE LOCATION, PART ALIAS, MANUFACTURER, EQUIPMENT MODEL, SALES TERRITORY,
 * PURCHASE ORDER VOID, SUPPLIER CATALOG ITEM. Measured on this branch: no capability in the catalog
 * names them. They are seeded as governable objects with no grantable verb, which is the honest
 * state -- an administrator sees the object and sees that nothing can be granted on it yet.
 */
export const MATRIX_GAP_CAPABILITIES = Object.freeze({
  warehouse: Object.freeze({ R: ["warehouse.record.read"] }),
  salesAgreement: Object.freeze({
    C: ["salesAgreement.create"],
    R: ["salesAgreement.read"],
    E: ["salesAgreement.updateDraft", "salesAgreement.accept"],
  }),
});

/**
 * Every object policy can govern, matrix rows first (their order is the one the Owner's matrix and
 * the Administration screens read in), then the entities the matrix never covered.
 */
export const GOVERNABLE_OBJECTS = Object.freeze(
  (() => {
    const out = [];
    const claimed = new Set();

    for (const entry of OBJECT_PERMISSIONS) {
      const key = matrixObjectKey(entry.object);
      const entity = ENTITY_REGISTRY.find((e) => e.id === key) ?? null;
      claimed.add(key);
      out.push(
        Object.freeze({
          key,
          label: entry.object,
          labelPlural: entity?.labelPlural ?? null,
          description: entity?.description ?? null,
          domain: entry.domain,
          source: entity ? "MATRIX_AND_REGISTRY" : "MATRIX_ONLY",
          entityId: entity?.id ?? null,
          rulesOnly: entry.rulesOnly ?? null,
          capabilitiesByVerb: Object.freeze(matrixCapabilities(entry)),
          // A D grant is only meaningful where a capability governs Delete. Measured: no matrix row
          // declares one, because nothing in this platform hard-deletes a business record -- they
          // are archived, cancelled, voided or deactivated.
          supportsDelete: (entry.D ?? []).length > 0,
          fields: Object.freeze([...(entity?.fields ?? [])]),
        }),
      );
    }

    for (const entity of ENTITY_REGISTRY) {
      if (claimed.has(entity.id)) continue;
      out.push(
        Object.freeze({
          key: entity.id,
          label: entity.label,
          labelPlural: entity.labelPlural ?? null,
          description: entity.description ?? null,
          // The matrix carries the business domain; an entity does not declare one. Left null
          // rather than guessed, so a blank column reads as "not stated" instead of a wrong answer.
          domain: null,
          source: "REGISTRY_ONLY",
          entityId: entity.id,
          rulesOnly: null,
          capabilitiesByVerb: Object.freeze(entityCapabilities(entity)),
          supportsDelete: false,
          fields: Object.freeze([...entity.fields]),
        }),
      );
    }

    return out;
  })(),
);

/** Which verbs are governed at all, for the UI's third cell state. */
export function governedVerbs(object) {
  const out = {};
  for (const verb of VERBS) out[verb] = (object?.capabilitiesByVerb?.[verb] ?? []).length > 0;
  return out;
}

export const findGovernableObject = (key) => GOVERNABLE_OBJECTS.find((o) => o.key === key) ?? null;

/** Totals, for the coverage ledger and for a screen that wants to say how much it is showing. */
export const governableObjectCounts = () => ({
  objects: GOVERNABLE_OBJECTS.length,
  fromMatrixAndRegistry: GOVERNABLE_OBJECTS.filter((o) => o.source === "MATRIX_AND_REGISTRY").length,
  matrixOnly: GOVERNABLE_OBJECTS.filter((o) => o.source === "MATRIX_ONLY").length,
  registryOnly: GOVERNABLE_OBJECTS.filter((o) => o.source === "REGISTRY_ONLY").length,
  fields: GOVERNABLE_OBJECTS.reduce((n, o) => n + o.fields.length, 0),
});
