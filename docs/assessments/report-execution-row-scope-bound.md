# Report execution: the operating-company and row-scope bound (lane P2-H)

Closes the defect lane P3-A3 named its single most urgent finding: the trusted report
execution path had **no operating-company axis and no row-level bound**.

Scope of this note: `functions/src/reporting/reportExecutionService.ts` and the new pure
`functions/src/reporting/reportRowScope.ts`. The client capability-request set
(`field-ops-app-vite/src/access/*`) is untouched — that is lane P2-G's territory.

---

## 1. What was actually there

Two lines, at the tree as of `d104cf49`:

| Line | Code | Effect |
| --- | --- | --- |
| `reportExecutionService.ts:420` | `const target: TargetContext = { scope: { type: "global" }, condition: {} };` | one hardcoded target reused for **every** object, field and traversal gate in the run, so the Scope axis contributed no narrowing at all |
| `reportExecutionService.ts:500` | `db.collection(object.collection).limit(maxScanDocs + 1).get()` | no `where()` of any kind — every document in the collection, up to `MAX_SCAN_DOCS` (20,000) |

Both citations verified against the current tree, not inherited.

### The shape of it was sharper than "one company can read another's rows"

Measured, not reasoned (`scripts` under `/tmp/.../night/p2h/repro.mjs`; see §4):

* A runner granted at **`global`** scope got `kind: "results"`, **no `where` clause**, and
  **every row of every company** — plus rows carrying no company at all.
* A runner granted at **`operatingCompany: "taylor"`** scope got **`permission-denied`**.
  `resolveEffectivePermission`'s `scopeMatches` value-matches `operatingCompany` exactly, so a
  company-scoped assignment could never satisfy a `global` target. **The scope type was inert in
  this path.**

So there was no such thing as a company-bounded report runner. The only way to run a report at
all was a global grant, and a global grant returned everything. That is why this is a
**pre-activation** defect: the first activation, not a later regression, is what grants the access.

### Blast radius if `report.*` were activated

`validateReportDefinition` defaults its activated set to `objectsWithPopulatedFields()`, so the
base objects reachable today are exactly four:

| object | collection | ownership-matrix `companyScope` |
| --- | --- | --- |
| `customer` | `accounts` | `COMPANY_NEUTRAL` |
| `contact` | `contacts` | `COMPANY_NEUTRAL` |
| `location` | `locations` | `COMPANY_NEUTRAL` |
| `equipment` | `equipment` | **`SINGLE_COMPANY`** (`operatingCompanyId`) |

Wave-2/3/4 objects (`fieldops_jobs`, `fieldops_wos`, `fieldops_technicians`, `reorder_requests`,
`reorder_purchase_orders`, `inventory_actions`, `employees`) are `fieldsPopulated: false` and are
refused by the validator. `employees` is additionally unreachable through the
`customer -> employee` relationship, because the catalog declares no `employee.*` field for a
definition to reference.

**Unbounded axes found — the `global` scope was not the only one:**

1. the hardcoded capability target (`:420`);
2. the `where()`-less base scan (`:500`);
3. **the one-hop join** (`joinRelatedDocs`, `:~799`), which fetches related documents by id
   (`collection(c).doc(id).get()`) and applied no company check — a second route to the same leak,
   which closing only the base query would have left open;
4. **the runner context itself** (`loadRunnerAccessState`, `:244-252`) returned only
   `{accessVersion, assignments}` — there was no company identity in the run to bound *with*.
   This is the root cause; the other three are its symptoms.

---

## 2. What changed, and why it reuses existing authority

The repo already suffers from duplicated implementations, so **nothing new was invented**. Both
halves of the bound are read from authorities that already exist and are already under Owner ruling.

**Which companies does this runner reach?** — exactly the pattern
`finance/financeReadCallables.ts:119-123` established: enumerate the governed value set
(`OPERATING_COMPANY_IDS`) and probe the canonical resolver once per candidate with a value-matched
`{ type: "operatingCompany", value }` target. The company is **never inferred** from an employee
profile, warehouse, job title or display name — `types/access.ts:26-33` and
`employeePrincipalLink.ts:202-207` forbid precisely that, and there is no uid→company resolver in
this codebase to misuse. Authority decides reach, not demographics.

**Is this collection company-partitioned, and by which field?** — `ownership/ownershipMatrix.ts`,
the ownership matrix reconciled against the measured sandbox census under Owner rulings D-8…D-16.
Its `companyScope` column already answers the question for every governed family and its
`ownerFields`/`companyScopeField` columns already name the storage. Re-deciding it in the reporting
layer would create a second authority for a question that already has one (ruling D-1 forbids that).

Consequences, both deliberate:

* a **global** assignment still matches every company target (`scopeMatches`:
  `case "global": return true`), so an admin's reach is both companies and nothing regresses;
* an **operatingCompany-scoped** assignment can now match, where before it could match nothing.
  That is the scope type doing its declared job, and it is strictly *narrower* than the global
  grant it removes the need for.

Where a reach spans more than one company, a capability must hold at **every** company in reach to
count as held: the result set may contain rows from any of them, so a field readable for only one
must not be projected across all. With a single-company reach this collapses to one ordinary check.

### Fail-closed, never a fallback to global

Every unknown answers *refuse*: an unknown collection, a collection claimed by two families, an
`EXCLUDED` family, a `CROSS_COMPANY_CAPABLE` / `PARTICIPATING_COMPANIES` family (its bound is a
participating **pair**, not a single-field equality — and a wrong bound is worse than none, because
it reads as one), or a `SINGLE_COMPANY` family naming no company field.

A refusal returns a new outcome kind, **`scope-unresolved`**, with `rows: null` and a row-data-free
`reason`. It is deliberately distinct from `permission-denied`: the runner may well hold the
capability — what is missing is the *scope* saying which company's rows the run is about. Collapsing
the two would hide a tenancy failure behind a permissions message and invite "just grant them the
capability" as the fix.

---

## 3. Open Owner questions — **not decided here**

Lane P2-D recorded two live Owner questions in this area. Both are business rulings, not engineering
choices. The **conservative reading** was implemented in each case, pending a ruling.

### Q1. Does a report default to the runner's company, or require an explicit filter?

**Conservative reading taken:** neither an implicit default nor silent widening. The run is bound to
the companies the runner's **own grants** actually reach, resolved through the canonical resolver. A
runner reaching no company gets `scope-unresolved` and zero documents read — never a fall-back to
global. No new "run as company X" parameter was added to `RunReportParams`, because choosing one
would answer this question.

**What a ruling would change:** if the Owner wants an *explicit* per-run company selection, that
parameter is added and a run supplying none is refused even when reach is non-empty. If the Owner
wants a *default*, the default is named here rather than derived.

### Q2. Is a saved report private user data or shareable business configuration?

**Not touched by this lane.** It bears on `savedDefinitionCommands.ts`, not on the execution path,
and nothing in this change presumes an answer. Flagged as still open.

### Q3 (raised by this lane). Are the three `COMPANY_NEUTRAL` CRM families readable across companies?

The ownership matrix already rules `accounts`, `contacts` and `locations` **`COMPANY_NEUTRAL`** —
ruling R-15 is explicit that a Customer must **not** carry a single operating company, because one
customer may legitimately transact with either company. This change therefore applies **no company
row predicate** to those three: fabricating one would invent a fact the Owner ruled must not exist.
A company reach is still required to run at all.

**The question the matrix does not answer:** R-15 says a customer record is not *owned* by one
company. It does not say every Ventana employee may *read* every Taylor-touched account. Those are
different statements, and only the first is ruled. If the Owner wants a read partition on the CRM
families, it needs a different axis than `operatingCompanyId` — most likely the existing PERSON
ownership axis (`accounts.accountOwner`, `contacts.owner`, `locations.owner`) plus
`access/hierarchicalVisibility.ts`. **That is not implemented here** and must not be assumed to be.

### Q4 (raised by this lane). Equipment is largely ownerless today.

The ownership matrix records `equipment` as `unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED` with
`backfillSource: null` and the note "No mass assignment." A record carrying no
`operatingCompanyId` therefore does **not** satisfy the bound and is not returned — an ownerless
record is not everyone's record; it is a record whose company nobody has stated, and stating it is
not the reporting layer's job.

**Practical consequence, stated plainly:** until equipment carries operating companies, an
`equipment` report returns **fewer rows than before, possibly none**, in the sandbox where Reporting
is live. That is the fail-closed answer and it is the intended one, but it is a visible behaviour
change and the Owner should see it rather than discover it.

---

## 4. Reproduction

`functions/test/reportScopeBound.test.mjs`, run with `npm run test:reportingScope` (or
`node --test test/reportScopeBound.test.mjs`). It uses the service's own documented `options.db`
injection seam with an in-memory Firestore double that **records the query actually issued**, so the
assertion is on the predicate that reached the database — not merely on the rows that came back. An
in-memory post-filter would satisfy a row-count assertion while leaving the real defect intact,
because the scan cap is applied by Firestore *before* any in-memory pass: another company's rows
would still consume the budget and could push the runner's own rows past the cap (and, with
aggregates, into an `IncompleteAggregateScanError` over data the runner was never entitled to see).

Seeded `equipment`: 2 Taylor rows, 2 Ventana rows, 1 with no `operatingCompanyId`.

| runner's grant scope | | `kind` | query issued | rows |
| --- | --- | --- | --- | --- |
| `global` | **before** | `results` | *(none)* | **5 — both companies + the ownerless row** |
| | **after** | `results` | `operatingCompanyId in [taylor, ventana]` | 4 |
| `operatingCompany: taylor` | **before** | `permission-denied` | *collection never read* | – |
| | **after** | `results` | `operatingCompanyId in [taylor]` | **2 (Taylor only)** |
| `location: bay-3` | **before** | `permission-denied` | *collection never read* | – |
| | **after** | `scope-unresolved` | *collection never read* | `null`, with a reason |

Against the pre-fix build the suite reports **11 of 16 failing**; against the fix, **16 of 16
passing**.

---

## 5. The ratchet

Three source-text assertions in the same suite, so a future edit cannot quietly restore the defect
and cannot fail with a misleading message:

1. `reportExecutionService.ts` must construct no `scope: { type: "global" }` target. Comments are
   stripped before the check — this file documents the old line verbatim on purpose, and a ratchet
   that forbade *explaining* the defect would be the wrong ratchet.
2. the base fetch must not go `collection(...).limit(...)` directly, and must branch on
   `rowScope.kind` and carry `.where(rowScope.field, "in", [...companyReach])`.
3. the empty-reach case must be handled explicitly and must produce its own outcome kind.

Structurally reinforcing the text checks: `resolveFieldAuthorization` no longer takes a
`(runner, target, roles)` triple. It takes a reach-aware **checker**. There is no single `target`
parameter left for a future edit to pin back to `global`.

---

## 6. Out of scope — recorded, not fixed

P3-A3 reported `financialReconciliation.ts` as "a detector that is never run". **Confirmed, and
sharper than reported:** `functions/src/finance/financialReconciliation.ts` is imported by **no
production module** (only by test files), *and* its test `functions/test/financialReconciliation.test.mjs`
is registered in **no** `package.json` script. It is both unwired and unrun. Belongs to a future lane.

Also observed while registering tests — pre-existing, not caused here:
`functions/test/reportingActivationBoundary.test.mjs` and `functions/test/financialReportingRead.test.mjs`
are registered in no `package.json` script either, though both pass when run directly.

---

## 7. UNPROVEN

* **Transactional / real-Firestore behaviour.** The covering suite
  `functions/test/reportExecutionService.test.mjs` requires a live Firestore emulator on
  `127.0.0.1:8080`, which is held here by an unrelated process. It was **not run**. Specifically
  unproven against real Firestore: that `where(field, "in", [...])` composes with `.limit()` as the
  in-memory double models it, and that no composite index is required for the single-field `in`
  (believed automatic, not verified).
* **Behaviour against real sandbox data.** No live project was contacted. The claim that equipment
  documents largely lack `operatingCompanyId` is read from the ownership matrix's own recorded
  census verdict, not re-measured.
* **Client rendering of the new `scope-unresolved` kind.** `runReportDefinitionCallable` returns the
  outcome as data and switches on no `kind`, so nothing server-side breaks; how the client surfaces
  it is P2-G's territory and was not touched or tested.
