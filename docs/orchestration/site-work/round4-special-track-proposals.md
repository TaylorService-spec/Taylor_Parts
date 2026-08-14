# Round-4 Deferred Items — Analysis & Recommendations

**Status:** PROPOSALS ONLY — nothing built, nothing applied. Owner authorized "draft options, don't build" (2026-08-13). The two Tier-2 rules snippets below are *proposed text*, NOT applied to `firestore.rules`. The two truck items are product/config decisions.

Source findings: `docs/orchestration/site-work/round4-candidates.json` (tracks `owner-decision`, `tier2-rules`).

---

## Item 1 (OWNER-DECISION) — `truck-deactivate-permanently-fails-unknown-inventory`

### Problem
`deactivateTruckCallable` (`functions/src/truckRegistry/truckRegistryCallables.ts:155-163`) calls `deactivateTruck()` with no `deps` override, so `resolveDeps()` (`truckRegistryCommands.ts:88-99`) falls back to the module default `UNKNOWN_INVENTORY` (`truckRegistryCommands.ts:59-60`), which always returns `"UNKNOWN"`. `deactivateTruck`'s `apply` (`truckRegistryCommands.ts:327-338`) throws `InventoryStateUnknownError` whenever presence `!== "ABSENT"`, so **every call fails** → `failed-precondition` ("Inventory state cannot be confirmed, so deactivation is blocked.").

Yet the control ships enabled in production:
- `config/environments.json:112` — `taylor-parts-production.readiness.TRUCK_MANAGEMENT_WRITE_READY: true`
- `field-ops-app-vite/src/config/truckManagementReadiness.js:22` resolves that flag
- `field-ops-app-vite/src/modules/inventory/truckManagement/ManageTruckDrawer.jsx:139-141` — "Confirm deactivate" gated only on `busy`; the action button at `:73` gated only on `!writeReady`.

### Options
**(a) Gate the deactivate control off in production (repo-only, Tier-1).** Introduce a distinct readiness flag (e.g. `TRUCK_DEACTIVATE_READY`), default `false` in every `config/environments.json` entry until a real `GovernedInventoryProbe` ships. Gate `ManageTruckDrawer.jsx:73` and `:139-141` on it, and show an explanatory notice ("Deactivation requires inventory verification, not yet available") rather than a silent disable. Surgical single-button gate — create/assign-driver/change-status/change-home-warehouse/reactivate are unaffected (none touch the inventory probe).

**(b) Build the governed inventory-presence source.** A real, persisted, MOBILE-location-indexed governed inventory model for trucks so a `GovernedInventoryProbe` can answer PRESENT/ABSENT for `mobile_locations/{locationId}`. Per `operationalReferenceProbe.ts:11-20`, no such persistence exists today (`inventory_transactions` is workOrder/part-keyed and location-blind; `stock_locations` is warehouse-keyed). Multi-week capability build; intersects the Serialized Asset / Equipment Custody P0 work.

### Recommendation
**(a) now** (Tier-1, stops shipping a guaranteed-fail destructive control), **(b) later** as a distinct roadmap item scoped alongside Equipment Custody / Serialized Asset. Do not build (b) as a quick follow-on.

---

## Item 2 (OWNER-DECISION) — `truck-delete-created-in-error-permanently-fails-unknown-references`

### Problem
`deleteTruckCreatedInErrorCallable` (`truckRegistryCallables.ts:182-193`) injects the real probe `buildOperationalReferenceProbe` (`operationalReferenceProbe.ts:119-141`), but all **11** `REFERENCE_AUTHORITIES` (`operationalReferenceProbe.ts:86-97`: serializedAssets, partsStock, transferOrders, transferLines, ledgerEvents, custodyAssignmentHistory, receiving, reconciliation, cycleCount, rma, scrap) are wrapped in `unverifiable()` (`:80-82`) → each returns `"UNKNOWN"`. `aggregateReferenceStates` (`:102-107`) forces `UNKNOWN` if any authority is inconclusive, and the command (`truckRegistryCommands.ts:439-441`) fails closed on anything but `"CLEAR"`. So **every delete fails** → `failed-precondition`.

Same production exposure: admin "Danger zone" delete enabled whenever `writeReady` (`ManageTruckDrawer.jsx:195-196`, confirm dialog `:208-227`), with `TRUCK_MANAGEMENT_WRITE_READY: true` in prod.

### Options
**(a) Gate the delete control off in production** with a dedicated `TRUCK_DELETE_READY` flag, same mechanism as 1(a), applied to `ManageTruckDrawer.jsx:196` and the dialog confirm at `:219`. Repo-only, fast, zero risk.

**(b) Build the governed reference sources** — strictly larger than 1(b): 11 authorities wired to real MOBILE-location/truck-indexed persistence. None exist today (`operationalReferenceProbe.ts:11-20`). `buildReferenceCrosswalk()` (`:111-113`) gives a per-authority checklist; note the aggregator fails closed even if 10 of 11 ship, so it's all-or-nothing to activate.

### Recommendation
**(a) now**, same rationale (a destructive, irreversible, admin-only control should not be live while provably unable to succeed). **(b)** long-horizon; activate each authority's check only when its own governed persistence ships (the file's own design intent), keeping `TRUCK_DELETE_READY` false until the aggregate can plausibly reach CLEAR. Not near-term; do not schedule ahead of runway work.

---

## Item 3 (TIER2-RULES) — `locations-write-rule`

### Problem
`firestore.rules:1337-1341` allows `create, update` on `/locations/{locationId}` for any admin/dispatcher with **zero field validation** — no key allowlist, no `accountId` type check, no immutability guard. So `accountId` can be changed on an existing Location, silently re-parenting it to a different Account and diverging from equipment that validated against the old `accountId` at create time (`equipmentLocationBelongsToAccount`, `firestore.rules:1434-1439`). Materially weaker than sibling `accounts` (`:1315-1335`) and `equipment` (`:1501-1517`, which enforces a `hasOnly` allowlist + `affectedKeys()` immutability on `accountId`). `locations` has no callable/writer — Rules are the only enforcement point (`field-ops-app-vite/src/domain/locations.js:18-24` writes direct via `makeCollectionStore`).

### Recommendation
Tighten to match the established `equipment` pattern. **Tier-2** — needs review + `firebase deploy --only firestore:rules` + `verify-rules-deploy`.

### Proposed change (NOT applied)
```javascript
function locationWritableKeys() {
  return ["accountId", "name", "address", "accessNotes", "createdAt", "updatedAt"];
}

match /locations/{locationId} {
  allow read: if isAdminOrDispatcher();

  allow create: if isAdminOrDispatcher()
    && request.resource.data.keys().hasOnly(locationWritableKeys())
    && request.resource.data.keys().hasAll(["accountId", "name", "createdAt"])
    && request.resource.data.accountId is string && request.resource.data.accountId.size() > 0
    && request.resource.data.name is string && request.resource.data.name.size() > 0;

  // accountId immutable after create; other writable keys may change freely (equipment affectedKeys() pattern).
  allow update: if isAdminOrDispatcher()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["name", "address", "accessNotes", "updatedAt"])
    && request.resource.data.accountId == resource.data.accountId;

  allow delete: if false;
}
```
Note: `accessNotes` optional (`locations.js:5`) — in the allowlist but not the create `hasAll`. Confirm exact field list against callers of `createLocation`/`updateLocation` before merging (derived from the domain comment + sole writer, not a live-data audit).

---

## Item 4 (TIER2-RULES) — `inventory-actions-create-rule`

### Problem
`firestore.rules:1167-1171` — `allow create` is bare `isAdminOrDispatcher()` with no shape/value validation, despite the comment immediately above (`:1160-1166`) claiming parity with `reorder_requests` (which enforces a 35-key canonical schema, `hasCanonicalReorderRequestKeys`, `:208-236`). The sole writer `recordInventoryAction()` (`field-ops-app-vite/src/domain/inventoryActions.js:38-65`) produces a canonical 7-key shape (`partId, transactionType, quantityDelta, reason, notes, createdBy, createdAt`), with `transactionType ∈ {RECEIVE_STOCK, ADJUST_STOCK, CORRECT_MISTAKE}` (`domain/constants.js:282-286`), non-zero finite `quantityDelta` (positive for RECEIVE_STOCK), and CORRECT_MISTAKE requiring reason+notes — **none enforced server-side**. There is no Cloud Function writer, so any admin/dispatcher client can write arbitrary/invalid docs to this append-only audit ledger with no backstop.

### Recommendation
Enforce the canonical shape, mirroring `reorder_requests`. **Tier-2** — needs review + deploy + `verify-rules-deploy`.

### Proposed change (NOT applied)
```javascript
function inventoryActionWritableKeys() {
  return ["partId", "transactionType", "quantityDelta", "reason", "notes", "createdBy", "createdAt"];
}
function isValidInventoryActionType(t) {
  return t in ["RECEIVE_STOCK", "ADJUST_STOCK", "CORRECT_MISTAKE"];
}

match /inventory_actions/{actionId} {
  allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER");

  // Canonical-shape gate derived from recordInventoryAction() (inventoryActions.js:38-65).
  // Append-only ledger — update/delete stay false; a correction is a NEW CORRECT_MISTAKE action.
  allow create: if isAdminOrDispatcher()
    && request.resource.data.keys().hasOnly(inventoryActionWritableKeys())
    && request.resource.data.keys().hasAll(["partId", "transactionType", "quantityDelta", "createdBy", "createdAt"])
    && request.resource.data.partId is string && request.resource.data.partId.size() > 0
    && isValidInventoryActionType(request.resource.data.transactionType)
    && request.resource.data.quantityDelta is number && request.resource.data.quantityDelta != 0
    && (request.resource.data.transactionType != "RECEIVE_STOCK" || request.resource.data.quantityDelta > 0)
    && (request.resource.data.reason == null || (request.resource.data.reason is string && request.resource.data.reason.size() > 0))
    && (request.resource.data.notes == null || (request.resource.data.notes is string && request.resource.data.notes.size() > 0))
    && (request.resource.data.transactionType != "CORRECT_MISTAKE"
        || (request.resource.data.reason is string && request.resource.data.reason.size() > 0
            && request.resource.data.notes is string && request.resource.data.notes.size() > 0))
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.createdAt is number;

  allow update, delete: if false;
}
```
Note: `createdBy == request.auth.uid` is a *new* constraint (client sets `createdBy: auth.currentUser?.uid`, already the caller's uid in practice) — closes the spoofing gap like `reorder_requests`' `requestedBy == request.auth.uid` (`:248`). Confirm no caller depends on a null/different `createdBy` before merging.

---

## Summary for the Owner
| Item | Track | Recommendation |
|---|---|---|
| Truck deactivate always-fails | owner-decision | Gate off in prod now (Tier-1 flag); build inventory-presence source later (roadmap) |
| Truck delete always-fails | owner-decision | Gate off in prod now (Tier-1 flag); build 11-authority persistence long-horizon |
| `locations` write rule | tier2-rules | Adopt proposed predicate; Tier-2 deploy+verify |
| `inventory_actions` create rule | tier2-rules | Adopt proposed predicate; Tier-2 deploy+verify |

If you approve the truck gate-offs, each is a small repo-only PR I can dispatch. The rules changes need a Tier-2 rules-authoring workstream (review → `firebase deploy --only firestore:rules` → `verify-rules-deploy`) — I can prepare the branch but not deploy.
