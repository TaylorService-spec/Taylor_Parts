// Production-derived operational fixtures — CANONICAL AUTHORITY SPEC (Parts / Inventory / Equipment).
//
// This encodes the repository authority review (do NOT infer collection names from UI labels): the exact
// canonical collections, identity semantics, and the required relationship graph to close, plus the
// representative selection criteria that make the fixture set useful for real workflow testing. It is PURE
// data + pure helpers (no Firestore, no I/O) so it is unit-testable and shared by both the read-only
// extractor and the governed sandbox importer.
//
// Sources (verified in-repo):
//   parts, manufacturers, part_aliases, part_supplier_items  — functions/src/partMaster/*
//   stock_locations, warehouses, inventory_transactions      — functions/src/constants/collections.ts
//   mobile_locations, trucks                                 — functions/src/truckRegistry/*
//   equipment                                                — field-ops EQUIPMENT_COLLECTION (installed asset register)
//   equipment_models, equipment_model_aliases,
//   equipment_part_compatibility, equipment_compatibility_sources — functions/src/equipmentCompatibility/*

export const FIXTURE_VERSION = "operational-fixtures-v1";

// Domains selected for v1 + the "minimum supporting records required to preserve valid governed
// relationships" (NOT a wholesale clone).
export const DOMAINS = ["PARTS", "INVENTORY", "EQUIPMENT"];

// Per-collection canonical descriptor. `idField` names the domain identity; `docIdIsId` = the Firestore
// doc id equals that identity (parts/{partId} etc.). `refs` are outgoing relationship edges that must be
// CLOSED (the referenced record pulled into the fixture) — each { field, to, required }. Only required
// refs must resolve to zero dangling. `domain` groups collections for selection.
export const COLLECTIONS = {
  // ---- PARTS ----
  parts: {
    domain: "PARTS", idField: "partId", docIdIsId: true,
    refs: [{ field: "manufacturerId", to: "manufacturers", required: false }],
  },
  manufacturers: { domain: "PARTS", idField: "manufacturerId", docIdIsId: true, refs: [] },
  // Alias/supplier links are keyed compositely; they reference a part. Included only to the extent a
  // selected part needs them for realism; a dangling supplier is not fatal (required:false).
  part_aliases: { domain: "PARTS", idField: null, docIdIsId: false, refs: [{ field: "partId", to: "parts", required: true }] },
  part_supplier_items: { domain: "PARTS", idField: null, docIdIsId: false, refs: [{ field: "partId", to: "parts", required: true }] },

  // ---- INVENTORY ----
  warehouses: { domain: "INVENTORY", idField: "warehouseId", docIdIsId: true, refs: [] },
  stock_locations: {
    domain: "INVENTORY", idField: null, docIdIsId: false,
    refs: [
      { field: "warehouseId", to: "warehouses", required: true },
      { field: "partId", to: "parts", required: true },
    ],
  },
  // trucks are MOBILE inventory LOCATION identity (Truck Registry). mobile_locations mirror them.
  trucks: { domain: "INVENTORY", idField: "truckId", docIdIsId: true, refs: [{ field: "homeWarehouseId", to: "warehouses", required: false }] },
  mobile_locations: { domain: "INVENTORY", idField: "locationId", docIdIsId: true, refs: [] },
  // The WO-driven RESERVED/RELEASED/CONSUMED ledger. Included ONLY where a selected fixture requires a
  // reservation relationship; ledger docs reference a part. Never treated as a stock authority.
  inventory_transactions: { domain: "INVENTORY", idField: null, docIdIsId: false, refs: [{ field: "partId", to: "parts", required: false }] },

  // ---- EQUIPMENT ----
  equipment_models: { domain: "EQUIPMENT", idField: "equipmentModelId", docIdIsId: true, refs: [] },
  equipment_model_aliases: { domain: "EQUIPMENT", idField: null, docIdIsId: false, refs: [{ field: "equipmentModelId", to: "equipment_models", required: true }] },
  // (equipmentModelId, partId) compatibility — closes to BOTH a model and a part.
  equipment_part_compatibility: {
    domain: "EQUIPMENT", idField: null, docIdIsId: false,
    refs: [
      { field: "equipmentModelId", to: "equipment_models", required: true },
      { field: "partId", to: "parts", required: true },
    ],
  },
  equipment_compatibility_sources: { domain: "EQUIPMENT", idField: null, docIdIsId: false, refs: [] },
  // Installed-asset register (serialized units in the field). References its model + owning account/location;
  // account/location are OUT OF FIXTURE SCOPE (no customer/employee data) -> those refs are NOT closed here
  // and are handled by the sanitizer (TRANSFORM to sandbox-only placeholders) rather than pulled in.
  equipment: { domain: "EQUIPMENT", idField: "equipmentId", docIdIsId: true, refs: [{ field: "equipmentModelId", to: "equipment_models", required: false }] },
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

export function collectionsForDomain(domain) {
  return COLLECTION_NAMES.filter((c) => COLLECTIONS[c].domain === domain);
}

// Representative selection criteria (Owner step 2). Each is a PURE predicate over a record; the extractor
// picks a bounded number matching each, to guarantee useful variation rather than "copy everything".
// A criterion is best-effort: if production has no matching record it is skipped and reported, never faked.
export const SELECTION_CRITERIA = {
  parts: [
    { key: "active", desc: "an ACTIVE common part", match: (p) => p.status === "ACTIVE" },
    { key: "inactive", desc: "an INACTIVE/edge-status part", match: (p) => p.status && p.status !== "ACTIVE" },
    { key: "serialized", desc: "a SERIALIZED/LOT control-type part", match: (p) => /SERIAL|LOT/.test(String(p.controlType || "")) },
    { key: "standard", desc: "a STANDARD control-type part", match: (p) => p.controlType === "STANDARD" },
    { key: "kit-or-service", desc: "a KIT/SERVICE/NON_STOCK stocking-class part", match: (p) => /KIT|SERVICE|NON_STOCK/.test(String(p.stockingClass || "")) },
    { key: "has-manufacturer", desc: "a part with a manufacturerId (closes the manufacturer edge)", match: (p) => !!p.manufacturerId },
  ],
  warehouses: [
    { key: "active", desc: "an ACTIVE warehouse", match: (w) => w.status === "ACTIVE" || w.active === true },
    { key: "any", desc: "any warehouse (location distribution)", match: () => true },
  ],
  stock_locations: [
    { key: "positive", desc: "positive on-hand quantity", match: (s) => Number(s.quantity) > 0 },
    { key: "zero", desc: "zero quantity", match: (s) => Number(s.quantity) === 0 },
  ],
  equipment_models: [
    { key: "any", desc: "distinct equipment models/types", match: () => true },
  ],
  equipment: [
    { key: "active", desc: "an active installed asset", match: (e) => e.status === "ACTIVE" || !e.status },
    { key: "non-active", desc: "an inactive/out-of-service asset", match: (e) => e.status && e.status !== "ACTIVE" },
  ],
};

// A hard upper bound per collection so an extraction can never accidentally clone production. The operator
// can lower it; it can never be silently exceeded (the extractor enforces it).
export const MAX_PER_COLLECTION = 40;
