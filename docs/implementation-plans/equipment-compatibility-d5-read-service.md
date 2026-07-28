---
artifact_type: implementation-authorization-package
status: PENDING — NOT AUTHORIZED — documentation only; authorizes no implementation, read-capability activation, permission grant, Rules/Functions/index, callable export, or production access
gate: D5 (Read service) — Part–Equipment Compatibility
date: 2026-07-28
baseline: 602ed1f9e3e3c0cceb6025cc547b91972630f747
workstream: Inventory → Equipment integration
related:
  - docs/architecture/equipment-part-compatibility.md
  - docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md
  - docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md
  - docs/architecture/ADR-006-equipment-and-installed-asset-management.md
  - docs/architecture/ADR-008-part-master.md
  - docs/architecture/SYSTEM_AUTHORITIES.md
  - docs/DECISIONS.md (#51 D-COMPAT-1..7)
  - functions/src/equipmentCompatibility/repository.ts
  - functions/src/equipmentCompatibility/compatibilityRepository.ts
  - functions/src/equipmentCompatibility/equipmentModelRepository.ts
  - functions/src/access/effectiveAccessFeed.ts
  - functions/src/access/effectiveAccessFeedCallable.ts
  - functions/src/access/resolveEffectivePermission.ts
  - functions/src/access/permissionCatalog.ts
  - firestore.rules
  - firestore.indexes.json
  - docs/Deployment.md
---

# D5 — Read service authorization package (Part–Equipment Compatibility)

## 0. Gate, status, and hard boundary

Documentation-only authorization package for the D5 gate defined **verbatim** in
`docs/architecture/equipment-part-compatibility.md` §10:

> **D5 — Read service:** bounded bidirectional queries and fail-closed read model; no UI source fallback.

The merged D4 package restates the same D5 boundary in its gate-separation table
(`docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md` §0):

> **D5** | read model / read service, derived projections, and the exact query shapes + compound
> indexes those queries need | repo → emulator | **separate gate; out of scope [of D4]**.

This package **implements nothing**: no code, no read-service, no callable, no permission-catalog
change, no permission activation, no role grant, no Firestore Rules change, no Cloud Function export,
no index, no Firebase or production access, no UI. The five governed `equipment.*` capabilities remain
**inactive (`active:false`) and ungranted**; the read capability `equipment.compatibility.view` stays
inactive. This is a **PENDING — NOT AUTHORIZED** design gate returned for **Codex review and Owner
decision**.

### 0.1 Established merged state (reconciled at baseline `602ed1f`)

- **D0 — architecture APPROVED** (PR #449, DECISIONS **#51** D-COMPAT-1..7): separate top-level
  `equipment_models` / `equipment_model_aliases` / `equipment_part_compatibility` /
  `equipment_compatibility_sources` authorities; deterministic opaque compatibility IDs; reduced
  compatibility enum; immutable multi-source provenance with relationship-level verification + visible
  conflicts; Parts Catalog remains primary; trusted-writer-only mutation; installed assets stay
  separate from Equipment Model identity.
- **D1** (PR #450), **D2** (PR #454), **D3** (PR #456), **D4** (PR #459, **merge commit
  `24573ae78c6c11db7b3a54bdd3db3753ba2e9c25`**) are merged.
- **D4 is repository-only and NOT deployed** (`docs/Deployment.md`: `firestore.rules` / indexes are
  not deployed by any CI workflow — `merged ≠ deployed`). Verified at baseline:
  - `firestore.indexes.json` contains **no `equipment_` index**;
  - `functions/src/index.ts` exports **no equipment callable** (nothing is wired to run);
  - `firestore.rules` denies all direct client read/write on all five governed collections
    (`allow read, write: if false;`), byte-mirrored in `field-ops-app-vite/firestore.rules`;
  - the five `equipment.*` permissions are registered **`active:false`** in both permission-catalog
    mirrors, ungranted.
- **Customer/Auth changes after D4** (e.g. AUTH-PR-4) entered `main` only through merge ancestry, not
  through this workstream.

### 0.2 Explicit gate separation (architecture §10)

| Gate | Scope | Environment | This package |
|---|---|---|---|
| **D4** | repositories, trusted commands, permission-catalog *entries* (inactive), audit, client-closed Rules proposal, emulator tests | emulator only | **merged (`24573ae`)** |
| **D5** | governed **read service** — bounded bidirectional queries + fail-closed read model; the query shapes + any indexes those queries need; **no UI source fallback** | repo → emulator | **designed here (PENDING)** |
| **D6** | Part Detail "Used In Equipment" MVP section | repo → emulator | separate gate; out of scope |
| **#226** | read-capability **activation** + role grants | production security gate | separate gate; out of scope |
| **D10** | production Rules / index / Functions **deployment** + verification | production | separate gate; own authorization required |
| **D11** | production data / import execution | production | separate gate; out of scope |

D5 **never deploys and never touches production**. Any client-visible read path, any capability
activation, and any index deployment are downstream gates, each with its own repository-defined
authorization.

---

## 1. What already exists to build on (merged D1–D4 read surface)

D5 is a **read service over already-merged, already-validated data**, not new persistence. The merged
surface D5 composes:

- **Collections + client closure** — `functions/src/equipmentCompatibility/repository.ts`
  (`EQUIPMENT_*_COLLECTION` constants); all five client-closed in `firestore.rules`.
- **Deserializers (the read model already exists)** — `compatibilityFromFirestore` /
  `sourceFromFirestore` (`compatibilityRepository.ts`), `modelFromFirestore`
  (`equipmentModelRepository.ts`): each re-validates a stored document through the merged D1/D2 pure
  contracts and **fails closed** (`MalformedStoredRecordError`) on any drift. D5 reuses these; it does
  **not** re-implement identity or validation.
- **The one relationship query that exists today** — `CompatibilitySourceRepository.listByCompatibilityId`
  (`compatibilityRepository.ts`): `where("compatibilityId","==",…)`, a **single-field equality** query
  (automatic single-field index) with defence-in-depth that every returned doc belongs to the
  relationship — but **it carries no `limit`** (it reads the full evidence set for a relationship, which
  is safe for D4's single-relationship conflict analysis but **not** for D5's per-page fanout). D5 therefore
  issues its **own bounded** evidence query (§5.5) rather than calling it. **No forward/reverse
  relationship query exists yet** — `repository.ts` states verbatim: *"There is intentionally no
  list/query/delete surface in D4 — the trusted commands use point access … D5 still owns projections and
  their query shapes."*
- **The governed read-service PRECEDENT** — `functions/src/access/effectiveAccessFeed.ts` +
  `effectiveAccessFeedCallable.ts`: a trusted server-side read model behind an `onCall` adapter whose
  **only** job is auth-gating (`request.auth.uid` **only**, never from `request.data`), a **narrow**
  request-shape validation (rejects unrecognized fields), delegation to a pure service, and typed-error
  → **safe `HttpsError`** mapping, **exported from `index.ts` only when separately authorized**. D5
  proposes the **same pattern**; the effective-access feed is the on-main template.

---

## 2. Proposed D5 boundary

D5 delivers a **governed, server-side, emulator-only read service** for Part↔Equipment compatibility.
Its entire job is to answer two bounded questions from already-persisted, already-validated data, fail
closed, and expose nothing raw.

**In scope (proposed):**

1. A **pure read-model service** (server-only, Admin-SDK in emulator) exposing:
   - **forward** read — *given a canonical `partId`, the compatibility relationships that cite it*
     (`where("partId","==",partId)`);
   - **reverse** read — *given an `equipmentModelId`, the relationships that cite it*
     (`where("equipmentModelId","==",equipmentModelId)`);
   - **evidence disposition** for a relationship — a **bounded** evidence read (§5.5: D5 issues its own
     `.limit(MAX_EVIDENCE_PER_RELATIONSHIP + 1)` query, **not** D4's unlimited `listByCompatibilityId`),
     returning only a **sanitized** provenance summary (authority type + verification-relevant
     disposition + bounded-window counts), never raw evidence contents, and marked **incomplete** when
     the bound is hit.
   - a **point read** of an `equipmentModel` by id (for display of manufacturer/model/family/subtype).
2. A **sanitized, bounded response schema** (§4) — opaque ids + display-safe fields only; **bounded
   pagination**; deterministic ordering; every relationship carries an explicit **disposition**
   (verified / in-review / conflict / unverified) and is **never silently dropped**.
3. **Fail-closed read semantics** (§6) — malformed, unavailable, denied, incomplete, or conflicting
   data resolves to an explicit typed disposition, **distinct from "no records"**.
4. An **`onCall` adapter proposal** mirroring `effectiveAccessFeedCallable.ts` — actor from
   `request.auth.uid` only, narrow request shape, typed-error → safe `HttpsError`, **not exported from
   `functions/src/index.ts`** in D5 (kept inert, exactly as D4 kept its commands unexported).
5. **Emulator-only verification** (§7) — the read service + a **negative authorization matrix**,
   authorized paths driven by an **injected `resolveEffectivePermission` fixture** (the D4/§226 seam),
   never a real role or grant. Includes proof that the five collections remain client-closed (D5 opens
   **no** client Rules path).
6. The **query-shape + index determination** the D5 gate explicitly owns (§5): whether the bounded reads
   are answerable with single-field (auto-indexed) queries + server-side domain filtering, or whether a
   compound index is genuinely required.

**Out of scope / explicitly excluded (invariants this package will not cross):**

- **No persistence mutation** — no import, verify, correct, alias write, model write, or any collection
  write. D5 is read-only; the trusted D4 orchestrator remains the *only* writer.
- **Client collections remain directly unreadable and unwritable** — D5 changes **no** `firestore.rules`;
  reads occur **only** through the trusted server-side service/callable.
- **No permission activation or role grant** — `equipment.compatibility.view` (and the other four)
  remain `active:false`; activation/grant is the separate **#226** gate.
- **No projection rebuild** — no derived projection collection, no projection audit action, no
  projection writer. Projections stay deferred (architecture §3: *"only when measured query or scale
  needs justify them"*). *(See OD-2.)*
- **No Rules, Functions, index, or Hosting deployment** — D5 is repo → emulator; deployment is **D10**.
- **No callable export** — the proposed callable is **not** wired into `functions/src/index.ts`.
- **Compatibility unavailability fails closed only within the compatibility section** — it must **not**
  block Part identity, stock, reorder, or existing Inventory workflows. D5 returns a typed disposition;
  it never throws into, gates, or degrades any Part-identity/stock/reorder path.
- **Parts Catalog remains the primary user-facing Parts experience** — D5 adds no UI and creates no
  competing surface. The consuming "Used In Equipment" section is **D6**, not D5.
- **No competing Part Master or duplicate compatibility authority** — D5 reads the single D4 authority;
  it introduces no second store of compatibility truth.
- **Existing Part IDs remain unchanged** — D5 reads by existing canonical `partId`; it rekeys nothing.
- **No installed-asset `equipmentModelId` linkage** — D5 does not read, write, or infer any link between
  `equipment` installed assets and `equipment_models` (that is **D7**).
- **No Truck Inventory / downstream Work Order / procurement / warehouse / PM / AI consumer** — each is
  its own later authorized gate (architecture §10 D9).

---

## 3. Genuine design questions — resolved, with recommended safe defaults

Each question below is answered with a **recommended safe default**; the ones that need Owner authority
(not merely an engineering choice) are surfaced again in §8 as **Owner decisions (OD-n)**.

### 3.1 Exact read-service / API surface
**Recommendation.** A pure service module (proposed `functions/src/equipmentCompatibility/readService.ts`)
exposing three functions — `readCompatibilityForPart({ partId, cursor?, limit? })`,
`readCompatibilityForModel({ equipmentModelId, cursor?, limit? })`, and
`readModelSummary({ equipmentModelId })` — plus a thin `onCall` adapter
(`equipmentCompatibilityReadCallable.ts`) modeled on `effectiveAccessFeedCallable.ts`. Actor from
`request.auth.uid` only; request shape is narrow (rejects unrecognized fields); the adapter is **not
exported** from `index.ts` in D5.

### 3.2 Sanitized response schema and bounded pagination
**Recommendation.** Responses carry **opaque ids + display-safe fields only** (§4). Pagination is a
caller `limit` clamped to `[1, MAX_PAGE]` (proposed `MAX_PAGE = 50`, `DEFAULT_PAGE = 25`) with a **stable
opaque cursor** over a **database-level deterministic order** — `orderBy(FieldPath.documentId())` — so
traversal is complete and gap-free across pages. Sorting only an already-fetched page is **rejected**
(it cannot guarantee stable, complete traversal). The exact query, order, cursor binding/validation, and
index determination are the §5 contract, and are **proven executably** (§7), not asserted.

### 3.3 Which relationship / evidence fields are safe for each caller
**Recommendation (allowlist, §4).** **Exposed:** model identity display (manufacturer/model/family/
subtype/displayName), `compatibilityType`, `assembly`, `installationPosition`, `quantityRequired`, a
**derived serial-applicability summary**, `verificationStatus`, `confidenceLevel`, and a **derived
source-authority summary** computed over a **bounded evidence window** (§5.5) — strongest authority per
side plus supports/contradicts counts that are labeled **bounded-window** and marked incomplete unless
the relationship's full evidence set was read. **Never exposed:** raw evidence `sourceReference`
contents, `contentFingerprint`, `capturedBy`, raw serial lists/bounds, free-text `notes`,
`uniquenessKey`, operation-record internals, or audit internals. *(See OD-4 for the persona set.)*

### 3.4 Conflict and UNRESOLVED visibility
**Recommendation.** Every relationship is returned with its explicit `verificationStatus`
(`UNVERIFIED | IN_REVIEW | VERIFIED | REJECTED | CONFLICT`) and an `applicability.kind` that may be
`UNRESOLVED`. `CONFLICT` and `IN_REVIEW` are **surfaced, visibly labeled, and marked non-operational**
(never silently merged or dropped — DECISIONS #51 / architecture §7). `UNRESOLVED` applicability is
never presented as verified. `REJECTED` is **excluded from the default read** but reported in an
aggregate count so "excluded" never reads as "none". *(See OD-5.)*

### 3.5 Permission model while `equipment.*` entries remain inactive
**Recommendation.** The read service resolves `equipment.compatibility.view` through the **pure,
fail-closed `resolveEffectivePermission`** resolver — **exactly as coded**, i.e. an `active:false`
capability resolves to **DENY `inactivePermission`**. In D5, authorized-path emulator tests inject a
**resolver fixture** (the same seam D4 used), so the service is fully reviewable **without activating
anything**. The capability stays inactive; **real** activation + persona grants are the **#226** gate.
*(See OD-1 — the single most important decision.)*

### 3.6 Query shapes and whether compound indexes are needed
**Recommendation — determined by the documented Firestore rule + executable proof, NOT pre-authorized.**
The forward (`partId ==`) and reverse (`equipmentModelId ==`) reads each pair **one equality filter**
with `orderBy(FieldPath.documentId())`. Per Firestore's documented indexing rule, an equality filter
plus an order on `__name__` is served by the collection's **automatic single-field index** and needs
**no composite index** — whereas an equality filter plus an order on a *different stored field* **would**
need one (which is precisely why D5 orders by `documentId()`, not by the `compatibilityId` field). Any
verification/type refinement is applied as **server-side domain filtering on the bounded page** *after*
the equality+`__name__` query, introducing no new indexed predicate. This expectation is **settled at
implementation** by an emulator test that executes each exact query shape (§7) against this branch's
`firestore.indexes.json`. **If any exact query the implementation actually issues requires a composite
index, D5 proposes it in `firestore.indexes.json` repository-only, undeployed until D10** — the package
does **not** force "no composite index" as a precondition (§5.4, revised OD-3).

### 3.7 Projection source-of-truth and freshness (if projections are proposed)
**Recommendation.** **No projections in D5.** Direct bounded queries over the D4 authorities are the
single source of truth; freshness is "read-time consistent with the authority." Projections remain
deferred until a measured scale/query need exists; when introduced they must carry
`sourceCompatibilityId` + projection version + reconciliation and never accept direct writes
(architecture §3). *(See OD-2.)*

### 3.8 Fail-closed behavior for malformed / unavailable / incomplete / conflicting data
**Recommendation — fail-closed at the RESPONSE level, not merely per-item (§6).** Encountering **any**
malformed relationship in the authoritative query, or **any** item whose evidence is incomplete/
unavailable, makes the whole response `DEGRADED` — an explicit state **distinct** from `AVAILABLE`,
`EMPTY`, `DENIED`, and `UNAVAILABLE`. A malformed doc is omitted from `items` **and** counted, but its
presence forbids an `AVAILABLE` verdict; a page of only-rejected records is `AVAILABLE` with zero
operational items (never `EMPTY`); a page of only-malformed records is `DEGRADED` (never `EMPTY`); a
backend error is `UNAVAILABLE`; a denied caller is `DENIED`. A malformed **or missing** model authority
yields an item with `model:null` and `operational:false`; malformed or incomplete **evidence** forces
that item `operational:false`. Pagination/truncation can **never** convert a degraded/incomplete
response into `AVAILABLE`. Scoped to the compatibility response only (§2 exclusion) — it never blocks
Part identity/stock/reorder/Inventory.

### 3.9 Audit requirements for reads
**Recommendation.** **No per-read audit event.** The shared `auditEventWriter` is create-only for
governed **mutations** (architecture §8 audits initiation/outcome/conflict/verification/correction/
projection-rebuild — **not reads**). D5 performs no mutation and stages no audit event. *(See OD-6.)*

### 3.10 Emulator tests and negative authorization matrix
**Recommendation (§7).** Positive reads behind an injected resolver fixture for each authorized persona;
a **negative authorization matrix** proving deny for unauthorized principals; proof the five collections
stay client-closed (D5 opens no client path); fail-closed proofs for malformed/unavailable/conflict;
pagination bound + deterministic order; forward/reverse parity; sanitized/secret-free output.

### 3.11 D5 rollback posture
**Recommendation.** D5 is repo → emulator with **no deployment and no data effect**, so rollback is
**revert-by-gate** (revert the PR; nothing deployed, nothing activated, no callable exported, no data
touched) — identical to the D4 posture.

---

## 4. Proposed sanitized read-model schema (DESIGN ONLY)

```ts
// Server-derived, display-safe. Opaque ids only; no raw evidence, no serial lists, no notes.
type CompatibilityReadItem = {
  compatibilityId: string;                 // opaque (== the doc id / order key)
  equipmentModelId: string;                // canonical opaque id
  partId: string;                          // existing canonical Part id (unchanged)
  model: {                                 // from readModelSummary / point read
    manufacturerName: string;
    modelNumber: string;
    displayName: string;
    family: string | null;
    subtype: string | null;
  } | null;                                // null => model unavailable/malformed (fail-closed, not "none")
  compatibilityType: "DIRECT_FIT" | "APPROVED_ALTERNATE" | "OPTIONAL_ACCESSORY" | "CONSUMABLE";
  assembly: string | null;
  installationPosition: string | null;
  quantityRequired: number | null;
  serialApplicabilitySummary: string;      // DERIVED, bounded; never a raw serial list
  verificationStatus: "UNVERIFIED" | "IN_REVIEW" | "VERIFIED" | "REJECTED" | "CONFLICT";
  applicabilityResolved: boolean;          // false when applicability.kind === "UNRESOLVED"
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  // operational === true ONLY IF: verificationStatus === "VERIFIED" AND applicabilityResolved AND
  // model !== null AND evidence.status === "OK" (complete + read). Any other case => false.
  operational: boolean;
  evidence: {                               // DERIVED from a BOUNDED evidence window (§5.5)
    // "OK" only when the FULL evidence set was read within bounds. Overflow (> MAX_EVIDENCE_PER_
    // RELATIONSHIP) or request-budget exhaustion => "INCOMPLETE"; a malformed evidence doc => "UNAVAILABLE".
    status: "OK" | "INCOMPLETE" | "UNAVAILABLE";
    windowComplete: boolean;               // true only when status === "OK"
    strongestSupportingAuthority: string | null;
    // Bounded-window counts. Authoritative TOTALS only when windowComplete === true; otherwise these are
    // counts over the read window and MUST be presented as incomplete (operational is already false).
    boundedSupportsCount: number;
    boundedContradictsCount: number;
    windowSize: number;                    // number of evidence docs actually read (<= MAX_EVIDENCE_PER_RELATIONSHIP)
  };
};

type CompatibilityReadResponse = {
  // DEGRADED = the authoritative query ran but >=1 relationship was malformed/omitted OR >=1 item's
  // evidence was INCOMPLETE/UNAVAILABLE. Distinct from AVAILABLE (clean+complete), EMPTY (zero docs),
  // UNAVAILABLE (backend error), DENIED (unauthorized). Pagination/truncation NEVER upgrades to AVAILABLE.
  disposition: "AVAILABLE" | "DEGRADED" | "EMPTY" | "UNAVAILABLE" | "DENIED";
  items: CompatibilityReadItem[];          // [] when EMPTY/UNAVAILABLE/DENIED (may be [] for malformed-only => DEGRADED)
  nextCursor: string | null;               // opaque, (dir,key)-bound (§5.3); null => last page
  counts: { returned: number; operational: number; excludedRejected: number; malformedOmitted: number; evidenceIncomplete: number };
};
```

---

## 5. Query, ordering, cursor, and index contract (the shape the D5 gate owns)

### 5.1 Exact relationship queries

```ts
// Forward — relationships that cite a Part. FieldPath imported from firebase-admin/firestore.
db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION)
  .where("partId", "==", partId)
  .orderBy(FieldPath.documentId())          // == compatibilityId (the doc id): total, deterministic order
  .startAfter(cursor.afterId)               // OMITTED on the first page
  .limit(pageLimit + 1);                    // +1 probes "is there a next page"

// Reverse — relationships that cite an Equipment Model (identical shape, different equality field).
db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION)
  .where("equipmentModelId", "==", equipmentModelId)
  .orderBy(FieldPath.documentId())
  .startAfter(cursor.afterId)
  .limit(pageLimit + 1);
```

`pageLimit = clamp(request.limit ?? DEFAULT_PAGE, 1, MAX_PAGE)`; `DEFAULT_PAGE = 25`, `MAX_PAGE = 50`.
The `pageLimit + 1` probe decides `nextCursor` (present only when a `pageLimit + 1`-th doc was seen);
the probe row is dropped from `items`.

### 5.2 Ordering — why `documentId()`

`orderBy(FieldPath.documentId())` gives a **total, database-level deterministic order** over the whole
result set, so `startAfter` traversal is **stable, complete, and gap-free** across pages. The doc id of
`equipment_part_compatibility` **is** the canonical `compatibilityId` (D2 opaque hash), so this orders
by identity without ordering on any mutable field. **Sorting only a fetched page is rejected** — it
cannot guarantee stable/complete traversal (this review's requirement).

### 5.3 Cursor payload, direction/identity binding, and tamper refusal

The cursor is an **opaque** base64url encoding of a strict record:

```ts
{ v: CURSOR_SCHEMA_VERSION, dir: "forward" | "reverse", key: string /* partId | equipmentModelId */, afterId: string /* compatibilityId */ }
```

- **Bound to BOTH direction and query identity:** a cursor minted for one `(dir, key)` is **refused**
  against any other — a forward-Part cursor cannot be replayed on a reverse-Model read or on a different
  Part/Model (`invalid-argument`).
- **Validation / tamper refusal:** decode → require a known `v`; `dir` ∈ enum; `key` **strictly equals**
  the current request's canonical key; `afterId` matches the canonical `compatibilityId` shape. Any
  decode failure, unknown/extra field, or mismatch **fails closed** (`invalid-argument`) and is **never**
  silently treated as "start from the beginning." (No cryptographic signature is claimed; integrity comes
  from strict shape + the `(dir, key)`-to-request binding, so a tampered cursor cannot broaden, skip, or
  cross-bind a read.)

### 5.4 Index determination — documented rule + executable proof, not pre-authorization

| Read | Exact query | Composite index? |
|---|---|---|
| forward (by Part) | `where("partId","==",X).orderBy(documentId())` | **No** — equality + `__name__` is served by the automatic single-field index |
| reverse (by Model) | `where("equipmentModelId","==",X).orderBy(documentId())` | **No** — same rule |
| evidence (per relationship, §5.5) | `where("compatibilityId","==",X).orderBy(documentId()).limit(N)` | **No** — same rule |
| model summary | point read by doc id | none |

**Firestore rule applied:** an equality filter combined with an order on `__name__`
(`FieldPath.documentId()`) is served by the collection's automatic single-field index and needs **no
composite index**; an equality filter combined with an order on a *different stored field* **would**
need one — which is exactly why every D5 query orders by `documentId()`.

**This is not pre-authorized.** The determination is **settled at implementation** by an emulator test
(§7) that executes each exact query shape above against this branch's `firestore.indexes.json` (which
today carries **no `equipment_` index**), asserting the query runs and returns the expected order/page.
**Honest caveat:** the Firestore emulator does **not** enforce composite-index requirements the way
production does, so the executable test proves query **shape, ordering, completeness, and pagination
correctness**, while the **composite-index requirement** is settled by the documented rule above. **If
any exact query the D5 implementation actually issues requires a composite index, D5 proposes it in
`firestore.indexes.json` repository-only, undeployed until D10** — never forcing "no index." (See revised
**OD-3**.)

### 5.5 Bounded evidence retrieval and fanout budget

D4's `listByCompatibilityId` has **no limit**; calling it per relationship across a page is an unbounded
read + page-size-multiplied fanout. **D5 does not call it. D5 issues its own bounded evidence query:**

```ts
db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION)
  .where("compatibilityId", "==", compatibilityId)
  .orderBy(FieldPath.documentId())          // == sourceId: deterministic
  .limit(MAX_EVIDENCE_PER_RELATIONSHIP + 1); // +1 detects overflow
```

- **Per-relationship bound:** `MAX_EVIDENCE_PER_RELATIONSHIP = 20` (proposed). Seeing the `+1`-th doc ⇒
  the relationship's evidence is **overflowing** ⇒ `evidence.status = "INCOMPLETE"`, `operational:false`.
- **Per-request read-work budget:** `MAX_EVIDENCE_READS_PER_REQUEST = 100` (proposed) across the whole
  page. Once the budget is spent, remaining relationships' evidence is **not read** and is marked
  `evidence.status = "INCOMPLETE"` (`operational:false`) — never silently reported as zero.
- **Ordering/cursor:** evidence is a bounded per-relationship set ordered by `sourceId`
  (`documentId()`); D5 does **not** expose a separate evidence pager (deferred). Overflow ⇒ `INCOMPLETE`.
- **When more evidence exists than can be safely read** (per-relationship overflow OR request budget
  exhausted): `evidence.status = "INCOMPLETE"`, `windowComplete = false`, `operational = false`.
- **Counts:** `boundedSupportsCount` / `boundedContradictsCount` are authoritative **totals only when
  `windowComplete === true`**; otherwise they are **bounded-window counts** and the item is already
  non-operational. D5 introduces **no separate aggregate authority**, so it **never** presents a
  supports/contradicts total it did not fully read.

**Determination:** as recommended, D5 needs **no composite index** (§5.4) — but that outcome is proven
by §7, not asserted here, and any required index is repo-only + undeployed until D10.

---

## 6. Fail-closed disposition contract (scoped to the compatibility surface only)

**Response-level disposition (mutually exclusive, fail-closed):**

- `AVAILABLE` — the authoritative query ran, **every** encountered relationship was well-formed, **no**
  item's evidence was incomplete/unavailable, and ≥1 item is returned. (Items may still be
  non-operational for governance reasons — see below — but nothing was malformed or unread.)
- `DEGRADED` — the query ran but **≥1 relationship was malformed/omitted** OR **≥1 item's evidence was
  `INCOMPLETE`/`UNAVAILABLE`**. Partial data may be returned; the response is explicitly **not** a clean,
  complete read. **Pagination/truncation can never upgrade `DEGRADED` to `AVAILABLE`.**
- `EMPTY` — the authoritative query ran and returned **zero documents**. A page with only-rejected or
  only-malformed records is **never** `EMPTY` (only-rejected ⇒ `AVAILABLE` with zero operational items +
  `excludedRejected > 0`; only-malformed ⇒ `DEGRADED`).
- `UNAVAILABLE` — a backend/read error; rendered **distinctly** from `EMPTY`.
- `DENIED` — the caller lacks the (future-activated) read capability.

**Per-item accounting (never silent):** `malformedOmitted` (failed `fromFirestore` re-validation —
omitted from `items`, counted, and forces the response to `DEGRADED`); `excludedRejected`
(`verificationStatus === "REJECTED"` — excluded from `items`, counted, **never** shown as "none");
`evidenceIncomplete` (an item whose `evidence.status ≠ "OK"`).

**`operational: false` is mandatory whenever ANY of:** `verificationStatus ≠ "VERIFIED"` (i.e.
`CONFLICT`, `IN_REVIEW`, `UNVERIFIED`, `REJECTED`); `applicability.kind === "UNRESOLVED"`; `model`
missing/malformed (`model: null`); the relationship doc is malformed (it is omitted entirely and forces
`DEGRADED`); evidence `INCOMPLETE`; or evidence `UNAVAILABLE`. `operational: true` requires the full
positive conjunction in §4 and a complete evidence window.

**Invariant:** none of these states may block or degrade Part identity, stock, reorder, or any existing
Inventory workflow. The disposition is confined to the compatibility response object (§2 exclusion).

---

## 7. Emulator verification plan (D5)

All D5 verification runs against the **Firestore emulator** with **zero production access**, authorizing
paths via an **injected `resolveEffectivePermission` fixture** (no real role or grant created):

- **Client-closure regression** — direct client read/write to all five collections stays **denied** for
  every principal; D5 opens **no** client Rules path (the D4 emulator proof continues to hold).
- **Positive reads** — for each authorized persona (§8/OD-4), forward and reverse reads return the
  expected sanitized items; forward/reverse **parity** for the same relationship.
- **Negative authorization matrix** — unauthenticated, technician (bare), technician-with-operational-
  role, and any principal without an *active* `equipment.compatibility.view` all resolve **`DENIED`**;
  a resolver that throws denies (never approves).
- **Sanitization** — responses contain **no** raw evidence contents, `contentFingerprint`, `capturedBy`,
  raw serials, `notes`, or `uniquenessKey`; summaries are bounded; secret-scan clean.
- **Executable query-shape + index proof** — the emulator test **runs each exact query** (§5.1/§5.5:
  `where(field,==,X).orderBy(documentId()).startAfter(...).limit(...)`) against this branch's
  `firestore.indexes.json`, asserting it executes and returns the expected **order** and **page**. If a
  query the implementation issues demands a composite index, the test surfaces it and the package's index
  posture is updated (repo-only, undeployed until D10). *(Honest caveat, §5.4: the emulator does not
  enforce composite-index needs the way production does; the requirement is settled by the documented
  rule + this shape proof, not asserted.)*
- **Pagination integrity** — `limit` clamped to `[1, MAX_PAGE]`; deterministic `documentId()` order;
  complete, gap-free, non-overlapping traversal across pages over a seeded set spanning multiple pages;
  the `+1` probe drives `nextCursor`; a **cursor bound to `(dir, key)`** is **refused** when replayed on a
  different direction, a different Part/Model, a tampered `afterId`, or an unknown schema version
  (`invalid-argument`, never "from the start").
- **Evidence bounds cannot be bypassed** — per-relationship overflow (> `MAX_EVIDENCE_PER_RELATIONSHIP`)
  ⇒ `evidence.status = "INCOMPLETE"` + `operational:false`; request read-work budget
  (`MAX_EVIDENCE_READS_PER_REQUEST`) exhaustion ⇒ later relationships `INCOMPLETE`; a seeded relationship
  with more evidence than the bound **never** yields authoritative totals (counts labeled bounded-window);
  total evidence reads per request never exceed the budget.
- **Response-level fail-closed matrix** — **corrupt-plus-valid** input ⇒ `DEGRADED` (never `AVAILABLE`);
  **corrupt-only** input ⇒ `DEGRADED` (never `EMPTY`); **rejected-only** input ⇒ `AVAILABLE` with zero
  operational + `excludedRejected>0` (never `EMPTY`); **evidence overflow** ⇒ `DEGRADED` + item
  `operational:false`; **malformed evidence** ⇒ item `evidence.status="UNAVAILABLE"` + `operational:false`
  + response `DEGRADED`; **missing/malformed model** ⇒ item `model:null` + `operational:false`;
  **backend failure** ⇒ `UNAVAILABLE ≠ EMPTY`; and **pagination/truncation never upgrades a degraded
  response to `AVAILABLE`**.
- **Conflict/unresolved** — `CONFLICT` / `IN_REVIEW` / `UNRESOLVED` applicability surfaced, labeled
  `operational:false`, never dropped; `REJECTED` excluded from `items` but counted.
- **No mutation / no audit** — the read path stages no `auditEvents` write and mutates no collection.
- **CI** — a path-gated emulator workflow mirroring the D4 pattern
  (`equipment-compatibility-emulator-tests.yml`), boots Firestore + Auth, runs the D5 read-service suite;
  zero secrets, loopback, project `taylor-parts`.

---

## 8. Owner decisions requested

Recommended safe defaults are in §3. The genuine authority decisions:

- **OD-1 (primary) — inactive-capability read service.** Approve building the D5 read service
  **emulator-only behind the inactive `equipment.compatibility.view`** (resolved via the pure
  fail-closed resolver; authorized-path tests use an injected fixture), with **no activation and no
  grant** in D5 — activation + persona grants deferred to the separate **#226** gate. *(Recommended.)*
- **OD-2 — no projections in D5.** Approve **direct bounded queries only**; defer all derived
  projections (and their audit actions) to a later measured-need gate. *(Recommended.)*
- **OD-3 (revised) — index outcome determined by executable proof, not pre-authorized.** Approve that
  the query/index result is **settled by the D5 implementation's exact executed queries** (equality +
  `orderBy(documentId())`, §5) plus the documented Firestore rule and the §7 shape proof — **not** by
  pre-declaring "no compound index." The expectation is that **no composite index is required**; **if the
  implementation's exact query requires one, D5 proposes it in `firestore.indexes.json` repository-only,
  undeployed until D10.** *(Recommended.)*
- **OD-4 — read persona set + field allowlist.** Confirm the initial authorized readers = **admin,
  dispatcher, active `PARTS_MANAGER`, active `WAREHOUSE_MANAGER`** (architecture §8); **technician
  denied** broad reads (any work-order-scoped technician read is a separate later gate); and the §3.3/§4
  sanitized field allowlist. *(Recommended.)*
- **OD-5 — conflict/rejected visibility.** Confirm `CONFLICT`/`IN_REVIEW`/`UNRESOLVED` are surfaced
  labeled + non-operational, and `REJECTED` is excluded-but-counted (never silently dropped, never shown
  as "none"). *(Recommended.)*
- **OD-6 — no read audit.** Confirm reads emit **no** audit event. *(Recommended.)*

No provider, deployment, production-data, import-execution, permission-activation, role-grant,
projection, index, or UI decision is requested here — those live in **#226 / D6 / D10 / D11**.

---

## 9. Proposed governance text (NOT appended here — included for the package only)

*Provided for Owner/Codex to place if D5 is approved; this package does not modify `docs/DECISIONS.md`
or `docs/architecture/SYSTEM_AUTHORITIES.md`.*

**Proposed DECISIONS entry (draft):**
> **## NN. Equipment–Part Compatibility D5 read service — authorized (repository/emulator only)**
> **Decision:** APPROVE the D5 boundary: a governed, server-only, emulator-only read service exposing
> bounded forward/reverse compatibility reads (deterministic `documentId()` order + `(dir,key)`-bound
> cursor) + a sanitized, response-level fail-closed read model with a bounded evidence window; no
> persistence mutation, no projections, no capability activation or grant, no callable export, no
> Rules/index/Functions deployment, no UI. The composite-index outcome is **determined by the executed
> query + §7 proof** (expected: none; any required index is repository-only and undeployed until D10).
> `equipment.compatibility.view` stays `active:false`; activation + persona grants remain the separate
> #226 gate. Owner decisions OD-1..OD-6 as recorded.
> **Not authorized:** #226 activation; D6 UI; D7 installed-asset linkage; D10 deployment; D11 import;
> Truck Inventory; downstream consumers.

**Proposed SYSTEM_AUTHORITIES row (draft):** a "Part–Equipment compatibility READ authority" row naming
the D5 read service as the **only** governed read path (clients remain Rules-closed), added in the D5
**implementation** PR, not here.

---

## 10. What this package explicitly does NOT do

No D5 code; no read service, callable, or index; no permission-catalog change; no permission activation
or role grant; no `firestore.rules` change; no projection; no Functions export or deployment; no
Firebase or production access; no UI or consumer wiring; no installed-asset linkage; no Truck Inventory;
no Customer/Auth work; no change to `docs/DECISIONS.md` or `docs/architecture/SYSTEM_AUTHORITIES.md`.
**Documentation only, PENDING — NOT AUTHORIZED**, returned for Codex review and Owner decision before
any D5 implementation gate is opened.
