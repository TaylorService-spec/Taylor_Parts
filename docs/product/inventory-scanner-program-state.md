# Inventory scanner program — delivery state

Companion to [the program specification](inventory-scanner-program.md). The specification says what
the scanner *should* be; this file says what is actually true in the repository right now, and is the
document to update when that changes.

**Last updated:** 2026-08-20, at Phase E.

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

**MERGED is not DEPLOYED. UX COMPLETE is not USER OPERABLE.** Every phase below is repository-complete
and none is user-operable in production.

## 2. Phase state

| Phase | Repository | UX | Backend | Deployment | Grant / activation / readiness |
| --- | --- | --- | --- | --- | --- |
| **A** — identifier administration | MERGED | COMPLETE | Written | **NOT DEPLOYED** | Capability registered; not activated |
| **B** — multi-line PO reconciliation + design | MERGED (docs + pure contracts only) | n/a | n/a | n/a | n/a |
| **C** — canonical multi-line receiving command | MERGED (#1354) | n/a (transport) | Written | **NOT DEPLOYED** | `inventory.stock.receive` active and granted; transport unreachable |
| **D** — multi-scan receiving journey | MERGED (#1355) | COMPLETE | Uses Phase C | **NOT DEPLOYED** | `RECEIVING_TRANSPORT_READY` is `false` outside `eos-platform-sandbox` |
| **E** — shared Scan workspace | This change | COMPLETE | Composes C/D + existing scanner | **NOT DEPLOYED** | Reachable; supplier receiving inert until D's transport is ready |

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
false — those commands are not built. A test enforces that only the two real workflows are nameable.

### Readiness is reported as readiness

An authorized user in an environment where receiving is not switched on is told exactly that, and no
protected callable is attempted. Telling them they lack permission would send them to request access
they already hold.

## 4. Lookup-only scanning — deliberately not built

The specification calls for scanning an item purely to see what it is. It was **not** built in Phase E,
and this is a finding rather than an omission:

All three reads it requires are registered in the permission catalog with `active: false`, which denies
regardless of grant:

- `inventory.catalog.read`
- `inventory.serializedAsset.read`
- `inventory.location.display.read`

A lookup screen built today could therefore only render blanks or invented values for every user. It is
recorded as the **immediate next phase** rather than shallow-built.

## 5. Remaining scanner backlog

In rough dependency order. None is started.

| Item | Blocked on |
| --- | --- |
| Lookup-only scanning | Activation of the three inert read capabilities above |
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

### A CI gap found and closed

Phase D's two vitest suites — `multiScanReceiving.test.jsx` and `receivingTransport.test.jsx` — were
merged without any workflow naming them. This repository has no glob lane for client vitest suites in
CI: a suite runs only where a workflow names the file. Both suites had therefore **never run in CI**
from the day they merged. They pass, and passed locally throughout, but they were CI-invisible and a
regression in either would not have failed a PR.

The new `scan-workspace-tests.yml` lane names them alongside the Phase E suites, with a path list wide
enough that a change to the queue, the transport, the readiness constant, the nav config or either
workspace brings the lane with it.
