import {
  ADMIN_EDIT_SCOPE,
  MIGRATION_READINESS,
  MUTABILITY,
  REPRESENTATION_DISPOSITION,
  cite,
  makeAdminEditing,
  makeCommandDescriptor,
  makeFieldPolicy,
  makeIdentityRule,
  makeMigrationStatus,
  makeObjectAdministrationProfile,
  makeOwnershipRule,
  makeReadModel,
  makeRepresentation,
} from "../objectAdministrationProfile.js";

// PART — the reference Object Administration Profile.
//
// This is the first one, and it is meant to be READ by the next nine objects rather than admired.
// Everything below is measured from this branch and cited; nothing is aspirational, and where the
// honest answer is "no capability exists" or "nothing enforces this", that is what it says.
//
// ════════════════════ WHY PART GOES FIRST ════════════════════
//
// It is the only object in the program where the whole chain is already intact and can therefore be
// DESCRIBED rather than proposed: a canonical id that is also the storage key and is refused at
// read if they disagree; one write path; three governed commands with capabilities, audit actions,
// version checks and idempotency; a stated immutability rule with a pure enforcement function; a
// classified ownership answer; a named migration analyzer. Starting anywhere else would have meant
// inventing half the vocabulary to describe gaps.
//
// ════════════════════ THE THREE THINGS A LATER OBJECT SHOULD COPY ════════════════════
//
//   1. CITE, DO NOT RESTATE. Every behavioural claim here carries a `cite(path, symbol)` that the
//      test resolves against the real file. If your object's rule is enforced nowhere, the profile
//      must say the rule does not exist yet — not assert it and hope.
//   2. MUTABILITY IS THE SPINE. Field policies and command `mutates` lists are cross-checked. Get
//      them from the command's own allowlist, not from the entity's field list.
//   3. ADMIN EDITING IS THE SMALLEST TRUE ANSWER. Part is PRESENTATION_ONLY, and the reason is
//      recorded. Widening it is a governed decision with its own evidence, not a default.

export const partAdministrationProfile = makeObjectAdministrationProfile({
  entityId: "part",
  description:
    "The catalog record Part Master owns. Descriptive identity only — stock, cost and supplier terms " +
    "are other authorities and are blocked on the entity rather than approximated here.",

  // ── IDENTITY (P1B R1) ──────────────────────────────────────────────────────────────────────
  //
  // partId IS the `parts` document id. That is not a convention a reader has to trust: the
  // repository REFUSES a record whose stored partId disagrees with its own document id, so a
  // divergent record cannot be read at all rather than being silently read under the wrong id.
  identityRule: makeIdentityRule({
    idField: "partId",
    documentIdIsIdentity: true,
    canonicalValidator: cite("functions/src/partMaster/validation.ts", "parsePartId"),
    enforcedBy: cite("functions/src/partMaster/partMasterRepository.ts", "MalformedStoredRecordError"),
    // Each of these has been offered as "the part id" somewhere in this codebase's history, which
    // is precisely why the list is written down rather than assumed obvious.
    neverSubstituted: [
      "a part_aliases alias value (an alias is how a part is FOUND, never what it IS)",
      "a supplier SKU or supplier catalog item id",
      "a manufacturer part number (primaryManufacturerPartNumber)",
      "the internalPartNumber, which is mutable and therefore not identity",
      "the part name or any display text",
      "a hardcoded src/data/partsCatalog.ts SKU",
      "a spreadsheet column from a migration source file",
    ],
    // The ONLY deterministic id derivation in the program, and it exists so a re-import lands on
    // the same document and is refused by createPart's own already-exists check rather than by a
    // second uniqueness authority. It is a DERIVATION for new records, not a canonicalizer: it
    // never rewrites an existing id, and the migration boundary refuses a value that would need
    // rewriting (requireCanonicalPartId's NOT_EXACT).
    derivation: cite("functions/src/dataImport/contracts/partImportContract.ts", "derivePartId"),
    description:
      "Canonical identity is Part.partId, which IS the Firestore `parts` document id. The migration " +
      "boundary gate is requireCanonicalPartId (functions/src/eosOps/migration/partIdContract.ts); it " +
      "returns the value unchanged or throws, never a different string, and consults no alias table.",
  }),

  // ── OWNERSHIP AND OPERATING COMPANY ────────────────────────────────────────────────────────
  //
  // Part is REFERENCE / COMPANY_NEUTRAL, and that is a CLASSIFICATION, not a missing owner. Taylor
  // and Ventana legitimately use the same part number; assigning one of them would be fabricating
  // a fact to satisfy a field. The entity already blocks `businessLine` for the same reason.
  ownership: makeOwnershipRule({
    ownerClass: "REFERENCE",
    companyScope: "COMPANY_NEUTRAL",
    companyField: null,
    authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERSHIP_MATRIX"),
    prohibitedInference: [
      "the manufacturer (a shared manufacturer says nothing about which company owns the part)",
      "description or category text",
      "which warehouse currently holds stock of it (that is a stock location's company, not the part's)",
      "the creating actor's own company",
    ],
    description:
      "NOT ownerless-in-error: excluded from the owner-required invariant by classification (ruling " +
      "D-8/D-11). Adding an operating company to Part requires proving the two companies cannot share " +
      "a catalog record, which the census found they can.",
  }),

  // ── READ MODEL ─────────────────────────────────────────────────────────────────────────────
  readModel: makeReadModel({
    path: "CLIENT_DIRECT",
    collection: "parts",
    // Measured, and it is the uncomfortable answer: reads are gated by ROLE in Rules, not by a
    // capability id. `inventory.catalog.manage` / `inventory.catalog.activate` gate the WRITES.
    // There is no `part.read` in the catalog, so the entity declares readCapability: null and this
    // profile says the same thing rather than inventing one to make the row look complete.
    gate: "firestore.rules: isAdminOrDispatcher() OR isActiveOperationalRole(PARTS_MANAGER) OR isActiveOperationalRole(WAREHOUSE_MANAGER)",
    gateIsCapability: false,
    authority: cite("functions/src/partMaster/partMasterRepository.ts", "PARTS_COLLECTION"),
    description:
      "Client-direct reads of `parts`; all client writes are denied by Rules (create/update/delete: " +
      "if false), so every write arrives through the trusted commands below. Balance figures " +
      "(warehouseAvailable / onOrder) come from a SINGLE-PART callable and are deliberately not list columns.",
  }),

  // ── FIELD POLICIES ─────────────────────────────────────────────────────────────────────────
  //
  // Taken from the command's own UPDATABLE_FIELDS allowlist and the stored-record shape — never
  // from the entity's field list, which describes what can be DISPLAYED and is a different question.
  fieldPolicies: [
    makeFieldPolicy({
      fieldId: "partId",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      // Structural, not merely policed: updatePart takes partId from the stored record and the
      // allowlist has no key for it, so there is no shape in which a caller can change it.
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "UPDATABLE_FIELDS"),
      reason: "The document id. Changing it would be creating a different record, not editing this one.",
    }),
    makeFieldPolicy({
      fieldId: "internalPartNumber",
      mutability: MUTABILITY.MUTABLE,
      requiredAtCreate: true,
      // MUTABLE AND LOAD-BEARING. Changing the IPN is the one update with a side effect on identity
      // data: the PREVIOUS value is preserved as an INTERNAL_PN alias in the same transaction, so a
      // historical lookup of the old number still resolves. An administration surface that offered
      // this as an ordinary text edit would be offering an identity migration.
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "preserveInternalPartNumberAlias"),
      reason:
        "Mutable, but an IPN change stages an INTERNAL_PN alias preserving the prior value, and refuses " +
        "if either the old or the new alias identity is owned by another part.",
    }),
    makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE, requiredAtCreate: true }),
    makeFieldPolicy({ fieldId: "description", mutability: MUTABILITY.MUTABLE }),
    makeFieldPolicy({ fieldId: "category", mutability: MUTABILITY.MUTABLE }),
    makeFieldPolicy({
      fieldId: "status",
      mutability: MUTABILITY.MUTABLE,
      requiredAtCreate: true,
      // Not editable by updatePart at all: status is absent from UPDATABLE_FIELDS and moves only
      // through changePartStatus, which requires a DIFFERENT capability and a legal transition.
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "PART_STATUS_TRANSITIONS"),
      reason: "Lifecycle, not a field edit. DRAFT→ACTIVE→(INACTIVE|DISCONTINUED|SUPERSEDED); the last two are terminal.",
    }),
    makeFieldPolicy({ fieldId: "stockingClass", mutability: MUTABILITY.MUTABLE, requiredAtCreate: true }),
    makeFieldPolicy({ fieldId: "stockingUnit", mutability: MUTABILITY.MUTABLE, requiredAtCreate: true }),
    makeFieldPolicy({
      fieldId: "controlType",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "assertControlTypeImmutable"),
      // P1B R2. Note the shape of the enforcement, because it is easy to get wrong when copying:
      // `controlType` REMAINS in updatePart's allowlist on purpose, so a full-object resend of the
      // stored value stays idempotent. Immutability is a VALUE comparison on the merged record, not
      // a missing key — which is exactly why this profile does NOT list controlType under
      // updatePart's `mutates`: the command accepts the key and can never change the value.
      reason:
        "P1B R2. Movement tracking_mode is historical evidence; controlType is future policy, and " +
        "re-reading history through today's policy silently reinterprets movements recorded under a " +
        "different one. A conditional 'allow while no history exists' was refused: it needs a ledger " +
        "query mid-cutover, where 'no history in Firestore' does not mean 'no history'.",
    }),
    makeFieldPolicy({ fieldId: "primaryManufacturerId", mutability: MUTABILITY.MUTABLE }),
    makeFieldPolicy({ fieldId: "primaryManufacturerPartNumber", mutability: MUTABILITY.MUTABLE }),
    makeFieldPolicy({ fieldId: "oemStatus", mutability: MUTABILITY.MUTABLE }),
    makeFieldPolicy({
      fieldId: "wholeUnit",
      mutability: MUTABILITY.MUTABLE,
      enforcedBy: cite("functions/src/partMaster/validation.ts", "validatePart"),
      reason:
        "The EXPLICIT whole-unit classification, never inferred from equipmentModelId. A whole unit must " +
        "be SERIALIZED (or SERIALIZED_LOT) and a SERVICE part is never one — enforced at the command layer.",
    }),
    makeFieldPolicy({
      fieldId: "equipmentModelId",
      mutability: MUTABILITY.MUTABLE,
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "assertEquipmentModelExists"),
      reason:
        "Legal ONLY when wholeUnit is true, and checked to EXIST against equipment_models on every write. " +
        "Neither rule is in Rules or in the entity metadata.",
    }),

    // ── NOT STORED ON THIS OBJECT ────────────────────────────────────────────────────────────
    //
    // Declared on the entity so their meaning and refusal are recorded; an administration surface
    // must not offer them as editable, because there is nothing here to edit.
    makeFieldPolicy({
      fieldId: "warehouseAvailable",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "the inventory ledger, read per part via the getPartBalance callable",
      reason: "Warehouse-only by design; EXCLUDES truck stock. Unknown is not zero.",
    }),
    makeFieldPolicy({
      fieldId: "onOrder",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "the getPartBalance callable's outstanding-inbound projection",
    }),
    makeFieldPolicy({
      fieldId: "reorderPoint",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "inventoryAnalyticsService.calculateReorderPoint, computed at read",
    }),
    makeFieldPolicy({
      fieldId: "unitCost",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "no authority — the canonical Part carries no cost of any kind (PART_INVENTORY_VALUATION_AUTHORITY_GAP)",
    }),
    makeFieldPolicy({
      fieldId: "sellPrice",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "no authority — no sell or list price exists on the Part",
    }),
    makeFieldPolicy({
      fieldId: "businessLine",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "no authority — Part is company-neutral by classification (see ownership above)",
    }),
    makeFieldPolicy({
      fieldId: "mobileQuantity",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "no projected mobile/truck figure exists; onHand is warehouse-only",
    }),
    makeFieldPolicy({
      fieldId: "preferredSupplierId",
      mutability: MUTABILITY.NOT_STORED,
      heldBy: "part_supplier_items — Part↔Supplier is many-to-many (PART_SUPPLIER_IS_MANY_TO_MANY)",
    }),

    // ── SERVER-STAMPED PROVENANCE ────────────────────────────────────────────────────────────
    //
    // Part is the object where this invariant actually HOLDS end to end: readMeta refuses a stored
    // record missing or malforming any of the five, so they are declared rather than described as
    // a gap. No command accepts them from a caller.
    makeFieldPolicy({
      fieldId: "version",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "VersionConflictError"),
      reason: "Optimistic concurrency. Every post-creation command takes expectedVersion and refuses a stale one.",
    }),
    makeFieldPolicy({ fieldId: "createdAt", mutability: MUTABILITY.SYSTEM_MANAGED }),
    makeFieldPolicy({ fieldId: "createdBy", mutability: MUTABILITY.SYSTEM_MANAGED }),
    makeFieldPolicy({ fieldId: "updatedAt", mutability: MUTABILITY.SYSTEM_MANAGED }),
    makeFieldPolicy({ fieldId: "updatedBy", mutability: MUTABILITY.SYSTEM_MANAGED }),
  ],

  // ── GOVERNED COMMANDS ──────────────────────────────────────────────────────────────────────
  //
  // Three, and only three. Each: server-derived actor → capability check (a denial is itself
  // audited) → domain validation → ONE transaction covering read, version check, idempotency check,
  // mutation and an atomically staged audit event. Idempotency is the house mechanism: the audit
  // document id is deterministic, so a replay is detected by its existence and a MATCHING
  // fingerprint rather than by a second write.
  commands: [
    makeCommandDescriptor({
      id: "createPart",
      label: "Create part",
      phase: "CREATE",
      transport: "CALLABLE",
      entryPoint: cite("functions/src/partMaster/partMasterCallables.ts", "createPartCallable"),
      implementation: cite("functions/src/partMaster/partMasterCommands.ts", "createPart"),
      capability: "inventory.catalog.manage",
      auditAction: "createPart",
      // No expectedVersion: there is no stored record to conflict with. The duplicate guard is the
      // already-exists check on the derived document id.
      versionChecked: false,
      idempotent: true,
      mutates: [
        "partId",
        "internalPartNumber",
        "name",
        "description",
        "category",
        "status",
        "stockingClass",
        "stockingUnit",
        "controlType",
        "primaryManufacturerId",
        "primaryManufacturerPartNumber",
        "oemStatus",
        "wholeUnit",
        "equipmentModelId",
      ],
      description:
        "The ONLY point at which partId and controlType are chosen. `flags` {expiryTracked, consumable, " +
        "returnableCore} is also written here; it is an embedded object with no v1 FIELD_TYPE, so the entity " +
        "does not declare it and it cannot be listed above — recorded here rather than silently omitted.",
    }),
    makeCommandDescriptor({
      id: "updatePart",
      label: "Update part details",
      phase: "UPDATE",
      transport: "CALLABLE",
      entryPoint: cite("functions/src/partMaster/partMasterCallables.ts", "updatePartCallable"),
      implementation: cite("functions/src/partMaster/partMasterCommands.ts", "updatePart"),
      capability: "inventory.catalog.manage",
      auditAction: "updatePart",
      versionChecked: true,
      idempotent: true,
      // NOTE what is absent: `partId` (structurally impossible), `status` (changePartStatus owns it),
      // `controlType` (in the allowlist for idempotent resend, but a real change is refused), and the
      // five provenance fields. That absence is the profile's actual content.
      mutates: [
        "internalPartNumber",
        "name",
        "description",
        "category",
        "stockingUnit",
        "stockingClass",
        "primaryManufacturerId",
        "primaryManufacturerPartNumber",
        "oemStatus",
        "wholeUnit",
        "equipmentModelId",
      ],
      description:
        "Rejects any key outside its allowlist before authorization. An internalPartNumber change also " +
        "stages an INTERNAL_PN alias preserving the prior value, with its own audit event.",
    }),
    makeCommandDescriptor({
      id: "changePartStatus",
      label: "Change part status",
      phase: "LIFECYCLE",
      transport: "CALLABLE",
      entryPoint: cite("functions/src/partMaster/partMasterCallables.ts", "changePartStatusCallable"),
      implementation: cite("functions/src/partMaster/partMasterCommands.ts", "changePartStatus"),
      // A DIFFERENT capability from the detail edits, deliberately: activating or discontinuing a
      // catalog line is not the same authority as correcting its description.
      capability: "inventory.catalog.activate",
      auditAction: "changePartStatus",
      versionChecked: true,
      idempotent: true,
      mutates: ["status"],
      description:
        "Legal transitions only (PART_STATUS_TRANSITIONS). DISCONTINUED and SUPERSEDED are terminal — " +
        "nothing in this platform hard-deletes a Part, which is why no Delete verb is governed.",
    }),
  ],

  // ── REPRESENTATIONS ────────────────────────────────────────────────────────────────────────
  //
  // The honest census. Prefer retirement over compatibility layers — so each row states what stands
  // in the way of deleting it, and none of them is described as "the catalog" without qualification.
  representations: [
    makeRepresentation({
      id: "partsCollection",
      label: "parts (Firestore)",
      disposition: REPRESENTATION_DISPOSITION.AUTHORITY,
      location: cite("functions/src/partMaster/partMasterRepository.ts", "PARTS_COLLECTION"),
      description: "The Part Master record. Descriptive identity; one write path; document id IS the identity.",
    }),
    makeRepresentation({
      id: "staticPartsCatalog",
      label: "src/data/partsCatalog.ts (200 hardcoded SKUs)",
      disposition: REPRESENTATION_DISPOSITION.RETIRE,
      location: cite("field-ops-app-vite/src/data/partsCatalog.ts", "PARTS_CATALOG"),
      readBy: [
        "src/modules/inventory/PartsList.jsx",
        "src/modules/inventory/PartDetail.jsx",
        "src/modules/inventoryRole/WarehouseManagerHome.jsx",
        "src/hooks/useCanonicalPartNames.js",
        "src/domain/inventoryAnalyticsEngine.ts",
        // src/analytics/operationsIntelligenceService.ts WAS a reader and was deleted by W1-C21.
        // Removed here rather than left standing: a census of "who reads this" that names a file
        // which no longer exists overstates the retirement blocker it is used to justify.
      ],
      blockedBy:
        "It is the ONLY warehouseQty baseline the availability math has, and its SKUs are not canonical " +
        "partIds — some have no canonical record at all. Deleting it before the ledger is authoritative " +
        "would remove numbers the screens still show, so retirement follows the ledger cutover, not this lane.",
      description:
        "Metadata with NO stock authority and no identity authority. requireCanonicalPartId deliberately " +
        "has no catalog fallback branch: a legacy SKU is never accepted as a part id.",
    }),
    makeRepresentation({
      id: "partReferenceCompatibility",
      label: "PART_MASTER_REFERENCE resolver",
      disposition: REPRESENTATION_DISPOSITION.COMPATIBILITY_SHIM,
      location: cite("functions/src/partMaster/partReferenceCompatibility.ts", "comparePartReferenceParity"),
      blockedBy:
        "Deliberate and flag-guarded: defaults OFF and nothing in the repository sets the flag. It ends when " +
        "canonical Part records are the descriptive source everywhere; enabling it anywhere is a separate " +
        "governed gate (cutover criterion C16 requires it verified OFF).",
      description:
        "Read-only resolver whose outputs are byte-identical with the flag ON or OFF — both paths take " +
        "warehouseQty from the static catalog, and descriptive divergence is surfaced explicitly, never silently.",
    }),
    makeRepresentation({
      id: "partAliases",
      label: "part_aliases",
      disposition: REPRESENTATION_DISPOSITION.DERIVED,
      location: cite("functions/src/partMaster/partAliasRepository.ts", "buildFirestorePartAliasRepository"),
      description:
        "Load-bearing identity DATA, not a duplicate Part: ten alias types resolving to one partId, written " +
        "only by trusted commands, and extended automatically when an internalPartNumber changes. An alias " +
        "is how a part is found; it is never what the part IS.",
    }),
  ],

  // ── MIGRATION / READINESS ──────────────────────────────────────────────────────────────────
  migration: makeMigrationStatus({
    readiness: MIGRATION_READINESS.BLOCKED,
    targetAuthority:
      "PostgreSQL. eos_ops already holds the part-REFERENCING ledger (inventory_movements.part_id, " +
      "serialized_custody.part_id, cycle_count_lines.part_id); the Part record itself has no Postgres table yet.",
    source: cite("functions/src/partMaster/csvMigrationAnalysis.ts", "analyzeCsv"),
    evaluator: cite("functions/src/partMaster/cutoverReadiness.ts", "evaluateCutoverReadiness"),
    // Quoted verbatim from the evaluator's own decision list so a reader can look each one up.
    // BLOCKED is the measured verdict, not a judgement made here: seven Owner decisions are open
    // and eight approvals are unrecorded, and the evaluator is BLOCKED unless every criterion passes.
    blockedBy: [
      "D-M1 … D-M7 — seven unresolved Owner cutover decisions (criterion C20)",
      "C10/C11 — no recorded Owner approval of the CREATE or UPDATE populations",
      "C12/C13/C14/C15 — rollback point, reconciliation method, production operator and window unrecorded",
      "C16 — PART_MASTER_REFERENCE must be verified OFF before any cutover authorization",
      "no `parts` table exists in functions/migrations/ — the target authority is named, not yet built",
    ],
    reconciliation: null,
    description:
      "ANALYSIS ONLY. The evaluator can say ready or blocked and can never act; cutover execution is " +
      "unauthorized and governed by its own Owner gates. Nothing in this lane changes that.",
  }),

  // ── WHAT ADMINISTRATION MAY EDIT ───────────────────────────────────────────────────────────
  //
  // PRESENTATION_ONLY, and the reason matters more than the value: the Administration Objects
  // surface already has a governed write for an object's label/plural/description
  // (updateObjectMetadata, against the tenant's policy store), and that changes how the object is
  // PRESENTED, never a Part record. There is no governed path from an Administration screen to
  // createPart/updatePart/changePartStatus, and inventing one here would be building a second write
  // path to an object that deliberately has one.
  adminEditing: makeAdminEditing({
    scope: ADMIN_EDIT_SCOPE.PRESENTATION_ONLY,
    reason:
      "Administration governs the OBJECT (its label, description, field policy), not its RECORDS. Part " +
      "records are created and edited in Inventory through the three governed commands above, which require " +
      "inventory.catalog.manage / inventory.catalog.activate — capabilities an administrator does not hold " +
      "by virtue of being an administrator. Widening this to GOVERNED_COMMAND is a separate decision that " +
      "would need its own capability answer, not a default.",
  }),
});
