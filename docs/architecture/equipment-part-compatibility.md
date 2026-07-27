---
artifact_type: architecture-and-implementation-gate
status: Architecture approved by Owner; D1 only authorized; no other implementation or production authority
date: 2026-07-27
baseline: e53c7b0e44565789d4f1322e4b2fa4535c709e5f
workstream: Inventory → Equipment integration
related:
  - docs/architecture/inventory-parts-authority-contract.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-008-part-master.md
  - docs/specifications/equipment-and-installed-asset-management.md
  - docs/implementation-plans/equipment-and-installed-asset-management.md
---

# Governed Part–Equipment compatibility

## 1. Gate and outcome

This document proposes the authority, data, UX, ingest, security, test, and rollout contracts for Equipment-driven Parts discovery. It is a **design gate only**. It changes no runtime code, Rules, Functions, indexes, Firebase resources, or production data.

The approved direction remains:

- `parts` owns canonical Part identity and governed Part metadata.
- A future Equipment Model authority owns model identity.
- Part–Equipment Compatibility owns the many-to-many applicability relationship.
- Inventory → Parts Catalog remains the primary user-facing Parts experience.
- Installed customer assets remain in `equipment`; they are not Equipment Model records.

## 2. Current-state findings

### 2.1 Authorities that exist

- Canonical Parts are top-level `parts`; stable `partId` values join existing Inventory, Work Order snapshots, warehouse, truck, procurement, aliases, and supplier-item records.
- Parts Catalog and Part Detail consume the governed compatibility adapter and fail closed when canonical Part input is denied, unavailable, malformed, or incomplete.
- Installed assets are top-level `equipment` documents with `accountId`, `locationId`, name, status, manufacturer, model, serial number, asset tag, service dates, and notes.
- Work Orders optionally reference an installed asset through `equipmentId`; service history is derived from Work Orders. Parts usage is preserved through `inventorySnapshot[].partId`.
- Part aliases (`part_aliases`) resolve identifier variants to a canonical Part. Supplier mappings (`part_supplier_items`) and procurement records reference `partId`.
- Stock, reorder, truck, warehouse, Work Order, and procurement records consume Part identity. None is compatibility authority.

### 2.2 Authorities that do not exist

- No governed Equipment Model master was found. Current `equipment.manufacturer` and `equipment.model` are free-text installed-asset attributes, not stable model identities.
- No authoritative Part–Equipment compatibility collection, validator, importer, query service, Rules block, permission family, or UI exists.
- No equipment-model alias authority exists.
- No source-backed compatibility evidence authority exists.

### 2.3 Data that resembles compatibility but is not authoritative

- Static Part names contain marketing-like qualifiers such as “Compact”, “Twin Twist”, “Floor Model”, “Single Flavor”, and “3 Ton”. These are descriptive strings, not verified model links.
- Work Order history can show that a Part was used while servicing an installed asset. It is historical usage evidence only and must not auto-create compatibility.
- `equipment.manufacturer`/`model`, Work Order snapshots, procurement purchases, aliases, and supplier records can assist review and reconciliation but cannot become compatibility truth without source-backed verification.
- No repository-backed manuals, authoritative compatibility fixtures, or market listings establish a complete mapping. Reseller or market listings, if later imported, remain evidence candidates only.

### 2.4 Active gates and conflicts

- C2 is deployed and production-verified; sanitized evidence is pending repository merge in draft PR #448. This design does not modify or depend on that PR.
- Parts Catalog integrity repair and Parts Master reconciliation remain open. Compatibility work must preserve all Part IDs and existing consumers and cannot retire the static catalog.
- Truck Inventory implementation remains separately gated and is not started here.
- ADR-006 governs installed assets, not model identity. Extending `equipment` documents into a shared model master would violate that boundary.

## 3. Recommended authoritative model

Use independent top-level authorities:

| Collection | Authority | Write posture |
|---|---|---|
| `equipment_models` | stable manufacturer/model/family/subtype identity | trusted writer only |
| `equipment_model_aliases` | source-specific or historical model aliases | trusted writer only |
| `equipment_part_compatibility` | verified or reviewable Part↔Equipment Model applicability | trusted writer only |
| `equipment_compatibility_sources` | one or more provenance/evidence items per compatibility record | trusted writer only |

Keep installed assets in `equipment`. A later, separately gated reconciliation may add nullable `equipmentModelId` to installed assets after model identity exists and matching is reviewed. Free-text manufacturer/model remains historical input and is never silently overwritten.

### Why top-level compatibility

A top-level relationship collection is the single write authority and supports bounded queries in both directions:

- `where("partId", "==", partId)`
- `where("equipmentModelId", "==", equipmentModelId)`
- compound filters for verification, type, assembly, and normalized applicability

Subcollections under Parts or Equipment would privilege one direction and invite duplicate writes. Arrays embedded in both documents would create competing truth. Derived projections may be added later only when measured query or scale needs justify them; projections must carry `sourceCompatibilityId`, projection version, and reconciliation checks and must never accept direct writes.

## 4. Document contracts

### 4.1 Equipment Model

```ts
type EquipmentModel = {
  equipmentModelId: string;
  manufacturerId: string;
  manufacturerName: string;
  modelNumber: string;
  displayName: string;
  family: string | null;
  subtype: string | null;
  revision: string | null;
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "RETIRED";
  sourceAuthority: string;
  version: number;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
};
```

Model aliases are separate records keyed deterministically from source scope + normalized alias. An alias resolves to exactly one `equipmentModelId`; conflicts fail closed for review.

### 4.2 Compatibility relationship

```ts
type EquipmentPartCompatibility = {
  compatibilityId: string;
  uniquenessKey: string;
  equipmentModelId: string;
  partId: string;
  compatibilityType:
    | "DIRECT_FIT"
    | "APPROVED_ALTERNATE"
    | "OPTIONAL_ACCESSORY"
    | "CONSUMABLE";
  assembly: string | null;
  installationPosition: string | null;
  quantityRequired: number | null;
  applicability: {
    kind: "ALL_SERIALS" | "SERIAL_RANGE" | "MODEL_REVISION" | "UNRESOLVED";
    serialScheme: string | null;
    serialRangeStart: string | null;
    serialRangeEnd: string | null;
    modelRevision: string | null;
  };
  effectiveFrom: Timestamp | null;
  effectiveTo: Timestamp | null;
  sourceSummary: string;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  verificationStatus: "UNVERIFIED" | "IN_REVIEW" | "VERIFIED" | "REJECTED" | "CONFLICT";
  notes: string | null;
  version: number;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
};
```

`sourceAuthority` and `sourceReference` belong on evidence records, not as a single lossy relationship field. `sourceSummary` is a derived, non-authoritative display summary.

### 4.3 Evidence/provenance

```ts
type CompatibilitySource = {
  sourceId: string;
  compatibilityId: string;
  authorityType: "MANUFACTURER" | "AUTHORIZED_DISTRIBUTOR" | "SERVICE_BULLETIN"
    | "INTERNAL_VERIFIED" | "WORK_ORDER_OBSERVATION" | "RESELLER" | "OTHER";
  sourceReference: string;
  sourceVersion: string | null;
  observedClaim: "SUPPORTS" | "CONTRADICTS" | "INCONCLUSIVE";
  capturedAt: Timestamp;
  capturedBy: string;
  contentFingerprint: string;
  notes: string | null;
};
```

Multiple evidence items may support or contradict one relationship. Verification is a governed decision on the relationship, while evidence remains immutable provenance. Manufacturer evidence outranks reseller evidence, but precedence never silently erases a conflict.

## 5. Identity, uniqueness, and serial applicability

- `compatibilityId` should be a deterministic opaque hash of a versioned normalized tuple:
  `equipmentModelId + partId + compatibilityType + assembly + installationPosition + applicability`.
- Store the unhashed normalized tuple fingerprint as `uniquenessKey`; trusted writers transactionally reject non-equivalent collisions.
- Evidence identity is independent, allowing multiple sources for one relationship.
- Raw serials are strings. Never coerce alphanumeric serials to numbers.
- A serial scheme/parser must be manufacturer- or model-family-specific and versioned. Store raw bounds plus normalized comparison tokens only when that parser validates them.
- Open-ended ranges use one null bound. Both-null means `ALL_SERIALS`, not a range.
- `UNRESOLVED` applicability cannot be published as verified compatibility.
- Overlapping equivalent claims may reconcile; overlapping contradictory claims become `CONFLICT`.
- Serial filtering is domain evaluation after a bounded model query, not naive Firestore lexical range comparison.

## 6. Domain classification

| Concept | Home |
|---|---|
| Direct fit, optional accessory, consumable applicability | Part–Equipment Compatibility |
| Approved alternate for the same equipment application | Compatibility, while the Parts remain independent |
| Part-to-Part supersession / replacement direction | separate governed Part-to-Part relationship; not compatibility |
| Kit/PM-kit component membership and quantity | separate kit-composition/BOM authority |
| Assembly/installation position | compatibility context; not a full BOM by itself |
| Equipment BOM membership | future BOM authority if source-backed completeness is required |
| Serial-specific applicability | `applicability`, not a compatibility type |
| Universal | prohibited as unbounded; replace with explicit governed model/family scope |
| Unknown/requires review | verification/applicability status, not a compatibility type |
| Common-failure rank, service recommendation, AI suggestion | derived recommendation/evidence domain; never compatibility authority |
| Work Order usage | historical observation source only |

The proposed `SUPERSEDED_BY`, `REPLACED_PART`, `PM_KIT_COMPONENT`, `SERIAL_RANGE_SPECIFIC`, `UNIVERSAL`, and `UNKNOWN_REQUIRES_REVIEW` enum values are therefore rejected from the compatibility-type enum.

## 7. Read model and UX

### Minimum viable Parts experience

Add a fail-closed “Used In Equipment” section to existing Part Detail after the authoritative read service exists:

- manufacturer, model, family, subtype
- compatibility type, assembly, position, quantity
- serial applicability
- source-authority summary and verification status

The section distinguishes:

- verified matches;
- review-required/conflicting claims, visibly labeled and excluded from operational recommendations;
- no verified records;
- unavailable/denied/error (never shown as “none”).

Do not block the existing Part Detail identity/stock experience merely because compatibility is absent. Block only the compatibility section unless a later workflow explicitly requires verified compatibility.

### Later search/filter gate

Extend the existing Parts Catalog—not Part Master—with equipment manufacturer, family, model, assembly, compatibility type, serial applicability, PM/consumable classification, and verification filters. Existing availability, truck, and reorder filters continue to use their current authorities and are composed at the view layer.

### Equipment side

The existing installed-asset detail may show model-compatible Parts only after the asset has a governed `equipmentModelId`. A future Equipment Model page can show reverse lookup by assembly, service/PM classification, alternates, and composed stock state. It must not infer the model ID from free text at read time.

## 8. Permissions, writers, and audit

- Direct client writes to all four new collections: denied.
- Initial reads: admin, dispatcher, active `PARTS_MANAGER`, and active `WAREHOUSE_MANAGER`, aligned with governed Parts access. Technician has no broad collection read.
- Technician/work-order preparation uses a later scoped trusted read or projection tied to an authorized assigned Work Order and installed asset; it must fail closed.
- Proposed governed permissions:
  - `equipment.compatibility.view`
  - `equipment.compatibility.import`
  - `equipment.compatibility.verify`
  - `equipment.compatibility.correct`
  - `equipment.model.manage`
- Import, verify, correct, alias resolution, and model linkage are trusted commands with idempotency keys, expected versions, referential-integrity checks, and append-only audit events.
- Audit initiation, outcome, conflicts, verification changes, corrections, and projection rebuilds. Do not audit raw source contents, serial lists, credentials, or unbounded notes.

Permission IDs and role grants require a separate #226-aligned security gate. This document does not grant them.

## 9. Ingest contract

Future packages keep these files separate:

1. `equipment_master.csv`
2. `equipment_model_aliases.csv`
3. `equipment_part_compatibility.csv`
4. `equipment_compatibility_sources.csv`
5. optional `market_listings.csv` (evidence-only quarantine)

Every import runs: parse → normalize → validate → resolve references → duplicate/conflict analysis → dry-run report → explicit approval → trusted idempotent apply → reconciliation → evidence.

Hard rules:

- stable IDs; strict headers/types/row bounds; UTF-8 and normalized line endings;
- no invented specifications; unknown stays null or explicit unresolved state;
- every `partId`, `equipmentModelId`, `compatibilityId`, and source reference resolves;
- aliases cannot create model identities;
- listings cannot create or activate models or verified compatibility;
- source provenance is mandatory;
- serial parser/scheme is explicit and ranges validate;
- duplicates are idempotent-equivalent or rejected;
- conflicts remain reviewable and cannot auto-verify;
- no partial apply; write-ahead recovery and rollback manifest required;
- no production import without separate data-mutation authorization.

## 10. Safe implementation sequence

Each item is a separate review/merge gate; backend deployment and production data are later, separate gates.

1. **D0 — architecture approval:** approve this model and explicit decisions below.
2. **D1 — Equipment Model contract:** pure types, normalization, aliases, validators, serial schemes; no I/O.
3. **D2 — Compatibility contract:** pure relationship/evidence types, deterministic IDs, conflict/precedence logic.
4. **D3 — Import dry-run:** strict parsers and sanitized reports; emulator only, zero production writes.
5. **D4 — Trusted persistence:** repositories, trusted commands, permission catalog entries, audit, Rules/index proposal; emulator only.
6. **D5 — Read service:** bounded bidirectional queries and fail-closed read model; no UI source fallback.
7. **D6 — Part Detail MVP:** “Used In Equipment” section; preserve all current Part Detail behavior.
8. **D7 — Equipment Model/reverse lookup:** model page and optional installed-asset linkage workflow.
9. **D8 — Parts filters/search:** equipment-driven discovery composed with existing stock/reorder authorities.
10. **D9 — downstream consumers:** Work Order preparation, technician view, truck-stock recommendations, warehouse, procurement, PM, and AI—each separately authorized.
11. **D10 — production infrastructure:** separately authorize Rules, indexes, Functions, and verification.
12. **D11 — production data:** separately authorize dry-run-reviewed import, one bounded batch at a time, reconciliation and rollback.

Rollback is revert-by-gate before deployment; backend rollback restores the pinned Rules/Functions/index state; data rollback uses the write-ahead manifest and never deletes pre-existing Part or Equipment records.

## 11. Mandatory tests

- strict schema and unknown-field rejection;
- stable deterministic IDs and collision refusal;
- Part and Equipment Model referential integrity;
- alias conflict and no duplicate models;
- idempotent import/replay and zero-write dry-run;
- serial parsing, open bounds, alphanumeric ordering, overlap, revision, unresolved applicability;
- source precedence without silent conflict erasure;
- multi-source evidence and verification-state transitions;
- direct-client write denial and persona read matrix;
- trusted-writer permission, idempotency, concurrency, expected-version, audit, and secret-free output;
- forward/reverse query parity and projection reconciliation;
- no dropped/renamed/rekeyed Parts;
- existing Parts Catalog, Part Detail, C1/C2 fail-closed, truck inventory, warehouse, Work Order, procurement, alias, supplier-item, and Rules regressions;
- rollback/re-import proof and production evidence sanitization.

## 12. Risks and limitations

- Free-text installed-asset model values may not map uniquely to future Equipment Models.
- Static Part names may look compatible while being wrong; they are not bootstrap authority.
- Serial semantics vary by manufacturer and may not be lexically sortable.
- One Part/model pair may have contradictory evidence by revision, geography, or serial range.
- Broad client reads could leak operational model/serial applicability; technician access needs scoped design.
- Compatibility can influence purchasing or technician behavior, so unverified records must never drive operational recommendations.
- C2 confirms Part identity/read behavior, not compatibility completeness.

## 13. Owner decisions

**Approved by Owner on 2026-07-27:**

1. **D-COMPAT-1:** top-level `equipment_models`, model aliases, compatibility, and source-evidence collections as separate authorities.
2. **D-COMPAT-2:** deterministic opaque compatibility ID from the versioned normalized uniqueness tuple.
3. **D-COMPAT-3:** the reduced compatibility-type enum and separation of supersession, kit composition, serial scope, and review status.
4. **D-COMPAT-4:** multiple immutable evidence records; relationship-level verification; conflicts never silently merged.
5. **D-COMPAT-5:** Parts Catalog remains primary; no visible competing Part Master or duplicate static compatibility.
6. **D-COMPAT-6:** initial read personas and trusted-writer-only mutation posture.
7. **D-COMPAT-7:** installed assets remain separate and receive `equipmentModelId` only in a later reconciled linkage gate.

No provider, data source, permission grant, production import, or deployment decision was approved.

## 14. Exact next gate

**D1 only:** repository-only pure Equipment Model types, normalization, aliases, manufacturer/model identity rules, serial-scheme contracts, validators, and deterministic/alias-conflict/no-I/O tests.

Do not begin compatibility persistence, Firestore collections, Rules, Functions, indexes, UI, imports, production access, installed-asset linkage, Truck Inventory, or downstream consumers.
