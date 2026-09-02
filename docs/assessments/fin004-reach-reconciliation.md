# FIN-004 Reach Reconciliation

**Status:** MEASURED AND CLOSED, except for one Owner decision recorded in §6. Analysis and tests
only — no Role was granted, no capability activated, no scope widened, no comment rewritten to
claim a grant that does not exist. Measured against `fd40ff5d` on 2026-09-02.

**Why this document exists.** The dashboard reporting census
(`eos-dashboard-reporting-authority-census.md`, PR #1740) reported as its headline finding that
**no Role carried any `finance.visibility.*` capability**, and that fourteen dashboard fact
families were therefore blocked behind a missing grant. The Owner directed that this be treated
as a real FIN-004 functional blocker rather than documentation cleanup.

**Re-measurement shows the finding was wrong.** `admin` and `owner` carry all five scopes. The
census measured Role grants by searching the Role source files for the capability ids and finding
no literal occurrence. That method cannot see a derived grant, and admin's grants are derived. The
correction is recorded in full in §2 because the measurement defect is more durable than the
finding was.

---

## 1. The invariant, restated

```
FINANCIAL REACH = finance.read fact-family authority
                + explicit finance.visibility.* reach
```

Either one alone reaches nothing. Enforced in `functions/src/finance/financialVisibility.ts`
(`anyReach = factFamilyAllowed && grants.length > 0`) and composed by
`financeReadCallables.ts`'s `loadFinancialVisibilityAuthority`. Reach is the UNION of granted
scopes. There is no admin role-branch anywhere in the authority module.

A third factor sits in front of both: **per-environment activation**. Every
`finance.visibility.*` id is registered `active: false`, so a held capability resolves DENY
`inactivePermission` unless the environment activates it. Grant, activation and fact family are
three independent conditions, and all three are required.

---

## 2. The measurement defect, recorded so it does not recur

`admin`'s permission list is **derived, not enumerated**:

```ts
// functions/src/access/compatibilityRoles.ts
const ADMIN_ALL_PERMISSIONS = [
  ...ADMIN_CURATED_PERMISSIONS,
  ...PERMISSION_CATALOG.map((p) => p.id).filter((id) => !ADMIN_CURATED_PERMISSIONS.includes(id)),
];
```

This is deliberate and is itself an Owner ruling (2026-08-19: *"Admin and Owner have full access
to all possible features and permissions"*), adopted precisely because a hand-kept list had
drifted sixty ids behind the catalog. `owner` inherits the same set through `OWNER_PERMISSIONS`
composition.

**The consequence for anyone auditing grants:** a capability id can be a real, resolved grant on
`admin` and `owner` while appearing **nowhere as a literal string** in any Role source file. A
`grep` over the role files returns nothing and looks like proof of absence. It is not.

The correct measurement asks the resolver:

```js
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
ROLES.admin.permissions.includes("finance.visibility.consolidated"); // true
```

This is pinned by `functions/test/fin004ReachComposition.test.mjs` — *"admin's five scopes are
DERIVED from the catalog, not listed literally"* asserts both halves at once: the id must NOT
appear as a literal in the source, and it must nonetheless be a real grant.

It is also worth noting that an existing test already asserted the truth
(`financialVisibilitySandboxActivation.test.mjs`: *"admin must hold it as a declared Role
permission"*) and was passing the whole time. The census contradicted a green test without
running it.

---

## 3. The measured Role / scope matrix

Measured by resolver on `fd40ff5d`. 43 Roles total; only those holding any `finance.*` reach
capability are listed.

| Role | `finance.read` | `visibility.self` | `.team` | `.businessUnit` | `.company` | `.consolidated` | Reach in SANDBOX | Reach in PRODUCTION |
|---|---|---|---|---|---|---|---|---|
| `admin` (compatibility) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **CONSOLIDATED** | none |
| `owner` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **CONSOLIDATED** | none |
| `accountingManager` | ✅ | — | — | — | — | — | none | none |
| `controller` | ✅ | — | — | — | — | — | none | none |
| `generalManager` | ✅ | — | — | — | — | — | none | none |
| `salesManager` | ✅ | — | — | — | — | — | none | none |
| `salesperson` | ✅ | — | — | — | — | — | none | none |
| `purchasingManager` | ✅ | — | — | — | — | — | none | none |
| `fieldManager` (Service Manager) | ✅ | — | — | — | — | — | none | none |
| `partsManager` | ✅ | — | — | — | — | — | none | none |
| `partsAssociate` | ✅ | — | — | — | — | — | none | none |
| `shopManager` | ✅ | — | — | — | — | — | none | none |
| `shopAssociate` | ✅ | — | — | — | — | — | none | none |
| **`financeManager`** | ❌ | — | — | — | — | — | none | none |
| every other Role (29) | ❌ | — | — | — | — | — | none | none |

**Reading the two reach columns.** admin and owner *hold* all five scopes, but sandbox activates
only `finance.visibility.consolidated`, so their reach there is exactly CONSOLIDATED — the other
four are held and denied. Production activates nothing, so reach is nil for every principal
including admin, which is the triple block working as designed.

**The eleven gate-only Roles are correct, not broken.** Holding `finance.read` without a scope is
the FIN-004 invariant doing its job: it retires the pre-FIN-004 trap where activating the single
`finance.read` boolean would have granted company-wide AR over any caller-supplied accountId.

---

## 4. What this means for the census's fourteen blocked fact families

The census's §9 decision 1 and its correction C-2 are **withdrawn**. The corrected position:

| Census claim | Corrected |
|---|---|
| No Role carries any `finance.visibility.*` | admin and owner carry all five |
| Every Financials surface resolves to zero reach for every principal, in every environment | Sandbox admin/owner resolve CONSOLIDATED reach; every other principal and every other environment resolve none |
| "The Owner review that activation was performed for cannot show a single financial figure" | It can. The activation achieved what it was for |
| Fourteen fact families blocked on a missing grant | Those fourteen are **ACTIVATION-CLASS for admin/owner in sandbox**. They remain blocked for the other eleven finance-gate Roles, which is a scope-grant decision (§6), not a defect |
| `environmentCapabilityOverrides.ts` asserts something false | The comment is **correct**. It was the census that was wrong |

The census document carries this correction inline; this file is its evidence.

---

## 5. Deterministic proof

`functions/test/fin004ReachComposition.test.mjs` — 10 checks, all passing, run with
`node --test test/fin004ReachComposition.test.mjs` after `npm run build`.

It exists because the two pre-existing suites each test one layer:
`financialVisibility.test.mjs` proves the authority layer (given grants, what is visible);
`financialVisibilitySandboxActivation.test.mjs` proves the resolver layer (given a role and an
environment, is a capability ALLOW). Neither drove the two together — and the seam between them
is exactly where the census went wrong. `composeReach()` mirrors the production loader's own
composition with the Firestore reads removed; it calls the same resolver and the same authority
builder, so it is not a second opinion.

The five required proofs:

| Proof | Construction | Result |
|---|---|---|
| 1. Eligibility alone ⇒ zero reach | `technician` in sandbox, where consolidated IS activated | no fact family, no scopes, no invoice visible |
| 2. Grant alone while inactive ⇒ zero reach | `admin` (carries all five) in production (activates none) | no scopes conferred; GRANT ≠ ACTIVATION |
| 3. `finance.read` without visibility ⇒ zero reach | `accountingManager` in sandbox | fact family true, scopes empty, reach false |
| 4. Visibility without `finance.read` ⇒ zero reach | constructed at the authority layer, per scope and all five at once | reach false in every case |
| 5. Fact family + active grant ⇒ exactly the governed scope, nothing broader | `admin` in sandbox | exactly `["CONSOLIDATED"]` despite holding five; each narrower scope reaches a strictly smaller, exactly-specified invoice set |

Plus: the Role/scope matrix pinned; the derived-grant defect pinned; `active:false` catalog
posture pinned; no-admin-bypass (same call, different Role, different answer; a revoked
assignment confers nothing); and the §6 contradiction pinned as current state.

**Mutation-verified** — the proofs were confirmed non-vacuous by breaking the invariant and
watching them fail, then restoring:

| Mutation | Caught by |
|---|---|
| `anyReach = grants.length > 0` (drop the fact-family requirement) | PROOF 4 |
| resolver ignores per-environment activation | PROOF 2 and PROOF 5 |

---

## 6. The one unresolved Owner decision

**Finance Manager holds no finance capability at all, while both Roles' descriptions claim they
are intentionally identical.**

Measured on `fd40ff5d`:

- `financeManager` — **5** permissions: `audit.event.read`, `customer.governedField.write`,
  `customer.record.read`, `reorder.purchaseOrder.read`, `salesOrder.read`.
  **Zero `finance.*` ids.** It fails the fact-family gate outright, so it cannot read a single
  financial fact in any environment.
- `accountingManager` — **17** permissions, including all five `finance.*` ids
  (`read`, `invoice.issue`, `payment.apply`, `adjustment.record`, `refund.record`).
- The difference is twelve permissions, entirely one-directional: `financeManager ⊂
  accountingManager`.

**Yet both descriptions say so in as many words:**

> `accountingManager`: "…Intentionally identical to Finance Manager (Owner ruling 2026-08-18)."
> `financeManager`: "…Intentionally identical to Accounting Manager (Owner ruling 2026-08-18)."

And the source comment above `ACCOUNTING_MANAGER_ROLE` adds: *"The two sets are now intentionally
identical, and the pinning test was inverted to assert exactly that — so a future divergence has
to be a decision, not a drift."*

**Why nothing caught it.** The pinning test
(`governedBusinessRoles.test.mjs`, "Accounting Manager retains everything Finance Manager holds")
is **directional**: it asserts `accounting ⊇ finance` and
`accounting.length >= finance.length`. Both hold at 17 vs 5. The test passes while its own
comment — *"the two are identical again"* — is false. It permits the divergence it was written to
detect, because "at least" was chosen over "equal" to allow a future Accounting-only grant.

**The decision required.** Which Role is the financial-oversight Role, and what does it hold?
Three coherent answers, none of which a build may pick:

1. **Restore parity** — grant `financeManager` the twelve ids, making the descriptions true.
2. **Retire the parity claim** — Accounting is the operational financial Role, Finance is
   policy-only; correct both descriptions and the pinning test's comment to say so.
3. **Re-specify Finance Manager** — it is the natural holder of a `finance.visibility.*` scope
   (§3 shows only admin/owner hold any), which would make it the first non-admin financial
   reader. That is a reach grant and is squarely an Owner decision.

**Not fixed here, deliberately.** Granting a finance capability to a Role by inference is the
exact move the addendum's step 6 forbids, and step 4 conditions implementation on the carrying
Roles being resolved first. The current state is pinned by the CONTRADICTION test so that the day
this is ruled, that test fails and forces this record to be updated rather than silently
outgrown.

**Related, and also open:** the F14 §2 grant table still marks "carrying role TBD" for the
Financial-company-manager, BU-manager, self-view-salesperson, team-manager and
consolidated-executive personas. §3 shows the concrete gap: eleven Roles hold the fact-family
gate and no scope, so none of those personas can read anything until a scope is granted to a
carrying Role. That remains exactly the decision F14 recorded; nothing in this reconciliation
closes it.

---

## 7. Preserved, and verified preserved

| Property | State | Where proven |
|---|---|---|
| `active:false` catalog posture | unchanged — all five scopes | `fin004ReachComposition.test.mjs` "every visibility capability stays active:false" |
| Sandbox-only activation | unchanged — only `consolidated`, only `eos-platform-sandbox` | `financialVisibilitySandboxActivation.test.mjs` (17 checks) |
| Production triple block | unchanged — role-keyed EMPTY, no override key, test-asserted | PROOF 2; existing "PRODUCTION resolves EMPTY" and the poisoned-registry case |
| Canonical FIN-004 resolver | untouched — this run added a test and two documents | `git diff` carries no change under `functions/src/` |
| No admin bypass | unchanged — no role branch; reach follows the grant | PROOF 5 and "no admin bypass: reach comes from the grant, not the role name" |
| No production deploy | none performed | this run made no deploy of any kind |
