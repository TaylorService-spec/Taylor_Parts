# FIN-004 Reach Reconciliation

**Status:** CLOSED. The measurement (§1–§5) is closed. The Role contradiction it surfaced is closed
by **Owner ruling 2026-09-02** and implemented in §6–§8. Two non-closures remain, named in §9: TEAM
and SELF are granted but activated nowhere, so their carriers resolve zero reach. No production
change, no deploy.

Measured against `fd40ff5d` (§1–§5) and re-measured against `c54cd218` for the ruling (§6–§9).

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

> **This table is the BEFORE state — it is history, not current.** The Owner ruling of 2026-09-02
> changed it: `generalManager`, `financeManager` and `accountingManager` now carry CONSOLIDATED,
> `salesManager` carries TEAM, `salesperson` carries SELF, and `financeManager` holds
> `finance.read` at all. **§7 is the current matrix.** This one is kept because §4's withdrawal of
> the census finding is only legible against the state that was actually measured.

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

`functions/test/fin004ReachComposition.test.mjs` — **18 checks**, all passing, run with
`node --test test/fin004ReachComposition.test.mjs` after `npm run build` (it is also in the
CI-covered `test:access` chain). It began as 10 checks proving the invariant; the 2026-09-02
ruling added the approved-matrix, activation-state and TEAM/SELF binding blocks, and turned the
CONTRADICTION check into the PARITY CLOSED check.

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
## 6. The Finance Manager contradiction — CLOSED by Owner ruling 2026-09-02

**What was measured** (2026-09-02, `c54cd218`): `financeManager` held **5** permissions and
**zero** `finance.*` ids, so the Role named Finance Manager could not read a single financial fact
anywhere. `accountingManager` held **17**, including all five `finance.*` ids. Both descriptions
said *"Intentionally identical (Owner ruling 2026-08-18)"*, and the source comment added *"a future
divergence has to be a decision, not a drift."*

**Why nothing caught it.** The pinning test was **directional** — `accounting ⊇ finance` and
`accounting.length >= finance.length`. Both hold at 17 vs 5. It passed while its own comment ("the
two are identical again") was false.

**The Owner ruled** (2026-09-02): the two Roles remain intentionally identical; restore parity.
This is a restoration of already-recorded Role policy, not a new expansion of business authority.

**Implemented.** Both Roles are now built from **one shared constant**,
`MONEY_MANAGER_PERMISSIONS` in `functions/src/access/governedBusinessRoles.ts`. Two arrays that
must be equal are two chances to be wrong; one array is zero. This is not an abstraction — it is a
single shared literal with no factory, no indirection and no new type. If the Owner ever rules the
two Roles apart, the constant splits in that same change, and the equality test requires it.

The pinning test is now **exact set equality** (`governedBusinessRoles.test.mjs`), which rejects a
missing permission, an extra permission, and same-length-different-membership. All three rejections
are demonstrated against the real permission set rather than asserted in prose, because "at least"
is precisely what let the drift through.

**Result:** `financeManager` 5 → **18**; `accountingManager` 17 → **18**; the two sets are exactly
equal. The twelve ids Finance Manager regained are the five `finance.*` authorities, five
`inventory.*` / `warehouse.*` reads and `opportunity.read` — plus `finance.visibility.consolidated`,
which both Roles gain under §7.

**One consequential side effect, recorded rather than absorbed.** Parity carries
`warehouse.transferOrder.read` to `financeManager`, taking the canonical transfer-order-read roster
from eight Roles to nine. That follows necessarily from the parity ruling (accountingManager's
canonical row declares the id), and the expectation list in `governedBusinessRoles.test.mjs` was
updated with that reasoning attached rather than silently widened.

---

## 7. Financial visibility matrix — Owner ruling 2026-09-02

Financial visibility is granted by explicit business need. Holding `finance.read` alone does not
imply reach; the FIN-004 invariant in §1 is unchanged.

| Role | Ruled scope | Carried after this change | Note |
|---|---|---|---|
| `owner` | CONSOLIDATED | SELF, TEAM, BUSINESS_UNIT, OPERATING_COMPANY, CONSOLIDATED | **Untouched** — pre-existing derived grants left exactly as they were |
| `admin` | CONSOLIDATED | SELF, TEAM, BUSINESS_UNIT, OPERATING_COMPANY, CONSOLIDATED | **Untouched**, same reason (derived from the whole catalog, Owner ruling 2026-08-19) |
| `generalManager` | CONSOLIDATED | CONSOLIDATED | granted |
| `financeManager` | CONSOLIDATED | CONSOLIDATED | granted via `MONEY_MANAGER_PERMISSIONS` |
| `accountingManager` | CONSOLIDATED | CONSOLIDATED | granted via `MONEY_MANAGER_PERMISSIONS` |
| `salesManager` | TEAM | TEAM | granted; resolves zero until TEAM is activated (§9) |
| `salesperson` | SELF | SELF | granted; resolves zero until SELF is activated (§9) |

**Explicitly granted no scope by this ruling**, and verified to have gained none:
`operationsManager`, `fieldManager` (Service Manager), `purchasingManager`, `officeManager`,
`marketingManager`, `shopManager`, `shopAssociate`, `partsManager`, `partsAssociate`,
`warehouseManager`, `warehouseAssociate`, `dispatcher`, `technician`, `generalEmployee`,
`controller`, and every execution/special-purpose Role. A test asserts that **no** Role outside the
approved matrix carries any `finance.visibility.*`.

**Seven Roles now hold `finance.read` with no scope** — `controller`, `fieldManager`,
`partsAssociate`, `partsManager`, `purchasingManager`, `shopAssociate`, `shopManager`. This is an
**allowed, intentional, fail-closed state**, and each is measured to resolve zero reach rather than
merely being unlisted.

**BUSINESS_UNIT and OPERATING_COMPANY gained no new carrier.** Both remain valid FIN-004
architecture for future explicit use; `admin` and `owner` carried them before and still do, and a
test pins that the carrier set for each is exactly those two.

---

## 8. Activation state — measured, and deliberately not completed

| Capability | Catalog | Sandbox-eligible | Sandbox active | Production active |
|---|---|---|---|---|
| `finance.read` | `active:false` | yes | **yes** | no |
| `finance.visibility.consolidated` | `active:false` | yes | **yes** | no |
| `finance.visibility.team` | `active:false` | **no** | no | no |
| `finance.visibility.self` | `active:false` | **no** | no | no |
| `finance.visibility.businessUnit` | `active:false` | no | no | no |
| `finance.visibility.company` | `active:false` | no | no | no |

Production carries **zero** capability activation overrides, and the block is role-keyed as well as
data-driven — a production entry declaring one would still resolve EMPTY.

### Resolved reach after this change

| Role | Sandbox | Production | Why |
|---|---|---|---|
| `owner` | **CONSOLIDATED** | none | carries five scopes; only CONSOLIDATED is active |
| `admin` | **CONSOLIDATED** | none | same |
| `generalManager` | **CONSOLIDATED** | none | new grant, active scope |
| `financeManager` | **CONSOLIDATED** | none | new grant, active scope |
| `accountingManager` | **CONSOLIDATED** | none | new grant, active scope |
| `salesManager` | **ZERO** | none | TEAM granted, TEAM inactive — GRANT ≠ ACTIVATION |
| `salesperson` | **ZERO** | none | SELF granted, SELF inactive — same |
| every other Role | **ZERO** | none | carries no scope |

TEAM and SELF were **not** activated here. The ruling forbids completing the matrix by activation
in this change, and they are not in the eligible-id allow-list — so even declaring them in an
environment registry would not activate them. That intersection is asserted by test.

---

## 9. Non-closures

1. **TEAM activation.** `finance.visibility.team` is granted to `salesManager` and is neither
   eligible nor active in any environment. Sales Manager financial reach is **zero** until an Owner
   activation ruling adds it to `SPINE_OVERRIDE_ELIGIBLE_IDS` *and* to the sandbox registry.
2. **SELF activation.** Identical position for `finance.visibility.self` on `salesperson`.
3. **Binding prerequisites — not measured against live data, deliberately.** Even once activated,
   TEAM requires `loadPrincipalPositions` / `visibleEmployeeIdsFor` to resolve a non-empty set, and
   SELF requires `users/{uid}.employeeId` to be linked. Both fail closed today, asserted at the
   authority layer (§5). Whether sandbox personas actually carry the required position rows and
   employee links is a **live-data question a repository change cannot answer**, and it was not
   assumed. Measure it as part of any TEAM/SELF activation package — a granted, activated scope
   that binds to nothing still reaches nothing, which is correct but would look like a bug.
4. **Production unchanged.** No override, no deploy, no reachable grant.
5. **FIN-BLOCK-003 unaffected.** Cost and margin remain structurally UNKNOWN. Reach is not cost:
   a CONSOLIDATED carrier can see every governed financial fact and still gets UNKNOWN for margin.

---
---

## 10. Preserved, and verified preserved

| Property | State | Where proven |
|---|---|---|
| `active:false` catalog posture | unchanged — all five scopes | `fin004ReachComposition.test.mjs` "every visibility capability stays active:false" |
| Sandbox-only activation | unchanged — only `consolidated`, only `eos-platform-sandbox` | `financialVisibilitySandboxActivation.test.mjs` (17 checks) |
| Production triple block | unchanged — role-keyed EMPTY, no override key, test-asserted | PROOF 2; existing "PRODUCTION resolves EMPTY" and the poisoned-registry case |
| Canonical FIN-004 resolver | untouched — this run added a test and two documents | `git diff` carries no change under `functions/src/` |
| No admin bypass | unchanged — no role branch; reach follows the grant | PROOF 5 and "no admin bypass: reach comes from the grant, not the role name" |
| No production deploy | none performed | this run made no deploy of any kind |
