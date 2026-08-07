# Sandbox Auth initialization + A-7 persona seeding (2026-08-06)

**Authorization:** Owner — initialize Firebase Auth on `eos-platform-sandbox`, enable Email/Password (sandbox only), complete A-7 via the governed `provisionEmployeeAccess.js`. A-9 remains HELD.

## Auth initialization — COMPLETE

- `identityPlatform:initializeAuth` on `eos-platform-sandbox` → **HTTP 200**
- `signIn.email` → `{"enabled": true, "passwordRequired": true}`
- Admin SDK reachable via **ADC** — **no service-account key was created**
- **No Taylor Parts production Auth change. No additional providers. No production identities.**

## Personas — 7 of 8 seeded, all via the governed path

| employeeId | securityRole | operationalRoles | link | status |
|---|---|---|---|---|
| `sbx-owner` | admin | — | linked | ACTIVE |
| `sbx-admin` | admin | — | linked | ACTIVE |
| `sbx-dispatcher` | dispatcher | — | linked | ACTIVE |
| `sbx-tech` | technician | — | linked | ACTIVE |
| `sbx-partsmgr` | technician | `PARTS_MANAGER` | linked | ACTIVE |
| `sbx-partsassoc` | technician | `PARTS_ASSOCIATE` | linked | ACTIVE |
| `sbx-restricted` | technician | — | linked | ACTIVE |

All addresses use the reserved `.invalid` TLD (RFC 2606) — they cannot receive mail or collide with a real person. `employees` 7 / `users` 7, every link bidirectional.

## ⚠️ A-7 is NOT COMPLETE

The Owner's criterion: *"Do not treat successful user creation alone as A-7 completion. A-7 completes when the seeded personas can actually exercise the expected platform authority model."*

**All 7 accounts have no password and cannot sign in** (`without_password=7`). This is by design: `provisionEmployeeAccess.js` provisions **identity and access records only** and never generates, prints, or stores a credential — a terminal is itself an observable log surface. Password setup is explicitly a separate, approved process.

Therefore **sign-in, effective-permission, navigation, denial, and accessVersion verification have NOT been performed.** A-7 remains open.

## Findings

### F-5 — `owner` is not a legacy securityRole
`--securityRole` accepts only `admin | dispatcher | technician`. The `owner` role exists in the **governed capability** model, not the legacy compatibility model. `sbx-owner` was therefore seeded as `admin`. This is the R-1 dual-model split showing up in practice, not a defect — but it means an "Owner" persona cannot currently be distinguished from an admin by security role alone.

### F-6 — persona seeding depends on reference data (correct fail-closed)
The Warehouse Manager persona **failed by design**: *"Warehouse(s) not found: wh-main. Refusing to assign a Warehouse Manager to a nonexistent warehouse."*

The governed script correctly refuses to scope a WM to a warehouse that does not exist. **Ordering requirement for the scenario program: reference data (warehouses) must be seeded BEFORE warehouse-scoped personas.** The 8th persona will be seeded once the baseline pack exists.

### F-7 — credential activation is an unsolved sandbox need
A reproducible sandbox requires personas that can actually sign in, but the governed path deliberately never issues credentials. The gap is real and needs a decision: either a sandbox-only activation step (Admin SDK password set, synthetic, non-production project only) or use of the existing admin password-reset flow. **Not resolved here** — it touches credential handling and was left for an explicit decision.
