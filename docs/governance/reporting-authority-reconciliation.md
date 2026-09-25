# Reporting Authority Reconciliation

**PROPOSAL — NOT A GRANT.** Measured 2026-09-24 against `origin/main` `b6a36b15` and live nonprod
(`eos-policy-nonprod`, read-only). Nothing in this document has been activated or granted.

## 1. Measured current state

Reporting is **not** blocked by an unregistered capability. It is governed by a second, complete,
parallel authority stack — `functions/src/access/permissionCatalog.ts` plus per-environment
activation plus `resolveEffectivePermission` — that never touches `eos_policy`.

| Fact | Measurement |
|---|---|
| `report.*` ids in `permissionCatalog.ts` | **39** |
| …with catalog `active: true` | **0** (all 39 are `active: false`) |
| …**production-adopted** (`taylor-parts`) | **25** |
| …**sandbox-active** (`eos-platform-sandbox`) | **36** |
| `report.*` capabilities in `eos_policy.capabilities` | **0** of 76 |
| `reportViewer` / `reportFinanceViewer` / `reportAuthor` declarations | **27 / 5 / 3** |
| …their `eos_policy` capabilities, object permissions, field overrides, assignments | **0 / 0 / 0 / 0** |

The three Roles exist in `eos_policy.roles` (`origin SYSTEM`) as **empty shells**. `owner` holds all
39 by composition (`OWNER_PERMISSIONS` spreads `ADMIN_ROLE.permissions`). Both certification worlds
are 0/39. Ids 8, 14 and 24 (`customer.notes`, `customer.accountOwner`, `location.accessNotes`) are
eligible in **no** environment.

**Correction to a common reading:** a Reporting persona is not "read-only vacuously". Reporting is a
live authority today — just not a PostgreSQL one.

## 2. The capability schema limitation

Three independent structural refusals. The first alone is decisive.

1. **`capabilities.object_key` is NOT NULL and must name a catalogued Object.** Migration
   `1761350400000` adds `object_key/action_key/action_kind/display_label`, sets all NOT NULL, and adds
   `CHECK (action_kind IN (...))` plus `UNIQUE (object_key, action_key)`. The 39 catalogued Objects
   contain no Report/Reporting/Analytics/ReportDefinition, so **no `report.*` row can be inserted at
   all**. `capabilityObjectAuthorityGuard.test.mjs` enforces it.
2. **The unique index makes the 34 field reads mutually exclusive.** One row per
   `(object_key, action_key)`; the 14 customer field reads all want the same cell. **`capabilities`
   has no FIELD dimension.**
3. **No code path maps `permissionCatalog.ts` into `eos_policy`.** Capability rows are written by
   migrations only; Object rows by the seed only. `functions/src/reporting/` imports Postgres zero
   times.

**34 of the 39 ids cannot be represented as capability rows in any form.**

## 3. The field-permission relation

The field dimension already exists and is empty:

| relation | rows (nonprod) | purpose |
|---|---|---|
| `eos_policy.object_fields` | **390** (389 `NORMAL`, 1 `CONFIDENTIAL`) | field catalogue with `reportable` + `sensitivity` |
| `eos_policy.role_object_permissions` | **256** | per-Role CRED on an Object |
| `eos_policy.role_field_permission_overrides` | **0** | per-Role `can_read` on a **field** |

Every field the 34 capabilities govern already exists as an `object_fields` row on an
already-registered Object — `account` (21), `contact` (6), `location` (9), `equipment` (13).
**The family is not missing from `eos_policy`; it is expressed in the wrong relation, and the right
relation is empty.**

## 4. The Slice 1 model

Reporting over business records is an **ACTION**, not an Object — report execution is inherently
bulk, which is genuinely distinct from reading one record. A saved definition **is** a record and
needs one new Object, mirroring the existing `workflowDefinition` shape.

**A "Reporting"/"Analytics" Object must NOT be registered** — that is the blanket-capability error
migration `1762041600000` refuses in its own header.

| slice | contents | holders |
|---|---|---|
| **1** | Object `reportDefinition` + capability `reportDefinition.read` (READ) | admin, owner |
| **2** | `account.report`, `contact.report`, `location.report`, `equipment.report` (READ) + `reportDefinition.read` | + reportViewer |
| **3** | `reportDefinition.create` (CREATE), `.rename` (EDIT), `.duplicate` (EDIT) | + reportAuthor |

**Eight capabilities and one Object across three slices — not 39 and not 5.**

## 5. Role separation

- **`reportViewer` (27 ids)** — ordinary operational reporting. No finance-sensitive field, no
  authoring, no delete.
- **`reportFinanceViewer` (5 ids)** — **ADDITIVE, NOT A SUPERSET.** Its own header states the rule: a
  holder needs `reportViewer` as well, so tier 2 can be withheld from an operations manager who
  legitimately holds tier 1. It holds **no object read of its own**. Granting it an Object-level
  reporting capability would silently convert it to a superset and destroy the two-decision design.
- **`reportAuthor` (3 ids)** — authoring only, **no data capability at all**. `report.definition.delete`
  is deliberately absent: there is no per-definition ownership model to scope it.

**No job-title Role receives Reporting.** `operationsManager`, `salesManager`, `generalManager`,
`controller`, `financeManager`, `accountingManager`, `officeManager` and `salesperson` stay at zero.

## 6. Sensitive finance-field treatment

Measured: finance READ (`finance.invoice.read`, `finance.payment.read` — **14** holders each) is
already separated from EXECUTION (`issue` 7, `adjustment.record` 7, `payment.apply` 6,
`refund.record` 6) on the **`action_kind`** axis.

- **F1 — Reporting is READ, always.** Every reporting capability carries `action_kind READ`. A
  reporting Role must never hold `BUSINESS_ACTION` or `EDIT`.
- **F2 — `reportFinanceViewer` stays additive.** No Object-level reporting capability, ever.
- **F3 — Reporting over a finance Object must COMPOSE with the finance read, never substitute.**
  `invoice`, `payment` and `commissions` are already registered Objects. Without this rule a future
  `invoice.report` becomes a parallel read channel routing **around** the 14-holder `finance.*.read`
  gate. **Fix this before waves 5/6, not after.**
- **F4 — Reading terms is never writing terms.** `customer.paymentTerms` and `customer.taxStatus` are
  admin-edit-only (Issue #175).
- **F5 — The separation has NO PostgreSQL representation today.** `object_fields.sensitivity` is
  `NORMAL` for 389 of 390 rows. **Moving Reporting into `eos_policy` now would LOSE the
  finance-field distinction**; populating `sensitivity` is a prerequisite for any field-level grant.

**Withheld field list (10), confirmed:** `customer.billingAddress`, `customer.externalIds`,
`customer.paymentTerms`, `customer.taxStatus`, `customer.accountOwner`, `customer.notes`,
`contact.email`, `contact.phone`, `location.accessNotes`, `equipment.notes`.
Three corrections: it is an **Owner production-deferral ruling**, not a Spec sensitivity
classification; only **3** are hard denials in every environment; and it **omits** three
`commercial`-classified fields (`defaultCurrency`, `purchaseOrderRequired`,
`invoiceDeliveryMethod`) that are already production-adopted inside `reportFinanceViewer`.

## 7. Activation plan

Order is forced by the schema, not chosen.

1. Register the Object in `seed/capabilityGovernedObjects.json` — `object_key` is NOT NULL and the
   guard fails any migration naming an undeclared Object.
2. Regenerate `policySeedSnapshot.json` and `policySeedCoverage.json` with
   `scripts/buildAdminPolicySeedSnapshot.mjs`. **Generated — never hand-edited.**
3. Author the migration modelled on `1762041600000`: a `DO $$…$$` census that RAISEs rather than
   guesses, then `INSERT INTO capabilities`, then the Role-key-joined `INSERT INTO role_capabilities`
   stamped `granted_by = 'migration:<id>'`, then a guarded Down.
4. **Move the pinned expectations in the same commit** — a migration landing without them fails CI.
5. Only then can a grant exist. A grant written before 1–3 is **stranded**: unadministrable,
   `NOT_FOUND` from `getObjectSecurityMatrix`.

**Smallest safe first slice: SLICE 1.** One Object, one READ capability, two grants. It opens **no
report data whatsoever** — a definition confers no data access — and is reversible by its own Down.

**Fan-out: 16 pinned surfaces move for one capability row**, including the Sample Company
vocabulary and its ~4,500-character prose comment, the authority baseline, the migration ledger
guard, and a ~70-line prose ledger in `sampleCompanyPostgres`.

**Approving these slices does not change what any principal can do today.** The runtime authorizes
through `resolveEffectivePermission` and the activation registry; a separate later lane must cut the
runtime over.

## 8. Denial cases

- `DO_NOT_ACTIVATE — wrong relation; the schema cannot express it.` All 34 field-level ids as
  capability rows. Correct home: `role_field_permission_overrides` over existing `object_fields`.
- `DO_NOT_ACTIVATE — no per-definition ownership model.` `reportDefinition.delete`, not registered at
  all, so no Role can acquire it by accident.
- `DO_NOT_ACTIVATE — a blanket capability naming no Object.` Any `Reporting`/`Analytics` Object.
- `DO_NOT_ACTIVATE — would convert an additive Role into a superset.` Any Object-level reporting
  capability granted to `reportFinanceViewer`.
- `DO_NOT_ACTIVATE — routes around the finance read gate.` `invoice.report`, `payment.report`,
  `commissions.report`, pending F3.
- `DO_NOT_ACTIVATE — no PostgreSQL representation exists for the exclusion.` Any field-level grant
  while `sensitivity` is uniformly `NORMAL` and `role_field_permission_overrides` holds 0 rows.
- `DO_NOT_ACTIVATE — reporting must not become implicit in a job title.` Any grant to a position Role.
- `DO_NOT_ACTIVATE — out of scope and separately ruled.` Changing the 25 production adoptions, the 36
  sandbox activations, or any `active` flag.

## 9. Remaining future Reporting work

1. **Slices 2 and 3**, each its own Owner approval. Slice 3 has a hard dependency: `report.definition.*`
   is production-unadopted *deliberately* because no saved-definition callable is deployed, and
   `sampleCompanyManifest.test.mjs:939` guards exactly that condition.
2. **Populate `object_fields.sensitivity`** before any field-level reporting grant (F5).
3. **Ratify F3** before any finance Object enters the report catalogue.
4. **Cut the runtime over** from `resolveEffectivePermission` to the governed path — a separate lane.
5. **Retire the client nav gaps** at `navConfig.js:803-806`, which requires Slice 2 plus a client
   cutover.
6. **Stale comments to correct** (other lanes own these files): `permissionCatalog.ts:636-638`
   ("Every other wave-1 id is active:true" — false); `environmentCapabilityOverrides.ts:28-37` and
   `:413-421`; `reportExecutionService.ts:22-28` ("adds NO Role grant for any report.* capability" —
   contradicted by four Roles holding them).
