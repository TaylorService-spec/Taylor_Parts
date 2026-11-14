# Sign-in recovery (REC): second-Owner resilience, the ruled break-glass ceremony, and its emergency exception

**Status: DESIGN FOR THE OWNER. DOCS ONLY.** No code, migration, capability, grant, authentication, MFA, session, Rules or configuration change. No recovery has been run, and nothing here is activated. No credential, secret, key or token was read, searched for or handled.
**Issued:** 2026-11-14 (America/Phoenix). **Base:** `origin/main` `ee850d02`. **Lane:** A15 (work queue), REC.
**Authority:** the Owner's REC rulings of 2026-10-20 (`docs/governance/owner-commercial-spec-rulings-2026-10-20.md`, "REC Account recovery", merged in #2182). Ruling **OD-1: "Design both secondary-Owner resilience and an independent emergency operator recovery ceremony."** Ruling OD-6 adds: "Prepare an emergency-exception design separately." The Owner also directed (D1, 2026-11-13) that recovery is designed before go-live.
**Builds on:** the REC specification in PR #2174 (`docs/architecture/rec-sign-in-recovery-design.md`, held). That document's threat model (§4), ceremony (§6) and unlinked-Principal analysis (§7) are not repeated. Where it and the 2026-10-20 rulings differ, the rulings win. This note adds what the specification left undesigned.
**Decision level:** every open choice is an **OWNER DECISION** (`R-n`) with a recommendation. This is a security and authorization-model change (`docs/DelegationCharter.md` §8.3), so nothing is built until the Owner decides, and nothing is activated until the Owner's final security-policy acceptance (rulings §7 item 1).

## 0. At a glance

| Layer | What it is | Status after this note |
|---|---|---|
| **A. Second Owner** (prevention) | A second real person holds the protected Owner Role and an enabled sign-in. Either Owner can reset the other through Administration, using the existing Owner-to-Owner path | **Designed here (§2)**. Needs a new Owner lifecycle operation; today nothing can appoint a second Owner |
| **B. Break-glass ceremony** (guaranteed floor) | Custodian signature + operator execution + recoverer-held secret + delay + notices | **Ruled** 2026-10-20 (§3 records the ruled shape against #2174 §6) |
| **C. Emergency exception** | A shorter delay under stricter conditions, for when 24 hours is too long | **Designed here (§4)**, provisional values only |
| **D. Succession** (an Owner who is permanently gone) | Not a recovery. No one is recovering their own account | Out of the ceremony. **Owner + counsel (R-9)** |

The order of use: a second Owner when one exists, the ceremony when none can act, the emergency exception only under its own conditions. Firebase production break-glass stays the floor until B is built, drilled and accepted (#2174 OD-14).

## 1. What the code does today (verified at `ee850d02`)

| Fact | Where |
|---|---|
| The protected Owner is never appointed or removed by role administration. Any attempt is refused with `PROTECTED_OWNER_MEMBERSHIP` | `refuseProtectedOwnerMembership`, `functions/src/adminPolicy/policyCommands.ts:2009` |
| Owner succession "is a separate governed lifecycle operation that does not exist yet" | `policyCommands.ts:2006`, `administrationAuthority.ts:171` |
| `bootstrapFirstOwner` works only while the tenant has zero Owners, and never adds a second | `tenantBootstrap.ts:337-389` |
| A login held by an Owner or Administrator is administered only by an Owner in that tenant, never by its holder (`SELF_ADMINISTRATION`) | `eosLoginService.ts:1352`, `targetAdministrable :1445`, `holdsProtectedAdministeringRoleIn :1465` |
| Reset, unlock and MFA reset of a login need `admin.credentialReset.initiate`. In nonprod the EOS grants give it to `owner`, `admin` and `generalManager` (R2.6.2 snapshot `evidence/security/grid-apply/live-after-r262.json`). So **in nonprod an Owner can already reset, unlock or reset the MFA of another Owner**, with no new credential code. The legacy Firebase permission catalog marks the key `active: false` and excludes it from environment activation. That governs only the Firebase path, but any other environment needs the EOS grant before Layer A gives recovery there (§6 gate) | `LOGIN_ADMINISTRATION_OPERATIONS :2073-2083`, `requireCredentialAdministration :1340`; `functions/src/access/permissionCatalog.ts:1113-1116`, `environmentCapabilityOverrides.ts:31-33` |
| The last enabled login held by an Owner **or** Administrator cannot be disabled or retired. It counts both roles together, so it does **not** protect the last Owner login while an Administrator login exists | `requireNotLastAdministratorLogin :1497` |
| `bootstrapFirstOwner` refuses a target who holds the protected Administrator Role (#223) or would hold an owner-excluded capability (Owner ruling A) | `refuseFirstOwnerTarget`, `tenantBootstrap.ts:309-326` |
| The protected-Owner check (secondary-approval exemption seam) works **per Principal**: any enabled Principal with the protected Owner Role and exactly one active link to an access-eligible Employee qualifies | `eos_policy.protected_owner_employee`, migration `1764716000000`; TypeScript twin `functions/src/access/secondaryApprovalExemption*` |
| `login_tickets.purpose` allows only `enrollment` and `reset` | migration `1764550000000_eos-native-login.sql:97` |
| Every attempt reserves a failure before it is checked, and the count clears only on a fully successful sign-in. Since R2.6.1 (#2236, A16), a correct password with a wrong authenticator code does not clear it. Anyone who knows a login name can still hold it locked (residual D-4), which pushes a sole Owner toward recovery | `eosLoginService.ts:389-431, 544, 604` |

**Finding F-10 (new).** The secondary-approval exemption seam qualifies *every* protected Owner. Appointing a second Owner therefore also hands that person the platform-wide exemption from second-person approval (the 2026-10-20 Owner policy override). That may be intended, but it was ruled when there was one Owner. It is decision **R-4**.

**Finding F-11 (new).** A stolen Owner session can do everything an Owner can, including any future "appoint an Owner". A second Owner appointed by an attacker survives a later recovery of the real Owner. Appointment therefore needs friction that a recovered Owner will see (§2.3, R-10).

## 2. Layer A: a second Owner (new design)

### 2.1 Form (R-1)
A **living** second Owner: a real, trusted person who holds the Role and signs in normally. The dormant sealed Owner of #2174 option 1A-ii is **not** recommended. It is a standing, rarely watched target, and its envelope custody becomes its own recovery problem.

### 2.2 Who can be appointed (R-3)
The target, at proposal **and** at acceptance:
- is an enabled Principal with an active membership in the tenant;
- has exactly one active link to an access-eligible Employee (the same rule as the seam), so the protected-Owner check qualifies them from the first minute;
- has an **enabled** EOS login with a **confirmed authenticator** (not `pending_enrollment`). A second Owner who cannot sign in gives no resilience;
- is not already an Owner, and is not the proposer;
- does **not** hold the protected Administrator Role (Owner and Administrator are distinct, #223), and would not hold an owner-excluded capability with the Owner Role (Owner ruling A). These are the existing `refuseFirstOwnerTarget` checks, reused.

Every condition is checked again at completion, under the governance lock.

### 2.3 The operation: propose, accept, take effect
New protected lifecycle actions. They are **not** capability-gated: only a verified protected Owner may run them, exactly like the existing protected-Owner rule. They register no capability and need no grant. An Administrator, or any other role, is refused with zero trace.

| Step | Who | What happens |
|---|---|---|
| **Propose** `owner.lifecycle.propose` | A protected Owner, with a reason, after **fresh re-authentication** (password and authenticator, within the last 5 minutes, not just a live session) | A proposal row `PROPOSED` is created, expiring in 72 hours. Notice to every enabled Owner and Administrator. Audit row. **While the tenant has one Owner**, the proposal also needs one custodian's callback to that Owner's number of record (§3.1) confirming they made it, before it can be accepted. This is the guaranteed observer when a sole Owner's session is stolen (R-2) |
| **Accept** `owner.lifecycle.accept` | The appointee, signed in with their own fresh re-authentication | The proposal becomes `ACCEPTED`, effective after **24 hours** (R-2). Notices again |
| **Cancel** | The proposer, any other Owner, the appointee, any custodian, or any Administrator | `CANCELLED` (terminal), with notice to every Owner. Administrators may cancel but never propose or accept. To stop one hostile Administrator blocking a second Owner forever, a second Administrator cancellation for the same appointee within 30 days is refused; an Owner or custodian cancellation is never limited |
| **Complete** `owner.lifecycle.complete` | The appointee or the proposer, at any time between the end of the delay and 72 hours later. This is the only entry point; no other request activates the Role | In one transaction under the governance lock: every §2.2 condition is re-checked, then one active, global, protected Owner Role assignment is written with provenance `owner-lifecycle:<proposalId>`. Audit row and notice. If a condition fails, the proposal becomes `VOIDED` with the reason. Not completed in time, it becomes `EXPIRED` |

The appointee's consent proves the person exists, agrees, and has a working sign-in. The delay, the notices and, for a sole Owner, the custodian callback give a 24-hour window to stop an attacker's appointment (F-11).

### 2.4 Removing an Owner (R-5)
`owner.lifecycle.remove`, run by **another** protected Owner with a reason and fresh re-authentication.
- **Delay.** Removal takes effect after **24 hours**, with notice to every Owner and Administrator. The target Owner (by signing in) or any custodian can cancel it. Immediate removal needs one custodian's attestation of suspected compromise, recorded by reference. Without that delay, a hostile second Owner could remove the real Owner during a lockout and become sole Owner, and nothing in EOS could restore the Role (§5).
- **Refused** while the target is locked or has an open recovery request, so a lockout cannot be used to remove someone who cannot answer.
- **Never the last Owner**: refused unless at least one *other* protected Owner keeps an enabled, MFA-confirmed login. This is a new guard; `requireNotLastAdministratorLogin` does not provide it (§1).
- **Relinquish.** An Owner may give up their own Role under the same last-Owner rule. It takes effect immediately, because the person is acting for themselves.
- **Effect.** The removed person keeps their login and Employee link and loses only the Role. Their open proposals are cancelled.
- **No restore path.** A wrongly removed Owner is re-appointed by a remaining Owner through §2.3. Where no honest Owner remains, it is succession (§5).

### 2.5 What a second Owner changes
- **Recovery**: either Owner resets, unlocks or resets the MFA of the other through Administration, where the environment grants `admin.credentialReset.initiate` to `owner` (nonprod does, §1). These are the existing commands, audit and notices. No ceremony is needed.
- **Administrator lockouts**: they now have two Owners able to handle them (finding F-3 in #2174).
- **Exemption (R-4)**: the second Owner is exempt from second-person approval like the first (F-10), unless the Owner rules otherwise.
- **Two Owners**: one Owner approving the other Owner's request is an ordinary two-person approval, recorded with no exemption basis.

### 2.6 Schema and build (after decisions)
- One table, `eos_policy.owner_lifecycle_proposals`: kind (appoint or remove), tenant, target Principal, proposer, reason, states with timestamps, cancel and void actor and reason, custodian attestation reference. Append-only state history goes to `audit_events`. An operator-applied migration, because migration writes from agent sessions are refused (count-pinning tests listed in the build PR).
- The protected actions: propose, accept, complete, cancel, remove and relinquish. The `PROTECTED_OWNER_MEMBERSHIP` refusal stays: ordinary role administration still cannot touch the Owner Role.
- **Fresh re-authentication** (password and authenticator within the last 5 minutes). It does not exist today and is new build, with its own tests (a live session alone is refused; a stale step-up is refused).
- A notice surface shared with the ceremony (#2174 OD-11): Users screen and sign-in banner for every Owner and Administrator, kept for 7 days.
- Tests (sandbox, synthetic data):
  - a non-Owner or an Administrator is refused at every step;
  - proposing yourself is refused;
  - an unlinked, unenrolled or disabled target is refused, and so is a protected Administrator or a target that would hold an owner-excluded capability, at proposal and at completion;
  - acceptance without fresh re-authentication is refused;
  - an expired, cancelled or voided proposal never takes effect;
  - the role is not active before the delay or before `complete`, and only `complete` activates it;
  - a sole-Owner proposal cannot be accepted without the custodian callback;
  - a second Administrator cancellation for the same appointee within 30 days is refused;
  - removal waits 24 h unless a custodian attests compromise, and is refused while the target is locked or has an open recovery request;
  - removing the last Owner, or the last Owner with an enabled, MFA-confirmed login, is refused;
  - relinquishing is refused when no second MFA-confirmed Owner exists;
  - the seam qualifies the new Owner exactly as R-4 rules;
  - no output, log or audit row carries a credential.

## 3. Layer B: the break-glass ceremony as ruled

The mechanics are #2174 §6 (parties, states, steps, operator properties I-1 to I-7). The rulings settle these points:

| Ruled 2026-10-20 | Effect on the ceremony |
|---|---|
| OD-1 both layers | The ceremony is the floor, whether or not a second Owner exists. When one does, see R-6 |
| OD-4 separation | A custodian authorizes and the operator executes. The recoverer never authorizes their own recovery, even as operator |
| OD-5 no automatic custodians | The custodian register ships **empty**. The ceremony refuses every request until the Owner names custodians, each registered by the operator with their public key |
| OD-6 provisional 24 h delay, 72 h expiry | Stored as configuration marked `provisional`, read by the commands. The ceremony is **inactive** (every command refuses with `RECOVERY_NOT_ACTIVATED`) until the Owner's final security-policy acceptance |
| OD-9 two channels + attestation | One live channel and one **trusted callback** to the number of record, attested by the custodian. The callback procedure is documented and drilled (§3.1) |
| OD-10 revocation only on execution | Every session, refresh token, open ticket, authenticator and recovery code is revoked **only** when an emergency recovery executes successfully. A request, approval, cancellation or expiry revokes nothing. Routine resets are unchanged (#56 D-ROUTINE-REVOKE) |

### 3.1 The trusted callback (OD-9 detail)
- **Number of record**: held **outside EOS**, on the custodian register (paper or the custodian's own device). It is recorded when a custodian or recoverable person is registered, and changed only with two custodians present. EOS stores no phone number, identity document or personal data for this.
- **Callback**: the custodian ends any inbound call and dials the number of record themselves. They never use a number given during the request. They confirm a fact agreed at registration, then record an attestation reference (who, when, which two channels). The reference is stored in EOS; the content is not.
- **Drill**: run at activation, then yearly and after any custodian change. It uses a synthetic recoverer in the sandbox and an actual callback. A failed drill blocks activation.

### 3.2 When a second Owner exists (R-6)
For an **Owner** target, a ceremony request is refused while another protected Owner holds an enabled, MFA-confirmed login, **unless** the custodian attests that the other Owner is unavailable or suspected compromised. The attestation is recorded by reference and the other Owner gets the same notices. This keeps the ordinary path ordinary without trapping the company when both Owners are affected.

### 3.3 Post-recovery review (R-10)
The execute command's identifiers-only output, and a notice shown to the recovered person at first sign-in, list what happened to their tenant's governance since their last successful sign-in (at most 30 days):
- Owner proposals, acceptances and removals;
- Administrator staffing;
- credential acts on Owner and Administrator logins.

This is how a recovered Owner finds an attacker's appointment (F-11). It is read-only, and it locks nothing.

## 4. Layer C: emergency exception (new design, provisional)

**When.** The 24-hour delay is too long: for example, the sole Owner is locked out while payroll, an inspection or a security incident needs Owner authority now.

| Condition | Recommendation (R-7) |
|---|---|
| Who may need it | Owner targets only. Administrator recoveries take the ordinary delay, because an Owner can recover an Administrator in-product |
| When it applies | Only when **no** other protected Owner can act: none exists, or **both** emergency custodians independently attest that the other Owner is unavailable or suspected compromised |
| Approvals | **Two different custodians**, each doing their own two-channel verification and each signing. The operator's key and the recoverer's key never count |
| Delay | Shortened to **2 hours**, never zero. A cancel stops it exactly as in the ordinary ceremony |
| Reason | One of a fixed list of reason codes (security incident, payroll or legal deadline, safety), plus free text |
| Frequency | At most one **executed** emergency recovery per target per 30 days. Requests, approvals, cancellations and expiries do not count, so a false emergency cannot use up the window. A second executed emergency inside the window takes the ordinary delay |
| Effects | Identical to an ordinary execution: full revocation (OD-10), forced MFA re-enrollment, the same notices plus an `EMERGENCY` marker, and the post-recovery review |
| After | Each custodian confirms in the evidence record within 7 days that the emergency was genuine. A missing confirmation is reported to the Owner; it does not undo the recovery |

With one named custodian, there is **no** emergency exception; the ordinary delay applies. Every value in this table is provisional, like OD-6, and inactive until final acceptance.

## 5. Layer D: an Owner who is permanently gone (R-9)

Death, incapacity or departure of a sole Owner with no second Owner is **succession**, not recovery: the person whose account it is will never redeem a secret. The ceremony never appoints a new Owner, and `bootstrapFirstOwner` stays limited to tenants with zero Owners. Recommendation: the Owner and counsel decide on a separate legal procedure, such as a documented successor letter held with counsel. Only after that procedure exists should EOS get an operator command for it. That command would be built on the ceremony's parties and audit, with a longer delay. The practical prevention is Layer A: name a second Owner.

## 6. Build order and gates (after decisions)

1. Layer A schema, operations, fresh re-authentication, notice surface and tests (§2.6). This is independent of the ceremony and gives the most resilience first. A sole Owner's first appointment needs one named custodian (the §2.3 callback).
2. Ceremony schema (the `recovery` ticket purpose, a request table, a custodian register, provisional configuration), commands, the `recovery` validity rule (#2174 F-4), and the post-recovery review.
3. Emergency exception on the same commands.
4. Offline recoverer and custodian helpers (#2174 §9).
5. Sandbox drill with synthetic data: everything in #2174 §9, plus the §2.6 tests, the R-6 refusal, a two-custodian emergency, the 30-day limit, the callback drill and the post-recovery review.
6. **Gates that are not engineering's:** the custodian names (OD-5); in any environment other than nonprod, the EOS grant of `admin.credentialReset.initiate` to `owner`, without which Layer A gives no recovery there (§1); the Owner's final security-policy acceptance, any production identity activation (OD-10), and keeping Firebase break-glass until acceptance (#2174 OD-14).

Not in this lane: email (D-5), the production EOS API (D-1), splitting database ownership (#2174 F-8), and A13's "make a person login-ready" operation (PR #2238). A13 is the in-product way to give the future second Owner a linked, enrolled login (§2.2).

## 7. OWNER DECISIONS

| R | Decision | Recommendation |
|---|---|---|
| R-1 | Form of the second Owner | A living second Owner only. Do not build the dormant sealed Owner |
| R-2 | Appointment friction | Proposer and appointee both re-authenticate. Appointee consent required. With one Owner, a custodian callback confirms the proposal. A 24 h delay after acceptance, with notices, then an explicit `complete`. Cancellable by either party, any other Owner, any custodian or an Administrator (a second Administrator cancellation within 30 days refused) |
| R-3 | Who may be appointed | Linked to exactly one access-eligible Employee, with an enabled login and a confirmed authenticator. Not a protected Administrator, and no owner-excluded capability. Checked at proposal, acceptance and completion |
| R-4 | Secondary-approval exemption for a second Owner (F-10) | Each protected Owner is exempt, as the seam already behaves. One Owner approving the other's request is an ordinary two-person approval |
| R-5 | Removing an Owner | By another Owner, with re-authentication, after a 24 h delay cancellable by the target or a custodian (immediate only with a custodian's compromise attestation). Refused while the target is locked or being recovered. Never leaves no Owner with an enabled, MFA-confirmed login. Self-relinquish under the same rule. No restore path |
| R-6 | Ceremony when a second Owner exists | Refuse an Owner-target request unless a custodian attests that the other Owner is unavailable or suspected compromised |
| R-7 | Emergency exception | Owner targets only, no other Owner able to act (both custodians attest), two different custodians, a 2 h delay (never zero), reason codes, at most one executed emergency per 30 days. Provisional and inactive |
| R-8 | Trusted callback | The number of record is held outside EOS on the custodian register, changed only with two custodians. The custodian dials it themselves. Drilled at activation, yearly and on any custodian change |
| R-9 | An Owner permanently gone | Not a recovery. A separate procedure decided by the Owner and counsel. The ceremony never appoints an Owner |
| R-10 | Post-recovery review | Show the recovered person every Owner lifecycle, Administrator staffing and privileged credential act since their last good sign-in (at most 30 days). Read-only |

Still open from #2174 and not re-decided here: OD-2, OD-7, OD-8, OD-11 to OD-17. This note is the design OD-3 asked for. The REC register (§5) says OD-7, OD-8, OD-13 and OD-16 stay design-only with no activation. The custodian names (OD-5) and final security-policy acceptance remain the Owner's.

## 8. Not done here
- No code, migration, capability, grant, Rules, configuration or production change. `docs/DECISIONS.md` is not edited; a decision record follows the Owner's rulings on R-1 to R-10.
- Nobody is named as a custodian, second Owner or successor.
- Whether the sole Owner and the operator are the same person in production is not assumed. Every layer holds either way, because the custodian, not the operator, is the second party.
