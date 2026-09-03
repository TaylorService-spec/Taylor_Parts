---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-09-03
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: BIN-P3 — Administration racking configuration and generator

**Architecture:** [ADR-014](../architecture/ADR-014-warehouse-and-bin-inventory-custody-model.md) and **Decision #160**. **Source verified against** `origin/main` @ `5824df2a6afd91a145ccc081502e9da42a479125` on 2026-09-03.

## Executive summary

BIN-P1 built the governed bin registry: stable `binId`, structured `area`/`aisle`/`bay`/`position`, warehouse-scoped canonical code claims, rename that preserves identity, and trusted reads. Every one of those commands is reachable only from a script or a test today. **No operator can configure a single rack.**

BIN-P3 gives an authorized administrator the ordinary EOS Administration workflow: pick a warehouse, see its bins, generate a proposed Area/Aisle/Bay/Position layout, **preview every exact code before anything is written**, apply it resumably, and afterwards add, correct, retire or revive individual positions.

It introduces **no new persistent configuration model**, **no new capability**, **no quantity anywhere**, and **no labels**.

## The identity stop-gate, answered first

The task asks whether generator and manual creation can coexist with P1's caller-supplied `idempotencyKey` contract *without* changing stable bin identity semantics.

> **YES. No change to the P1 identity contract, and no Owner decision required.**

**Why.** P1 derives `binId = "bin_" + sha256(idempotencyKey).slice(0,40)` and validates the key only as a non-blank string (`binRegistry.ts` — `idempotency_key_invalid` fires on empty/blank alone). **Nothing in the contract requires the key to be random.** P1 chose a caller-supplied nonce so a retry addresses the same document; a caller supplying a *deterministic* key satisfies that intent more completely, not less.

**The mechanism.** Both Administration create paths — the generator and the single-bin form — derive the key from the **structured creation identity**, using one shared client-side function:

```
binIdempotencyKey(v) = `binadm:v1:${warehouseId}:${area}:${aisle}:${bay}:${position}`
```

Consequences, each of which is the desired behaviour:

| Scenario | Result |
|---|---|
| Same layout generated twice | identical key → identical `binId` → `unchanged` replay, **no second bin** |
| Operator adds `A01-001` by hand, then a generator run covers it | identical key → **same `binId`**, replays as `unchanged` — not merely "conflict prevented" |
| Generator run, then the same layout re-applied after a partial failure | completed rows replay; only the remainder is created |
| Two different structured locations | different keys → different `binId`s |

**The namespace and version matter.** `binadm:v1:` is deliberate. It scopes the derivation to Administration-authored bins and leaves room to change the derivation later *for new bins only* without disturbing existing identities — the property that makes this safe to adopt now.

**One honest caveat.** A bin created earlier under a *different* key — a script, a scenario runner, a hand-crafted call — has a different `binId`. A later generator run for that same structured location produces a different key, so the **code claim refuses it** with `CODE_RESERVED`. That is correct: two records for one physical shelf must never exist. The preview classifies such a row as `CODE_RESERVED` and explains it. It is not a defect and it needs no migration — the BIN-P2R census measured **zero bins in both sandbox and production**, so there is no legacy population to reconcile.

**What this does NOT do:** it does not change `deriveBinId`, the fingerprint, the stored shape, or any existing bin's identity. The derivation lives entirely in the Administration client.

---

## Verified current state

### Bin command authority (BIN-P1, live in the repository, inert in every environment)

| Operation | Command | Capability |
|---|---|---|
| Create | `createBin` | `inventory.location.bin.manage` |
| Rename / physical correction | `renameBin` | `inventory.location.bin.manage` |
| Retire / revive | `setBinStatus` | `inventory.location.bin.manage` |
| Resolve a human code | `resolveBinCode` | `inventory.location.bin.read` |
| Resolve a scanned token | `resolveBinToken` | `inventory.location.bin.read` |
| List a warehouse's bins | `listBinsForWarehouse` | `inventory.location.bin.read` |

All six are exported as callables from `functions/src/index.ts` and reachable from `services/binCommandClient.js`. **Both capabilities are registered `active: false` and granted to no Role**, with no per-environment override, so every call resolves `permission-denied` today.

Stored bin shape: `binId`, `fingerprint`, `warehouseId`, `area`, `aisle`, `bay` (integer), `position` (integer), `code` (derived), `name` (optional, non-identity), `status`, `version`, `schemaVersion: 2`, `idempotencyKey`, audit fields. `bin_code_claims` reserves each canonical code to one `binId`, `HELD` then `SUPERSEDED`, permanently, with no release command.

### Administration surfaces that exist

`modules/administration/` holds `AdministrationOverview`, `AdminUsers`, `AdminRolesPermissions`, `AdminObjects`, `AdminDuplicateRules`, `EmployeesList`, `ApprovalRequests`, `IntegrationsFaq`, `AdministrationUnavailable`. Routing lives under the `administration` key in `navConfig.js`. **There is no inventory-location Administration surface at all.**

`AdminDuplicateRules.jsx` is the pattern to follow for an honestly-disabled write surface: controls render as `variant="protected"` with the reason stated, rather than looking live and silently doing nothing.

### BIN-P2R closure and its release dependency

`stock_locations` has **zero runtime readers, zero writers, and no Rules allow** — backend (P2), client and Rules (P2R). Nine inert documents remain in sandbox and production, untouched.

> **P2R is merged but NOT deployed.** This does not block P3's specification, implementation, tests or merge. It **does** create a release prerequisite: **before any P3 Hosting release, the P2R Hosting bundle and the Firestore Rules retirement must go out as one coordinated release**, so a live bundle expecting `stock_locations` is never served against Rules that deny it. Carried here so it cannot be forgotten at the release gate.

---

## Scope

- Administration navigation and composition for warehouse racking.
- A **pure** layout generator with preview.
- Resumable bulk apply over the **existing** `createBin` authority.
- Single-bin create, rename, retire, revive over the existing commands.
- The shared deterministic idempotency derivation above.
- Truthful unavailable states while capabilities remain inert.

## Explicitly out of scope

- **No new persistent configuration collection** — see the ruling below.
- **No new capability, no activation, no grant.** BIN-P4 owns those, after P3 *and* P6.
- **No Firestore Rules change.**
- **No quantity of any kind** — no on-hand, available, reserved, `binQuantity`, or stock count. BIN custody does not exist until BIN-P6.
- **No labels** — no printable output, PDF, ZPL, symbology choice, barcode rendering or CSV export. BIN-P5.
- **No warehouse map or visualization** — no coordinates, floor plan, drawing schema or image references.
- **No delete-bin control** and **no code-claim release control.** Operational bins remain historical; a reserved code stays reserved.
- **No `depth` / `width` / `height` / `oversized` / `palletClass` / `shelfGeometry`** — see C-7.
- **No Warehouse creation** — see G10.
- **No bulk formatter change.** See *Display width*.

---

## Ruling: no second racking-configuration registry

> **`bins/{binId}` IS the physical racking configuration authority.** P3 creates no `racking_configs`, `warehouse_layouts`, `aisle_configs`, `bay_configs` or `bin_templates`.

Administration input is **transient planning input**, held in component state for the duration of one configure→preview→apply session and then discarded:

```
operator enters desired layout
  -> pure generator
  -> PREVIEW of proposed governed bins
  -> validation / conflict classification
  -> explicit Apply
  -> existing governed createBin
  -> bins/{stable binId}
```

Once created, the bin records **are** the durable truth. The form is not persisted so it can be reopened; re-deriving a layout from the governed bins is always possible, and a stored form would immediately become a second, staler description of the same racking. If reusable rack templates later prove valuable, they can be designed then — **YAGNI**.

---

## Administration composition

```
Administration
  └── Inventory / Locations
        └── Warehouses            (governed warehouse list, read)
              └── Racking / Bins  (per warehouse)
```

Workflow: choose warehouse → review areas and configured bins → **Add one bin** *or* **Generate layout** → configure area → aisles → per-aisle bay counts → per-bay position counts and overrides → **Preview** → **Apply** → results → return to the governed list.

Uses the existing EOS Administration visual language and the current North Star colour schema. It is a section of Administration, **not a standalone warehouse application**. Desktop/tablet first; mobile must remain usable (readable, operable, no horizontal page scroll) but is not the design target.

---

## Generator input model

### Area

Operator-entered, validated by P1 as shape only: normalized to upper-case with whitespace collapsed to `_`, matching `/^[A-Z][A-Z0-9_]{0,31}$/`. **P3 defines and enforces no site-specific Area vocabulary.** `PARTS` and `WAREHOUSE` are illustrations, not canonical Taylor values.

**C-2 therefore does not block P3.** When Taylor settles its area codes, an operator types them — no developer code, no deploy.

### Aisles

Two input modes, and nothing more elaborate:

1. **Range** — `A` through `H`, or `AA` through `AF`. Expanded left-to-right over the same width; a range whose endpoints differ in width or whose end precedes its start is rejected with a plain message.
2. **Explicit list** — `A, B, D, F` for racking that skips letters, or any warehouse that does not follow a clean sequence.

Every generated aisle must pass P1's `/^[A-Z]{1,2}$/`. **No formula or expression language** — a spreadsheet dialect is a maintenance liability and nothing here needs one.

### Bays — per aisle, not per warehouse

Bay count **varies by aisle**, so a single warehouse-wide count is not offered as the only option:

```
Area PARTS
  Aisle A: 8 bays
  Aisle B: 12 bays
  Aisle C: 5 bays
```

The form takes a default bay count for the area and a per-aisle override. `bay` is stored as its **integer** value; display width is not identity and is not stored.

### Positions — per bay, with overrides

Client "Bin Count" means the number of physical storage positions in a bay.

- **Default position count per aisle**, with a **per-bay override**.
- **Explicit position list** for an irregular bay: `1, 3, 9`.
- **Omitted positions stay omitted** — the generator proposes exactly what was asked for.

```
Aisle A: default 6 positions per bay
  Bay 01: 6
  Bay 02: 6
  Bay 03: 3
  Bay 04: explicit -> 001, 003, 009
```

An operator must never be forced to hand-create every position because one bay is irregular.

### Odd-number default generation

For a count of `N`, the generator proposes positions `2i − 1`:

| N | Positions |
|---|---|
| 1 | `001` |
| 3 | `001, 003, 005` |
| 10 | `001` … `019` |

**This is generation policy only.** Even positions are fully valid: an operator can later create `002` between `001` and `003` with no renumbering and no identity change, because `position` is an integer and nothing anywhere encodes `position % 2 == 1`. A test asserts that rule is absent from the schema.

### Display width — pinned, deliberately

P1's formatter policy is **server-owned and injected**, currently pinned to bay width 2, position width 3, separator `-` (`A01-003`, `AA01-003`).

**P3 does not make it configurable.** Administration may *display* the resulting code convention, but there is no width toggle and no formatter configuration collection.

The reason is not caution, it is arithmetic: the canonical code is derived from the structured attributes, so **changing the width changes the canonical code of every bin under that warehouse**. That is a **bulk rename** — every affected bin runs the rename path, every old code becomes a `SUPERSEDED` reservation, and **every printed label's visible text goes stale**. It is not a cosmetic toggle and must never be presented as one.

**C-1 (one-digit or two-digit warehouse bays) is unresolved**, and BIN-P5 cannot mass-print until it closes. Introducing a mutable width before that answer would invite exactly the silent mass rename this paragraph exists to prevent.

### C-7 — irregular, deep and oversized positions

P3 supports irregular **physical structure** through the input model above: differing bay counts, differing position counts, explicit positions, omissions, and later even-position insertion.

It **invents no descriptive attributes**. No `depth`, `width`, `height`, `oversized`, `palletClass` or `shelfGeometry` until Taylor confirms those facts need recording. The existing optional non-identity `name` may be displayed where useful; **P3 adds no name-update verb** — consistent with the BIN-P1 ruling.

**C-7 therefore does not block P3.**

---

## The generator is pure

```
generateRackingLayout(input) -> ProposedBin[]
```

No Firestore, no capability check, no writes, no side effects, no clock. Unit-testable without an emulator.

Each proposed row carries:

```
area · aisle · bay · position       the structured identity
code                                canonical code preview, via the pinned formatter
idempotencyKey                      the deterministic derivation above
classification                      NEW | ALREADY_EXISTS | CODE_RESERVED | CONFLICT | INVALID
reason                              present on anything not NEW
```

**The generator never authors a `binId`.** Identity remains server-derived by `createBin`. The generator's `idempotencyKey` is an input to that derivation, not a claim on it.

Classification is computed by comparing the proposed set against the warehouse's existing bins (from `listBinsForWarehouse`) and their claims:

| Classification | Meaning |
|---|---|
| `NEW` | no existing bin and no claim on this code |
| `ALREADY_EXISTS` | a bin already holds this structured identity **and** the same derived key — applying replays as `unchanged` |
| `CODE_RESERVED` | the canonical code is `HELD` or `SUPERSEDED` by a **different** bin — apply would be refused |
| `CONFLICT` | two proposed rows resolve to the same structured location — a duplicate **within** the request |
| `INVALID` | fails P1 validation (area, aisle, bay, position or code shape) |

---

## Preview before apply

**No bulk generation writes from form input.** Apply is reachable only from a preview the operator has seen.

Preview shows, at minimum: the number of bins proposed; the exact human code for every row; area/aisle/bay/position; duplicates within the proposed set; conflicts with existing governed bins; rows that would replay unchanged; invalid rows; and the total that would actually be created.

**Aggregate counts are computed from the row set**, never independently — a summary that can disagree with its own table is a lie waiting to happen.

**A preview containing any `INVALID` row cannot be applied.** `CODE_RESERVED` and `ALREADY_EXISTS` rows do not block apply; they are skipped or replayed and reported.

---

## Bulk apply

**No giant transaction.** A warehouse may hold thousands of positions, and P1's per-bin transaction is already the correct atomic unit: one bin, one claim, one commit.

**Bounded client orchestration over the existing `createBin` callable**, with a small concurrency limit (4) and per-row result capture.

**No new bulk callable is specified.** A thin trusted bulk command was considered and rejected: it would either duplicate `createBin`'s logic — a second writer, the thing this programme keeps retiring — or wrap it, adding a deploy surface and an error-mapping layer for no behaviour the client cannot already achieve safely. If a future run proves client orchestration too slow at real scale, a bulk callable can be added **delegating to the same `createBin`**, under the **same** `inventory.location.bin.manage`, with no new capability. **YAGNI until measured.**

**Semantics:**

- **Resumable.** A retry of the same layout re-derives the same keys; completed rows replay as `unchanged` and only the remainder is created.
- **Idempotent.** Never a duplicate bin, never a renumbered one.
- **Truthful on partial completion.** Row 301 failing does **not** roll back 300 successfully configured physical locations — they are real, committed, and correct. The result reports per-row outcome plus an aggregate: **created / unchanged / conflicted / refused**.
- A row that failed is **never** reported as succeeded.

Progress is visible during a long apply, and the result summary is derived from the row results.

---

## Existing-bin administration

| Action | Command | Notes |
|---|---|---|
| List | `listBinsForWarehouse` | grouped by area → aisle → bay |
| Display | — | current canonical code, area, aisle, bay, position, status, optional `name` |
| Create one | `createBin` | same deterministic key derivation as the generator |
| Rename / correct | `renameBin` | **`binId` preserved**; old code becomes `SUPERSEDED` and stays reserved |
| Retire | `setBinStatus` → `INACTIVE` | frees no code |
| Revive | `setBinStatus` → `ACTIVE` | same `binId`, reclaims nothing |

**No delete control. No claim-release control.** Both are absent from the UI because both are absent from the authority, and a button for an operation the server refuses is a lie.

A rename must state its consequence before it is confirmed: the code changes, the old code stays reserved to this bin, and **any printed label showing the old code becomes stale** — the barcode keeps working, because the machine token is the `binId`.

---

## G10 — Warehouse creation authority census

The implementation plan assigned "Warehouse creation has no callable" to P3. Measured against current `main`:

| Finding | Evidence |
|---|---|
| A governed `createWarehouse` **already exists** | `warehouseGovernance/warehouseStatusWriter.ts:113` — creates NATIVE records under an `expectedVersion` CAS, through the same §3A validator |
| It is **already gated** | line 127 authorizes `inventory.warehouse.status.set`, the same capability `setWarehouseStatus` uses |
| It is **not exported** | zero references in `functions/src/index.ts`; no callable, production-inert |
| **`inventory.warehouse.status.set` is NOT REGISTERED in the permission catalog** | absent from `permissionCatalog.ts` and from every Role; referenced by string only |

**This is not Case A.** The writer exists and the authority decision was already made inside it, but the capability it names **does not exist in the catalog**, so no callable could be authorized without **registering a new capability** — which P3 is explicitly not authorized to do, and which is a listed stop condition.

> **G10 remains a separately gated Administration gap.** P3 configures racking on **existing** warehouses, which is all Taylor's Phoenix site needs. G10 must not be allowed to force a capability expansion into this work.

Two observations recorded for whoever closes G10, neither actionable here:

- the capability name `inventory.warehouse.status.set` also gates **creation**, which is a broader authority than its name suggests — worth deciding deliberately rather than inheriting;
- `inventory.location.bin.manage`'s catalog description says *"Create, retire or revive"* and predates BIN-P1's `renameBin`. The description is stale, not the authority — renaming racking is registry maintenance and is correctly covered. A description-only correction is a reasonable P3 addition; it changes no id and no grant.

---

## Capability posture

Unchanged. `inventory.location.bin.manage` and `inventory.location.bin.read` stay **`active: false`, granted to no Role**. P3 activates nothing and grants nothing; BIN-P4 owns that, after P3 **and** P6.

The Administration UI wires to the real client command service and **renders an honest unavailable state** when the capability or transport is not operational — following `AdminDuplicateRules.jsx`'s posture: controls visible and clearly disabled with the reason stated, rather than a screen that looks live and silently does nothing.

**No fixtures, and no fabricated success.** A refusal renders as a refusal. A surface that fakes a created bin in sandbox teaches an operator to trust a number the server never wrote.

---

## Error and failure handling

Each of P1's failure classes maps to a distinct, plain-language message — none collapses into another, because each calls for a different fix:

| Failure | Operator reads |
|---|---|
| `IDEMPOTENCY_CONFLICT` | the same request id was used for a different bin — this should not occur under the deterministic derivation, and if it does it is a defect worth surfacing loudly |
| `CODE_RESERVED` | that code already belongs to another rack in this warehouse |
| `CLAIM_INTEGRITY` | this bin's code reservation could not be verified — nothing was changed, and retrying will not fix it |
| `MALFORMED_STORED_RECORD` | this bin's record could not be read |
| `DENIED` | you are not authorized |
| validation | the specific field that was rejected |

No message echoes a stored value or an internal path.

## Accessibility

Every control keyboard-reachable and operable in a logical tab order; preview and result tables use real table semantics with header associations; the apply confirmation is a focus-trapped dialog returning focus on close; progress and result summaries announce via `role="status"`; classification is never conveyed by colour alone — every row carries a text label; disabled controls state *why*.

**No destructive action disguised as formatting.** A width or format control that silently triggers a bulk rename is the specific anti-pattern this specification forbids.

---

## Testing strategy

**Generator (pure, no emulator)**

1. 1 position → `001`
2. 3 positions → `001, 003, 005`
3. N positions ends at `2N − 1`
4. an explicit even position `002` is valid
5. inserting `002` later leaves `001`/`003` identities untouched
6. per-aisle bay counts differ
7. per-bay position counts differ
8. an explicit position override is honoured
9. omitted positions stay omitted
10. a duplicate proposed structured location is detected before apply
11. an invalid area is rejected
12. an invalid aisle is rejected
13. `bay` integer semantics preserved — `"01"` is not a bay
14. `position` integer semantics preserved
15. an aisle range expands correctly; a malformed range is rejected

**Preview**

16. preview writes nothing — no callable is invoked
17. the exact human code is visible for every row
18. `NEW` classified correctly
19. an existing identical structured location classifies as `ALREADY_EXISTS`
20. a code held or superseded by another bin classifies as `CODE_RESERVED`
21. a preview containing `INVALID` cannot be applied
22. aggregate counts equal the row results

**Apply**

23. explicit confirmation is required
24. partial completion stays committed — no rollback of earlier rows
25. a retry is safe and creates only the remainder
26. no duplicate bin is ever created
27. existing identities are never renumbered
28. a failed row is never reported as created
29. no single transaction spans the layout

**Idempotency**

30. the same structured identity yields the same derived key
31. a manual create and a generator row for the same location yield the same `binId`
32. different structured identities yield different keys
33. the derivation is namespaced and versioned
34. no client code calls `deriveBinId` or authors a `binId`

**Administration**

35. list existing bins for a warehouse
36. create one bin
37. rename preserves `binId`
38. the old code remains reserved after rename
39. deactivate
40. reactivate
41. **no delete action exists**
42. **no claim-release action exists**

**Authority guards**

43. no quantity field is introduced anywhere in P3
44. no `inventory_transactions` write
45. no BIN custody
46. no Cycle Count change
47. no `firestore.rules` change
48. no capability activation
49. no grant change
50. **no second configuration collection is created**
51. `stock_locations` remains absent from runtime (P2R holds)
52. no visualization, coordinate, map or image field

**UX**

53. apply is unreachable without preview
54. conflicts are visible per row
55. the partial-result summary is truthful
56. controls are keyboard-accessible
57. no destructive action is disguised as formatting
58. the unavailable state is truthful when the capability is inert

## Acceptance criteria

- [ ] No new persistent configuration collection exists; generator input is transient.
- [ ] The generator is pure, authors no `binId`, and performs no I/O.
- [ ] Preview precedes every apply and shows every exact code, with row-level classification.
- [ ] Apply is resumable, idempotent, and truthful about partial completion.
- [ ] Manual and generator creation of the same structured location produce the **same** `binId` and replay.
- [ ] `deriveBinId`, the fingerprint, and the stored shape are unchanged; no existing bin identity moves.
- [ ] Odd-number default generation; even positions valid; `position % 2` appears nowhere in the schema or validators.
- [ ] Per-aisle bay counts and per-bay position counts are supported, with explicit overrides.
- [ ] No formatter width control; no bulk rename is reachable from P3.
- [ ] No quantity, custody, label, Rules, capability, grant or visualization change.
- [ ] Warehouse creation is **not** included; G10 is recorded as separately gated.
- [ ] `git diff` touches no `firestore.rules` copy, no capability id, and no role grant.
- [ ] All 58 tests pass.

## Rollback

Fully reversible. P3 adds an Administration surface over commands whose capabilities are `active: false` and granted to no Role, so **no principal can invoke anything it wires up, in any environment**. Reverting the PR removes the surface. No environment data can be written by this change.

## Deployment dependency

**P3 merges without deploying anything.** But before any P3 **Hosting** release:

> **The BIN-P2R Hosting bundle and the `stock_locations` Firestore Rules retirement must be deployed as one coordinated release**, so no live bundle expecting `stock_locations` is served against Rules that deny it. P2R is merged and undeployed today.

## Risks

- **The deterministic key is now load-bearing for identity.** It is namespaced `binadm:v1:` precisely so it can be revised for new bins without touching existing ones — but a careless change would fork identity for the same physical shelf. Tests 30–34 guard it.
- **A bin created outside Administration is unreachable by replay.** It resolves to `CODE_RESERVED`, which is correct and classified, but an operator will need the explanation. Environments hold zero bins today, so the exposure is future scripts.
- **Bulk apply at real scale is unmeasured.** Bounded client orchestration is the smallest correct approach; if a Phoenix-sized layout proves slow, the fallback is a bulk callable delegating to the same `createBin` — not a second writer.
- **The formatter is the one-way door.** Making width configurable before C-1 closes would put a silent mass rename behind a settings control. P3 does not offer it.
- **Honest-disabled surfaces get "fixed" by well-meaning people.** The unavailable state must stay honest until BIN-P4 activates the capabilities; wiring a fixture to make the screen "work" would be the exact failure this repository keeps correcting.

## Open questions

**No Owner architectural decision is open.** The identity stop-gate resolves **YES** with no contract change.

```
CLIENT (none blocks P3 implementation)
  C-1  Warehouse bay display width, one digit or two. P3 pins the approved P1
       formatter and offers no width control, so C-1 blocks only BIN-P5 printing.
  C-2  Final Phoenix area codes. P3 enforces no vocabulary; an operator types them.
  C-3  Which Areas exist. Same — shape-validated, not enumerated.
  C-7  Irregular / deep / oversized attributes. P3 models irregular STRUCTURE and
       invents no descriptive fields.

SEPARATELY GATED (not P3)
  G10  Warehouse creation. createWarehouse exists and is gated, but
       inventory.warehouse.status.set is UNREGISTERED in the catalog, so exposing it
       needs a new capability — outside P3's authority.
  BIN-P4  Capability activation and grants, after P3 AND P6.
  BIN-P5  Labels, blocked on C-1.
  BIN-P6  Bin-level custody, before any quantity may appear on a bin.
```

## Approval

Pending review. **Implementation is not authorized by the existence of this document.**
