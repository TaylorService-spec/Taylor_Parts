// EOS Ownership Model v1 — the OWNERSHIP MATRIX as code, reconciled against the measured sandbox
// census (Owner rulings D-8 … D-16, 2026-08-30).
//
// ============================ WHAT THE CENSUS CHANGED ============================
//
// The first matrix classified every non-person record as COMPANY-owned. The census showed that was
// wrong in a way counting could not fix: 130 sandbox records sit in families where the question
// "which company owns this?" has no true answer, because Taylor and Ventana legitimately use the
// SAME part, the same manufacturer, the same equipment model. Assigning one of them would have been
// fabricating a fact to satisfy a sentence.
//
// So the invariant is now, per ruling D-8:
//
//     EVERY OWNABLE GOVERNED BUSINESS RECORD HAS AN OWNER.
//
// and every family declares whether it is ownable at all.
//
// ============================ THE FOUR CLASSES ============================
//
//   PERSON     business responsibility belongs to an employee
//   COMPANY    business responsibility belongs to Taylor or Ventana
//   REFERENCE  governed, intentionally company-neutral, not an owned business object. Both
//              operating companies may legitimately use the same record. NOT ownerless-in-error --
//              excluded from the invariant by classification, which is a different statement.
//   EXCLUDED   not a business record at all: identity, access, audit, coverage, infrastructure
//
// ============================ THE OTHER FIVE COLUMNS ============================
//
//   ownerFields       the EXISTING storage the typed owner derives from. Empty = no storage yet.
//   inheritanceSource where a NEW record's default owner comes from. Recorded here as a NAME, not a
//                     rule -- the rule lives in the creation path (ruling D-1 forbids a second
//                     authority), and this column exists so the backfill plan can be read whole.
//   transfer          HANDOFF (explicit auditable transfer) / IMMUTABLE (historical) / N_A
//   companyScope      SINGLE_COMPANY / CROSS_COMPANY_CAPABLE / COMPANY_NEUTRAL (ruling D-10 -- a
//                     transfer between a Taylor and a Ventana site has no single owning company,
//                     and picking one would be the false owner the ruling warns about)
//   backfillSource    the DETERMINISTIC source a backfill could use, or null when none exists.
//                     `null` is the most important value in this file: it is the honest statement
//                     that a family cannot be populated without new business input, and it is what
//                     stops a plan from inventing one.
//   unresolvedPolicy  what happens to a record that cannot resolve. Always "remains OWNERLESS" for
//                     an ownable family -- never a default, never a guess.
//
// NOTHING HERE IS INFERRED FROM A PROHIBITED PROXY. Ruling D-6/D-11/D-12 forbid deriving company or
// person ownership from lineOfBusiness, display text, title holder, customer, location NAME,
// creator, assignment, territory, coverage, activity, sales history, or auth uid. No column below
// names any of them as a backfill source.

import { OWNER_TYPES, type OwnerType } from "./typedOwner";

// Owner ruling (2026-08-30): four ACTUAL ownership shapes, not two forced ones.
//
//   PERSON                 one employee is responsible
//   COMPANY                one operating company is responsible
//   PARTICIPATING_COMPANIES a governed transaction that legitimately spans companies. It is OWNABLE
//                          -- it has a valid governed ownership shape -- but that shape is two
//                          named participants, not one owner. Forcing "source always owns it" would
//                          be a convention invented to satisfy a field, which is what the ruling
//                          forbids.
//   REFERENCE              intentionally company-neutral shared authority. No business owner.
//
// plus EXCLUDED for non-business authorities. The invariant is now:
//
//     EVERY OWNABLE GOVERNED BUSINESS RECORD HAS A VALID GOVERNED OWNERSHIP SHAPE.
export type OwnerClass = "PERSON" | "COMPANY" | "PARTICIPATING_COMPANIES" | "REFERENCE" | "EXCLUDED";
export type TransferBehavior = "HANDOFF" | "IMMUTABLE" | "N_A";
export type CompanyScope = "SINGLE_COMPANY" | "CROSS_COMPANY_CAPABLE" | "COMPANY_NEUTRAL";

export interface OwnershipFamily {
  readonly family: string;
  readonly collection: string;
  readonly ownerClass: OwnerClass;
  /** null for REFERENCE and EXCLUDED -- they have no owner type because they have no owner. */
  readonly ownerType: OwnerType | null;
  readonly ownerFields: readonly string[];
  /**
   * For PARTICIPATING_COMPANIES only: the two company references that TOGETHER constitute the
   * record's ownership shape. Deliberately not `ownerFields` -- these are participants in a
   * transaction, and a reader who saw them under "owner" would reasonably conclude one of them was.
   */
  readonly participatingFields?: readonly string[];
  /**
   * Ruling R-8: the ORTHOGONAL operating-company axis a PERSON-owned record may also carry.
   *
   * "Do not interpret operatingCompanyId as replacing salesperson ownership." A Sales Order owned by
   * Rudy and booked to Taylor is one record with two true, independent facts:
   *
   *     ownerEmployeeId    = Rudy     -- sales ownership, who is responsible commercially
   *     operatingCompanyId = taylor   -- company scope, whose books it lands in
   *
   * This column is NOT ownership. It exists so the financial lineage Sales Order -> Invoice ->
   * Payment can inherit a company without anyone concluding the company displaced the salesperson.
   */
  readonly companyScopeField?: string;
  readonly inheritanceSource: string | null;
  readonly transfer: TransferBehavior;
  readonly companyScope: CompanyScope;
  readonly backfillSource: string | null;
  readonly unresolvedPolicy: string;
  /** Why this family is classified as it is, where the reason is not self-evident. */
  readonly note?: string;
}

const usr = OWNER_TYPES.USER;
const cmp = OWNER_TYPES.COMPANY;

const OWNERLESS_UNTIL_SUPPLIED = "remains OWNERLESS until an explicit company assignment is supplied";
const OWNERLESS_UNTIL_UPSTREAM = "remains OWNERLESS until its upstream owner resolves";
const NOT_OWNABLE = "not ownable -- excluded from the invariant by classification, not by omission";

export const OWNERSHIP_MATRIX: readonly OwnershipFamily[] = Object.freeze(
  [
    // ═══════════════════════ PERSON ═══════════════════════
    //
    // Commercial responsibility that belongs to a named employee. The Account is the root of the
    // whole chain (ruling D-4), which is why the sandbox's 0/103 accountOwner rate mattered so
    // much more than its size suggested.
    {
      family: "account", collection: "accounts", ownerClass: "PERSON", ownerType: usr,
      ownerFields: ["accountOwner"], inheritanceSource: null, transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: "explicit assignment only -- ruling D-6 forbids inferring an Account owner from creator, territory, coverage, activity, sales history, or auth uid",
      unresolvedPolicy: "remains OWNERLESS until an owner is explicitly assigned",
      note: "The root of the person-owned inheritance chain. An ownerless Account makes inherited Opportunity creation REFUSE, by design.",
    },
    {
      family: "contact", collection: "contacts", ownerClass: "PERSON", ownerType: usr,
      ownerFields: ["owner"], inheritanceSource: "parent Account owner at creation", transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: "parent Account owner via accountId -- deterministic, and a real relationship rather than a proxy",
      unresolvedPolicy: OWNERLESS_UNTIL_UPSTREAM,
    },
    {
      family: "location", collection: "locations", ownerClass: "PERSON", ownerType: usr,
      ownerFields: ["owner"], inheritanceSource: "parent Account owner at creation", transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: "parent Account owner via accountId -- Rules already enforce this parentage",
      unresolvedPolicy: OWNERLESS_UNTIL_UPSTREAM,
      note: "A CUSTOMER site, not one of ours. Distinct from warehouses/stock_locations, which are company-owned physical roots.",
    },
    {
      family: "opportunity", collection: "opportunities", ownerClass: "PERSON", ownerType: usr,
      // Ruling R-8. NOT STORED TODAY -- this is the recorded company-scope gap: no commercial record
      // carries an operating company, which is why every financial artifact downstream has a null
      // backfillSource. Declared here so the axis exists in the model before anything depends on it.
      companyScopeField: "operatingCompanyId",
      ownerFields: ["ownerEmployeeId"], inheritanceSource: "Customer (Account) owner", transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: null, unresolvedPolicy: "n/a -- measured 100% RESOLVED",
      note: "Complete in sandbox (14/14) because ownerEmployeeId was required until D-4 relaxed it.",
    },
    {
      family: "salesAgreement", collection: "sales_agreements", ownerClass: "PERSON", ownerType: usr,
      // Ruling R-8 -- see the Opportunity row. Same axis, same gap.
      companyScopeField: "operatingCompanyId",
      ownerFields: ["ownerEmployeeId"], inheritanceSource: "Opportunity owner", transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: null, unresolvedPolicy: "n/a -- measured 100% RESOLVED",
    },
    {
      family: "salesOrder", collection: "sales_orders", ownerClass: "PERSON", ownerType: usr,
      // Ruling R-8, and this row is the one that matters: the Sales Order is where the company must
      // enter the commercial chain, because every financial artifact downstream inherits from it.
      // ownerEmployeeId = Rudy and operatingCompanyId = taylor are both true on the same record.
      companyScopeField: "operatingCompanyId",
      ownerFields: ["ownerEmployeeId"], inheritanceSource: "Opportunity owner", transfer: "HANDOFF",
      companyScope: "COMPANY_NEUTRAL",
      backfillSource: null, unresolvedPolicy: "n/a -- measured 100% RESOLVED",
    },

    // ═══════════════════════ COMPANY — financial (ruling D-15) ═══════════════════════
    //
    // RECLASSIFIED from PERSON. A ledger entry belongs to the books it lands in, not to the
    // salesperson upstream of it. Commercial attribution is still fully available through the
    // Customer -> Opportunity -> Agreement -> Sales Order lineage, which is the point: accounting
    // ownership and sales credit are different questions and must not share one field.
    ...(
      [
        ["invoice", "invoices"],
        ["payment", "payments"],
        ["paymentApplication", "payment_applications"],
        ["invoiceAdjustment", "invoice_adjustments"],
        ["refund", "refunds"],
      ] as const
    ).map(([family, collection]) => ({
      family, collection, ownerClass: "COMPANY" as const, ownerType: cmp,
      ownerFields: [] as readonly string[],
      inheritanceSource: "the operating company whose books contain the transaction",
      transfer: "IMMUTABLE" as const, companyScope: "SINGLE_COMPANY" as const,
      backfillSource: null,
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "Owner is the company whose books hold it -- NOT the salesperson it descends from. No source exists yet because no upstream commercial record stores an operating company either.",
    })),

    // ═══════════════════════ COMPANY — service (ruling D-13) ═══════════════════════
    //
    // RECLASSIFIED from PERSON. The responsible operating company owns the job; the technician
    // performs it. That keeps the ownership/assignment distinction this whole model rests on, and
    // it is why assignedTechId is deliberately NOT an ownerField below.
    {
      // Ruling R-3. The JOB is where the company enters the service lineage: explicit at creation, or
      // inherited from a governed upstream service/commercial source. Never from the technician, the
      // dispatcher, createdBy or assignedTo -- those are who DOES the work, which is precisely the
      // distinction this model exists to hold.
      family: "workOrder", collection: "fieldops_jobs", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "explicit at creation, or the governed upstream service/commercial source company",
      transfer: "HANDOFF", companyScope: "SINGLE_COMPANY", backfillSource: null,
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "MEASURED: 41 of 45 sandbox jobs are certification fixtures and can be explicitly authored, as equipment was. The other 4 are not, and stay unresolved. assignedTechId remains ASSIGNMENT.",
    },
    {
      // CORRECTED by DECISIONS #143. Ruling R-12 -- which would have added `fieldops_wos.jobId` and
      // inherited company from a parent Job -- is WITHDRAWN. Its own condition ("if fieldops_jobs is
      // the actual parent domain authority") is not met:
      //
      //   constants/collections.ts defines WORK_ORDERS_COLLECTION = "fieldops_wos"
      //   the deployed createWorkOrder / transitionWorkOrder callables write THIS collection
      //   completeAssignedJob.ts records that legacy fieldops_jobs carry a `workOrderId` field which
      //     is THEIR UPWARD LINK to fieldops_wos
      //
      // So the link R-12 proposed points the opposite way to the one the code documents, and would
      // have made the legacy collection the parent of the live one. THIS is the current Work Order
      // authority; `fieldops_jobs` is a distinct legacy domain, not its parent.
      //
      // A Work Order therefore takes its company from its OWN governed context and stores it as a
      // historical fact. Never from the technician, dispatcher, creator, assignedTo, customer owner,
      // location name, lineOfBusiness, or a legacy Job coincidence.
      family: "workOrderLegacy", collection: "fieldops_wos", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"],
      inheritanceSource: "explicit at creation, or a governed upstream source that already carries one (e.g. a Sales Order)",
      transfer: "HANDOFF", companyScope: "SINGLE_COMPANY", backfillSource: null,
      unresolvedPolicy: "remains OWNERLESS -- NO_GOVERNED_COMPANY_SOURCE, which is a company-provenance gap and NOT a lineage defect",
      note: "11 of 30 sandbox Work Orders carry a salesOrderId and become POTENTIALLY derivable once the commercial company axis is authored -- to be measured, never assumed. No jobId is added and no parent is invented.",
    },

    // ═══════════════════════ COMPANY — inventory obligation (ruling D-14) ═══════════════════════
    {
      // Ruling R-4, and the derivation check is what forced it: a reorder request carries NO location
      // reference of any kind today, so it can derive a company from nothing. The fix is at the
      // record, not in a derivation -- it must say WHERE inventory needs replenishment.
      //
      //   warehouseId        where replenishment is needed. The WAREHOUSE deliberately, not a
      //                      stock_location -- that is a warehouse+part BALANCE, not a place, and
      //                      making a balance the location authority would repeat the exact category
      //                      error the root correction already had to fix once.
      //   operatingCompanyId derived from that warehouse at TRUSTED CREATION, then stored
      //   requestedBy        the person who asked. Never the owner.
      //   currentOwner       the role queue. Untouched, and still not ownership.
      family: "reorderRequest", collection: "reorder_requests", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: [], inheritanceSource: "the warehouse the replenishment is for, at trusted creation",
      transfer: "HANDOFF", companyScope: "SINGLE_COMPANY",
      backfillSource: null,
      unresolvedPolicy: "remains OWNERLESS -- measured 6/6 MISSING_REFERENCE, the record cannot say where",
      note: "MEASURED DESIGN GAP: 6/6 sandbox requests carry no warehouseId. Adding it is a schema change to the reorder request, not a backfill.",
    },

    // ═══════════════════════ COMPANY — physical roots (ruling D-9) ═══════════════════════
    //
    // The company boundary starts here. These four are the only families whose company can be
    // stated as a primary business fact rather than derived from something else, so they are
    // populated from governed configuration and everything else in the inventory chain hangs off
    // them. Explicitly NOT from display names.
    // MEASURED CORRECTION. The first plan listed four root families and 19 records. The derivation
    // check found two of them are not roots at all:
    //   stock_locations is a per-warehouse-per-part BALANCE record, not a place. 5/5 derive from
    //     their warehouseId.
    //   trucks carry homeWarehouseId. 2/2 derive from their home warehouse.
    // Only warehouses and mobile_locations are primary. 12 root decisions, not 19.
    ...(
      [
        ["warehouse", "warehouses"],
        ["mobileLocation", "mobile_locations"],
      ] as const
    ).map(([family, collection]) => ({
      family, collection, ownerClass: "COMPANY" as const, ownerType: cmp,
      ownerFields: [] as readonly string[],
      inheritanceSource: "none -- this IS the root",
      transfer: "HANDOFF" as const, companyScope: "SINGLE_COMPANY" as const,
      backfillSource: "explicit governed configuration, Owner-supplied per site or vehicle -- never the record's display name",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "A company-boundary root. Populating these unblocks the location-derived families below.",
    })),

    // ═══════════════════════ COMPANY — location-derived (ruling D-10) ═══════════════════════
    {
      family: "stockLocation", collection: "stock_locations", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "the warehouse the balance belongs to", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "warehouseId -- measured 5/5 DERIVABLE",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "Reclassified from root to derived. It is a per-warehouse-per-part balance, not a physical place.",
    },
    {
      family: "truck", collection: "trucks", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "the truck's home warehouse", transfer: "HANDOFF",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "homeWarehouseId -- a real governed reference, measured 2/2 DERIVABLE",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "Reclassified from root to derived. A truck belongs to the depot it works out of.",
    },
    {
      // Owner ruling Q1: the company-scoped half of the supplier relationship. THE COLLECTION DOES
      // NOT EXIST YET -- recorded here so the classification is stated before anything is built,
      // rather than discovered when someone needs a place to put payment terms and reaches for the
      // supplier master. Census scans it and finds nothing, which is the correct current answer.
      family: "supplierCompanyTerms", collection: "supplier_company_terms",
      ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: [], inheritanceSource: "the operating company the terms belong to",
      transfer: "HANDOFF", companyScope: "SINGLE_COMPANY",
      backfillSource: null,
      unresolvedPolicy: "n/a -- the collection does not exist yet",
      note: "supplierId + operatingCompanyId + accountNumber/pricing/payment/freight terms + status. Keeps the shared supplier master company-neutral while company-specific commercial facts get a home that can be owned.",
    },
    {
      family: "inventoryTransaction", collection: "inventory_transactions", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"],
      // A ledger entry BETWEEN two companies records a pair, like a transfer does. The scalar above
      // is the ordinary case; this is the shape the cross-company movements actually carry, and
      // declaring it is what stops the census reporting a correctly-recorded movement as ownerless.
      participatingFields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"], inheritanceSource: "the governed stock location's company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the stock location's operatingCompanyId, once D-9 is populated",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
    },
    {
      family: "inventoryAction", collection: "inventory_actions", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: [], inheritanceSource: "the governed stock location's company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the stock location's operatingCompanyId, once D-9 is populated",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
    },
    {
      family: "receivingOrder", collection: "receiving_orders", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "the receiving location's company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the destination location's operatingCompanyId, once D-9 is populated",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "Receiving has one destination, so it has one owning company. Unlike a transfer.",
    },
    {
      family: "cycleCount", collection: "cycle_counts", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "the counted location's company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the counted location's operatingCompanyId, once D-9 is populated",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
    },
    {
      family: "purchaseOrder", collection: "purchase_orders", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: [], inheritanceSource: "the buying company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the ship-to location's operatingCompanyId, once D-9 is populated -- to be confirmed against purchasing semantics",
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
    },
    {
      family: "reorderPurchaseOrder", collection: "reorder_purchase_orders", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: [], inheritanceSource: "the buying company", transfer: "IMMUTABLE",
      companyScope: "SINGLE_COMPANY",
      backfillSource: "the linked Reorder Request's operatingCompanyId, once the request carries one",
      unresolvedPolicy: "remains OWNERLESS -- its only path to a company runs through a request that has none",
      note: "Ruling R-4: a purchase order combining requests from MORE THAN ONE operating company must be REFUSED, or split into separate per-company POs. Taylor and Ventana purchasing obligations are never silently collapsed into one company-owned PO.",
    },

    // ═══════════════════════ COMPANY — CROSS-COMPANY CAPABLE (ruling D-10) ═══════════════════════
    {
      // Owner ruling: PARTICIPATING COMPANIES, decided. A transfer order is a cross-company
      // TRANSACTION, not a single-company-owned record. Its two participants derive from the
      // governed source and destination location authorities.
      //
      // Deliberately NOT given a convention. "Source always owns it" and "destination always owns
      // it" were both rejected: either would record a company as responsible for a movement it may
      // only have received. If the business later assigns formal transaction responsibility, that
      // is a decision to add, not one to assume.
      //
      // AND THE HANDOFF AUTHORITY MUST NOT TOUCH THESE. Changing a transfer's participants is
      // transaction-domain state -- correcting where goods went -- not an ownership handoff. The
      // `transfer: "N_A"` below is what enforces that: the handoff command refuses this family.
      family: "transferOrder", collection: "transfer_orders",
      ownerClass: "PARTICIPATING_COMPANIES", ownerType: null,
      ownerFields: [],
      participatingFields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"],
      inheritanceSource: "the governed source and destination location authorities",
      transfer: "N_A",
      companyScope: "CROSS_COMPANY_CAPABLE",
      backfillSource: "origin.locationId and destination.locationId, once the physical roots carry companies -- measured 47/47 resolve to two distinct roots",
      unresolvedPolicy: "remains without a participating pair until both roots carry companies",
      note: "Taylor->Taylor, Ventana->Ventana, Taylor->Ventana and Ventana->Taylor are all valid. The shape holds all four.",
    },

    // ═══════════════════════ COMPANY — equipment (ruling D-12) ═══════════════════════
    {
      family: "equipment", collection: "equipment", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "the operating company that carries the record", transfer: "HANDOFF",
      companyScope: "SINGLE_COMPANY",
      backfillSource: null,
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "Stays company-owned and stays DISTINCT from explicitTitleHolder -- a CUSTOMER may hold title without owning the internal record. No deterministic source exists: every candidate on the record (customer, title holder, location name) is a prohibited proxy. No mass assignment.",
    },

    // ═══════════════════════ REFERENCE — company-neutral (ruling D-11) ═══════════════════════
    //
    // The question the ruling posed for each: "Can Taylor and Ventana both legitimately use the
    // same record?" For all of these the answer is yes -- a part number, a manufacturer, an
    // equipment model and a supplier's catalog entry describe the WORLD, not our side of it. Two
    // operating companies referencing one part is the normal case, not a data problem.
    //
    // Classifying them REFERENCE removes them from the owner-required invariant. That is a
    // deliberate narrowing of the original "every record" wording, per ruling D-8, and it is not
    // the same statement as "these are ownerless".
    ...(
      [
        ["part", "parts"],
        ["partAlias", "part_aliases"],
        ["partSupplierItem", "part_supplier_items"],
        ["manufacturer", "manufacturers"],
        ["equipmentModel", "equipment_models"],
        ["supplierCatalogItem", "supplier_catalog"],
      ] as const
    ).map(([family, collection]) => ({
      family, collection, ownerClass: "REFERENCE" as const, ownerType: null,
      ownerFields: [] as readonly string[], inheritanceSource: null,
      transfer: "N_A" as const, companyScope: "COMPANY_NEUTRAL" as const,
      backfillSource: null, unresolvedPolicy: NOT_OWNABLE,
      note: "Shared catalog/reference data. Both operating companies may legitimately use the same record.",
    })),
    {
      // Held apart from the block above ON PURPOSE. A supplier's IDENTITY is shared, but a supplier
      // RELATIONSHIP -- terms, pricing, account numbers, approval -- may well be company-specific.
      // The census cannot answer which of those `suppliers` actually represents, and guessing would
      // either fabricate ownership or wrongly exempt a company-scoped record. Flagged for ruling.
      family: "supplier", collection: "suppliers", ownerClass: "REFERENCE", ownerType: null,
      ownerFields: [], inheritanceSource: null, transfer: "N_A", companyScope: "COMPANY_NEUTRAL",
      backfillSource: null,
      unresolvedPolicy: "PROVISIONALLY not ownable -- pending the Owner ruling in the note",
      note: "OPEN QUESTION. Supplier identity is shared; supplier terms may be per-company. If `suppliers` carries commercial terms, it is company-scoped and belongs in COMPANY, not REFERENCE.",
    },

    // ═══════════════════════ EXCLUDED — not business records ═══════════════════════
    //
    // Recorded rather than omitted, so a reader can see these were considered. A collection absent
    // from this file entirely would be indistinguishable from one nobody thought about.
    ...(
      [
        ["user", "users", "identity authority -- a subject of ownership, not an object"],
        ["employee", "employees", "person authority -- a subject of ownership, not an object"],
        ["technician", "fieldops_technicians", "person authority"],
        ["permission", "permissions", "access authority, governed separately"],
        ["role", "roles", "access authority, governed separately"],
        ["roleAssignment", "roleAssignments", "access authority, governed separately"],
        ["accessRequest", "accessRequests", "access authority, governed separately"],
        ["auditEvent", "auditEvents", "the audit trail itself -- immutable, client-deny-all"],
        ["reportDefinition", "reportDefinitions", "platform record with its own private-by-owner model -- do not disturb"],
        ["salesTerritory", "sales_territories", "coverage is not ownership, credit, commission or security"],
        ["coverageAssignment", "commercial_coverage_assignments", "coverage is not ownership"],
        ["counter", "counters", "infrastructure"],
        ["inventorySyncStatus", "inventory_sync_status", "infrastructure"],
        ["locationTruckClaim", "location_truck_claims", "infrastructure"],
        ["technicianAvailability", "technician_working_availability", "person-scoped scheduling"],
        ["technicianBlockedTime", "technician_blocked_time", "person-scoped scheduling"],
        ["operatingCompany", "operating_companies", "the company authority itself -- companies are not owned by companies"],
      ] as const
    ).map(([family, collection, note]) => ({
      family, collection, ownerClass: "EXCLUDED" as const, ownerType: null,
      ownerFields: [] as readonly string[], inheritanceSource: null,
      transfer: "N_A" as const, companyScope: "COMPANY_NEUTRAL" as const,
      backfillSource: null, unresolvedPolicy: NOT_OWNABLE, note,
    })),
  ].map((row) => Object.freeze(row)) as OwnershipFamily[],
);

const BY_FAMILY = new Map(OWNERSHIP_MATRIX.map((f) => [f.family, f] as const));

export function ownershipFamily(family: unknown): OwnershipFamily | null {
  return typeof family === "string" ? (BY_FAMILY.get(family) ?? null) : null;
}

/**
 * The families the owner-required invariant actually applies to (ruling D-8: every OWNABLE record).
 * REFERENCE and EXCLUDED families are not counted, not censused, and not backfilled.
 */
export function ownableFamilies(): readonly OwnershipFamily[] {
  return OWNERSHIP_MATRIX.filter(
    (f) => f.ownerClass === "PERSON" || f.ownerClass === "COMPANY" || f.ownerClass === "PARTICIPATING_COMPANIES",
  );
}

/** Families whose ownership shape is two named participants rather than one owner. */
export function participatingCompanyFamilies(): readonly OwnershipFamily[] {
  return OWNERSHIP_MATRIX.filter((f) => f.ownerClass === "PARTICIPATING_COMPANIES");
}

/** Families whose ownership may legitimately be transferred. The rest are historical or not owned. */
export function transferableFamilies(): readonly OwnershipFamily[] {
  return OWNERSHIP_MATRIX.filter((f) => f.transfer === "HANDOFF");
}

/**
 * Families where a single owning company may be the WRONG SHAPE (ruling D-10). Named as a function
 * rather than left implicit, because a backfill plan must treat these differently from a family
 * that merely lacks a source: one is waiting for data, the other is waiting for a model decision.
 */
export function crossCompanyFamilies(): readonly OwnershipFamily[] {
  return OWNERSHIP_MATRIX.filter((f) => f.companyScope === "CROSS_COMPANY_CAPABLE");
}

/** Ownable families with no deterministic backfill source. These need business input, not code. */
export function familiesWithoutBackfillSource(): readonly OwnershipFamily[] {
  return ownableFamilies().filter((f) => f.backfillSource === null);
}
