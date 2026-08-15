# Serialized Asset Registry — slice B boundary (Wave 7, Item 5)

**Status:** repository-safe work for the Specification's phase **M.1** is complete and merged
(PR #1004). Slice **B** — the path that actually CREATES a `serialized_assets` record — cannot
proceed without one Owner decision. This document records the exact boundary and the smallest
decision that unblocks it.

**This is a dependency boundary, not a difficulty.** The blocking condition is written into the
code as a deliberate deferral, not merely absent.

## What is complete

| Spec phase | State |
| --- | --- |
| M.1 — Serialized Asset identity + Available Equipment read | **Implemented** (PR #1004): document contract, fail-closed validator, trusted `getAvailableEquipment` read, capability `inventory.serializedAsset.read` (registered `active:false`, granted to no Role), CI workflow. No write path. |
| M.2 — Unified Timeline compose (read-only) | The pure composer already exists on `main` (`field-ops-app-vite/src/domain/serializedAssetInstallation.js`). It has nothing to compose until records exist. |
| M.3 — §H installation handoff | **Blocked** — see below. |
| M.4 — §J customer projection | Depends on M.1–M.3 having real data. |
| M.5 — Scan-event reuse | Explicitly a later track. |

## The boundary

Nothing can create a Serialized Asset today, and both available routes are closed.

**1. The governed intake path explicitly refuses SERIAL parts.**

`functions/src/inventoryReceiving/receivingValidation.ts:49`

```
if (part.trackingMode !== RECEIVING_LINE_TRACKING_MODE) return fail("tracking_mode_unsupported"); // SERIAL/LOT deferred
```

with `RECEIVING_LINE_TRACKING_MODE = "NONE"` (`receivingTypes.ts:30`).

Specification §F makes Receiving the authority that creates the asset — *"serial capture at receipt
(§4.9) activates the Serialized Asset at its put-away location (RECEIVED)"*. That capture is
deliberately deferred in the deployed-and-granted receiving command. Enabling it widens the accepted
input domain of a live governed command (`inventory.stock.receive`, granted to
`{admin, dispatcher, owner}`, with its Rules already deployed live) and pulls in an Enterprise
Inventory phase this package did not authorize.

**2. The alternative would invent a competing authority.**

A standalone "register a serial" command would create a *second* way stock enters the system,
competing with Receiving's §F authority as the supplier→internal-stock handoff. That is precisely
what the Specification's non-authorities clause (§A) and this package's own anti-duplication rule
forbid, so it was not built.

**3. §H is separately gated regardless.**

The installation handoff verifies the serial is *already at the CUSTOMER location*, which requires a
governed Transfer Order (§F, Enterprise Inventory Phase 4). **No transfer module exists** anywhere in
`functions/src` or `field-ops-app-vite` — verified by inspection. §H cannot be implemented honestly
until delivery exists, independent of the intake question above.

## Smallest Owner decision required

> **Does Wave 7 authorize extending the governed Receiving command to accept `SERIAL` tracking mode
> (Enterprise Inventory serial receiving), so that receipt creates the Serialized Asset per §F?**

- **Yes** → slice B proceeds: serial capture at receipt, the registration write inside Receiving's
  existing transaction, idempotency and audit per the #226/#325 pattern, and the registry read gains
  real data. Still repo-only; still no deployment.
- **No** → Item 5 rests at M.1. The contract and read are merged and inert, and the registry waits on
  the Enterprise Inventory phase that owns serial receiving.

This decision is *not* the custody/ownership model (§4.13 vendor consignment, Ventana/Taylor
ownership) — that remains deferred by the Specification itself and is not required to answer the
question above.

## What was deliberately NOT done

- No competing intake/registration authority.
- No change to the live Receiving command's accepted input domain.
- No second ledger, movement/custody authority, truck authority, or second Equipment record.
- No `firestore.rules` change (a collection with no `match` block is denied by default; there is no
  `{document=**}` wildcard in the file).
- No write, migration, backfill or seed of any kind.
