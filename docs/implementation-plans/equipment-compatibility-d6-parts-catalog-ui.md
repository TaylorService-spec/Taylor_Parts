---
artifact_type: implementation-authorization-package
status: PENDING — NOT AUTHORIZED — documentation only; authorizes no implementation, capability activation/grant, callable export, deployment, or production access
gate: D6 (Part Detail "Used In Equipment" MVP) — Part–Equipment Compatibility
date: 2026-07-29
baseline: 3591fa87fee24c78b1125cbe067b493a95035aab
workstream: Inventory → Equipment integration
related:
  - docs/architecture/equipment-part-compatibility.md
  - docs/implementation-plans/equipment-compatibility-d5-read-service.md
  - functions/src/equipmentCompatibility/readService.ts
  - functions/src/equipmentCompatibility/equipmentCompatibilityReadCallable.ts
  - field-ops-app-vite/src/modules/inventory/PartDetail.jsx
  - field-ops-app-vite/src/domain/partDetailView.js
  - field-ops-app-vite/src/access/permissionCatalog.ts
  - field-ops-app-vite/src/access/resolveEffectivePermission.ts
  - field-ops-app-vite/src/navigation/navConfig.js
  - field-ops-app-vite/src/services/partMasterQueries.js
  - field-ops-app-vite/src/access/useReportCapabilities.js
  - field-ops-app-vite/src/shared/ui/LoadingEmptyState.jsx
---

# D6 — Part Detail "Used In Equipment" MVP (Part–Equipment Compatibility)

## 0. Gate, status, and hard boundary

Documentation-only authorization package for the D6 gate defined **verbatim** in
`docs/architecture/equipment-part-compatibility.md` §10:

> **D6 — Part Detail MVP:** "Used In Equipment" section; preserve all current Part Detail behavior.

The consuming section for the D5 read model was reserved as D6 by the merged D5 package
(`equipment-compatibility-d5-read-service.md` §0 / §2: *"the consuming 'Used In Equipment' section is
D6, not D5"*). This package **implements nothing**: no React component, no service, no permission
change, no capability activation or grant, no callable export, no Firebase/Rules/index/Functions/Hosting
change, no production access. It is a **PENDING — NOT AUTHORIZED** design gate returned for **Codex
review and Owner decision** (six decisions, §8).

### 0.1 Established state (reconciled at baseline `3591fa8`)

- **D0–D5 merged.** D5 read service merged at `7664c5e` (an ancestor of the current `3591fa8`).
- **`equipment.compatibility.view` is registered `active:false` and ungranted** in both permission-catalog
  mirrors (`field-ops-app-vite/src/access/permissionCatalog.ts:636-642`). Client-side the resolver hard-
  DENYs any `active:false` capability **before** any role/grant check
  (`resolveEffectivePermission.ts:227-229`), so the capability denies **every** principal today.
- **The D5 callable is present but UNEXPORTED** from `functions/src/index.ts` (inert) and undeployed; the
  five Equipment collections remain **directly client-closed** in `firestore.rules`. **No client read path
  to compatibility exists.**
- **`equipment.compatibility.view` is referenced nowhere client-side yet** — no component, hook, nav item,
  or test uses it.
- **Parts Catalog is the primary Parts experience**, hosted in the **Inventory** domain
  (`navConfig.js:167-178`, route `/inventory`). *(Naming note: the app's domain label is "Inventory", not
  "Inventory Management"; the Owner's "do not move Parts Catalog out of Inventory Management" is honored by
  leaving Parts Catalog and Part Detail exactly where they are, in the Inventory domain — this package
  proposes no move and no rename.)*

### 0.2 Consequence for D6: the section is INERT in the running app

Because `equipment.compatibility.view` is `active:false`, the capability gate (§1, §3) resolves **DENY for
every user**, so the D6 section is **not shown to anyone** and issues **no read** in the running app —
exactly as the D5 callable is inert. All D6 behavior is exercised only by **tests** (fixtures) and the
**Playwright browser gate** (injected capability + injected data source). D6 wires **no** live data source
(§5). This is the repository-only posture: the UI exists in the codebase but is dormant until a separate
#226 activation + D10 deployment.

### 0.3 Explicit gate separation

| Gate | Scope | This package |
|---|---|---|
| **D5** | governed read service + inert callable (merged `7664c5e`) | done |
| **D6** | Part Detail "Used In Equipment" section consuming the D5 read CONTRACT via an injectable seam; fail-closed states; pagination; a11y; capability-gated + inert | **designed here (PENDING)** |
| **#226** | activation of `equipment.compatibility.view` + persona grants | separate gate; out of scope |
| **D7** | Equipment Model page + installed-asset linkage | separate gate; out of scope |
| **D10** | export/deploy the read callable + Rules/index; wire the live data source | separate gate; out of scope |

---

## 1. What exists to build on (the reconciled UI map)

- **Host component** — `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` (route `/inventory/:partId`,
  `App.jsx:328-330`; the `:partId` route mounts only when `isDomainVisible(inventory)` — a mount-time gate
  so listeners never attach for an unauthorized role). Part identity flows through
  `resolvedPartId = part ? part.partId : null` (`PartDetail.jsx:1235`) — the new section keys off this.
  Existing READY-body cards (DOM order): Header → Reorder status → **Catalog** → **Stock Position & Reorder**
  → **Inventory Action Log** → **Recent Transactions** (`PartDetail.jsx:1315-1493`). Each card is
  `<div className="fo-card"><h3>…</h3></div>`.
- **Permission idiom** — the capability-feed gate: `operationalContext.hasCapability(<capId>) === true`
  (fail-closed; `navConfig.js:349-353`), wired from the trusted feed hook `useReportCapabilities(user)`
  (`App.jsx:413,419`). This is the exact idiom nav items use for `report.*` capabilities. A D6 section gates
  on `hasCapability("equipment.compatibility.view")`.
- **Async data seam** — `services/partMasterQueries.js` returns a discriminated `{ ok: true, … } | { ok:
  false, code }` (`code ∈ "permission-denied" | "unavailable"`), mapped in-component to a `canonicalRead`
  sentinel. A D6 compatibility read source mirrors this shape.
- **Loading / empty / blocked** — shared `shared/ui/LoadingEmptyState.jsx`; blocked/governance states get
  their own dedicated-copy branch (`partDetailBlockedMessage()`), mutually exclusive with loading.
- **Pure view-model + test convention** — derivation lives in `src/domain/*.js` (e.g. `partDetailView.js`);
  unit tests are standalone `node:assert` `test/*.test.mjs` scripts chained in `package.json` `"test"`;
  **no JSDOM/React render in the unit suite** — rendering + a11y are proven by the Playwright skill driver
  (`.claude/skills/run-field-ops-app-vite/driver.mjs`). Lint `oxlint`, typecheck `tsc --noEmit` are
  separate scripts. The existing pure Part↔Equipment contracts live in `src/domain/equipmentCompatibility.js`.
- **A11y / responsive idioms** — status badges `fo-badge fo-badge-<value>`; `role="status"`/`role="alert"`;
  `.fo-sr-only` live region (short summary only); `.fo-table-scroll` responsive wrapper; `.fo-card`.

---

## 2. Proposed D6 boundary

**In scope (proposed):** a **capability-gated, inert, fail-closed** "Used In Equipment" section inside
`PartDetail.jsx`, consuming the **D5 read CONTRACT** (`CompatibilityReadResponse`) through an **injectable
data source** (§5), rendering **bounded forward** compatibility for the selected `resolvedPartId`:

1. A pure **view-model** (proposed `src/domain/equipmentCompatibilitySection.js`) that maps a
   `CompatibilityReadResponse` (or a source error) to an exhaustive, fail-closed **view state** (§3) —
   never interpreting a non-operational record as verified.
2. A **section component** (proposed `src/modules/inventory/UsedInEquipmentSection.jsx`) rendered as a
   `fo-card` in the READY body, gated by `hasCapability("equipment.compatibility.view")`, showing model/
   manufacturer summaries, sanitized relationship fields, per-record verification/operational status, and
   an evidence summary — with loading, retry, pagination ("show more" over the D5 cursor), and
   **section-scoped** failure handling.
3. **Sanitized display only** (§4): the D5 item allowlist; **never** raw provenance, `sourceReference`,
   `capturedBy`, `contentFingerprint`, raw serial lists, internal error text, or protected identifiers.
4. An **injectable data-source seam** (§5) that in D6 wires **no live callable** (the callable stays
   unexported); tests/the Playwright gate inject a fixture source + a granted-capability fixture.
5. Tests (§6) for **every** D5 disposition + item state, pagination + later-page degradation, permission-
   denied + inactive-capability, evidence-incomplete + malformed-model, **section-failure-isolation**,
   **no-fallback**, and a11y — plus existing Inventory/frontend regression and CI enforcement.

**Out of scope / excluded (invariants):** no capability activation or grant; no callable export; no
Functions/Rules/indexes/Hosting deployment; no production reads or writes; no persistence/trusted-command
mutation; no import execution; no D7 installed-asset linkage; no D10/D11; no Truck Inventory; no downstream
consumer; no Customer/Auth work; **no renaming/rekeying/rewriting/replacing existing Part IDs**; **Parts
Catalog stays in the Inventory domain** (no move).

---

## 3. State → UI mapping (exhaustive, fail-closed; scoped to the section)

The view-model reduces (source result → response → items) to these **mutually-exclusive section states**.
The section **never** blocks or alters the rest of Part Detail — a compatibility failure changes only this
card.

| Source / D5 signal | Section state | UI treatment |
|---|---|---|
| capability **not granted** (`hasCapability` false — incl. the D6 `active:false` DENY) | `HIDDEN` *(OD-B)* | the section is **not rendered** — no read attempted (recommended); the alternative neutral state is OD-B |
| source in flight | `LOADING` | `LoadingEmptyState` loading copy; a short `role="status"` `.fo-sr-only` summary |
| response `DENIED` | `DENIED` | neutral "You don't have access to compatibility information." (only reachable if OD-B chooses to render rather than hide) |
| response `UNAVAILABLE` **or** source `{ok:false}` | `UNAVAILABLE` | "Compatibility information is temporarily unavailable." + **Retry**; **never** shown as "none" |
| response `EMPTY` | `EMPTY` | "No known equipment compatibility is recorded for this part." (a real zero) |
| response `AVAILABLE`, all items operational-or-labeled, no malformed/incomplete | `AVAILABLE` | render the item list; if `nextCursor` present, a "Show more" control + "Showing the first N; more may exist" (never a whole-query "complete/clean" claim) |
| response `DEGRADED` (≥1 malformed/omitted or ≥1 evidence incomplete/unavailable) | `DEGRADED` | render the valid items **plus** a visible notice "Some compatibility records could not be fully evaluated and are not shown as complete." — never upgraded to a clean claim; pagination cannot clear it |

**Per-record labels (within `AVAILABLE`/`DEGRADED`):** the service already excludes `REJECTED` from
`items` (only counted in `windowCounts.excludedRejected`), so the list contains `VERIFIED`, `CONFLICT`,
`IN_REVIEW`, `UNVERIFIED` records:

| Item signal | Label / treatment |
|---|---|
| `operational === true` (⇔ `VERIFIED` + `applicabilityResolved` + `model !== null` + `evidence.status === "OK"`) | badge **Verified**; the only records presented as usable/operational |
| `verificationStatus === "CONFLICT"` | badge **Conflicting** + "not for operational use"; `operational:false` |
| `verificationStatus === "IN_REVIEW"` | badge **In review** + "not for operational use"; `operational:false` |
| `verificationStatus === "UNVERIFIED"` | badge **Unverified**; `operational:false` |
| `applicabilityResolved === false` (UNRESOLVED applicability) | badge **Applicability unresolved**; `operational:false` |
| `model === null` (missing/malformed model) | "Model details unavailable"; `operational:false` |
| `evidence.status === "INCOMPLETE"` | "Evidence incomplete" — counts shown as **bounded-window**, never a total; `operational:false` |
| `evidence.status === "UNAVAILABLE"` | "Evidence unavailable"; `operational:false` |
| `windowCounts.excludedRejected > 0` | a subtle note "N record(s) excluded from review" — **never** rendered as compatibility |

**Fail-closed invariants (enforced by the view-model + tests, §6):**
- a compatibility failure affects **only** this section — never Part identity, stock, reorder, pricing, or
  any Inventory workflow;
- `DEGRADED` / `INCOMPLETE` / `CONFLICT` / `IN_REVIEW` / `UNRESOLVED` / malformed / missing-model /
  evidence-unavailable are **never** presented as verified/operational;
- with `nextCursor` present, the UI **never** claims a clean/complete whole-query result;
- **no fallback**: the section never substitutes static catalog names, free-text installed-asset
  manufacturer/model, Work Order history, reseller listings, or a duplicate Part Master for missing
  compatibility;
- **no leak**: only the §4 allowlist is rendered.

---

## 4. Sanitized field allowlist (what renders)

**Exposed** (from `CompatibilityReadItem` / `EquipmentModelSummary`): `model.manufacturerName`,
`model.modelNumber`, `model.displayName`, `model.family`, `model.subtype`; `compatibilityType`,
`assembly`, `installationPosition`, `quantityRequired`; `serialApplicabilitySummary` (already a derived,
bounded, serial-safe string); `verificationStatus`, `confidenceLevel`, `operational`; and the derived
`evidence` summary — `evidence.status`, `evidence.strongestSupportingAuthority`, and
`evidence.boundedSupportsCount` / `evidence.boundedContradictsCount` **only when
`evidence.windowComplete === true`**, otherwise shown as bounded-window and marked incomplete.

**Never exposed:** `compatibilityId` / `equipmentModelId` shown only as opaque non-actionable text at most
(OD-C); and **never** any raw evidence content, `sourceReference`, `capturedBy`, `contentFingerprint`, raw
serial values/lists, free-text `notes`, `uniquenessKey`, cursor internals, or internal error messages.

---

## 5. Data-source seam — the future callable seam while the callable stays unexported

The D5 callable is **unexported and undeployed**, so D6 wires **no live read**. The section depends on an
**injectable source interface**:

```ts
interface EquipmentCompatibilitySource {
  // Returns the D5 read contract, or a discriminated error mirroring services/partMasterQueries.js.
  readForPart(input: { partId: string; cursor?: string | null }):
    Promise<{ ok: true; response: CompatibilityReadResponse } | { ok: false; code: "permission-denied" | "unavailable" }>;
}
```

- **Production binding in D6:** a single **inert placeholder** source that never calls a backend (it cannot
  — no exported callable) and, if ever reached, returns `{ ok: false, code: "unavailable" }`. In practice
  it is **never reached**, because the capability gate hides the section (§0.2). The real binding — an
  onCall wrapper around the exported D5 `equipmentCompatibilityReadCallable` — is wired **only at D10**,
  when the callable is exported and deployed. *(OD-F fixes the exact seam.)*
- **Tests / Playwright gate:** inject a fixture `EquipmentCompatibilitySource` returning crafted
  `CompatibilityReadResponse`s (per disposition) plus a granted-capability fixture, so every state (§3) and
  pagination path is exercised without any live backend or activation.

This mirrors D5's own inert-callable posture: the code path exists and is fully tested, but nothing is
activated or reachable in production until its own separate gate.

---

## 6. Test plan (reconciled to repo conventions)

The repo's unit suite is pure-view-model `node:assert` scripts (no JSDOM); rendering + a11y are proven by
the Playwright browser gate. D6 uses both:

- **Pure view-model unit tests** (`field-ops-app-vite/test/equipmentCompatibilitySection.test.mjs`, added to
  the `package.json` `"test"` chain) — the state reducer for **every** D5 disposition and item state:
  `AVAILABLE` (operational + each non-operational label), `DEGRADED` (malformed-omitted, evidence-
  incomplete, evidence-unavailable, missing-model), `EMPTY`, `UNAVAILABLE`, `DENIED`, source `{ok:false}`;
  `REJECTED` counted-not-shown; **pagination** (cursor threaded; "more may exist" while `nextCursor`;
  **later-page degradation** — a clean first page followed by a `DEGRADED` page never retro-claims clean);
  **no-fallback** (asserts the view-model has no branch that reads static catalog / free-text / WO history /
  reseller / Part Master); **no-leak** (asserts the projected view object contains none of the §4 forbidden
  fields — regex over the serialized view, as `partsCompatibilityAdapter.test.mjs` does).
- **Section-failure-isolation integration test** — a `PartDetail`-level derivation test proving that a
  compatibility source error / `DEGRADED` / `UNAVAILABLE` leaves the Catalog, Stock/Reorder, pricing, and
  transactions view-models **unchanged and fully usable** (the compatibility state is a sibling, never a
  parent, of the Part-identity state).
- **Permission tests** — `hasCapability("equipment.compatibility.view")` false ⇒ `HIDDEN` (no read); the
  `active:false` inactive-capability path denies through the resolver mirror (as
  `reportNavAccess`/`reportCapabilityAccess` tests do for `report.*`).
- **Playwright browser gate** (skill driver scenario) — renders the section with an injected fixture source
  + granted capability, verifying: status badges + labels present and correct per state; `role="status"`/
  `role="alert"` live region and `.fo-sr-only` summary; Retry control; "Show more" pagination; responsive
  `.fo-table-scroll`; keyboard focus/labels on interactive controls; and that hiding/UNAVAILABLE never
  reads as "none".
- **Regression** — full `field-ops-app-vite` `npm test` chain, `oxlint`, `tsc --noEmit`, and the existing
  Inventory/Part Detail suites stay green.
- **CI enforcement** — a path-gated workflow (or extension of the existing frontend workflow) runs the new
  view-model test + lint + typecheck for all new D6 files.

---

## 7. Accessibility & responsive (proposed)

Status uses `fo-badge fo-badge-<status>` (a new namespaced set, e.g. `fo-badge-equipment-verified/
conflict/in-review/unverified/unresolved`, following the existing `fo-badge-equipment-*` convention); a
short `role="status"` `.fo-sr-only` line announces the section's async state (loading/updated/unavailable);
errors use `role="alert"`; the relationship table wraps in `.fo-table-scroll` and collapses to stacked
cards on narrow viewports (OD-E); all interactive controls (Retry, Show more) are real buttons with
accessible names and visible focus.

---

## 8. Owner decisions requested

Recommended safe defaults given; the genuine authority decisions:

- **OD-A — placement & interaction.** Host the section as a `fo-card` **"Used In Equipment"** in the
  `PartDetail` READY body, inserted **after the Catalog card and before Stock Position** (compatibility is
  part-identity context, above operational stock). Interaction: a bounded relationship table with a **"Show
  more"** control that appends the next D5 page via `nextCursor`. *(Recommended.)*
- **OD-B — inactive-capability behavior (primary).** When `equipment.compatibility.view` is not granted
  (the D6 reality for everyone), **HIDE the section entirely** (no read, no placeholder) — consistent with
  nav `capabilityAccess` gating — reserving a rendered neutral state for the **transient** `UNAVAILABLE`
  case only. *(Recommended: hide-on-not-granted; the alternative is a permanent neutral "unavailable"
  card.)*
- **OD-C — field allowlist.** Approve the §4 sanitized allowlist (model display + relationship fields +
  verification/operational + bounded evidence summary), and whether the opaque `compatibilityId`/
  `equipmentModelId` are shown at all (recommend **not shown**, or shown only as inert copy). *(Recommended.)*
- **OD-D — pagination interaction + page size.** "Show more" cursor pagination; UI page size **10** per
  fetch (below D5 `DEFAULT_PAGE = 25`, `MAX_PAGE = 50`) to keep the section compact. *(Recommended.)*
- **OD-E — mobile presentation.** `.fo-table-scroll` on wide viewports, collapsing to **stacked per-record
  cards** under the 640px breakpoint. *(Recommended.)*
- **OD-F — the future callable seam.** Approve the §5 `EquipmentCompatibilitySource` interface; in D6 the
  production binding is an **inert placeholder** (never calls a backend, returns `unavailable` if reached,
  and is unreachable behind the capability gate); the real onCall-backed binding is wired **only at D10**
  when the callable is exported/deployed. *(Recommended.)*

No activation, grant, deployment, production, D7, or Part-ID decision is requested here.

## 9. Proposed governance text (NOT appended here)

*Provided for placement if D6 is approved; this package modifies neither `docs/DECISIONS.md` nor
`docs/architecture/SYSTEM_AUTHORITIES.md`.*

> **## NN. Equipment–Part Compatibility D6 Part Detail MVP — authorized (repository-only, inert UI)**
> APPROVE a capability-gated, inert "Used In Equipment" section in Inventory Part Detail consuming the D5
> read contract via an injectable source; fail-closed per-section states; no capability activation/grant,
> no callable export, no deployment, no production access, no persistence mutation, no fallback data, no
> Part-ID change, no move of Parts Catalog out of Inventory. `equipment.compatibility.view` stays
> `active:false`; the live source is wired only at D10. Owner decisions OD-A..OD-F as recorded.

## 10. What this package explicitly does NOT do

No D6 code; no component/service/view-model; no permission-catalog change; no capability activation or
grant; no callable export; no Functions/Rules/index/Hosting deployment; no Firebase or production access;
no persistence or trusted-command mutation; no import execution; no D7 installed-asset linkage; no
D10/D11; no Truck Inventory; no downstream consumer; no Customer/Auth work; no Part-ID rename/rekey/
replace; no move of Parts Catalog out of the Inventory domain; no change to `docs/DECISIONS.md` or
`SYSTEM_AUTHORITIES.md`. **Documentation only, PENDING — NOT AUTHORIZED**, returned for Codex review and
Owner decision before any D6 implementation gate is opened.
