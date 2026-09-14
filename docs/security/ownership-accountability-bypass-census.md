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
| 6 | `src/salesAgreement/salesAgreementCommands.ts` | via #5 | **NOT APPLICABLE** | Verified: `SALES_AGREEMENT_DRAFT_EDITABLE_FIELDS` (`:456-477`) does **not** contain `ownerEmployeeId`, and a non-DRAFT agreement freezes entirely. There is no agreement ownership-change path. |
| 7 | `src/salesOrder/salesOrderCommands.ts` | via `salesOrderCallables` | **NOT APPLICABLE** | Creation only (`:261`, `:285`). No Sales Order command changes `ownerEmployeeId`. |
| 8 | `src/salesAgreement/agreementToSalesOrder.ts` | via #5 / Sales Order creation | **NOT APPLICABLE** | Projection into a creation payload. Writes nothing itself. |
| 9 | `src/ownership/creationOwnerResolution.ts` | via #1 · #3 · #4 · #5 · #7 | **NOT APPLICABLE** | The pure creation-owner inheritance rule. Establishment axis; no I/O. |
| 10 | `src/ownership/ownershipBackfillRules.ts` | **NO** | **LEGACY** | The pure rule that authors the `owner: { type: "USER", … }` patch (`:77`) which the bounded backfill scripts write. See §4. |
| 11 | `src/crm/customerIdentity.ts` | **NO** | **INERT** | Pure CRM identity/inheritance helper. No entry point imports it outside `crm/`. |
| 12 | `src/crm/customerMigrationSource.ts` | **NO** | **INERT** | Reads legacy `accountOwner` shapes to build a migration projection. Unreachable from `index.ts`. |
| 13 | `src/crm/customerRepository.ts` | **NO** | **INERT** | PostgreSQL CRM repository. Unreachable from `index.ts`; no callable imports it. |
| 14 | `src/eosCommercial/commercialOwnershipAuthority.ts` | **NO** | **INERT** | PostgreSQL commercial ownership authority. Unreachable from `index.ts`. |
| 15 | `src/eosCommercial/commercialOwnershipRepository.ts` | **NO** | **INERT** | Same. |
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

---

## 5. ACCOUNTABILITY — STATED HONESTLY

> ## `NO ACCOUNTABILITY WRITE PATH EXISTS YET`

This is the required phrasing and it is the literal truth of the measurement, **not** a finding that
accountability is safe. Measured at this baseline:

* **zero** exported callables write an accountable-person field;
* **zero** `firestore.rules` statements mention one;
* **zero** operator scripts write one;
* **zero** occurrences of `accountablePerson` / `accountableEmployeeId` anywhere in `functions/src`;
* `ownershipMatrix.ownerFields` contains no accountability field — correctly, per **#187 §1**.

**The vacuity trap, named:** this population is empty because **the storage does not exist**, not because the
paths were audited and found governed. **"No accountability bypasses were proven"** would therefore be a false
statement about a stronger claim than the evidence supports, and it is not made here.

**What this wave built instead:** the accountability axis is governed **at the boundary** —
`AccountabilityStore` and `AccountabilityAuditPort` in the S4 module are the smallest seam the ruled sequence
needs, and **neither has an implementation in this repository.** With no ports supplied the axis refuses
`PORT_UNAVAILABLE`, which is the fail-closed answer: the alternative — recording an accountability change as an
`OWNERSHIP_HANDOFF`, the only ownership action the governed `AuditAction` vocabulary has — would be exactly
**#187 §1**'s *"accountability must not be redefined as ownership."*

**S6 owns the storage.** When it lands, the ratchet in
`functions/test/governedOwnershipWriterCensus.test.mjs` **fails** — deliberately — and forces this section to be
rewritten with a real population and real classifications.

---

## 6. THE RATCHET

`functions/test/governedOwnershipWriterCensus.test.mjs`, registered in `functions/package.json` under
`test:ownership` and path-filtered in `.github/workflows/eos-ownership-model-tests.yml`.

A snapshot document rots; a ratchet does not. It fails when:

1. a **new** source module names a person-axis ownership field and is not classified in §2;
2. the ownership matrix gains a **new** `PERSON`-axis ownership field not listed in §0;
3. any accountability field appears **anywhere** while §5 still says no write path exists;
4. `accountablePerson` appears in `ownershipMatrix.ownerFields` (**#187 §1**);
5. the recorded `firestore.rules` findings change — a Rules edit must force this census to be re-read;
6. `updateOpportunity`'s module gains handoff auditing, which would mean entry #1 must be reclassified;
7. the S4 boundary becomes exported from `index.ts`, which would mean a capability was activated.

---

## 7. WHAT WAS NOT DONE, AND WHY

| | |
|---|---|
| `firestore.rules` not changed | **Tier-2 HOLD.** The three PERSON-axis defects in §3 are recorded for the Rules lane. |
| `updateOpportunity` not changed | `#184`: *"eliminate or refuse the bypass"* — but doing so is an opportunity-domain change with its own audit-vocabulary consequences, and this wave's authority is the boundary and the census. Recorded as **BYPASS DEFECT (when granted)**. |
| No capability activated | No `active: false` capability was flipped, and the S4 boundary is unexported for that reason. |
| No accountability storage invented | S6's. Only the seam exists. |
| Nothing proven against a database | **NOT_RUN.** No PostgreSQL was reachable in this lane and no Firestore emulator exists here (no `java`). Every proof in this wave is a proof about the contract and the sequence, run with doubles. |
