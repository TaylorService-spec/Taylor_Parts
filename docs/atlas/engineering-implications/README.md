# Atlas Engineering Implication Register

**Purpose.** One register for every *engineering implication* the Atlas program discovers: a
statement of what the platform would have to become for a stated user need to be served honestly,
recorded at a fixed baseline, with its evidence attached and its authority impact named.

An entry in this register is **documentation and design only**. No entry authorizes code. Every
entry carries `IMPLEMENTATION STATUS: NOT AUTHORIZED` when it is created, and only the Owner
changes that value.

---

## Baseline discipline

| | |
|---|---|
| **Baseline tag** | `ATLAS-BASE-2026-09-12-A` |
| **Baseline SHA** | `64008d5ae0bdd9532909671b15a91122400accf1` (post-Wave-1 `main`) |
| **Short form used in entries** | `OBSERVED AT: 64008d5a` |

Every code-derived fact in every entry carries a `file:line` citation **and** the baseline SHA.
A figure without both is not evidence, it is a recollection. Three agents on this program had a
figure corrected because it came from a different branch; a claim in this register that cannot be
re-derived at `64008d5a` is a defect in the entry, not a difference of opinion.

Where a thing could not be established, the entry says **UNPROVEN** and names what would settle it.
"UNPROVEN" is a finding. An invented join, an assumed count, or a plausible-sounding derivation is
not.

## Source note: Design r1 is not yet in the repository

The Atlas **Design r1** artifacts are **not present in the repository at `64008d5a`**. `docs/atlas/`
does not exist at this baseline (created by this entry), and `docs/north-star/` carries no reporting
surface — its subdirectories are `dispatch-board`, `equipment`, `financials`, `lists`,
`my-dashboard`, `opportunity`, `parts`, `receiving`, `sales-agreement`, `service-operations`, plus
`VISUAL-SYSTEM.md`. **OBSERVED AT: 64008d5a.**

Consequently `SOURCE NORTH STAR` for the first entry is **an Owner ruling, not a page**. When the
r1 artifacts land, entries should be amended to cite the page, and the ruling retained as the
provenance of the design that preceded it.

---

## Entry schema

Each entry carries exactly these fields, in this order:

| Field | Meaning |
|---|---|
| `SOURCE NORTH STAR` | The design artifact or Owner ruling the need comes from. |
| `USER NEED` | What a person is trying to do, stated as the person would state it. |
| `DESIGN ELEMENT` | The specific element of the design that creates the implication. |
| `CURRENT EOS STATUS` | `AVAILABLE NOW` / `PARTIAL` / `MISSING` / `UNKNOWN — REVERIFY`. |
| `OBSERVED BASELINE` | The SHA the status was measured at. |
| `TYPE` | One or more of the type set below. |
| `AUTHORITY IMPACT` | What this would do to who may assert what. The governance question. |
| `WORKFLOW IMPACT` | What changes in the work people actually do. |
| `PROPOSED DIRECTION` | The design. Not a plan, not a schedule, not an authorization. |
| `DEPENDENCIES` | What must be true or decided first. |
| `ACCEPTANCE / PROOF` | The test that would demonstrate the design is correct — including the negative case. |
| `IMPLEMENTATION STATUS` | Begins `NOT AUTHORIZED` for every entry, without exception. |

### `CURRENT EOS STATUS` values

| Value | Means |
|---|---|
| `AVAILABLE NOW` | The need is served today, correctly, at the baseline. |
| `PARTIAL` | Something exists; it does not serve the need as stated. Say precisely what is missing. |
| `MISSING` | Nothing exists. |
| `UNKNOWN — REVERIFY` | Could not be established at this baseline. Must name what would settle it. |

### `TYPE` set

`READ MODEL / PROJECTION` · `API / TRANSPORT` · `GOVERNED COMMAND` · `DATABASE / SCHEMA` ·
`PERFORMANCE` · `SEARCH` · `FRONTEND PRIMITIVE` · `RESPONSIVE ENGINEERING` · `ACCESSIBILITY` ·
`AI INFRASTRUCTURE` · `OBSERVABILITY / AUDIT` · `TESTABILITY`

---

## Standing rules an entry may not contradict

These are the Owner's, and they bind every entry in this register.

1. **SINGLE_COMPANY** facts may be directly company-filtered.
2. **COMPANY_NEUTRAL** objects **must remain company-neutral** unless business authority
   independently establishes otherwise.
3. A company-scoped report needing neutral-object context **must derive it through an authoritative
   company-bearing relationship/fact**, or **explicitly identify the result as tenant/customer-neutral**.
4. Never write a `where(operatingCompanyId == x)` predicate against an object that has no such
   authoritative field.
5. Do not duplicate company authority onto Account / Contact / Location for reporting convenience.
6. `operatingCompanyId` ∈ { `taylor`, `ventana` } and is **never inferred**.
   (`functions/src/ownership/operatingCompanyAuthority.ts:23-24`, **OBSERVED AT: 64008d5a**.)

A corollary this register adds, from `ENG-IMPL-001`'s evidence: **rule 4 cannot be decided from the
matrix's `companyScope` column alone.** See ENG-IMPL-001 § "The two-column question".

---

## Entries

| ID | Title | TYPE | CURRENT EOS STATUS | IMPLEMENTATION STATUS |
|---|---|---|---|---|
| [ENG-IMPL-001](./ENG-IMPL-001-company-scoped-reporting.md) | Company-scoped reporting over company-neutral objects | READ MODEL / PROJECTION · DATABASE / SCHEMA · PERFORMANCE · OBSERVABILITY / AUDIT · TESTABILITY | `MISSING` | `NOT AUTHORIZED` |

---

## Open Owner decisions tracked across the register

Carried, never answered by an entry. An entry may state what turns on a decision; it may not decide it.

| ID | Decision | First raised by |
|---|---|---|
| `OD-R1` | Does a report default to the runner's company, or require an explicit company filter? | carried into ENG-IMPL-001 |
| `OD-R2` | Is a saved report private user data, or shareable configuration? | carried into ENG-IMPL-001 |
| `OD-R3` | Should ownerless rows be invisible to every runner? | carried into ENG-IMPL-001 |
| `OD-R4` | Is a **company-derived** result acceptable as an answer to "show me my company's records", or must the answer be either genuinely company-scoped or honestly neutral? | ENG-IMPL-001 |
| `OD-R5` | An Account or Location with governed activity from **both** companies: both reports, neither, or a company-neutral section? | ENG-IMPL-001 |
| `OD-R6` | How is a `PARTICIPATING_COMPANIES` row attributed for counting and for totals under a single-company scope? | ENG-IMPL-001 |
| `OD-R7` | May a Contact report carry an Account-inherited derived scope, or must Contact reports be declared company-neutral? | ENG-IMPL-001 |
| `OD-R8` | May an aggregate be computed over a company-derived population, or must it be refused? | ENG-IMPL-001 |
| `OD-R9` | May a fixture-backfill-only company fact ever be a derivation source? | ENG-IMPL-001 |
| `OD-R10` | Should `equipment` get a live company writer and a report-catalog company field, becoming the first genuinely company-scoped report object? | ENG-IMPL-001 |
| `OD-R11` | Where does the single company-scope authority for reporting live, and what happens to the existing restatements? | ENG-IMPL-001 |
