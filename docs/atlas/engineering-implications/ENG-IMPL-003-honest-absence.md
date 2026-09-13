# ENG-IMPL-003 — Honest Absence

**Status:** engineering implications. Not a design, not an implementation plan, not a copy deck.
**Invariant this serves (Owner, standing):** **EOS MUST NOT REPRESENT UNPROVEN ABSENCE AS PROVEN EMPTY.**
**OBSERVED AT:** `64008d5a` — every `file:line` in this document was read at commit
`64008d5ae0bdd9532909671b15a91122400accf1`, verified identical to `origin/main` at 2026-09-13T16:22Z.
**Lane:** UX-HONEST-ABSENCE. Sibling extension lanes own `ENG-IMPL-001/002/004`; this file is the only
surface this lane writes.

---

## 0. How to read this document

### 0.1 Three evidence markers, used on every finding

| Marker | Meaning |
|---|---|
| **LIVE AT BASELINE** | the behaviour is in the product at `64008d5a`. A statement about EOS. |
| **FIXED ON A BRANCH** | a branch changes it. **Not** a statement about the product. Nothing in this document claims this unless it names the branch. |
| **UNPROVEN** | could not be verified at `64008d5a` by reading source. Never rounded to a yes or a no. |
| **MISSING INPUT** | depends on Atlas r1 design input. `docs/atlas/inputs/design-r1/` **does not exist** at `origin/main` (verified: `git ls-tree -r origin/main -- docs/atlas/inputs` → empty). Any answer would be a guess. |

Every finding below is **LIVE AT BASELINE** unless explicitly marked otherwise. This document makes **no**
claim that the false-empty defect or the unreachable-surface defect is fixed: both are live here.

### 0.2 What this specifies, and what it refuses to specify

This is a contract over **required distinctions** and **required behaviour**. It names no screen, no
component, no layout, and approves no copy. Where wording is load-bearing — where the sentence itself is
the product decision — it is marked **OWNER DESIGN DECISION** and left open (§7).

### 0.3 Counting discipline

No ALLOW count appears in this document. The withdrawn "62 of 147", and its contested replacements
(34/36/37/38/39), are all excluded: an ALLOW count is method-dependent and this document does not need one.
Two counts *are* used, and each states its method inline (§2.1, §5.7). A count without a method is treated
here as a defect, not a fact — see §5.7, where two committed artifacts in this repo disagree about the same
number and the wrong one is guarded by a drift test.

---

## 1. State taxonomy

### 1.1 The brief's table, refined against what the code can emit

The brief's eight states are correct as far as they go, but the shipped code already distinguishes more
than eight, and two of the eight are not single states. Three corrections, each load-bearing:

| # | Correction | Why |
|---|---|---|
| C1 | **NOT YET RUN and IN FLIGHT are two states, not one.** | `HonestState.jsx:26-28` and `:94-102` already separate them, and the separation is the point: `IDLE` renders **no spinner** because "a loading affordance would be announcing progress on a request that does not exist" (`HonestState.jsx:95-98`). Collapsing them makes the shell claim a request it never issued. |
| C2 | **DECISION NOT YET RESOLVED is a third, distinct waiting state.** | Not "the data is loading" but "the authority answer has not arrived". `isAccessResolving()` (`field-ops-app-vite/src/access/reportCapabilityAccess.js:107-127`) exists *specifically* because acting on its absence destroyed deep links (`:92-100`). It is a separate fact from LOADING and must not merge with NOT AUTHORIZED. |
| C3 | **PROVEN EMPTY is a family of four, already ratified.** | `collectionPageState.js:80-215` ships `TRUE_EMPTY`, `EMPTY_VIEW`, `SEARCH_ZERO`, `FILTER_ZERO` as four different facts with four sentences. All four are "the query ran and returned zero", but only `TRUE_EMPTY` claims the collection is empty. A surface that says TRUE_EMPTY when it means FILTER_ZERO is a false-empty of the same family. |
| C4 | **`SCOPE UNRESOLVED` must not be minted as a kind name.** | Zero grep hits at `64008d5a` for `scope-unresolved`, `scopeUnresolved`, `SCOPE_UNRESOLVED`, `scope_unresolved`, `companyUnresolved`, `unresolvedScope` (verified, all six = 0 across `.ts/.js/.jsx/.mjs/.md`, excluding `node_modules`). It is a **required distinction with an existing home** — `HONEST_STATE.UNKNOWN` — not a new vocabulary item. See §1.3. |
| C5 | **`CURRENT_SUPPORTED_SERVER_KINDS` and `CLIENT_RECOGNIZED_KINDS` do not exist as identifiers.** | Zero grep hits. The shipped instances of that contract are `SERVICE_KINDS` (`field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:13`, 5 members) and `KINDS` (`field-ops-app-vite/src/domain/reporting/reportResultState.js:13-16`, 10 members). The subset rule is satisfied today. §4 states the rule over the real identifiers. |

### 1.2 The taxonomy, with representability

`REPRESENTABLE + USED` = the state has a rendering *and* a real code path reaches it.
`REPRESENTABLE, UNUSED` = the rendering exists; nothing feeds it for this cause.
`RENDERING ONLY` = a rendering exists but **no signal can derive the state** — asserting it is a guess.
`NOT REPRESENTABLE` = there is no way to say it.

| State | Meaning | Representability | Deciding `file:line` |
|---|---|---|---|
| **NOT YET RUN** | nothing has been requested | REPRESENTABLE + USED | `field-ops-app-vite/src/shared/ui/HonestState.jsx:57` (id), `:94-99` (renders, no spinner); report path `field-ops-app-vite/src/domain/reporting/reportResultState.js:21-23` |
| **IN FLIGHT** | a read is issued and outstanding | REPRESENTABLE + USED | `HonestState.jsx:58`, `:101-102`; `reportResultState.js:24-25` |
| **DECISION NOT YET RESOLVED** | the authority answer has not arrived | REPRESENTABLE + USED, **but rendered as a bare string** | `field-ops-app-vite/src/access/reportCapabilityAccess.js:107-127`; consumed `field-ops-app-vite/src/App.jsx:1190` (`return <div className="fo-panel">Loading...</div>`) |
| **PROVEN EMPTY — TRUE EMPTY** | the query ran, scope resolved, zero rows exist in the collection | REPRESENTABLE + USED | `HonestState.jsx:59`, `:104-105`; `collectionPageState.js:103-109`; server emitter `functions/src/reporting/reportExecutionService.ts:627-628` |
| **PROVEN EMPTY — EMPTY VIEW** | rows exist; this view's slice is empty | REPRESENTABLE + USED | `HonestState.jsx:61`, `:111-124`; `collectionPageState.js:110-116` |
| **PROVEN EMPTY — SEARCH ZERO** | a search matched nothing; the query is echoed and the real scope stated | REPRESENTABLE + USED | `HonestState.jsx:62`, `:126-145`; `collectionPageState.js:117-124` |
| **PROVEN EMPTY — FILTER ZERO** | filters narrowed to none, with the count they are eating | REPRESENTABLE + USED | `HonestState.jsx:63`, `:147-164`; `collectionPageState.js:125-132` |
| **NOT AUTHORIZED** | the caller lacks the capability; the answer is withheld, not zero | REPRESENTABLE + USED **on callable paths only** | `HonestState.jsx:65`, `:183-190`; report kind `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:31`, server emitter `functions/src/reporting/reportExecutionService.ts:437`; field-level `field-ops-app-vite/src/metadata/referenceResolution.js:49`, `:70`; criteria-level `field-ops-app-vite/src/metadata/listUrlState.js:53`, `:66`. **NOT representable through the effective-access feed** — see next row. |
| **CAPABILITY NOT ACTIVATED** | the id is in the catalogue but not active in this environment | **RENDERING ONLY.** The rendering exists (`HonestState.jsx:66`, `:192-198`) and the server computes the reason (`functions/src/access/resolveEffectivePermission.ts:63`, emitted `:265`) — but the reason is **deliberately never transmitted** (`functions/src/access/effectiveAccessFeed.ts:77-82`), and even server-side it **cannot be told apart from catalogue-inactive**: one reason covers both (`resolveEffectivePermission.ts:264`). | `functions/src/access/effectiveAccessFeed.ts:77-82`; `functions/src/access/resolveEffectivePermission.ts:264-266`; client boolean-only validator `field-ops-app-vite/src/access/reportCapabilityAccess.js:71-79` |
| **SCOPE UNRESOLVED** | company/tenant scope could not be established, so no query was valid | **REPRESENTABLE, UNUSED** as a scope fact. The rendering that carries it honestly is `HONEST_STATE.UNKNOWN` (`HonestState.jsx:64`, `:166-181` — "renders NO count, ever"). No kind name exists (C4). Server-side the reason is computed and **withheld**: `blockedScopes` with human reasons at `functions/src/finance/financeReadCallables.ts:131-136`, never placed in any returned payload. | `HonestState.jsx:166-181`; `functions/src/finance/financeReadCallables.ts:131-136`; `functions/src/finance/financialReportingRead.ts:239-259` |
| **FAILED** | the query errored | REPRESENTABLE + USED | `HonestState.jsx:67`, `:200-215` (the server's own reason survives verbatim, `:201-209`); `field-ops-app-vite/src/domain/loadErrorMessage.js:7-16`; report kind `reportRunOutcome.js:37` |
| **PARTIAL** | some sources/fields/filters answered, some did not | REPRESENTABLE + USED, **but collapses into TRUE EMPTY at zero rows** — see §5.1 V1 | `HonestState.jsx:68`, `:217-222`; report kinds `reportRunOutcome.js:13` and `reportResultState.js:34-80`; truncation-as-unavailable `functions/src/finance/financeReadCallables.ts:196-198` |
| **NOT IMPLEMENTED** | the surface has no server behaviour at all | REPRESENTABLE + USED | `field-ops-app-vite/src/navigation/PlaceholderPage.jsx:28-32`; `field-ops-app-vite/src/domain/financialsSurface.js:136-137` + `:152-155`; unreachable-with-`awaits` `field-ops-app-vite/src/shared/ui/collectionPageState.js:190-215` |
| **NOT APPLICABLE** | the fact does not apply to this record | REPRESENTABLE + USED (record scope only, deliberately not a collection state) | `HonestState.jsx:69`, `:224-225`; exclusion recorded `collectionPageState.js:32-38` |
| **NOT REQUESTED** | the client gates on a capability it never asked the feed about | **NOT REPRESENTABLE.** Indistinguishable from NOT AUTHORIZED *by construction*, and the code says so: "an unasked capability is indistinguishable from a denied one" | `field-ops-app-vite/src/access/reportCapabilityAccess.js:34-35` (the admission), `:147` (`feed.decisions[capabilityId] === true` — `undefined` → `false`) |
| **NOT READY (build-time)** | a compile-time readiness constant disables the transport | REPRESENTABLE + USED, and **already distinguishable from an authority denial** | `field-ops-app-vite/vite.config.js:113` (`__APP_READINESS__`); e.g. `field-ops-app-vite/src/config/receivingReadiness.js:26`; state token `field-ops-app-vite/src/services/partAliasCallableClient.js:43` (`"transport-not-ready"`) |

### 1.3 Two states the brief asks for that the system cannot currently emit

Recorded plainly, because a kind that exists only in a document is a lie of the same family as a false empty.

| State | What exists | What does not |
|---|---|---|
| **CAPABILITY NOT ACTIVATED** | the reason (`inactivePermission`), the resolver, the rendering (`NOT_ENABLED`) | any transport from the first to the last. And a *distinction* between catalogue-inactive and environment-not-activated at **any** layer: `resolveEffectivePermission.ts:264` tests `permission.active === false && !activationOverrides.has(id)` and emits one reason for both branches. |
| **SCOPE UNRESOLVED** | the fact (`blockedScopes`), and a rendering that refuses to print a count (`UNKNOWN`) | a name, a transport, and any client consumer. `blockedScopes` has **zero** references under `field-ops-app-vite/src`. |

**Engineering consequence.** §3 asks for a transport, not a new vocabulary. The renderings already exist; the
signal does not. Adding kind names before adding the signal would reproduce the defect.

---

## 2. Failure-mode → state mapping

### 2.1 The seven authority failure modes

Each can present as an empty screen. `Required state` is what the contract in §1 obliges the surface to say.
`Reason emitted` is the server's own internal reason. `Reaches client?` is whether that reason is transmitted.

| # | Mode | Mechanism `file:line` | Reason emitted | Reaches client? | Required state | Shipped state |
|---|---|---|---|---|---|---|
| 1 | **`active:false` in the catalogue** | `functions/src/access/permissionCatalog.ts:64` (catalogue), `:1695` (`permission.active !== false`); deny at `functions/src/access/resolveEffectivePermission.ts:264-266` — **fires ahead of any role check** | `inactivePermission` | **No** | CAPABILITY NOT ACTIVATED | collapsed to NOT AUTHORIZED (a bare `false`) |
| 2 | **environment-not-activated** | `functions/src/access/environmentCapabilityOverrides.ts:339-367` (non-production resolver), `:734-759` (production adoption), `:761-778` (composition); consumed by the feed at `functions/src/access/effectiveAccessFeed.ts:174`, passed `:241` | `inactivePermission` — **the same value as mode 1** | **No** | CAPABILITY NOT ACTIVATED | collapsed to NOT AUTHORIZED, and **not separable from mode 1 even server-side** |
| 3 | **gated-but-never-requested client-side** | request set `field-ops-app-vite/src/access/reportCapabilityAccess.js:30-37`; gate `:147`; the defect is documented three times at `field-ops-app-vite/src/access/governedSurfaceCapabilities.js:87-103`, `:160-179`, `:200-229` | none — **the server is never asked** | n/a | honest unknown / a build-time failure, never absence | collapsed to NOT AUTHORIZED. **Three live leaks, §5.3** |
| 4 | **held-only-by-admin** | `functions/src/access/compatibilityRoles.ts:235-241` (`ADMIN_ALL_PERMISSIONS` spreads the whole catalogue), applied `:257`; owner composes from it `functions/src/access/governedBusinessRoles.ts:36`, role at `:951-961`. Only two non-admin compatibility roles exist: `compatibilityRoles.ts:350-354` | `noQualifyingGrant` (for everyone who is not admin/owner) | **No** | NOT AUTHORIZED (truthful *per user*) — **but "an admin can see it" is not evidence the surface is reachable** | NOT AUTHORIZED, correct per-user; the *program* fact (held-only-by-admin) is a readiness fact with no user-facing state, and should not have one (§7) |
| 5 | **compile-time readiness constants** | define `field-ops-app-vite/vite.config.js:113`; ten constants, e.g. `field-ops-app-vite/src/config/receivingReadiness.js:26`, `field-ops-app-vite/src/config/partIdentifierReadiness.js:20`, `field-ops-app-vite/src/config/inventoryBalanceReadiness.js:19`, `field-ops-app-vite/src/config/truckManagementReadiness.js:41`,`:51`,`:52`, `field-ops-app-vite/src/config/partMasterWriteReadiness.js:27`, `field-ops-app-vite/src/config/manufacturerWriteReadiness.js:13`, `field-ops-app-vite/src/config/workOrderReadinessContextReadiness.js:11-12`, `field-ops-app-vite/src/config/trustedCompletion.js:13` | not a resolver reason at all | **Yes** — it is a client-side fact | NOT IMPLEMENTED / NOT READY | **correct today.** `"transport-not-ready"` at `field-ops-app-vite/src/services/partAliasCallableClient.js:43`. The one mode already honest. |
| 6 | **`rulesOnly` objects** | declared `field-ops-app-vite/src/access/objectPermissionMap.js:36`, `:37`, `:92` (Contacts, Customer Locations, Equipment/Installed Base); honoured `field-ops-app-vite/src/access/roleAccessModel.js:167`,`:281`,`:310`; rendered `field-ops-app-vite/src/modules/administration/AdminObjects.jsx:118-119`, `field-ops-app-vite/src/modules/administration/RolePolicyGrid.jsx:157-158`; rules blocks `firestore.rules:1341`, `:1505`, `:1555` | **none** — Rules refuses before the capability resolver is consulted | a raw Firestore `permission-denied` only | NOT AUTHORIZED, with no capability to name | NOT AUTHORIZED where the caller maps the Firestore code (`field-ops-app-vite/src/domain/loadErrorMessage.js:9-11`); otherwise the read's `|| []` fallback yields absence |
| 7 | **absent from catalogue** | `functions/src/access/resolveEffectivePermission.ts:241-244` | `unknownPermission` | **No** | a build/deploy failure, never a user-facing absence | collapsed to NOT AUTHORIZED. **No test covers capability ids referenced in UI gate code** — §6.7 |

### 2.2 Two further modes found at the baseline (additions to the seven)

| # | Mode | Mechanism `file:line` | Required state | Shipped state |
|---|---|---|---|---|
| 8 | **feed error treated as a settled denial** | `field-ops-app-vite/src/access/reportCapabilityAccess.js:126` (`return false; // ERROR: settled denial`), consumed `field-ops-app-vite/src/App.jsx:1190` then `:1191` | FAILED | NOT AUTHORIZED. A transport failure of the authority feed presents as "your account isn't assigned a role with access yet" (`App.jsx:1194-1196`) — §5.2 V4 |
| 9 | **company scope not bound to the query** | `functions/src/coverage/coverageReadCallables.ts:18-28` (global `coverage.read` boolean, no company binding) then `:51` and **`:59`** (`where("companyId", "==", data.companyId)` on a **client-supplied** value) | SCOPE UNRESOLVED, fail closed | `status: "ready"` with zero rows — a **PROVEN EMPTY claim about a company the caller has no scope for**. §5.4 V9. Latent today (see the caveat there), not live-exploitable. |

### 2.3 The stacking order — why a surface is empty

The checks fire in this order. The first one wins, and modes 2–5 and 7 all arrive at the client as the same
`false`:

| Order | Layer | Mode | Distinguishable at the client? |
|---|---|---|---|
| 1 | build-time readiness (`__APP_READINESS__`) | 5 | **Yes** (`"transport-not-ready"`) |
| 2 | client request set membership | 3 | **No** — and the server is never asked |
| 3 | `findPermission` miss | 7 | No (`unknownPermission` discarded) |
| 4 | `active:false` ∧ no override | 1 **and** 2 | No — *and not separable from each other server-side* |
| 5 | role / scope / binding / condition / accessVersion | 4 | No (`noQualifyingGrant` discarded) |
| 6 | Firestore Rules on a `rulesOnly` object | 6 | Only as a raw Firestore code |

`functions/src/access/effectiveAccessFeed.ts:77-82` is the single deliberate decision that makes rows 2–5
indistinguishable. It is not an oversight; it is a stated non-disclosure rule (§3.3).

---

## 3. Server contract

A contract over what a response must **carry**, not a schema migration and not a new wire format.

### 3.1 The four obligations

| # | Obligation | Why, at the baseline |
|---|---|---|
| **S1** | **Every read response must carry a discriminated outcome, not rows-or-nothing.** A zero-length row array is not an answer; it is the absence of one. | Already honoured by two families and it is the difference between them and everything else: `functions/src/reporting/reportExecutionService.ts:184-189` (`RunReportOutcomeKind`) and `functions/src/finance/financialReportingRead.ts:239-240` + `:255-259` — *"A principal with no reach must never receive a 'ready' empty page — 'ready, nothing outstanding' and 'you cannot see this' are different facts, and only the second one is true."* |
| **S2** | **A zero-row result must be emitted only when every gate was passed and the scope was bound.** Any gate that refused, any scope that failed to bind, and any source that did not answer must produce a different outcome than TRUE EMPTY. | Violated at `reportExecutionService.ts:627-634`: `rowCount === 0` is tested **first**, ahead of `droppedColumnLabels.length > 0` and `truncated || widened`, so a run whose authorization narrowed the report reports `"empty"`. §5.1 V1. |
| **S3** | **A refusal must be distinguishable from an empty, and the *class* of refusal must be distinguishable from other classes** — at minimum: not-authorized, not-activated-here, scope-unbound, not-implemented. Naming the capability id, the Role, the assignment, the Scope or the Condition is **not** required to achieve this and must not be inferred as a requirement. | The classes exist server-side (`resolveEffectivePermission.ts:61-65` — four reasons; `financeReadCallables.ts:131-136` — `blockedScopes` with human reasons) and none of them is transmitted (`effectiveAccessFeed.ts:77-82`; `financeReadCallables.ts` — `blockedScopes` has zero references under `field-ops-app-vite/src`). |
| **S4** | **A capability the client gates on must be a capability the client asked about.** An unasked id must be a *build* failure, never a runtime `false`. | `reportCapabilityAccess.js:147` cannot tell them apart, and says so at `:34-35`. Three live leaks: §5.3. |

### 3.2 What S3 does and does not ask the feed to disclose

This distinction decides whether S3 is even implementable without breaking the non-disclosure rule that
`effectiveAccessFeed.ts:77-82` exists to enforce. Setting it out explicitly, because conflating the two is
how this obligation gets rejected as a security regression:

| Withheld today | Is it *about the access-control model's shape*? | May S3 disclose it? |
|---|---|---|
| `matchedRoleId`, `matchedAssignmentId`, Scope, Condition | **Yes** — internal structure of the principal's grants | **No.** S3 does not ask for these. |
| `noQualifyingGrant` vs `malformedAssignments` | Partly — `malformedAssignments` is a data-integrity fact about the caller's own assignments | **OWNER DESIGN DECISION.** Merging them into one "not authorized" loses nothing the operator can act on. |
| `inactivePermission` (modes 1 + 2) | **No** — it is a fact about the *environment's configuration*, identical for every principal, and already published in `config/environments.json` and `docs/governance/effective-authority.json` | **Yes.** Disclosing "this is not switched on here" tells an attacker nothing about who holds what. This is the one widening S3 actually needs. |
| `unknownPermission` (mode 7) | **No** — it is a programming error | **Yes**, and it should be loud: it means the client is gating on an id the platform does not know. |
| `blockedScopes` reasons | **No** — they say "your grant has no bound company", not which companies exist | **Yes** for the *existence* of the condition. Whether the sentence names the binding is **OWNER DESIGN DECISION**. |

**Engineering consequence.** The minimum S3 needs is a **three-way** answer per capability where a boolean
sits today — allowed / withheld / not-active-here — plus a separate loud channel for `unknownPermission`.
That is strictly less disclosure than the four internal reasons, and it closes modes 1, 2 and 7.

### 3.3 The feed's boolean-only contract is a hard blocker, and it is load-bearing

`functions/src/access/effectiveAccessFeed.ts:77-82` states the rule; `:232-243` implements it
(`decision === "ALLOW"` → boolean). The client's validator **rejects any non-boolean decision value as
malformed and fails closed** (`field-ops-app-vite/src/access/reportCapabilityAccess.js:71-79`). Two
consequences that any implementation must plan for:

1. A reason-carrying payload sent to today's client is treated as **malformed** → every capability denies.
   A widening is therefore **not** backward-compatible on the wire unless it is additive beside the
   existing `decisions` map, or version-negotiated.
2. Every other place a reason is computed already discards it downstream, so the feed is not the only
   chokepoint: `functions/src/access/trustedWriterCommands.ts:429` and `:462` interpolate the reason into a
   throw, and `functions/src/access/accessCommandCallables.ts:72` replaces it with
   `"You are not authorized to perform this action."` (the intent is stated at `:68-71`). Same shape at
   `functions/src/performance/performanceGoalReadService.ts:217` → `functions/src/performance/performanceGoalCallables.ts:58`.

### 3.4 Company scope must fail closed

| Rule | Status at baseline | Evidence |
|---|---|---|
| The company a read is scoped to is **derived server-side**, never adopted from the caller | Honoured on the finance path and the reorder path | `functions/src/finance/financeReadCallables.ts:57`, `:65-68`, `:120-123`; per-record match `functions/src/finance/financialVisibility.ts:169-170`; provenance `functions/src/finance/financeReadProjection.ts:21-24`; reorder `functions/src/reorderRequest/reorderWarehouseAuthority.ts:57`, client counterpart `field-ops-app-vite/src/services/reorderCallableClient.js:9`,`:99` ("NEVER SENDS operatingCompanyId") |
| A caller-supplied company id may only **narrow**, never widen | Honoured on the finance path by structural ordering (authority predicate computed before any caller filter) | `functions/src/finance/financialReportingRead.ts:272`, `:287`, filters parsed `:400`; rule stated `:16-22`; account variant `functions/src/finance/financeReadCallables.ts:217-231` |
| **A scope that cannot be established is SCOPE UNRESOLVED, never "no results for that company"** | **Honoured in outcome, not in vocabulary.** No-reach returns `status:"unavailable"`, explicitly not a ready empty — but the client renders `unavailable` as a *transport* failure, so a scope failure reads as a network problem | `functions/src/finance/financialReportingRead.ts:239-240`, `:255-259`; callable variant throws `permission-denied` `functions/src/finance/financeReadCallables.ts:222-224`; client mapping `field-ops-app-vite/src/domain/financialFactsView.js:37-52` |
| No arbitrary user-entered company override | **Honoured for read scope.** Company selection is an enumerated governed list, never free text; no URL/query-param override exists | `field-ops-app-vite/src/domain/financialsSurface.js:44-48` (`COMPANY_FILTER_OPTIONS`); one free-text company input exists but it is a **config write, not a read scope**: `field-ops-app-vite/src/modules/administration/AdminEmailCommunications.jsx:411` |
| Postgres/HTTP axis: a stated tenant is **checked**, never adopted | Honoured, and it is the only place in the repo with a genuinely distinguishable scope-refusal vocabulary | `functions/src/adminPolicy/principalContext.ts:111-123`; refusal tokens `:109`,`:117`,`:122`,`:126`,`:128` (`NO_TENANT_MEMBERSHIP`, `TENANT_NOT_A_MEMBERSHIP`, `AMBIGUOUS_TENANT`, `TENANT_NOT_ACTIVE`); surfaced `functions/src/eosOps/eosOpsHttp.ts:98-100` |
| **Exception — one path takes the caller's company as the query scope** | **VIOLATED.** §5.4 V9 | `functions/src/coverage/coverageReadCallables.ts:18-28`, `:51`, `:59` |

**Note on `undefined` scope.** No path queries with `companyId === undefined`: every company filter is
guarded by a `nonEmpty()` predicate and the clause is omitted rather than matched against `undefined`
(`functions/src/finance/financialReportingRead.ts:265`, `:322`; `functions/src/finance/financialVisibility.ts:170`).
The Firestore "silently matches nothing" trap is **not** present at `64008d5a`.

---

## 4. Client contract

### 4.1 The subset rule, over the identifiers that actually exist

The rule is **subset, not equality** — a client that recognises more kinds than the server currently emits
is correct and forward-compatible; equality would force the client to forget kinds.

```
SERVER-EMITTED  ⊆  CLIENT-RECOGNISED
```

| Role | Identifier `file:line` | Members |
|---|---|---|
| Server-emitted (the wire union) | `functions/src/reporting/reportExecutionService.ts:184-189` (`RunReportOutcomeKind`) | 5: `permission-denied`, `empty`, `partially-authorized`, `truncated-widened`, `results` |
| Client's accept-list at the seam | `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:13` (`SERVICE_KINDS`) | the same 5 |
| Client-recognised (the render vocabulary) | `field-ops-app-vite/src/domain/reporting/reportResultState.js:13-16` (`KINDS`) | 10: the 5 above plus `idle`, `loading`, `unsupported`, `failure`, `unavailable` |

**Subset holds at `64008d5a`.** The five extra client kinds are the client's own states (not-yet-run,
in-flight, seam-level unavailability) plus `failure`/`unsupported`, which the client synthesises from
transport codes (`reportRunOutcome.js:69-83`). This is the correct shape and the contract preserves it.

**C1 requirement.** Neither set may shrink to force agreement. A server kind added without a client
rendering is a contract break the client must absorb honestly (§4.2), not a reason to remove client kinds.

### 4.2 An unrecognised or absent kind degrades to an honest unknown. Never to empty.

| Rule | Status | Evidence |
|---|---|---|
| **C2** An unrecognised kind must not render as empty | **Honoured on the report path.** Unknown/absent kind fails closed to `failure`, which renders "This report couldn't run" | `reportRunOutcome.js:43` (`!SERVICE_KINDS.has(data.kind)` → `reportRunFailure()`); `reportResultState.js:19` (unknown → `"failure"`), `:91-93` (`default:` branch) |
| **C3** An unmapped *client* state must not render as blank | **Honoured.** "An unmapped state is reported rather than rendered as nothing — a blank here would be the exact fail-blank defect this component exists to remove." | `field-ops-app-vite/src/shared/ui/HonestState.jsx:227-230` |
| **C4** A malformed payload must not produce rows | **Honoured.** Non-array rows → `null`, not `[]`; non-string labels filtered | `reportRunOutcome.js:47-48`; `reportResultState.js:103-106` |
| **C5** `failure` is the wrong destination for an unrecognised kind | **OPEN.** Degrading to `failure` says "something went wrong, try again" for what is actually "this server speaks a newer dialect". Retryable copy for a non-retryable condition. The *required distinction* is between a failed run and an uninterpretable answer; whether it needs a separate rendering is **OWNER DESIGN DECISION**. | `reportRunOutcome.js:43`; `reportResultState.js:81-84` |
| **C6** A client must never assert a *cause* it did not resolve | **VIOLATED in three places.** §5.5. The rule is already written down in this repo, at `field-ops-app-vite/src/domain/financialsSurface.js:116-126`: *"A page asserting an authority fact it has not resolved is the same defect class as a page inventing a number, even when the error runs conservative."* | `financialsSurface.js:116-126` (the rule); violations §5.5 V11–V13 |
| **C7** A count must never accompany an unknown | **Honoured, and structurally enforced** — the `UNKNOWN` branch has no count slot at all, "so a caller cannot accidentally print a `0` beside a sentence that says the answer is unknown" | `HonestState.jsx:166-181` |
| **C8** A denial must leak nothing about what exists — no counts, no views, no create | **Honoured in the rendering**; asserted by test | `HonestState.jsx:183-190`; `collectionPageState.js:144-149`; test `field-ops-app-vite/test/listsP2StateContract.test.jsx:219` |

### 4.3 Where the client's absence vocabularies live

There are five, and they are complementary, not duplicative. Any implementation must route through the
existing one rather than mint a sixth.

| Vocabulary | Scope | `file:line` |
|---|---|---|
| `HONEST_STATE` (13 ids) | page / section body | `field-ops-app-vite/src/shared/ui/HonestState.jsx:56-70` |
| `COLLECTION_PAGE_STATES` (17 ids, each with `renderedBy`, `reachable`, `awaits`) | collection pages; the contract that binds each id to a real rendering | `field-ops-app-vite/src/shared/ui/collectionPageState.js:79-215` |
| `REFERENCE_STATE` (7 ids) | one resolved reference inside an otherwise-good row | `field-ops-app-vite/src/metadata/referenceResolution.js:42-58`, labels `:67-74` |
| `DROP_REASON` / `DROP_TEXT` | one filter/sort criterion dropped from a URL | `field-ops-app-vite/src/metadata/listUrlState.js:47-56`, `:59-68` |
| report result states (10 kinds) | the report result area | `field-ops-app-vite/src/domain/reporting/reportResultState.js:13-16` |

**Documentation defect, live at baseline.** `HonestState.jsx:5` says "ONE VOCABULARY FOR THE SIX HONEST
STATES" and then declares thirteen (`:56-70`). The header comment is stale by seven ids.

---

## 5. Census of shipped violations at `64008d5a`

**All entries LIVE AT BASELINE.** The census distinguishes four classes:

| Class | Meaning |
|---|---|
| **(A) RENDERS EMPTY on unproven absence** | the false-empty defect proper |
| **(B) RENDERS AN HONEST UNAVAILABLE/DENIED STRING** | honest that it is not empty; may still be terminal, or may mis-attribute the *cause* |
| **(C) RENDERS NOTHING** | a blank region — the worst case |
| **(D) STATE COLLAPSE** | two distinct states rendered identically; no false zero, but a distinction destroyed |

**Census totals — 38 numbered entries.**

| Where | Entries | ids |
|---|---|---|
| Server-side | 5 | V1–V5 |
| Shell / routing | 5 | V6–V10 |
| Gated-but-never-requested (mode 3) | 3 | V11–V13 |
| Scope | 3 | V14–V16 |
| Fabricated cause (C6) | 3 | V17–V19 |
| Measurement | 5 | V20–V24 |
| Client read paths falling to absence | 7 | V25–V31 |
| Blank regions | 7 | V32–V38 |

| Class | Count | ids |
|---|---|---|
| **(A)** renders empty on unproven absence | **7** | V1 (in effect), V14, V25, V26, V27, V28, V29 — plus V30 (dead code) |
| **(B)** honest string, **false cause attribution** | **5** | V6, V7, V17, V18, V19 |
| **(B)** honest and terminal, **no defect** | 7 surfaces | §5.6 |
| **(C)** renders nothing | **7** | V13, V32, V34, V35, V36, V37, V38 |
| **(D)** state collapse | **10** | V1, V2, V3, V4, V5, V8, V10, V15, V16, V33 |
| governance / measurement, not user-facing | **6** | V9, V20, V21, V22, V23, V24 |

Entries appear in more than one class where the defect is genuinely both (V1 is a collapse that produces a
false claim; V13 is a mode-3 leak whose rendering is a blank region). The classes are not a partition and no
total is a sum.

### 5.1 Server-side

| id | Violation | `file:line` | Class |
|---|---|---|---|
| **V1** | **`kind` selection tests `rowCount === 0` first.** A run whose authorization dropped columns, or whose filters were dropped and widened, reports `"empty"` when it happens to return zero rows. The client's `empty` branch then renders *"This report ran successfully but no records matched."* — and that branch **accepts no notes at all** (`d()` is called with no `notes` argument), so even a server that sent `droppedColumnLabels` alongside `kind:"empty"` could not have them rendered. PARTIAL collapses into PROVEN EMPTY. | emitter `functions/src/reporting/reportExecutionService.ts:627-634`; client `field-ops-app-vite/src/domain/reporting/reportResultState.js:27-29` | **D**, and **A** in effect — the sentence claims a successful complete run |
| **V2** | **`blockedScopes` is computed with human-readable reasons and never returned.** e.g. `"no operatingCompany-scoped binding resolves for this principal; a valueless grant confers no reach"`. Zero references under `field-ops-app-vite/src`. A principal holding `finance.visibility.company` with no resolving binding is, at the client, identical to a principal holding nothing. | computed `functions/src/finance/financeReadCallables.ts:131-136`, carried `:59`,`:152`,`:156`,`:167`; `functions/src/finance/financialVisibility.ts:108`,`:155`,`:160`,`:186` | **D** |
| **V3** | **Four DENY reasons collapse to one boolean at the only capability feed.** Deliberate (`:77-82` states the rule), which is why §3.2 separates what may and may not be disclosed rather than asking for all four. | `functions/src/access/effectiveAccessFeed.ts:77-82`, `:232-243`; reasons `functions/src/access/resolveEffectivePermission.ts:61-65` | **D** |
| **V4** | **Reason discarded on the command path too.** The reason is interpolated into a throw and then replaced with generic copy. | `functions/src/access/trustedWriterCommands.ts:429`,`:462` → `functions/src/access/accessCommandCallables.ts:72` (intent at `:68-71`); same shape `functions/src/performance/performanceGoalReadService.ts:217` → `functions/src/performance/performanceGoalCallables.ts:58` | **D** |
| **V5** | **`inactivePermission` cannot distinguish catalogue-inactive from environment-not-activated.** One reason, two causes, one test. | `functions/src/access/resolveEffectivePermission.ts:264-266` | **D** |

### 5.2 Shell / routing

| id | Violation | `file:line` | Class |
|---|---|---|---|
| **V6** | **Every denied subnav item renders one sentence that asserts a role cause: `"<label> isn't available to your role"`.** `isNavItemVisible` returns `false` for at least six distinct causes — no grant (mode 4), catalogue-inactive (1), environment-not-activated (2), never requested (3), unknown id (7), and a feed **error** (mode 8). All six render the same role attribution. This is the highest-traffic honest-absence surface in the product: it is emitted for every hidden item in every domain. | `field-ops-app-vite/src/App.jsx:904-920` (title at `:914`); gate `field-ops-app-vite/src/navigation/navConfig.js:660-686`, capability branch `:652-657` | **B** (not empty) with a **false cause attribution** |
| **V7** | **`hasAnyAccess === false` renders `"your account isn't assigned a role with access yet"`.** Also reached when the authority feed **errored** (settled denial, `reportCapabilityAccess.js:126`) and when the environment has activated nothing. For a production principal today this is the landing state, and the sentence names the wrong cause in at least two of the three ways of reaching it. | `field-ops-app-vite/src/App.jsx:1191-1197`; `hasAnyAccess` computed `:1162` | **B** with a **false cause attribution** |
| **V8** | **`DECISION NOT YET RESOLVED` renders as a bare `Loading...` div** — not `LoadingState`, not `HonestState.LOADING`. It is the correct state (it does not deny), rendered outside the vocabulary. | `field-ops-app-vite/src/App.jsx:1190`; cf. `:1164` for the identical treatment of auth loading | **D** (cosmetic/vocabulary, not a false empty) |
| **V9** | **`deniedDomainIndexItem` is dead code.** Exported at `navConfig.js:699-703` with the docstring *"DENIED must never be presented as EMPTY"*, tested at `field-ops-app-vite/test/domainIndexDenial.test.mjs`, and called by **zero** product files (verified: the only non-test reference in the repo is its own definition). The generalized inline filter at `App.jsx:904` superseded it and nobody removed it. A declaration nothing consumes — the defect `uxMigrationManifest.js:6-15` was written to prevent. | `field-ops-app-vite/src/navigation/navConfig.js:699-703` | not a user-facing violation; a **governance** violation |
| **V10** | **Route-level denial uses `EmptyState variant="filtered"`, not `HONEST_STATE.DENIED`.** The denial is rendered in the empty-state chrome — the same primitive that renders TRUE EMPTY — while the designated rendering exists and is bound to `DENIED` by the shipped contract (`collectionPageState.js:144-149`). | `field-ops-app-vite/src/App.jsx:910-918` | **D** |

### 5.3 Gated-but-never-requested (mode 3) — three live leaks

Each of these surfaces is unavailable to **every** principal, permanently, including a genuine holder,
because the id it gates on is not in the request list threaded to it. The shell's request set is
`REPORT_CAPABILITY_REQUEST` (`field-ops-app-vite/src/access/reportCapabilityAccess.js:30-37`), threaded as
`operationalContext.hasCapability` at `field-ops-app-vite/src/App.jsx:1161`.

| id | Surface | Unrequested id | Gate `file:line` | Mount `file:line` | Class |
|---|---|---|---|---|---|
| **V11** | Administration → Financial Policy | `financialPolicy.profile.read`, `.configure` | `field-ops-app-vite/src/modules/administration/AdminFinancialPolicy.jsx:39-40`, used `:71-72` | `field-ops-app-vite/src/App.jsx:657` | **B** (states unavailability) with a **fabricated cause** — see V14 |
| **V12** | Administration → Warehouse Racking, bin create/change | `inventory.location.bin.manage` (`.read` *is* requested; `.manage` is not) | `field-ops-app-vite/src/modules/administration/AdminWarehouseRacking.jsx:42`, used `:158`, rendered `:323` | `field-ops-app-vite/src/App.jsx:643` | **B** with a **fabricated cause** — see V14 |
| **V13** | Part Detail → "Used In Equipment" | `equipment.compatibility.view` | `field-ops-app-vite/src/domain/equipmentCompatibilitySection.js:13`, `:29-36`; also declared `field-ops-app-vite/src/metadata/definitions/equipmentModel.js:124` | `field-ops-app-vite/src/App.jsx:1070` → `field-ops-app-vite/src/modules/inventory/PartDetail.jsx:1901` → **`field-ops-app-vite/src/modules/inventory/UsedInEquipmentSection.jsx:118`** (`if (!canView) return null;`) | **C — the section renders nothing at all** |

**V13 is the worst single instance in the product** and deserves its full statement, because three independent
mechanisms stack on it: `equipment.compatibility.view` is catalogue-`active:false`, is recorded as
owner/admin-only with gap code `EQUIPMENT_COMPATIBILITY_ENGINE_DRAFT`
(`docs/governance/effective-authority.json`), **and** is absent from the request set the component's gate
reads. So the section is a blank region for **every principal in every environment**, and the file's own
header says it "renders NOTHING (returns null)". This is verbatim the defect `HonestState.jsx:9-11` was
written to close: *"inactive capability flags erase whole sections … so honest security reads as a broken
product."* The rendering it should reach is `HONEST_STATE.NOT_ENABLED` (`HonestState.jsx:192-198`), which
already exists.

**Coverage gap that lets these through.** Nav *is* covered: all 22 `capabilityAccess` ids in `navConfig.js`
are asserted to be in the request set (`field-ops-app-vite/test/navCapabilityConvergence.test.mjs:147-149`).
**In-page gates have no equivalent test.** §6.3.

### 5.4 Scope

| id | Violation | `file:line` | Class |
|---|---|---|---|
| **V14** | **`resolveCoverageForContext` takes the caller's `companyId` as the query scope.** Authorization is one global boolean (`coverage.read`) with no company binding; the read is then `where("companyId", "==", data.companyId)`. A company the caller has no scope for returns `status:"ready"` with zero assignments — **a PROVEN EMPTY claim about a scope that was never established** — and a company that *does* have assignments returns them. This is precisely the trap `functions/src/finance/financialVisibility.ts:1-12` records as closed for finance; it is open here. **Caveat, stated so this is not overclaimed:** `coverage.read` is catalogue-`active:false` and activated in no environment, and `docs/governance/effective-authority.json` records it as owner/admin-only with gap code `COVERAGE_TERRITORY_AUTHORITY_GAP`. No client caller exists. So the defect is **latent**, not live-exploitable — it becomes live the day coverage is activated. | `functions/src/coverage/coverageReadCallables.ts:18-28`, `:51`, **`:59`** | **A**, latent |
| **V15** | **A scope failure is rendered as a transport failure.** `readFinancialFacts` with no reach returns `status:"unavailable"` (correctly refusing a ready empty), and the client maps `unavailable` to `HONEST_STATE.UNAVAILABLE`, whose copy is about a read that failed and offers reassurance about other work. The operator is told the server had a problem when in fact their scope has no binding. | server `functions/src/finance/financialReportingRead.ts:239-240`, `:255-259`; client `field-ops-app-vite/src/domain/financialFactsView.js:37-52`; rendering `field-ops-app-vite/src/shared/ui/HonestState.jsx:200-215` | **D** |
| **V16** | **`unauthenticated` falls through to UNAVAILABLE, not DENIED.** Only `permission-denied` is classified as a denial. | `field-ops-app-vite/src/domain/accountArView.js:28-32` | **D** |

### 5.5 Clients asserting a cause they did not resolve (violations of C6)

| id | Violation | `file:line` | Class |
|---|---|---|---|
| **V17** | `"It needs <code>{capability}</code>, which is not active for this environment and is not granted to any role yet."` — **hard-coded**. The client has no signal for either clause (the feed is boolean-only), and the capability it names is not even in the request set (V12). The sentence is an authorial claim that will keep rendering, unchanged, after the environment activates the capability or a role is granted it. | `field-ops-app-vite/src/modules/administration/AdminWarehouseRacking.jsx:67-73` | **B** with a **fabricated cause** |
| **V18** | The same sentence, same construction, for `financialPolicy.profile.*` (V11). | `field-ops-app-vite/src/modules/administration/AdminFinancialPolicy.jsx:42-48` | **B** with a **fabricated cause** |
| **V19** | `"<label> isn't available to your role"` / `"your account isn't assigned a role with access yet"` — see V6, V7. Same defect class, far larger blast radius. | `field-ops-app-vite/src/App.jsx:914`, `:1194-1196` | **B** with a **fabricated cause** |

**This rule is already settled in this repo**, and V17–V19 are the surfaces that have not caught up.
`field-ops-app-vite/src/domain/financialsSurface.js:116-126` records the correction verbatim, having
*removed* exactly this kind of sentence from the Financials family after it was found to be false in
platform-sandbox; and `field-ops-app-vite/test/financialsSurface.test.mjs:159` pins it — but only for
Financials pages. Nothing pins it globally. §6.5.

### 5.6 Honest but terminal

Recorded separately because these are **not** defects of honesty. They are honest statements that the
surface has nowhere to go, and they are the correct behaviour until the thing behind them exists.

| Surface | String | `file:line` |
|---|---|---|
| Report run seam, engine unreachable | `"Running reports isn't available yet. Nothing was read or changed."` | `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js:27`, rendered `field-ops-app-vite/src/domain/reporting/reportResultState.js:85-88` |
| Unbuilt destinations | `"This area isn't built yet…"` | `field-ops-app-vite/src/navigation/PlaceholderPage.jsx:31`, fall-through `field-ops-app-vite/src/App.jsx:829`, future domains `:1132` |
| Financials, surface issues no read | `READ_STATE_DETAIL.noReadOnSurface` | `field-ops-app-vite/src/domain/financialsSurface.js:134-135`, `:147` |
| Financials, no read callable exists | `READ_STATE_DETAIL.notWired` | `field-ops-app-vite/src/domain/financialsSurface.js:136-137`, `:152-155` |
| Parts planning, function not deployed here | `"Parts planning is not available in this environment."` | `field-ops-app-vite/src/hooks/useWorkOrderPartsPlan.js:51-54` |
| Report builder, object with no report definitions | `"(coming soon)"` on a **disabled, visible** option — "honest about what exists" rather than hidden | `field-ops-app-vite/src/domain/reporting/reportBuilderModel.js:19`, `:25`; rendered `field-ops-app-vite/src/modules/reporting/ReportBuilder.jsx:139-140` |
| Build-time readiness | `"transport-not-ready"` | `field-ops-app-vite/src/services/partAliasCallableClient.js:43` |

**One stale claim inside this group.** `reportRunOutcome.js:22` and `reportResultState.js:86` both describe
the report engine as undeployed ("the not-deployed case", "the trusted engine isn't deployed yet"), and
`App.jsx:1153-1154` says "the callable is undeployed". But `runReportDefinitionCallable` **is** exported at
`functions/src/index.ts:183` (defined `functions/src/reporting/runReportDefinitionCallable.ts:24`). Whether
it is deployed to `taylor-parts` is **UNPROVEN** from source — deployment is an environment fact, not a
source fact, and this lane makes no production contact. The comments assert a deployment state they cannot
know, which is the same defect class as V17.

### 5.7 Measurement defects that feed false-absence reporting

| id | Defect | `file:line` | Why it belongs in this census |
|---|---|---|---|
| **V20** | **`docs/architecture/capability-graph.json` reports `catalogActive: 0, catalogInactive: 147`.** Wrong for 38 entries. The parser tests `/\bactive:\s*true/` (`scripts/buildCapabilityGraph.mjs:91`) but no catalogue entry carries `active: true` — active entries simply **omit** the field, and the resolver reads `active !== false` (`functions/src/access/permissionCatalog.ts:1695`). **The wrong figure is pinned by a drift test** (`functions/test/capabilityGraphDrift.test.mjs:62-63`), so correcting the parser fails the build until the artifact is regenerated. | `scripts/buildCapabilityGraph.mjs:91`; `docs/architecture/capability-graph.json`; `functions/test/capabilityGraphDrift.test.mjs:62-63` | "zero capabilities are active" is a false-absence claim about the platform itself |
| **V21** | `docs/governance/effective-authority.json` reports `{total:147, active:38, inactive:109}` — **correct**, and contradicts V20. It has **no drift test**: the correct artifact is unguarded while the wrong one is guarded. | `docs/governance/effective-authority.json`; generator `functions/scripts/governance/effectiveAuthority.mjs:104`, `:108` | two committed answers to one question |
| **V22** | `permissionDecisionCopy.js` — the only denial-explanation surface in the product — has **no consumer** (the only non-test references are its own definition and a comment in `field-ops-app-vite/src/access/navPermissionPreview.js:8`), **and omits `inactivePermission` from its table**, so `DEFAULT_DENIAL_EXPLANATION` would report an activation problem as `"No active, currently-valid Role grants this permission for the selected scope."` If wired as-is it would mis-attribute modes 1 and 2 as mode 4. | `field-ops-app-vite/src/domain/permissionDecisionCopy.js:7-13`, `:20` | the fix for V3, half-built and wrong |
| **V23** | `roleAccessModel.js` can never report a capability as held by nobody, because `admin` is in the roster it checks (`state: "nobody"` requires `holders.length === 0`). The same vacuity is in the backend guard: `functions/test/resolveEffectivePermission.test.mjs:74-78` derives `SEEDED_GRANTED_IDS` from `ADMIN_ROLE.permissions`, which since the 2026-08-19 ruling is the whole catalogue, so the assertion at `:160` is trivially satisfied. | `field-ops-app-vite/src/access/roleAccessModel.js:264`, `:270`; roster `field-ops-app-vite/src/modules/administration/AdminObjects.jsx:49`; `functions/test/resolveEffectivePermission.test.mjs:74-78`, `:160` | **"an admin can see it" is not evidence a surface is reachable** — and this is the code that turns that fallacy into a green test |
| **V24** | **`OWNER_ACTIVE_REPORT_PERMISSIONS` evaluates to the empty array.** It is derived as `PERMISSION_CATALOG.filter(p => p.id.startsWith("report.") && p.active !== false)` — and **all 39 `report.*` entries are `active: false`** (verified by per-entry parse, method in §5.7 note). So the Owner Role's report grant is empty, while `governedBusinessRoles.ts:955` still describes Owner as holding "every active wave-1 report.* object/field capability … The only Role with report access today" and `:62-65` still says it is "the ONLY Role … that holds any report.* id". Both are stale: the derivation yields nothing, and `REPORT_VIEWER_ROLE` (`:1373`+) holds report ids by literal list. | derivation `functions/src/access/governedBusinessRoles.ts:66-68`; stale claims `:62-65`, `:955`; other holder `:1373`+; catalogue `functions/src/access/permissionCatalog.ts` (39/39 `report.*` inactive) | the production adoption of 25 `report.*` ids (§5.8) lifts activation for capabilities whose only literal holders are `admin` and an unassigned `reportViewer` — mode 4 in its purest form |

**Counting method for the catalogue figures used above.** Parsed `functions/src/access/permissionCatalog.ts`
at `64008d5a`: located every line matching `^\s+id: "`, treated the span to the next such line as one
entry, and tested each span for a property line matching `^\s+active: false,?\s*$`.
Result: **147 entries; 109 carry `active: false`; 38 carry no `active` key; 0 carry `active: true`.**
`report.*`: **39 entries, 39 inactive, 0 active.** This is a catalogue count, not an ALLOW count, and it is
method-dependent: a naive `grep -c "active: false"` over the same file returns **119**, because ten
occurrences are inside comments. That eleven-count gap is exactly the failure mode the lane brief warns
about, reproduced here on purpose so the method is checkable.

### 5.8 The production picture, and why this contract is not cosmetic

| Fact | Evidence | Consequence for absence |
|---|---|---|
| `capabilityActivationOverrides` is **inert in production by construction** — `role === "production"` returns EMPTY unconditionally, ignoring registry data | `functions/src/access/environmentCapabilityOverrides.ts:354`; hard-block rationale `:16-25`; the production entry carries no such key `:664-666` | every `active:false` capability resolves `inactivePermission` in production through this path |
| `productionCapabilityActivations` is a **different field with a different resolver**, and holds **25** entries on the `taylor-parts-production` environment (`firebase.projectId: "taylor-parts"`), all `report.*`, adopted despite their catalogue `active:false` | field `functions/src/access/environmentCapabilityOverrides.ts:313`, contract `:303-311`; data `:679-705` (25 ids); resolver `:734-759`; eligibility allow-list `:52-78`; environment identity `config/environments.json:257`, `:258`, `:266` | reporting is the **only** family activated in production |
| The two fields **compose in one place** — but **not as a union**, despite the comment | `functions/src/access/environmentCapabilityOverrides.ts:761-778`; line **`:777`** is `cachedOverrides = production.size > 0 ? production : nonProduction;` while the comment at `:773-776` calls it "the union". Functionally equivalent today because each resolver refuses the other's role, so exactly one can be non-empty — but the code is a **preference, not a union**, and the comment is wrong about its own line | a reviewer trusting the comment would reason about overlap that the code does not compute |
| Production role occupancy: **one** principal holds any active `roleAssignment` (`admin@global`), and the committed census records `heldByNobody: 0` alongside **21** owner/admin-only capabilities | `be1e5579` (`docs(access): R-32 production exposure census — zero exposed principals (#1752)`), verified an ancestor of `64008d5a` by `git merge-base --is-ancestor`; `docs/governance/effective-authority.json` (`ownerAdminOnly.total: 21`, `heldByNobody: 0`) | **for a real production user today, NOT AUTHORIZED is the true state of most surfaces.** Which makes V6, V7, V17, V18 and V19 — the five surfaces that attribute that state to a missing *role assignment* or to a *named capability's activation* — the sentences a real operator actually reads. |

**Correction to the lane brief.** The brief states "Production role occupancy is ZERO" and "2 `roleAssignments`,
one principal `admin@global` with `employeeId: null`". The census commit message records *"Exactly one
principal holds any active RoleAssignment (admin@global)"* and *"The two production managers carry their
operational role and NO RoleAssignment whatsoever"*. So: **governed-role occupancy is effectively zero for
every business role, but not literally zero overall** — `admin@global` is a real assignment. The
`employeeId: null` detail and the "2 roleAssignments" figure are **UNPROVEN** from source at `64008d5a`
(they are live-data facts; this lane makes no production contact). The operative conclusion the brief draws
is unaffected and is confirmed: no production principal holds a governed business Role.

### 5.9 Client read paths that fall to absence on a failed or refused read (class A)

These are the false-empty defect proper on the client: a `catch`, a `?? []`, or a shared branch that turns a
refusal or a failure into zero rows.

| id | Violation | `file:line` | Class |
|---|---|---|---|
| **V25** | **A denied or failed warehouse read becomes "no warehouses".** `loadWarehouses().then(rows => setWarehouses(rows ?? [])).catch(() => setWarehouses([]))` — there is no error state and no `listError` for this read, so the warehouse `<select>` renders with only its placeholder and the administrator concludes the tenant has no warehouses. **The same file fixed the same defect one function down**: `refreshBins` sets `bins` to `null` plus a `listError` under the comment *"A refused read is a refusal, never an empty rack."* The warehouse read did not get the fix. | violation `field-ops-app-vite/src/modules/administration/AdminWarehouseRacking.jsx:185-190` (`.catch` at `:189`); the correct pattern beside it `:193-205` (comment `:199`) | **A** |
| **V26** | **A failed warehouse-scope read silently removes every per-location goal tile.** `.catch(() => { setIds([]); setNameById({}); })`, under the comment *"Fail closed, **quietly**: the person still sees everything else."* Quietly is the defect: the viewer sees a dashboard with fewer goals and no statement that any are missing. Failing closed is right; failing *silently* converts a read failure into a claim that those locations have no goals. | `field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx:152-155` (`.catch` at `:154`) | **A** |
| **V27** | **Global search asserts "No matches" over a list that may be empty because the read was denied or is in flight.** `results.length === 0` → `No matches for "<query>"`, with no loading state, no failure state and no scope sentence. Its only mount passes `{ parts: catalogRows }`, and `catalogRows` is `[]` both while loading and when the canonical Parts read is blocked. So a denied Parts read makes the header search state that a part which exists does not. `HONEST_STATE.SEARCH_ZERO` exists precisely for this and takes a `scope` prop (`HonestState.jsx:126-145`, contract `:74-77`: *"a search that quietly covers less than it appears to is how somebody concludes a record does not exist"*). | `field-ops-app-vite/src/shared/search/GlobalSearch.jsx:60-61`; mount and empty-on-blocked source `field-ops-app-vite/src/modules/inventory/PartsList.jsx:982`, `:435-439` | **A** |
| **V28** | **A throwing capability resolver silently narrows the transfer list's scope.** `try { dispatches = hasCapability(...) === true } catch { dispatches = false }` then switches the source from SHARED to MY_TRUCK. The operator gets a narrower list with no statement that the scope changed; the short or zero result reads as "no transfers are waiting". | `field-ops-app-vite/src/modules/scan/TransferScan.jsx:101-102`, list render `:187-188` | **A** |
| **V29** | **Operations panels claim "nothing recorded yet" for a `null` snapshot.** `consumptionSnapshot?.parts.slice(0,5) ?? []` → *"No parts usage recorded yet."*; `(technicianVolume ?? []).slice(0,5)` → *"No assigned Work Orders recorded yet."* Currently masked by a page-level loading/error guard at the caller, but the component itself cannot distinguish, and two sibling panels take no `loading`/`error` prop at all. | `field-ops-app-vite/src/modules/operations/panels/ExecutionInsightsPanel.jsx:9-10`, `:18`, `:42`; siblings `field-ops-app-vite/src/modules/operations/panels/ProcurementPanel.jsx:29`,`:62` and `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx:87`; caller guard `field-ops-app-vite/src/modules/operations/Operations.jsx:166`,`:175` | **A**, latent behind a caller guard |
| **V30** | *"No planned parts across current Work Orders."* derived from a `workOrders` prop with no `error`/`loading` companion. **Dead code** — the component has no importer — so it is a latent template, not a live violation. Recorded because it will be copied. | `field-ops-app-vite/src/modules/controlTower/panels/PartsOverviewPanel.jsx:56`, `:65` | **A**, dead |
| **V31** | Raw error message rendered to the user, with no `role="alert"` and bypassing `FailureState`/`loadErrorMessage` — the one place in the client that leaks a backend sentence. | `field-ops-app-vite/src/modules/operations/Operations.jsx:179` | not an absence defect; recorded as adjacent |

### 5.10 Blank regions (class C)

A capability or environment fact that removes a region with no trace. Ordered by blast radius.

| id | Violation | `file:line` | Notes |
|---|---|---|---|
| **V32** | **Dashboard modules are removed from the composition before they can reach a state.** `DASHBOARD_MODULES.filter(m => m.needs(ctx) === true)`, with `catch { return false }`, then `.filter(s => s.modules.length > 0)` drops whole sections. A module the viewer does not hold **never reaches `MODULE_STATE`**, so it never renders a blocked tile — and a malformed context deletes modules with the same silence (*"the dashboard shows less, never more"*). Only the all-empty case gets copy. This is the most systemic class-C instance: it is the composition step, not a rendering. | `field-ops-app-vite/src/domain/dashboardComposition.js:469-477` (the `catch` at `:473-477`), section drop `:494`; representative gates `:190`, `:211`, `:349`, `:390`; all-empty copy `field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx:649-659` | see V33 for the tension |
| **V33** | The same file argues the omission is correct: *"A section with no modules is OMITTED: an empty 'Team performance' heading on a technician's screen would imply a team they do not have"* (`:466-467`). **That argument is right for NOT APPLICABLE and wrong for NOT AUTHORIZED / CAPABILITY NOT ACTIVATED** — and the code cannot tell which it is in, because `needs()` returns a boolean. Whether a withheld module is stated or omitted is **OWNER DESIGN DECISION** (§7 O10); that the code cannot currently distinguish the two cases is engineering's. | `field-ops-app-vite/src/domain/dashboardComposition.js:466-467`, `:469-477` | **D** — the distinction is unavailable |
| **V34** | **A record-page region whose sections were all hidden by capability renders no container**, and the comment concedes it: *"A region whose only section(s) were hidden by capability is empty in the SAME sense as a region nothing was ever placed in … both render no container."* Only *total* page denial gets an honest string (`:697-708`). | `field-ops-app-vite/src/metadata/MetadataRecordPage.jsx:723-729`; field-group variant `:268`; embedded-page total denial `:697` | **C** |
| **V35** | Environment-not-activated → blank: `if (!isPolicyApiConfigured()) return null;` in two surfaces. `isPolicyApiConfigured()` is a build/env fact (`policyApiBaseUrl() !== null`). Mitigated only because the callers wrap it in a notice; the components themselves state nothing. | `field-ops-app-vite/src/modules/administration/AdminPolicySurfaces.jsx:122`, `:459`; caller mitigation `field-ops-app-vite/src/modules/administration/AdminObjects.jsx:310`, `field-ops-app-vite/src/modules/administration/AdminRolesPermissions.jsx:191` | **C**, mitigated |
| **V36** | Three governed actions vanish for a non-assignee with no statement of why (`if (!isAssignee) return null;`). An identity fact rendered as absence. | `field-ops-app-vite/src/modules/inventory/PartDetail.jsx:250`, `:708`, `:915` | **C** |
| **V37** | Capability denial removes the rail notification bell entirely (`if (!canSeeReorderRequests) return null;`). Defensible for chrome; recorded because it is a capability-driven `return null` and the file states the intent. | `field-ops-app-vite/src/shared/ui/NotificationControl.jsx:108` | **C**, arguably correct |
| **V38** | Unrecognised related-list `listId` falls through to `return null` — a blank section slot with no diagnostic. A config error rendered as absence. | `field-ops-app-vite/src/modules/accounts/AccountDetail.jsx:572` | **C** |

**Deliberate absent-on-clean bands, recorded as NOT violations.** `if (total === 0) return null` on attention
bands is the correct behaviour (an attention band with nothing to say should not occupy space), and each is
downstream of a page-level loading/error guard;
`field-ops-app-vite/src/modules/accounts/AccountAttentionSection.jsx:123` additionally requires both source
reads proven ready and untruncated. Also:
`field-ops-app-vite/src/modules/controlTower/panels/WorkOrderAttentionPanel.jsx:68`,
`field-ops-app-vite/src/modules/controlTower/panels/DispatchQueuePanel.jsx:30`,
`field-ops-app-vite/src/modules/accounts/ImportedServiceHistoryBlock.jsx:49`,
`field-ops-app-vite/src/modules/mobile/FieldMode.jsx:410`.

### 5.11 What is already correct, recorded so the census is not read as a verdict on the whole client

The honest-absence discipline is genuinely present in most of the product, and the strongest compliance is
worth naming because it is where the repair patterns already exist:

| Surface | Why it is correct | `file:line` |
|---|---|---|
| The central list presenter | `EMPTY`/`FILTERED` → EmptyState, `DENIED`/`UNAVAILABLE` → FailureState, and an unhandled state falls through to UNAVAILABLE *"rather than to a blank region"* | `field-ops-app-vite/src/metadata/MetadataListGrid.jsx:43-44` (the rule), `:51`, `:73`, `:78` (the branches) |
| The older combined primitive | `failed` is checked **before** `isEmpty` | `field-ops-app-vite/src/shared/ui/LoadingEmptyState.jsx:36-39` |
| Financials family | `state: "NOT_ENABLED"` with *"this workspace reports no counts, not zero counts"* | `field-ops-app-vite/src/domain/financialsSurface.js:133-155`; pages `field-ops-app-vite/src/modules/financials/FinancialsReports.jsx` and siblings |
| Scheduling | both source reads propagate their errors (`error: woError ?? techError ?? null`), so one failed read cannot present as an empty board | `field-ops-app-vite/src/hooks/useSchedulingData.js`; consumers `field-ops-app-vite/src/modules/scheduling/SchedulingWorkspace.jsx:196`,`:257`,`:352` |
| Scan workflows | `empty: available.length === 0` — *"which must be SAID, not left blank"* | `field-ops-app-vite/src/access/scanWorkflows.js:246` |
| Administration, undeployed read path | a full paragraph naming what is not deployed | `field-ops-app-vite/src/modules/administration/AdministrationUnavailable.jsx` |
| Dashboard preview lists | `UNKNOWN` is not empty | `field-ops-app-vite/src/modules/dashboard/PreviewList.jsx:26-34` |

### 5.12 Adoption gap — the vocabulary exists; the adoption does not

**Two methods, two answers. Both are reported, because the gap between them is the point.**

| Measure | Loose method | Strict method |
|---|---|---|
| Product files using `HonestState` | **26** | **22** |
| Product files rendering `EmptyState`/`FailureState` **directly** | **50** | **34** (plus **8** via `LoadingEmptyState`, a third and older path) |
| Direct renderers that do **not** use `HonestState` | **42** | **31** |
| Files in both sets | — | **3** (`MyDashboard.jsx`, `PartDetail.jsx`, `TruckInventory.jsx`) |

- **Loose method:** `grep -rl` for the bare identifier across `field-ops-app-vite/src/**/*.{js,jsx}`, minus the
  six `shared/ui` primitive and contract files. Counts comments and re-exports.
- **Strict method:** `grep -rl "from .*HonestState"` for imports, and JSX-element occurrences
  (`<EmptyState`, `<FailureState`) for renderers.

**The strict number is the one to act on, and the important finding is not the number at all: of the 31
strict non-adopters, 26 already keep DENIED / UNAVAILABLE apart from EMPTY by hand** — each has an explicit
denial or error branch *before* its zero-rows branch. They are architecturally un-migrated and behaviourally
honest. The violations are V25–V38, not the 31.

**So the adoption gap is a durability risk, not a live falsehood.** Each of the 26 re-implements the
discrimination locally, which is exactly the condition under which V25 happened twice in one file (`.catch`
→ `[]` for warehouses; `null` + `listError` for bins, forty lines apart). §6.2 specifies the test that makes
this mechanical instead of a reading exercise. A file-by-file adjudication is **not** in this document, and
no number here is asserted as a count of false empties.

### 5.13 A readiness flag that gates nothing

`TRUSTED_COMPLETION_ENABLED` is defined from `__APP_READINESS__` and has **zero consumers** under
`field-ops-app-vite/src` (`field-ops-app-vite/src/config/trustedCompletion.js:13`). Either dead, or a surface
that lost its gate — and the second case would mean a readiness gate silently open. Which one it is is
**UNPROVEN** at `64008d5a`; resolving it needs the history of the file, not its current contents.

---

## 6. Acceptance proofs

Tests are **named and specified**, not written. No product change is proposed or made by this lane.
Registration mechanics that any new suite must satisfy at `64008d5a`:

- `field-ops-app-vite/test/*.test.mjs` must be listed in `field-ops-app-vite/test/suites.json`
  (290 entries) or named by a workflow, or `field-ops-app-vite/test/ciSuiteCoverage.test.mjs:153` fails.
- `field-ops-app-vite/test/*.test.jsx` must be named by a `.github/workflows/*.yml`, or
  `ciSuiteCoverage.test.mjs:95` fails; adding to its `KNOWN_UNNAMED` allowlist is forbidden (`:105`).
- `functions/test/*` has **no manifest**: a new suite must be appended to a `test:*` script in
  `functions/package.json` **and** reached by a workflow path filter.

### 6.1 Per state

| State | Proof obligation | Closest existing test (extend, don't duplicate) |
|---|---|---|
| NOT YET RUN | the idle rendering issues no `aria-live` and shows no spinner | `field-ops-app-vite/test/listsP2StateContract.test.jsx:171` (`IDLE is not LOADING…`) |
| IN FLIGHT | distinct from idle and from empty | same suite, `:155` |
| DECISION NOT YET RESOLVED | a deep link to a capability-gated route survives a pending decision, and the state renders inside the vocabulary (closes V8) | `field-ops-app-vite/test/reportCapabilityAccess.test.mjs:104`; routing half is **UNPROVEN** — no test asserts `App.jsx:1190`'s rendering |
| PROVEN EMPTY (TRUE EMPTY) | emitted only when every gate passed **and** scope was bound (closes V1) | `functions/test/reportExecutionService.test.mjs:297` asserts zero rows → `empty`; it must be **extended** with the partially-authorized-and-zero-rows case, which no test covers today |
| EMPTY VIEW / SEARCH ZERO / FILTER ZERO | four sentences stay four; FILTER_ZERO invents no denominator | `field-ops-app-vite/test/listsP2StateContract.test.jsx:184`, `:199`, `:204` |
| NOT AUTHORIZED | a denial never renders as empty and leaks no count | `functions/test/reportExecutionService.test.mjs:183`, `:200`; `field-ops-app-vite/test/listsP2StateContract.test.jsx:219`; `field-ops-app-vite/test/partLookup.test.mjs:94` |
| CAPABILITY NOT ACTIVATED | **new.** A capability that is catalogue-inactive, or active-but-not-activated-here, is reported to the client as a *third* value distinct from allowed and from withheld — and the surface says "not switched on here", not "not your role" | server half: `functions/test/environmentCapabilityOverrides.test.mjs:180`, `:185`, `:401`, `:420`, `:463` and `functions/test/financialVisibilitySandboxActivation.test.mjs:57`, `:66` already prove the *resolution*. **No test asserts the fact reaches a client**, because it cannot. |
| SCOPE UNRESOLVED | **new.** A no-reach read is reported as a scope fact, not as `unavailable` (closes V15); and a company id the caller cannot reach never returns `status:"ready"` (closes V14) | `functions/test/fin004ReachComposition.test.mjs:347` (`TEAM with an unresolved team reaches nothing, and never widens`), `:383`; `functions/test/financialReportingRead.test.mjs:96`, `:131`. **Nothing covers `coverageReadCallables.ts:59`.** |
| FAILED | a failed read is not a denial, and the server's own reason survives verbatim | `field-ops-app-vite/test/sharedStates.test.mjs:17`; `field-ops-app-vite/test/financialFactsView.test.mjs:76` (`denial, failure, emptiness and readiness are four distinct states`) |
| PARTIAL | truncation is never a confident partial; and PARTIAL never collapses into EMPTY | `functions/test/financialReportingRead.test.mjs:265`, `:272`; `functions/test/reportTruncationHonesty.test.mjs:53`. **The collapse case (V1) is uncovered.** |
| NOT IMPLEMENTED | an unreachable state names the authority it awaits; "not built yet" is never an acceptable value | `field-ops-app-vite/test/listsP2StateContract.test.jsx:113`; validator `field-ops-app-vite/src/shared/ui/collectionPageState.js:255-262` |
| NOT REQUESTED | **new.** See §6.3 — it must be a build failure, so the proof is a static test, not a render test |

### 6.2 The adoption test (closes §5.12, V25–V31 mechanically)

**`honestAbsenceAdoption.test.mjs`** — for every file that renders `EmptyState` without routing through
`HonestState`, assert the empty branch is reached only from a *settled, successful* read. The three source
patterns it must fail on are exactly the ones V25–V31 are made of:

| Pattern | Live instance |
|---|---|
| a `.catch` whose handler sets a collection to `[]` or `{}` | `field-ops-app-vite/src/modules/administration/AdminWarehouseRacking.jsx:189`; `field-ops-app-vite/src/modules/dashboard/MyDashboard.jsx:154` |
| `?? []` / `\|\| []` on a value that can be `null` because the read failed or was refused | `field-ops-app-vite/src/modules/operations/panels/ExecutionInsightsPanel.jsx:9-10` |
| a zero-length test on a collection whose source is `[]` while loading **or** while blocked | `field-ops-app-vite/src/shared/search/GlobalSearch.jsx:60-61` against `field-ops-app-vite/src/modules/inventory/PartsList.jsx:435-439` |

Model it on the existing derive-from-source discipline of
`field-ops-app-vite/src/metadata/uxMigrationManifest.js:130-190` (`evaluateMigration` reads the screen's own
source; there are no booleans to tick) and on `field-ops-app-vite/test/ciSuiteCoverage.test.mjs:105`'s
shrink-only allowlist — the exemption list may only get smaller. The 26 hand-rolled-but-honest non-adopters
(§5.12) are the initial allowlist; they pass on behaviour and are migrated by attrition.

### 6.2a The no-blank-region test (closes V13, V32–V38)

**`capabilityDrivenBlankRegion.test.mjs`** — assert that no `return null` is reached from a capability or
environment predicate. The decidable rule: a `return null` whose guard reads `hasCapability(...)`,
`canView`/`canRead`/`canManage`, `isPolicyApiConfigured()`, or a `needs(ctx)` result must instead reach a
state in the vocabulary of §4.3. Deliberate absent-on-clean bands (guard reads a **count**, not an
authority) are out of scope and must be excluded by that distinction, not by an allowlist. The composition
case (V32) needs its own assertion, because the module never reaches a rendering at all: assert that
`composeDashboard` produces a module for every declared module and marks the withheld ones, rather than
filtering them out — the `MODULE_STATE`/`blocker` machinery it already carries is unreachable for exactly the
modules that most need it. `MODULE_STATE` is declared at
`field-ops-app-vite/src/domain/dashboardComposition.js:51-77` and already has a `GATED` member documented as
*"The authority exists; a NAMED activation or grant does not. Renders with its blocker."* (`:77`); every
module is mapped with `state` and `blocker` at `:478-488` — **after** the filter at `:470-477` has already
discarded the withheld ones. The consequence is precise: `GATED` is reachable, but only for a viewer who
*holds* the capability and is blocked for some *other* reason (the one live instance, `governedStockPosition`
at `:344-351`, needs `inventory.balance.read` and is GATED because no governed location total exists). A
viewer who lacks the capability is filtered out before `state()` is ever called, so the one state built to
say "your authority is missing" is the one state an authority-missing viewer cannot see. Existing partial
coverage to extend, not duplicate:
`field-ops-app-vite/test/dashboardComposition.test.mjs:36` (`a module whose scope the viewer does not hold is
ABSENT, not empty`) and `:320` (`the four absences stay four`) — note that the first test **ratifies** the
omission, so changing V32 is a contract change, not a bug fix, and needs O10 answered first.

### 6.3 The mode-3 test (closes V11–V13)

**`inPageCapabilityConvergence.test.mjs`** — extend `field-ops-app-vite/test/navCapabilityConvergence.test.mjs:147-149`
from `navConfig.capabilityAccess` to **every** capability id referenced by in-page gate code
(`hasCapability(...)`, `readCapability:`, `capabilityRequirement:`), asserting membership in the request list
actually threaded to that component. Known false-positive shapes to exclude, both lexically identical to a
capability id: KPI metric keys (`field-ops-app-vite/src/domain/dashboardComposition.js:524-528`, e.g.
`service.workOrder.pastDue.count`) and report field ids (`field-ops-app-vite/src/modules/reporting/SavedReports.jsx:39`).

### 6.4 The mode-7 test (closes the gap at §2.1 row 7)

**`uiCapabilityIdsExist.test.mjs`** — every dotted id in UI gate code resolves via `findPermission`. Today
only *role definitions* are covered (`functions/test/governedBusinessRoles.test.mjs:415`;
client mirror `field-ops-app-vite/test/permissionCatalogRoleParity.test.mjs:86`), so a typo in
`hasCapability("inventroy.transfer.create")` is caught by nothing and is indistinguishable from mode 3.

### 6.5 The no-fabricated-cause test (closes V17–V19)

Generalise `field-ops-app-vite/test/financialsSurface.test.mjs:159` (`no Financials page asserts a
capability's activation state in rendered copy`) from the Financials family to **every** rendered string:
no rendered copy may assert an activation state, a grant state, or a deployment state that the rendering
path did not resolve. The rule is already written in prose at
`field-ops-app-vite/src/domain/financialsSurface.js:116-126`; this makes it executable.
The **replacement wording** for V6/V7/V17/V18 is **OWNER DESIGN DECISION** (§7).

### 6.6 The subset test (closes C1 as a standing invariant)

Assert `RunReportOutcomeKind ⊆ SERVICE_KINDS ⊆ KINDS`, as a **subset** in that direction, and that an
unrecognised kind degrades to an honest non-empty state. The client halves already exist
(`field-ops-app-vite/test/reportRunOutcome.test.mjs:56`; `field-ops-app-vite/test/reportResultState.test.mjs:107`);
**the cross-tier subset assertion does not** — nothing at `64008d5a` compares the server union to the client
sets, so a server kind added without a client rendering would ship silently.

### 6.7 The measurement tests (close V20–V23)

| Proof | Target |
|---|---|
| `catalogActive` counts entries where `active !== false`, not where `active: true` is written | `scripts/buildCapabilityGraph.mjs:91`; the drift pin at `functions/test/capabilityGraphDrift.test.mjs:62-63` must be regenerated in the same change, or it blocks the fix |
| `docs/governance/effective-authority.json` gains a drift test of the shape `capabilityGraphDrift` already has | `docs/governance/effective-authority.json` (currently unguarded) |
| "held by nobody" is computed over the roster **excluding** privileged roles | `field-ops-app-vite/src/access/roleAccessModel.js:264`,`:270`; `functions/test/resolveEffectivePermission.test.mjs:74-78` |
| `OWNER_ACTIVE_REPORT_PERMISSIONS` is asserted non-empty, **or** the stale comments are corrected | `functions/src/access/governedBusinessRoles.ts:66-68`, `:62-65`, `:955` |

---

## 7. What this does **not** decide

Every item here is the Owner's product judgement, not an engineering consequence.

| # | Open decision | Why it is not engineering's |
|---|---|---|
| **O1** | **Every user-facing sentence.** This document approves no copy. Where wording is load-bearing it is named as load-bearing and left open. | **OWNER DESIGN DECISION** |
| **O2** | **What a denial is allowed to say.** §3.2 shows that separating "not switched on here" from "not your role" needs no disclosure of Roles, Scopes or assignments — so the *security* objection to S3 does not apply to that one widening. Whether to take it, and whether the sentence may name the capability id (as V17/V18 do today, without evidence), is the Owner's. | trades operator clarity against surface area; not a technical question |
| **O3** | **Whether an unrecognised server kind gets its own rendering** or keeps degrading to `failure` (C5). Engineering's only requirement is: not empty, and not a retryable claim for a non-retryable condition. | **OWNER DESIGN DECISION** |
| **O4** | **Whether held-only-by-admin gets any user-facing state at all.** It is a *readiness* fact about the product, not a state of one user's query. Per-user, NOT AUTHORIZED is already truthful. Surfacing "nobody but an administrator can reach this" is a roadmap-transparency decision. | product transparency, not correctness |
| **O5** | **Whether SCOPE UNRESOLVED is one state or several** (no binding / ambiguous binding / inactive binding). The Postgres axis already distinguishes four (`functions/src/adminPolicy/principalContext.ts:109`,`:117`,`:122`,`:126`,`:128`); the Firestore axis distinguishes none. Whether the Firestore axis needs the same granularity is a product call. | **OWNER DESIGN DECISION** |
| **O6** | **Whether `deniedDomainIndexItem` is deleted or wired** (V9). Engineering's requirement — a denial has somewhere to be said — is already met by `App.jsx:904`. Keeping a tested, unconsumed export is a governance choice. | |
| **O7** | **The order of repair.** V1 (server collapses PARTIAL into EMPTY) is the only entry that produces a *false claim about data*; V6/V7/V19 produce a false claim about *cause* with far greater reach. Which matters more to a pilot operator is the Owner's. | |
| **O8** | **Visual and semantic treatment of each state** — tone, role, placement, whether a way out is offered. | **MISSING INPUT** — `docs/atlas/inputs/design-r1/` does not exist at `origin/main` |
| **O9** | **Whether the four PROVEN EMPTY subtypes stay four** (C3), or whether some families may keep saying the less specific true thing. The shipped contract already permits the latter deliberately (`collectionPageState.js:50-55`). | **OWNER DESIGN DECISION** |
| **O10** | **Whether a withheld dashboard module / record-page region is STATED or OMITTED** (V32–V34). The omission argument is real and is written down (`dashboardComposition.js:466-467`): an empty "Team performance" heading implies a team the viewer does not have. It is correct for NOT APPLICABLE and wrong for NOT AUTHORIZED. Engineering's obligation is only to make the two distinguishable; which one gets a sentence and which gets silence is the Owner's. | **OWNER DESIGN DECISION** |
| **O11** | **Whether the rail hides a denied nav link or shows it disabled** (V37, and the silent-link half of V6). The route already answers honestly on a direct URL; the link's absence is a navigation-design choice. The Report Builder's `comingSoon` pattern (`reportBuilderModel.js:19`,`:25`) is the shipped precedent for the "shown, disabled, honest" alternative. | **OWNER DESIGN DECISION** |

---

## 8. What could not be proved at `64008d5a`

| Claim | Status | Why |
|---|---|---|
| Whether `runReportDefinitionCallable` is **deployed** to `taylor-parts` | **UNPROVEN** | deployment is an environment fact. The export exists (`functions/src/index.ts:183`); three source comments assert it is undeployed (§5.6). This lane makes no production contact. |
| The exact production `roleAssignments` documents (count, `employeeId` values) | **UNPROVEN** | live data. Only the committed census (`be1e5579`) is in scope, and §5.8 records exactly what it says. |
| Whether the 31 strict / 42 loose direct `EmptyState` users in §5.12 contain a false empty beyond V25–V38 | **UNPROVEN** | requires per-family adjudication of each read path. §6.2 specifies the test that answers it mechanically; this document does not assert a number. |
| Any ALLOW count | **deliberately absent** | method-dependent and unnecessary here. §5.7 uses catalogue counts only, with the method stated. |
| Visual/semantic treatment per state | **MISSING INPUT** | `docs/atlas/inputs/design-r1/` absent at `origin/main` |
| Which sentence should replace V6/V7/V17/V18/V19 | **MISSING INPUT** + **OWNER DESIGN DECISION** | no approved copy exists to cite |

### 8.1 Corrections to the lane brief

Recorded because correcting the brief is in scope, and because each of these would have become a false
statement in this document if carried through unchecked.

| # | Brief said | Baseline says |
|---|---|---|
| 1 | `ENG-IMPL-001` and `002` exist on branch `atlas/eng-impl-reporting-company-scope` | `001` (plus a `README.md`) is on `atlas/eng-impl-reporting-company-scope` at `64bb65c6`; **`002` is on a different branch**, `rpt/p0-blast-radius` at `379961ff` (`ENG-IMPL-002-reporting-production-blast-radius.md`). No `003` or `004` exists on any ref. This lane's `003` collides with nothing. |
| 2 | `CURRENT_SUPPORTED_SERVER_KINDS` must be a subset of `CLIENT_RECOGNIZED_KINDS` | Neither identifier exists. The real ones are `RunReportOutcomeKind` (server), `SERVICE_KINDS` and `KINDS` (client). The subset rule is correct and holds; §4.1 restates it over the real names. |
| 3 | "The two fields compose in `resolveRuntimeCapabilityOverrides()`" | They compose there, but **as a preference, not a union**: `environmentCapabilityOverrides.ts:777` is `production.size > 0 ? production : nonProduction`. The function's own comment at `:773-776` calls it a union and is wrong about its own line. Equivalent in today's data; not equivalent as written. |
| 4 | `productionCapabilityActivations` holds 25 entries "on `taylor-parts-production`" | Correct, with one identity nuance worth pinning: `taylor-parts-production` is the **environment id** (`config/environments.json:257`); the **Firebase projectId** the resolver keys on is `taylor-parts` (`:266`, matching `environmentCapabilityOverrides.ts:664`). Both names appear in the repo and they are not interchangeable. |
| 5 | "Production role occupancy is ZERO" | Effectively zero for every **governed business role**; one real assignment exists (`admin@global`). See §5.8. The brief's operative conclusion stands. |
| 6 | The eight-state table | Correct but incomplete: NOT YET RUN and IN FLIGHT are two states; DECISION NOT YET RESOLVED is a third; PROVEN EMPTY is already a ratified family of four. See C1–C3. |
| 7 | `SCOPE UNRESOLVED` | Confirmed **not** emittable as a kind: six candidate spellings, zero hits. It is a required *distinction* with an existing home (`HONEST_STATE.UNKNOWN`), not a new vocabulary item. The brief's own warning was right and is honoured. |
| 8 | The false-empty defect is fixed on branches only | Confirmed, and the shape at the baseline is more specific than "unfixed": the **vocabulary is shipped** (`HonestState.jsx`, `collectionPageState.js`, both tracked at `64008d5a`) and the **route-level blank body is closed** (`App.jsx:904-920`). What is live is (a) the server-side collapse V1, (b) the cause mis-attribution V6/V7/V17–V19, (c) the mode-3 leaks V11–V13, (d) the blank regions V32–V38, (e) the adoption gap §5.12. None of that is "fixed on a branch"; all of it is here. |
