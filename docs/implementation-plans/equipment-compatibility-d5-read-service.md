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
- **The one bounded query that exists today** — `CompatibilitySourceRepository.listByCompatibilityId`
  (`compatibilityRepository.ts`): `where("compatibilityId","==",…)`, a **single-field equality** query
  that needs only Firestore's automatic single-field index, with defence-in-depth that every returned
  doc actually belongs to the relationship. **No forward/reverse relationship query exists yet** —
  `repository.ts` states verbatim: *"There is intentionally no list/query/delete surface in D4 — the
  trusted commands use point access … D5 still owns projections and their query shapes."*
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
   - **evidence disposition** for a relationship — reuse the merged `listByCompatibilityId`, returning
     only a **sanitized** provenance summary (authority type + verification-relevant disposition), never
     raw evidence contents.
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
**Recommendation.** Responses carry **opaque ids + display-safe fields only** (§4). Bounded pagination:
a caller-supplied `limit` clamped to `[1, MAX_PAGE]` (proposed `MAX_PAGE = 50`, matching the audit
feed's `DEFAULT_LIST_LIMIT`), with a **stable opaque cursor** over a deterministic order
(`compatibilityId` ascending — deterministic, index-free). No unbounded reads.

### 3.3 Which relationship / evidence fields are safe for each caller
**Recommendation (allowlist, §4).** **Exposed:** model identity display (manufacturer/model/family/
subtype/displayName), `compatibilityType`, `assembly`, `installationPosition`, `quantityRequired`, a
**derived serial-applicability summary**, `verificationStatus`, `confidenceLevel`, and a **derived
source-authority summary** (strongest authority per side + supports/contradicts counts).
**Never exposed:** raw evidence `sourceReference` contents, `contentFingerprint`, `capturedBy`, raw
serial lists/bounds, free-text `notes`, `uniquenessKey`, operation-record internals, or audit internals.
*(See OD-4 for the persona set.)*

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
**Recommendation.** The forward (`partId ==`) and reverse (`equipmentModelId ==`) reads are
**single-field equality** queries — served by Firestore's **automatic** single-field index, **no
compound index required**. Verification/type filtering is applied as **server-side domain filtering on
the bounded page** *after* the single-field query (the same "bounded model query then domain
evaluation" posture the architecture §5 mandates for serials), so D5 introduces **no compound index**.
If a future measured need requires index-backed filtered/ordered queries, that index is proposed and
**deployed** only at **D10**. *(See OD-3.)*

### 3.7 Projection source-of-truth and freshness (if projections are proposed)
**Recommendation.** **No projections in D5.** Direct bounded queries over the D4 authorities are the
single source of truth; freshness is "read-time consistent with the authority." Projections remain
deferred until a measured scale/query need exists; when introduced they must carry
`sourceCompatibilityId` + projection version + reconciliation and never accept direct writes
(architecture §3). *(See OD-2.)*

### 3.8 Fail-closed behavior for malformed / unavailable / incomplete / conflicting data
**Recommendation.** The service returns a typed disposition per item and per response (§6): a document
that fails its `fromFirestore` re-validation is **omitted from results and counted as `malformed`**
(fail-closed, never rendered as valid); a backend error surfaces as `UNAVAILABLE`; a denied caller
surfaces as `DENIED`; an empty authoritative result surfaces as `EMPTY` — all **distinct** states. A
malformed evidence doc degrades that relationship's evidence summary to `EVIDENCE_UNAVAILABLE` without
fabricating a verdict. This is scoped to the compatibility response only (§2 exclusion).

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
  compatibilityId: string;                 // opaque
  equipmentModelId: string;                // canonical opaque id
  partId: string;                          // existing canonical Part id (unchanged)
  model: {                                 // from readModelSummary / point read
    manufacturerName: string;
    modelNumber: string;
    displayName: string;
    family: string | null;
    subtype: string | null;
  } | null;                                // null => model unavailable (fail-closed, not "none")
  compatibilityType: "DIRECT_FIT" | "APPROVED_ALTERNATE" | "OPTIONAL_ACCESSORY" | "CONSUMABLE";
  assembly: string | null;
  installationPosition: string | null;
  quantityRequired: number | null;
  serialApplicabilitySummary: string;      // DERIVED, bounded; never a raw serial list
  verificationStatus: "UNVERIFIED" | "IN_REVIEW" | "VERIFIED" | "REJECTED" | "CONFLICT";
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  operational: boolean;                    // false for CONFLICT / IN_REVIEW / UNRESOLVED
  evidenceSummary: {                        // DERIVED from sanitized provenance only
    strongestSupportingAuthority: string | null;
    supportsCount: number;
    contradictsCount: number;
    status: "OK" | "EVIDENCE_UNAVAILABLE"; // fail-closed if an evidence doc is malformed
  };
};

type CompatibilityReadResponse = {
  disposition: "AVAILABLE" | "EMPTY" | "UNAVAILABLE" | "DENIED";
  items: CompatibilityReadItem[];          // [] when EMPTY/UNAVAILABLE/DENIED
  nextCursor: string | null;               // opaque; null => last page
  counts: { returned: number; excludedRejected: number; malformedOmitted: number };
};
```

---

## 5. Query + index determination (the shape the D5 gate owns)

| Read | Query | Index | Filtering |
|---|---|---|---|
| forward (by Part) | `where("partId","==",partId)` | **auto single-field** | verification/type applied server-side on the bounded page |
| reverse (by Model) | `where("equipmentModelId","==",equipmentModelId)` | **auto single-field** | same |
| evidence (per relationship) | merged `listByCompatibilityId` (`where("compatibilityId","==",…)`) | **auto single-field** | sanitized to a summary |
| model summary | point read by doc id | none | — |

**Determination:** D5 as recommended needs **no compound index**. Ordering is by `compatibilityId`
(deterministic, index-free). Any index-backed filtered/ordered query is a future need proposed and
**deployed only at D10** — never in D5. *(OD-3 confirms this posture.)*

---

## 6. Fail-closed disposition contract (scoped to the compatibility surface only)

- `AVAILABLE` — one or more valid relationships returned.
- `EMPTY` — the authoritative query ran and returned nothing (a real "no verified/known records").
- `UNAVAILABLE` — a backend/read error; the caller must render this **distinctly from `EMPTY`**.
- `DENIED` — the caller lacks the (future-activated) read capability.
- per-item `malformedOmitted` — a stored doc failed `fromFirestore` re-validation; omitted + counted,
  never rendered as valid.
- `EVIDENCE_UNAVAILABLE` — an evidence doc for a relationship is malformed; the relationship is still
  returned but its evidence summary is fail-closed (no fabricated verdict).

**Invariant:** none of these states may block or degrade Part identity, stock, reorder, or any existing
Inventory workflow. The disposition is confined to the compatibility response object.

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
- **Fail-closed** — malformed relationship/evidence docs are omitted/summarized fail-closed; a backend
  error surfaces `UNAVAILABLE ≠ EMPTY`.
- **Conflict/unresolved** — `CONFLICT` / `IN_REVIEW` / `UNRESOLVED` are surfaced, labeled
  `operational:false`, never dropped; `REJECTED` excluded from results but counted.
- **Pagination** — `limit` clamped to `[1, MAX_PAGE]`; deterministic order; stable opaque cursor;
  no unbounded read.
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
- **OD-3 — no compound index in D5.** Approve **single-field query + server-side domain filtering**;
  any index-backed query is proposed and deployed only at **D10**. *(Recommended.)*
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
> bounded forward/reverse compatibility reads + a sanitized fail-closed read model; no persistence
> mutation, no projections, no compound index, no capability activation or grant, no callable export, no
> Rules/index/Functions deployment, no UI. `equipment.compatibility.view` stays `active:false`;
> activation + persona grants remain the separate #226 gate. Owner decisions OD-1..OD-6 as recorded.
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
