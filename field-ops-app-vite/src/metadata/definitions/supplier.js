import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { SUPPLIER_STATUSES, SUPPLIER_STATUS_META } from "../../domain/suppliersView.js";

// Supplier — S-INV-WAREHOUSE-SUPPLIER-DEFINITIONS. Describes the `suppliers` collection under the
// Supplier Master governance (docs/architecture/supplier-master-architecture.md, DECISIONS #78,
// functions/src/supplierMaster/*), read by the Operations Suppliers workspace through
// domain/suppliersView.js (buildSuppliersView) over services/operationsQueries.ts's
// fetchSuppliersPage — a BOUNDED, name-ordered read added by an earlier §9 remediation, not the
// unbounded fetchSuppliers the Operations dashboard's ProcurementPanel still depends on.
//
// ONE GOVERNED WRITE PATH, UNLIKE WAREHOUSE. functions/src/supplierMaster/supplierMasterCommands.ts's
// createSupplier/updateSupplier/activateSupplier/deactivateSupplier is the sole writer of the
// governed GovernedSupplier shape (supplierMasterTypes.ts), and — unlike warehouseStatusWriter.ts —
// its onCall adapters (supplierMasterCallables.ts) ARE exported from functions/src/index.ts. The
// export's own comment is careful about what that does and does not mean: "Export is not
// deployment/grant" — NOT deployed to the live project, no UI wired to call it, and (per
// docs/releases/supplier-master-rc-1.md) activate/deactivate fail closed today because no standing
// role carries inventory.catalog.activate. This definition describes the CONTRACT the command
// service produces — the same posture part.js takes toward partMasterCommands.ts — not a claim
// about production deployment state.
//
// TWO KINDS OF DOCUMENT SHARE THIS COLLECTION, AND BOTH ARE DESCRIBED HONESTLY. A governed
// createSupplier() record carries the full pack below (normalizedKey/status/version/createdAt/
// createdBy/updatedAt/updatedBy, all always present together). A legacy Epic-5 demo supplier
// predates Supplier Master entirely and carries NONE of them — domain/suppliersView.js's own header
// names this explicitly ("this collection may still hold legacy Epic-5 demo supplier docs that
// predate the Supplier Master governance (no `status`)") and labels that state "Ungoverned" (amber),
// a DELIBERATE divergence from warehousesView's muted "Unknown" — Supplier Master is mid-adoption,
// so a status-less doc must be noticed. Every governed-pack field below is therefore declared as
// optional, with "legacy/ungoverned, absent" recorded as the real missing state rather than a
// fabricated status value — the same treatment warehouse.js applies to its own single `status`
// field, extended here to the whole pack because here the whole pack rises and falls together.
//
// LEGACY-ONLY FIELDS ARE NOT DECLARED. services/operationsQueries.ts's RawSupplier retains
// `contactEmail`/`leadTimeDays` "for the Operations ProcurementPanel consumer" — Epic-5 fields with
// no equivalent in GovernedSupplier (which has `email`, not `contactEmail`, and no lead-time concept
// at all). Declaring them would assert a second, competing shape for the same collection; they are
// named here as a known gap instead, the same restraint applied to Part's deliberately-absent ledger
// fields.
//
// NO CAPABILITY GATES THIS COLLECTION. firestore.rules' `suppliers/{supplierId}` admits
// isAdminOrDispatcher() only, unconditional read/deny-write — a role check, never a capability id.
// There is no `supplier.read` in the capability catalog. readCapability is therefore null, the same
// finding every role-gated collection in this program already records.
//
// IDENTITY IS A nameField ONLY. `name` (GovernedSupplier's "canonical display name") is what
// suppliersView.js falls back to `.id` for when missing, the exact identity-gap pattern
// entityDefinition.js's own header names as a defect elsewhere. `vendorNumber` is a real, stored,
// optional business field (SUPPLIER_OPTIONAL_STRING_FIELDS) — but it is optional, not enforced
// unique by Rules or by createSupplier()/updateSupplier(), and not server-allocated. Promoting it to
// referenceField would be exactly the optional-field promotion DECISIONS #106 forbids; it stays a
// plain, declared, non-identity field instead — the same restraint equipment.js applies to
// serialNumber/assetTag and purchaseOrder.js's header names for the identical reason.
//
// normalizedKey IS DECLARED, RENDERED BUT NOT FILTERED. A real, stored, deterministic normalization
// of `name` (supplierMasterTypes.ts's own comment: "for dedup DETECTION only, never an auto-merge
// key") — createSupplier() reads it via findActiveByNormalizedKey to flag (never block or merge)
// suspected duplicates. No client surface queries this collection by normalizedKey; declaring a
// filter would promise a query nothing serves, the same restraint employee.js applies to
// securityRole and part.js applies to stockingUnit.
//
// NO RELATIONSHIP IS DECLARED. part_supplier_items (functions/src/partMaster/partSupplierItems.ts)
// references every supplierId it stores (`<partId>__<supplierId>` doc ids), a real outbound edge
// Supplier would own — but no `partSupplierItem` EntityDefinition is registered anywhere in this
// program, so declaring one here would target an entity this registry cannot validate. See
// REGISTRATION_PENDING.
export const supplierEntity = makeEntityDefinition({
  id: "supplier",
  label: "Supplier",
  labelPlural: "Suppliers",
  // No client-side SUPPLIERS_COLLECTION constant exists in domain/constants.js (only a local const
  // inside services/operationsQueries.ts) — the literal here matches that local const and
  // functions/src/constants/collections.ts's own SUPPLIERS_COLLECTION = "suppliers".
  collection: "suppliers",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null rather than
  // invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description:
    "A governed vendor record (Supplier Master, functions/src/supplierMaster) — or, on a document predating that " +
    "governance, a legacy Epic-5 demo supplier. See the file header for how the two are told apart.",
  fields: [
    // The document id, declared rather than left implicit — the same shape part.js's partId takes.
    // Not part of identity (identity is `name`) and not filterable or sortable.
    makeFieldDefinition({
      id: "supplierId",
      entityId: "supplier",
      label: "Supplier ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body as `id` by createSupplier(). Governed ids match SUPPLIER_ID_PATTERN.",
    }),
    makeFieldDefinition({
      id: "name",
      entityId: "supplier",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "The canonical display name. The nameField half of identity; required on a governed record.",
    }),
    // Rendered, not filtered — see the file header.
    makeFieldDefinition({
      id: "normalizedKey",
      entityId: "supplier",
      label: "Normalized Name",
      type: "STRING",
      description:
        "Deterministic normalization of `name`, for dedup DETECTION only (never an auto-merge key). Optional — " +
        "absent on a legacy/ungoverned document. Not filtered — see the file header.",
    }),
    // Optional — see the file header for why the whole governed pack rises and falls together, and
    // why a missing value is a real, undeclared state rather than a fabricated enum member.
    makeFieldDefinition({
      id: "status",
      entityId: "supplier",
      label: "Status",
      type: "ENUM",
      enumValues: [...SUPPLIER_STATUSES],
      enumLabels: Object.fromEntries(SUPPLIER_STATUSES.map((s) => [s, SUPPLIER_STATUS_META[s].label])),
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "Optional; absent on a legacy Epic-5 demo document that predates Supplier Master governance (surfaced as \"Ungoverned\" — see the file header), never a fabricated third enum value.",
    }),
    makeFieldDefinition({
      id: "vendorNumber",
      entityId: "supplier",
      label: "Vendor #",
      type: "STRING",
      sortable: true,
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS). Not enforced unique or server-allocated — see the file header for why this is not referenceField.",
    }),
    makeFieldDefinition({
      id: "contactName",
      entityId: "supplier",
      label: "Contact Name",
      type: "STRING",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS).",
    }),
    makeFieldDefinition({
      id: "phone",
      entityId: "supplier",
      label: "Phone",
      type: "STRING",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS).",
    }),
    makeFieldDefinition({
      id: "email",
      entityId: "supplier",
      label: "Email",
      type: "STRING",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS). The governed field name — distinct from the legacy `contactEmail` RawSupplier also carries; see the file header.",
    }),
    makeFieldDefinition({
      id: "address",
      entityId: "supplier",
      label: "Address",
      type: "STRING",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS). A single free-text field, not the four-scalar struct location.js's address uses — no AddressFields.jsx write path touches this collection.",
    }),
    makeFieldDefinition({
      id: "paymentTermsRef",
      entityId: "supplier",
      label: "Payment Terms",
      type: "STRING",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS). A label/reference, not a terms engine (supplierMasterTypes.ts's own comment).",
    }),
    makeFieldDefinition({
      id: "notes",
      entityId: "supplier",
      label: "Notes",
      type: "TEXT",
      description: "Optional (SUPPLIER_OPTIONAL_STRING_FIELDS).",
    }),
    // Governed version counter — see the file header for why it is optional. Not filterable or
    // sortable: nothing queries or scans by it.
    makeFieldDefinition({
      id: "version",
      entityId: "supplier",
      label: "Version",
      type: "NUMBER",
      description: "Optimistic-concurrency counter, starting at 1. Optional — absent on a legacy/ungoverned document.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "supplier",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate in createSupplier()), not epoch milliseconds. Optional — absent on a legacy/ungoverned document.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "supplier",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Optional — absent on a legacy/ungoverned document.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "supplier",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, not epoch milliseconds. Optional — absent on a legacy/ungoverned document.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "supplier",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Optional — absent on a legacy/ungoverned document.",
    }),
  ],
  // No relationships declared — see the file header and REGISTRATION_PENDING.
});

/**
 * The Supplier registry index. No standalone route renders this yet — a definition is not a
 * surface, the same restraint part.index and employee.index apply — but it is defined now so a
 * future route has a real target.
 *
 * status IS THE ONE DECLARED FILTER, matching SUPPLIER_FILTERS' own active/inactive/ungoverned
 * split (domain/suppliersView.js) — but, as with warehouse.js, that split is applied CLIENT-SIDE
 * today over the bounded page fetchSuppliersPage already returns; no real backend query filters
 * `suppliers` by status. One optional equality filter on a two-value enum is a single net-new
 * composite (status+name+__name__) — well inside the Work Order lesson's restraint
 * (MAX_DECLARED_FILTERS = 4).
 *
 * defaultSort is name ASC, matching fetchSuppliersPage's own orderByField: "name" — the real query
 * shape this surface already runs (see the file header).
 */
export const supplierIndexList = makeListViewDefinition({
  emptyGuidance:
    "Suppliers are the vendors parts are purchased from. Each carries a status showing whether it is active for purchasing. Suppliers are recorded outside this read-only screen.",
  id: "supplier.index",
  entityId: "supplier",
  label: "Suppliers",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "vendorNumber" }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "phone" }),
    makeColumn({ fieldId: "email" }),
  ],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "name", direction: "ASC" })],
    }),
  ],
});
