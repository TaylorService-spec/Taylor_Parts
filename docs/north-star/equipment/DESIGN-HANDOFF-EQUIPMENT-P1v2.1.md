# Equipment — North Star P1v2.1 handoff (DESIGN LOCKED)

## P1v2.1 change log (three corrections only)

1. Stale P1 authority claims removed/annotated in this README — the superseded universal-DENIED
   language is now a provenance note, not an authority statement; the acceptance checklist item
   updated to the five-state wording.
2. Taylor/Ventana explanation for Available Equipment corrected to the exact governed composition:
   Serialized Asset → whole-unit Part → canonical Equipment Model identity → manufacturer →
   existing declared manufacturer-to-operating-line mapping → Taylor / Ventana / Unclassified.
   The line is not stored on the asset; nothing is inferred from the Customer. Documentation only —
   visual grouping unchanged, no new lineOfBusiness field.
3. Unresolved-location copy standardized family-wide: the 1a illustrative cell now reads
   "Location unavailable" (was "Unresolved reference"). Raw ids never shown; names/types never
   guessed; 1c's independent Customer/Location failure behavior unchanged.

Confirmation: no new backend or platform authority introduced. Frames 1a–1e, three tabs, Warranty
Expires, install confirmation, inventory-control UNKNOWN, all honest states, and the D/G ledger
statuses are unchanged from P1v2.

Revision label: EQUIPMENT NORTH STAR P1v2.1 — DESIGN LOCKED.
Visual source of truth: `North Star - Equipment P1v2.dc.html` (P1 retained for provenance).
Design artifact only — no application code implemented.

## Correctness changes in P1v2 (explicit list)

1. **EQ-D2 CLOSED — warranty rendered.** Removed the claim that no warranty field exists.
   `warrantyExpiresDate` (Warranty Expires, YYYY-MM-DD) is an existing governed Equipment fact;
   the record (1c) now shows it exactly as recorded. No derived semantics (in/out of warranty,
   days remaining, provider, coverage).
2. **EQ-G1 CORRECTED.** Removed "granted to no role / DENIED in every environment" — stale.
   The governed trusted Available Equipment read exists and is sandbox-activatable
   (`inventory.serializedAsset.read`). 1b now designs the full runtime state model —
   LOADING / READY / EMPTY / DENIED / UNAVAILABLE — with DENIED as one possible state,
   not the universal condition.
3. **EQ-G2 CORRECTED.** Removed "location display read inactive everywhere" — stale. The governed
   resolver exists and is sandbox-activatable (`inventory.location.display.read`). Presentation
   rule kept unchanged: resolved → human-readable name; unresolved → "Location unavailable";
   never a raw id as a business label; never a guessed type.
4. **Install at customer designed as a governed, confirmed command (1b).** Backed by existing
   `equipment.install` authority; confirmation composition shows Unit (model + serial), Customer,
   Installation location, with Confirm installation / Cancel. Not casual reassignment; no recovery
   command designed in P1.
5. **EQ-G5 ADDED — operating-company seam.** Installed Equipment never shows Taylor/Ventana
   derived from the Customer (a customer may own units from both operating companies). The seam
   composes the future governed ownership fact when available; P1 does not build that authority.
   Noted in 1a and 1c. (Available Equipment's line grouping is different and kept: the governed
   Serialized Asset → whole-unit Part → Equipment Model → manufacturer → declared
   manufacturer-to-operating-line mapping composition classifies Taylor / Ventana / Unclassified.)
6. **1d expanded** to current-truth states: Available Equipment five-state row, the reference
   resolution ladder (resolved / failed-with-retry / proven-unset), inventory-control honest
   unknown. Denied never relabelled "not found".
7. **Ledger reconciled** (frame 1e and below); serial number noted as context, not canonical
   identity (1a).

**Confirmation: no new backend or platform authority was invented** — no schema, rules, indexes,
Functions, capabilities, activations, role grants, recovery workflow, analytics, or data-model
merges. Presentation-layer North Star migration only.

## Remaining questions that truly require Owner judgment

- EQ-D4: does the compatible-parts panel belong on the unit record (vs Parts catalog only)?
- EQ-D1 / EQ-D3: whether to fund the analytics / opportunity-linkage authorities at all.
- EQ-G5: which authority will carry per-unit operating-company ownership, and when.

---

# Equipment — North Star P1 handoff (original, superseded notes below)

Visual source of truth: `North Star - Equipment P1.dc.html` (copy in this folder).
Behavioral source: `field-ops-app-vite/src/modules/equipment/*`, `src/domain/equipment*`,
`installedEquipmentListView.js`, `equipmentTimelineView.js`, `availableEquipmentCatalogView.js`,
`src/metadata/definitions/equipment*.js` (see github.md).

## Verdict

Equipment is a **Workspace + Record** family. The workspace keeps the shipped three-tab shape
(`/equipment`: Customer Equipment / Available Equipment / Add Equipment — they answer three
different questions) recomposed into the Lists P2 grammar; the record (`/equipment/:equipmentId`)
is the shared record shell plus the family's honest sections. This is a recomposition of existing
reads — no new data authority anywhere except the separately named decisions below.

The prior `Proposed - Equipment.dc.html` invented authority (repair economics, warranty,
opportunity flagging); every block is dispositioned in frame 1e — named, never silently kept
or dropped.

## Composition

- **1a Customer Equipment (canonical):** workspace header with NO count (repo law: three tabs,
  one number would be ambiguous) → tab rail → tab-level governed aggregate + saved views →
  server-side filters (Customer as a picker of names, Status; manufacturer/model stay columns —
  no composite index) → result context directly above rows → table (display name + disambiguating
  summary, never a document id) → Load more.
- **1b Available Equipment:** the full runtime state model — LOADING / READY / EMPTY / DENIED /
  UNAVAILABLE — plus the READY composition grouped by operating line (both lines always named,
  including at zero), governed fields, Install as the capability-gated governed command with a
  confirmation composition, unresolvable location as an absence.
  SUPERSEDED P1 NOTE — the original P1 artifact modeled Available Equipment around a universal
  DENIED state. That authority snapshot is no longer current; P1v2 uses the runtime state model
  above.
- **1c Unit record:** identity header (status word beside the name) · shared record shell
  (em dash for absent, pencil only on editable fields, one edit modal) · Customer & location kept
  apart (independent failure + Retry) · Inventory control honest UNKNOWN (D-5 unratified) ·
  lifecycle actions present-but-disabled with the stated reason · unified activity timeline with
  the verbatim "inventory not yet connected" note.
- **1d Honest states:** choose-a-customer (nothing read yet) vs filtered-empty vs database-empty;
  read failure vs not-found; failed reference reads as "unavailable", never "Unknown" as fact.
- **1e Disposition:** Proposed page fully accounted for.

## Behavioral backlog — named product decisions (Owner)

- **EQ-D1 — Repair economics.** Repairs-12mo / repair-spend-vs-replacement / "repair-heavy"
  flagging needs a projection that does not exist. Build it (new derived read over WO costs) or
  drop the concept. Not rendered in P1.
- **EQ-D2 — Warranty.** CLOSED in P1v2: `warrantyExpiresDate` already exists as a governed
  Equipment fact and is displayed as recorded. Richer warranty-status semantics are outside P1.
- **EQ-D3 — Equipment→Opportunity linkage.** The Proposed "flag this serial for OP-…" suggestion
  has no domain basis. If wanted, it is a new relationship plus a suggestion surface — a full
  product decision, not a design patch.
- **EQ-D4 — Compatible parts on the unit record.** The compatibility authority exists;
  its ratified UI (D6) lands in the Parts catalog. A unit-record slot is a separate call.

## Gaps (truthful states designed in)

- **EQ-G1** — CORRECTED in P1v2: the governed read exists and is sandbox-activatable. All five
  runtime states (loading/ready/empty/denied/unavailable) are designed; no universal-DENIED claim.
- **EQ-G2** — CORRECTED in P1v2: the governed resolver exists and is sandbox-activatable.
  Presentation rule unchanged: unresolved renders "Location unavailable", never a raw id.
- **EQ-G5** — Installed-equipment operating company (Taylor/Ventana) is not a safely composable
  presentation fact and is never inferred from the Customer; compose the governed ownership fact
  when it exists.
- **EQ-G3** — Timeline inventory half not connected; repo's honest note kept verbatim.
- **EQ-G4** — Move/Retire/Reactivate trusted-writer Functions undeployed; actions render
  disabled with the stated reason (repo behavior, kept as design).

## Integration order

1. Workspace header + tab rail (no count) — WorkspaceIdentity unchanged.
2. Customer Equipment: restyle the existing metadata list composition (ListViewHeader, AddFilter,
   SortControl, ActiveCriteria, CollectionResultContext, MetadataListGrid) into the 1a table
   pattern. All behavior already exists.
3. Record header + record shell (MetadataRecordPage over equipmentRecordPage) per 1c.
4. Customer & location panel, InventoryControlSection, lifecycle actions — existing components,
   1c placement.
5. Activity timeline per 1c table treatment (EquipmentTimeline logic unchanged).
6. Available Equipment per 1b (both states; existing view-models).
7. Add Equipment register per 1d state wording (existing flow, restyled).

## Acceptance checklist

- [ ] Sandbox vs 1a/1c side-by-side, whole composition (Design + Owner).
- [ ] Workspace header shows no count; tab aggregate counts over its own filters, null on failure.
- [ ] Customer filter is a picker of names; no control errors at read time.
- [ ] Duplicate-name rows disambiguated by summary; no document id rendered as content.
- [ ] Available tab: honest runtime states match 1b — LOADING / READY / EMPTY / DENIED / UNAVAILABLE; grouped READY render; both lines named.
- [ ] Record: failed Account/Location reads show inline failure + Retry, not "Unknown".
- [ ] Lifecycle buttons disabled WITH the reason; Edit live, including on retired assets.
- [ ] Timeline: loading / unavailable / empty / partial distinct; inventory note verbatim.
- [ ] Regression: existing equipment tests (workspace, timeline, list migration, fail-closed
      detail) still pass.
