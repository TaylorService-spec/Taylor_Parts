---
artifact_type: acceptance-contract
lane: OWN-DECISION-PRESENTATION
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
baseline_tag: ATLAS-BASE-2026-09-12-A
date: 2026-09-13
implementation_status: NOT AUTHORIZED
gated_by: OD-6
scope: what a proof of person-axis census integrity must demonstrate
schema_designed: none
---

# PERSON-OWNER CENSUS — ACCEPTANCE CONTRACT

**OBSERVED AT: 64008d5a.** Every code claim below was re-read in this worktree at this baseline by
this lane. Where a claim is inherited from an earlier lane it is attributed and marked as that lane
marked it. Where nothing could be executed, it says so — see §8.

> ## THIS DOCUMENT IS NOT A DESIGN AND NOT A FIX.
> It states **what a proof must demonstrate** before anyone may claim the ownership census can
> detect an invalid PERSON owner. **`OD-6` gates the fix; this contract is written so that whichever
> way `OD-6` is ruled, the acceptance bar is already known.** No field, collection, index, command,
> code token or schema is proposed anywhere. **No generic `ownerId` is proposed.** ACCOUNTABLE
> PERSON, ASSIGNEE and RECORD OWNER are three distinct facts throughout and are never collapsed.

---

## 0. THE PRESERVED FINDING, STATED ONCE

> **CONFIRMED CORRECTNESS / MODEL FINDING.** `ownershipCensus` **cannot detect invalid PERSON
> ownership with the referential-integrity semantics available to COMPANY ownership.** The person
> axis is measured by a shape guard; the company axis is measured against a governed authority. The
> census's person-axis figures are therefore evidence that **a non-empty string is present**, and
> nothing more.

**The central invariant, as the Owner stated it, and the thing every eventual proof must establish:**

> **An invalid person reference must NOT census as `RESOLVED` merely because its shape is valid.**

**One precision that must travel with the finding and is easy to lose:** the correct target is **not
"match what COMPANY does."** COMPANY does **less** than that — it has **existence** integrity and
**no active-status** integrity, deliberately (§2.3). A contract written as *parity with COMPANY*
would accept a proof that leaves `INACTIVE` and `TERMINATED` person owners censusing as `RESOLVED`,
which is most of the defect.

---

## 1. THE FOUR PERSON-OWNER DERIVATION ENTRY POINTS — all shape-only

The person axis is reached through **four** functions, not the two usually cited. All four are
shape-only and **none reads an Employee document**. `functions/src/ownership/` at baseline:

| # | Entry point | Location | What it reads | Terminal check | Reads Employee? |
|---|---|---|---|---|---|
| 1 | `deriveAccountOwner` | `typedOwner.ts:95-109` | `accountOwner.assignedToEmployeeId` | `nonEmptyString` → `typedOwner(USER, …)` → `isTypedOwner` | **No** |
| 2 | `deriveEmployeeRefOwner` | `typedOwner.ts:112-125` | the declared employee-ref field | `nonEmptyString` → `typedOwner(USER, …)` → `isTypedOwner` | **No** |
| 3 | `deriveStoredOwner` | `typedOwner.ts:196-210` | the stored typed-owner map | `isTypedOwner`; the governance re-check at `:206` is **guarded on `type === COMPANY`** and so never runs for a person owner → `:209` `RESOLVED` | **No** |
| 4 | `isTypedOwner` (the floor under all three) | `typedOwner.ts:62-70` | `{type, id}` | `:67` **USER → `nonEmptyString(v.id)` only.** `:68` COMPANY → `isOperatingCompanyIdShape(v.id)` | **No** |

**Dispatch is at `ownershipCensus.ts:165-172`** — `accountOwner` → (1); `owner` → (3); otherwise
COMPANY → `deriveCompanyOwner`, else → (2). So for the six PERSON families the census reaches
(1), (2) or (3), and each ends at (4).

> **`[CORRECTION TO THE CONTROLLING BRIEF — see §10, C-A]`** The brief named two shape-only person
> derivations. There are **four entry points**, and the third — `deriveStoredOwner` — is the one
> that will read a *backfilled* stored owner on `contacts` and `locations`. A contract covering only
> `deriveAccountOwner` and `deriveEmployeeRefOwner` would leave the backfill's own output
> unmeasured, on the two families whose field existence is itself the highest-consequence UNPROVEN
> (`U-K`).

### 1.1 The person axis has no syntactic floor either — `[OBSERVED AT: 64008d5a]`

`isTypedOwner` applies a **shape regex** to a COMPANY id (`:68` → `/^[a-z][a-z0-9_-]{1,62}$/`,
`operatingCompanyAuthority.ts:71`) and applies **nothing but non-emptiness** to a USER id (`:67`).

| Stored owner | Census outcome today | Why |
|---|---|---|
| COMPANY id `"!!!"` | **`invalid`** (blocking) | fails the shape regex → `deriveCompanyOwner` `INVALID` (`typedOwner.ts:138`) |
| USER id `"!!!"` | **`resolved`** (non-blocking) | passes `nonEmptyString` → `RESOLVED` |

**This is the cheapest non-vacuous observation in the whole contract and it needs no employee data,
no emulator and no Firestore.** It is a *shape* asymmetry, strictly weaker than the referential one,
and it is already enough to show the two axes are not measured by comparable instruments.

---

## 2. CURRENT BEHAVIOUR, PER STATE — re-verified by this lane

### 2.1 The four person-owner states the brief names

`[OBSERVED AT: 64008d5a]` — derived by reading every branch of the four entry points above. There is
**no branch in any of them that could distinguish these four states from each other or from a valid
owner**, because none of them reads the Employee document; the identity of the outcome below is a
property of the control flow, not of a sample.

| Person-owner state | Employee doc read? | Derivation outcome | `UnresolvedCode` | Census bucket | Increments `blocking`? | Appears in `reasons`? | Appears in `samples`? |
|---|---|---|---|---|---|---|---|
| **INACTIVE** (exists, not `ACTIVE`) | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** (`ownershipCensus.ts:190`) | **No** (`:184`) |
| **TERMINATED** (exists, departed) | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** | **No** |
| **DELETED** (document removed) | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** | **No** |
| **NON-EXISTENT** (never existed) | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** | **No** |

**Three consequences of the last three columns, which are usually overlooked:**

1. `censusFamily` skips the reason tally for a resolved document — `ownershipCensus.ts:190`:
   `if (key === "resolved") continue;`. So a person orphan contributes **no reason string**.
2. `samples` has exactly four keys — `invalid`, `unknown`, `ambiguous`, `ownerless`
   (`ownershipCensus.ts:184`). There is **no `resolved` sample list**.
3. Therefore **there is today no channel of any kind — blocking or advisory — by which the census
   could report a person orphan.** It is not that the signal is non-blocking; the signal does not
   exist. `[OBSERVED AT: 64008d5a]`

**Why the ruling O-1 comment is the authority for this, not an accident** — `typedOwner.ts:45-48`,
verbatim at baseline: *"Producing UNKNOWN for an employee id would require a cross-collection
existence lookup, which Owner ruling O-1 explicitly excluded from ownership resolution … So a USER
family's UNKNOWN count is structurally zero, not merely empty."* **The blindness is designed,
documented and attributed to an Owner ruling.** Any proof that changes it is changing a ruling, not
fixing a bug — which is exactly why `OD-6` gates it.

### 2.2 The state vocabulary does not exist to be counted — `[OBSERVED AT: 64008d5a]`

| Enum | Location | Members | Has `INACTIVE`? |
|---|---|---|---|
| `OWNERSHIP_RESOLUTION` | `typedOwner.ts:25-29` | `RESOLVED` · `UNRESOLVED` · `AMBIGUOUS` · `OWNERLESS` | **No** |
| `UnresolvedCode` | `typedOwner.ts:50` | `INVALID` · `UNKNOWN` | **No** |
| `CensusCounts` | `ownershipCensus.ts:44-48`, `emptyCounts()` `:78` | `resolved` · `ownerless` · `invalid` · `unknown` · `ambiguous` | **No** |
| `OperatingCompanyResolutionState` | `operatingCompanyAuthority.ts:54` | `INVALID` · `UNKNOWN` · **`INACTIVE`** · `RESOLVED` | **Yes** |

> **`[CORRECTION — §10, C-B]`** `OD-6`'s recommendation is phrased as *"distinguish `OWNERLESS` ≠
> `UNKNOWN` ≠ `INACTIVE` ≠ `RESOLVED`, as the company axis already does."* **`INACTIVE` exists in
> exactly one enum and it is not on the census side of the boundary.** The company axis **produces**
> `INACTIVE` at `operatingCompanyAuthority.ts:80` and the ownership layer **discards** it
> (§2.3). So the four states named are not four states the census can currently express, and a proof
> that claims parity with "what the company axis already does" would be claiming parity with a
> distinction the ownership layer throws away. **This is a count-vocabulary consequence, not a
> schema consequence** — it changes no stored field. It is stated here because it determines whether
> a fourth or fifth census bucket is part of the acceptance bar, and that is an `OD-6` question.

### 2.3 What COMPANY actually does — the target must not be stated as parity with it

| Step | Location | Behaviour |
|---|---|---|
| The authority **returns** `INACTIVE` | `operatingCompanyAuthority.ts:54` (the type), **`:80`** (`return { state: company.active ? "RESOLVED" : "INACTIVE", company }`) | Active status **is** resolved and **is** reported |
| `deriveCompanyOwner` **discards** it | **`typedOwner.ts:137-143`** — `:137` takes `state`; `:138` handles `INVALID`; `:139` handles `UNKNOWN`; **`INACTIVE` matches neither and falls through to `:140-143`, producing `RESOLVED`** | The distinction the authority computed is dropped one layer up |
| And it is deliberate | `typedOwner.ts:128-130`, verbatim: *"INACTIVE resolves: a record owned by a since-deactivated company still HAS an owner, and calling it unresolved would invite a backfill to reassign it."* | Ruling R-20's accept-in-storage / refuse-in-assignment asymmetry |

**So the COMPANY axis has existence integrity and no active-status integrity.** `[Precision carried
from OWN-E2E and from OD-PACKET-001-006-007 §8 C-4.]`

**The consequence for this contract, and it is the single most load-bearing sentence in it:**

> **"Match what COMPANY does" is an INSUFFICIENT acceptance bar.** Under it, a proof could
> legitimately ship in which an **INACTIVE or TERMINATED** person owner still censuses as
> `RESOLVED`, because that is precisely what an INACTIVE company owner does. That would satisfy
> *existence* and leave *status* — the half of the defect that departure actually produces — intact.
> **The contract therefore requires existence and status to be acceptance-tested separately, and
> permits `OD-6` to rule them differently.** Whether status *should* be distinguished on the person
> axis, given that it deliberately is not on the company axis, is an **`OD-6` question and this
> contract does not answer it** (§7).

### 2.4 Both readings carried, unresolved

| ID | Bears on | Reading A | Reading B | Carried as |
|---|---|---|---|---|
| **C-4 / OWN-E2E precision** | the target semantics | *"the COMPANY axis has referential integrity; the PERSON axis has none"* | *right in direction, too strong in degree* — COMPANY has **existence** only; `INACTIVE` resolves by design | **BOTH. A is the correct summary of the asymmetry; B is the correct statement of the ceiling.** A proof must satisfy A's direction without assuming B's ceiling is the bar |
| **A-1** | what is missing | **ABSENT** — no accountability representation of any kind; `grep -c accountable functions/src/ownership/*.ts` = **0** across all 12 modules | **COLLAPSED** — *"business responsibility belongs to an employee"* (`ownershipMatrix.ts:20`, the PERSON row of the ownerClass legend — **the packet cites `:22`; the line is `:20`**); two things wear one field | **BOTH.** *Absent* is about storage; *collapsed* is about intent. **For the 20 COMPANY families there is no person at all, so nothing can be collapsed into.** This contract must not be read as supplying the missing axis — it measures the person axis EOS already has |
| **O-10** | which field is being measured | `accountOwner` **is an ownership field** — `ownerFields: ["accountOwner"]`, projected by `typedOwner.ts:95-109` | **a Person Assignment map** whose ownership-bearing key is `assignedToEmployeeId` | **BOTH TRUE (`OD-24`).** *The root ownership fact of the person chain is stored inside an assignment record.* **This is the exact field entry point (1) reads**, so the contract's subject is a field whose own identity is contested. **Do not resolve it by inventing a neutral owner field — that is the collapse the Owner forbade** |
| **O-8** | the authority for requiring the check | `record-ownership.md` §2 **requires** the active check — *"reassigning to a departed employee ORPHANS THE RECORD SILENTLY, which is how ownership models rot"* | the same document states the **superseded** creation model (*"whoever creates a record owns it"*), refuted by `creationOwnerResolution.ts:12-23` / ruling D-4 | **BOTH. The document is RIGHT about `OD-6` and SUPERSEDED about creation, and is marked as neither.** Draft, not marked superseded. **Ruling O-1 and this specification point in opposite directions and both stand** |
| **O-1 (matrix row)** | the instrument's other defects | `reorderRequest`'s row is **CORRECTED, NOT STALE** | **STILL STALE** — `reorderCommands.ts:91-92` makes both ids required; `ownerFields: []` is wrong | **BOTH DEFENSIBLE, NO CHOICE MADE.** Carried because the census inherits the description |
| **O-7** | the instrument's other defects | `ownerFields: []` for all five financial families (the financial spread block: `ownershipMatrix.ts:188` `ownerClass: "COMPANY"`, **`:189` `ownerFields: []`** — the packet cites `:182`, which is the id pair `["invoice","invoices"]`) → a company-stamped invoice censuses **OWNERLESS** | factually wrong — `InvoiceRecord.companyId` is required (`invoiceCommands.ts:214`) | **CLOSED AS A MATRIX DEFECT, carried anyway:** it is a **second** way the census mis-measures, on the axis that **does** have integrity. **Fixing the person axis is not the whole of the instrument problem, and a proof that only fixes the person axis must not be reported as "the census is now sound."** |

---

## 3. THE GATE ARITHMETIC — the foundation of the acceptance test

`censusGate`, `ownershipCensus.ts:218-241`, **re-derived by this lane at baseline**:

| Line | Code | Consequence |
|---|---|---|
| `:227-230` | `totals` accumulated over the five `CensusCounts` keys | `resolved` is accumulated but never consulted below |
| **`:231`** | `const blocking = totals.ownerless + totals.invalid + totals.unknown + totals.ambiguous;` | **Four terms. `resolved` is not one of them.** |
| **`:240`** | `assessable: blocking === 0 && unreadable.length === 0 && truncated.length === 0` | The only three ways the gate can go false |

**The proof, stated as arithmetic rather than as a sample:**

> A person orphan in **any** of the four states of §2.1 produces `RESOLVED` → bucket `resolved`
> (`censusBucket`, `ownershipCensus.ts:82`) → increments **none** of `ownerless`, `invalid`,
> `unknown`, `ambiguous` → contributes **0** to `blocking` at `:231`. It is not an `unreadable`
> family and it does not set `truncated`. **Therefore `assessable` cannot go false at any quantity of
> person orphans — one, or every record in all six PERSON families.**

**Why this is the right foundation for the acceptance test:**

| Property | Why it matters |
|---|---|
| **It needs no employee data at all** | The claim is about which counters `blocking` sums, not about any employee. It is decidable from `censusFamily` + `censusGate` over fabricated documents — the mode `functions/test/ownershipCensus.test.mjs` already uses (*"fabricated documents … No emulator, no Firebase, no network"*) |
| **It needs no emulator** | Nothing in §3 is a Firestore Rules claim. `U-N`'s emulator blocker does not reach it |
| **It is quantity-independent** | So the test is a **structural** assertion, not a threshold. A test that asserted "N orphans block the gate" would be weaker and would invite a sample-size argument |
| **It is the gate's own stated failure mode, reached by a second route** | `censusGate`'s comment (`:215-217`): *"A permission or index failure that counted as zero would let enforcement be enabled over records nobody managed to look at."* The person axis reproduces that **not as an unread family but as a family read with a blind instrument.** The number is not wrong; **the number cannot be wrong**, which is worse and is why an unreadable-family check does not cover it |

---

## 4. THE FIVE-WAY DISTINCTION — the acceptance bar

**The eventual proof must distinguish all five. Conflating any two is a failing proof.** The
right-hand column is the part a prior lane's harness lacked: **the observation that would prove the
test is not vacuously passing** (§5).

**Notation.** *Resolver outcome* is stated as a behaviour, in the vocabulary that exists at baseline
where it exists. Where a new distinction is required, the contract says **"a code distinguishable
from every existing one"** and **deliberately does not name a token** — naming one would be design,
and `OD-6` has not ruled whether the distinction lives in the derivation (option (a)), in the census
and gate layer only (option (c)), or nowhere (option (b)). **Distinguishability is the requirement;
the token is not.**

| # | Case | What the resolver must return | What reason code must be distinguishable | What the census must count it as | NEGATIVE CONTROL — the observation that proves the test is not vacuous |
|---|---|---|---|---|---|
| **1** | **VALID PERSON OWNER** — names an existing, `ACTIVE` employee | `RESOLVED`, with the owner present and typed `USER` | **None.** `code` must be `null`, as on every resolved outcome today — the `outcome` helper, `typedOwner.ts:87` (`code: code ?? null`) | **`resolved`** — and it must contribute **0** to `blocking` at `:231` | **The fixture set must contain at least one case-1 record and the run must report `resolved ≥ 1`.** A suite whose only person fixtures are invalid proves that the resolver refuses, not that it *discriminates*. **And it must be asserted that case 1 and case 2 differ in the same run** — two runs with different code paths prove nothing about discrimination |
| **2** | **INVALID / INACTIVE PERSON OWNER** — names an employee that exists but is not `ACTIVE` (`INACTIVE`, on leave, `TERMINATED`) | **NOT `RESOLVED`.** The specific non-resolved outcome is **`OD-6`-gated** (§7). What is contracted: the outcome must be **distinct from case 1 and distinct from case 3** | **A code distinguishable from `INVALID` and from `UNKNOWN`, or an explicit ruled decision to reuse one of them.** Reuse is permissible only if ruled — it must not be arrived at by default, because `INVALID` means *malformed* and this value is well-formed (`typedOwner.ts:36-38`) | **A bucket that contributes to `blocking` at `:231`**, i.e. not `resolved`. If `OD-6` rules that status is advisory rather than blocking, then: a bucket that is **reported**, and `censusGate`'s contract must be amended in the same change so the non-blocking-ness is **declared, not emergent** | **Two observations, both required.** (i) **The same fixture, with the employee's status flipped to `ACTIVE` and nothing else changed, must census as case 1.** A single-status fixture set cannot distinguish "status is checked" from "this id is rejected for another reason". (ii) **`blocking` must be observed to CHANGE** between a run with the case-2 record and a run without it. Asserting the bucket count alone leaves open that the bucket is summed nowhere — **which is exactly the defect being fixed** (`:231` omits `resolved`) |
| **3** | **MISSING PERSON OWNER** — the ownership-bearing field is absent | `OWNERLESS` — the behaviour that already exists, and must be **preserved unchanged**: `typedOwner.ts:97` (`"no accountOwner"`), `:117` (`"no <field>"`), `:201` (`"no <field>"`) | **None.** `code` must remain `null` on `OWNERLESS` — `typedOwner.ts:41-43` states why: *"`null` on a RESOLVED, OWNERLESS, or AMBIGUOUS outcome — those are not failures of lookup"* | **`ownerless`** — already blocking at `:231`. **Must not migrate into the case-2 bucket.** *"No owner"* and *"an owner who cannot act"* are different findings with different remediations and different Owner decisions (`OD-11a` vs `OD-6`) | **The regression direction.** A run over the **existing** fixtures must produce a `ownerless` total **identical** to the baseline run. **Any change is a failing proof**, even an increase — the commonest way to make case 2 blocking is to reclassify some of case 3 into it and report the gate as newly sensitive. **Additionally: case 3 must be provable with no Employee collection in the fixture at all**, which distinguishes it from case 2 by construction |
| **4** | **COMPANY OWNER** — the other axis, untouched | **Exactly what it returns today, byte for byte**: `INVALID` at `typedOwner.ts:138`, `UNKNOWN` at `:139`, **`RESOLVED` for `INACTIVE`** via the fall-through at `:140-143`, `OWNERLESS` at `:136` | **No new code.** The existing two, unchanged | **The same buckets, in the same proportions, as the baseline run** | **A pinned, unchanged COMPANY expectation table, run in the same suite.** Specifically: **an INACTIVE company owner must still census `resolved` after the change.** This is the control that proves the person-axis work did not silently extend status-checking to the company axis and reverse ruling R-20 as a side effect. **It is a negative control in the strict sense: the expected observation is "no change", and a change is the failure** |
| **5** | **NON-OWNABLE / REFERENCE FAMILY** — `REFERENCE` and `EXCLUDED` classes | **Nothing — the resolver must not be reached.** These families are **outside the census population**, by classification: `CENSUS_FAMILIES = ownableFamilies()` (`ownershipCensus.ts:251`), and `ownableFamilies()` admits only `PERSON`, `COMPANY`, `PARTICIPATING_COMPANIES` (`ownershipMatrix.ts:550-554`) | **None, and this is the point.** A reason code here would mean the family was classified, i.e. that it entered a population it must not enter | **Counted in nothing.** Not `resolved`, not `ownerless`, not a new bucket. `censusGate`'s comment (`:245-247`): *"they are not ownerless-in-error, they are not owned, and counting them would report a backlog that no decision could ever clear"* | **Both directions must be asserted, and the existing suite already asserts the pattern** (`ownershipCensus.test.mjs`, *"REFERENCE and EXCLUDED are absent BY CLASSIFICATION, not by omission"*). (i) The census family list must equal the ownable list **exactly**, by set equality both ways — not a subset check, which passes when a family is dropped. (ii) **A `REFERENCE` family carrying a person-shaped owner value must not be counted at all.** Without (ii) a reader cannot tell "excluded" from "scanned and found resolved" — the two are indistinguishable in the totals, and the second is a false clean |

### 4.1 Conflations that are specifically failing proofs

| Conflated pair | Why it fails |
|---|---|
| **1 ≡ 2** | The defect itself. `RESOLVED` for both is exactly `64008d5a` |
| **2 ≡ 3** | Turns "an owner who cannot act" into "no owner", which invites the backfill that `typedOwner.ts:128-130` and ruling R-20 exist to prevent. **Also pre-empts `OD-11a`** (*on departure, what is RELEASED and what is RETAINED?*) by making departure look like release |
| **2 ≡ 4** | Either extends status-checking to companies (**reverses R-20**) or accepts COMPANY's existence-only ceiling for people (**leaves the departure case resolved**). §2.3. **The two axes must be asserted separately in the same run** |
| **3 ≡ 5** | Reports never-owned reference data as an ownership backlog. `ownershipCensus.ts:245-247` names this as the answer a gate must never produce |
| **4 ≡ 5** | Would mean a REFERENCE family entered the ownable population — a matrix-classification error, and it would move `blocking` |
| **1 ≡ 5** | The worst of the five: a false clean. An excluded family and a resolved family are **indistinguishable in the totals**, so the gate reads the same either way |

---

## 5. NON-VACUITY — the hole this contract exists to close

**A prior lane found the inventory capability parity harness could pass vacuously. Re-verified here,
with the mechanism named**, so the same hole is not handed forward:

`functions/test/inventoryWriterCapabilityCensus.test.mjs` iterates a **hand-maintained declaration**,
`WRITER_CAPABILITY_CENSUS`, and asserts properties **of the declaration**. `[OBSERVED AT: 64008d5a]`

| Observation | Line | The hole |
|---|---|---|
| `assert.ok(op.sourceFile.length > 0)` | `:22` | The named source file is asserted to be a **non-empty string**, never to **exist on disk**. **No test opens `op.sourceFile`.** The two `readFileSync` calls in the file target one migration SQL and one named module (`:97`, `:107`), not the census rows |
| Every assertion is `for (const op of WRITER_CAPABILITY_CENSUS)` | `:20`, `:31` | **An operation omitted from the table is invisible to every check.** The harness proves the table is internally consistent; it does not prove the table covers the code it claims to census |
| *"exactly two writer operations are the mechanically-verified HARDCODED_ROLE discrepancy"* | `:43` (name) vs `:45-54` (body) | **The test name says two and the assertion lists four.** A reader auditing by name would record the wrong figure. **A secondary finding, reported and not acted on — outside this lane's surface** |

**The generalised failure and the rule taken from it:**

> **A census proof must never be allowed to assert only over its own declaration.** Every one of the
> five cases in §4 therefore carries a negative control, and **each control is an observation that
> would have to CHANGE if the mechanism were absent.** Three forms are used and each is required
> where it is stated:
>
> | Form | Where used | What it defeats |
> |---|---|---|
> | **Paired fixtures differing in exactly one fact** (case 2's status flip; case 1 vs case 2 in one run) | §4 cases 1, 2 | *"It refuses everything"* masquerading as *"it discriminates"* |
> | **A summed, gate-level observation, not a bucket count** (`blocking` must change) | §4 case 2 | A new bucket that is counted and **summed nowhere** — the literal shape of the `:231` defect |
> | **An expected non-observation** (COMPANY unchanged; `ownerless` total unchanged; REFERENCE counted in nothing) | §4 cases 3, 4, 5 | Collateral change sold as progress, and false cleans |

**Two suite-level non-vacuity requirements, over and above the per-case controls:**

| # | Requirement | Why |
|---|---|---|
| **NV-1** | **The fixture population must be asserted non-empty per case, per run**, in the repository's existing idiom (e.g. `workforceDoesNotDefeatGovernance.test.mjs:52`, `capacityUsesOperableAuthority.test.mjs:60`, `certificationWorldContracts.test.mjs:146` — *"the contracts are not vacuous"*). An empty case-2 fixture set makes the whole of §4 pass | The convention already exists in this repository and the person-axis proof must not be the exception |
| **NV-2** | **A deliberately-broken control run must be shown to FAIL.** The suite must be demonstrated failing when the person-axis check is disabled — i.e. the proof includes evidence of the **red** state, not only the green one | A suite that passes both with and without the mechanism proves nothing, and this is the one property neither the declaration nor the fixtures can establish about themselves |

---

## 6. WHAT MUST REMAIN TRUE — preservation clauses

**A proof that achieves §4 by breaking any of these is a failing proof.**

| # | Must remain true | Location | Why |
|---|---|---|---|
| **P-1** | `OWNERLESS` stays distinct from every unresolved outcome, and keeps `code: null` | `typedOwner.ts:41-43` | *"those are not failures of lookup."* Collapsing them destroys the remediation split the Owner census ruling asked for |
| **P-2** | `INVALID` stays *malformed* and `UNKNOWN` stays *well-formed but unrecognised* | `typedOwner.ts:36-38` | *"They need different remediation, which is why they are not one bucket."* A well-formed id naming a departed person is **neither** |
| **P-3** | An `INACTIVE` **company** owner still censuses `resolved` | `typedOwner.ts:128-130`, `:140-143`; ruling R-20 | Changing it reverses a standing ruling as a side effect of a person-axis change |
| **P-4** | `AMBIGUOUS` still means *two fields resolve to different owners* and is not reachable by a status difference | `typedOwner.ts:151-158` | A person orphan is not an ambiguity. Routing it there hides it behind *"needs a human"* |
| **P-5** | `unreadable` and `truncated` keep blocking independently | `ownershipCensus.ts:225,234,240` | They answer *"we did not look"*, which is a different question from *"we looked and the owner cannot act"* |
| **P-6** | REFERENCE and EXCLUDED stay outside the population | `ownershipCensus.ts:251`, `ownershipMatrix.ts:550-554` | §4 case 5 |
| **P-7** | The 20 COMPANY families gain **no person owner** as a consequence | `ownershipMatrix.ts` | *For the 20 COMPANY families there is no person at all* (A-1). A person-axis measurement change must not become a person-axis **population** change |
| **P-8** | **ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER remain three facts.** No generic owner field, no collapse | `ownershipMatrix.ts` — *"it is why `assignedTechId` is deliberately NOT an ownerField"*; conflict `O-10` | **`OD-1` is unruled.** A proof that measures "the person on the record" without saying which of the three it measures **pre-empts `OD-1`** |
| **P-9** | No cascade. One record, one event | `ownershipHandoffCommand.ts:26` — *"NO CASCADE. The command takes ONE record and produces ONE event"* | `H6`, *"the one test of nine that EOS passes today."* A remediation pass triggered by a newly-visible orphan count is the obvious way to lose it |

---

## 7. PROVABLE TODAY vs `OD-6`-GATED

### 7.1 Provable today, with no ruling, no employee data, no emulator

| # | Claim | Method | Why no ruling is needed |
|---|---|---|---|
| **T-1** | **`blocking` omits `resolved`, so no quantity of `RESOLVED` records can make `assessable` false** | `censusGate` over fabricated reports | Arithmetic over `ownershipCensus.ts:231,240`. Not a statement about employees |
| **T-2** | **All four person-owner states of §2.1 produce `RESOLVED`** | The four entry points over fabricated documents | **Follows from control flow: no branch reads an Employee document.** The four states are indistinguishable *as inputs*, so one fabricated id proves it for all four |
| **T-3** | **A syntactically absurd USER id censuses `resolved`; the same absurdity as a COMPANY id censuses `invalid`** | Fabricated documents, both axes, one run | §1.1. Pure shape asymmetry, `typedOwner.ts:67` vs `:68` |
| **T-4** | **The census has no channel — blocking or advisory — to report a person orphan** | Read `:184` (`samples` keys) and `:190` (`resolved` skips the reason tally) | §2.1. A structural property of `censusFamily` |
| **T-5** | **`INACTIVE` is absent from all three census-side enums** | §2.2's table | Enum membership |
| **T-6** | **REFERENCE / EXCLUDED are outside the population, both directions** | Set equality, `CENSUS_FAMILIES` vs `ownableFamilies()` | Already the pattern in `ownershipCensus.test.mjs` |
| **T-7** | **The baseline `ownerless` / `invalid` / `unknown` / `ambiguous` totals over a fixed fixture set** — the regression floor every §4 control is measured against | One run, recorded | It is a measurement of the current instrument, not a claim about the fix |

> **T-1 through T-7 are the acceptance test's foundation and none of them is gated.** They can be
> written, reviewed and pinned **before `OD-6` is ruled**, and doing so is what makes the eventual
> proof checkable rather than argued. **`OD-6` decides what the resolver must return in case 2; it
> does not decide any of T-1…T-7.**

### 7.2 Unsatisfiable until `OD-6` is ruled

| # | Cannot be specified, still less proven, until `OD-6` rules | Which part of `OD-6` decides it |
|---|---|---|
| **G-1** | **Whether the person-axis check exists at all** | The substance half. Option **(b)** — uphold ruling O-1 — means §4 case 2 has **no resolver behaviour to test**, and the contract's satisfaction condition changes entirely (see G-6) |
| **G-2** | **Where the check lives: the derivation, or the census/gate layer only** | Option **(a)** vs option **(c)**. This decides *which module the acceptance test targets*. `OD-PACKET-001-006-007` records that (a) and (c) rest on the same evidence and that the difference is an **Owner** question, because ruling O-1 was an Owner ruling **about the derivation specifically** |
| **G-3** | **Whether case 2 must be blocking or merely reported** | Not settled by any lane. Under a reported-only ruling, `censusGate`'s contract must be **amended in the same change** so the non-blocking-ness is declared and not emergent (§4 case 2) |
| **G-4** | **Whether EXISTENCE and STATUS are one refusal or two** | §2.3. COMPANY distinguishes existence and **discards** status. Extending existence only is a defensible ruling and leaves the departure case `RESOLVED` — **which is the case the Owner's invariant is about.** The evidence does not settle it |
| **G-5** | **Whether `UNKNOWN` may be reused for a non-existent employee** | `typedOwner.ts:45-48` states a USER family's `UNKNOWN` is **structurally zero** *by ruling*. Making it non-zero **is** the reversal of O-1. It cannot be done as a test-driven detail |
| **G-6** | **What satisfies the contract under `OD-6` = (b)** | Option (b) is not a no-op here. It requires the gate's own documentation to state that **its person-axis zero is structural** — *"otherwise this option is indistinguishable from the current state, which is the defect."* **Under (b) the acceptance bar becomes a documentation and gate-evidence bar, and T-1…T-7 are exactly the evidence it must cite.** The five-way distinction is then a specification of what the census **cannot** do, not of what it must |
| **G-7** | **What an `INACTIVE`/`TERMINATED` person owner should *mean* for the record** | **`OD-11a`, a different row** (*on departure, what is RELEASED and what is RETAINED?*). This contract deliberately specifies **measurement** and not **policy**. A proof must not smuggle a release policy in as a census bucket |

---

## 8. UNPROVEN — nothing in this document was executed

**Every refusal specified above is UNPROVEN BY EXECUTION.** Not one assertion in §4 has been run.

| # | Blocker | Verified how |
|---|---|---|
| **X-1** | **No JRE on this machine** — the Firestore emulator cannot start | `which java javac` returns nothing at baseline |
| **X-2** | **Port 8080 is held by an unrelated process** | `ss -ltnp` → `127.0.0.1:8080 LISTEN users:(("uvicorn",pid=187,…))` |
| **X-3** | **`[NEW — §10, C-C]` Even the pure, emulator-free Node suite cannot run in this worktree.** `functions/node_modules` is **absent**, `functions/lib` is **absent** and untracked (`git ls-files functions/lib` is empty), and the tests import from `../lib/ownership/*.js`, i.e. a `tsc` output that does not exist. No `tsc`, no `esbuild` | `ls functions/node_modules`, `ls functions/lib`, `git --no-pager ls-files functions/lib`, all at `64008d5a` |

> **Consequence, stated plainly: every claim in this document is a STATIC READ of source at
> `64008d5a`.** The brief's blocker was the emulator; **X-3 is a second, independent blocker that
> reaches even T-1…T-7**, which need no emulator. **T-1…T-7 are therefore specified as executable and
> are marked NOT EXECUTED.** They are the first thing to run in an environment that has
> `node_modules` and a build.

| # | Claim this lane could not settle | What would settle it | Bears on |
|---|---|---|---|
| **U-J** | **How many records are person-owned by an employee who no longer exists** | Join owner ids against `employees`, per environment | *"THIS IS THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE."* **Requires Owner authorization; not available to this run.** The contract can be satisfied without it; the **magnitude** cannot be known without it |
| **U-K** | **Whether `contacts.owner` / `locations.owner` exist in FIRESTORE at all** | Read one `contacts` doc per environment | **The highest-consequence UNPROVEN.** Bears directly on §4 case 2 and on entry point (3): **two of the six PERSON families may have no field for the contract to govern.** A proof over `contacts`/`locations` fixtures could therefore pass while governing a field that does not exist where the applier writes |
| **U-1** | **Whether any real person-owner record is in state INACTIVE / TERMINATED / DELETED today** | The `U-J` read | **`[NEW]`** §2.1's table is derived from control flow, so it holds regardless. But **no claim is made here that any orphan exists in any environment** — this is a capability finding, not an incidence finding, and it must not be reported as the latter |
| **U-2** | **Whether the six PERSON families' baseline totals still hold** | Re-run the read-only census | **`[NEW]`** The cited shape-valid counts (100/103 accounts, 337/339 contacts, 180/183 locations, 14/14, 5/5, 17/17) are **2026-09-02 against a 2026-09-12 baseline.** T-7's regression floor must be **re-measured, not cited** |

---

## 9. MISSING INPUT — only the Owner's separate employee-design conversation can answer these

**That conversation is NOT AVAILABLE TO THIS RUN. Nothing below is reconstructed.**

| # | MISSING INPUT | Bears on this contract |
|---|---|---|
| **MI-C** | **What happens on each of the nine departure states.** *"The matrix is ENTIRELY `NO CHANGE` today, which is a description of the gap, not a statement of intent"* | **§4 case 2, decisively.** Whether `TERMINATED` and `INACTIVE` are the **same** census case, or two, is a statement about departure the repository does not contain |
| **MI-J** | **`[NEW]` Which employee fact is authoritative for "this person can no longer act."** `employmentStatus === "ACTIVE"` is what fails closed at `operationalRoleContext.ts:52`, `adminCredentialCommands.ts:183,223` and Rules' `isActiveOperationalRole` — but **that is an operational-capability authority, and whether it is also the ownership-validity authority is an Owner question.** The contract deliberately does **not** assume they are the same fact | **§4 case 2 and `G-4`.** Assuming it would be designing the check, which `OD-6` gates |
| **MI-K** | **`[NEW]` Whether a DELETED employee document and a NON-EXISTENT one are one case or two.** Both census `RESOLVED` today, so the distinction has never had to exist. Hard-deletion vs tombstoning is a lifecycle statement, not a census one | **§2.1 and §4 case 2.** The contract requires both to be distinguished from case 1; it does **not** require them to be distinguished from **each other**, and that gap is recorded rather than closed |
| **MI-A** | **The per-workflow accountable person by job role** | **`OD-1`**, and **P-8**: until it is known, a proof must not describe what it measures as "accountability" |
| **MI-G** | **Whether the three deliberately-ownerless R-7 control Accounts are the ONLY approved exception to the invariant, or a precedent** | **§4 case 3.** It bounds whether some `ownerless` records are **correct** — and if any are, the T-7 regression floor is not simply a number to drive to zero |

---

## 10. CORRECTIONS TO THE CONTROLLING BRIEF — offered because it is in scope and expected

| # | The brief said | Finding at `64008d5a` | Severity |
|---|---|---|---|
| **C-A** | *"`deriveAccountOwner` / `deriveEmployeeRefOwner` are shape-only and never read the Employee document"* | **Correct, and incomplete: there are FOUR person-axis entry points, not two.** `deriveStoredOwner` (`typedOwner.ts:196-210`) is a third shape-only person path — its governance re-check at `:206` is guarded on `type === OWNER_TYPES.COMPANY`, so for a USER owner it falls straight through to `:209` `RESOLVED`. It is the path the census dispatches for the `owner` field (`ownershipCensus.ts:169`), i.e. **`contacts` and `locations`, and the shape a backfill would write.** `isTypedOwner` (`:62-70`) is the fourth, the floor under all three | **MEDIUM** — a contract scoped to the two named functions would leave the backfill's own output ungoverned, on the two families whose field existence is `U-K` |
| **C-B** | *(implicit in `OD-6`'s carried wording)* *"distinguish `OWNERLESS` ≠ `UNKNOWN` ≠ `INACTIVE` ≠ `RESOLVED`, as the company axis already does"* | **`INACTIVE` is not a census-side state and never has been.** It appears in exactly one enum — `OperatingCompanyResolutionState` (`operatingCompanyAuthority.ts:54`) — and is **absent** from `OWNERSHIP_RESOLUTION` (`typedOwner.ts:25-29`), from `UnresolvedCode` (`:50`) and from `CensusCounts` (`ownershipCensus.ts:44-48`, `emptyCounts()` `:78`). So the four states named are not four states the census can express, and the company axis does **not** "already do" this — it computes `INACTIVE` and then discards it (§2.3) | **MEDIUM** — it determines whether a new census bucket is part of the acceptance bar. **Still not schema:** no stored field is implied |
| **C-C** | *"The Firestore emulator cannot run here (no JRE; port 8080 held), so every refusal you specify is UNPROVEN by execution"* | **Confirmed, and there is a SECOND, independent blocker the brief does not name, and it is the one that bites here.** `which java javac` → nothing; `ss -ltnp` → `127.0.0.1:8080` held by `uvicorn` pid 187. **But `functions/node_modules` and `functions/lib` are both ABSENT** (`functions/lib` is untracked — `git ls-files functions/lib` is empty), and `functions/test/*.mjs` import from `../lib/ownership/*.js`, a `tsc` output that does not exist; no `tsc` and no `esbuild` are available. **So even the emulator-free, pure-Node, no-network assertions — T-1…T-7, which need no emulator at all — could not be executed.** The brief's reasoning implies only Rules-level claims are static; in fact **everything in this document is static** | **HIGH** for evidence marking — without it a reader would assume the arithmetic proof was run |
| **C-D** | `resolveOperatingCompany` returns `INACTIVE` at `operatingCompanyAuthority.ts:54,80`; `deriveCompanyOwner` discards it at `typedOwner.ts:137-143`; the gate arithmetic is at `ownershipCensus.ts:218-241` | **All three citations verified exactly, line for line.** `:54` is the state type, `:80` the `company.active ? "RESOLVED" : "INACTIVE"` return; `:137` takes `state`, `:138` handles `INVALID`, `:139` handles `UNKNOWN`, and **`INACTIVE` matches neither and falls through to `:140-143`**; `censusGate` spans `:218-241` with `blocking` at **`:231`** and `assessable` at **`:240`** | **LOW** — confirmation. **The brief's ESTABLISHED FACTS on this point stand without amendment** |
| **C-E** | *"do not write the contract as 'match what COMPANY does' — COMPANY does less than that"* | **Correct, and the asymmetry is wider than stated in a way that helps.** The person axis is weaker than the company axis on **two** counts, not one: it lacks **existence** integrity (the referential point the brief makes) **and** it lacks a **syntactic floor** — `isTypedOwner` applies `/^[a-z][a-z0-9_-]{1,62}$/` to a COMPANY id (`typedOwner.ts:68`) and only `nonEmptyString` to a USER id (`:67`). **A syntactically absurd COMPANY id censuses `invalid` and blocks; the same absurdity as a USER id censuses `resolved`.** This is the cheapest available non-vacuous observation and it is *not* gated by `OD-6`, because it does not require reading any Employee | **MEDIUM** — it hands the eventual proof a test that is provable today and independent of the ruling |
| **C-F** | *(via the packet's citations)* `ownershipMatrix.ts:22` for *"business responsibility belongs to an employee"*; `ownershipMatrix.ts:182` for the financial families' `ownerFields: []` | **Two off-by-a-few citations in the decision packet, both harmless to the findings.** The PERSON row of the `ownerClass` legend is **`:20`**, not `:22` (`:22` is the REFERENCE row). The financial spread's `ownerFields: []` is **`:189`** (with `ownerClass: "COMPANY"` at `:188`); **`:182` is the id pair `["invoice","invoices"]`** inside the spread's input array. **Both findings stand; a reader following the line numbers lands beside them** | **LOW** — citation hygiene |
| **C-G** | *"a person orphan yields `RESOLVED`, incrementing none of the four, so `assessable` cannot go false at any quantity"* | **Confirmed exactly, and the blindness is TOTAL rather than merely non-blocking** — which the brief's phrasing understates. Beyond `:231`, `censusFamily` **skips the reason tally for a resolved document** (`ownershipCensus.ts:190`: `if (key === "resolved") continue;`) and `samples` has **no `resolved` key** (`:184`). **There is therefore no channel at all — not blocking, not advisory, not diagnostic — by which the census could report a person orphan.** A fix that only adds a bucket to `blocking` would be a narrower change than the defect | **MEDIUM** — strengthens the brief's own claim |
| **C-H** | *"a prior lane found the inventory capability parity harness could pass vacuously"* | **Confirmed, mechanism named, plus a defect the prior lane did not report.** `inventoryWriterCapabilityCensus.test.mjs` asserts `op.sourceFile.length > 0` (`:22`) and **never opens the file**; every check iterates the hand-maintained `WRITER_CAPABILITY_CENSUS` (`:20`, `:31`), so **an omitted operation is invisible to all of them.** Separately: the test at **`:43` is named *"exactly two writer operations"* and its body `:45-54` asserts a list of FOUR.** **Reported, not acted on — outside this lane's allowed surface** | **MEDIUM** for the vacuity mechanism (it is the hole §5 closes); **LOW** for the name/body mismatch |
| **C-I** | *"`ownershipCensus` cannot detect invalid PERSON ownership …"* — preserve as a confirmed finding | **Confirmed as stated. One boundary must travel with it:** the person axis is not the census's only mis-measurement. `O-7` (five financial families with `ownerFields: []` at `ownershipMatrix.ts:189`, so a company-stamped invoice censuses `OWNERLESS`) and the `O-1` matrix row (`reorderRequest`, carried both ways) are defects **on the axis that does have integrity.** **So a proof that satisfies this contract must not be reported as "the census is now sound"** — only as "the person axis is no longer blind" | **MEDIUM** — it bounds what the eventual proof may claim |
| **C-J** | *"Verify and document the current behaviour for a person owner in each of these states: INACTIVE · TERMINATED · DELETED · NON-EXISTENT"* | **Done (§2.1), with a precision the four-way framing invites a reader to miss: the four states are indistinguishable AS INPUTS to all four entry points**, because none of them reads the Employee document. **They are therefore ONE observation about control flow, not four independent verifications**, and this document does not claim otherwise. The four-way framing is the right specification of the **target** (the proof must distinguish them) and would be an overstatement of the **evidence** (they were not each separately exercised — nothing was exercised at all, `C-C`) | **LOW** — evidence hygiene, and it is the reason §4 case 2 requires a paired status-flip fixture rather than four fixtures |

**Everything else in the brief's ESTABLISHED-BY-PRIOR-LANES section was re-verified and stands**,
including the shape-only derivations and their line ranges, `deriveCompanyOwner`'s resolve-and-discard,
the gate arithmetic, the six PERSON families (`account`, `contact`, `location`, `opportunity`,
`salesAgreement`, `salesOrder` — `ownershipMatrix.ts:119,127,134,142,155,163`), and the exclusion of
REFERENCE and EXCLUDED families from the census population by classification.

---

## 11. WHAT THIS DOCUMENT DID NOT DO

- **No implementation.** **`OD-6` gates the census fix and it is not implemented here, nor sketched.**
- **No schema.** No field, collection, index, command or code token is proposed. **No generic
  `ownerId`.** Where a new distinction is required, only its **distinguishability** is specified.
- **No collapse.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER stay three facts (**P-8**).
- **No Owner question answered.** `OD-6`'s substance is carried as `G-1`…`G-7`, unruled. `OD-11a`'s
  policy question is carried as `G-7` and **not** answered as a census bucket.
- **No conflict resolved to make the document tidier.** Six are carried with both readings intact
  (§2.4), including the one that undermines the simple framing of this lane's own finding (`C-4`).
- **No standing ruling reversed.** Where satisfying the contract would reverse one — ruling **O-1**
  under `OD-6` (a); ruling **R-20** if status-checking spread to companies — it is named on the
  clause (`G-5`, **P-3**).
- **Nothing executed.** §8. **No production contact, no deploys, no data mutation, no Firestore read
  or write, no secrets requested or exposed.**
- **Nothing written outside this file. Not pushed. No PR.**
