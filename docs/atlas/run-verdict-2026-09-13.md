# POST-WAVE-1 PROGRAM RUN — FINAL CONSOLIDATED VERDICT

**Run window:** 2026-09-12 → 2026-09-13 · **Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (`ATLAS-BASE-2026-09-12-A`)
**Lanes:** 27 dispatched, 27 complete, 0 failed, 1 refused by rule (P3-ROLE), 0 still running.
**Corrections:** seven further claims are **withdrawn or corrected as of 2026-09-13** — indexed in §C
*WITHDRAWN / SUPERSEDED CLAIMS* as `CORR-A`…`CORR-G`, with the detail in the subsection that follows it.
Original wording is preserved verbatim throughout and carries inline `**[→CORR-x]**` markers.
**Durability note:** placed here with the run's other cross-cutting records (Atlas baseline pin, branch
inventory, open-PR register). `docs/engineering/ACTIVE_WORKSTREAMS.md` disclaims being a history log;
`docs/DECISIONS.md` is for rulings, and this run raised questions, not decisions.

---

## A. EXECUTIVE RESULT

**What the run established.** Wave 1 merged cleanly (32/32 ancestry, zero squashes). Five engineering
lanes then found five *live* defects at mainline — none of which was theoretical, and none of which
was fixed by broadening access. Separately, a repository-wide census reduced an apparent 1,098-PR
backlog to **71 candidates**, and an authorised recovery restored design authority previously called
permanently lost.

**What materially changed our understanding, in order of consequence:**

1. **EOS cannot name who is responsible for any actionable operational item — and cannot detect
   that.** Three individually-correct rulings compose into "nobody is responsible" with no rule
   broken, and the person-ownership derivation is shape-only, so a record owned by a terminated
   employee censuses as `RESOLVED`. **The COMPANY axis has referential integrity; the PERSON axis has
   none.**
2. **Production role occupancy is zero.** Measured, committed, verified: 2 `roleAssignments`, one
   principal (`admin@global`, no employee link), **zero holders of any of the 45 governed Roles.**
   Every role-shaped queue is *measured-empty*, and the gap is a grant plus a vocabulary, not a
   mechanism. **[→CORR-E]**
3. **25 `report.*` capabilities are live in production** via a field distinct from the one everyone
   reads, with row scope closed for **zero of four** reachable objects. **[→CORR-A]**
4. **Design authority believed permanently lost was recovered** from an untracked folder — including
   the artifact a closed 2026-08-25 Owner acceptance rested on.

**Complete:** Wave-1 integration · five post-main engineering lanes · reporting remediation (server +
client) · the 8-lane Employee/Ownership discovery and its synthesis · design recovery · PR register ·
Atlas baseline · the flake fix.

**Not complete:** deployed-bundle identity (no credential) · A-MIN containment (awaiting identity) ·
Atlas family design (r1 artifacts never arrived) · conformance audit of shipped surfaces against the
recovered authorities (deliberately unasked).

**Ready to integrate:** `rpt/reporting-remediation` (pushed, verified, PR not opened — no API access).
Everything else is local and unpushed by design.

**Blocking the next step:** one GitHub credential and one Firebase login. Nothing else. **[→CORR-D]**

---

## B. LANES COMPLETED

| Lane | Purpose | Status | Commit / branch | Key result |
|---|---|---|---|---|
| ENG-A | audit.event.read defect | CONFIRMED+FIXED | `acdd87b9` post/eng-a-audit-read | 11 governed Roles denied → allowed; refused the half of the brief that would have broadened access |
| ENG-B | Firebase guard bypass + shim ratchet | CONFIRMED+FIXED | `bccf0759` post/eng-b-firebase-guard | 15 bypass shapes live at main, all closed; shim discovery narrowed 190→4 |
| ENG-C | capability parity vacuity | CONFIRMED+FIXED | `276e0417` post/eng-c-parity-vacuity | **three** states certified READY; prior suite *encoded* the defect |
| ENG-D | environment / ADC fence | 6 GAPS CLOSED | `129c485d` post/eng-d-environment-fence | bare `initializeApp` 1→0 **at main**; prod reset-link closed; the fence that could not be proven **[→CORR-F]** |
| ENG-E | report row scope | PARTIAL, honestly | `92db1d19` post/eng-e-report-scope | 4 axes closed; **1 of 4 objects** genuinely scoped; refused to claim more |
| RPT-P0 | production blast radius | COMPLETE | `379961ff` rpt/p0-blast-radius | 24 of 25 UNSAFE; containment is **4 ids**, not 25 |
| RPT-FIX | false-empty + audit context | COMPLETE | `8521cd88` rpt/false-empty-and-audit | audit defect **9 sites, not 3**; refuse-not-report; guard was unregistered |
| RPT-CLIENT | client outcome honesty | COMPLETE | `d65be79c` | removed a user-facing falsehood ("nothing was read") |
| RPT-COMPAT | subset kind contract | COMPLETE | `8e28e32d` rpt/client-outcome-honesty | strict equality **failed the last recorded production deploy** **[→CORR-G]** |
| P3-WF | workflow registry revalidation | COMPLETE | `3fdb3ee5` post/p3-wf-registry | **Wave 1 changed no workflow classification** |
| P3-FB | Firebase runtime census | COMPLETE | `feed0459` post/p3-fb-census | **Wave 1 added zero Firebase business dependency**, proven 4 ways |
| P3-MIG | Postgres / nonprod reality | COMPLETE | `8429358a` post/p3-mig-reality | traced the withdrawn claim to its true source; no DB contacted |
| P3-ROLE | assignment occupancy census | **REFUSED BY RULE** | — | no explicit environment + credential |
| P3-ID | identity standard verification | NOT READY TO FREEZE | `8af319d0` atlas/p30b-identity-verification | 4 defects fixed; 2 existing tests proven **vacuous** |
| ATLAS-ENG-RPT | company-scoped reporting | COMPLETE | `64bb65c6` | register + ENG-IMPL-001; one runtime conclusion later refuted |
| PR-RECON | repository-wide PR census | COMPLETE | read-only | 1,098 → **71**; squash-merge was the missing discriminator |
| ARCH-RECOVER | historical design recovery | COMPLETE | `ea9ddcaf` archaeology/recovered-design-evidence | 61 artifacts recovered; 6 register rows reclassified |
| FIX-FLAKE | crash-id flake | COMPLETE | `bcb91387` fix/crash-diagnostics-flake | reproduced 0.750%; 200/200 deterministic; found a latent 91× false margin |
| EMP-ROLE | Taylor job-role model | COMPLETE | `01023fc0` emp/role-map | no job-role vocabulary; Retail/National ruling corroborated but unmeasurable |
| EMP-WORK | real employee work | COMPLETE | `73be0ef2` emp/work-matrix | 44 instances of work held outside EOS, **all recovery paths** |
| EMP-ACCOUNTABILITY | business accountability | COMPLETE | `69cb2824` emp/accountability | the invariant is unsatisfied **and undetectable** |
| OWN-DESIGN | family reconciliation | COMPLETE | `14598745` own/design-reconciliation | matrix is offline tooling; Rules never enforce ownership |
| OWN-E2E | 16-stage lifecycle census | COMPLETE | `9c24c951` own/e2e-census | handoff refusals live only where nothing reaches |
| EMP-INFORMATION | information model | COMPLETE | `ca755a3b` emp/information | 13-state honest-absence vocabulary; 16 of 26 families cannot speak it |
| EMP-PERFORMANCE | outcomes and metrics | COMPLETE | `c8c77911` emp/performance | 0 of 12 active registry metrics are employee performance |
| EMP-EXPERIENCE | experience requirements | COMPLETE | `e5847dab` emp/experience | 103 requirements; one "My Work" bucket has a working key |
| EMP-OWN-SYNTHESIZER | integration | COMPLETE | `5eb9d773` emp/own-synthesis | 25 files, 11,357 lines; **60 conflicts preserved**, 48 Owner decisions |

**TOTAL 27 · COMPLETE 26 · FAILED 0 · REFUSED 1 · BLOCKED 0 · STILL RUNNING 0**

---

## C. CANONICAL FINDINGS

| # | Finding | Final verified fact | Evidence / method | Consequence |
|---|---|---|---|---|
| C1 | Responsibility invariant | Unsatisfied for **0 of 27** ownable families, **and undetectable** | EXECUTED resolver + matrix eval | Blocks operational completeness of every family |
| C2 | Person vs company axis | COMPANY has referential integrity; **PERSON has none**. `deriveAccountOwner`/`deriveEmployeeRefOwner` never read the Employee doc | EXECUTED | The census gating enforcement is blind to person orphans |
| C3 | Production role occupancy | **ZERO** holders of any of 45 governed Roles; 2 assignments total; 1 principal `admin@global`, `employeeId: null` **[→CORR-E]** | committed census `be1e5579`, ancestor of main, re-read |
| C4 | Work Order past Dispatch | Only exits are the technician-only next step or **CANCELLED** | state machine + corpus `P3B1-S21-A09` | The only expressible answer to an unavailable technician is cancelling a live customer commitment |
| C5 | Handoff reachability | All 5 family-level refusals live only in a module **no callable/route/component reaches**; the live writer accepted a handoff for `"notAFamilyAtAll"` | EXECUTED | Wiring handoff the short way produces the corruption the matrix exists to prevent |
| C6 | Owner rewrite path | Any **admin or dispatcher** can rewrite `accountOwner`/`contacts.owner`/`locations.owner` client-direct, **unaudited**; Rules call it an "INTERIM path"; `/locations` has no field guard | static read of `firestore.rules` | Production's single principal holds exactly that role |
| C7 | Shipped ruling violation | `firestore.rules:765-790` moves `currentOwner` **and** `assignedToUserId` in one write | static read | Contradicts "reassignment ≠ ownership transfer" **in shipped Rules** — **WITHDRAWN, see `CORR-C`** |
| C8 | Reporting production exposure | **25 `report.*` ids production-adopted** via `productionCapabilityActivations`; `capabilityActivationOverrides` absent; intersection 25, zero dropped **[→CORR-A]** **[→CORR-B]** | EXECUTED ×2 lanes + controller ×4 | Row scope closed for **0 of 4** reachable objects |
| C9 | Report row scope | `accounts`/`contacts`/`locations` are `COMPANY_NEUTRAL` **with no company field**; only `equipment` is `SINGLE_COMPANY`, and it is absent from the report catalog | EXECUTED | Company-scoped reporting cannot be made correct without a business ruling |
| C10 | Guard bypass | 15 evasion shapes of `firebase-admin` + `admin.firestore()` live at main; positive control proves the harness | EXECUTED real ratchet | Closed on branch; **must be reapplied**, not merged |
| C11 | Parity vacuity | Three states certified READY, incl. a principal absent from `eos_policy` entirely; 13 of 14 census keys `active:false` so deny/deny is the **default** row | EXECUTED | The prior suite *asserted* the defect and passed 17/17 |
| C12 | Audit context | The ambient-Firestore defect spans **9 call sites, not 3**; `stageAuditEvent` resolved `?? getFirestore()` **to mint the ref** | EXECUTED, poisoned-getter proof | An injected transaction still built its ref on the ambient instance |
| C13 | Design recovery | **61 artifacts** recovered incl. `North Star - Work Order.dc.html`; **19 of 25 register rows still stand**; 31 artifacts remain gone | SHA-256 verified ×3 | Auditability restored; **no acceptance state changed** |
| C14 | PR reconciliation | **71** candidates, not 1,098 — repo is predominantly squash-merge (1,191 squash vs 511 merge subjects) | bulk git analysis | Open/closed state needs the API |
| C15 | Wave-1 neutrality | Changed **no** workflow classification and added **zero** Firebase business dependency | 2 lanes, 4 independent proofs | `0ba8ab0d` and the baseline have byte-identical trees |
| C16 | Flake | Reproduced at **0.750%** (predicted 0.576%); fixed deterministically, 200/200 | EXECUTED | Module carries a real latent narrowing: keyspace is 36⁶ not 2³², non-uniform, and its comment overstated the margin **91×** |

### WITHDRAWN / SUPERSEDED CLAIMS (controller's own, kept auditable)

| Claim | Status | Correction |
|---|---|---|
| "7 of 18 nonprod migrations" | **WITHDRAWN** | Untraceable to any input. Origin found: a true statement about two git trees ("goes from 7 to 18") re-voiced as a live measurement. 7 existed pre-merge, 18 at baseline |
| "62 of 147 capabilities ALLOW in production" | **WITHDRAWN** | Arithmetic error, and the concept is method-dependent. Contested 4–5 ways (34/36/37/38/39). All methods agree: **nothing commercial is reachable** |
| "61" (my union) | **WITHDRAWN** | Mixed two measurement methods |
| "the Family-1 acceptance is permanently unauditable" | **WITHDRAWN** | "Permanently" never justified by a git-scoped method; the artifacts were one untracked folder away |
| "the false-empty defect and 5 unreachable surfaces are fixed" | **CORRECTED** | True of **branches**, not of the baseline. Both are LIVE at `64008d5a` |
| "occupancy is unknown" | **WITHDRAWN** | Measured and **zero** |
| "docs/OWNERSHIP.md is the record-ownership authority" | **WITHDRAWN** | It is IP/attribution governance. Cited to 3 lanes before one read it |
| "~34 artifacts permanently lost" | **CORRECTED** | 30 dedup rows / 34 files; 5 were never lost; 61 recovered; 31 still gone |
| "1,098 PRs not in main" | **CORRECTED** | 71 candidates; squash-merge was the missing discriminator |
| "Service Coordinator / Dispatcher" as one role | **CORRECTED** | Two roles — and my own anti-merging rule forbade it |
| "45 security Roles" | **CORRECTED** | 48 (45 governed + 3 compatibility) |
| "matrix is 15/9/1" | **CORRECTED** | 20/30/1 — naive grep undercounts spread blocks |
| guard "12 categories / roots not a per-file filter" | **CORRECTED** | Both facts were from #1898's guard, not main's — two branches in one brief |
| "50 of 406 shim files" | **CORRECTED** | Denominator 428, and the measure counted **type imports** — building a ratchet on it would have caused the forbidden false-violation outcome |
| "Reporting stays fail-closed in production" / "nothing is reachable in production" | **WITHDRAWN 2026-09-13** | **Not present here** — this document always said the opposite; the false statement is the *source* comment at `reportExecutionService.ts:271-272`. 25 `report.*` are activation-eligible in production per source + config, 25 of 25 surviving the allowlist. **→ `CORR-A`** |
| `productionCapabilityActivations` "unioned" / "composed" with `capabilityActivationOverrides` | **WITHDRAWN 2026-09-13** | **Not present here**; withdrawn at program level. `environmentCapabilityOverrides.ts:774` is a **precedence ternary** — a non-empty production set **discards** the non-production set. Also: keyed on `projectId`, and there are **three** gates, not two. **→ `CORR-B`** |
| "`firestore.rules:765-790` violates reassignment ≠ ownership transfer" (`C7` · §D · §F · §K) | **WITHDRAWN 2026-09-13** | **No defect at that site** — the branch at `:764`ff is a counter-example and `currentOwner` is a role baton. The real defect is `firestore.rules:381-384`: the `fieldops_jobs` admin/dispatcher update carries **no `affectedKeys().hasOnly(...)`**, so `operatingCompanyId` is rewritable. **→ `CORR-C`** |
| `GITHUB_AUTH_REQUIRED` as a blanket statement | **WITHDRAWN 2026-09-13** | Git over **SSH fetch works** (`ls-remote` → `64008d5a`); the **REST / PR / CI API is unavailable**; **push** is technically possible but needs Owner authorization. Three operations, not one. **→ `CORR-D`** |
| "ZERO ROLE OCCUPANCY" (§A.2 · `C3` · §F) | **CORRECTED 2026-09-13** | Read **"ZERO GOVERNED-BUSINESS-ROLE OCCUPANCY"** — `admin@global` is a real assignment. Census `be1e5579`, ancestor of main: 2 `roleAssignments`, one principal `admin@global`, `employeeId: null`. **→ `CORR-E`** |
| the three-script ambient-ADC figure | **CORRECTED 2026-09-13** | **Not present here**; withdrawn at program level. **One** file remains: `functions/scripts/inventoryCapabilityParityHarness.js`. The other two **are** fenced. The claim failed as a **static negative over a chosen marker set** — a method lesson, not just a number. **→ `CORR-F`** |
| `CURRENT_SUPPORTED_SERVER_KINDS` / `CLIENT_RECOGNIZED_KINDS` | **CORRECTED 2026-09-13** | **Not present here**; withdrawn at program level. **Neither identifier exists at `64008d5a`**; the real ones are `RunReportOutcomeKind`, `SERVICE_KINDS`, `KINDS`. **The subset rule itself holds** — only the names were paraphrase. **→ `CORR-G`** |

### CORRECTIONS OF 2026-09-13 — `CORR-A` … `CORR-G` (detail for the last seven rows above)

**Mechanism.** These seven are the same instrument as the 14 rows above — the controller's own claims,
kept auditable — but each needs more than a one-line `Correction` cell, so the table indexes them and
the detail sits here. **No original wording anywhere in this document has been altered:** where a
corrected statement appears in the body, it stands verbatim and carries an inline `**[→CORR-x]**`
marker. **Re-verification baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` — `origin/main`,
confirmed unmoved against the live remote by `git ls-remote`. Every code claim below is
`OBSERVED AT: 64008d5a` with `file:line`.

**Three and a half of the seven correct claims this document never made.** `CORR-A`, `CORR-B`, `CORR-F`,
`CORR-G` and part of `CORR-D` were made at **program level** — in lane briefs, controller messages, and
in two source comments — and are withdrawn here because this is the canonical handoff and the record has
to be reachable from it. They are marked **NOT PRESENT; WITHDRAWN AT PROGRAM LEVEL**. Nothing was
manufactured to withdraw. `CORR-C` and `CORR-E` **are** present in this document, in four and three
places respectively, and are corrected in place.

---

#### `CORR-A` — Reporting production activation

**WITHDRAWN 2026-09-13** (program level) · **CORRECTED 2026-09-13** (this document: §A.3, `C8`, §D, §J)

**Original claim withdrawn:** *"Reporting stays fail-closed in production"*, and every equivalent
including any unqualified *"nothing is reachable in production."*

**NOT PRESENT IN THIS DOCUMENT.** This document said the opposite from the start (§A.3, `C8`, §D, §J).
The false statement lives in the **source**, as the comment the engine carries at its own activation
call — `functions/src/reporting/reportExecutionService.ts:271-272`: *"Production carries no overrides,
so Reporting stays fail-closed there until a separate activation ruling."* **That comment is false about
the code it annotates** — the very next line, `:273`, passes the resolved activation set straight in.
It is where the program's error came from, so it belongs in the record and not only in a diff.

**Corrected statement — the production activation path, end to end:**

| Step | Fact | Evidence (`OBSERVED AT: 64008d5a`) |
|---|---|---|
| catalogue | all **39** `report.*` entries declare `active: false` | `functions/src/access/permissionCatalog.ts` — 39 of 39, parsed per entry |
| declaration | env `taylor-parts-production` (`firebase.projectId: "taylor-parts"`, `role: "production"`) declares **25** `productionCapabilityActivations`, all `report.*` | `functions/src/access/environmentCapabilityOverrides.ts:679` (ids `:680-704`) |
| allowlist | `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` holds **exactly 25** ids | `environmentCapabilityOverrides.ts:52` (ids `:53-77`) |
| filter | the 25 declared ids are **set-identical** to the 25 eligible ids → **25 of 25 survive the filter; none dropped** | filter at `environmentCapabilityOverrides.ts:755`; both sets extracted and diffed — empty diff |
| gate | the runtime resolver honours the production mechanism: `role === "production"` | `environmentCapabilityOverrides.ts:748` |
| preference | the resolved production set wins the composition | `environmentCapabilityOverrides.ts:774` |
| engine | the reporting engine passes that set to the resolver | `functions/src/reporting/reportExecutionService.ts:273` |
| effect | **presence** of the id in the set suppresses the `active: false` deny | `functions/src/access/resolveEffectivePermission.ts:264` |

**Therefore source + configuration evidence indicates those 25 `report.*` capabilities are eligible for
production activation despite catalogue `active: false`.**

**Ordinary permission and grant checks still apply.** The resolver leaves **Role / Scope / Condition /
accessVersion unchanged** — suppression of the `inactivePermission` deny at
`resolveEffectivePermission.ts:264` is the *only* thing activation buys — so **a lifted capability with
no qualifying grant still denies.** The file states this itself at `:259-263`, and it is true of the
code. Activation is not a grant.

**Deployment standing — phrased deliberately. DO NOT INFER THE DEPLOYED ACTIVE SET SOLELY FROM SOURCE.**
What exists is *committed evidence*, not a live read:

- `docs/audits/functions-live-state/2026-07-21/function-describes/runReportDefinitionCallable.json` —
  `state = ACTIVE`, `environment = GEN_2`,
  `name = projects/taylor-parts/locations/us-central1/functions/runReportDefinitionCallable`,
  `updateTime 2026-07-21T05:07:33.817263116Z`.
- the same callable also appears in `docs/audits/sandbox-provisioning-20260806/prod-functions.json`.

Those are **real operator observations, dated, now weeks old, and not re-verified in this run.**

**Correct standing:** *activated per source and configuration; deployed per dated committed evidence;
awaiting live read-only re-verification* — **not** *proven reachable today*.

**REMAINS UNPROVEN.** **Deployed runtime identity** — which bundle production is actually running, and
therefore whether the deployed resolver is the `64008d5a` resolver. That read-only re-verification
**remains a prerequisite before production containment** (§E: A-MIN execution is gated on exactly it).
Also unproven: whether any principal holds a grant that would turn an activated capability into ALLOW —
`C3` bears on this but is a separate axis (see `CORR-E`).

**This document's own over-claim, in the other direction.** §A.3 and §D say `25 report.*` are "live in
production" flatly, and §J calls Reporting "the only production-activated family". Those are **CORRECTED
to the standing above** — activated per source and configuration, deployed per dated committed evidence,
not re-verified live. Original wording stands in place.

---

#### `CORR-B` — Activation field semantics: precedence, not union

**WITHDRAWN 2026-09-13** (program level) · two figure corrections **added to `C8`**

**Original claim withdrawn:** that `productionCapabilityActivations` and `capabilityActivationOverrides`
are **unioned**, or that they "compose."

**NOT PRESENT IN THIS DOCUMENT** as a claim about these two fields — `C8` records
`capabilityActivationOverrides` as **absent**, which is correct. The union language is again in the
**source**: `environmentCapabilityOverrides.ts:764` (*"the SINGLE place the two activation authorities
are composed"*) and `:770-771` (*"Exactly one of the two can ever be non-empty … The **union** is
therefore a statement of intent, not an overlap to reason about"*).

**Actual semantics** — `environmentCapabilityOverrides.ts:774`:

```ts
cachedOverrides = production.size > 0 ? production : nonProduction;
```

A **precedence ternary**, not a union. **If the production set is non-empty the non-production set is
discarded entirely.** The file's own comment at `:770-771` calls it a union and is **wrong about its own
line.** It is harmless today only because the registry populates **one field per environment** — a fact
about the registry's *contents* (`:663-705`), **not an invariant the code enforces.** Neither
`resolveRuntimeCapabilityOverrides` nor `ActivationRegistryEnv` (`:301-323`, where both fields are
independently optional) prevents an environment from declaring both.

| Figure corrected | As recorded / assumed | Actual | Evidence |
|---|---|---|---|
| resolver key | the environment **name** `taylor-parts-production` | the **`projectId`** — `"taylor-parts"` | `:742`; and `ActivationRegistryEnv` (`:301-323`) has **no name field at all** — the name exists only in a comment at `:665` and in `config/environments.json:257` |
| gate count | two gates | **three**, in order: `role === "production"` (`:748`) → eligibility allowlist (`:755`) → preference (`:774`) | as cited; the `role` gate had not been recorded by anyone |

**REMAINS UNPROVEN.** Nothing further at source level. What is **untested** is the both-fields-populated
case: no test asserts precedence, so the discard is unguarded against a future registry edit. Recorded,
not fixed — no implementation in this lane.

---

#### `CORR-C` — Rules defect location: `:765-790` withdrawn, `:381-384` recorded

**WITHDRAWN 2026-09-13** · present in this document in **four** places:

- `C7` — *"`firestore.rules:765-790` moves `currentOwner` **and** `assignedToUserId` in one write …
  Contradicts 'reassignment ≠ ownership transfer' **in shipped Rules**"*
- §D — *"`firestore.rules:765-790` ruling violation"*
- §F — *"`firestore.rules:765-790` violates a standing ruling"*
- §K — *"Tier-2 fix for `firestore.rules:765-790`"*

**There was no defect at that site.** Three independent reasons:

1. **The range is wrong and the counter-example is inside it.** `allow update: if` opens at
   `firestore.rules:763`. The **first** branch, `:764-775` (Approve/Reject), changes `currentOwner`
   (`:768`) with **no assignee at all** — its `affectedKeys().hasOnly(...)` allowlist at `:772-773`
   names `currentOwner` and **not** `assignedToUserId`. A site cited as proof that the two always move
   together contains the counter-example in its own first branch.
2. **`currentOwner` there is not the governed record owner.** The Rules literals are **role strings** —
   `"PARTS_MANAGER"` (`:768`, `:779`) and `"PARTS_ASSOCIATE"` — a workflow **baton**, not a person or a
   company. `functions/src/ownership/ownershipMatrix.ts:286-288` says so in terms: *"`currentOwner` the
   role queue. Untouched, and still not ownership"*, with `ownerFields: []` for that family.
3. **Moving a baton together with an assignment is correct** for a queue hand-off. `:776-789` is the
   Assign branch, where advancing the queue *is* the assignment. Requiring them to move apart would be
   the defect.

**The actual defect — `firestore.rules:381-384`, `fieldops_jobs` update, admin/dispatcher branch:**

| Element | Fact | Evidence (`OBSERVED AT: 64008d5a`) |
|---|---|---|
| the branch | `allow update: if resource.data.status != 'complete' && ( (isAdminOrDispatcher() && isValidJobTransition(…)) \|\| …` | `firestore.rules:381-384` |
| what is missing | **no `affectedKeys().hasOnly(...)` allowlist on this branch** — a transition predicate and nothing else | `:383-384` |
| the contrast | the technician branch immediately below **does** have one, via `jobStatusOnlyChange()` | `:389` |
| why it was missed | the block comment says that allowlist makes other fields "client-immutable **in this transition**", which scopes it to the **technician** path only | `:377-380` |
| what is exposed | `operatingCompanyId` — the **governed company-ownership field of this very family** | `ownershipMatrix.ts:267-268`: `collection: "fieldops_jobs"`, `ownerClass: "COMPANY"`, `ownerFields: ["operatingCompanyId"]` |

**So an admin or dispatcher performing any valid status or assignment transition may rewrite
`operatingCompanyId` in the same write** — a company-boundary change riding on an unrelated lifecycle
update. Per `C6`, production's single principal holds exactly that role.

**Classification: Tier-2 authority defect, pending explicit authorization. No Rules change made here and
none proposed in this lane.**

**REMAINS UNPROVEN.** **Static read only** — `firestore.rules` cannot be executed on this machine (§H:
no JRE, emulator port held), so there is no emulator proof that such a write succeeds, and no evidence
that any such write has occurred. The **deployed** Rules were not read. §F's Tier-2 row and §K's
parallel item should be re-pointed from `:765-790` to `:381-384` when the Rules-authorization ruling
lands.

---

#### `CORR-D` — Authentication: three operations, not one

**WITHDRAWN 2026-09-13** — `GITHUB_AUTH_REQUIRED` as a blanket statement.

**NOT PRESENT IN THIS DOCUMENT as that token**, and this document is already partly right: §A and §D
record `rpt/reporting-remediation` as **PUSHED**, which a blanket auth failure would have made
impossible. What is imprecise is the conflation in §A (*"Blocking the next step: one GitHub
credential"*) and §L (*"Authenticate GitHub … `gh auth login`"*) — they read as one blocker where there
are three operations.

| Operation | Standing 2026-09-13 | Evidence |
|---|---|---|
| Git over **SSH** fetch | **WORKS** | `git ls-remote --heads origin main` → `64008d5ae0bdd9532909671b15a91122400accf1` |
| GitHub **REST / PR / CI API** | **UNAVAILABLE** | `gh auth status` → *"not logged into any GitHub hosts"*; `gh api user` → *"please run gh auth login"* |
| **push** | technically possible over the same SSH transport, **but still requires Owner authorization** | policy, not credential; this lane is `DO NOT PUSH` |

**Push, open-PR and check-CI are three different operations and must not be conflated.** PR creation and
check inspection require the API; push does not.

**REMAINS UNPROVEN.** Push to a ref was not attempted — correctly, being unauthorized — so **write-side**
SSH permission is untested; only the read side (`ls-remote`) is proven.

---

#### `CORR-E` — "ZERO ROLE OCCUPANCY" → "ZERO GOVERNED-BUSINESS-ROLE OCCUPANCY"

**CORRECTED 2026-09-13** · present in this document in **three** places (a fourth was already right):

- §A.2 — *"**Production role occupancy is zero.**"*
- `C3` — *"Production role occupancy … **ZERO** holders of any of 45 governed Roles"*
- §F — *"zero production occupancy"*
- §D already reads *"zero governed-Role occupancy"* — **no correction needed there.**

Read **"ZERO GOVERNED-BUSINESS-ROLE OCCUPANCY"** wherever the unqualified form appears. **`admin@global`
is a real assignment**: occupancy is not zero in the plain sense, and the unqualified phrasing invites
the wrong containment conclusion.

**Evidence.** Committed census `be1e5579` — verified an **ancestor of `64008d5a`** by
`git merge-base --is-ancestor`; *"docs(access): R-32 production exposure census — zero exposed
principals (#1752)"*, 2026-09-02. `docs/assessments/r32-production-exposure-census.json`:
`projectId: "taylor-parts"`, `readOnly: true`, `writesPerformed: 0`, `totals.roleAssignments: 2`, and
one principal carrying `activeAssignments: ["admin@global"]` with `employeeId: null` — itself raised as
the anomaly `PRINCIPAL_HAS_NO_EMPLOYEE_LINK`.

**REMAINS UNPROVEN.** The census is **dated 2026-09-02 and was not re-read live** in this run — §B's
P3-ROLE lane was **REFUSED BY RULE** for exactly that reason. The **second** of the two
`roleAssignments` is not itemised: the census's `principals` array is scoped to its manager-exposure
query, so "1 principal" is that listing's scope, **not a proven global count.**

---

#### `CORR-F` — Firebase / ADC guard: one file, and a method lesson

**CORRECTED 2026-09-13** — the **three-script** ambient-ADC figure.

**NOT PRESENT IN THIS DOCUMENT** — §B's ENG-D row and §D say only *"bare `initializeApp` 1→0 at main"*
and *"the fence that could not be proven"*. Withdrawn at program level; the corrected figure is recorded
here so the canonical handoff carries it.

**Confirmed remaining ambient-ADC residue: ONE file** —
`functions/scripts/inventoryCapabilityParityHarness.js`:

| Fact | Evidence (`OBSERVED AT: 64008d5a`) |
|---|---|
| requires only `--tenant` and `--subject` | `:264`, `:270` |
| takes **no project or environment argument at all** | `:254-280` is the whole CLI entry; the file contains no `--projectId`, no `GCLOUD_PROJECT`, no `--confirmProduction` |
| documents reading Firestore from *"a live Firestore credential (GOOGLE_APPLICATION_CREDENTIALS / ADC)"* | `:254-258` |
| reaches `getFirestore()` with **no app of its own** | `:192` — `const db = opts.db \|\| require("firebase-admin/firestore").getFirestore();` |

**The other two are fenced** — this is the part the earlier figure got wrong:

| Script | Fence | Evidence |
|---|---|---|
| `functions/scripts/operatorAccessCommand.js` | `--projectId` **required, no default**; production gated behind an **exact-match** `--confirmProduction` | `:109-121` |
| `functions/scripts/productionFoundationVerification.js` | the same guard, the same convention | `:85-97` |

**Method lesson — worth more than the number.** The earlier claim failed because it was a **static
negative over a chosen marker set**: it searched for the absence of a fixed list of guard markers and
reported every non-match as unfenced. Both fenced scripts guard by a *different* convention than the
markers looked for, so a correct fence read as a gap. **A negative finding produced by marker absence is
not a finding about the code; it is a finding about the marker set.** Record this alongside the
corrected figure, not instead of it.

**REMAINS UNPROVEN.** The one-file figure is itself a **static** result over `functions/scripts/`
markers and inherits the same limit — a fourth residue guarded by yet another convention would not
necessarily be caught. No script was executed and no credential was present.

---

#### `CORR-G` — Server-kind identifiers were paraphrase; the subset rule holds

**CORRECTED 2026-09-13** — the identifiers `CURRENT_SUPPORTED_SERVER_KINDS` and
`CLIENT_RECOGNIZED_KINDS`.

**NOT PRESENT IN THIS DOCUMENT** — §B's RPT-COMPAT row says only *"subset kind contract"* and *"strict
equality failed the last recorded production deploy"*. Withdrawn at program level. **Verified: neither
identifier exists anywhere at `64008d5a`** — 0 occurrences each, across `.ts`, `.tsx` and `.js`.

| Real identifier | Where (`OBSERVED AT: 64008d5a`) |
|---|---|
| `RunReportOutcomeKind` — the server outcome type | `functions/src/reporting/reportExecutionService.ts:184` |
| `SERVICE_KINDS` — the client's set of accepted server kinds | `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:13` |
| `KINDS` — the client's own result-state kinds | `field-ops-app-vite/src/domain/reporting/reportResultState.js:13` |

**The subset rule itself HOLDS and is preserved.** Only the names were paraphrase. §B's RPT-COMPAT
result — that **strict equality** failed the last recorded production deploy, and that a subset contract
is the correct shape — stands unchanged.

**REMAINS UNPROVEN.** Nothing new. No claim in this document rested on the invented names, because they
were never written here. **The lesson is that a paraphrased identifier is indistinguishable from a
verified one once it is written down** — `CORR-F`'s lesson in a second form.

---

## D. CURRENT MAIN VS BRANCH-ONLY

### CURRENT MAIN — TRUE NOW at `64008d5a`
Wave 1 merged, 32/32 ancestry proven · 25 `report.*` live in production **[→CORR-A]** with row scope closed for
zero of four objects · false-empty defect **LIVE** · 5 surfaces unreachable **LIVE** · guard bypass
**LIVE** · parity vacuity **LIVE** · bare `initializeApp` present · production reset-link one argument
away · zero governed-Role occupancy · `firestore.rules:765-790` ruling violation **[→CORR-C]** · `accountOwner`
client-rewritable unaudited · handoff INERT.

### IMPLEMENTED / PROVEN ON BRANCH — NOT IN MAIN

| Branch | Head | Fixes | Proof | Integration |
|---|---|---|---|---|
| `rpt/reporting-remediation` | `8e28e32d` | row scope, false-empty, 9 audit sites, activation guard, client honesty, subset contract | 81 server subtests + 290-suite client manifest + guard ratchet, all exit 0; 8 negative controls | **PUSHED. PR not opened (no API).** **[→CORR-D]** |
| `post/eng-a-audit-read` | `acdd87b9` | 11 governed Roles denied audit read | EXECUTED both directions; typo control | MERGE CANDIDATE |
| `post/eng-b-firebase-guard` | `bccf0759` | 15 bypass shapes + shim ratchet | 99/99, 5 negative controls, byte-identical restores | MERGE CANDIDATE |
| `post/eng-c-parity-vacuity` | `276e0417` | deny/deny no longer certifies | 13 new tests; `test:adminPolicy` 575 | MERGE CANDIDATE |
| `post/eng-d-environment-fence` | `129c485d` | 6 env gaps incl. prod reset-link | 17/17 + mutation-checked SDK-load trap | MERGE CANDIDATE |
| `fix/crash-diagnostics-flake` | `bcb91387` | 0.6%/run manifest flake | 200/200, 4 negative controls | MERGE CANDIDATE (separate, per ruling) |
| `phase3/operational-reality-evidence` | `9171bd4b` | Atlas baseline, branch inventory, PR register, 3 stale-authority corrections | documentation | MERGE CANDIDATE |
| `archaeology/recovered-design-evidence` | `ea9ddcaf` | 61 recovered artifacts + manifest + reclassification | SHA-256 ×3, 0 defects | MERGE CANDIDATE — take **this** branch's register on conflict |
| `emp/own-synthesis` + 8 lane branches | `5eb9d773` | Employee/Ownership evidence | machine-validated tables | MERGE CANDIDATE (evidence) |
| `post/p3-{wf,fb,mig}`, `rpt/p0-blast-radius`, `atlas/eng-impl-*` | — | evidence | read-only/static | MERGE CANDIDATE (evidence) |

### PROPOSED / NOT AUTHORIZED
Identity standard (**NOT READY TO FREEZE**) · `atlas/guard-admin-firestore` (**superseded** — do not merge) ·
`atlas/p30b-identity-verification` runtime impl (**not canonical**) · 45 engineering implications (all
`NOT AUTHORIZED`) · A-MIN containment (approved in principle, **execution blocked on identity**) ·
4 August `integration/*` branches (LEGACY LOCAL).

---

## E. OWNER DECISIONS

**48 consolidated rows from 117 lane-local items occupying only 50 distinct id strings** —
`OD-EMP-001` meant four different decisions and `OD-OWN-001` three, which is itself a finding.
Full set: `emp/own-synthesis:docs/operating-model/EMPLOYEE-OPEN-DECISIONS.md`.

The ten that gate the most:

| ID | Question | Blocks | Recommendation |
|---|---|---|---|
| OD-1 | What represents ACCOUNTABLE PERSON, distinct from record owner? | Everything in the employee model | None — this is the root decision |
| OD-6 | Person-orphan policy | **The enforcement gate, either way** | None |
| OD-7 | Handoff wiring order | Any handoff work | Do **not** wire before OD-1 |
| OD-R4 | May reporting use *derived* company scope where the object has none? | All company-scoped reporting | Contact: declare **company-neutral** (no derivation exists) |
| — | Temporary reporting containment | Production exposure | **A-MIN, 4 ids** — approved; **execution gated on identity** |
| — | Deployed-bundle identity | Containment ceiling (25 vs 36 ids) | Authorize the read-only check |
| — | Invoice state after full write-off / credit memo | Wiring the finance detector | None — two modules disagree |
| — | `.firebaserc` `default: taylor-parts` | Every un-`--project`'d command | Propose sandbox or removal |
| — | Retail vs National Accounts sequencing | The distinct-roles ruling | **Owner-vs-Owner:** the ruling needs the coverage model you deferred |
| — | Conformance audit vs recovered authorities | Whether a closed acceptance still holds | Available on request; **your timing** |

Also open: the 4 August branches · `SERVICE_MANAGER` has no consumer under **any** reading · "Verenward EOS" vs **"Enterprise Operations OS"** in 40 source files.

---

## F. ENGINEERING / PRODUCT GAPS

| Class | Finding | State |
|---|---|---|
| OWNERSHIP / ACCOUNTABILITY | ACCOUNTABLE PERSON + ESCALATION OWNER have **no representation** | BLOCKED — OWNER DECISION |
| OWNERSHIP | person-axis referential integrity | BLOCKED — OWNER DECISION (OD-6) |
| OWNERSHIP | handoff reachable only where nothing calls it | BLOCKED — OWNER DECISION (OD-7) |
| AUTHORITY | `firestore.rules:765-790` violates a standing ruling **[→CORR-C:** withdrawn; re-point to `:381-384`**]** | READY — ENGINEERING REQUIRED (Tier-2) |
| AUTHORITY | `accountOwner` client-rewritable unaudited | READY — ENGINEERING REQUIRED (Tier-2) |
| CORRECTNESS | report row scope for 3 COMPANY_NEUTRAL objects | BLOCKED — OWNER DECISION (OD-R4) |
| CORRECTNESS | false-empty; 9 audit sites; parity vacuity; guard bypass; audit-read denial | **READY — fixed on branch** |
| EMPLOYEE MODEL | no job-role vocabulary (5 disjoint, `jobTitle` free text) | BLOCKED — OWNER DECISION (OD-1) |
| EMPLOYEE MODEL | zero production occupancy **[→CORR-E]** | BLOCKED — AUTHORITY (a grant) |
| EMPLOYEE MODEL | competence/proficiency unmodelled — *"Nothing warns"* | BLOCKED — DATA MODEL |
| UI / EXPERIENCE | 16 of 26 module families cannot speak the 13-state absence vocabulary | READY — ENGINEERING REQUIRED |
| UI / EXPERIENCE | governed KPI tile has **no drill-through at all** | READY — ENGINEERING REQUIRED |
| REPORTING | one-hop outbound engine cannot express inbound questions | READY — ENGINEERING REQUIRED (projection) |
| FIREBASE EXIT | bypass closed on branch; shim boundary ratcheted; **Rules authz still 43 of 69 tracked** | READY — ENGINEERING REQUIRED |
| MIGRATION | live migration state **unmeasured**; no production Postgres declared anywhere | BLOCKED — AUTHORITY (env + credential) |
| TEST RELIABILITY | flake fixed; 3 guards were registered nowhere; 1 guard asserted a **false** safety property | **READY — fixed on branch** |
| AI | two thirds of modelled work is work AI should stay out of; assistant exports nothing | DEFERRED |
| AUDIT | 9 ambient-Firestore sites | **READY — fixed on branch** |

14 items sit under **READY — ALREADY EXISTS**: built, correct, and unwired, unrendered or unactivated.

---

## G. ARTIFACTS CREATED / RECOVERED

| Path | Purpose | Classification | Branch |
|---|---|---|---|
| `docs/operating-model/` (25 files, 11,357 lines) | Employee Operating Model + Ownership | DESIGN / EVIDENCE | `emp/own-synthesis` |
| `docs/design-history/recovered/` (61 files) + manifest | recovered design artifacts | **RECOVERED HISTORICAL AUTHORITY — NOT current North Star** | `archaeology/recovered-design-evidence` |
| `docs/atlas/ATLAS-BASE-2026-09-12-A.md` | observation baseline | OWNER RULING / pinned fact | `phase3/...` |
| `docs/atlas/open-pr-register-post-wave1.md` | PR disposition | EVIDENCE | `phase3/...` |
| `docs/atlas/local-branch-inventory-post-wave1.md` | branch classification | EVIDENCE | `phase3/...` |
| `docs/atlas/engineering-implications/` (2 entries) | implication register | DESIGN — `NOT AUTHORIZED` | `atlas/eng-impl-*` |
| `docs/architecture/postgres-nonprod-reality-post-wave1.md` | declared-vs-live | EVIDENCE | `post/p3-mig-reality` |
| `docs/architecture/firebase-business-runtime-census-post-wave1.md` | Firebase census | EVIDENCE | `post/p3-fb-census` |
| `docs/architecture/eos-workflow-registry*` (revalidated) | 86 workflows | EVIDENCE | `post/p3-wf-registry` |
| `docs/architecture/verenward-global-record-identity-standard.md` + registry + census | identity standard | **PROPOSAL — NOT READY TO FREEZE** | `atlas/p30b-*` |
| 3 stale-authority corrections | supersession markers | CORRECTION | `phase3/...` |

**Recovered ≠ current.** No recovered artifact was promoted to current authority, and no conformance
claim was made.

---

## H. TEST / PROOF SUMMARY

**EXECUTED:** ~450 subtests across reporting, access, guard, identity, ownership and client suites;
290–291-suite client manifests; `test:adminPolicy` 575; governance 682; the shipped resolver run with
**zero `node_modules`** (Node 22 type-stripping + loader hook) by five lanes independently; real
Firebase-guard ratchet runs with `--previous-baseline`; 200-run determinism proof; 4,000-run flake
reproduction.

**NEGATIVE CONTROLS / MUTATION PROOFS: 30+**, every one injected → failed → reverted → green, several
verified byte-identical on restore. Notables: the shim ratchet's four rejected discovery rules kept as
regression floors; the SDK-load trap that fails if a module *resolves* `firebase-admin`; the keyspace
mask that width-and-alphabet checks would miss.

**STATIC:** `firestore.rules` and JSX throughout (execution impossible) — flagged per claim.

**NOT MEASURED:** every Firestore-emulator suite (**no JRE on this machine**; port 8080 held by an
unrelated uvicorn) · all production runtime state · live migration state · rendered UI.

**Method disagreements preserved:** the capability count (4–5 ways) · write-only field denominator ·
`ownershipMatrix.ts:287-296` staleness · unconsumed `operationalRoles` (4 readings). **60 conflicts
carried with both readings intact.**

---

## I. PR / INTEGRATION STATUS

| Branch / PR | Head | Purpose | Disposition | Dependencies |
|---|---|---|---|---|
| `rpt/reporting-remediation` | `8e28e32d` | reporting remediation | **MERGE — PR not opened** | GitHub API |
| `post/eng-a`,`-b`,`-c`,`-d` | see §D | 4 live defects | MERGE | — |
| `fix/crash-diagnostics-flake` | `bcb91387` | flake | MERGE (separate) | — |
| `phase3/operational-reality-evidence` | `9171bd4b` | run records | MERGE | — |
| `archaeology/recovered-design-evidence` | `ea9ddcaf` | recovery | MERGE — **take this register on conflict** | — |
| `emp/*`, `own/*` (9) | see §B | Employee/Ownership | MERGE (evidence) | — |
| `atlas/guard-admin-firestore` | `4d2ec94b` | superseded by ENG-B | **DO NOT MERGE** | — |
| `atlas/p30b-identity-verification` | `8af319d0` | identity | **HOLD — evidence only** | freeze decision |
| #1821 | `bc4c626f` | Rules→capability | **DO NOT MERGE AS-IS** | salvage scope |
| #1826 | `eadcf3f1` | Cursor Firebase env | **DO NOT MERGE AS-IS** | #1832 |
| #1857, #1832, #1569 | — | release record, identity, sticky header | MERGE CANDIDATE | #1857 training half |
| #1724, #1487 | — | visual system, provenance | **ABSORBED** — merging #1724 regresses `index.css` ~1,069 lines | — |
| #1722, #1630 | — | evidence | HISTORICAL | — |
| #1855 | `1d3fa9c6` | assistant boundary | HOLD — PREREQUISITE | ZERO-FIREBASE ruling |
| #1414 | `b8e68485` | cert governance | CLOSE — SUPERSEDED | — |
| #1866–#1897 | — | Wave-1 sources | CLOSE as SUPERSEDED/ABSORBED | GitHub API |

---

## J. PROGRAM IMPACT

**Employee Operating Model** — now exists as evidence (11,357 lines) with the invariant answered:
**no**. 48 decisions gate it; OD-1 gates them.
**Ownership / Accountability** — two of nine concepts have no representation; the matrix is offline
tooling; Rules never enforce ownership.
**Atlas** — baseline pinned; **r1 artifacts never arrived**, so no family opened. The gate stands: no
family may receive final acceptance until Employee findings are reconciled.
**North Star UI** — nothing implemented. Recovery restored *auditability* for three acceptances and
changed **no** acceptance state.
**Engineering** — five live defects fixed on branches; 45 implications recorded, all unauthorized.
**Firebase exit** — Wave 1 added none; the bypass is closed on a branch; Rules authorization remains
the largest unretired surface at 43 of 69 sites tracked.
**Reporting** — the only production-activated family, with the weakest row scope. Remediation is
complete and pushed. **[→CORR-A]**
**Production safety** — improved on branches, **unchanged in production**: no deploy, no activation
change, no data written, no schema migrated, handoff not activated.

---

## K. REMAINING WORK

**CAN RUN NOW IN PARALLEL** — reapply ENG-B onto post-merge main · Tier-2 fix for
`firestore.rules:765-790` **[→CORR-C:** read `:381-384`**]** and the `accountOwner` path (needs Rules authorization) · consolidate the
evidence branches · honest-absence vocabulary rollout · KPI drill-through primitive.

**MUST WAIT FOR OWNER DECISION** — OD-1 → OD-6 → OD-7 (strict order) · OD-R4 · A-MIN execution ·
conformance audit · identity freeze · the 4 August branches.

**MUST WAIT FOR INTEGRATION** — PR opening and CI (GitHub API) · #1866–#1897 closure · Atlas
re-baseline after further merges.

**LATER / DEFERRED** — Atlas six specialist lanes + synthesizer (needs r1) · AI activation policy ·
nine deliberate refusals, each written after something went wrong.

---

## L. SINGLE NEXT ACTION

**NEXT BEST ACTION:**
Authenticate GitHub and Firebase in this shell — `gh auth login` and `firebase login`. **[→CORR-D:**
SSH fetch already works; this unblocks the **API**, not the transport**]**

**WHY:**
It is the only input that unblocks three separate stalls at once: the reporting-remediation PR and its
CI, the deployed-bundle identity that gates the approved A-MIN containment, and closure of the 32
absorbed Wave-1 PRs. Every other thread is either complete, correctly awaiting an Owner ruling, or
running on evidence already in hand.
