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

- **Never deleted.** No row is deleted.
- **Write-once stamps.** The prepared, submitted, approved, rejected, activated and superseded stamps are written once.
- **Enforced twice.** The server enforces every rule, and so do the database's triggers and CHECKs.
- **Effective date.** It is stated at activation. It may not precede the company's business date, nor the effective date of any earlier activated version.
- **Fail closed.** A company without an ACTIVE version reads `NOT_CONFIGURED`. No default method exists.

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
2. **`accountingManager`.** Should it also prepare, and should `generalManager` read? #232 names neither. The canonical financeAccounting persona's registry entry expects `accountingManager`, while its nonprod fixture holds `controller`.
3. **Administrator standing.** Is approve / activate by standing the intended mechanism (as implemented), or should it be withheld through `PROTECTED_ADMINISTRATOR_EXCLUSIONS` and granted explicitly?
4. **The UI.** The Financial Policy screen and the client operation mirror (`financeApiClient.js`) are a later PR.
