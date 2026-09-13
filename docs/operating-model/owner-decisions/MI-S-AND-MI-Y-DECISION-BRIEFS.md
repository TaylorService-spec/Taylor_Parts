---
artifact_type: owner-decision-briefs
lane: MIS-MIY-BRIEFS
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
decisions_presented: ["MI-S", "MI-Y"]
decisions_answered: none
schema_designed: none
---

# `MI-S` AND `MI-Y` — OWNER DECISION BRIEFS

**OBSERVED AT: `64008d5a`** unless a claim is attributed to a ruling record, in which case the ruling is
cited by **DOCUMENT · ENTRY · HEADING** and quoted. Every repository claim below was read at source in this
worktree or by `git show` against a named ref. Nothing was executed — see §7.

> ## THIS DOCUMENT ANSWERS NEITHER DECISION.
> It presents `MI-S` and `MI-Y` in the shape an Owner ruling needs: the exact question at source, why it
> exists, what EOS does today, what settled rulings already constrain it, what it gates, and every option
> the evidence supports with all nine consequences. **No schema. No migration. No backfill. No Rules
> change. No enum, field, table, column or interface name is proposed.** `#182` withholds those names and
> `#185` states *"Naming is explicitly not frozen by this ruling"* — so only **semantic states and
> capabilities** are named here.
>
> **`MI-ι` is not reopened.** The person-authority target is settled: **CREDENTIAL → PRINCIPAL →
> EMPLOYEE_PRINCIPAL_LINK → EMPLOYEE**; PostgreSQL Employee = business person authority;
> `eos_policy.principals` = security authority; `employee_principal_links` = governed crosswalk;
> Firebase/Firestore sources transitional only; no long-lived dual authority.
>
> **UI/DESIGN consequences below are DESIGN INPUT, not implementation authority.** A revised Employee
> propagation design pass is proceeding separately and this document does not design any surface.

## CITATION DISCIPLINE — why every reference below names a heading, never a section number

A prior ruling record cited *"`MI-ι` §6"* and *"`MI-ι` §11"*. **No `MI-ι` document exists at any ref**; the
section numbers belonged to the Owner's message as delivered, and both citations were withdrawn
(`int/a-correctness-register:docs/DECISIONS.md` **#185**, heading *"Two factual corrections carried into this
entry"* and the paragraph beginning *"Enumerated here deliberately"*). **This document therefore cites every
ruling clause by the heading it sits under inside its `DECISIONS.md` entry**, and every repository claim by
`file:line`. Where something could not be located at source it says **NOT LOCATABLE AT SOURCE** and names
what was checked.

---

## 0. THE `MI-X` DECISION-ID COLLISION — VERIFIED INDEPENDENTLY, AND THE TRUE GATED-ITEM COUNTS

### 0.1 `MI-S` is CLEAN — confirmed exactly

| Check | Result |
|---|---|
| Occurrences of `MI-S` across all local and remote refs, `docs/` only | **27 lines, all on `ext/own-engineering-gap`** — `PERSON-AUTHORITY-TARGET-MODEL.md` **6** + `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` **21**. `origin/ext/own-engineering-gap` carries **3** of them (the branch is ahead of origin); no other ref carries any |
| Competing definitions | **none.** Every occurrence is the same question |
| Canonical statement | `ext/own-engineering-gap:docs/operating-model/architecture/PERSON-AUTHORITY-TARGET-MODEL.md:1083` — *"Is state **B** a distinct resolution outcome, or `RESOLVED` + a separately carried eligibility fact — and must INACTIVE be distinguishable from TERMINATED inside it?"* Gating recorded there as *"**B**, **G**, **H**, and 10 of the 42 register items"* |

**The Owner's census of `MI-S` is correct in every particular. No correction.**

### 0.2 `MI-X` IS a collision — confirmed, and it was already flagged at source twice

| Sense | The decision | Where it is defined | Status |
|---|---|---|---|
| **Sense 1** | Which collection is *the* person authority | `ext/own-engineering-gap:docs/operating-model/owner-decisions/MI-X-PERSON-AUTHORITY-OPTIONS.md:17` — *"`MI-X` — WHICH COLLECTION IS *THE* PERSON AUTHORITY"*; 511 lines, six candidates, `RECOMMENDATION: NONE` | **CLOSED by `MI-ι` / #185** |
| **Sense 2** | *"Which of `MI-P`'s **two** acceptable architectures?"* | `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1212` | **OPEN — and the sense that gates items** |

The collision was flagged at source before this lane, twice, and **not resolved** either time:

- `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1491-1494` — *"**Label collision, flagged not resolved:**
  **`MI-X` denotes two different things** … §21 uses `MI-X` **only** in the §17 sense. This is the same class
  of problem `MI-α` already registers and the Owner should settle with it."*
- `…PERSON-AUTHORITY-TARGET-MODEL.md:1086` — *"OPEN. **Note the label collides** with
  `MI-X-PERSON-AUTHORITY-OPTIONS.md`; `MI-α` should settle it."*
- And the packet named its own collision on its first page: `MI-X-PERSON-AUTHORITY-OPTIONS.md:37` —
  *"**`MI-X` IS ALREADY TAKEN, AND MEANS SOMETHING ELSE**"*, filing itself under the colliding label as
  instructed and raising **`MI-α`** rather than renaming itself.

### 0.3 The resolution, and one correction to the Owner's account of it

**`MI-Y` is free and the rename is now canonical.** Used ids across `ext/own-engineering-gap`,
`ext/own-decision-packet`, `int/a-correctness-register`, `emp/own-synthesis` and `ext/census-acceptance` are
`MI-A`…`MI-K`, `MI-N`, `MI-P`…`MI-X`, and `MI-α`…`MI-λ`. **`MI-L`, `MI-M`, `MI-O`, `MI-Y` and `MI-Z` are
unused.** `MI-Y` is therefore free, as the Owner said.

> **CORRECTION — the rename is no longer this lane's to make; it has already been recorded.**
> `int/a-correctness-register:docs/DECISIONS.md:7104-7135`, under the heading **"Register hygiene — `MI-X`
> DECISION-ID COLLISION, resolved 2026-09-13"**, already records the identical mapping and the identical
> resolution: *"**Resolution: the open sense-2 decision is renamed `MI-Y`**"* and *"**`MI-X` is RETIRED AS
> AMBIGUOUS, not overwritten.**"* That entry states it is **not an Owner ruling** but a citation-integrity
> correction. **This brief conforms to it rather than re-deciding it**, and the `MI-Y` grep hit on that
> branch is that record, not a prior distinct use of the label.

**Historical mapping, recorded explicitly as the lane contract requires:**

| Reading `MI-X` in an artifact written before 2026-09-13 | Resolve it to |
|---|---|
| person-authority **source** question | **sense 1 — CLOSED by `MI-ι` / #185.** The canonical Employee authority is the PostgreSQL Employee relation |
| `MI-P`'s **census architecture** choice | **sense 2 — now `MI-Y`. OPEN** |

**`MI-X` is RETIRED AS AMBIGUOUS, NOT OVERWRITTEN.** Both senses stay readable in their source documents.
Nothing on any branch was edited to erase either.

### 0.4 THE TRUE GATED-ITEM COUNTS — `MI-S` = 10, `MI-Y` = 7. The seventh is `OI-05`.

The Owner asked whether **7** is right for the census-architecture decision, noting that `:1212` + `:1358`
yield **6**. **Answer: 7 is CORRECT at source, but the Owner's set of six and the register's set of seven are
not the same items.** Both the §17 prose row and the Owner's reading omit members the register's own
per-item blocker rows and its tally include.

**The authoritative tally is `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1415-1416`** (§21.1, *"Which Owner
decision blocks how many"*), and it is consistent with the twelve per-item rows at `:1358`-`:1396`:

| Decision | Count at `:1415`/`:1416` | Items named there |
|---|---|---|
| **`MI-S`** | **10** | `OI-06`, `OI-07`, `OI-10`, `OI-11`, `OI-21`, `OI-30`, `OI-31`, `OI-35`, `OI-37`, `OI-40` |
| **`MI-Y`** *(as `MI-X` sense 2)* | **7** | `OI-02`, `OI-03`, `OI-32`, `OI-35`, `OI-37`, `OI-40`; **`OI-05` secondarily** |

**The seventh is `OI-05`**, and the register says so in that cell verbatim — *"`OI-05` secondarily"*. Its
per-item row confirms the route: `:1361` — *"**OI-05** | A | **BLOCKED BY OWNER DECISION — `OD-16`** (+
`MI-X` via `OI-02`)"*. So `OI-05` is gated **primarily by `OD-16`** and **secondarily by `MI-Y` through
`OI-02`**, which is why it is the seventh rather than a seventh peer. **Nothing was padded to reach 7.**

**Two discrepancies inside the source, carried both ways rather than resolved:**

| # | Discrepancy | Reading A | Reading B |
|---|---|---|---|
| **D-1** | **`OI-10`.** The §17 row at `:1212` names it — *"`OI-03`, **`OI-10`**, `OI-37`, `OI-40` all hang off which"* — but its own blocker row at `:1366` reads **`MI-U`, `MI-S`** with no `MI-X`, and the `:1416` tally omits it from the `MI-X` list while including it in `MI-S`'s and `MI-U`'s | `OI-10` **is** `MI-Y`-gated: §12.4's `OI-10` row states *"**OI-10 now depends on OI-32**"*, and `OI-32` is `MI-Y`'s item. On this reading the tally under-reports | `OI-10`'s **blocker** is the state set (`MI-S`/`MI-U`); its **dependency** on `OI-32` is a sequencing fact, not an Owner gate. On this reading the tally is right and `:1212`'s prose is loose |
| **D-2** | **`OI-35`.** In the `:1416` tally and at `:1391` (*"BLOCKED BY OWNER DECISION — `MI-X`, `MI-S`"*), absent from `:1212`'s prose | `:1212` is a summary row and incomplete | — no competing reading; `:1391` is the per-item authority and `:1212` simply does not enumerate exhaustively |

**Consequence for the Owner:** the set to rule against is the seven at `:1416`. If reading D-1(A) is
preferred, ruling `MI-Y` unblocks **eight** items, not seven — `OI-10` moves from *dependency* to *gate*.
Either way the number is **7 or 8, never 6**, and the Owner's shorthand of 7 was right.

**`MI-S` = 10 is exact and needs no correction.** `…PERSON-AUTHORITY-TARGET-MODEL.md:1083`'s *"10 of the 42
register items"* and `:1415`'s enumeration agree item-for-item.

---

# 1. `MI-S` — DECISION BRIEF

## 1.1 EXACT QUESTION — quoted at source

> **`ext/own-engineering-gap:docs/operating-model/architecture/PERSON-AUTHORITY-TARGET-MODEL.md:1083`**
>
> *"Is state **B** a distinct resolution outcome, or `RESOLVED` + a separately carried eligibility fact — and
> must INACTIVE be distinguishable from TERMINATED inside it?"*

Stated at greater length, with its evidence, at
**`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1207`**:

> *"Is `#182`'s state **B** a distinct resolution outcome, or `RESOLVED` plus a separately carried eligibility
> fact? **And must INACTIVE be distinguishable from TERMINATED inside it?** `#182` groups *"INACTIVE /
> TERMINATED / FORMER"*; `C-B3` insisted on **distinct reasons** *"because the remediation is opposite — one
> owner returns, one never does"*."*

**State B is defined by ruling, not by this brief.** `int/a-correctness-register:docs/DECISIONS.md` **#182**,
heading *"3. Required person-reference states — a SEMANTIC contract"*:

> | **B** | `VALID_HISTORICAL / NOT_CURRENTLY_ELIGIBLE` | Employee exists, historical reference remains valid,
> person not eligible to receive new/current accountability (inactive · terminated · former) |

and, in the same subsection: *"**Exact enum and schema names are NOT authorized by this ruling.**"*

**`MI-S` therefore has two parts, and they are separable.** This brief treats them as two axes:

| Axis | The question |
|---|---|
| **S-REP** | **Representation.** Is B an outcome the authority returns, or a `RESOLVED` outcome plus a separately carried eligibility fact? |
| **S-GRAIN** | **Grain.** Inside B, must INACTIVE be distinguishable from TERMINATED? |

## 1.2 WHY THIS QUESTION EXISTS

| # | Cause | Evidence |
|---|---|---|
| **1** | **`#182` created state B and withheld its representation.** It named four semantic states and then declined to authorize names or shapes | **#182**, heading *"3. Required person-reference states"*: *"Exact enum and schema names are NOT authorized by this ruling."* **#185**, heading *"Interim path — no big-bang migration"*: *"Naming is explicitly not frozen by this ruling."* |
| **2** | **`#182` split the contract into two layers and put eligibility in the census, not the resolver** | **#182**, heading *"OD-6 RULED AND CLOSED"* table: Layer 1 *"belongs in"* **authoritative person-reference resolution / derivation**; Layer 2 *"belongs in"* **the accountability / responsibility census and enforcement gate** |
| **3** | **`#185` then listed B among the states the resolution PORT must return** — which pulls it back toward the resolver | **#185**, heading *"Interim path — no big-bang migration"*: *"must return semantic states supporting `OD-6` — VALID CURRENT · **VALID HISTORICAL / NOT CURRENTLY ELIGIBLE** · INVALID / MISSING · AUTHORITY UNAVAILABLE if later ruled separately."* **This is the tension `MI-S` sits in, and §1.7 carries it as a live conflict** |
| **4** | **The shipped outcome type has nowhere to put a non-shape fact** | `functions/src/ownership/typedOwner.ts:41-43` — *"`null` on a RESOLVED, OWNERLESS, or AMBIGUOUS outcome — those are not failures of lookup"*; the `outcome` helper forces `code: code ?? null` at `:87`. A "resolved but not eligible" fact has **no field** |
| **5** | **A prior lane's recommendation (`C-B3`) and the ruling's own grouping disagree about grain, and the ruling declines to adjudicate** | `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:822` — *"`#182` explicitly groups INACTIVE / TERMINATED / FORMER — so Part I's insistence on distinct reasons inside one state is **compatible but not ratified**; the ruling neither requires nor forbids the distinction."* |
| **6** | **The COMPANY axis has already run this exact experiment and chose the opposite of what B implies, deliberately** | §1.4 below. `typedOwner.ts:128-130`, and `int/a-correctness-register:docs/integration/int-a-correctness-register.md:588-614` (**§12.3.C**), which says in terms *"the answer for the person axis should not be chosen while the company axis's answer is undecided"* |

## 1.3 WHAT CURRENT EOS DOES — `[OBSERVED AT: 64008d5a]`

**There is no state B at the baseline. There is no state A, C or D either — every person-owner condition
produces one outcome.**

| Person-owner condition | Employee document read? | Derivation outcome | `code` | Census bucket | Contributes to `blocking`? | Reportable at all? |
|---|---|---|---|---|---|---|
| exists, `ACTIVE` | **No** | `RESOLVED` | `null` | `resolved` | **No** | — |
| exists, `INACTIVE` | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** |
| exists, `TERMINATED` | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** |
| document deleted | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** |
| never existed | **No** | `RESOLVED` | `null` | `resolved` | **No** | **No** |

**The mechanism, line by line:**

| Fact | Location |
|---|---|
| The person arm of the shape guard is `nonEmptyString` **only**; the company arm applies a format regex | `functions/src/ownership/typedOwner.ts:67` vs `:68` |
| A resolved bucket is chosen by resolution alone | `functions/src/ownership/ownershipCensus.ts:81-82` |
| `blocking` sums **four** terms and `resolved` is not one of them | `ownershipCensus.ts:231` — `totals.ownerless + totals.invalid + totals.unknown + totals.ambiguous` |
| `assessable` can go false only three ways, none of them a resolved person orphan | `ownershipCensus.ts:240` |
| A resolved document contributes **no reason string** | `ownershipCensus.ts:190` — `if (key === "resolved") continue;` |
| `samples` has four keys and **no `resolved` list** | `ownershipCensus.ts:184` |
| The vocabulary to express B does not exist: `OWNERSHIP_RESOLUTION` = `RESOLVED`·`UNRESOLVED`·`AMBIGUOUS`·`OWNERLESS`; `UnresolvedCode` = `INVALID`\|`UNKNOWN` | `typedOwner.ts:25-29`, `:50` |
| `INACTIVE` exists in exactly one enum, on the **company** side | `functions/src/ownership/operatingCompanyAuthority.ts:54` |
| The blindness is **designed and attributed to an Owner ruling** | `typedOwner.ts:45-48` — *"Producing UNKNOWN for an employee id would require a cross-collection existence lookup, which Owner ruling **O-1** explicitly excluded from ownership resolution … So a USER family's UNKNOWN count is structurally zero, not merely empty."* |

> **Therefore there is today no channel of any kind — blocking, advisory or diagnostic — by which EOS can
> report a person reference in any of states B or C.** `ext/census-acceptance:docs/operating-model/engineering/PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md`
> §2.1 states this as its third consequence and §7.1 `T-4` makes it provable with no employee data.
> **#180**, heading *"What this ruling does NOT do"*, states the same in ruling voice: *"**Invariant 1 is not
> currently detectable.** At `64008d5a` the ownership census cannot report an invalid person owner through
> any channel — blocking, advisory or diagnostic."*

**The eligibility fact B would have to read already exists, and it has six members, not two.**
`EMPLOYMENT_STATUS_VALUES` at `functions/src/access/employeeProfileCommands.ts:122-129` is `ACTIVE`,
`ON_LEAVE`, `INACTIVE`, `TERMINATED`, `RETIRED`, `CONTRACTOR`. **It is a measured input to `MI-S`'s grain
question, not a proposal** — `…PERSON-AUTHORITY-TARGET-MODEL.md:814` (item **B**) says so explicitly: *"it is
**not proposed here as R1's vocabulary**; it is the measured input to the Owner's choice."*

**And three shipped counter-examples prove an existence-plus-status check is already idiomatic in this
codebase** (`…PERSON-AUTHORITY-TARGET-MODEL.md:620`): `assignedDriverEmployeeId` checks existence **and**
`ACTIVE` (`truckRegistryCommands.ts:277`, `truckRegistryRepository.ts:196-200`); `managerEmployeeId` checks
existence (`employeeProfileCommands.ts:531-541`); scheduling checks technician existence
(`placementPolicy.ts:82`, `TECHNICIAN_NOT_FOUND`). **So `MI-S` is not asking whether the check is feasible.
It is asking what the answer must be shaped like.**

## 1.4 WHAT SETTLED OWNER RULINGS ALREADY CONSTRAIN — and what they leave open

**CLOSED and binding:** `OD-1` (#180) · `MI-N` (#181) · `OD-6`, `MI-P`, `MI-Q`, `MI-R` (#182) · `M-4` (#183)
· `OD-7` (#184) · `MI-ι` (#185).

| Constraint on `MI-S` | Ruling · heading · text |
|---|---|
| **B must exist as a distinguishable condition.** It may not collapse into C | **#182**, *"2. Historical person references"*: *"**INACTIVE · TERMINATED · FORMER EMPLOYEE are NOT the same condition as NON-EXISTENT / INVALID.**"* |
| **B must not be represented by the existing unresolved outcome** | **#182**, same heading: *"`UNRESOLVED` must **NOT** be the automatic representation for every inactive or terminated employee — that would destroy the distinction between *'this person existed and historically held responsibility'* and *'this person reference is invalid.'*"* |
| **The historical reference must be preserved, and history must not be rewritten** | **#182**, same heading: EOS *"**must preserve the historical reference**"* and must not rewrite historical record ownership, accountability or attribution. **#180**, invariant 6: *"Historical accountability must remain auditable."* **#181**, *"Transfer rules"*: *"**HISTORICAL REMAINS HISTORICAL. FUTURE WORK FOLLOWS CURRENT GOVERNED AUTHORITY.**"* |
| **B must block NEW responsibility.** Whatever its shape, it may not qualify a person for new accountability | **#182**, *"5. Creation / inheritance consequence"*: *"an inherited person reference must satisfy the applicable CURRENT eligibility contract … must **not** treat a structurally `RESOLVED` but inactive, terminated, deleted or non-existent person as automatically suitable for **new** responsibility. … **The word VALID is load-bearing. It may not be implemented using today's shape-only USER resolution.**"* |
| **B must be measurable without being treated as current actionability** | **#182**, *"9. Census / enforcement gate"*: *"Historical references remain **measurable without being treated as current actionability**."* |
| **Eligibility's floor is governed employment/person status, and no more** | **#182**, *"4. Current accountability eligibility — `MI-R` CLOSED"*: eligibility must *"at minimum … consider **governed employment / person status**"* and must **not** be *"has the capability to perform the assigned command."* Further constraints are *"**per family — do not invent them globally.**"* |
| **A handoff to a B-state target must refuse before write** | **#183**, *"The handoff-boundary responsibility"* and *"Atomicity"*: refuse before write, *"zero responsibility mutation · zero partial handoff · zero responsibility gap"* |
| **The resolution happens once, at the governed orchestration boundary** | **#184**, *"Division of responsibility"* and *"Why no second authority lookup in the writer"* |
| **B must ultimately be established against the PostgreSQL Employee authority** | **#185**, *"`OD-6` Layer 1 consequence"*: Layer 1 must establish *"employee exists · employee identity is authoritative · **employee status** · historical identity preservation · current eligibility facts required by the caller."* |
| **No backfill may be used to "fix" B-state references** | **#182**, *"10. Backfill"*: *"**Backfill is NOT the mechanism for fixing historical inactive or terminated references** … **No backfill authorized.**"* |
| **Names are not authorized** | **#182** *"3."*; **#185** *"Interim path"* |

**What the rulings deliberately do NOT settle, and therefore what `MI-S` is:**

1. **Whether B is returned by the resolution layer or carried beside a `RESOLVED` result.** #182 places
   eligibility in the census/gate layer; #185 lists B among the port's return states. **Both texts are
   binding and they point different ways** — carried as conflict **`K-1`** at §1.7.
2. **Whether INACTIVE and TERMINATED are one condition, one condition with two reasons, or two conditions.**
   `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:822`: *"the ruling neither requires nor forbids the
   distinction."*
3. **Whether B blocks the enforcement gate or is merely reported.** `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md`
   §7.2 **`G-3`**: *"Whether case 2 must be blocking or merely reported … Not settled by any lane. Under a
   reported-only ruling, `censusGate`'s contract must be **amended in the same change** so the
   non-blocking-ness is declared and not emergent."*
4. **Whether EXISTENCE and STATUS are one refusal or two.** Same contract, **`G-4`**: *"COMPANY distinguishes
   existence and **discards** status. Extending existence only is a defensible ruling and leaves the
   departure case `RESOLVED` — which is the case the Owner's invariant is about. **The evidence does not
   settle it.**"*

**THE STRONGEST SINGLE PIECE OF EVIDENCE BEARING ON `MI-S`, AND IT CUTS BOTH WAYS.** EOS has already decided
this question on the COMPANY axis, in the opposite direction, on purpose:

| Step | Location | Behaviour |
|---|---|---|
| The company authority **computes** and **returns** an inactive state | `operatingCompanyAuthority.ts:54` (the type), `:80` (`company.active ? "RESOLVED" : "INACTIVE"`) |
| `deriveCompanyOwner` **discards** it | `typedOwner.ts:137-143` — `:138` handles `INVALID`, `:139` handles `UNKNOWN`, **`INACTIVE` matches neither and falls through to `RESOLVED`** |
| And it is deliberate, with a stated reason | `typedOwner.ts:128-130`, verbatim: *"**INACTIVE resolves: a record owned by a since-deactivated company still HAS an owner, and calling it unresolved would invite a backfill to reassign it.**"* |
| A **fourth** site accepts INACTIVE by a different mechanism | `typedOwner.ts:206` re-checks a COMPANY owner as `resolveOperatingCompany(value.id).company === null`; an inactive company **has** a company object, so it **passes**. `int-a-correctness-register.md:588-614` calls this *"emergent at this one, not declared"* |
| A **fifth** site accepts INACTIVE explicitly, with the historical-integrity reason | `commercialCompanyScope.ts:63-68` — *"a record booked to a company that has since been deactivated still landed on that company's books, and rejecting it would rewrite history to tidy a registry"* |

> **`int-a-correctness-register.md` §12.3.C carries both readings and picks neither**, and closes: *"**This is
> an OD-6 input, not an engineering fix**, because the whole question OD-6 asks is what a resolver owes the
> census about an owner's current validity — and **the answer for the person axis should not be chosen while
> the company axis's answer is undecided.** Do not 'fix' this before OD-6."*
>
> **And `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` §2.3 states the ceiling this implies, in its own words
> the single most load-bearing sentence in it:** *"**'Match what COMPANY does' is an INSUFFICIENT acceptance
> bar.** Under it, a proof could legitimately ship in which an **INACTIVE or TERMINATED** person owner still
> censuses as `RESOLVED`, because that is precisely what an INACTIVE company owner does."* Its preservation
> clause **`P-3`** makes the converse binding too: *"An `INACTIVE` **company** owner still censuses
> `resolved`"* — changing it *"reverses a standing ruling as a side effect of a person-axis change."*

## 1.5 WHICH IMPLEMENTATION ITEMS `MI-S` GATES — 10, from source

From `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1415` and the per-item rows at `:1362`-`:1396`. **All 42
items carry `IMPLEMENTATION STATUS = NOT AUTHORIZED`** (#185, *"Status"*).

| Item | Area | What `MI-S` blocks in it | Per-item row |
|---|---|---|---|
| **`OI-06`** | B | The port's **return set** cannot be specified | `:1362` — also `MI-U`; *"Placement inverted — see §20.2(a)"* |
| **`OI-07`** | B | **This item *is* the state table.** `MI-S` is literally one of its two unresolved rows | `:1363` — also `MI-U` |
| **`OI-10`** | B | New outcomes need their **own counts** and a **declared** gate constant; which counts exist depends on the state set | `:1366` — listed as `MI-U`, `MI-S` |
| **`OI-11`** | B | Layer 1's parity question is answered (trusted-side-only by construction, `typedOwner.ts:1-8`); **Layer 2's representation is `MI-S`** | `:1367` |
| **`OI-21`** | D | Under `#182` one refusal becomes two in two layers; the **terminated** target is a Layer-2 refusal whose representation is exactly `MI-S` | `:1377` |
| **`OI-30`** | B | The accountable Layer-1 contract *does not exist at all* (**V-5**: 0 hits / 12 modules), so every part of it is a name #182 and #185 decline to fix | `:1386` — also `MI-U` |
| **`OI-31`** | B | **Layer 2 must distinguish A from B while preserving the reference.** `MI-S` is that representation; `MI-J` is the predicate | `:1387` — also `MI-J` |
| **`OI-35`** | A | The accountable-person fact has no validity representation | `:1391` — also `MI-Y` |
| **`OI-37`** | D | The step must assert the accountable person is **not** in state B, C or D at commit | `:1393` — also `MI-Y` |
| **`OI-40`** | A+B | The weld proof (`#182` proof 10) needs the accountable reference | `:1396` — also `MI-W`, `MI-Y` |

**Plus three of the ten prepared PostgreSQL work items** — `…PERSON-AUTHORITY-TARGET-MODEL.md:1083`: **B**
(Employee status model, `:814`), **G** (the person-resolution port, `:890`), **H** (`OD-6` acceptance tests,
`:905`). Item **H**'s own row states why: *"the suite cannot assert against a state set that is not fixed."*
Item **C** (historical retention, `:829`) records the boundary: *"`MI-S` governs how state **B** is
*represented*, not whether history is *retained*."*

**Register-side shorthand for the same ten:** `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1423-1424` —
*"**`MI-S` and `MI-X` between them gate more than half the register, and neither is a large question.** `MI-S`
is one sentence about whether state **B** is an outcome or a carried fact."*

## 1.6 WHICH OBJECT / WORKFLOW FAMILIES `MI-S` AFFECTS

**The families whose RECORD-OWNER person reference exists today — six PERSON families**
(`ownershipMatrix.ts:119`, `:127`, `:134`, `:142`, `:155`, `:163`): `account` · `contact` · `location` ·
`opportunity` · `salesAgreement` · `salesOrder`.

**The accountability envelope `MI-S` will also govern once the axis exists — nine, or twelve**
(`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:772-806`, §12.2c):

| Class | Members | Count |
|---|---|---|
| COMPANY, liveness settled | `workOrder` · `reorderRequest` · `receivingOrder` · `cycleCount` · `invoice` | 5 |
| PARTICIPATING_COMPANIES | `transferOrder` | 1 |
| PERSON — commercial chain | `opportunity` · `salesAgreement` · `salesOrder` | 3 |
| **RE-DERIVED MINIMUM** | | **9** |
| CONTESTED ADJACENT (factual liveness, never T3) | `purchaseOrder` (`MI-14`/`U-4`) · `reorderPurchaseOrder` · `workOrderLegacy` (`U-5`) | 3 |
| **ENVELOPE IF ALL THREE RESOLVE LIVE** | | **12** |

**And the fifteen person references `MI-V` asks whether Layer 1 reaches**
(`…PERSON-AUTHORITY-TARGET-MODEL.md:597-620`) — among them `creditedSalespersonId` (8 sites),
`responsibleEmployeeId`, `assignedToEmployeeId`/`assignedToUserId` on coverage, `actorEmployeeId`,
`personaEmployeeId`, `requestedBy`, and the six PostgreSQL `owner_employee_id` columns. **`MI-V` is a separate
open Owner decision; `MI-S`'s answer sets what those references would return if extended.**

### 1.6a UI / DESIGN CONSEQUENCES — **DESIGN INPUT ONLY, NOT IMPLEMENTATION AUTHORITY**

Recorded because state B is the one state that is *legitimate and must still be visible*. **A revised
Employee propagation design pass is underway separately. Nothing below is designed here.**

| Surface | Consequence of B existing at all (shape-independent) |
|---|---|
| **Employee Profile** | A former employee's profile must remain reachable, because records still legitimately reference them. A design must distinguish *"this person's record is historical"* from *"this person is missing"* |
| **My Dashboard** | Work whose accountable person is in B must be visible **to someone**; whose dashboard it appears on is `OD-11a` (release/retain), not `MI-S` |
| **Dispatch** | Two different refusals now exist for one gesture — *target not eligible* (B) vs *target does not resolve* (C). If they render identically, the operator cannot tell a departure from a data error |
| **Service · Sales · Parts/Purchasing · Warehouse** | Historical attribution must still render the person's name. `financialAttribution.ts:225` freezes the snapshot and `:184` calls it *"history, not state"* — so a historical display is already the intent; what changes is that an eligibility answer becomes available beside it |
| **Lists / Search** | An eligibility state implies a filter dimension that does not exist. **Whether it is user-visible at all is `OD-10`** (*"Is company ownership intended to be a USER-VISIBLE fact, or an INTERNAL SCOPING KEY only?"* — `emp/own-synthesis:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md:142`), whose own note says it *"MUST BE ANSWERED BEFORE THE CENSUS GATE, because a fact nobody can see cannot be verified by the people accountable for it"* |
| **Mobile** | `typedOwner.ts:1-8` is a **client parity mirror** that cannot perform a trusted read. **#182**'s Layer 1 is therefore trusted-side-only by construction, so the client's obligation is to **render** the state, never compute it (`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1367`, `OI-11`) |

## 1.7 CONFLICT `K-1` — carried with both readings, as required

| | Reading (i) — **B is a resolution outcome** | Reading (ii) — **B is `RESOLVED` + a carried fact** |
|---|---|---|
| **Ruling text relied on** | **#185**, *"Interim path"*: the port *"must return semantic states supporting `OD-6` — VALID CURRENT · **VALID HISTORICAL / NOT CURRENTLY ELIGIBLE** · INVALID / MISSING"*. B is named as a **returned state of the resolution interface** | **#182**, *"OD-6 RULED AND CLOSED"* table: Layer 2 — *"can this person currently be accountable?"* — *"belongs in the accountability / responsibility **census and enforcement gate**"*, not in resolution |
| **Structural support** | `#185`'s own storage-hiding clause requires the port's answer to be semantic, and an eligibility answer that is not part of the return value has to travel some other way, which reintroduces a storage-shaped or out-of-band channel | `typedOwner.ts:41-43`/`:87` have **nowhere** to put a non-shape fact today; `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:839-873` (§12.3c) records the two-layer split as **discharging** that obstruction precisely by moving the fact out of `OwnerDerivation` |
| **What it makes of `OI-07`** | `OI-07` stays the full state table | `OI-07` **narrows to Layer 1 (A-vs-C)**, which §12.3c consequence 1 states as the ruling's effect: *"TERMINATED/INACTIVE is **not** the resolver's job under `#182`"* |
| **Status** | **BOTH STAND.** Both texts are binding rulings. The conflict is not resolvable from evidence and is the core of `MI-S` |

**Subsidiary conflict `K-2`, already in the record and now resolvable — see §9, correction `E-1`.**
`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:825-838` (§12.3b) carries three readings of whether `#182`
ratifies, refines or removes `C-B3`'s TERMINATED row, and its third — **`R-III`** — is attributed to the
acceptance contract on `ext/census-acceptance` and marked *"**NOT VERIFIED BY THIS LANE.** That branch was not
read … Carried as a live disagreement between two lanes"* (`U-13`). **This lane read that branch. `R-III` as
reported is wrong.** §9 `E-1`.

## 1.8 OPTIONS — axis S-REP (representation)

**`S-REP-1` — B IS A DISTINCT OUTCOME RETURNED BY THE PERSON-AUTHORITY PORT.** A is not B; B is not C; the
caller receives one semantic answer that already carries the eligibility verdict.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | *"This person exists and this reference is a real historical fact, and this person may not be given new responsibility"* is **one business answer**, delivered once. A caller cannot obtain the existence half without the eligibility half |
| **DATA MODEL** | **No stored field changes.** The change is to a **return contract**, not to storage. It does require the port's answer to be able to express more than the four members of `OWNERSHIP_RESOLUTION` (`typedOwner.ts:25-29`); `code` cannot carry it, because `:41-43` reserves `null` for non-lookup-failures and `UnresolvedCode` (`:50`) has two members meaning *malformed* and *unrecognised*, and B is neither |
| **AUTHORITY** | Consistent with **#185**'s return-state list. **In tension with #182**'s placement of Layer 2 in the census/gate (conflict `K-1`). It concentrates both layers behind one port call, which **#184**'s *"resolve every authoritative fact the handoff requires"* (stage A) favours, and which **#184**'s *"duplicating that lookup … would create two authority decisions that could drift"* also favours |
| **WORKFLOW** | One call answers the handoff's question. **#183**'s *"REFUSE BEFORE WRITE"* becomes a single predicate at the orchestration boundary. A governed creation that inherits an owner (**#181**'s *"GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER"*) can refuse a B-state upstream owner without a second lookup |
| **HISTORICAL** | **Satisfies #182's preservation requirement directly and visibly**: B is literally named *valid historical*, and nothing is rewritten. The risk is the opposite one — a consumer that treats "not A" as "bad" and triggers remediation. **#182** *"10. Backfill"* already forbids the remediation, so the guard exists by ruling |
| **MIGRATION** | The transitional Firestore adapter **can** produce B (it can read `employmentStatus`), so `…PERSON-AUTHORITY-TARGET-MODEL.md:1004-1028` (§9.5) condition 5 — *"a state the Firestore adapter cannot produce must be **absent, not approximated**"* — is satisfiable. The PostgreSQL adapter produces it from item **B**'s single governed status fact |
| **UI/DESIGN** *(design input only)* | **One answer to render, three distinguishable refusals.** Dispatch can say *"no longer eligible"* rather than *"invalid"*. Lists/Search gain a dimension **only if `OD-10` permits a user-visible fact.** Mobile renders; never computes (`OI-11`) |
| **TEST/ACCEPTANCE** | Maps cleanly onto **#182**'s *"11. Acceptance contract"* proofs — valid current · inactive · terminated · non-existent each a **distinct** outcome. `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` §4 case 2's required negative control is directly expressible: *"the same fixture, with the employee's status flipped to `ACTIVE` and nothing else changed, must census as case 1"* |
| **COMPATIBILITY** | **Diverges from the COMPANY axis by design.** `typedOwner.ts:128-130` resolves an inactive company; under `S-REP-1` an inactive person does not resolve. The acceptance contract's **`P-3`** requires the company behaviour be **left untouched**, so the two axes are deliberately asymmetric and that asymmetry must be **declared**, not discovered. Client parity (`typedOwner.ts:1-8`, `test/typedOwner.test.mjs`) must be extended or its invariant breaks silently (`OI-11`) |

**`S-REP-2` — B IS `RESOLVED` PLUS A SEPARATELY CARRIED ELIGIBILITY FACT.** Layer 1 answers existence only
(A-or-C). Eligibility is a second fact, evaluated and carried by the census / enforcement gate.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | *"The reference is sound"* and *"the person can take new work"* are **two business answers**, and a caller may legitimately need only the first. This is the reading under which *historical attribution never has to ask an eligibility question at all* |
| **DATA MODEL** | **No stored field changes, and no change to the resolution return contract either** — `OwnerDerivation` keeps its four outcomes. The eligibility fact needs a home in the **census / gate** layer, which is where `#182` puts it. `ownershipCensus.ts:165` maps only `family.ownerFields` and `:157-163` returns OWNERLESS when that is empty, so the census is **structurally single-axis** and cannot carry a second fact today — **this option therefore depends on `MI-Y`** |
| **AUTHORITY** | **Consistent with #182**'s layer table and with §12.3c's *"the not-actionable fact lives in the census layer"*. **In tension with #185**'s return-state list (`K-1`). Also consistent with the **company** precedent's shape — resolve, then judge separately |
| **WORKFLOW** | Two predicates at the orchestration boundary rather than one. **#184** stage B already asks for both — *"verify the target satisfies applicable Layer-1 / current eligibility"* — so the sequence is unchanged; what changes is that eligibility is a second evaluation the orchestrator performs, not a field it reads off the resolution result. **Risk named by #184 itself:** two evaluations are two places that can drift |
| **HISTORICAL** | **Strongest historical safety of the three.** The historical reference keeps the same outcome it has today (`RESOLVED`), so no historical display, report or frozen snapshot changes meaning. `#182` *"2."*'s requirement that `UNRESOLVED` not become the automatic representation is satisfied trivially, because the representation does not move at all |
| **MIGRATION** | Cheapest at the resolution layer — **the resolver's contract does not change**, so `…PERSON-AUTHORITY-TARGET-MODEL.md` §9.5 condition 3 (*"the `OD-6` acceptance suite passes unchanged against both adapters"*) is easiest to hold. **But the cost moves into the census**, which must gain an axis first: **`MI-Y` becomes a hard prerequisite of `MI-S`'s implementation rather than a parallel decision** |
| **UI/DESIGN** *(design input only)* | Two facts to render, and the honest rendering is *two* fields, not one badge. Employee Profile shows employment status (already a governed fact); the record shows a sound reference. **Dispatch's refusal message must be composed from two sources**, which is where a design can accidentally re-collapse them. My Dashboard is unaffected until `OD-11a` |
| **TEST/ACCEPTANCE** | **#182**'s four person proofs split across two layers — which is exactly how `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1142-1178` (§15) already scores them: *"**2 FULL** (P1, P4) · **2 split across layers** (P2, P3)"*. The acceptance contract's case-2 requirement (*"the outcome must be **distinct from case 1** and distinct from case 3"*) is **NOT satisfied at the resolver** under this option, so the contract's §4 would have to be read as governing the composed gate answer rather than the derivation. **That is a real reinterpretation and must be ruled, not assumed** |
| **COMPATIBILITY** | **Preserves the COMPANY precedent's shape exactly** — resolve existence, judge status elsewhere — so `P-3` holds by construction and no standing ruling is disturbed. **Preserves `O-1`'s determinism claim** most nearly (`typedOwner.ts:45-48`). Client parity is least disturbed: the mirror keeps returning what it returns |

**`S-REP-3` — THE PORT RETURNS A COMPOSITE RESULT: AN EXISTENCE VERDICT **AND** AN ELIGIBILITY VERDICT, AS
TWO NAMED PARTS OF ONE ANSWER.** B is neither a third peer outcome nor a free-floating side fact; it is the
**named combination** *(exists, not currently eligible)*.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | *"Is the reference sound?"* and *"may this person take new work?"* stay two business questions with two answers, but **one authority answers both at once**, so no caller can hold one without the other being available |
| **DATA MODEL** | **No stored field changes.** The return contract grows from one verdict to two, which is the minimum shape that can express B without reusing `UnresolvedCode` (whose two members mean *malformed* and *unrecognised* — `typedOwner.ts:36-38`) and without a second out-of-band channel |
| **AUTHORITY** | **The only option that satisfies both #182 and #185 as written.** #182's two layers remain two layers — existence is Layer 1, eligibility is Layer 2 — and #185's requirement that the port *return* VALID HISTORICAL / NOT CURRENTLY ELIGIBLE is met, because the composite answer expresses it. **It resolves `K-1` structurally rather than by choosing a side** |
| **WORKFLOW** | One call, one place the authority is consulted — **#184**'s anti-drift requirement is met in its strongest form. Stage B evaluates both verdicts it was handed rather than performing a second lookup |
| **HISTORICAL** | Preservation is explicit: the existence verdict stays sound for a former employee, so **no historical display or frozen snapshot changes meaning**, while the eligibility verdict carries the new fact. It gets `S-REP-2`'s historical safety and `S-REP-1`'s visibility |
| **MIGRATION** | Both adapters must produce both verdicts. The transitional adapter can (`employees.employmentStatus` is readable); the target adapter reads item **B**'s single governed status fact. **§9.5 condition 5's *"absent, not approximated"* rule applies to each verdict separately**, which is stricter and therefore safer, and it is a genuine cost: two verdicts are two things to prove equivalent across the swap |
| **UI/DESIGN** *(design input only)* | Gives a design the two facts it needs without forcing them into one badge, and without requiring the surface to compose them from two sources. **Does not decide whose dashboard B-state work appears on — that is `OD-11a`.** Does not decide visibility — that is `OD-10` |
| **TEST/ACCEPTANCE** | **#182**'s four proofs become assertions over a pair, and the acceptance contract's case-2 negative control (status flip, nothing else changed) applies to the **eligibility** verdict while case 3's regression floor (*"a `ownerless` total **identical** to the baseline run"*) applies to the **existence** verdict. §15's *"2 split across layers"* score becomes *"2 asserted on the eligibility half"* — a cleaner coverage map than either pole |
| **COMPATIBILITY** | Leaves the COMPANY axis alone (`P-3`) because the company path need not grow the second verdict. **But it is the largest change to the port's signature**, and `…PERSON-AUTHORITY-TARGET-MODEL.md` §9.5 condition 1 requires the signature mention **no datastore type** — a constraint this option must be designed inside, not around. **It is also the option furthest from anything shipped**, so it has the least precedent in this codebase |

## 1.9 OPTIONS — axis S-GRAIN (INACTIVE vs TERMINATED inside B)

**`S-GRAIN-1` — ONE CONDITION, NO SUB-DISTINCTION.** B is B; INACTIVE, TERMINATED and FORMER are the same
answer.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | *"Not eligible for new responsibility"* is the whole business fact. Why they are ineligible is HR's question, not the responsibility model's |
| **DATA MODEL** | Nothing. The distinction already exists upstream — `EMPLOYMENT_STATUS_VALUES` has six members (`employeeProfileCommands.ts:122-129`) — and this option simply declines to project it |
| **AUTHORITY** | **Closest to #182's literal text**, which groups *"inactive · terminated · former"* in one cell of its state table |
| **WORKFLOW** | One refusal message, one code path. No workflow needs to branch on which kind of departure |
| **HISTORICAL** | Neutral. History is preserved either way; this is about the **reason**, not the fact |
| **MIGRATION** | Cheapest. The transitional adapter needs to map six shipped status values onto two answers, and one mapping table does it |
| **UI/DESIGN** *(design input only)* | One state to render. **But the surface cannot tell the operator whether to wait or to reassign**, which is the substance of the objection below |
| **TEST/ACCEPTANCE** | **#182** *"11."* requires proofs for *"inactive"* **and** *"terminated"* as separate listed cases. Under `S-GRAIN-1` both proofs assert the **same** outcome — which is a legitimate reading of a required-proof list, but it means the two proofs are not independent and that should be stated rather than inferred |
| **COMPATIBILITY** | Matches the COMPANY axis's grain (one `INACTIVE`, no sub-reasons). Disturbs nothing |

**`S-GRAIN-2` — ONE CONDITION, WITH A DISTINCT REASON CARRIED.** B stays one answer; the reason
distinguishes a person who may return from one who will not.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | The Owner-relevant distinction, in `C-B3`'s words as quoted at `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1207`: *"**the remediation is opposite — one owner returns, one never does**"*. `ON_LEAVE` and `TERMINATED` are both ineligible **now**; only one is ineligible **permanently** |
| **DATA MODEL** | Nothing stored. A reason is a projection of a fact EOS already holds, and `#182` *"3."* withholds only **names**, not the existence of a reason channel |
| **AUTHORITY** | **`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:822`: *"compatible but not ratified* — the ruling neither requires nor forbids the distinction."* So this is **permitted, and choosing it is the Owner's**, not a lane's |
| **WORKFLOW** | One refusal, two remediation paths. **It does not decide either path** — what departure releases or retains is **`OD-11a`**, whose own record says *"deactivation releases NOTHING. P1 has no release command at all"* (`emp/own-synthesis:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md:144`) |
| **HISTORICAL** | Neutral to preservation, and **helpful to auditability** — **#180** invariant 6 requires historical accountability remain auditable, and a reason makes the audit record self-explanatory |
| **MIGRATION** | The transitional adapter must surface a reason from `employees.employmentStatus`; the target adapter from item **B**'s status fact. **Item B's migration note binds here:** *"the vocabulary must be decided **before** E moves any row, or E writes values R1 must later re-map"* (`…PERSON-AUTHORITY-TARGET-MODEL.md:814`) |
| **UI/DESIGN** *(design input only)* | The surface can tell an operator whether to wait or to reassign — the single most useful thing a design can do with state B. Dispatch, My Dashboard and Employee Profile all benefit. **Does not authorize any of them** |
| **TEST/ACCEPTANCE** | **#182** *"11."*'s *"inactive"* and *"terminated"* proofs become genuinely independent assertions. The acceptance contract's `MI-C` (*"what happens on each of the nine departure states"*) and `MI-K` (*"whether a DELETED employee document and a NON-EXISTENT one are one case or two"*) stay open and are not pre-empted |
| **COMPATIBILITY** | **Diverges from the COMPANY axis in grain** — the company axis has no reason channel for `INACTIVE`, and `P-3` forbids giving it one as a side effect. **The asymmetry must be declared.** No standing ruling is reversed: `#182` permits the distinction, and the existing `UnresolvedCode` (`typedOwner.ts:50`) is untouched because B is not an unresolved outcome |

**`S-GRAIN-3` — TWO DISTINCT CONDITIONS.** *Temporarily ineligible* and *permanently ineligible* are two
states, not one state with two reasons.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | Sharpest business separation: *"come back to this"* vs *"this needs a new owner"* are different obligations with different owners and different clocks |
| **DATA MODEL** | Nothing stored, but the **state set grows** — and every item that depends on the state set (`OI-06`, `OI-07`, `OI-10`, `OI-30`, `OI-31`) grows with it |
| **AUTHORITY** | **The furthest from `#182`'s text**, which puts all three of inactive/terminated/former in one cell. Permitted only on the reading that `#182`'s cell enumerates **examples**, not a closed condition. **Both readings of that cell are available and neither is settled** |
| **WORKFLOW** | Two refusals, two remediation paths, and a transition between them when a leave becomes a termination. **That transition has no governed home**: `OD-11a` says *"All nine unavailability states are `NO CHANGE` for owned records"* |
| **HISTORICAL** | Risk: a person who moves from temporarily to permanently ineligible changes state, and **a naive implementation would rewrite the stored representation of a historical reference** — precisely what `#182` *"2."* and *"8."* forbid. The state must be **derived at read time**, never stamped; that constraint is a consequence of this option and would have to be stated as part of it |
| **MIGRATION** | Most expensive. Six shipped status values map onto two states with a boundary the Owner must place, and `S-GRAIN-2`'s *"decide the vocabulary before E moves a row"* applies with more force |
| **UI/DESIGN** *(design input only)* | Two states to render everywhere B renders. Highest design surface of the three, across Employee Profile · My Dashboard · Dispatch · Service · Sales · Lists/Search · Mobile |
| **TEST/ACCEPTANCE** | Most proofs, and it **enlarges** the state set that `H`'s suite cannot be written against until `MI-S` is ruled — so it is the option that most increases what `MI-S` must settle in one pass |
| **COMPATIBILITY** | Largest divergence from the COMPANY axis and from `O-1`'s structurally-zero claim. Client parity (`OI-11`) must carry two more states |

## 1.10 `MI-S` — RECOMMENDATION

> # NO RECOMMENDATION — OWNER POLICY REQUIRED

**On axis S-REP, the evidence does not support one option, and the reason is that two binding rulings point
in different directions.** Conflict `K-1` is not a lane's misreading to clear up: **#182**'s layer table puts
current-eligibility in the census and enforcement gate, and **#185**'s interim-path clause lists VALID
HISTORICAL / NOT CURRENTLY ELIGIBLE among the states the port must **return**. Both are ruled text. Choosing
between them is choosing which ruling's placement governs, which is an Owner act. `S-REP-3` is the only
option that satisfies both as written, but it is also the option furthest from anything shipped and the one
with the largest signature consequence — **so the fact that it resolves the conflict structurally is an
argument, not a recommendation**, and this brief does not advance it as one.

**Three further reasons a lane may not answer S-REP:**

1. **`#182` withholds exactly this.** *"Exact enum and schema names are NOT authorized by this ruling"*, and
   **#185** *"Naming is explicitly not frozen."* The representation question is upstream of the names but not
   separable from them.
2. **The COMPANY axis's answer is undecided and must be decided with it, by an existing instruction.**
   `int-a-correctness-register.md` §12.3.C: *"**the answer for the person axis should not be chosen while the
   company axis's answer is undecided.** Do not 'fix' this before OD-6."* `OD-6` is now ruled and this is
   the residue.
3. **The gate-treatment half is separately unruled.** `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` `G-3` and
   `G-4` record that whether B **blocks** and whether existence and status are **one refusal or two** are
   *"not settled by any lane"* and *"the evidence does not settle it."*

**On axis S-GRAIN — OBSERVATION, NOT A RECOMMENDATION.** `S-GRAIN-2` is the only one of the three that
commits nothing `#182` withholds: it adds no state, reuses no existing code, and
`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:822` records the ruling as *"neither requir[ing] nor forbid[ding]"*
it. **That asymmetry is recorded because it is real. It is not a recommendation, because "neither required
nor forbidden" means the choice is policy** — `C-B3`'s *"the remediation is opposite"* argument is an argument
about remediation, and what departure remediates is **`OD-11a`**, which is open.

**What the Owner would fix by answering `MI-S`:** 10 register items (§1.5), work items **B**, **G** and **H**,
and the state set that `H`'s acceptance suite and `G`'s port signature cannot be written without.
**`MI-S` answers none of `OD-11a`, `MI-J`, `MI-U`, `MI-T`/`MI-η` or `MI-V`**, and it must not be read as
answering them.

---

# 2. `MI-Y` — DECISION BRIEF

*(Formerly `MI-X` sense 2. `MI-X` is retired as ambiguous, not overwritten — §0.3.)*

## 2.1 EXACT QUESTION — quoted at source

> **`ext/own-engineering-gap:docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1212`**
>
> *"Which of `MI-P`'s **two** acceptable architectures? *'Prepare the smallest design consistent with this
> ruling'* does not choose between *(i)* a multi-axis responsibility census and *(ii)* a dedicated
> accountability census composed into the gate."*

Restated at **`…PERSON-AUTHORITY-TARGET-MODEL.md:1086`**: *"Which of `MI-P`'s **two** acceptable census
architectures?"* — gating *"**J**, and 7 register items."*

**The two architectures are the Owner's own, from the ruling that created the question.**
`int/a-correctness-register:docs/DECISIONS.md` **#182**, heading *"6. `MI-P` CLOSED — YES, accountability is
measured"*:

> *"ACCOUNTABLE PERSON **must** be included in responsibility-integrity measurement. **But
> `accountablePerson` must NOT be put into `ownershipMatrix.ownerFields` merely to make the existing
> ownership census see it** — `OD-1` established that OWNER and ACCOUNTABLE PERSON are different axes, so the
> canonical integrity model must measure both **distinctly**.*
>
> *Acceptable directions: **extend the census into a multi-axis responsibility census**, **or** add a
> **dedicated accountability census composed into the enforcement gate**. **Not** pretending accountability
> is an ownership field. Eventual measurable axes: **RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT where
> governed · ESCALATION where governed.** *Prepare the smallest design consistent with this ruling; do not
> implement the final architecture.*"*

## 2.2 WHY THIS QUESTION EXISTS

| # | Cause | Evidence |
|---|---|---|
| **1** | **`MI-P` closed with two acceptable answers and reserved the choice** | **#182** *"6."*, quoted above. `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1212`: *"**A lane choosing would be designing the architecture the ruling reserved**"* |
| **2** | **The existing census is structurally single-axis and cannot carry a second axis without a decision** | `ownershipCensus.ts:165` maps only `family.ownerFields`; `:157-163` returns OWNERLESS when it is empty (**V-2**, `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1388`) |
| **3** | **The accountability axis does not exist at all**, so there is nothing to extend a census over yet | **V-5**: `grep -ci accountable functions/src/ownership/*.ts` = **0** across all 12 modules (`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:762-771`, §12.2b). The acceptance contract records the same as **A-1**: *"`grep -c accountable functions/src/ownership/*.ts` = **0**"* |
| **4** | **EOS has already run this experiment twice and lost both times** — §2.4's natural experiment |
| **5** | **The gate may not close on a census that cannot see accountability, so the architecture is on the critical path of the gate, not beside it** | **#182** *"9."*: *"**The gate may NOT close on a census structurally incapable of detecting:** non-existent person owner · invalid person owner · **missing accountable person · invalid accountable person**"* |
| **6** | **`#180` invariant 10 forbids the shortcut that would otherwise make the question moot** | **#180**, *"Hard invariants"* 10: *"**Do NOT implement one generic `ownerId` / `accountableId` shortcut across all families.**"* And *"Invariant 10 means this ruling does not license adding a field"* |

## 2.3 WHAT CURRENT EOS DOES — `[OBSERVED AT: 64008d5a]`

| Fact | Location |
|---|---|
| **The census is single-axis by construction.** One family, one `ownerFields` list, one owner derivation | `ownershipCensus.ts:165`; `:157-163` |
| **No accountability representation exists anywhere in the ownership modules** | **V-5** / **A-1**: zero hits for `accountable` across all 12 modules of `functions/src/ownership/` |
| **The census population is the ownable families only** | `ownershipCensus.ts:251` — `CENSUS_FAMILIES = ownableFamilies()`; `ownershipMatrix.ts:550-554` admits `PERSON`, `COMPANY`, `PARTICIPATING_COMPANIES` |
| **The gate sums four terms and nothing else** | `ownershipCensus.ts:231`, `:240` |
| **The `PARTICIPATING_COMPANIES` family has no single owner field to overload — *"the shape IS the pair"*** | `ownershipCensus.ts:106-124`, `:122`; `OI-05` at `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:496-533` |
| **There is no open/closed discriminator the census can read** | `OI-03`: *"The census cannot tell an **open** record from a closed one, so it cannot report the invariant for actionable work even once the axis exists"*; nine distinct per-family status vocabularies exist |
| **The gate's own comment names the failure class the person axis reproduces** | `ownershipCensus.ts:215-217` — *"A permission or index failure that counted as zero would let enforcement be enabled over records nobody managed to look at"* |

## 2.4 THE DECISIVE EVIDENCE — a natural experiment EOS has already run, twice

`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:936-970` (§12.5b), verified at source:

| Fact | Location |
|---|---|
| `creditedSalespersonId` is a **governed person fact** written by **all three** commercial creation paths | `opportunityCommands.ts:178`, `salesAgreementCommands.ts:307-308`, `salesOrderCommands.ts:291` |
| It has a derivation chain of **exactly `#181`'s shape** — explicit → inherited → the commercial owner | `financialAttribution.ts:321-330`; `:328` falls back to `commercialOwnerEmployeeId` |
| Its **entire** validation is `nonEmpty` | `financialAttribution.ts:326-328`, and `person()` at `:205-209` |
| `responsibleEmployeeId` is a **second** such fact on the same floor | `financialAttribution.ts:164`, built at `:229` through the same `person()` |
| In the **same function**, the COMPANY reference is required and throws | `financialAttribution.ts:212-224` — `COMPANY_REQUIRED` / `COMPANY_INVALID` |
| **Neither person field appears in `ownershipMatrix.ts` or `ownershipCensus.ts`** | zero occurrences (**V-4**) |

> **What it predicts, in the register's own words:** *"**`MI-P`'s ruling is load-bearing engineering, not
> architectural taste.** EOS has **already** shipped governed person facts outside the matrix and outside the
> census, **twice**, and the outcome each time was the same: *governed at creation, never measured
> afterwards, validated only for non-emptiness.* **Without a census axis, an accountability field will land
> exactly where `creditedSalespersonId` landed.**"*

**This establishes that `MI-Y` must be answered. It does not establish which answer**, and the register says
so in the same breath: *"The two acceptable architectures `MI-P` names are the difference between a measured
axis and a third unmeasured person fact."*

**A second, cheaper property, testable today with no employee data at all** — `…PERSON-AUTHORITY-TARGET-MODEL.md:935`
(item **J**): *"`assessable` (`ownershipCensus.ts:240`) cannot go false at any quantity of person orphans,
because an orphan yields `RESOLVED` (`typedOwner.ts:108`, `:124`) → bucket `"resolved"` (`ownershipCensus.ts:81-82`)
→ none of `blocking`'s four terms (`:231`)."* **Verified line for line at the baseline. It is the negative
control whichever architecture is chosen.**

## 2.5 WHAT SETTLED OWNER RULINGS ALREADY CONSTRAIN

| Constraint | Ruling · heading · text |
|---|---|
| **Accountability MUST be measured** | **#182** *"6."*: *"ACCOUNTABLE PERSON **must** be included in responsibility-integrity measurement"* |
| **It may NOT be measured as an ownership field** | **#182** *"6."*: *"must **NOT** be put into `ownershipMatrix.ownerFields` merely to make the existing ownership census see it … **Not** pretending accountability is an ownership field"* |
| **Only two directions are acceptable** | **#182** *"6."*: multi-axis responsibility census, **or** dedicated accountability census composed into the gate |
| **The eventual axes are four** | **#182** *"6."*: *"RECORD OWNERSHIP · ACCOUNTABILITY · ASSIGNMENT where governed · ESCALATION where governed"* |
| **Only the smallest design is authorized to be prepared** | **#182** *"6."*: *"Prepare the smallest design consistent with this ruling; **do not implement the final architecture**"* |
| **The gate cannot close without it** | **#182** *"9."* |
| **No generic owner/accountable field** | **#180** invariant 10 |
| **COMPANY ownership and a PERSON accountable coexist** — so the axis must be expressible on a COMPANY-owned family | **#180** invariant 8 |
| **Reference/master data does not automatically need one**, and its stewardship is a separate decision | **#180** invariants 9 and *"Invariant 9 does not settle REFERENCE stewardship"* |
| **Accountability is not assignment and not ownership; a transaction changes an axis only when the command asks** | **#184**, *"Assignment remains separate"*: *"Never infer *assignment changed → accountability changed*, nor *accountability changed → ownership changed*"* |
| **The census must read the port's SEMANTIC outcome, never a storage shape** | **#185**, *"Interim path"* (*"The interface must hide storage"*), applied to J at `…PERSON-AUTHORITY-TARGET-MODEL.md:935`: *"which is what makes the same census valid before and after cutover"* |
| **For actionable work the gate must eventually prove exactly one eligible, authoritative current accountable person** | **#182** *"9."* |

**What the rulings do NOT settle:** which of the two. And **#182** *"6."* reserves it in terms.

## 2.6 WHICH IMPLEMENTATION ITEMS `MI-Y` GATES — 7, from source (or 8 under reading D-1(A), §0.4)

| Item | Area | What `MI-Y` blocks | Per-item row |
|---|---|---|---|
| **`OI-02`** | A | **Where a family declares it carries an accountable person.** `#182`'s `MI-P` ratified the `ownerFields` prohibition, but *where* a family declares accountability is fixed by which architecture is chosen | `:1358` |
| **`OI-03`** | A | The per-family open/closed **predicate** is buildable today over the nine existing status vocabularies; its contracted proof is a **counting** proof, and *"the counting home is `MI-Y`'s choice via `OI-32`"* | `:1359` |
| **`OI-32`** | A/B | **This item *is* the architecture.** *"a lane choosing would be designing the architecture the ruling reserved"* | `:1388` |
| **`OI-35`** | A | The accountable-person creation rule has **no declared home** (`OI-02` → `MI-Y`) | `:1391` — also `MI-S` |
| **`OI-37`** | D | Invariant 7's commit-time assertion must be *"measured on a census axis `MI-Y` has not chosen"* | `:1393` — also `MI-S` |
| **`OI-40`** | A+B | The weld proof needs the census axis (`OI-32`). *"It is the one proof that cannot be partially satisfied"* | `:1396` — also `MI-W`, `MI-S` |
| **`OI-05`** | A | **The seventh.** `transferOrder`'s classification is `OD-16`; *"the item is the acceptance case for an architecture `MI-X` has not selected"* | `:1361` — *"**BLOCKED BY OWNER DECISION — `OD-16`** (+ `MI-X` via `OI-02`)"* |

**Plus work item J** — census / responsibility-integrity integration (`…PERSON-AUTHORITY-TARGET-MODEL.md:935`),
whose *"Remaining Owner decisions"* cell names `MI-Y` first and `MI-W` second.

**And one downstream gate:** *"J is the gate on `OI-24` / `W6`"* — `OI-24` being **`W6. NOT AUTHORIZED. DO NOT
ACTIVATE OWNERSHIP HANDOFF.`** (`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:496-533`).

## 2.7 WHICH OBJECT / WORKFLOW FAMILIES `MI-Y` AFFECTS

**Everything §1.6 lists, plus the axis-shaped consequences the ownership census does not currently reach.**

| Scope | Members | Source |
|---|---|---|
| The nine-family accountability minimum | `workOrder` · `reorderRequest` · `receivingOrder` · `cycleCount` · `invoice` · `transferOrder` · `opportunity` · `salesAgreement` · `salesOrder` | §12.2c |
| Envelope if the three liveness questions resolve live | + `purchaseOrder` · `reorderPurchaseOrder` · `workOrderLegacy` = **12** | §12.2c |
| The acceptance case for orthogonality | **`transferOrder`** — *"if the axis is defined so that it cannot be expressed on a `PARTICIPATING_COMPANIES` family, the axis is wrong"* (`OI-05`) | Table A |
| The 20 COMPANY families invariant 8 makes eligible | `ownershipMatrix.ts` | **#180** invariant 8 |
| REFERENCE / EXCLUDED | **Outside the population, both directions, by classification** — and the acceptance contract's `P-6` requires it stay so | `ownershipCensus.ts:251`; `ownershipMatrix.ts:550-554` |

**`MI-W` is what leaves the envelope at 9 or 12** (*"is there an Owner exception list to 'exactly one
accountable person'?"* — `…PERSON-AUTHORITY-TARGET-MODEL.md:947`), and **`MI-κ`** is what leaves the axis
unpopulatable at any size: *"What is the governed JOB-ROLE vocabulary, and who may occupy it?"*
(`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1488`). §12.2c states the precondition plainly: *"**ZERO**
holders of any of 45 governed Roles, and no job-role vocabulary. … **Widening the set from 6 to 9 widens a gap
that cannot yet be populated at any size.**"*

### 2.7a UI / DESIGN CONSEQUENCES — **DESIGN INPUT ONLY, NOT IMPLEMENTATION AUTHORITY**

| Surface | Consequence, architecture-independent |
|---|---|
| **My Dashboard** | This is the surface a responsibility census makes possible and whose absence it measures. *"Who is personally responsible for making sure the next required outcome happens?"* (**#180**) has no queue today |
| **Dispatch** | Accountability and assignment must render as **two** facts. **#184** *"Assignment remains separate"* forbids inferring one from the other, so a surface that shows one label is a surface that has collapsed them |
| **Service · Sales · Parts/Purchasing · Warehouse** | Each has at least one family in the nine-family minimum, so each acquires a second responsibility fact to render — and an **honest-absence** state until `MI-κ` and a role grant exist. `OI-04` states that requirement: *"Any accountability surface must render an **honest-absence state**, not an empty one"* |
| **Lists / Search** | A second axis implies a second filter. `OD-10` governs whether it is user-visible at all |
| **Employee Profile** | The inverse view — *"what is this person accountable for?"* — is the query a dedicated accountability census makes cheap and a multi-axis census makes uniform. **Neither is designed here** |
| **Mobile** | Same trusted-side constraint as §1.6a: render, never compute |

## 2.8 OPTIONS

**`Y-1` — EXTEND THE EXISTING CENSUS INTO A MULTI-AXIS RESPONSIBILITY CENSUS.** One instrument, several
axes; RECORD OWNERSHIP is one axis and ACCOUNTABILITY is another.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | **One question — *"is responsibility sound on this record?"* — with several parts.** A single report answers ownership and accountability together, which is how a manager would ask it |
| **DATA MODEL** | **No stored field.** But the census's family contract must gain a second axis declaration, and `ownershipCensus.ts:165` maps only `family.ownerFields` while `:157-163` treats an empty list as OWNERLESS — so **the single-axis assumption is load-bearing in the instrument and must be removed, not worked around.** `OI-02` fixes the constraint on the declaration: per-family, orthogonal, **not** an `ownerFields` entry, **not** a reuse of `ownerType`, **not** satisfiable by `assignedTechId` |
| **AUTHORITY** | Explicitly acceptable under **#182** *"6."*. It puts all four eventual axes behind one authority, which matches *"the canonical integrity model must measure both **distinctly**"* by making distinctness a property of the model rather than of two instruments. **Risk it must answer:** the same file already carries the matrix's own defects — the five financial families with `ownerFields: []` (`ownershipMatrix.ts:188-189`) and the contested `reorderRequest` row — so widening the instrument widens whatever is wrong with it |
| **WORKFLOW** | The enforcement gate keeps **one** input. `ownershipCensus.ts:231`'s `blocking` grows terms; `:240`'s `assessable` keeps one shape. **#182** *"9."*'s four detections all land in one arithmetic |
| **HISTORICAL** | Must carry **#182** *"9."*'s hardest clause — *"Historical references remain **measurable without being treated as current actionability**"* — which in a single instrument means the same axis reports a historical reference and an actionable failure **without summing them into one gate term.** That is a real design constraint and it is where a one-instrument design can silently fail |
| **MIGRATION** | No data migration. But it **touches the shipped census and its gate**, which `ownershipCensus.ts:9-10` declares READ-ONLY BY CONSTRUCTION and which the existing suite pins. Every existing expectation is a regression surface, and the acceptance contract's `T-7` regression floor (*"the baseline `ownerless`/`invalid`/`unknown`/`ambiguous` totals over a fixed fixture set"*) must be **re-measured, not cited** — its `U-2` says the cited 2026-09-02 counts are stale against this baseline |
| **UI/DESIGN** *(design input only)* | One report, several columns — the cheapest surface to design and the easiest to read. **Risk:** one report invites one number, and one number re-collapses the axes `OD-1` separated |
| **TEST/ACCEPTANCE** | **#182**'s thirteen proofs live in one suite. `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1163-1178` (§15a) scores the starting arithmetic: *"**2 FULL** (P1, P4) · **2 split across layers** (P2, P3) · **3 partial** (P5, P12, P13) · **6 not covered by any existing item** (P6–P11)"*. The COMPANY negative control (`P-3`, *"an INACTIVE company owner must still census `resolved`"*) must run **in the same suite**, which this option makes natural |
| **COMPATIBILITY** | Highest coupling to shipped code, therefore highest blast radius **and** highest chance of catching a divergence early. `P-7` binds: *"The 20 COMPANY families gain **no person owner** as a consequence"* — a measurement change must not become a population change |

**`Y-2` — A DEDICATED ACCOUNTABILITY CENSUS, COMPOSED INTO THE ENFORCEMENT GATE.** Two instruments, one
gate; the ownership census is left as it is.

| Consequence | |
|---|---|
| **BUSINESS MEANING** | **Two questions, deliberately** — *"is record ownership sound?"* and *"is accountability sound?"* — composed into one go/no-go. `OD-1`'s axis separation is visible in the instrument list itself |
| **DATA MODEL** | **No stored field, and no change to the ownership census's family contract.** The accountability axis declares its own population and its own counts. `OI-10`'s requirement binds here: *"New outcomes need their **own counts** and a **declared** gate constant"* |
| **AUTHORITY** | Explicitly acceptable under **#182** *"6."*. **Risk it must answer, and #182 already named the general form of it:** two instruments composed into one gate are two things that can disagree — the same hazard `commercialOwnershipAuthority.ts:19-20` states as *"the only thing two authorities can do that one cannot is disagree"*, and which `OI-25` records as a live instance (*"A **second** matrix-consulting family authority already exists … reachable only from tests"*) |
| **WORKFLOW** | The gate composes two inputs. **The composition is the design**, and `#182` *"9."* fixes its floor: the gate may not close while either instrument is structurally blind. A composed gate must therefore assert **both** instruments ran, which is the same obligation `ownershipCensus.ts:225`/`:234`/`:240` already discharges for `unreadable` and `truncated` |
| **HISTORICAL** | Cleanest separation of *"measurable but not actionable"*: a historical reference can be reported by the accountability census on its own terms without competing with the ownership census's gate arithmetic. **#182** *"9."*'s clause is easiest to satisfy here |
| **MIGRATION** | Lowest coupling to shipped code — the ownership census and its pinned expectations are **untouched**, so the `T-7` regression floor is preserved by construction and `P-1`…`P-9` are satisfied without effort. **The cost is the composition point, which is new** |
| **UI/DESIGN** *(design input only)* | Two reports. Honest about the two axes; more work to assemble a single manager-facing view, and **a surface that joins them is where the collapse `OD-1` forbids would reappear** |
| **TEST/ACCEPTANCE** | Two suites, one composition test. The accountability proofs (P5–P11, the six uncovered plus three partial) sit in a suite that can be written **without touching the ownership suite**, which lowers the risk that a person-axis change silently moves a company-axis expectation — the exact failure the acceptance contract's `2 ≡ 4` conflation row describes |
| **COMPATIBILITY** | Lowest blast radius. **But it creates a second responsibility authority, and `OI-25` already records that a second family authority exists and is unreconciled** — so this option inherits an obligation to reconcile rather than a clean field |

**`Y-3` — STAGED: `Y-2` AS THE SMALLEST DESIGN NOW, CONVERGING ON `Y-1` AS THE END STATE, WITH THE GATE
COMPOSITION CONTRACT DECLARED FROM THE START.**

*Supported by evidence, and stated as an option because **#182** itself separates the two horizons: "Prepare
the smallest design consistent with this ruling; **do not implement the final architecture**." That sentence
distinguishes a smallest design from a final architecture, which is what makes a staged answer coherent
rather than a dodge.*

| Consequence | |
|---|---|
| **BUSINESS MEANING** | The business gets a measured accountability axis at the earliest point, and the single-report view later. **It requires the Owner to accept that the end state is `Y-1`**, which is a decision, not a deferral |
| **DATA MODEL** | `Y-2`'s at first, `Y-1`'s eventually. **The binding requirement is that the accountability census's family declaration be written so it can later be read by a multi-axis instrument** — i.e. `OI-02`'s orthogonality is honoured from day one, not retrofitted |
| **AUTHORITY** | Satisfies *"prepare the smallest design"* literally, and keeps *"do not implement the final architecture"* true by construction. **It does not escape #182's reservation** — choosing `Y-1` as the end state is still choosing one of the two, and only the Owner may |
| **WORKFLOW** | The gate composition exists from the start and is the thing that survives the convergence, so the gate's contract is written **once** |
| **HISTORICAL** | `Y-2`'s clean separation now; `Y-1`'s single-instrument constraint later, with the separation already proved by a passing suite |
| **MIGRATION** | Two steps instead of one, and the second is a consolidation with a working acceptance suite already in place — the same *"exists before the swap, not after"* discipline `…PERSON-AUTHORITY-TARGET-MODEL.md:905` (item **H**) applies to the adapter cutover |
| **UI/DESIGN** *(design input only)* | Two reports first, one later. **A design pass would be asked to build the joined view twice, or to wait** — which is a real cost and is why this is the Owner's call, not a scheduling detail |
| **TEST/ACCEPTANCE** | Strongest position: the composition test written for `Y-2` becomes the **regression control** for the convergence to `Y-1`. The thirteen proofs move once, with a suite that already passes |
| **COMPATIBILITY** | Lowest risk now, `Y-1`'s coupling later, with the reconciliation obligation `OI-25` names discharged as part of the convergence rather than left open |

**A fourth option is NOT viable and is recorded so it is not re-proposed:** putting `accountablePerson` into
`ownershipMatrix.ownerFields`. **#182** *"6."* forbids it by name, and `OI-02` was already written to forbid it
before the ruling — *"it may not be an `ownerFields` entry, may not reuse `ownerType`, and may not be
satisfied by `assignedTechId`"* — which `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:924-935` (§12.5a) records
as **"RATIFIED, EXACTLY."**

## 2.9 `MI-Y` — RECOMMENDATION

> # NO RECOMMENDATION — OWNER POLICY REQUIRED

**The evidence does not support one option, and in this case the ruling that created the question says so in
terms.** **#182** *"6."* declares both directions acceptable and instructs *"Prepare the smallest design
consistent with this ruling; **do not implement the final architecture**."*
`…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1212` and `:1388` both state the consequence:
**"A lane choosing would be designing the architecture the ruling reserved."** This lane does not choose.

**What the evidence DOES establish, and what the Owner may rely on whichever way `MI-Y` is ruled:**

| # | Established | Source |
|---|---|---|
| **1** | **Some census axis is mandatory, not optional.** Without one, an accountability field lands exactly where `creditedSalespersonId` and `responsibleEmployeeId` landed: governed at creation, never measured, validated only for non-emptiness | §2.4; **V-3**, **V-4** |
| **2** | **The existing instrument cannot carry the axis unchanged.** `ownershipCensus.ts:165` + `:157-163` make it single-axis by construction | **V-2** |
| **3** | **The gate arithmetic is the cheapest proof and it needs no employee data.** `blocking` (`:231`) omits `resolved`, so `assessable` (`:240`) cannot go false at any quantity of person orphans | Acceptance contract `T-1`; item **J** |
| **4** | **Whichever is chosen, two obligations bind:** new outcomes get their **own counts**, and the gate treatment is a **declared constant with a rationale in one named place**, never emergent | `OI-10`; acceptance contract `G-3` |
| **5** | **Whichever is chosen, `transferOrder` is the orthogonality acceptance case** — an axis that cannot be expressed on a `PARTICIPATING_COMPANIES` family is wrong | `OI-05` |
| **6** | **Whichever is chosen, the census must read the port's SEMANTIC outcome, never a storage shape** — that is what makes one census valid before and after the PostgreSQL cutover | **#185** *"Interim path"*; item **J** |
| **7** | **`MI-Y` does not unblock the axis on its own.** `MI-W` leaves the envelope at 9 or 12; `MI-κ` means nothing can yet **name** an accountable person (**ZERO** holders of 45 governed Roles, no job-role vocabulary) | §12.2c; `OI-04`; `MI-κ` |

---

# 3. THE FOUR SIDE QUESTIONS — disposition of each

## 3.1 AUTHORITY UNAVAILABLE vs INVALID / MISSING

**Does `MI-S` settle it? NO. It is a separate, already-deferred ruling and must be preserved as one.**

| | |
|---|---|
| **The ruling that names and defers it** | **#185**, heading *"Interim path — no big-bang migration"*: the interface *"must return semantic states supporting `OD-6` — VALID CURRENT · VALID HISTORICAL / NOT CURRENTLY ELIGIBLE · INVALID / MISSING · **AUTHORITY UNAVAILABLE if later ruled separately**"* |
| **Its register identity** | **`MI-T` / `MI-η`** — `…PERSON-AUTHORITY-TARGET-MODEL.md:1078-1112` (§9.8): *"Is **AUTHORITY UNAVAILABLE** a fifth outcome distinct from **C**? … **OPEN, and now NAMED-AND-DEFERRED by `#185`** … It is no longer a lane's invention; it is a deferred ruling."* Raised earlier as `MI-η` at `:567-594` (§4.2) and as `MI-T` at `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:822` (§12.3a's last row) |
| **Why `MI-S` cannot settle it** | `MI-S` asks how **state B** is represented. AUTHORITY UNAVAILABLE is not a property of the **reference** at all. §12.3a's last row states this exactly: *"`#182`'s four states classify the **reference**; an unreadable authority is a property of the **lookup**. The ruling does not provide for it."* **A decision about B's shape is silent about a fact of a different kind** |
| **Why the business meaning matters — the Owner's point, confirmed at source** | *"Employee does not exist"* ≠ *"EOS could not reach the Employee authority."* `…PERSON-AUTHORITY-TARGET-MODEL.md:1029-1061` (§9.6) mechanism ④ names the cost of collapsing them: *"An outage becoming *'this person does not exist'* — **which is what a fallback is usually added to avoid, so removing the motive is part of the enforcement**"*. And `financialAttribution.ts:225`'s frozen snapshot plus `:184`'s *"history, not state"* mean **a false C written during an outage is never revisited** |
| **What it already gates** | Work items **G** and **H** (`…PERSON-AUTHORITY-TARGET-MODEL.md:1078-1112`), register item **`OI-09`** (*"A failed authority read has nowhere to go but `RESOLVED`"* — Table A), and **enforcement mechanism ④ of "no silent fallback"** (§9.6). Its own §9.6 honest limit: *"until `MI-η` is answered the enforcement is **four mechanisms, not five** — and the missing one is the one that removes the *motive* for a fallback"* |
| **Existing precedent for the shape of the answer, at source** | `OI-09`'s required contract: *"make the failure an **outcome**, not an exception. This is the answer to `O-1`'s stated objection — determinism is preserved for the price of one state."* And a shipped positive control: `coverageReadCallables.ts` returns **`status: "unavailable"`** with an empty array on error and on truncation — *"A bounded resolver must never label a truncated result as complete"* (`int-a-correctness-register.md:574-587`, §12.3.B, which records it as *"a **positive control**, not a defect"*) |
| **DISPOSITION** | **PRESERVED AS A SEPARATE OWNER DECISION — `MI-T` / `MI-η`.** Not decided here, not decided implicitly by `MI-S`, and **not folded into state C**. `MI-S`'s options above are all written so that adding a fifth outcome later remains possible |

## 3.2 TECHNICIAN LINKAGE — core person authority, or domain crosswalk / projection?

**Does `MI-S` or `MI-Y` settle it? NO. It is `MI-θ`, and it is already open.**

| | |
|---|---|
| **The ruling** | **#185**, *"Three concepts, permanently separate"*: *"**Never collapse** EMPLOYEE into PRINCIPAL, Firebase Auth, Firestore `users`, or `fieldops_technicians`."* And *"Target and transitional classification"*: *"`fieldops_technicians` = **legacy operational compatibility**"*. And *"`OD-6` Layer 1 consequence"*: **a technician id** is *"Insufficient as proof that an Employee exists"* |
| **The four files that deny it the identity role — verified at `64008d5a`, with two path corrections** | ① `functions/src/employeeIdentity/employeePrincipalLinkPlan.ts:24-25` — *"`fieldops_technicians` — **TEMPORARY COMPATIBILITY. Never employee-identity authority, never assignment authority, and never a link source here.**"* ② `functions/src/employeeIdentity/employeePrincipalLink.ts:43-47` — *"**THERE IS NO THIRD TERM** … `fieldops_technicians` is temporary compatibility data and must not remain employee-identity authority"* ③ `scripts/employeeTruckCrosswalk.lib.mjs:25-26` — *"`fieldops_technicians` is TEMPORARY COMPATIBILITY / OPERATIONAL PROJECTION. It must not remain assignment or employee-identity authority"* ④ **the strongest, and it is DDL**: `functions/migrations/1758412800000_employee-principal-linkage.sql:90` — *"`fieldops_technicians` is compatibility data that must not remain employee-identity authority"*, backed by the `link_source` `CHECK` and the reasoning at `:86-92`: *"A future migration cannot add that term by accident: it would have to edit this `CHECK`, in a diff a reviewer reads"* |
| **CITATION CORRECTION** | `…PERSON-AUTHORITY-TARGET-MODEL.md:79` and `:875` cite ① and ② as `employeePrincipalLinkPlan.ts:24-25` and `employeePrincipalLink.ts:46-47` **with no directory**. **Neither file exists under `functions/src/access/`.** Both are under **`functions/src/employeeIdentity/`** at `64008d5a`, and ②'s `LINK_SOURCES` constant is at **`:49`** with the *"no third term"* prose at `:43-47`. **The substance of all four citations is exact; two paths and one line number are not.** §9 `E-3` |
| **The measured reason the inference is forbidden** | `1758412800000:87-89` — *"In the live census **11 of 13** `fieldops_technicians` ids coincide exactly with `employees` ids — and **2 do not** (`tech-sbx-01`, `tech-sbx-02`). A rule inferred from the 11 is **provably wrong for the 2**"* |
| **What would be destroyed by retiring it without re-homing** | `TECHNICIAN_ONLY_BUSINESS_FACT` (`functions/src/employeeIdentity/employeePrincipalLink.ts:81-83`) — *"A business fact that exists ONLY on `fieldops_technicians` (`skills`, dispatch `status`) and on no Employee. **Retiring the collection would destroy it; this names that, and refuses.**"* And `docs/architecture/inventory-reference-authority-p1b-census.md:1044`: *"**RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first"* |
| **THE SMALLEST OWNER DECISION, and it already exists** | **`MI-θ` — *"Is technician linkage in the minimum model at all?"*** (`…PERSON-AUTHORITY-TARGET-MODEL.md:875-889`, item **F**, and `:1078-1112`). The lane that raised it recorded its own position — *"**no**, because **no `OD-6` state depends on it**"* — and why it cannot rule it: **`MI-R`** says further eligibility constraints are *"per family — do not invent them globally"*, so whether **any family's** accountability requires a technician linkage is family-by-family and the Owner's |
| **DISPOSITION** | **PRESERVED AS `MI-θ`. NOT pulled into canonical Employee authority.** `fieldops_technicians` stays a **domain-specific crosswalk / operational projection**, per #185 and per four independent artifacts one of which is DDL with a `CHECK`. **No new Owner decision is raised** — `MI-θ` is already the smallest one, and it is correctly scoped. **`MI-S` and `MI-Y` neither settle nor need it** |

## 3.3 `RECIPROCAL_FIREBASE_UID_LINK` — target disposition

**Does `MI-S` or `MI-Y` settle it? NO. It is a crosswalk-provenance question, and it needs a separate ruling.**

**Verified at source, `[OBSERVED AT: 64008d5a]` — three sites, not one:**

| # | Site | Content |
|---|---|---|
| **1** | `functions/migrations/1758412800000_employee-principal-linkage.sql:140` | `CHECK (link_source IN ('RECIPROCAL_FIREBASE_UID_LINK', 'OPERATOR_ASSERTED'))` — **a closed vocabulary of exactly two** |
| **2** | same file, `:80-82` | *"**RECIPROCAL_FIREBASE_UID_LINK** — `employees/{id}.userId` and `users/{uid}.employeeId` agree in **BOTH directions**, and that uid is the `external_subject` of the principal named here. This is the only **DERIVED** source, and it is derived from a reciprocal fact, not a coincidence"* |
| **3** | `functions/src/employeeIdentity/employeePrincipalLink.ts:49` | `export const LINK_SOURCES = ["RECIPROCAL_FIREBASE_UID_LINK", "OPERATOR_ASSERTED"] as const;` — and the plan builder **mints** it at `employeePrincipalLinkPlan.ts:297` |
| **4** | migration, `:138` | *"A closed vocabulary, because a `link_source` with free text means nothing after the third value somebody invents — **and the third value somebody would invent is the technician id**"* |

**Why it cannot remain the permanent basis of Employee↔Principal identity.** **#185**, heading *"Target and
transitional classification"*: *"The crosswalk must not rely permanently on** matching strings · **Firebase
uid coincidence** · **`users/{uid}.employeeId`** · `fieldops_technicians` identity · client-side linkage."*
And **#185**'s own closing correction, heading *"Two factual corrections carried into this entry"*: *"**One of
the crosswalk's two admitted provenances is a compatibility mechanism this ruling forbids relying on
permanently.** … **The target therefore needs either a governed successor provenance or a declared retirement
for that value.**"*

**Target disposition options, prepared and not chosen:**

| Option | What it means | Evidence for | Evidence against / cost |
|---|---|---|---|
| **`P-RETAIN` — RETAIN AS HISTORICAL PROVENANCE** | The value stays in the vocabulary, but **may never be minted again** after cutover. Existing rows keep their true provenance | **#180** invariant 6 (*"Historical accountability must remain auditable"*) and **#182** *"2."* (preserve the historical reference) both argue against erasing why a link exists. The table already has the retention pattern: two **partial** unique indexes on `status = 'active'` (`1758412800000:169-176`) — *"**history survives, ambiguity does not**"* (`:167-168`) | *"May never be minted again"* is a **prohibition, not a constraint**, unless something enforces it. `employeePrincipalLinkPlan.ts:297` mints it today, so retention alone leaves a live minting path — this option is incomplete without a guard |
| **`P-SUPERSEDE` — SUPERSEDE WITH A GOVERNED EOS LINK** | Add a governed successor provenance; new links use it; the reciprocal value becomes mint-forbidden | **#185** offers this first: *"either a governed successor provenance or a declared retirement"*. `:138`'s reasoning supports a **deliberate** third value: the closure exists *"so a third value is a deliberate act"*, and adding one is *"a diff a reviewer reads"* | Requires deciding what the governed successor **is**, which is bound up with **`MI-γ`** (*"Must a person reference resolve an Employee **only**, or an Employee **and** a live principal link?"* — `…PERSON-AUTHORITY-TARGET-MODEL.md:1078-1112`). A successor provenance implies a minting authority, and that authority does not exist while the EOS API is **NOT DEPLOYED** (`functions/src/eosApi/server.ts:19-23`) |
| **`P-RETIRE` — RETIRE AFTER MIGRATION** | Declare the value retired at a named point; rows retain it as history; the `CHECK` is edited to forbid new writes | The shape `CHECK` on `employee_id` is **already** a transitional constraint with the same character — `:157-158` encodes *"`employee_id` is a Firestore document id today"*, and `…PERSON-AUTHORITY-TARGET-MODEL.md:1062-1075` (§9.7 row 4) classifies it **RETAIN WITH A DECLARED EXPIRY**: *"saying so is the difference between retiring it and forgetting it"*. The same treatment is available here | **Retirement has a hard prerequisite that is not met.** The value's only alternative is `OPERATOR_ASSERTED`, which requires `asserted_by` **and** `assertion_reason` by `CHECK`. So retiring the derived source means **every future link needs a named human**, which is a product decision about operational load, not a schema detail. And **`U-14`** records that *"whether any row exists in `employee_principal_links` anywhere"* is **unproven** — no environment was contacted — so the population being retired is unmeasured |

**HARD CONSTRAINT ON ALL THREE:** *"do not erase its history."* Every option above keeps existing rows'
provenance. **None of them is a repair of a row**, which **#182** *"10."* forbids.

**DISPOSITION — A SEPARATE OWNER RULING IS NEEDED, AND IT IS NOT YET REGISTERED UNDER ANY `MI-` ID.**
`…PERSON-AUTHORITY-TARGET-MODEL.md:845` (item **D**) records it as *"the `link_source` successor question
above, which is **new and unregistered**"*, and §9.7 row 5 marks it **"DECIDE — a governed successor, or a
declared retirement"** and **"NOT IN THE BRIEF; this lane's finding."** **This brief raises it as a distinct
Owner decision and does not assign it a label**, because naming a register item is the Owner's — the same
constraint that produced `MI-α`. **It is not part of `MI-S` and not part of `MI-Y`.**

## 3.4 `fieldops_jobs` — BUSINESS CASE NOT ESTABLISHED, and it is NOT a dependency

**Verified. The prior lane's finding is correct: there is no dependency on `MI-S` or `MI-Y`.**

| | |
|---|---|
| **Where the status is recorded** | **`int/a-correctness-register:docs/integration/int-a-correctness-register.md:622`** — heading *"12.4 `fieldops_jobs` A/B — BUSINESS CASE NOT ESTABLISHED"* — and `:650`: *"**Status: `BUSINESS CASE NOT ESTABLISHED`. A/B stays OPEN and nothing is chosen.**"* |
| **What the question actually is** | A **Tier-2 `firestore.rules`** decision about the **COMPANY** axis: whether the admin/dispatcher branch at `firestore.rules:381-384` may rewrite `operatingCompanyId` in the same write as a lifecycle or assignment transition. The settling evidence the Owner asked for is *"a real Taylor business case where an existing job legitimately changes operating company after creation"* |
| **Why it is not a `MI-S` / `MI-Y` dependency** | It concerns **`operatingCompanyId`** — a COMPANY-axis field — on a family classified `ownerClass: "COMPANY"`, `ownerFields: ["operatingCompanyId"]`, `transfer: "HANDOFF"` (`ownershipMatrix.ts:267-269`). **`MI-S` is about the PERSON axis's state representation; `MI-Y` is about where accountability is measured.** Neither reaches this field |
| **Its actual register identity and gates** | **`OI-13`**, gated on **`OD-8`** (Tier-2 Rules authorization) plus the emulator blocker — `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1369`: *"Design fully settled — copy `equipmentEditableKeys()` … Only the Tier-2 authorization (`OD-8`) is missing."* `MI-S` and `MI-Y` appear in **neither** |
| **The decisive evidence in the register's own words** | `warehouseRootCompanyAssignment.ts`, quoted at `:640`: *"**A routing rule is not a use case**, so a mismatch is refused rather than treated as a transfer. If that requirement ever becomes real it gets its own ruling."* The register applies it verbatim: *"the `HANDOFF` routing on jobs is a routing rule, and on its own it is not evidence that a job's operating company ever legitimately changes"* |
| **The boundary that must travel with it** | `:652-655`: *"**This is a repository-scoped negative and must not be over-read.** It establishes that no code, no client surface and no document describes such a change — **not** that the business never does one. The Owner's own knowledge is precisely the evidence class that could establish it"* |
| **DISPOSITION** | **`BUSINESS CASE NOT ESTABLISHED` stands. NOT mixed into `MI-S` or `MI-Y`.** No source evidence proves a dependency, and the prior lane's finding of none is **confirmed** |

> **CORRECTION TO A CORRECTION — §9 `E-2`.** `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1440-1446` and
> `:1506` (**X-17**) assert *"`grep -rn 'BUSINESS CASE' docs/` → **0 hits***" and conclude that *"'`fieldops_jobs`
> A/B' and 'BUSINESS CASE NOT ESTABLISHED' are not findings of this register and should not be carried
> forward."* **Both phrases ARE locatable at source** — at `int/a-correctness-register:docs/integration/int-a-correctness-register.md:622`
> and `:650`, a file that does not exist on `ext/own-engineering-gap`, where that grep was run. **`X-17` is
> right that they are not findings of the *decomposition* and right about `OI-13`'s gates. It is wrong that
> they are not findings at all, and the instruction "should not be carried forward" must not be followed
> literally** — the `fieldops_jobs` A/B status is a live, sourced finding of the correctness register. The
> Owner's instruction to preserve it is correct.

---

# 4. MIGRATION ORDER

## 4.1 Reconciling the two instructions — they do not conflict

**The Owner asked:** FKs must **not** be added before crosswalk completeness is measured; **and** the
migration must **not** be the first discovery mechanism in production. A prior lane concluded **constraint
must precede movement**. **Which ordering does the evidence support?**

**All three compose, once two distinctions are made explicit:**

| Distinction | Consequence |
|---|---|
| **MEASURE ≠ CONSTRAIN** | *"No FK before completeness is measured"* orders **measurement before constraint**. It does not say the constraint comes after the data moves |
| **CONSTRAIN ≠ MOVE** | *"Constraint must precede movement"* orders **constraint before data movement**. It does not say the constraint comes before measurement |
| **Composed** | **MEASURE → CONSTRAIN → MOVE.** No contradiction exists between the two instructions; they order different adjacent pairs |
| **NON-PRODUCTION ≠ PRODUCTION** | *"The migration must not be the first discovery mechanism in production"* is satisfied by requiring a **read-only census first**, and by attempting the constraint in a non-production environment before production. This is the instruction that forbids the shortcut of using the FK **as** the census in production |

**The evidence for each link, quoted:**

| Link | Evidence |
|---|---|
| **Measurement first** | **#182** *"9."*: the gate may not close on a census structurally incapable of detecting invalid person references. And **#180**, *"What this ruling does NOT do"*: *"**Invariant 1 is not currently detectable** … Closing that measurement gap is `OD-6`'s subject, which is why `OD-6` is the gate on implementation rather than a follow-up."* **Measurement is a ruled prerequisite, not a preference** |
| **The constraint attempt IS a second, stronger measurement** | `…PERSON-AUTHORITY-TARGET-MODEL.md:987-1003` (§9.4a(4)): *"**The constraint work is itself a measurement.** Adding a referential constraint to a column that already holds rows **cannot succeed** while any value fails to resolve — so the attempt is the census."* And item **D**: *"an FK that cannot be added is a measurement of exactly how incomplete the crosswalk is"* |
| **Constraint before movement** | §9.4a(3): *"**Constraining before moving is the only order in which an FK failure is a measurement rather than an outage.**"* And §9.4a(2), which is the reason: `ownership_handoffs` is **append-only and trigger-protected** — `CREATE FUNCTION refuse_ownership_history_mutation()` at `1758844800000:295-301`, *"a correction is a NEW handoff row … not an edit to the old one"* — so *"**an unvalidated person id written here is permanent by design** … **E must not be allowed to run before this column is constrained**, because history that cannot be edited cannot be repaired"* |
| **Why production must not discover it first** | `…PERSON-AUTHORITY-TARGET-MODEL.md:1124-1142` (§9.10) **`U-13`**: whether migrations **004–018** are applied in **any** environment is **UNPROVEN** — *"it decides whether the constraints of §9.4a(3) are a schema edit or a data reconciliation"*. **`U-14`**: whether any row exists in `employee_principal_links` anywhere is **UNPROVEN**. **A constraint attempt against an unmeasured population in production is an outage with a census attached** |

> **THE ORDERING THE EVIDENCE SUPPORTS:**
> **READ-ONLY MEASUREMENT (every environment) → CONSTRAINT ATTEMPT (non-production, where the failure is the
> second measurement) → CONSTRAINT (production, before any row moves) → MOVEMENT.**
>
> **The two instructions were never in conflict.** They would conflict only if *"measured"* were read as
> *"remediated"* — and **#182** *"10."* forbids that reading outright: *"**Backfill is NOT the mechanism for
> fixing historical inactive or terminated references** … **No backfill authorized.**"*
>
> **The residue is a genuine gap, and it is `MI-λ`:** what is the **declared disposition** of a row whose
> person reference does not resolve when the constraint is added? It may be neither a rewrite (**#182** *"8."*:
> do not rewrite history automatically) nor a silent drop (**#180** invariant 6: historical accountability must
> remain auditable). `…PERSON-AUTHORITY-TARGET-MODEL.md:1078-1112`: *"**Without an answer, E has no legal
> action for a non-resolving row, and §9.4's constraint attempt has no defined outcome.**"* **This is the one
> thing that blocks the ordering above from being executable, and it is Owner-only.**

## 4.2 THE SEQUENCE — the Owner's draft, corrected where repository evidence requires

**Every step below is `NOT AUTHORIZED`. This states DEPENDENCIES, not a schedule** — `firebase-exit-manifest.json:60-62`
is `"waves": []` and the wave model reserves ordering to *"the engineers and owners doing the migration
work."*

| # | Step | Change from the Owner's draft | Evidence |
|---|---|---|---|
| **0** | **Make historical retention a governed invariant** — state it, and pin it with a test that fails if a delete path is introduced | **NEW — not in the draft, and it is the cheapest step in the programme** | Item **C**: retention is *"satisfied **de facto** today and it is verified"* (`firestore.rules:497` is `allow create, update, delete: if false;`; zero `.delete()` on an `employees` document in the trusted tree) — *"**It is satisfied by accident, not by contract** — which is precisely why C is the cheapest item and the one most worth doing early"* |
| **1** | **Measure existing person references — read-only, every environment** | unchanged in position; **scope widened** | The inventory is **fifteen** references, not two (`…PERSON-AUTHORITY-TARGET-MODEL.md:597-620`), plus **nine unconstrained PostgreSQL person columns** (§9.4). Acceptance contract `U-J`: *"**THIS IS THE READ THE ENFORCEMENT GATE ACTUALLY NEEDS AND DOES NOT HAVE.** Requires Owner authorization"* |
| **2** | **Introduce the governed person-resolution PORT — interface only, no implementation** | **MOVED UP from the draft's position 8.** The draft's *"migrate governed person resolution"* conflates **introducing** the port with **swapping** its adapter; they are different steps at opposite ends | Item **G**: *"**G must precede any implementation, or the cutover cost is locked in.** Behind one port the cost is **one adapter**; without it, a re-audit of every reference."* §4.1 step 3 says the same |
| **3** | **Build the governed mutation entry point `OD-7` names** | **NEW — not in the draft** | §4.1 step 4: *"`OD-7`(e) requires a single entry point; `stageOwnershipHandoff` is the seam and **nothing calls it** (`ownershipHandoffCommand.ts:197`). **Until this exists there is nowhere for Layer 1 to live**"* |
| **4** | **ESTABLISH THE EMPLOYEE RELATION (R1)** | **MOVED UP — the draft has this at 5, after populating it at 2 and after the crosswalk at 3. That order is impossible** | Item **A**: *"**R1 must exist before D and before E.**"* Item **D**: *"**D is impossible before A.**"* The draft's step 2 (*"establish canonical Employee population"*) **is** item **E**, which populates R1 |
| **5** | **Decide and fix the status vocabulary** | **NEW, and it is on the critical path** | Item **B**: *"the vocabulary must be decided **before** E moves any row, **or E writes values R1 must later re-map**."* Gated by **`MI-S`** (grain) and **`MI-J`** |
| **6** | **Crosswalk integrity — the FK from `employee_principal_links` onto R1, composite and tenant-scoped** | position roughly as drafted (6) | Item **D**: *"the constraint is the only thing that has to be added"* (`1758412800000:55-57`). **Must be composite**: a single-column key *"would prove existence and **reintroduce exactly the cross-tenant leak `:39-42` was written to make unrepresentable**"* |
| **7** | **CONSTRAIN THE NINE EXISTING POSTGRESQL PERSON COLUMNS** | **MOVED AHEAD OF ROW MOVEMENT.** The draft has this at 7 and movement at 8, which is already correct on that pair; the correction is that it must also precede anything that **writes** those columns | §9.4a(3): *"§4.1 listed the nine columns as step **10**, *after* the FK at step 9; **§9.4 tightens that: they must be constrained before E populates or repoints anything that writes them.**"* The nine: `accounts`/`contacts`/`account_locations` `owner_employee_id` (`1758758400000:176`, `:219`, `:262`), `opportunities`/`sales_agreements`/`sales_orders` `owner_employee_id` (`1758844800000:184`, `:208`, `:233`), **`ownership_handoffs.previous_owner_employee_id` and `.new_owner_employee_id`** (`:262`, `:263`), `employee_principal_links.employee_id` (`1758412800000:121`). **Zero `REFERENCES` onto any person relation exists anywhere** |
| **8** | **Enumerate and DECLARE the disposition of every non-resolving reference** | **REPLACES the draft's *"reconcile invalid/missing"*.** *"Reconcile"* cannot mean repair | **#182** *"10."*: no backfill. **#182** *"8."*: do not rewrite history automatically. **`MI-λ`** and **`MI-ε`** gate what the legal action is. **`MI-ε`** is the harder one: *"`employees` is **not the complete person population**… Does Layer 1 **fail closed** on those people — **declaring real actors non-existent** — or is completeness a **precondition**? **A product decision about real people being refused**"* |
| **9** | **Move rows into R1 — additive, idempotent, creating no links** | draft position 2; **moved after 4–8** | Item **E**: *"E is **additive and idempotent**… A row moved by E with no resolvable principal link is a **measured incompleteness**, never an inferred link."* No document is deleted; Firestore `employees` becomes **ARCHIVE** |
| **10** | **Write the `OD-6` acceptance suite — storage-agnostic** | **NEW, and it must precede the swap** | Item **H**: *"**H is the cutover's acceptance gate**, so it must exist before the swap, not after."* And §9.5 condition 3: *"the suite **passes unchanged against both adapters**. That is the operational definition of 'without changing `OD-7` semantics' — **if the suite needs editing for the swap, the swap changed semantics**"* |
| **11** | **Re-home the Rules-based eligibility out of the security boundary** | **NEW, and named as the transition's largest un-priced cost** | Item **B**: *"**four `firestore.rules` sites enforce `employmentStatus == "ACTIVE"` inside the security boundary** (`:61`, `:92`, `:114`, `:141`). **No PostgreSQL relation can ever be read from `firestore.rules`**"* → **`MI-δ`**, which *"governs whether step 11's Rules re-homing is even permissible"* |
| **12** | **Switch the authoritative adapter** | draft position 9 | §9.5's six conditions, of which **condition 4 is the one that does real design work**: *"a Firestore transaction and a PostgreSQL transaction are not interchangeable objects… the port must take the transaction from the caller as an **opaque handle**, or the adapters are not substitutable."* `commercialOwnershipRepository.ts:185-188` uses `FOR UPDATE` so that *"the second one records the first one's new owner as its previous owner instead of overwriting it"* — **a guarantee the Firestore adapter must be proved to provide, not assumed to** (`U-11`) |
| **13** | **Make the non-authoritative bearer UNREACHABLE — by import closure and a pinned ratchet** | **REPLACES the draft's *"remove transitional fallback"*.** There is no fallback to remove; the requirement is that one never becomes constructible | **#185**: *"**No silent fallback from PostgreSQL to Firestore after cutover.**"* §9.6: *"**'No silent fallback' is a property that review cannot hold.** A fallback is added by someone solving an outage under pressure, and it is invisible precisely because it works. So the enforcement must be **structural or ratcheted**"* — mechanism ①'s precedent is measured: the transitive import closure from `functions/src/index.ts` reaches **297 files, ZERO of which import `pg`** |
| **14** | **Retire the legacy stores — and they are NOT one step** | **SPLIT. The draft's single *"retire legacy stores"* would destroy data** | `users` → **RETIRE** (`p1b-census.md:1043`). Firestore `employees` → **ARCHIVE, NEVER DELETED** (item **C**; **#182** *"2."*). `fieldops_technicians` → **RETIRE LAST, and only after re-homing** `TECHNICIAN_ONLY_BUSINESS_FACT` — `p1b-census.md:1044`: *"**RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first"* |

## 4.3 THE CRITICAL INVARIANT — NO SILENT FALLBACK AFTER CUTOVER

**The acceptance test, from `…PERSON-AUTHORITY-TARGET-MODEL.md:1029-1061` (§9.6), quoted:**

> *"**A test that fails if any module reachable from the deployed entrypoint can obtain a person-authority
> answer from the non-authoritative bearer — asserted by import closure and by a pinned count, not by reading
> the code.** Plus: a test that an authority outage produces the unavailable outcome and **refuses the
> mutation**, and a test that the archive bearer is read only on evidence paths."*

**Five mechanisms, and TWO HONEST LIMITS that belong to the Owner, not to engineering:**

| Limit | Statement |
|---|---|
| **① Mechanism ④ is not yet available by ruling** | *"**④ depends on a ruling `#185` explicitly deferred**, so until `MI-η` is answered the enforcement is **four mechanisms, not five** — and **the missing one is the one that removes the *motive* for a fallback**."* §3.1 above |
| **② The unreachability property INVERTS at cutover, and nobody has designed the inversion** | *"①'s strongest form is currently an **accident** of deployment topology (`eosApi/server.ts` is not reachable from `index.ts`, and is **not deployed** at all); **after cutover that accident inverts**, and what was unreachable becomes the authority while what was the authority must be made unreachable. **Nobody has designed that inversion, and it is not designed here.**"* Registered **`U-12`** |

---

# 5. ARCHITECTURE DOCUMENTATION CORRECTION

**All three statements the Owner named are verified at `64008d5a`. A FOURTH site carries the same defect and
was not named. A FIFTH conflicting statement is recorded but is a larger, separate correction.**

## 5.1 CURRENT CONFLICTING STATEMENTS — verified at source

| # | Site | Exact text at `64008d5a` | Defect |
|---|---|---|---|
| **A-1** | `docs/architecture/firebase-exit-manifest.json:14` — `IDENTITY_ONLY.description` | *"Firebase usage that establishes or verifies who the caller is (sign-in, ID token verification, custom-claims issuance) **or correlates a Firebase UID to an EOS Principal/Employee**. This is outside the BUSINESS_RUNTIME ratchet **for the current business-runtime exit phase**; eventual identity/auth migration is a separate future Firebase-exit concern, **not decided here**."* | **`/Employee` places the Employee business record inside the identity carve-out.** Confirmed exactly as the Owner described |
| **A-2** | **`docs/architecture/firebase-exit-manifest.json:10` — `principle`** | *"Firebase is permitted only for sign-in identity and Firebase UID correlation to an **EOS Principal/Employee**. All business data, business authorization, and business transport must run through the Render EOS API against PostgreSQL, not through Firestore or Firebase Functions."* | **THE SAME DEFECT, AT A FOURTH SITE THE OWNER'S BRIEF DID NOT NAME.** This is the manifest's **top-level principle** — arguably the most load-bearing of the four, because everything else in the file is read in its light. **NEW FINDING** |
| **A-3** | `docs/architecture/firebase-exit-ratchet.md:4-5` | *"Firebase remains permitted only as **IDENTITY_ONLY** (sign-in, and Firebase UID correlation to an EOS **Principal/Employee**)."* | Same defect. The Owner cited `:4`; the sentence **wraps onto `:5`**, where `Principal/Employee` actually sits. **Citation precision only; the finding is exact** |
| **B-1** | `docs/architecture/firebase-exit-ratchet.md:70-71` | *"…that is correct, not a gap: **identity is the one Firebase capability this architecture keeps on purpose**."* | **A permanence claim its own cited source does not make.** The manifest it points to says *"not decided here"* (A-1). Verified: `:70-71` is exactly where this sits |
| **C-1** | `docs/PROJECT_ARCHITECTURE.md:88` | *"**Firestore is the source of truth for all operational data** across every model described below."* | **Directly contradicts #185** (*"canonical Employee authority belongs in EOS-owned PostgreSQL"*) and the standing target. **Recorded, not scoped into the smallest correction** — it is a system-of-record statement about **all** operational data, not an identity-carve-out defect, and correcting it properly is a separate, larger piece of work |

**Verified CLEAN and requiring NO edit** — recorded so a correction pass does not over-reach:

| Site | Why it is clean |
|---|---|
| `firebase-exit-manifest.json:49` — `dispositionRationale.IDENTITY_ONLY` | *"This dependency is sign-in identity or **UID correlation** and is outside this business-runtime ratchet for the current exit phase"* — **no `/Employee`.** Says exactly what #185 permits |
| `firebase-exit-manifest.json:20` — `"trendsToZero": false` | **NOT a permanence claim, and #185 withdrew the over-read of it**: *"the flag means **out of scope for this ratchet**, not retained permanently. **A prior report in this program stated that Firebase Auth is retained permanently on the strength of that flag. That over-read the manifest and is withdrawn.**"* **Do not change it** |
| `firebase-exit-ratchet.md:66-72` — `firebase/auth`, `firebase-admin/auth`, `firebase-admin/app` outside `FORBIDDEN_CATEGORIES` | **#185**: *"**unaffected** — that is about credentials, which this ruling leaves with the credential provider"* |
| `scripts/firebaseExitGuard.mjs` | Reads the manifest's **dependency-class arrays**, not these description strings. Its only reference to the text is a message at `:398` and comments at `:6`, `:22`, `:101`. **No test asserts the `/Employee` wording**, so the correction breaks nothing |

## 5.2 CURRENT OWNER RULING

**`int/a-correctness-register:docs/DECISIONS.md` #185, heading *"ARCHITECTURE AUTHORITY CONFLICT — raised as
the ruling directs, not silently resolved"*, clause 3 (*"The scope defect this ruling directly overturns"*):**

> *"**Both** documents place Employee inside the identity carve-out … **Under this ruling, UID → PRINCIPAL
> correlation is legitimately identity; UID → EMPLOYEE is not.** The word **`/Employee`** in both places is
> now **wrong**, and it is **exactly the seam by which Employee business data could have been retained in
> Firebase under an identity label.**"*

and clause 2 (*"A real conflict: the ratchet asserts permanence its own source does not"*):

> *"`docs/architecture/firebase-exit-ratchet.md:70-71` — *'identity is the one Firebase capability this
> architecture **keeps on purpose**.'* That is a permanence claim. The manifest it cites says *not decided
> here*. **The ratchet overstates its source**, and against the standing target — *'zero Firebase
> dependency'*, `docs/architecture/inventory-reference-authority-p1b-census.md:1021` — it is wrong as
> written."*

and the reconciliation it directs:

> *"strike **`/Employee`** from the identity carve-out in both documents, leaving `Principal`; correct the
> ratchet's *'keeps on purpose'* to the manifest's own *'not decided here'*; and record that `OD-6` Layer 1
> therefore **cannot** be satisfied through the identity exception."*
>
> *"**No new Firebase dependency is added, Employee authority is not moved into the identity exception, and
> the conflict is NOT resolved by expanding Firebase's scope.**"*

> **ONE CITATION CORRECTION, VERIFIED.** #185 cites *"zero Firebase dependency"* at
> `docs/architecture/inventory-reference-authority-p1b-census.md:1021`. **At `64008d5a`, `:1021` is a
> disposition-table row about `fieldops_technicians`**, not that phrase. **NOT LOCATABLE AT `:1021`.**
> Checked: `:1018-1024` and `:1042-1046` of that file at the baseline. **The substance of the standing target
> is not in doubt** — the same file's disposition table retires `users`, `fieldops_technicians`,
> `stock_locations` and the static catalogue, and the manifest's own `principle` (A-2) requires all business
> data to run *"through the Render EOS API against PostgreSQL, not through Firestore or Firebase Functions."*
> **Only the line number is wrong, and a corrective pass should re-derive it rather than copy it.**

## 5.3 SMALLEST CORRECTION REQUIRED

**Four text edits and one added sentence. No schema, no code, no guard, no ratchet, no scope change.**

| # | File | Edit |
|---|---|---|
| **1** | `docs/architecture/firebase-exit-manifest.json:14` | In `IDENTITY_ONLY.description`, strike **`/Employee`**, leaving *"correlates a Firebase UID to an EOS Principal"* |
| **2** | `docs/architecture/firebase-exit-manifest.json:10` | In `principle`, strike **`/Employee`**, leaving *"Firebase UID correlation to an EOS Principal"*. **This is the site the ruling's reconciliation did not name and the manifest's most load-bearing sentence** |
| **3** | `docs/architecture/firebase-exit-ratchet.md:4-5` | Strike **`/Employee`**, leaving *"Firebase UID correlation to an EOS Principal"* |
| **4** | `docs/architecture/firebase-exit-ratchet.md:70-72` | Replace the permanence claim with the manifest's own scope statement — identity is **outside this business-runtime ratchet for the current exit phase**, and eventual identity/auth migration is **not decided here**. **Do not assert permanence and do not assert retirement** |
| **5** | one of the two files, once | Add: **`OD-6` Layer 1 cannot be satisfied through the identity exception.** Employee existence resolves against the governed Employee authority (**#185**), never through UID correlation |

**Explicitly NOT part of the smallest correction:**

- `firebase-exit-manifest.json:20` `"trendsToZero": false` — **leave it.** #185 withdrew the permanence over-read of it.
- `firebase-exit-ratchet.md:66-72`'s `FORBIDDEN_CATEGORIES` exclusion — **leave it.** #185: *"unaffected."*
- `firebase-exit-manifest.json:49` — **leave it.** Already correct.
- `scripts/firebaseExitGuard.mjs` and its test — **no change needed.** No assertion depends on this wording.
- `docs/PROJECT_ARCHITECTURE.md:88` — **record, do not fold in.** A separate and larger correction (C-1).
- **No broad architecture rewrite. Firebase's scope is not expanded anywhere.**

## 5.4 FILES AFFECTED

| File | Sites | Kind |
|---|---|---|
| `docs/architecture/firebase-exit-manifest.json` | `:10`, `:14` | **two `/Employee` strikes** |
| `docs/architecture/firebase-exit-ratchet.md` | `:4-5`, `:70-72` | **one `/Employee` strike + one permanence-claim correction** |
| either of the above | one location | **one added sentence** (item 5) |
| `docs/PROJECT_ARCHITECTURE.md` | `:88` | **RECORDED ONLY — separate, larger correction. Not in the smallest scope** |

**Neither file was touched by this lane.** Both are outside its allowed surface, which is this document only.

---

# 6. REMAINING GENUINELY-UNRESOLVED PERSON-AUTHORITY DECISIONS

**CLOSED, and marked so throughout:** `OD-1` (#180) · `MI-N` (#181) · `OD-6`, `MI-P`, `MI-Q`, `MI-R` (#182) ·
`M-4` (#183) · `OD-7` (#184) · `MI-ι` (#185).

| Ref | Question | Blocks | Status |
|---|---|---|---|
| **`MI-S`** | §1 of this document | **B**, **G**, **H**, and **10** register items | **OPEN — presented here** |
| **`MI-Y`** | §2 of this document *(formerly `MI-X` sense 2)* | **J**, and **7** register items (8 under reading D-1(A)) | **OPEN — presented here** |
| **`MI-U`** | Is state **C** (`MISSING / INVALID_REFERENCE`) **one** state or **two**? Today *missing* → `OWNERLESS` and **blocks** (`ownershipCensus.ts:231`); *invalid reference* → `RESOLVED` and **cannot block at any quantity** — **opposite treatment for one ruled state** | **G**, **H**, **J**; 4 register items | OPEN |
| **`MI-T` / `MI-η`** | Is **AUTHORITY UNAVAILABLE** a fifth outcome distinct from **C**? | **G**, **H**, no-silent-fallback mechanism ④, `OI-09` | **OPEN — NAMED AND DEFERRED BY #185.** §3.1 |
| **`MI-ε`** | `employees` is **not the complete person population** (~15% of technicians unrepresented; `tech-sbx-02` *"exists in no other collection"*; one **production** principal that can act has no employee link). Does Layer 1 **fail closed** on those people, or is completeness a **precondition**? | **A**, **D**, **E** — **E cannot proceed without it** | OPEN. **A product decision about real people being refused** |
| **`MI-λ`** | Is item **E** a *"backfill"* under **#182** *"10."*, or a governed datastore move? And **what is the declared disposition of a non-resolving row** when the constraints are added? | **E**, and §4.1's ordering | **OPEN. The one thing that makes §4.2 executable** |
| **`MI-δ`** | Must any part of Layer 1 be enforceable in `firestore.rules`? | **B**, and the whole cutover sequence | OPEN. If yes, **no PostgreSQL relation can ever serve it**, and four Rules sites (`:61`, `:92`, `:114`, `:141`) must leave the security boundary |
| **`MI-γ`** | Must a person reference resolve an **Employee only**, or an Employee **and** a live principal link? | **D** (whether its FK is on Layer 1's critical path), **G** | OPEN |
| **`MI-β`** | Does **#182** Layer 1 **supersede** `O-1`'s exclusion of cross-collection lookup, or does `O-1` stand with resolution at the governed entry point? | **G** | OPEN. *"**#184(e) and #185's storage-hiding clause both compose only with the latter.** This lane recommends it and cannot rule it"* |
| **`MI-ζ`** | Sequence R1 with the Firestore answer, or decide both together? | **A**, **E** | OPEN. §9.4's finding — the defect is **already reproduced in the PostgreSQL schema** — argues for deciding together |
| **`MI-θ`** | Is technician linkage in the minimum model at all? | **F** | OPEN. §3.2 |
| **`MI-V`** | Does Layer 1 extend to the **fifteen** person references, including `creditedSalespersonId` and `responsibleEmployeeId` on `person()`'s `nonEmpty`-only floor (`financialAttribution.ts:205-209`)? | **G**'s scope, `OI-38` | OPEN. **#185** rules the **authority**, not the **scope** — extension is *"by analogy, not by ruling"* |
| **`MI-J`** | Which employee fact is authoritative for *"this person can no longer act"*? | **B**; `OI-31` | OPEN. `SYSTEM_AUTHORITIES.md:121` warns against conflating it with account state |
| **`MI-W`** | Is there an Owner exception list to *"exactly one accountable person"*? | **J**, `OI-01`, `OI-40`, `OI-42` | OPEN. Leaves the family envelope at **9 or 12** |
| **`MI-κ`** | What is the governed **JOB-ROLE vocabulary**, and who may occupy it? | `OI-04`; **nothing can NAME an accountable person without it** | OPEN. **ZERO** holders of 45 governed Roles |
| **`MI-α`** | The register label for the person-authority question (`OI-39` / `V-15` / `X-13` / `BA-7`) | all of §9's citations in `…PERSON-AUTHORITY-TARGET-MODEL.md` | **PARTLY DISCHARGED.** The **collision half** is resolved (§0.3, and the register-hygiene entry at `DECISIONS.md:7104`); the **which-label-governs** half is not |
| **`link_source` successor** | Governed successor provenance for `RECIPROCAL_FIREBASE_UID_LINK`, or a declared retirement? | **D**, **E** | **OPEN AND UNREGISTERED under any `MI-` id.** §3.3. **Raised here; not labelled, because naming a register item is the Owner's** |
| **`OD-11a`** | On departure, what is **RELEASED** and what is **RETAINED**? | `MI-S`'s remediation half; My Dashboard; the acceptance contract's `G-7` | OPEN. *"All nine unavailability states are `NO CHANGE` for owned records… **deactivation releases NOTHING. P1 has no release command at all.**"* |
| **`OD-10`** | Is company ownership — and by extension a responsibility fact — a **USER-VISIBLE** fact or an **INTERNAL SCOPING KEY**? | every Lists/Search and reporting consequence in §1.6a and §2.7a | OPEN. *"**IT MUST BE ANSWERED BEFORE THE CENSUS GATE**, because a fact nobody can see cannot be verified by the people accountable for it"* |
| **`OD-8`** · **`OD-13`** · **`OD-16`** | Tier-2 Rules authorization · product approval for the Work Order workflow items · family classification incl. `transferOrder` | 5 · 4 · 1 register items | OPEN, and untouched by #180–#185 |
| **`M-1`** · **`M-2`** · **`M-3`** | `OD-7` sub-questions: axis scope · which carrier owns the handoff fact · whether selecting a placement authorizes wiring | **I** | **ALL EXPLICITLY LEFT OPEN BY #183.** **`M-1` here is NOT the `M-1` of #179**, which concerns a `cycle_counts` migration — the register-hygiene entry at `DECISIONS.md:7130-7135` records that collision |
| **`O-1`** | Whether the `USER` id namespace is the canonical Employee id, and whether `O-1`'s exclusion stands | `OI-08`, `OI-39`, `MI-β` | OPEN |

---

# 7. UNPROVEN

**NOT_RUN — stated in full.** **No test, typecheck, build, lint or emulator was executed. No `java` (no JRE
is present, so the Firestore emulator cannot start). No `functions/lib` was consulted for any claim and it
was excluded from every search. No `functions/node_modules` was borrowed. No production or non-production
environment was contacted. No schema, migration, backfill, or Rules change was written. No DDL was added to
any file. No data was mutated. No secrets were requested or exposed.** Every measurement in this document is
a file read in a git worktree at `64008d5a`, plus `git show` / `git grep` reads of named refs.

| # | Unproven | Why | What would prove it |
|---|---|---|---|
| **`V-1`** | That any person-owner record is in state **B** or **C** in any environment | No environment was contacted. §1.3's table is derived from **control flow** — no branch reads an Employee document — so it holds regardless. **This is a capability finding, not an incidence finding, and must not be reported as the latter** | The `U-J` read: join owner ids against the Employee authority, per environment. **Requires Owner authorization** |
| **`V-2`** | The **magnitude** of `MI-S`'s and `MI-Y`'s consequences | Both are decidable without it; neither's **cost** is | The same read |
| **`V-3`** | Whether migrations **004–018** are applied in **any** environment — i.e. whether §4.2 step 7's nine columns exist as **rows** or only as **DDL** | No environment contacted. Inherited as `U-13`; the only activation evidence is `migrations: 3` | A migration-state read. **Load-bearing: it decides whether step 7 is a schema edit or a data reconciliation** |
| **`V-4`** | Whether any row exists in `employee_principal_links` anywhere | No environment contacted. Inherited as `U-14`. **D's FK cannot be added over non-resolving rows** | The same read |
| **`V-5`** | That a Firestore adapter can provide the serialization guarantee PostgreSQL provides with `FOR UPDATE` (`commercialOwnershipRepository.ts:185-188`) | No code executed, no transaction semantics tested. Inherited as `U-11`. **§9.5 condition 4 — the one place a signature-identical swap can change `OD-7` semantics** | A concurrency test against both adapters, asserting the same previous-owner outcome under two simultaneous handoffs |
| **`V-6`** | That the post-cutover **inversion** of the unreachability property is designable | No such design exists. Inherited as `U-12`. §4.3 limit ② | A cutover design stating the import-closure invariant in both directions, with the ratchet that holds it |
| **`V-7`** | Whether `contacts.owner` / `locations.owner` exist in **Firestore** at all | Inherited as the acceptance contract's `U-K`, its *"highest-consequence UNPROVEN"*: **two of the six PERSON families may have no field for the contract to govern** | Read one `contacts` and one `locations` document per environment |
| **`V-8`** | Whether the six PERSON families' baseline totals still hold | The cited shape-valid counts are **2026-09-02 against a 2026-09-12 baseline** (acceptance contract `U-2`). **`T-7`'s regression floor must be re-measured, not cited** | Re-run the read-only census |
| **`V-9`** | Whether the acceptance contract's `T-1`…`T-7` actually pass | **Even the emulator-free pure-Node suite cannot run**: `functions/node_modules` and `functions/lib` are both absent, `functions/lib` is untracked, and `functions/test/*.mjs` import from `../lib/ownership/*.js` — a `tsc` output that does not exist. No `tsc`, no `esbuild` | An environment with `node_modules` and a build. **`T-1`…`T-7` are specified as executable and marked NOT EXECUTED** |
| **`V-10`** | Whether reading **D-1(A)** or **D-1(B)** of §0.4 is correct — i.e. whether `MI-Y` gates **7** items or **8** | The source disagrees with itself (`:1212` prose vs `:1366` blocker row vs `:1416` tally). **Both readings are carried; neither is a lane's to settle** | An Owner or a register-owning lane reconciling `:1212` with `:1366` and `:1416` |
| **`V-11`** | The enumeration and exact wording of `MI-ι`'s items **A–J** | **No `MI-ι` document exists at any ref.** #185 confirms A–J exist and are *"prepared only"* and **now enumerates them** under *"The ten prepared PostgreSQL work items"* — but `…PERSON-AUTHORITY-TARGET-MODEL.md` §9's headings still carry `SOURCE: LANE BRIEF, NOT VERIFIED AT SOURCE`. **This brief uses #185's own enumeration**, which is verified | Already substantially discharged by #185's enumeration; the per-item **content** of A–J remains a lane's construction |

---

# 8. MISSING INPUT — Owner-only

| # | MISSING INPUT | Bears on |
|---|---|---|
| **1** | **`MI-S`'s axis S-REP.** Is state **B** an outcome the authority returns, or `RESOLVED` + a separately carried eligibility fact? | §1. **Conflict `K-1` — #182 and #185 point different ways and both are binding** |
| **2** | **`MI-S`'s axis S-GRAIN.** Must INACTIVE be distinguishable from TERMINATED inside B? | §1. *"The ruling neither requires nor forbids the distinction"* |
| **3** | **Does state B BLOCK the enforcement gate, or is it reported only?** If reported only, `censusGate`'s contract must be amended **in the same change** so the non-blocking-ness is declared, not emergent | Acceptance contract `G-3`; `OI-10` |
| **4** | **Are EXISTENCE and STATUS one refusal or two?** The COMPANY axis distinguishes existence and **discards** status, deliberately | Acceptance contract `G-4`; `int-a-correctness-register.md` §12.3.C |
| **5** | **`MI-Y`.** Which of `MI-P`'s two acceptable census architectures? | §2. **#182 reserves it: *"a lane choosing would be designing the architecture the ruling reserved"*** |
| **6** | **The `link_source` successor question.** Governed successor provenance, or declared retirement, for `RECIPROCAL_FIREBASE_UID_LINK`? **And what label does it carry?** | §3.3. **Unregistered under any `MI-` id** |
| **7** | **`MI-λ`.** What is the declared, legal disposition of a row whose person reference does not resolve — neither a rewrite nor a silent drop? | §4.1. **Without it, §4.2 is not executable** |
| **8** | **`MI-ε`.** Does Layer 1 fail closed on the people `employees` does not represent, declaring real actors non-existent, or is completeness a precondition? | §4.2 step 8. **A product decision about real people being refused** |
| **9** | **`MI-T` / `MI-η`.** Is AUTHORITY UNAVAILABLE a distinct outcome? **#185 named and deferred it** | §3.1; no-silent-fallback mechanism ④ |
| **10** | **`MI-δ`.** Must any part of Layer 1 be enforceable in `firestore.rules`? | §4.2 step 11 — *"the transition's largest un-priced cost"* |
| **11** | **`MI-θ`.** Is technician linkage in the minimum model at all? | §3.2 |
| **12** | **`MI-J`.** Which employee fact is authoritative for *"this person can no longer act"*? | `MI-S`'s grain; work item **B** |
| **13** | **`MI-K`** *(acceptance contract)*. Are a **DELETED** employee document and a **NON-EXISTENT** one one case or two? | State **C**'s grain; interacts with `MI-U` |
| **14** | **`MI-C`** *(acceptance contract)*. What happens on each of the **nine** departure states? *"The matrix is ENTIRELY `NO CHANGE` today, which is a description of the gap, not a statement of intent"* | `MI-S`'s grain, decisively; `OD-11a` |
| **15** | **`OD-11a`.** On departure, what is RELEASED and what is RETAINED? | `MI-S`'s remediation half. **A proof must not smuggle a release policy in as a census bucket** (`G-7`) |
| **16** | **`OD-10`.** Is a responsibility fact USER-VISIBLE or an internal scoping key? | Every Lists/Search and reporting consequence in §1.6a and §2.7a |
| **17** | **`MI-W`.** Is there an Owner exception list to *"exactly one accountable person"*? | `MI-Y`'s family envelope: **9 or 12** |
| **18** | **`MI-κ`.** The governed JOB-ROLE vocabulary, and who may occupy it | Nothing can **name** an accountable person without it |
| **19** | **Authorization for the environment reads `V-1`…`V-4` and `V-7`…`V-8` require.** No environment was contacted and none may be | The magnitude of everything above |

---

# 9. CORRECTIONS — things this lane found wrong, including in the controlling brief

| # | The statement | Finding at source | Severity |
|---|---|---|---|
| **`E-1`** | `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:825-838` (§12.3b) reading **`R-III`**: *"the acceptance contract's case 2 on `ext/census-acceptance` says the ruling **CONFIRMS** `C-B3`"*, marked **`U-13`**, *"NOT VERIFIED BY THIS LANE. That branch was not read"* | **WRONG, AND THAT `U-13` IS DISCHARGED. That branch was read this lane.** `PERSON-OWNER-CENSUS-ACCEPTANCE-CONTRACT.md` **does not discuss #182 at all** — it predates the ruling and says so: *"**`OD-6` is unruled**"* (`P-8`), *"**No Owner question answered.** `OD-6`'s substance is carried as `G-1`…`G-7`, **unruled**"* (§11). And its §4 **case 2 requires the opposite of `C-B3`'s TERMINATED row**: for an employee who *"exists but is not `ACTIVE` (`INACTIVE`, on leave, `TERMINATED`)"* the resolver must return **"NOT `RESOLVED`"**. `C-B3`'s TERMINATED row required **`RESOLVED`** plus a separately reported fact. **So the contract is nearer to `R-II` than to `R-I`, and `R-III` as characterised does not exist in the document.** `R-III` must be **WITHDRAWN**; `R-I` and `R-II` stand | **MEDIUM.** It removes a *"live disagreement between two lanes"* that was never a disagreement, and it is the third pass over one sentence — the failure class #183 records as the method lesson |
| **`E-2`** | `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1440-1446` / `:1506` (**X-17**): *"`grep -rn 'BUSINESS CASE' docs/` → **0 hits***… *'`fieldops_jobs` A/B' and 'BUSINESS CASE NOT ESTABLISHED' are not findings of this register and **should not be carried forward**"* | **HALF WRONG.** Both phrases **are** locatable at source — `int/a-correctness-register:docs/integration/int-a-correctness-register.md:622` (a section heading) and `:650` (a status line). That file **does not exist on `ext/own-engineering-gap`**, where the grep ran. **`X-17` is right that they are not findings of the decomposition and right about `OI-13`'s gates (`OD-8` + the emulator). Its instruction not to carry them forward must not be followed** — the status is a live, sourced finding of the correctness register, and the Owner's instruction to preserve it is correct | **MEDIUM.** A correction that would have deleted a real finding |
| **`E-3`** | `…PERSON-AUTHORITY-TARGET-MODEL.md:79` and `:875` cite the technician-denial files as `employeePrincipalLinkPlan.ts:24-25` and `employeePrincipalLink.ts:46-47` | **Two paths are wrong and one line number is off.** Neither file is under `functions/src/access/`; both are under **`functions/src/employeeIdentity/`** at `64008d5a`. `LINK_SOURCES` is at `employeePrincipalLink.ts:**49**`, with the *"no third term"* prose at `:43-47`. **The substance of all four denials is exact, including the DDL one at `1758412800000:90` with its `CHECK` at `:86-92`** | **LOW** — citation hygiene, and the fourth (DDL) citation is exact as given |
| **`E-4`** | **#185**, *"ARCHITECTURE AUTHORITY CONFLICT"* clause 2, cites *"zero Firebase dependency"* at `docs/architecture/inventory-reference-authority-p1b-census.md:1021` | **NOT LOCATABLE AT `:1021`.** At `64008d5a` that line is a disposition-table row about `fieldops_technicians`. Checked `:1018-1024` and `:1042-1046`. **The standing target is not in doubt** — the manifest's own `principle` (`:10`) requires all business data to run through the Render EOS API against PostgreSQL — **but the line number should be re-derived by a corrective pass rather than copied** | **LOW** for the finding; **MEDIUM** for method — this is the same class as the withdrawn `MI-ι §6`/`§11` citations |
| **`E-5`** | The Owner's dispatch: *"`:1212` + `:1358` yield **6** named. **Find the seventh or report that 7 is wrong.**"* | **7 is CORRECT, and the Owner's set of six is not the register's set of seven.** The authoritative tally at `:1416` names `OI-02`, `OI-03`, `OI-32`, **`OI-35`**, `OI-37`, `OI-40`, plus **`OI-05` secondarily** — the seventh. **The Owner's six included `OI-10` (which `:1366` and `:1416` gate on `MI-U`/`MI-S`, not `MI-X`) and omitted `OI-35` (which `:1391` gates on `MI-X` explicitly).** Under the alternative reading of `:1212`, the count is **8**, never 6 | **MEDIUM.** It changes which items an Owner ruling unblocks |
| **`E-6`** | The Owner's dispatch: *"**`MI-Y` is free**"* and the implicit instruction that this lane assign it | **`MI-Y` is free, and the rename has already been recorded — this lane did not need to and should not re-make it.** `int/a-correctness-register:docs/DECISIONS.md:7104-7135`, heading *"Register hygiene — `MI-X` DECISION-ID COLLISION, resolved 2026-09-13"*, already records the identical mapping and states *"**`MI-X` is RETIRED AS AMBIGUOUS, not overwritten.**"* **This brief conforms to that record rather than duplicating the act.** Also: the accurate free set is `MI-L`, `MI-M`, `MI-O`, `MI-Y`, `MI-Z` — **`MI-O` is unused**, which the record's *"`MI-A`…`MI-K`"* phrasing implies but does not say | **LOW** — no substantive change; recorded so the rename has one origin, not two |
| **`E-7`** | The Owner's dispatch names **three** conflicting architecture statements | **There are FOUR of the same kind, and a FIFTH of a different kind.** `firebase-exit-manifest.json:**10**`'s top-level `principle` carries the identical `/Employee` defect and is named in **neither** the Owner's brief nor #185's reconciliation. `docs/PROJECT_ARCHITECTURE.md:88` (*"Firestore is the source of truth for all operational data"*) is a fifth conflicting statement of a broader kind, already recorded by `…PERSON-AUTHORITY-TARGET-MODEL.md:1078-1112` and **kept out of the smallest correction** here | **MEDIUM.** A correction pass scoped to three sites would leave the manifest's governing sentence wrong |
| **`E-8`** | The Owner's dispatch cites the ratchet's identity carve-out at `firebase-exit-ratchet.md:**4**` | **The sentence spans `:4-5`; `Principal/Employee` sits on `:5`.** Verified at `64008d5a`. **The finding is exact; the citation should be `:4-5`** | **LOW** — citation precision |
| **`E-9`** | The Owner's draft migration order places *"establish Employee relation"* at position **5**, after *"establish canonical Employee population"* (2) and *"establish governed legacy crosswalk"* (3) | **That order is impossible.** Item **A**: *"R1 must exist before D and before E."* Item **D**: *"**D is impossible before A.**"* The draft's step 2 **is** item **E**, which populates R1. **The relation must be established first** — §4.2 step 4 | **HIGH** for the order; the draft's other steps survive with the corrections in §4.2 |
| **`E-10`** | The Owner's draft has one step, *"remove transitional fallback"*, and one step, *"retire legacy stores"* | **Both need splitting.** There is **no fallback to remove** — the requirement is that one never becomes **constructible**, enforced by import closure and a pinned ratchet (§4.2 step 13; §9.6). And *"retire legacy stores"* as one step **would destroy data**: `users` retires, Firestore `employees` becomes **ARCHIVE and is never deleted** (item **C**; **#182** *"2."*), and `fieldops_technicians` retires **last and only after `TECHNICIAN_ONLY_BUSINESS_FACT` is re-homed** | **HIGH** for the retirement step |
| **`E-11`** | The Owner's draft treats *"reconcile invalid/missing"* as an executable step | **"Reconcile" has no legal meaning yet.** **#182** *"10."* forbids backfill and *"8."* forbids automatic history rewrite, so the step can only be **enumerate and declare** — and what the declaration may say is **`MI-λ`**, which is open. **Without `MI-λ`, this step has no defined outcome and neither does the constraint attempt that depends on it** | **HIGH** — it is the gap that makes the corrected order non-executable |
| **`E-12`** | `…PERSON-AUTHORITY-TARGET-MODEL.md:1086` records `MI-X` sense 2 as gating *"**J**, and 7 register items"*, while `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1212`'s own prose enumerates five and its `:1416` tally seven | **The two documents agree on the number and disagree on the membership** (§0.4, D-1 and D-2). **Carried both ways as `V-10`, not resolved.** The per-item blocker rows at `:1358`-`:1396` are the better authority than either summary, and they yield the `:1416` set exactly | **MEDIUM** |

---

# 10. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

- **No answer to `MI-S` and no answer to `MI-Y`.** Both return **NO RECOMMENDATION — OWNER POLICY REQUIRED**,
  with the evidence for why in §1.10 and §2.9.
- **No answer to** `MI-U`, `MI-T`/`MI-η`, `MI-V`, `MI-W`, `MI-J`, `MI-α`, `MI-β`, `MI-γ`, `MI-δ`, `MI-ε`,
  `MI-ζ`, `MI-θ`, `MI-κ`, `MI-λ`, the `link_source` successor question, `O-1`, `M-1`, `M-2`, `M-3`, `OD-8`,
  `OD-10`, `OD-11a`, `OD-13` or `OD-16`.
- **No reopening of `MI-ι`.** The person-authority target is taken as settled throughout.
- **No naming.** **No enum, field, collection, index, table, column, command, code token or interface name is
  proposed anywhere.** Where a distinction is required, only its **distinguishability** is stated — **#182**
  *"3."* withholds the names and **#185** confirms *"Naming is explicitly not frozen."*
- **No schema, no DDL, no migration, no backfill, no repair path, no Rules change, no deploy, no data
  mutation, no production or non-production contact, no secret requested or exposed.**
- **No implementation of the architecture documentation correction.** §5 **prepares** it. `firebase-exit-manifest.json`,
  `firebase-exit-ratchet.md` and `PROJECT_ARCHITECTURE.md` are outside this lane's allowed surface and **none
  was touched.** **Firebase's scope is not expanded anywhere.**
- **No UI design.** §1.6a and §2.7a are **DESIGN INPUT ONLY** and are labelled so at the head of each. The
  revised Employee propagation design pass owns those surfaces.
- **No collapse.** ACCOUNTABLE PERSON, ASSIGNEE and RECORD OWNER remain three facts. No generic `ownerId` or
  `accountableId` — **#180** invariant 10.
- **No standing ruling reversed as a side effect.** Where an option would reverse one, it is named on the
  option: `O-1` under any Layer-1 lookup; **R-20** / `P-3` if status-checking spread to the COMPANY axis.
- **No conflict resolved to make the document tidier.** `K-1` is carried with both readings; `MI-S`'s three
  `R`-readings are carried minus the one **withdrawn on verification** (`E-1`); §0.4's `D-1` is carried both
  ways.
- **No schedule.** §4.2 states **dependencies**, not dates.
- **No implementation authorization.** All **42** items in
  `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` and all ten prepared PostgreSQL work items **A–J** remain
  `IMPLEMENTATION STATUS = NOT AUTHORIZED`.
- **Nothing written outside this file. Not pushed. No PR.**
