# Serialized equipment forward lifecycle — live sandbox state

**As of 2026-08-23.** Target: `eos-platform-sandbox`.

---

## 1. What is done live

### Equipment model identity — MIGRATED

See [equipment-model-registry-correction.md](equipment-model-registry-correction.md) §4 for the full
evidence. Summary: 48 canonical models created and verified through the registry's own reader, 278
equipment back-references repointed, 48 superseded legacy documents deleted, 8 pre-existing records
correctly left out of scope. Every invariant held; a second apply was a true no-op.

### What was deliberately NOT changed

| | count | note |
|---|---:|---|
| certification purchase orders | **0** | the 3 `ro-sbx-*` orders are pre-existing sandbox records |
| certification receipts | **0** | the 2 `rcv_*` records are pre-existing |
| certification work orders | **0** | unchanged |
| destructive world rebuild | **not run** | |

---

## 2. What is BLOCKED, and on exactly what

Everything downstream of the migration — live grants, live E01/E02, the live 30-unit cohort — is
blocked on **one Functions deploy**.

### The blocker, probed rather than inferred

The two new Roles merged to `main` today (#1422). The deployed `grantRole` build predates that merge,
so it cannot name them. Confirmed by calling the deployed callable directly, authenticated as the
owner persona:

```
POST https://us-central1-eos-platform-sandbox.cloudfunctions.net/grantRole
  { roleId: "equipmentInstaller", ... }

400  { "error": { "message": "The specified roleId is not recognized.",
                  "status": "INVALID_ARGUMENT" } }
```

Nothing was written — the command rejects before any write. This is a **deploy gap, not a governance
gap**, and `applyRoleGrants.mjs` already models it as `BLOCKED_ROLE_NOT_DEPLOYED`; the same thing
happened to five Roles from PR #1401.

**⚠ One idempotency key is spent.** That probe recorded a DENIAL under
`certworld_g3_cw-emp-013_equipmentInstaller`. The command refuses to reuse a key that previously
resolved to a denial, because an idempotency key records the *outcome* of a request, not just its
intent. Post-deploy, these grants need **key generation 4 or higher**. Reusing generation 3 asks the
platform to change a recorded answer, and it will refuse.

### The chain, and why nothing partial was done

```
Functions deploy
  → grantRole learns the two Roles
    → live employees' certGovernedRoles updated (4 records, additive)
      → applyRoleGrants creates 4 roleAssignments through the governed path
        → live whole-unit Parts seeded (8 documents, additive)
          → E01/E02 live
            → the 30-unit cohort live
```

Each step is a precondition of the next. Half of it would leave live employees claiming Roles they do
not hold, or 8 whole-unit Parts with no units under them — the half-finished state this whole slice
was built to refuse.

### Current live counts on the blocked items

| | live | intended |
|---|---:|---:|
| employees carrying a station Role | 0 | 4 |
| `inventorySerializedAssetAcquirer` / `equipmentInstaller` assignments | 0 | 4 |
| whole-unit Parts | 0 | 8 |
| unassigned serialized units | 0 | 30 |

---

## 3. What IS proven, in the certification emulator

Everything above the deploy line has been executed end to end against `demo-certworld` at world
`1.6.0`, authority 86 assignments:

- **E01 / E02 — 37/37.** Acquire (no PO) → install at a customer, Taylor and Icetro through the same
  code with no brand-specific branch. The acquirer is refused when asked to install the unit they
  just acquired; the installer is refused when asked to acquire. Both refusals carry
  `noQualifyingGrant`, not `inactivePermission` — about the person, not the environment.
- **The 30-unit pool — 6/6.** 17 Taylor, 13 Ventana/Icetro, every unit through
  `inventory.serializedAsset.acquire`. Deterministic serials: a second run was 0 new, 30 replayed.

The emulator run is a **test precondition, not governed-grant evidence**. The live grant path remains
the governance proof, and it is what the deploy unblocks.

---

## 4. Still open

`EQUIPMENT RECOVERY AUTHORITY GAP` — unimplemented and untouched. Equipment `accountId`/`locationId`
remain immutable, nothing clears `currentEquipmentId`, and neither new Role confers recovery.
Recovery gets its own lifecycle design after forward installation works.
