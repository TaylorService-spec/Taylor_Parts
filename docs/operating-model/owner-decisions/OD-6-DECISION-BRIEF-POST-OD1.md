---
artifact_type: owner-decision-brief
lane: OD-6-FINAL
decision: OD-6
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
baseline_tag: ATLAS-BASE-2026-09-12-A
date: 2026-09-13
revision: FINAL -- revised in place after the MI-N ruling. PART I is the pre-ruling brief, PRESERVED VERBATIM; PART II is the post-ruling analysis. Nothing in PART I was deleted or rewritten; corrections are marked at the point of correction and argued in PART II.
supersedes: nothing -- OD-PACKET-001-006-007.md section 3 stands and is cited throughout
depends_on_ruling: "OD-1 APPROVED 2026-09-13 (ACCOUNTABLE PERSON a distinct first-class axis, ten hard invariants); MI-N CLOSED 2026-09-13 (ACCOUNTABLE PERSON is a SEPARATELY CARRIED business fact, NOT permanently derived from RECORD OWNER)"
mi_n_status: CLOSED 2026-09-13
ruling_records: "OD-1 = DECISIONS.md #180 on int/a-correctness-register; MI-N = DECISIONS.md #181, recorded by the controller in parallel. NEITHER IS ON THIS BRANCH -- both cited by name and ref only, never by relative link. See K-10."
implementation_status: NOT AUTHORIZED -- NO schema, NO backfill, NO migration, NO handoff activation, NO implementation
schema_designed: none
executed: nothing
---

# `OD-6` — FINAL DECISION BRIEF

### Revision 2, 2026-09-13 — `OD-1` **APPROVED** and `MI-N` **CLOSED**. Two parts: the pre-ruling brief, preserved; then the final analysis.

**OBSERVED AT: 64008d5a.** Every code claim below was re-read in this worktree at this baseline by
this lane, from `git show 64008d5a:<path>`, and carries a `file:line`. Claims inherited from an
earlier lane are attributed and marked as that lane marked them.

> ## THIS BRIEF ANSWERS NO OWNER QUESTION.
> It prepares **`OD-6` only**, with **`OD-1` APPROVED and `MI-N` CLOSED as settled authority**. A **RECOMMENDATION** appears
> below, **labelled, attributed and explicitly not a decision** — and where the evidence supports no
> recommendation, the field says so. **No field, collection, index, command, code token or schema is
> proposed anywhere. No generic `ownerId`/`accountableId`.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD
> OWNER are three distinct facts throughout and are never collapsed.
>
> **`OD-6` is NOT person-orphan policy.** That is **`OD-11a`** (*on departure, what is RELEASED and
> what is RETAINED?*), a different row, and this brief does not enter it. Where a question turns out
> to be `OD-11a`'s, it is named and left there.

---

> # SECOND RULING NOW IN FORCE — **`MI-N` IS CLOSED (2026-09-13)**
>
> **For `opportunity`, `salesAgreement` and `salesOrder`: ACCOUNTABLE PERSON IS A SEPARATELY CARRIED
> BUSINESS FACT. It is NOT permanently derived from RECORD OWNER.** At creation EOS **may** derive the
> **initial** accountable person from the governed commercial record owner when no explicit governed
> accountable person is supplied — **EXPLICIT VALID ACCOUNTABLE PERSON → GOVERNED DERIVATION FROM
> CURRENT COMMERCIAL RECORD OWNER → REFUSE**. **That is initialization, not permanent equivalence.**
> `accountablePerson = ownerEmployeeId` as a **permanent computed identity** is **forbidden**:
> *"the accountable-person fact must have its own lifecycle."*
>
> **The `OD-6` consequence, in the Owner's words:** *"`OD-6` must evaluate person-reference validity
> for the accountable person **INDEPENDENTLY** from record-owner validity. **Do not use the record
> owner's validity as a substitute for validating the accountable person.**"*
>
> **IMPLEMENTATION STATUS: NO schema, NO backfill, NO handoff activation, NO migration.**
> The full ruling, its transfer and continuity clauses and its four open sub-questions are recorded at
> **`M-1`**.
>
> ## HOW TO READ THIS DOCUMENT
>
> | Part | What it is | Authority it reasons from |
> |---|---|---|
> | **PART I** (immediately below, through *"WHAT THIS DOCUMENT DID NOT DO — PART I's STATEMENT"*) | **The pre-ruling brief, PRESERVED VERBATIM.** Not rewritten. Its conditional branches are left standing so the reasoning that led to the ruling stays readable | `OD-1` only. **`MI-N` was open when it was written** |
> | **PART II** (from *"PART II — POST-`MI-N`"*) | **The final brief.** It settles PART I's conditionals, reassesses the option set against the widened scope, and states what PART I got wrong | `OD-1` **and** `MI-N` |
>
> **Three corrections PART II makes to PART I, flagged here so no reader takes PART I's version as
> final:** `K-11` (PART I's *"(b) is comfortable"* shorthand) · `K-12` (PART I's *"status may only be
> reported"*) · `K-13` (PART I's *"only one exception changes what `OD-6` must resolve"*). Each is
> marked in place below and argued in PART II.

---

**Sources, read-only:** `own-decision:docs/operating-model/owner-decisions/OD-PACKET-001-006-007.md`
(`ce66f9b1`) §3 · `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` on this branch (`e1d5c024`) ·
`emp-synth:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md` (`664ed365`) ·
`own-enggap:docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` (`7792c1ba`) ·
`functions/src/ownership/**`, `functions/scripts/ownership*.js`, `firestore.rules` at `64008d5a`.
**PART II additionally read, read-only, at `64008d5a`:** `functions/src/opportunity/opportunityCommands.ts` ·
`functions/src/salesOrder/salesOrderCommands.ts` · `functions/src/salesAgreement/salesAgreementCommands.ts` ·
`functions/src/opportunity/closeOpportunityAsWon.ts` · `functions/src/opportunity/createSalesOrderFromOpportunity.ts` ·
`functions/src/finance/financialAttribution.ts` · `functions/src/access/governedBusinessRoles.ts` ·
`functions/src/workOrderLabor/workOrderLaborCommand.ts` · `docs/DECISIONS.md` on this branch.

---

# PART I — THE PRE-RULING BRIEF, PRESERVED VERBATIM

> **`MI-N` WAS OPEN WHEN PART I WAS WRITTEN.** Nothing below has been deleted or rewritten. Where the
> ruling corrects it, a marker appears at the point of correction and the argument is in PART II.

## DECISION ID

| Field | Content |
|---|---|
| **ID** | **`OD-6`** — `EMPLOYEE-OPEN-DECISIONS.md` §3, row `OD-6` (`emp-synth` `664ed365:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md:141`) |
| **PROVENANCE (5 lane-local items consolidated)** | EMP-ACCOUNTABILITY `OD-OWN-006` · OWN-E2E `OD-OWN-013` and `U-13` · OWN-DESIGN `EG-11` and `OD-OWN-017`. **Also folded by the synthesis:** EMP-INFORMATION `OD-EMP-004` (*"what is the 'census gate', and what closes it?"* → split across `OD-10`/`OD-6`) |
| **SIBLING ROW, DISTINCT, FREQUENTLY CONFUSED** | **`OD-11a`** — *on departure, what is RELEASED and what is RETAINED?* `OD-6` is a **measurement and sequencing** decision. `OD-11a` is **policy**. Ruling on policy as though it were `OD-6` would leave the gate blindness untouched |
| **GATING RULING NOW IN FORCE** | **`OD-1` APPROVED 2026-09-13** (`EMPLOYEE-OPEN-DECISIONS.md:60-82`). `OD-6` is named **by the ruling's own banner** as a precondition of the accountability programme: *"No ACCOUNTABLE PERSON storage, migration, enforcement, handoff or backfill until `OD-6` resolves person-reference validity and census behaviour and the remaining dependency decisions are reconciled"* |

---

## EXACT QUESTION — the packet's wording, unaltered

> ### **"Should person-owner derivation check the Employee document — and must it do so BEFORE the census gates enforcement?"**

**Two parts.** `OD-PACKET-001-006-007.md` §3: *"The second is the sequencing question and is the one
with a live consequence."* That framing stands. `OD-1` changes which of the two the evidence settles
— see **WHICH OPTIONS `OD-1` HAS CONSTRAINED OR ELIMINATED**.

---

## WHAT `OD-1` SETTLED THAT BEARS ON THIS

`OD-1` ruled **option (a)**: ACCOUNTABLE PERSON is a **distinct first-class axis**, modelled
independently from RECORD OWNER · ASSIGNEE/EXECUTOR · MANAGER · ESCALATION OWNER · OPERATING COMPANY ·
DOMAIN STEWARD · JOB ROLE · SECURITY ROLE. It answers *"Who is personally responsible for making sure
the next required outcome happens?"* For every **ACTIONABLE** business item EOS must be able to
identify **exactly one** accountable person **at every point in time**, unless a separately
Owner-approved exception defines otherwise.

**Which of the ten invariants reach `OD-6`, and how far. This is the load-bearing table of the brief.**

| Inv. | What it binds | Reaches `OD-6`? | The precise bearing |
|---|---|---|---|
| **1** | Actionable work must never have ACCOUNTABLE PERSON = NONE | **YES — decisively, but on 3 families, not 6** | It is an invariant whose violation EOS **cannot currently detect** on the person axis. See **INVARIANT 1 — HOW FAR IT ACTUALLY REACHES** below: by the decomposition's own measured `T2`, invariant 1 binds on `opportunity`, `salesAgreement`, `salesOrder` and **not** on `account`, `contact`, `location` |
| **2** | Reassigning execution does not automatically change accountability | **Indirectly** | No PERSON family carries an execution field (`assignedTechId` is on `workOrder`, deliberately **not** an `ownerField`). So invariant 2 does not bite inside `OD-6`'s six families; it bites on Area A's six, which `OD-6` does not govern |
| **3** | Changing accountability does not automatically change record ownership | **YES — as a constraint on the derivation reading** | If accountability for the commercial chain is *derived from* the record owner, invariant 3 becomes inexpressible for those families: there is nothing to change independently. See **DEPENDENCY RECONCILIATION Q2** |
| **4** | Manager involvement does not automatically change accountability | **No** | `OD-6b`'s subject. Carried in the reconciliation, not here |
| **5** | Escalation does not automatically change record ownership | **No** | No escalation mechanism exists to constrain. `OD-11`/`OD-6b` |
| **6** | **Historical accountability must remain auditable** | **YES — it constrains the SHAPE of a YES from inside** | It permits a **reporting** distinction and forbids a **resolution** change for owners that *did* exist (TERMINATED / INACTIVE), because `UNRESOLVED` is the input a backfill acts on. **This is where `OD-1` contradicts a prior lane** — see **CONFLICT NOW CREATED BY THE RULING** |
| **7** | Handoff semantics must guarantee no responsibility gap | **No, but it newly constrains `OD-11`** | *"Between Dispatch and Accept, NOBODY IS NAMED"* is a responsibility gap invariant 7 now forbids. `OD-11`'s row, not `OD-6`'s |
| **8** | A record may have COMPANY ownership while still requiring a PERSON accountable for active work | **YES — it finishes off the "parity with COMPANY" framing** | It legitimises the two axes as answering different questions, so their integrity checks **need not match** — a second, independent reason to abandon parity, and this one is an authority rather than a code reading. It also **ratifies P-3 and case 4** |
| **9** | Reference/master-data objects do NOT automatically require an accountable person merely because the field exists; their stewardship model is defined separately | **YES — it ratifies acceptance-contract case 5** | Case 5 previously rested on ruling D-8 and `ownershipCensus.ts:245-247`; it now also rests on an Owner invariant. **They agree; there is no conflict.** One new consequence, below |
| **10** | Do NOT implement one generic `ownerId`/`accountableId` shortcut across all families | **YES — but weakly, and not where it is usually read to** | It forbids a generic **field**, not a generic **resolver**. Its effect on **(a)** vs **(c)** is real but marginal, and it points at **(c)** — the first evidence-grounded argument for (c) that exists. Argued below |

### INVARIANT 1 — HOW FAR IT ACTUALLY REACHES, AND WHY IT MATTERS MORE THAN IT LOOKS

Invariant 1 binds on **ACTIONABLE** items. The decomposition's `T2` clause — *"the family stores a
non-terminal lifecycle state… the business carries an outstanding obligation on it"* — is a **measured,
code-decidable** test of exactly that (`OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` §1.1, §1.3). Applied
to `OD-6`'s six PERSON families, by that lane's own verdicts:

| PERSON family | `ownerFields` | Entry point | `T2` (actionable) | Invariant 1 binds directly? |
|---|---|---|---|---|
| `account` | `["accountOwner"]` (`ownershipMatrix.ts:120`) | (1) `deriveAccountOwner` | **FAILS** — *"master records, no lifecycle"* (§1.3) | **No — but transitively, see below** |
| `contact` | `["owner"]` (`:128`) | (3) `deriveStoredOwner` | **FAILS** (§1.3) | **No** |
| `location` | `["owner"]` (`:135`) | (3) `deriveStoredOwner` | **FAILS** (§1.3) | **No** |
| `opportunity` | `["ownerEmployeeId"]` (`:149`) | (2) `deriveEmployeeRefOwner` | **PASSES** (§1.3: *"These three are actionable"*) | **YES** |
| `salesAgreement` | `["ownerEmployeeId"]` (`:158`) | (2) | **PASSES** | **YES** |
| `salesOrder` | `["ownerEmployeeId"]` (`:168`) | (2) | **PASSES** | **YES** |

**Two consequences, and the second is a correction to the standing framing of `U-K`.**

1. **`account` is transitively load-bearing for invariant 1 even though it fails `T2`.** The matrix
   declares the inheritance chain: `opportunity.inheritanceSource = "Customer (Account) owner"`
   (`ownershipMatrix.ts:149`), `salesAgreement` and `salesOrder` = `"Opportunity owner"` (`:158`,
   `:168`). So an invalid `accountOwner.assignedToEmployeeId` propagates **into** the three families
   where invariant 1 binds. `account`'s owner validity is therefore inside invariant 1's scope by
   inheritance, not by classification. `[OBSERVED AT: 64008d5a]`
2. **Invariant 1's bite and `U-K`'s uncertainty fall on DISJOINT families.** `U-K` — *whether
   `contacts.owner` / `locations.owner` exist in Firestore at all* — is about `contact` and
   `location`, the two families that **fail `T2`** and that invariant 1 therefore does **not** reach.
   The three families where invariant 1 binds are the `ownerEmployeeId` families, measured at
   **14/14, 5/5, 17/17** shape-valid, i.e. the field demonstrably exists there. **So `U-K` does not
   stand between `OD-6` and invariant 1.** It remains the highest-consequence unknown for the
   *acceptance contract's case-2 coverage* — a narrower claim than "the highest-consequence unknown
   for `OD-6`". See **CORRECTIONS**, `K-3`.

### THE INVARIANT 9 / CASE 5 INTERACTION — ratification, plus one new guard

| | |
|---|---|
| **Acceptance contract case 5** | REFERENCE / EXCLUDED families are *"counted in nothing"*; the resolver **must not be reached**; `CENSUS_FAMILIES = ownableFamilies()` (`ownershipCensus.ts:251`), admitting only PERSON, COMPANY, PARTICIPATING_COMPANIES (`ownershipMatrix.ts:550-554`). Both directions asserted, by set equality |
| **Invariant 9** | Reference/master-data objects do **not** automatically require an accountable person merely because the field exists; stewardship is defined separately |
| **Interaction** | **They agree. Invariant 9 upgrades case 5 from a preservation clause resting on ruling D-8 and a code comment to a requirement resting on an Owner invariant.** No conflict is created, and case 5 needs no amendment |
| **The one NEW consequence** | Invariant 9 says stewardship *"is defined separately"* — i.e. **`OD-11b`**. So case 5's negative control (ii) — *"a `REFERENCE` family carrying a person-shaped owner value must not be counted at all"* — is now **doubly** load-bearing: it is also the guard that stops an eventual `OD-11b` steward from arriving as a census bucket. **`P-6` must not be relaxed when `OD-11b` rules**, and invariant 9 is the authority for saying so |
| **The mirror-image error invariant 9 also names** | *"merely because the field exists"* is a warning against inferring an obligation from a field's presence. That is the same inference `U-K` guards in the other direction: a proof over `contacts`/`locations` fixtures could pass while governing a field that does not exist where the applier writes |

### THE INVARIANT 8 QUESTION — does it weaken the parity framing? YES, and it helps

The packet's `OD-6` OWNERSHIP consequence row frames the target as the person axis reaching parity
with the company axis, then immediately corrects itself: *"the COMPANY axis has existence integrity
but not active-status integrity… So the claim is right in direction and slightly too strong in
degree."* The acceptance contract §2.3 goes further and rejects parity as the bar outright. **Both
were reading code. Invariant 8 supplies an authority for the same conclusion, and a different reason.**

**Re-verified at baseline — the company axis accepts INACTIVE in three independent places:**

| # | Location | Verbatim behaviour | Marking |
|---|---|---|---|
| 1 | `operatingCompanyAuthority.ts:80` | `return { state: company.active ? "RESOLVED" : "INACTIVE", company };` — the authority **computes** active status | `[OBSERVED AT: 64008d5a]` |
| 2 | `typedOwner.ts:137-143` | `:137` takes `state`; `:138` handles `INVALID`; `:139` handles `UNKNOWN`; **`INACTIVE` matches neither and falls through to `:140-143` producing `RESOLVED`.** Stated reason at `:128-130`: *"a record owned by a since-deactivated company still HAS an owner, and calling it unresolved would invite a backfill to reassign it"* | `[OBSERVED AT: 64008d5a]` |
| 3 | **`commercialCompanyScope.ts:63-68`** | `if (state === "RESOLVED" \|\| state === "INACTIVE")` → accept, with the reason stated **in the source**: *"INACTIVE passes: a record booked to a company that has since been deactivated still landed on that company's books, and rejecting it would rewrite history to tidy a registry."* | `[OBSERVED AT: 64008d5a]` — **confirms the controlling brief's citation; the lines are `:63-68`, the brief said `:64-67`, which is the body without the `if` and the closing brace** |
| 4 | `typedOwner.ts:206` | `deriveStoredOwner`'s COMPANY governance re-check tests `resolveOperatingCompany(value.id).company === null` — an **INACTIVE** company returns a non-null `company`, so it **passes** and reaches `:209` `RESOLVED`. A fourth, independent acceptance of INACTIVE | `[OBSERVED AT: 64008d5a]` — **not previously stated by any lane in this form** |

**The argument, stated as an argument rather than asserted:**

| Step | Claim |
|---|---|
| 1 | Invariant 8 says a record may be COMPANY-owned **and** require a PERSON accountable for active work. The two facts coexist and answer different questions |
| 2 | If they answer different questions, **there is no principled reason their integrity checks must be equally strong.** Parity was never a valid target — it was an intuition about symmetry |
| 3 | So invariant 8 **removes parity as an argument FOR the person-axis check.** That looks like a weakening |
| 4 | **But it replaces it with a stronger argument: invariant 1 detectability.** Parity was never true (the company axis has existence integrity only — four places above). Detectability is now *ruled*. **An argument that is true and binding is worth more than one that was neither** |
| 5 | And invariant 8 **actively requires the two axes to be measured separately**, because it legitimises a record that is COMPANY-owned and PERSON-accountable at once. That is precisely the prohibition on conflation `2 ≡ 4`, and it **ratifies `P-3`** (an INACTIVE company owner must still census `resolved`) **and acceptance-contract case 4's negative control** (a pinned, unchanged COMPANY expectation table) |
| 6 | **The defect invariant 8 actually exposes is not "the person axis is weaker."** It is that **the asymmetry between the axes was never decided** — today it is *emergent*, produced by a fall-through at `typedOwner.ts:140-143` and an absent enum member (`INACTIVE` is in `OperatingCompanyResolutionState` `operatingCompanyAuthority.ts:54` and in **none** of `OWNERSHIP_RESOLUTION` `typedOwner.ts:25-30`, `UnresolvedCode` `:50`, `CensusCounts` `ownershipCensus.ts:43-49`, `emptyCounts()` `:78`). Invariant 8 makes declaring it a requirement |

**Net: invariant 8 weakens the framing and strengthens the decision.** It does not eliminate any
option.

---

## CURRENT EOS FACT — re-verified by this lane at `64008d5a`

### F-1. FIVE person-axis touch points, not four and not two

The controlling brief named **four**. Four is right for **derivation**. There is a **fifth** that
**writes** the field the census then reads shape-only, and it is the sole writer of
`contacts.owner` / `locations.owner` in `functions/src`.

| # | Touch point | Location | What it does on the person axis | Reads `employees`? |
|---|---|---|---|---|
| 1 | `deriveAccountOwner` | `typedOwner.ts:95-109` | `accountOwner.assignedToEmployeeId` → `nonEmptyString` (`:102`) → `typedOwner(USER, …)` (`:105`) → `RESOLVED` (`:108`) | **No** |
| 2 | `deriveEmployeeRefOwner` | `typedOwner.ts:112-125` | one declared field → `nonEmptyString` (`:118`) → `typedOwner(USER, …)` (`:121`) → `RESOLVED` (`:124`) | **No** |
| 3 | `deriveStoredOwner` | `typedOwner.ts:196-210` | `isTypedOwner` (`:202`); **the governance re-check at `:206` is guarded on `value.type === OWNER_TYPES.COMPANY`, so a USER owner skips it and falls through to `:209` `RESOLVED`.** Its own header comment `:186` calls the field *"the shape the backfill writes"* | **No** |
| 4 | `isTypedOwner` — the floor under 1–3 | `typedOwner.ts:62-70` | `:67` **USER → `nonEmptyString(v.id)` only.** `:68` COMPANY → `isOperatingCompanyIdShape(v.id)` | **No** |
| **5** | **`personFromAccount`** — **`[NEW — this lane]`** | **`ownershipBackfillRules.ts:70-78`** | *"contacts / locations -> the parent Account's owner. The only PERSON derivation authorized."* `:74` reads `ctx.accountOwnerByAccountId`; `:77` writes `{ owner: { type: "USER", id: employeeId } }`. Its context map is built by **non-emptiness alone** — `ownershipBackfillSimulation.js:81-84` and `ownershipSandboxBackfill.js:88-91`, both `typeof id === "string" && id.trim().length > 0` | **No** |

**Dispatch, re-verified:** `ownershipCensus.ts:165-172` — `accountOwner` → (1) at `:166`; **`owner` →
(3) at `:169`**; else COMPANY → `deriveCompanyOwner` at `:170`; else → (2) at `:171`. **Only `contact`
and `location` declare `ownerFields: ["owner"]`** (`ownershipMatrix.ts:128`, `:135`) — verified by
grepping the whole matrix; there are exactly two. So entry point (3) governs exactly the two `U-K`
families. `[OBSERVED AT: 64008d5a]`

**Two consequences of touch point 5 that no prior lane states:**

| # | Consequence | Evidence |
|---|---|---|
| **5a** | **The backfill CANNOT repair an invalid person owner, by construction.** `ownershipBackfillRules.ts:71` — `if (doc.data.owner !== undefined) return { kind: "ALREADY_SET" };`, and the module header `:21` states it as a ruling requirement: *"ALREADY_SET the ownership field is already present — never overwritten (requirement 10)."* So an invalid `contacts.owner` / `locations.owner` made newly visible by `OD-6` has **no repair path in the shipped backfill.** This *strengthens* the *"measurement change, not a backfill"* framing in an unexpected direction: it is not a backfill because the backfill is structurally forbidden from touching it | `[OBSERVED AT: 64008d5a]` |
| **5b** | **The propagation of an invalid Account owner into children is in shipped code, at a `file:line`.** `:74` looks up the parent Account's owner id in a map validated only for non-emptiness, `:76` protects only the three R-7 deliberately-ownerless control Accounts, and `:77` writes it onto the child. **There is no employee check at any hop.** This is the code location of the carried finding *"departure SEEDS NEW ORPHANS INDEFINITELY"* — previously cited to `RESPONSIBILITY-HANDOFF-MODEL.md` §4.2 and the corpus, never to source | `[OBSERVED AT: 64008d5a]` |

### F-2. The person axis has no syntactic floor either — confirmed

| Stored owner | Census outcome today | Why | Marking |
|---|---|---|---|
| COMPANY id `"!!!"` | **`invalid`** (blocking) | fails `/^[a-z][a-z0-9_-]{1,62}$/` (`operatingCompanyAuthority.ts:69`, function declared `:68`) → `resolveOperatingCompany` `INVALID` (`:77`) → `typedOwner.ts:138` | `[OBSERVED AT: 64008d5a]` |
| USER id `"!!!"` | **`resolved`** (non-blocking) | `typedOwner.ts:67` applies `nonEmptyString` and nothing else | `[OBSERVED AT: 64008d5a]` |

**Confirmed exactly as the controlling brief states it.** One citation correction: the regex is at
**`operatingCompanyAuthority.ts:69`**, not `:71` (`:71` is a blank line following the closing brace).
`[CORRECTION K-1]` This is the cheapest non-vacuous observation available, it needs no employee data,
and **it is not `OD-6`-gated** — it is acceptance-contract `T-3`.

### F-3. The blindness is total, not merely non-blocking — confirmed

| Line | Verbatim | Consequence |
|---|---|---|
| `ownershipCensus.ts:231` | `const blocking = totals.ownerless + totals.invalid + totals.unknown + totals.ambiguous;` | **Four terms. `resolved` is not one of them** — it is accumulated at `:228-229` and never consulted |
| `ownershipCensus.ts:240` | `assessable: blocking === 0 && unreadable.length === 0 && truncated.length === 0` | The only three ways the gate can go false |
| `ownershipCensus.ts:190` | `if (key === "resolved") continue;` | A resolved document contributes **no reason string** to `reasons` |
| `ownershipCensus.ts:184` | `samples = { invalid: [], unknown: [], ambiguous: [], ownerless: [] }` | **Four keys. There is no `resolved` sample list** |

> **Therefore there is today NO channel of any kind — blocking, advisory or diagnostic — by which
> the census could report a person orphan.** `[OBSERVED AT: 64008d5a]` The controlling brief is
> correct and a fix that adds only a blocking bucket is **narrower than the defect**: it would give
> the gate a number and still give an operator nothing to act on, because neither `reasons` nor
> `samples` would name a single record.

### F-4. `INACTIVE` is not a census-side state at all — confirmed

| Enum | Location | Members | Has `INACTIVE`? |
|---|---|---|---|
| `OWNERSHIP_RESOLUTION` | `typedOwner.ts:25-30` | `RESOLVED` · `UNRESOLVED` · `AMBIGUOUS` · `OWNERLESS` | **No** |
| `UnresolvedCode` | `typedOwner.ts:50` | `INVALID` \| `UNKNOWN` | **No** |
| `CensusCounts` | `ownershipCensus.ts:43-49`; `emptyCounts()` `:78` | `resolved` · `ownerless` · `invalid` · `unknown` · `ambiguous` | **No** |
| `OperatingCompanyResolutionState` | `operatingCompanyAuthority.ts:54` | `INVALID` \| `UNKNOWN` \| **`INACTIVE`** \| `RESOLVED` | **Yes** |

The company axis **computes** `INACTIVE` (`operatingCompanyAuthority.ts:80`) and the ownership layer
**discards** it (`typedOwner.ts:137-143`). So `OD-6`'s carried recommendation wording — *"distinguish
`OWNERLESS` ≠ `UNKNOWN` ≠ `INACTIVE` ≠ `RESOLVED`, as the company axis already does"* — names a
distinction **the census cannot express and the company axis does not make.** `[Acceptance contract
`C-B`, confirmed line for line by this lane.]`

### F-5. The specification and the ruling still point in opposite directions — both stand

| Authority | Says | Status |
|---|---|---|
| `record-ownership.md` §2 | *"reassigning to a departed employee ORPHANS THE RECORD SILENTLY, which is how ownership models rot"* — **requires** the active check | **Draft, and NOT marked superseded** |
| Owner ruling **O-1**, quoted verbatim in source at `typedOwner.ts:45-48` | *"Producing UNKNOWN for an employee id would require a cross-collection existence lookup, which Owner ruling O-1 explicitly excluded from ownership resolution ('would introduce a fallible cross-collection lookup into otherwise deterministic ownership resolution'). So a USER family's UNKNOWN count is structurally zero, not merely empty"* | **Shipped, documented, attributed** |

**Both readings are carried. Neither is resolved here.** `OD-1` does **not** adjudicate between them —
it is silent on cross-collection lookups. What `OD-1` changes is the **cost of leaving them
unadjudicated**, because one of the two is now load-bearing for a binding invariant.

### F-6. `contacts` / `locations` — the exposure, and what it does and does not tell us about `U-K`

| Fact | Evidence | Marking |
|---|---|---|
| `firestore.rules` `match /locations/{locationId}` is **`allow create, update: if isAdminOrDispatcher();` with no `hasOnly` and no field validation whatsoever** | `firestore.rules:1341-1345` | `[OBSERVED AT: 64008d5a]` |
| `firestore.rules` `match /contacts/{contactId}` — **identical shape** | `firestore.rules:1555-1559` | `[OBSERVED AT: 64008d5a]` |
| **Rules never name `owner` on either collection.** A grep of the whole file for `owner` returns no `contacts`/`locations`/`accountOwner` field reference | `firestore.rules`, whole-file grep | `[OBSERVED AT: 64008d5a]` |
| The **only** writer of `contacts.owner` / `locations.owner` in `functions/src` is touch point 5 | `ownershipBackfillRules.ts:77`; repo-wide grep for `owner: { type` returns exactly one hit | `[OBSERVED AT: 64008d5a]` |

**This CONFIRMS `OD-8`'s finding exactly** (*unguarded, no `hasOnly`, unaudited generic client write
by any `admin` or `dispatcher`*) **and it WIDENS `U-K` rather than narrowing it.** `[NEW — this lane]`
There is no repository-side evidence at all that the field exists in Firestore: it is *declared* in
the matrix (`:128`, `:135`), *read* by one derivation (`typedOwner.ts:196-210` via dispatch at
`ownershipCensus.ts:169`), *written* by one backfill rule that refuses to overwrite (`:71`), and
**named nowhere in Rules and by no UI or callable.** See **CORRECTIONS**, `K-3`.

---

## WHY IT MUST BE DECIDED NOW

| # | Reason | Changed by `OD-1`? |
|---|---|---|
| **1** | **Enforcement could be switched on against a census reading zero while orphans exist.** `censusGate`'s own comment states the failure mode it exists to prevent — `ownershipCensus.ts:214-216`: *"A permission or index failure that counted as zero would let enforcement be enabled over records nobody managed to look at."* **The person axis reproduces it by a different route: not an unread family, but a family read with a blind instrument.** The number is not wrong; **the number cannot be wrong**, which is worse | **No — unchanged and still the primary reason** |
| **2** | **`OD-1`'s own banner names `OD-6` as a precondition.** *"No ACCOUNTABLE PERSON storage, migration, enforcement, handoff or backfill until `OD-6` resolves person-reference validity and census behaviour."* `OD-6` is now on the critical path of an **approved** programme, not of a proposal | **YES — NEW, and it is the strongest new reason** |
| **3** | **Invariant 1 is binding and undetectable.** On the three `ownerEmployeeId` families it binds, and the census has no channel of any kind to report the violation (**F-3**). An invariant no instrument can falsify is a statement of intent, not a control | **YES — NEW** |
| **4** | **The propagation is live and unchecked in shipped code.** `ownershipBackfillRules.ts:70-78`: an invalid Account owner is copied onto every child Contact and Location, and `:71` then protects it from ever being corrected | **No, but newly located at a `file:line` by this lane** |
| **5** | **Nothing surfaces it in the product.** `contacts.owner`/`locations.owner` are unreachable from the product (census §4.4 downgrades stages 2 and 3 on that basis) and the one owner report dimension `report.customer.field.accountOwner.read` is `active:false`. A person orphan is invisible in the census, in the UI and in reporting simultaneously | **No — and `OD-10` is the row that owns it** |

---

## OPTION A — the packet's `(a)`: YES, in the derivation, and BEFORE the gate

| Field | Content |
|---|---|
| **Statement** | The person axis distinguishes `OWNERLESS` ≠ `UNKNOWN` ≠ *cannot-act* ≠ `RESOLVED`. The check lives in `typedOwner`'s derivation. A **measurement** change and a **prerequisite** to enforcement, not a follow-up |
| **Traceability** | EMP-ACCOUNTABILITY `OD-OWN-006`, carried by the synthesis and by `OD-PACKET-001-006-007.md` §3 |
| **What it costs** | **Explicitly revisits Owner ruling O-1.** `typedOwner` stops being *"otherwise deterministic"* — which is precisely what O-1 protected. The decomposition's `C-B3` offers an answer to O-1's stated objection on its own terms: make the lookup failure **an outcome** rather than an exception, which *"preserves determinism and totality for the price of one state, not for the price of correctness"* |
| **What it costs that is usually missed** | `typedOwner.ts:1-8` declares itself the *"trusted-side mirror of the client authority `field-ops-app-vite/src/domain/typedOwner.js`"*, with parity *"asserted by `test/typedOwner.test.mjs` against the same canonical case table"*. **The client cannot perform a trusted cross-collection read.** So (a) necessarily breaks the mirror unless the contract says which side owns the new outcomes and what the other renders (decomposition `C-B7`). **(a) is the option where this cost lands hardest, because it lands in the mirrored module itself** |
| **Effect of `OD-1`** | **Not eliminated. Strengthened in motive, narrowed in shape.** Invariant 1 supplies the motive; **invariant 6 narrows the shape from inside** — see the conflict section |

## OPTION B — the packet's `(b)`: NO. Uphold ruling O-1 as written

| Field | Content |
|---|---|
| **Statement** | Derivation stays shape-only and deterministic — **and the census may then never be cited as the gate's evidence for person families.** The gate's person-axis evidence becomes a separate, explicitly out-of-band join |
| **Traceability** | Ruling O-1, verbatim in source at `typedOwner.ts:45-48`; the read named in `U-J` |
| **What it buys** | The determinism O-1 bought, intact. No mirror break. No new bucket. No revisiting of a standing Owner ruling |
| **What it requires — packet's own words** | *"Requires the gate's own documentation to state that its person-axis zero is structural — otherwise this option is indistinguishable from the current state, which is the defect"* |
| **What it requires AFTER `OD-1`, in addition** | It must **also** declare that **the census is not evidence for invariant 1 on any family**, and that invariant 1's verification is deferred to whatever instrument the accountability axis eventually acquires. **That is a materially higher bar than a documentation note about a structural zero**, because it is a written acknowledgement that EOS has bound itself to an invariant it cannot currently detect the violation of |
| **Effect of `OD-1`** | **NOT eliminated. Eliminated as a DEFAULT.** The full argument is in the next section — it is the question the lane contract asked to be argued rather than asserted, and the answer turns on something `OD-1` did **not** settle |

## OPTION C — the packet's `(c)`: YES, but NOT in the derivation

| Field | Content |
|---|---|
| **Statement** | Leave `typedOwner` shape-only (O-1 intact); place the existence/status check **in the census and gate layer only**, where a cross-collection read is already expected and the gate already distinguishes unreadable from empty |
| **Traceability** | **MARKED: surfaced by `OD-PACKET-001-006-007.md` itself. No lane states it as an option and nothing in the evidence endorses it.** That marking still holds after `OD-1` |
| **What it buys** | It satisfies `H9` (*the person axis must be able to REPORT an orphan before enforcement is gated on the census*) **without reversing O-1** — the two are separable, and `OD-6` as written treats them as one. It leaves the client mirror untouched, which is the cost (a) cannot avoid |
| **What it costs** | **Unassessed.** It splits the answer to *"does person ownership resolve?"* across two layers — the shape that produced conflict `O-1` elsewhere in the matrix. And the split is not symmetric: under (c), the **server census** and the **client `typedOwner.js`** would answer *different questions about the same record*, which is a mirror divergence of a subtler kind than (a)'s |
| **Effect of `OD-1`** | **Not eliminated. Marginally strengthened — by invariant 10, and this is the first evidence-grounded argument for (c) that exists.** Argued in the next section |

## OPTION D — the packet's `(d)`: switch enforcement on regardless

| Field | Content |
|---|---|
| **Statement** | The current trajectory if `OD-6` is not ruled |
| **Traceability** | **Not recommended by any lane. Recorded only so the null action is named** |
| **What it costs** | **The one option with a live downside.** The gate reads a structural zero as a measurement and enforcement is enabled over a population nobody measured |
| **Effect of `OD-1`** | **Not forbidden — SELF-DEFEATING, which is stronger and is precisely citable.** See below. Be careful about the overclaim: the banner forbids **ACCOUNTABLE PERSON** enforcement, not the **ownership** census gate, so the ruling does not literally prohibit (d) |

---

## WHICH OPTIONS `OD-1` HAS CONSTRAINED OR ELIMINATED, AND WHY

**Summary, then the arguments.**

| Option | Before `OD-1` | After `OD-1` | Verdict |
|---|---|---|---|
| **A** `(a)` | Recommended by one lane; reverses O-1 | **Motive strengthened** (invariant 1). **Shape narrowed from inside** (invariant 6). Mirror cost unchanged and now the sharpest difference from (c) | **CONSTRAINED, NOT ELIMINATED** |
| **B** `(b)` | A defensible steady state with a documentation bar | Survives **only** with a written acknowledgement of a permanent, undetectable invariant gap. Its coherence depends on a question `OD-1` did not settle | **VIABLE AS A DECISION; ELIMINATED AS A DEFAULT** |
| **C** `(c)` | Surfaced by the packet; endorsed by nothing | Endorsed by nothing still, but **marginally strengthened by invariant 10** and by invariant 9's per-class exemption. New cost surfaced: the mirror divergence runs the other way | **CONSTRAINED UPWARD, STILL UNENDORSED** |
| **D** `(d)` | *"The one option with a live downside"* | **Blocks the ruling the Owner just made.** `OD-6`'s resolution is a named precondition of the entire `OD-1` programme, so (d) — under which `OD-6` is never ruled — stalls an **approved** decision indefinitely | **SELF-DEFEATING. NOT LITERALLY FORBIDDEN** |
| — | — | **The question itself is untouched.** `OD-1` changes no option's definition and adds none | **NO NEW OPTION** |

### B-1. Is option (b) INCOHERENT with a binding invariant? Argued, not asserted.

**The case that it IS incoherent:**

| # | Step |
|---|---|
| 1 | Invariant 1 is now binding: for every ACTIONABLE item EOS *"must be able to identify exactly one accountable person at every point in time"* |
| 2 | *"Must be able to identify"* is a **capability** claim about EOS, not merely a storage claim about a record. Identifying a string that may name nobody is not identifying a **person** |
| 3 | Under (b), the person axis remains measured by `nonEmptyString` (`typedOwner.ts:67`) and the census retains **no channel of any kind** to report otherwise (**F-3**) |
| 4 | For `opportunity`, `salesAgreement` and `salesOrder` — the three families where invariant 1 **binds** — the only person-valued fact on the record is `ownerEmployeeId`. If accountability for them is the owner (the decomposition's `T3`, and the cheapest reading of `OD-1`), then under (b) **invariant 1 is unfalsifiable for three of the six PERSON families, permanently and by design** |
| 5 | An invariant whose violation no instrument can ever report is not a control. **So (b) leaves the Owner's newest invariant in the same evidentiary condition as the gap the ruling was made to close** |

**The case that it is still VIABLE:**

| # | Step |
|---|---|
| 1 | Invariant 1 binds **ACCOUNTABLE PERSON**. `OD-6` governs **RECORD OWNER** derivation. The ruling's invariants **2** and **3** expressly hold the axes apart — *"changing accountability does not automatically change record ownership"* |
| 2 | The accountability axis **does not exist**: `grep -ci accountable` returns **0 across all 12 modules of `functions/src/ownership/`** at baseline, re-verified by this lane. Invariant 10 forbids the generic field, and the banner states the ruling *"does not license adding a field"* |
| 3 | So a ruling that the **record-owner derivation** stays shape-only says **nothing** about whether the **accountability axis** must be validity-checked. Those are different instruments for different facts |
| 4 | Under (b) the honest statement is available and complete: the census's person-axis zero is **structural**; the census is **not** evidence for invariant 1 on any family; invariant 1's verification is deferred to the accountability axis's own instrument, which does not exist yet and whose design `OD-1` deliberately did not authorize |
| 5 | **(b) then costs an acknowledged gap, not a contradiction.** The acceptance contract already specifies what satisfies it — `G-6`: *"under (b) the acceptance bar becomes a documentation and gate-evidence bar, and `T-1`…`T-7` are exactly the evidence it must cite"* |

> ### `[MI-N` CLOSED 2026-09-13 — THIS VERDICT IS DISCHARGED. SEE `M-2`.]`
> The conditional below turned on `MI-N`. **`MI-N` ruled SEPARATELY CARRIED.** The *"separately
> carried"* row's shorthand — *"(b) is comfortable"* — **is WRONG AS STATED (`K-11`).** Separately
> carried makes (b) **COHERENT** (its incoherence branch is retired) and **MORE EXPENSIVE** (the
> ruling's governed-derivation branch makes the unvalidated owner reference the **seed** of the
> accountability fact). **Settled status: COHERENT, UNCONDITIONALLY; STILL ELIMINATED AS A DEFAULT;
> DEARER THAN PART I PRICED IT. Argued at `M-2`. The text below is preserved unaltered.**

**THE VERDICT, AND THE THING IT TURNS ON:**

> **(b)'s coherence depends entirely on a question `OD-1` did NOT settle: for the three commercial
> families, is the accountable person a SEPARATELY-CARRIED fact, or the record owner?**
>
> | If… | Then (b) is… |
> |---|---|
> | accountability for the commercial chain is a **separately-carried** fact | **comfortable.** Two axes, two instruments, one deferred. The gap is declared and bounded |
> | accountability for the commercial chain is the **record owner, by derivation** (the decomposition's `T3` route, and the cheapest answer) | **very close to incoherent.** The accountability instrument *is* the ownership instrument, so refusing to fix the ownership instrument refuses to make invariant 1 detectable, forever |
>
> **That question is `OD-1`-adjacent and belongs to the Owner** — see **DEPENDENCY RECONCILIATION
> Q2**. It is **MISSING INPUT** in this run.
>
> > **`[SUPERSEDED 2026-09-13 — MI-N IS CLOSED.]` It is no longer MISSING INPUT. The Owner ruled
> > SEPARATELY CARRIED. See `M-2`.**
>
> **So: (b) is NOT eliminated. It is eliminated as a DEFAULT.** Before `OD-1`, (b) could be reached
> by upholding a standing ruling and adding a documentation note. After `OD-1`, reaching (b) requires
> the Owner to state, in writing, that a binding invariant will remain undetectable on the person
> axis, and to accept that its detectability rests on an axis that does not exist and may not be
> built. **That is a decision the Owner may make. It is no longer one that can be arrived at by
> leaving things as they are.**

### B-2. Does invariant 10 change the calculus between (a) and (c)?

**Invariant 10:** do **not** implement one generic `ownerId`/`accountableId` shortcut across all
families.

| # | Step | Weight |
|---|---|---|
| 1 | **First reading — it disfavours (a).** A check in `typedOwner` is a **single, family-blind** rule: all four derivation entry points funnel to `isTypedOwner` (`typedOwner.ts:62-70`), which sees `{type, id}` and nothing about the family. A check placed there cannot vary per family | **Weak** |
| 2 | **The counter, and it is stronger: invariant 10 forbids a generic FIELD, not a generic RESOLVER.** Its wording is `ownerId`/`accountableId` — **identifiers**, i.e. storage. The banner reinforces it: the ruling *"does not license adding a field."* `typedOwner` is already the single generic resolution authority for **both** axes and already ships; making it read one more collection adds no field | **Decisive on the letter** |
| 3 | **But invariant 10 does add a constraint that applies to BOTH options:** whichever layer holds the check, it must be able to answer **per family**, because **invariant 9** exempts reference/master-data classes and **invariant 8** legitimises COMPANY-owned-plus-PERSON-accountable records. One rule for all 51 families is exactly what invariant 10's spirit refuses | **Real and new** |
| 4 | **And on that constraint, (c) is already per-family and (a) is not.** `censusFamily` takes an `OwnershipFamily` (`ownershipCensus.ts:177-181`) and dispatch at `:165-172` branches on `family.ownerType` and on the declared field name. `isTypedOwner` has no family in scope at all | **The actual shift** |
| 5 | **The counter-cost, which is new in this brief:** `typedOwner.ts:1-8` declares the module the *"trusted-side mirror"* of `field-ops-app-vite/src/domain/typedOwner.js`. Under **(a)** the mirror breaks loudly — parity is asserted by a shipped test against a shared case table, so the break is caught. Under **(c)** the mirror stays green while the **server census** and the **client resolver** answer *different questions about the same record*, and **nothing tests that divergence.** A silent divergence is worse than a caught one | **Real, and cuts against (c)** |

> **VERDICT: invariant 10 does NOT decide between (a) and (c), and it is not the reason to prefer
> either.** It shifts the balance toward **(c)** by a small, genuine margin — the first
> evidence-grounded argument for (c) in the record, since the packet noted no lane endorses it — and
> that margin is **offset, arguably more than offset, by the silent-mirror-divergence cost (c)
> carries and (a) does not.**
>
> **The difference between (a) and (c) remains an OWNER question, for exactly the reason the packet
> gave and `OD-1` does not touch: ruling O-1 was an Owner ruling about the DERIVATION specifically.**

### B-3. Does invariant 6 threaten or support a validity check in the derivation? BOTH — and it constrains the answer.

| Direction | Argument | Evidence |
|---|---|---|
| **It THREATENS (a), for owners that DID exist** | If the check reclassifies a TERMINATED or INACTIVE owner from `RESOLVED` to `UNRESOLVED`, it converts a **true historical fact** into a **backfill input**. `typedOwner.ts:128-130` names the mechanism for companies: *"calling it unresolved would invite a backfill to reassign it."* A reassignment that rewrites who owned what **is** a history rewrite, and invariant 6 forbids it | `typedOwner.ts:128-130`; decomposition `C-B3` reaches the same conclusion independently: TERMINATED → `RESOLVED` *"because `UNRESOLVED` is the input a backfill acts on"* |
| **It SUPPORTS (a), for auditability** | Invariant 6 requires history to remain **auditable**, and today **nothing can list a departed person's records at all** — `U-J` is *"THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE"*, and ORPHAN-13 records that even the honest remediation *"has no queue to work from."* **An unauditable history is not a preserved history; it is an unreadable one.** A derivation that **reports** the state while keeping the resolution `RESOLVED` makes history auditable for the first time and changes not one stored fact | `U-J`; ORPHAN-13; **F-3** (no channel exists) |
| **It says NOTHING against a resolution change for NON-EXISTENT** | Where the owner **never existed**, there is no history to preserve. Invariant 6 is silent, and the decomposition's `C-B3` puts NON-EXISTENT at `UNRESOLVED`/`UNKNOWN` — *"This is the clause that reverses O-1's 'structurally zero'"* | decomposition `C-B3` |

> **VERDICT: invariant 6 is not neutral between the FORMS of a YES. It constrains (a) and (c) alike,
> identically, from inside:**
>
> | Person state | What invariant 6 permits | What invariant 6 forbids |
> |---|---|---|
> | **NON-EXISTENT** (well-formed id, no such employee) | a **resolution** change | nothing — no history to preserve |
> | **DELETED** (existed, no longer does) | a **resolution** change, **if** the authority cannot distinguish it from never-existed | claiming a distinction the authority cannot make |
> | **TERMINATED** (exists, employment ended) | a **reported, non-resolution** distinction | a **resolution** change — it makes history a backfill input |
> | **INACTIVE** (exists, temporarily cannot act) | a **reported, non-resolution** distinction, **separate from TERMINATED** (opposite remediations) | a resolution change; and folding it into TERMINATED |
>
> **This is `G-4` — *whether EXISTENCE and STATUS are one refusal or two* — and `OD-1` has now partly
> answered it that the evidence alone could not: they must be TWO, and they must be two of DIFFERENT
> KINDS. Existence may move the resolution; status may only be reported.**

### B-4. CONFLICT NOW CREATED BY THE RULING — stated loudly, as the lane contract requires

> ## `OD-1`'s INVARIANT 6 CONTRADICTS THE ACCEPTANCE CONTRACT'S CASE 2, AND SIDES WITH THE DECOMPOSITION. BOTH PRIOR LANES ARE CITED.

| Source | Says, verbatim | On invariant 6 |
|---|---|---|
| **`PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` §4 case 2** (this branch, `e1d5c024`) | case 2 covers *"an employee that exists but is not `ACTIVE` (`INACTIVE`, on leave, `TERMINATED`)"*, and the resolver *"must return **NOT `RESOLVED`**… a bucket that contributes to `blocking` at `:231`, i.e. not `resolved`"* | **CONTRADICTED on the resolution value.** For TERMINATED and INACTIVE, invariant 6 requires the resolution to **stay `RESOLVED`**, because `UNRESOLVED` is what a backfill acts on |
| **`OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` §2.2 `C-B3`** (`own-enggap`, `7792c1ba`) | TERMINATED → *"**`RESOLVED`, and separately reported as not actionable**… the ownership fact is *true* — this record **is** owned by that person, and history does not change because employment ended"*; INACTIVE → *"same resolution as TERMINATED… different reason because the remediation is opposite"* | **RATIFIED.** Invariant 6 is the authority this lane reasoned its way to from the code's own argument |

**Three precisions that must travel with the conflict:**

| # | Precision |
|---|---|
| 1 | **The two prior lanes ALREADY contradicted each other.** This is not a contradiction `OD-1` introduced; it is one `OD-1` **adjudicates**. Neither lane cited the other on this point |
| 2 | **The contract's escape hatch does not reach it.** §4 case 2 allows *"if `OD-6` rules that status is advisory rather than blocking, then: a bucket that is **reported**"* — so the contract concedes on **blocking-ness** and **not** on the resolution value. **The contradiction is on `NOT RESOLVED`, not on `blocking`** |
| 3 | **The contract remains right about EXISTENCE.** For NON-EXISTENT and DELETED, `NOT RESOLVED` stands and invariant 6 is silent. **The contract is right for half of its own case 2 and wrong for the other half, and its own `G-4` is the field that says the halves may be ruled differently.** The conflict is therefore *inside* a gap the contract itself declared |

**Consequence for whoever eventually satisfies the contract, stated because it is load-bearing and
this lane may not edit the contract:** §4 case 2 must be read **split** — existence sub-cases keep the
contract's `NOT RESOLVED`; status sub-cases take the decomposition's `RESOLVED` + separately-reported
fact. **The acceptance contract is NOT modified by this brief** (it is off this lane's surface) and
**both readings stand on the record**.

### B-5. Why (d) is now self-defeating rather than merely bad

| # | Step |
|---|---|
| 1 | Be precise about what the banner does **not** say. It forbids *"ACCOUNTABLE PERSON storage, migration, enforcement, handoff or backfill"* — that is the **accountability** axis. The **ownership** census gate is a different gate. **The ruling does not literally prohibit (d)** |
| 2 | What the banner **does** say is that the prohibition lifts only *"until `OD-6` resolves person-reference validity and census behaviour and the remaining dependency decisions are reconciled"* |
| 3 | (d) is defined by the packet as *"the current trajectory if `OD-6` is not ruled"* — i.e. the option in which `OD-6` is **never** resolved |
| 4 | **Therefore (d) permanently withholds a named precondition of a decision the Owner has APPROVED.** Its cost is no longer only the live downside the packet named; it is that the `OD-1` programme cannot start |
| 5 | And (d) does not violate invariant 1 directly — it is not an accountability action — but it **forecloses the only route to verifying it** on the three families where it binds |

---

## RECOMMENDATION — labelled, attributed, and NOT a decision

> ### R-1. CARRIED UNCHANGED — EMP-ACCOUNTABILITY's, attributed
>
> **(a) YES**, and *"distinguish the states the company axis already does: `OWNERLESS` ≠ `UNKNOWN` ≠
> `INACTIVE` ≠ `RESOLVED`. It is a MEASUREMENT CHANGE, NOT A BACKFILL, and a PREREQUISITE to the gate
> rather than a follow-up."* **The synthesis's addition is part of it: it REVISITS ruling O-1, and
> that must be explicit.**
>
> **Carried with the two corrections the later lanes made to its wording, which stand:** `INACTIVE`
> is **not** a state the census can express and the company axis does **not** *"already do"* this
> (**F-4**, contract `C-B`); and *"parity with COMPANY"* is an **insufficient** bar because COMPANY
> has existence integrity only (contract §2.3, decomposition §2.1a, and now invariant 8).

> ### R-2. THIS LANE'S RECOMMENDATION ON THE SEQUENCING HALF — the part the evidence settles
>
> **The sequencing constraint is unchanged in content and UPGRADED in authority.** The packet's
> formulation holds verbatim and under all of (a), (b) and (c):
>
> > *"whatever is ruled, the gate must not be closed on the census's person-axis figures while those
> > figures are structurally incapable of being non-zero."*
>
> **What `OD-1` adds:** before the ruling this rested on `H9` and on `censusGate`'s own comment. It
> now **also** rests on invariant 1 for `opportunity`, `salesAgreement` and `salesOrder`, and on the
> `OD-1` banner naming `OD-6` a precondition. **This is the one part of `OD-6` the evidence settles
> on its own, and it is now the one part with an Owner authority behind it.**
> **THIS IS A RECOMMENDATION, NOT A DECISION.**

> ### R-3. THIS LANE'S RECOMMENDATION ON THE SHAPE OF A YES — new, and derived from invariant 6
>
> > **`[PARTLY WITHDRAWN 2026-09-13 — see `K-12` and `M-7`.]` The *"existence and status are two
> > questions"* half STANDS and is now on firmer authority (the `MI-N` ruling's own sub-questions ①/②).
> > The *"status may only be REPORTED"* half is **WITHDRAWN**: the ruling forbids the **rewrite**, not
> > the **value**, and lists the representation question as still-open sub-question ③. The text below is
> > preserved unaltered.**
>
> **If (a) or (c) is ruled, EXISTENCE and STATUS must be separated, and separated in KIND:**
> existence may move the **resolution**; status may only be **reported**. Full table at **B-3**.
> **Attribution:** the behaviour is the decomposition's `C-B3`, reasoned from `typedOwner.ts:128-130`;
> the **authority** is `OD-1` invariant 6, which no prior lane could cite. **It contradicts the
> acceptance contract's case 2 on the status half and both readings are carried (B-4).**
> **THIS IS A RECOMMENDATION, NOT A DECISION.**

> ### R-4. NO RECOMMENDATION BETWEEN (a) AND (c). The evidence does not support one.
>
> Stated as a finding, not a hedge:
>
> | For (a) | For (c) |
> |---|---|
> | One authority for the fact, no split | O-1 left intact — the option needs no ruling reversed |
> | The mirror break is **loud**: parity is asserted by a shipped test against a shared case table (`typedOwner.ts:1-8`) | Already **per-family** (`ownershipCensus.ts:165-172`, `:177-181`), which invariant 10's spirit and invariant 9's per-class exemption both want |
> | It is where every lane that studied the problem placed the fix | A cross-collection read is **already expected** at this layer |
> | — | **Cost: the mirror stays green while server and client answer different questions about one record, and nothing tests that** |
>
> **`OD-1` does not adjudicate this, and the reason is the one the packet gave: ruling O-1 was an
> Owner ruling about the DERIVATION specifically.** Invariant 10 moves the balance toward (c) by a
> small margin and the silent-divergence cost moves it back. **The run verdict records `None` for
> `OD-6`; on the (a)/(c) axis specifically, `None` remains the correct entry.**

> ### R-5. WHAT THIS LANE DOES NOT RECOMMEND
>
> | | |
> |---|---|
> | **Not (b)** — and **not** its elimination either | (b) is a viable Owner decision at a raised bar (**B-1**). This lane recommends only that **if** (b) is ruled, the written acknowledgement in `G-6` be **extended** to name invariant 1 |
> | **Not (d)** | Self-defeating (**B-5**) |
> | **No token, field, bucket name, collection, index or command** | Distinguishability is the requirement; the token is not |
> | **No departure policy** | `OD-11a`. Not entered |

---

## WHAT THE RECOMMENDATION ENABLES

| # | Enabled | By which part |
|---|---|---|
| **E-1** | **The census may be cited as the gate's evidence for person families** — or explicitly may not. Either is an advance on today, where it is cited and cannot bear the weight | R-2, under any ruling |
| **E-2** | **`T-1`…`T-7` become the pinned foundation of the acceptance test**, writable and reviewable before any code changes. **None of the seven is `OD-6`-gated** | R-2 |
| **E-3** | **Invariant 1 becomes falsifiable on the three families where it binds** (`opportunity`, `salesAgreement`, `salesOrder`), and transitively on `account` via the inheritance chain (`ownershipMatrix.ts:149`, `:158`, `:168`) | R-1 + R-3 |
| **E-4** | **`OD-7`'s test `H1`** — *a handoff target must be a live `ACTIVE` employee at the moment of assignment* — acquires a derivable fact to test. `buildOwnershipHandoff` *"is pure and performs none"* | R-1 |
| **E-5** | **`OD-11a` becomes implementable** rather than merely rulable: its recommended *"a non-`ACTIVE` employee may REMAIN an owner of record and may NOT BE CHOSEN as a new owner or accountable person"* requires exactly the check `OD-6` gates — **and R-3's existence/status split is what lets the two halves of that sentence be implemented independently** | R-3 |
| **E-6** | **The `ownershipBackfillRules.ts:70-78` propagation becomes visible** at the point it occurs, instead of being inferred from a corpus finding | R-1 |
| **E-7** | **The asymmetry between the axes becomes DECLARED rather than emergent** — today it is a fall-through at `typedOwner.ts:140-143` and an absent enum member. Invariant 8 makes declaring it a requirement | R-3 |

---

## WHAT REMAINS UNPROVEN

**Nothing in this brief was executed. Every behavioural claim below is UNPROVEN BY EXECUTION.**

| # | Blocker | Verified how | Status |
|---|---|---|---|
| **X-1** | **No JRE on this machine** — the Firestore emulator cannot start | `which java javac` returns nothing | Carried from the contract, unchanged |
| **X-2** | **Port 8080 held by an unrelated process** (`uvicorn`) | `ss -ltnp` | Carried, unchanged |
| **X-3** | **Even the emulator-free Node suite cannot run in THIS worktree.** `functions/node_modules` absent; `functions/lib` absent and untracked; `functions/test/*.mjs` import `../lib/ownership/*.js` | Contract `C-C` / `X-3` | **Carried. NOTE:** `functions/node_modules` is present in 43 of 107 worktrees, so `T-1`…`T-7` are executable **somewhere** — but `functions/lib` must be **built on the ref under test** and never borrowed. **Not attempted here: this lane's allowed surface is one document** |

| # | Claim this lane could not settle | What would settle it | Bears on |
|---|---|---|---|
| **U-J** | **How many records are person-owned by an employee who no longer exists** | Join owner ids against `employees`, per environment | *"THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE."* **Requires Owner authorization; not available to this run.** `OD-6` can be ruled without it; the **magnitude** cannot be known without it |
| **U-K** | **Whether `contacts.owner` / `locations.owner` exist in Firestore at all** | Read one `contacts` and one `locations` doc per environment | **Two of the six PERSON families may have no field for this contract to govern.** **This lane WIDENED it (F-6):** Rules name the field nowhere, no UI or callable writes it, and its only writer (`ownershipBackfillRules.ts:77`) refuses to overwrite. **But see `K-3`: `U-K` does NOT stand between `OD-6` and invariant 1** |
| **U-L** | **`[NEW]` Whether the shipped backfill has ever been applied to `contacts` / `locations` in any environment**, i.e. whether touch point 5 has produced any `owner` value at all | The applier's run record, per environment | `U-K`'s other half. `ALREADY_SET` at `:71` means the field's population is **entirely** a function of whether that applier ran — nothing else writes it |
| **U-M** | **`[NEW]` Whether `field-ops-app-vite/src/domain/typedOwner.js` can be made to answer the same question as a server-side check, or must be specified to render a server answer** | Read the client authority and its parity test | **The (a)/(c) tiebreak this lane could not settle.** It is the one cost difference between the options that is a **fact** rather than a judgement, and settling it might settle `R-4` |
| **U-1** | **Whether any real person-owner record is in state INACTIVE / TERMINATED / DELETED today** | The `U-J` read | §F-1's table is derived from **control flow**, so it holds regardless. **No claim is made here that any orphan exists in any environment** — a **capability** finding, not an **incidence** finding |
| **U-2** | **Whether the six PERSON families' baseline totals still hold** | Re-run the read-only census (and `OD-2` authorizes it) | The cited 100/103 · 337/339 · 180/183 · 14/14 · 5/5 · 17/17 are **2026-09-02 against a 2026-09-12 baseline.** `T-7`'s regression floor must be **re-measured, not cited** |
| **U-9** | Whether the `OD-8` write exposure behaves as read | The emulator, blocked by `X-1`/`X-2` | **F-6** confirms the Rules text exactly (`:1341-1345`, `:1555-1559`) by **static read**. The *behaviour* is unproven |

---

## MISSING INPUT — only the Owner's separate employee-design conversation can answer these

**That conversation is NOT AVAILABLE TO THIS RUN. Nothing below is reconstructed.**

| # | MISSING INPUT | Bears on |
|---|---|---|
| ~~**MI-N**~~ **— CLOSED 2026-09-13** | **`[CLOSED BY OWNER RULING 2026-09-13: SEPARATELY CARRIED.]` ACCOUNTABLE PERSON is a separately carried business fact, NOT permanently derived from RECORD OWNER; initial derivation from the current governed commercial record owner is permitted as INITIALIZATION only; the permanent computed identity is FORBIDDEN — *"the accountable-person fact must have its own lifecycle."* Recorded as `DECISIONS.md` #181 (not on this branch — `K-10`). Consequence for (b) is at **`M-2`**; the question as originally posed is preserved verbatim below.** ORIGINAL QUESTION, PRESERVED: **For `opportunity`, `salesAgreement` and `salesOrder`, is the accountable person a SEPARATELY-CARRIED fact, or the record owner?** `OD-1` rules the axes distinct; it does not say whether, on the commercial chain, the two are filled by one derived fact or two independent ones. The Owner's own worked example — *"Accountable Person: potentially same salesperson for relationship outcome"* — says the **same person** may fill both roles, which is **not** the same claim as the two roles being one fact | **B-1's verdict, decisively — NOW DISCHARGED.** PART I predicted: *Under "separately carried", option (b) is comfortable. Under "the owner, derived", (b) is close to incoherent.* **THE RULING WENT TO "SEPARATELY CARRIED" AND THE SHORTHAND WAS HALF WRONG (`K-11`): (b) is COHERENT, and MORE EXPENSIVE, not comfortable. See `M-2`** |
| **MI-C** | **What happens on each of the nine departure states.** *"The matrix is ENTIRELY `NO CHANGE` today, which is a description of the gap, not a statement of intent"* | **B-3 and contract case 2.** Whether TERMINATED and INACTIVE are one census case or two is a statement about departure the repository does not contain — invariant 6 says *report* both and does not say whether they are one row |
| **MI-J** | **Which employee fact is authoritative for *"this person can no longer act."*** `employmentStatus === "ACTIVE"` is what fails closed at `operationalRoleContext.ts:52`, `adminCredentialCommands.ts:183,223` and Rules' `isActiveOperationalRole` — **but that is an operational-capability authority, and whether it is also the OWNERSHIP-VALIDITY authority is an Owner question** | **B-3, `G-4`.** Assuming they are the same fact would be designing the check, which `OD-6` gates |
| **MI-K** | **Whether a DELETED employee document and a NON-EXISTENT one are one case or two.** Both census `RESOLVED` today, so the distinction has never had to exist | **B-3's existence half.** The decomposition's `C-B3` makes reporting the distinction conditional on the authority being *able* to — which is `U-10` there, unproven |
| **MI-A** | **The per-workflow accountable person by job role** | `P-8`. Until known, no proof may describe what it measures as *"accountability"* |
| **MI-G** | **Whether the three deliberately-ownerless R-7 control Accounts are the ONLY approved exception, or a precedent** | Contract case 3 and `T-7`. It bounds whether some `ownerless` records are **correct** — and `ownershipBackfillRules.ts:76` shows the applier already treats them as an exception in code |

---

## WHAT IT BLOCKS

| Blocked item | Why | Changed by `OD-1`? |
|---|---|---|
| **The enforcement gate, either way** | Ruling YES makes the check a prerequisite; ruling NO makes the census non-evidence for the person axis. **Both answers change what may close the gate; leaving it unruled is the only outcome that permits closing it on a blind number** | **No** |
| **The whole `OD-1` programme** | The ruling's banner names `OD-6` a precondition of all ACCOUNTABLE PERSON storage, migration, enforcement, handoff and backfill | **YES — NEW, and it is the largest change to this field** |
| **`OD-7` test `H1`** | *"A handoff target must be a live, `ACTIVE` employee at the moment of assignment."* The fact `H1` tests is what `OD-6` decides exists | No |
| **`OD-11a`'s IMPLEMENTATION** (not its ruling) | Its recommended *"may NOT BE CHOSEN as a new owner or accountable person"* needs the check `OD-6` gates | **Sharpened** — `OD-11a` is now rulable (its `OD-1` gate lifted) and still not implementable |
| **Acceptance-contract `G-1`…`G-7`** | Seven satisfaction conditions that cannot be specified until `OD-6` rules | **`G-4` PARTLY ANSWERED by invariant 6** (B-3). `G-1`, `G-2`, `G-3`, `G-5`, `G-6`, `G-7` untouched |
| **`U-J`** | *"THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE."* Requires Owner authorization | No |
| **Any claim that person ownership resolves** | The census proves only that a **non-empty string** is present | No |

---

## WHAT THIS DECISION DOES NOT DECIDE

| # | Not decided by `OD-6` | Whose row it is |
|---|---|---|
| 1 | **What an INACTIVE or TERMINATED person owner MEANS for the record** — what is released, what is retained | **`OD-11a`** |
| 2 | **Whether the accountability axis is stored, derived, or per-family shaped** | **`OD-1`'s implementation reconciliation.** `OD-6` decides person-reference **validity and census behaviour**, nothing about accountability storage. Invariant 10 already forbids the generic shortcut |
| 3 | **Which employee fact means *"cannot act"*** | **MI-J** — Owner |
| 4 | **Whether company ownership is user-visible or an internal scoping key** | **`OD-10`**, which *"MUST BE ANSWERED BEFORE THE CENSUS GATE"* in its own right |
| 5 | **Whether the ownership-write exposure is accepted or Rules are narrowed** | **`OD-8`** |
| 6 | **Whether a handoff requires acceptance** | **`OD-11`** |
| 7 | **Whether REFERENCE data has a steward, and at what granularity** | **`OD-11b`**. Invariant 9 settles its **premise** and not its **granularity** |
| 8 | **Which manager authority is canonical** | **`OD-6b`** |
| 9 | **Which vocabulary is the authoritative JOB ROLE** | **`OD-3`** |
| 10 | **The canonical owner id namespace** — `employeeId` or Firebase `uid`. `typedOwner.ts:4-5` records it as open item `O-1` | **`OD-4`.** The decomposition's `C-B2` makes it a **precondition** of any check: *"if the stored owner id's namespace cannot be shown to be the authority's key namespace, the outcome must be a distinct 'cannot ask' outcome — never a lookup miss"* |
| 11 | **That the census is now sound.** The person axis is not its only mis-measurement — `O-7` (five financial families with `ownerFields: []` at `ownershipMatrix.ts:189`) and the `O-1` matrix row are defects on the axis that **does** have integrity | Contract `C-I`. A proof satisfying `OD-6` may be reported only as *"the person axis is no longer blind"* |
| 12 | **Whether any orphan exists anywhere.** `OD-6` is a **capability** decision | `U-J`, `U-1` |

---

## DEPENDENCY RECONCILIATION

**Presenting no decision below. Each row states only its relation to `OD-1`'s ruling and to `OD-6`.**

| Row | Unblocked by `OD-1`? | Still blocks `OD-6`? | Would `OD-6` unblock it? | New constraint `OD-1` imposes on it |
|---|---|---|---|---|
| **`OD-7`** — where family-level handoff validation must live | **PARTLY.** The `OD-1 → OD-7` direct link is settled in principle: accountability and ownership are distinct axes, so `OWNERSHIP_HANDOFF` names **ownership** and cannot be made to carry accountability by wiring | **No** | **YES** — test `H1` needs the fact `OD-6` decides exists | The `OD-7 → OD-1` risk named in the packet is now realised in the other direction: **the handoff vocabulary must not acquire an accountability meaning by being wired.** `OD-7` stays **last** in the chain |
| **`OD-3`** — the authoritative JOB ROLE | **GATE LIFTED** (`OD-1`'s banner lists `OD-3` under GATES). Still unruled on its own merits, and **`OD-3b` is MISSING INPUT** | **No** | **No** | None new. **Orthogonal to `OD-6`**, and `OD-1`'s §1.5 precondition stands: *"occupancy and vocabulary are INDEPENDENT prerequisites; the grant closes only half the gap"* |
| **`OD-10`** — is company ownership user-visible or an internal scoping key? | **No** | **NO — but it is a PARALLEL blocker of the same gate.** Its own text: *"IT MUST BE ANSWERED BEFORE THE CENSUS GATE, because a fact nobody can see cannot be verified by the people accountable for it"* | **Direction NOT established — both readings stand.** The packet lists `OD-10` under *"`OD-6` — WHAT IT BLOCKS"* on the strength of a **provenance** link (the synthesis folds EMP-INFORMATION `OD-EMP-004` across both). **A shared provenance is not a dependency direction.** The defensible statement is that **both** block the gate, in parallel | **Invariant 8 CONSTRAINS it without ruling it:** a record may legitimately be COMPANY-owned **and** require a PERSON accountable. That is an argument against *"internal scoping key only"*, because the ruling treats company ownership as a **business** fact standing beside a person, not as a hidden scoping mechanism |
| **`OD-11`** — does a handoff require ACCEPTANCE? | **GATE LIFTED**, still MISSING INPUT | **No** | **No** | **NEW and substantive. Invariant 7** (*handoff semantics must guarantee no responsibility gap*) **forbids the gap `OD-11`'s evidence measures:** *"Between Dispatch and Accept, NOBODY IS NAMED."* Invariant 7 does **not** rule that acceptance is the mechanism — overlap, or a named interim holder, would also close the gap. **The gap is now forbidden; the closure mechanism is still the Owner's** |
| **`OD-11a`** — on departure, what is RELEASED and what is RETAINED? | **YES, as a decision** — gate lifted, **and strongly constrained toward its own recommended (a)**: invariant 6 forbids rewriting history (⇒ **retain** record ownership); invariant 1 forbids leaving actionable work with nobody (⇒ **release** accountability and name a successor). `OD-11a`'s recommendation already said exactly this, so `OD-1` **ratifies** rather than moves it | **NO — and keeping this direction straight is why `OD-PACKET-001-006-007.md` §0 exists** | **Its IMPLEMENTATION, yes.** *"may NOT BE CHOSEN as a new owner or accountable person"* is exactly the refusal `OD-6` decides is derivable | **`OD-6` and `OD-11a` are now MORE separable, not less.** R-3's existence/status split is the seam: invariant 6 makes *retain the historical fact* a **measurement** rule (`OD-6`) and *release accountability* a **policy** rule (`OD-11a`), so neither needs to smuggle the other. **The contract's `G-7` warning stands: a release policy must not arrive as a census bucket** |
| **`OD-11b`** — does REFERENCE / master data have a named steward, at what granularity? | **PREMISE SETTLED BY INVARIANT 9**, which states the narrowing `OD-11b`'s own evidence said *"should be explicit if chosen"*: reference objects do **not** automatically require an accountable person. **The granularity question — per-domain vs per-record — is untouched and remains `OD-11b`'s** | **No** | **No** | **Acceptance-contract case 5 and `P-6` are the guard**, now doubly load-bearing: they keep an eventual `OD-11b` steward out of the census population. **`P-6` must not be relaxed when `OD-11b` rules**, and invariant 9 is the authority for that |
| **`OD-6b`** — which manager authority is canonical? | **GATE LIFTED** (banner lists it). Still unruled; its own caveat stands — populating `managerEmployeeId` is *"A PREREQUISITE, NOT A NICETY"* | **No** | **No** | **NEW. Invariant 4** (*manager involvement does not automatically change accountability*) constrains the answer's **use**: whichever authority is canonical, it is an escalation-and-visibility authority and **not** an accountability-transfer mechanism. That cuts against any implementation in which a manager inherits accountability by hierarchy — the shape `roleHierarchy.ts:9-20` warns about (*"EVERY salesManager sees EVERY salesperson"*) |
| **`OD-8`** — accept the ownership-write exposure, or narrow Rules now? | **No** | **No** | **No — but there is a REVERSE dependency the packet does not record. `[NEW]`** | **Two, and both are substantive.** (i) **Invariant 6 gives `OD-8` an authority it did not have:** an unaudited rewrite of the person owner **destroys** the audit trail invariant 6 requires, and **F-6** confirms the write is unguarded (`firestore.rules:1341-1345`, `:1555-1559` — `allow create, update: if isAdminOrDispatcher();`, no `hasOnly`, no field validation) and unaudited. (ii) **`OD-6`'s VALUE is partly contingent on `OD-8`:** under (a) or (c), a validity check that a generic client write can bypass yields a census that **reports clean while the field is rewritten out of band**. **A measurement any `admin` can invalidate between measurements is a weaker control than its arithmetic suggests** — and production's only principal holds exactly `admin@global` |

### THE COORDINATOR'S THREE QUESTIONS — answered

**Context.** `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` §1.3 excludes `opportunity`,
`salesAgreement`, `salesOrder` from **Area A** (the accountability axis), flagging it as *"the
boundary's sharpest edge."* Its argument has two separable components. **Be fair to it: the ruling
displaces one and leaves the other standing.**

| Component | Verbatim | Verdict under `OD-1` |
|---|---|---|
| **(i) the `T3` MECHANISM** | *"If a person-valued owner already exists, the invariant is satisfiable by making that owner resolvable and able to act (Area B) rather than by adding a third axis."* And: *"These three are actionable and already have a named person. The invariant fails for them only because that person may not exist or may not be able to act — which is Area B, not a new axis."* | **STANDS, and is arguably STRENGTHENED.** `OD-1` explicitly does not authorize implementation and its banner states the ruling *"does not license adding a field"*; invariant 10 forbids the generic shortcut. So the route to invariant 1 for these three **without** new storage is exactly owner validity — **Area B, which is `OD-6`'s subject** |
| **(ii) the JUSTIFICATION for the exclusion** | *"adding an accountability axis would create a **second** person-valued field beside one that already claims the same meaning… Two person facts of the **same kind** is exactly the ambiguity `combineOwnerDerivations` (`typedOwner.ts:151-159`) exists to refuse."* | **DISPLACED.** `OD-1` rules ACCOUNTABLE PERSON **distinct** from RECORD OWNER, so they are facts of **different kinds**. The premise *"the same kind"* is no longer available. The Owner's own Account example — *"Accountable Person: potentially same salesperson for relationship outcome"* — is **one person in two distinct roles**, not two roles in one field |
| **A second, independent weakness in (ii), found by this lane — it does not depend on the ruling** | — | **The `combineOwnerDerivations` citation could never support the weight placed on it.** `typedOwner.ts:151-159`, re-read at baseline: it refuses two **ownership** derivations that RESOLVE to **different owners**, and its inputs are exactly `family.ownerFields` (`ownershipCensus.ts:165-172`). An accountability fact would not be an `ownerField` and would **never be an input to it** — the shipped precedent is `companyScopeField`, which is a second fact on the same record, is **not** in `ownerFields`, and `combineOwnerDerivations` never sees it (`ownershipMatrix.ts:82-94`). `[OBSERVED AT: 64008d5a]` |

**Q1 — Does `OD-1` move those three families INTO Area A, leave them in Area B, or leave it open?**

> **For `OD-6`'s purposes: they stay in AREA B, and that is the operative answer.** Their route to
> invariant 1 runs through owner validity, which is `OD-6`.
>
> **For Area A's purposes: GENUINELY OPEN — the outcome stands, the reason given for it does not.**
> The exclusion is sustained by (i) and no longer by (ii). **An exclusion that has lost its argument
> is an open question wearing a closed answer**, and it should be re-argued on (i) alone rather than
> assumed settled. **That re-argument is Area A's and this brief does not enter it** — it is named
> here and left there.

**Q2 — If the accountable person for them is the owner BY DERIVATION rather than by a stored field,
does that satisfy `OD-1` while respecting invariant 10?**

> **YES on invariant 10, with three conditions — and derivation-vs-storage may indeed be the whole
> answer for these three. It is cheaper than either alternative.**
>
> | # | Why it respects invariant 10 |
> |---|---|
> | 1 | Invariant 10 forbids a generic `ownerId`/`accountableId` **across all families**. A derivation is **not a field**, adds no storage, and can be per-family. The banner separates the ruling from field-adding in the same breath |
> | 2 | **The shipped pattern is already derivation-shaped and is arguably what invariant 10 endorses by forbidding its opposite.** `ownershipMatrix` declares **where ownership is stored, per family** (`accountOwner` map · `ownerEmployeeId` · a stored `owner` map) and `typedOwner`'s entry points **derive** a common vocabulary from that heterogeneous storage. That is *"no generic field, per-family derivation to one vocabulary"*, precisely |
> | 3 | Invariants **2** and **5** are satisfied vacuously for these three: no execution field and no escalation mechanism exists on them to leak across |
>
> | # | The three conditions — and the second is the important one |
> |---|---|
> | 1 | **Derivation makes the two facts operationally identical, and invariant 3 forbids that the moment they must diverge.** `accountable := owner` is an **identity**, and under it *"changing accountability does not automatically change record ownership"* is **inexpressible** — there is nothing to change independently. `OD-1` says the same person **may fill** both roles; it does not say the axes are one function. **So derivation is a defensible INTERIM answer and an indefensible PERMANENT one, and which it is, is an Owner statement about the commercial chain** — **MI-N** `[CLOSED 2026-09-13: the Owner ruled exactly this — derivation is permitted as INITIALIZATION and the PERMANENT computed identity is FORBIDDEN. PART I's condition 1 is RATIFIED. See `M-1`, `M-2`]` |
> | 2 | **Under derivation, invariant 1's detectability for these three collapses ENTIRELY onto `OD-6`.** If accountable **is** the owner and the owner is a string nobody checks, invariant 1 is unfalsifiable for three of the six PERSON families by construction. **This is the single strongest argument against option (b) in the whole brief — and it is CREATED by the derivation answer, not by the ruling** |
> | 3 | It says nothing about `account`, `contact`, `location` (which fail `T2`) and nothing about Area A's 6-family minimum set, **none of which carries any person-valued field at all** — `workOrder.ownerFields: []`, and `transferOrder`'s ownership shape **is** two participants (`ownershipMatrix.ts:447-450` — `ownerClass: "PARTICIPATING_COMPANIES"`, `ownerFields: []`, `participatingFields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"]`), so *"no owner field can ever be made to carry an accountable person here, in any modelling"* |
>
> **Net: derivation is a cheap, invariant-10-respecting answer for exactly these three families, and
> it is the answer that makes `OD-6` LOAD-BEARING rather than optional.** Whether it is permitted is
> **MI-N**.
>
> > **`[MI-N` CLOSED 2026-09-13.]` Permitted as INITIALIZATION ONLY; forbidden as a permanent
> > identity.** So PART I's Q2 **condition 1 is ratified** and PART I's **condition 2 — *"under
> > derivation, invariant 1's detectability collapses ENTIRELY onto `OD-6`"*, which PART I called *"the
> > single strongest argument against option (b) in the whole brief"* — IS RETIRED**: there is no
> > construction in which the accountability instrument and the ownership instrument are the same
> > instrument. **That is why (b) is no longer near-incoherent, and it is also why (b) is now dearer:
> > the derivation branch the Owner authorized makes the UNVALIDATED owner reference the SEED of the
> > accountability fact. `M-2`.**

**Q3 — Does any of this change what `OD-6` must RESOLVE, or only what `OD-6` UNBLOCKS?**

> ### `[INCOMPLETE — see `K-13` and `M-3`.]`
> **PART I found ONE exception. After `MI-N` there are TWO, and the second is larger:** the ruling
> requires `OD-6` to resolve **WHICH PERSON REFERENCES its ruling binds** — the record owner's, the
> accountable person's, or both — and **the packet's wording cannot express the answer**, because it
> names *"person-owner derivation"* and nothing else. **The four option letters no longer partition the
> space as worded; a scope rider is now mandatory on each. `M-3`. The text below is preserved unaltered.**

> **Overwhelmingly what `OD-6` UNBLOCKS. One exception changes what it must resolve. Stated plainly:**
>
> | | |
> |---|---|
> | **What does NOT change — the QUESTION** | The packet's wording stands verbatim. All four options stand, none is added, none is redefined |
> | **What does NOT change — the OPTION SET** | (a), (b), (c), (d) are the same four decisions with the same meanings |
> | **THE ONE EXCEPTION — what `OD-6` must RESOLVE** | **Invariant 6 narrows the answer space INSIDE (a) and (c) alike**, and it partly answers `G-4`: **existence may move the resolution; status may only be reported** (B-3). `OD-6` must now resolve `G-4` in a direction that does not convert a true historical fact into a backfill input. **That is a narrowing of the answer, not a change of question — and it is where `OD-1` contradicts the acceptance contract (B-4)** |
> | **What `OD-6` UNBLOCKS — changed a great deal** | If the commercial chain's accountability is Area B / derivation, `OD-6` stops being *"can the census report an orphan"* and becomes **the sole mechanism by which invariant 1 is verifiable for three of the six PERSON families.** `OD-6`'s **stakes** rise sharply; its **question** does not |
> | **And one consequence for the sequencing half** | Under the derivation reading, *"the gate must not be closed on the census's person-axis figures while those figures are structurally incapable of being non-zero"* is no longer only a measurement-hygiene rule. **It becomes the condition under which invariant 1 can be said to hold at all** |

---

## CORRECTIONS TO THE CONTROLLING BRIEF — offered because it is in scope and expected

| # | The brief said | Finding at `64008d5a` | Severity |
|---|---|---|---|
| **K-1** | *"`isTypedOwner` applies `/^[a-z][a-z0-9_-]{1,62}$/` to a COMPANY id (`:68`) but only `nonEmptyString` to a USER id (`:67`)"* | **CORRECT, line for line.** `typedOwner.ts:67` → `nonEmptyString(v.id)`; `:68` → `isOperatingCompanyIdShape(v.id)`. One inherited citation drifts: the acceptance contract places the regex at `operatingCompanyAuthority.ts:71`; **it is at `:69`**, in the body of the function declared at `:68` (`:71` is blank). **The finding is untouched** | **LOW** — citation hygiene |
| **K-2** | *"FOUR person-axis entry points, not two"* | **CORRECT for DERIVATION, and incomplete for the axis. There is a FIFTH touch point, and it WRITES.** `personFromAccount` (`ownershipBackfillRules.ts:70-78`) is the **only** writer of `contacts.owner`/`locations.owner` in `functions/src`; its context map is built by non-emptiness alone (`ownershipBackfillSimulation.js:81-84`, `ownershipSandboxBackfill.js:88-91`); `:71` **never overwrites** an existing `owner` (module header `:21`, *"requirement 10"*); and `:74-77` **propagates an unvalidated parent-Account owner onto every child.** Two consequences: **(5a)** a newly-visible invalid person owner on those families has **no repair path in the shipped backfill**, and **(5b)** *"departure SEEDS NEW ORPHANS INDEFINITELY"* now has a `file:line` instead of only a corpus citation | **MEDIUM** — it changes what a fix must cover, and it strengthens the *"measurement change, not a backfill"* framing from an unexpected direction |
| **K-3** | *"`U-K`, the HIGHEST-CONSEQUENCE unknown: whether `contacts.owner`/`locations.owner` exist in Firestore at all — two of the six PERSON families may have no field for this contract to govern"* | **CORRECT as a fact and MISSCOPED as a consequence.** By the decomposition's own measured `T2`, `contact` and `location` **fail `T2`** — *"master records, no lifecycle"* — so **invariant 1 does not reach them.** The three families invariant 1 **does** reach are the `ownerEmployeeId` families, measured **14/14 · 5/5 · 17/17** shape-valid, where the field demonstrably exists. **So `U-K` does NOT stand between `OD-6` and invariant 1.** It is the highest-consequence unknown for the **acceptance contract's case-2 coverage** — a narrower and more useful claim. **And this lane WIDENED the underlying uncertainty (F-6):** Rules name the field **nowhere** (`firestore.rules:1341-1345`, `:1555-1559`), no UI or callable writes it, and its sole writer refuses to overwrite | **HIGH for decision framing** — it materially de-risks a YES ruling, and it is the correction most likely to change how the Owner reads the risk |
| **K-4** | *"the company axis checks existence only, not active status, and `commercialCompanyScope.ts:64-67` deliberately accepts INACTIVE with a stated historical-integrity reason"* | **CORRECT, and the acceptance is in FOUR independent places, not one.** `commercialCompanyScope.ts:63-68` (the `if` is at `:63`, so the range is `:63-68`, not `:64-67`); `typedOwner.ts:137-143` (fall-through); `operatingCompanyAuthority.ts:80` (computed then dropped one layer up); **and a fourth not previously stated — `typedOwner.ts:206`, whose governance re-check tests `resolveOperatingCompany(value.id).company === null`, which an INACTIVE company PASSES.** The direction of the brief's point is confirmed and its base widens | **LOW** for the citation; **MEDIUM** for the fourth site, which shows the acceptance is systemic rather than local |
| **K-5** | *"The blindness is total, not merely non-blocking"* | **CONFIRMED exactly** — `:231` omits `resolved`; `:190` `if (key === "resolved") continue;`; `:184` has four `samples` keys and no `resolved`. **One addition the brief's phrasing understates in the other direction:** because `reasons` and `samples` are both silent, a fix adding only a blocking bucket would give the gate a **number** and give an operator **nothing to act on** — no reason string and no sample id. **The remediation gap is wider than the detection gap** | **LOW** — strengthens the brief |
| **K-6** | *"`INACTIVE` is not a census-side state at all"* | **CONFIRMED, enum by enum** (**F-4**). And a consequence worth stating: **the asymmetry between the axes is EMERGENT, not declared** — a fall-through at `typedOwner.ts:140-143` plus an absent enum member. **Invariant 8 makes declaring it a requirement**, which turns a code observation into a `OD-6` obligation | **LOW** for the fact; **MEDIUM** for the invariant-8 consequence |
| **K-7** | *"`record-ownership.md` §2 requires the active check and ruling O-1 points the other way; the specification is Draft and not marked superseded. Both readings stay on the record"* | **CORRECT, and carried unresolved (F-5).** One addition: **`OD-1` does NOT adjudicate between them** — the ruling is silent on cross-collection lookups. What it changes is the **cost** of leaving them unadjudicated, because one of the two is now load-bearing for a binding invariant | **LOW** |
| **K-8** | *(not in the brief — this lane's own finding about the RULING's record)* | **`OD-1`'s banner cites `DECISIONS.md` #180 as canonical for the full ruling** — *"the full ruling… is recorded in `../../DECISIONS.md` #180, which is canonical for it."* **That entry does not exist.** `docs/DECISIONS.md` ends at **#179** in `emp-synth`, `census-acc`, `own-decision` and `own-enggap`, and a `git grep` for `^## #180` across 50 branches returns nothing. **So the ten invariants — which this brief reasons from throughout — have no canonical repository record; the banner is a dangling citation and the lane contract's statement of them is currently the only text.** **Outside this lane's allowed surface; reported, not acted on** | **MEDIUM** — every invariant-derived conclusion in this brief inherits it. Reported so no reader assumes the ruling is written down where the banner says it is |
| **K-9** | *(not in the brief — a citation drift in the DECOMPOSITION, found while re-verifying)* | **`ownableFamilies()` is at `ownershipMatrix.ts:550-554`**, exactly as the acceptance contract states. `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` §1.1 cites it as **`:574-578`**, which lands in `familiesWithoutBackfillSource()` (`:576-577`). **Both documents describe the same three admitted classes correctly** — `PERSON \| COMPANY \| PARTICIPATING_COMPANIES` at `:552` — so the `T1` clause and acceptance-contract case 5 / `P-6` are unaffected. **Reported, not acted on: the decomposition is off this lane's surface** | **LOW** — citation hygiene |

---

## WHAT THIS DOCUMENT DID NOT DO — PART I's STATEMENT, PRESERVED

> **This was PART I's closing statement, written before the `MI-N` ruling. It is preserved unaltered.
> PART II's own closing statement — which covers both parts — is at `M-11`.**

- **`OD-6` is NOT answered.** A recommendation is given, labelled, attributed and evidence-grounded, and it is **not a decision.** On the (a)/(c) axis the recommendation is explicitly **None**.
- **No implementation. No schema. No field, collection, index, command, bucket name or code token proposed. No generic `ownerId`/`accountableId`.** Distinguishability is specified where a distinction is required; the token is not.
- **No collapse.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER stay three facts throughout (`P-8`).
- **`OD-11a` not entered.** Where a question turned out to be departure policy, it is named and left there.
- **Area A not entered.** The decomposition's `T3` exclusion is discussed **only** in the dependency reconciliation, at the coordinator's direction, and its re-argument is left to Area A.
- **No conflict resolved to tidy the brief.** `F-5` (`record-ownership.md` §2 vs ruling O-1) is carried with both readings. **`B-4` is carried with both readings and stated loudly**, including that `OD-1` contradicts the acceptance contract on this branch.
- **The acceptance contract was NOT modified.** It was read; nothing was extended or rewritten. Where invariant 6 contradicts its case 2, the contradiction is recorded **here**.
- **The original decision packet on `ext/own-decision-packet` was NOT modified.** It was read at `ce66f9b1`.
- **Nothing executed.** No production contact, no deploys, no data mutation, no Firestore read or write, no emulator, no secrets requested or exposed. **Every behavioural claim in this document is UNPROVEN BY EXECUTION and labelled.**
- **Nothing written outside this file. Not pushed. No PR.**

---

# PART II — POST-`MI-N`. THE FINAL BRIEF.

**OBSERVED AT: 64008d5a** for every code claim in this part, re-read in this worktree at this
baseline by this lane from `git show 64008d5a:<path>`, each with a `file:line`. **Nothing was
executed.** Every behavioural claim is **UNPROVEN BY EXECUTION** and labelled.

> ### THIS PART STILL ANSWERS NO OWNER QUESTION.
> `OD-6` is **not** answered. A **RECOMMENDATION** is revised below, labelled, attributed and
> evidence-grounded. **No schema. No backfill. No migration. No handoff activation. No
> implementation. No field, collection, index, command, bucket name or code token proposed for the
> accountable person.** Where shipped identifiers are cited (`ownerEmployeeId`, `creditedSalespersonId`,
> `responsibleEmployeeId`, `resolveCreationOwner`, `resolveCreditedSalesperson`) they are cited **as
> existing evidence and precedent**, never as a proposal for what an accountable-person fact should be
> called or shaped like. **Naming is design and `OD-6` gates it.**

---

## `M-1`. THE RULING, RECORDED — and what it is authority for

| Field | Content |
|---|---|
| **Ruling** | **`MI-N` CLOSED, 2026-09-13.** For `opportunity`, `salesAgreement` and `salesOrder`: **ACCOUNTABLE PERSON IS A SEPARATELY CARRIED BUSINESS FACT. It is NOT permanently derived from RECORD OWNER.** |
| **Creation rule, canonical** | **EXPLICIT VALID ACCOUNTABLE PERSON → GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER → REFUSE.** Initialization / defaulting, **not** permanent equivalence |
| **Explicitly forbidden** | `accountablePerson = ownerEmployeeId` as a **permanent computed identity**. *"The accountable-person fact must have its own lifecycle."* |
| **Transfer** | Changing RECORD OWNER does not silently change ACCOUNTABLE PERSON, and the converse. Both together is **one explicit governed operation recording both changes**. *"HISTORICAL REMAINS HISTORICAL. FUTURE WORK FOLLOWS CURRENT GOVERNED AUTHORITY."* |
| **Continuity** | For every open/actionable commercial record ACCOUNTABLE PERSON must remain **identifiable throughout the lifecycle**. **A handoff must not create a NONE state.** Task assignment does not transfer accountability; manager involvement does not transfer accountability |
| **THE `OD-6` CONSEQUENCE, verbatim** | *"`OD-6` must evaluate person-reference validity for the accountable person **INDEPENDENTLY** from record-owner validity. **Do not use the record owner's validity as a substitute for validating the accountable person.**"* |
| **Four sub-questions `OD-6` may now distinguish** | ① does the referenced Employee **exist**? ② is that Employee **valid for current accountability**? ③ how should **INACTIVE / TERMINATED historical** references be represented? ④ what must the census/enforcement gate consider **resolved vs actionable**? |
| **Also ruled** | *"Preserve historical accountability even when the referenced employee later becomes inactive or terminated. **Do not automatically backfill/rewrite** historical accountability merely because the person is no longer actionable."* |
| **Implementation status** | **NO schema, NO backfill, NO handoff activation, NO migration** |
| **Record** | Being recorded as `docs/DECISIONS.md` **#181** by the controller in parallel. **Cited by name and ref only** — see **`K-10`**: neither #180 nor #181 exists on this branch |

**What the ruling is NOT authority for, stated so PART II does not over-read it:** it is silent on
cross-collection lookups (so **`F-5`** stays unresolved and ruling **O-1** stands); silent on whether
the check belongs in the derivation or the census layer (so **`R-4`**'s `None` is untouched); silent
on which employee fact means *"cannot act"* (**MI-J**); and silent on the **representation** of a
historical non-actionable reference, which it expressly lists as still-open sub-question **③**.

---

## `M-2`. OPTION (b) — SETTLED. And the shorthand was half right, in a way that matters.

> ### `[CORRECTION TO PART I — LOUD]` PART I's `MI-N` row says *"Under 'separately carried', option (b) is comfortable."* **That shorthand is wrong as stated.** Separately carried makes (b) **COHERENT**. It does **not** make it **comfortable** — it raises (b)'s price. The two are different claims and PART I compressed them into one word.

### `M-2.1` What separately-carried actually does to (b) — the argument, both directions

**The reason PART I's shorthand pointed the way it did, and it is a real effect:**

| # | Step | Verdict |
|---|---|---|
| 1 | PART I's strongest argument against (b) was **Q2 condition 2**: *"under derivation, invariant 1's detectability for these three collapses ENTIRELY onto `OD-6`"* — if accountable **is** the owner, and the owner is a string nobody checks, invariant 1 is unfalsifiable for three of six PERSON families **by construction** | **This argument is now DEAD.** The Owner forbade the permanent identity outright. There is no construction in which the accountability instrument and the ownership instrument are the same instrument |
| 2 | With the identity forbidden, the accountable person has *"its own lifecycle"* and therefore, in principle, its own instrument. **An `OD-6` that declines to validate the record owner no longer forecloses invariant 1 forever** — it defers it to an instrument that does not yet exist and whose design `OD-1` deliberately did not authorize | **So (b) is not incoherent.** PART I's *"very close to incoherent"* branch is **retired by the ruling**, and retired in (b)'s favour |
| 3 | And invariants 2 and 3 are now expressible rather than inexpressible: *"changing accountability does not automatically change record ownership"* has two facts to hold apart. **PART I's Q2 condition 1 is answered — derivation-as-identity is not permitted at all, interim or otherwise** | **(b) loses its incoherence risk** |

**The effect that cuts the other way, and it is larger. Three sub-effects, each with evidence.**

| # | Step | Evidence |
|---|---|---|
| **1. THE UNVALIDATED OWNER IS NOW A LOAD-BEARING INPUT TO ACCOUNTABILITY, NOT A PARALLEL FACT** | The canonical creation rule's **middle branch** is *"GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER."* Under (b) the record-owner reference is never validated — so **the branch the Owner authorized as the default seeds accountability from a reference that may name nobody.** Before the ruling the two axes were merely parallel and a gap in one did not feed the other; the creation rule **wires** them. The Owner's *"FUTURE WORK FOLLOWS CURRENT GOVERNED AUTHORITY"* makes this recur at every downstream creation, not once | `typedOwner.ts:67` — a USER owner's entire floor is `nonEmptyString(v.id)`. `creationOwnerResolution.ts:67-73` — the shipped derivation branch inherits only a `RESOLVED`, `USER`-typed upstream owner, and for a USER `RESOLVED` **is** `nonEmpty`. So the shipped governed-derivation gate is satisfied by **any non-empty string**. `[OBSERVED AT: 64008d5a]` |
| **2. (b) SATISFIES THE OWNER'S PROHIBITION ONLY VACUOUSLY** | *"Do not use the record owner's validity as a substitute for validating the accountable person."* Under (b), `OD-6` validates **neither**, so it never substitutes — the prohibition is met **by validating nothing.** The prohibition's *purpose* — that the accountable person's validity be evaluated **independently** — cannot be met by an `OD-6` that creates no validity evaluation at all. **(b) therefore becomes a decision to defer TWO validity questions, having been asked to separate them** | The ruling's own `OD-6` consequence clause, and **`M-4`**: no accountable-person reference exists at baseline, so there is nothing for a future instrument to have been tested against |
| **3. CONTINUITY IS A STRICTLY STRONGER CLAIM THAN INVARIANT 1, AND (b) CANNOT SUPPORT IT EITHER** | Invariant 1 is a **point-in-time** claim (*exactly one accountable person at every point in time*). The ruling adds a **lifecycle** claim: ACCOUNTABLE PERSON *"must remain identifiable throughout the lifecycle"* and *"a handoff must not create a NONE state."* **"Identifiable" is a capability claim about EOS** — the same step `B-1` used — and it now quantifies over a record's whole life, not over an instant. Under (b) nothing in EOS can establish that any person reference identifies a person at **any** instant, so it cannot establish it **throughout** | **`F-3`**: `ownershipCensus.ts:231` (`blocking` omits `resolved`), `:190` (`if (key === "resolved") continue;`), `:184` (four `samples` keys, no `resolved`). No blocking, advisory or diagnostic channel exists. `[OBSERVED AT: 64008d5a]` |

### `M-2.2` VERDICT ON (b) — the settled status

| | |
|---|---|
| **PART I said** | *"VIABLE AS A DECISION; ELIMINATED AS A DEFAULT"*, with coherence **conditional** on `MI-N` |
| **PART II says** | **COHERENT, UNCONDITIONALLY. STILL ELIMINATED AS A DEFAULT. AND MORE EXPENSIVE THAN PART I PRICED IT.** The conditional is discharged in (b)'s favour on coherence and against it on cost |
| **The net movement** | (b) traded a **risk of incoherence** for a **certainty of higher cost**. PART I's *"comfortable"* predicted the first half and missed the second |
| **What (b) now requires in writing, three clauses where `G-6` has one** | (i) the census's person-axis zero is **structural** (the contract's existing bar); (ii) **the census is not evidence for invariant 1 on any family**, nor for accountability **continuity** (PART I's addition, now also resting on the continuity clause); (iii) **`[NEW]`** that the **governed-derivation branch of the Owner's own canonical creation rule** will seed the accountable person from a record-owner reference whose only floor is `nonEmptyString` (`typedOwner.ts:67`), and that this is accepted |
| **Is (b) eliminated?** | **NO.** It remains an Owner decision the Owner may make. This lane does not recommend it and does not recommend eliminating it — **`R-5`**, unchanged in direction, raised in bar |

> **The honest one-line answer the lane contract asked for: separately carried makes (b) MORE
> comfortable on coherence and LESS comfortable on price, and the price movement is the larger of the
> two, because the creation rule turns the owner reference from a neighbour of the accountability fact
> into its seed.**

---

## `M-3`. THE WIDENED SCOPE — do (a)/(b)/(c)/(d) still partition the space?

**Answer: the four LETTERS still exhaust the WHERE. They no longer exhaust the WHAT. A scope rider is
now required on each, and without it two materially different decisions share one letter.**

| # | Step |
|---|---|
| 1 | The option set answers **one** question: *where does a person-reference validity check live* — in the derivation **(a)**, nowhere **(b)**, in the census/gate layer only **(c)**, or is the gate closed regardless **(d)**. The ruling **adds no fifth location.** There is no new layer in EOS to put a check in |
| 2 | But the ruling adds a **second reference** the check could apply to. So *"(a)"* now names at least two distinct decisions: **(a) for the record-owner reference only**, and **(a) for every governed person reference on the record**. Those differ in cost, in provability (**`M-4.3`**) and in which module is touched |
| 3 | **Therefore the options do not partition AS WORDED** — the packet's question says *"person-owner derivation"*, which names the owner reference and nothing else, so *"(a), and also for the accountable person when it is stored"* **is not expressible in the option set at all** |
| 4 | **The minimal repair is a rider, not a restatement.** Keep the letters; add one scope dimension. This lane does **not** propose new option letters: inventing (e)/(f) would make the Owner's two prior rulings harder to read against the record, and the underlying choice is genuinely a product of two independent questions |

### `M-3.1` The option set, restated with the rider. **Letters unchanged. Statements unchanged. One column added.**

| Option | Statement — **UNCHANGED from PART I** | **`[NEW]` SCOPE RIDER the ruling makes mandatory** | Post-ruling status |
|---|---|---|---|
| **(a)** | YES, in the derivation, and BEFORE the gate | **Does it bind the record-owner reference only, or every governed person reference?** `typedOwner`'s four entry points are reached only from `family.ownerFields` (`ownershipCensus.ts:165`), so **(a) applied in `typedOwner` reaches the accountable person only if that fact becomes an `ownerField`** — which would be an `OD-1`-implementation decision `OD-6` does not own (**MI-P**) | **CONSTRAINED, NOT ELIMINATED.** PART I's motive/shape verdict stands. **Newly: (a) alone does not satisfy the ruling's independence clause unless the rider says it reaches the second reference** |
| **(b)** | NO. Uphold ruling O-1 as written | **Rider is forced: (b) means NEITHER reference is validated.** There is no (b)-for-owner-only-and-yes-for-accountable — that combination *is* (a) or (c) with a rider | **COHERENT, UNCONDITIONALLY. ELIMINATED AS A DEFAULT. MORE EXPENSIVE** (**`M-2`**) |
| **(c)** | YES, but NOT in the derivation — the census and gate layer only | **This is where the rider bites hardest and where the ruling supplies new, adverse evidence.** The census layer reads **only** `family.ownerFields` (`ownershipCensus.ts:165`). **`M-5`** shows two second-person facts already shipped on exactly these three families and **neither is in any family's `ownerFields`** — so *"put it in the census layer"* does **not**, as the layer is built today, reach a second person reference | **CONSTRAINED UPWARD, STILL UNENDORSED. Newly: (c)'s advantage of being "already per-family" does NOT extend to being "already per-reference"** |
| **(d)** | Switch enforcement on regardless | Rider is vacuous — (d) validates nothing anywhere | **SELF-DEFEATING, NOT LITERALLY FORBIDDEN** (**`B-5`**), and now **twice** so: it withholds a precondition of `OD-1` *and* of `MI-N`'s accountability programme |
| — | — | **`[THE ONE STRUCTURAL CHANGE]`** The rider is a **second dimension**, so the decision space is now `{(a),(b),(c),(d)} × {owner-reference only, every governed person reference}` | **NO NEW OPTION LETTER. ONE NEW DIMENSION** |

> **This is the one place the ruling changes `OD-6`'s QUESTION rather than only its stakes.** PART I's
> `Q3` concluded *"overwhelmingly what `OD-6` UNBLOCKS; one exception changes what it must resolve
> (invariant 6 narrowing `G-4`)."* **That conclusion is now incomplete: there is a SECOND exception,
> and it is larger.** `OD-6` must now resolve **which references** its ruling binds, and the packet's
> wording cannot express the answer. `[CORRECTION TO PART I — `Q3`]`

---

## `M-4`. IS THERE ANY ACCOUNTABLE-PERSON REFERENCE TO VALIDATE AT `64008d5a`? **NO. NONE.**

### `M-4.1` The evidence, exhaustive

| # | Search | Result | Marking |
|---|---|---|---|
| 1 | `grep -ci accountable` over **each** of the 12 files in `functions/src/ownership/` | **`0` in all twelve**, file by file: `commercialCompanyScope.ts` · `creationOwnerResolution.ts` · `operatingCompanyAuthority.ts` · `ownershipBackfillRules.ts` · `ownershipCensus.ts` · `ownershipDerivation.ts` · `ownershipHandoffCommand.ts` · `ownershipMatrix.ts` · `reorderRequestLocationAuthority.ts` · `typedOwner.ts` · `warehouseCanonicalIdRepair.ts` · `warehouseRootCompanyAssignment.ts`. Concatenated: **`0`** | `[OBSERVED AT: 64008d5a]` — **confirms the count PART I `B-1` asserted** |
| 2 | `grep -E "accountable(Person\|EmployeeId\|Id\|UserId)"` over `functions/`, `field-ops-app-vite/`, `firestore.rules`, `firestore.indexes.json` | **No hit of any kind.** No field, no type member, no Rules token, no index | `[OBSERVED AT: 64008d5a]` |
| 3 | `grep -ci accountable` over `firestore.rules` | **`0`** | `[OBSERVED AT: 64008d5a]` |
| 4 | Every `accountable*` occurrence in `functions/src` | **Exactly two files, and both are PROSE in comments or Role descriptions, not data.** `access/governedBusinessRoles.ts` — 3 matching lines (`:1494`, `:1510`, `:1520`/`:1524`/`:1542`/`:1580` carry *"accountability"*), all describing why a governed **Role** exists; `workOrderLabor/workOrderLaborCommand.ts:86,321,457` — *"somebody accountable can see them"*, *"a different act with different accountability"* | `[OBSERVED AT: 64008d5a]` — **`[NEW — this lane]`** |
| 5 | `ownershipMatrix` declares an accountable reference on any of the 51 families | **No.** No family carries an accountability field; the three commercial families declare `ownerFields: ["ownerEmployeeId"]` and nothing else (`ownershipMatrix.ts:149`, `:158`, `:168`) | `[OBSERVED AT: 64008d5a]` |

> **FINDING. The fact `MI-N` ruled about does not exist in the repository at `64008d5a`. Not as a
> field, not as a type, not as a Rules token, not as an index, not as a matrix row. The only
> occurrences of the word are English prose about governed Roles and labor authority.**

### `M-4.2` So what is `OD-6` deciding? **TWO DIFFERENT KINDS OF DECISION IN ONE ROW. This is the heart of the final brief.**

| | **HALF 1 — the RECORD-OWNER reference** | **HALF 2 — the ACCOUNTABLE-PERSON reference** |
|---|---|---|
| **Does the fact exist at `64008d5a`?** | **YES.** `ownerEmployeeId` on 14/14 · 5/5 · 17/17 measured records (2026-09-02 figures, `U-2`); `accountOwner.assignedToEmployeeId`; a stored `owner` map on two families (`U-K`) | **NO.** `M-4.1` |
| **What kind of decision is it?** | **A MEASUREMENT FIX.** Data exists; the instrument is blind to a defect the data may already contain (`F-2`, `F-3`) | **A CONTRACT ON A FACT NOT YET STORED.** There is nothing to measure. It is the **validity rule the fact must satisfy before it may be stored** |
| **What makes it urgent** | Enforcement could close on a structurally-zero number (`censusGate`'s own stated failure mode, `ownershipCensus.ts:214-216`) | **`OD-1`'s banner makes `OD-6` the gate on the storage itself:** *"No ACCOUNTABLE PERSON storage, migration, enforcement, handoff or backfill until `OD-6` resolves person-reference validity."* The fact cannot be stored until this half rules |
| **Can it be proven today?** | **YES, in part.** `T-1`…`T-7` are all provable with no ruling, no employee data and no emulator (contract §7.1) | **NO, AND NOT IN PRINCIPLE.** **No fixture can be written against a field that does not exist.** This half can acquire a **specification** obligation and **cannot acquire a proof obligation at all** until the fact is stored — which `OD-1` forbids until `OD-6` rules. `[NEW — this lane]` |
| **What a wrong answer costs** | A gate that reads clean over records nobody could measure | **A fact that arrives already unvalidated**, with the shipped default trajectory of **`M-5`** |
| **Can one half substitute for the other?** | — | **NO — ruled.** *"Do not use the record owner's validity as a substitute for validating the accountable person."* So half 1 answering YES does **not** discharge half 2 |

> ### The consequence the Owner should see stated plainly
> **`OD-6` was framed as a measurement question and it is now half measurement, half constitution.**
> The measurement half can be tested before it is ruled. The constitutional half can only be
> **specified** before it is ruled and can only be **tested after something is built that `OD-1`
> forbids building until it is ruled.** That is not a deadlock — a specification is a legitimate
> product of a ruling — but it means **the acceptance contract's proof-shaped instruments (`T-`, and
> the `G-` conditions that are proof obligations) cover half 1 only**, and no amount of work on them
> reaches half 2. See **`M-8`**.

### `M-4.3` The asymmetry in one line

| Half | Instrument that could bind it today | Status |
|---|---|---|
| Record-owner reference | The census, the gate, `typedOwner`, a Node test suite over fabricated fixtures | **All exist. All shipped. Blind, but present** |
| Accountable-person reference | **None. There is no field, so there is no fixture, no bucket, no dispatch entry and no enum member to test** | **`NOT_RUN` is not the status. `NOT CONSTRUCTIBLE` is** |

---

## `M-5`. `[NEW — THIS LANE — THE STRONGEST NEW EVIDENCE IN THE BRIEF]` EOS HAS ALREADY ADDED SECOND AND THIRD PERSON-VALUED FACTS TO THESE EXACT THREE FAMILIES — AND BOTH LANDED UNVALIDATED AND UNCOUNTED.

**Why this matters more than anything else in PART II:** the widened scope asks what happens to a
*future* second person reference. **EOS does not have to speculate. It has done it twice, on exactly
`opportunity` / `salesAgreement` / `salesOrder`, and the outcome is measurable at `file:line`.**

| # | Fact | Where it lives | Populated? | Its validity floor | In the census population? |
|---|---|---|---|---|---|
| 1 | `ownerEmployeeId` — RECORD OWNER | `ownershipMatrix.ts:149`, `:158`, `:168` as `ownerFields` | Yes | **`nonEmptyString` only** — `typedOwner.ts:67` | **YES** — it is the census's only person input |
| 2 | **`creditedSalespersonId`** — sales credit | **Not in `ownershipMatrix` at all.** Declared at `salesAgreementCommands.ts:99`, `:252`; `opportunityCommands.ts:139`; the FIN-002 authority at `financialAttribution.ts:163` | **Yes — written by all three commercial creation paths**: `opportunityCommands.ts:178`, `salesAgreementCommands.ts:307-308`, `salesOrderCommands.ts:291` | **`nonEmpty` only.** `resolveCreditedSalesperson` `financialAttribution.ts:326-328` — three bare `nonEmpty` tests; and the snapshot's `person()` helper `:205-209` refuses only empty-or-whitespace | **NO.** `grep` for `creditedSalesperson` across all of `functions/src/ownership/` returns **zero hits**. The census maps over `family.ownerFields` (`ownershipCensus.ts:165`) and this is not one |
| 3 | **`responsibleEmployeeId`** — *"WHICH CREDITED/RESPONSIBLE PERSON"* | `financialAttribution.ts:164`, `:176`, `:229`, `:252`, `:304` | **NO — declared, never written.** No commercial creation path supplies it; it only passes through from an existing invoice snapshot | Same `person()` helper, `:205-209` | **NO** — same reason |

**`[OBSERVED AT: 64008d5a]` for every cell.**

### `M-5.1` What the shipped record therefore proves about the default trajectory

| # | Claim | Evidence |
|---|---|---|
| 1 | **When EOS adds a second person-valued fact to a commercial record, it lands OUTSIDE the ownership matrix.** Both `creditedSalespersonId` and `responsibleEmployeeId` are declared in the finance authority, not the ownership authority | `financialAttribution.ts:163-164`; zero hits in `functions/src/ownership/` |
| 2 | **It lands with the SAME `nonEmpty`-only floor the record owner has.** `financialAttribution.ts:205-209` is `typedOwner.ts:67` written a second time in a second module | both `file:line` |
| 3 | **It lands outside the census population, so its validity is not merely unmeasured — it is unmeasurable by the existing instrument, in either option (a) or option (c).** The census's person input is `family.ownerFields` (`ownershipCensus.ts:165`); a fact not declared there is not reached by `typedOwner`'s entry points **or** by `censusFamily`'s dispatch | `ownershipCensus.ts:165-172`; `ownershipMatrix.ts:149`, `:158`, `:168` |
| 4 | **`responsibleEmployeeId` is the sharpest case: a person-valued slot that has existed, declared and unpopulated, with no validity and no census coverage, for the life of the FIN-002 module.** It is the nearest thing in the repository to *"what happens to an accountability slot if nobody rules on it"* | `financialAttribution.ts:164` declared; no writer anywhere in `functions/src` |
| 5 | **This is NOT a criticism of FIN-002.** FIN-002 is explicit that `creditedSalespersonId` is a **reporting** fact and that ownership is elsewhere (`financialAttribution.ts:16-17`). The finding is about the **census's reach**, not about finance's correctness | `financialAttribution.ts:1-23` |

> ### THE CONSEQUENCE FOR `OD-6`
> **The question *"what happens to an accountable-person reference if `OD-6` does not bind it?"* has a
> shipped, measured answer: it arrives with a `nonEmpty` floor, in a module the ownership authority
> does not read, outside the census population, and the gate's arithmetic never sees it.** That is not
> a risk this lane is projecting; it is the observed outcome, twice, on the same three families.
> **`OD-6`'s half 2 is the decision about whether the third time is different.**
>
> **And it is adverse to BOTH (a) and (c) as currently built.** (a) in `typedOwner` is reached only
> via `ownerFields`; (c) in the census layer dispatches only over `ownerFields`. **Neither option, as
> the packet defines it, reaches a second person reference that is not declared an `ownerField`.**
> Whether such a fact should be declared an `ownerField` is **`OD-1`-implementation, not `OD-6`** —
> **MI-P**, new below.

---

## `M-6`. THE CREATION RULE'S SHIPPED PRECEDENT — verified. Real, and imperfect in three specific ways.

**The lane contract asked this lane to verify that `EXPLICIT → GOVERNED DERIVATION FROM UPSTREAM →
REFUSE` is the same shape as the existing creation-owner chain, and to report it as precedent without
designing anything. Verified. It is.**

### `M-6.1` The precedent, at `file:line`

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | The rule shape is **stated in the module header, in EOS's own words, as three lines** | `creationOwnerResolution.ts:5-7` — *"explicit valid ownerEmployeeId -> use it / otherwise -> inherit the governed upstream owner / neither resolves -> REFUSE"* | **CONFIRMED — the Owner's canonical rule is this rule, for a different fact** |
| 2 | It is one function in one place for the governed commercial creation paths | `resolveCreationOwner`, `creationOwnerResolution.ts:58-81`; header `:3` — *"One rule, in one place, for all three governed commercial creation paths"* | **CONFIRMED** |
| 3 | `buildCreateOpportunity` routes `ownerEmployeeId` through it | `opportunityCommands.ts:159` (call, upstream label *"the Account"*), result written at `:173` | **CONFIRMED — exactly as the lane contract stated** |
| 4 | **`[NEW — not named by the lane contract]`** The Sales Order path does too | `salesOrderCommands.ts:261` (upstream label *"the Opportunity"*), written at `:285`; reached from `closeOpportunityAsWon.ts:287` and `createSalesOrderFromOpportunity.ts:203`, each supplying `inheritedOwner: deriveEmployeeRefOwner(opp)` | **CONFIRMED, and it widens the precedent** |
| 5 | The REFUSAL is deliberate and reasoned, not incidental | `creationOwnerResolution.ts:12-23` — six named forbidden fallbacks (actor, createdBy, authenticated user, assignedTo, arbitrary salesperson, admin, first available employee); *"an unowned record the model can see is recoverable, a silently mis-owned one is not"* | **CONFIRMED. The Owner's *"→ REFUSE"* has a shipped rationale already written down** |
| 6 | It is **pure** — no Firestore, no I/O; the caller reads upstream inside its own transaction *"so the inherited owner cannot drift between the read and the write"* | `creationOwnerResolution.ts:25-26` | **CONFIRMED — and this is why the precedent is cheap: it needs no cross-collection read to express the SHAPE** |
| 7 | **A SECOND, CLOSER PRECEDENT the lane contract did not name** | `resolveCreditedSalesperson` (`financialAttribution.ts:313-330`) is **explicit → inherited from governed upstream → the record's own commercial owner**, and its module header `:16-21` reads: *"OWNERSHIP != SALES CREDIT: `ownerEmployeeId` remains the ownership authority; `creditedSalespersonId` is a **DISTINCT** reporting fact that **defaults from the governed commercial owner** at the point a sale enters the commercial chain and is **thereafter carried — never silently re-derived** from whoever owns the Customer today. **HISTORICAL STAYS HISTORICAL**"* | **THIS IS THE RULING, ALREADY SHIPPED FOR A DIFFERENT FACT.** *Separately carried · initialized by derivation from the current governed owner · never silently re-derived · historical preserved* — four of the ruling's clauses, in EOS's own source comments, at `64008d5a` |

> **PRECEDENT FINDING: the Owner's `MI-N` rule is expressible in a pattern EOS already ships TWICE —
> once for the record owner (`resolveCreationOwner`) and once, semantically much closer, for a
> separately-carried second person fact on the same three families (`resolveCreditedSalesperson`).
> Nothing about the rule's SHAPE requires new machinery.**

### `M-6.2` Where the precedent is IMPERFECT — three gaps, and the second is the one that matters

| # | Imperfection | Evidence | Why it matters to `OD-6` |
|---|---|---|---|
| **1** | **One of the three families the Owner named does not use the chain at all.** `salesAgreement` has **no derivation branch**: `buildCreateSalesAgreement` refuses outright when `ownerEmployeeId` is empty | `salesAgreementCommands.ts:280` — `if (!nonEmpty(input?.ownerEmployeeId)) throw new SalesAgreementCommandError("OWNER_REQUIRED", …)`; `resolveCreationOwner` is **not** imported there. The header's *"all three governed commercial creation paths"* (`creationOwnerResolution.ts:3`) is satisfied by Opportunity, Sales Order and — via `creditedSalespersonId` — the Agreement's **credit** chain, not its **owner** chain | The shipped precedent implements **three** steps for two families and **two** steps (EXPLICIT → REFUSE) for the third. The Owner's rule has three steps for all three. **Whether the middle step is to be added for the record owner too, or only for the accountable person, is an Owner statement — `MI-Q`, new below** |
| **2** | **THE WORD *"VALID"* HAS NO CONTENT IN THE PRECEDENT.** The Owner's rule begins *"EXPLICIT **VALID** ACCOUNTABLE PERSON"*. In the precedent, *"explicit valid"* means **non-empty string** | `creationOwnerResolution.ts:45` (`nonEmpty`) used at `:63`. And the derivation branch at `:67-73` requires `RESOLVED` + `USER` — which for a USER is `nonEmptyString` and nothing else (`typedOwner.ts:67`). **Both branches bottom out at "any non-empty string"** | **This is exactly what `OD-6` decides, and the precedent supplies none of it.** The pattern gives the Owner the **shape** for free and gives **zero** of the **validity**. So: *"the rule is expressible in shipped machinery"* is true; *"the rule is satisfiable by shipped machinery"* is **false** until `OD-6` rules |
| **3** | **The two precedents disagree on the terminal step, and the ruling matches only one.** `resolveCreationOwner` **throws** (`:77-80`, `CreationOwnerUnresolvedError`, code `OWNER_UNRESOLVED`). `resolveCreditedSalesperson` **returns `null`** and *"the caller decides whether that is legal for its record type"* (`:318-319`) | both `file:line` | The Owner's rule says **REFUSE**, which matches `resolveCreationOwner`. But the **semantically** closer precedent is the one that returns `null`. **So the shape-precedent and the semantics-precedent are two different functions with two different terminal behaviours**, and the ruling picks the terminal of the less-similar one. That is not a contradiction — it is a detail the eventual contract must state rather than inherit |

**`[NOT DESIGN]` This lane names no field, proposes no signature and recommends no module. It reports
that the shape exists, where, and what it does and does not supply. Any statement beyond that is
`OD-1`-implementation work `OD-6` gates.**

---

## `M-7`. THE INVARIANT-6 CONFLICT — how much is CLOSED, how much remains sub-question ③

> ### `[CORRECTION TO PART I — LOUD, AND IT CUTS AGAINST THIS LANE'S OWN `R-3`]`
> **PART I `B-3`/`R-3` concluded that invariant 6 requires TERMINATED and INACTIVE to STAY `RESOLVED`, and that *"status may only be reported."* That conclusion is now OVERSTATED and is withdrawn to a weaker form. The ruling closes the HARM directly and therefore REMOVES THE ARGUMENT that forced the value.**

### `M-7.1` The mechanism of the correction, stated as an argument

| # | Step |
|---|---|
| 1 | The decomposition's `C-B3` chose `RESOLVED` for TERMINATED **consequentially**: *"because `UNRESOLVED` is the input a backfill acts on"*, reasoning from `typedOwner.ts:128-130` — *"calling it unresolved would invite a backfill to reassign it."* The value was chosen **as a means of preventing a rewrite** |
| 2 | PART I promoted that to an invariant-6 requirement: history must be auditable ⇒ the resolution must not change ⇒ `RESOLVED` |
| 3 | **The ruling now forbids the rewrite BY FIAT:** *"Preserve historical accountability even when the referenced employee later becomes inactive or terminated. **Do not automatically backfill/rewrite** historical accountability merely because the person is no longer actionable."* Plus *"HISTORICAL REMAINS HISTORICAL"* and *"Historical facts are not rewritten"* |
| 4 | **When the harm is prohibited directly, the proxy that existed to prevent it stops being load-bearing.** `C-B3`'s argument for `RESOLVED` was *"choose this value because the other value triggers a backfill."* Under the ruling, **the backfill is forbidden whatever the value is.** So the argument no longer selects the value |
| 5 | **And the Owner listed the representation question as STILL OPEN — sub-question ③:** *"how should INACTIVE / TERMINATED historical references be represented?"* A question the Owner lists as open cannot have been closed by the same ruling |
| 6 | **Therefore: the contract's case-2 `NOT RESOLVED` is NOT forbidden by the ruling** — provided the design can show that whatever non-`RESOLVED` representation it uses does not feed an automatic backfill or rewrite. **PART I said invariant 6 contradicted the contract on the status half. PART II says the ruling REOPENS that on its merits and forbids only the consequence** |

### `M-7.2` The conflict, itemised: CLOSED vs OPEN

| # | Sub-issue | Status after `MI-N` | Authority |
|---|---|---|---|
| **1** | **The historical reference must be PRESERVED — not cleared, not reassigned, not rewritten** | **CLOSED.** Binding on both prior lanes and on any eventual design | *"Preserve historical accountability… Do not automatically backfill/rewrite"*; *"Historical facts are not rewritten"* |
| **2** | **A mechanism whose EFFECT is an automatic rewrite of a historical reference is forbidden, regardless of which bucket or resolution value it uses** | **CLOSED.** This is the operative constraint, and it is a constraint on **consequence**, not on **value** | same |
| **3** | **New downstream records may initialize from CURRENT governed upstream facts** — so *"preserve history"* does not freeze future creation | **CLOSED, and it resolves a tension PART I did not name.** *"HISTORICAL REMAINS HISTORICAL. FUTURE WORK FOLLOWS CURRENT GOVERNED AUTHORITY"* | ruling, transfer clause |
| **4** | **EXISTENCE and STATUS are TWO QUESTIONS, not one refusal** — contract `G-4`'s first half | **CLOSED — by the ruling's own enumeration.** ① *does the referenced Employee exist?* and ② *is that Employee valid for current accountability?* are listed as **two** distinguishable sub-questions. **This is a firmer basis than PART I's derivation from invariant 6, and it reaches the same place** | ruling, sub-questions ①/② |
| **5** | **WHAT RESOLUTION VALUE / BUCKET represents an INACTIVE or TERMINATED historical reference** | **OPEN. This is sub-question ③ verbatim.** `C-B3`'s `RESOLVED + separately reported` and the contract's `NOT RESOLVED` **BOTH REMAIN ON THE RECORD AS LIVE READINGS.** Neither is ruled in or out | ruling lists ③ as open |
| **6** | **Whether case 2 is BLOCKING or merely REPORTED** — contract `G-3` | **OPEN.** Sub-question ④ (*what must the gate consider resolved vs actionable*) is the Owner's framing of the same question and is listed as open. **The ruling's `resolved` / `actionable` distinction is new vocabulary and is NOT the census's `resolved` bucket — do not conflate them** | ruling, sub-question ④ |
| **7** | **Which employee fact means *"cannot act"* / *"valid for current accountability"*** | **OPEN — MI-J, unchanged.** The ruling says *"valid for current accountability"* and does **not** say which stored employee fact decides it. `employmentStatus === "ACTIVE"` is what fails closed at `operationalRoleContext.ts:52` and `adminCredentialCommands.ts:183,223`, but that is an **operational-capability** authority | `MI-J`, carried |
| **8** | **Whether TERMINATED and INACTIVE are ONE census case or TWO** | **OPEN — MI-C, unchanged.** The ruling names them together (*"inactive or terminated"*) and does not separate their treatment. `C-B3` says *"different reason because the remediation is opposite"*; the ruling neither adopts nor rejects that | `MI-C`, carried |
| **9** | **Whether a DELETED and a NON-EXISTENT employee document are one case or two** | **OPEN — MI-K, unchanged** | `MI-K`, carried |

### `M-7.3` The conflict statement, replacing PART I `B-4`'s verdict while preserving it

| | |
|---|---|
| **PART I `B-4` said** | *"`OD-1`'s invariant 6 CONTRADICTS the acceptance contract's case 2, and sides with the decomposition."* **Preserved above, unaltered** |
| **PART II says** | **PARTLY WITHDRAWN.** Invariant 6 plus the `MI-N` ruling forbid the **rewrite**, not the **value**. The contract's `NOT RESOLVED` is therefore **not contradicted** — it is **conditioned**: permissible if and only if it does not feed an automatic backfill. `C-B3`'s `RESOLVED` is **not ratified** — its stated reason has been superseded by a direct prohibition |
| **Net effect on the two prior lanes** | **Neither lane is overruled and neither is vindicated.** Both were reasoning about a value in order to control a consequence; the Owner has now controlled the consequence directly and left the value to `OD-6` sub-question ③. **Both readings stand on the record, and now stand on a narrower question than before** |
| **What travels with it** | **The acceptance contract is NOT modified by this brief** (off this lane's surface). Its §4 case 2 must still be read **split** by reference (owner vs accountable, ruled independent) and by sub-case (existence vs status, ruled two questions). **What is no longer claimed is that the status sub-case's resolution value is settled.** See **`M-8`** |

---

## `M-8`. WHAT WOULD NEED TO CHANGE IN THE ACCEPTANCE CONTRACT — **REPORTED ONLY. THAT FILE WAS NOT MODIFIED.**

`docs/operating-model/engineering/PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` on this branch
(`e1d5c024`) was **read at this baseline and not edited**. Every row below is a report to whoever
eventually holds that surface.

### `M-8.1` `T-1`…`T-7` — **none becomes FALSE. All seven become INSUFFICIENT as a set.**

| # | Claim | Effect of the widened scope |
|---|---|---|
| `T-1` | `blocking` omits `resolved` | **UNCHANGED, still true, still provable.** Pure arithmetic over `ownershipCensus.ts:231,240` |
| `T-2` | All four person-owner states produce `RESOLVED` | **UNCHANGED.** A control-flow claim about the four owner entry points |
| `T-3` | An absurd USER id censuses `resolved`; the same absurdity as a COMPANY id censuses `invalid` | **UNCHANGED.** `typedOwner.ts:67` vs `:68` |
| `T-4` | No channel — blocking or advisory — reports a person orphan | **UNCHANGED, and now broader in consequence:** it is also why accountability **continuity** has no instrument (`M-2.1` step 3) |
| `T-5` | `INACTIVE` absent from all three census-side enums | **UNCHANGED** |
| `T-6` | REFERENCE/EXCLUDED outside the population, both directions | **UNCHANGED** |
| `T-7` | The baseline `ownerless`/`invalid`/`unknown`/`ambiguous` regression floor | **UNCHANGED as a method.** Still must be **re-measured, not cited** (`U-2`) |
| **The set** | *"`T-1` through `T-7` are the acceptance test's foundation"* | **NOW TRUE OF ONE REFERENCE ONLY.** All seven are statements about the **record-owner** instrument. **None mentions a second person reference, and under the ruling none can be cited as evidence about the accountable person.** `G-6`'s *"`T-1`…`T-7` are exactly the evidence it must cite"* is therefore **incomplete under (b)** |

**Two rows that are provable TODAY and that the widened scope newly makes worth pinning. `[PROPOSED, NOT ADDED]`**

| Proposed | Claim | Method — no ruling, no employee data, no emulator |
|---|---|---|
| **`T-8`** | **No accountable-person reference exists at `64008d5a`** — no field, type, Rules token or index; the only `accountable*` occurrences in `functions/src` are prose in two files | Static grep, `M-4.1`. Pins the negative so no later reader assumes coverage |
| **`T-9`** | **EOS's second and third person-valued facts on these three families (`creditedSalespersonId`, `responsibleEmployeeId`) are outside the census population entirely and carry a `nonEmpty`-only floor** | Set reasoning over `family.ownerFields` (`ownershipCensus.ts:165`) plus `financialAttribution.ts:205-209`. Same kind of claim as `T-5`/`T-6`. **This is the measured default trajectory of `M-5`** |

### `M-8.2` `G-1`…`G-7` — four need a scope rider, one is partly answered, one needs adding

| # | Condition | Effect of the ruling |
|---|---|---|
| `G-1` | Whether the person-axis check exists at all | **NEEDS A SCOPE RIDER.** *"Which reference"* is now part of the question (**`M-3`**) |
| `G-2` | Where the check lives — derivation vs census/gate layer | **NEEDS A SCOPE RIDER, and acquires new adverse evidence:** neither layer reaches a person reference that is not an `ownerField` (**`M-5.1`** step 3) |
| `G-3` | Blocking vs merely reported | **STILL OPEN.** It is the Owner's sub-question ④ (*resolved vs actionable*). **Do not read the ruling's `resolved`/`actionable` vocabulary as the census's `resolved` bucket** |
| `G-4` | Whether EXISTENCE and STATUS are one refusal or two | **PARTLY ANSWERED — TWO QUESTIONS, ruled (sub-questions ①/②).** **Which representation each takes is OPEN (③).** PART I claimed more than this; see the `M-7` correction |
| `G-5` | Whether `UNKNOWN` may be reused for a non-existent employee | **UNCHANGED.** `typedOwner.ts:45-48` records O-1's *"structurally zero"*; the ruling is silent on cross-collection lookups |
| `G-6` | What satisfies the contract under `OD-6` = (b) | **MATERIALLY WIDENED — three clauses, not one** (`M-2.2`). **This is the single largest required change to that file** |
| `G-7` | What an INACTIVE/TERMINATED person owner should *mean* — `OD-11a`'s row | **REINFORCED BY OWNER AUTHORITY.** *"Do not automatically backfill/rewrite"* turns *"a release policy must not arrive as a census bucket"* from a lane's caution into an Owner-backed rule |
| **`G-8`** | **`[PROPOSED, NOT ADDED]` Whether the accountable-person reference, once stored, enters the ownership census population at all** — i.e. whether it is declared an `ownerField`-like governed reference or follows `creditedSalespersonId` outside the matrix | **CREATED BY THE RULING, and it is prior to `G-1`/`G-2`: if the fact never enters the population, neither (a) nor (c) reaches it, whatever `OD-6` rules.** Its answer is **`OD-1`-implementation — `MI-P`** |

### `M-8.3` Two other clauses in that file the rulings have made stale — **reported, not acted on**

| Clause | What it says | What is now stale |
|---|---|---|
| **`P-8`** | *"ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER remain three facts… **`OD-1` is unruled.** A proof that measures 'the person on the record' without saying which of the three it measures pre-empts `OD-1`"* | **The rationale text is stale — `OD-1` IS ruled (2026-09-13) and `MI-N` closed.** **The clause itself is STRONGER, not weaker:** it now rests on a ruling rather than on a pending decision, and `MI-N`'s prohibition on the permanent identity is a second authority for it. **Only the parenthetical reason needs correcting** |
| **§4 case 2** | *"an employee that exists but is not `ACTIVE`… must return **NOT `RESOLVED`**"* | **Must be read split twice over:** by **reference** (owner vs accountable — ruled independent, so one case-2 row cannot cover both) and by **sub-case** (existence vs status — ruled two questions). **And its `NOT RESOLVED` is now CONDITIONED rather than contradicted** (`M-7.3`) |

---

## `M-9`. RECOMMENDATION, REVISED — labelled, attributed, and NOT a decision

**`R-1`…`R-5` are preserved above in PART I. Their revised status follows. `R-6` is new.**

| # | Direction | Post-ruling status | Why |
|---|---|---|---|
| **`R-1`** | Carry EMP-ACCOUNTABILITY's **(a) YES**, attributed, with the two wording corrections | **STANDS IN CONTENT · NARROWED IN SCOPE · WEAKER AS A TOTAL ANSWER** | It was always a recommendation about the **record-owner** reference. Under the independence clause it **does not extend to the accountable person by default**, so as an answer to the widened `OD-6` it now covers **half 1 only** (`M-4.2`). **Nothing in it is withdrawn; its reach is smaller than the question** |
| **`R-2`** | The sequencing constraint: *"the gate must not be closed on the census's person-axis figures while those figures are structurally incapable of being non-zero"* | **STANDS · STRONGER · AND EXTENDED** | **Stronger:** it now also rests on the independence clause and on the continuity clause, not only on invariant 1 and `H9`. **Extended, `[NEW]`:** the gate must **also not be cited as evidence about accountability continuity**, because **no accountable-person reference exists to count** (`M-4.1`) — a zero there is not a structural zero, it is an **absent fact**, and the two must not be reported the same way. **This remains the one part of `OD-6` the evidence settles on its own** |
| **`R-3`** | *"Existence may move the resolution; status may only be reported"* | **PARTLY WITHDRAWN — RESTATED WEAKER. This lane got this wrong and says so.** | **Retained half:** existence and status are **two questions** — now on firmer authority (the ruling's own ①/②) than PART I's derivation from invariant 6. **Withdrawn half:** *"status may only be reported."* The ruling forbids the **rewrite**, not the **value**, so the argument that forced `RESOLVED` is superseded and the representation question is the Owner's **open ③** (`M-7.1`). **Restated: EXISTENCE and STATUS must be separated as two questions; which representation each takes is NOT recommended by this lane and is sub-question ③** |
| **`R-4`** | **No recommendation between (a) and (c). `None`.** | **STANDS. `None` remains the correct entry.** | Nothing in the ruling touches the derivation-vs-census-layer question; ruling **O-1** was an Owner ruling **about the derivation specifically** and the ruling is silent on cross-collection lookups; **`U-M`** is still unsettled. **One new datum, and it is NEUTRAL between them and ADVERSE TO BOTH:** neither layer reaches a person reference outside `ownerFields` (`M-5.1` step 3). **It does not break the tie; it lowers both sides.** The Owner has now ruled twice without needing this lane to pick, and a manufactured preference would be worse than the abstention |
| **`R-5`** | Not (b), not its elimination; not (d); no token; no departure policy | **STANDS, with (b)'s bar RAISED AGAIN** | (b) is now **coherent** (its incoherence branch retired) and **more expensive** (`M-2.2`). This lane still recommends only that **if** (b) is ruled, `G-6`'s written acknowledgement carry **three** clauses rather than one — including that the Owner's own governed-derivation branch will seed accountability from a reference whose floor is `nonEmptyString` (`typedOwner.ts:67`). **(d) is now self-defeating twice over** |
| **`R-6`** | **`[NEW]` The accountable-person half should be ruled as a STORAGE PRECONDITION, not as a census bucket** | **THIS IS A RECOMMENDATION, NOT A DECISION** | There is no fact to measure (`M-4.1`) and no fixture that can be written against a field that does not exist (`M-4.2`). So half 2 can only be discharged as a **condition the fact must satisfy before it is stored** — which is exactly the role `OD-1`'s own banner already assigns `OD-6`. **Attempting to discharge it as a census bucket would require the fact to exist first, which `OD-1` forbids until `OD-6` rules.** **No field, shape, module or name is proposed here, and none should be read into it** |

**Also not recommended, restated because the ruling did not change it:** no schema · no backfill · no
migration · no handoff activation · no implementation · no departure policy (**`OD-11a`**) · no entry
into Area A's re-argument · no token or field name for the accountable person.

---

## `M-10`. UNPROVEN, MISSING INPUT, AND CORRECTIONS — PART II

### `M-10.1` UNPROVEN — additions. **Everything in PART I §UNPROVEN is carried unchanged.**

| # | Claim | Status |
|---|---|---|
| **`X-1`/`X-2`/`X-3`** | No JRE · port 8080 held by an unrelated process · no `functions/node_modules` and no `functions/lib` in this worktree | **CARRIED UNCHANGED.** `T-1`…`T-7`: **NOT_RUN.** No emulator was started, no suite was run, nothing was borrowed from another worktree, and **`functions/lib` was neither built nor borrowed.** This lane's surface was one document |
| **`U-N` `[NEW]`** | **Whether any environment stores a person reference under a name this lane did not grep for** — the `M-4.1` negative is exhaustive over `accountable*` tokens and over `ownershipMatrix`, **not** over every conceivable synonym | Static. `responsibleEmployeeId` (`financialAttribution.ts:164`) is the proof that the synonym risk is real: it is a *"RESPONSIBLE PERSON"* slot found only because FIN-002 was read, not because `accountable` was grepped |
| **`U-O` `[NEW]`** | **Whether `creditedSalespersonId` is populated with ids that name existing, `ACTIVE` employees in any environment** | Requires the `U-J` read plus Owner authorization. **Not attempted.** `M-5` is a **capability and coverage** finding, not an **incidence** finding — **no claim is made that any bad value exists anywhere** |
| **`U-P` `[NEW]`** | **Whether `responsibleEmployeeId` has ever been written in any environment.** Its only appearance is pass-through from an existing snapshot (`financialAttribution.ts:304`); **no writer exists in `functions/src`**, so a value could only pre-date or bypass that module | Static read only. **Not attempted** |
| **All of `U-J`, `U-K`, `U-L`, `U-M`, `U-1`, `U-2`, `U-9`** | — | **CARRIED UNCHANGED.** `U-M` (whether the client authority can answer the same question) remains **the (a)/(c) tiebreak this lane could not settle**, and `R-4` stays `None` because of it |

### `M-10.2` MISSING INPUT — `MI-N` CLOSED; three new

| # | MISSING INPUT | Bears on |
|---|---|---|
| ~~**`MI-N`**~~ | **CLOSED 2026-09-13.** ACCOUNTABLE PERSON is a **separately carried business fact**, not permanently derived from RECORD OWNER; initial derivation from the current governed commercial record owner is permitted as **initialization only**; the permanent computed identity is **forbidden** | **Settled: `M-2`.** Option (b) is **coherent**, still **not a default**, and **more expensive** |
| **`MI-P`** | **`[NEW]` When the accountable-person fact is stored, does it enter the ownership census population — i.e. is it a governed reference the ownership authority reads, or does it live outside `ownershipMatrix` as `creditedSalespersonId` does?** This is prior to `OD-6`'s (a)/(c) choice: **if the fact never enters the population, neither layer reaches it whatever `OD-6` rules** (`M-5.1` step 3) | **`M-3`'s scope rider · proposed `G-8` · the reach of any YES.** `OD-1`-implementation, not `OD-6` — but `OD-6` cannot state its own reach without it |
| **`MI-Q`** | **`[NEW]` The Owner's canonical rule has three steps for all three commercial families, but `salesAgreement`'s shipped owner chain has two (EXPLICIT → REFUSE, `salesAgreementCommands.ts:280`, no derivation branch). Is the middle step to be added for the RECORD OWNER too, or does the three-step rule bind only the accountable person?** | **`M-6.2` imperfection 1.** It decides whether the ruling implies a change to a shipped creation path on the owner axis — which would be more than a measurement change |
| **`MI-R`** | **`[NEW]` Does *"valid for current accountability"* (sub-question ②) mean the same employee fact as *"cannot act"* for record ownership?** The ruling introduces *"valid for current accountability"* as a **new** predicate and does not say whether it is `MI-J`'s answer, a narrower one, or a different one | **Sub-questions ② and ③, and `G-4`.** Assuming they are one predicate would be **using one axis's validity as a proxy for the other's — the exact substitution the ruling forbids** |
| **`MI-C` · `MI-J` · `MI-K` · `MI-A` · `MI-G`** | — | **ALL CARRIED UNCHANGED, and `MI-C`/`MI-J`/`MI-K` are now MORE load-bearing**, because sub-question ③ cannot be answered without them (`M-7.2` rows 7–9) |

### `M-10.3` CORRECTIONS — to this brief's own PART I, and to the record

| # | Correction | Severity |
|---|---|---|
| **`K-10`** | **`K-8` STANDS AND EXTENDS.** `docs/DECISIONS.md` on this branch ends at **`## #179`** (`:6410`, *"OWNER RULINGS: M-1 Option A…"*, 2026-09-10) — **verified at this baseline in this worktree.** **Neither #180 (`OD-1`) nor #181 (`MI-N`) exists here.** `OD-1` is recorded as #180 on `int/a-correctness-register`, not on `main` and not on this branch; #181 is being recorded by the controller in parallel. **Both rulings are therefore cited BY NAME AND REF ONLY throughout PART II, with no relative link**, and every invariant- and ruling-derived conclusion in both parts inherits this. **Reported, not acted on — `docs/DECISIONS.md` is off this lane's surface** | **MEDIUM** |
| **`K-11`** | **PART I's `MI-N` row — *"Under 'separately carried', option (b) is comfortable"* — is WRONG AS STATED.** Separately carried makes (b) **coherent**; it makes (b) **more expensive**. The prediction was half right and the compression hid the half that matters (`M-2`) | **HIGH for decision framing** — it is the row the Owner would have read as *"the ruling was good for (b)"* |
| **`K-12`** | **PART I `B-3`/`R-3`'s *"status may only be reported"* is OVERSTATED and is withdrawn** (`M-7.1`). The ruling forbids the **rewrite**, not the **value**; sub-question ③ is expressly open; **the contract's `NOT RESOLVED` is conditioned, not contradicted; `C-B3`'s `RESOLVED` is not ratified.** PART I's `B-4` verdict is correspondingly **partly withdrawn** and preserved in place | **HIGH** — PART I told the Owner a question was adjudicated that the Owner has listed as open |
| **`K-13`** | **PART I `Q3` — *"overwhelmingly what `OD-6` UNBLOCKS; ONE exception changes what it must resolve"* — is INCOMPLETE.** There is a **second and larger** exception: the ruling requires `OD-6` to resolve **which references** it binds, and the packet's wording cannot express the answer (`M-3`) | **HIGH for decision framing** |
| **`K-14`** | **`[NEW — about the record, not about PART I]` The lane contract's *"`grep -ci accountable` across `functions/src/ownership/**` was 0"` is CONFIRMED file by file and in concatenation.** But the negative is narrower than it reads: **`functions/src` is not `accountable`-free** — `access/governedBusinessRoles.ts` (3 matching lines) and `workOrderLabor/workOrderLaborCommand.ts:86,321,457` carry the word **in prose**, and `financialAttribution.ts:164` declares a **`responsibleEmployeeId`** person slot that no `accountable` grep would ever find. **The correct statement is "no accountable-person DATA REFERENCE exists", not "the word does not appear"** | **MEDIUM** — it is the difference between a clean negative and an exhaustive one |
| **`K-1`…`K-9`** | — | **ALL CARRIED UNCHANGED.** Nothing in PART II disturbs them; `K-3`'s de-risking of a YES (`U-K` does not stand between `OD-6` and invariant 1) still holds and is now **additionally** relevant because half 2 has no field at all |

---

## `M-11`. WHAT PART II DID NOT DO

- **`OD-6` is NOT answered.** Both halves remain open. A recommendation is revised, labelled, attributed and evidence-grounded, and **`R-4` remains `None` on the (a)/(c) axis** — the Owner has ruled twice without needing this lane to pick.
- **PART I was NOT rewritten.** Every pre-ruling argument, including the three this part corrects (`K-11`, `K-12`, `K-13`), is **preserved verbatim and in place**, with a marker at the point of correction. **Mark and append; never silently rewrite.**
- **Both readings of every preserved conflict still stand.** `F-5` (`record-ownership.md` §2 vs ruling O-1) — unresolved, both carried. `B-4` / `M-7.3` (contract case 2 vs decomposition `C-B3`) — **both live, on a narrower question than before**. Neither lane overruled, neither vindicated.
- **`PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` was NOT modified.** It was read at `e1d5c024`. Everything in **`M-8`** — including proposed `T-8`, `T-9`, `G-8` and the stale `P-8` rationale — is a **report** to whoever holds that surface. **Nothing was added to it, extended in it, or rewritten.**
- **The packet on `ext/own-decision-packet` was NOT modified** (read at `ce66f9b1`). **`docs/DECISIONS.md` was NOT modified** (`K-10` reported only). **Nothing on `emp/own-synthesis` or `own-enggap` was touched.**
- **No implementation. NO SCHEMA. NO BACKFILL. NO MIGRATION. NO HANDOFF ACTIVATION.** No field, collection, index, command, bucket name or code token proposed for the accountable person. Shipped identifiers are cited **as precedent and as evidence**, never as a proposal — **`M-6`** reports that the Owner's rule shape already exists and **explicitly does not design it**.
- **No collapse.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER stay three facts (`P-8`), and the ruling's prohibition on the permanent identity is now a second authority for that.
- **`OD-11a` not entered. Area A not entered.** Where a question turned out to be departure policy or Area A's re-argument, it is named and left there.
- **Nothing executed.** No production contact, no deploys, no data mutation, no Firestore read or write, no emulator (`X-1`/`X-2` unchanged), no secrets requested or exposed. **`T-1`…`T-7`: NOT_RUN**, and **not relabelled.** Every behavioural claim in both parts is **UNPROVEN BY EXECUTION** and labelled.
- **Nothing written outside this file. Not pushed. No PR.**
