# Production Verification Matrix — Truck Registry Rules (Gate C, Step 8)

Real client REST against the live project, using short-lived password-authenticated ID tokens for
one admin, one dispatcher, and one technician principal (plus unauthenticated), against **disposable**
Admin-SDK fixtures. Every allow/deny below is the behavior of the **deployed** Rules. Mirrors the
merged emulator suites (`truckRegistryRules` 20/20, `truckRegistryWriteRules` 10/10, and the D4
rules suites). Client writes (create/update/delete) are tested for **all four principals**
(admin, dispatcher, technician, unauthenticated) on every collection — none has a client write
path. Fixtures + temp Auth users are removed by the mandatory cleanup step, which runs on every
path (success, failure, or rollback).

## Readable collections (Truck Registry)

| # | Collection | Principal | Operation | Expected |
|---|---|---|---|---|
| 1 | `trucks` | admin | GET (read) | ALLOW (200) |
| 2 | `trucks` | dispatcher | GET (read) | ALLOW (200) |
| 3 | `trucks` | technician | GET (read) | DENY (403) |
| 4 | `trucks` | unauth | GET (read) | DENY (403) |
| 5a | `trucks` | admin | create / update / delete | DENY (403) |
| 5b | `trucks` | dispatcher | create / update / delete | DENY (403) |
| 5c | `trucks` | technician | create / update / delete | DENY (403) |
| 5d | `trucks` | unauth | create / update / delete | DENY (403) |
| 6 | `mobile_locations` | admin | GET (read) | ALLOW (200) |
| 7 | `mobile_locations` | dispatcher | GET (read) | ALLOW (200) |
| 8 | `mobile_locations` | technician | GET (read) | DENY (403) |
| 9 | `mobile_locations` | unauth | GET (read) | DENY (403) |
| 10a | `mobile_locations` | admin | create / update / delete | DENY (403) |
| 10b | `mobile_locations` | dispatcher | create / update / delete | DENY (403) |
| 10c | `mobile_locations` | technician | create / update / delete | DENY (403) |
| 10d | `mobile_locations` | unauth | create / update / delete | DENY (403) |

## Fully client-closed collections (read included)

| # | Collection | Principal | Operation | Expected |
|---|---|---|---|---|
| 11 | `location_truck_claims` | admin / dispatcher / technician / unauth | GET (read) | DENY (403) |
| 12 | `location_truck_claims` | any | create / update / delete | DENY (403) |

## Acknowledged combined content — D4 equipment-compatibility (client-closed; verify only if included)

| # | Collection | Principal | Operation | Expected |
|---|---|---|---|---|
| 13 | `equipment_models` | any | read + write | DENY (403) |
| 14 | `equipment_model_aliases` | any | read + write | DENY (403) |
| 15 | `equipment_part_compatibility` | any | read + write | DENY (403) |
| 16 | `equipment_compatibility_sources` | any | read + write | DENY (403) |
| 17 | `equipment_compatibility_operations` | any | read + write | DENY (403) |

**Pass condition:** every row matches. Any deviation is a Step-8 stop condition → run ROLLBACK → report.

## Writes stay Admin-SDK-only everywhere
No collection above has a client write path. The Truck Registry write callables are exported but
**undeployed** (Gate B), so no Function writes to these collections occur in production either —
Step 7 (`firebase functions:list` unchanged) confirms this.
