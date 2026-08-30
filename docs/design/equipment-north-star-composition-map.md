# Equipment North Star P1v2.1 — composition map

The reconciliation between the locked design artifact
([`docs/north-star/equipment/North Star - Equipment P1v2.dc.html`](../north-star/equipment/North%20Star%20-%20Equipment%20P1v2.dc.html)),
the Equipment surfaces as they stand, and the governed behavioral truth underneath them. Produced
**before any UI code changed**, per the North Star execution rule.

**Design authority:** the artifact above, frames 1a–1e, plus
[`DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md`](../north-star/equipment/DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md)
in the same folder. Revision label: **EQUIPMENT NORTH STAR P1v2.1 — DESIGN LOCKED**.

**Behavioral authority:** `src/domain/equipment.js`, `equipmentStatus.js`, `equipmentTimelineView.js`,
`equipmentInventoryControlAdapter.js`, `equipmentInstallForm.js`, `availableEquipmentCatalogView.js`,
`availableEquipmentGovernedProjection.js`, `wholeUnitAssetDisplay.js`, `locationDisplayProjection.js`,
`installedEquipmentListView.js`, `equipmentRepository.js`, `equipmentWrites.js`;
`src/metadata/definitions/equipment.js` + `equipmentPage.js`; `src/metadata/referenceResolution.js`;
`src/access/permissionCatalog.ts`, `governedBusinessRoles.ts`, `useEquipmentInstallCapability.js`;
`config/environments.json`; `functions/src/serializedAsset/`.

**Where they conflicted, behavioral truth won.** Each conflict is a ruling below, not a silent
resolution.

---

## The one thing to read first

**This family is already substantially compliant, and two of the design's own authority notes were
written against a snapshot the repository has since moved past — in opposite directions.**

The handoff warns: *"Inspect the current implementation carefully here because older comments may
conflict with newer sandbox activation truth. Do not rewrite authority based on stale comments."*
That warning lands, and it lands on the **repository**, not on the design:

`AvailableEquipment.jsx`'s file header asserts, twice, that
`inventory.serializedAsset.read` and `inventory.location.display.read` are *"granted to no Role as of
this build, so this surface fails closed to the DENIED state in every environment."* **That is no
longer true.** Both capabilities are granted to eight governed Roles in
`access/governedBusinessRoles.ts`, and both appear in `capabilityActivationOverrides` for the sandbox
environment in `config/environments.json`. The catalog's `active: false` is the *production* posture,
not a universal one. The design corrected exactly this in P1v2 (EQ-G1, EQ-G2) and the design is right;
the repository's comments are the stale artifact. Correcting them is documentation, not authority.

The mirror image is **the unresolved-reference vocabulary**, where the repository is ahead of the
design and stays ahead — see **ND-30** below.

Twenty-two drawn elements were checked against the function that would have to supply them. **Sixteen
are already built and correct.** Four need presentation/composition work. Two cannot be rendered as
drawn and are ruled below.

---

## Verdict — three tabs, one record, and no new authority anywhere

Equipment stays exactly where it is: the workspace at `/equipment` (`EquipmentWorkspace.jsx`, three
tabs over three genuinely different populations) and the record at `/equipment/:equipmentId`
(`EquipmentDetail.jsx`). Both are recomposed into the North Star grammar. Neither gains a read, a
command, a capability, an index or a Rules change.

The three populations are **not** merged. The design says so, the repository already does so, and the
reasons are structural rather than visual: Customer Equipment is a cross-account read of the
`equipment` collection; Available Equipment is a trusted callable read of `serialized_assets`; Add
Equipment is an account-scoped create flow whose Location options and write are bound to one fixed
Account.

---

## Item-by-item: does the drawn element fall within functionality?

### Already built and correct — no change required

| Drawn (frame) | Source | Note |
|---|---|---|
| Three tabs, three populations (1a) | `EquipmentWorkspace.jsx` | WAI-ARIA tabs, roving tabindex, panels stay mounted |
| Workspace header with **no count** (1a) | `WorkspaceIdentity` called without `count` | The repo reached this conclusion first and records the reason in place |
| Tab-level governed aggregate (1a) | `useListViewChrome` → `ListViewHeader` | A real aggregate over the same filters; `null` on failure, never a tally of loaded rows |
| Server-side Customer + Status filters (1a) | `equipmentIndexList.filters`, backed by three live composites | `(accountId,name)`, `(status,name)`, `(accountId,status,name)` |
| Customer filter as a **picker of names** (1a) | `useAccountPicker` + `valueOptions` | Truncation disclosed by the hook's own notice |
| Manufacturer/model stay columns, not filters (1a) | `equipmentIndexList` | No composite exists; declaring one would error at read time |
| No document id as content (1a) | `listPresentation.cellValue` + `MetadataListGrid` | The id routes the row and is never a cell |
| Result context directly above the rows (1a) | `CollectionResultContext` | Lists P2 anatomy, already positioned |
| Load more (1a) | `MetadataListGrid` `hasMore` | |
| Five runtime states (1b) | `deriveAvailableState` → `AVAILABLE_STATE` | LOADING / READY / EMPTY / DENIED / UNAVAILABLE, each with its own copy |
| Line grouping via the governed composition (1b) | `wholeUnitAssetDisplay.js` | Serialized Asset → whole-unit Part → canonical `equipmentModelId` → manufacturer → declared `LINE_BY_MANUFACTURER` → Taylor / Ventana / Unclassified. No stored `lineOfBusiness`; nothing inferred from Customer |
| Both lines always named, including at zero (1b) | `countAvailableByLine` + the summary line | |
| Unresolvable location as an **absence**, never a raw id (1b) | `availableUnitFields` → `locationField(locationResolved === false ? null : …)` | |
| Install gated on the capability (1b) | `useEquipmentInstallCapability`, fail-closed while loading | Server re-checks inside its transaction |
| Install backed by the existing governed command (1b) | `callInstallSerializedAsset` → `equipment.install` | One command, no client-direct write, one idempotency key per attempt |
| **Warranty Expires** on the record (1c) | `equipmentPage.js` §`equipmentService` → `warrantyExpiresDate` | Rendered as recorded. No derived warranty status exists anywhere in `src/` — verified by grep |
| Customer & Location kept apart with independent failure + Retry (1c) | `EquipmentDetail.jsx` `data-account-error` / `data-location-error` | |
| `"Location unavailable"` on a failed location read (1c) | `EquipmentDetail.jsx` `locationName` | And `"Unknown location"` only on a *succeeded* read that resolves to nothing — the design's own ladder, exactly |
| Inventory control honest UNKNOWN (1c) | `equipmentInventoryControlAdapter.js` + `InventoryControlSection.jsx` | Ownership/title and availability kept as separate axes |
| Lifecycle actions present-but-disabled **with the reason** (1c) | `trustedActionUnavailable("equipment.move")` | One shared reason string, from the seam the buttons would call |
| Edit live, including on a retired asset (1c) | `EquipmentEditModal` + `updateEquipment` | Ownership/location immutable; status writable ACTIVE↔INACTIVE only, and therefore deliberately *not* pencilled |
| Choose-a-customer / filtered-empty / database-empty / not-found (1d) | `EquipmentRegister.jsx`, `MetadataListGrid` `StateBody` | Four distinct facts, four distinct renderings |
| No Taylor/Ventana on installed Equipment (1a, 1c, EQ-G5) | `equipment.js` gap `EQUIPMENT_BUSINESS_LINE_NOT_RECORDED` | The refusal is already recorded as a first-class gap with the reason: *an account can hold equipment from both lines* |

### Buildable as drawn — presentation/composition work in this migration

| Drawn | What is missing | Change |
|---|---|---|
| Record shell in the North Star grammar (1c) | `EquipmentDetail.jsx` still hosts `WorkspaceShell`; families 1–7 compose `ns-page` + `RecordIdentity` | Migrate, and **move the file between the two membership lists in `compositionConformance.test.jsx` in the same commit** (GATE 2b²) |
| Workspace description sentence (1a) | `WorkspaceIdentity` has no slot for the sentence under the title | Additive optional `description` prop, default `null` — every one of the 15 existing collection pages renders byte-identically |
| Duplicate section naming (1a, 1b) | `CustomerEquipment` renders `<h3>Customer Equipment</h3>` **inside** the panel whose tab already says "Customer Equipment"; `AvailableEquipment` does the same | Remove both. "No duplicate page/section naming" is a North Star presentation rule |
| Available Equipment READY as a **table** (1b) | Rendered as `<ul>` of `StructuredFields` cards | Recompose as the `ns-table` row grammar (Serial · Model · Condition · Location · action) per line group, keeping every field a field |
| Activity timeline as a **table**, Source · Date · Event (1c) | Rendered as an `<ol>`, and it prints `e.type` / `e.status` **raw** | Recompose as `ns-table`; source the words from `WORK_ORDER_TYPE_LABEL` / `WORK_ORDER_STATUS_LABEL` (see **the one defect** below) |
| Install **confirmation** composition (1b) | The dialog collects and confirms in one step; the consequence sentence names customer and location, but there is no labelled Unit / Serial / Customer / Installation location read-back, and the primary reads "Install at customer" | Add the confirmation step over the *same* command. Primary "Confirm installation", secondary "Cancel" |

### Not buildable as drawn — ruled

| Drawn | Why not | Ruling |
|---|---|---|
| Unresolved location renders the single string **"Location unavailable"** in the 1a table (1a) | The metadata list runtime resolves references through `referenceResolution.js`, which distinguishes NOT_FOUND / DENIED / LOADING / ERROR and renders a different sentence for each. Collapsing them to one string would re-introduce the exact defect that module was written to remove — telling an operator their data is broken when the truth is that their role is narrow | **ND-30** — repository truth preserved. The *invariant* the design is protecting (never a raw id, never a guessed name) holds and is tested. The record page (1c) keeps the literal `"Location unavailable"`, because there the failure state genuinely is one |
| Identity cell as `Name · Manufacturer Model · S/N …` (1a) | The design draws a muted concatenated summary in the identity column *while also* drawing Manufacturer and Model as their own columns. The family-wide rule — stated in `equipment.js`'s own gap register, and in the design's own 1b note ("SIX ATTRIBUTES, SIX FIELDS") — forbids concatenating business attributes into one opaque string. The repository already gives each attribute a column, including `serialNumber` | **ND-31** — repository truth preserved. Duplicate names are disambiguated by the *adjacent columns*, which is strictly more useful than a muted summary: they are also sortable and scannable down their own edge. No concatenation is introduced |

---

## The one defect this migration corrects

`EquipmentTimeline.jsx` renders a Work Order's `type` and `status` **raw**:

```jsx
{isService && e.type   ? <span className="fo-muted"> · {e.type}</span>   : null}
{isService && e.status ? <span className="fo-muted"> · {e.status}</span> : null}
```

So the row reads `Service · WO-873 · REPAIR · IN_PROGRESS`, while the design draws
`Repair · In progress` and every other Work Order surface in EOS already sources those words from
`WORK_ORDER_TYPE_LABEL` and `WORK_ORDER_STATUS_LABEL`. This is the same shape as Parts defect #4 and
#5 (`docs/design/north-star-migration-ledger.md`, family 7): **a stored token reaching a reader.**
It is pre-existing, it is family-local, and it blocks truthful composition of the drawn timeline, so
it is corrected here rather than deferred.

No other defect was found. The `Row()` helper at the foot of `EquipmentDetail.jsx` is dead code with
no caller and is removed with the shell it belonged to.

---

## Deferred concepts — confirmed absent, and kept absent

| Item | Status | Verified |
|---|---|---|
| **EQ-D1** repair economics / repair-vs-replace | Deferred | No repair-spend, replacement-score or repair-heavy composer exists in `src/domain/`; none added |
| **EQ-D2** warranty | Closed to the extent `warrantyExpiresDate` exists | It is displayed as recorded. No `inWarranty`, `daysRemaining`, provider or coverage derivation exists anywhere in `src/`; none added |
| **EQ-D3** Equipment → Opportunity | Deferred | No equipment↔opportunity relationship in any entity definition; none added |
| **EQ-D4** compatible parts on the unit record | Deferred | `equipmentCompatibilitySection.js` exists and is consumed by the **Parts** catalog surface, not by the Equipment record. Left exactly there |
| **EQ-G3** timeline inventory half | Open | `inertInventoryHistorySource` stays inert; the repo's note is kept verbatim |
| **EQ-G4** Move/Retire/Reactivate trusted writers | Open | Buttons stay disabled with the stated reason |
| **EQ-G5** installed-unit operating company | Open — authority seam | Never inferred from the Customer. The gap `EQUIPMENT_BUSINESS_LINE_NOT_RECORDED` is the seam a later governed ownership fact composes into |

---

## Authority preservation

Nothing in this migration touches `firestore.rules`, `firestore.indexes.json`, `functions/`,
`permissionCatalog.ts`, `governedBusinessRoles.ts`, `config/environments.json`, any collection, any
schema, any backfill or any deployment config. Every rendered value is an existing read; every
action resolves through an existing command:

- installed Equipment — one `onSnapshot` doc read + one `equipmentId`-scoped Work Order query +
  the account/location lookups the register already performs;
- the installed register — the metadata list runtime's single bounded read plus the two batched
  reference resolvers;
- Available Equipment — `getAvailableEquipment` and `getLocationDisplay`, both unchanged;
- install — `callInstallSerializedAsset` → `equipment.install`, unchanged;
- edit — `updateEquipment`, unchanged, with its allowlist still **imported** from the write path.
