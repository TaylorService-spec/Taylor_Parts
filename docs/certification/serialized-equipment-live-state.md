# Serialized equipment forward lifecycle — live sandbox state

**As of 2026-08-23, after the Functions refresh.** Target: `eos-platform-sandbox`.
**Status: READY IN SANDBOX.**

---

## 1. Deploy verification

Hosting reports commit `b34c3cec` — current `main`. `grantRole` recognition was verified by
contrast rather than by a grant that would have succeeded:

| roleId sent | result |
|---|---|
| `inventorySerializedAssetAcquirer` | passed role validation, reached a later step |
| `equipmentInstaller` | passed role validation, reached a later step |
| `noSuchRoleControl` (control) | `400 The specified roleId is not recognized.` |

Sandbox activation resolves both `inventory.serializedAsset.acquire` and `equipment.install`;
production resolves **0** overrides.

### ⚠ The recognition probe created authority, and had to be revoked

The probe used a principal uid that does not exist, on the assumption that the command would reject
it before writing. **It did not.** `grantRole` returned `503 "Your request was recorded, but a
follow-up step is still completing"` — and the assignment *had* been written. Two live
`roleAssignments` were created for `probe-principal-that-does-not-exist`.

Both were revoked immediately through the governed `revokeRole` callable — the same path that created
them, not a direct delete — and are now `status: disabled`. Reconciliation afterwards: **0
UNEXPECTED_GRANT**, and active station assignments returned to 0 before the real grants ran.

Two things worth keeping:

- **"Recorded" can mean written.** A 503 from this command is not evidence that nothing happened.
  Any probe against `grantRole` must be followed by reading `roleAssignments`, not by trusting the
  response.
- **A non-existent principal is not a safe probe argument.** The command validates the *role* before
  it validates the *principal*, so an invalid principal cannot be used to test role recognition
  without granting.

## 2. World version

Live moved `1.5.0` → `1.6.0` **without a reset**, through
`scripts/certificationWorld/upgradeWorldAdditive.mjs`:

```
identical 0 · missing 8 · differing 1084 · marked-but-unexpected 0
wrote 1092 record(s) with merge
```

The 8 missing were the whole-unit Parts. The 1084 "differing" were differing in exactly one field —
the `certificationWorld` marker's version stamp — which is how `verify` reports what is installed.

`certificationWorld.mjs verify` → **COMPLETE, 1.6.0, 1092/1092**. Re-running the upgrade is a true
no-op: **1092 identical, 0 differing, 0 written**.

`rebuild` could not be used: it refuses to run over an existing world, and with `--confirm-reset` it
deletes first. The live world carries a migration, real Auth principal links and governed grants —
none of it re-earned by a reset.

## 3. Authority — GRANTED LIVE

`applyRoleGrants --keyGeneration 4 --apply`:

```
total intended 87 · grantable 86 · HELD (privileged) 1 — cw-emp-000:owner
applied 4 · alreadyApplied 82 · blockedNotDeployed 0 · failed 0
second run: applied 0 · alreadyApplied 86
```

Generation 4 because generation 3 was consumed by the denied pre-deploy probe
(`certworld_g3_cw-emp-013_equipmentInstaller`). An idempotency key records the *outcome* of a request,
so a key that resolved to a denial cannot be reused.

Reconciliation: **86 ALREADY_CORRECT · 0 UNEXPECTED · 0 UID_MISMATCH · 0 SOD_CONFLICT**. The one
`MISSING_GRANT` is the deliberately held privileged `owner` grant — two-person control, unchanged.

### Semantic proof, through the live resolver against live assignments

| employee | station | acquire | install |
|---|---|---|---|
| cw-emp-044 | acquirer | ALLOW | DENY `noQualifyingGrant` |
| cw-emp-045 | acquirer | ALLOW | DENY `noQualifyingGrant` |
| cw-emp-013 | installer | DENY `noQualifyingGrant` | ALLOW |
| cw-emp-017 | installer | DENY `noQualifyingGrant` | ALLOW |

Overlap **0**. No Admin or Owner identity was used as proof.

## 4. Whole-unit Parts — 8 LIVE

All 8 read back through the real Part Master repository: **8 readable · 0 duplicate internal part
numbers · 0 broken model refs**.

## 5–6. E01 / E02 — 37/37 LIVE

| | E01 Taylor | E02 Ventana/Icetro |
|---|---|---|
| Part | `CW-WU-TAYLOR--C161` | `CW-WU-ICETRO--ISI-203SN` |
| serial | `CW-E01-000001` | `CW-E02-000001` |
| acquirer | cw-emp-044 | cw-emp-045 |
| installer | cw-emp-013 | cw-emp-017 |
| customer | Harbor Grill Restaurant Group | Handel's Homemade Ice Cream … LLC |
| Equipment | `eq_8e7dcb8f…` | `eq_7adc0f2f…` |

No purchase order, no receipt. The acquirer was refused when asked to install the unit they had just
acquired (`PERMISSION_DENIED`). Replay returned the same equipment id; a second key returned
`ALREADY_INSTALLED`; re-acquiring an installed unit replayed **without** resurrecting it to
`AVAILABLE`. Taylor and Icetro ran the same code with no brand-specific branch.

## 7–8. The unassigned cohort — 30 LIVE

**17 Taylor · 13 Ventana/Icetro**, every unit through `inventory.serializedAsset.acquire`.
Second run: **0 new, 30 replayed**.

All 30 remain uninstalled — E01/E02 used their own serials — so the manual test pool is the full
cohort, well above the required 5 per line.

Independent sweep: `currentEquipmentId` null on **30/30** · duplicate serial identities **0** ·
derived-id mismatches **0** · purchasing references **0**.

## 9. Counts, kept apart

| | |
|---|---:|
| certification installed base (fixture-marked) | 278 |
| E01 + E02 installed through the command | +2 |
| **installed customer Equipment from this program** | **280** |
| uninstalled serialized equipment — Taylor | 17 |
| uninstalled serialized equipment — Ventana/Icetro | 13 |
| **uninstalled total** | **30** |

The 30 are **not** installed base. They are company inventory with no customer.

The two E01/E02 Equipment records do not carry the `certificationWorld` marker, and should not: they
were created by the install command as operational records, not written by the fixture seeder. That
is why the marked count stays 278.

## 10. `SERIALIZED INSTALLED LOCATION SEMANTIC GAP` — REPRODUCED LIVE

An `INSTALLED` serialized asset still names its pre-install warehouse in `currentLocationId`:

```
E01  currentLocationId=wh-main  inventoryState=INSTALLED
E02  currentLocationId=wh-main  inventoryState=INSTALLED
```

**Consumers are safe today** because every one that counts stock also filters on `inventoryState` —
`cycleCountExpectedQuantity` requires `currentLocationId === origin AND state === "AVAILABLE"`, so an
installed unit is excluded by its state, not by its location. The governed `getAvailableEquipment`
read likewise returned 30 rows and **excluded both installed units**.

The risk is a future reader that filters on location alone and counts a machine sitting at a customer
as warehouse stock. Not fixed here — changing it as an incidental cohort change is exactly what was
prohibited, and `installedFromLocationId` on the Equipment already records the same fact.

## 11. UI

| check | result |
|---|---|
| uninstalled Taylor discoverable | **YES** — 17 via `getAvailableEquipment` |
| uninstalled Ventana/Icetro discoverable | **YES** — 13 |
| all 8 whole-unit Parts represented | YES |
| installed units excluded from Available | YES — 0 of 30 rows are E01/E02 |
| E01 Equipment under its customer | **YES** — client-path read, `acct-harbor`, 8 equipment, 1 from a serialized asset |
| E02 Equipment under its customer | **YES** — `cw-acct-0003`, 19 equipment, 1 from a serialized asset |
| customer-installed vs internal distinguishable | YES — separate surfaces; Equipment carries `serializedAssetId` |

The Available Equipment tab (`modules/equipment/AvailableEquipment.jsx`) reads through the deployed
governed `getAvailableEquipment` callable and returns `status: "ready"`, 30 rows, 0 excluded, not
truncated.

Equipment client reads are Rules-scoped: `dispatcher` and `admin` can read a customer's equipment;
`warehouseManager` and `technician` are denied (`PERMISSION_DENIED`). That is pre-existing Rules
scoping, not something this work changed.

### `BACKEND_SUPPORTED / UNASSIGNED EQUIPMENT ASSIGNMENT-INSTALL UI GAP`

There is **no callable and no client caller** for `installSerializedAsset` or
`acquireSerializedAsset`. Both commands are library-only, reachable solely from the certification
scripts. A person using the sandbox can **see** the 30 uninstalled units and can see installed
Equipment under a customer, but cannot **assign or install** one through the application.

Nothing was direct-written around this.

## 12. Purchasing boundary — HELD

| | total | certification-created |
|---|---:|---:|
| `purchase_orders` | 0 | **0** |
| `reorder_purchase_orders` | 3 | **0** |
| `receiving_orders` | 2 | **0** |

The 3 `ro-sbx-*` orders and 2 `rcv_*` records are pre-existing sandbox data.

## 13. Open gaps

- **`EQUIPMENT RECOVERY AUTHORITY GAP`** — unimplemented and untouched. Equipment
  `accountId`/`locationId` remain immutable, nothing clears `currentEquipmentId`, neither new Role
  confers recovery.
- **`SERIALIZED INSTALLED LOCATION SEMANTIC GAP`** — reproduced live, §10.
- **`BACKEND_SUPPORTED / UNASSIGNED EQUIPMENT ASSIGNMENT-INSTALL UI GAP`** — §11.
