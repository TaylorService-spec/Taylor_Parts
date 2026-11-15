# Sign-in recovery for EOS logins: sole-Owner break-glass and Principals with no Employee link

**Status: DESIGN FOR THE OWNER. DOCS ONLY.** No code, authentication, MFA, session, Rules or configuration is changed by this document. No reset has been run. No credential, secret, key, `.env`, askpass or token file was read, searched for or handled to write it.
**Issued:** 2026-10-20 (America/Phoenix). **Base:** `origin/main` `b3d09dc3`. **Lane:** REC (item R2 on the Firebase-exit critical path).
**Decision level:** every choice below is a numbered **OWNER DECISION** (`OD-n`) with a recommendation. A security or authorization-model change is an Owner boundary under `docs/DelegationCharter.md` §8.3, and credentials are Tier 3 (§2), so nothing here is built until the Owner decides.

Sources: `evidence/firebase-replacement-gap-map-2026-10-19.md` (recovery gaps, line 28), `evidence/firebase-replacement-matrix-2026-10-19.md` (lines ~179 and 194, R2), `evidence/B5-ACCEPTANCE-MATRIX.md` (Identity row). Code and governance read: `functions/src/eosAuth/eosLoginService.ts`, `eosLoginHttp.ts`, `functions/migrations/1764550000000_eos-native-login.sql`, `functions/src/adminPolicy/{policyCommands,tenantBootstrap}.ts`, `docs/architecture/eos-native-identity.md`, `docs/assessments/{auth-modernization-architecture,admin-password-reset-current-state}.md`, `docs/governance/privileged-approvals-inventory-b2.md`, `docs/DECISIONS.md` (#52, #54, #56, #223), `docs/DelegationCharter.md`, `docs/operations/{auth-pr-4-operator-workflow,eos-human-login-cutover-runbook,legacy-admin-bootstrap-procedure}.md`.

## 0. Decisions at a glance

| OD | Decision | Recommendation |
|---|---|---|
| OD-1 | Recovery model for a sole Owner | Layered: an operator break-glass ceremony as the guaranteed floor, plus a second Owner as prevention when a suitable person exists |
| OD-2 | What the ceremony covers | Owner and Administrator logins, plus the unlinked-human case in OD-15. Everyone else keeps in-product, administrator-issued codes |
| OD-3 | Commission an Owner succession and second-Owner design | Yes, as its own lane. No second Owner can be appointed in-product today |
| OD-4 | The two-party rule | A custodian's signature plus an operator's database execution. The custodian is never the person being recovered |
| OD-5 | Who the custodians are | At least two named people, neither holding database access, public keys on a register. The Owner names them |
| OD-6 | Delay and cancellation | 24 hours between approval and execution. Cancellable by the account holder, any other enabled Owner or Administrator, any custodian or the operator |
| OD-7 | Where the reset secret comes from | The recovering person generates it on their own device; only its SHA-256 digest is registered. No one else ever sees it |
| OD-8 | Sealed standing recovery code stored at enrollment | Not in v1. Generate at recovery time. Never a standalone bypass |
| OD-9 | Identity-verification standard before approval | Two independent channels, one live and one callback to the number of record, attested by the custodian |
| OD-10 | Revocation inside a break-glass | Revoke every session, ticket, authenticator and recovery code at execution. This is a named exception to #56 D-ROUTINE-REVOKE |
| OD-11 | Notification channel in v1 | In-product notice to every other enabled Owner and Administrator, a recorded callback to the person, and a security event. Email stays under D-5 |
| OD-12 | Audit actor for operator-executed acts | Operator handle plus custodian key id in the audit payload, following the `bootstrapFirstOwner` precedent. No pseudo-Principal |
| OD-13 | Schema change for the ceremony | Approve a `recovery` ticket purpose and a recovery-request table, applied by the operator because migration writes have been refused before |
| OD-14 | Interim safeguard | Keep Firebase production break-glass until the ceremony is built, drilled in the sandbox and accepted. Do not disable Firebase in a production role before that |
| OD-15 | Which Principals without an Employee link may hold a human login | Real people must be linked. Service Principals never get a password. Do not relax `requireEmployeeLink` |
| OD-16 | An unlinked human Principal, for example the Administrator persona | Link an accountable Employee record if the person is a real employee. Otherwise reset through the ceremony with the Owner's attestation recorded |
| OD-17 | Recovery of a service Principal | Credential rotation by the operator under a separate runbook. Never a password and never an in-product reset |

## 1. What is being decided

Two gaps block disabling Firebase sign-in in any future production role.

1. **Sole-Owner break-glass.** An Owner or Administrator login is administered only by an Owner, and never by itself. A sole Owner who loses the password or the authenticator has no in-product recovery and no operator tool.
2. **A Principal with no Employee link.** The reset path presumes one linked Employee, so a Principal without one (an Administrator persona, a service Principal) cannot be given a reset.

This document specifies options for each, recommends one, and says exactly what the recommended shape does to audit, notification, MFA, sessions and secret custody. It does not choose names (custodians, delay owners) on the Owner's behalf.

## 2. What the code does today

| Fact | Where |
|---|---|
| Every credential act requires the operation's governed capability, a stated reason, a target in the actor's tenant, and **not self** (`SELF_ADMINISTRATION`) | `eosLoginService.ts:1320-1340` |
| A target holding the protected Owner or Administrator Role (in any tenant) is administered only by an actor who holds the Owner Role in that tenant | `targetAdministrable` `:1426-1450`, `holdsProtectedAdministeringRoleIn` `:1446` |
| `issueLoginReset` is refused with `EMPLOYEE_LINK_REQUIRED` unless the Principal is linked to exactly one Employee. It revokes nothing | `:1832-1845`, `requireEmployeeLink` `:1468` |
| `provisionLoginAccount` and persona enrollment call the same link check | `:1559`, `:1759` |
| `resetLoginMfa` removes every factor, supersedes the recovery codes and revokes every session. It has **no** link check | `:1881-1890` |
| `unlockLoginAccount`, `setLoginAccountStatus` and `revokeLoginSessions` also have no link check | `:1865`, `:1846`, `:1873` |
| The last enabled Owner or Administrator login cannot be disabled or retired | `requireNotLastAdministratorLogin` `:1478` |
| A reset or enrollment ticket is a SHA-256 digest only. Using it re-runs the issue-time authority check against the **issuer, now**, and refuses if the issuer no longer holds authority over that target | `consumeTicket` `:800-870` |
| Using a reset ticket sets the password, raises the credential version and revokes every session. It does not touch MFA | `:855-870` |
| Recovery codes (ten, single-use) substitute for the authenticator **after** the password step. They cannot reset a password or mint more codes | `completeMfaLogin` `:554`, `eos-native-identity.md` §3(c) |
| An `mfa_required` account with no factor gets a session that reaches `/auth/*` only, until it enrolls. Whoever redeems the code and enrolls first holds the account | `eos-native-identity.md` §3(c) last bullet |
| The protected Owner is not appointed or removed by ordinary role administration. Owner succession "is a separate governed lifecycle operation that does not exist yet" | `policyCommands.ts:1010,1433,2003`, `tenantBootstrap.ts:340` |
| `bootstrapFirstOwner` works only while the tenant has **zero** Owners, is operator-run, and records `bootstrap:first-owner:<operator>` as the grantor | `tenantBootstrap.ts:354` |
| There is no email self-service (D-5), no email channel, and no EOS production API. Production recovery is still Firebase email reset | `eos-native-identity.md` §5, matrix line 194 |
| Operator tools already follow one pattern: dry run by default, a named environment, no flag that accepts a credential, secrets written only to an absolute path outside the repository (mode 0600) | `functions/scripts/enrollPersonaLogins.js` header |
| The AUTH-PR-4 production gate already uses a time-bound, signed confirmation from a named confirmer who is not the executor | `docs/operations/auth-pr-4-operator-workflow.md:52` |

## 3. Findings that shape the design

- **F-1. The sole-Owner gap is wider than "both lost".** Losing the **password alone** strands a sole Owner once their last session ends (idle 12 h, absolute 7 d). Recovery codes only stand in for the authenticator, and they are asked for after the password. Nothing in-product resets an Owner's password except another Owner.
- **F-2. "Require a second Owner" is not a policy toggle.** The protected Owner cannot be appointed through role administration, and `bootstrapFirstOwner` refuses once any Owner exists. A second Owner needs a new lifecycle operation, which is also what Owner succession (departure, incapacity) will need.
- **F-3. The Owner is a single point for all privileged-credential recovery.** An Administrator cannot reset another Administrator or an Owner, and Owner and Administrator are distinct authority types (#223). So every Administrator lockout also lands on the one Owner.
- **F-4. An operator-issued ticket cannot pass today's consume check.** A ticket is worth its issuer's authority at the moment of use. An operator is not a Principal holding the Owner Role, so a ticket they issue would die on use. The ceremony needs a new ticket purpose whose validity comes from the ceremony record (approvals valid, not cancelled, not expired), not from a live Principal. `login_tickets.purpose` has a CHECK constraint limited to `enrollment` and `reset`, so this is a schema change.
- **F-5. The MFA half already exists.** `resetLoginMfa` already does what a recovery needs for the authenticator (factors removed, recovery codes superseded, sessions revoked). The missing pieces are the authority to run it on a sole Owner and a safe way to hand over the password reset.
- **F-6. The Employee-link rule is deliberate.** #56 denies "missing Employee linkage", and the code states why: a login is for a **person**, and a service or fixture Principal gets no password. Recovery for unlinked Principals must keep that purpose (a named, accountable human at the other end of the handoff), not just remove the check.
- **F-7. The trust-on-first-use window is the crux.** Resetting MFA is easy. The risk is the moment someone redeems the reset secret and enrolls the first authenticator. Whoever holds the secret then **is** the Owner. Secret custody decides everything else.
- **F-8. The database is a root of trust above the application.** Anyone with write access to the policy database can already do what any break-glass does. No application design removes that. What a design can do is make the audited, multi-party path the sanctioned one, so that any other path is both unnecessary and conspicuous. Section 5 states what that does and does not buy.
- **F-9. Retiring Firebase removes the only break-glass that exists.** Today the recovery floor is the Firebase Console / Admin SDK procedure (auth-modernization §8; the break-glass identities in #52). It disappears when Firebase sign-in is disabled in a production role.

## 4. Threat model (shared by every option)

| Threat | What it looks like here |
|---|---|
| Account takeover through the recovery path | An attacker obtains whatever the recovery path accepts and becomes the Owner, who has full governance authority |
| Insider abuse | A single custodian, operator or administrator quietly recovers an account they do not own |
| Social engineering | Someone persuades a custodian or operator that they are the locked-out Owner, or that an emergency justifies skipping the delay |
| Lockout denial of service | Anyone who knows a login name can lock the account (five guesses per 15 minutes; the residual risk recorded under D-4 in `eos-native-identity.md`), which pushes the Owner toward the break-glass path |
| Replay and stale approval | An old approval or ticket is reused after the situation changed (account disabled, authority changed, person left) |
| Silent compromise | The legitimate Owner never learns that their account was recovered |
| AI in the credential path | An AI session sees, stores or transmits a password, code, key or ticket |

Design rules applied throughout: nobody can bypass MFA alone; a recovery always leaves a trail that the legitimate holder and the other administrators can see; a secret never exists on a machine an AI session can read; and the recovery costs time, so it cannot be done in one unnoticed minute.

## 5. Gap 1: sole-Owner break-glass

### Option 1A: a second Owner (prevention)

A second human holds the Owner Role and an enabled login. The existing path already works: an Owner administers another Owner (proof L4), so the second Owner resets the first through Administration. Two variants:

- **1A-i. A living second Owner.** A real, trusted person holds the Role day to day.
- **1A-ii. A dormant sealed Owner.** A second Owner login whose password and authenticator seed are generated by an operator tool (the `--credentialsOut` pattern), split into two sealed envelopes held by two different people, and never used except to recover the first. Any sign-in by this account raises a notice to every administrator.

| | |
|---|---|
| Threat model | 1A-i adds a second person with ultimate authority, which is a business and governance decision as much as a security one. 1A-ii creates a standing, valuable target that is deliberately rarely watched. In both, a second Owner can also be socially engineered into resetting the first |
| Audit | Existing: `issueLoginReset`, `resetLoginMfa` and `revokeLoginSessions` write `audit_events` naming the acting Owner and the reason, plus `authentication_events` |
| Notification | None built in. A reset of an Owner is visible only in the audit trail and the account's recent activity. Needs OD-11 |
| MFA re-enrollment | Existing: the second Owner runs `resetLoginMfa`, then `issueLoginReset`. The first Owner redeems the code, sets a password and enrolls again |
| Session revocation | Existing: `resetLoginMfa` revokes all sessions. A routine reset revokes none until the code is used (#56) |
| Holds the secret | 1A-i: the second Owner's own password and authenticator. 1A-ii: two custodians each hold half of the sealed material. The hand-over code goes from the second Owner to the first in person or by phone |
| Operator without AI | 1A-i needs no operator. 1A-ii needs the operator to generate and seal the credentials once. The tool writes only to an absolute path outside the repository, mode 0600, and prints identifiers only. The AI reviews the tool's code and never runs it |
| Build size | Large and not yet designed: the Owner succession lifecycle (F-2). Nothing else changes |
| Residual | Both Owners can be lost together. A company with one trusted person has no second Owner to name. 1A-ii's envelope custody becomes its own recovery problem |

### Option 1B: sealed offline recovery codes issued at enrollment

At Owner enrollment the system issues a long one-time recovery code, printed once and sealed in a safe. Redeeming it resets the account.

| | |
|---|---|
| Threat model | Whoever holds the envelope can take over the account with no other factor. That is the single-party MFA bypass the brief rules out. Theft, a copied envelope, or an insider with safe access all end in takeover, and the legitimate Owner may never know |
| Audit | A new event on redemption would be needed. Today's recovery codes record `RECOVERY_CODE` as the login method only |
| Notification | None unless added |
| MFA re-enrollment | The code would have to force it. Today a recovery code logs in but does not remove the authenticator |
| Session revocation | Would need to be built. Today it is not part of a recovery-code login |
| Holds the secret | The sealed envelope, plus the system's digest of it. The code itself is generated once, so something has to print it. That is the point where an AI must never be |
| Operator without AI | The code must be generated and printed by a tool that writes to a sealed medium and prints nothing. Possible, and the same discipline as 1A-ii |
| Build size | Medium: a new credential type, table, redemption route and tests |
| Residual | The weak point is physical custody. Taken alone it fails the "nobody bypasses MFA alone" rule |

**Verdict:** reject as a standalone bypass (OD-8). The useful part of 1B, a secret only the recoverer holds, is kept in the ceremony below as a **recoverer-held secret**, where it is one necessary part and not the whole key.

### Option 1C: operator break-glass with two humans, a time delay and notification

A sanctioned, operator-run procedure that recovers an Owner or Administrator login only when a custodian approves it, a delay elapses, and the people who could object have been told. Specified in section 6.

| | |
|---|---|
| Threat model | Takeover needs the custodian's signing key **and** operator database access **and** the recoverer's secret **and** 24 hours of silence. A single insider cannot finish it. Social engineering must defeat the identity standard (OD-9) and survive the delay and the notices. The residual is a database owner acting outside the procedure (F-8) |
| Audit | One governed `audit_events` row per state change, plus `authentication_events`, naming the request id, the target, the operator handle, the custodian key id, the reason, the verification attestation reference and every timestamp. Append-only |
| Notification | At request, at approval and at execution: an in-product notice to every other enabled Owner and Administrator, a security event, and a recorded callback to the person (OD-11) |
| MFA re-enrollment | Forced. Execution removes all factors and recovery codes (the `resetLoginMfa` semantics), keeps `mfa_required`, and the redeemed session is `/auth/*`-only until a new authenticator is confirmed and ten new recovery codes are shown once |
| Session revocation | All sessions, refresh tokens and open tickets are revoked at execution (OD-10) |
| Holds the secret | The **recoverer** holds the reset secret and generated it on their own device. The database holds only its digest. The custodian holds a signing key. The operator holds the database connection. No one holds another's secret |
| Operator without AI | See section 6.4. The operator workstation or shell holds the connection details already. The script has no input for a secret and prints none. The AI writes and reviews code and reads only sanitized evidence |
| Build size | Medium: a request table, a `recovery` ticket purpose, a validity rule for it, three operator commands, a signature check, notice surfaces, and a sandbox drill |
| Residual | A database owner can act outside the ceremony (F-8). In a one-person company the Owner may also be the operator, so the custodian is what makes it two people. Notice reach is limited to people with logins and no email channel |

### Option 1D: out-of-band identity verification

A procedure, not a mechanism: before anything is approved, a human confirms that the person asking is the Owner, through channels the attacker cannot control.

| | |
|---|---|
| Threat model | Defeats social engineering by an outsider. Does not stop an insider who can fake the check, which is why it needs a second human to attest and a record |
| Audit | The attestation is recorded by reference (who verified, when, by which two channels). The identity evidence itself is never stored in EOS |
| Notification | Itself a notification: a live call to the number of record tells the person, and a stranger asking would be refused |
| MFA / sessions | None. It authorizes; it does not execute |
| Holds the secret | None |
| Operator without AI | Entirely human. An AI is not part of it |
| Build size | None for the procedure. A field in the request for the attestation reference |
| Residual | A procedure is only as good as the people following it. Not a control on its own |

**Verdict:** mandatory precondition of 1C (OD-9), not an alternative to it.

### Comparison and recommendation

| | Nobody bypasses MFA alone | AI never in the credential path | Works when the Owner is gone entirely | Needs another Owner | Build |
|---|---|---|---|---|---|
| 1A second Owner | Yes (the second Owner is the other party) | Yes (1A-i); needs care to generate (1A-ii) | No, if both are lost | Yes | Large (succession) |
| 1B sealed codes alone | **No** | Needs a sealed printer tool | Yes | No | Medium |
| 1C ceremony | Yes (custodian + operator + recoverer + delay) | Yes, by construction | Yes | No | Medium |
| 1D verification | Not a mechanism | Yes | Not a mechanism | No | None |

**Recommendation (OD-1):** build **1C with 1D as its mandatory first step** as the guaranteed floor, because it works for a sole Owner with no second person holding the Role. Add **1A-i** as prevention when the Owner names a suitable person, which requires the succession design in OD-3. Keep the recoverer-held secret from 1B as part of 1C (OD-7) and reject 1B as a standalone bypass (OD-8).

## 6. The recommended ceremony (1C + 1D)

### 6.1 Parties

| Party | Holds | Never holds |
|---|---|---|
| **Recoverer**: the locked-out Owner or Administrator | A reset secret `S` they generate on their own device at recovery time | Any operator access |
| **Custodian**: at least two registered, any one may approve | A signing key on their own device or hardware key | Database access, `S`, the recoverer's password |
| **Operator**: the human who runs the scripts | The database connection and the operator environment, as today | `S`, the custodian's key |
| **EOS** | The digest of `S`, the request record, the custodian register (public keys) | `S`, any private key |

The recoverer may be the operator in a one-person company, but never the custodian. The custodian's signature and the delay are what keep the procedure from being a single-person act.

### 6.2 States

`REQUESTED` -> `APPROVED` (custodian signature verified) -> `WAITING` (delay running) -> `EXECUTABLE` -> `EXECUTED`
Terminal alternatives: `CANCELLED` (by the holder's sign-in, any other enabled Owner or Administrator, any custodian, or the operator) and `EXPIRED` (not executed within 72 hours after the delay ends). One open request per target.

### 6.3 Steps

1. **Claim.** On their own device the recoverer generates `S` (256 bits, in the existing `eospr_` ticket format) and its SHA-256 digest `H`. They keep `S` and give `H` to the operator by any channel, because a digest of a high-entropy secret reveals nothing usable.
2. **Verify (OD-9).** The custodian confirms identity through two independent channels, one live (in person or live video with someone who knows the person) and one callback to the phone number of record. The custodian records an attestation reference. No identity document or personal data is stored in EOS.
3. **Request.** The operator runs `recovery-request` (dry run first). It records target, reason, `H`, operator handle and the database role it ran as, and states `REQUESTED`. Notices go out (OD-11).
4. **Approve.** The custodian signs a canonical text (request id, target, `H`, not-before, expiry) with their key and submits the signature. The script verifies it against the register and rejects an unknown key, a signature by the operator's own key, a reused request id, or an expired text. State becomes `APPROVED`, then `WAITING` for the delay (OD-6).
5. **Wait.** Anyone entitled to cancel can. The holder signing in normally cancels it automatically.
6. **Execute.** After the delay the operator runs `recovery-execute`. In **one transaction** it re-checks that the request is `EXECUTABLE`, the signature still verifies, the delay has elapsed, nothing was cancelled, and the target's authority fingerprint is unchanged since the request. Then it revokes every session and refresh token, closes open tickets, removes every factor and recovery code, clears any lockout, sets `mfa_required`, inserts one `recovery` ticket with digest `H` (24 hour life), and writes the audit row and security event.
7. **Redeem.** The recoverer submits `S` and a new password on the reset route. The session they get reaches `/auth/*` only. They enroll a new authenticator and are shown ten new recovery codes once. The ticket is consumed.
8. **Close.** The operator pastes the script's identifiers-only output (request id, states, timestamps, event ids) into the evidence record. There is no secret anywhere to paste.

A target whose account is disabled, retired or still `pending_enrollment` is refused at request. Those are fixed by the existing administration acts, not by a recovery.

### 6.4 How the operator executes it without an AI handling a credential

These are properties of the build, listed so they can be checked in review and in the drill.

- **I-1.** The scripts take the environment name and the name of the variable that holds the connection, never the value (the `--databaseUrlEnv` pattern). The connection and any key are already operator-held and are not given to any AI session.
- **I-2.** The scripts have no flag, argument or file input that accepts a password, ticket, code or private key, and no option that prints one. The only secret-shaped input is `H`, a public digest.
- **I-3.** `S` and the custodian's private key exist only on the recoverer's and custodian's own devices.
- **I-4.** Ceremony execution needs only the database. It does not need the signing key or the factor keys: tickets are stored as digests, and removing a factor does not decrypt it.
- **I-5.** Dry run is the default. `--apply` is explicit. Each command prints identifiers, states and counts only.
- **I-6.** An AI session writes and reviews the scripts and the tests, runs them against the synthetic sandbox with generated fixtures, and reads only the sanitized output the operator chooses to share. It is not given the operator shell, the database connection or any account for a real person.
- **I-7.** The only place `S` ever travels is from the recoverer's browser to the reset route over TLS.

### 6.5 What this does not fix (F-8)

A person who owns the database can still write rows directly. The ceremony does not stop that. It removes the *need* for it, makes the sanctioned path produce a complete audit trail and notices, and means an unrecorded reset is by definition outside the procedure. A later step would be to split database ownership between two humans. It is out of scope here and not recommended now.

## 7. Gap 2: a Principal with no Employee link

### What is affected

`issueLoginReset`, `provisionLoginAccount` and persona enrollment require exactly one linked Employee. `resetLoginMfa`, `unlockLoginAccount`, `setLoginAccountStatus` and `revokeLoginSessions` do not check it. Two kinds of Principal are in play:

- **Unlinked humans:** an Administrator persona, or the Owner Principal in an environment that seeds it without an Employee (the nonprod Owner persona deliberately has none, and cannot authenticate).
- **Service Principals:** not people, and not meant to have a password.

### Option 2A: an accountable-person attestation in place of the Employee link

Allow `issueLoginReset` and provisioning for an unlinked Principal when an authorized administrator states, per act, who the accountable person is.

| | |
|---|---|
| Threat model | Weakest of the four. The link check is the control that a real, HR-known person receives the code (F-6). Replacing it with a typed statement lets any administrator mint a credential for any Principal they can name, including a service Principal |
| Audit, notice, MFA, sessions | Unchanged from today's reset |
| Holds the secret | The administrator who is handed the code, then the named person |
| Operator without AI | Not applicable (in-product) |
| Build | Small code change, but it alters the authorization model |

### Option 2B: link an accountable Employee record (data, not code)

For a real person, create or link the Employee record that represents them and establish the existing link. The reset path then works unchanged.

| | |
|---|---|
| Threat model | Preserves the control. The risk is a careless link made only to unblock a reset, which is why the link goes through the existing governed link command |
| Audit, notice, MFA, sessions | Unchanged. The link itself is audited by its existing command |
| Holds the secret | Unchanged |
| Operator without AI | The linking uses governed commands; the AI does not hold any credential for them |
| Build | None in the reset path. Needs a decision per person, and a check that creating the Employee does not feed payroll, scheduling or eligibility reports in the wrong way |
| Residual | Some people (the Owner persona in nonprod) are deliberately not Employees. For those, 2D |

### Option 2C: service Principals never receive a human login

Keep refusing passwords for service Principals, and say so as policy. Their "recovery" is rotating whatever machine credential they use, as an operator act.

| | |
|---|---|
| Threat model | Removes the target. No password means nothing to reset or phish |
| Audit | Rotation recorded in the operator evidence for that service |
| Holds the secret | The service's own credential store, per the environment's runbook |
| Operator without AI | Rotation is operator-run with the usual variable-name-only discipline |
| Build | None in the login system. A separate runbook per service credential |

### Option 2D: the ceremony covers an unlinked human

When linking is not appropriate, the Owner attests who the accountable person is, and the same ceremony as section 6 issues the reset. The custodian's identity check (OD-9) takes the place of the Employee link as proof that a named human receives the secret.

| | |
|---|---|
| Threat model | Equal to 1C. The accountable human is verified by two channels instead of inferred from a link |
| Audit, notice, MFA, sessions, secret, operator | Identical to section 6 |
| Build | None beyond 1C. The request type accepts an unlinked human Principal, and records the Owner's attestation reference |

### Recommendation

Do **not** relax `requireEmployeeLink` (reject 2A, OD-15). Use **2B** for any real person, **2C** for service Principals (OD-15, OD-17), and **2D** for the residual unlinked human (OD-16). The check in `issueLoginReset` stays as the guard for ordinary resets.

One consistency note for the build, not a decision: `resetLoginMfa` and `unlockLoginAccount` already run on a Principal without a link, which means an existing login can lose its link and still have its authenticator reset but not its password. Make the three consistent in the same change.

## 8. Cross-cutting specification of the recommended design

| Concern | Specification |
|---|---|
| Authority | Owner and Administrator logins (OD-2). Nobody is recovered by someone who only holds one party's key |
| Audit | One `audit_events` row per state change and one `authentication_events` row, both append-only. Fields: request id, target Principal, operator handle, database role, custodian key id, reason, verification attestation reference, delay and expiry timestamps, outcome. The digest `H` is recorded; `S`, passwords, codes and keys never are. Actor follows the `bootstrapFirstOwner` precedent (OD-12) |
| Notification | At request, approval and execution: a notice shown to every other enabled Owner and Administrator at sign-in and on the Users screen, a security event, and a recorded callback to the person. Email is out of scope until D-5 is revisited (OD-11) |
| MFA | Always re-enrolled. All factors and recovery codes are removed at execution. `mfa_required` is set. The redeemed session reaches `/auth/*` only until a new authenticator is confirmed. The first-authenticator window is the trust-on-first-use risk (F-7), closed by the recoverer-held secret |
| Sessions | Every session and refresh token is revoked at execution. This is bundled on purpose and is an explicit exception to #56 D-ROUTINE-REVOKE (OD-10), because a break-glass is by definition not a routine reset, and `resetLoginMfa` already revokes |
| Replay | A request is single-use, bound to the target's authority fingerprint, expires 72 hours after the delay, and is voided by any change to the account state |
| Lockout abuse | The ceremony clears the lock. A repeated lock after recovery is a signal for the notices and for the abuse limiter, not a reason for a standing exception |
| Secret custody | `S`: recoverer's device. Custodian key: custodian's device. Connection and keys: operator environment. EOS: digests and public keys only |
| Post-recovery watch | In v1 the notices stay visible for 7 days on the Users screen. No functional lock on the recovered account, so an Owner in an emergency is not locked out of the company |

## 9. Sequencing, size and verification

- **Interim (OD-14).** Firebase production break-glass stays the only recovery floor. R1 (the production recovery release) preserves it. Nothing in this lane lets Firebase be disabled in a production role before the ceremony is built, drilled and accepted. This is the R2 gate in the critical path.
- **Build order after decisions.** (1) Schema: the `recovery` ticket purpose and a recovery-request table (OD-13). (2) Ceremony commands and the `recovery` validity rule (F-4). (3) Notice surfaces. (4) The recoverer's offline helper that prints `S` and `H`. (5) The custodian's signing helper. (6) Sandbox drill. The Owner succession design (OD-3) runs as a separate lane and is not on this path.
- **Migration.** New migration files have been refused by the permission classifier in earlier sessions. Plan an operator-applied SQL path, and list the tests that pin table or constraint counts so they can be updated in the same change.
- **Drill (sandbox, synthetic data only).** A synthetic Owner persona is stranded by password loss, authenticator loss and both. The drill must show: a single insider cannot finish it; an approval by the operator's own key is rejected; execution before the delay is rejected; a cancelled or expired request is rejected; a changed account state voids a request; the recovered account is `/auth/*`-only until it enrolls; every prior session is dead; no log line, event, audit row or script output contains `S`, a password, a code or a key; and the notices appear for the other administrators.
- **Not on this lane.** Email self-service (D-5), moving Firebase password hashes, splitting database ownership, and the production EOS API (D-1).

## 10. OWNER DECISIONS (full text)

**OD-1. Recovery model for a sole Owner.** Choose between: only a second Owner; only an operator ceremony; both. *Recommendation:* both. The ceremony is the guaranteed floor, because it works with one Owner and no one else holding the Role. The second Owner (1A-i) is prevention, adopted when a suitable person exists.

**OD-2. What the ceremony covers.** *Recommendation:* Owner and Administrator logins, and the unlinked-human case in OD-16. All other logins keep the in-product, administrator-issued code path.

**OD-3. Owner succession and second-Owner design.** Commission a separate design for appointing a second Owner and for succession on departure or incapacity. Today no ordinary command can do either. *Recommendation:* yes, as its own Tier-2 lane. This is a security and authorization-model change, and it is independent of the ceremony.

**OD-4. The two-party rule.** *Recommendation:* recovery needs a registered custodian's signature **and** the operator's database execution. The recoverer may be the operator in a one-person company, but never the custodian.

**OD-5. Who the custodians are.** *Recommendation:* at least two named people who hold no database access, each with a signing key kept on their own device or hardware key, and the public keys listed on a register. Any one may approve. The Owner chooses the names. This lane does not.

**OD-6. Delay and cancellation.** *Recommendation:* 24 hours from approval to execution; a request expires 72 hours after the delay ends. Cancellable by the account holder (signing in cancels it), any other enabled Owner or Administrator, any custodian, or the operator.

**OD-7. Where the reset secret comes from.** *Recommendation:* the recovering person generates `S` on their own device at recovery time; only its SHA-256 digest is registered. Reject any design where the operator or a tool generates and displays the secret for someone else.

**OD-8. A sealed standing recovery code stored at enrollment (option 1B).** *Recommendation:* not in v1, and never as a standalone bypass. It is one necessary part inside the ceremony. Revisit only if recoverers cannot run the offline helper at recovery time.

**OD-9. Identity-verification standard.** *Recommendation:* two independent channels (one live, one callback to the number of record), attested by the custodian, recorded by reference only. No identity evidence is stored in EOS.

**OD-10. Revocation inside a break-glass.** *Recommendation:* revoke every session, refresh token, open ticket, authenticator and recovery code at execution. Record this as an explicit, narrow exception to #56 D-ROUTINE-REVOKE, which remains in force for routine resets.

**OD-11. Notification channel in v1.** EOS has no outbound email (D-5). *Recommendation:* an in-product notice to every other enabled Owner and Administrator, a security event, and a recorded callback to the person. Revisit email only under a separate D-5 decision.

**OD-12. Audit actor for operator-executed acts.** *Recommendation:* operator handle, database role and custodian key id in the audit payload, following the `bootstrapFirstOwner` precedent (`bootstrap:first-owner:<operator>`). Do not create a pseudo-Principal for the operator.

**OD-13. Schema change.** *Recommendation:* approve a `recovery` value for `login_tickets.purpose`, a recovery-request table and a custodian register, applied by the operator because migration writes from agent sessions have been refused. The consume-time check for a `recovery` ticket uses the ceremony record, not a live issuer.

**OD-14. Interim safeguard.** *Recommendation:* keep Firebase production break-glass until the ceremony is built, drilled in the sandbox and accepted by the Owner. Do not disable Firebase in any production role before then.

**OD-15. Principals with no Employee link and human logins.** *Recommendation:* keep `requireEmployeeLink` for ordinary resets and provisioning. Real people must be linked (option 2B). Service Principals never get a password (option 2C). Reject option 2A.

**OD-16. An unlinked human Principal, for example the Administrator persona.** *Recommendation:* link an accountable Employee record when the person is a real employee. Where that is not appropriate, reset through the ceremony (option 2D), with the Owner's attestation of the accountable person recorded.

**OD-17. Recovery of a service Principal.** *Recommendation:* credential rotation by the operator under a separate runbook per service. Never a password and never an in-product reset.

## 11. Not decided and not done here

- No code, configuration, Rules, MFA, session or authentication behavior changed. `docs/DECISIONS.md` is not edited (precedence hash); a decision record follows the Owner's rulings.
- The custodians, the delay owners and the exact notice wording are the Owner's to name. Nothing is assumed about who they are.
- Whether the sole Owner and the operator are the same person today is not stated in any source this lane read as a fact about production. Section 6.1 is written so it holds either way.
- Production has no EOS API (D-1). This design is for nonprod proof first and for the production role only after D-1 and OD-14.
