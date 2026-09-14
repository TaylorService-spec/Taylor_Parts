# BOUNDED BYPASS CENSUS — RECORD OWNERSHIP · ACCOUNTABILITY

**Authority:** Owner ruling **#184** (`OD-7` option (e)) — *"Any runtime mutation path capable of changing
governed RECORD OWNERSHIP or ACCOUNTABILITY without passing through the governed orchestration boundary is a
DEFECT."* · **#187** `M-1` (`OD-7` covers ownership and accountability, **not** assignment) · **#189** `OD-16`
(accountability family applicability).

**Measured at:** `impl/wave-2b-governed-handoff`, baseline `726211a4`.
**Method:** static, over the repository. **No production contact. No deploy. Nothing was fixed by this census.**

---

## 0. SCOPE, AND WHAT IS DELIBERATELY NOT IN IT

This is a **bounded** census, not a repository archaeology run. Three populations only:

1. exported callables in `functions/src/index.ts` that can write a **record-ownership field**;
2. client-writable `firestore.rules` `update` statements that touch one;
3. operator scripts under `functions/scripts/` that write one.

**The axis boundary matters and is drawn deliberately.** `#180` makes **RECORD OWNER** and **OPERATING
COMPANY** *different axes*, so this census measures the **PERSON axis** of record ownership — the fields the
ownership matrix declares for its `ownerClass: "PERSON"` families:

| field | families |
|---|---|
| `accountOwner` | `account` |
| `owner` (typed-owner map) | `contact` · `location` |
| `ownerEmployeeId` | `opportunity` · `salesAgreement` · `salesOrder` |

**`operatingCompanyId` is NOT censused here.** It is the OPERATING COMPANY axis, it appears in **35** source
files, and folding it in would turn a bounded census into the archaeology run the brief forbids. Two company-axis
facts are still recorded below because they were named in the brief and verified: `fieldops_jobs`'s Rules admin
branch, and `assignWarehouseRootCompany.js`, which is the **only fully governed ownership writer in the tree**.

**Creation is not a handoff.** A command that *establishes* ownership on a record being created is not a path
that *changes* governed ownership, so those are classified separately and explicitly rather than being counted
as bypasses. `#184`'s defect definition is about changing ownership.

---

## 1. THE GOVERNED BOUNDARY, AS IT NOW EXISTS

`functions/src/responsibility/governedResponsibilityHandoff.ts` —
`stageGovernedResponsibilityHandoff`. It runs the ruled sequence
(**AUTHORITATIVE READ → CALLER AUTHORIZATION → TARGET EMPLOYEE RESOLUTION → CURRENT ELIGIBILITY (where
applicable) → PURE FAMILY/AXIS VALIDATION → MUTATION → AUDIT → ATOMIC COMMIT**) and stages both the mutation
and its audit onto one caller-supplied atomic unit.

**It is NOT exported from `functions/src/index.ts`, and that is a governed constraint rather than an omission.**
Every capability that would gate such a command is registered `active: false`
(`opportunity.write` · `salesOrder.write` · `salesAgreement.create|updateDraft|accept` · `opportunity.createSalesOrder`),
and exporting a callable that needed one activated would be this wave activating a capability. `#184` was ruled
before any surface existed precisely so the placement would be free.

**It does not appear in the writer scan in §2**, and the reason is a design property worth stating: it never
names an ownership field. It reads the field to write from `ownershipMatrix.ownerFields`, so the matrix stays the
single declaration of where ownership lives, and the storage shape stays behind the `OwnershipRecordPort` seam.

---

## 2. CENSUS — SOURCE MODULES NAMING A PERSON-AXIS OWNERSHIP FIELD

Every module in `functions/src/**` that names `accountOwner`, `ownerEmployeeId`, or writes a typed-owner literal
(`owner: { type: … }`), comments stripped. **23 modules.** The ratchet in
`functions/test/governedOwnershipWriterCensus.test.mjs` fails if this population changes.

| # | module | reachable from a callable? | classification | why |
|---|---|---|---|---|
| 1 | `src/opportunity/opportunityCallables.ts` | **YES** — `createOpportunity` · `transitionOpportunity` · `updateOpportunity` | **BYPASS DEFECT (when granted)** | `updateOpportunity` **changes** `ownerEmployeeId` and emits **no** `OWNERSHIP_HANDOFF` — it stages a free-text `summary` instead (`:337-350`). Gated on `opportunity.write`, **`active: false`** (`permissionCatalog.ts:154-159`), so it is **INERT at the catalogue baseline** and a bypass **when granted**, not a live production bypass today. |
| 2 | `src/opportunity/opportunityCommands.ts` | via #1 | **BYPASS DEFECT (when granted)** — pure half | `EDITABLE_OPPORTUNITY_FIELDS` (`:242-244`) includes `ownerEmployeeId`, and `buildUpdateOpportunity` (`:312-317`) records the change into the patch. This is where the ownership change is *authored*; #1 is where it is written. |
| 3 | `src/opportunity/closeOpportunityAsWon.ts` | **YES** | **INERT** | Establishes `ownerEmployeeId` on a **newly created** Sales Order (`:283`). Creation, not a handoff. Gated on `opportunity.write` **+** `opportunity.createSalesOrder`, both `active: false`. |
| 4 | `src/opportunity/createSalesOrderFromOpportunity.ts` | **YES** | **INERT** | Same: creation-time owner (`:200`, `:336`), gated on `opportunity.createSalesOrder`, `active: false`. |
| 5 | `src/salesAgreement/salesAgreementCallables.ts` | **YES** | **INERT** | `createSalesAgreement` requires `ownerEmployeeId` at creation (`:239-240`). `updateSalesAgreementDraft` **cannot** change it — see #6. All three capabilities `active: false`. |
| 7 | `src/salesAgreement/salesAgreementCommands.ts` | via #5 | **NOT APPLICABLE** | Verified: `SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS` (`:456-477`) does **not** contain `ownerEmployeeId`, and a non-DRAFT agreement freezes entirely. There is no agreement ownership-change path. |
| 8 | `src/salesOrder/salesOrderCommands.ts` | via `salesOrderCallables` | **NOT APPLICABLE** | Creation only (`:261`, `:285`). No Sales Order command changes `ownerEmployeeId`. |
| 8 | `src/salesAgreement/agreementToSalesOrder.ts` | via #5 / Sales Order creation | **NOT APPLICABLE** | Projection into a creation payload. Writes nothing itself. |
| 9 | `src/ownership/creationOwnerResolution.ts` | via #1 · #3 · #4 · #5 · #7 | **NOT APPLICABLE** | The pure creation-owner inheritance rule. Establishment axis; no I/O. |
| 10 | `src/ownership/ownershipBackfillRules.ts` | **NO** | **LEGACY** | The pure rule that authors the `owner: { type: "USER", … }` patch (`:77`) which the bounded backfill scripts write. See §4. |
| 11 | `src/crm/customerIdentity.ts` | **NO** | **INERT** | Pure CRM identity/inheritance helper. No entry point imports it outside `crm/`. |
| 12 | `src/crm/customerMigrationSource.ts` | **NO** | **INERT** | Reads legacy `accountOwner` shapes to build a migration projection. Unreachable from `index.ts`. |
| 13 | `src/crm/customerRepository.ts` | **NO** | **INERT** | PostgreSQL CRM repository. Unreachable from `index.ts`; no callable imports it. |
| 14 | `src/eosCommercial/commercialOwnershipAuthority.ts` | **NO** | **INERT** | PostgreSQL commercial ownership authority. Unreachable from `index.ts`. |
| 15 | `src/eosCommercial/commercialOwnershipRepository.ts` | **NO** | **INERT** | Same. Since wave C2 its transfer is also available as `stageCommercialOwnershipTransfer` on a caller's transaction -- one implementation, two entry points. |
| 15a | `src/eosCommercial/commands/opportunityCommandService.ts` | **NO** | **GOVERNED** | Commercial wave C2. The PostgreSQL Opportunity edit: an owner change is refused as a plain overwrite and goes through `stageCommercialOwnershipTransfer` (locked predecessor, append-only `ownership_handoffs`, owner moved) in the edit's transaction; the Accountable Person is untouched. This is blocker #3's PostgreSQL path. Unwired; capabilities `active: false`; blocker #3 stays open while the legacy Firestore `updateOpportunity` (#1) is reachable. |
| 15b | `src/eosCommercial/commands/salesAgreementCommandService.ts` | **NO** | **INERT** | Commercial wave C2. Creation-time owner only; the draft edit cannot change the owner. Unwired. |
| 15c | `src/eosCommercial/commands/salesOrderCommandService.ts` | **NO** | **INERT** | Commercial wave C2. Creation-time owner only; no Sales Order command changes the owner. Unwired. |
| 15d | `src/eosCommercial/commands/commercialRecordStore.ts` | **NO** | **INERT** | Commercial wave C2. The SQL the command services use; writes an owner only in the creation INSERT. |
| 15e | `src/eosCommercial/commands/commercialCommandKernel.ts` | **NO** | **NOT APPLICABLE** | Commercial wave C2. Reads the Account owner as the upstream creation default; writes no owner. |
| 15f | `src/eosCommercial/commands/commercialCreation.ts` | **NO** | **NOT APPLICABLE** | Commercial wave C2. Reads the record owner only to derive creation accountability (§5.2). |
| 16 | `src/ownership/ownershipMatrix.ts` | n/a | **NOT APPLICABLE** | The model. Declares where ownership is stored; writes nothing. |
| 17 | `src/ownership/typedOwner.ts` | n/a | **NOT APPLICABLE** | The shape and the derivations. Pure. |
| 18 | `src/ownership/ownershipCensus.ts` | n/a | **NOT APPLICABLE** | Measurement. Pure. |
| 19 | `src/opportunity/opportunityReadService.ts` | **YES** (read) | **NOT APPLICABLE** | Projection only. |
| 20 | `src/salesAgreement/salesAgreementReadService.ts` | **YES** (read) | **NOT APPLICABLE** | Projection only. |
| 21 | `src/salesOrder/salesOrderReadService.ts` | **YES** (read) | **NOT APPLICABLE** | Projection only. |
| 22 | `src/reporting/reportCatalog.ts` | **YES** (read) | **NOT APPLICABLE** | Declares `accountOwner` as a reportable field (`:142`, `:209`). Read catalogue. |
| 23 | `src/access/permissionCatalog.ts` | n/a | **NOT APPLICABLE** | Capability metadata text only. |

**So: exactly ONE ownership-CHANGE path exists in the callable surface** — `updateOpportunity` — and it does not
reach the governed boundary. Everything else in the surface either establishes ownership at creation, reads it,
or models it.

---

## 3. CENSUS — `firestore.rules` CLIENT-WRITABLE STATEMENTS

**Rules are Tier-2 HOLD. These are RECORDED, NOT FIXED.** No line of `firestore.rules` was changed by this wave.
All four brief claims were independently verified at this baseline.

| statement | verified finding | classification |
|---|---|---|
| `accounts/{accountId}` — `allow update` (**`firestore.rules:1335`**) | `isAdminOrDispatcher() && accountGovernedFieldsValid(...) && (isAdmin() \|\| accountGovernedFieldsUnchanged())`. The `isAdmin()` branch **short-circuits** the equality helper, and **`accountOwner` occurs 0 times in the entire file** — so no Rules constraint of any kind applies to `accountOwner`. An admin client can rewrite record ownership directly. | **BYPASS DEFECT** — live for any admin client |
| `locations/{locationId}` — `allow create, update` (**`firestore.rules:1343`**) | `allow create, update: if isAdminOrDispatcher();` — **no field constraint at all**. `owner` is unconstrained. | **BYPASS DEFECT** — live for any admin/dispatcher client |
| `contacts/{contactId}` — `allow create, update` (**`firestore.rules:1557`**) | `allow create, update: if isAdminOrDispatcher();` — **no field constraint at all**. `owner` is unconstrained. | **BYPASS DEFECT** — live for any admin/dispatcher client |
| `fieldops_jobs/{jobId}` — `allow update`, admin branch (**`firestore.rules:381-391`**) | The technician branch is narrowed by `jobStatusOnlyChange()`; the `isAdminOrDispatcher()` branch is narrowed **only** by `isValidJobTransition(...)`, so it carries no field allow-list and `operatingCompanyId` is unconstrained. | **BYPASS DEFECT** — **COMPANY axis**, recorded for completeness |
| `opportunities` · `sales_orders` · `sales_agreements` (`:1741`, `:1750`, `:1795`) | `allow read, write: if false;` — Admin-SDK-only. | **NOT APPLICABLE** — no client write path exists |

**The three PERSON-axis Rules defects are the most consequential finding in this census**, because unlike
`updateOpportunity` they are **not** gated behind an inactive capability. They are live today for any client
holding the admin/dispatcher claim.

---

## 4. CENSUS — OPERATOR SCRIPTS UNDER `functions/scripts/`

| script | classification | why |
|---|---|---|
| `scripts/assignWarehouseRootCompany.js` | **GOVERNED** | The only complete read→validate→txn→stage→commit chain in the repo: the five patches and their five `OWNERSHIP_HANDOFF` events commit in **one transaction**, with an in-transaction overwrite guard and no reassignment. **COMPANY axis.** This is the shape the S4 boundary follows. |
| `scripts/ownershipSandboxBackfill.js` | **LEGACY** | Bounded one-time backfill. Writes only fields that are currently **unset** (guarded twice, including in-transaction) and refuses any patch that is not a governed company id or a typed `USER` owner. It emits **no** `OWNERSHIP_HANDOFF`. It is establishment-only and capped, so it is not a reassignment vehicle — but it does **not** reach the governed boundary. |
| `scripts/certificationWorld/seedAccountOwners.mjs` | **LEGACY** | Seeds `accountOwner` in the certification world via `batch.set(..., { merge: true })` (`:220-223`). Non-production world; no handoff audit. |
| `scripts/financialReviewFixtures.mjs` | **LEGACY** | Fixture seeding; sets `ownerEmployeeId` inside a created Sales Order document (`:427`). Creation, no handoff audit. |
| `scripts/ownershipBackfillSimulation.js` | **NOT APPLICABLE** | Read-only simulation. Its only `set` calls are on in-memory `Map`s. Writes nothing. |
| `scripts/governance/effectiveAuthority.mjs` | **NOT APPLICABLE** | Read-only; names `ownerEmployeeId` in a projection. No write API call. |
| `scripts/seedSyntheticNonprodWorkforce.js` | **GOVERNED/SEED** | Owner ruling 2026-09-14. The fenced synthetic NONPROD seed. Creation only: CRM and commercial owners are written through the governed `customerRepository` and `createCommercialRecord` writers; no ownership change, no reassignment. Refuses production by role and project id and refuses without `EOS_ENVIRONMENT=nonprod`. Its accountability half is classified in §5.2. |

---

## 5. CENSUS — ACCOUNTABILITY WRITE PATHS

**The previous revision of this section read `NO ACCOUNTABILITY WRITE PATH EXISTS YET`, and that sentence is
now FALSE.** Wave 2C's S6 built the storage — migration
`functions/migrations/1759276800000_commercial-accountability-authority.sql` and
`functions/src/responsibility/accountablePersonStorage.ts` — so the ratchet in
`functions/test/governedOwnershipWriterCensus.test.mjs` failed, exactly as it was built to, and this section is
rewritten with a real population. **The vacuity guard is not deleted: it is replaced by a
POSITIVE REACHABILITY PROOF**, which is a strictly stronger assertion and is described in §6.

### 5.1 What "an accountability write" is, and where it can happen

Accountability is carried on **exactly three families** — OPPORTUNITY · SALES AGREEMENT · SALES ORDER
(**#189 `OD-16`**) — in **one document field** and **one SQL column**:

| | |
|---|---|
| document field | `accountableEmployeeId`, plus `accountablePersonSource` recording EXPLICIT vs DERIVED_FROM_RECORD_OWNER |
| SQL column | `eos_commercial.{opportunities,sales_agreements,sales_orders}.accountable_employee_id`, **NULLABLE** |
| history | `eos_commercial.accountability_handoffs`, append-only, its own trigger, **zero foreign keys on either person column** (**#189 `MI-λ`**) |

There are **two** governed ways a value reaches that field and no third:

```
CREATION   establishCreationAccountablePerson  →  mintGovernedAccountablePerson  →  accountablePersonFields
           (authority lookup + eligibility)       (refuses an ineligible verdict)    (the only field map)
                                                        ↓
                                               buildCreate{Opportunity,SalesAgreement,SalesOrder}

CHANGE     stageGovernedResponsibilityHandoff (axis ACCOUNTABILITY)  →  mintGovernedAccountablePerson
           (authoritative read + caller authorization + eligibility)       ↓
                                                        createRecordAccountabilityStore → accountablePersonFields
```

**Both funnel through the same mint**, and the mint cannot be called without an `EmployeeFacts` that only a
`RESOLVED` answer from the Employee authority produces and an `AccountabilityEligibility` that only
`decideAccountabilityEligibility` produces from a **stated** governed policy. The mark it stamps is a
module-private `Symbol()` — not `Symbol.for()` — so it cannot be forged by name, and it does not survive JSON or
`structuredClone`, so a value that crossed a serialization boundary is no longer accepted as evidence that the
authority was consulted in this process.

### 5.2 The population, classified

| # | path | classification | why |
|---|---|---|---|
| 1 | `src/responsibility/accountablePersonStorage.ts` | **GOVERNED** | Declares the field, the source vocabulary and the scope; holds the **only** mint and the **only** function that produces a persistable accountability field map. Refuses to build one from an unmarked value. |
| 2 | `src/responsibility/accountablePersonEstablishment.ts` | **GOVERNED** | The creation rule, **#181**: EXPLICIT VALID → GOVERNED DERIVATION FROM CURRENT RECORD OWNER → REFUSE. Resolves through the Wave-2A Employee port; `AUTHORITY_UNAVAILABLE` gets its own code and fails closed. |
| 3 | `src/responsibility/accountablePersonRecordStore.ts` | **GOVERNED** | The `AccountabilityStore` implementation. Takes a document port, never a driver; stages, never commits; refuses an out-of-scope family so storage cannot acquire fake accountability even if a command asked. |
| 4 | `src/responsibility/accountabilityCensus.ts` | **NOT APPLICABLE** | The dedicated census (**#187 §1** `MI-Y` option (ii)). It is in the population because it imports the storage declaration, and it writes nothing — it takes documents and an authority port and returns counts. |
| 5 | `src/responsibility/governedResponsibilityHandoff.ts` | **GOVERNED** | The **change** path (**#184** option (e)). Authoritative read → caller authorization → target resolution → eligibility → no-op refusal → mint → stage mutation and audit with no `await` between them. |
| 6 | `src/opportunity/opportunityCommands.ts` | **GOVERNED** | Creation **verifies** the governed mark and refuses `ACCOUNTABLE_PERSON_NOT_GOVERNED` otherwise. The ordinary edit **refuses** `ACCOUNTABLE_PERSON_NOT_EDITABLE` rather than silently ignoring the field — see §5.3. |
| 6 | `src/salesAgreement/salesAgreementCommands.ts` | **GOVERNED** | Same creation verification. `SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS` does not contain it and `buildUpdateSalesAgreementDraft` **rejects** every unnamed key (`FIELD_NOT_EDITABLE`), so the draft edit is not a path. |
| 7 | `src/salesOrder/salesOrderCommands.ts` | **GOVERNED** | Same creation verification. There is **no** Sales Order field-edit command at all, so no edit path exists to classify. |
| 8 | `scripts/seedSyntheticNonprodWorkforce.js` | **GOVERNED/SEED** | See §5.6. Nonprod-only; `accountable_employee_id` is persisted only from `accountablePersonFields(establishCreationAccountablePerson(...))`, in the record's own transaction, only while NULL. |
| 9 | `src/eosCommercial/commercialAccountabilityRepository.ts` | **GOVERNED** | Owner ruling 2026-09-14, blocker #1 (Option B). The **PostgreSQL accountability audit authority**: accepts only a minted `EstablishedAccountablePerson`, refuses a person minted in another tenant, locks the record, and writes `accountable_employee_id` and its append-only `accountability_handoffs` row (`action` ESTABLISHMENT / HANDOFF, `source` = the mint's provenance) in **one PostgreSQL transaction**; a failed history write refuses the mutation. Imported by no callable and not exported from `index.ts`. See §5.5. |
| 10 | `src/eosCommercial/commands/commercialCreation.ts` | **GOVERNED** | Commercial wave C2. Creation-time Accountable Person for every governed Commercial create: `establishCreationAccountablePerson` under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1, then the #1905 writer's `stageCommercialAccountablePersonChange` (ESTABLISHMENT history) in the create's transaction. Unwired. |
| — | every other `functions/scripts/**` | **NOT APPLICABLE** | **Zero** other operator scripts name an accountability field or import the declaration. Unlike §4's ownership scripts, there is no legacy accountability backfill to classify because the field is new. |
| — | `firestore.rules` | **NOT APPLICABLE** | **Zero** occurrences. See §5.4 for the runtime consequence, which is stated and **not** acted on. |
| — | every other family | **NOT APPLICABLE** | **#189 `OD-16`**: accountability is NOT APPLICABLE to them — *not* `MISSING`, *not* `OWNERLESS`, *not* `DEFECTIVE`. They have no accountability storage, which is what makes that true rather than claimed. |

**There is no `BYPASS DEFECT` row, and this time the absence is earned rather than vacuous.** The three write
entry points were inspected individually — they are not alike, and the survey that said so was right:

| family | entry points that could have touched accountability | finding |
|---|---|---|
| **Opportunity** | `buildCreateOpportunity` · `buildUpdateOpportunity` (the ordinary edit, which **does** move `ownerEmployeeId`) · `buildTransitionPatch` | creation governed; **the ordinary edit was the one real exposure and is now an explicit refusal**; transitions never name a person field |
| **Sales Agreement** | `buildCreateSalesAgreement` · `buildUpdateSalesAgreementDraft` · `buildAcceptSalesAgreement` | creation governed; the draft edit's allow-list **already** refuses unnamed keys, so it was never a path; acceptance patches only state and timestamps |
| **Sales Order** | `buildCreateSalesOrder` · `buildTransitionPatch` | creation governed; **no field-edit command exists**, so there is nothing to close |

### 5.3 The one accountability-mutation exposure this wave corrected

`buildUpdateOpportunity` is the only ordinary-edit command among the three that changes a person field at all —
it moves `ownerEmployeeId`, which is §2 entry #1's recorded **BYPASS DEFECT** on the *ownership* axis. Because
it is the one command shaped to move a person, it is the one place an `accountableEmployeeId` key could
plausibly have been added later by someone treating accountability as an ordinary field.

It now **refuses**, with its own code, naming where the change belongs. Refusing rather than ignoring is
deliberate on **#184**'s terms — *"eliminate or refuse the bypass"* — and because silently dropping the key
would report success for a change that did not happen, and a UI built on that report would ship a control that
does nothing.

**What was deliberately NOT done:** the *ownership* bypass in that same command is **not** fixed here. It is
§2 entry #1, it is pinned by a test that fails when it is fixed, and it belongs to the ownership axis; closing
it inside an accountability wave would broaden this lane into a family it was told not to touch.

### 5.4 `firestore.rules` — the runtime consequence, stated only

**No line of `firestore.rules` was changed. Tier-2 remains HOLD.**

The measured runtime consequence, which required no Rules change and authorizes none:

* `opportunities`, `sales_orders` and `sales_agreements` are each `allow read, write: if false` — **Admin-SDK
  only**. So the `accountableEmployeeId` field the governed commands write is **unreachable from any client**,
  and no client-direct accountability write path exists on any admitted family.
* `accountOwner` appears **nowhere** in Rules, as §3 records. **Nothing is inferred from that absence.** It is
  not read here as permission, as prohibition, or as a Rules semantic of any kind — only as the fact that the
  *accounts* family's ownership field carries no Rules constraint, which is a §3 ownership finding and not an
  accountability one.

### 5.5 What is still a seam, and why that is the honest state

**Update — Owner ruling 2026-09-14, activation blocker #1 (Option B).** The governed accountability audit authority is
**PostgreSQL**, not the Firestore `AuditAction` vocabulary, which is deliberately **not** extended for accountability.
Migration 021 gives `eos_commercial.accountability_handoffs` a generated `action` (ESTABLISHMENT when there was no
previous accountable person — at creation or on an existing record — otherwise HANDOFF) and a `source` that mirrors
the mint's `ACCOUNTABLE_PERSON_SOURCES` with no new values. `src/eosCommercial/commercialAccountabilityRepository.ts`
writes the accountable person and its history row in ONE PostgreSQL transaction. That closes blocker #1.

**Blocker #2 stays OPEN and is now explicit:** the live commercial create callables persist to **Firestore**, so they
cannot be the final governed accountability write path — the record, the establishment and its PostgreSQL history
could not be atomic across two stores. Blocker #2 must move that write path to PostgreSQL; it must not weaken
atomicity to keep the Firestore callables. **Blocker #3 stays OPEN.** The rows the synthetic nonprod seed
(§5.6) wrote predate this writer and carry no history rows; they are fixture data, not governed runtime history.

The historical record of this seam, as it stood before the ruling, follows unchanged.

`AccountabilityAuditPort` **still has no implementation**, and the reason is unchanged from the previous
revision and is a real constraint rather than a scoping choice: the governed `AuditAction` vocabulary
(`functions/src/access/auditEventWriter.ts`) contains exactly one ownership action, `OWNERSHIP_HANDOFF`, and
**no** accountability action. Recording an accountability change as an `OWNERSHIP_HANDOFF` — carrying the
accountable person in `previousOwner`/`newOwner` — would be precisely **#187 §1**'s *"accountability must not be
redefined as ownership"*, and adding a new governed audit action is a change to the audit contract that this
lane was not asked to make. So the **change** path refuses `PORT_UNAVAILABLE` when the audit port is absent,
which is fail-closed, and `eos_commercial.accountability_handoffs` is the durable history the future audit
writer records into.

The **creation** path needs no such port — a created record's audit is the creation's own — so it is complete,
implemented and reachable end to end. **That is the path the reachability proof in §6 executes.**

### 5.6 `GOVERNED/SEED` — what the classification means, and what it does NOT

Owner ruling 2026-09-14 (synthetic nonprod seed), recorded in these words:

> **GOVERNED/SEED** = a nonprod-only persistence path whose accountable Employee value was produced by the
> governed establishment + mint authority.

It is **NOT** equivalent to: live write activation; a production accountability writer; permission to bypass the
governed mint; or closure of activation blocker #2. **Activation blockers #1–#3 remain OPEN** — no accountability
audit action exists, no deployed creation callable invokes governed establishment or the enforcement gate, and
`updateOpportunity` still moves ownership without a handoff.

`scripts/seedSyntheticNonprodWorkforce.js` is the only member. It is unreachable from `functions/src` and from
`index.ts`, runs only as an operator command in a process declaring `EOS_ENVIRONMENT=nonprod`, and the ratchet
(§6 item 8) fails if another script reaches accountability storage or if this one stops being fenced and
mint-gated. It exists because the Owner authorized a **synthetic** nonprod acceptance dataset; its rows are fixture
data, not historical truth and not migrated Taylor data.

---

## 6. THE RATCHET

`functions/test/governedOwnershipWriterCensus.test.mjs`, registered in `functions/package.json` under
`test:ownership` and path-filtered in `.github/workflows/eos-ownership-model-tests.yml`.

A snapshot document rots; a ratchet does not. It fails when:

1. a **new** source module names a person-axis ownership field and is not classified in §2;
2. the ownership matrix gains a **new** `PERSON`-axis ownership field not listed in §0;
3. an accountability write path appears that §5 does not classify, **or** the accountability write population
   becomes EMPTY — the reachability proof requires **at least one** governed path, so zero can never pass;
4. `accountablePerson` appears in `ownershipMatrix.ownerFields` (**#187 §1**);
5. the recorded `firestore.rules` findings change — a Rules edit must force this census to be re-read;
6. `updateOpportunity`'s module gains handoff auditing, which would mean entry #1 must be reclassified;
7. the S4 boundary becomes exported from `index.ts`, which would mean a capability was activated;
8. an operator script reaches accountability storage (imports the declaration or establishment) without being a
   classified **GOVERNED/SEED** path — or a GOVERNED/SEED script stops being nonprod-fenced, stops going through
   `establishCreationAccountablePerson` + `accountablePersonFields`, names a field literal, or becomes reachable
   from `functions/src`.

---

## 7. WHAT WAS NOT DONE, AND WHY

| | |
|---|---|
| `firestore.rules` not changed | **Tier-2 HOLD.** The three PERSON-axis defects in §3 are recorded for the Rules lane. |
| `updateOpportunity` not changed | `#184`: *"eliminate or refuse the bypass"* — but doing so is an opportunity-domain change with its own audit-vocabulary consequences, and this wave's authority is the boundary and the census. Recorded as **BYPASS DEFECT (when granted)**. |
| No capability activated | No `active: false` capability was flipped, and the S4 boundary is unexported for that reason. |
| No accountability **audit action** added | §5.5. The governed `AuditAction` vocabulary has no accountability member, and adding one is a change to the audit contract rather than to this axis. The change path fails closed without the port; the creation path needs none. |
| The *ownership* bypass in `updateOpportunity` still not fixed | §5.3. It is the ownership axis, it is pinned by a failing-when-fixed test, and closing it inside an accountability wave would broaden this lane. |
| No backfill of existing records | **#182 §10** and **#189 `MI-λ`**: measure first. `functions/scripts/measureCommercialAccountability.js` is the read-only artifact; a backfill is a separate, separately-proven decision and the migration's column is NULLABLE so that the un-established population stays countable. |
| PostgreSQL | **PROVEN** in Wave 2C against a real `postgres:16` server: migration 020 applied, structure and constraints asserted, and the measurement classification exercised over seeded rows. §5.1's storage claims are database facts, not source facts. |
