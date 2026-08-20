# Inventory scanner program — delivery state

Companion to [the program specification](inventory-scanner-program.md). The specification says what
the scanner *should* be; this file says what is actually true in the repository right now, and is the
document to update when that changes.

**Last updated:** 2026-08-20, at Phase F.

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
| **F** — lookup-only scanning | This change | COMPLETE | **No backend change** — reuses the existing client-direct `parts` read | **Hosting release only** | **No activation needed** for the Part-identity slice |

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
| Lookup: serialized-unit and location rows | Activation of `inventory.serializedAsset.read` and `inventory.location.display.read` |
| Lookup: stock / reserved / available balances | No governed client balance read exists — needs one designed, not a scanner-only projection |
| Lookup by BARCODE rather than part code | The Phase A alias transport: `resolvePartAlias` is undeployed, `PART_IDENTIFIER_TRANSPORT_READY` is `false` in all four environments, and it is gated on `inventory.catalog.manage` (administration), which is the wrong audience for a warehouse lookup |
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
