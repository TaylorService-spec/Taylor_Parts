---
artifact_type: owner-decision-brief
lane: OD-6-PREPARATION
decision: OD-6
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
baseline_tag: ATLAS-BASE-2026-09-12-A
date: 2026-09-13
supersedes: nothing -- OD-PACKET-001-006-007.md section 3 stands and is cited throughout
depends_on_ruling: OD-1 APPROVED 2026-09-13 (distinct first-class ACCOUNTABLE PERSON axis, ten invariants)
implementation_status: NOT AUTHORIZED
schema_designed: none
executed: nothing
---

# `OD-6` — DECISION BRIEF, RE-PREPARED WITH `OD-1` SETTLED

**OBSERVED AT: 64008d5a.** Every code claim below was re-read in this worktree at this baseline by
this lane, from `git show 64008d5a:<path>`, and carries a `file:line`. Claims inherited from an
earlier lane are attributed and marked as that lane marked them.

> ## THIS BRIEF ANSWERS NO OWNER QUESTION.
> It prepares **`OD-6` only**, with **`OD-1` now settled authority**. A **RECOMMENDATION** appears
> below, **labelled, attributed and explicitly not a decision** — and where the evidence supports no
> recommendation, the field says so. **No field, collection, index, command, code token or schema is
> proposed anywhere. No generic `ownerId`/`accountableId`.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD
> OWNER are three distinct facts throughout and are never collapsed.
>
> **`OD-6` is NOT person-orphan policy.** That is **`OD-11a`** (*on departure, what is RELEASED and
> what is RETAINED?*), a different row, and this brief does not enter it. Where a question turns out
> to be `OD-11a`'s, it is named and left there.

**Sources, read-only:** `own-decision:docs/operating-model/owner-decisions/OD-PACKET-001-006-007.md`
(`ce66f9b1`) §3 · `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` on this branch (`e1d5c024`) ·
`emp-synth:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md` (`664ed365`) ·
`own-enggap:docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` (`7792c1ba`) ·
`functions/src/ownership/**`, `functions/scripts/ownership*.js`, `firestore.rules` at `64008d5a`.

---

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
| **MI-N** | **`[NEW — and it is the one that decides option (b)]` For `opportunity`, `salesAgreement` and `salesOrder`, is the accountable person a SEPARATELY-CARRIED fact, or the record owner?** `OD-1` rules the axes distinct; it does not say whether, on the commercial chain, the two are filled by one derived fact or two independent ones. The Owner's own worked example — *"Accountable Person: potentially same salesperson for relationship outcome"* — says the **same person** may fill both roles, which is **not** the same claim as the two roles being one fact | **B-1's verdict, decisively.** Under "separately carried", option (b) is comfortable. Under "the owner, derived", (b) is close to incoherent |
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
> | 1 | **Derivation makes the two facts operationally identical, and invariant 3 forbids that the moment they must diverge.** `accountable := owner` is an **identity**, and under it *"changing accountability does not automatically change record ownership"* is **inexpressible** — there is nothing to change independently. `OD-1` says the same person **may fill** both roles; it does not say the axes are one function. **So derivation is a defensible INTERIM answer and an indefensible PERMANENT one, and which it is, is an Owner statement about the commercial chain** — **MI-N** |
> | 2 | **Under derivation, invariant 1's detectability for these three collapses ENTIRELY onto `OD-6`.** If accountable **is** the owner and the owner is a string nobody checks, invariant 1 is unfalsifiable for three of the six PERSON families by construction. **This is the single strongest argument against option (b) in the whole brief — and it is CREATED by the derivation answer, not by the ruling** |
> | 3 | It says nothing about `account`, `contact`, `location` (which fail `T2`) and nothing about Area A's 6-family minimum set, **none of which carries any person-valued field at all** — `workOrder.ownerFields: []`, and `transferOrder`'s ownership shape **is** two participants (`ownershipMatrix.ts:447-450` — `ownerClass: "PARTICIPATING_COMPANIES"`, `ownerFields: []`, `participatingFields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"]`), so *"no owner field can ever be made to carry an accountable person here, in any modelling"* |
>
> **Net: derivation is a cheap, invariant-10-respecting answer for exactly these three families, and
> it is the answer that makes `OD-6` LOAD-BEARING rather than optional.** Whether it is permitted is
> **MI-N**.

**Q3 — Does any of this change what `OD-6` must RESOLVE, or only what `OD-6` UNBLOCKS?**

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

## WHAT THIS DOCUMENT DID NOT DO

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
