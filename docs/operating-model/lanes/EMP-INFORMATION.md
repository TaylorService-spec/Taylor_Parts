# EMP-INFORMATION — the information and attention model

**LANE:** EMP-INFORMATION · **MODE:** EVIDENCE_WRITE
**BASELINE:** `64008d5ae0bdd9532909671b15a91122400accf1` (= `ATLAS-BASE-2026-09-12-A`)
**OBSERVED AT: 64008d5a** — every derived fact in this document was measured at that commit unless the row says otherwise.
**WORKTREE / BRANCH:** `emp/information`

This lane owns **what EOS should show, explain, recommend and warn about, unprompted versus on demand**, per role.
It does **not** own the experience shape. Start-of-day, queues, handoff, the manager experience, mobile and the
six "My Work" buckets belong to **EMP-EXPERIENCE**; where a requirement here implies a surface, it defers.

---

## 0. THE FOUR VERBS — the distinction is the deliverable

| Verb | Trigger | Present when | Failure mode it exists to prevent | Volume discipline |
|---|---|---|---|---|
| **SHOW** | none — it is the page | always, for this role, whether or not anything is wrong | the reader has to ask EOS for the fact their job is made of | unbounded in kind, bounded in count; a SHOW fact that is usually irrelevant is an ATTENTION fact mis-filed |
| **ATTENTION** | a fact crossed a stated threshold, or a due time passed | only while true; **silence is the designed clean state** | the reader finds out from a customer | zero is the normal count; every item names the record, the fact, the age and one next act |
| **EXPLAIN** | the reader asked | on demand only, at the point of the thing being explained | the system's answer is not self-evident and the reader invents a wrong reason | always available for every refusal, every number, every absence |
| **WARN** | the reader is **about to act** and the act has a consequence they cannot see | before the commit, never after | acting without knowing would be a mistake | one sentence at the decision point; a warning that fires on a safe act destroys the channel |

**Two more verbs the brief separates and this lane keeps separate:**
**RECOMMEND** is a proposal with its inputs stated; it is never authority (§9).
**SEARCH** is the reader going looking; its obligation is to state the **real scope** of what was searched (§5).

**The four verbs are not interchangeable renderings of one "notification".** The repository already proves the cost of
collapsing them: `ND-31` (p3a1 archaeology) records a design ruling to collapse NOT_FOUND / DENIED / LOADING / ERROR
into one "Location unavailable" string, refused on the grounds that it "would re-introduce the exact defect that
module was written to remove — telling an operator their data is broken when the truth is that their role is narrow."

---

## 1. WHAT I FOUND WRONG IN THE BRIEF

Measured at `64008d5a`, in this worktree. These are corrections, not quibbles: three of them change what EOS may honestly show.

| # | Brief says | Measured at `64008d5a` | Evidence | Consequence |
|---|---|---|---|---|
| B-1 | "62 of 147 capabilities resolve ALLOW in production" | **The number is 37, EXECUTED.** `eos-workflow-registry.md:314`: *"EXECUTED at `0ba8ab0d`: **37 of 147 capabilities are allowed anywhere in production, and not one of them is commercial.**"* Stated identically in `eos-design-p2-master-brief.md:495` and again as cutover condition **C1** at `:991`. **The string "62 of 147" appears in no file in any of the 97 worktrees.** | the two docs above; my own static parse of `functions/src/access/permissionCatalog.ts` at `64008d5a` gives 147 ids / 113 carrying `active: false` / 34 with no explicit flag (`atlas-eng-rpt/.../ENG-IMPL-001…md` §1.4 parses the same file at the same commit as **38** active / 109 inactive — a 4-id parse difference recorded as **U-6**) | **62 is almost certainly `37 + 25` — the resolver-ALLOW count plus the production report activation set (B-2) — summed across two different measurement methods. Do not cite it.** The "none is commercial" half is verified: every `finance.*`, `salesOrder.*`, `opportunity.*`, `salesAgreement.*` and `report.*` id resolves `DENY/inactivePermission` for all 48 roles. |
| B-2 | "Reporting is the only production-activated family (25 `report.*` ids)" | **The brief is right and my first pass was wrong.** Production activation does **not** come through `capabilityActivationOverrides` — `taylor-parts-production` has none of those. It comes through a **separate field, `productionCapabilityActivations`**, introduced by `DECISIONS #169` precisely because the other field's production hard-block is absolute. `taylor-parts-production` declares **25**, and **all 25 are `report.*`**. EXECUTED: `resolveRuntimeCapabilityOverrides()` under `GCLOUD_PROJECT=taylor-parts` returns a set of size **25**; `owner` → ALLOW 25/25, `admin` → 25/25, `reportViewer` → **23/25**. | `config/environments.json:303` (`environments[4].productionCapabilityActivations`, 25 ids, verified in this worktree at `64008d5a`); `functions/src/access/environmentCapabilityOverrides.ts:750`; `rpt-p0/.../ENG-IMPL-002-reporting-production-blast-radius.md` rows 0.2 / 0.4 / 0.5 | **Both facts are true at once and both matter:** all **39** `report.*` ids are `active: false` in the catalog, **and** 25 of them are production-activated by the override field. A reader of the catalog alone concludes reporting is dead; a reader of the environment file alone concludes it is live. **Two refinements:** `report.definition.read` is already row-scoped per-owner (`listSavedDefinitions` issues `.where("ownerUid","==",actorUid)`), so **the unscoped set is 24, not 25**; and 25 is a **floor** — under the last recorded production Functions deploy (pinned `fb45e6ee`) 36 of 39 are `active: true` and `owner` resolves ALLOW 36/39. |
| B-3 | "its row scope is closed for zero of four reachable objects" | **Confirmed, and the four objects are named:** `customer`, `contact`, `location`, `equipment` (`fieldsPopulated: true`). The other eight of twelve carry no fields. 45 field declarations total (customer 21, contact 5, location 7, equipment 12). The row-scope hole is a **hardcoded `{ scope: { type: "global" }, condition: {} }`** over an unfiltered collection scan. | `functions/src/reporting/reportCatalog.ts` `REPORT_OBJECTS`; p3a3 archaeology §"Report creator row-scope defect" | The brief's list omits **Equipment**. A company-scoped number over Accounts, Contacts, Locations **or Equipment** cannot be produced correctly. Worse: a grant at `ownAssignment` or `location` scope **will not resolve at all**. |
| B-4 | "occupancy of all 45 governed business Roles is unknown" | **45 governed business Roles is right; the security-Role set is 48** — 45 in `governedBusinessRoles.ts` plus `admin` / `dispatcher` / `technician` in `compatibilityRoles.ts`. (Confirmed by EMP-ROLE.) | `functions/src/access/governedBusinessRoles.ts` (45 `roleId:`); `functions/src/access/compatibilityRoles.ts` (`admin`, `dispatcher`, `technician`) | The three roles that carry **most of the observed work in the corpus** are the compatibility three, not the governed 45 — see §4. |
| B-5 | "968 not executed of which only 660 carry the literal `NOT_RUN` token" | **Confirmed, and the other 308 use exactly five statuses**: `IMPLEMENTED_UNEXECUTED` 141, `PARTIAL` 68, `BLOCKED` 64, `NOT_SUPPORTED` 26, `DESIGNED_ONLY` 9. All 42 executed records are in P3-B3 (`EXECUTED_PASS` 22 + `EXECUTED_FAIL` 20). | the seven corpus files' own `status` fields | The **entire** Service and Inventory evidence base (660 of 1,010) is **authored, never observed**. Every requirement drawn from it is a design claim. |
| B-6 | (implied) the corpus was authored at this baseline | **It was not.** All seven corpus files declare `basedOnCommit` / `generated_against_head` = **`d104cf49`**, generated 2026-09-12. | corpus headers | Corpus statements about code state are **one commit behind** and marked accordingly below. |
| B-7 | "an effective-permission explanation would need the full trace Role → Capability → Assignment → Policy → Operating Company" | **This sentence exists nowhere in the repository.** Searched all 97 worktrees: literal arrow chains, `Assignment →`, `→ Operating Company`, all-five-nouns-on-one-line across every `.md`, relaxed four-noun, and `functions/src/access/**` comments — **zero hits**. | nearest real artifacts: `ADR-005:63` ("effective-permission preview/explanation" as an MVP item); `docs/implementation-plans/enterprise-access-and-administration-platform.md:60` Task 16 ("effective-permission preview, denial explanation"); p3a3 archaeology `:887` classifies `/administration/roles-permissions` as **AUTHORITY GAP** | **It is an unsourced synthesis, not a repository fact.** This lane **adopts it as a requirement anyway** — §6.2 shows all five hops are real and two are MISSING — but it must be recorded as a new requirement needing ratification, not quoted as an existing finding. → **OD-EMP-001** |
| B-8 | "a recently fixed defect returned 'no matching records' from a bounded 20,000-document page" | **The defect is NOT fixed at `64008d5a`. It is live.** `UnprovenAbsenceError` and `reportRunIncompleteScan` do not exist in this worktree. The false sentence is still shipping: `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:27` and `reportResultState.js:88` both read **"Running reports isn't available yet. Nothing was read or changed."** | verified by grep in this worktree; the fix is on an unmerged branch — `rpt-client` commits `b8308e48` (server, `UnprovenAbsenceError`) and `9d3ab48d` (client, `reportRunIncompleteScan`) | The bound is confirmed: `MAX_SCAN_DOCS = MAX_RESULT_ROWS * 2` and `MAX_RESULT_ROWS = 10_000` → **20,000**. Reproduction recorded at `92db1d19`: 4 equipment docs, `maxScanDocs 2`, one matching doc beyond the page → `{ kind: "empty", rowCount: 0, truncated: true }` with audit `outcome: "applied"`. **"No records matched" was false, and the audit trail recorded it as a clean answer.** This is the single most dangerous live information defect at this baseline. |
| B-9 | "five built surfaces are permanently unavailable" | **VERIFIED, the five are named, and the defect is LIVE at `64008d5a`.** The fix (`field-ops-app-vite/src/access/shellCapabilityGates.js`, commit `17a96ed3` in `p2g-cap-request`) **is not in this worktree.** | `p3d-workflow-registry/.../eos-workflow-registry.md` §3.4, heading verbatim: *"Five built surfaces are unreachable by everyone, forever, and no test catches it"*. I independently reconstructed `REPORT_CAPABILITY_REQUEST` at this baseline as **44 ids** (4 + 5 + 24 + 11) and confirmed **all five gated ids are absent from it** | See §6.3 for the five ids, their gate sites, and the tautological guard test. |

---

## 2. WHAT I MEASURED THAT THE BRIEF DOES NOT CONTAIN

These are the findings that most change the information model. All `OBSERVED AT: 64008d5a`.

| # | Finding | Measurement | Why it is an information defect, not an engineering detail |
|---|---|---|---|
| **M-1** | **EOS already has the right vocabulary for honest absence, and 16 of 26 module families cannot speak it.** | `field-ops-app-vite/src/shared/ui/HonestState.jsx` declares **13 states** (IDLE, LOADING, EMPTY, NO_MATCHES, EMPTY_VIEW, SEARCH_ZERO, FILTER_ZERO, UNKNOWN, DENIED, NOT_ENABLED, UNAVAILABLE, DEGRADED, NOT_APPLICABLE). **10 of 26** `src/modules/*` families reference it: accounts, administration, dashboard, financials, inventory, jobs, sales, service, technicianDashboard, workOrders. **16 do not**: controlTower, dispatch, dispatcherBoard, equipment, inventoryRole, mobile, operations, purchasing, receiving, registry, reporting, scan, scheduling, technician, technicians, warehouse. | The 16 include **every surface the Field Technician, Dispatcher, Scanner Operator and Receiving Lead touch** — `scan` (8 files), `mobile` (7), `dispatcherBoard` (10), `receiving` (3), `warehouse` (2), `technician` (1). The roles with the **least** ability to ask a colleague have the **least** honest messaging. This is the single highest-leverage information fix in the program. |
| **M-2** | **The 17-state collection-page contract is declared and consumed by zero surfaces.** | `src/shared/ui/collectionPageState.js` is imported by exactly **one** file in the repository: `test/listsP2StateContract.test.jsx`. No `src/modules/**` file imports it. | The contract's own header names "a declaration nothing consumes" as "this program's defining defect" — and is currently an instance of it. Every list's empty state is therefore invented locally, which is how `NO_MATCHES`, `EMPTY_VIEW` and `SEARCH_ZERO` become one sentence. |
| **M-3** | **The governed KPI tile has no drill-through at all.** | `src/modules/dashboard/GoalTile.jsx` contains **no** `onClick`, `navigate`, `Link` or `href`. Neither does `CompactMetric.jsx` (13 lines, value + label, nothing else). `src/modules/financials/FinancialsOverview.jsx` contains no `onClick`. | Every number these render is a **dead KPI by construction** — the hard requirement in the brief is violated at the primitive level, not per page. Fix belongs in the primitive. |
| **M-4** | **One surface already does it right, and is the pattern to copy.** | `src/domain/accountHealthStrip.js` projects **only** metrics with a real account-scoped authority, names the three it has (Open Work Orders, Outstanding AR, Past due), names the three it refuses (**Open pipeline, Sales Order backlog, Equipment count** — each with the reason the read does not exist), carries one on-screen sentence saying so (`HEALTH_STRIP_ABSENCE_NOTE`), and attaches a per-metric `href`. | This is the template for §8. **Defect in it:** `href: count > 0 ? "/service/work-orders" : null` drills to the **unfiltered** Work Orders list, so the drill-through loses the predicate that produced the number. A drill-through that changes the population is a wrong drill-through. |
| **M-5** | **An Employee record carries no company, no department and no location.** | `src/metadata/definitions/employee.js` records that `companyId` / `departmentId` / `locationId` are "Future — reserved, unused this sprint" and that **every write path sets all three to `null` unconditionally**. | Every "show me my company's / my branch's numbers" requirement has **no per-person anchor to scope by**. Combined with B-3 (no report row scope) and B-2 (reporting inactive), a scoped number is **MISSING**, not PARTIAL, for every role below General Manager. |
| **M-6** | **There is no job-role vocabulary, so "show this person what is theirs" has nothing authoritative to key on.** | Five disjoint vocabularies with no mapping (EMP-ROLE). `operationalRoles[]` write-time vocabulary is **8 values** (`domain/employeeVocabulary.js`: PARTS_MANAGER, PARTS_ASSOCIATE, TECHNICIAN, WAREHOUSE_MANAGER, WAREHOUSE_ASSOCIATE, SERVICE_MANAGER, SALES_MANAGER, SALES_ASSOCIATE); the client's `OPERATIONAL_ROLE` carries **3**, and the file states the other **five are "reserved, legally-writable values with no consumer yet."** `jobTitle` is **free text**. `securityRole` is a read-only denormalized mirror of `users/{uid}.role` that **no query filters on**. | Every unprompted-display requirement in §7 inherits this ambiguity. **Each row in §7 therefore names which vocabulary it would have to read.** |
| **M-7** | **"Who manages this person" has two unreconciled answers at this baseline.** | MANAGER and JOB ROLE are conflated in **opposite directions** by two subsystems (EMP-ROLE). `jobTitle` and `managerEmployeeId` reach the model only via `docs/assessments/administration-users-consolidation.md:204-209`, **which is not present in this worktree at `64008d5a`** (the `employee-foundation.md` trio lives in the `arch-classify` worktree). | The ESCALATION dimension and the effective-permission EXPLAIN trace both terminate in "your manager". Neither can be produced unambiguously. Marked `UNKNOWN — REVERIFY` throughout §7. |
| **M-8** | **Proficiency and certification are wholly unmodelled, and the corpus records the consequence.** | `P3B1-S17-A06` — an apprentice completes a Work Order requiring a certification he does not hold. `expectedAuthorityCapability`: *"Complete: technician, own assignment. **Certification is not consulted anywhere.**"* `expectedUiResult`: **"Nothing warns."** | This is a **WARN requirement with no backing fact**. It is listed in §7 for Apprentice Technician and Field Technician as `MISSING / MODEL`, and is the clearest case in the corpus of a warning EOS ought to give and cannot. |
| **M-9** | **26 of the 45 governed business Roles have no corpus activity at all** (EMP-ROLE), and the roles that carry most observed work are not governed Roles. | Corpus role labels normalise to **27** distinct roles over 1,010 activities. The five heaviest — Field Technician (134), Administrator (110), Dispatcher (97), Parts Manager (74), Service Coordinator (68) — include **three that are not among the 45**: `dispatcher` and `technician` are compatibility Roles; `serviceCoordinator` and `serviceManager` exist in **no** role vocabulary. | An effective-permission explanation (`Role → Capability → Assignment → Policy → Operating Company`) **cannot be produced for the roles doing most of the work**, because step 1 has no governed Role to start from. See §6. |
| **M-10** | **The `report.*` field capabilities are template-constructed, so no grep can enumerate a role's reportable fields.** | `reportCatalog.ts` builds `readCapability` as `` `report.${objectId}.field.${capabilityGroup}.read` `` — **zero literal `report.*` strings appear in the catalog.** | An EXPLAIN answer of the form "you cannot see this column because you lack X" must be produced by **resolution**, never by reading a list. Any design that assumes a static list of a role's readable fields is wrong. |

---

## 3. EVIDENCE BASE AND ITS HONEST LIMITS

| Source | Records | What it authorises me to say | What it does not |
|---|---|---|---|
| `p3b1-act-service/.../service-technician.json` | 330 activities, 33 stories, 8 role labels, `helpOpportunity` + `expectedUiResult` + `aiOpportunityClassification` on every row | the information a service person needs, per activity, as **authored** | nothing observed: `byFullActivityExecutability = { BLOCKED_BY_TEST_ENVIRONMENT: 330 }`; all 330 `NOT_RUN` |
| `p3b2-act-inventory/.../inventory-warehouse-purchasing.json` | 330 activities, 14 role labels, `help_info_opportunity` + `ai_opportunity` on every row, **128 rows carrying an explicit `DESIRED:` information requirement** | the densest pre-authored information model in the repository | all 330 `NOT_RUN`; statements about code are at `d104cf49` |
| `p3b3-act-sales/docs/activities/p3b3-*.json` (6 files) | 350 activities, 18 role labels, `authority_path` + `status` + `blocking_mechanism` + `owner_question` | the **only** executed evidence: 22 `EXECUTED_PASS`, 20 `EXECUTED_FAIL` | thinner schema — **no `help_*` or `ai_*` field at all**, so sales/finance/admin information needs are inferred from `narrative`, not authored |
| `p3a1/p3a2/p3a3` archaeology | 1,268 / 1,852 / 1,032 lines | what is on screen today, and 60+ named display defects | design authority, not measurement, where it says so |
| `p3d-workflow-registry/.../eos-workflow-registry.json` | 86 workflows | which end-to-end paths exist | **0 of 86 proven end-to-end**; 34 EXECUTED / 52 TRACED / 0 INFERRED evidence tiers |
| `docs/north-star/financials/pages/15-employee-performance.md` | 64 lines | the only page spec in the repo whose composition **is** visibility | `READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW`; **implementation NOT authorized from this package**; all values are Certification World specimen fixtures |

**Corpus caveats carried forward:** 1,010 records / **1,009 distinct** · 42 executed · 968 not executed, of which **660** carry the literal `NOT_RUN` token · **authored ≠ observed** · generated against `d104cf49`, not `64008d5a`.

---

## 4. THE ROLE SET THIS LANE ADDRESSES

The corpus's 1,010 activities carry 40 raw role strings across three lanes. Normalised (case, separators, and the four
genuine synonyms — `parts_counter`→Parts Associate, `stocker`→Scanner Operator, `warehouse manager`→Parts Manager where
the sales corpus means the parts desk, `finance manager`→Controller), they resolve to **27 distinct roles**.

**Service Coordinator and Dispatcher are two roles, not one.** 68 vs 61 service activities, disjoint personas
(Priya Raman / Marisol Vega vs Dale Brackett / Brett Hollins), and only Dispatcher holds a security Role. Their
information needs diverge sharply: the coordinator's information problem is *promising*, the dispatcher's is *placing*.

| # | Role | Corpus activities | Lanes | Security Role at `64008d5a` | Vocabulary that identifies them |
|---|---|---|---|---|---|
| 1 | Field Technician | 134 | SVC+INV+SAL | `technician` (**compatibility**, not governed) | `users/{uid}.role` + `users/{uid}.technicianId` |
| 2 | Administrator | 110 | INV+SAL | `admin` (**compatibility**; holds all 147 ids via `ADMIN_ALL_PERMISSIONS`) | `users/{uid}.role` |
| 3 | Dispatcher | 97 | SVC+INV+SAL | `dispatcher` (**compatibility**) | `users/{uid}.role` |
| 4 | Parts Manager | 74 | INV+SAL | `partsManager` (governed) | `operationalRoles[] = PARTS_MANAGER` (one of the 3 consumed) |
| 5 | Service Coordinator | 68 | SVC | **none — exists in no role vocabulary** | `jobTitle` free text only |
| 6 | Service Manager | 60 | SVC | **none as a security Role**; `SERVICE_MANAGER` is a **reserved, unconsumed** `operationalRoles[]` value | `operationalRoles[]` (no consumer) |
| 7 | Sales Manager | 52 | SAL | `salesManager` (governed) | `SALES_MANAGER` reserved/unconsumed |
| 8 | Controller | 51 | INV+SAL | `controller` (governed) | `jobTitle` free text |
| 9 | Operations Manager | 43 | INV+SAL | `operationsManager` (governed) | `jobTitle` free text |
| 10 | Salesperson | 43 | SAL | `salesperson` (governed) | `SALES_ASSOCIATE` reserved/unconsumed |
| 11 | Parts Associate | 42 | INV+SVC | `partsAssociate` (governed) | `operationalRoles[] = PARTS_ASSOCIATE` (consumed) |
| 12 | Accounting Manager | 36 | SAL | `accountingManager` (governed; holds all five `finance.*`) | `jobTitle` free text |
| 13 | Inventory Control Analyst | 34 | INV | **none**; nearest are `inventoryCycleCountCounter` / `inventoryCycleCountReconciler` | none |
| 14 | Scanner Operator | 32 | INV | **none**; nearest `inventoryPutAwayOperator` / `inventoryStockRelocationOperator` | none |
| 15 | Receiving Lead | 19 | INV | `inventoryReceivingClerk` (governed) | `WAREHOUSE_ASSOCIATE` reserved/unconsumed |
| 16 | Service Billing Admin | 18 | SVC | **none** | `jobTitle` free text |
| 17 | Office Manager | 18 | SAL | `officeManager` (governed) | `jobTitle` free text |
| 18 | General Manager | 14 | SAL | `generalManager` (governed) | `jobTitle` free text |
| 19 | Branch Parts Coordinator | 12 | INV | **none** | none |
| 20 | Purchasing Admin | 10 | INV+SAL | `purchasingManager` (governed) | `jobTitle` free text |
| 21 | Owner | 10 | SAL | `owner` (governed; privileged) | `jobTitle` free text |
| 22 | Apprentice Technician | 9 | SVC | `technician` (compatibility) — **indistinguishable from a journeyman** | none (see M-8) |
| 23 | Field Manager | 9 | SAL | `fieldManager` (governed) | `jobTitle` free text |
| 24 | Satellite Attendant | 7 | INV | **none** | none |
| 25 | After-Hours Coordinator | 5 | SVC | **none**; `ACTION_PERMISSIONS` has **no time-of-day or on-call dimension** (`P3B1-S19-A02`) | none |
| 26 | Marketing Manager | 2 | SAL | `marketingManager` (governed) | `jobTitle` free text |
| 27 | Report Viewer | 1 | SAL | `reportViewer` (governed) | none |

**Nine of 27 roles doing observed work hold no security Role at all** (#5, #6, #13, #14, #16, #19, #24, #25, and #22 which is
merged into #1). **Two of 27** are identified by a vocabulary value that any code actually consumes. Everything else is
`jobTitle` free text or the three-value `users/{uid}.role`.

**26 of the 45 governed business Roles have no corpus activity** (EMP-ROLE). Capacity is proven; occupancy is not (§10).

---

## 5. THE SHOW / ATTENTION / EXPLAIN / WARN SPLIT — the standing rules

These bind every requirement in §7. Each rule is sourced to a repository artifact or a corpus row, not invented here.

### 5.1 SHOW

| Rule | Source | What it forbids |
|---|---|---|
| **S-1. A structural slot is kept even when its content cannot be produced; the slot renders a truthful state.** | `docs/design/eos-north-star-design-grammar.md`: "KEEP THE DESIGNED STRUCTURAL SLOT. RENDER A TRUTHFUL STATE IN IT. NEVER FABRICATE THE CONTENT." | Removing a section because the read is missing — which teaches the reader the fact does not exist. |
| **S-2. A gated module holds its place; availability is not importance.** | `docs/governance/eos-dashboard-composition-authority.md` (Decision #161) | Re-ranking a dashboard around what happens to resolve today. |
| **S-3. No number without provenance.** Every displayed quantity states **what it counts, at which location/company, and as of when**. | Corpus `S14-A07` (`DESIRED: every quantity on screen states its source and as-of time. CURRENT: a hardcoded baseline and a governed on-hand render in the same column with the same typography`); `S20-A09`; `S02-A01` | Two numbers with different authorities sharing a column and a typeface. |
| **S-4. A count is a claim about the business; a dash is a claim about the read.** Three states — `undefined` / `null` / number — never two. | `docs/north-star/lists/LISTS-VIEW-CHIP-ROLLOUT.md`; p3a3 archaeology (an earlier cut rendered `null` as nothing, "quietly demoted 'we could not count' into 'there is nothing to count'") | `0 Active` when the count failed. |
| **S-5. A bounded read may return a page and say so. A TOTAL may not.** | `docs/governance/eos-dashboard-composition-authority.md` Rule 6 | The 20,000-document defect class (§6.4). |
| **S-6. A rate rolls up as `sum(numerator)/sum(denominator)`, never `average(per-person percentages)`.** | same, Rule 8 | Manager roll-ups that overweight low-volume people. |
| **S-7. Unknown has no number slot.** | `GoalTile.jsx`: "NEVER `0 of 400`. An unknown actual has no number slot on this component at all." | `$0.00` where the truth is "we do not know what it is worth" (p3a2: "on a purchasing list those are opposite facts"). |
| **S-8. A cross-company total is labelled as one, or is not produced.** | Corpus `S14-A09`, `S24-A07`, `S32-A06`; `DECISIONS #165 ruling 4` | One unattributed number spanning Taylor and Ventana. |

### 5.2 ATTENTION

| Rule | Source | What it forbids |
|---|---|---|
| **A-1. Silence is the designed clean state.** Attention renders **nothing** when clean, and a clean queue is a *distinct* rendering from an empty one. | p3a1 archaeology (Service Operations attention block; "Queue-clear is rendered as good news, distinct from empty") | A permanent "0 items needing attention" banner, which trains the reader to stop looking. |
| **A-2. Loading withholds counts. A zero is only reported when zero is known.** | p3a1 archaeology, verbatim | An attention count of 0 during a failed read. |
| **A-3. Every attention item names the record, the plain-language fact, the age, and one next act.** | p3a1 Service Operations spec (severity word, fact with reference bold, account, owner, deep link) | A severity badge with no sentence. |
| **A-4. Attention is ordered by a declared rule, not a computed score, where no score authority exists.** | p3a2 archaeology ("Attention order is declared, not scored") | Inventing a priority model in the client. |
| **A-5. Attention families are not merged into one ranked list unless one authority ranks them.** | p3a3 archaeology (Account record: "AR and WO past-due are never merged into one ranked list") | A single "inbox" that silently ranks a $12 residual above a stranded transfer. |
| **A-6. An item whose input is unusable must still appear.** | Corpus/archaeology `SO-G7`: an unusable `createdAt` scores 0 on age and stagnation, total falls to `LOW`, and the Work Order is **dropped from the At-risk table entirely** — "the Work Order the system knows least about is the one it shows least." | Scoring pipelines that silently discard the records most in need of attention. |
| **A-7. Attention must not be positioned after the thing it warns about.** | p3a3 archaeology: `AccountAttentionSection` rendered at the bottom of the secondary column, "a reader reached it after everything it should have warned them about." | Correct content, wrong place — still a defect. |

### 5.3 EXPLAIN

| Rule | Source | What it forbids |
|---|---|---|
| **E-1. Every refusal explains itself at the point of refusal.** It names the capability it required, whether that capability is **active at all**, the Role or desk that **does** hold it, and **one concrete next act**. | Corpus `S22-A04`, verbatim `DESIRED` | One generic "permission denied", "which makes the system's actual state unknowable from the outside — the user cannot tell an unbuilt feature from a misconfigured Role from a deliberate policy." |
| **E-2. "Capability inactive" and "authority required" are two different states, two different sentences, two different owners.** | p3a2 archaeology, verbatim: "Calling an inactive capability a missing authority tells the Owner that something must be designed and built when in fact something must be activated." | Sending a Parts Manager to an administrator for a grant that cannot help (corpus `S22-A06`, `S22-A07`, `S23-A03`). |
| **E-3. Every number explains what it counts and where it came from, on demand.** | S-3; `accountHealthStrip.js`; `15-employee-performance.md` §19 (hover-ⓘ carries contract copy, only the contract sentence stays visible) | A figure whose derivation exists only in a code comment. |
| **E-4. Denied and unknown are explainable by construction, not by copywriting.** The explanation must be **produced from the resolution**, because the field capabilities are template-built (M-10). | `reportCatalog.ts`; `resolveEffectivePermission.ts` | A hand-maintained table of reasons that drifts from the resolver. |
| **E-5. An explanation may not leak the fact it is explaining.** | p3a3 archaeology: a filter on an unreadable field is **dropped, never applied**, "because the result-set membership would itself leak the hidden field" — and **the widening is surfaced, not silent** | "You cannot see 4 of these 17 rows" where the 4 is itself governed. |
| **E-6. The reference-resolution ladder has three rungs, not two.** resolved → human name; read failed → "…unavailable" + Retry; **proven unset → "Unknown …", only when the read succeeded and resolved to nothing.** | p3a1 archaeology `ND-31`: "a database key is never a fallback business label"; "'we could not look' never renders as 'Unknown customer'" | A raw `locationId` as a place name (a real p3a2 receiving defect) or `PO-1` (a document id) as a journey title. |

### 5.4 WARN

| Rule | Source | What it forbids |
|---|---|---|
| **W-1. A warning fires before the commit, at the control, naming the consequence in business words.** | Corpus `S25-A05` (`'This transfer has been dispatched. It cannot be cancelled; the stock must be returned.'`), `S07-A07` ("says 'this cannot be undone' BEFORE the click") | A confirmation dialog that says "Are you sure?". |
| **W-2. A warning states what the act does **not** do, where a reader would reasonably assume it does.** | Corpus `S16-A01` / `S01-A09` (`'this records where it went; it does not change how much there is'`), `S20-A10`, `S08-A01` (`'marking received does NOT add the stock'`), `S15-A05` (retiring a bin "does not free the code, and it does not move any stock") | A put-away confirmation that reads like a stock movement. |
| **W-3. Crossing an operating-company boundary is always warned, by name, before commit.** | Corpus `S24-A03` (`'Taylor Freezer of Arizona -> Ventana' in words`), `S22-A05`, `S24-A09`; `DECISIONS #165 ruling 4` | Inferring the company from the location the operator is standing in. |
| **W-4. "Allowed, and here is what it costs" is a warning, never a refusal.** | Corpus `P3B1-S04-A06`: `'75 minutes of this placement fall outside the technician's working hours.' Outside hours is a warning, never a refusal.` | Blocking a legitimate act because the system can only say no. |
| **W-5. A stale-write warning is owed before a colleague's work is overwritten.** | Corpus `S04-A07` ("Losing a colleague's vendor note silently is the failure"), `P3B1-S07-A03` | Last-write-wins with no notice. |
| **W-6. Losing typed work is warned before it happens, or the draft is preserved and labelled a draft.** | Corpus `S02-A06`: "Silent loss of typed work is the failure to catch" | A modal that discards a half-filled form on close. |
| **W-7. A warning EOS cannot ground is not written as copy.** The absence is recorded as a gap. | M-8 (`P3B1-S17-A06`: certification "is not consulted anywhere"; "Nothing warns.") | A certification warning with no certification model behind it. |

---

## 6. WHAT EOS MUST BE ABLE TO EXPLAIN ABOUT DENIAL AND UNKNOWN

This is the section the brief calls urgent, and the measurement makes it worse than stated.

### 6.1 The five conditions that must never share a rendering

| Condition | The true sentence | Who can change it | Today's rendering |
|---|---|---|---|
| **D-1 UNGRANTED** — the capability is active; this principal's Roles do not include it | "Approving a reorder request needs review authority you do not hold. Marisol Vega and any admin hold it." | an administrator, by Role assignment | generic error, or the control renders and fails after the click (corpus `S03-A05`, `S05-A03`, `S06-A05`) |
| **D-2 INACTIVE** — the capability is registered `active: false`; **no** Role can hold it in this environment | "These capabilities are registered but not active in this release. Granting them has no effect." (corpus `S22-A06`) | **a release, not a configuration** (corpus `S22-A07`) | indistinguishable from D-1 — which sends the operator to an administrator who cannot help |
| **D-3 UNASKED** — the capability is active **and** grantable **and** granted, and the client **never asks the server about it**, so it is permanently `false` | "This control is gated on a capability this screen never requests. Nothing you can be granted will switch it on." | an engineering change to the request set | **nothing at all** — the user is told nothing (see 6.3) |
| **D-4 NOT-A-CAPABILITY** — the permission is not expressible as a capability: `rulesOnly` objects (Contacts, Customer Locations, Equipment) with C/R/E/D all empty | "Access to equipment records is decided by Firestore Rules, not by a Role. There is no capability to grant." | a Rules change | p3a1 §1.2 records all three conditions collapsing; the administration policy seed **drops `rulesOnly` entirely**, so "a Rules-governed object is indistinguishable from an unmodelled one" |
| **D-5 SEPARATION-OF-DUTIES** — the principal **holds** the capability and is refused on **who they are relative to the record** | "A counter cannot approve their own material variance. This is a control, not a permissions problem." (corpus `S27-A05`) | nobody — it is the control working | "a sanitized error taxonomy that returns a generic permission message, which reads as 'you lack access' and sends the operator to the wrong person" |

**Corpus `S22-A04` is the whole requirement in one row:** three refusals with three different causes must produce **three visibly different messages**, and today's risk is "one generic 'permission denied' for all three."

### 6.2 The full effective-permission trace, and where it breaks

The brief's required trace is **Role → Capability → Assignment → Policy → Operating Company**. Measured, each hop has a specific failure:

| Hop | What EOS must resolve | Can it? | Break |
|---|---|---|---|
| **Role** | which Role(s) this principal holds | **PARTIAL** | for **9 of 27** observed roles there is no Role to name (§4); `jobTitle` is free text (M-6) |
| **Capability** | which capability the act required, and its `active` flag | **AVAILABLE NOW** | `permissionCatalog.ts` carries both; 113 of 147 are `active: false` |
| **Assignment** | which assignment conferred it, and its `accessVersionAtGrant` | **PARTIAL** | `resolveEffectivePermission.ts:131-142` records its own interpretation of "consistent with the current accessVersion" as `accessVersionAtGrant <= currentAccessVersion` and notes it was **recorded for Owner review** — corpus `P3B3-MGMT-043`: "Has that interpretation been ratified?" → **OD-EMP-011** |
| **Policy** | which of the **two** policy stores governed this | **MISSING** | corpus `P3B3-ADV-029` / `ADMIN-060`: the Roles & Permissions screen edits the **Postgres** store while every sales/CRM/finance command resolves against the **Firebase** capability model. `P3B3-ADV-039`: EOS resolves "may this person do this" **three** ways (44 legacy role-string sites in Rules, the 147-capability engine, the Postgres object/field store) |
| **Operating Company** | which company's books this act touches | **MISSING** | no `operatingCompanyId` on the Work Order (`P3B1-S07-A08`); `commercialCompanyScope.ts:26-29` forbids enforcement until "the census gate" passes (**OD-EMP-004**); Employee carries `companyId = null` always (M-5) |

**Verdict: the effective-permission explanation the program requires cannot be produced at `64008d5a` for any role.** Two of five hops are MISSING and two are PARTIAL. This is the lane's headline blocker.

### 6.3 The UNASKED defect (D-3) — the measured mechanism

The client asks the trusted feed for a **closed, declared list** of capabilities:
`field-ops-app-vite/src/access/reportCapabilityAccess.js:30` → `REPORT_CAPABILITY_REQUEST = [ ...REPORT_WAVE1_OBJECT_READ_CAPABILITIES, ...REPORT_DEFINITION_CAPABILITY_IDS, ...GOVERNED_SURFACE_CAPABILITY_IDS, ...DASHBOARD_MODULE_CAPABILITY_IDS ]`.
The file states the invariant itself: *"Without these the feed is never asked, and **an unasked capability is indistinguishable from a denied one**."*

A capability outside that list resolves `false` **forever**, for every principal, in every environment, whatever Role they hold.
The archaeology names this "the unasked question defect class" and calls it **worse than ungranted or inactive**, because
no grant, no activation and no Role change can reach it — and **the user is told nothing**, not even "you lack X".

**Instances named in the evidence** (p3a2 §1, p3a1 §1.2, p3a3 §12): `inventory.location.bin.manage` — every bin-write
control on `/administration/warehouse-racking` is **Ungated for every principal in every environment, including a holder
of `inventoryBinAdministrator`**; `inventory.stock.relocate` — the only quantity-moving scanner workflow **can never be
offered**; the Data Import surface; Administration → Users; and the dashboard case corrected by PR #1793, where *"six
governed capabilities the composition gates on were never in the access-feed request set, so **seven modules could not
resolve for anyone**."*

**Brief says "five built surfaces."** The evidence names at least five sites and one already-corrected sixth; the exact
membership of "the five" is recorded as `UNKNOWN — REVERIFY` (§13, U-1) because the four sources enumerate overlapping
but not identical sets. **The mechanism is not in doubt.**

**Information requirement (all roles, unprompted):** a surface whose control is gated on a capability outside the request
set must say so, in the control's own state, naming that nothing grantable will change it. `AVAILABLE NOW / ENGINEERING`
— the request set and the resolver are both in the repository; only the rendering is missing.

### 6.4 UNKNOWN, and the prohibition on unproven absence

**EOS must never present unproven absence as proven emptiness.** The defect the brief cites — "no matching records"
returned from a bounded page — is one of a family the archaeology measures repeatedly:

| Instance | Source | The lie |
|---|---|---|
| A truncated aggregate returned as **the** aggregate with only `truncated: true`; a truncated slice matching no rows resolved to a state that **outranked** `"truncated-widened"` | p3a3 archaeology, verbatim | "an understated total could arrive labelled **'no results'**" |
| The silent-truncation warning on the Accounts list **had never rendered** — it read `presentation.page.rows` and `buildListPresentation` returns no `page` key | p3a3 archaeology | "a safeguard against silent truncation that is itself silent is the worst of both" |
| A reconciliation engine fed an empty array renders **"No discrepancies"** | p3a2 archaeology | "a clean result for a check that never ran" |
| A denied location read rendered as an innocently empty `<select>` | p3a2 receiving 1e sweep | a permission fact presented as a data fact |
| A bin picker rendering empty instead of denied on **three** surfaces | Corpus `S15-A08` | "Three screens inventing three different stories about the same refusal" |
| An apprentice with `technicianId` unpopulated sees **an empty jobs list** | Corpus `P3B1-S09-A02` | `DESIRED: distinguish 'you have no jobs today' from 'your account is not linked to a technician record'` — "the difference between a five-minute fix and a lost morning" |

**The rule this lane sets:** every "nothing here" must be **provably complete or say it is not.**
Operationally that means the read returns, and the surface renders, one of exactly three things:
**(a)** `EMPTY` — the read succeeded, was unbounded or exhausted its cursor, and there is genuinely nothing;
**(b)** `SEARCH_ZERO` / `FILTER_ZERO` / `EMPTY_VIEW` — things exist and *this* predicate excludes them, with the predicate and its row count stated;
**(c)** `UNKNOWN` — the read was bounded and not exhausted, or a derivation failed, **and no count is rendered at all**.
`HonestState.jsx` already implements all three. **M-1 and M-2 are why they are not reaching the reader.**

### 6.5 What EOS must be able to say about UNKNOWN numbers

| Unknown | Required sentence | Backing | Status |
|---|---|---|---|
| a margin figure | "Margin is unavailable — no cost authority exists." Never `0%`. | `FIN-BLOCK-003`; `F12_SURFACE_READINESS_MAP.md` binding rule 3: "UNKNOWN renders as unknown (never 0, never blank-as-zero)" | `MISSING / AUTHORITY` — **OD-EMP-006** |
| an inventory valuation | "UNKNOWN, and here are the offending lots." Refuses to render a dollar figure. | Corpus `S32-A04`: "A partial total with a footnote is the failure mode — somebody will export the total." | `MISSING / AUTHORITY` |
| a goal actual with a real target | the target **stays on screen**; the actual has no number slot | `GoalTile.jsx` `NO_ACTUAL` | `AVAILABLE NOW` (component), `MISSING` (data: all five `performance.goal.*` are `active: false`) |
| an unpriced agreement line | "Incomplete — 1 line has no price." Never a partial sum, never `$0.00`. | p3a3 `SA-D3` | `AVAILABLE NOW` |
| a duration derived from an inverted timestamp pair | the whole figure is **withdrawn**, never transformed | `docs/governance/eos-dashboard-composition-authority.md`; PR #1796 corrected "a negative Avg Job Duration presented as a performance fact" | `AVAILABLE NOW` |

---

## 7. THE PER-ROLE INFORMATION MODEL

### 7.0 Three rules that bind every row below — read these first

**(a) The relationship dimensions mostly have no backing fact.** EOS models the **assignee** and no other role concept
(EMP-WORK). There is no stored accountable-person distinct from assignee, no record-level owner outside CRM's
ownership matrix, no approval-queue membership, and no escalation target. Therefore:

| Dimension | Backing fact at `64008d5a` | Verdict |
|---|---|---|
| **AS ASSIGNED** | yes — `assignedTechId` on the Work Order, `assignedTo`/`assignedBy` on the reorder request, `ownerUid` on a saved report definition | `PARTIAL` — real, but only for three object families |
| **AS ACCOUNTABLE** | **none** — no accountable-person field exists anywhere | `MISSING / MODEL` |
| **AS OWNED** | partial — CRM declares an ownership matrix (account owner, inherited by contacts and locations, HANDOFF transfer behaviour); financial families are IMMUTABLE, transfer order is N/A; **the handoff command has no `onCall` export, so it has no caller** | `PARTIAL / WORKFLOW` |
| **AS APPROVAL** | **none as a queue** — approval authority exists per capability (`reorder.request.approve`, `inventory.cycleCount.reconcile`, `performance.goal.approve`), but nothing lists "things waiting on me" | `MISSING / MODEL` |
| **AS ESCALATION** | **none** — no escalation target, and "who manages this person" has two unreconciled answers (M-7) | `MISSING / MODEL` |

Every row below states the role-specific requirement **and** whether the fact exists. Where it does not, the row says
what would have to be modelled rather than specifying a display EOS cannot populate.

**(b) Denominators.** P3-B3 (350 rows, **34.7% of the corpus**) carries **no coverage tags, no device context, no
friction scores and no operating company** (EMP-WORK; independently confirmed — its activity schema is
`id, title, actor_role, trigger, narrative, objects_touched, authority_path, status` only). So every coverage-derived
figure in this document has a denominator of **660**, not 1,010, and **sales, CRM, finance and administration contribute
zero rows to those axes. That silence is a measurement gap, not evidence those roles need less.**
Coverage counts over the 660: `PERMISSION_DENIAL` **69** (svc 32 / inv 37) · `MISSING_DATA` 135 · `EXCEPTION` 163 ·
`CROSS_COMPANY` 70 · `BAD_DATA` 139 · `MOBILE` 218 · `RECOVERY` 55 · `HANDOFF` 53.

**(c) Which vocabulary each requirement must read.** Because there is no job-role vocabulary (M-6), each SHOW row names
the identifier it would key on. Five options exist and none is authoritative for all roles:
`users/{uid}.role` (3 values) · `roleAssignments` → one of 45 governed Roles · `operationalRoles[]` (8 stored, 3 consumed) ·
`employees/{id}.jobTitle` (**free text**) · `users/{uid}.technicianId` (the only per-person work anchor that exists).

---

### 7.1 Field Technician — 134 activities (SVC 104 + INV 26 + SAL 4) · `technician` compatibility Role · device: MOBILE

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW (vocabulary) | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | Today's assigned Work Orders with address, equipment, fault, and **the exact on-hand of the part at THIS truck**, each figure stating its location and as-of time | unprompted | `technicianId` → `assignedTechId`; `sumExactLocationOnHand` per location | **PARTIAL** — jobs yes; truck stock no: corpus `S23-A07`/`S23-A09` — the client availability derivation is **location-blind**, has **no `WORK_ORDER_CONSUMPTION` term**, and adds the static catalog `warehouseQty` on top of ledger movement | ENGINEERING |
| **SEARCH** | this machine's service history while standing in front of it; a part by SKU/barcode | on demand | equipment timeline read reachable by a technician | **MISSING** — `P3B1-S12-A05`: equipment detail is on a route technicians are excluded from; `firestore.rules:1506` gates equipment reads on `isAdminOrDispatcher()`, the exclusion documented at `:1367-1381` | AUTHORITY |
| **ATTENTION** | a new dispatch; **"your truck is marked out of service"**; unsent scans from a previous shift | unprompted | truck status; the offline queue depth | **PARTIAL** — `P3B1-S09-A06`: *"'Your truck is marked out of service' is a sentence the server already knows and does not send."* `S21-A06` DESIRED: *"You have 4 unsent scans from 21:40."* | ENGINEERING |
| **ASSIGNED** | only my own jobs, and the boundary said out loud | unprompted | `assignedTechId == callerTechnicianId()` | **AVAILABLE NOW** — enforced in Rules; `P3B1-S17-A01`/`S17-A02` confirm an unconstrained technician read is denied | — |
| **ACCOUNTABLE** | "this visit's outcome is yours to close" | unprompted | an accountable-person fact | **MISSING** | MODEL |
| **OWNED** | nothing a technician owns as a record | n/a | — | **NOT APPLICABLE** | — |
| **APPROVAL** | none — a technician approves nothing | n/a | — | **NOT APPLICABLE** | — |
| **ESCALATION** | "who holds warehouse authority at THIS location, right now" on every refusal | on demand | location → Role holders | **MISSING** — corpus `S22-A01` DESIRED verbatim: *"Moving stock out of WH-PHX-MAIN requires warehouse authority you do not hold. Ask the parts desk."* Requires Role occupancy (§10) | MODEL |
| **EXPLAIN** | why a part number scanned as unknown (`NOT_FOUND` distinct from `FAILED`, with the scanned text echoed); why warranty status is nowhere; why this job shows a company that is not mine | on demand | scan resolution mode; `operatingCompanyId` on the Work Order | **MISSING** — `S19-A06`/`S19-A07`; `P3B1-S14-A07` ("Nothing about warranty claim status appears"); `P3B1-S17-A07` ("Nothing distinguishes this from her own company's work") | ENGINEERING + MODEL |
| **RECOMMEND** | almost nothing. Of 104 service technician activities, **82 are `NONE`** and 4 are `NOISE`; only 3 DRAFT / 2 EXPLAIN / 13 SHORTEN | on demand | — | **AVAILABLE NOW** as a rule: AI is quiet here | — |
| **WARN** | before Complete: "this job requires a certification you do not hold"; before a cross-company part movement: both companies by name; before a second send of a queued batch: "this line was already received at 09:14. Nothing was added." | unprompted, pre-commit | certification model; `operatingCompanyId`; idempotency key state | **MISSING** — M-8: *"Certification is not consulted anywhere… Nothing warns."* `S22-A05`, `S21-A05` | MODEL |

### 7.2 Apprentice Technician — 9 activities (SVC) · `technician` compatibility Role — **indistinguishable from a journeyman**

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the same surfaces as a technician, plus **the fact that his account is or is not linked to a technician record** | unprompted | `users/{uid}.technicianId` populated? | **MISSING** — `P3B1-S09-A02`: `callerTechnicianId()` returns null, every technician-scoped read is denied, and the reader gets **an empty jobs list**. DESIRED: distinguish *"you have no jobs today"* from *"your account is not linked to a technician record"* | ENGINEERING |
| **SEARCH** | a procedure or a prior visit's findings | on demand | equipment timeline | **MISSING** (as 7.1) | AUTHORITY |
| **ATTENTION** | work assigned to him; **nothing about supervision, because no supervision fact exists** | unprompted | — | **PARTIAL** | MODEL |
| **ASSIGNED** | own assignment only | unprompted | `assignedTechId` | **AVAILABLE NOW** | — |
| **ACCOUNTABLE** | "your supervisor signs this off" | unprompted | supervisor / manager | **MISSING** — M-7, two unreconciled answers | MODEL |
| **OWNED / APPROVAL** | none | n/a | — | **NOT APPLICABLE** | — |
| **ESCALATION** | who to call when a job exceeds his competence | on demand | competence + manager | **MISSING** — competence is held by nobody | MODEL |
| **EXPLAIN** | why a route he typed refuses rather than renders blank | on demand | the honest-state id for the refusal | **PARTIAL** — `P3B1-S09-A10`/`S17-A08`: *"The honest-state vocabulary already has `CAPABILITY_NOT_ENABLED` for exactly this"*; but `modules/technician` does not import `HonestState` (M-1) | ENGINEERING |
| **RECOMMEND** | nothing (7 of 9 activities `NONE`) | — | — | **AVAILABLE NOW** | — |
| **WARN** | **the single clearest warn-gap in the corpus**: `P3B1-S17-A06`, completing a job requiring an unheld certification — expected result **"Nothing warns."** | unprompted, pre-commit | certification/competence | **MISSING** | MODEL — **OD-EMP-002** |

### 7.3 Dispatcher — 97 activities (SVC 61 + INV 27 + SAL 9) · `dispatcher` compatibility Role · device: DESKTOP

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the board: lanes, chips, blocked time by governed `kind`, per-lane shift and % booked, the ready queue with priority word and top recommendation **with its score**; and **an operating-company badge on every card** | unprompted | technician schedule; `operatingCompanyId` on the Work Order | **PARTIAL** — board yes; company no. `P3B1-S04-A10`: *"Nothing in `ACTION_PERMISSIONS` distinguishes a Taylor dispatcher from a Ventana one; the role string is the whole authority."* Help field verbatim: *"An operating-company badge on every board card is the single highest-value addition in this story."* | MODEL |
| **SEARCH** | capacity for a promised window; a technician by skill or proximity | on demand | availability model; competence | **PARTIAL** — availability exists; competence does not. Also: fleet-wide `% booked` renders **only when every technician in view has a recorded schedule**, "in practice means never" | MODEL |
| **ATTENTION** | at-risk Work Orders (reference, account, severity, age, **why**, technician); jobs `WORK_IN_PROGRESS` past their window; **aged transfers** ("TRF-2209 — dispatched 6 days ago, not received. 6 × TST-1016 unaccounted.") | unprompted | stagnation inputs; transfer age | **PARTIAL** — the at-risk panel exists but `SO-G7` drops the records with unusable `createdAt` (A-6); `S25-A01` records **no aging surface at all** for transfers | ENGINEERING + MODEL |
| **ASSIGNED** | which technician holds each job, and **whether they have seen it yet** | unprompted | a "seen/acknowledged" fact and a last-seen-online time | **MISSING** — `P3B1-S07-A05`: *"'The technician has not seen this yet' is a state the dispatcher needs and cannot have."* `S15-A10`: *"'Last seen online 13:40' on the technician lane would answer most of this"*; today nothing distinguishes "still working" from "finished, offline, unsent" | MODEL |
| **ACCOUNTABLE** | who answers for a slipped window | unprompted | — | **MISSING** | MODEL |
| **OWNED** | which rows on the queue are **his** versus undecided | unprompted | a row owner + "waiting on" state | **MISSING** — `P3B1-S01-A10` DESIRED: *"an owner and a 'waiting on' state visible on the row"* | MODEL |
| **APPROVAL** | nothing waiting on a dispatcher's approval today | n/a | — | **NOT APPLICABLE** | — |
| **ESCALATION** | who can act when the edge does not exist from this state | on demand | transition graph + Role holders | **PARTIAL** — `P3B1-S21-A02` shows the correct pattern already shipping: *"a deliberately disabled placeholder… with a `title=` explaining it is not available yet and is not a permission limit — which is honest and correct practice"* | ENGINEERING |
| **EXPLAIN** | **which** Work Order a scheduling conflict collides with (never merely "conflict"); why a button that existed ten minutes ago is gone; **who moved this, and to where** | on demand | the colliding record; the transition that removed the edge; a change history | **PARTIAL/MISSING** — `P3B1-S04-A03`: *"The dialog must name the colliding Work Order, not merely say 'conflict'"*; `S07-A04`: *"The button is simply absent, with no explanation of why it was there ten minutes ago"*; `S07-A03`: *"'Who moved this, and to where?' has no location"* — and `rescheduledFrom*` is a **single denormalized slot a second reschedule overwrites** | ENGINEERING + MODEL |
| **RECOMMEND** | dispatch suggestions — **the densest legitimate AI surface in the service corpus**: 10 EXPLAIN + 14 SHORTEN + 6 CLASSIFY + 2 DRAFT of 61. A recommendation must carry its score and its reasons, and a no-candidate row must **state why** | unprompted (as a tray, never as an action) | scoring inputs | **PARTIAL** — batch scoring is the supported shape (`P3B1-S06-A09`); but the engine recommends a technician at availability 100 while the same viewport draws their PTO as a hatched chip — *"One screen, two disagreeing answers to 'is this person available'"* | ENGINEERING |
| **WARN** | "75 minutes of this placement fall outside the technician's working hours" — **allowed, and here is what it costs**; "past slots should be visually unavailable, not merely refused after the fact"; a bulk result summary: **"8 of 11 dispatched, 3 refused because those technicians are occupied"** | unprompted, pre-commit | working hours; slot validity; per-item outcome of a batch | **PARTIAL** — the outside-hours warning is specified (`S04-A06`); the past-slot case is refuse-after-the-fact (`S04-A04`); the batch summary is *"the summary nobody gets"* (`S08-A05`) | ENGINEERING |

### 7.4 Service Coordinator — 68 activities (SVC) · **no security Role; identified by `jobTitle` free text only**

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the inbound request queue with, per row, **the operating company**, a completeness indicator, an owner and a "waiting on" state | unprompted | `operatingCompanyId` on the request; a completeness projection | **MISSING** — `P3B1-S01-A06` DESIRED "operating company for each. **Whether operating company is shown today is UNPROVEN**"; `S02-A10` DESIRED "a completeness column. CURRENT: she reads each one" | MODEL |
| **SEARCH** | **15 of 68 of her activities are search-shaped — the highest search intensity of any role.** She needs: the existing Work Order an email belongs to; a duplicate request's original; the account's other locations | on demand | search scope stated honestly | **PARTIAL** — `S01-A08` DESIRED "the duplicate row links straight to the original request and to the Work Order the original produced. **Whether it does is UNPROVEN**" | ENGINEERING |
| **ATTENTION** | requests aging without a decision; a Ventana mailbox message about a Taylor account | unprompted | mailbox ↔ account company comparison | **MISSING** — `S27-A10`: *"Nothing indicates the mailbox and the account belong to different companies"* | MODEL |
| **ASSIGNED** | nothing is assigned **to** a coordinator; requests have no assignee concept | n/a | — | **MISSING / MODEL** | MODEL |
| **ACCOUNTABLE** | she is accountable for the **customer promise**, which EOS does not hold at all (EMP-WORK: *"the promise lives outside EOS"*) | unprompted | a promise object | **MISSING** | MODEL — **OD-EMP-003** |
| **OWNED** | which queue rows are hers this shift | unprompted | row owner | **MISSING** — `S01-A10` | MODEL |
| **APPROVAL** | none | n/a | — | **NOT APPLICABLE** | — |
| **ESCALATION** | **"if the coordinator lacks Cancel, the button should say who can do it, not simply be absent"** — she cannot cancel her own two-minute-old mistake and must ask a dispatcher | unprompted at the control | `ACTION_PERMISSIONS` → Role → holders | **PARTIAL** — the authority fact is in the repo (`Cancel` is admin/dispatcher only); the **holders** are not (§10). `S02-A06`, `S02-A08` (*"A denial that names the role that can do it is worth more than the denial itself"*), `S08-A07` | MODEL |
| **EXPLAIN** | replay vs first-accept (*"already accepted — this is the Work Order that was created"*); *"This request was accepted by Dale Brackett at 06:51 and became WO-2026-000141"*; why one fault produced two Work Order numbers; **that changing an equipment model does not re-plan parts on open Work Orders** | on demand | idempotency state; acceptance actor+time; WO grouping | **PARTIAL** — all three are authored as DESIRED and all three marked **UNPROVEN** in the current UI (`S01-A03`, `S01-A05`, `S20-A09`, `S03-A03`) | ENGINEERING |
| **RECOMMEND** | the highest AI density in service after dispatch: 10 CLASSIFY + 6 DRAFT + 5 EXPLAIN + 17 SHORTEN of 68. Legitimate uses: triage an inbound email, draft a customer status sentence, shorten a 62-Work-Order PM run (`S23-A02`: **248 wizard steps**) | on demand | — | **PARTIAL** — bulk creation is `MISSING_CAPABILITY`; AI cannot shorten what has no bulk path | WORKFLOW |
| **WARN** | *"Cancelled is permanent" belongs in the confirm dialog*; *"no equipment registered at this location — register it, or proceed without"*; before creating a Ventana Work Order on a shared account, which company's machine she picked | unprompted, pre-commit | terminality; equipment presence; company on the equipment row | **PARTIAL** — `S02-A06`, `S02-A05`; `S29-A02` help verbatim: *"An operating-company badge in the equipment picker row is the single highest-value change in this story"* | MODEL |

### 7.5 Service Manager — 60 activities (SVC) · **no security Role**; `SERVICE_MANAGER` is a reserved, unconsumed `operationalRoles[]` value

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the service position: open Work Orders, completion, technician load — each number **scoped to his team**, drilling to the records | unprompted | team membership; a windowed completion read | **MISSING** — `SO-D4`: *"no windowed 'completed this week' read exists anywhere in Service"*, so the label was downgraded to "Completed" over snapshot truth. Team membership has no authoritative source (M-6, M-7) | MODEL + ENGINEERING |
| **SEARCH** | Work Orders across his whole team | on demand | a service-manager-scoped read | **MISSING** — `P3B1-S17-A10`: **"There is NO `workOrder.read` capability in the permission catalog."** Work Order visibility is decided by the legacy `users/{uid}.role` string, so "the governed capability system… has nothing to grant here" | AUTHORITY |
| **ATTENTION** | jobs at risk in his team; absences that still leave a technician unavailable for another reason | unprompted | stacked absence reasons | **PARTIAL** — `S05-A06` DESIRED: *"This absence is removed. The technician is still unavailable Thursday because of &lt;the other block&gt;."* Also `§4.1`: two identical 8-hour PTO records currently draw **"sixteen hours blocked" on an eight-hour lane** (SUM vs UNION) | ENGINEERING |
| **ASSIGNED** | nothing assigned to a manager | n/a | — | **NOT APPLICABLE** | — |
| **ACCOUNTABLE** | he answers for his team's service outcomes | unprompted | team + accountable fact | **MISSING** | MODEL |
| **OWNED** | the technician records for his team | unprompted | a manager→technician relation | **MISSING** — `P3B1-S33-A01`: the legacy technicians directory that offered create is **orphaned**; `S33-A02`: `users/{uid}` is Admin-SDK-written and `technicianId` is deliberately client-immutable, so **there is no reachable technician-create screen** | AUTHORITY |
| **APPROVAL** | goals drafted for his people | unprompted | `performance.goal.approve` | **MISSING** — all five `performance.goal.*` are `active: false` | AUTHORITY |
| **ESCALATION** | who grants a service manager read access to all Work Orders | on demand | — | **MISSING** — the answer is "nobody, via the capability system" (see SEARCH) | AUTHORITY |
| **EXPLAIN** | why his team's numbers differ from the dispatcher's; what a goal's actual is computed from | on demand | provenance per figure | **PARTIAL** — `GoalTile` states its four absences correctly; the data behind them does not exist | AUTHORITY |
| **RECOMMEND** | 27 SHORTEN of 60 — the highest SHORTEN share in service. Legitimate: summarising a shift, drafting a customer explanation. **3 EXPLAIN, 0 CLASSIFY, 0 DRAFT** | on demand | — | **AVAILABLE NOW** as a rule | — |
| **WARN** | before publishing a team number: that it covers a snapshot, not a window | unprompted | the read's real scope | **PARTIAL** (S-3, S-5) | ENGINEERING |

### 7.6 Service Billing Admin — 18 activities (SVC) · **no security Role** · **0 of 5 workflows finishable** (EMP-WORK)

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | completed Work Orders ready to bill, with parts, labour and what is missing | unprompted | a billable-service read | **MISSING** — `P3B3-FIN-007`: the billing queue is **Sales-Order-anchored** (`billingQueue.ts:20`); `FIN-BLOCK-002` records service billing as **structurally absent** | AUTHORITY — **OD-EMP-005** |
| **SEARCH** | a Work Order by number, customer or date (4 of her 18 activities are search-shaped) | on demand | route reachability | **PARTIAL** — `P3B1-S16-A04`: whether her legacy role reaches the Work Order routes at all *"depends on the `workOrder.create` gate those routes carry — a billing role that lacks `workOrder.create` cannot"* | AUTHORITY |
| **ATTENTION** | completed work aging unbilled | unprompted | completion→billing link | **MISSING** | AUTHORITY |
| **ASSIGNED / ACCOUNTABLE / OWNED / APPROVAL / ESCALATION** | none of the five has a backing fact for this role | — | — | **MISSING** | MODEL |
| **EXPLAIN** | why a completed job cannot be invoiced; where labour time went | on demand | the structural reason, in words | **PARTIAL** — the reason is documented (`FIN-BLOCK-002`) and must be **said on the surface**, per S-1 | ENGINEERING |
| **RECOMMEND** | 7 SHORTEN of 18, 1 NOISE, 10 NONE | on demand | — | **AVAILABLE NOW** | — |
| **WARN** | that labour recording is off, and that the figure she is reading excludes it | unprompted | the two labour capabilities' state | **PARTIAL** — both labour capabilities are among the 17 activated nowhere; `P3B1-S12-A04` shows the right pattern: *"the screen renders DISABLED with an explanation rather than hidden or broken… which is the honest-state convention working correctly"* | ENGINEERING |

### 7.7 After-Hours Coordinator — 5 activities (SVC) · **no security Role, and no time dimension exists**

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the on-call picture: what came in, who is reachable, what can be acted on **at this hour** | unprompted | an on-call / time-of-day dimension | **MISSING** — `P3B1-S19-A02`: MarkReady, Schedule and Dispatch are all admin/dispatcher **"with no time-of-day or on-call dimension"**; the actions are *"simply absent"* | MODEL — **OD-EMP-007** |
| **SEARCH** | a customer's emergency history | on demand | — | **PARTIAL** | AUTHORITY |
| **ATTENTION** | an emergency intake at 23:05, **visibly distinguished from a daytime job** | unprompted | urgency + hour | **MISSING** — `P3B1-S19-A05`: an emergency dispatch accepted from bed is *"Identical to a daytime job."* | MODEL |
| **ASSIGNED / ACCOUNTABLE / OWNED / APPROVAL** | none | — | — | **MISSING** | MODEL |
| **ESCALATION** | who he may wake, and what he may do himself | on demand | on-call roster | **MISSING** | MODEL |
| **EXPLAIN** | why he can take the call and not dispatch it | on demand | `ACTION_PERMISSIONS` + the absence of an on-call dimension | **PARTIAL** — the fact is in the repo; the sentence is not on screen | ENGINEERING |
| **RECOMMEND** | 1 DRAFT of 5; otherwise quiet | on demand | — | **AVAILABLE NOW** | — |
| **WARN** | that an after-hours request will sit until morning, and what that means | unprompted | overnight handling | **MISSING** — corpus `S02-A08` help verbatim: *"ⓘ: what happens to an after-hours request overnight."* | WORKFLOW |

### 7.8 Parts Manager — 74 activities (INV 65 + SAL 9) · `partsManager` governed Role · `operationalRoles[] = PARTS_MANAGER` (one of the 3 consumed)

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the parts position: **one authoritative on-hand per location, computed server-side, with the movement list behind it**; every quantity attributed to an operating company and a location; a cross-company total labelled as one | unprompted | `sumExactLocationOnHand`; `MOVEMENT_SIGN`; `operatingCompanyId` | **MISSING** — `S26-A10`: the client derivation **adds the static catalog `warehouseQty` on top of ledger movement** and **omits `RETURNED`, `SCRAPPED`, `RELOCATION_IN/OUT` and `WORK_ORDER_CONSUMPTION`**; `S14-A07`: a hardcoded baseline and a governed on-hand *"render in the same column with the same typography"*; `S14-A09`: *"CURRENT: one unattributed number"* | ENGINEERING |
| **SEARCH** | a part by number, description, barcode or alias | on demand | the search's **real** scope | **PARTIAL** — p3a2: the drawn placeholder claiming barcode+alias was **REJECTED** because two of four terms were false; the shipped placeholder is *"Search part number, description, or category"* with a test asserting a barcode-shaped value matches nothing | ENGINEERING |
| **ATTENTION** | parts below reorder point; open counts with material variances, **variances-first**; aged transfers | unprompted | reorder point; variance state; transfer age | **PARTIAL** — the Attention column exists but `partsAttentionProjection` carries `ACTION_ITEM`/`NOTIFICATION` only, **no severity, so the column is not sortable**; `S31-A01` DESIRED "sheets ordered variances-first… with an honest truth-state rather than an empty pane on failure" | ENGINEERING |
| **ASSIGNED** | reorder requests assigned to her desk | unprompted | `assignedTo` on the request | **AVAILABLE NOW** | — |
| **ACCOUNTABLE** | she answers for the position at her warehouse | unprompted | — | **MISSING** | MODEL |
| **OWNED** | which cycle-count sheets are hers | unprompted | a sheet assignee | **MISSING** — `S31-A08`: *"a sheet is a location and a set of lines; it carries no assignee"* | MODEL |
| **APPROVAL** | reorder requests and count variances awaiting her decision | unprompted | approve/reconcile capability + a queue | **PARTIAL** — `reorder.request.approve` is production-active; `inventory.cycleCount.reconcile` is `active: false`; **no "waiting on me" list exists for either** | MODEL |
| **ESCALATION** | who can activate a capability she needs; who can reassign a request | on demand | Role holders; the activation owner | **MISSING** — `S22-A06` DESIRED: *"These capabilities are registered but not active in this release. Granting them has no effect."* `S14-A01`: *"that notice names WHO can turn the writes on and what is missing, not just that they are off."* | MODEL |
| **EXPLAIN** | for every figure: which movement types it counts and which location it describes; whether each capability in a Role is **ACTIVE or INACTIVE in the catalog, at assignment time** | on demand | movement-type set; catalog `active` flag | **PARTIAL** — `S20-A09` DESIRED; `S15-A03`: *"a successful assignment is not a successful grant… The Role screen must show, per capability, whether it is ACTIVE in the catalog"* | ENGINEERING |
| **RECOMMEND** | reorder quantities — **and the recommendation must state what on-hand it was computed from and as of when.** 13 `AI_ASSIST_NARROW` + 8 `AI_MATERIAL` of 65, against 37 `AI_NOISE` | unprompted, as a proposal | the derivation behind the number | **MISSING** — `S02-A01`: *"CURRENT: the number arrives with no provenance affordance"* | ENGINEERING |
| **WARN** | *"An open request already exists for this part at this warehouse"* with a link; before a cross-company transfer, **both companies by name in words**; before a reversal, exactly which rows will be written and that the originals remain | unprompted, pre-commit | duplicate detection; company pair; reversal shape | **MISSING** — `S02-A05`, `S24-A03`, `S25-A09` (*"no reversal path, so the actual fix is an `ADJUSTED +5` with a free-text reason, which loses the connection"*) | MODEL |

### 7.9 Parts Associate — 42 activities (INV 37 + SVC 5) · `partsAssociate` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the requests on his desk with line-by-line picked/outstanding state; **the receipt progress per line** | unprompted | per-line receipt state | **PARTIAL** — `S23-A04` DESIRED; p3a2 records per-row receipt progress as **NOT AVAILABLE (RCV-G6)** — "none fabricated" | ENGINEERING |
| **SEARCH** | a part; an existing PO for a request | on demand | — | **PARTIAL** | ENGINEERING |
| **ATTENTION** | lines he has left outstanding; a scan that resolved by hand rather than by barcode | unprompted | resolution mode | **MISSING** — `S19-A09` DESIRED: *"the resolution card states 'entered by hand' so a later reviewer knows no barcode confirmed it"* | ENGINEERING |
| **ASSIGNED** | requests assigned to him, and **only** his | unprompted | `assignedTo` | **AVAILABLE NOW** — and the double gate is deliberate governance (`S04-A04`) | — |
| **ACCOUNTABLE** | which lines **he** received in a shared session | unprompted | per-line operator identity | **MISSING** — `S20-A08` DESIRED: *"the session header updates to name the current operator and shows that lines 1-11 belong to Ray. CURRENT risk: a session bound to its opener, so per-line operator identity is lost"* | MODEL |
| **OWNED** | nothing he owns as a record | n/a | — | **NOT APPLICABLE** | — |
| **APPROVAL** | **none, deliberately** — `PARTS_ASSOCIATE` never gains review authority, an Architecture Review decision | n/a | — | **AVAILABLE NOW** as a fact; the **display** of it is the gap | — |
| **ESCALATION** | on every refusal: *"who can void, and what to do when nobody who can void is the assignee"*; *"who reviews reorder requests"*; *"who can cancel"* | on demand, at the control | Role holders | **MISSING** — all three are authored `ⓘ` requirements (`S06-A05`, `S03-A05`, `S07-A04`) and all three need Role occupancy (§10) | MODEL |
| **EXPLAIN** | *"Already recorded"* with the existing PO shown, not a raw error; *"already received at 14:02 by you"*; why an edit control is not offered (void-and-reorder is the path) | on demand | idempotency + actor + time | **MISSING** — `S05-A05`, `S08-A06`, `S05-A03` all record the risk as *"a control that renders and then fails"* or *"a raw error"* | ENGINEERING |
| **RECOMMEND** | 5 `AI_ASSIST_NARROW` + 8 `AI_MATERIAL` of 37, against 18 `AI_NOISE` | on demand | — | **AVAILABLE NOW** as a rule | — |
| **WARN** | *"marking received does NOT add the stock"*, naming the separate act that does; *"Placement recorded. Quantity unchanged — put-away does not verify counts."*; a **stale-write warning** before a colleague's vendor note is lost; that the destination is another operating company | unprompted, pre-commit | the semantic difference between the two acts; write version; company | **MISSING** — `S08-A01` (*"CURRENT RISK: a success message that reads as though the stock is now in"*), `S20-A10`, `S04-A07`, `S24-A04` | MODEL + ENGINEERING |

### 7.10 Inventory Control Analyst — 34 activities (INV) · **no security Role**; nearest are `inventoryCycleCountCounter` / `inventoryCycleCountReconciler`

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | **three numbers that agree** — server exact on-hand at the location, the availability panel figure, and the physical count | unprompted | one server-side on-hand rule | **MISSING** — `S23-A10`: *"the availability panel is location-blind and omits `WORK_ORDER_CONSUMPTION`, so it will be high"*; `S21-A10` DESIRED: *"one authoritative on-hand per location, computed server-side, with the movement list behind it"* | ENGINEERING |
| **SEARCH** | a scan resolution by raw text, mode, or part | on demand | the resolution record | **MISSING** — `S19-A10` DESIRED: *"each row shows resolved `partId`, raw scanned text, and a resolution mode (EXACT / CASE_FOLDED / MANUAL / DISAMBIGUATED). CURRENT: the row carries a `partId` and nothing about how it was chosen"* | MODEL |
| **ATTENTION** | open counts by age; transfers aged, **with both operating companies visible on each row** | unprompted | age; company per transfer | **MISSING** — `S25-A02`: *"a list that cannot state which company a transfer belongs to, because company is inferred from location — the inference `DECISIONS #165` forbids"* | MODEL |
| **ASSIGNED** | counts assigned to her | unprompted | sheet assignee | **MISSING** (as 7.8) | MODEL |
| **ACCOUNTABLE** | the accuracy of the position she publishes | unprompted | — | **MISSING** | MODEL |
| **OWNED** | the count sheets she opened | unprompted | sheet owner | **MISSING** | MODEL |
| **APPROVAL** | variances awaiting disposition — **and she may not approve her own** | unprompted | `submittedBy` vs actor | **PARTIAL** — the control is real (`S27-A05`); the **queue** is not | MODEL |
| **ESCALATION** | who can activate cycle counting; who can dispose of a variance she submitted | on demand | Role holders + activation owner | **MISSING** — `S26-A02`: *"the Cycle Counts nav entry was deliberately un-hidden on the stated grounds that these capabilities are active, so the operator reaches a full workspace and only learns otherwise after choosing a location"* | ENGINEERING + MODEL |
| **EXPLAIN** | that a refusal is **a control, not a permission problem** — *"A counter cannot approve their own material variance."*; why dispatch uses EXACT and never an aggregate | on demand | the rule, named; `submittedBy`; the movement-authority rule | **MISSING** — `S27-A05`, `S23-A08` (*"dispatch uses EXACT, always, and the UI never offers an aggregate figure as authority for a movement"*) | ENGINEERING |
| **RECOMMEND** | **the highest legitimate AI share in inventory**: 6 `AI_ASSIST_NARROW` + 9 `AI_MATERIAL` of 34 (44%), against 13 `AI_NOISE` and 2 `AI_UNSAFE_HERE` | on demand | — | **AVAILABLE NOW** as a rule | — |
| **WARN** | that a `COUNTED`-undisposed line is a **known, quantified discrepancy deliberately not applied**, and a close that ignores it is wrong | unprompted, pre-commit | open-count state at close | **MISSING** — `S32-A08`: *"there is no close surface at all"* | AUTHORITY |

### 7.11 Scanner Operator — 32 activities (INV) · **no security Role**; nearest `inventoryPutAwayOperator` / `inventoryStockRelocationOperator` (both gated on ids that are `active: false`, one of them **never requested** — §6.3)

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | **the location he is working, prominently, in the session header**; a running scan count; and **only the workflows he can actually complete** | unprompted | the session's location (never defaulted silently from the profile); per-workflow reachability | **PARTIAL** — p3a2 records the Scan Workspace doing this correctly (unsupported workflows **absent, not disabled**, *"because a disabled control asserts the operation exists"*, plus an explicit *"Not available to you"* list carrying per-workflow reasons). `S22-A08` DESIRED: the header names the location, *"because an operator covering an unfamiliar site is exactly the person who needs to see it"* | ENGINEERING |
| **SEARCH** | a part by scan; and when it fails, `NOT_FOUND` distinct from `FAILED` **with the read string echoed** and a manual-entry affordance | on demand | resolution outcome + raw text | **MISSING** — `S19-A07` DESIRED: *"'label may be damaged — enter the code manually'. The beep must not be the only feedback that a scan happened."* `S19-A06`: *"CURRENT risk: an empty result set rendering as an empty screen"* | ENGINEERING |
| **ATTENTION** | a persistent offline banner and a **queued-count badge**, legible in one glance with cold gloves; on power-up, *"You have 4 unsent scans from 21:40."* | unprompted | queue depth; durability probe result | **MISSING** — `S21-A01` (*"CURRENT risk: committed and queued lines rendering identically, which makes the offline state invisible"*), `S21-A06` (*"CURRENT risk: a clean home screen that silently implies there is nothing outstanding"*) | ENGINEERING |
| **ASSIGNED** | the session, and which lines are his within a shared one | unprompted | per-line operator | **MISSING** (as 7.9) | MODEL |
| **ACCOUNTABLE / OWNED / APPROVAL** | none | — | — | **NOT APPLICABLE / MISSING** | MODEL |
| **ESCALATION** | who holds the authority this workflow needs, at this location, right now | on demand | Role holders by location | **MISSING** | MODEL |
| **EXPLAIN** | **three visibly different messages** for three different refusals — you lack it / it is off for everyone / it is not built; *"This is a serialized asset… not a stock part"*; *"Bin locations are not enabled. This label is not tracked."* | on demand, at the refusal | capability id + `active` flag + holders | **MISSING** — `S22-A04` is the canonical row: *"CURRENT risk: one generic 'permission denied' for all three, which makes the system's actual state unknowable from the outside"*. `S19-A04`, `S19-A05`, `S22-A02`, `S22-A03` | ENGINEERING |
| **RECOMMEND** | 8 `AI_ASSIST_NARROW` of 32 — but **5 `AI_UNSAFE_HERE`, the highest unsafe count of any role.** AI must be absent from the scan-commit path | — | — | **AVAILABLE NOW** as a rule | — |
| **WARN** | *"This line was already received at 09:14. Nothing was added."*; **an explicit third state between success and failure** with a "check status" action; *"15 lines recorded. Any unsent scans from handheld #2 are not included."*; *"Counted 31, expected 37. Variance -6 recorded for reconciliation. On-hand unchanged until reviewed."* | unprompted, pre- and post-commit | idempotency; send state; other-device queues; variance vs adjustment | **MISSING** — `S21-A05` (*"CURRENT risk: a cheerful success toast for the second write"*), `S21-A04` (*"a binary success/error toast… forces Luis to guess and therefore to retry"*), `S21-A07`, `S21-A09` (*"which lets a night attendant silently move stock"*). `S21-A03` is the cost: **"sixteen units of TST-1007 on hand, with a perfectly clean audit trail of sixteen legitimate-looking RECEIVED rows."** | ENGINEERING — **the highest-severity WARN set in the corpus** |

### 7.12 Receiving Lead — 19 activities (INV) · `inventoryReceivingClerk` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the receiving queue; per line **ordered / already received / outstanding / scanned now / remaining after**; and on resume, *"11 of 14 received"* opening on the first outstanding line | unprompted | per-line receipt ledger | **PARTIAL** — the multi-scan expected-versus-observed table exists in design; `S20-A07` records the risk as *"a fresh-looking session screen that invites Ray to re-scan lines 1-11"* | ENGINEERING |
| **SEARCH** | an order by supplier or reference — **by supplier name, never by document id** | on demand | governed supplier identity | **PARTIAL** — p3a2 records a test that asserted `heading { name: "PO-1" }` — **the document id as the journey title** — since corrected to the supplier-name identity with *"No order number recorded"* in place of the opaque id | ENGINEERING |
| **ATTENTION** | partially delivered orders; an unaccounted variance | unprompted | partial-receipt state | **MISSING** — `S08-A04` DESIRED: *"a partial-receipt state, or an explicit refusal to close a partially delivered order. Mark MISSING_CAPABILITY if executed and neither exists."* | AUTHORITY |
| **ASSIGNED** | the session he opened, shown as `IN_PROGRESS` **with his name and an idle time** on the desk queue | unprompted | session owner + activity timestamp | **MISSING** — `S20-A06`: *"the queue shows only a status, so nobody can tell a working session from a dead one"* | MODEL |
| **ACCOUNTABLE** | the lines he receipted | unprompted | per-line operator | **MISSING** | MODEL |
| **OWNED / APPROVAL** | none | — | — | **NOT APPLICABLE** | — |
| **ESCALATION** | who holds put-away authority when he does not | on demand | Role holders | **MISSING** — `S01-A09`: `inventory.placement.record` is `active: false` and granted to no Role; DESIRED *"a refusal that names the missing authority"*, current risk *"a screen that renders the put-away form over an authority nobody holds, so the refusal arrives only after the work is typed"* | MODEL |
| **EXPLAIN** | a correction shown as **effective quantity with the correction visible underneath**, not a bare number that hides what happened; both halves of a part-change correction on one screen with the net effect in units | on demand | append-only ledger semantics | **MISSING** — `S20-A03` (*"an edit-looking affordance over an append-only store"*), `S20-A05` | ENGINEERING |
| **RECOMMEND** | 4 `AI_ASSIST_NARROW` + 3 `AI_MATERIAL` of 19 | on demand | — | **AVAILABLE NOW** | — |
| **WARN** | *"this records where it went; it does not change how much there is"* at the point of submit; that a receipt does **not** close the request | unprompted, pre-commit | the two acts' semantics; receipt↔request link | **MISSING** — `S16-A01`: *"This activity FAILS if the confirmation reads like a stock movement."* `S08-A05`: *"CURRENT: two disconnected acts with no link between them."* | MODEL |

### 7.13 Branch Parts Coordinator — 12 activities (INV) · **no security Role**

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | **every inventory figure scoped to an operating company, saying which**: *"WH-VEN-MAIN: 0. WH-PHX-MAIN (taylor): 11 — cross-company transfer required."* | unprompted | company per location per quantity | **MISSING** — `S24-A01`, `S32-A06`; `S14-A09`: *"CURRENT: one unattributed number"* | MODEL |
| **SEARCH** | stock at another company's warehouse | on demand | cross-company read authority | **MISSING** — all four `inventory.transfer.*` are `active: false` and granted to no Role | AUTHORITY |
| **ATTENTION** | inbound transfers not yet received | unprompted | in-transit state | **MISSING** — `S24-A05`: the risk is *"the belts appearing in neither company's on-hand and in no list at all — invisible"* | MODEL |
| **ASSIGNED / ACCOUNTABLE / OWNED / APPROVAL** | none | — | — | **MISSING** | MODEL |
| **ESCALATION** | who at the other company may dispatch to her | on demand | Role holders per company | **MISSING** — and it is **unproven that a ventana Role can act on a transfer created by a taylor user** (`S24-A06`) | MODEL |
| **EXPLAIN** | which company's stock backs an order line | on demand | backing company per line | **MISSING** — `S24-A02`: *"nothing on screen distinguishes a ventana-backed promise from a taylor-backed one"* | MODEL |
| **RECOMMEND** | 1 of 12; effectively silent | — | — | **AVAILABLE NOW** | — |
| **WARN** | that receiving moves stock onto **Ventana's** books, with the Taylor side shown | unprompted, pre-commit | the company pair | **MISSING** — `S24-A06`: a company-blind derivation means *"the pair nets to zero visible change while ownership has in fact moved between two legal entities"* | MODEL |

### 7.14 Satellite Attendant — 7 activities (INV) · **no security Role** · covers unfamiliar sites

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | **the location being worked, stated prominently — never defaulted silently from the user profile** | unprompted | session location, explicitly chosen | **MISSING** — `S22-A08`: *"CURRENT risk: a location defaulted from the user profile with no on-screen statement"*; `DECISIONS #165 ruling 4` forbids inferring location from ownership | MODEL |
| **SEARCH** | stock at the site he is standing in | on demand | per-location exact on-hand | **MISSING** (location-blind derivation) | ENGINEERING |
| **ATTENTION** | what is outstanding at this site tonight | unprompted | per-location open work | **MISSING** | MODEL |
| **ASSIGNED** | his own lines within a shared session | unprompted | per-line operator | **MISSING** — `S21-A08`: *"CURRENT risk: a single operator name on the whole session"* | MODEL |
| **ACCOUNTABLE / OWNED / APPROVAL / ESCALATION** | none have a backing fact; escalation at 22:00 has no target at all | — | — | **MISSING** | MODEL |
| **EXPLAIN** | that retiring a bin **does not free the code and does not move any stock** | on demand | bin semantics | **MISSING** — `S15-A05`: *"An operator who believes retiring a bin empties it is in for a bad cycle count"* | ENGINEERING |
| **RECOMMEND** | 0 of 7 material; 4 `AI_NOT_APPLICABLE` | — | — | **AVAILABLE NOW** | — |
| **WARN** | *"Dispatched 8, received 7. 1 unit unaccounted — discrepancy raised."* | unprompted, pre-commit | dispatched vs received | **MISSING** — `S25-A03`: the risk is a form that *"either forces 8 (Owen receives a gasket he does not have) or silently accepts 7 and closes the transfer, losing the unit"* | MODEL |

### 7.15 Purchasing Admin — 10 activities (INV 8 + SAL 2) · `purchasingManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the purchasing queue — **and no money anywhere, deliberately, until a cost authority exists** | unprompted | order state; **not** cost | **PARTIAL** — p3a2: Purchase Orders *"shows no money anywhere, deliberately"*; `unitCost` is blocked from display, report **and** export (`ND-27`); `totalCost` carries **no declared unit — a 100× formatting-error risk** | AUTHORITY |
| **SEARCH** | an order by supplier | on demand | — | **PARTIAL** | ENGINEERING |
| **ATTENTION** | requests assigned and not started | unprompted | assignment + start state | **AVAILABLE NOW** (the reorder family is production-active) | — |
| **ASSIGNED** | requests assigned to her | unprompted | `assignedTo` | **AVAILABLE NOW** | — |
| **ACCOUNTABLE / OWNED / APPROVAL** | none modelled | — | — | **MISSING** | MODEL |
| **ESCALATION** | *"Assigned to Dwayne Holbrook. Ask an admin or dispatcher to reassign."* | on demand, at the refusal | assignee name + who may reassign | **MISSING** — `S04-A04`: *"CURRENT RISK: a raw permission error that does not name the assignee or the escalation"* | MODEL |
| **EXPLAIN** | *"Acquisition is not receiving. It creates no purchase history and no supplier order."* | on demand | the semantic distinction | **MISSING** — `S29-A01`: *"The acquire form must not be reachable over an authority nobody holds without saying so first"* | ENGINEERING |
| **RECOMMEND** | 3 `AI_ASSIST_NARROW` of 8, **0 `AI_MATERIAL`** | on demand | — | **AVAILABLE NOW** | — |
| **WARN** | that a mixed-company purchase order must be refused or split — **and which** | unprompted, pre-commit | Ruling R-4's resolution | **MISSING** — `P3B3-MGMT-023` is an open Owner question: *"Which is it — refuse at entry, or split into two orders — and where is that enforced?"* → **OD-EMP-008** | — |

### 7.16 Operations Manager — 43 activities (INV 17 + SAL 26) · `operationsManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | per-location, per-company on-hand from **the server's single `MOVEMENT_SIGN` rule**; a daily exception list | unprompted | one server rule; an exception projection | **MISSING** — `S22-A09`; `S08-A10`: *"CURRENT: no such surface, and no join key. Mark MISSING_CAPABILITY."* | ENGINEERING + MODEL |
| **SEARCH** | a day's movements at a location, each with type, sign, source object and actor | on demand | a location-filtered movement read | **MISSING** — `S31-A06`: *"the client's analytics derivation has no location filter at all and no `RETURNED` / `SCRAPPED` / `RELOCATION` / `WORK_ORDER_CONSUMPTION`"* | ENGINEERING |
| **ATTENTION** | operational exceptions across both companies | unprompted | — | **MISSING** | MODEL |
| **ASSIGNED / ACCOUNTABLE / OWNED** | none modelled | — | — | **MISSING** | MODEL |
| **APPROVAL** | nothing queued for him | — | — | **MISSING** | MODEL |
| **ESCALATION** | who owns a stuck request | on demand | assignee + reassignment authority | **PARTIAL** | MODEL |
| **EXPLAIN** | **a legible chronology — who did what, when, in business words** | on demand | one audit projection | **MISSING** — `S04-A10`: *"CURRENT: the document carries `reviewedBy/reviewedAt`, `assignedBy/assignedAt`, `purchasingStartedBy/purchasingStartedAt` and `lastPurchasingUpdateBy/lastPurchasingUpdateAt`"* — four field pairs, no chronology. Compounded by p3a1: the Activity rail is *"Derived from the loaded work-order snapshot — **not an audit log**"* while a real `auditEvents` authority exists | ENGINEERING |
| **RECOMMEND** | 2 `AI_ASSIST_NARROW` + 4 `AI_MATERIAL` of 17 (INV) | on demand | — | **AVAILABLE NOW** | — |
| **WARN** | before taking a location `INACTIVE`, **what that means for stock already sitting there** | unprompted, pre-commit | stock at the location | **MISSING** — `S18-A02`: the activity *"FAILS if a status toggle renders anywhere and does nothing, and equally fails if the consequences of going INACTIVE are not stated before the flip"* | MODEL |

### 7.17 Controller — 51 activities (INV 19 + SAL 30, of which **14 BLOCKED** and 9 PARTIAL) · `controller` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the money position, and **every published figure stating its as-of instant, timezone, operating company, derivation, costing method, and what it excludes** | unprompted | all six provenance facts | **MISSING** — `S32-A10`: *"CURRENT: no surface produces one."* `S32-A07`: *"every month-end figure states the timezone and the window it covers"*; the reporting calendar is configuration on the operating company and `reportingPeriod.ts` resolves it, but nothing states it | AUTHORITY |
| **SEARCH** | an invoice, a payment, a period's detail | on demand | finance reads | **MISSING** — every `finance.*` id is `active: false`; only `finance.visibility.consolidated` resolves anywhere, and only in `platform-sandbox` | AUTHORITY |
| **ATTENTION** | in-transit value per company, itemised and aged; unreconciled positions | unprompted | in-transit view | **MISSING** — `S25-A10`: *"the only availability figure is company-blind, location-blind, and omits five of nine operational movement types"*; `S24-A05` | ENGINEERING + AUTHORITY |
| **ASSIGNED / ACCOUNTABLE / OWNED** | none modelled; financial families are **IMMUTABLE** in the ownership matrix | — | — | **MISSING by design for OWNED** | MODEL |
| **APPROVAL** | credits, write-offs and refunds above a threshold | unprompted | the threshold values | **MISSING** — `financialApprovals.ts` is **built with no policy values to enforce**, which is why two financial surfaces ship with their write actions disabled → **OD-EMP-009** | — |
| **ESCALATION** | who is the second approver above each threshold | on demand | the policy | **MISSING** — same | AUTHORITY |
| **EXPLAIN** | **one view of why something was refused, cancelled, voided or rejected** | on demand | one reason store | **MISSING** — `S07-A10`: *"cancellation reasons live on `reorder_requests`, void reasons live on BOTH `reorder_requests` and a separate `reorder_purchase_order_voids` collection, and rejection reasons live in `reviewNotes` — three different places"* | — |
| **RECOMMEND** | 11 `AI_MATERIAL` of 19 (INV) — **58%, the highest material-AI share of any role.** Reconciliation, variance narration, exception triage | on demand | — | **PARTIAL** — the surfaces AI would summarise do not exist (`S08-A08`: reconciliation *"blocked on Firebase Blaze (issue #15)"*) | AUTHORITY |
| **WARN** | that a valuation **shows UNKNOWN and the offending lots, and refuses to render a dollar figure**; that `REOPEN` is deliberately not modelled, so a close cannot be quietly reopened; that a consolidated figure is an **unelimated sum** | unprompted, pre-commit | unpriced lots; period model; elimination boundary | **PARTIAL** — the rules are written (`S32-A04`: *"A partial total with a footnote is the failure mode — somebody will export the total"*; `S32-A01`; `P3B3-FIN-055`) and the surfaces do not exist | AUTHORITY |

> **Provenance note for 7.18–7.27.** These ten roles appear only in the P3-B3 corpus, whose schema carries **no
> `help_*` field, no `ai_*` field, no coverage tag, no device context and no friction score** (§7.0(b)). Their
> information requirements are therefore **inferred from `narrative`, `trigger`, `authority_path` and `status`**, not
> authored as information needs. They are the weakest-evidenced rows in this document, and the absence of an authored
> help/AI classification for sales, CRM, finance and administration is itself a **MISSING INPUT** (§12, MI-4).
> P3-B3 is also the only lane with **executed** rows (22 PASS / 20 FAIL), so its *authority* claims are the strongest.

### 7.18 Administrator — 110 activities (INV 27 + SAL 83; 14 `EXECUTED_PASS`, 4 `EXECUTED_FAIL`) · `admin` compatibility Role, holding **all 147 capabilities** by construction

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the access picture: per Role, per capability, **three cell states not two** — granted / not granted / **em-dash "no capability governs this object/verb at all"**, with inert objects marked "· inert" | unprompted | the catalog, the Role, and the `rulesOnly` classification | **PARTIAL** — the three-state grid is designed (p3a3); but **the policy seed drops `rulesOnly`**, so *"inside the tenant policy store, a Rules-governed object is indistinguishable from an unmodelled one. An administrator looking at Contacts sees the same emptiness they would see for Marketing Initiatives… The store cannot tell them apart, and neither can the person using it."* | MODEL |
| **SEARCH** | a user, a Role, an assignment, an audit event | on demand | read paths | **MISSING for two of four** — Permission Preview and Audit Logs render `AdministrationUnavailable`: deny-all collections, no deployed read path. **"An administrator cannot see who did what."** Also **Employees has no capability row in any of the four permission tables** — *"the most fundamental record in an access-control system is the one Administration cannot describe"* | AUTHORITY |
| **ATTENTION** | Role edits that changed nothing; capabilities registered but inactive; **controls gated on capabilities the client never requests** | unprompted | catalog `active` + the request set | **MISSING** — this is §6.3, and the guard that would catch it is a tautology (`navCapabilityConvergence.test.mjs:147-151` asserts `GOVERNED_SURFACE_CAPABILITY_IDS ⊆ REPORT_CAPABILITY_REQUEST`, where the latter is **defined by spreading the former** — *"The subset relation is true by construction; the test can never fail."*) | ENGINEERING |
| **ASSIGNED** | nothing assigned to an administrator | n/a | — | **NOT APPLICABLE** | — |
| **ACCOUNTABLE** | he answers for access correctness | unprompted | — | **MISSING** | MODEL |
| **OWNED** | the Role definitions | unprompted | definition vs assignment split | **AVAILABLE NOW** as an engine invariant — defining a Role is administrator-only; assigning one is open to owner / general manager / administrator (`P3B3-ADMIN-058`) | — |
| **APPROVAL** | privileged-role elevation requests | unprompted | the approval path | **PARTIAL** — the Firebase path requires a distinct second approver; the Postgres path accepts owner/GM/admin alone and *"the design note records that this supersedes the earlier two-person route"*. An **MFA seam is recorded and not implemented** (`accessCommandCallables.ts:272-277`) → **OD-EMP-010** | — |
| **ESCALATION** | what only the Owner can decide (activation, thresholds, authority-of-record) | on demand | the Owner-decision register | **PARTIAL** — 106 owner questions are registered in `eos-workflow-registry.json`; nothing surfaces them to an administrator | WORKFLOW |
| **EXPLAIN** | **the one thing this lane needs most**: for any principal and any act, the full trace — Role → Capability (+`active`) → Assignment (+`accessVersionAtGrant`) → Policy store → Operating Company | on demand | all five hops | **MISSING** — §6.2: two hops MISSING, two PARTIAL. `/administration/roles-permissions` is classified **AUTHORITY GAP**. And **five source comments in `functions/src/index.ts` (`:396, :405, :492, :515, :519`) plus one in `firestore.rules` assert capabilities are "granted to nobody" when they are granted to admin and owner** via the catalog spread at `compatibilityRoles.ts:235-240` — an administrator who reads the code is misinformed | MODEL — **OD-EMP-001** |
| **RECOMMEND** | 1 `AI_ASSIST_NARROW` + 1 `AI_MATERIAL` of 27 (INV), against 13 `AI_NOISE` and **10 `AI_NOT_APPLICABLE`** | on demand | — | **AVAILABLE NOW** as a rule: AI is nearly silent in administration | — |
| **WARN** | *"These capabilities are registered but not active in this release. Granting them has no effect."*; *"This capability is defined in source as inactive. Activating it is a release change, not a configuration change."*; that **activating any capability immediately grants it to every administrator and owner** | unprompted, pre-commit | catalog `active`; the `ADMIN_ALL_PERMISSIONS` spread | **MISSING** — `S22-A06`, `S22-A07`, `P3B3-ADV-014`. The last is the sharpest: the code's own comment at `compatibilityRoles.ts:232-234` **anticipates an exclusion list that does not exist** | MODEL — **OD-EMP-012** |

### 7.19 Sales Manager — 52 activities (SAL; 11 BLOCKED, 12 PARTIAL, 6 `EXECUTED_FAIL`) · `salesManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the team's pipeline, **scoped to the team** | unprompted | team membership + viewer scope | **MISSING** — p3a3: *"Opportunity list has no viewer scoping. Every row is visible regardless of owner."* And Taylor and Ventana opportunities appear in **one undimensioned list**. Team membership has no authoritative source (M-6) → **OD-EMP-013** | — |
| **SEARCH** | every open opportunity on one account before a QBR | on demand | an account-scoped projection | **AVAILABLE NOW** — `P3B3-SALES-007`: client-direct reads are denied, so *"the account page composes a trusted server projection instead. The projection is the only read path that exists"* | — |
| **ATTENTION** | stalled orders; agreements aging in DRAFT | unprompted | stage-entry times | **MISSING** — `ND-8`: a Sales Order does **not** record the time it entered each lifecycle stage, so *"order cycle time cannot be measured from the record at all"* | MODEL |
| **ASSIGNED** | nothing is assigned **to** a sales manager | n/a | — | **NOT APPLICABLE** | — |
| **ACCOUNTABLE** | her team's number | unprompted | — | **MISSING** | MODEL |
| **OWNED** | accounts owned by her team; **contacts and locations inherit the account owner** | unprompted | the ownership matrix + the handoff command | **PARTIAL** — the matrix declares inheritance via `accountId` (*"a real relationship rather than a proxy"*) and HANDOFF transfer behaviour; **the handoff command has no `onCall` export, so it has no caller** | WORKFLOW |
| **APPROVAL** | agreements above a value threshold | unprompted | a threshold model | **MISSING** — `governedBusinessRoles.ts:388-394` records the absence as a **deliberate governance gap**; today a Salesperson can bind the same terms as a General Manager → **OD-EMP-014** | — |
| **ESCALATION** | who allocates a booked order | on demand | capability holders | **MISSING** — `P3B3-ADV-015`: *"The role that books an order cannot move it and the role that can move it never sees it"* — `salesOrder.fulfill` / `.service` are held only by `admin`/`dispatcher`/`owner`; **no governed business role holds either** | — |
| **EXPLAIN** | that a saved report shows **the runner** what the runner may see, never what the author could | on demand | run-time re-resolution | **AVAILABLE NOW** — `P3B3-MGMT-005`: *"Every object capability, every field capability and every relationship traversal is re-resolved at run time against a fresh read of the runner's own access version"* | — |
| **RECOMMEND** | not classified in P3-B3 | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | before booking: that an opportunity's operating company is **accepted with no enforcement of any kind** | unprompted, pre-commit | company on the opportunity | **MISSING** — `P3B3-SALES-051` / `ADV-027`: the field is optional everywhere, omission yields null, *"and there is no enforcement of any kind… none may be added until the census gate passes"* → **OD-EMP-004** | — |

### 7.20 Salesperson — 43 activities (SAL; 4 `EXECUTED_FAIL`) · `salesperson` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | **his own** opportunities, agreements and orders, with `expectedValue` **carrying a currency** | unprompted | viewer scope; a governed currency | **MISSING on both** — no viewer scoping (7.19); p3a3 `G5`: `expectedValue` renders as *"a bare number with no currency symbol — no governed currency"* | MODEL |
| **SEARCH** | what this account last paid for this part | on demand | a price-history read | **MISSING** — `P3B3-SALES-042` is `NOT_SUPPORTED`: *"Invoice lines exist, but there is no read path that answers 'what did this account last pay for this part'"* → **OD-EMP-015** | — |
| **ATTENTION** | his own agreements aging in DRAFT; accounts without an owner (which **block opportunity creation by design**) | unprompted | owner presence | **MISSING** — `P3B3-CRM-030`: *"`report.customer.field.accountOwner.read` is inactive in every environment, so no report can list them"* → **OD-EMP-016** | — |
| **ASSIGNED** | nothing assigned to a salesperson | n/a | — | **NOT APPLICABLE** | — |
| **ACCOUNTABLE** | the deals credited to him | unprompted | `creditedSalespersonId` | **PARTIAL** — attribution **is** snapshotted onto the financial record at issuance *"so a later reassignment of the account cannot rewrite who earned last quarter's revenue"* (`P3B3-FIN-053`) — but the surface that would show it (page 15) is unbuilt | — |
| **OWNED** | accounts he owns; contacts and locations that inherit from them | unprompted | ownership matrix | **PARTIAL** — and `P3B3-CRM-025`: contacts and locations *"stay ownerless until the upstream account is owned. Ownership propagates down, never sideways"* | WORKFLOW |
| **APPROVAL** | none — and that is itself the finding | n/a | a threshold model | **MISSING** (7.19 APPROVAL) | MODEL |
| **ESCALATION** | who may bind terms he may not | on demand | threshold + holders | **MISSING** | MODEL |
| **EXPLAIN** | why he can see no financial fact at all; why a service-history read returns nothing | on demand | the reach model; wave state | **MISSING** — `P3B3-FIN-021`: in `platform-sandbox`, *"`finance.visibility.consolidated` is activated but `.self`, `.team`, `.businessUnit` and `.company` are not. The practical effect is that a Salesperson and a Sales Manager can see NO financial fact at all."* `P3B3-CRM-046`: service history *"is a wave-2 object with no fields populated — so it is declared and not yet readable"* → **OD-EMP-017** | — |
| **RECOMMEND** | not classified in P3-B3 | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | that an order builder **fails closed** on a missing quantity rather than defaulting to one; that acceptance proves exactly three things and **never** "signed", "binding" or "the customer accepted" | unprompted | the forbidden vocabulary | **AVAILABLE NOW** — `P3B3-SALES-024`; p3a3 `SA-D7` names the forbidden words explicitly | — |

### 7.21 Accounting Manager — 36 activities (SAL; 14 PARTIAL, 6 BLOCKED, 5 `NOT_SUPPORTED`) · `accountingManager` governed Role — **holds all five `finance.*`**

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the AR position; the billing queue; **days overdue** | unprompted | the finance read projection | **PARTIAL** — *"Days overdue is factual and available in the projection"*, but **aging buckets exist in code under a recorded deployment policy of not shipping them**, and the projection is reachable only through the account-scoped AR read → **OD-EMP-018** | — |
| **SEARCH** | an invoice; a customer's total exposure | on demand | a statement read | **MISSING** — `P3B3-FIN-013` is `NOT_SUPPORTED`: *"No statement object, no dunning, no reminder. Grepping for both terms across the repository returns nothing."* | — |
| **ATTENTION** | invoices open past terms | unprompted | due date derived from terms | **MISSING** — `P3B3-FIN-011`: *"the invoice due date is carried at issuance and the Account's terms enum is never translated into one"* → **OD-EMP-019** | — |
| **ASSIGNED / ACCOUNTABLE / OWNED** | none modelled; financial families are IMMUTABLE for ownership | — | — | **MISSING** | MODEL |
| **APPROVAL** | credits and adjustments above a threshold | unprompted | the threshold | **MISSING** (as 7.17) | AUTHORITY |
| **ESCALATION** | who voids an invoice issued against the wrong customer | on demand | a void command | **MISSING** — `P3B3-FIN-004`: *"the columns and the AR VOID position exist but no command sets them"* → **OD-EMP-020** | — |
| **EXPLAIN** | why an overpayment **cannot be recorded at all**; why a deposit has no home; why she can see the billing queue and not issue from it | on demand | the command's own constraint, in words | **PARTIAL** — the reasons are precise in code (`paymentCommands.ts:129-130` rejects over-application because unapplied cash is unsupported; `FinancialsBillingQueue.jsx:50`: *"the invoice command core exists, but this page has no governed command path wired to it"*) and must be said on the surface | ENGINEERING |
| **RECOMMEND** | not classified in P3-B3 | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | that an invoice **cannot be voided once issued**, before issuing it | unprompted, pre-commit | terminality | **MISSING** — and `P3B3-ADV-019`: `issueInvoice` *"does not read the governed Sales Order, so it cannot see a cancellation"* — an invoice can issue for an order cancelled an hour earlier | MODEL |

### 7.22 Office Manager — 18 activities (SAL; 3 `NOT_SUPPORTED`) · `officeManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the customer record with its contacts, locations and equipment | unprompted | — | **PARTIAL** — `P3B3-CRM-053`: **there is no Contacts list in the navigation.** *"The Contacts, Locations, Equipment and Service History subnav entries were removed; contacts and locations are now reachable only from inside an account record."* The retired URLs redirect rather than 404 | — |
| **SEARCH** | a contact across accounts | on demand | a global contact index | **MISSING** — no global Contacts index exists | AUTHORITY |
| **ATTENTION** | duplicate accounts; ownerless imported accounts | unprompted | duplicate detection | **MISSING** — `P3B3-CRM-027`: *"no merge command, no delete, and the Duplicate Rules surface is a static display with every control disabled"* → **OD-EMP-021** | — |
| **ASSIGNED / ACCOUNTABLE / APPROVAL / ESCALATION** | none modelled | — | — | **MISSING** | MODEL |
| **OWNED** | accounts she administers | unprompted | ownership matrix | **PARTIAL** | WORKFLOW |
| **EXPLAIN** | **what the correcting act is** when a record was created in error — and that physical delete is refused everywhere | on demand | the correcting act, per family | **MISSING** — `P3B3-CRM-005`, `CRM-023` (*"Delete is refused. The record stays and the business has no governed way to mark it inactive either — there is no status field in the contact contract"*), `CRM-043`, `CRM-033` → **OD-EMP-022** | — |
| **RECOMMEND** | not classified | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | that a bulk contact import **writes straight from the browser with no server-side validation, no audit event and no capability check beyond the Rules role gate** | unprompted, pre-commit | the import path | **MISSING** — `P3B3-CRM-020`: *"the largest client-direct write in CRM"* → **OD-EMP-023** | — |

### 7.23 General Manager — 14 activities (SAL; 3 BLOCKED, 3 `NOT_SUPPORTED`, 1 `EXECUTED_FAIL`) · `generalManager` governed Role · **0 of 9 workflows finishable** (EMP-WORK)

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | one business unit's numbers **without seeing the rest** | unprompted | a business-unit reach | **MISSING — EXECUTED FAIL.** `P3B3-FIN-023`: *"Business-unit and company reach are catalogued and held only by the catch-all admin and owner roles — no governed business role declares either. Both are also inactive in every environment. **A scoped financial view below consolidated is not reachable by anyone.**"* Compounded by M-5 (Employee `companyId` is always `null`) → **OD-EMP-024** | — |
| **SEARCH** | a ready-made report in his domain | on demand | report definitions | **MISSING** — `P3B3-MGMT-010`: eight reporting domain sections are nav-hidden placeholders, *"a promise of where reports will live rather than a claim that they exist"* — which is the **correct** honest rendering | — |
| **ATTENTION** | exceptions in his unit | unprompted | unit scope | **MISSING** | MODEL |
| **ASSIGNED / ACCOUNTABLE** | none modelled | — | — | **MISSING** | MODEL |
| **OWNED** | the records handed to him in a territory reshuffle | unprompted | the handoff command | **PARTIAL** — *"An explicit auditable handoff command exists per ruling D-5… What does not exist is an `onCall` export, so the command has no caller"* | WORKFLOW |
| **APPROVAL** | goals drafted by his managers | unprompted | `performance.goal.approve` | **MISSING** — all five `performance.goal.*` are `active: false` | — |
| **ESCALATION** | what needs the Owner | on demand | — | **PARTIAL** | WORKFLOW |
| **EXPLAIN** | that **defining a Role is administrator-only while assigning one is open to him** — an engine invariant, not configurable policy | on demand | the split | **AVAILABLE NOW** (`P3B3-ADMIN-058`) | — |
| **RECOMMEND** | not classified | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | that gross margin on a completed job **must display as unknown and never as 0%** | unprompted | the cost authority's absence | **AVAILABLE NOW as a rule** (`F12` binding rule 3), **MISSING as data** (`FIN-BLOCK-003`) → **OD-EMP-006** | — |

### 7.24 Owner — 10 activities (SAL; 2 `EXECUTED_PASS`, 1 `EXECUTED_FAIL`, 3 BLOCKED) · `owner` governed Role, privileged

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the whole business on one dashboard — **composed from independently gated reads that degrade tile by tile, never all at once** | unprompted | per-tile gating | **AVAILABLE NOW as a shape** — `P3B3-MGMT-012`: *"There is no server-side dashboard service, so each tile can be denied on its own and the page degrades tile by tile"*; with S-2, that is the right behaviour | — |
| **SEARCH** | any record, any period | on demand | — | **PARTIAL** | AUTHORITY |
| **ATTENTION** | what is blocked on an Owner decision | unprompted | the Owner-decision register | **MISSING as a surface** — 106 owner questions exist in `eos-workflow-registry.json`; nothing surfaces them → **OD-EMP-025** | — |
| **ASSIGNED / ACCOUNTABLE / OWNED / APPROVAL / ESCALATION** | the Owner is the terminal escalation; nothing escalates **from** him | — | — | **NOT APPLICABLE** | — |
| **EXPLAIN** | **how much of EOS is actually reachable in production today** — and this is the one EXECUTED_PASS answer in the corpus | on demand | the resolver, run against the production set | **AVAILABLE NOW as a measurement, MISSING as a surface** — `P3B3-MGMT-046` (EXECUTED_PASS): 37 of 147 resolve ALLOW in production; the rest *"are built, granted and inert"*. `P3B3-MGMT-050` (EXECUTED_PASS): *"ninety-two ids are already proven activatable in the sandbox, production activates none, and seventeen capabilities are activated nowhere at all"* | — |
| **RECOMMEND** | what to activate next — **a bounded, legible decision**, which is exactly what a recommendation may legitimately be | on demand | the 17-id list and its dependencies | **AVAILABLE NOW** (`P3B3-MGMT-050`) | — |
| **WARN** | that a consolidated figure across both companies is an **unelimated sum**, typed as one so nobody reads it as a consolidation | unprompted | the elimination boundary | **AVAILABLE NOW as a rule** — `P3B3-FIN-055`: *"Elimination is explicitly outside EOS and belongs to an external authority"* | — |
| **(the standing finding)** | `P3B3-ADV-040` (**EXECUTED_FAIL**): *"The order-to-cash spine is complete… all written, all capability-gated, all fail-closed and all deployed. Every one of their capabilities is registered inactive, production activates none."* | — | — | — | → **OD-EMP-026** |

### 7.25 Field Manager — 9 activities (SAL; 7 `IMPLEMENTED_UNEXECUTED`) · `fieldManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | fulfilment progress across work orders against one sales order | unprompted | additive write-back state | **AVAILABLE NOW** — `P3B3-SALES-032`: *"The write-back is additive and serialises on the shared order document, so two work orders completing against one order accumulate rather than race"* | — |
| **SEARCH** | machines by customer, **traversing the relationship** | on demand | traversal capability | **PARTIAL** — `P3B3-MGMT-007`: *"A traversal is its own gate… resolved at run time alongside the object and field capabilities — so reading across a relationship is never a side effect of reading either end"* — correct design, inactive family | — |
| **ATTENTION** | overage declarations refused | unprompted | the failed transaction | **PARTIAL** — `P3B3-SALES-033`: *"The pure write-back throws rather than clamping. There is no placeholder overage array"* — the refusal is right; **the reader is not told** | ENGINEERING |
| **ASSIGNED** | the visits his people hold | unprompted | `assignedTechId` | **AVAILABLE NOW** | — |
| **ACCOUNTABLE / OWNED / APPROVAL / ESCALATION** | none modelled | — | — | **MISSING** | MODEL |
| **EXPLAIN** | that PART lines take fulfilled quantity from the **governed inventory snapshot**, while equipment and service lines need an **explicit technician declaration** — and that explicit acceptance overrides the derived value | on demand | the two derivations | **AVAILABLE NOW as a fact** (`P3B3-SALES-031`), **MISSING as a sentence** | ENGINEERING |
| **RECOMMEND** | not classified | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | that a duplicate part on two order lines credits by **line id**, not by (ref, kind) — and that the shipped code and the spec **no longer agree** | unprompted | the matching rule actually in force | **MISSING** — `P3B3-ADV-031` (PARTIAL): `docs/design/p1-fulfillment-billing-spine-spec.md:29` specifies (ref, kind); `salesOrderFulfillmentWriteBack.ts:7-15` has moved to lineId-primary → **OD-EMP-027** | — |

### 7.26 Marketing Manager — 2 activities (SAL; **both BLOCKED**) · `marketingManager` governed Role

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | nothing is reachable. Both of this role's corpus activities are BLOCKED | — | — | **MISSING** | AUTHORITY |
| **SEARCH** | a contact's phone number from the reporting surface | on demand | contact field capabilities | **MISSING** — `P3B3-CRM-022`: *"Contact name, email, phone, role and parent customer are each independently gated report fields. Every one of them is registered inactive."* **Note the tension with B-2:** three contact field ids **are** in the 25-id `productionCapabilityActivations` set (`report.contact.field.name/role/customer.read`) — **phone and email are not.** So the blocked half is real and the corpus's "every one" is too broad at this baseline → **U-7** | — |
| **ATTENTION / ASSIGNED / ACCOUNTABLE / OWNED / APPROVAL / ESCALATION** | none modelled | — | — | **MISSING** | MODEL |
| **EXPLAIN** | who covers this account before routing a lead | on demand | coverage resolution | **MISSING** — `P3B3-SALES-045`: the coverage read exists and is capability-gated, and **both coverage ids are among the 17 activated nowhere** | — |
| **RECOMMEND** | not classified | — | — | **UNKNOWN — REVERIFY** | — |
| **WARN** | — | — | — | **MISSING INPUT** — no corpus row | — |

### 7.27 Report Viewer — 1 activity (SAL; **`EXECUTED_PASS`**) · `reportViewer` governed Role — and the **only role below owner/admin with a production-activated capability set** (23 of the 25, EXECUTED)

| DIM | REQUIREMENT | MODE | WHAT EOS MUST KNOW | KNOWABLE | GAP |
|---|---|---|---|---|---|
| **SHOW** | the four reportable objects and **only the fields he may read** — a field he may not read is **absent from the response payload, not blanked and not returned-then-hidden** | unprompted | per-field capability resolution | **AVAILABLE NOW for the mechanism** (p3a3), **BROKEN for rows**: the authorization target is hardcoded `{ scope: { type: "global" }, condition: {} }` over `db.collection(...).limit(maxScanDocs + 1).get()` with **no `where()` of any kind**, so *"a runner holding the object capability sees every row of the collection"* — and `firestore.indexes.json` contains **zero** occurrences of `operatingCompanyId` | ENGINEERING — **the most urgent single fix in this lane** |
| **SEARCH** | build a report; filter and group | on demand | operators per field | **AVAILABLE NOW** — 45 fields across 4 objects, each with declared operators | — |
| **ATTENTION** | that a report **refused** rather than returned a wrong total | unprompted | scan completeness | **MISSING AT THIS BASELINE** — B-8: the false sentence *"Running reports isn't available yet. Nothing was read or changed."* is live at `reportRunOutcome.js:27` | — |
| **ASSIGNED / ACCOUNTABLE / APPROVAL / ESCALATION** | none | — | — | **NOT APPLICABLE** | — |
| **OWNED** | his own saved definitions | unprompted | `ownerUid` | **AVAILABLE NOW** — `report.definition.read` **is already row-scoped per-owner**: `listSavedDefinitions` issues `.where("ownerUid","==",actorUid)`. This is the one correctly row-scoped read in reporting | — |
| **EXPLAIN** | **which columns were dropped and why**; that a filter on an unreadable field was **dropped, never applied**, and that **the widening is surfaced, not silent**; that traversal is its own gate resolved on arrival | on demand | the resolution result, per field and per hop | **AVAILABLE NOW as a design** (p3a3), and it is the correct answer to E-5 | — |
| **RECOMMEND** | nothing; a report viewer needs no proposal | — | — | **AVAILABLE NOW** | — |
| **WARN** | that a report **cannot be exported at all** — `report.export` does not exist anywhere in the app | unprompted | the absence | **MISSING as a sentence** — p3a3: *"A governed report you cannot get out of the building is a report you looked at"* → **OD-EMP-028** | — |

---

## 8. EVERY NUMBER, AND WHAT CLICKING IT MUST REVEAL

**The rule.** A figure a person cannot act on, or cannot trace to its records, is a defect not a feature. So every number
this lane requires is listed here with (a) its drill-through target, (b) the predicate that drill-through must carry, and
(c) whether it can be produced at `64008d5a`. **A number with no row here must not ship.**

**The drill-through contract, in four parts:**
1. **The drill-through population must equal the number.** Not a superset. `accountHealthStrip.js`'s
   `href: count > 0 ? "/service/work-orders" : null` fails this — it drills from "open Work Orders for **this account**"
   to the unfiltered Work Orders list (M-4).
2. **The predicate travels in the URL**, so the reader can see and edit the scope they landed in.
3. **A number that cannot be drilled must not be rendered as a number** — it is `UNKNOWN`, with no number slot (S-7).
4. **A number whose population was bounded and not exhausted is not a total** (S-5, B-8).

| # | Number | Whose | Drill-through must reveal | Producible at `64008d5a`? | Gap |
|---|---|---|---|---|---|
| N-01 | **On-hand at a location** | Parts Manager, ICA, Field Tech, Satellite Attendant | the movement list behind it, filtered to that location and company, each row with type, sign, source object and actor | **MISSING** — the client derivation is location-blind, company-blind, adds catalog `warehouseQty` to ledger movement, and omits 5 of 9 movement types (`S26-A10`, `S31-A06`) | ENGINEERING |
| N-02 | **Available (on-hand minus commitment)** | Parts Manager | the open commitments netted out, itemised | **MISSING** — `S01-A10`; and `S23-A09`: no `WORK_ORDER_CONSUMPTION` term, so *"consumed stock never leaves on-hand"* | ENGINEERING |
| N-03 | **In-transit quantity and value, per company** | Controller, Branch Parts Coordinator | each open transfer, itemised and aged, with dispatching and receiving company | **MISSING** — `S24-A05`, `S25-A10` | ENGINEERING |
| N-04 | **Queued-scan count (offline badge)** | Scanner Operator | the queued lines, distinguishable from committed ones | **MISSING** — `S21-A01`: committed and queued lines render identically | ENGINEERING |
| N-05 | **"11 of 14 received"** | Receiving Lead | the three outstanding lines, opened on the first | **MISSING** — `S20-A07` | ENGINEERING |
| N-06 | **Counted vs expected, and the variance** | Satellite Attendant, ICA | the count lines, and the statement that on-hand is unchanged until reviewed | **MISSING** — `S21-A09`, `S25-A03` | MODEL |
| N-07 | **Awaiting dispatch / In progress / Technicians on shift / Completed this week** | Dispatcher, Service Manager | the Work Orders in each bucket, "every number linked and carrying an exception count" (p3a1) | **PARTIAL and one is WRONG** — `SO-N7`: "Technicians on shift" is computed over `technicians.length` and **includes `OFF_SHIFT`**; `SO-D4`: **no windowed "completed this week" read exists anywhere in Service**, so the label was honestly downgraded to "Completed" | ENGINEERING |
| N-08 | **Per-lane % booked, and fleet % booked** | Dispatcher | the blocked-time records and the shift that form the denominator | **PARTIAL and one is WRONG** — `§4.1`: `blockedMinutesInBand` SUMs clipped durations while `availabilityModel` UNIONs minutes, so two identical 8-hour PTO records draw **sixteen hours blocked on an eight-hour lane**. Fleet % renders only when every technician has a recorded schedule — "in practice means never" | ENGINEERING |
| N-09 | **At-risk count** | Dispatcher, Service Manager | the at-risk rows with severity, age and **why** | **PARTIAL** — `SO-G7` drops records whose `createdAt` is unusable, so the count understates and the implemented "age unknown" row is **unreachable** (A-6) | ENGINEERING |
| N-10 | **Average job duration** | Service Manager, Field Tech | the jobs averaged, and those excluded for a missing or inverted timestamp, **counted so the shortfall is not silent** | **PARTIAL** — PR #1796 corrected "a negative Avg Job Duration presented as a performance fact"; the exclusion count is the remaining requirement | ENGINEERING |
| N-11 | **Completed all-time / parts used / average duration** (technician identity strip) | Field Technician | the work orders and consumptions behind each — **and it must not read as a scorecard** (p3a1) | **PARTIAL and one is mislabelled** — `PerformanceSnapshot.jsx`'s own header: *"'Parts used this week' isn't literally computable… Shows the real, honest all-time total instead of fabricating a weekly figure"*. **The component has no drill-through of any kind** (no `onClick`/`Link`) | ENGINEERING |
| N-12 | **Goal target and actual, attainment %** | Service Manager, Sales Manager, GM, Owner | the credited events behind the actual; the goal version behind the target | **MISSING** — all five `performance.goal.*` are `active: false`; `GoalTile.jsx` has **no drill-through** (M-3); page 15 specifies *"Person → credited events; manager rollups by scope"* and is **not authorized for implementation** | AUTHORITY + ENGINEERING |
| N-13 | **Open Work Orders (per account)** | Salesperson, Office Manager, Accounting Manager | the open Work Orders **for that account** | **PARTIAL** — real count via `getCountFromServer` on `fieldops_wos` by `customerId`; **drill-through loses the predicate** (M-4 defect) | ENGINEERING |
| N-14 | **Outstanding AR / Past due (per account)** | Accounting Manager, Controller, Salesperson | the outstanding invoice lines, per currency, **never summed across currencies**, with the company named in the label | **PARTIAL** — the view model is correct and multi-company/multi-currency-safe; the reach that would let anyone but an Accounting Manager see it is inactive | AUTHORITY |
| N-15 | **AR aging buckets** | Accounting Manager | the invoices in each bucket | **MISSING BY POLICY** — implemented at `financeReadProjection.ts:124, :143-145` under a recorded deployment policy of **"no aging buckets"**; and page 01 says "60+ days" while page 04 says "61+" — **one wording must win** → **OD-EMP-018** | — |
| N-16 | **Margin / gross margin per job or per person** | GM, Controller, Field Manager | the cost basis and the revenue basis, separately | **MISSING** — `FIN-BLOCK-003`; must render **UNKNOWN, never 0%** | AUTHORITY |
| N-17 | **Inventory valuation** | Controller | the lots priced, the lots unpriced, and the costing method (FIFO or weighted average per the effective policy profile) | **MISSING** — `S32-A03`: *"no surface produces one"*; `S32-A04` requires it to **refuse a dollar figure** and name the offending lots | AUTHORITY |
| N-18 | **Pipeline value / expected value** | Sales Manager, Salesperson | the opportunities summed, **with a currency** | **MISSING** — p3a3 `G5`: no governed currency, so `expectedValue` renders as a bare number; **pipeline value is on the DO-NOT-BUILD list (S-4)** until an authority exists | MODEL |
| N-19 | **Account counts on a list ("1,286 active of 1,412")** | all list readers | the rows counted, and the filter that produced the slice | **PARTIAL** — the three-state count rule is designed (`undefined` / `null` / number); `collectionPageState.js` which would enforce it has **zero consumers** (M-2) | ENGINEERING |
| N-20 | **Any report aggregate** | Report Viewer, Sales Manager, Operations Manager | the rows aggregated, and **a refusal instead of a number when the scan was not exhausted** | **BROKEN AT THIS BASELINE** — B-8: a bounded 20,000-document page + in-memory filters + a `rowCount === 0` → `"empty"` branch ahead of truncation. **"No records matched" can be false, and the audit records it as `outcome: "applied"`.** | ENGINEERING — **highest severity** |
| N-21 | **Parts count "1,412 parts · 1,286 active · 9 need attention"** | Parts Manager | the parts in each view chip | **PARTIAL** — the `On hand` column was **REJECTED** under `ND-25` (*truthful absence > false comfort*) because no availability authority exists; the counts themselves rest on a **whole-collection read (`P-G1`)** on every Parts surface | ENGINEERING |
| N-22 | **Days overdue** | Accounting Manager | the invoice and its due date derivation | **PARTIAL** — factual and available in the projection; the due date is **carried at issuance and never derived from the account's terms** | MODEL |
| N-23 | **Reorder recommended quantity** | Parts Manager | **what on-hand it was computed from and as of when** | **MISSING the provenance** — `S02-A01`: *"the number arrives with no provenance affordance"* | ENGINEERING |
| N-24 | **A company-scoped count over Accounts / Contacts / Locations / Equipment** | GM, Owner, Controller | the rows in that company | **MISSING — and this is the brief's own constraint, confirmed:** row scope is closed for **zero of four** objects. `customer`, `contact` and `location` are `COMPANY_NEUTRAL` in the ownership matrix; only `equipment` is `SINGLE_COMPANY`, and closing it needs **a catalog field + a capability + an activation decision** before a predicate has anything to bind to | ENGINEERING + AUTHORITY |
| N-25 | **Any dashboard rate (%)** | every manager | the numerator set and the denominator set, separately | **AVAILABLE NOW as a rule** (S-6: `sum(num)/sum(den)`), **MISSING as a drill** | ENGINEERING |

**Numbers this lane explicitly declines to require**, because the repository has already ruled them out and re-deriving
them would be a regression: AOV, pipeline value, first-time fix, SLA/response, callbacks, parts-delay impact, technician
utilisation, WO aging buckets, jobs-per-workday, stockout rate, inventory aging, inventory value/turns/carrying cost,
**waste avoided** (*"needs a prevention event, a cost basis, AND a stated counterfactual"*), emergency-purchase rate,
PO cycle time, supplier on-time, cross-domain activity roll-up, notification history.
Source: the DO-NOT-BUILD list in `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md`.

---

## 9. WHERE AI MAY SPEAK, AND WHERE IT MUST BE SILENT

**The rule from the program:** AI may summarize, explain, investigate, prioritize, draft, recommend. **AI is not business
authority and has no independent write path. It must be quiet or absent when it has nothing grounded to contribute.**

The corpus classified AI opportunity per activity for the 660 service+inventory rows. **It is overwhelmingly a mandate for
silence**, and that is the finding.

| Corpus classification | Count | Share of 660 | What it licenses |
|---|---|---|---|
| Service `NONE` + `NOISE` | 176 + 25 = **201** | 61% of the 330 service rows | **nothing.** "No AI role; judgement and physical presence carry the task"; "AI would be noise here; the task is already one deliberate act" |
| Inventory `AI_NOISE` + `AI_NOT_APPLICABLE` + `AI_UNSAFE_HERE` | 156 + 56 + 15 = **227** | 69% of the 330 inventory rows | **nothing — and 15 rows say actively harmful** |
| Service `SHORTEN` | 80 | 24% | compressing a multi-step act (62 PM Work Orders = **248 wizard steps**) — but **only where a bulk path exists, and none does** |
| Service `EXPLAIN` | 21 | 6% | *"AI's value is explaining a refusal or a state, not changing it"* — **the single best-grounded AI use in the corpus** |
| Service `CLASSIFY` | 16 | 5% | triage of inbound work; concentrated in Service Coordinator (10) and Dispatcher (6) |
| Service `DRAFT` | 12 | 4% | customer-facing text a human then approves |
| Inventory `AI_MATERIAL` | 54 | 16% | concentrated in Controller (11 of 19 = **58%**), ICA (9 of 34), Parts Manager (8), Parts Associate (8) |
| Inventory `AI_ASSIST_NARROW` | 49 | 15% | Parts Manager (13), Scanner Operator (8), ICA (6) |

**Where AI must be absent, per this lane:**
- **The scan-commit path.** Scanner Operator carries **5 of the 15 `AI_UNSAFE_HERE` rows** — the highest of any role.
- **Any refusal's disposition.** AI may *explain* a refusal (21 rows say so); it may never soften, retry or route around one.
- **Any number.** A figure AI produced is not a governed figure. AI may narrate a number that has an authority; it may not
  compute one. This follows directly from N-01…N-25: every number needs a drill-through to **records**, and AI has none.
- **Field Technician surfaces.** 82 of 104 service-technician rows are `NONE`. A technician on a roof is the reader least
  able to audit a generated sentence.
- **Administration.** 10 of 27 inventory-administrator rows are `AI_NOT_APPLICABLE` and 13 are `AI_NOISE`.

**Where AI legitimately earns its place:** explaining a refusal (E-1 through E-6 are the highest-value AI surface in EOS —
the explanation is exactly what the system knows and does not say); triaging inbound work for the Service Coordinator;
drafting a customer status sentence for approval; narrating a Controller's variance once a reconciliation surface exists.

**A hard consequence of §6:** AI cannot currently produce the denial explanation either, because **two of the five trace
hops are MISSING**. An AI that guessed at "why you cannot do this" would be inventing authority. **Until §6.2 is closed,
AI must say "I cannot determine why" rather than compose a plausible reason.** That is the quiet-or-absent rule applied
to the very requirement AI is best suited to serve.

---

## 10. REQUIREMENTS THAT SILENTLY ASSUME SOMEONE HOLDS A ROLE

**"Capacity is proven, occupancy is unknown."** Verified verbatim in two places:
`p2n-role-resolution/docs/architecture/governed-role-binding-analysis.md:298-300` — *"the numbers describe a system, not a
model — but they describe its capacity, not its occupancy. The wiring is real and carries current. Whether anyone is
standing at the other end of it is a question only live data answers."* And its §8 UNPROVEN item 1: *"Whether any
principal holds any of the 45 governed business Roles, in any environment… **The single most consequential open question
remaining.**"* Reading `roleAssignments` in a live project is the only way to answer it — **which this lane may not do.**

Compounding facts: **26 of the 45 governed Roles have no corpus activity** (EMP-ROLE). **Nine of the 27 observed roles
hold no security Role at all** (§4). **`roleAssignments` is the sole source of an ALLOW, read per request at 9+ sites.**

Every requirement below **renders a sentence naming a Role holder, and therefore silently assumes somebody occupies it.**
If nobody does, each one degrades from "helpful escalation" to **a dead end that names a ghost.**

| # | Requirement | The Role it assumes is occupied | What it renders if occupancy is zero |
|---|---|---|---|
| O-1 | *"if the coordinator lacks Cancel, the button should say who can do it"* (`S02-A06`) | `dispatcher` or `admin` | a button naming a role nobody holds |
| O-2 | *"A denial that names the role that can do it is worth more than the denial itself"* (`S02-A08`, `S08-A07`) | `dispatcher` / `admin` | the same |
| O-3 | *"Assigned to Dwayne Holbrook. Ask an admin or dispatcher to reassign."* (`S04-A04`) | `admin` or `dispatcher` | correct on the assignee, **a dead end on the escalation** |
| O-4 | *"ⓘ: who reviews reorder requests"* (`S03-A05`) | a reviewer Role | an empty answer to a direct question |
| O-5 | *"ⓘ: who can void, and what to do when nobody who can void is the assignee"* (`S06-A05`) | a void-holder | **this one already anticipates the empty case and is the right pattern** |
| O-6 | *"ⓘ: who can cancel"* (`S07-A04`) | a cancel-holder | a dead end |
| O-7 | *"Moving stock out of WH-PHX-MAIN requires warehouse authority you do not hold. Ask the parts desk."* (`S22-A01`) | a warehouse-authority holder **at that location** | worse than a dead end: **all four `inventory.transfer.*` are `active: false` and granted to no Role**, so the honest sentence is D-2, not D-1 |
| O-8 | *"a refusal that names the capability and says who can activate it"* (`S26-A02`) | the activation owner | activation is **a release, not a person** (E-2) — naming a person here is wrong |
| O-9 | *"the refusal names the rule, names who submitted the count, and names who can dispose of it"* (`S27-A05`) | a reconciler | `inventory.cycleCount.reconcile` is `active: false`; two Roles are **declared** carrying it |
| O-10 | *"ⓘ on the refusal: who does hold this authority at this location, right now"* (`S22-A01`) | any holder | requires occupancy **and** a location dimension on the Role |
| O-11 | *"a refusal naming the capability"* for asset acquisition (`S29-A01`) | `inventorySerializedAssetAcquirer` | both `inventory.serializedAsset.*` ids are `active: false` and granted to no Role |
| O-12 | *"the escalation names who can"* (`S07-A04`, `S06-A05`) | any holder | a dead end |
| O-13 | ESCALATION for Apprentice Technician, Satellite Attendant, After-Hours Coordinator (§7.2, 7.14, 7.7) | a manager | **M-7: "who manages this person" has two unreconciled answers**, so even with occupancy the answer is ambiguous |
| O-14 | *"Ask your administrator"* on an unlinked technician record (`P3B1-S09-A02`) | `admin` | this one is safe — `admin` is a seeded compatibility Role |
| O-15 | Any "who approves this" sentence (§7.8, 7.10, 7.17, 7.21, 7.23) | an approver | no approval queue exists at all (§7.0(a)) |

**The rule this lane sets.** A refusal sentence must be composed from **three resolved facts**, in this order, and must
degrade honestly when a fact is missing:
1. **Is the capability active?** If no → say D-2 (*"not active in this release; granting it has no effect"*) and **name no person**.
2. **Does any principal hold it?** If the occupancy read returns zero → say *"no one currently holds this authority"* —
   which is a **true, actionable** sentence — and never name a Role as though someone were in it.
3. **Who holds it?** Only then name them.

**Until the occupancy read exists, step 2 cannot be evaluated, so every "ask X" sentence in the corpus is `UNKNOWN — REVERIFY`.**
Nine of the 15 rows above would render a dead end today. → **OD-EMP-029**

---

## 11. OWNER DECISIONS — raised, not answered

These are the decisions this lane cannot make. Each is scoped to the **information** consequence, so the Owner is being
asked what EOS should *say*, not only what it should do.

| ID | Decision | Why this lane cannot decide it | Information consequence if unanswered |
|---|---|---|---|
| **OD-EMP-001** | **Ratify (or replace) the effective-permission trace.** The five-hop chain `Role → Capability → Assignment → Policy → Operating Company` **appears nowhere in the repository** (B-7). Is that the required trace, and which of the **three** authorities that currently answer "may this person do this" is the one an explanation must cite? | It is an unsourced synthesis, and `P3B3-ADV-039` records an Owner constraint about a third authority. | EOS cannot explain a denial at all. This is the lane's headline blocker. |
| **OD-EMP-002** | **Should EOS hold competence?** Certification, proficiency and skill are unmodelled. `P3B1-S17-A06` records an apprentice completing a job requiring an unheld certification, expected result **"Nothing warns."** | A competence model is a business policy decision, not a display decision. | The clearest WARN requirement in the corpus has no backing fact, for two roles. |
| **OD-EMP-003** | **Should EOS hold the customer promise?** The coordinator is accountable for a commitment that "lives outside EOS" (EMP-WORK, authored narrative). | It creates a new object. | The role with the highest search intensity (§7.4) is accountable for something EOS cannot show. |
| **OD-EMP-004** | **What is the "census gate"** that `commercialCompanyScope.ts:27` names as the precondition for enforcing the operating company on commercial records, **and what closes it?** | Named in code as a precondition with no owner. | Until it closes, the operating company on an Opportunity is accepted with **no enforcement of any kind**, and no commercial number can be honestly company-scoped. |
| **OD-EMP-005** | **How is a break-fix service visit with no Sales Order billed?** `FIN-BLOCK-002`; the billing queue is Sales-Order-anchored. | Crosses Service and Finance. | Service Billing Admin has **0 of 5 finishable workflows**; an attention model for the role would point at nothing. |
| **OD-EMP-006** | **Cost and margin authority** (`FIN-BLOCK-003`) — and the sub-question `FIN-PQ-15a`: **who may see margin by person?** | Design records the direction as APPROVED with repo ingest outstanding. | Margin must render UNKNOWN for GM, Controller and Field Manager. Page 15's `margin-by-person` stays an honest absence. |
| **OD-EMP-007** | **Should authority carry a time-of-day or on-call dimension?** `ACTION_PERMISSIONS` has none. | It changes the permission model's shape. | The After-Hours Coordinator's entire information model (§7.7) is MISSING. |
| **OD-EMP-008** | **Mixed-company purchase order: refuse at entry, or split?** Ruling R-4 requires one; neither is enforced. | Ruling R-4 is ambiguous on which. | A WARN with no resolution (§7.15). |
| **OD-EMP-009** | **Approval thresholds** for credits, write-offs and refunds, and the second approver above each. `financialApprovals.ts` is built with no policy values. | Owner policy values. | Two financial surfaces ship with write actions disabled; no "waiting on me" list can exist for Controller or Accounting Manager. |
| **OD-EMP-010** | **Should a second factor be required at the moment an administrator approves an elevation to a privileged role?** An MFA seam is recorded at `accessCommandCallables.ts:272-277` and not implemented. | Security policy. | The APPROVAL dimension for Administrator is PARTIAL and the two paths disagree. |
| **OD-EMP-011** | **Ratify the resolver's stale-access-version interpretation.** `resolveEffectivePermission.ts:131-142` records `accessVersionAtGrant <= currentAccessVersion` as its own reading, **noted for Owner review**. | Explicitly recorded as awaiting Owner review. | The **Assignment** hop of the trace (§6.2) cannot be cited with confidence. |
| **OD-EMP-012** | **Should capability activation and administrator grant be decoupled?** Activating any capability immediately grants it to every administrator and owner via the `ADMIN_ALL_PERMISSIONS` spread; the code anticipates an exclusion list at `compatibilityRoles.ts:232-234` that does not exist. | Internal control. | An administrator cannot be warned truthfully about what an activation will grant. |
| **OD-EMP-013** | **Is a salesperson supposed to see the whole firm's pipeline?** The Opportunity list has no viewer scoping while page 08 insists on "person rows only within viewer scope". | Two ratified artifacts disagree. | SHOW for Salesperson and Sales Manager cannot be specified. |
| **OD-EMP-014** | **Should Sales Agreement acceptance carry a value or discount threshold** above which a more senior principal must accept? Recorded as a deliberate governance gap at `governedBusinessRoles.ts:388-394`. | Commercial policy. | The APPROVAL dimension is MISSING for Sales Manager, Salesperson and GM. |
| **OD-EMP-015** | **Should a salesperson see what an account last paid for a part before quoting it again?** No price-history read exists. | New read + a disclosure decision. | A SEARCH requirement with no path. |
| **OD-EMP-016** | **Should `report.customer.field.accountOwner.read` be activated?** Accounts without an owner block Opportunity creation by design, yet no report can list them. | Activation decision. | An ATTENTION requirement for Salesperson and Sales Manager with no read. |
| **OD-EMP-017** | **Which finance reach scopes should ship, and to whom?** `FIN-BLOCK-001` — `.self`, `.team`, `.businessUnit`, `.company` are inactive everywhere; only `.consolidated` resolves, and only in `platform-sandbox`. | `FIN-004` is OPEN. | A Salesperson and a Sales Manager can see **no financial fact at all**. Page 15's whole composition *is* visibility. |
| **OD-EMP-018** | **Should AR aging buckets ship, and at which boundaries?** Implemented under a recorded policy of not shipping them — and page 01 says "60+ days" while page 04 says "61+". **One wording must win.** | Owner policy + a documentation conflict. | N-15 cannot ship; Accounting Manager's ATTENTION has no bucket. |
| **OD-EMP-019** | **Should invoice issuance derive the due date from the account's payment terms**, or is that deliberately the issuer's act? | Commercial policy. | N-22's drill-through has no derivation to show. |
| **OD-EMP-020** | **What is the correcting act for an invoice issued against the wrong customer** — a full-value credit memo, or a governed `voidInvoice`? | The columns and the AR VOID position exist; no command sets them. | The EXPLAIN requirement "what do I do instead" has no answer. |
| **OD-EMP-021** | **What is the governed correcting act for two Accounts that are the same customer?** No merge, no delete; the Duplicate Rules surface is a static display with every control disabled. | New command. | Office Manager's ATTENTION requirement points at a dead surface. |
| **OD-EMP-022** | **What is the correcting act when any CRM record is created in error?** Delete is refused everywhere; Contacts have **no status field at all**. | Ranges across four families. | The most-asked EXPLAIN question in CRM has no answer to give. |
| **OD-EMP-023** | **Should bulk contact import be routed through the governed Data Import pipeline?** Today `contactImport.js:20` writes a client Firestore batch with no audit trail. | Governance. | A WARN requirement about an unaudited write, with the write still in place. |
| **OD-EMP-024** | **Is a scoped financial view below consolidated still wanted, and which Role holds it?** `FIN-BLOCK-001`. **And: should `employees.companyId` / `departmentId` / `locationId` be populated** (M-5), since without them there is no per-person scope anchor? | Two OPEN blockers plus a schema decision. | **No scoped number is producible for any role below GM.** This is the widest single gap in §8. |
| **OD-EMP-025** | **Should the 106 registered Owner questions be surfaced to the Owner inside EOS?** They exist only in `eos-workflow-registry.json`. | Product scope. | The Owner's ATTENTION dimension has no surface. |
| **OD-EMP-026** | **What is the sequence and gating condition for activating the order-to-cash spine**, and is `platform-sandbox`'s 92-id array the intended production target or a superset needing trimming? (`P3B3-ADV-040`, EXECUTED_FAIL.) | The single largest activation decision. | Everything in §7.19–7.24 stays MISSING. |
| **OD-EMP-027** | **Should the fulfilment spine spec be updated to lineId-primary matching?** `p1-fulfillment-billing-spine-spec.md:29` and `salesOrderFulfillmentWriteBack.ts:7-15` **no longer agree**. | A spec/code divergence. | Field Manager cannot be warned truthfully about duplicate-line crediting. |
| **OD-EMP-028** | **Should a governed export exist?** `report.export` does not exist anywhere in the app, and `F13` Invariant E requires that restriction follow the number into exports. | Scope + a disclosure boundary. | *"A governed report you cannot get out of the building is a report you looked at."* |
| **OD-EMP-029** | **Authorize a Role-occupancy read**, and decide the honest sentence when occupancy is zero. Reading `roleAssignments` in a live project is the only way; this lane may not. | Requires production data authorization. | **Nine of the 15 escalation sentences in §10 would render a dead end naming a ghost.** |

---

## 12. MISSING INPUT

| ID | Input | Effect on this lane |
|---|---|---|
| **MI-1** | **Design r1 artifacts** — declared unavailable to this run. Not referenced or reconstructed anywhere above. | Where a requirement needs a visual composition, this document specifies the **information** and defers the **form**. Five financial-page facts reached me only via the archaeology's summary of them, not the r1 sources. |
| **MI-2** | **The Owner's separate employee-design conversation** — declared unavailable. | Any information requirement the Owner already settled there may be duplicated or contradicted here. §11 should be reconciled against it before ratification. |
| **MI-3** | **The `roleAssignments` occupancy read.** Live-data only. | §10 in its entirety; every "ask X" sentence; the second step of the three-fact refusal rule. **OD-EMP-029.** |
| **MI-4** | **An authored information/AI classification for the sales, CRM, finance and administration corpus.** P3-B3's 350 rows carry no `help_*`, no `ai_*`, no coverage tag, no device context, no friction score and no operating company. | §7.18–7.27 are inferred from narrative, not authored as information needs. **34.7% of the corpus contributes nothing to the AI-opportunity, device or friction axes** — and that is a measurement gap, not evidence those roles need less (§7.0(b)). |
| **MI-5** | **`docs/assessments/administration-users-consolidation.md`** — the source EMP-ROLE cites for `jobTitle` and `managerEmployeeId` (`:204-209`) **is not present in this worktree at `64008d5a`**; the `employee-foundation.md` trio lives in the `arch-classify` worktree. | The MANAGER fact cannot be verified here, so M-7 and every ESCALATION row that terminates in a manager stay `UNKNOWN — REVERIFY`. |
| **MI-6** | **`docs/north-star/financials/pages/15-employee-performance.md`'s design source** (`.dc.html` + two frames). The `.md` states `READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW` and that **implementation is NOT authorized from this package**, and all its values are Certification World specimen fixtures. | N-12's drill-through (*"Person → credited events; manager rollups by scope"*) is specified but not authorized, so it is recorded as a requirement awaiting authority rather than a plan. |
| **MI-7** | **A per-family breakdown of the 37 production-ALLOW capabilities.** The two docs that state 37 characterise it only negatively ("not one of them is commercial"). | I could name the **34 catalog-default-active** ids by family from the catalog, but cannot reconcile them to the EXECUTED 37 (see U-6). |
| **MI-8** | **An empty-state / no-records policy document, and a permission-denied copy document.** Neither exists. The de-facto policy is `docs/north-star/lists/DESIGN-HANDOFF-LISTS-P2.md` (17 states, 7 empties) plus `LISTS-VIEW-CHIP-ROLLOUT.md` (count honesty); denial copy exists only as scattered per-family rulings (`SA-D11`, the five Equipment states, `ND-31`, the financials withheld panel). | §5 and §6 had to be assembled from eleven sources. Consolidating them is the natural next artifact and **belongs to EMP-OWN-SYNTHESIZER, not to this lane.** |
| **MI-9** | **A notification/alert architecture.** No such document exists — only `docs/orchestration/notification-signal-quality.md` ("RAW SYSTEM EVENT ≠ OWNER NOTIFICATION"), a link-identity defect trio, and **notification history on the DO-NOT-BUILD list**. | The ATTENTION column in §7 specifies *what* must reach a person and deliberately **does not** specify a channel — that is EMP-EXPERIENCE's boundary and, for the delivery mechanism, an absent authority. |

---

## 13. UNPROVEN

Every item here is a claim this document relies on that is **not** established at `64008d5a` by evidence I could read.

| ID | Claim | Status |
|---|---|---|
| **U-1** | **The exact membership of "five built surfaces."** The registry names five capability ids and five gate sites (§6.3) and reconciles them to *"3 records + one section"*; the archaeology docs name overlapping but not identical sets that also include Data Import and Administration→Users. The registry itself records: *"The five `CLIENT_GATE_NEVER_REQUESTED` sites were **traced, not executed**."* | **The mechanism is proven; the count of five is traced.** I independently verified all five ids are absent from the 44-id request set. |
| **U-2** | **Whether `VITE_EOS_API_BASE_URL` is set out of band in Vercel.** Absent from every committed file. | If set, the admin policy panels reach Render; if not, **zero** Postgres authorities are browser-reachable. Every requirement I placed on that transport is a gap under the second reading. |
| **U-3** | **Whether the current UI distinguishes replay from first-accept**, whether it shows the acceptance actor and time, whether a duplicate row links to its original, and whether operating company is shown on the request queue. | All four are marked **UNPROVEN by the corpus lane itself** (`S01-A03`, `S01-A05`, `S01-A08`, `S01-A06`). §7.4 inherits that. |
| **U-4** | **Whether an unlinked technician renders "no jobs today" or "not linked to a technician record".** | *"Which one renders here is UNPROVEN"* (`P3B1-S09-A02`). |
| **U-5** | **Whether the technician jobs list is scoped by the query or merely emptied by Rules.** | *"UNPROVEN"* (`P3B1-S17-A09`). The difference matters: an emptied list is a DENIED presented as EMPTY. |
| **U-6** | **The active-capability count.** My static parse of `permissionCatalog.ts` at `64008d5a` yields 147 ids / 113 `active: false` / 34 with no explicit flag. `atlas-eng-rpt/.../ENG-IMPL-001…md` §1.4 parses the same file at the same commit as **38 active / 109 inactive**. The EXECUTED resolver measurement is **37 ALLOW anywhere in production**. | **A 4–5 id discrepancy across three methods.** Cite **37 (EXECUTED)** for "what a person can actually do"; treat my 34 and their 38 as static parses needing reconciliation. |
| **U-7** | **Whether contact phone and email are reachable in production.** `P3B3-CRM-022` says *"every one of them is registered inactive."* But three contact field ids **are** in the 25-id `productionCapabilityActivations` set — `report.contact.field.name/role/customer.read` — while **phone and email are not.** | The corpus statement is too broad at this baseline; the *conclusion* for Marketing Manager (phone unreachable) holds. |
| **U-8** | **Whether the report `productionCapabilityActivations` set is 25 or 36.** `rpt-p0` records 25 as a **floor**: under the last recorded production Functions deploy (pinned `fb45e6ee`) 36 of 39 are `active: true` and `owner` resolves ALLOW 36/39. | The blast radius of the row-scope defect (N-20, N-24) is **larger under the second reading**. |
| **U-9** | **Whether outside-EOS work and lost-in-handoff are real practice.** EMP-WORK's 44 instances of work held outside EOS and 26 handoffs where work can be lost rest **entirely on authored narrative** — *"a hypothesis to test, not observed practice."* | §7.4 ACCOUNTABLE (the customer promise) and §7.3 ASSIGNED (the shift handoff) inherit that qualifier. `P3B1-S21` is titled *"the transfer EOS cannot express."* |
| **U-10** | **Whether `/inventory`'s New Part inertness presents as a `Not activated` state or as a failure at submit.** | Marked UNPROVEN by p3a2. The readiness constants (`RECEIVING_TRANSPORT_READY`, `PART_MASTER_WRITE_READY`, `TRUCK_MANAGEMENT_WRITE_READY`) are the **real** gate, not capabilities, and while false the client makes **zero** callable attempts. |
| **U-11** | **Whether ordinary Account edits emit any audit event**, and whether the Account Financial Summary distinguishes *"no provider"* from *"not activated"*. | Both marked UNPROVEN by p3a3. The second is a direct E-1 violation if they render as one sentence. |
| **U-12** | **Everything drawn from the 660 Service and Inventory rows is authored, not observed.** All 660 are `NOT_RUN`; `byFullActivityExecutability = { BLOCKED_BY_TEST_ENVIRONMENT: 330 }` for service. | **This is the broadest caveat in the document.** The information requirements are design claims by the people who wrote the corpus, at `d104cf49`, not measurements of what users needed. |
| **U-13** | **0 of 86 workflows are proven end-to-end — and the zero is an absence of measurement, not a measurement of failure.** The registry's own §-limitations item 10: *"No workflow in this registry has been run end to end by anybody. The zero in the `WORKS_END_TO_END` row is not a measurement that they fail; it is the absence of a measurement."* | Any attention or KPI model over "workflow completion" has nothing proven to count. |

---

## 14. BOUNDARY WITH EMP-EXPERIENCE, AND WHAT I DID NOT TOUCH

| Question | Owner |
|---|---|
| *What* must reach a person, prompted or not; the four verbs; the numbers and their drill-through; denial and unknown explanation; where AI may speak | **EMP-INFORMATION** (this lane) |
| *When and where* it reaches them: start-of-day, the queue, the six "My Work" buckets, handoff, the manager experience, mobile composition, the notification channel | **EMP-EXPERIENCE** — deferred throughout §7's ATTENTION column, which names the fact and not the surface |
| Role definitions, vocabularies, occupancy, the manager relation | **EMP-ROLE** — consumed, not restated |
| Assignment, accountability and handoff as *work* facts | **EMP-WORK** — consumed; §7.0(a) is their finding applied to display |
| Canonical artifacts under `docs/atlas/**` | **EMP-OWN-SYNTHESIZER** only. Not written. |

**Files changed by this lane: one.** `docs/operating-model/lanes/EMP-INFORMATION.md`. No other path was modified.
