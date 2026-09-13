---
title: OD-7 DECISION BRIEF — where family-level handoff validation must live
lane: OD-7-PREPARATION
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
