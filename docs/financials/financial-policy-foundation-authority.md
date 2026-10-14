# Financial Policy foundation: authority impact

**Decision:** DECISIONS #232 (Owner, 2026-10-13). It continues the CERT-FIN-02 policy-profile ruling of 2026-09-03 ([reconciliation](../assessments/cert-fin-02-policy-framework-reconciliation.md), §7 lifecycle).
**Migration:** `functions/migrations/1764560000000_financial-policy-profiles.sql`; withdraw / cancel (Phase 3, §8): `1764570000000_financial-policy-withdraw-cancel.sql`.
**Server:** `functions/src/eosFinance/financialPolicy.ts`, served on `/operations/finance`.
**Proof:** `functions/test/financialPolicyFoundationPostgres.test.mjs`.

**Status:** local foundation. Nothing is granted, nothing touches nonprod or production, and there is no UI yet.

## 1. Lifecycle

```
DRAFT --submit--> SUBMITTED --approve--> APPROVED --activate--> ACTIVE --(later version activates)--> SUPERSEDED
  |                  |  \--reject---> REJECTED      |
  +----withdraw------+--> WITHDRAWN                 +--cancel--> CANCELLED        (Phase 3, §8)
                        ACTIVE / SUPERSEDED while SCHEDULED (not yet in force) --cancel--> CANCELLED   (Owner ruling 2026-10-14)
```

| State | Editable content | Next states | Notes |
|---|---|---|---|
| DRAFT | yes | SUBMITTED, WITHDRAWN | At most one version in flight (DRAFT, SUBMITTED or APPROVED) per company. |
| SUBMITTED | no (frozen) | APPROVED, REJECTED, WITHDRAWN | |
| APPROVED | no | ACTIVE, CANCELLED | |
| REJECTED | no | none (final) | A change is a new DRAFT. |
| ACTIVE | no (**locked**) | SUPERSEDED, only through the activation of a later approved version, in the same transaction; CANCELLED while still scheduled (§8) | At most one per company. |
| SUPERSEDED | no | CANCELLED while still scheduled (§8); otherwise none (final) | Preserved intact. |
| WITHDRAWN | no | none (final) | Phase 3. Releases the in-flight slot; never in force. |
| CANCELLED | no | none (final) | Phase 3. Keeps its approval (and, if it was scheduled, its activation stamps); releases the slot; never in force. |

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

## 3. Who may hold what (#232 Phase 1; supersedes the earlier proposed grants)

The earlier proposals are SUPERSEDED: read + prepare for `financeManager` / `controller`, and read + approve + activate for `owner`. The existing finance Roles stay unchanged.

| Holder | read | prepare | approve | activate | How |
|---|---|---|---|---|---|
| **Financial Policy Preparer** (custom Role; created through Administration on Owner authorization, no code) | yes | yes | – | – | global, or scoped per operating company (Amendment A) |
| `owner` | proposed | – | **reserved, proposed grant** | **reserved, proposed grant** | the grant needs Owner authorization through Administration |
| `admin` (protected Administrator) | standing | **no** | standing | standing | #223 standing; the reservation does not affect it |
| `controller`, `financeManager`, `accountingManager`, `generalManager` and every other Role | – | – | refused (reserved) | refused (reserved) | unchanged |

**Reserved list.**
- **approve / activate** are on `RESERVED_CAPABILITY_HOLDERS`, reserved to `[owner]`. A grant to any other Role, or a direct principal grant, is refused.
- **approve / activate at runtime.** They are checked against the reservation at request time too (the `requireReservedHolder` primitives `qualifyingGlobalRoles` + `reservedCapabilityAdmits`, plus Administrator standing), so a bypassed role-capability row does not authorize.
- **read / prepare are ROLE-ASSIGNMENT-ONLY (#232 Option C).** They are not reserved to a Role: any Role, including a custom Preparer Role, may hold them. A direct principal grant is refused (`ROLE_ASSIGNMENT_ONLY`), and a pre-existing direct row confers nothing at request time.

**Separation of duties holds whatever is granted.** The approver, rejecter OR ACTIVATOR is never the submitter, nor anyone who wrote the draft. The approver may activate.

## 4. Canonical personas

The persona roles come from `config/sandboxRoleIdentityRegistry.json` and `functions/scripts/fixtures/taylorNonprodWorkforce.v1.json`.

| Persona | Security Role(s) | After Phase 1 (and the Owner grant, once authorized) |
|---|---|---|
| ownerExecutive | `owner` | approve, activate (read: proposed) |
| administrator | `admin` | read, approve, activate (standing) |
| financeAccounting | `accountingManager` + `controller` (see §6 item 11) | nothing, until a Preparer Role assignment |
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
7. ~~**Scheduled corrections.**~~ **RESOLVED by the Owner ruling of 2026-10-14** (§8): a scheduled version stays cancellable until it takes effect.
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
- **Direct principal grants are not a path.** Approve and activate are reserved to the Owner Role (#232 Phase 1). Read and prepare are role-assignment-only (#232 Option C): a direct grant is refused, and a pre-existing direct row is ignored by the resolver, so it never widens a company-scoped holding.
- **So the only tenant-wide paths are** a GLOBAL Role assignment and Administrator standing (read / approve / activate).
- **Resolvers that honour the list.** Three resolvers apply the role-assignment-only filter: `resolveOperationalCapabilities`, `resolvePrincipalEffectiveAccess`, and the Workforce `withDirectCapabilityGrants`.
- **Raw readers that stay unfiltered by design.** These are display-only or latent and confer nothing: the Administration gate's `capabilityKeysFor` (Administration keys only; the preview's `latent` / `adminKeys`), the `directGrants` echo, and the grant matrix's `DIRECT_EXCEPTION` display.
- **Latent risk.** `entitledActionAuthority.authorizeEntitledResolvedAction` re-reads raw direct entitlements. It has test-only callers today, so it confers nothing. It MUST apply the same filter if it is ever wired to a transport.
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
13. ~~**Close direct grants of read / prepare.**~~ **RESOLVED by #232 Option C** (`ROLE_ASSIGNMENT_ONLY_CAPABILITIES`). Grant-time refusal, a request-time drop in the shared resolver, and the drift report are all in place. Creating the Preparer Role itself still needs only an Owner-authorized Administration action.
14. **Owner grants.** The Owner Role's approve / activate grants (and read, if wanted) need the Owner's authorization through Administration.
15. **Mandatory company assignment is not part of this feature.** The EOS-wide mandatory-company-assignment ruling is a separate future programme. Here, a GLOBAL Role assignment still means all companies.

**Status.** Activation separation of duties is RESOLVED (#232 Phase 1). Amendment A item 3 (direct grants) is RESOLVED for approve / activate, and OPEN for read / prepare (decision 13).

## Phase 2: Administration UI (local, 2026-10-13)

- **Page:** Administration → Financial Policy (`/administration/financial-policy`). `AdminFinancialPolicy.jsx` composes `FinancialPolicyWorkspace.jsx` and leaves Finance Configuration (#203) unchanged. The page no longer reads the Firebase-era `financialPolicy.profile.*` feed.
- **Server-derived authority:** `readMyFinancialPolicyAuthority` on `/operations/finance` is gated on `finance.policy.read`, held either globally or at operatingCompany scope. It lists only the ACTIVE companies that the caller's read covers. For each company it returns read/prepare/approve/activate as allowed, or as the refusal code that the command itself would return. `readFinancialPolicy` and `listFinancialPolicyVersions` also return:
  - per-version `yourActions`;
  - `yourAuthority.createDraft`;
  - the version audit trail;
  - actor display names.

  All of these are computed from the commands' own primitives (`capabilityReach`, `reservedAuthorityHeld`, `reachesCompany`, `independentDeciderRefusal`). The commands still decide every request.
- **Navigation:** the page's surface is `finance.policy`, a business surface rather than an `administration.*` one. It is earned by `finance.policy.read` held globally, or by an unconditioned operatingCompany holding tied to `operations.listFinancialPolicyVersions`. The Administration scoped-door guard is unchanged. The legacy placeholder row stays, so the row changes kind instead of being added: the cutover ceiling goes from 21 to 22, the ungoverned ceiling from 41 to 40, and the total stays at 62.
- **Grant matrix:** a stored direct grant of a ROLE_ASSIGNMENT_ONLY key (`finance.policy.read` / `.prepare`) is listed with `enforced: false`, `notEffectiveReason: "ROLE_ASSIGNMENT_ONLY"` and `forbiddenBy` (the ruling). The UI renders it as "Not effective — role assignment only" and does not count it as a holder. A stored direct row of a RESERVED key (for example `finance.policy.approve` or `salesAgreement.tradeIn.approve`) is deliberately NOT marked: only ROLE_ASSIGNMENT_ONLY keys are filtered out of the capability set (`capabilityAuthority.ts`), so a reserved direct row does enter it, and the reservation is decided separately at runtime (`requireReservedAuthority` / `requireReservedHolder`). Its matrix cell stays `enforced: true`, consistent with the Employee effective-access view.
- **Legacy shell gate (Firebase-retirement candidate):** `FINANCIAL_POLICY_GATE` in `field-ops-app-vite/src/access/shellCapabilityGates.js` still adds `financialPolicy.profile.read` / `.configure` to the legacy Firebase shell capability request set. Nothing reads those answers any more (the page reads `/operations/finance`). The entry was kept in this change so the shell request set is unchanged; remove it in a Firebase-retirement step together with its request-set pins.

## 8. Phase 3: withdraw and cancel (local, 2026-10-14)

**Why.** An APPROVED version held the company's single in-flight slot until it was activated, and nothing removed an abandoned DRAFT or SUBMITTED version, so a company could be stranded with no way to start a new draft.

| Command | Key (no new key) | From | To | Who | Refusals |
|---|---|---|---|---|---|
| `withdrawFinancialPolicy` {operatingCompanyId, versionId, reason} | `finance.policy.prepare` (global or company-scoped) | DRAFT, SUBMITTED | WITHDRAWN | the version's own preparer: a content author (the creator is the first) or the submitter | `CAPABILITY_REQUIRED`, `OUTSIDE_OPERATING_COMPANY_SCOPE` (before any lookup), `FINANCIAL_POLICY_NOT_WITHDRAWABLE`, `FINANCIAL_POLICY_LOCKED` (ACTIVE / SUPERSEDED), `NOT_YOUR_VERSION`, `REASON_REQUIRED` |
| `cancelFinancialPolicy` {operatingCompanyId, versionId, reason} | `finance.policy.approve` + its request-time reservation (Owner Role, or Administrator standing) | APPROVED; or ACTIVE / SUPERSEDED while SCHEDULED (effective date after the company's business date) | CANCELLED | anyone holding it who is neither the submitter nor a content author (the approver may) | `CAPABILITY_REQUIRED`, `RESERVED_CAPABILITY`, `OUTSIDE_OPERATING_COMPANY_SCOPE`, `FINANCIAL_POLICY_NOT_CANCELLABLE`, `FINANCIAL_POLICY_LOCKED` (a version in force), `SEPARATION_OF_DUTIES`, `REASON_REQUIRED` |

- **Why approve governs cancel.** Cancelling an approval reverses a decision; activation is a separate act. Both keys are reserved to the same holders today, so the choice moves no one's authority.
- **History kept.** The content, every earlier stamp (including the approval and its note) and the audit trail are untouched. Each act writes one audit row (`finance.policy.withdraw` / `finance.policy.cancel`) with the full snapshot and the reason, and has its own write-once by / at / reason stamps.
- **Slot released.** The in-flight index covers DRAFT / SUBMITTED / APPROVED only, so a new draft may follow at once; version numbering continues.
- **Never in force.** In force is ACTIVE / SUPERSEDED by date; Financials governance reads only the server's in-force answer.
- **Scheduled versions (Owner ruling 2026-10-14).** A version activated with a future effective date is SCHEDULED until that date, whether still ACTIVE or already SUPERSEDED by a later activation, and stays cancellable until it actually takes effect. Both the server (`cancelState`, on the company's business date read inside the lock) and the trigger (on `operating_company_business_date(now())`) refuse a version in force with `FINANCIAL_POLICY_LOCKED`. The cancelled version keeps its activation and supersession stamps; the version it superseded keeps governing, because in force is resolved by date and CANCELLED is never in force. Offers (`yourActions.cancel`) are decided on today's business date even when the screen reads another `asOfDate`.
- **Database enforcement.** The transition trigger allows exactly DRAFT→WITHDRAWN, SUBMITTED→WITHDRAWN, APPROVED→CANCELLED and, while scheduled, ACTIVE / SUPERSEDED→CANCELLED; nothing out of REJECTED, WITHDRAWN or CANCELLED; and nothing else out of ACTIVE (except supersession) or SUPERSEDED. The CHECKs `financial_policy_withdrawer_owns_version` and `financial_policy_canceller_independent` hold ownership and independence against a direct write; the server maps them to `NOT_YOUR_VERSION` and `SEPARATION_OF_DUTIES`.
- **Concurrency.** Activation and cancellation take the same per-company advisory lock and the version's row lock and re-read the status; the trigger admits ACTIVE and CANCELLED only from APPROVED. Whichever commits first wins; the other answers 409 (`FINANCIAL_POLICY_LOCKED` or `FINANCIAL_POLICY_NOT_APPROVED`). Proven in both orders, through the server and through raw SQL.
- **Authority reads.** `yourActions` gains `withdraw` and `cancel`; `readMyFinancialPolicyAuthority` lists both per company. They are computed from the commands' own helpers (`withdrawState`, `cancelState`, `ownVersionRefusal`, `independentDeciderRefusal`).
- **Down.** The migration's Down refuses while any WITHDRAWN or CANCELLED version exists.
- **In order.** The trigger lets a transition write only its own stamps; every other lifecycle stamp keeps its prior value (no forged submission stamp on a withdrawal, no forged approval or withdrawal stamp on a cancellation).
- **Owner rulings (2026-10-14).** A policy author (any content author, or the submitter) withdraws their own DRAFT / SUBMITTED version while they retain company authorization. An authorized approver may cancel an APPROVED version, including their own approval. A scheduled version stays cancellable until it takes effect; a version in force never is.
- **Still open.** Nothing in this lifecycle (§6 item 7 resolved).
