# REMAINING DECISION TRIAGE — the 17 carried decision ids, classified

**LANE** `DECISION-TRIAGE-17` · **MODE** `EVIDENCE_WRITE` · **NO IMPLEMENTATION** · branch
`ext/census-acceptance` · **BASELINE `64008d5ae0bdd9532909671b15a91122400accf1`**

**What this is.** A triage, not a census. Seventeen decision ids that a register still lists are read **at
source**, classified into exactly one of five classes, and the residue that genuinely still needs Owner
policy is consolidated into **one** packet. The Owner's instruction governs: *"Do not manufacture decisions
merely because an old register still lists them."*

**What this is not.** No implementation. No schema, migration, Rules change, backfill, deploy, data
mutation or UI. No answer to any category-C decision. No naming is frozen — not the `OD-6` person-reference
states, not any new field, not any register label. No decision on the do-not-reopen list is reopened:
`OD-1` (#180) · `MI-N` (#181) · `OD-6` / `MI-P` / `MI-Q` / `MI-R` (#182) · `M-4` (#183) · `OD-7` (#184) ·
`MI-ι` (#185) · `MI-S` (#186) · `MI-Y`, `AUTHORITY_UNAVAILABLE`, `MI-θ`, link provenance, `M-1` (#187).

**Evidence convention.** Every **code, Rules, migration and test** measurement in this document was read at
**`64008d5a`** and is tagged **[OBSERVED AT: `64008d5a`]**. **Document** citations are `ref:path:line` and
are reads of that ref's tip, not of `64008d5a` — stated that way wherever used, because those refs are ahead
of the baseline. Rulings are cited by entry number and by the clause heading inside the entry, never by a
section number of a document that does not exist (the failure class #185 records).

---

## 0. THE FIVE CLASSES

| Class | Meaning | Consequence |
|---|---|---|
| **A** | **ALREADY SETTLED BY A NEWER OWNER RULING** | Close the register row. Cite the ruling and clause |
| **B** | **DERIVED CONSEQUENCE** — an existing ruling logically determines the answer | Record the derivation as a consequence, not as a new decision. **A derivation that cannot be stated in two sentences is a C** |
| **C** | **TRUE OWNER POLICY DECISION** | Goes in §2's packet, and only there |
| **D** | **OBSOLETE / SUPERSEDED** | Close the row; the question no longer has a subject |
| **E** | **NON-BLOCKING** | Register hygiene or bookkeeping. Not an Owner gate |

---

## 1. THE SEVENTEEN — CLASSIFICATION

Question text is quoted from the authoritative source named in the same row. Where a row is **A** or **B**
the clause or derivation is given in the last column; **two sentences is the ceiling for a B**.

| # | ID | SOURCE (document · line) | EXACT QUESTION, as the source states it | CLASS | RULING CLAUSE / DERIVATION |
|---|---|---|---|---|---|
| 1 | **`MI-λ`** | `ext/own-engineering-gap:docs/operating-model/architecture/PERSON-AUTHORITY-TARGET-MODEL.md:1097` (§9.8) | *"**Is item E a "backfill" under `#182` §10, or a governed datastore move of an existing record?** And **what is the declared disposition of a row whose person reference does not resolve when the constraints of §9.4 are added** — given that it may be neither a rewrite (`#182` §8: do not rewrite history automatically) nor a silent drop (`#180` invariant 6: historical accountability must remain auditable)?"* | **C** | First half is derivable; **second half is not**, and it is the half that gates. §2.1 |
| 2 | **`MI-κ`** | same, `:1098` (§9.8); raised at `…OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1489` (§23) | *"**What is the governed JOB-ROLE vocabulary, and who may occupy it?**"* | **C** | No ruling supplies a vocabulary or an occupant; #180 lists JOB ROLE as a distinct axis and #182 *"4."* forbids defining eligibility as role/capability — so nothing derives it. §2.1 |
| 3 | **`MI-β`** | same, `:1090` (§9.8); also `:571` (§4.2) | *"Does `#182` Layer 1 supersede `O-1`'s exclusion of cross-collection lookup, or does `O-1` stand with resolution at the governed entry point?"* | **A** | **#183, *"Placement consequence — ruled, not inferred"*:** *"**DO NOT put authoritative Employee existence lookup inside the synchronous audit writer or the pure builder**"*, and the same clause states the ruling *"is consistent with ruling `O-1`, cited in code at `typedOwner.ts:44-48` as excluding 'a fallible cross-collection lookup into otherwise deterministic ownership resolution.'"* **#184**'s *"Why no second authority lookup in the writer"* places resolution at the orchestration/read boundary. **Reading (ii). `O-1`'s exclusion is affirmed, not superseded** |
| 4 | **`MI-γ`** | same, `:1089` (§9.8); also `:572` | *"Must a person reference resolve an **Employee only**, or an Employee **and** a live principal link?"* | **B** | **#185**'s *"`OD-6` Layer 1 consequence"* enumerates what Layer 1 must establish — *"employee exists · employee identity is authoritative · employee status · historical identity preservation · current eligibility facts required by the caller"* — and **a principal link is not in that list**, while the same clause names *"Principal existence alone"* insufficient. Requiring a **live** principal link would make business-person existence conditional on security identity, which is exactly the collapse #185 forbids (*"**Never collapse** EMPLOYEE into PRINCIPAL"*) — **so Layer 1 resolves an Employee only**; the link is the governed crosswalk, not the existence predicate |
| 5 | **`MI-δ`** | same, `:1088` (§9.8); also `:573` | *"Must any part of Layer 1 be enforceable in `firestore.rules`?"* | **B** | **#185** rules the canonical Employee authority into **EOS-owned PostgreSQL** and requires the port be swappable to it *"without changing `OD-7` orchestration semantics"*; **no PostgreSQL relation can be read from `firestore.rules`**, so a Rules-enforceable Layer 1 is incompatible with the ruled target authority. **#184** independently forbids a second authoritative lookup below the orchestration boundary (*"would create two authority decisions that could drift"*) and supplies defence in depth by other means — **so the answer is NO**, and the Employee-document reads presently in Rules are access control to be re-homed at cutover, not Layer-1 enforcement. **See §3(2) for a correction to this row's own citation** |
| 6 | **`MI-ε`** | same, `:1087` (§9.8); also `:574` | *"`employees` is **not the complete person population**. Does Layer 1 **fail closed** on those people — declaring real actors non-existent — or is completeness a **precondition**?"* | **C** | #182 *"1."* fixes the **resolver's answer** for an absent person; it does not decide whether enforcement may be **activated** over a knowingly incomplete population. §2.1 |
| 7 | **`MI-ζ`** | same, `:1091` (§9.8); also `:575` | *"Is the Employee authority answered **for now** in Firestore with the PostgreSQL move left to `BA-7`, or must both be decided together?"* | **A** | **#185, *"Interim path — no big-bang migration"*:** *"The governed person-resolution port must allow a **current transitional implementation** to be replaced by the **PostgreSQL implementation** without changing `OD-7` orchestration semantics. **One authoritative implementation at a time. No long-lived dual authority. No silent fallback** from PostgreSQL to Firestore after cutover."* **The authority is decided (PostgreSQL) and sequencing behind a port is expressly permitted** — which is the question. The ordering constraint §9.4a(3) identifies is `MI-λ`'s territory, not a reopening of this |
| 8 | **`MI-U`** | same, `:1082` (§9.8); raised at `…DECOMPOSITION.md:1207` (§17) | *"Is state **C** (`MISSING / INVALID_REFERENCE`) **one** state or **two**? Today *missing* blocks the gate (`ownershipCensus.ts:231`) and *invalid reference* cannot block at any quantity — **opposite treatment for one ruled state**"* | **B** | **#186**'s five cases give *"id does not resolve"* **one** row (**case D**, *"INVALID / MISSING"*, eligibility *"NOT APPLICABLE"*), and **#187**'s `AUTHORITY_UNAVAILABLE` ruling treats *"INVALID / MISSING"* as **a single outcome** whose only ruled neighbour is the unreachable-authority outcome — so **C is one semantic state**. #182 *"9."* and *"11."* nonetheless require the census to **detect and prove** *"non-existent"* and *"missing reference"* separately, so C is one state carrying a distinguishable reported reason, and the baseline's opposite gate treatment is **a defect, not a ruled distinction** |
| 9 | **`MI-V`** | same, `:1093` (§9.8); raised at `…DECOMPOSITION.md:1208` (§17) | *"Does Layer 1 extend to the **fifteen** person references of §5.1, including `creditedSalespersonId` and `responsibleEmployeeId` on `person()`'s `nonEmpty`-only floor (`financialAttribution.ts:205-209`)?"* | **C** | #182 *"1."* extends Layer 1 to *"future governed person-reference facts **requiring authoritative identity resolution**"* — **which facts require it is the undecided predicate**, and #182 *"7."* separately protects existing `creditedSalespersonId` semantics. Extension by analogy is not extension by ruling. §2.1 |
| 10 | **`MI-W`** | same, `:1095` (§9.8); raised at `…DECOMPOSITION.md:1209` (§17) | *"`#180` permits "an Owner-approved exception" to the exactly-one-accountable-person rule. **Is there an exception list, and does any of the 9 families hold one?**"* | **B** | **#180 invariant 1** makes the exception **constitutively dependent** on its own precondition: *"unless **an explicit, separately Owner-approved exception** defines otherwise."* No such separate approval exists in #180–#187, **so the exception list is EMPTY and no family holds one** until the Owner approves one. Family-applicability is a **different mechanism** — #180 invariant 9 and #182 *"3."* state **D** `NONE` *"only where the family legitimately permits no person reference"* — so the residual 9-or-12 indeterminacy is **classification (`OD-16`) plus unproven liveness (`U-4`/`U-5`/`U-17`)**, not an exception list |
| 11 | **`MI-α`** | same, `:1096` (§9.8); also `:581` (§4.2) | *"The label. This question is registered as `OI-39` / `V-15` / `X-13` / `BA-7`. Which governs, and is a new ref to be issued?"* | **E** | Its **subject** — which collection is the canonical person authority — is **CLOSED by #185**, and its **collision** half is closed by #185's register-hygiene entry. What remains is which of four labels governs: **bookkeeping**, blocking no register item (`OI-39` is now *"BLOCKED BY MIGRATION"*, `…DECOMPOSITION.md:1395`), and #185's own register-hygiene entry is the standing precedent that such a resolution is recorded *"**Not an Owner ruling**"* |
| 12 | **`O-1`** | **`functions/src/ownership/typedOwner.ts:4-5`** (*"why the `USER` id namespace is the canonical Employee id (open item O-1)"*) and **`:44-48`** (the exclusion) **[OBSERVED AT: `64008d5a`]**; carried at `ext/census-acceptance:…/MI-S-AND-MI-Y-DECISION-BRIEFS.md:1034` | *"Whether the `USER` id namespace is the canonical Employee id, and whether `O-1`'s exclusion stands"* | **B** | **#185** fixes the chain *"CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE. Never *Firebase user → therefore Employee*"* and names *"a Firebase uid"* **insufficient as proof that an Employee exists** — **so the `USER` namespace is not the canonical Employee id**, in target or interim. The exclusion half is settled the same way as `MI-β` (#183's Placement-consequence clause affirms `O-1`); **what remains is which namespace the stored ids actually occupy, an unmeasured fact (§4 `V-O1`), not a decision** |
| 13 | **`M-2`** | `ext/own-decision-packet:docs/operating-model/owner-decisions/OD-7-DECISION-BRIEF.md:544`, expanded §15.2 `:707-735` | *"**Which carrier must a governed responsibility move use** — the handoff fields (`previousOwner`/`newOwner`/`handoffSource`/`handoffReason`) or the field-change fields (`fieldKey`/`previousValue`/`newValue`)?"* — sharpened at `:729` to *"does `#181`'s ONE GOVERNED OPERATION mean one AUDIT EVENT or one TRANSACTION?"* | **B** | **#183/#184**'s canonical sequence — *"READ AUTHORITATIVE FACTS · VALIDATE · WRITE RESPONSIBILITY CHANGE · WRITE AUDIT · COMMIT"*, *"commit atomically"* — **is a transaction, not one event**, which answers the sharpened prior question and makes #181 satisfiable with no new field. The carrier then follows **by exclusion**: `FIELD_CHANGE_ACTIONS` is a **one-member set** (`auditEventWriter.ts:415`, `"updateEmployeeProfile"`) and the field-change fields are **refused on every other action** (`:661-670`) **[OBSERVED AT: `64008d5a`]**, so a governed ownership or accountability move can only ride the handoff carrier — and #184's *"Bypass paths are DEFECTS"* clause makes the free-text `summary` path a defect rather than a third carrier. **Residue is engineering, not policy** (an accountability endpoint pair needs fields whose **names** #182 *"3."* withholds) |
| 14 | **`M-3`** | same, `:545`, expanded §15.3 `:736-745` | *"**Is `(d-wire)` — do not wire yet — intended to remain in force after the `OD-7` placement is ruled?**"* — i.e. does a placement ruling authorize wiring | **A** | **#184, *"Status and what is still blocked"*:** *"**`OD-7` closure does NOT authorize implementation.**"* Reading 1 confirmed verbatim, and restated in #185, #186 and #187, each of which keeps all 42 items `IMPLEMENTATION STATUS = NOT AUTHORIZED` |
| 15 | **`OD-8`** | `emp/own-synthesis:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md:140` | *"**Accept the ownership-write exposure, or narrow Rules now?**"* — `accounts.accountOwner`, `contacts.owner`, `locations.owner`, `fieldops_jobs.operatingCompanyId` *"rewritable by any `admin` **or** `dispatcher` via a generic client write — **unguarded … and unaudited**"* | **B** | All four are **governed ownership fields**: `ownershipMatrix.ts:119-120` `accounts`/`accountOwner`, `:127-128` `contacts`/`owner`, `:134-135` `locations`/`owner` — all `ownerClass: "PERSON"`, `transfer: "HANDOFF"` — and `:267` `fieldops_jobs` `ownerClass: "COMPANY"` **[OBSERVED AT: `64008d5a`]**. **#184, *"Bypass paths are DEFECTS"*:** *"**Any** runtime mutation path capable of changing governed RECORD OWNERSHIP or ACCOUNTABILITY without passing through the governed orchestration boundary is a **DEFECT**. Do not make the writer compensate for a bypass — **eliminate or refuse the bypass**."* **So "accept the exposure" is no longer an available disposition.** What remains is **when and by which mechanism**, which #184 already routes into its required *"end-to-end call-path census"*, and which inherits `U-9` (§4) |
| 16 | **`OD-13`** | same, `:156` | *"**Is there a governed "I COULD NOT COMPLETE THIS" outcome — and is `Cancel` an acceptable escalation answer for a dispatched Work Order in the interim?**"* | **C** | #186 *"8."* makes reassignment and escalation behaviour *"**workflow-specific**"* and #186 *"13."* lists *"workflow-specific reassignment · automatic escalation"* among what is **explicitly NOT decided**. §2.1 |
| 17 | **`OD-16`** | same, `:159` | *"**Classify `inbound_work_requests` and the three email collections; and are Approval/Exception and Report-execution governed families? And does a Work Order get company storage, from where?**"* | **C** | #180 invariant 9 states reference/master-data *"stewardship model must be defined separately"*; no ruling classifies a family, and `#143` forbids inferring a Work Order's company. §2.1 |

### 1.1 Counts

| Class | Count | Ids |
|---|---|---|
| **A** — already settled by a newer ruling | **3** | `MI-β` · `MI-ζ` · `M-3` |
| **B** — derived consequence | **7** | `MI-γ` · `MI-δ` · `MI-U` · `MI-W` · `O-1` · `M-2` · `OD-8` |
| **C** — true Owner policy decision | **6** | `MI-λ` · `MI-κ` · `MI-ε` · `MI-V` · `OD-13` · `OD-16` |
| **D** — obsolete / superseded | **0** | — (considered for `MI-α`; its subject is closed but the row still carries live bookkeeping, so **E** is the honest class) |
| **E** — non-blocking | **1** | `MI-α` |
| **TOTAL** | **17** | **A 3 · B 7 · C 6 · D 0 · E 1** |

**The C list grows by one in §2**, and by exactly one: the **Service lifecycle accountability** decision of
§3 is a true Owner policy decision that **is registered under no decision id at any ref** (§3.1). Packet
total: **7**.

---

## 2. THE CATEGORY-C PACKET — one packet, seven decisions

> **Nothing here is answered.** Recommendations appear only where the evidence already in the cited
> artifacts supports one; three rows carry **NONE**, and that is the honest entry. Evidence is **cited, not
> restated**.

### 2.1 Six of the seven, on one screen

| ID | EXACT QUESTION (source in §1) | WHY IT STILL REQUIRES OWNER POLICY | WHAT IS ALREADY SETTLED | OPTIONS | RECOMMENDATION | EXACT ITEMS BLOCKED | WHAT CHANGES PER OPTION |
|---|---|---|---|---|---|---|---|
| **`MI-λ`** | The declared disposition of a person reference that does not resolve, when the constraint is added — see §2.2 | Three rulings each **forbid** an action and **none prescribes one**: #182 *"10."* (no backfill / no repair), #182 *"8."* (do not rewrite history automatically), #180 invariant 6 (historical accountability must remain auditable). **A lane may not choose which prohibition yields** | E is ordered **after** the constraint (`…PERSON-AUTHORITY-TARGET-MODEL.md:995`, §9.4a(3)); the constraint attempt **is** the census (§9.4a(4)); `ownership_handoffs` is append-only by trigger so a bad row is **permanent by design** (§9.4a(2)) | **(a) DECLARE-AND-QUARANTINE** — constrain with the non-resolving rows **retained and flagged**, unmigrated, enumerated in a governed exception register · **(b) PRECONDITION** — no constraint until every reference resolves; Owner-authorized population first (couples to `MI-ε`) · **(c) TOMBSTONE THE REFERENT** — mint a governed **non-actionable** Employee identity that preserves the id without asserting a person | **(a)**, on the evidence already cited: it is the only option that satisfies all three prohibitions at once, and §9.4a(4) already establishes that a failed constraint is a **measurement**. **(c) is the option to name explicitly so it can be refused if the Owner intends it** — see §2.2 | **A**, **D**, **E** (target work) and the ordering of §9.4a(3). Registered items: none directly; **E is the gate on every PostgreSQL relation** | **(a)** the constraint is added and the residue is visible and countable; migration proceeds around it · **(b)** no constraint, no E, no cutover until a population decision lands; couples `MI-λ` to `MI-ε` and to an authorized production read · **(c)** the FK passes immediately — **and fabricates a person**, which §2.2 argues is forbidden |
| **`MI-κ`** | *"What is the governed JOB-ROLE vocabulary, and who may occupy it?"* | Organizational design. #180 separates **JOB ROLE** from accountability as a distinct axis; #180 invariant 9 and #182 *"4."* both **decline** to supply a vocabulary, and #182 *"4."* forbids defining eligibility as capability | Eligibility's **floor** is governed employment/person status (#182 *"4."*), and further constraints are *"per family — do not invent them globally"*. The Employee status vocabulary is **already shipped** and needs nothing new (#186 *"4."*) | **(a)** adopt an explicit governed job-role vocabulary now, with grants · **(b)** defer, and render **honest absence** on every role-keyed surface until it exists · **(c)** declare job role **out of scope** for the accountability program and keep it to escalation/approval surfaces | **NONE** on the vocabulary (org design). **The scope narrowing is evidence-supported:** naming an accountable **person** needs no job role — #182 *"4."* separates them — so `MI-κ` bears on **role-keyed escalation and approval** surfaces only. **This corrects the register's *"nothing can NAME an accountable person without it"*** (`…DECOMPOSITION.md:1489`) | **`OI-04`** — one item, and `OI-04` is **independently** blocked on an Owner role **grant** (`…DECOMPOSITION.md:1360`) | **(a)** `OI-04` unblocks once a grant also lands · **(b)** `OI-04` ships an honest-absence state and a test that it does not render zero — the item's own prescription · **(c)** `OI-04` leaves the accountability backlog entirely and the register is corrected |
| **`MI-ε`** | *"Does Layer 1 **fail closed** on those people — declaring real actors non-existent — or is completeness a **precondition**?"* | **A product decision about real people being refused.** #182 *"1."* fixes what the resolver **answers**; it does not license or forbid **activating** enforcement over a knowingly incomplete population | NON-EXISTENT must not yield `RESOLVED` (#182 *"1."*); `AUTHORITY_UNAVAILABLE` is **distinct** from missing and **fails closed** (#187 *"2."*) — so *"absent from the authority"* and *"cannot ask"* are already **different** outcomes, and this decision is only about the first | **(a) FAIL CLOSED NOW** — an unrepresented actor is refused · **(b) COMPLETENESS PRECONDITION** — no Layer-1 enforcement until the population is complete · **(c) STAGED** — measure and report first, refuse only after a named completeness threshold is met per family | **NONE.** The evidence establishes the **incidence** is unmeasured in production and cannot be measured without Owner authorization (§4 `V-ε`), and choosing to refuse real people is not an engineering call | **A**, **D**, **E** — *"E cannot proceed without it"* (`…PERSON-AUTHORITY-TARGET-MODEL.md:1087`) | **(a)** real actors lose the ability to hold responsibility on day one — the outcome the row exists to surface · **(b)** the cutover waits on a population project of unmeasured size · **(c)** measurement is authorized first and the refusal decision is taken on real numbers — but the interim leaves invariant 1 undetectable, which #180 already names as the gap `OD-6` exists to close |
| **`MI-V`** | *"Does Layer 1 extend to the **fifteen** person references … including `creditedSalespersonId` and `responsibleEmployeeId` on `person()`'s `nonEmpty`-only floor?"* | #182 *"1."* extends Layer 1 to *"future governed person-reference facts **requiring authoritative identity resolution**"* — **which facts require it is the undecided predicate.** #182 *"7."* separately rules that *"existing `creditedSalespersonId` **semantics** must not be silently changed"*, which protects semantics and is silent on the validation floor | #185 rules the **authority**, not the **scope** — the register's own words: extension is *"by analogy, not by ruling"* (`…:1093`). RECORD OWNER (PERSON) and ACCOUNTABLE PERSON **are** in scope and are **independently** validated (#182 *"1."*) | **(a) ALL FIFTEEN** — one Layer-1 floor for every governed person reference · **(b) THE TWO RULED FACTS ONLY** — owner and accountable; the other thirteen keep today's floor and are declared out of scope · **(c) ENUMERATED** — the Owner names which of the fifteen are governed person-reference facts, one list, once | **(c)**, on the evidence: #182 *"4."*'s *"per family — do not invent them globally"* and #180 invariant 10's prohibition on *"one generic `ownerId`/`accountableId` shortcut across all families"* both point away from a blanket rule, and an enumerated list is the form that classifies rather than argues | **`OI-38`** (1 item, `…DECOMPOSITION.md:1394`) and **G**'s scope | **(a)** one floor, and a frozen financial-attribution snapshot becomes subject to it — the largest scope · **(b)** the smallest, and thirteen governed person references stay outside every ruling — the state the register calls a *"second unvalidated governed person-fact floor … that no ruling reaches"* · **(c)** scope is bounded and checkable; the cost is that the Owner reads a fifteen-row list |
| **`OD-13`** | *"Is there a governed "I COULD NOT COMPLETE THIS" outcome — and is `Cancel` an acceptable escalation answer for a dispatched Work Order in the interim?"* | *"It is a business-outcome decision with billing, scheduling and metric consequences"* (the source's own words). #186 *"8."* makes reassignment and escalation **workflow-specific**; #186 *"13."* lists them as **not decided**. And the closure is **deliberate** — this **amends a design decision**, it does not fix a defect | Whatever is added: accountability is **never automatically transferred** (#186 *"8."*, #180 invariants 2 and 4); changing the executor is **not** a handoff (#187 *"5."*: *"REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER"*); any accountability move is an **explicit governed operation** through the OD-7 boundary (#184 B/E); and no transition may create a NONE state (#180 invariant 7) | **(a) NON-COMPLETION OUTCOME** — a governed *"could not complete, and why"* terminal-ish state, with declared billing and metric treatment · **(b) IN-FLIGHT EXECUTOR EXIT** — a non-technician-gated transition that changes the executor only, leaving accountability and ownership untouched · **(c) BOTH** · **(d) NEITHER — `Cancel` is affirmed as the interim answer**, explicitly and on the record | **NONE** on the business outcome. **One evidence-supported constraint:** under #187 *"5."* and #180 invariant 2, **(b)** must change the executor **without** touching accountability or ownership — so (b) is not an `OD-7` handoff and must not be built as one | **`OI-42`** (`…DECOMPOSITION.md:1398`, also via `OI-01`→`MI-W`), plus `EI-14` and `EI-15` (`emp/own-synthesis:…EMPLOYEE-ENGINEERING-IMPLICATIONS.md:96-97`) | **(a)** metrics gain an explicit exclusion instead of a silent one; billing treatment must be declared with it · **(b)** the CRITICAL orphan and the permanently-consumed dispatch capacity both clear; a non-completion outcome still does not exist · **(c)** both, and `U-8` (parts consumption on a cancelled WO) must be settled with it · **(d)** the register row closes as an accepted business outcome — and *"the ONLY expressible response to an unavailable technician is to CANCEL THE RECORD OF A LIVE CUSTOMER COMMITMENT"* becomes ruled rather than residual |
| **`OD-16`** | *"Classify `inbound_work_requests` and the three email collections; and are Approval/Exception and Report-execution governed families? And does a Work Order get company storage, from where?"* | Family classification is a business decision — the source's own recommendation is *"CLASSIFY IT … **Which class is a business decision**"*. No ruling classifies a family; #180 invariant 9 sends reference/master-data stewardship to *"a separate decision"* | #182 *"3."* state **D** `NONE` applies *"only where the family legitimately permits no person reference"* — so classification **determines** whether a family needs an accountable person; `#143` forbids **inferring** a Work Order's company; #180 invariant 8 permits COMPANY ownership **with** a PERSON accountable | **(a) OWNABLE** (which class, per collection) · **(b) REFERENCE** · **(c) EXCLUDED** — each with the matrix's required justification; and for the Work Order company: **(i)** store it explicitly, **(ii)** derive it from an authoritative upstream, **(iii)** declare it not carried | **PARTIAL, attributed:** the source's recommendation is *"CLASSIFY IT — the matrix's own rule requires it"*, and that is evidence-supported: the matrix's own header says a collection absent from the file *"would be indistinguishable from one nobody thought about"*, and **four** live collections are absent. **Which class is not recommendable.** On the Work Order company, **(ii) is not available as an inference** — `#143` forbids it, and *"11/30 carry a `salesOrderId` … to be measured, NEVER ASSUMED"* | **`OI-05`** (1 item, `…DECOMPOSITION.md:1421`); `EI-06` and `EI-24` (`…EMPLOYEE-ENGINEERING-IMPLICATIONS.md:88`, `:106`); and `MI-W`'s residual family envelope via `OI-01` | **(a)** the family enters the accountability envelope and needs an accountable person and a steward · **(b)** stewardship must be defined separately (#180 invariant 9) and state **D** becomes available · **(c)** the collection is declared out of the model and the *"first object in the service chain"* stays unclassified by decision rather than by omission · Work Order company: **(i)** a governed field and a source · **(ii)** refused by `#143` unless the Owner rules the SO authoritative **as a source, measured** · **(iii)** every per-company service number stays impossible (`WF-SVC-016`: *"Step 3 is impossible"*) |

### 2.2 `MI-λ` — the legacy-reference migration policy, in prose, because it needs it

**This is the one row where the constraint set is physical and the prohibitions collide.**
**[OBSERVED AT: `64008d5a`]** for every measurement in this section.

**The physical constraint.** `ownership_handoffs` is append-only and trigger-protected:
`refuse_ownership_history_mutation` raises on **UPDATE or DELETE** of any recorded row
(`functions/migrations/1758844800000_commercial-ownership-authority.sql:295-305`), with its own hint —
*"A correction is a NEW handoff row with source ADMIN_CORRECTION, not an edit to the old one."*
`commercialOwnershipRepository.ts:21-23` records that there is deliberately **no** update and **no** delete
function *"because the absence of a function is a property of"* the code rather than of the database alone.
**So its rows cannot be cleaned up later.** And in the same `CREATE TABLE`, **four** columns carry foreign
keys while the **two person columns carry none**: `:258` `tenant_id → eos_policy.tenants(id)`, `:259-261`
the three record ids, against `:262` `previous_owner_employee_id TEXT` and `:263`
`new_owner_employee_id TEXT NOT NULL` — **no FK, no CHECK**.

**Two absolute limits the options must respect, and they are why (c) is named rather than omitted.**

1. **Never fabricate an Employee to make an FK pass.** A minted Employee row is an assertion that a person
   exists. #182 *"1."* rules that **NON-EXISTENT must not produce the same authoritative `RESOLVED` result as
   a real Employee**; a fabricated row produces exactly that, and does it in the authority rather than in a
   resolver, where nothing downstream can ever detect it. **Option (c) is only admissible if the minted
   identity is governed as explicitly NON-ACTIONABLE and never resolves to `VALID_CURRENT`** — and even then
   it is the Owner's call, not a lane's, because it writes a person into the person authority.
2. **Never delete immutable history because a person reference is bad.** #180 invariant 6 requires historical
   accountability to remain auditable; #182 *"8."* forbids rewriting historical ownership, accountability or
   attribution automatically; #186 *"7."* forbids invalidating historical audit because an employee is no
   longer eligible. The trigger makes this a database guarantee as well as a ruling, and **that is the
   feature**: the row that cannot be deleted is the row whose history is protected.

**Why the first half of `MI-λ` is derivable and the second is not.** #182 *"10."* forbids backfill as a
*mechanism for fixing* references — *"Backfill is NOT the mechanism for fixing historical inactive or
terminated references and may not silently rewrite legitimate history"*. A datastore move that carries each
value across **verbatim** neither fixes nor rewrites anything, so **item E is not the prohibited backfill**;
§9.4a(1) independently calls E *"not a copy, [but] a repair boundary"*, which is the same reading. **That
derivation does not extend to the second half.** Three prohibitions bound the answer and none produces it,
and #182 *"10."*'s own caution — quoted in the source at `…PERSON-AUTHORITY-TARGET-MODEL.md:999` — is that
*"a constraint that cannot be added creates pressure to 'fix' the offending rows — and **that** pressure is
what `#182` §10 exists to refuse."* **A lane that picked a disposition would be applying exactly that
pressure.**

**One thing the Owner should be given with this decision, and it is not yet available.** Whether any row
exists in these columns in any environment is **UNPROVEN** (§4 `V-λ`), so `MI-λ` may be answerable as a
**schema rule before any row exists** — which is the cheapest form of the decision and the one that
disappears if the migrations are applied first.

---

## 3. SERVICE LIFECYCLE ACCOUNTABILITY — the disposition

### 3.1 The marker at source, and the id it does not have

The design marks Service and Dispatch accountability **PROPOSED**, per lifecycle state:

| Source | Text |
|---|---|
| `atlas/employee-v41-input:docs/atlas/inputs/employee-v4.1/08-EMP-PROPAGATION-MATRIX.md:10` | `NS2-SVC r2` … *"Accountable shown: **Yes + PROPOSED tag**"* … *"**lifecycle accountability PROPOSED for NEW/DISPATCHED/IN-PROGRESS/WAITING-PARTS/RETURN/BILLING/EXCEPTION**"* · authority dependency `P2-G5, OD-6` · **"PARTIAL — BLOCKED — OWNER DECISION on lifecycle rules"** |
| same, `:9` | `NS2-DSP-01 r2` … *"Yes + PROPOSED tag (**lifecycle rule unvalidated**)"* · **"PARTIAL — BLOCKED on lifecycle accountability rules"** |
| `…/NS2-SVC Service r2.dc.html:169` | *"**ACCOUNTABLE** K. Ames · next outcome: parts availability confirmed · **PROPOSED ACCOUNTABILITY — WORKFLOW VALIDATION REQUIRED**"* |
| `…/CHANGELOG-EMP-v4.1.md:3` | *"settled platform rule only; **per-lifecycle accountable person remains PROPOSED ACCOUNTABILITY — WORKFLOW VALIDATION REQUIRED on Service/Dispatch**"* |

**NOT LOCATABLE AT SOURCE: a decision id for this question.** Searched `ext/own-engineering-gap`,
`ext/census-acceptance`, `ext/own-decision-packet`, `emp/own-synthesis`, `int/a-correctness-register` and
`64008d5a` for `PROPOSED ACCOUNTABILITY` and `WORKFLOW VALIDATION REQUIRED` — **zero hits on all six**; the
only ref carrying the phrase is `atlas/employee-v41-input`, and there it cites `P2-G5` (a **gap** register
entry, `…/05-GAP-REGISTER.md:31`) and `OD-6` (**CLOSED** by #182). **So this decision is registered under no
decision id anywhere.** It is raised here and **deliberately not labelled**: naming a register item is the
Owner's, which is the same discipline `MI-α` records and the `link_source` successor question follows.

### 3.2 Does settled authority already derive a lifecycle rule? — **PARTLY. The derived part is a platform
rule; the per-state rule is NOT derived.**

**Derived, and therefore not an Owner question — state it as consequence:**

| Derived rule for every Service lifecycle state | From |
|---|---|
| Every **ACTIONABLE** Service state must have **exactly one** accountable person **at every point in time** | #180 invariant 1 and its *"at every point in time"* clause |
| **Accountability never changes as a side effect** of dispatch, technician assignment, reassignment, a status advance, or manager involvement | #180 invariants 2 and 4 · #184 *"Assignment remains separate"* · #187 *"5."* — *"REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER"* |
| The exception list to *"exactly one"* is **EMPTY** — no Service state holds an exception | `MI-W`, §1 row 10 |
| A lifecycle transition **may not create a NONE state**; responsibility is preserved until the governed transition commits | #180 invariant 7 · #181 *"Accountability continuity"* · #184 **B** and *"ZERO RESPONSIBILITY GAP"* |
| COMPANY ownership (Taylor AZ) **coexists** with a PERSON accountable for the active work | #180 invariant 8 |
| Historical accountability survives every later state change and every later employee-status change | #180 invariant 6 · #182 *"2."* · #186 *"7."* |
| Any accountability move is an **explicit governed operation** at the OD-7 orchestration boundary, atomically, with audit | #184 **A–E** · #187 *"5."* |
| An actionable item is **not healthy merely because its reference resolves** — a not-currently-eligible accountable person is a **responsibility defect requiring governed resolution** | #186 *"8."* |

**NOT derived, and explicitly reserved:** **who** is accountable in each state, and **whether accountability
moves at all** across a lifecycle boundary (the clearest case being `BILLING`, where the outcome owner
plausibly changes). #186 *"8."* rules reassignment and escalation behaviour *"**workflow-specific**"*; #186
*"13."* lists *"workflow-specific reassignment · automatic escalation · handoff acceptance semantics"* as
**not absorbed**; #182 *"4."* forbids inventing family constraints globally. **The design's `PROPOSED` tag is
therefore correctly placed — it marks exactly the part no ruling reaches.**

### 3.3 The decision, as one decision

| Field | Content |
|---|---|
| **ID** | **Unlabelled.** *(SERVICE ACCOUNTABILITY — LIFECYCLE)*. Registered under no id at any ref; naming is the Owner's |
| **EXACT QUESTION** | **For the Service Work Order family, across all lifecycle states together — `NEW`, `DISPATCHED`, `IN-PROGRESS`, `WAITING-PARTS`, `RETURN`, `BILLING`, `EXCEPTION` — who holds accountability, and at which state boundaries (if any) does accountability move, by which governed operation?** *(One decision. Not one question per status — the states share one rule surface and #180 invariant 1 applies to all of them identically.)* |
| **WHY IT STILL REQUIRES OWNER POLICY** | #186 *"8."* and *"13."* place workflow-specific reassignment and escalation **outside** every ruling to date; #182 *"4."* forbids a lane inventing per-family constraints. The derived rules of §3.2 **constrain** the answer completely and **determine** none of it |
| **WHAT IS ALREADY SETTLED** | The eight rules of §3.2, in full. In particular: the answer may **not** make a technician reassignment move accountability, may **not** produce a NONE state at any boundary, and may **not** move accountability implicitly at a status change |
| **OPTIONS** | **(a) ONE ACCOUNTABLE PERSON FOR THE WHOLE LIFECYCLE** — a single service-outcome accountable person from `NEW` to close; every state change is an executor or status change only · **(b) TWO PHASES** — one accountable person for execution (`NEW`…`RETURN`) and a declared governed transition to a second for commercial close (`BILLING`), with `EXCEPTION` routing to an escalation holder · **(c) PER-STATE MAP** — a declared accountable role per state, with a governed transition at each boundary |
| **RECOMMENDATION** | **(a)**, on the evidence already cited, and stated as a recommendation only. It is the only option that needs **no** new governed transition to satisfy #180 invariant 7, and it is the one the settled rules already describe: #180's own Work Order worked example separates *"the employee responsible for ensuring the service outcome"* from the technician and from the escalation owner, i.e. **one** outcome holder across the states. **(c) is the option to refuse explicitly:** seven boundaries means seven governed transitions, each an invariant-7 risk, and #180 invariant 10 warns against exactly that shape of per-slot proliferation. **`EXCEPTION` is the one state where (a) may not suffice** — it is where #180's ESCALATION OWNER axis bites — and the Owner may wish to answer it inside the same decision rather than as an eighth question |
| **EXACT ITEMS BLOCKED** | `NS2-SVC r2` and `NS2-DSP-01 r2` propagation rows (`…08-EMP-PROPAGATION-MATRIX.md:9-10`), both **PARTIAL — BLOCKED**; every `PROPOSED ACCOUNTABILITY` chip on those two surfaces; and the `OD-13` interaction (a governed in-flight executor exit is the same boundary) |
| **WHAT CHANGES PER OPTION** | **(a)** no new governed transition; the `PROPOSED` chips resolve to a single declared holder; Service needs only the platform handoff #184 already rules · **(b)** one governed transition to specify and prove at `BILLING`, plus an `EXCEPTION` escalation rule; two `OD-7` acceptance cases instead of one · **(c)** seven boundaries, seven transitions, seven invariant-7 proofs — and the per-state map becomes the de facto template for every other family, which is the invariant-10 pressure |

---

## 4. UNPROVEN · NOT_RUN

**NOT_RUN, stated in full.** No test, typecheck, build, lint or emulator was executed. **No `java`** (the
Firestore emulator cannot start). **`functions/lib` was never consulted or borrowed** and was excluded from
every search; `functions/node_modules` was not borrowed. No production or non-production environment was
contacted. No schema, migration, backfill, Rules change, DDL, deploy or data mutation. No secrets requested
or exposed. Every measurement is a file read at `64008d5a` plus `git show` / `git grep` of named refs.

| # | UNPROVEN | Why | What would prove it |
|---|---|---|---|
| **`V-λ`** | Whether **any row** exists in the nine unconstrained person columns — in particular `ownership_handoffs.previous_owner_employee_id` / `new_owner_employee_id` — in any environment | No environment contacted. Inherited as `V-3`/`V-4` of `…MI-S-AND-MI-Y-DECISION-BRIEFS.md` §7. **Load-bearing: it decides whether `MI-λ` is a schema rule or a data reconciliation** | A migration-state and row-count read. **Requires Owner authorization** |
| **`V-ε`** | The **incidence** of unrepresented actors in production — `MI-ε`'s magnitude | No environment contacted; the cited ~15% and the two sandbox technician ids are a prior census, not a current production read | The authorized person-population read, per environment |
| **`V-O1`** | Which namespace the **stored** `USER`-space owner ids actually occupy (`employeeId` or Firebase `uid`) | No environment contacted. This is the residue of `O-1` after §1 row 12, and it is **a measurement, not a decision** | Join stored owner ids against both candidate key namespaces, per environment |
| **`V-U9`** | `OD-8`'s exposure finding — that an `admin`/`dispatcher` client `update` can rewrite the four ownership fields — **rests on STATIC READ**; the emulator could not run | Inherited verbatim from `emp/own-synthesis:…EMPLOYEE-OPEN-DECISIONS.md:140` (`U-9`). **This does not disturb §1 row 12's classification**: #184's bypass clause applies to any such path, and whether this one exists is what `U-9` measures | A Rules unit test: an `admin`/`dispatcher` client `update` changing **only** `accounts.accountOwner` is **REFUSED** |
| **`V-SVC`** | That the seven Service lifecycle labels in `…08-EMP-PROPAGATION-MATRIX.md:10` are the **shipped** Work Order status vocabulary | The labels were read from a **design** ref (`atlas/employee-v41-input`), not from code. **§3.3's decision is stated over the design's own state names and must be re-stated over the governed vocabulary before any implementation** | Read the governed Work Order status domain at a named baseline and reconcile the seven labels against it |

---

## 5. CORRECTIONS — to this lane's brief, and to the artifacts it cites

**Correcting the brief is in scope and expected. Five corrections, each checkable.**

| # | Claim | Correction | Severity |
|---|---|---|---|
| **1** | The lane brief lists **`M-1`** among *"candidates the rulings plausibly already resolve — assess"* **and** among *"do not reopen"* | Both are right, and the register is what is stale: **#183 states *"`M-1` … remain[s] open"*, and #187 *"5."* subsequently RULED it** (OD-7 covers OWNERSHIP and ACCOUNTABILITY, not ASSIGNMENT). Any artifact still carrying `M-1` as open is stale **against #187**, not against #183 | **LOW** — no classification turns on it; `M-1` is not among the 17 |
| **2** | `…PERSON-AUTHORITY-TARGET-MODEL.md:1088` and `:824`: *"**four** `firestore.rules` sites enforce `employmentStatus == "ACTIVE"` inside the security boundary (`:61`, `:92`, `:114`, `:141`)"* | **Mis-described, and the line numbers belong to a different fact.** At `64008d5a` those four lines are the four sites that **read the `employees` document** (`:61`, `:92`, `:114`, `:141`); the `employmentStatus == "ACTIVE"` comparisons are at **`:118`, `:145` and `:494` — three**, and `:92` performs no status test at all (it tests `userId == request.auth.uid`). **The accurate statement is: four Rules sites read the Employee document; three of them enforce ACTIVE status.** **[OBSERVED AT: `64008d5a`]** | **MEDIUM** — it is a citation that looks verifiable and is not, the failure class #185 names four times. **`MI-δ`'s classification is unaffected**: the derivation rests on PostgreSQL being unreadable from Rules, not on the count |
| **3** | `…DECOMPOSITION.md:1489` (`MI-κ`): *"nothing can **name** an accountable person without it"* | **Too strong after #182.** #182 *"4."* separates accountability from ROLE · CAPABILITY · WORKFLOW AUTHORITY and rules eligibility must **not** be defined as capability-to-perform; an accountable person is named by **Employee identity**, which needs no job-role vocabulary. The accurate statement is that **`MI-κ` is required for role-keyed ESCALATION and APPROVAL surfaces**, not for naming an accountable person — which takes `MI-κ` off the Layer-1/eligibility critical path | **MEDIUM** — it changes what `MI-κ` blocks, and §2.1 records the narrowing |
| **4** | Both standing register tables — `ext/own-engineering-gap:…PERSON-AUTHORITY-TARGET-MODEL.md:1080-1099` (§9.8) and `ext/census-acceptance:…MI-S-AND-MI-Y-DECISION-BRIEFS.md:1010-1034` (§6) | **Stale for five ids**, all closed after they were written: **`MI-S`** (#186) · **`MI-T`/`MI-η`** (#187 *"2."*) · **`MI-θ`** (#187 *"3."*) · **`MI-X` sense 2 → `MI-Y`** (#187 *"1."*) · **`M-1`** (#187 *"5."*). Stated once, as one finding, rather than repeated per row | **LOW** — both are lane artifacts, and neither is the ruling register; recorded so a reader does not take an OPEN row as current |
| **5** | The lane brief directs *"`MI-α` and `MI-X`-sense-1 against **#185**"* as if both were open | **`MI-X` sense 1 is already recorded CLOSED** by #185's own register-hygiene entry (*"CLOSED by `MI-ι` / #185 — PostgreSQL Employee is canonical"*), so it is not an open id and is not among the 17. `MI-α` is assessed at §1 row 11 | **LOW** — the brief is describing an assessment, and the assessment confirms the entry |

**Nothing else in the brief was found wrong.** In particular its four candidate hints were each borne out:
`MI-U` **is** resolved by #186 case D plus #187, `MI-W` **is** resolved by #180 invariant 1's own
precondition, `MI-α` **is** discharged by #185, and `O-1` **is** determined by #182/#184's Layer-1 placement
plus #185's namespace chain. The brief's warning was also borne out in the other direction: **six of the
seventeen are genuinely C**, and the two the Owner named for Task 3 are among the hardest.

---

## 6. CONFLICTS CARRIED — both readings, unresolved

| # | Conflict | Reading A | Reading B |
|---|---|---|---|
| **`T-1`** | `O-1`'s status | **This document: `B`** — determined by #183's Placement-consequence clause (the exclusion) plus #185's resolution chain (the namespace) | **`ext/own-engineering-gap:…DECOMPOSITION.md:1289`, `:1364` and `…MI-S-AND-MI-Y-DECISION-BRIEFS.md:1034`: OPEN**, gating `OI-08`, *"partially answered in the target only"*. **Both carried. The difference is whether a target-side answer binds the interim; §1 row 12 argues it does because #185's chain is not conditioned on a datastore** |
| **`T-2`** | `M-2`'s status | **This document: `B`** — the sharpened prior question is answered by #183/#184's transaction sequence, and the carrier follows by exclusion | **`ext/own-decision-packet:…OD-7-DECISION-BRIEF.md:1199`, `:1101`: OPEN / `MISSING INPUT`**, *"constrained by exclusion"* but *"the ruling does NOT constrain `M-2`"*. **Both carried.** The brief's own §23.1 supplies both halves and declines to conclude; this document concludes on the same evidence and says so |
| **`T-3`** | `MI-Y` item count | **7** items (`…DECOMPOSITION.md:1416` tally) | **8** items (`:1212` prose). #187 *"1."* carries **both readings** explicitly. Inherited unchanged; nothing here depends on it |

---

## 7. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

- **No answer to `MI-λ`, `MI-κ`, `MI-ε`, `MI-V`, `OD-13`, `OD-16`, or the Service lifecycle accountability
  decision.** Options and, where the evidence supports one, a recommendation — never an answer.
- **No naming.** Not the `OD-6` person-reference states, not an accountability carrier field, not a job-role
  vocabulary, not a register label for the Service decision, not a new `MI-` id for anything raised here.
- **No reopening** of `OD-1`, `MI-N`, `OD-6`, `OD-7`, `MI-ι`, `MI-S`, `MI-Y`, `M-4`, `M-1`, `MI-P`, `MI-Q`,
  `MI-R`, `MI-θ`, `AUTHORITY_UNAVAILABLE`, or the link-provenance ruling.
- **No edit to any other file**, on this branch or any other. The `firestore.rules` mis-citation at
  correction 2 lives on `ext/own-engineering-gap` and **was not touched**; the documentation reconciliation
  #185 directs (`firebase-exit-manifest.json`, `firebase-exit-ratchet.md`, `PROJECT_ARCHITECTURE.md:88`)
  remains **recorded and unperformed**.
- **No implementation, no schema, no migration, no Rules change, no backfill, no deploy, no data mutation,
  no UI, no production contact.** All 42 items in `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` and all ten
  prepared PostgreSQL items **A–J** remain `IMPLEMENTATION STATUS = NOT AUTHORIZED`.
- **No broad archaeology and no duplicate evidence.** Where a fact is already established in a cited
  artifact or ruling it is **cited, not restated**.
