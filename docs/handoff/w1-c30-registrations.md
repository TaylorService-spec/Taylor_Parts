# W1-C30 — AI / contextual-assistant authority: registrations and findings

Branch `impl/w1-ai-assistant-authority`, from `33945090`.
Scope: `functions/src/ai/`, `functions/src/assistant/`, the AI provider policy, and the context those
surfaces may read. No business object is touched.

**Migration: none.** This lane changes no schema, adds no collection and stores no new field. The
reserved id `1760313600000` was not consumed and remains free.

---

## 1 — What is actually wired

There are two AI surfaces in this repository and only one of them is reachable at runtime.

| Surface | Files | Reachable? |
|---|---|---|
| Work Order readiness context + private interpretation | `functions/src/ai/` | **Yes** — two callables exported at `functions/src/index.ts:133` and `functions/src/index.ts:140` |
| Contextual assistant (gateway, tool registry, provider policy, telemetry) | `functions/src/assistant/` | **No** — nothing in `functions/src/index.ts` exports it; the only non-test importer in the repository is `functions/scripts/aiProviderSelfCheck.mjs:26` |

`functions/src/assistant/` is a designed, tested, unexported module tree. Its properties are real but
they are properties of code nothing calls. Every runtime statement below is about `functions/src/ai/`.

Client transport is gated off outside one sandbox: `WORK_ORDER_READINESS_CONTEXT_READY` is `true`
only for `eos-platform-sandbox` (`config/environments.json:81`) and `false` in production
(`config/environments.json:277`). While false the browser makes zero callable attempts
(`field-ops-app-vite/src/services/workOrderReadinessContextClient.js:19-21`).

---

## 2 — Registered exception: role-string Work Order visibility

`functions/src/ai/workOrderContext.ts:55-63` decides Work Order visibility from `users/{uid}.role`
(`admin`/`dispatcher` → any record; `technician` → only the record whose `assignedTechId` matches),
resolved by `functions/src/callerContext.ts:15-22`. This is a hand-copy of a `firestore.rules`
predicate, not a capability decision.

It is **not fixed in this lane** and the reason is recorded rather than worked around: the permission
catalog registers no `workOrder.read` id — only `workOrder.create` (`permissionCatalog.ts:94`),
`workOrder.transition` (`:100`), `workOrder.cancel` (`:107`), `workOrder.labor.record` (`:125`),
`workOrder.labor.correct` (`:133`), `workOrder.parts.plan` (`:141`). `permissionCatalog.ts` is a
shared file this lane must not edit, and minting a capability no Role grants and no other surface
honours would be worse than a visible, frozen gap.

**Frozen** by `functions/test/aiAssistantAuthorityBoundary.test.mjs` — `REGISTERED_ROLE_STRING_AUTHORITY`
contains exactly `ai/workOrderContext.ts`. A second role-string authorization anywhere in the AI or
assistant surface fails the suite.

**Owner needed:** whichever lane owns Work Order registers a `workOrder.read` capability; this
predicate is then the seam to replace under that capability's own authority decision.

---

## 3 — Open finding, not closed here: no operating-company dimension

`fieldops_wos` documents carry no `operatingCompanyId` (the string appears nowhere in
`functions/src/ai/` or in any Work Order type), and `assertWorkOrderContextReadable`
(`functions/src/ai/workOrderContext.ts:55`) lets any `admin`/`dispatcher` read **any** Work Order.
The readiness context and the interpretation envelope are therefore company-blind end to end.

The blindness is inherited, not introduced: procurement rows do carry a governed company
(`functions/src/reorderRequest/reorderCommands.ts:190`, derived from the warehouse), but
`loadReorderRows` joins them on `workOrderId` alone (`workOrderReadinessContext.ts:305-315`) because
the Work Order it joins from has no company to filter on.

Closing this means giving the Work Order an `operatingCompanyId`, which belongs to the Work Order
lane, not to this one. Recorded here so it is not mistaken for an assistant-only defect. Same class
as the AR/aging finding a sibling lane reported.

---

## 4 — Capabilities this lane began authorizing against

No new capability id. Two **existing** catalog ids are now consumed by the AI surface, replacing two
role-string checks:

| Dimension | Capability | Catalog | Previously |
|---|---|---|---|
| Procurement evidence | `reorder.request.read.queue` | `permissionCatalog.ts:447` | `caller.role === "admin" \|\| "dispatcher"` |
| Reorder suggestion eligibility | `reorder.request.create.system` | `permissionCatalog.ts:468` | `caller.role === "admin" \|\| "dispatcher"` |

Both are granted by the ADMIN and DISPATCHER compatibility Roles
(`functions/src/access/compatibilityRoles.ts:57` and `:60`, via
`SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`) and by governed business Roles
(`governedBusinessRoles.ts:183`, `:571`, `:825`). Both are catalog-active — neither carries
`active: false` — so no per-environment activation is required.

Constants: `PROCUREMENT_EVIDENCE_READ_CAPABILITY` and `REORDER_REQUEST_ELIGIBILITY_CAPABILITY` in
`functions/src/ai/workOrderReadinessContext.ts`, listed in `WORK_ORDER_READINESS_CAPABILITIES`
alongside `inventory.balance.read`.

**Behaviour change, stated plainly:** a principal who holds only the legacy `users/{uid}.role` string
and has no active `roleAssignment` document loses procurement evidence and the reorder suggestion.
`resolveEffectiveAccess` resolves from `roleAssignments` (`effectiveAccessFeed.ts:176-182`), never
from the legacy field. This is a narrowing in the fail-closed direction, it matches what the
inventory dimension on the same call has always done, and it surfaces honestly as the existing
`PROCUREMENT_READ_NOT_AUTHORIZED` limitation. The affected surface is sandbox-only today (§1).

---

## 5 — What leaves the EOS boundary

One transport, `functions/src/ai/workOrderReadinessContext.ts:590` → `operationalProvider`. The
envelope vocabulary is closed and enforced at runtime (`operationalProvider.ts:103-117`).

Sent: the Work Order business number (`sanitizeWorkOrderFacts` → `subject.reference`, from
`woNumber`), a counted observation, and one evidence line per planned part carrying part **name** or
**SKU**, planned/used/outstanding quantities, warehouse availability and procurement status
(`buildWorkOrderInterpretationInput`).

Not sent, verified: no customer name or id, no address, no contact, no price, cost or currency, no
credential, no Firestore id, no collection name, no query. `aiWorkOrderReadinessContext.test.mjs`
("output never exposes internal Work Order, customer or part ids") and the new
`aiAssistantAuthorityBoundary.test.mjs` ("a denied dimension contributes nothing to what is sent to
the model") assert this.

The `classification: "SYNTHETIC"` label is asserted from the runtime's own project identity, never
from the data and never from a caller (`runtimeSyntheticInterpretationPermitted`, resolved by
`resolveSyntheticOperationalInterpretation` at `environmentCapabilityOverrides.ts:388-403`, which
refuses production unconditionally). Exactly one environment declares it true: `demo-certworld`
(`environmentCapabilityOverrides.ts:646`). Production (`taylor-parts`) declares false at `:670`.

---

## 6 — Guard now in place

`functions/test/aiAssistantAuthorityBoundary.test.mjs` — 11 tests, mutation-proven (reintroducing the
role-string check and adding one chained Firestore write fails 7 of 11).

1. No role-string authority in the AI/assistant surface beyond the registered exception (§2).
2. The context assembler that feeds the model holds none at all.
3. Every capability the surface authorizes against is a registered catalog id, and none is in an
   `ai.*` / `assistant.*` namespace.
4. No write primitive in any file: no chained `.doc()/.collection()` set/update/delete/create/add,
   no `FieldValue`, no batch, no transaction.
5. No write-capable symbol imported from `firebase-admin/firestore`.
6. The callable surface is exactly `getWorkOrderReadinessContext` + `interpretWorkOrderReadinessContext`.
7-11. Behavioural: an `admin` with zero governed capability retrieves nothing and reads no source;
   each dimension is gated by its own capability independently; reading the reorder queue is not
   permission to create; a resolver failure denies everything rather than falling back to the role.
