# Inventory scanner program — delivery state

Companion to [the program specification](inventory-scanner-program.md). The specification says what
the scanner *should* be; this file says what is actually true in the repository right now, and is the
document to update when that changes.

**Last updated:** 2026-08-20 — Owner decisions #116–#119 recorded; Phases J1–J3 merged.

---

## 1. Why the states are separated

A single "done" column would be a lie in five different ways, so this document tracks five independent
facts per phase. They move independently and none implies another:

| State | Question it answers |
| --- | --- |
| **Repository** | Is the code written, reviewed, tested and merged to `main`? |
| **UX** | Is the user journey complete — real states, real copy, nothing stubbed? |
| **Backend** | Do the server-side commands and reads exist in the repository? |
| **Deployment** | Are those Functions actually *released* to an environment? |
| **Grant / activation / readiness** | Can a real person actually reach and use it? |

**MERGED is not DEPLOYED. UX COMPLETE is not USER OPERABLE.** Every phase below is
repository-complete. None is user-operable in production today, but they are not blocked on the same
thing: A, C, D and E all need Functions released and readiness flipped, while **F needs only a
Hosting release** — it introduced no backend and needs no capability activation.

## 2. Phase state

| Phase | Repository | UX | Backend | Deployment | Grant / activation / readiness |
| --- | --- | --- | --- | --- | --- |
| **A** — identifier administration | MERGED | COMPLETE | Written | **NOT DEPLOYED** | Capability registered; not activated |
| **B** — multi-line PO reconciliation + design | MERGED (docs + pure contracts only) | n/a | n/a | n/a | n/a |
| **C** — canonical multi-line receiving command | MERGED (#1354) | n/a (transport) | Written | **NOT DEPLOYED** | `inventory.stock.receive` active and granted; transport unreachable |
| **D** — multi-scan receiving journey | MERGED (#1355) | COMPLETE | Uses Phase C | **NOT DEPLOYED** | `RECEIVING_TRANSPORT_READY` is `false` outside `eos-platform-sandbox` |
| **E** — shared Scan workspace | MERGED (#1356) | COMPLETE | Composes C/D + existing scanner | **NOT DEPLOYED** | Reachable; supplier receiving inert until D's transport is ready |
| **F** — lookup-only scanning | MERGED (#1357) | COMPLETE | **No backend change** — reuses the existing client-direct `parts` read | **Hosting release only** | **No activation needed** for the Part-identity slice |
| **G** — barcode / alias lookup | MERGED (#1358) | COMPLETE | Written (trusted resolver + callable) | **NOT DEPLOYED** | **`inventory.catalog.alias.read` registered INERT, granted to nobody**; `PART_IDENTIFIER_TRANSPORT_READY` false in all four environments |
| **H** — complete read-only lookup | MERGED (#1359) | COMPLETE | Written (shared balance read; the other two already existed) | **NOT DEPLOYED** | Three inert capabilities: `inventory.serializedAsset.read`, `inventory.location.display.read`, `inventory.balance.read` |
| **I** — location reconciliation | ANALYSIS MERGED (#1360) | n/a | n/a | n/a | Resolved by DECISIONS #116 |
| **J1** — transfers by scan | MERGED (#1362) | COMPLETE | **No backend change** — reuses the existing transfer commands | **NOT DEPLOYED** | `inventory.transfer.dispatch` / `.receive` inert, granted to nobody |
| **J2** — warehouse-level cycle count by scan | MERGED (#1363) | COMPLETE | **No backend change** — reuses the existing cycle-count commands | **NOT DEPLOYED** | `inventory.cycleCount.create` / `.submit` inert, granted to nobody |
| **J3** — shared scanner input hardening | This change | COMPLETE | n/a — client input layer only | n/a | n/a |

### What "not deployed" means concretely

The Phase C and D callables exist in `functions/src/` and are exported from `functions/src/index.ts`.
They have never been released. `RECEIVING_TRANSPORT_READY`
(`field-ops-app-vite/src/config/receivingReadiness.js`) is `false` in every environment except
`eos-platform-sandbox`, so the client does not attempt them — it says so instead of failing.

Flipping that constant, deploying the Functions, granting capabilities and provisioning identities are
all operator actions. None of them was performed or authorized during any phase of this program.

## 3. Phase E — what was built

A shared **Service > Scanning > Scan** workspace that lists only the scanning workflows the caller can
actually complete, and launches the existing journeys.

### Access is derived, not declared

The load-bearing decision. The legacy `ROLE_NAV_ACCESS` map understands exactly three roles — `admin`,
`dispatcher`, `technician` — and cannot express a parts associate or a warehouse manager at all
(see [the access decision record](../governance/parts-scanner-access-decision.md) §3). Two shortcuts
were available and both were rejected:

- **Adding governed business roles to `ROLE_NAV_ACCESS`** would add keys nothing reads, and would put
  warehouse eligibility back under role names.
- **Creating a `scanner.access` capability** would invent a second, weaker authority answering a
  question `inventory.stock.receive` already answers, and one the backend never agreed to.

Instead the Scan nav item declares **both** paths that `isNavItemVisible` already supports:

```js
{ key: "scan", label: "Scan", path: "scan", legacyKey: "fieldMode",
  capabilityAccess: RECEIVING_SURFACE_CAPABILITIES }
```

A governed persona reaches it through `capabilityAccess`; a legacy technician reaches it through
`legacyKey`. No new capability, no new role, no change to `ROLE_NAV_ACCESS`.

Within the workspace, `src/access/scanWorkflows.js` derives availability purely — capability for
receiving, and the *server's own* role/identity/assignment conditions for technician scanning, mirrored
rather than invented. It fails closed: a missing or throwing capability gate denies.

### Composition, not duplication

Supplier receiving **is** the Phase D `MultiScanReceiving` component. Technician scanning **is** the
existing `PartsScanner`, still mounted in FieldMode as well. There is no second queue, no second
progress calculation and no second normalizer, so every property Phase D proved holds here because it
is literally the same code — and the Phase E tests assert exactly that against the composed surface.

### Absent, not disabled

Put-away, pick, stage, transfer, return, cycle count and truck handoff are not listed at all. A
disabled control would assert the operation exists and that access is the only obstacle, which is
false — those commands are not built. A test enforces that only the real workflows are nameable
(two at Phase E; three once Phase F added lookup, which does have a governed read behind it).

### Readiness is reported as readiness

An authorized user in an environment where receiving is not switched on is told exactly that, and no
protected callable is attempted. Telling them they lack permission would send them to request access
they already hold.

## 4. Phase F — lookup-only scanning

Scan or type a part code and be told what the part is. It reads and displays; it has no command, no
quantity input, no writer, and nothing it imports has one.

### The Phase E finding was half right, and the half that was wrong matters

Phase E recorded that lookup could not be built because `inventory.catalog.read`,
`inventory.serializedAsset.read` and `inventory.location.display.read` are all registered
`active: false`. All three are still inert — verified against source at `6dc309cf`. But that was the
wrong list to check against a **Part** lookup:

- `inventory.catalog.read` governs the **Manufacturer** catalog projection, not Parts. Its own
  description says so. It was never the Part-read capability.
- **There is no Part-read capability at all.** The `parts` collection is governed exclusively by
  `firestore.rules:1638` — `isAdminOrDispatcher()`, or an ACTIVE employee holding the
  `PARTS_MANAGER` or `WAREHOUSE_MANAGER` operational role — and that rule is live in production
  today. `fetchPartMasterList` already reads it for PartsList, PartDetail, Receiving and the Work
  Order plan editor.

So the Part-identity half of lookup needed **no capability activation and no Functions deployment**.
It ships on a Hosting release like any other client change.

### What each field can honestly say

| Row | Source | State today |
| --- | --- | --- |
| Part number, Part ID, Name, Description, Category, Catalog status, Control type, Stocking class, Stocking unit | governed `parts` read | **Authoritative** |
| Tracking | derived from `controlType` | Authoritative where the mapping is unambiguous; `UNKNOWN` for `SERIALIZED_LOT` and anything unrecognized |
| Serialized units | `inventory.serializedAsset.read` | **Capability inactive** |
| Location | `inventory.location.display.read` | **Capability inactive** |
| On hand | *nothing* | **No governed read exists** |

The last three rows are **rendered, not omitted**. An absent row reads as "this part has none",
which is a claim. Each carries its own reason, and the reasons are different because the fixes are
different: two are waiting on an activation decision, one is waiting on a read that does not exist.

### A display mapping that deliberately differs from the server's

`receivingCallableWiring.ts` maps `controlType` to the ledger `trackingMode` vocabulary and ends
`default: return "LOT"`, so an unrecognized control type lands on a value its validator rejects.
That is correct for a command that must fail closed, and **wrong for a display**: a lookup using it
would tell a warehouse operator that an unrecognized part is lot-tracked. It also flattens the real
`SERIALIZED_LOT` control type to `LOT`, losing the serialization half.

`domain/partLookup.js` therefore has its own display mapping that fails closed by saying `UNKNOWN`.
Recorded here because two mappings of the same field is a thing that normally signals a defect, and
this one is deliberate.

### Access

Lookup is offered to everyone, and that is a decision rather than a missing gate. Because `parts` is
governed by Rules and not by a capability, there is nothing to consult that would honestly predict
the outcome. Re-implementing the Rules predicate client-side would create a second, weaker copy that
drifts — and drift lies in both directions. Inventing an `inventory.part.read` capability would be a
client-side authority the backend never agreed to, which Phase E already rejected.

So the governed read **is** the gate: the attempt is offered, and a refusal comes back as an explicit
`DENIED` state worded as a refusal. `ROLE_NAV_ACCESS` is untouched and no capability was created.

### One consequence worth noting

Because lookup needs no capability and no readiness, the shared workspace can no longer be empty. The
empty-state guard is **kept rather than deleted** — it becomes reachable again the moment any future
gating is put on lookup — and a test records that it is unreachable today by construction, so nobody
mistakes it for a state a user has seen.

## 5. Remaining scanner backlog

In rough dependency order. None is started.

| Item | Blocked on |
| --- | --- |
| Lookup: serialized-unit, location and balance rows: **built** (Phase H) | Activation + grant of `inventory.serializedAsset.read`, `inventory.location.display.read` and `inventory.balance.read`, plus deploying `getPartBalance` and flipping `INVENTORY_BALANCE_READ_READY` |
| Lookup by BARCODE: **built** (Phase G) | Activation + grant of `inventory.catalog.alias.read`, plus deploying the alias callables and flipping `PART_IDENTIFIER_TRANSPORT_READY`. The audience problem is solved in the repository; only the operator actions remain |
| Lookup: Work Order demand and purchasing context | Not designed |
| Put-away (bin assignment after receipt) | No put-away command; no authoritative bin registry |
| Offline scan capture and replay | Requires the batch contract in specification §15 |
| Batch submission and timeout recovery | Same |
| Cycle counting by scan | Existing cycle-count command is not wired to a scan surface |
| Transfers and returns by scan | Commands exist for transfer; no scan surface designed |
| Truck handoff by scan | Truck callables are undeployed (see the Truck Management gate) |
| Camera-based barcode decode hardening | Current implementation opens the camera; decode path needs field testing |

## 6. Test coverage and CI

Phase E suites, all registered:

| Suite | Runner | Lane |
| --- | --- | --- |
| `test/scanWorkflows.test.mjs` | `node --test` | `scan-workspace-tests.yml` + `suites.json` |
| `test/scanWorkspace.test.jsx` | vitest | `scan-workspace-tests.yml` |
| `test/partLookup.test.mjs` (Phase F) | `node --test` | `scan-workspace-tests.yml` + `suites.json` |
| `test/lookupScan.test.jsx` (Phase F) | vitest | `scan-workspace-tests.yml` |
| `test/partLookupAlias.test.mjs` (Phase G) | `node --test` | `scan-workspace-tests.yml` + `suites.json` |
| `test/lookupScanAlias.test.jsx` (Phase G) | vitest | `scan-workspace-tests.yml` |
| `functions/test/partAliasScanResolver.test.mjs` (Phase G) | `node --test` | `scan-workspace-tests.yml` |
| `test/partLookupInventoryRows.test.mjs` (Phase H) | `node --test` | `scan-workspace-tests.yml` + `suites.json` |
| `functions/test/partBalanceReadService.test.mjs` (Phase H) | `node --test` | `scan-workspace-tests.yml` |

### A CI gap found and closed

Phase D's two vitest suites — `multiScanReceiving.test.jsx` and `receivingTransport.test.jsx` — were
merged without any workflow naming them. This repository has no glob lane for client vitest suites in
CI: a suite runs only where a workflow names the file. Both suites had therefore **never run in CI**
from the day they merged. They pass, and passed locally throughout, but they were CI-invisible and a
regression in either would not have failed a PR.

The new `scan-workspace-tests.yml` lane names them alongside the Phase E suites, with a path list wide
enough that a change to the queue, the transport, the readiness constant, the nav config or either
workspace brings the lane with it.

## 7. Open finding — most client vitest suites do not run in CI

Phase E found that Phase D's two vitest suites were merged with no workflow naming them. Phase F
measured how far that goes:

**61 of the 133 `field-ops-app-vite/test/*.test.jsx` suites are named by no workflow at all.** They
have never run in CI. They pass locally, and a regression in any of them would not fail a PR.

This is not specific to scanning — the unnamed set spans accounts, dispatch, trucks, reporting,
inventory roles, design-system conformance and error-contract suites. It was **recorded rather than
fixed** here, because closing it properly is either 61 workflow registrations or a burn-down guard
with a 61-entry allowlist, and either is a repo-wide CI change rather than part of a scanner phase.

The scanning suites (Phase D, E and F) are all named and are not part of that 61.

**Recommended shape when it is taken up:** a single guard test that reads
`.github/workflows/*.yml`, lists every `test/*.test.jsx`, and fails on any suite named nowhere —
starting with the current 61 in a shrinking allowlist, the same pattern the card/composition program
used for `LEGACY_BADGE_ALLOWLIST`.

## 8. Phase G — barcode / alias lookup

Lookup now resolves registered identifiers — barcodes, UPC/EAN/GTIN, supplier SKUs, manufacturer part
numbers, legacy and customer/vendor references — not only direct Part codes.

### The authority finding: administration and lookup are different audiences

Phase A recorded the decision, and recorded the alternative it did not take:

> `inventory.catalog.read` exists but is scoped to the Manufacturer catalog projection and is
> registered INERT. Reusing it would be a synonym for something it does not mean. The alternative —
> a dedicated `inventory.catalog.alias.read` — is recorded here as the option NOT taken, so the
> choice is visible if the audience ever splits.
> — `functions/src/partMaster/partAliasCallables.ts`

**The audience has now split.** A warehouse or Parts user scanning a box to see what a part is needs
to resolve an identifier. All five existing alias callables are gated on `inventory.catalog.manage`,
so reusing it would hand every scanning user the authority to **create, deactivate and reactivate**
identifiers. Broadening a write capability to serve a read is the widening the capability catalog
exists to prevent.

**Smallest authority gap:** one new resolve-only read capability, exactly the one Phase A pre-named.

| Option | Verdict |
| --- | --- |
| Reuse `inventory.catalog.manage` | **Rejected** — grants identifier writes to every scanning user |
| Reuse `inventory.catalog.read` | **Rejected** — scoped to the Manufacturer projection; would become a synonym for something it does not mean, and the two reads could never be granted independently |
| Reuse a Part-read capability | **None exists** — `parts` is governed by `firestore.rules` only (Phase F finding) |
| New `inventory.catalog.alias.read` | **Taken** — registered `active: false`, granted to no Role, no activation override |

It is **narrower than the administration list on purpose**: it authorizes exactly one question —
"which Part does this scanned identifier point to?" It does *not* authorize `listPartAliases`
(seeing INACTIVE identifiers stays load-bearing for the write path) and grants nothing about the Part
record itself, which `firestore.rules` still governs separately.

### One resolver, one normalizer

`resolvePartAlias` answers "is THIS VALUE registered as THIS TYPE?" — it needs a declared alias type
because the document id is derived from (type, normalized value). **A scan does not carry its type.**

`partAliasScanResolver.ts` decides which types a bare value could be and asks the existing resolver
about each. It contains no parsing, no pattern matching, no normalization and no alias store: a test
asserts the absence structurally. Doing this in the browser instead would have put a matching
algorithm where it could disagree with the server about what a scan means — the exact failure the
Phase A scan-to-test probe was built to prevent — and would have leaked the alias namespace one round
trip at a time.

`MANUFACTURER_PN` is asked only when a manufacturer scope is supplied, because its normalizer
requires one; without it the type is *not a candidate* rather than an error.

### Fail closed, and never a silent fallback

| Situation | Outcome |
| --- | --- |
| Value is a Part code | `RESOLVED`, matched by part code — unchanged from Phase F |
| Value is an active identifier | `RESOLVED`, and the screen says **which** identifier matched |
| Registered, switched off | `ALIAS_INACTIVE` — names the part it used to mean, never "not registered" |
| Registered against two parts | `AMBIGUOUS` — lists both, picks neither |
| Not a code and not registered | `NOT_FOUND`, in its own words |
| Resolution refused | `ALIAS_DENIED` — says the check could not be *made* |
| Transport off or unreachable | `ALIAS_UNAVAILABLE` — the honest form of "we did not check" |
| Identifier resolves to an unreadable Part | `ALIAS_PART_UNREADABLE` — names the part |
| Value is one part's code AND another part's identifier | `CONFLICT` — resolves to neither |

The rule enforced by test throughout: **an identifier failure never widens into an unrelated Part
match.** Every branch either names the Part that identifier actually points to, or reports a failure.

`CONFLICT` is why both questions are asked even when the part code matches. Preferring the direct
match silently would hide a real data error inside a confident answer, and whichever side was
preferred would be wrong half the time.

### A copy fix Phase G forced

Phase F's not-found message explained the *shape* of a part code ("part codes look like PRT-1004").
That was right when a part code was the only valid input and became wrong the moment barcodes were
too — telling someone their perfectly good UPC does not look like a part code is both false and
useless. The identifier-checked path now has its own sentence.

### State today

Every environment has `PART_IDENTIFIER_TRANSPORT_READY: false`, so the callable is never invoked and
lookup reports `ALIAS_UNAVAILABLE` for anything that is not a part code. That is the correct and
truthful state: it says the barcode was not checked, rather than reporting it as unregistered.

**Owner decision required to make this operable** (three separate actions, none taken):

1. Activate `inventory.catalog.alias.read` (`active: true`).
2. Grant it to the roles that should scan — a narrower set than `inventory.catalog.manage` holders.
3. Deploy the alias callables and flip `PART_IDENTIFIER_TRANSPORT_READY` for the target environment.

Doing (3) without (1) and (2) is safe and produces `ALIAS_DENIED` for everyone. Doing (1) without
(2) is also safe — activation without a grant still denies.

## 9. Phase H — complete read-only lookup

The lookup result's three placeholder rows became real governed reads, and gained three more
(reserved, available, on order).

### H1/H2 — serialized units and location: pure composition

Both authorities already existed, complete, with client stacks: `getAvailableEquipment` +
`useAvailableEquipmentSource` + `availableEquipmentGovernedProjection`, and `getLocationDisplay` +
`locationDisplayProjection`. Nothing was built for these; the lookup consumes them, including the
existing `mapLocationDisplayResultToMap` rather than a second mapper.

A location id the resolver cannot name stays an **id**, never a fabricated label — that resolver
deliberately answers UNRESOLVED for CUSTOMER and other categories.

### H3 — the balance read: the math existed, the read did not

**Reconciliation result.** There IS an authoritative on-hand rule and the Owner has ratified it
twice. It lives in `fulfillment/fulfillmentAvailability.ts`:

- `sumLedgerEligibleOnHand` — physical stock at ACTIVE warehouses from the append-only ledger.
  The 2026-08-17 ruling made the **ledger** the authority, superseding `stock_locations`, after the
  two diverged in both directions in the sandbox (real stock refused; imaginary stock promised).
- `openWorkOrderReserved` — open commitments (RESERVED − RELEASED − CONSUMED).

Both are exported and pure. But that rule was reachable **only inside write commands' transactions**,
and had been reimplemented three times (transfer, cycle count, fulfillment) — each file noting it was
"a parallel, behaviorally-identical implementation … not a competing authority."

**There was no client-facing balance read at all.** So Phase H added the smallest one:
`getPartBalance`, which supplies the reads and calls those exported functions. It computes nothing
itself — a test asserts the movement-type vocabulary does not appear in the file.

The per-location breakdown is the **same function** called once per warehouse with a one-warehouse
eligible set, so a location figure can never disagree with the total it belongs to.

### H4 — operational context

**Reserved** (open Work Order demand) and **on order** (outstanding purchase-order quantity) both
come from reads that already exist: the commitment ledger, and `purchase_orders` in both the
canonical multi-line and legacy single-line shapes. Nothing else was added — Work Order *scheduling*
context and supplier context have no read that supports them yet.

### UNKNOWN survived every hop

| Situation | Reported as |
| --- | --- |
| No movement evidence for the part | **UNKNOWN** — never 0 |
| Evidence that nets to zero | KNOWN 0 — a real, empty shelf |
| On-hand unknown, reservations known | **available is UNKNOWN** — unknown is infectious |
| No reservation evidence | KNOWN 0 — the commitment ledger's silence genuinely means none |
| A SERIAL part's quantity | **NOT_COUNTED_BY_QUANTITY** — its units are counted individually |
| Read refused / capability inert | "Not switched on" — never an empty shelf |
| Read still in flight | "Reading…" — never "could not be read" |
| Read failed | "Could not be read" — distinct from refused |

A bug was found and fixed on the way: the part card renders as soon as identity resolves, and
composing that first render with no reads made the inventory rows say "could not be read" before
anything had been attempted.

### State today

All three capabilities are `active: false` and granted to nobody, and `INVENTORY_BALANCE_READ_READY`
is false in all four environments. Every inventory row therefore says "not switched on" — which is
the truthful answer, and the reason the rows were routed through real reads anyway: on the day they
are activated the values appear and no code changes.

**Owner decision required** — three activations and their grants, plus deploying `getPartBalance`:

1. `inventory.serializedAsset.read` — serialized units and their locations.
2. `inventory.location.display.read` — warehouse names instead of ids.
3. `inventory.balance.read` — on hand / reserved / available / on order.

Each is independent: activating one fills its rows and leaves the others saying "not switched on".

### A note for whoever converges the duplicates

Three parallel on-hand implementations remain inside their own command transactions. They are
behaviorally identical and each is emulator-tested, so converging them on the now-shared function is
a safe, valuable follow-up — but it touches live receiving, transfer and cycle-count authorities and
was deliberately **not** bundled into a read-only phase.

## 10. Phase I — RESOLVED by Owner decision #116

The reconciliation below stood; the Owner answered it on 2026-08-20 with **DECISIONS #116–#119**:

- **#116** — Warehouse is the inventory custody authority; a **bin is a descriptive physical
  sub-location**. Putting stock into a bin must not remove it from warehouse on-hand or available.
  No roll-up, no bin-level reservations, no second balance authority.
- **#117** — Quarantine is **excluded** from initial put-away and stays a future explicit workflow.
- **#118** — Returns intake and disposition are **separate authorities**; a return never
  automatically restores sellable stock.
- **#119** — Activation, grants, deployment and readiness stay separate rollout actions, and an
  existing capability is never broadened to avoid one.

The original finding, unchanged:

### The finding (as reconciled, before the decision)

Reconciliation is complete and is recorded in
[the location registry assessment](../assessments/inventory-location-registry-2026-08-20.md). No
code was written.

**The finding.** `BIN` is a location type the pure reference contract accepts and **every governed
authority rejects or ignores** — availability, receiving, transfer, cycle count and location display
all admit WAREHOUSE (and sometimes MOBILE) only. `binCode` exists solely as a field on
`stock_locations`, a seeded legacy projection nothing writes and which the Owner superseded as a
stock authority on 2026-08-17. There is no bin document, no bin registry, and no validation that a
scanned bin refers to anything real.

**Why it is a decision and not a task.** `sumLedgerEligibleOnHand` counts a movement only at
`type === "WAREHOUSE"`. If put-away moves stock to a `BIN`, then the moment a receipt is put away it
disappears from sellable on-hand, transfer sufficiency and cycle-count expected quantity. Whether
binned stock is still warehouse stock is a warehouse-operations policy with three coherent answers
(roll-up / descriptive attribute / full custody), and they are materially different businesses.

**Warehouse and truck locations are NOT blocked** and need no work — they are already authoritative
and complete. What is blocked is everything below the warehouse: put-away (J), pick/stage (L) and
bin-level counting (N).

The assessment carries a recommendation. It is not a decision, and nothing was built either way.

## 11. Phase J1 — transfers by scan

Pick the transfer in front of you, confirm you are at the right end of it, scan what you are holding,
and commit — or find out why you cannot.

### Scanning verifies; it never authors

`dispatchTransferOrder` and `receiveTransferOrder` take a **transferOrderId and nothing else**. They
re-read the order and re-derive every quantity, serial and location inside their own transaction, and
re-verify each serial's current location and state at commit time.

So this surface sends **no payload derived from scans**. Scanning answers one question before the
operator commits — *is what I am holding the thing this order is about?* — and a scan that disagrees
**blocks** submission rather than editing the order to match. Authoring a transfer with a barcode
would make the scanner an inventory authority, which it is not.

A test asserts the order object is byte-identical after a verification run.

### What blocks, and why each is separate

| Blocker | Why it is its own state |
| --- | --- |
| Wrong location | Dispatching from the wrong end moves stock that is not there |
| Wrong part | A real code, but not this order's part |
| Unknown serial | Right part, wrong unit — a different mistake from the wrong part |
| Excess | One more than the order moves; never silently dropped |
| Unreadable | Not a usable code — not the same as the wrong part |
| Incomplete | This command has no partial dispatch |
| Not actionable | Already complete, cancelled, or an unrecognized status |

A **duplicate** scan deliberately does *not* block: re-scanning is the operator checking their work,
not an error, and it never counts twice.

Serialized transfers name the units still outstanding rather than reporting "3 of 5" — the operator
has to go and find specific boxes.

### No readiness constant

The transfer transport has never had one, and both capabilities are already inert. A second gate in
front of a command that already denies would be belt-and-braces; the capability is the gate, and the
refusal is rendered as a refusal.

### A wording fix this forced

`NO_CAPABILITY` is now shared by receiving and transfers, and collapsing it into one sentence would
have dropped the only useful word — "not authorized to receive stock" and "not authorized to send or
receive transfers" send an operator to ask for different grants. `unavailableText(workflow, reason)`
gives a workflow its own wording where it has one. **A shared reason must not force a shared
sentence.**

### State today

`inventory.transfer.dispatch` and `.receive` are registered `active: false` and granted to no Role, so
a submission resolves `permission-denied` server-side. The screen says exactly that: *"You are not
authorized to move this transfer. The transfer commands are built and governed; they have not been
granted or switched on."*

## 12. Phase J2 — warehouse-level cycle count by scan

Pick what you are counting and where, scan every unit you can find, and submit what you saw.

### The count is blind, and stays blind

DECISIONS #111. The server snapshots the expected quantity at CREATE time and does not return it;
the first response that carries it is the SUBMIT response, by which point the counted value is
already recorded and there is nothing left to anchor.

So **nothing** in the counting session accepts, stores, derives or displays an expected figure — a
test greps the module for `expectedQuantity`, `variance` and `discrepanc*` and requires their
absence, and another asserts the screen renders no expected value even when the create response
carries one. The only number on the screen while counting is what has been scanned.

The screen also says *why* it is blind, so it reads as a control rather than as missing information.

### Observation is not adjustment

Submitting records what was seen. It moves no stock. The ledger correction happens only when a
manager **reconciles** — a separate capability and a separate screen, because a counter cannot
approve their own material variance. There is deliberately **no reconcile path** in this module or
this surface, asserted structurally.

Eligibility needs `inventory.cycleCount.create` **and** `.submit`, and deliberately does **not**
consult `.reconcile`: offering counting on the strength of the approval grant would put it behind the
wrong authority entirely.

### A count of zero is the finding

An empty shelf is submittable with no scans at all. Requiring a scan first would make "there are none
here" unreportable — which is precisely the result a cycle count most needs to surface.

### Serialized counts stay a list

`countedSerialNumbers` is never collapsed to a number: the server reports **missing** and
**unexpected** serials separately, and netting them would hide that two different units are involved.
The result screen keeps them separate too.

### Bin-level counting is still future

Per DECISIONS #116 a bin is descriptive, not a custody location, and the cycle-count command accepts
WAREHOUSE and MOBILE only. Counting is therefore at the authoritative warehouse/truck level, which is
exactly where the expected-quantity authority computes.

### State today

`inventory.cycleCount.create` and `.submit` are registered `active: false` and granted to no Role, so
a real call resolves `permission-denied` and the screen says so.

## 13. Phase J3 — the shared scanner input

One input for every scanning workflow: `shared/ui/ScanInput.jsx` over the pure
`domain/scanInputPolicy.js`. It owns *input*; what a value MEANS is still
`resolveScannedIdentity`, untouched.

### The load-bearing distinction: which repeats are real

Three input paths repeat for different reasons, and getting this wrong breaks counting:

| Source | Why it repeats | Window |
| --- | --- | --- |
| Hardware wedge / typing | A wedge can double-fire on one trigger pull, milliseconds apart | **250ms** |
| Camera | A decoder emits the same label **every frame** while it sits in view | **1500ms** |

**Counting ten identical boxes means scanning the same value ten times, deliberately.** Suppressing
that would silently under-count — the worst failure a cycle count can have. So the keyed window is
only just long enough to kill a stutter and no longer, while the camera window has to clear sixty
emissions a second. An unrecognized source defaults to the **shorter** window: a duplicate the
operator can see and undo beats a swallowed real count.

A suppressed repeat is **NEUTRAL**, never an error — buzzing at an operator whose scanner stuttered
teaches them to ignore the buzzer.

### Continuous focus

Focus returns to the field after every scan. A wedge types into whatever is focused, so a screen that
lets focus drift silently drops the second scan and the operator scans harder.

### Feedback is three-channel

Sound (distinguished by **pitch**, so it survives a forklift), vibration (a **rhythm** for rejection,
because a gloved hand cannot tell one buzz from another), and text. All three are advisory and
degrade silently — a device with no WebAudio or no vibration still scans.

The text channel **is** the accessibility channel: one `aria-live` sentence that always **names the
value**, because "scanned" alone is useless at a wall of similar boxes. And it carries the
*workflow's* verdict, not merely that a code arrived — a refused scan sounds refused.

### The camera degrades honestly

No `getUserMedia`, a refused permission, and no `BarcodeDetector` are three different messages, and
typing stays available in all of them. It asks for the rear camera with continuous focus (a
fixed-focus front camera cannot read a small label), keeps decoding so an operator can work through a
pallet without reopening it, and **always stops the track** — on close and on unmount. A live stream
behind a closed screen drains a handheld and lights the LED, which people reasonably read as being
recorded.

### Adoption

Transfers and cycle count use it now. Receiving (`MultiScanReceiving`) and the technician
`PartsScanner` keep their own inputs for the moment: both are covered by their own passing suites,
and migrating them is mechanical but belongs in its own change so a regression is attributable.
Recorded as a follow-up rather than bundled.
