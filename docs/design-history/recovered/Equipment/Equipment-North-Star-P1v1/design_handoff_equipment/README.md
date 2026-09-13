# Equipment — North Star P1 handoff

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
- **1b Available Equipment:** BOTH truths designed — the fail-closed DENIED state every
  environment shows today, and the granted composition: grouped by business line (both lines
  always named, including at zero), governed fields, Install as the capability-gated governed
  command, unresolvable location as an absence.
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
- **EQ-D2 — Warranty.** No warranty field exists in the equipment schema. Add the field (and its
  source of truth) or drop the column.
- **EQ-D3 — Equipment→Opportunity linkage.** The Proposed "flag this serial for OP-…" suggestion
  has no domain basis. If wanted, it is a new relationship plus a suggestion surface — a full
  product decision, not a design patch.
- **EQ-D4 — Compatible parts on the unit record.** The compatibility authority exists;
  its ratified UI (D6) lands in the Parts catalog. A unit-record slot is a separate call.

## Gaps (truthful states designed in)

- **EQ-G1** — Available Equipment read is fail-closed DENIED everywhere
  (`inventory.serializedAsset.read` granted to no role). The denied render ships; the composition
  lights on grant with no design change.
- **EQ-G2** — Location display governed read inactive; an unresolvable location renders
  "Location unavailable" — an absence, never a raw id.
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
- [ ] Available tab: DENIED state matches 1b copy; grouped render when granted; both lines named.
- [ ] Record: failed Account/Location reads show inline failure + Retry, not "Unknown".
- [ ] Lifecycle buttons disabled WITH the reason; Edit live, including on retired assets.
- [ ] Timeline: loading / unavailable / empty / partial distinct; inventory note verbatim.
- [ ] Regression: existing equipment tests (workspace, timeline, list migration, fail-closed
      detail) still pass.
