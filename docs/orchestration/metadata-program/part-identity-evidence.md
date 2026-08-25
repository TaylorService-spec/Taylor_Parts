---
artifact_type: evidence-audit
unit: X-PARTID-IDENTITY-CONFLICT (focused evidence audit)
gate: Evidence
status: Complete — no implementation authorized; this document decides nothing by itself
date: 2026-08-18
owner: Claude Code (docs/part-identity-evidence lane)
base: origin/main @ 7248b4d93eb8cca580ffbf15cc56fa4fc2fa7160
scope: docs/orchestration/metadata-program/part-identity-evidence.md ONLY — no code read as a target for editing, no code changed
---

# X-PARTID-IDENTITY-CONFLICT — evidence audit

## 0. What this document is

`docs/orchestration/metadata-program/LEDGER.md` records this conflict: `part.js` declares `partId`
(type `ID`) as "the Firestore document id" with `internalPartNumber` as the `referenceField`, while the
merged `INV-CONVERGENCE-B` production evidence records `partId == TST-####` for all 190 production Parts
and calls `internalPartNumber` "not exposed in source (not the operational key)." A prior lane recorded
one side of that disagreement uncritically. This audit re-derives the answer from primary sources — code,
production evidence, and the governing spec — and does not repeat that error by trusting either side's
framing.

Four concepts are kept distinct throughout, per instruction: the opaque `recordId` (`partId`, the Firestore
document id), `systemName` (not applicable here — v1 field definitions have no `storagePath`/`systemName`
split), `businessReference` (the field a human recognizes/communicates as "the part number"), and
`humanDescription` (`name`).

## 1. The two fields, as declared today

`field-ops-app-vite/src/metadata/definitions/part.js:98` —
```
identity: makeIdentity({ nameField: "name", referenceField: "internalPartNumber" }),
```
`part.js:105-111` declares `partId` as `type: "ID"`, explicitly not an identity field: *"The Firestore
document id. `partFromFirestore` throws if the stored `partId` does not match it."* That enforcement is
real: `functions/src/partMaster/partMasterRepository.ts` (per `part.js:15-19`'s own citation) throws
`MalformedStoredRecordError` if `data.partId !== docId`.

`part.js:112-119` declares `internalPartNumber` as `type: "STRING"`, required, sortable: *"The catalog
number staff use. Required on every Part; the referenceField half of identity."*

## 2. The governing spec already answered this, and it is Owner-ratified

`docs/specifications/part-master-architecture.md:25-30` (status: *"Approved — Owner decisions O-1…O-12
(2026-07-22), recorded in DECISIONS.md #40"*):

> `partId` — immutable internal identity = the Firestore document ID of `parts/{partId}`. Opaque going
> forward; **grandfathering rule:** parts migrated from existing references adopt their current sku string
> (e.g. `TST-1001`) as `partId`… New parts get generated opaque IDs.
>
> `internalPartNumber` — human-readable business number, mutable under governance, unique among active
> parts, initially equal to the legacy sku for migrated parts.
>
> Rejected: … C (business number as canonical ID — **breaks on renumbering, mergers, supplier/manufacturer
> changes**; the current sku-as-everything defect at scale).

`docs/architecture/ADR-008-part-master.md:42` repeats the same rejection: *"Business-number-as-ID (C) —
renumbering/mergers/supplier changes would mutate referential identity; the current defect
institutionalized."*

This is the load-bearing fact for this audit: **the exact complication this task asked me to reconcile —
"part numbers change when the manufacturer changes for the same part" — is the specific, named reason the
Owner-ratified spec rejected making the business number the canonical id.** It was not overlooked; it was
the deciding argument.

## 3. A–E, answered from evidence

### A. Which field is the opaque/storage identity?

**`partId`.** It is the Firestore document id of `parts/{partId}`, read-enforced
(`part.js:15-19`/`partMasterRepository.ts`), and it is what every transactional/join surface actually keys
on:
- Ledger: `functions/src/types/inventoryTransaction.ts:18` — `partId: string; // sku`.
- Work Order Parts Plan line identity: `functions/src/workOrderPartsPlan/setWorkOrderPartsPlan.ts:13-18` —
  *"`sku` … MUST equal the canonical Part's `internalPartNumber` … We NEVER fabricate `sku = partId`"* —
  the plan **line** itself is keyed on `partId`; `sku` is a resolved display value, never the join.
- Purchase Order lines: `functions/src/types/procurement.ts:26-30` —
  `PurchaseOrderLineItem { partId: string; … }` — no `internalPartNumber` field exists on a PO line at all.
- Receiving: `functions/src/inventoryReceiving/receivingValidation.ts:82` and
  `receiveInventoryStockCommand.ts:152-153` validate/read `partId`; the receiver-facing UI
  (`field-ops-app-vite/src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx:160,269`) displays
  `{candidate.partId}` directly.
- Scan resolution: `field-ops-app-vite/src/domain/scanCandidates.js:49-51` resolves final identity to
  `partId` (falling back to `sku`); `internalPartNumber` never appears in the scan-matching key list
  (`field-ops-app-vite/src/domain/scannedIdentity.js:99,115`).

### B. Which field do users actually recognize and communicate as "the part number" — today?

**`partId`, surfaced under the label "SKU."** `PartDetail.jsx:1423` — `{ key: "sku", label: "SKU", value:
part.sku }`; `part.sku` is set at `field-ops-app-vite/src/domain/partDetailView.js:102` — `sku: row.key` —
and that same file's own doc comment (`partDetailView.js:57`) states plainly: *"the route param (=== sku
=== canonical partId)."* Global search (`field-ops-app-vite/src/shared/search/searchProviders.js:85-103`)
matches and displays `part.sku` only — `internalPartNumber` does not appear in that file. Receiving and
Purchase Orders (cited under A) show `partId` raw.

**But this is a coincidence of the current data, not proof `internalPartNumber` is unused or wrong** — see
§4. The one screen that is explicitly the *governed* Part identity editor, `PartMasterList.jsx`, titles its
edit modal and renders its table column with `internalPartNumber` (`PartMasterList.jsx:162,208`), and the
Work Order Parts Plan Editor's add-part picker shows `internalPartNumber` to the user
(`WorkOrderPartsPlanEditor.jsx:308`) even though the plan line's join key underneath is `partId`.

### C. Which is immutable/stable enough to be a business reference?

**`partId` is the immutable one, by design — and that is exactly why it is *not* the declared
`referenceField`, not why it should be.** `internalPartNumber` is explicitly documented as mutable:
`functions/src/partMaster/partMasterCommands.ts:22` — *"internalPartNumber IS mutable under governance
(spec sec1)."* It is in the update allowlist (`partMasterCommands.ts:256`,
`UPDATABLE_FIELDS = new Set(["internalPartNumber", …])`), and a real, exercised code path exists for
changing it: `partMasterCommands.ts:293-344` — when `internalPartNumber` changes, the **old** value is
staged as an `INTERNAL_PN` `part_alias` atomically with the update (line 324-344: *"preserved prior
internalPartNumber of part … as INTERNAL_PN alias"*), so historical references keep resolving while
`partId` — and therefore every ledger entry, WO snapshot, and PO line that already joined on it — never
moves.

**This is the direct answer to the manufacturer-change complication the task flagged.** The task noted
this issue is recorded elsewhere with its own note to reconcile rather than decide independently — this
audit is that reconciliation, and the two issues resolve to the same architecture: when a part's number
changes (e.g., because its manufacturer changed), the governed path is to update `internalPartNumber` and
preserve the old value as an alias, *not* to touch `partId`. `partId` stays fixed so nothing already keyed
on it (ledger, WO `inventorySnapshot`, PO lines) silently breaks. This is a **simpler, already-implemented**
mechanism than the `part_relationships`/`SUPERSEDED_BY` model the spec separately describes for the harder
case of a genuinely new physical part (§5 of `part-master-architecture.md`) — that collection and its
commands are **not yet implemented**: `functions/src/partMaster/types.ts:5` — *"part_relationships/
manufacturers) are LATER gated PRs -- nothing here"* (only the `RELATIONSHIP_TYPES` enum and validation
shape exist, at `types.ts:55` and `validation.ts:276`). So: in-place renumbering (same physical part, new
manufacturer part number) is a live, working feature today; part-to-part supersession (a different physical
part entirely) is spec'd but not built. Neither case argues for `partId` as the business reference — both
confirm `partId` must stay inert precisely so the number can move around it.

### D. Are both values currently populated consistently?

**Yes — every observed row has them equal**, but the production evidence that is often read as saying
`internalPartNumber` is *absent* actually only says it wasn't captured by one specific read-back's
projection. `docs/audits/inv-convergence-b/production-parts-export.evidence.json` records that
`internalPartNumber` was `NOT_EXPOSED_IN_SOURCE` for all 190 rows (the read-back itself has been
removed from the repository as operational-provenance content), and `docs/audits/inv-convergence-b/evidence-review.md` §2.1
explains why: the source read (`postwrite-analyzer/row-results.json`) exposed `partId, name, stockingUnit,
status` only — `internalPartNumber` and `category` were outside that analyzer's projected fields, not
outside the stored document.

Other code paths confirm the field is required and populated on every write: `internalPartNumber` is
required by `validation.ts:55` (*"internalPartNumber must be a string"*), every `createPart` call logs it
in its own audit summary (`partMasterCommands.ts:238` — `` `created part ${part.partId}
(${part.internalPartNumber})` ``), and every seed/migration writer sets it equal to `partId`:
`functions/scripts/seedSandboxBaseline.js:193-195` — `partId: p.id, sku: p.id, … internalPartNumber: p.id`;
`functions/scripts/generatePartMasterMigrationEvidence.js:59` — `internalPartNumber: partId`. Divergence
between the two fields is exercised only in a CSV test fixture built to prove the write path supports it
(`functions/test/fixtures/part-master-migration-fixture.csv`, rows `MIGFIX-DUP-P1`/`MIGFIX-DUP-P2`/
`MIGFIX-OWNER`, where `internalPartNumber` and an explicit `partId` column differ on purpose) — never in
any real seed, demo, or production data path.

### E. Is either field externally sourced?

**`internalPartNumber` is the field with external provenance; `partId`'s current values are a copy of it.**
The CSV migration input's required business-key column is `internalPartNumber`
(`functions/src/partMaster/csvMigrationAnalysis.ts:45,140`); `partId` on that same CSV is **optional**, an
explicit override column, and when it is absent, `partId` is *derived from* `internalPartNumber`:
`functions/scripts/executePartMasterCreate.js:99-101` — `const rawIpn = cellOf(cells,
"internalPartNumber"); const explicitPartId = cellOf(cells, "partId"); const partId = explicitPartId ??
rawIpn;`. So for the 190 production Parts, "`partId == TST-####`" is not evidence that `partId` is the
authoritative external identifier — it is the trace of `partId` having been *grandfathered from*
`internalPartNumber`'s external legacy value, exactly as `part-master-architecture.md:27` names the rule.

## 4. Why the production-evidence framing that started this conflict was incomplete

`docs/orchestration/metadata-program/ledger.json`'s own note on this item is honest about the origin: one
lane (Transfers) called `partId` "the Part's SKU business identifier, not a document id"; another
(Purchase Orders) called raw `partId` display an id-as-content gap; the controller recorded the first
uncritically. The INV-CONVERGENCE-B evidence-review (§5, `evidence-review.md`) reached `JOIN_CLEAN` on a
narrower question than "which field is the business reference" — it proved `partId` is a safe, exact
**join key** against the static catalog (a data-plumbing question), then extrapolated past its own evidence
to also say `internalPartNumber` "is not the operational key" — a claim its own caveats (§2.1: *"Field
coverage: … not `internalPartNumber`… marked `NOT_EXPOSED_IN_SOURCE`"*) don't support, and which the write
path, CSV migration business-key requirement, and the governed alias-preserving rename all contradict.
`partId` being a reliable *join key* and `internalPartNumber` being the *business reference* are not in
tension — they are the two different jobs ADR-008 assigns the two fields, and both evidence sets are
correct about the job they each actually tested.

## 5. Conclusion

**RESOLVED.**

`part.js`'s current declaration is correct and needs no change:
`identity: makeIdentity({ nameField: "name", referenceField: "internalPartNumber" })`, with `partId`
declared separately as `type: "ID"` (not an identity field). This matches the Owner-ratified architecture
(`DECISIONS.md #40`, `ADR-008-part-master.md`, `part-master-architecture.md` §1) and is not actually
contradicted by the INV-CONVERGENCE-B production evidence once that evidence's own scope (join-key
correctness, not business-reference identity) is read precisely (§4). `partId` is the opaque, immutable
storage/join identity — grandfathered to the legacy SKU string for continuity, never rewritten thereafter.
`internalPartNumber` is the governed, human-facing business reference, deliberately mutable, with an
alias-preservation mechanism already implemented for exactly the renumbering case (manufacturer changes)
this task flagged as a complication. The two fields hold identical values today for every production Part
purely because migration grandfathered them that way, not because they are the same concept.

**One real, currently-live gap this audit surfaces but does not fix** (out of this lane's write scope —
code, none of it, was touched): the *display* layer — `PartDetail.jsx`'s "SKU" context-band chip, global
search results (`searchProviders.js`), Receiving, and Purchase Orders — all source their shown string from
`partId` (via the `sku` alias produced by `partsCompatibilityAdapter.js`/`partDetailView.js`), not from
`internalPartNumber`. That is invisible today because the two values are identical for all 190 Parts, but
it means those surfaces are not reading the governed `referenceField`. If/when a Part's
`internalPartNumber` is renumbered under governance (`partMasterCommands.ts:293-344`, already implemented),
those display surfaces would keep showing the stale, original grandfathered `partId` string forever — the
exact "record id as business identity" anti-pattern `DECISIONS.md #106` forbids, wearing a "SKU" label.
This is a distinct, actionable follow-up (repoint those four display sites at `internalPartNumber`) and
should be recorded as its own ledger item rather than folded into this identity question.

## 6. What could not be established

- Whether any Part in the live production `parts` collection today actually has `internalPartNumber !=
  partId` was not independently verified by a fresh read — the closest evidence
  (`production-parts-export.evidence.json`, describing the removed read-back) records that the column
  was explicitly not captured. Every code path examined (write,
  migration, seed) is consistent with the two always being equal in practice so far, but "not established"
  by direct production read for this audit.
- Whether any deployed UI screen other than the four named in §5 sources a part-identifier string from
  `internalPartNumber` versus `partId`/`sku` was not exhaustively enumerated across every module; the audit
  covered Part detail, search, receiving, purchasing, Work Order parts planning, inventory ledger, scanning,
  and CSV import/export as instructed, plus the Part Master admin CRUD screen found along the way.
