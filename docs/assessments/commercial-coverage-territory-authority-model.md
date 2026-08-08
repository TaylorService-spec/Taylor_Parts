# Commercial Coverage & Territory Management — Authority Model (capability #15)

**Status:** Design-first / authority-first assessment + a PURE, inert foundation (this PR). No persistence, no
governed write, no Rules, no admin UI, no runway surface rewritten. Precedence / sales-credit / commission are
explicitly DEFERRED (a later formal assessment). Nothing here is activated or deployed.

## 1. Reconciliation against repository authority (verified)

A bounded data-flow trace (one SONNET reviewer) + direct inspection establish where today's code bakes in the
assumptions #15 generalizes. All are **additively generalizable** — coverage is a NEW parallel concept; nothing
below is rewritten in this PR.

| Assumption | Where (evidence) | #15 treatment |
|---|---|---|
| **One owner** | Opportunity `ownerEmployeeId` (opportunityCommands.ts:50-51, opportunityLifecycle.js:71); Sales Order `ownerEmployeeId` (salesOrderCommands.ts:52-53); Account `accountOwner` single Person Assignment (commercialProfile.js:191-216); reporting `accountOwner` single reference (reportCatalog.*:123/142) | **Additive.** Coverage is a new parallel concept; `ownerEmployeeId`/`accountOwner` stay exactly as-is (record owner, a *distinct* concept — §7). |
| **One channel** | `SALES_CHANNELS = ["NATIONAL_ACCOUNTS","RETAIL"]` **duplicated** in opportunityLifecycle.ts:24 (`isChannel`) **and** salesOrderLifecycle.ts:15 (`isSalesChannel`) + the client mirror opportunityLifecycle.js:10; write-side gates reject anything else (opportunityCommands.ts:115, salesOrderCommands.ts:125) | The two functions **enum gates are the change points** — become a configurable ref-data lookup in a later increment. Labels/UI/read are additive. `STRATEGIC_ACCOUNTS` is the first widening. |
| **Geography-only / none** | Only unstructured `state`/`city`/`zip` on Location address + Account `billingAddress` (LocationCreateModal.jsx, accounts.js:16); no `territory`/`region`/coverage field anywhere | No existing coverage to conflict with. Geographic coverage keys off `state`/`zip`; a later increment may normalize those free-text fields into a match key. |
| **Owner == coverage** | **No behavioral conflation** — no "my pipeline" filter by `ownerEmployeeId`; no commission/credit/security field rides on owner. Only structural seam: reporting can filter/group by the single owner. | Coverage-based report filters are **added alongside** the owner filter. Owner is *just* record-owner today — clean. |

**Conclusion:** coverage can be introduced as a clean, additive authority. Nothing forces owner to be the
exclusive commercial party; there is no coverage/credit/commission overloading to untangle.

## 2. Authority model (pure; `field-ops-app-vite/src/domain/commercialCoverage.js`)

- **Channel = configurable reference data.** `SEED_COMMERCIAL_CHANNELS` (RETAIL / NATIONAL_ACCOUNTS /
  STRATEGIC_ACCOUNTS) as `{id,label,active,hidden}` objects — NOT a frozen triad. `isConfiguredChannel(id,
  channels)` is the lookup that replaces the hardcoded enum gates when the runway adopts it. Extra dimensions
  may exist `hidden` until an authorized Admin enables them (hidden ≠ security).
- **Territory = a durable coverage OBJECT, independent of salesperson.** `TERRITORY_KINDS = STATE /
  STATE_GROUP / ZIP_GROUP / GEOSPATIAL` over a geographic **abstraction** (states / zips / zipPrefixes /
  opaque polygonRef) — capable of future geospatial WITHOUT a map vendor or polygon editor.
  `territoryCoversLocation(territory, {state,zip})` is pure; **GEOSPATIAL fail-closes** (never a fabricated hit
  until a geometry authority exists).
- **CoverageAssignment** = `{ assignee: <Person Assignment, reusing the account-owner shape>, scope: {kind:
  TERRITORY|ACCOUNT|NAMED_ACCOUNT|CORPORATE|CHANNEL, …}, responsibility: <configurable label>, priority:
  PRIMARY|SECONDARY|OVERLAY, effectiveFrom, effectiveTo }`. Assignments assign PEOPLE to SCOPES; a scope may
  combine a channel with a geographic/account scope. `responsibility`/`priority` are recorded labels, never a
  new identity and never security.
- **`resolveCommercialCoverage(context, assignments, {now, territoriesById}) → coverageAssignments[]`** — the
  resolver returns ALL assignments effective at `now` whose scope matches the context. **Geographic AND
  account/corporate AND channel coverage COEXIST; nothing is dropped.** It never picks a primary, never returns
  an owner, never computes credit/commission, never authorizes. Fail-closed → `[]`.
- **Effective-dated:** `isEffective(assignment, now)` (inclusive-from / exclusive-to / open-ended). A
  reassignment tomorrow does not rewrite who covered a context yesterday — proven by test.

## 3. Distinctions held (§7) — enforced by construction

The resolver returns coverage assignments **only**. `summarizeCoverage` is unit-tested to expose **no**
`owner` / `salesperson` / `credit` / `commission` / `winner` field. Commercial coverage ≠ record owner ≠ sales
credit ≠ commission ≠ security permission ≠ Service Territory. Service Territory (Dispatch/technician routing)
is a separate concept and authority — not modeled here.

## 4. Deferred (require their own decision; NOT implemented)

- **Precedence / override / inheritance** between corporate and local coverage — the resolver deliberately
  returns ALL matches with their `priority` preserved but chooses **no** winner. Precedence is a later formal
  assessment; silently implementing it is forbidden.
- **Sales credit / commission / My Book primary** — downstream concepts that CONSUME coverage but are distinct;
  not derived from coverage membership here.

## 5. Canonical persistence (intended authority — documented, built later behind protected gates)

The runtime authority will be governed collections — `commercial_channels` (ref data), `sales_territories`
(durable territory objects), `commercial_coverage_assignments` (effective-dated assignments) — written through
a governed command path (Admin-SDK, capability-gated), with client reads through an injected source seam
(mirroring the Opportunity/coordinated-operations pattern). Introducing those collections + a governed write +
Rules is a **protected activation** (capability grant / callable deploy / Rules), gated on Owner/operator
authorization — NOT part of this PR. The pure model here is the shape those will persist and the resolver they
will feed.

## 6. Implementation plan (additive increments)

1. **(this PR)** Pure authority model + resolver + tests — inert, no persistence.
2. Configurable-channel adoption: replace the two functions enum gates (`isChannel`/`isSalesChannel`) with the
   ref-data lookup + add `STRATEGIC_ACCOUNTS`; unify the duplicated `SALES_CHANNELS`. Additive; keeps write
   validation.
3. Governed persistence (collections + write command + Rules) — **protected**, gated.
4. Read projection + a My-Book / coverage read surface (consumes `resolveCommercialCoverage`), and coverage
   report filters added alongside owner — **UX-owned** for surface/IA.

## 7. Boundary

No capability grant, callable deploy, Rules change, production action, or admin UI in this PR. The two channel
enum gates and all owner surfaces are **untouched** (seams identified, not rewritten). Precedence / credit /
commission remain open.
