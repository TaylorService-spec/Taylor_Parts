# Financial Policy foundation: authority impact

**Decision:** DECISIONS #232 (Owner, 2026-10-13). It continues the CERT-FIN-02 policy-profile ruling of 2026-09-03 ([reconciliation](../assessments/cert-fin-02-policy-framework-reconciliation.md), §7 lifecycle).
**Migration:** `functions/migrations/1764560000000_financial-policy-profiles.sql`.
**Server:** `functions/src/eosFinance/financialPolicy.ts`, served on `/operations/finance`.
**Proof:** `functions/test/financialPolicyFoundationPostgres.test.mjs`.

**Status:** local foundation. Nothing is granted, nothing touches nonprod or production, and there is no UI yet.

## 1. Lifecycle

```
DRAFT --submit--> SUBMITTED --approve--> APPROVED --activate--> ACTIVE --(later version activates)--> SUPERSEDED
                             \--reject---> REJECTED
```

| State | Editable content | Next states | Notes |
|---|---|---|---|
| DRAFT | yes | SUBMITTED | At most one version in flight (DRAFT, SUBMITTED or APPROVED) per company. |
| SUBMITTED | no (frozen) | APPROVED, REJECTED | |
| APPROVED | no | ACTIVE | |
| REJECTED | no | none (final) | A change is a new DRAFT. |
| ACTIVE | no (**locked**) | SUPERSEDED, only through the activation of a later approved version, in the same transaction | At most one per company. |
| SUPERSEDED | no | none (final) | Preserved intact. |

- **Never deleted.** No row is deleted, and TRUNCATE is refused.
- **Authorship only grows.** Even in DRAFT, `content_authors` only grows and `prepared_by` never changes.
- **Write-once stamps.** The prepared, submitted, approved, rejected, activated and superseded stamps are written once.
- **Enforced twice.** The server enforces every rule, and so do the database's triggers and CHECKs.
- **Effective date.** It is stated at activation. It may not precede the company's business date, nor the effective date of any earlier activated version.
- **Lifecycle is not effectivity.**
  - The version IN FORCE on a business date is the latest ACTIVE or SUPERSEDED version dated on or before it. A SUPERSEDED row keeps its own effective date.
  - A future-dated ACTIVE version is SCHEDULED: the prior version stays in force until that date.
  - `readFinancialPolicy` returns `inForce`, `scheduled` and `inFlight`, and accepts an `asOfDate`.
- **Fail closed.** A company with no version in force reads `NOT_CONFIGURED`, including before its first-ever activation's date. No default method exists.
- **Replay.** An identical re-send answers `replayed: true`. A re-send with a different reason or note is refused with `FINANCIAL_POLICY_REPLAY_CONFLICT`.

## 2. The new keys

All four sit on the new `financialPolicy` Object (Finance domain).

| Key | Kind | Operations | Grants in the migration | Implied by Protected Administrator standing |
|---|---|---|---|---|
| `finance.policy.read` | READ | `readFinancialPolicy`, `listFinancialPolicyVersions` | 0 | **yes** (READ) |
| `finance.policy.prepare` | EDIT | `saveFinancialPolicyDraft`, `submitFinancialPolicy` | 0 | **no** (EDIT is not implied) |
| `finance.policy.approve` | ADMIN_ACTION | `approveFinancialPolicy`, `rejectFinancialPolicy` | 0 | **yes** (ADMIN_ACTION) |
| `finance.policy.activate` | ADMIN_ACTION | `activateFinancialPolicy` | 0 | **yes** (ADMIN_ACTION) |

**PG-native keys.** All four keys are absent from `functions/src/access/permissionCatalog.ts`. Reusing the Firebase ids `financialPolicy.profile.read` / `.configure` would let the catalog reconcile grant them to admin silently.

**Standing.** No `PROTECTED_ADMINISTRATOR_EXCLUSIONS` entry is needed: each key's action kind alone gives exactly the #232 outcome. The Administrator approves and activates with no grant, and cannot prepare.

## 3. Proposed grants (NOT executed)

The Owner authorizes these separately, through Administration.

| Role | read | prepare | approve | activate | Basis |
|---|---|---|---|---|---|
| `financeManager` | proposed | proposed | no | no | #232 item 1 |
| `controller` | proposed | proposed | no | no | #232 item 1 |
| `owner` | proposed | no | proposed | proposed | #232 item 2 |
| `admin` (protected Administrator) | standing | **no** | standing | standing | #232 item 2, through #223 standing; no grant needed |
| `accountingManager` | no | no | no | no | not named by #232 (open Owner decision) |
| `generalManager` | no | no | no | no | not named by #232 |
| salesperson, salesManager, technician, fieldManager, dispatcher, partsManager, partsAssociate, purchasingManager, warehouseManager, warehouseAssociate, every other Role | no | no | no | no | |

**Separation of duties holds whatever is granted.** The approver or rejecter is never the submitter, nor anyone who wrote the draft. This holds even for a principal holding both prepare and approve, for example someone who is both `controller` and `owner`.

## 4. Canonical personas

The persona roles come from `config/sandboxRoleIdentityRegistry.json` and `functions/scripts/fixtures/taylorNonprodWorkforce.v1.json`.

| Persona | Security Role(s) | After the proposed grants |
|---|---|---|
| ownerExecutive | `owner` | read, approve, activate |
| administrator | `admin` | read, approve, activate (standing) |
| financeAccounting | `controller` in the nonprod workforce fixture (the registry expects `accountingManager`) | read and prepare through `controller`; nothing through `accountingManager` |
| generalManager | `generalManager` | nothing |
| officeManager, serviceManager, dispatcher, serviceTechnician, partsAssociate, partsManager, warehouseAssociate, warehouseManager, retailSales, nationalAccountsSales, reportingAnalyst, generalEmployee | operational Roles | nothing |

**Today, before any grant:**
- only the administrator persona can reach the policy (read, approve and activate, by standing);
- nobody can prepare a policy, so no policy can come into existence.

## 5. What does not change

- **No grants.** The migration writes no grant. The test proves it two ways:
  - after the seed, the authority baseline and the live Service delta, no Role and no Principal holds a `finance.policy.*` key;
  - peeling the migration down and up again leaves every existing Role grant identical.
- **Existing Finance authority is unchanged.** `finance.payment.read` keeps its 14 holders exactly, and so do the settlement and configuration keys.
- **Inventory authority is unchanged.**
- **Tenant and company scope hold.**
  - Every operation resolves the caller's tenant.
  - Every operation names one ACTIVE operating company. CONSOLIDATED, an unknown company and an inactive company are refused.
  - A version id from the other company is `NOT_FOUND`.
  - Taylor and Ventana number their versions independently.
- **Firebase is untouched.** The `financialPolicy.profile.*` catalog entries, their sandbox activation and `financialPolicyProfileCommand.ts` are not changed.

## 6. Open Owner decisions

1. **Execute the proposed grants** in §3, through Administration (nonprod first).
2. **Other Roles.** Should `accountingManager` prepare, and should `generalManager` read? #232 names neither. The canonical financeAccounting persona's registry entry expects `accountingManager`, while its nonprod fixture holds `controller`.
3. **Administrator by standing.** The Administrator's approve and activate come from standing, with no grant. The alternative is to withhold them through `PROTECTED_ADMINISTRATOR_EXCLUSIONS` and grant them explicitly.
4. ~~**Company scope is data-only.**~~ **RESOLVED by #232 Amendment A** (§7): company scope is enforced on every policy command.
5. **Revision without conversion.** CERT-FIN-02 §1 defines a later change as approval -> effective date -> impact assessment -> conversion -> activation. Impact assessment and conversion are unbuilt, and they must exist before any cost-engine consumer reads a revised policy.
6. **Activation has no separation of duties.** A principal holding prepare and activate can activate their own version once someone else has approved it.
7. **Scheduled corrections.** While a future-dated version is scheduled, a correction must be dated after it. No cancel-scheduled path exists.
8. **The UI.** The Financial Policy screen and the client operation mirror (`financeApiClient.js`) are a later PR.
9. **The finance Roles cannot be company-scoped** (`SCOPE_AMBIGUOUS_ADMINISTRATION`). See §7, options A, B and C.
10. **What a global assignment means.** See §7.
11. **The financeAccounting persona holds two Roles.** Its Principal (Employee `synthetic-np-emp-finance-controller`) holds TWO global assignments in nonprod:
    - `accountingManager`, from the Persona Foundation (2026-09-26). It matches `config/sandboxRoleIdentityRegistry.json` `expectedSecurityRoles` and is pinned by `sandboxPersonaBootstrapApply.test.mjs`.
    - `controller`, from the #2024 workforce seed (`functions/scripts/fixtures/taylorNonprodWorkforce.v1.json`, lines 690–707).

    Both Roles carry the same 25 grants. The Owner should choose one:
    - update the registry expectation (the Persona Foundation is frozen, so this needs Owner approval); or
    - revoke one of the two assignments through Administration.

    Nothing was changed here.
12. **Close the direct-grant path** (#232 Amendment A, open item 3). Options:
    - (i) reserve the keys to named Roles (`RESERVED_CAPABILITY_HOLDERS`; every new Role is a code change, and it forbids any unnamed Role, including the Option A Role, unless that Role is named);
    - (ii) a new Role-only rule in `grantObjectActionToPrincipal`;
    - (iii) an operating procedure only.

## 7. Company-scoped authority (#232 Amendment A)

**Rule.** A `finance.policy.*` key applies only at the operating companies the principal's Security Role assignments reach.

- **A global assignment, or Protected Administrator standing,** reaches every company. This is the current EOS meaning of "All (Global)", pending the Owner's confirmation.
- **An operatingCompany-scoped assignment** reaches its company only. The four keys are registered in `SCOPE_EVALUABLE_GRANTS`, whose consumers are the seven policy operations.
- **The company is admitted before any version is read.** Out of scope, the answer is `OUTSIDE_OPERATING_COMPANY_SCOPE` (403), with no version id or state disclosed.
- **Out of scope == missing.** For a scoped-only holder, an unknown company, an inactive company (including a scoped company made inactive) and an ACTIVE out-of-scope company get the same `OUTSIDE_OPERATING_COMPANY_SCOPE`. A flat holder keeps the precise `OPERATING_COMPANY_UNKNOWN`. CONSOLIDATED is always `CONSOLIDATED_NOT_A_COMPANY`.
- **Administrator standing** reaches every company for read, approve and activate, and never for prepare.
- **Direct principal grants are NOT yet closed.** A direct principal grant of `finance.policy.*` (`grantObjectActionToPrincipal`) is still a tenant-wide path. The existing `RESERVED_CAPABILITY_HOLDERS` list is a Role allow-list, and adding the keys would refuse the Option A Role. See Owner decision 12.
- **Fail closed.** A conditioned scoped holding admits nothing.
- **Consolidated.** CONSOLIDATED is refused for every policy command. Consolidated Finance reporting reads are unaffected.
- **Separation of duties** is unchanged and decided per version. A principal with a scoped preparer Role for Taylor and a global approve still cannot approve its own Taylor version.

| Holder (test-tenant Roles, Option A shape) | Taylor | Ventana |
|---|---|---|
| preparer @ Taylor | read, prepare, submit | refused (`OUTSIDE_OPERATING_COMPANY_SCOPE`) |
| preparer @ Ventana | refused | read, prepare, submit |
| preparer @ Taylor + preparer @ Ventana | separate, independently versioned policies | same |
| decider (approve + activate) @ Taylor | approve, activate | refused |
| global preparer | both | both |

**Which Role carries scoped policy authority is an Owner decision.** `controller`, `accountingManager`, `financeManager` and `owner` carry Administration capabilities (`audit.event.read` / `admin.*`), so Administration refuses them at company scope (`SCOPE_AMBIGUOUS_ADMINISTRATION`). The options:

| Option | What it means | Code needed |
|---|---|---|
| **A (recommended)** | A dedicated policy-preparer Role through Administration. | None. |
| **B** | Remove `audit.event.read` from `controller`. Its other 24 capabilities would go inert at a scope. | |
| **C** | An EOS-wide change. | Yes. |

**The meaning of a global assignment** is also an Owner decision:
- (a) all companies, the current behaviour; or
- (b) a scoped holding is required. This needs an EOS-wide `scopeRequired` extension, with exemptions for the Owner and for Administrator standing.
