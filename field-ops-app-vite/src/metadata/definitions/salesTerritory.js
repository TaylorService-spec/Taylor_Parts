import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// SalesTerritory — A-ENTITY-TERRITORY-MOBILE-DEFINITIONS. Describes the `sales_territories`
// collection (Commercial Coverage & Territory, capability #15 persistence — Business Capability
// Register): functions/src/coverage/coverageCommands.ts's TerritoryRecord, written only through
// the trusted createSalesTerritory callable (functions/src/coverage/coverageCallables.ts). Records
// only — NO precedence, credit, commission, or a resolved "owner"; the roadmap register (project_
// commercial_coverage_territory) is explicit this program is territory-independent-of-salesperson
// and that coverage is resolved via coverageAssignments[], never a single winner.
//
// THIS FILE DESCRIBES ONLY WHAT IS STORED TODAY, PER THIS LANE'S BRIEF. Channel, effective-dating
// and coverage-assignment cardinality are all recorded as FUTURE roadmap requirements, not
// implemented shape — nothing about them is modeled here. A SalesTerritory is a durable, standalone
// coverage object (STATE / STATE_GROUP / ZIP_GROUP / GEOSPATIAL); it has no channel, no
// effective-dating and no assignee of its own — those all live on the separate
// commercial_coverage_assignments collection, out of this lane's writeScope and unregistered here.
//
// READ VIA IS HONESTLY UNKNOWN — THE ONE CALLABLE THAT TOUCHES THIS COLLECTION NEVER RETURNS A
// TERRITORY RECORD TO A CLIENT. firestore.rules denies this collection outright: "match
// /sales_territories/{territoryId} { allow read, write: if false; }" (adjacent comment:
// "Admin-SDK-only, same fail-closed posture... the only write path is the trusted coverage
// commands... Deployment is a separate operator gate; merging these blocks changes nothing.").
// The ONE read callable that queries this collection, resolveCoverageForContext
// (functions/src/coverage/coverageReadCallables.ts), fetches the full sales_territories snapshot
// server-side ONLY to resolve TERRITORY-scoped coverage assignments against a caller's location
// (via the pure resolveCommercialCoverage / territoryCoversLocation functions,
// coverageResolution.ts) — its own projectAssignment() response shape is { assignmentId, assignee,
// scope, responsibility, priority, effectiveFrom, effectiveTo }, which carries NO territory field
// (no name, kind, geo or status) at all. A caller can learn that a territory-scoped assignment
// matched; a caller can never read the territory's own name, kind or geo through this or any other
// path. This is the identical shape payment.js already records for its own collection — a
// genuinely UNREACHABLE read, not merely an inactive capability — so readVia is UNKNOWN,
// readCallable and readCapability are both null, and (matching payment.js) NO list view is
// declared in this file: an INDEX or RELATED list over a collection nothing can read would promise
// a surface this program cannot serve.
//
// NO CAPABILITY NAMES THIS COLLECTION'S OWN READ, BECAUSE NONE EXISTS. `coverage.read`
// (functions/src/coverage/coverageReadCallables.ts's COVERAGE_READ_CAPABILITY, registered
// active:false in permissionCatalog.ts) gates resolveCoverageForContext — the coverage-assignment
// resolver described above, not a territory read. `coverage.write` (COVERAGE_WRITE_CAPABILITY,
// also registered active:false) gates createSalesTerritory itself, a WRITE capability, which
// EntityDefinition's readCapability has no field for and would misdescribe if declared there.
// Neither capability is a read gate on the territory record itself, so readCapability stays null
// rather than borrowing either.
//
// IDENTITY IS A nameField ONLY — `name`, A REAL, REQUIRED, OPERATOR-SUPPLIED STRING.
// buildTerritory (coverageCommands.ts) throws CoverageCommandError("REQUIRED", ...) on an empty or
// missing name and trims it before storage — a genuine human-typed label, not a mirrored or
// inferred one. There is no server-allocated territory number or code anywhere in TerritoryInput /
// TerritoryRecord or the createSalesTerritory callable — nothing is promoted to referenceField
// that the data does not carry (DECISIONS #106).
//
// `kind` IS A REAL, CLOSED ENUM — STATE / STATE_GROUP / ZIP_GROUP / GEOSPATIAL, sourced from
// TERRITORY_KINDS (coverageCommands.ts) — never re-declared as a second literal copy here.
//
// `geo` IS DELIBERATELY UNDECLARED — A DISCRIMINATED-UNION SHAPE THE v1 FIELD VOCABULARY CANNOT
// EXPRESS. buildTerritory's own switch on `kind` proves geo's shape VARIES by kind: { states:
// string[] } for STATE/STATE_GROUP, { zips?: string[], zipPrefixes?: string[] } for ZIP_GROUP, and
// { polygonRef: string } for GEOSPATIAL. FIELD_TYPE v1 has no composite/struct type and no union
// type — the identical gap location.js's own header names for its four flat address fields (there,
// at least, a FIXED struct; here, a variant one with no fixed field set at all) and part.js/
// salesOrder.js name for `flags`/`lines`. Declaring geo as one STRING or TEXT field would silently
// flatten a real, kind-dependent structure into an opaque blob no filter or column could honestly
// describe; left undeclared instead, exactly the restraint those three files already apply to
// their own struct/union gaps.
//
// `status` IS A REAL, GOVERNED TWO-VALUE ENUM — ACTIVE (the default) / INACTIVE. buildTerritory:
// `const status = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";` — every stored record
// carries exactly one of these two values, never a third or an absence. Not filterable: with no
// read path of any kind (see above), declaring an operator on this field would promise a query
// nothing can ever serve.
//
// PROVENANCE: createdAt/createdBy EXIST; THERE IS NO updatedAt/updatedBy — A STRUCTURAL FACT, NOT
// A GAP. createSalesTerritory's own tx.set is the ONLY write this collection's one write path
// (functions/src/coverage/coverageCallables.ts) ever issues to a sales_territories document — no
// update/delete callable exists anywhere in coverage/. That is the same append-only shape
// payment.js and purchaseOrder.js already record for their own never-updated records. `createdBy`
// is the actor uid (`createdBy: actorUid` in the same tx.set); `createdAt` is
// `FieldValue.serverTimestamp()` — a real server Timestamp, NOT the separate `createdAtMillis`
// number TerritoryRecord also carries (see the next paragraph).
//
// `createdAtMillis` IS A SECOND, DISTINCT, ALSO-REAL PROVENANCE FIELD — NOT A DUPLICATE OF
// `createdAt`. buildTerritory stamps `createdAtMillis: deps.nowMillis` (a caller-clock-derived ms
// epoch, computed in the PURE command core before the transaction runs) into the record BEFORE the
// callable spreads it into the document (`{ ...record, createdBy: actorUid, createdAt:
// FieldValue.serverTimestamp() }`) — so a stored territory carries BOTH createdAtMillis (a plain
// number, set once, from the pure builder) AND createdAt (a server Timestamp, set at commit). The
// two are typically near-identical in wall-clock time but are genuinely two different fields
// written by two different layers, the same "declare both, note the redundancy honestly" choice
// payment.js's own header makes for its receivedAt/receivedAtMillis/createdAt trio.
export const salesTerritoryEntity = makeEntityDefinition({
  id: "salesTerritory",
  label: "Sales Territory",
  labelPlural: "Sales Territories",
  // Matches functions/src/constants/collections.ts's own SALES_TERRITORIES_COLLECTION =
  // "sales_territories". No client-side collection-name constant exists for this collection —
  // the client never reads it directly (see the file header).
  collection: "sales_territories",
  readVia: "UNKNOWN",
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description:
    "A durable coverage object independent of any salesperson (Commercial Coverage & Territory, capability " +
    "#15) — STATE/STATE_GROUP/ZIP_GROUP/GEOSPATIAL. Deny-all in Rules; no read path of any kind reaches a " +
    "client today. See the file header before extending this.",
  fields: [
    makeFieldDefinition({
      id: "name",
      entityId: "salesTerritory",
      label: "Name",
      type: "STRING",
      description:
        "Required, non-empty, trimmed at write (buildTerritory). The nameField half of identity — no server-" +
        "allocated territory number or code exists anywhere in this write path.",
    }),
    makeFieldDefinition({
      id: "kind",
      entityId: "salesTerritory",
      label: "Kind",
      type: "ENUM",
      enumValues: ["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"],
      enumLabels: {
        STATE: "State",
        STATE_GROUP: "State Group",
        ZIP_GROUP: "ZIP Group",
        GEOSPATIAL: "Geospatial",
      },
      description:
        "The territory's coverage-geography shape, sourced from TERRITORY_KINDS (coverageCommands.ts). " +
        "Determines which geo shape the (undeclared) `geo` map carries — see the file header. Not filterable: " +
        "no read path of any kind reaches a client (see the file header).",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "salesTerritory",
      label: "Status",
      type: "ENUM",
      enumValues: ["ACTIVE", "INACTIVE"],
      enumLabels: { ACTIVE: "Active", INACTIVE: "Inactive" },
      description:
        "Defaults to ACTIVE when omitted at create (buildTerritory). Not filterable: no read path of any kind " +
        "reaches a client (see the file header).",
    }),
    makeFieldDefinition({
      id: "createdAtMillis",
      entityId: "salesTerritory",
      label: "Created (builder)",
      type: "NUMBER",
      description:
        "Ms epoch, stamped by the pure command builder (buildTerritory) before the transaction commits. A " +
        "SECOND, distinct provenance field from `createdAt` below — see the file header for why both are " +
        "declared despite the near-duplication.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "salesTerritory",
      label: "Created",
      type: "TIMESTAMP",
      description:
        "FieldValue.serverTimestamp(), set once at commit inside the createSalesTerritory transaction. A real " +
        "Firestore server Timestamp, never epoch milliseconds.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "salesTerritory",
      label: "Created By",
      type: "STRING",
      description: "The creating actor's uid, set in the same write as createdAt. No updatedAt/updatedBy exists — see the file header for why (append-only; no update callable exists).",
    }),
  ],
  // No relationships declared. commercial_coverage_assignments references territories by
  // territoryId (scope.territoryId, coverageCommands.ts) but that collection has no registered
  // EntityDefinition in this program (out of this lane's writeScope) — the same restraint
  // warehouse.js applies to its own undeclared stock_locations/transfer_orders/mobile_locations
  // edges before those existed.
});

// No list view is declared — see the file header: readVia is UNKNOWN because no read path of any
// kind reaches a client for this collection, and a definition is not a surface a runtime could
// ever actually serve. The same restraint payment.js already applies for the identical reason.
