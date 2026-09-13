---
title: OD-7 DECISION BRIEF — where family-level handoff validation must live
lane: OD-7-PREPARATION
revision_2_lane: OD-7-FINAL   # appended 2026-09-13, same baseline; §§0-13 NOT rewritten
mode: EVIDENCE_WRITE
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
prepared: 2026-09-13
scope: one decision only — OD-7. Prepares it; does not answer it.
authority_read: >-
  DECISIONS #180 (OD-1), #181 (MI-N), #182 (OD-6 + MI-P + MI-Q + MI-R) — all on
  ref `int/a-correctness-register`. This branch's docs/DECISIONS.md ends at #179.
supersedes: []
superseded_by: []
---

# `OD-7` DECISION BRIEF — WHERE FAMILY-LEVEL HANDOFF VALIDATION MUST LIVE

> **WHAT THIS IS.** The `OD-7` row of `OD-PACKET-001-006-007.md` §4, re-verified at baseline and
> re-reasoned **from** the five now-closed rulings. The packet is the canonical evidence artifact and
> **is not edited by this brief.** Where this brief corrects it, both readings are cited (§9).
>
> **WHAT THIS IS NOT.** Not an answer. Not a design. No schema, no field names, no enum names —
> `#182` §3 withholds those explicitly (*"Exact enum and schema names are NOT authorized"*).
>
> **CITATION RULE.** Every code claim carries `OBSERVED AT: 64008d5a` and `file:line`. Rulings are
> cited by number and ref, never by relative link.
>
> **REVISION 2 — READ §14 ONWARD.** This file was revised in place by lane **OD-7-FINAL** at the same
> baseline. **Nothing in §§0–13 is rewritten**; REVISION 2 is **appended** as **§14** (the three
> options — **(a)**, **(b)**, **(c)** — against all **eleven** Owner-specified fields, including the
> five REVISION 1 never analysed: **ATOMICITY · FAILURE MODE · ACCOUNTABILITY CONTINUITY ·
> OWNER/ACCOUNTABLE/ASSIGNEE DISTINCTNESS · MIGRATION/COMPATIBILITY**), **§15** (`M-1`…`M-4` with
> their alternatives and evidence, **no inferred Owner answer**), **§16** (corrections, including
> **four citation errors in REVISION 1** — `Y-1`…`Y-5`), and **§17** (new `UNPROVEN` / `NOT_RUN`).
> **THREE OPTIONS, NOT FOUR:** `(d-place)` was eliminated in §6.3 and `(d-wire)` absorbed into settled
> authority; that reasoning is carried, not re-opened. **RECOMMENDATION REMAINS `NONE`.**

---

## 0. DECISION ID · EXACT QUESTION

| Field | Content |
|---|---|
| **DECISION ID** | **`OD-7`** — `docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md` §3. Provenance: OWN-E2E `OD-OWN-001` (that lane's headline decision). Prepared as `OD-PACKET-001-006-007.md` §4 |
| **EXACT QUESTION — the packet's wording, verbatim** | ***"Where must family-level handoff validation live?"*** Concretely: *should `auditEventWriter` consult the ownership matrix, or must `OWNERSHIP_HANDOFF` be rejected there unless staged through the builder?* |
| **AXIS WARNING, carried from packet `C-7`** | **`OD-7` IS A PLACEMENT QUESTION, NOT AN ORDERING QUESTION.** The ordering constraint (*"decide this before wiring anything"*) is a **carried constraint attached** to the row, not the row. A prior pass mislabelled this as "HANDOFF WIRING ORDER" and it cost a round. Ruling the label instead of the row would leave the actual blocker untouched |
| **RELATED BUT NOT FOLDED IN** | `OD-8` (ownership-write exposure) · `OD-11` (does a handoff require acceptance?) · `OD-11a` (orphan policy) · `OD-11c` (escalation modality; may a handoff source represent a departure?) · `OD-18` (`reorder_requests.currentOwner`) · `OD-5` (the unmarked `record-ownership.md` cascade contradiction) |

---

## 1. WHAT THE FIVE RULINGS SETTLED THAT BEARS ON THIS

All five are closed. `docs/DECISIONS.md` **on this branch ends at #179**; the rulings live on ref
**`int/a-correctness-register`**.

| Ruling | Ref / commit | What it settles for `OD-7` |
|---|---|---|
| **#180 — `OD-1` APPROVED** | `int/a-correctness-register` @ `20830caf`, `docs/DECISIONS.md:6432` | **ACCOUNTABLE PERSON is a distinct first-class axis**, independent of RECORD OWNER · ASSIGNEE · MANAGER · ESCALATION OWNER · OPERATING COMPANY · DOMAIN STEWARD · JOB ROLE · SECURITY ROLE. Exactly one accountable person per **ACTIONABLE** item **at every point in time**. **Invariant 7: "Handoff semantics must guarantee no responsibility gap."** ← the binding invariant for `OD-7`. Invariant 6: historical accountability must remain auditable. Invariant 10: **no generic `ownerId`/`accountableId` shortcut across families** |
| **#180's own withholding** | same, `:6497-6500` | *"**IMPLEMENTATION IS NOT AUTHORIZED.** No ACCOUNTABLE PERSON storage, migration, enforcement, **handoff** or backfill may begin until **`OD-6`** resolves person-reference validity and census behaviour **and the remaining dependency decisions are reconciled**."* **#180 names handoff and forbids beginning it.** This is load-bearing against any reading of invariant 7 as a mandate to wire now |
| **#181 — `MI-N` CLOSED** | @ `79962104`, `:6518` | ACCOUNTABLE PERSON is a **separately carried fact** on Opportunity / Sales Agreement / Sales Order, never permanently derived from RECORD OWNER. `accountablePerson = ownerEmployeeId` as a permanent computed identity is **forbidden**. **"A business action intending both must be an explicit governed operation recording both changes."** Historical facts are not rewritten |
| **#182 — `OD-6` RULED** | @ `e5c4e983`, `:6604` | **TWO-LAYER PERSON-REFERENCE CONTRACT.** Layer 1 referential integrity in resolution/derivation — a person reference is **not** valid merely because it is a non-empty string, has type `USER`, or parses; **NON-EXISTENT and DELETED/UNRESOLVABLE must not produce the same authoritative `RESOLVED` result as a real Employee**; applies to RECORD OWNER (PERSON/USER) **and** ACCOUNTABLE PERSON, **independently validated**. Layer 2 current-accountability eligibility in the census and enforcement gate. Four distinguishable states **A/B/C/D** (semantic contract; **names not authorized**). `NONE` prohibited for actionable accountability. Gate **may not close** on a census structurally incapable of detecting invalid person owner or missing/invalid accountable person. **No backfill authorized** |
| **#182 §6 — `MI-P` CLOSED** | same | **YES**, accountability enters responsibility-integrity measurement — **but NOT by putting `accountablePerson` into `ownershipMatrix.ownerFields`.** Acceptable: a **multi-axis responsibility census**, or a **dedicated accountability census composed into the gate**. Eventual axes: **RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT where governed · ESCALATION where governed.** *"Prepare the smallest design consistent with this ruling; do not implement the final architecture"* |
| **#182 §7 — `MI-Q` CLOSED** | same | **YES** — all three commercial families use the approved creation shape. Sales Agreement gets **no** EXPLICIT→REFUSE-only exception. **`creditedSalespersonId` semantics must not be silently changed** |
| **#182 §4 — `MI-R` CLOSED** | same | **Eligibility ≠ execution authority.** *"`VALID FOR CURRENT ACCOUNTABILITY` does NOT mean `CURRENTLY AUTHORIZED TO PERFORM EVERY ACTION`."* An accountable person **may delegate execution**. Eligibility must **not** be *"has the capability to perform the assigned command"*; at minimum **governed employment/person status**; further company/domain constraints **per family, never invented globally** |
| **#182 Status — the new ordering fact** | same, `:6735-6740` | *"**ENGINEERING IMPLEMENTATION NOT YET AUTHORIZED.** The 29 accountability implementation items … **remain unimplemented until `OD-7` and any directly dependent decisions are reconciled.**"* **`OD-7` is now the named remaining gate.** This did not exist when the packet was written and it changes option (d) materially (§6) |

### The four consequences of the rulings that reshape `OD-7`

| # | Consequence | Which ruling |
|---|---|---|
| **R-i** | **`OD-7` is now the last gate, not the last-in-line.** `OD-6`'s prerequisite is discharged; `#182` names `OD-7` as the condition on 29 items. The packet's *"strongest argument for `OD-7` being last, not first"* (§1, `:69`) is now an argument about **wiring order**, and `OD-7` as a **placement ruling** is due **now** | #182 Status |
| **R-ii** | **A handoff validator must validate a PERSON target, not only a family.** `#182` Layer 1 applies to RECORD OWNER type PERSON/USER. The builder's `newOwner` check is `isTypedOwner` — **shape only** (`ownershipHandoffCommand.ts:126-128`) — and so is the writer's (`auditEventWriter.ts:541`). Family placement alone cannot satisfy `#182` | #182 §1 |
| **R-iii** | **Family-level refusals and person-level refusals are two layers, and `OD-7` as worded asks about only one.** *"Family-level handoff validation"* is the matrix layer. `#182` establishes that the target-validity layer is a **different** question with a **different** home (resolution/derivation vs census/gate). `OD-7`'s answer must therefore say where the **family** layer lives **without** implying it is the whole of handoff validation | #182 layer table |
| **R-iv** | **The matrix is an ownership matrix, and `MI-P` forbids widening it to carry accountability.** So the artifact option (a) would have the writer consult is, by ruling, **axis-incomplete and must stay that way** (§7) | #182 §6 |

---

## 2. CURRENT EOS FACT — RE-VERIFIED AT `64008d5a`

### 2.1 The builder — `functions/src/ownership/ownershipHandoffCommand.ts` (206 lines)

| Fact | Evidence | Marking |
|---|---|---|
| **All five family-level refusals live only here**, line numbers **confirmed exactly as the packet states them**: `FAMILY_UNKNOWN` `:92` · `FAMILY_PARTICIPATING_COMPANIES` `:103` · `FAMILY_NOT_OWNABLE` `:112` · `FAMILY_IMMUTABLE` `:118` · `OWNER_TYPE_MISMATCH` `:131,149`; plus `NEW_OWNER_INVALID` `:127` | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **The builder is not a stub.** It also refuses `ACTOR_REQUIRED` `:86` · `RECORD_REQUIRED` `:123` · `PREVIOUS_OWNER_REQUIRED` `:139` · `PREVIOUS_OWNER_INVALID` `:145` · `NO_OP` `:155` · `SOURCE_INVALID` `:163` · `REASON_INVALID` `:168`. **12 distinct refusal codes** | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **`buildOwnershipHandoff` accepts 14 families and refuses 37** — **confirmed, and the refusal split reproduced exactly**: `FAMILY_IMMUTABLE` ×12 · `FAMILY_NOT_OWNABLE` ×24 · `FAMILY_PARTICIPATING_COMPANIES` ×1. **The matrix holds 51 families**, and 14 + 37 = 51 | Refusal order replayed against the matrix literal (table below) | `[EXECUTED — transliteration, §8]` |
| **`buildOwnershipHandoff` is PURE and performs no person-reference validation.** `newOwner`/`previousOwner` are checked by `isTypedOwner` (`:126,144`) — **shape only.** `USER:EMP-DOES-NOT-EXIST` passes | Read verbatim; no Firestore, no `await`, no `async` in the file | `[OBSERVED AT: 64008d5a]` |
| **`stageOwnershipHandoff` is a two-line wrapper**: `return stageAuditEvent(writer, buildOwnershipHandoff(input, ctx))` (`:200-206`). It stages onto a caller-supplied writer and **never commits** | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **`H6` — NO CASCADE — structurally satisfied.** `OwnershipHandoffInput` (`:51-64`) carries a single `recordId: string`. **No array, no list, no children flag** anywhere in the file | Read verbatim | `[OBSERVED AT: 64008d5a]` |

**The 51-family partition, reproduced (the packet's counts are correct):**

| Builder outcome | n | Families |
|---|---|---|
| **ACCEPT** (`transfer: "HANDOFF"`, `ownerClass` PERSON or COMPANY) | **14** | `account` `contact` `location` `opportunity` `salesAgreement` `salesOrder` *(USER)* · `workOrder` `workOrderLegacy` `reorderRequest` `warehouse` `mobileLocation` `truck` `supplierCompanyTerms` `equipment` *(COMPANY)* |
| **`FAMILY_PARTICIPATING_COMPANIES`** | **1** | `transferOrder` |
| **`FAMILY_NOT_OWNABLE`** | **24** | `part` `partAlias` `partSupplierItem` `manufacturer` `equipmentModel` `supplierCatalogItem` `supplier` `user` `employee` `technician` `permission` `role` `roleAssignment` `accessRequest` `auditEvent` `reportDefinition` `salesTerritory` `coverageAssignment` `counter` `inventorySyncStatus` `locationTruckClaim` `technicianAvailability` `technicianBlockedTime` `operatingCompany` |
| **`FAMILY_IMMUTABLE`** | **12** | `invoice` `payment` `paymentApplication` `invoiceAdjustment` `refund` `stockLocation` `inventoryTransaction` `inventoryAction` `receivingOrder` `cycleCount` `purchaseOrder` `reorderPurchaseOrder` |
| **`FAMILY_UNKNOWN`** | — | everything else, including `"notAFamilyAtAll"` |

*The packet's independent derivation (`grep -c 'transfer: "HANDOFF"'` = 13 lines = 12 single-family
literals + one two-family spread at `:320` → 14) is **confirmed**: `:120,128,135,149,158,168,251,269,289,365,379,462` plus the `warehouse`/`mobileLocation` spread at `:320`.*

### 2.2 The live writer — `functions/src/access/auditEventWriter.ts` (929 lines)

| Fact | Evidence | Marking |
|---|---|---|
| **Never imports `ownershipMatrix`.** Its only ownership import is `isTypedOwner, type TypedOwner` from `../ownership/typedOwner` at **`:58`** | `grep 'ownershipMatrix\|ownershipFamily\|OWNERSHIP_MATRIX'` → **0 hits** | `[OBSERVED AT: 64008d5a]` |
| **Validates `targetType` as nothing more than a non-empty string** — **`:470-471`** verbatim: `if (!input.targetType \|\| typeof input.targetType !== "string") { throw new AuditEventValidationError("targetType is required"); }` | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **`OWNERSHIP_HANDOFF` is a valid `AuditAction`** — runtime array `:256`, union member `types/access.ts:510`, module constant `OWNERSHIP_HANDOFF_ACTION` `:437` | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **The handoff block checks `objectId` `:520-534` · `newOwner` shape `:541` · `previousOwner` undefined-vs-null `:549,554` · the no-op `:557-564` · `handoffSource` against the closed set `:566-569` — and no family semantics at all** | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **The three `OWNERSHIP_HANDOFF_SOURCES` are `DIRECT_HANDOFF`, `CUSTOMER_HANDOFF_REVIEW`, `ADMIN_CORRECTION`** — `:429-433`. **No escalation source. No departure source.** | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **`assertValid` is a SINGLE CHOKE POINT.** All three write entry points funnel through it: `stageAuditEvent` `:785` · `stageAuditEventWithId` `:820` · `recordStandaloneAuditEvent` `:846` (which delegates to `stageAuditEvent`). **There is no fourth write path and no update/delete function in the module at all** (`:772-778` states the append-only posture) | Read verbatim | `[OBSERVED AT: 64008d5a]` — **NEW, not in the packet; see §9 `X-1`** |
| **The writer ALREADY implements per-action closed-carrier gating three times over**: report actions `:514` · handoff action `:520` · field-change actions `:614` against `FIELD_CHANGE_ACTIONS` `:414-416`. Every one refuses its fields on a non-matching action (`:531-535`, `:574-580`) | Read verbatim | `[OBSERVED AT: 64008d5a]` — **NEW; see §9 `X-2`** |
| **`EXECUTED` (OWN-E2E Probe B, carried): the live writer accepted an `OWNERSHIP_HANDOFF` for `invoice`, `payment`, `inventoryTransaction`, `part`, `auditEvent`, `roleAssignment`, `transferOrder`, `"notAFamilyAtAll"`, and an `account` given a COMPANY owner** | Carried from OWN-E2E; **not re-executed here** (§8) | `[EXECUTED — carried, not re-run]` |

### 2.3 Reach — the importer count is **WRONG IN THE PACKET**

| Fact | Evidence | Marking |
|---|---|---|
| **`auditEventWriter` has 44 importing modules in `functions/src`, not 50.** **50 is the number of files that MENTION the string `auditEventWriter`**; six of those mention it **only in prose comments** and import nothing: `access/claimsWriter.ts:14` · `eosCommercial/commercialOwnershipAuthority.ts:79,88` · `equipmentCompatibility/commands.ts:78` · `truckRegistry/types.ts:30` · `types/access.ts:302,320,481,506,515,522,537,591` · `types/workOrder.ts:140` | `git grep -l 'auditEventWriter'` = **50**; `git grep -l -E 'from "[^"]*auditEventWriter(\.js)?"'` = **44**; set difference inspected line by line | `[OBSERVED AT: 64008d5a]` — **CORRECTION, §9 `X-3`** |
| **Of the 44, one is the builder itself** (`ownership/ownershipHandoffCommand.ts`) **and one is read-only** (`access/recordChangeHistoryReadService.ts`, which imports `listAuditEventsForRecord` and nothing else). **42 are write-capable non-builder importers** | Import specifiers extracted per file | `[OBSERVED AT: 64008d5a]` |
| **`functions/src/index.ts` contains ZERO occurrences of `ownership`, case-insensitive** — confirming no callable, route or deployed surface reaches the builder | `grep -ic 'ownership'` → **0** | `[OBSERVED AT: 64008d5a]` |

### 2.4 The one live builder caller — and why `(b)` has **no working precedent**

| Fact | Evidence | Marking |
|---|---|---|
| **The only non-test caller of `stageOwnershipHandoff` is the operator CLI `functions/scripts/assignWarehouseRootCompany.js:72` (require) and `:234` (call), inside a real transaction, for one COMPANY family** — **confirmed** | Repo-wide grep for `stageOwnershipHandoff\|buildOwnershipHandoff` | `[OBSERVED AT: 64008d5a]` |
| **The packet's two "prose only" matches are confirmed prose only**: `eosCommercial/commercialOwnershipAuthority.ts:274` and `ownership/ownershipMatrix.ts:211` | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **The CLI's handoff input comes from a `functions/src` module the packet does not name: `functions/src/ownership/warehouseRootCompanyAssignment.ts:373-395`, `assignmentHandoffInput()`** | Read verbatim | `[OBSERVED AT: 64008d5a]` — **ADDITION, §9 `X-4`** |
| **That function's return type pins `previousOwner: null` (`:376,387`) — it is STRUCTURALLY INCAPABLE of producing a transfer**, and its own docstring says so: *"The handoff input for one first assignment: previousOwner is NULL"* (`:371-372`). Its `source` is `"ADMIN_CORRECTION"` (`:389-393`) with the comment *"`OWNERSHIP_HANDOFF_SOURCES` has none for a first assignment, which the reconciliation recorded as an open gap"* | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **The command REFUSES a different company outright**: `classifyWarehouseAssignment` returns `REFUSED_COMPANY_MISMATCH` with detail *"no governed warehouse company reassignment semantics exist"* (`:277-284`); the same-company case is `ALREADY_ASSIGNED` → *"IDEMPOTENT SUCCESS. No write, no handoff, no audit event"* (`:273-276`). Header contract `:23-30`: `unset + governed ACTIVE company -> ASSIGN` · `same company -> IDEMPOTENT SUCCESS` · `different company -> REFUSE`, and *"NO REASSIGNMENT"* | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **CONCLUSION, and it is STRONGER than the packet states it.** The single live builder path has never exercised, and **cannot** exercise, a handoff with a non-null `previousOwner`. So **`(b)` has no working precedent — not merely no product path.** The one thing that has ever gone through the builder is a **first assignment**, which is the case where there is no prior holder to release and therefore **the one case in which invariant 7 cannot be violated** | Derived from the above | `[OBSERVED AT: 64008d5a]` |
| **A second `functions/src` ownership module deliberately emits no handoff**: `ownership/warehouseCanonicalIdRepair.ts:20` — *"which is also why it emits no `OWNERSHIP_HANDOFF`"* — and `functions/test/warehouseCanonicalIdRepair.test.mjs:164` asserts the operator never references it | Read verbatim | `[OBSERVED AT: 64008d5a]` |

### 2.5 The one place ownership genuinely moves in production

| Fact | Evidence | Marking |
|---|---|---|
| **`field-ops-app-vite/src/modules/sales/OwnerSelect.jsx:21`** is a real owner-reassignment picker over the employee directory, rendered from `modules/sales/opportunitySections.jsx:96` (`case "owner"`), saved via `hooks/useOpportunitySectionSave.js:72` → `services/opportunityCommandClient.js:117,131` → the `updateOpportunity` callable. **Real, live, Opportunity-only** | Traced end to end | `[TRACED @ 64008d5a]` |
| **The server records it as a field diff**: `functions/src/opportunity/opportunityCommands.ts:312-318` records `("ownerEmployeeId", cur.ownerEmployeeId, input.ownerEmployeeId)` into `changes[]`. **Packet line numbers confirmed** | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **It emits NO `OWNERSHIP_HANDOFF`** — `functions/src/opportunity/opportunityCallables.ts:337-348` stages `action: "updateOpportunity"`. `opportunityCommands.ts` does not import `auditEventWriter` at all (0 hits) | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **AND IT RECORDS THE CHANGED FIELD *NAMES* ONLY — no before, no after.** `opportunityCallables.ts:348`: `` summary: `updated opportunity ${id}: ${changes.map(c => c.field).join(", ")}` ``, with the in-file comment at `:341-347`: *"**CHANGED FIELD NAMES ONLY, and that is a contract limit rather than a choice.** … **BEFORE/AFTER VALUES CANNOT BE RECORDED** without altering the governed audit schema"* | Read verbatim | `[OBSERVED AT: 64008d5a]` — **ADDITION, §9 `X-5`** |
| **The carrier for before/after EXISTS on the same contract and is closed to this action.** `RecordAuditEventInput` carries `fieldKey` / `previousValue` / `newValue` (`:404-406`), gated by `FIELD_CHANGE_ACTIONS` (`:414-416`) whose membership is **exactly one action: `"updateEmployeeProfile"`** | Read verbatim | `[OBSERVED AT: 64008d5a]` — **ADDITION, §9 `X-5`** |
| **Consequence for `#181`.** `#181` requires that a business action intending both an owner change and an accountability change be *"an explicit governed operation recording both changes."* The live path **cannot record even ONE of them** — only that `ownerEmployeeId` was among the fields touched. So the live path is disqualified by `#181` for ownership alone, before accountability is considered | Derived | `[OBSERVED AT: 64008d5a]` |
| **No other client owner-move surface exists.** Zero hits for `changeOwner` / `transferOwnership` in `field-ops-app-vite/src`; every `reassign` hit is technician assignment | Carried from Census §4.5; consistent with the trace above | `[TRACED]` |
| **The new owner id is never validated against a real Employee on this path** — the only check is `nonEmpty(input.ownerEmployeeId)` (`opportunityCommands.ts:313-315`). `resolveCreationOwner` runs at **creation** (`:159`), never on update. **This is `#182` Layer 1, live, on the only production ownership move EOS has** | Read verbatim | `[OBSERVED AT: 64008d5a]` |

### 2.6 The accountability axis has no carrier at all

| Fact | Evidence | Marking |
|---|---|---|
| **`accountablePerson` / `accountableId` / `ACCOUNTABLE_PERSON` appear in ZERO files in the entire repository at baseline** | Repo-wide grep → **0 files** | `[OBSERVED AT: 64008d5a]` |
| **The census is single-axis.** `functions/src/ownership/ownershipCensus.ts` buckets `RESOLVED` / `UNRESOLVED` / `AMBIGUOUS` / `OWNERLESS` off `ownerFields` only (`:82-85,98`); *"A family with NO declared `ownerFields` is OWNERLESS by construction"* (`:98`) | Read verbatim | `[OBSERVED AT: 64008d5a]` |
| **So `#180` invariant 1 is not detectable and `#182` §9's gate cannot close** — exactly as `#180` states of itself at `int/a-correctness-register:docs/DECISIONS.md:6505-6510` | Derived | `[OBSERVED AT: 64008d5a]` |

### 2.7 `OD-8` — the ungoverned client-direct path, re-verified by STATIC READ

| Fact | Evidence | Marking |
|---|---|---|
| **`accountOwner` appears NOWHERE in `firestore.rules`** — zero hits, and no hits for `ownerEmployeeId` either | `grep` over `firestore.rules` @ baseline | `[SOURCE READ — NOT EXECUTED]` |
| **`accounts` update is `isAdminOrDispatcher()` gated with only two governed fields validated** — `firestore.rules:1335-1337`; the governed set is `paymentTerms` + `taxStatus` only (`accountGovernedFieldsValid` `:1298-1300`, `accountGovernedFieldsUnchanged` `:1306-1309`). **A dispatcher "may freely edit every OTHER field"** — the Rules' own comment, `:1303-1305` | Read verbatim | `[SOURCE READ — NOT EXECUTED]` |
| **`locations` and `contacts` are fully open to admin/dispatcher with no field constraint**: `allow create, update: if isAdminOrDispatcher();` — `:1343` and `:1557` | Read verbatim | `[SOURCE READ — NOT EXECUTED]` |
| **`U-N` STANDS: this is the one headline claim resting on static read.** No emulator available (no `java` on this machine; port 8080 held). Constraint 5 is therefore **evidenced but not executed** | §8 | `[NOT_RUN]` |

---

## 3. WHY IT MUST BE DECIDED NOW

| # | Ground | Citation |
|---|---|---|
| **1** | **`#182` names `OD-7` as the remaining gate on 29 implementation items.** *"remain unimplemented until `OD-7` and any directly dependent decisions are reconciled"* | `int/a-correctness-register:docs/DECISIONS.md:6735-6740` |
| **2** | **`#180`'s own prerequisite for handoff work is now discharged.** It withheld handoff *"until `OD-6` resolves person-reference validity and census behaviour and the remaining dependency decisions are reconciled."* `OD-6` is resolved; `OD-7` is the named remainder | `:6497-6500` + `:6735-6740` |
| **3** | **The placement is free exactly once, and that is now.** `buildOwnershipHandoff` / `stageOwnershipHandoff` have **no callable, no route, no component** (`index.ts` = 0 `ownership`). There is no surface to migrate and no consumer to break | §2.3 |
| **4** | **`#181` requires a governed operation that does not exist and cannot be built on the live path.** The live path records changed field **names** only, and the before/after carrier is closed to it | §2.5 |
| **5** | **The shortest wiring is the corrupting one.** The live writer accepts a handoff for 37 families it must refuse and for names that are not families. A future wirer reaching for `stageAuditEvent` directly gets none of the 12 refusals | §2.1–§2.2, Probe B |
| **6 — COUNTERWEIGHT, and it is real** | **Nothing can pass `OWNERSHIP_HANDOFF` today.** §4 enumerates all 44 importers: **zero of the 42 write-capable non-builder importers can reach the handoff branch without a source change.** The urgency is about the writer's **contract**, not a live production exposure. This is `U-NEW-1` answered, and it cuts **against** urgency | §4 |

---

## 4. `U-NEW-1` ANSWERED — THE ENUMERATION OF EVERY `auditEventWriter` IMPORTER

> **`U-NEW-1`, the packet's own flagged overstatement risk:** *"no lane has enumerated which of the 50
> `auditEventWriter` callers could pass `OWNERSHIP_HANDOFF`."* **Enumerated below.**
>
> **METHOD.** For each importing module at `64008d5a`: extract the import specifier; extract every
> `action:` value reaching a write entry point; resolve each named constant, each ternary, and each
> parameter to its declared type; for every module-private helper whose parameter is typed on the
> full `AuditAction` union, read **all** in-module call sites. Also grepped all 44 for any
> client-derived `action` (`data.action` / `request.*.action` / `body.action` / `payload.action` /
> `input.action`).

### 4.1 Verdict

| | Finding |
|---|---|
| **ANSWER** | **ZERO.** Of the **42** write-capable non-builder importers, **none can pass `OWNERSHIP_HANDOFF` at `64008d5a` without a source change.** The only module that passes it is **the builder itself** (`ownership/ownershipHandoffCommand.ts:180`) |
| **NO CLIENT STRING REACHES `action`** | The only client-supplied value named `action` anywhere in the 44 is `transitionWorkOrder.ts`'s **workflow** `ActionName` (`:68`), validated against `ACTION_TO_STATUS` at `:109-111` and **never** used as the audit action — every audit action in that file is a literal (`:563,584,610,628,647`). `completeAssignedJob.ts:160,169` reads `input.action` of its **own** idempotency descriptor, not a client field |
| **NEAREST-TO-REACHABLE SET — 4 modules, 6 signatures** | Module-**private** helpers whose `action` parameter is typed on the **whole** `AuditAction` union (which *includes* `OWNERSHIP_HANDOFF`, so a one-token edit at any in-module call site would type-check silently). **Every** call site of all six passes a literal, verified exhaustively |
| **CONSEQUENCE FOR THE PACKET** | The packet's *"`OWNERSHIP_HANDOFF` is reachable **the moment any of the 50 callers passes the action**"* is **true as a statement about the writer's contract and false as a statement about any existing caller.** The packet flagged this risk itself; it is now resolved, **in the direction that lowers urgency.** The safety inversion is real; its **exposure** is a code-change risk, not a live production path |

### 4.2 Classification legend

| Code | Meaning | Can pass `OWNERSHIP_HANDOFF` without a source change? |
|---|---|---|
| **L** | every audit action is a hardcoded string literal at the call | **No** |
| **C** | literal pinned in a module `const` | **No** |
| **T** | ternary over two literals | **No** |
| **U** | parameter typed on a **narrow string-literal union** that excludes `OWNERSHIP_HANDOFF` — a compile error to pass it | **No — type-blocked** |
| **A** | module-**private** helper typed on the **full `AuditAction` union**; all in-module call sites pass literals | **No — but one token away, with no type error** |
| **R** | imports a read function only | **No — cannot write** |
| **B** | the builder | **Yes — by design; it is the authority** |

### 4.3 The 44, exhaustively

| # | Module (`functions/src/…`) | Imports | Class | Audit action(s) — evidence |
|---|---|---|---|---|
| 1 | `access/adminCredentialCommands.ts` | `recordStandaloneAuditEvent`, `stageAuditEvent` | **A** + L | `audit()` `:374` and `auditDenial()` `:382` take `action: AuditAction`; **all 14 call sites literal** (`:572,576,580,589,595,600,601,614,616,634,654,662,683`); plus literals `:672,721,728` |
| 2 | `access/employeeProfileCommands.ts` | `auditEventDocRef`, `recordStandaloneAuditEvent`, `stageAuditEventWithId` | **C** | `const UPDATE_ACTION: AuditAction = "updateEmployeeProfile"` `:102`; used `:483,628`. Annotated on the union, **value pinned** |
| 3 | `access/recordChangeHistoryReadService.ts` | `listAuditEventsForRecord` | **R** | no write entry point imported |
| 4 | `access/trustedWriterCommands.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** + T | 9 literals; ternary over two literals `:2228`. `:489,527` `action: string` are **fingerprint** objects, not audit inputs |
| 5 | `completeAssignedJob.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **C** | `const AUDIT_ACTION = "completeAssignedJob" as const` `:50`; used `:210` |
| 6 | `coverage/coverageCallables.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** | `:57,81` |
| 7 | `createWorkOrder.ts` | `auditEventDocRef`, `stageAuditEvent`, `stageAuditEventWithId` | **L** | `:196,205` |
| 8 | `crmActivity/crmActivityCallables.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:72` |
| 9 | `cycleCount/cycleCountCallableWiring.ts` | `stageAuditEvent` | **U** | `:84` `a.action`; `CycleCountAuditInput.action` is a **5-member literal union**, `cycleCount/cycleCountCommand.ts:103` |
| 10 | `cycleCount/cycleCountSheetCallables.ts` | `stageAuditEvent` | **U** | `:59` `a.action`; `SheetAuditAction` is an **8-member literal union**, `cycleCount/cycleCountSheetCommand.ts:83-85` |
| 11 | `equipmentInstall/installCallableWiring.ts` | `stageAuditEvent` | **L** | `:66` |
| 12 | `finance/adjustmentCallables.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** | `:96` |
| 13 | `finance/invoiceCallables.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** | `:100` |
| 14 | `finance/paymentCallables.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** | `:99` |
| 15 | `finance/refundCallables.ts` | `stageAuditEventWithId`, `auditEventDocRef` | **L** | `:84` |
| 16 | `inboundWork/attachmentCustody.ts` | `recordStandaloneAuditEvent` | **L** | `:271` |
| 17 | `inboundWork/emailAdminCommands.ts` | `stageAuditEvent` | **L** | `:48,88,153` |
| 18 | `inboundWork/emailConnectionCommands.ts` | `recordStandaloneAuditEvent` | **L** | `:83,154,187,220,311,353` |
| 19 | `inboundWork/emailDeliveryService.ts` | `stageAuditEvent`, `recordStandaloneAuditEvent` | **L** | `:138,365` |
| 20 | `inboundWork/inboundDecisionCommands.ts` | `stageAuditEvent` | **L** | `:207,215,264,326` |
| 21 | `inboundWork/inboundIntakeCommand.ts` | `stageAuditEvent` | **L** | `:201,242,312` |
| 22 | `inventoryLocation/stockRelocationCallables.ts` | `stageAuditEvent` | **L** | `:49` |
| 23 | `inventoryReceiving/receivingCallableWiring.ts` | `stageAuditEvent` | **U** | `:98` `a.action`; `ReceiveAuditInput.action` is the **single literal** `"receiveInventoryStock"`, `inventoryReceiving/receiveInventoryStockCommand.ts:107` |
| 24 | `inventoryTransfer/transferCallableWiring.ts` | `stageAuditEvent` | **U** | `:76` `a.action`; `TransferAuditInput.action` is a **4-member literal union**, `inventoryTransfer/transferOrderCommand.ts:101` |
| 25 | `opportunity/closeOpportunityAsWon.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:224,353,362,371` |
| 26 | `opportunity/createSalesOrderFromOpportunity.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:276` |
| 27 | `opportunity/opportunityCallables.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:126,172,339` — **`:339` is the live ownership-move event (§2.5)** |
| 28 | **`ownership/ownershipHandoffCommand.ts`** | `OWNERSHIP_HANDOFF_SOURCES`, `stageAuditEvent` | **B** | **`:180` — the only `action: "OWNERSHIP_HANDOFF"` in `functions/src` outside the writer's own constants** |
| 29 | `partMaster/partAliasCommands.ts` | `stageAuditEventWithId`, `recordStandaloneAuditEvent` | **L** + U | literals `:121,154`; 2-member literal union `:175` |
| 30 | `partMaster/partMasterCommands.ts` | `stageAuditEventWithId`, `recordStandaloneAuditEvent` | **A** + L | `requireCapabilityOrAudit(… action: AuditAction …)` `:134`; **all 6 call sites literal** (`:244,313,439,499,550,603`); plus literals `:270,388,411,469,522,575,631` |
| 31 | `partMaster/partSupplierItems.ts` | `stageAuditEventWithId` | **L** | `:351,406,455,520` |
| 32 | `performance/performanceGoalCommands.ts` | `recordStandaloneAuditEvent`, `stageAuditEventWithId` | **U** + T + L | `auditAction` param is a **4-member literal union** `:109`, used `:140`; ternary over two literals `:401`; literals `:268,489` |
| 33 | `reorderRequest/reorderCallables.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:201,296` |
| 34 | `reporting/reportExecutionService.ts` | `recordStandaloneAuditEvent` | **L** | `:428,514,614` |
| 35 | `reporting/savedDefinitionCommands.ts` | `stageAuditEvent`, `recordStandaloneAuditEvent` | **A** + L | `requireMutationCapabilityOrAudit` `:215` and `requireOwnershipOrAudit` `:263` take `action: AuditAction`; **all 6 call sites literal** (`:317,431,443,482,494,545,557`); plus literals `:341,449,513,563` |
| 36 | `salesAgreement/salesAgreementCallables.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:218,307,403` |
| 37 | `salesOrder/salesOrderCallables.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:115,158` |
| 38 | `scheduling/schedulingCommands.ts` | `stageAuditEvent` | **U** + L | `auditAction: Extract<AuditAction, "rescheduleWorkOrder" \| "reassignScheduledWorkOrder">` `:175`, used `:247` — **`Extract` narrows it to two members, so `OWNERSHIP_HANDOFF` is a compile error**; plus literals `:382,422,542,582` |
| 39 | `serializedAsset/acquireCallableWiring.ts` | `stageAuditEvent` | **L** | `:81` |
| 40 | `supplierMaster/supplierMasterCommands.ts` | `stageAuditEventWithId` | **L** + U | literals `:130,200`; 2-member literal union `:223` |
| 41 | `transitionWorkOrder.ts` | `stageAuditEvent`, `stageAuditEventWithId` | **L** | literals `:563,584,610,628,647`. **Client `input.action` is a workflow `ActionName` (`:68`) validated against `ACTION_TO_STATUS` (`:109-111`) and is never the audit action** |
| 42 | `truckRegistry/truckRegistryCommands.ts` | `stageAuditEventWithId`, `recordStandaloneAuditEvent` | **A** + L | `requireAdminOrDispatcherOrAudit(… action: AuditAction …)` `:139` and `args.action: AuditAction` `:221`, used `:260`; **all call sites literal** (`:180,275,295,314,330,345,368`); plus literals `:202,467,482` |
| 43 | `updateWorkOrderExecutionData.ts` | `auditEventDocRef`, `stageAuditEventWithId` | **L** | `:264` |
| 44 | `workOrderLabor/laborCallables.ts` | `stageAuditEvent` | **T** | `:101` ternary over two literals |

### 4.4 Tally

| Class | Modules |
|---|---|
| **L** (literal only) | 24 |
| **L** + another non-reaching class | 7 |
| **U** (type-blocked union) as the sole action source | 5 |
| **C** (pinned const) | 2 |
| **T** (ternary of literals) as the sole action source | 1 |
| **A** (full-union private helper; **all** call sites literal) | 4 — `adminCredentialCommands` · `partMasterCommands` · `savedDefinitionCommands` · `truckRegistryCommands` |
| **R** (read-only) | 1 |
| **B** (builder) | 1 |
| **TOTAL** | **44** |
| **CAN PASS `OWNERSHIP_HANDOFF` TODAY WITHOUT A SOURCE CHANGE** | **1 — the builder** |

### 4.5 The six non-importers, recorded so the 50/44 gap is legible

`access/claimsWriter.ts:14` · `eosCommercial/commercialOwnershipAuthority.ts:79,88` ·
`equipmentCompatibility/commands.ts:78` · `truckRegistry/types.ts:30` ·
`types/access.ts:302,320,481,506,515,522,537,591` · `types/workOrder.ts:140`. **All prose comments.
None imports the module.** `[OBSERVED AT: 64008d5a]`

---

## 5. THE OPTIONS — as the packet states them, with the rulings applied

| # | Option | Blast radius as the packet states it | Blast radius **re-measured** |
|---|---|---|---|
| **(a)** | **`auditEventWriter` consults `ownershipMatrix`** — family semantics enforced at the writer, so every path that can file an `OWNERSHIP_HANDOFF` is validated | *"adds an ownership-matrix dependency to a module with 50 importers … Blast radius is the whole audit surface"* | **Substantially overstated — see §9 `X-6`.** The edit is confined to **`assertValid`**, one function all three write entry points funnel through (`:785,820,846`). `ownershipMatrix.ts` imports **only `./typedOwner`** (`:49`), which the writer **already imports** (`:58`); `typedOwner` imports only `./operatingCompanyAuthority`, which is **PURE — its own header states "no firebase-admin / firebase-functions import"** (`operatingCompanyAuthority.ts:6`). The matrix is a **frozen in-memory literal with zero `await`, zero `async`, zero Firestore**; `ownershipFamily()` is an **O(1) `Map.get`** (`:542-544`). **(a) adds NO new transitive dependency and NO I/O to the audit path.** The 44 importers do not each change; **none** does |
| **(b)** | **`OWNERSHIP_HANDOFF` is REJECTED at `auditEventWriter` unless staged through the builder** | *"requires a way for the writer to know it was called by the builder … makes the builder a hard prerequisite"* | **Confirmed, and the mechanism gap is sharper than stated.** `stageOwnershipHandoff` calls `stageAuditEvent(writer, buildOwnershipHandoff(…))` (`:205`) and `buildOwnershipHandoff` returns a **plain `RecordAuditEventInput`** (`:178-190`) with **no marker of provenance** — byte-indistinguishable from a hand-rolled object. So (b) is **not implementable without a new mechanism** (an unforgeable in-module token, or a separate writer entry point the builder alone calls). Also confirmed: **the prerequisite it would enforce has never been exercised for a transfer** (§2.4) |
| **(c)** | **Both** — consult at the writer **and** require the builder path | *"Defence in depth. Unassessed cost, and it inherits (a)'s blast radius. Nothing in the evidence endorses it."* **Surfaced by the packet, endorsed by no lane** | (a)'s blast radius is now measured as near-zero, so *"inherits (a)'s blast radius"* is no longer a cost argument against (c). **(c)'s real cost is that it needs (b)'s missing mechanism.** Still endorsed by no lane |
| **(d)** | **Neither, yet — wire nothing** | *"Safe, and it is what the evidence supports as an interim. `stageOwnershipHandoff` is unexercised, not unsound."* | **This is the option the rulings changed. See §6.** The two readings of (d) now diverge sharply, and only one survives |

---

## 6. DOES `OD-1` INVARIANT 7 ELIMINATE `(d)`?

> `#180` invariant 7: ***"Handoff semantics must guarantee no responsibility gap."***
> `int/a-correctness-register:docs/DECISIONS.md:6480`. `OD-7` is the handoff decision.

### 6.1 The case FOR elimination

| # | Argument | Evidence |
|---|---|---|
| **F1** | **Invariant 7 is stated unconditionally and in the present tense, and EOS has handoff semantics TODAY.** `OWNERSHIP_HANDOFF` is a live valid `AuditAction` (`:256`) with a live validation block (`:520-575`) reachable at three live write entry points. This is not a future artifact awaiting construction — it is a shipped vocabulary with a shipped validator | §2.2 |
| **F2** | **Those live semantics guarantee nothing about whether a responsibility can move at all.** `targetType` is any non-empty string (`:470-471`). A handoff may be filed against a family whose ownership is historical and immutable (12), a family with no owner to move (24), a transaction that records participants rather than an owner (1), or a name that is not a family. **A permanent append-only record asserting that responsibility moved, where no responsibility could move, is a responsibility gap written into the trail** — and invariant 6 makes that trail the authority on historical accountability | §2.1–§2.2; Probe B `[EXECUTED — carried]` |
| **F3** | **The gap is not only family-shaped; it is person-shaped, and `#182` makes that decisive.** The writer's `newOwner` check is `isTypedOwner` — **shape only** (`:541`), as is the builder's (`:126`). Under `#182` §1 a reference is not valid because it parses. So the live handoff semantics can record responsibility moving **to a person who does not exist**: the trail releases the prior holder and names no real successor. **That is the canonical responsibility gap**, and invariant 7 forbids exactly it | §2.1–§2.2; `#182` §1 |
| **F4** | **(d) leaves all of F2 and F3 untouched.** (d) declines to place validation; it does not remove the vocabulary, does not narrow `targetType`, and does not make the writer refuse anything. It avoids **adding** a gap; it does not **close** one | §5 |
| **F5** | **`#182` has made (d) self-blocking.** *"remain unimplemented until `OD-7` … reconciled"* (`:6735-6740`). Under (d), `OD-7` is not reconciled, so the 29 items stay blocked — **including the person-reference validation `#182` §1 mandates and the multi-axis census `#182` §6 mandates.** (d) is now the option that prevents the rulings from being implemented | `#182` Status |
| **F6** | **`#181` requires a governed operation that (d) forecloses.** *"A business action intending both must be an explicit governed operation recording both changes."* The only live ownership move records **changed field names only** and cannot carry before/after (§2.5). So `#181` cannot be satisfied by anything that exists. (d) blocks the only vocabulary that could carry it | §2.5 |

### 6.2 The case AGAINST elimination — argued honestly

| # | Argument | Evidence |
|---|---|---|
| **G1** | **Invariant 7 constrains handoff *semantics*, and under (d) no handoff is performed.** `functions/src/index.ts` has **zero** occurrences of `ownership`; no callable, route or component reaches the builder. EOS executes no handoff, so EOS creates no responsibility gap in business data. Invariant 7 is then **vacuously satisfied on the data**, and binding only on whatever EOS eventually builds | §2.3 |
| **G2** | **`U-NEW-1`, answered, removes the live-exposure premise.** **Zero of the 42 write-capable non-builder importers can pass `OWNERSHIP_HANDOFF` without a source change** (§4). The corruption path requires an author to write `OWNERSHIP_HANDOFF` — at which point they are wiring, and constraint 1 already governs them. **The packet warned this was its one possible overstatement, and the enumeration confirms the warning.** *"Unexercised, not unsound"* survives the enumeration intact | §4 |
| **G3** | **`#180` itself forbids beginning handoff work.** *"No ACCOUNTABLE PERSON storage, migration, enforcement, **handoff** or backfill may begin until …"* (`:6497-6500`). **Invariant 7 cannot mean "wire a handoff now" when the same ruling, seven lines later, forbids beginning one.** The coherent reading is that invariant 7 is a **design constraint on any handoff EOS builds**, not a construction mandate | `#180` |
| **G4** | **`#182` §9 forbids closing the gate on today's census — so nothing may be ENFORCED yet.** A validator placed per `OD-7` and switched on would have to refuse against a fact EOS cannot derive: `accountablePerson` appears in **zero files repo-wide**, and the census is single-axis (§2.6). Placement without a derivable fact produces the **half-validated shape** constraint 3 was written to prevent | `#182` §9; §2.6 |
| **G5** | **The one exercised builder path is the one case where invariant 7 cannot bind.** `assignmentHandoffInput` pins `previousOwner: null` (`:376,387`) — a **first assignment**. There is no prior holder to release, so **no gap is possible.** EOS has therefore never run a handoff in which invariant 7 has any content | §2.4 |

### 6.3 Resolution — the answer turns entirely on which `(d)` is meant

**`(d)` as the packet words it — *"Neither, yet — wire nothing"* — conflates two different answers, and
the rulings separate them.**

| Reading of (d) | Status after the five rulings | Why |
|---|---|---|
| **(d-wire) — "do not WIRE a validator yet"** | **NOT ELIMINATED.** But it is **no longer an option**: it has been **absorbed into the settled authority** and is now a **carried constraint identical to constraint 1**. `#180:6497-6500` and `#182`'s Status already require it; `#182` §9 forbids closing any gate on today's census; G4 and G5 stand unrebutted | Choosing (d-wire) as an *answer* to `OD-7` would record as a decision something the Owner has already ruled twice |
| **(d-place) — "do not DECIDE the placement yet"** | **ELIMINATED.** | **`OD-7` is a placement question** (`C-7`). `#182`'s Status makes `OD-7` the named remaining gate on 29 items, so (d-place) reconciles nothing and blocks the rulings' own implementation (F5). `#181` requires a governed operation that no existing path can express (F6). And invariant 7 is binding *now* on semantics that exist *now* (F1–F3) — a **binding invariant about handoff cannot be discharged by declining to say where its guarantee lives** |

> ### THE FINDING, STATED ONCE
>
> **INVARIANT 7 DOES NOT COMPEL WIRING. IT DOES COMPEL PLACEMENT.**
>
> It does **not** eliminate the *conduct* (d) describes — not wiring is still correct, and `#180` and
> `#182` both require it independently of `OD-7`.
>
> It **does** eliminate (d) *as an answer to `OD-7`*, because `OD-7` asks **where** the guarantee
> lives and invariant 7 makes it binding on semantics that are already shipped. **After `#182`,
> `(d)` is a deferral wearing an option's clothes**: it defers the one decision `#182` names as the
> gate, on the only axis `#180` calls an invariant.
>
> **PRACTICAL CONSEQUENCE.** The Owner can rule the **placement** — (a), (b) or (c) — and
> **separately withhold implementation**, exactly as `#180` and `#182` each did. That satisfies
> invariant 7, discharges `#182`'s gate, and violates no constraint. **A placement ruling is not a
> wiring authorization, and treating them as the same thing is what made (d) look safe.**

### 6.4 Does `#181` make `(d)` a deferral on its own, independently of invariant 7?

**YES — on narrower and more concrete grounds, and this is the argument that does not depend on
reading invariant 7 at all.**

| Step | Fact |
|---|---|
| 1 | `#181` requires: a business action intending **both** an owner change and an accountability change **must be an explicit governed operation recording both changes** |
| 2 | EOS's only live ownership move is `updateOpportunity`, which records **the changed field NAMES only** — `opportunityCallables.ts:341-348`, whose own comment states *"BEFORE/AFTER VALUES CANNOT BE RECORDED without altering the governed audit schema"* |
| 3 | The carrier for before/after exists on the same contract — `fieldKey`/`previousValue`/`newValue` `:404-406` — and is gated by `FIELD_CHANGE_ACTIONS` `:414-416`, **membership: exactly one action, `"updateEmployeeProfile"`** |
| 4 | The handoff carrier — `previousOwner`/`newOwner`/`handoffSource`/`handoffReason` — **does** record both endpoints, and is gated on `OWNERSHIP_HANDOFF` (`:520,538-570`) |
| **⇒** | **`#181`'s required operation cannot be expressed by any path EOS can reach today, and the one carrier that could express it is the one `OD-7` governs.** So `#181` **does** convert (d-place) into a deferral: it makes a validated handoff path a *requirement*, not an *option*, for the commercial families `#181` and `#182` §7 name |
| **CAVEAT, recorded** | `#181` requires the operation to exist **eventually**; it sets no date and `#180` still withholds implementation. So `#181` makes (d-place) a **deferral**, not an **error** |

---

## 7. THE MULTI-AXIS CONSEQUENCE — must `OD-7`'s answer be AXIS-AWARE?

> `MI-P` (`#182` §6) requires **ACCOUNTABILITY**, and eventually **ESCALATION**, as measured axes.
> The matrix today is an **ownership** matrix.

| Q | Finding |
|---|---|
| **Does a validator placed per `OD-7` need to cover handoffs of ACCOUNTABILITY, not only of OWNERSHIP?** | **YES — and the vocabulary EOS has cannot express one.** `#180` invariant 3 (changing accountability does not change record ownership) and invariant 2 (reassigning execution does not change accountability) mean an accountability handoff is a **different event** from an ownership handoff. `#180` invariant 7 says *"handoff semantics"* without restricting the axis, and **invariant 7 read on the accountability axis is the invariant with teeth** — invariant 1 forbids ACCOUNTABLE PERSON = NONE on actionable work, so an accountability handoff is precisely where a gap would appear. **The only handoff vocabulary EOS has is named `OWNERSHIP_HANDOFF` and carries `previousOwner` / `newOwner`** (`:387-389`) |
| **Is the matrix capable of carrying the accountability axis?** | **NO, and `MI-P` forbids making it so.** *"`accountablePerson` must NOT be put into `ownershipMatrix.ownerFields` merely to make the existing ownership census see it."* The matrix's every column is ownership-shaped: `ownerClass` · `ownerType` · `ownerFields` · `transfer` · `companyScope` · `backfillSource` · `unresolvedPolicy` (`ownershipMatrix.ts:72-104`). **`transfer: "HANDOFF" \| "IMMUTABLE" \| "N_A"` is a statement about OWNERSHIP transferability only** (`:70`) | 
| **So must `OD-7`'s answer be axis-aware?** | **YES, but only in one specific and limited sense: it must not FORECLOSE the other axes.** `OD-7` as worded asks where **family-level** validation lives. That question is answerable per-axis and does not require the accountability axis to be designed first — **provided the answer places the *mechanism*, not the *table*.** An answer phrased as *"the writer consults **the ownership matrix**"* silently makes ownership the only governed responsibility axis at the audit boundary, and **`#180` invariant 10 forbids the generic shortcut that would otherwise be the escape hatch** |
| **Does axis-awareness change the (a)/(b) calculus?** | **YES, and it is the first discriminator in this file that the evidence actually supports** — see below |

### 7.1 Axis-awareness as a discriminator between (a) and (b)

| | **(a) writer consults `ownershipMatrix`** | **(b) writer rejects unless staged through the builder** |
|---|---|---|
| **What it binds the writer to** | **A specific ownership-shaped TABLE.** Adding ACCOUNTABILITY or ESCALATION later means either widening that table — **`MI-P` forbids it** — or teaching the writer a second and third table, i.e. **re-deciding `OD-7` once per axis** | **A PROVENANCE RULE, axis-agnostic by construction**: *responsibility-moving events are staged through their governed authority.* A future accountability authority satisfies the same rule without touching the writer |
| **`#180` invariant 10** | **Pressure toward violation.** The cheapest way to make one writer-side table serve three axes is one generic responsibility field — **exactly the shortcut invariant 10 forbids** | **Neutral.** Provenance says nothing about field shape |
| **`#182` layer separation** | **Blurs it.** Family validity (matrix) and person validity (resolution/derivation, `#182` Layer 1) would both sit inside `assertValid`, in a module that imports no Employee authority and cannot | **Preserves it.** Each authority validates its own axis at its own layer; the writer only enforces *"came from an authority"* |
| **`MI-P`'s eventual four axes** | Requires the writer to know all four tables | Requires the writer to know **none** |
| **Cost, re-measured** | **Near-zero today** (§5). The cost is **structural and deferred**, not dependency-shaped | **Non-zero today**: needs a provenance mechanism that does not exist (§5) |

> **AXIS FINDING.** Axis-awareness is the **only** discriminator in this file that follows from the
> rulings rather than from engineering taste, and **it runs toward (b)** — because (b) places a rule
> and (a) places a table, and `MI-P` has ruled that the table may not grow to fit the other axes.
> **It is not decisive**: (b) still has no working precedent (§2.4) and no mechanism (§5), and `MI-P`
> explicitly withholds the multi-axis design (*"do not implement the final architecture"*). **Recorded
> as a lean with its counterweights, not as a recommendation.**
>
> **It also implies a correction to the question's own wording** — see §9 `X-7`.

---

## 8. WHICH OPTIONS THE RULINGS HAVE CONSTRAINED OR ELIMINATED

| Option | Status after the five rulings | Grounds |
|---|---|---|
| **(a)** | **LIVE. Constrained, not eliminated.** Two constraints attach: **(i)** it may **not** be implemented by widening the matrix to carry accountability — `MI-P` — so it is an answer for the **ownership axis only** and re-opens per axis; **(ii)** it satisfies the **family** layer only, never `#182` Layer 1 person validity, which the writer cannot reach. **Its stated cost is substantially overstated** (§5, `X-6`) | `#182` §6, §1 |
| **(b)** | **LIVE. Constrained, not eliminated.** Constraints: **(i)** it needs a provenance mechanism that does not exist — `buildOwnershipHandoff` returns an unmarked plain object (`:178-190`); **(ii)** **no working precedent** — the one live builder path is type-pinned to `previousOwner: null` and refuses a real transfer (§2.4); **(iii)** it makes the builder a hard prerequisite, and the builder performs **no** person validation (`:126,144`), so (b) alone leaves `#182` Layer 1 open. **Gains the axis-awareness advantage** (§7.1) | `#182` §1; §2.4 |
| **(c)** | **LIVE, and its stated objection is now void.** The packet's cost objection was *"inherits (a)'s blast radius"*; (a)'s blast radius is measured near-zero (§5), so that objection falls. **(c) remains endorsed by no lane** and inherits (b)'s missing mechanism. **Still marked as a packet-surfaced alternative, not a lane position** | §5; packet `OD-7` options |
| **(d)** | **SPLIT BY THE RULINGS — the single most important change in this brief.** **(d-wire)** "do not wire yet" — **NOT eliminated, but no longer an option**: absorbed into settled authority as a constraint (`#180:6497-6500`, `#182` Status, `#182` §9). **(d-place)** "do not decide the placement yet" — **ELIMINATED** by `#182`'s Status naming `OD-7` as the gate, by `#181`'s required-but-unexpressible governed operation, and by invariant 7 binding on shipped semantics | §6 |

---

## 9. RECOMMENDATION

> ## **NONE — between (a), (b) and (c).**
>
> **The evidence still does not support one, and this brief declines to manufacture a preference.**
> OWN-E2E — the only lane that reached this decision — recorded **NONE** between (a) and (b), and
> the synthesis and the packet both carried that. **The axis-awareness finding (§7.1) is a LEAN
> toward (b) with its counterweights recorded, and a lean is not a recommendation.** The two options
> differ on **where family knowledge should live**, which is an architectural preference the
> repository has not ruled, and `MI-P` explicitly withholds the multi-axis design that would settle
> it.
>
> **WHAT HAS CHANGED SINCE THE PACKET, AND IT IS NOT A RECOMMENDATION BETWEEN (a) AND (b):**
>
> | # | Change | Direction |
> |---|---|---|
> | **1** | **`(d-place)` is eliminated** — `OD-7` must now be answered as a placement question | Narrows the field from four to three |
> | **2** | **`(a)`'s blast-radius objection is substantially overstated** — the one discriminator the packet offered is **wrong in direction** (§9 `X-6`) | Removes the packet's only discriminator; **does not** become a discriminator for (a), because it merely restores parity |
> | **3** | **Axis-awareness leans toward `(b)`** (§7.1) — the only ruling-derived discriminator in this file | A lean, with two unrebutted counterweights against (b) |
> | **4** | **Neither `(a)` nor `(b)` alone satisfies `#182` Layer 1** — both are family-layer answers to a two-layer contract | Applies **equally** to both, so it discriminates nothing; it constrains the **scope of the ruling's claim** |
>
> **THE EVIDENCE-DERIVED CONSTRAINTS** (not a decision, not a recommended option) are §10.

### 9.1 Corrections and additions to `OD-PACKET-001-006-007.md` §4

**`OD-PACKET-001-006-007.md` IS NOT EDITED BY THIS BRIEF.** Both readings are cited.

| # | Packet claim | This brief | Severity |
|---|---|---|---|
| **`X-1`** | *(not stated)* | **ADDITION.** `assertValid` is a **single choke point** — `stageAuditEvent:785`, `stageAuditEventWithId:820`, `recordStandaloneAuditEvent:846` (delegating). Both (a) and (b) are one-function changes | **HIGH** — it is the premise `X-6` rests on |
| **`X-2`** | *(not stated)* | **ADDITION.** The writer **already** implements per-action closed-carrier gating three times: report `:514`, handoff `:520`, field-change `:614`/`:414-416`. **(b) follows an established in-file pattern; (a) would be the first domain table the writer consults** | **MEDIUM** |
| **`X-3`** | *"**50 importing modules** in `functions/src` at baseline"*, and *"the writer has **50 importers**"* (`:69`), and `U-NEW-1`'s *"the 50 `auditEventWriter` callers"* | **WRONG. 44 import it; 50 files merely MENTION the string.** Six mention it in prose comments only (§4.5). Of the 44: **1 builder**, **1 read-only**, **42 write-capable non-builder** | **MEDIUM** — the number appears in the headline blast-radius argument and in `U-NEW-1`'s own wording |
| **`X-4`** | *"The only real caller of `stageOwnershipHandoff` is the operator CLI `functions/scripts/assignWarehouseRootCompany.js:72,234`"* | **CORRECT, and INCOMPLETE.** The handoff **input** is built by a `functions/src` module: `ownership/warehouseRootCompanyAssignment.ts:373-395`. So a src-side handoff staging shape exists, which matters because (b) makes the builder a prerequisite | **MEDIUM** |
| **`X-5`** | *"It records a field diff and emits NO `OWNERSHIP_HANDOFF`"* | **CORRECT, and UNDERSTATED.** It records the changed field **NAMES ONLY** — no previous owner, no new owner (`opportunityCallables.ts:341-348`, with the contract-limit comment verbatim). The before/after carrier **exists** on the same contract (`:404-406`) and is closed to this action by `FIELD_CHANGE_ACTIONS` (`:414-416`, one member). **This is what disqualifies the live path under `#181`** (§6.4) | **HIGH** — it converts `#181` from a constraint into a blocker |
| **`X-6`** | *"the one discriminator this packet can add — **blast radius: (a) touches a module with 50 importers, (b) does not**"*, and *"a validation added there is a **change to the whole audit path**"*, *"Blast radius is the whole audit surface"* | **THE DISCRIMINATOR IS WRONG IN DIRECTION, AND LOUDLY SO.** `ownershipMatrix.ts:49` imports **only `./typedOwner`**, which `auditEventWriter.ts:58` **already imports**; `typedOwner.ts:10` imports only `./operatingCompanyAuthority`, which is **PURE by its own header** (`:6`: *"PURE: no firebase-admin / firebase-functions import"*). The matrix has **zero `await`, zero `async`, zero `getFirestore`, zero `collection(`**; `ownershipFamily()` is an **O(1) `Map.get`** (`:542-544`). **(a) adds no new transitive dependency, no I/O, and no latency to the audit path, and changes one function (`X-1`). Not one of the 44 importers changes.** The 44/50 figure measures **who would be affected by a REGRESSION**, which is a real risk-appetite consideration, but it is **not** *"adds a dependency"* and it is **not** a reason to prefer (b) | **HIGH — this is the packet's only stated discriminator between (a) and (b), and it does not hold** |
| **`X-7`** | The question: *"should `auditEventWriter` consult **the ownership matrix** …"* | **THE QUESTION NAMES AN ARTIFACT WHERE IT MEANS A LAYER.** `MI-P` has ruled the ownership matrix may **not** grow to carry accountability or escalation, and `#180` invariant 10 forbids the generic shortcut. So an answer that binds the writer to *"the ownership matrix"* answers `OD-7` **for one axis and re-opens it for three**. **RECOMMENDED WORDING OF THE RULING, not of the question:** the Owner should rule on *where **family-level responsibility-move validation** must live*, and state whether the placement is **per-axis** or **one mechanism serving all axes**. **The question is NOT rewritten here** — the packet's wording is used verbatim throughout (§0), and this is recorded as a defect in the question for the Owner to resolve | **HIGH — it determines whether one ruling closes `OD-7` or only its ownership quarter** |
| **`X-8`** | *"`buildOwnershipHandoff` accepts 14 families / refuses 37 … `FAMILY_IMMUTABLE` ×12, `FAMILY_NOT_OWNABLE` ×24, `FAMILY_PARTICIPATING_COMPANIES` ×1"*; the five refusal line numbers; `:470-471`; `:256`; `:429-433`; `:520-534`; `index.ts` zero `ownership`; `opportunityCommands.ts:312-318`; `assignWarehouseRootCompany.js:72,234`; the two prose-only matches; the 14-derivation via `grep -c` | **ALL CONFIRMED EXACTLY.** The matrix holds **51** families and 14 + 37 = 51 | **NONE — confirmation** |
| **`X-11`** | *"owner **shape** (`:543`)"* in the handoff-block inventory | **OFF BY TWO.** The `isTypedOwner(input.newOwner)` guard is at **`:541`**; `:543` is the error-message string inside it. Re-cited as `:541` throughout this brief | **LOW — citation precision only** |
| **`X-9`** | *"so (b) has no working precedent, not merely no product path"* | **CONFIRMED AND STRENGTHENED.** Not only has no transfer gone through the builder — `assignmentHandoffInput`'s **return type pins `previousOwner: null`** (`:376,387`), and `classifyWarehouseAssignment` **refuses** a different company (`:277-284`, *"no governed warehouse company reassignment semantics exist"*). **The precedent is structurally incapable of being one**, and it is the one case where invariant 7 has no content (§6.2 G5) | **NONE — confirmation, strengthened** |
| **`X-10`** | `C-7`: *"`OD-7` is a **placement** decision, not an **ordering** one"* | **CONFIRMED, AND NOW LOAD-BEARING IN A NEW WAY.** §6.3 shows the (d-wire)/(d-place) split is exactly the placement/ordering distinction `C-7` names. **A prior pass mislabelled `OD-7` as ordering and it cost a round; answering (d) would repeat that error in a different register** — it would answer the ordering question (correctly) and leave the placement question (the actual row) untouched | **HIGH** |

### 9.2 Contradictions with prior lane conclusions — stated loudly

| # | Prior conclusion | Ruling that contradicts it | Both cited |
|---|---|---|---|
| **`Z-1`** | The packet, `OD-7` option (d): *"**Safe, and it is what the evidence supports as an interim.**"* | **`#182` Status** (`int/a-correctness-register:docs/DECISIONS.md:6735-6740`): the 29 items *"remain unimplemented until **`OD-7`** … reconciled."* **(d-place) is no longer safe — it is the blocker.** (d-wire) remains correct and is now redundant with settled authority | Packet `OD-7` OPTIONS row (d); `#182` Status. **BOTH READINGS PRESERVED: the conduct (d) describes is still right; (d) as an ANSWER is not** |
| **`Z-2`** | The packet: *"the one discriminator this packet can add — **blast radius**"* | **Measured at baseline** (`X-6`): `ownershipMatrix.ts:49` → `typedOwner` (already imported at `:58`) → `operatingCompanyAuthority` (**pure**, `:6`); matrix has no I/O; edit confined to `assertValid`. **The discriminator does not hold** | Packet `OD-7` RECOMMENDED OPTION + ENGINEERING rows; `[OBSERVED AT: 64008d5a]` |
| **`Z-3`** | The packet's safety inversion: *"`OWNERSHIP_HANDOFF` is reachable **the moment any of the 50 callers passes the action**"* | **`U-NEW-1` answered** (§4): **zero of the 42 write-capable non-builder importers can pass it without a source change**; no client string reaches `action` anywhere in the 44. **The packet flagged this as its one possible overstatement and the flag was correct.** The inversion is sound as a statement about the writer's **contract**; it is **not** a live production path | Packet `U-NEW-1` + SAFETY INVERSION block; §4. **BOTH PRESERVED** |
| **`Z-4`** | `O-4` (unresolved authority conflict, carried): `record-ownership.md:139,214,226,244` + AC-7 say an Account handoff moves Contact/Location visibility *"immediately and silently"*; `ownershipHandoffCommand.ts:24-30` forbids it **structurally** | **Not resolved by any of the five rulings.** Re-verified: `record-ownership.md` front-matter still reads `supersedes: []` / `superseded_by: []` (`:10-11`) and `:139` still promises the cascade. **`#180` invariant 3 and invariant 5 lean AGAINST automatic movement but neither names the Contact/Location cascade.** The conflict stands, both readings live | `record-ownership.md:10-11,139`; `ownershipHandoffCommand.ts:26-30`; `#180` invariants 3, 5. **CONSTRAINT 4 STRENGTHENED — §10** |
| **`Z-5`** | `AS-1` (carried): the reorder **Assign** branch changes `currentOwner` to `"PARTS_ASSOCIATE"` **and** sets `assignedToUserId` in one write — *"the one genuine contradiction of 'reassignment ≠ ownership transfer' in EOS"* | **`#180` invariants 2 and 4 now make this an invariant violation in vocabulary.** `#180` states explicitly that invariants 2 and 4 *"restate, on the accountability axis, the substance recorded at #142 … and #110"*, and notes the phrase *"reassignment ≠ ownership transfer"* appears in **no** document. **Remedy remains `OD-18`, not `OD-7`** | Packet `AS-1`; `#180` invariants 2, 4 + the `#142`/`#110` citations |

---

## 10. THE FIVE CARRIED CONSTRAINTS — REASSESSED

| # | Constraint as the packet states it | Status now | Reasoning |
|---|---|---|---|
| **1** | **DECIDE THIS BEFORE WIRING ANYTHING** | **STANDS — and STRENGTHENED into the operative instruction.** `#182` Status makes `OD-7` the gate on 29 items, and §6.3 shows the whole force of the rulings lands here: **decide the placement, withhold the wiring.** This constraint is now the *shape of the answer*, not a caveat on it | `#182:6735-6740`; §6.3 |
| **2** | **Do not wire before `OD-1`** | **DISCHARGED as a prerequisite; REPLACED by substantive constraints.** `OD-1` is APPROVED (`#180`). What replaces it: **invariant 7** (the handoff guarantee, §6) · **invariant 10** (no generic shortcut, so no one-field escape from the axis problem, §7) · **invariant 6** (historical accountability auditable, which makes the audit trail the authority and therefore makes a false handoff record a real harm, §6.2 F2) · **invariant 3** (accountability change ≠ ownership change, which is why an ownership-only handoff vocabulary is the wrong tool for the departure case) | `#180` |
| **3** | **Do not wire before `OD-6`** | **DISCHARGED as a prerequisite; REPLACED and SHARPENED.** `OD-6` is RULED (`#182`). What replaces it: **`#182` Layer 1 is a SEPARATE layer from the family layer `OD-7` asks about**, with a different home (resolution/derivation vs the audit boundary). **Consequence: neither (a) nor (b) nor (c) satisfies `#182` Layer 1**, and `OD-7`'s ruling must say so explicitly or it will read as closing handoff validation entirely. The half-validated shape Probe A exhibited (`USER:EMP-OLD → USER:EMP-NEW`, strings naming no employee, accepted) is **still live and still unaddressed by any `OD-7` answer** | `#182` §1, layer table; §2.1 |
| **4** | **Preserve `H6` — no cascade — under every option** | **STANDS, and STRENGTHENED by `#180` invariants 3 and 5.** Re-verified: `OwnershipHandoffInput` carries one `recordId`, **no array, no children flag** (`:51-64`), and the file's header states the rule (`:26-30`). **It remains the one test of nine EOS passes today.** Strengthened because invariant 3 (*"changing accountability does not automatically change record ownership"*) and invariant 5 (*"escalation does not change record ownership"*) generalize no-cascade from the ownership axis to the responsibility axes. **`Z-4` UNRESOLVED and now more dangerous**: `record-ownership.md:139` still promises the opposite and front-matter still reads `superseded_by: []` (`:11`), so a later reader can still cite the contradicted rule. **`OD-5`** | `#180` invariants 3, 5; §2.1; `Z-4` |
| **5** | **`OD-7` does not close `OD-8`** | **STANDS, UNCHANGED, and now EVIDENCED at baseline.** Static read confirms: **`accountOwner` appears nowhere in `firestore.rules`**; `accounts` update is admin/dispatcher-gated with only `paymentTerms` + `taxStatus` validated (`:1335-1337`, `:1298-1309`, and the Rules' own comment *"they keep full edit rights on every other field"* `:1303-1305`); `locations` `:1343` and `contacts` `:1557` are `allow create, update: if isAdminOrDispatcher();` with **no** field constraint. **No `OD-7` answer touches any of this.** `U-N` STANDS: **`[NOT_RUN]`**, no emulator (§11) | §2.7; `U-N` |

### 10.1 One constraint this brief adds

| # | Constraint | Grounds |
|---|---|---|
| **6** | **A RULING ON `OD-7` MUST STATE ITS AXIS SCOPE AND ITS LAYER SCOPE, OR IT WILL BE READ AS CLOSING MORE THAN IT DECIDES.** Axis: `MI-P` forbids the ownership matrix growing to carry accountability or escalation, so an answer naming *"the ownership matrix"* closes one axis of four (`X-7`, §7). Layer: `#182` establishes person-reference validity as a **different layer** with a **different home**, so no `OD-7` answer closes `#182` Layer 1 (constraint 3). **Without both scopes stated, `OD-7` will be cited later as having settled handoff validation, and it will not have.** | `#182` §6, §1; `#180` invariant 10; `X-7` |

---

## 11. WHAT IT ENABLES · WHAT REMAINS UNPROVEN · WHAT IT BLOCKS · WHAT IT DOES NOT DECIDE

### 11.1 What a placement ruling enables

| Enabled | Why |
|---|---|
| **`#182`'s gate condition is discharged** | *"remain unimplemented until `OD-7` … reconciled"* — a placement ruling reconciles it without authorizing implementation | 
| **`MI-P`'s "smallest design consistent with this ruling"** can be prepared | A multi-axis responsibility census must know whether its handoff refusals run at the authority or at the audit boundary |
| **Test `H4`** — *"family-level refusals must run on the path a caller can actually reach"* — becomes specifiable | It names a path; `OD-7` chooses it |
| **`OD-11`** (does a handoff require acceptance?) becomes answerable | An acceptance state must be validated somewhere |
| **`OD-11c`** (may a handoff source represent an escalation or a departure?) becomes answerable | The three sources `:429-433` contain no escalation and no departure token; `warehouseRootCompanyAssignment.ts:389-393` already records that *"`OWNERSHIP_HANDOFF_SOURCES` has none for a first assignment"* — a **fourth** missing case, found here |
| **Retiring the one live bypass** becomes plannable | `OwnerSelect.jsx` → `updateOpportunity` cannot be routed through handoff vocabulary until that vocabulary has a validated path — and under `#181` it must be (§6.4) |

### 11.2 What remains UNPROVEN

| # | Unproven | What would settle it | Status |
|---|---|---|---|
| **`U-NEW-1`** | Which of the `auditEventWriter` callers could pass `OWNERSHIP_HANDOFF` | Read the `action` argument at every call site | **CLOSED BY THIS BRIEF — §4. ZERO of the 42 write-capable non-builder importers. The importer count was 44, not 50** |
| **`U-NEW-2`** | **NEW.** Whether a *provenance* mechanism for (b) is achievable in this codebase without a new writer entry point | A design pass — **not authorized here.** Recorded as a fact: `buildOwnershipHandoff` returns an unmarked plain object (`:178-190`), so (b) has **no** mechanism today | **UNPROVEN — and it is (b)'s load-bearing gap** |
| **`U-NEW-3`** | **NEW.** Which audit carrier a governed responsibility move must use, now that **two** closed-carrier groups on the same contract could express one: the handoff fields (`:387-389`, gated on `OWNERSHIP_HANDOFF`) and the field-change fields (`:404-406`, gated by `FIELD_CHANGE_ACTIONS` `:414-416`) | An Owner ruling — **`MISSING INPUT`**, §12 | **UNPROVEN. `OD-7` as worded does not ask it, and `#181` cannot be satisfied without an answer** |
| **`U-L`** | Whether any handoff has ever been recorded | `auditEvents where action == "OWNERSHIP_HANDOFF"` | **NOT_RUN — no production contact permitted in this lane.** Static analysis at `64008d5a` proves **no reachable emitter exists** (§2.3, §4), so the expected count is **0**; a non-zero result would mean an out-of-band write |
| **`U-N`** | All Firestore Rules behaviour in the ownership-write exposure finding | An emulator Rules unit test | **NOT_RUN — no JRE on this machine; port 8080 held. Read as SOURCE, never EXECUTED** (§2.7). Bears on `OD-8` and on constraint 5 |
| **`U-NEW-4`** | **NEW.** Whether `buildOwnershipHandoff`'s 12 refusals still behave as re-derived, executed against the **compiled** module rather than against a transliteration of the matrix literal | `npm --prefix functions run build` then `node --test functions/test/ownershipModel.test.mjs` | **NOT_RUN.** `functions/node_modules` and `functions/lib` are both **absent** in this worktree; borrowing `functions/lib` is prohibited by lane contract and building is outside this lane's allowed surface. **The §2.1 partition is labelled `[EXECUTED — transliteration]` and is NOT relabelled as a module test** |
| **`O-4` / `Z-4`** | Whether an Account handoff moves Contact/Location visibility | An Owner ruling marking `record-ownership.md` §4 / AC-7 **SUPERSEDED**, or upholding them | **UNRESOLVED, BOTH CITED** (`Z-4`). `record-ownership.md:10-11` still reads `superseded_by: []` |
| **`MI-H`** | Legitimate operating-company change cases — the lane *"found NO EVIDENCE FOR ANY AT ALL"* | Business input | **UNPROVEN, and now sharper**: `warehouseRootCompanyAssignment.ts:26-30` states *"nothing in this repository describes a warehouse moving between operating companies or what business event that would be. **A routing rule is not a use case.**"* **The matrix routes `warehouse` to HANDOFF and no business event exists for it** |

### 11.3 What `OD-7` blocks while it is open

| Blocked | Citation |
|---|---|
| **Any handoff work at all** | Run verdict §E *"Blocks: any handoff work"*; §F **BLOCKED — OWNER DECISION (OD-7)** |
| **The 29 accountability implementation items** | **`#182` Status — NEW since the packet:** *"remain unimplemented until `OD-7` and any directly dependent decisions are reconciled"* |
| **Test `H4`** | *"Family-level refusals must run on the path a caller can actually reach"* |
| **`OD-11`** (acceptance) | **Model B is required by 5 of 16 workflows and is representable in NONE** |
| **`OD-11c`** (escalation / departure modality) | The three sources `:429-433` include no escalation and no departure. *"Routing a departure through `ADMIN_CORRECTION` would file a legitimate lifecycle event as a data-entry fix"* |
| **`#181`'s required governed operation** | Cannot be expressed on any live path (§6.4) |
| **Retiring `OwnerSelect.jsx` → `updateOpportunity`** | §2.5 |

### 11.4 What `OD-7` does NOT decide

| Not decided | Why |
|---|---|
| **`OD-8`** — the ungoverned client-direct owner rewrite on `accounts` / `contacts` / `locations` / `workOrderLegacy`. A **Rules** exposure, unaudited, reachable by any `admin` or `dispatcher` — **and production's only principal is `admin@global`** | Constraint 5, re-evidenced §2.7. **No `OD-7` answer touches Rules** |
| **`#182` Layer 1 person-reference validity** | Different layer, different home. Both the builder (`:126,144`) and the writer (`:541`) validate owner **shape only** |
| **Whether accountability moves when ownership moves** | `#180` invariant 3 says not automatically; **what a business action that intends both must look like is `#181`'s subject and `U-NEW-3`'s open question** |
| **Whether a handoff requires acceptance** (`OD-11`) · **whether a source may represent escalation or departure** (`OD-11c`) · **`reorder_requests.currentOwner`** (`OD-18`) · **REFERENCE stewardship** (`OD-11b`, and `#180` invariant 9 explicitly) | Separate rows |
| **Any field name, enum name, or schema** | `#182` §3: *"Exact enum and schema names are NOT authorized by this ruling"* |
| **Whether the placement is per-axis or one mechanism for all axes** | **Constraint 6. `OD-7`'s wording does not ask, and `MI-P` makes it matter** (`X-7`) |
| **Whether `record-ownership.md` §4 / AC-7 are superseded** | `OD-5` / `O-4`, unresolved (`Z-4`) |

---

## 12. `MISSING INPUT` — only the Owner can answer these

> **`M-1`…`M-4` ARE EXPANDED IN §15** (REVISION 2) with their alternatives and the evidence bearing on
> each. **The numbering below is preserved and nothing in it is deleted.** `M-2` is **sharpened** there:
> it depends on a prior question REVISION 1 did not ask (§15.2).

| # | Question | Why only the Owner |
|---|---|---|
| **`M-1`** | **Is the `OD-7` ruling scoped to the OWNERSHIP axis, or is it one placement serving RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT-where-governed · ESCALATION-where-governed?** | `MI-P` names the four eventual axes and forbids the matrix carrying them; `#180` invariant 10 forbids the generic shortcut. **The evidence cannot choose. Constraint 6 / `X-7`** |
| **`M-2`** | **Which carrier must a governed responsibility move use** — the handoff fields (`previousOwner`/`newOwner`/`handoffSource`/`handoffReason`) or the field-change fields (`fieldKey`/`previousValue`/`newValue`)? `#181` requires an operation *"recording both changes"* and both carriers exist, each closed to a different action set | An audit-contract decision. **`U-NEW-3`** |
| **`M-3`** | **Is `(d-wire)` — do not wire yet — intended to remain in force after the `OD-7` placement is ruled?** This brief reads `#180:6497-6500` and `#182` Status as already requiring it, i.e. a placement ruling is not a wiring authorization. **Confirmation is needed, because the opposite reading turns an `(a)` or `(b)` ruling into an implementation authorization** | §6.3 |
| **`M-4`** | **Is a handoff whose target is a non-existent Employee a responsibility gap under invariant 7, or a referential-integrity defect under `#182` Layer 1 — or both?** Determines whether `OD-7`'s answer must **also** carry a target check, or whether the family layer may ship validated while the person layer remains open | `#182` layer separation vs `#180` invariant 7; §6.2 F3 |
| **`M-5`** | **Does a DEPARTURE require a handoff source token?** `OWNERSHIP_HANDOFF_SOURCES` has none, **and `warehouseRootCompanyAssignment.ts:389-393` records that it has none for a FIRST ASSIGNMENT either.** Two missing lifecycle cases, both already routed through `ADMIN_CORRECTION` in code | `OD-11c`; `#180` invariant 7 (a departure is the case where a gap is most likely) |
| **`M-6`** | **`MI-H`: is there any legitimate operating-company change case at all?** `warehouseRootCompanyAssignment.ts:26-30`: *"A routing rule is not a use case."* The matrix routes `warehouse` and `mobileLocation` to HANDOFF; **no business event for either exists in the repository** | Business input only |
| **`M-7`** | **`O-4` / `OD-5`: are `record-ownership.md` §4 and AC-7 SUPERSEDED?** Front-matter still reads `superseded_by: []` (`:11`) and `:139` still promises Contacts and Locations move *"immediately and silently"* — the exact opposite of `H6`, which is the one test EOS passes | Authority conflict, unresolved; both cited (`Z-4`) |

---

## 13. EVIDENCE LEDGER

> **REVISION 2 ADDS 18 NEW OBSERVED FACTS (`N-1`…`N-18`, §14.0), ALL `[OBSERVED AT: 64008d5a]`**, plus
> `[SOURCE READ — NOT EXECUTED]` for `U-NEW-6` (§17). **No marking in this ledger is relabelled.**

| Marking | Meaning | Items in this brief |
|---|---|---|
| **`[OBSERVED AT: 64008d5a]`** | Read verbatim at baseline in this pass, `file:line` cited | §2.1–§2.6, §4, §5, §9 |
| **`[TRACED @ 64008d5a]`** | Multi-file path followed end to end at baseline | §2.5 (`OwnerSelect.jsx` → callable → command → audit event) |
| **`[EXECUTED — transliteration]`** | The 51-family partition and the 14/37 split were produced by replaying the builder's refusal order against a **faithful transliteration of `ownershipMatrix.ts`'s frozen literal** at `64008d5a` (type annotations stripped, `usr`/`cmp` inlined, all four `.map` spreads preserved). **It is NOT the compiled module and is not labelled as one** | §2.1 |
| **`[EXECUTED — carried, not re-run]`** | OWN-E2E Probe A / Probe B, carried from the packet and **not** re-executed here | §2.2 |
| **`[SOURCE READ — NOT EXECUTED]`** | `firestore.rules` read at baseline; behaviour not exercised | §2.7 |
| **`[NOT_RUN]`** | `U-L` (no production contact permitted) · `U-N` (no JRE; port 8080 held) · `U-NEW-4` (`functions/node_modules` and `functions/lib` both absent; borrowing `lib` prohibited; building outside this lane's allowed surface) | §11.2 |

**Never relabelled.** No emulator was run. No production system was contacted. No schema, migration,
backfill, handoff activation, Rules change or implementation was performed or designed.

---

# REVISION 2 — OD-7-FINAL LANE (appended 2026-09-13, baseline `64008d5a`)

> **NOTHING ABOVE §14 IS REWRITTEN.** §§0–13 are REVISION 1 and remain readable as written. Where
> this revision corrects REVISION 1, the correction is in **§16** and cites both.
>
> **WHAT REVISION 2 ADDS.** (1) The three options — **(a)**, **(b)**, **(c)** — each against the
> **eleven fields** the Owner asked for (**§14**). (2) `M-1`…`M-4` restated with their **alternatives
> and the evidence bearing on each**, and **no inferred Owner answer** (**§15**). (3) Corrections,
> including four citation errors in REVISION 1 (**§16**). (4) New `UNPROVEN` / `NOT_RUN` /
> `MISSING INPUT` (**§17**).
>
> **THREE OPTIONS, NOT FOUR.** `(d-place)` was eliminated by §6.3 of this brief and `(d-wire)` was
> absorbed into settled authority as a constraint identical to carried constraint 1. **That reasoning
> is carried forward and is NOT re-opened here.**
>
> **RECOMMENDATION IS STILL `NONE`** (§9). The new evidence in §14 does not newly support one option:
> it moves **ATOMICITY** to a tie held by the placement rather than by any option's content, and it
> splits **FAILURE MODE** and **MIGRATION/COMPATIBILITY** in **opposite** directions.

## 14. THE THREE OPTIONS × THE ELEVEN FIELDS

### 14.0 The new evidence this section rests on

Every row read verbatim at `64008d5a` in this pass. `functions/src/…` unless stated.

| # | Fact | `file:line` |
|---|---|---|
| **`N-1`** | **The writer's write seam is a caller-supplied `.set()` and its contract is atomicity WITH the caller's business mutation**, stated in the module: *"The minimal shape both firebase-admin's Transaction and WriteBatch satisfy — a caller passes either one, **already holding its own business-mutation writes**, so this Audit Event write **commits (or aborts) exactly WITH those writes, never independently**."* | `access/auditEventWriter.ts:765-771` |
| **`N-2`** | **`assertValid` is the FIRST statement of every write path, before the document ref is even minted.** `stageAuditEvent`: `assertValid(input)` `:785` → `getFirestore()` `:786` → `.doc()` `:787` → `writer.set(...)` `:788`. `stageAuditEventWithId`: id check `:816-818` → `assertValid` `:820` → `writer.set` `:822`. `recordStandaloneAuditEvent`: `db.batch()` `:844` → `stageAuditEvent` `:845` → `await batch.commit()` `:846` | `access/auditEventWriter.ts:780-790, 815-824, 841-848` |
| **`N-3`** | **`assertValid` is synchronous and performs no I/O.** Declared `function assertValid(input: RecordAuditEventInput): void` — no `async`, no `await`, no Firestore inside it | `access/auditEventWriter.ts:460` |
| **`N-4`** | **The writer's refusal class carries NO CODE.** `export class AuditEventValidationError extends Error {}` — an empty subclass. The builder's carries one: `OwnershipHandoffError` with `readonly code: string` and `name = "OwnershipHandoffError"` | `access/auditEventWriter.ts:354`; `ownership/ownershipHandoffCommand.ts:42-49` |
| **`N-5`** | **`AuditEventValidationError` is referenced in ZERO files in `functions/src` outside the writer itself.** No catch, no mapper, no `HttpsError` translation anywhere | `grep -rn AuditEventValidationError functions/src` minus the writer → **0** |
| **`N-6`** | **The writer logs NOTHING, ever.** Zero `logger` and zero `console.` occurrences in the whole 929-line module | `access/auditEventWriter.ts` — 0 hits |
| **`N-7`** | **The callable boundary destroys an unrecognized error.** `mapCommandError`'s fallback is `return new HttpsError("internal", "Opportunity command failed.")`; the *recognized* path carries the domain code in `details` (`const detail = err.code` `:64`, `new HttpsError("invalid-argument", err.message, detail)` `:81`) with the in-file rationale *"THE DOMAIN CODE TRAVELS IN `details`, and it has to."* `:52`. **There are 10 separate `mapCommandError` functions in `functions/src` and none recognizes `AuditEventValidationError`** (`crmActivity` `:41` · `salesOrder` `:34` · `createSalesOrderFromOpportunity` `:42` · `opportunity` `:50` · `coverage` `:19` · `salesAgreement` `:64` · `reorderRequest` `:77` · `finance/adjustment` `:22` · `finance/payment` `:24` · `finance/refund` `:21`) | `opportunity/opportunityCallables.ts:50-84`; `N-5` |
| **`N-8`** | **Firestore's all-reads-before-writes transaction rule is documented IN-REPO, five times.** *"Firestore requires all reads before any write"* `updateWorkOrderExecutionData.ts:143` · `transitionWorkOrder.ts:222` and `:435-436` · *"Firestore requires every transaction read before its first write"* `inventoryService.ts:238` · *"Every command: one transaction, **all reads before any write**, one staged audit event, sanitized errors"* `cycleCount/cycleCountSheetCommand.ts:19` · `cycleCount/cycleCountCommand.ts:8`. **`assertValid` runs at write-STAGING time — i.e. in the WRITE phase** (`N-2`) | as cited |
| **`N-9`** | **EOS already has ONE established pattern for a pure validator that needs an I/O fact, and it puts the read in the CALLER.** *"**PURE: no Firestore, no I/O.** The caller reads the upstream document (**inside its own transaction, so the inherited owner cannot drift between the read and the write**) and hands the derivation in."* | `ownership/creationOwnerResolution.ts:24-26` |
| **`N-10`** | **An in-transaction Employee-existence read precedent exists, in the READ phase**: `const snap = await txn.get(db.collection(EMPLOYEES_COLLECTION).doc(employeeId))`; and a manager variant at `access/employeeProfileCommands.ts:538` | `truckRegistry/truckRegistryRepository.ts:198` |
| **`N-11`** | **EOS ALREADY IMPLEMENTS OPTION (c)'s SHAPE FOR EXACTLY ONE REFUSAL, DELIBERATELY, AND SAYS WHY.** The builder's header: *"a no-op handoff → **enforced in the audit writer, restated here so the caller gets the error before staging**."* The no-op is refused in both places: writer `:557-564`, builder `:155` | `ownership/ownershipHandoffCommand.ts:23`; `access/auditEventWriter.ts:557-564` |
| **`N-12`** | **The D-5 audit-contract test suite validates the writer by HAND-ROLLING the input.** `validHandoff()` is a literal object with `targetType: "account"`, `previousOwner {USER, emp-1}`, `newOwner {USER, emp-2}` (`:90-101`), passed straight to `stageAuditEvent(rejectingWriter, input)` (`:105`). 6 tests, ~12 assertions, 142 lines. **`account` is a PERSON/USER/HANDOFF family, so the fixture survives (a); the suite's METHOD does not survive (b).** It imports `../lib/access/auditEventWriter.js` — a build is required to run it | `functions/test/ownershipHandoffAudit.test.mjs:80-142` |
| **`N-13`** | **(a) cannot reuse the builder's coded error class: that import is a CYCLE.** `ownershipHandoffCommand.ts` imports `stageAuditEvent`, `OWNERSHIP_HANDOFF_SOURCES`, `AuditEventWriter`, `OwnershipHandoffSource`, `RecordAuditEventInput` **from** `../access/auditEventWriter` (`:33-40`). The **matrix** import is cycle-free: `ownershipMatrix.ts:49` imports only `./typedOwner` (which the writer already imports at `:58`) | as cited |
| **`N-14`** | **ASSIGNEE is already a DISTINCT audit action, never the handoff carrier; ACCOUNTABILITY is no action at all.** `reassignWorkOrderTechnician` (union `types/access.ts:470`, runtime `access/auditEventWriter.ts:240`), `reassignScheduledWorkOrder` (`types/access.ts:495`), `assignTruckDriver` (`types/access.ts:300`). None may carry the four handoff fields — the closed-carrier guard refuses them on any other action (`:579`). **`AUDIT_ACTIONS` contains no accountability action of any kind** | as cited |
| **`N-15`** | **`MI-X` CONFIRMED at baseline: Layer 1 has no single named authority.** The EXCLUDED block declares `["user","users","identity authority — a subject of ownership, not an object"]` `:513`, `["employee","employees","**person authority** — a subject of ownership, not an object"]` `:514`, `["technician","fieldops_technicians","**person authority**"]` `:515`. **Two rows claim person authority** | `ownership/ownershipMatrix.ts:513-515` |
| **`N-16`** | **`functions/lib` AND `functions/node_modules` are both ABSENT in this worktree** — `ls` → *"No such file or directory"* for both. Borrowing `functions/lib` is prohibited by lane contract. **`U-NEW-4` stays `NOT_RUN` and is not relabelled** | filesystem, this worktree |
| **`N-17`** | **The person axis has no syntactic floor, confirmed.** `isTypedOwner` applies `nonEmptyString` to a USER id (`typedOwner.ts:67`) and `isOperatingCompanyIdShape` to a COMPANY id (`:68`), which is `/^[a-z][a-z0-9_-]{1,62}$/` (`operatingCompanyAuthority.ts:69`). **The COMPANY id is shape-checked; the PERSON id is not** | as cited |
| **`N-18`** | **The one live builder path stages its BUSINESS write FIRST and the audit event SECOND, on the same transaction** — `txn.update(refs[i], assignmentPatch(d))` `:231`, then `stageOwnershipHandoff(txn, …)` `:234`, inside `await db.runTransaction(async (txn) => {…})` `:214`, with the in-file comment *"the audit event commits with the patch rather than beside it"* `:232-233`. The program's top-level handler prints **`err.message` only** and exits 1 — `main().catch((err) => { console.error(String(err && err.message ? err.message : err)); process.exit(1); })` — **so even `OwnershipHandoffError.code` is discarded on the one live path** | `functions/scripts/assignWarehouseRootCompany.js:214,231-234,244-246` |

### 14.1 OPTION (a) — `auditEventWriter` consults `ownershipMatrix`

| Field | Finding |
|---|---|
| **WHAT "PLACEMENT" MEANS** | The family check is added **inside `assertValid`** (`:460`), within the **already-existing** `if (isHandoffAction)` block (`isHandoffAction` computed `:520`, block opens `:540`), calling `ownershipFamily(input.targetType)` — an **O(1) `Map.get`** (`ownershipMatrix.ts:542-544`) over a frozen literal. **One new import in the writer; one function edited.** `targetType` becomes a matrix key rather than *"any non-empty string"* (`:470-471`) for this action only |
| **WHICH AXES IT VALIDATES** | **RECORD OWNERSHIP only, and by TABLE.** Every matrix column is ownership-shaped (`ownershipMatrix.ts:72-104`) and `transfer: "HANDOFF" \| "IMMUTABLE" \| "N_A"` (`:70`) is a statement about ownership transferability. `MI-P` forbids widening it (`#182`, ref `int/a-correctness-register`, `docs/DECISIONS.md:6681`). So (a) answers **1 of `MI-P`'s 4 eventual axes** (`:6687-6688`) and has **no mechanism** for the other three |
| **WHAT CALL PATH ENFORCES IT** | **All three write entry points, unconditionally** — `stageAuditEvent:785` · `stageAuditEventWithId:820` · `recordStandaloneAuditEvent:846`→`stageAuditEvent`. `assertValid` is the single choke point (`X-1`) and there is **no fourth write path and no update/delete function** in the module (`:773-778`). Enforced whether or not the builder was used — **including on the builder's own output, where it is redundant** (the builder already refused first, `:92-118`). `N-11` shows EOS has already accepted exactly that redundancy once, deliberately |
| **WHICH CARRIERS IT COVERS** | **ONE of two.** The check sits inside `if (isHandoffAction)`, so it covers the **four handoff fields** (`:387-390`) and nothing else. The **field-change carrier** (`fieldKey`/`previousValue`/`newValue` `:405-407`, gated by `FIELD_CHANGE_ACTIONS` `:414-416`, **one member**) is untouched — **and that is the carrier production's only real ownership move actually uses** (`opportunityCallables.ts:341-348`, field **names** only). **(a) validates the carrier nobody reaches and leaves the carrier everybody reaches unvalidated.** `M-2` |
| **HOW PERSON EXISTENCE IS CHECKED** | **It is NOT, and at this placement it CANNOT BE.** `isTypedOwner(input.newOwner)` `:541` is shape-only; USER ids get `nonEmptyString` and no pattern at all (`N-17`). A person-existence check needs I/O; `assertValid` is **synchronous** (`N-3`) and runs in the transaction's **WRITE phase** (`N-2`), and Firestore forbids a read there (`N-8`). Making it async would change the signature of all three write entry points and of every one of the 44 importers' call sites. Separately, `#182`'s layer table puts Layer 1 in **resolution/derivation**, not at the audit boundary (`docs/DECISIONS.md:6608-6612`), and `MI-X` means **no Layer-1 authority is even named yet** (`N-15`) |
| **HOW ACCOUNTABILITY CONTINUITY IS PRESERVED** | **It is not addressed.** There is nothing to preserve it with: `accountablePerson`/`accountableId`/`ACCOUNTABLE_PERSON` appear in **0 files repo-wide** (§2.6), `AUDIT_ACTIONS` has **no accountability action** (`N-14`), and the census is single-axis (`ownershipCensus.ts:82-85,98`). (a) can make an ownership event *well-formed*; it cannot tell whether an accountable person exists **after** the move, which is what invariant 1 (`:6474`) and invariant 7 (`:6481`) are about. And the fact it would need is the one `MI-P` forbids the matrix from carrying (`:6681`) |
| **HOW OWNER / ACCOUNTABLE / ASSIGNEE REMAIN DISTINCT** | **Preserved by the EXISTING closed-carrier rule, not by (a).** The writer already refuses the four handoff fields on any other action (`:579`) and the field-change fields on any non-`FIELD_CHANGE_ACTION` (`:668`); ASSIGNEE already has its **own** actions that cannot carry owner fields (`N-14`). (a) adds no blurring — **and adds no protection.** It does add **pressure**: it entrenches `targetType` (a family name) as the writer-side key for a responsibility move, and the cheapest way to make one writer-side table serve three axes is one generic responsibility field, which is exactly what invariant 10 forbids (`:6486`) |
| **AUDIT BEHAVIOR** | **A refusal produces NO audit record at all, and NO log line.** `assertValid` throws **before** the doc ref is minted and before `writer.set` (`N-2`), so no document — not even a `denied` one — is ever built. `outcome: "denied"` exists on the contract (`:477`) but is **structurally unreachable** from a validation refusal. The writer logs nothing (`N-6`). **Invariant 6 (`:6480`) is not violated — nothing happened — but a refused handoff attempt is invisible everywhere** |
| **ATOMICITY** | **The strongest field for (a), and it is a property of the PLACEMENT, not of (a)'s content — so it is a TIE, not a discriminator.** `assertValid` is the first statement of every write path (`N-2`); the caller has typically **already** staged its business mutation onto the same writer (`N-18`: `txn.update` `:231` then `stageOwnershipHandoff` `:234`). A throw propagates out of the `runTransaction` callback → Firestore **aborts the whole transaction** → **no committed ownership change AND no audit record.** The writer's own interface comment asserts exactly this contract (`N-1`). **So the Owner's concern — a committed ownership change with no audit record, or an audit record with no change — is structurally impossible at this placement, conditional on three things:** (i) the caller is inside a transaction or batch; (ii) the caller stages its business write on the **same** writer; (iii) the caller does not catch the throw. (i)+(ii) are the interface's **stated** contract (`:765-771`) but are **not enforceable by the writer** — the writer only ever sees a `.set()`; (iii) holds today (**0** catch sites, `N-5`) and is **unenforced**. `recordStandaloneAuditEvent` is a batch-of-one with no business write, so it cannot desynchronize by construction (`:841-848`). **The residual atomicity risk at every placement is a caller that commits its business write on a different batch — no validator placement can close that.** (a) adds **no read**, so it does not disturb the read-before-write phase ordering (`N-8`) |
| **FAILURE MODE** | **The weakest field for (a), and it IS a discriminator.** The refusal is an `AuditEventValidationError` — an **empty `Error` subclass with no code** (`N-4`). **No mapper in the repo recognizes it** (`N-5`), so on any callable path the fallback fires: **`HttpsError("internal", "Opportunity command failed.")`** (`N-7`). The writer logs nothing (`N-6`) and `mapCommandError`'s fallback logs nothing either. **So a family refusal reaches a caller as an opaque `internal` with the family, the reason and the refusal code all destroyed, and reaches the server logs as nothing.** On the one live path an operator sees `err.message` only (`N-18`). **Silent refusal: not silent in the sense of accepting — it fails CLOSED — but silent in the sense of unattributable.** **A FALSE refusal blocks live work and is near-undiagnosable**: the matrix routes `warehouse` and `mobileLocation` to `HANDOFF` while `warehouseRootCompanyAssignment.ts:26-30` records that **no business event for either exists** (*"A routing rule is not a use case"*, `MI-H`/`M-6`), so a matrix row that is wrong about a family refuses a legitimate operation with `internal`. **(a) cannot borrow the builder's coded error class: that import is a cycle** (`N-13`); it would need a new coded error class in the writer, or the codes lifted to a third module — neither of which this lane may design |
| **MIGRATION / COMPATIBILITY IMPACT** | **The strongest field for (a), and it IS a discriminator.** **No source change outside the writer.** **None of the 44 importers changes** (`X-3`); **zero of the 42 write-capable non-builder importers can pass `OWNERSHIP_HANDOFF` today without a source change** (`U-NEW-1`); `functions/src/index.ts` has **0** occurrences of `ownership`. **The existing D-5 contract test still passes unchanged** — its fixture is `targetType: "account"` with USER owners, and `account` is PERSON/USER/`HANDOFF` (`N-12`). **No schema, no field name, no enum, no migration, no backfill** — consistent with `#182` §3 (`:6652`, *"Exact enum and schema names are NOT authorized"*) and with *"no backfill authorized"*. **The cost is DEFERRED, not absent**: `MI-P` (`:6681`) forbids growing the matrix, so a second axis later means either a second table in the writer or **re-deciding `OD-7` per axis** (§7.1). And (a) does **not** retire the live bypass — `OwnerSelect.jsx` → `updateOpportunity` keeps moving ownership on the **unvalidated** field-change carrier (§2.5) |

### 14.2 OPTION (b) — `OWNERSHIP_HANDOFF` is REJECTED at the writer unless staged through the builder

| Field | Finding |
|---|---|
| **WHAT "PLACEMENT" MEANS** | A **provenance rule** in the same block: `assertValid` refuses `OWNERSHIP_HANDOFF` unless the input demonstrably came from `buildOwnershipHandoff`. **No mechanism for this exists.** `buildOwnershipHandoff` returns a **plain, unmarked `RecordAuditEventInput`** (`ownershipHandoffCommand.ts:178-190`) — byte-indistinguishable from the hand-rolled literal the test suite builds (`N-12`). (b) therefore requires **new** machinery: an unforgeable in-module token, or a separate writer entry point only the builder can call. **`U-NEW-2` — (b)'s load-bearing gap** |
| **WHICH AXES IT VALIDATES** | **Axis-agnostic by construction** — it places a **rule** (*responsibility-moving events are staged through their governed authority*), not a table. `MI-P`'s four axes (`:6687-6688`) would each supply their own authority and satisfy the same rule **without touching the writer**. **But today only ONE authority exists and it validates only ownership**, so (b) validates **the same single axis as (a) in practice** and differs only in whether the next axis re-opens `OD-7` (§7.1) |
| **WHAT CALL PATH ENFORCES IT** | Same choke point (`:785`/`:820`/`:846`), but the **permitted** path narrows to `stageOwnershipHandoff:200-206` → `buildOwnershipHandoff` → `stageAuditEvent`. Makes the builder a **hard prerequisite** for the action. **The one live caller already complies** (`N-18`). **But the prerequisite has never been exercised for a transfer**: `assignmentHandoffInput` pins `previousOwner: null` (`warehouseRootCompanyAssignment.ts:376,387`) and `classifyWarehouseAssignment` refuses a different company outright (`:277-284`) — `X-9`, re-confirmed |
| **WHICH CARRIERS IT COVERS** | **ONE of two — the same hole as (a), and one degree worse.** The builder emits only `action: "OWNERSHIP_HANDOFF"` (`:180`), so the field-change carrier stays unvalidated. **And (b) makes the validated carrier HARDER to reach**, which raises the incentive to record an ownership move on the **unvalidated** carrier instead — which is precisely what production already does (`opportunityCallables.ts:341-348`). Unless `M-2` is answered, **(b) can push responsibility moves toward the carrier nothing governs** |
| **HOW PERSON EXISTENCE IS CHECKED** | **Not checked today** — the builder's `newOwner`/`previousOwner` guards are `isTypedOwner`, shape only (`:126,144`). **But this is the only one of the three placements that CAN host such a check, and EOS already has the pattern.** The builder is called **by** the caller, so the caller can perform the Employee read in its transaction's **READ phase** (`N-10`) and hand the fact in — exactly the documented contract of `creationOwnerResolution.ts:24-26` (`N-9`), which keeps the validator pure *and* closes the drift window. **This is the first evidence-derived discriminator on this field in this brief, and it favours (b) — but it settles nothing**, because `#182` places Layer 1 in resolution/derivation rather than in a handoff validator (`:6608-6612`), `#182` `:6627-6628` requires RECORD OWNER and ACCOUNTABLE PERSON to be **independently** validated, and `MI-X` means **no person authority is named** (`N-15`). Do not read this as choosing the authority |
| **HOW ACCOUNTABILITY CONTINUITY IS PRESERVED** | **Not today — same nothing as (a)** (no carrier, no action, single-axis census). (b)'s only advantage is **prospective**: a future accountability authority satisfies the same provenance rule, so continuity rules would live **in that authority** rather than in the writer, which is what keeps invariant 3 (`:6476`) expressible — an accountability move that is **not** an ownership move would be a different authority's event, not a reuse of `previousOwner`/`newOwner`. **Unproven**: no such authority exists and `MI-P` explicitly withholds its design (`:6688-6689`, *"do not implement the final architecture"*) |
| **HOW OWNER / ACCOUNTABLE / ASSIGNEE REMAIN DISTINCT** | **Best positioned, on one reading — and it must not be overclaimed.** *"Each axis is staged through its own authority"* is the structural expression of invariants 2/3/4 and the natural defence against invariant 10's generic shortcut (`:6486`). **But provenance is a rule about WHERE an event came from, not about WHAT FIELDS it carries — it cannot by itself stop one generic responsibility field.** The distinctness that actually holds today is the **closed-carrier rule** (`:579`, `:668`) plus the **separate assignment actions** (`N-14`), and **(b) changes neither** |
| **AUDIT BEHAVIOR** | Writer-side refusal: identical to (a) — throw before `writer.set`, **no event, no log** (`N-2`, `N-6`). **The difference is that under (b) the business-meaningful refusals move EARLIER, to the builder, which throws `OwnershipHandoffError` with a CODE (`:42-49`) before anything is staged** — and the builder's header states that rationale in exactly those terms (`N-11`: *"so the caller gets the error before staging"*). The writer's refusal degrades to a **programming-error backstop**: it fires when an author forgot the builder, not when a business rule was broken |
| **ATOMICITY** | **The writer-side guarantee is UNCHANGED** — same choke point, same throw-before-`set`, same transaction abort (`N-1`, `N-2`). The builder adds a **second** refusal point that today sits **inside** the caller's transaction callback (`N-18`: `stageOwnershipHandoff` is called at `:234`, inside `runTransaction` opened at `:214`), so a builder throw **also** aborts the whole transaction. **All-or-nothing holds at both points. (b) introduces ONE new atomicity hazard that does not exist under (a):** (b)'s whole benefit is that the caller gets a **coded** error **before** staging, which invites calling `buildOwnershipHandoff` **outside** the transaction and staging the result **inside** it. That **separates validation from commit in time.** Today the window is **empty** — the builder validates only immutable facts (a frozen matrix literal, looked up by `ownershipFamily` `:542-544` over `BY_FAMILY` `:540` and two shape guards). **It becomes real the moment a person-existence check is added to the builder**: the Employee could be deleted between check and commit — the exact drift `creationOwnerResolution.ts:25` says the in-transaction read exists to prevent (`N-9`). **So (b)'s atomicity is sound now and CONDITIONAL later, and the condition is the person check `M-4` may require** |
| **FAILURE MODE** | **Best of the three for business refusals; it creates the worst NEW failure class.** Business refusals: **12 distinct codes** on a coded error class (`:42-49`, §2.1), thrown before staging — the only refusals in this whole analysis that the repo's error architecture can actually translate (`N-7`: `mapCommandError` exists **to** carry `err.code` in `details`). **New failure class:** a *legitimate* handoff staged by a caller that did not use the builder is refused as an opaque `AuditEventValidationError` → `internal` with no log (`N-4`, `N-5`, `N-6`, `N-7`) — a caller who did the business correctly gets *"Opportunity command failed."* **And the mechanism's own failure mode is UNKNOWN because the mechanism is unbuilt** (`U-NEW-2`): **a forgeable marker fails OPEN** — silently accepting a hand-rolled handoff while reporting that provenance is enforced — **which is the worst failure direction available in this decision and cannot be ruled out without the design pass this lane may not perform.** Note the one live path prints `err.message` only, so **it discards the code (b)'s advantage depends on** (`N-18`) — (b)'s benefit is real but is **not** realized by the only caller EOS has |
| **MIGRATION / COMPATIBILITY IMPACT** | **The only option with a MEASURED present-day breakage, and it IS a discriminator.** **`functions/test/ownershipHandoffAudit.test.mjs` — the D-5 audit-contract suite — validates the writer by HAND-ROLLING the input and calling `stageAuditEvent` directly** (`:90-101`, `:105`). Under (b) **every one of its 6 tests hits the provenance refusal first**, so all ~12 assertions and all 6 refusal-message patterns break and the suite must be rewritten against the builder (`N-12`). That suite is also the file that asserts union/runtime-array symmetry for **`OWNERSHIP_HANDOFF` and eleven other actions** (`auditEventWriter.ts:253-256` and the comments at `:231-240`, `:262-268`), so the rewrite touches a test other rows depend on. **(b) is also the only option that changes the writer's PUBLIC surface** (a new marker or a new entry point). The one live caller already complies (`N-18`). **No schema, no field name, no enum, no migration, no backfill.** Forward benefit: no per-axis re-decision (§7.1) |

### 14.3 OPTION (c) — BOTH

| Field | Finding |
|---|---|
| **WHAT "PLACEMENT" MEANS** | Both edits in the **same** function: the provenance gate **and** the family check inside `assertValid`'s handoff block. **EOS already does exactly this for one refusal, deliberately, and records why**: the no-op is *"enforced in the audit writer, restated here so the caller gets the error before staging"* (`N-11`). **So (c) is not an invented shape — it is the shape the builder's own header describes.** REVISION 1 §8 said (c) is *"endorsed by no lane"*; that remains true, and `N-11` is **not** a lane endorsement — it is an **in-repo precedent for the pattern**, which the packet and REVISION 1 both missed (**`X-12`**, §16) |
| **WHICH AXES IT VALIDATES** | **The union, with the halves pulling opposite ways.** The (a) half binds the writer to the **ownership table** — `MI-P`'s forward cost, paid in full. The (b) half is axis-agnostic. **Adding the rule does not cancel the table's forward cost**, so (c) inherits `MI-P`'s per-axis re-decision problem for the half that has it |
| **WHAT CALL PATH ENFORCES IT** | Same choke point; **both** conditions must hold. The builder path is validated **twice** for family (builder `:92-118`, then writer); the non-builder path is refused on provenance before family is ever reached (or after — **the order is a design choice with a visible consequence**, see FAILURE MODE) |
| **WHICH CARRIERS IT COVERS** | **Still ONE of two.** (c) does **not** close `M-2`: the field-change carrier (`:411-416`) remains unvalidated and remains the carrier production's only ownership move uses. **Defence in depth on one carrier is not coverage of two** |
| **HOW PERSON EXISTENCE IS CHECKED** | **Neither half checks it.** (c) inherits (b)'s **compatibility** with a future builder-side pre-read (`N-9`, `N-10`) and (a)'s **structural inability** to host one at the writer (`N-3`, `N-8`). **Net: the same as (b), plus one more place a maintainer might try to put the check where it cannot legally go** |
| **HOW ACCOUNTABILITY CONTINUITY IS PRESERVED** | **Unchanged from (a) and (b): nothing to preserve it with.** No carrier, no action, single-axis census |
| **HOW OWNER / ACCOUNTABLE / ASSIGNEE REMAIN DISTINCT** | **Unchanged, and it inherits both postures at once**: (a)'s invariant-10 pressure (a writer-side table keyed on `targetType`) **and** (b)'s provenance neutrality. **The pressure is not cancelled by adding the rule** — the table is still there, and it is still the cheapest thing to widen |
| **AUDIT BEHAVIOR** | Identical to both: **no event on refusal, nothing logged** (`N-2`, `N-6`). The informative refusals come from the builder with codes; the writer's two refusals are both opaque |
| **ATOMICITY** | **Identical to (a) and (b); no additional exposure.** Both writer-side checks are synchronous, in the write phase, before `writer.set`; the builder-side checks are in the caller's transaction. **One (c)-specific hazard, and it is a documentation hazard rather than a code one:** two refusal points means **two** places a future maintainer could add an I/O check, and **one of them cannot legally host one** (`N-8`). **(c) therefore needs the read-order constraint written into the placement ruling, or it invites the illegal placement** it is otherwise neutral about |
| **FAILURE MODE** | **Most informative for a compliant caller; most confusing for a non-compliant one.** A compliant caller gets the builder's coded refusal first (best available). A non-compliant caller now faces **two opaque refusal classes for the same input**, and **which message they see depends on the order of the two writer-side checks** — and the repo already **depends** on writer refusal-message order: `refuses(mutate, pattern)` matches on `e.message` against six distinct regexes (`N-12`, `:102-106`). **(c) also DOUBLES the false-refusal surface**: a wrong matrix row (`MI-H`/`M-6`: `warehouse` and `mobileLocation` are routed to `HANDOFF` with **no business event in the repository**, `warehouseRootCompanyAssignment.ts:26-30`) refuses at the writer **even for a caller that used the builder correctly and was already told the operation was fine.** That is the one failure mode unique to (c) and it is the ugliest kind: **a refusal after an approval** |
| **MIGRATION / COMPATIBILITY IMPACT** | **Strictly the UNION of (a)'s and (b)'s costs and benefits.** Inherits (b)'s D-5 test-suite rewrite (`N-12`) **and** (a)'s writer import; needs (b)'s unbuilt mechanism (`U-NEW-2`); changes none of the 44 importers; **no schema, no field, no enum, no migration, no backfill.** REVISION 1 recorded that (c)'s stated cost objection (*"inherits (a)'s blast radius"*) is **void** because (a)'s blast radius is near-zero (`X-6`); **that stands, and this pass adds the real cost — (c) is the only option that pays BOTH the test-suite rewrite and the matrix coupling** |

### 14.4 The five previously-unanalysed fields, side by side

| Field | (a) | (b) | (c) | Discriminates? |
|---|---|---|---|---|
| **ATOMICITY** | All-or-nothing, held by the placement (`assertValid` before `writer.set`, inside the caller's transaction) | Same, **plus** a conditional TOCTOU window if the builder is called outside the transaction **and** later gains an I/O check | Same as both; one documentation hazard (two sites, one of which cannot host I/O) | **NO — a tie.** The guarantee belongs to `assertValid`'s position (`N-2`) and to `AuditEventWriter`'s stated contract (`N-1`), not to any option's content. **The residual risk at every placement is a caller that commits its business write on a different batch, and no placement closes it** |
| **FAILURE MODE** | **Worst.** Business refusals on a code-less error class no mapper reads → `internal`, unlogged, unattributable; false refusal blocks live work; cannot reuse the coded class (cycle) | **Best for business refusals** (12 codes, pre-staging); **worst new class** — an unbuilt mechanism that could fail **OPEN** | Most informative for compliant callers; **a refusal after an approval** for false-matrix cases; order-dependent messages | **YES — toward (b) for business refusals, toward (a) for having no unbuilt mechanism at all.** The two cut opposite ways and **do not resolve** |
| **ACCOUNTABILITY CONTINUITY** | Not addressed | Not addressed; prospectively better (a future authority satisfies the same rule) | Not addressed | **NO — nothing exists to address it with.** `accountablePerson` = **0 files**; no accountability audit action (`N-14`); `MI-P` withholds the design (`:6688-6689`) |
| **OWNER / ACCOUNTABLE / ASSIGNEE DISTINCT** | Adds pressure toward invariant 10; no protection | Best posture, but provenance ≠ field shape, so it protects nothing by itself | Inherits both | **WEAKLY toward (b)** — the same §7.1 lean, now with `N-14` showing the distinctness EOS actually has is the closed-carrier rule plus separate assignment actions, which **no option changes** |
| **MIGRATION / COMPATIBILITY** | **Best. Zero measured breakage** — the D-5 suite's fixture survives (`N-12`) | **Only option with measured breakage** — the D-5 suite's **method** does not survive; only option changing the writer's public surface | Union of both | **YES — toward (a).** This is the exact mirror of §7.1's axis lean toward (b), at the same strength, and it is why the recommendation stays **NONE** |

> ### THE SYMMETRY, STATED ONCE
>
> **The two ruling-derived discriminators now point in opposite directions at comparable strength.**
> Axis-awareness leans **(b)** (§7.1, `MI-P` `:6681`). Present-day compatibility leans **(a)**
> (`N-12`). **ATOMICITY is a tie held by the placement.** **ACCOUNTABILITY CONTINUITY is vacuous for
> all three.** **FAILURE MODE splits internally.** **RECOMMENDATION REMAINS `NONE`** — and it is now
> `NONE` for a **better-evidenced reason** than in REVISION 1: not an absence of discriminators, but
> **two of them in opposition**, plus three fields that no option can currently satisfy.

## 15. `M-1`…`M-4` — ALTERNATIVES AND EVIDENCE, NO INFERRED ANSWER

> **The numbering of `M-1`…`M-7` in §12 is preserved.** This section expands `M-1`…`M-4` only.
> **No Owner answer is stated, implied, or leaned toward in this section.**

### 15.1 `M-1` — Which axis / axes are within `OD-7` handoff validation?

**Why the question exists:** `OD-7`'s wording is *"should `auditEventWriter` consult **the ownership
matrix**"* — **it names an ARTIFACT where it means a LAYER** (`X-7`), and `MI-P` has ruled that the
named artifact may not grow to the other axes: *"`accountablePerson` must NOT be put into
`ownershipMatrix.ownerFields`"* (`#182`, ref `int/a-correctness-register`, `docs/DECISIONS.md:6681`).

| Alternative | What it means concretely | What it costs | Evidence |
|---|---|---|---|
| **1 — OWNERSHIP AXIS ONLY** | `OD-7` rules where **ownership**-family validation lives. `ACCOUNTABILITY`, `ASSIGNMENT`-where-governed and `ESCALATION`-where-governed each get their own later placement decision | **Cheapest and immediately implementable-shaped**: the matrix already carries exactly this axis (`ownershipMatrix.ts:70,72-104`). **Cost: `OD-7` closes 1 of 4 and re-opens 3.** Under option (a) that is **3 further `OD-7`-shaped rulings**, because (a) places a table; under (b) it is **0**, because (b) places a rule (§7.1). **Second cost: citation risk** — a ruling worded *"the ownership matrix"* will later be cited as having settled handoff validation, and it will not have (carried constraint 6) | `MI-P` `:6681,6685-6688`; matrix columns `:72-104`; `transfer` `:70` |
| **2 — ONE PLACEMENT SERVING ALL FOUR AXES** | `OD-7` rules a single mechanism that every governed responsibility-move event must pass, whichever axis it moves | **Satisfies invariant 10's spirit** (`:6486`, no generic cross-family shortcut) **and `MI-P`'s distinctness requirement in one stroke — but CANNOT BE SPECIFIED TODAY WITHOUT DOING THE DESIGN `MI-P` RESERVED.** There is no accountability carrier (`accountablePerson` = **0 files**), no accountability audit action (`N-14`), and no escalation vocabulary — the three `OWNERSHIP_HANDOFF_SOURCES` contain **no escalation and no departure token** (`:429-433`). `MI-P` says *"Prepare the smallest design consistent with this ruling; **do not implement the final architecture**"* (`:6688-6689`). **A ruling for alternative 2 is answerable as a PRINCIPLE and not as a MECHANISM** | `MI-P` `:6685-6689`; invariant 10 `:6486`; §2.6; `N-14`; `:429-433` |
| **3 — PER-AXIS PLACEMENT, DECIDED WITH EACH AXIS'S CARRIER** | Each axis's placement is ruled when that axis's carrier is designed; `OD-7` rules ownership and **explicitly states that it rules only ownership** | **Four rulings instead of one, and the first becomes the de facto template.** If the first is (a), the template is *"the writer consults a table per axis"* — which is the invariant-10 pressure §7.1 identifies, because the cheapest way to make one writer-side table serve four axes is one generic responsibility field. If the first is (b), the template generalizes at no further cost. **So alternative 3's cost is CONDITIONAL ON WHICH OPTION IS CHOSEN, which makes `M-1` and the (a)/(b)/(c) choice interdependent rather than sequential** | §7.1; invariant 10 `:6486`; `MI-P` `:6687-6688` |

**What the evidence does NOT settle:** nothing in `#180`, `#181` or `#182` states an axis scope for
`OD-7`. `#182` Status names `OD-7` as the gate on the 29 items (`:6735-6738`) **without** saying which
axes it must cover. **`MISSING INPUT`.**

### 15.2 `M-2` — Which carrier owns the handoff fact?

**Two closed carriers exist on the same contract, each gated to a disjoint action set.**

| | **CARRIER A — the four handoff fields** | **CARRIER B — the field-change fields** |
|---|---|---|
| **Fields** | `previousOwner?: TypedOwner \| null` `:387` · `newOwner?: TypedOwner` `:388` · `handoffReason?: string` `:389` · `handoffSource?: OwnershipHandoffSource` `:390` — plus `objectId` `:368`, required for this action (`:520-534`) | `fieldKey?: string` `:405` · `previousValue?: string \| null` `:406` · `newValue?: string \| null` `:407` |
| **Gate** | `action === "OWNERSHIP_HANDOFF"` (`OWNERSHIP_HANDOFF_ACTION` `:437`, `isHandoffAction` `:520`); refused on any other action `:579` | `FIELD_CHANGE_ACTIONS` `:414-416` — **a one-member set: `"updateEmployeeProfile"`**; refused on any other action `:668` |
| **CAN record** | A **typed** owner pair with **both endpoints**, a governed source from a 3-member closed set (`:429-433`), a bounded reason, the record moved (`objectId`), the family (`targetType`) | **Which field changed, from what, to what** — as **already-rendered strings** (the module's own words, `:402-404`), one field per event |
| **CANNOT record** | **Which axis moved** — there is no axis field, and `previousOwner`/`newOwner` assert **ownership** by name · **an accountability endpoint pair** · **more than one record** (no array; `H6`) · **a first assignment as such** or **a departure** — `warehouseRootCompanyAssignment.ts:389-393` records in code that `OWNERSHIP_HANDOFF_SOURCES` *"has none for a first assignment"* | **A typed owner** (strings only, never sub-documents — `:402-404`) · **two changes in one event** · **anything at all on an ownership action**, since the gate excludes every action but one |
| **What production actually does** | **Nothing.** Zero reachable emitters (`U-NEW-1`, `index.ts` 0 `ownership`) | **This is the carrier the only live ownership move uses — and it records the changed field NAMES ONLY, no before, no after** (`opportunityCallables.ts:341-348`, whose own comment says before/after *"CANNOT BE RECORDED without altering the governed audit schema"*) — `X-5` |

**What `#181` needs from each.** `#181` (ref `int/a-correctness-register`, `docs/DECISIONS.md:6559`):
*"A business action intending **both** must be **an explicit governed operation that records both
changes**."*

| Reading of *"one explicit governed operation recording both changes"* | Satisfiable from Carrier A? | Satisfiable from Carrier B? | What it would take |
|---|---|---|---|
| **One AUDIT EVENT recording both changes** | **NO.** Carrier A has exactly one owner pair and no axis discriminator. Recording an accountability endpoint pair as well requires **new fields** | **NO.** Carrier B records one field per event and is closed to one action | **New fields or a new action — and `#182` §3 withholds both** (*"Exact enum and schema names are NOT authorized"*, `:6652`). **So this reading is UNSATISFIABLE under current authority** |
| **One TRANSACTION recording both changes, as two events** | **YES, mechanically.** `AuditEventWriter` is a `.set()` seam that commits N events with the caller's business write atomically or not at all (`N-1`, `N-2`, `N-18`) | **YES, mechanically** — same seam | **No new fields.** It needs a ruling that *"one governed operation"* means one **transaction**, not one **event** |
| **One event on Carrier A plus a SECOND governed vocabulary for the accountability axis** | Carrier A keeps ownership; accountability gets its own action and its own authority | n/a | **A new action** — withheld by `#182` §3; and it is `M-1` alternative 2/3 territory |

> **`M-2` SHARPENED — and this is new in REVISION 2.** The unanswered question is **not only *"which
> carrier"*. It is *"does `#181`'s ONE GOVERNED OPERATION mean one AUDIT EVENT or one
> TRANSACTION?"*** — because **under the one-event reading, `#181` is unsatisfiable without the field
> or enum additions `#182` §3 withholds**, and **under the one-transaction reading it is satisfiable
> today with no schema change at all**, using a seam whose atomicity contract is already stated in
> the module (`N-1`). **`OD-7` as worded asks neither.** **`MISSING INPUT`** — `U-NEW-3`, restated.

### 15.3 `M-3` — Does selecting a placement authorize wiring, or only settle architecture?

| | **READING 1 — placement settles ARCHITECTURE ONLY; wiring stays withheld** | **READING 2 — selecting a placement AUTHORIZES wiring** |
|---|---|---|
| **Textual support** | **`#180`: *"IMPLEMENTATION IS NOT AUTHORIZED.** No ACCOUNTABLE PERSON **storage, migration, enforcement, handoff or backfill** may begin until `OD-6` resolves person-reference validity and census behaviour and the remaining dependency decisions are reconciled"* — `docs/DECISIONS.md:6503-6505`, **and it names handoff explicitly.** `#182` Status: *"**ENGINEERING IMPLEMENTATION NOT YET AUTHORIZED.** The 29 accountability implementation items … remain unimplemented until `OD-7` and any directly dependent decisions are reconciled"* — `:6735-6738`. **Both rulings withhold implementation in the same breath as they name the next gate**, which is the pattern this brief reads as deliberate | **Nothing in `#180`, `#181` or `#182` states it.** Reading 2 requires construing *"reconciled"* (`:6738`) as *"implemented"* — but the same sentence begins *"ENGINEERING IMPLEMENTATION NOT YET AUTHORIZED"*, so the construal has to survive its own clause. **The only genuine support is pragmatic**: `OD-7` is the last named gate, so a reader may take its closure as the release of the hold |
| **What turns on it — if Reading 1** | An (a)/(b)/(c) ruling is **safe**: it discharges `#182`'s gate condition and authorizes **nothing**. The 29 items still need their own authorization. `#182` §9's *"gate may not close on today's census"* stays in force, and the half-validated shape carried constraint 3 warns about cannot arise | — |
| **What turns on it — if Reading 2** | — | **The ruling becomes an implementation authorization for a validator that must refuse on facts EOS cannot derive.** `accountablePerson` = **0 files**; the census is single-axis (`ownershipCensus.ts:82-85,98`); `MI-X` means Layer 1 has **no named authority** (`N-15`). **That is exactly the half-validated shape carried constraint 3 exists to prevent**, and it would put a live refusal path in front of the one live ownership move (`OwnerSelect.jsx` → `updateOpportunity`) whose failure mode is an unattributable `internal` (`N-7`) |
| **Third fact bearing on both** | **`(d-wire)` is already settled authority, not an option** (§6.3). If Reading 1 is right, `M-3` is a **confirmation** question, not an open one. If Reading 2 is right, then **REVISION 1 §6.3's "PRACTICAL CONSEQUENCE" — *"rule the placement and separately withhold implementation"* — is WRONG**, and this brief says so loudly here rather than quietly | §6.3; `:6503-6505`; `:6735-6738` |

**`MISSING INPUT`** — only the Owner can say which reading governs. **This brief's reading is
Reading 1, stated as a reading and not as an answer.**

### 15.4 `M-4` — Is a handoff to a non-existent Employee a Layer-1 defect, a handoff-validation defect, or both?

**The shared fact under all three readings:** the target is checked by `isTypedOwner` — **shape only**
— at the writer (`auditEventWriter.ts:541`) and at the builder (`ownershipHandoffCommand.ts:126`);
a USER id gets only `nonEmptyString` and **no pattern at all**, while a COMPANY id gets
`/^[a-z][a-z0-9_-]{1,62}$/` (`typedOwner.ts:67-68`, `operatingCompanyAuthority.ts:69` — `N-17`).
`#182` §1 is explicit that this is **not** validity: *"A PERSON reference is **not** valid merely
because it is a non-empty string, has type `USER`, or parses"* (`docs/DECISIONS.md:6618-6619`).

| Reading | The claim | Evidence for it | What it implies for `OD-7`'s answer |
|---|---|---|---|
| **(i) LAYER-1 PERSON-REFERENCE DEFECT ONLY** | It is a referential-integrity defect, and its home is person-reference **resolution / derivation** — not a handoff validator | `#182`'s layer table assigns Layer 1 to *"authoritative person-reference **resolution / derivation**"* (`:6608-6612`); `:6627-6628` *"ACCOUNTABLE PERSON and RECORD OWNER are **independently validated** references. One person's validation is never validation for another person fact."* **The word "handoff" appears nowhere in `#182` §1** | **`OD-7`'s answer need NOT carry a target check.** The family layer may ship validated while Layer 1 stays open — **but then the ruling must SAY it does not close Layer 1** (carried constraint 6), or `OD-7` will later be cited as having settled handoff validation. **All three options are equally acceptable under this reading** |
| **(ii) HANDOFF-VALIDATION DEFECT** | A permanent append-only record that releases a prior holder and names **no real successor** IS the responsibility gap invariant 7 forbids | `#180` invariant 7: *"Handoff semantics must guarantee no responsibility gap"* (`:6481`); invariant 1 forbids `ACCOUNTABLE PERSON = NONE` on actionable work (`:6474`); invariant 6 makes the trail the authority on historical accountability (`:6480`) — so a false successor is written into the authority. §6.2 `F3` | **`OD-7`'s answer MUST carry a target check — and then placement becomes decisive in a way no other field makes it.** A person check needs I/O. **The writer CANNOT host one**: `assertValid` is synchronous (`N-3`) and runs in the transaction's **write** phase (`N-2`), where Firestore forbids a read (`N-8`). **The builder CAN, via the caller's pre-read** — the documented `creationOwnerResolution.ts:24-26` pattern (`N-9`) with `truckRegistryRepository.ts:198` as the in-transaction precedent (`N-10`). **Under reading (ii), option (a) ALONE is structurally incapable of satisfying invariant 7.** Recorded as **conditional on the Owner's reading**, never as a conclusion |
| **(iii) BOTH — two defects, two homes, one symptom** | Layer 1 is defective **and** the handoff path must consume Layer 1's result before it may record a move | Both of the above, and they are not in conflict: `#182` §5 already establishes the composite shape — *"an inherited person reference **must satisfy the applicable CURRENT eligibility contract**"* (`:6668-6670`), i.e. one layer's output is another layer's input | **`OD-7` rules the family layer AND must explicitly NOT close Layer 1, AND the handoff path must later consume Layer 1's result.** The consequence is about **ORDER**: the Layer-1 authority must be **named** before the target check can be specified — and `MI-X` is open precisely because it is not (`N-15`: the matrix declares **three** authority rows and **two** claim *"person authority"* — `ownershipMatrix.ts:513,514,515`). **So under (iii) the target check is blocked on `MI-X`, not on `OD-7`** |

**Cross-cutting fact the Owner should have in front of them, which no reading disputes:** the
**COMPANY** half of the owner axis has a syntactic floor and the **PERSON** half does not (`N-17`),
and `operatingCompanyAuthority.ts:10` states the company authority is *"INERT in v1: no Rules enforce
company ownership, no writer stamps it, no backfill has run."* **The axis with the weaker check is the
axis `#182` §1 names.**

**`MISSING INPUT`. This lane does not choose the person authority** (`MI-X` is being prepared
separately) **and does not choose the reading.**

## 16. CORRECTIONS — TO THIS BRIEF, AND TO THE INPUTS

> **Correcting this brief is in scope.** REVISION 1 text is **not** deleted; each correction cites
> both.

| # | Where | REVISION 1 / input said | REVISION 2 finding | Severity |
|---|---|---|---|---|
| **`Y-1`** | §1, §3, §6.2 `G3`, §8, §10, `Z-1` — every citation of `#180`'s withholding | `int/a-correctness-register:docs/DECISIONS.md` **`:6497-6500`** | **WRONG LINE.** The withholding is at **`:6503-6505`**. `:6497-6500` is the *"Invariants 2 and 4 restate … #142 … #110"* paragraph. **The quoted text is verbatim correct; the line numbers are not** | **LOW — citation precision, but it appears 6 times and this brief's own rule is `file:line`** |
| **`Y-2`** | §6 epigraph | invariant 7 at **`:6480`** | **OFF BY ONE.** Invariant 7 is at **`:6481`**; `:6480` is invariant 6. Both are cited in this brief, so the error is doubly worth fixing. Invariant list spans `:6474-6486`; invariant 10 is `:6486` | **LOW** |
| **`Y-3`** | §1, §3, §11.3, `Z-1` | `#182` Status at **`:6735-6740`** | **OVER-RANGE.** The Status block is **`:6735-6738`**; `:6739-6740` are not part of it. The *"remain unimplemented until `OD-7`"* sentence is at **`:6738`** | **LOW** |
| **`Y-4`** | §7, `M-2`, `U-NEW-3` | the handoff fields at **`:387-389`** | **UNDER-RANGE.** There are **four** handoff fields and they span **`:387-390`** (`previousOwner` `:387`, `newOwner` `:388`, `handoffReason` `:389`, `handoffSource` `:390`). The module itself calls them *"the four handoff fields"* (`:399`, `:538`). REVISION 1's `:387-389` silently drops `handoffSource` — the one field that carries the governed source | **MEDIUM — the dropped field is the one `OD-11c` / `M-5` turn on** |
| **`Y-5`** | §2.5, `X-5`, `M-2`, `U-NEW-3` | the field-change fields at **`:404-406`** | **OFF BY ONE.** The three field-change fields are at **`:405-407`** (`fieldKey` `:405`, `previousValue` `:406`, `newValue` `:407`); `:402-404` is the explanatory comment above them, so REVISION 1's range starts one line early and drops `newValue`. **`FIELD_CHANGE_ACTIONS` at `:414-416` is correct, and its one member `"updateEmployeeProfile"` is at `:415`** | **LOW — `M-2` rests on this carrier, so the range is worth being exact about** |
| **`X-12`** | §5, §8, §9 — *"(c) … endorsed by no lane"*, *"Nothing in the evidence endorses it"* | **STILL TRUE AS TO LANES, BUT THE PATTERN HAS AN IN-REPO PRECEDENT THE PACKET AND REVISION 1 BOTH MISSED.** `ownershipHandoffCommand.ts:23` records that the **no-op** refusal is *"enforced in the audit writer, **restated here** so the caller gets the error before staging"* — i.e. **EOS already implements (c)'s shape for one refusal, deliberately, with a stated rationale** (writer `:557-564`, builder `:155`). This is **not** a lane endorsement and **not** a recommendation; it is evidence that (c) is the codebase's existing pattern rather than an invented one | **MEDIUM — it removes "unprecedented" as an objection to (c); it does not make (c) preferred** |
| **`X-13`** | §5, §7.1 — (a)'s cost described as *"structural and deferred, not dependency-shaped"* | **INCOMPLETE.** (a) has a **present, non-deferred** cost REVISION 1 did not identify: its refusals ride an error class with **no code** (`N-4`) that **no mapper in the repo recognizes** (`N-5`, `N-7`), so they surface as `internal` and are logged nowhere (`N-6`); and (a) **cannot** borrow the builder's coded class without a **circular import** (`N-13`). **(a)'s cost is not only deferred — it is also diagnostic, today** | **MEDIUM** |
| **`X-14`** | §5, §8 — (b)'s cost described as *"needs a provenance mechanism that does not exist"* | **INCOMPLETE, and the omission is measurable.** (b) additionally **breaks the D-5 audit-contract test suite's method**: `functions/test/ownershipHandoffAudit.test.mjs` hand-rolls the input and calls `stageAuditEvent` directly (`:90-101,:105`), so all 6 tests / ~12 assertions / 6 refusal-message patterns must be rewritten against the builder (`N-12`). **REVISION 1 recorded no migration cost for (b) at all** | **HIGH — it is the only measured present-day breakage in the whole decision, and it is the mirror of `X-6`** |
| **`X-15`** | §2.2, §5 — (a) as *"no I/O added to the audit path"* | **CONFIRMED and now load-bearing for a reason REVISION 1 did not state.** `assertValid` runs in the transaction's **WRITE** phase (`N-2`), and Firestore forbids a read there — documented in-repo five times (`N-8`). **So "no I/O" is not merely a performance property of (a): it is the reason (a) can never host the person check `M-4` reading (ii) would require.** Re-verified: matrix has **0** `await`/`async`/`getFirestore`/`.collection(`; imports only `./typedOwner` (`:49`), already imported by the writer (`:58`); `typedOwner.ts:10` → `operatingCompanyAuthority`, **PURE by its own header** (`:6`) | **HIGH — it converts `X-6` from a cost measurement into a capability limit** |
| **`X-16`** | §2.2 — *"the three `OWNERSHIP_HANDOFF_SOURCES` … at `:429-433`"* | **CONFIRMED at baseline and independently asserted by a test**: `functions/test/ownershipHandoffAudit.test.mjs:124` does `assert.deepEqual([...OWNERSHIP_HANDOFF_SOURCES], ["DIRECT_HANDOFF","CUSTOMER_HANDOFF_REVIEW","ADMIN_CORRECTION"])`. **So `M-5`'s missing departure/first-assignment tokens are pinned by a test, not only by a constant** | **NONE — confirmation, with a new citation** |
| **`X-17`** | sibling input — *"`MI-X` is open … the matrix declares three authority rows and two claim person authority"* | **VERIFIED AT BASELINE, EXACTLY AS STATED.** `ownershipMatrix.ts:513` `["user","users","identity authority — a subject of ownership, not an object"]` · `:514` `["employee","employees","person authority — a subject of ownership, not an object"]` · `:515` `["technician","fieldops_technicians","person authority"]`. **Two rows claim person authority; Layer 1 has no single named authority.** Used in `M-4` and in every option's PERSON EXISTENCE field. **This lane does NOT choose the authority** | **NONE — confirmation of a sibling lane's finding** |
| **`X-18`** | sibling input — *"`typedOwner.ts` is pure and `operatingCompanyAuthority` is pure by its own header; a person-existence check requires I/O"* | **VERIFIED, and the consequence is now stated precisely.** `operatingCompanyAuthority.ts:6` *"PURE: no firebase-admin / firebase-functions import"*; `typedOwner.ts:10` imports only it. **Consequence for a validator in the WRITER: impossible — `assertValid` is sync (`N-3`) and in the write phase (`N-8`). Consequence for a validator in the BUILDER: possible WITHOUT breaking purity, via the caller's pre-read — the pattern `creationOwnerResolution.ts:24-26` already documents (`N-9`), with `truckRegistryRepository.ts:198` as the in-transaction precedent (`N-10`)** | **HIGH — this is the only new evidence in REVISION 2 that bears directly on an option's capability rather than its cost** |

**Carried findings re-verified in this pass and unchanged:** `U-NEW-1` (zero of 42; 44 import / 50
mention) · `X-6` (blast-radius discriminator void — re-verified, see `X-15`) · `X-5` (field names only;
`opportunityCallables.ts:341-348`) · `X-9` ((b) has no working precedent; `:376,387` re-read) ·
`U-NEW-2` ((b)'s unmarked plain object, `:178-190`) · the §7.1 axis lean toward (b), **with `X-14` now
supplying a counterweight of comparable strength in the opposite direction**.

## 17. `UNPROVEN` · `NOT_RUN` · `MISSING INPUT` — REVISION 2 DELTA

| # | Item | Status |
|---|---|---|
| **`U-NEW-5`** | **NEW.** Whether a provenance marker for (b) can be made **unforgeable** across a module boundary in this codebase. **A forgeable marker fails OPEN** — silently accepting a hand-rolled handoff while reporting that provenance is enforced. **This is the worst failure direction in the decision and it cannot be ruled out without the design pass this lane may not perform** | **UNPROVEN — and it is strictly worse than `U-NEW-2`, which only says the mechanism is absent** |
| **`U-NEW-6`** | **NEW.** Whether Firestore actually rejects a read issued in a transaction's write phase, as five in-repo comments assert (`N-8`). **Evidenced by SOURCE READ only; no emulator (no `java`; port 8080 held), no production contact.** The `M-4` reading-(ii) conclusion about the writer's incapability rests on this | **`[SOURCE READ — NOT EXECUTED]` — never relabelled** |
| **`U-NEW-7`** | **NEW.** Whether any caller will ever **catch** an `AuditEventValidationError` and commit anyway, breaking the transaction-abort guarantee every option's ATOMICITY depends on. **Today: 0 catch sites in `functions/src` (`N-5`). The writer cannot enforce it** — it only ever sees a `.set()` (`N-1`) | **UNPROVEN and UNENFORCEABLE at any placement** |
| **`U-NEW-4`** | Re-checked: **`functions/lib` AND `functions/node_modules` are both absent in this worktree** (`N-16`); borrowing `functions/lib` is prohibited by lane contract. **`ownershipHandoffAudit.test.mjs:80-82` imports `../lib/access/auditEventWriter.js`, so every handoff contract test requires a build** | **`NOT_RUN` — unchanged, not relabelled. §2.1 stays `[EXECUTED — transliteration]`** |
| **`U-L`** · **`U-N`** | Unchanged | **`NOT_RUN`** |
| **`M-1`…`M-7`** | Numbering preserved. `M-1`…`M-4` expanded in §15 with alternatives and evidence; **no Owner answer inferred.** `M-2` is **sharpened**: the prior question *"which carrier"* is now shown to depend on a **prior** question — *"does `#181`'s ONE GOVERNED OPERATION mean one AUDIT EVENT or one TRANSACTION?"* — because the one-event reading is **unsatisfiable** under `#182` §3's withholding of field and enum names (`:6652`), while the one-transaction reading is satisfiable today with no schema change | **`MISSING INPUT`** |
| **Recommendation** | **`NONE`, unchanged** — and now `NONE` because **two ruling-derived discriminators oppose each other at comparable strength** (§14.4: axis-awareness → (b); measured present-day compatibility → (a)), **ATOMICITY is a tie held by the placement**, **ACCOUNTABILITY CONTINUITY is vacuous for all three**, and **FAILURE MODE splits internally.** No option is newly supported by this evidence | **NONE** |

**REVISION 2 evidence discipline.** No emulator was run. No production system was contacted. No
schema, field name, enum name, migration, backfill, handoff activation, Rules change, wiring or
implementation was performed or designed. `OD-PACKET-001-006-007.md` was not modified. No census
architecture was designed (`MI-P` reserved it). No person authority was chosen (`MI-X` is open).

---
---

# REVISION 3 — OD-7-POST-M4 LANE (appended 2026-09-13, baseline `64008d5a`)

> **APPEND ONLY. REVISION 1 (§0–§13) and REVISION 2 (§14–§17) ARE NOT MODIFIED, NOT DELETED, AND NOT
> SILENTLY RESTATED.** Where this revision contradicts them, both are cited and the contradiction is
> marked **LOUDLY**.
>
> **TRIGGER:** the Owner's `M-4` ruling of 2026-09-13 — **`M-4` IS CLOSED. Answer: (iii) BOTH, at
> different layers.**
>
> **WHAT THIS REVISION DOES NOT DO.** It does not choose an option merely from the ruling — the Owner
> forbade that in terms. It does not resolve the person-authority source (**PERSON AUTHORITY GAP**
> is preserved; no collection is named). It does not propose a field or enum name, does not design
> the census architecture (`MI-P` reserved it), does not wire, deploy, mutate, migrate, or touch
> Rules. `OD-PACKET-001-006-007.md` was not modified.

## 18. THE RULING AS RECEIVED, AND THE FOUR THINGS IT SETTLES

| # | Ruled | Where it lands in this brief |
|---|---|---|
| **`R-1`** | **NON-EXISTENT EMPLOYEE → INVALID PERSON REFERENCE → NOT ELIGIBLE AS HANDOFF TARGET. That is a Layer-1 failure.** | Closes `M-4` on the Layer-1 half |
| **`R-2`** | **A governed handoff command MUST REFUSE TO COMMIT a handoff whose target person failed Layer-1 resolution; it must require successful authoritative person resolution before mutation. This does NOT mean the pure builder performs the lookup. The command/orchestration boundary must supply a validated target fact.** | Closes `M-4` on the handoff-boundary half, **and relocates the obligation to a layer no option contains** — §20, §21 |
| **`R-3`** | **DO NOT put authoritative Employee existence lookup inside the synchronous audit writer or the pure builder.** | **Ratifies `X-15` and `X-18` and goes further**: what those two established as *impossible at the writer / possible at the builder* is now **forbidden at BOTH** |
| **`R-4`** | Preferred sequence: `TRANSACTION / COMMAND READ PHASE` → resolve target Employee via the canonical person authority → evaluate OD-6 eligibility → construct validated handoff input → **pure family/axis validation** → mutation → audit → **commit atomically**. **If resolution fails: REFUSE BEFORE WRITE.** | §20 `N-19`: **this sequence already exists in the repository, has already executed, and was built without any of (a)/(b)/(c)** |

### 18.1 WHERE THE RULING CONTRADICTS THIS BRIEF — STATED LOUDLY

| # | REVISION 2 said | The ruling says | Resolution |
|---|---|---|---|
| **`Z-5`** | **`X-18` / §14.2 HOW PERSON EXISTENCE IS CHECKED — *"this is the only one of the three placements that CAN host such a check … the builder is called BY the caller, so the caller can perform the Employee read … and hand the fact in."* This was recorded as *"the first evidence-derived discriminator on this field … and it favours (b)."*** | **`R-3`: do not put the lookup in the pure builder.** | **THE DISCRIMINATOR IS VOID — and it was this brief's only discriminator that favoured (b) on the person field.** REVISION 2's *mechanism* survives intact (the caller reads, the pure layer consumes), but its *attribution* was wrong: the capability belongs to the **caller**, i.e. to concern **B**, and REVISION 2 credited it to **(b)** because (b) names the builder. **(b) does not own the caller.** Neither does (a) or (c). **Cited both: §14.2 and `X-18` say (b); `R-2`/`R-3` say the orchestration boundary.** The ruling is authority; REVISION 2 is corrected |
| **`Z-6`** | §14.4 and §17 — recommendation `NONE` because **two ruling-derived discriminators oppose each other at comparable strength** (axis-awareness → (b); measured compatibility → (a)) | The ruling does not adjudicate either | **BOTH DISCRIMINATORS SURVIVE AND BOTH ARE STRENGTHENED — see §20.4.** The opposition is not resolved; it is sharpened on both sides. `NONE` is **not** retained by inertia, and the reason it is retained has changed again |
| **`Z-7`** | §14.2 / `X-14` — *"(b) makes the validated carrier HARDER to reach … which is precisely what production already does (`opportunityCallables.ts:341-348`)"*, describing production as using **the field-change carrier** | — | **WRONG, AND THIS REVISION FOUND IT INDEPENDENTLY OF THE RULING. See `Y-6`.** The live path uses **neither** carrier |

## 19. RE-VERIFICATION OF EVERY CARRIED CLAIM — `[OBSERVED AT: 64008d5a]`

> Each row was re-read from `git show 64008d5a:<path>` in this pass. **Five carried claims are wrong
> and are corrected here.** Corrections carry `Y-`/`X-` numbers continuing REVISION 2's series.

| Carried claim | Re-verified result | Verdict |
|---|---|---|
| `assertValid` is **synchronous, returns `void`** | `function assertValid(input: RecordAuditEventInput): void` — no `async`, no `await` in body | **CONFIRMED** — `access/auditEventWriter.ts:460` |
| `assertValid` is the **first statement** of the write paths | `stageAuditEvent`: `assertValid(input)` **before** `getFirestore()` `:786` and `.doc()` `:787`. `stageAuditEventWithId`: id guard `:817-819` → `assertValid` `:820`. Third path `recordStandaloneAuditEvent` `:840-849` reaches it via `stageAuditEvent` `:846` | **CONFIRMED** — `:785`, `:820`, `:846` |
| `X-6` — the matrix imports **only** `./typedOwner`, which the writer already imports | `ownershipMatrix.ts:49` is its **sole** import line. `auditEventWriter.ts:58` already imports `../ownership/typedOwner`. Adding the matrix to the writer therefore introduces **exactly one** new module, whose only dependency is **already present** | **CONFIRMED AND SLIGHTLY STRENGTHENED** |
| `U-NEW-2` — `buildOwnershipHandoff` returns an **unmarked plain object** | `:178-190` returns an object literal typed `RecordAuditEventInput`; no brand, no symbol, no marker, no class | **CONFIRMED** — `ownership/ownershipHandoffCommand.ts:178-190` |
| `X-12` — (c) is **not unprecedented** | *"a no-op handoff → enforced in the audit writer, **restated here** so the caller gets the error before staging"* | **CONFIRMED — and the DIRECTION matters, see `X-19`** — `ownershipHandoffCommand.ts:22-23` |
| `M-2` carriers | handoff carrier `:387-390` (`previousOwner` `:387`, `newOwner` `:388`, `handoffReason` `:389`, `handoffSource` `:390`); field-change carrier `:405-407`; `FIELD_CHANGE_ACTIONS` `:414-416` with its **one** member `"updateEmployeeProfile"` at `:415` | **CONFIRMED** (`Y-4`/`Y-5` ranges hold) |
| **PATH** of the writer | The writer is at **`functions/src/access/auditEventWriter.ts`** (929 lines). `functions/src/audit/auditEventWriter.ts` **does not exist at `64008d5a`** | **`Y-7` — CITATION CORRECTION.** All line numbers in the lane brief were right; the directory was not |

### 19.1 `U-NEW-1` — **THE DENOMINATOR IS WRONG, AND THE HEADLINE IS WRONG REPO-WIDE**

| Measure | Carried as | Re-measured at `64008d5a` | Method |
|---|---|---|---|
| files **importing** `auditEventWriter` | **44** | **44** ✅ | `git grep -l -E "from ['\"].*auditEventWriter" 64008d5a -- functions/src` |
| files **mentioning** it | **50** | **50** ✅ (mention-only gap = **6**) | same, without the `from` anchor |
| **write-capable** importers | **42** | **40** ❌ | of the 44, those also referencing `stageAuditEvent` / `stageAuditEventWithId` / `recordAuditEvent` / `recordStandaloneAuditEvent` |
| write-capable importers that **can pass `OWNERSHIP_HANDOFF`** | **ZERO** | **ONE** ❌ | `ownershipHandoffCommand.ts` is itself one of the 40 (it imports `stageAuditEvent` `:36`) and it passes `action: "OWNERSHIP_HANDOFF"` `:180`. `employeeProfileCommands.ts` was the only other hit and it is a **comment** (`:252-257`); it passes `UPDATE_ACTION` at `:483` and `:628` |

> ### **`X-20` — `U-NEW-1`'s HEADLINE IS FALSE REPO-WIDE, AND THE COUNTEREXAMPLE MATTERS MORE THAN THE ARITHMETIC**
>
> **Corrected statement:** *of the **40** write-capable `auditEventWriter` importers in
> `functions/src`, **39** cannot pass `OWNERSHIP_HANDOFF` without a source change; the 40th is the
> handoff builder itself.* **44 import, 50 mention — both confirmed.**
>
> **But `OWNERSHIP_HANDOFF` is not unreachable, and it is not unexercised.**
> `functions/scripts/assignWarehouseRootCompany.js:234` calls
> `stageOwnershipHandoff(txn, assignmentHandoffInput(d), { actorUid })` **inside a real
> `db.runTransaction`** opened at `:214`, and
> `docs/specifications/reorder-trusted-command-authority.md:208` records that **five real
> `OWNERSHIP_HANDOFF` events were actually written** in sandbox under `R-28`, *"each with one
> `OWNERSHIP_HANDOFF` (`previousOwner: null`)"*, a re-run writing 0.
>
> **Consequence for this decision:** every option's MIGRATION field in §14 was assessed against a
> population of callers that was implicitly **empty**. It is not empty. **There is one live producer
> of the action, it sits outside `functions/src`, and it is not counted by any importer census in
> this brief.** `X-9` (*"(b) has no working precedent for a transfer"*) **still stands** — that
> producer pins `previousOwner: null` (`warehouseRootCompanyAssignment.ts:376,387`) — but
> *"(b) has no working precedent"* unqualified would now be false: **the builder path is exactly what
> the one live producer uses**, which is a point **for** (b) that REVISION 2 recorded only as
> *"the one live caller already complies (`N-18`)"* without connecting it to the count.

### 19.2 `X-21` — "EVERY MODULE IN `functions/src/ownership/` DECLARES ITSELF **PURE**, EACH BY ITS OWN HEADER" IS **NOT TRUE AS STATED**

| Wording actually used | Modules |
|---|---|
| **`PURE`** explicitly | `creationOwnerResolution.ts:25` · `operatingCompanyAuthority.ts:6` · `ownershipBackfillRules.ts:27` · `ownershipDerivation.ts:26` · `warehouseCanonicalIdRepair.ts:4` · `warehouseRootCompanyAssignment.ts:4` |
| *"stays pure"* (a clause, not a header declaration) | `commercialCompanyScope.ts:52` · `reorderRequestLocationAuthority.ts:53` |
| *"a **pure** builder … Pure: no Firestore, no I/O, no clock"* | `ownershipHandoffCommand.ts:4, 73` |
| **`READ-ONLY BY CONSTRUCTION`** — a *different* claim (it takes documents; it cannot write) | `ownershipCensus.ts:9-10` |
| **`INERT, DERIVED, READ-NORMALIZED`** — a *third* wording | `typedOwner.ts:7-8` |
| **NO PURITY OR I/O DECLARATION AT ALL** | **`ownershipMatrix.ts`** — its 48-line header is about the census reconciliation and the four owner classes; purity is nowhere asserted. It is nonetheless a frozen literal with **one** import (`:49`) and **zero** `async`/`await`/`getFirestore`/`.collection(` |

> **Severity: MEDIUM, and it cuts against the strongest form of the argument.** The *substance*
> (nothing in `functions/src/ownership/` performs I/O) holds at baseline. The *form* — *"each by its
> own header"* — does not: **the one module option (a) would import into the writer is the one module
> that never declares the property (a) depends on.** `R-3`'s prohibition is unaffected either way,
> because `R-3` forbids the lookup rather than relying on a header. **Cited both:** the lane brief and
> REVISION 2 `X-15`/`X-18` state the uniform version; `ownershipMatrix.ts` (header, 48 lines) is the
> counterexample.

### 19.3 `X-22` — (b)'s MEASURED BREAKAGE: THE **SHAPE** IS RIGHT, THE **NUMBERS** ARE NOT

| Measure | `X-14` carried | Re-counted at `64008d5a` |
|---|---|---|
| `ownershipHandoffAudit.test.mjs` tests | **6** | **7** (`:47`, `:58`, `:108`, `:112`, `:119`, `:123`, `:129`) |
| …of which exercise `stageAuditEvent` with a **hand-rolled** input | (not distinguished) | **5.** `:47` and `:58` are **static source-text** checks and touch no writer function |
| assertions / refusal patterns broken under (b) | **~12 / 6** | **11 `refuses(...)` invocations** (`:109`, `:113-116`×4, `:120`, `:125-126`×2, `:131`, `:136`, `:141`) **+ 1 `assert.deepEqual` `:124`** = **12 assertions**, across **6 distinct refusal regexes** |
| the hand-rolling method | `:90-101`, `:105` | **CONFIRMED VERBATIM** — `validHandoff()` `:89-100` is a literal; `refuses` `:102-106` calls `stageAuditEvent(rejectingWriter, input)` directly |

> **Net: `X-14` is directionally right and numerically off by one test.** The corrected figure is
> **7 tests, 5 writer-exercising, 12 assertions, 6 refusal regexes.** **(b) remains the only option
> with measured present-day breakage, and the only one changing the writer's public surface.**

### 19.4 `X-23` — A **NEW** MEASUREMENT THAT **REDUCES** (b)'s COST, FOUND IN THIS PASS

**Eight tests in two files call `buildOwnershipHandoff`** — `ownershipModel.test.mjs:215, 344, 367,
384, 398, 440, 821` and `warehouseRootCompanyAssignment.test.mjs:251` — carrying **36 assertions**
(29 + 7). **Not one of them asserts a whole-object `deepEqual` on the builder's return.** Every
assertion is field-by-field: `event.action` `:256`, `event.targetType` `:257`, `event.previousOwner`
`:259`, `assert.deepEqual(event.newOwner, …)` `:260`, `event.actorUid` `:261`,
`assert.match(event.summary, …)` `:262`; likewise `ownershipModel.test.mjs:360-361`.

> **Consequence:** **adding a provenance marker to `buildOwnershipHandoff`'s return (`:178-190`)
> would break ZERO of those 36 assertions.** `U-NEW-2`'s *remediation* cost is therefore smaller
> than REVISION 2 implied — the gap is a **design** gap, not a test-migration gap. This is the first
> finding in three revisions that **lowers** a measured cost for (b). It does **not** touch `U-NEW-5`
> (whether such a marker can be made unforgeable), which is the objection that actually matters and
> which §20.3 now makes worse.

## 20. TASK 1 — THE THREE OPTIONS AGAINST THE RULED SEQUENCE

### 20.1 `N-19` — **THE RULED SEQUENCE ALREADY EXISTS, HAS ALREADY RUN, AND CONTAINS NONE OF (a), (b) OR (c)**

`functions/scripts/assignWarehouseRootCompany.js`, read verbatim at `64008d5a`:

| `R-4` step | Where it is, in that file | Line |
|---|---|---|
| authoritative facts assembled, refuse if they do not reconcile | `assertAuthoredFacts()` → `resolveAuthoredWarehouseAssignments(config)`; throws `REFUSING:` unless `MATCHED` | `:131-141` |
| read phase (pre-plan) | `db.collection(WAREHOUSES).doc(id).get()` for every candidate | `:172-173` |
| evaluate eligibility, **purely** | `planWarehouseRootCompanyAssignment(authored, candidates)` — `warehouseRootCompanyAssignment.ts`, **PURE by its own header** `:4` | `:175` |
| **REFUSE BEFORE WRITE** | *"BLOCKED … Zero writes. The whole batch is validated before anything is mutated, so a refusal anywhere stops all of it rather than leaving a partial assignment behind."* | `:189-195` |
| **ONE governed transaction** | `await db.runTransaction(async (txn) => {` — *"the patches and their audit events commit together or not at all"* | `:209-214` |
| **TRANSACTION READ PHASE** — re-read inside the transaction | `txn.get(ref)` for every target; *"a warehouse that changed between the plan and the commit fails closed rather than being overwritten on stale evidence"* | `:210-216` |
| in-transaction re-validation, fail closed | `ABORTING: … disappeared between plan and commit` · `ABORTING: … gained a company … between plan and commit` | `:218-227` |
| construct validated handoff input | `assignmentHandoffInput(d)` — **PURE**, returns the input shape only | `:234` → `warehouseRootCompanyAssignment.ts:373-395` |
| **pure family/axis validation** | `stageOwnershipHandoff` → `buildOwnershipHandoff` `:78-191` (family known `:89-95`, participating `:101-106`, ownable `:110-115`, IMMUTABLE `:116-121`, owner-type compat `:126-134`, `previousOwner` explicitness `:137-142`, no-op `:153-158`, source closed `:161-166`) | `:234` |
| mutation | `txn.update(refs[i], assignmentPatch(d))` | `:231` |
| audit, staged onto the **same** writer | `stageOwnershipHandoff(txn, …)` — *"The writer seam is anything with `.set(ref, data)` -- a Transaction is one, which is how the audit event commits with the patch rather than beside it"* | `:232-234` |
| **commit atomically** | the `runTransaction` boundary closes | `:237` |

**And it has executed:** `docs/specifications/reorder-trusted-command-authority.md:208`.

**The idiom is not exotic.** In `functions/src` alone, **61** modules call `runTransaction`, and
**33** of those **also** import `auditEventWriter` — i.e. 33 existing governed commands already run
`READ → VALIDATE → WRITE → AUDIT → COMMIT` on one transaction.
`access/trustedWriterCommands.ts:1966` states the ruling's refusal rule in the repo's own words:
*"refuse BEFORE any write (no audit against the mismatched project)."*
The pure-consumer contract is likewise pre-stated: `ownership/creationOwnerResolution.ts:25-26` —
*"PURE: no Firestore, no I/O. The caller reads the upstream document (inside its own transaction, so
the inherited owner cannot drift between the read and the write) and hands the derivation in."*

> #### **WHAT `N-19` PROVES, AND ITS ONE LIMIT**
>
> **Proves:** `R-4` is implementable at this baseline, is already implemented once end-to-end, and
> **required no change to the audit writer, no change to the builder's signature, and no new refusal
> in either.** It was built entirely in the **orchestrator**. **`R-4` therefore does not select among
> (a), (b) and (c) — it is satisfied by a layer none of them occupies.**
>
> **Limit, and it is exactly the `PERSON AUTHORITY GAP`:** that precedent resolves a **COMPANY** fact,
> and it resolves it from an **authored JSON config cross-checked against a pinned expectation**
> (`:131-141`, `config/ownership/operating-company-roots.sandbox.json`) — **not** from a live
> authority. `R-4`'s first step says *"resolve target Employee using the canonical person authority."*
> **No authored file and no authority can play that role for a person at this baseline**, and naming
> one is outside this lane. **So the precedent proves the SHAPE and leaves `R-4` step 1 with no
> referent.**

### 20.2 THE OWNER'S ELIMINATION TEST, APPLIED WITH THE THREE OUTCOMES DISTINGUISHED

> **Test:** *"any option that cannot accommodate a governed pre-write read/validation phase cannot
> independently satisfy the complete handoff contract."*
>
> **"INDEPENDENTLY", DEFINED PRECISELY, BECAUSE THE WHOLE RESULT TURNS ON IT.** An option satisfies
> the contract **independently** iff, with that option in place and **no other layer changed**, a
> handoff to a non-existent Employee is refused before mutation. **All three fail that.** The
> question the test actually decides is therefore the *weaker* one the lane brief specifies: whether
> the option is **incompatible** with an orchestration layer that hosts the phase — and that is a
> different question with a different answer.

| | **Can the option HOST the pre-write read?** | **Is it INCOMPATIBLE with an orchestrator that hosts it?** | **Independently satisfies the complete contract?** | **Outcome** |
|---|---|---|---|---|
| **(a)** writer consults the matrix | **NO, twice over.** `assertValid` is sync `void` (`:460`) and runs in the transaction **write** phase (`U-NEW-6`, source-read only) — and `R-3` **forbids** it regardless | **NO.** (a) is a synchronous shape/table check on an input the orchestrator has already validated. It neither performs nor prevents any read; `ownershipMatrix.ts` has zero `await` | **NO** | **SURVIVING — orchestrator (concern B) as a NAMED DEPENDENCY** |
| **(b)** writer rejects unless staged through the builder | **NO.** (b) is a rule *at the writer*; the writer still cannot read. The **builder** cannot host it either — `R-3` forbids it, ending `X-18`'s route (`Z-5`) | **NO — and it is the only option that makes the orchestrator STRUCTURALLY MANDATORY**, since the sole permitted route runs `stageOwnershipHandoff:200-206` → `buildOwnershipHandoff`, which a caller must invoke | **NO** | **SURVIVING — orchestrator as a NAMED AND ENFORCED DEPENDENCY** |
| **(c)** both | **NO** (union of two NOs) | **NO** | **NO** | **SURVIVING — orchestrator as a NAMED DEPENDENCY** |

> ### **`X-24` — THE TEST ELIMINATES NOTHING AMONG (a), (b) AND (c). IT ELIMINATES THE CLAIM.**
>
> **No option is eliminated. No option can host the phase. All three are identically dependent on
> concern B, and `R-3` is the reason — it removes the two layers the options are about from
> contention for the read, so the read was never theirs to win.**
>
> **What the test does eliminate is the premise of `OD-7` as framed:** that one of these three
> placements could *"satisfy the complete handoff contract."* After `R-2` and `R-3`, **none can, and
> none was ever going to** — which is a correction to the packet's framing, not to any option.

### 20.3 `X-25` — THE RULING **WORSENS** (b), AND IT IS A NEW *SOUNDNESS* OBJECTION, NOT A COST

`R-2` moves the load-bearing guarantee from *"the builder ran"* to *"the orchestration boundary
supplied a **validated target fact**."* Ask what the writer could verify about that property:

| Candidate | Result |
|---|---|
| perform the resolving read itself | **FORBIDDEN** by `R-3`; **and impossible** — `assertValid` is sync `void` `:460` in the write phase |
| inspect the input's shape | Possible, and it is what the writer already does — `:540-570` validates the four handoff fields unconditionally. **But shape is exactly what `R-2` says is insufficient**: the builder *"must consume an already-resolved person fact rather than pretending a string id proves Employee existence"*, and `TypedOwner` is `{ type, id }` with `id: string` (`typedOwner.ts:19-22`) |
| trust a marker the builder attaches | The only remaining route — and it is `U-NEW-5` verbatim: **a forgeable marker fails OPEN**, accepting a hand-rolled handoff while reporting that provenance is enforced |

> **`U-NEW-2` was a gap (the mechanism is absent). `U-NEW-5` was a risk (it might be forgeable).
> `R-2`/`R-3` together make it a CATEGORY LIMIT: the property (b) would enforce — that an
> authoritative resolution happened upstream — is UNVERIFIABLE at the writer in principle, because
> verifying it requires either the read the writer may not perform or trust in a marker the writer
> cannot authenticate.** (b) can still soundly enforce *"the pure checks ran"*; it can **never**
> soundly enforce *"the target was resolved."* **That is a downgrade in what (b) buys, delivered by
> the ruling, and it is the sharpest answer this lane can give to the lane brief's question about
> `U-NEW-2`.**
>
> **`U-NEW-2` — DOES THE RULED SEQUENCE CLOSE IT, MAKE IT IRRELEVANT, OR LEAVE IT OPEN? ANSWER: it
> makes it IRRELEVANT TO THE CONTRACT and leaves it OPEN AS A DESIGN QUESTION.** Irrelevant, because
> under `R-4` the fact's provenance is guaranteed by the orchestrator's in-transaction read
> (`N-19` `:210-216`) — the place `creationOwnerResolution.ts:25-26` already says drift is prevented —
> so nothing in the *contract* now depends on the writer recognising the builder. Open, because if
> the Owner still wants a writer-side provenance gate as defence in depth, the mechanism remains
> undesigned and `U-NEW-5` remains unresolved. **It is not closed.**

### 20.4 `X-26` — THE RULING **STRENGTHENS (a)'s** POSITION TOO, SO §14.4's OPPOSITION SURVIVES

| Direction | New ruling-derived evidence |
|---|---|
| **toward (b)** | `R-4` makes the pure builder a **named stage** of the governed sequence (*"→ pure family/axis validation →"*), and `R-2` makes the orchestrator mandatory — so (b)'s rule *"responsibility-moving events are staged through their governed authority"* is the structure `R-4` describes. **And `X-20` supplies what REVISION 2 missed: the one live producer of the action already uses that route** (`assignWarehouseRootCompany.js:234`) |
| **toward (a)** | `R-4` allocates *"supported family · supported axis"* to the **pure builder**, and **the builder already does all of it** (`:89-121`, `:126-166`). So the writer-side family check (a) proposes is **redundant with the ruled allocation** — which reads against (a)… **except that `X-19` shows the repo's shipped precedent runs the OTHER WAY**: `ownershipHandoffCommand.ts:22-23` records the **no-op** as *"enforced in the audit writer, restated here"* — **authority at the writer, convenience copy in the builder.** That is (a)'s topology, already shipped, for one handoff invariant, with a written rationale. `X-12` established (c) is not unprecedented; **`X-19` adds that the precedent's DIRECTION is (a)'s.** And (a) alone survives a caller that skips the builder — which matters precisely because `R-1`'s defect is a bad target reaching the write |
| **unchanged** | `X-15` (a) can never host the person check · `X-13` (a)'s refusals ride a code-less class no mapper reads · `X-22` (b) is the only measured breakage · `X-23` (b)'s marker breaks no builder test |

> **§14.4's symmetry HOLDS. Both poles moved outward, neither crossed.** `Z-6` is the record of that.

## 21. TASK 2 — THE FIVE CONCERNS, SEPARATED. **NOT COLLAPSED.**

| | Concern | **What exists at `64008d5a` (`file:line`)** | **What is missing** | **Which of (a)/(b)/(c) touches it** | **In `OD-7` scope?** |
|---|---|---|---|---|---|
| **A** | **PERSON AUTHORITY RESOLUTION** | **Nothing authoritative.** `typedOwner.ts:7-8` — *"INERT, DERIVED, READ-NORMALIZED. No setter, no writer, no persistence"*; `TypedOwner = { type, id }` `:19-22`; `isTypedOwner` is **shape only**, used at `ownershipHandoffCommand.ts:126,144` and `auditEventWriter.ts:541,554`. The matrix declares **two** rows claiming person authority (`ownershipMatrix.ts:514,515`) and **no single** one (`X-17`) | **Everything in the `PERSON AUTHORITY GAP`**: stable Employee/business-person identity · namespace · **existence** · employment/current-status · historical identity preservation · Principal/Firebase linkage · technician relation · operating-company context | **NONE.** `R-3` forbids A in the writer **and** in the builder; (a)/(b)/(c) are those two layers | **NO.** Named dependency, not solvable here |
| **B** | **HANDOFF COMMAND ORCHESTRATION** | **The idiom is pervasive and the ruled sequence is implemented once end-to-end.** 61 `functions/src` modules call `runTransaction`; **33** also import `auditEventWriter`. `trustedWriterCommands.ts:1966` — *"refuse BEFORE any write."* `creationOwnerResolution.ts:25-26` states the pure-consumer contract. **The full `R-4` sequence, executed:** `scripts/assignWarehouseRootCompany.js:131-141, 172-175, 189-195, 209-237` (`N-19`), five real events per `docs/specifications/reorder-trusted-command-authority.md:208` | **A handoff orchestrator in `functions/src`** — there is none; the only one is an operator script outside it, it is not exported from `index.ts`, and it resolves a **COMPANY** fact from an **authored config** (`:131-141`), never a person from an authority. **`R-4` step 1 has no referent** (depends on **A**) | **NONE.** No option adds, changes or constrains an orchestrator. **(b) makes one structurally mandatory without supplying it** | **NO — and this is where `R-2` puts the obligation.** **THE GAP IS HERE** |
| **C** | **PURE FAMILY/AXIS VALIDATION** | **Implemented, and it already matches `R-4`'s enumerated builder contract.** `ownershipHandoffCommand.ts` — family known `:89-95` · participating-companies refusal `:101-106` · not-ownable `:110-115` · **IMMUTABLE** `:116-121` · owner/family type compatibility `:126-134`, `:147-152` · `previousOwner` explicit-vs-forgotten `:137-142` · **no-op** `:153-158` · closed source set `:161-166`. Table: `ownershipMatrix.ts` (578 lines), `ownershipFamily()` an O(1) `Map.get` | **AXIS — the word appears 0 times in `ownershipHandoffCommand.ts`** (4 times in `ownershipMatrix.ts`), so *"supported axis"* has no implementation. **And `R-2`'s consumption contract is unmet:** the builder takes `newOwner: TypedOwner` (`:58`), a bare `{type,id}` — the *"string id pretending to prove Employee existence"* the ruling names | **(b)** makes C a mandatory route; **(a)** duplicates C's family half at the writer; **(c)** both | **YES** |
| **D** | **AUDIT WRITING** | **Complete for the handoff, and closed both ways.** Four handoff fields `:387-390`; validated **unconditionally** for the action `:540-570`; refused for every other action `:571-582`; `objectId` required `:520-536`; `handoffReason` length + secret guards `:586-600`. `assertValid` `:460`, first statement at `:785`/`:820`/`:846`. Writer **stages, never commits** — `AuditEventWriter` is `{ set() }` (`:769-771`), append-only by design (`:773-777`) | **Nothing for `R-4`.** The writer already commits with the caller's mutation by construction (`:765-771`) | **ALL THREE.** This is the only file (a), (b) and (c) each edit | **YES** |
| **E** | **TRANSACTION COMMIT** | **Owned by the caller, deliberately.** `:765-771` — *"a caller passes either one, **already holding its own business-mutation writes**, so this Audit Event write commits (or aborts) exactly WITH those writes, never independently."* The writer's **only** committer is `recordStandaloneAuditEvent:840-849`, for audit-only events. The 33 modules in **B** commit; `N-19` commits at `:237` | **No handoff committer in `functions/src`** — a restatement of **B**, not a separate gap | **NONE.** No option commits anything or changes who does | **NO** |

> ## **`X-27` — THE FINDING THE FIVE-WAY SEPARATION PRODUCES, STATED PLAINLY AS THE LANE BRIEF REQUIRES**
>
> **THE THREE OPTIONS DIFFER ONLY ON `C` AND `D`. THE REAL GAP IS `A` AND `B`.**
>
> - **`C` is already satisfied** against `R-4`'s own enumeration of the pure builder's contract —
>   family, immutability, owner/person type compatibility, current/next structure, no-op refusal are
>   all implemented at `ownershipHandoffCommand.ts:89-166`. What is missing from `C` is **axis**
>   (0 occurrences) and **the resolved-person input type** — and **neither of those is what (a), (b)
>   or (c) proposes.**
> - **`D` is already complete** for the handoff and is closed in both directions (`:540-582`).
> - **`A` is empty** and `R-3` bars the options' two layers from filling it.
> - **`B` is where `R-2` puts the obligation**, has 33 in-repo precedents plus one executed
>   end-to-end instance, and **no option touches it.**
>
> **So the ruling narrows `OD-7` exactly as the lane brief anticipated: from "where does validation
> live" to "what must the orchestration boundary guarantee" — and the second question is not a choice
> among (a), (b) and (c).**

## 22. DOES THE THREE-OPTION FRAME STILL FIT? **NO — AND THE MISSING SHAPE MUST BE NAMED**

| | Assessment |
|---|---|
| **Why it no longer fits** | The frame asks **where family-level handoff validation must live** and offers three answers spanning **C** and **D**. `R-2` relocates the contract's load-bearing requirement to **B**; `R-3` bars **A** from **C** and **D**; `R-4` allocates **C** to the builder, **where it already is**. The frame's three answers are therefore all answers to a question that is **no longer the binding one** |
| **What the frame cannot express** | That **C stays exactly where it is** (`ownershipHandoffCommand.ts:89-166`), **D is left unchanged**, and `OD-7`'s substance moves to a constraint on **B**. That is a **positive placement** — *"family/axis validation lives in the pure builder; the writer is not a second family authority"* — and **it is not `(d)`**, which was *"neither, yet — wire nothing"* (§5, §6.3 `(d-place)`/`(d-wire)`). `(d-place)` was eliminated in REVISION 2 §6.3. **This shape is a ruling, not a deferral, and the packet's four options do not contain it** |
| **How it is recorded** | As **`(e)` — a fourth live shape, surfaced, not chosen.** Consistent with `X-27` and with `N-19`, which shows it is the shape the one executed handoff already has. **This lane does not select it**, because the Owner forbade choosing from the ruling and because the question *"is a second writer-side family authority still wanted as defence in depth?"* is a governance preference no evidence in this brief settles |
| **Is surfacing `(e)` within lane?** | Yes. The lane brief requires *"whether the three options are even still the right frame"* and forbids collapsing the five concerns *"merely to preserve an old three-option framing."* `(e)` names no field, no enum, no collection, no authority, and designs no architecture |

## 23. `M-1`…`M-4` UNDER THE RULING — NO OWNER ANSWER INFERRED

| | Status after the ruling | Evidence |
|---|---|---|
| **`M-4`** | **CLOSED by the Owner — (iii) BOTH, at different layers** (`R-1`, `R-2`). Recorded; not reinterpreted | `R-1`–`R-4` |
| **`M-1`** — which axis/axes | **STILL OPEN, with new evidence that sharpens it.** `R-4` puts *"supported **axis**"* in the pure builder's contract and forbids *"owner/accountability conflation"* — so the ruling **presupposes more than one axis** and presupposes the builder knows which are supported. **At baseline the builder has no axis concept whatever: `axis` appears 0 times in `ownershipHandoffCommand.ts`** (4 times in `ownershipMatrix.ts`), and `accountablePerson` appears in **0** files under `functions/src`. **The ruling therefore adds evidence that `M-1`'s answer is "more than ownership" without saying which axes** — and it does so without touching `MI-P`'s reservation. **`M-1` is not answered and this lane does not lean** | `ownershipHandoffCommand.ts` (grep `axis` = 0) · `ownershipMatrix.ts` (4) · `accountablePerson` = 0 files |
| **`M-2`** — which carrier | **THE RULING CONSTRAINS IT, WEAKLY BUT REALLY — BY EXCLUSION, AND WITHOUT NAMING A CARRIER. STATED EITHER WAY BELOW** | see §23.1 |
| **`M-3`** — architecture only, or authorizes wiring | **STILL OPEN. The ruling supplies evidence for BOTH readings and this lane declines to infer.** **Toward "authorizes wiring":** `R-2` and `R-4` are imperative (*"must refuse to commit"*, *"must require"*) and `R-4` is specific enough to implement as written — `N-19` proves an implementation of that shape is achievable at this baseline with no new authority. **Toward "architecture only":** `R-4`'s **step 1 has no referent** — *"resolve target Employee using the canonical person authority"* names something that does not exist (**A** is empty; `ownershipMatrix.ts:514,515` claim person authority **twice**, `X-17`), so the sequence cannot be wired however imperative its verbs; and the ruling **explicitly declines to select a placement** (*"Do not automatically choose an option merely from this ruling"*), which is the very act `M-3` asks about. **On evidence the unmet precondition is the harder fact, but "harder fact" is not the Owner's answer and `M-3` is about intent.** `M-3` STAYS OPEN | `R-2`, `R-4` · §21 row **A** · `X-17` |

### 23.1 `M-2` — WHAT THE RULING DOES AND DOES NOT CONSTRAIN

> `R-4` says **"WRITE AUDIT"** and names **no carrier**. Both readings are carried.

| Reading | Case |
|---|---|
| **The ruling DOES constrain `M-2`** | `R-4` requires the audit write **inside the one governed transaction, after the responsibility mutation, before commit.** At this baseline only **one** carrier can satisfy that for a handoff: the field-change carrier is refused for any action outside `FIELD_CHANGE_ACTIONS` (`auditEventWriter.ts:661-670`), whose **sole** member is `"updateEmployeeProfile"` (`:415`); and the four handoff fields are refused for any action but `OWNERSHIP_HANDOFF` (`:571-582`). **The two carriers are mutually exclusive by construction.** Admitting a handoff to the field-change carrier would require adding an action to `FIELD_CHANGE_ACTIONS` — **an enum change `#182` §3 withholds and this lane may not propose.** So `R-4` **rules out the field-change carrier by exclusion**, leaving the handoff carrier as the only satisfiable one — **without the Owner naming it** |
| **The ruling does NOT constrain `M-2`** | `R-4` is silent on the carrier, and `M-2`'s **sharpened** form (§15.2) is a **prior** question — *"does `#181`'s ONE GOVERNED OPERATION mean one AUDIT EVENT or one TRANSACTION?"* **`R-4` answers that prior question in favour of ONE TRANSACTION** (`READ · VALIDATE · WRITE · WRITE AUDIT · COMMIT` is a transaction, not an event) — and the one-transaction reading was already *"satisfiable today with no schema change"*, so the ruling relieves the pressure on `M-2` without deciding which carrier a responsibility move must use. **And `M-2`'s live half is untouched** (`Y-6`) |

> ### **`Y-6` — CORRECTION TO `X-5` / §2.5 / §14.2, FOUND IN THIS PASS AND INDEPENDENT OF THE RULING**
>
> REVISION 2 §14.2 says the incentive under (b) is to record ownership moves on *"the unvalidated
> **field-change carrier** … which is precisely what production already does
> (`opportunityCallables.ts:341-348`)."* **That is wrong, and the mechanism makes it impossible.**
> `functions/src/opportunity/opportunityCallables.ts:337-350` stages
> `action: "updateOpportunity"` carrying **`actorUid`, `targetType`, `targetId`, `outcome` and a
> `summary` string listing changed field NAMES** — **no `fieldKey`, no `previousValue`, no
> `newValue`.** It **cannot** carry them: `:661-670` refuses all three for any action outside
> `FIELD_CHANGE_ACTIONS`, and `updateOpportunity` is not a member (`:415`). The module says so itself
> at `:343-348` — *"`RecordAuditEventInput` has no metadata/detail field, so BEFORE/AFTER VALUES
> CANNOT BE RECORDED without altering the governed audit schema."*
>
> **Corrected:** the live ungoverned ownership move uses **neither** `M-2` carrier — it uses a
> **free-text `summary` naming the changed field**. **Severity: MEDIUM.** It **sharpens** `M-2` (the
> real competitor to the handoff carrier is not carrier #2 but an unparseable sentence) and it
> **weakens** REVISION 2's *"(b) pushes moves toward the carrier nothing governs"* argument — there
> is no such carrier to be pushed toward; there is only a summary string, which is equally available
> under (a) and (c). **Cited both:** §14.2 / `X-5` say field-change carrier; `:337-350` and `:661-670`
> say otherwise.

## 24. THE VERDICT

> # **OWNER DECISION STILL REQUIRED.**
>
> **RECOMMENDATION REMAINS `NONE` between (a), (b) and (c) — for the third time, and for a third,
> narrower reason.** REVISION 1: no discriminators. REVISION 2: two discriminators in opposition.
> **REVISION 3: the ruling moved the binding requirement to a layer none of the three options
> occupies, so the choice among them no longer decides whether the handoff contract is satisfied.**
>
> **THIS IS NOT CLINGING TO `NONE`.** The lane brief's instruction was to declare dominance if the
> ruling produced it. It did not, and the reason is structural rather than evidential: `R-3` removed
> both candidate layers from contention for the person check, `R-4` allocated family/axis to the
> builder **where it already lives** (`ownershipHandoffCommand.ts:89-166`), and `N-19` shows the ruled
> sequence was **already built once, end to end, without any of the three** — so no option gained
> the ability to satisfy anything it could not satisfy before, and none lost it either.
>
> **WHAT DID CHANGE, AND IT IS SUBSTANTIVE:**
>
> | # | Change | Direction |
> |---|---|---|
> | **1** | **The complete handoff contract is satisfied at `B`, which no option touches** (`X-27`) | Demotes the whole (a)/(b)/(c) question from *"does handoff validation exist"* to *"is redundant defence wanted on one carrier"* |
> | **2** | **`X-18`/§14.2's person-existence discriminator for (b) is VOID** (`Z-5`) — `R-3` forbids the builder-side check the argument depended on | Removes the only discriminator that favoured (b) on the ruled defect |
> | **3** | **`U-NEW-2` becomes a SOUNDNESS limit, not a gap** (`X-25`) — the writer can never verify that an authoritative resolution happened | Against (b), and stronger than any prior objection to it |
> | **4** | **`X-23` — a provenance marker breaks ZERO of the 36 builder-test assertions** | For (b): the first measured cost *reduction* in three revisions |
> | **5** | **`X-19` — the repo's shipped duplication precedent runs in (a)'s direction** (authority at the writer, restatement in the builder, `:22-23`) | For (a), and it is the flip side of `X-12` |
> | **6** | **`X-20` — `OWNERSHIP_HANDOFF` has one live producer and five events actually written**; `U-NEW-1`'s "zero" was a `functions/src` artefact | For (b) (the live producer uses the builder route); against every MIGRATION assessment that assumed an empty caller population |
> | **7** | **The three-option frame no longer fits; `(e)` is surfaced** (§22) | Reframes, selects nothing |
>
> ## THE RESIDUAL QUESTION — ONE QUESTION, NARROWER THAN BEFORE
>
> > **Given that `R-2` places the complete handoff contract at the orchestration boundary (`B`) and
> > `R-4` allocates family/axis validation to the pure builder — where it is already fully
> > implemented (`ownershipHandoffCommand.ts:89-166`) — does `OD-7` still require a SECOND,
> > WRITER-SIDE enforcement for paths that bypass the builder?**
> >
> > **IF NO → `(e)`:** `C` stays in the builder, `auditEventWriter.ts` is unchanged, and `OD-7`'s
> > ruling is a constraint on `B`. *(A positive placement, not `(d)`. `(d-place)` remains eliminated.)*
> >
> > **IF YES → then and only then does the (a)/(b)/(c) choice arise**, and it arises as a
> > **defence-in-depth** question on **one** carrier, with §14.4's opposition intact and `X-25`
> > added: **(a)** an independent matrix check — sound, zero measured breakage, cannot host `A`,
> > refusals ride a code-less class no mapper reads (`X-13`), precedent-aligned (`X-19`);
> > **(b)** a provenance gate — soundly enforces only *"the pure checks ran"*, **never** *"the target
> > was resolved"* (`X-25`), the only measured breakage (`X-22`: 5 tests, 12 assertions, 6 regexes),
> > the only public-surface change, mechanism still undesigned (`U-NEW-5`); **(c)** the union.
>
> ## WHAT WOULD HAVE TO BE TRUE FOR ANY OPTION TO BECOME DOMINANT
>
> | For | Requires |
> |---|---|
> | **(a)** | That the Owner wants family semantics enforced for callers that bypass the builder — i.e. answers the residual question **YES** and values bypass-resistance over the builder's coded refusals. Also requires accepting that `AuditEventValidationError` carries no code (`:354`) and that **0** `functions/src` files catch it (`N-5`) |
> | **(b)** | The residual question answered **YES**, **plus** a resolution of `U-NEW-5` showing the marker is unforgeable, **plus** acceptance that what it enforces is only *"the pure checks ran"* (`X-25`), **plus** the `X-22` rewrite |
> | **(c)** | Everything (b) requires, plus (a)'s coupling, plus a written read-order constraint (§14.3) so the two refusal sites cannot invite the placement `R-3` forbids |
> | **`(e)`** | The residual question answered **NO** — and an Owner ruling that `OD-7` is discharged by constraining `B`. **Requires `A`.** This lane does not select it |

## 25. `UNPROVEN` · `NOT_RUN` · `MISSING INPUT` — REVISION 3 DELTA

| # | Item | Status |
|---|---|---|
| **`U-NEW-8`** | **NEW.** Whether the `R-4` sequence can be instantiated for a **PERSON** target at all. `N-19` proves the shape for a **COMPANY** target resolved from an **authored config** (`assignWarehouseRootCompany.js:131-141`). `R-4` step 1 requires *"the canonical person authority"*, and **`A` is empty** | **UNPROVEN — and it is a dependency on `A`, not a defect of any option** |
| **`U-NEW-9`** | **NEW.** Whether a writer-side provenance marker can convey *"an authoritative resolution occurred upstream"* soundly. `X-25` argues it cannot in principle at that layer. **Reasoned from source, not executed** | **UNPROVEN — strictly worse than `U-NEW-5`, which only asks whether a marker is forgeable** |
| **`U-NEW-10`** | **NEW.** Whether the 33 `functions/src` modules that combine `runTransaction` with `auditEventWriter` all perform their reads **before** their writes as `R-4` requires. **Counted by grep; not individually read.** Only `trustedWriterCommands.ts:1966`, `creationOwnerResolution.ts:25-26` and `N-19` were read verbatim | **PARTIALLY VERIFIED — the count is exact, the per-module conformance is not claimed** |
| **`U-NEW-5`** · **`U-NEW-6`** · **`U-NEW-7`** | Unchanged. `U-NEW-6` remains **`[SOURCE READ — NOT EXECUTED]`** — no emulator (**`java` ABSENT**, port 8080 held); never relabelled | **UNPROVEN / SOURCE READ** |
| **`U-NEW-4`** | Re-checked this pass: **`functions/lib` ABSENT · `functions/node_modules` ABSENT.** Every handoff contract test imports `../lib/...` (`ownershipHandoffAudit.test.mjs:80-82`, `warehouseRootCompanyAssignment.test.mjs:28`), so all of them require a build, and **borrowing `functions/lib` is prohibited by lane contract.** Every count in §19 and §21 is **`[EXECUTED — git grep / git show over the 64008d5a tree]`**; every semantic claim is **`[SOURCE READ]`** | **`NOT_RUN` — unchanged, not relabelled** |
| **`M-1`** | **OPEN**, with new evidence (§23): `R-4` presupposes an axis concept the builder does not have (`axis` = 0 occurrences) | **`MISSING INPUT`** |
| **`M-2`** | **OPEN**, now **constrained by exclusion** (§23.1) and **sharpened** by `Y-6` — the live competitor is a free-text `summary`, not carrier #2 | **`MISSING INPUT`** |
| **`M-3`** | **OPEN.** Both readings carried with the ruling's evidence attached to each. **No Owner intent inferred** | **`MISSING INPUT`** |
| **`M-4`** | **CLOSED by the Owner, 2026-09-13 — (iii) BOTH** | **ANSWERED** |
| **`M-5`** · **`M-6`** · **`M-7`** | Unchanged. `M-5` re-confirmed at `warehouseRootCompanyAssignment.ts:389-393` | **`MISSING INPUT`** |
| **`M-8`** | **NEW — THE RESIDUAL QUESTION OF §24.** *Given `R-2` places the contract at `B` and `R-4` allocates family/axis to the pure builder where it is already implemented, does `OD-7` still require a second, writer-side enforcement for paths that bypass the builder — and if so, (a), (b) or (c); and if not, is `(e)` the ruling?* **Only the Owner can answer: it is a governance preference about redundant defence, and no evidence in three revisions settles it** | **`MISSING INPUT`** |
| **`PERSON AUTHORITY GAP`** | **PRESERVED AS A NAMED DEPENDENCY. NOT RESOLVED, NOT NARROWED, NO COLLECTION NAMED.** `R-3` makes it **structurally out of reach** of every option in `OD-7` | **NAMED DEPENDENCY** |
| **Recommendation** | **`NONE` between (a), (b) and (c) — third revision, third reason.** The ruling moved the binding requirement to a layer no option occupies (`X-27`); it strengthened both poles of §14.4's opposition without breaking it (`X-26`); and it made the three-option frame the wrong frame (§22) | **`OWNER DECISION STILL REQUIRED`** |

### 25.1 CORRECTIONS ADDED BY REVISION 3

| # | Target | Finding | Severity |
|---|---|---|---|
| **`X-20`** | `U-NEW-1` (lane brief, §4, §14 all three MIGRATION rows) | **Denominator 42 → 40.** *"ZERO can pass `OWNERSHIP_HANDOFF`"* → **39 of 40 cannot; the 40th is the builder.** **And repo-wide the headline is FALSE**: `scripts/assignWarehouseRootCompany.js:234` produces the action and **five real events exist** (`docs/specifications/reorder-trusted-command-authority.md:208`). **44 import / 50 mention confirmed** | **HIGH** |
| **`X-21`** | lane brief; `X-15`; `X-18` | *"every module in `functions/src/ownership/` declares itself **PURE**, each by its own header"* — **NOT TRUE AS STATED.** Six say `PURE`; two say *"stays pure"*; `ownershipCensus.ts:9-10` says `READ-ONLY BY CONSTRUCTION`; `typedOwner.ts:7-8` says `INERT, DERIVED, READ-NORMALIZED`; **`ownershipMatrix.ts` declares nothing** — and it is the one module (a) would import | **MEDIUM** |
| **`X-22`** | `X-14`, §14.2, §14.4 | (b)'s measured breakage: **7 tests (5 writer-exercising), 12 assertions, 6 regexes** — not *"6 tests / ~12 assertions / 6 patterns"*. **Direction unchanged; (b) remains the only measured breakage** | **LOW** |
| **`X-23`** | `U-NEW-2`, §14.2 | **NEW MEASUREMENT.** 8 tests / 36 assertions call `buildOwnershipHandoff` and **none** asserts a whole-object `deepEqual`, so a provenance marker on `:178-190` breaks **zero** of them. `U-NEW-2` is a design gap, not a test-migration gap | **MEDIUM — the only cost reduction for (b) in three revisions** |
| **`Y-6`** | `X-5`, §2.5, §14.2 | The live ungoverned ownership move uses **neither** `M-2` carrier — `opportunityCallables.ts:337-350` records changed field **names in a `summary`**, and `:661-670` + `:415` make the field-change carrier **structurally unreachable** for `updateOpportunity` | **MEDIUM** |
| **`Y-7`** | lane brief | The writer is `functions/src/**access**/auditEventWriter.ts`, not `functions/src/audit/…`. All cited line numbers were correct | **LOW** |
| **`Z-5`** | `X-18`, §14.2 | **`R-3` VOIDS** the builder-side person-check capability that was recorded as (b)'s only discriminator on that field. The mechanism survives; the **attribution** was wrong — it belongs to **B** | **HIGH** |
| **`X-19`** | `X-12`, §14.3 | `X-12` established (c) is not unprecedented. **The precedent's DIRECTION is (a)'s**: `ownershipHandoffCommand.ts:22-23` — the no-op is *"enforced in the audit writer, restated here"*, i.e. **authority at the writer**, convenience copy in the builder | **MEDIUM — a point for (a) that three revisions recorded as a point for (c)** |
| **`X-24`** | packet framing; the Owner's elimination test | The test **eliminates no option**. All three fail to satisfy the contract independently and **none is incompatible** with an orchestrator that does. What it eliminates is the premise that any of the three **could** | **HIGH** |
| **`X-25`** | `U-NEW-2`, `U-NEW-5`, §14.2 | `R-2`+`R-3` convert (b)'s gap into a **soundness limit**: the writer can verify shape, never the provenance of a read it may not perform | **HIGH** |
| **`X-26`** | §14.4 | The ruling strengthens **both** poles of the opposition; neither crosses. `Z-6` | **MEDIUM** |
| **`X-27`** | §5, §14, packet §4 | **The three options differ only on `C` and `D`; the real gap is `A` and `B`.** Stated plainly, as the lane brief requires | **HIGH — it is the finding of this revision** |

**REVISION 3 evidence discipline.** No emulator was run (**`java` ABSENT**; port 8080 held).
`functions/lib` and `functions/node_modules` are **ABSENT** and `functions/lib` was **not borrowed**.
No production system was contacted. No test suite was executed — every figure is `git grep` / `git
show` over the `64008d5a` tree, labelled **`[EXECUTED — git grep / git show]`**, with semantic claims
labelled **`[SOURCE READ]`**; nothing was relabelled. No schema, field name, enum name, migration,
backfill, handoff activation, Rules change, wiring or implementation was performed or designed.
`OD-PACKET-001-006-007.md` was **not modified**. No census architecture was designed (`MI-P`).
**No person authority was named or chosen — the `PERSON AUTHORITY GAP` is preserved intact.**
**No option was selected, and none was selected merely from the ruling.**
