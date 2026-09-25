# Persona credential and identity readiness — measured 2026-09-24

**MEASUREMENT ONLY.** Nothing on this page was produced by creating, resetting,
rotating, activating or fetching a password, a token or an authentication
account. No authentication account was touched. No nonprod or production row was
written. Every PostgreSQL statement behind this page was a `SELECT`.

Companion to [`sandbox-persona-credentials.md`](./sandbox-persona-credentials.md),
which is the *contract*. This page is the *state*: for each of the sixteen
canonical persona keys in `scripts/sandboxCredentials.mjs`, whether it can sign
in today, and whether the identity it would sign in as is the identity EOS
believes it is.

Measured against the reconciled catalog at `d06dc607` and the live nonprod
authority (`eos_policy.principals`, `eos_policy.employee_principal_links`,
`eos_policy.user_role_assignments`, `eos_policy.audit_events`).

---

## The two questions are not the same question

A persona mission needs **two** things to be true, and they fail in completely
different places:

1. **A credential** — an authentication account exists and its password is held
   in the operator's one credential file. Failing this is loud: the loader
   refuses, or the sign-in page says the password is wrong.
2. **A binding** — the uid that authentication returns is the
   `external_subject` of the EOS Principal that holds the Roles. Failing this is
   **silent**: the sign-in succeeds and the session is simply the wrong
   identity, so the run reports a surprising authorization answer rather than an
   error.

The second failure has already happened once in this tenant, and it was found
only because the Owner read a uid out of a browser. It was invisible to every
repository file and every database query. That precedent governs how honestly
this page reports what it cannot see.

---

## Table 1 — Credential dry run

Produced by calling `loadSandboxPersona()` once per canonical key and recording
**only** the outcome code. No password, length, encoding or derivative was
printed, logged or written at any point.

Classifications as applied here:

| Classification | Means |
| --- | --- |
| `CREDENTIAL_READY` | The loader returns a credential, and a live Principal stands behind the address. |
| `PASSWORD_NOT_ACTIVATED` | The identity exists; no password for it is held on this host; a **governed activation mechanism exists and covers this address**. |
| `AUTH_ACCOUNT_MISSING` | No authentication account exists for the address. *(Not used — see "What could not be measured".)* |
| `IDENTITY_BINDING_MISMATCH` | The auth uid is **proven** different from the Principal's `external_subject`. *(Not used — zero proven mismatches today.)* |
| `UNRECONCILABLE` | No governed path in this repository can make the key serviceable. Two distinct causes occur; the reason column separates them. |

| # | Persona key | Address | Loader outcome | Classification | Reason |
| --- | --- | --- | --- | --- | --- |
| 1 | `owner` | `eos-owner@sandbox.invalid` | `LOADED` | **CREDENTIAL_READY** | The only serviceable key on this host. Principal `dca03ad1…`, Role `owner`, no employee link. |
| 2 | `admin` | `admin@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **UNRECONCILABLE** | `CREDENTIAL_WITHHELD_BY_DESIGN`. The account exists and its credential is real and pre-existing — it is **deliberately excluded** from the activation allowlist (`existingAdministrator`, `credentialEmail: null`, `REUSE_UNCHANGED`). There is no governed mechanism that can place it in the credential file, and activation must never be pointed at it. |
| 3 | `generalManager` | `bailey.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `98fbb1ee…` live, employee link active. In the activation allowlist. |
| 4 | `serviceManager` | `devon.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `45b60e4f…` live. In the activation allowlist. |
| 5 | `dispatcher` | `emerson.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `18e54b1f…` live and **binding-verified 2026-09-24**. In the activation allowlist. |
| 6 | `technicianAssigned` | `finley.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `97652f09…` live. In the activation allowlist. |
| 7 | `technicianUnassigned` | `gray.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `728f5b0d…` live. In the activation allowlist. |
| 8 | `partsAssociate` | `logan.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `29ec481c…` live. In the activation allowlist. |
| 9 | `partsManager` | `kai.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `68ab4dec…` live. In the activation allowlist. |
| 10 | `warehouseAssociate` | `noor.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `65a269d9…` live. In the activation allowlist. |
| 11 | `warehouseManager` | `morgan.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `00e45827…` live. In the activation allowlist. |
| 12 | `retailSales` | `harper.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `c117537e…` live. In the activation allowlist. |
| 13 | `nationalAccountsSales` | `jules.fixture@sandbox.invalid` | `PERSONA_NOT_IN_FILE` | **PASSWORD_NOT_ACTIVATED** | Principal `da330746…` live. In the activation allowlist. |
| 14 | `financeAccounting` | *(none)* | `PERSONA_UNRECONCILED` | **UNRECONCILABLE** | `NO_LIVE_PRINCIPAL`. Verified: `financeManager` and `accountingManager` hold **0** active assignments. |
| 15 | `reporting` | *(none)* | `PERSONA_UNRECONCILED` | **UNRECONCILABLE** | `NO_LIVE_PRINCIPAL_AND_NO_AUTHORITY`. Verified: `reportAuthor`, `reportViewer`, `reportFinanceViewer` each hold **0** active assignments. |
| 16 | `restricted` | *(none)* | `PERSONA_UNRECONCILED` | **UNRECONCILABLE** | `NO_SUCH_ROLE`. Verified: no Role keyed `restricted` exists in nonprod at all. |

**1 of 16 canonical keys is serviceable on this host.** The other fifteen are
not blocked on a *bug*: eleven are blocked on an operator activation that has
not been authorized, one is withheld by design, and three have no identity to
give a password to.

### `UNRECONCILABLE` covers two different things — do not merge them

Row 2 and rows 14–16 both read `UNRECONCILABLE`, and they are **not** the same
condition:

- Rows 14–16 have **no identity**. Giving them a password would be
  manufacturing an authority so that a test could pass.
- Row 2 has a **correct, live, real identity with a real credential**. It is
  unserviceable here only because the credential is held elsewhere and the
  governed activation path is forbidden from touching it.

Row 2 is deliberately **not** labelled `PASSWORD_NOT_ACTIVATED`, even though
that label would be the closest fit by shape. That label carries an implied
instruction — *run the governed activation* — and running it against the reused
real administrator is precisely the act that must never happen. A label that
invites the wrong act is a worse answer than an awkward one.

### The governed activation mechanism — named, NOT run

```
node functions/scripts/seedSampleCompany.js --mode activate-credentials
```

- **Dry run by default.** `--apply` is what writes; it was not passed, and the
  command was not run at all in this lane. Activation is an **operator act
  needing explicit authorization**, because it mints passwords.
- It does not reimplement password generation. It delegates to
  `activateMissingSandboxPasswords` in
  `functions/scripts/activateSandboxPersonas.js` — the one password-generating
  code path in the repository.
- It is scoped by an **explicit allowlist**, computed from the manifest as an
  intersection the caller cannot widen: the 14 manifest Employees carrying
  `sandboxPersona.interactiveLogin`. Eleven of those fourteen are canonical keys
  (rows 3–13); the other three are the supplemental keys `officeManager`
  (`casey.fixture@`), `retailSalesB` (`indigo.fixture@`) and
  `contractTechnician` (`oakley.fixture@`).
- **`admin@sandbox.invalid` is not in the allowlist and cannot be reached by
  it.** Its `credentialEmail` is `null` in the manifest specifically so it can
  never become one.
- **`eos-owner@sandbox.invalid` is not in the manifest at all.** The Owner
  Principal is bound by `functions/scripts/bindOwnerPersonaIdentity.js`, is
  already serviceable, and needs nothing.

Password creation is therefore **never** part of fixture seeding: it is a
separate, separately-authorized phase with its own allowlist, and resetting a
business scenario does not reach it.

---

## Table 2 — Auth uid vs EOS Principal `external_subject`

The EOS side is fully measurable read-only. **The authentication side is not**,
for the reasons in the next section. A uid is never guessed, and a match is
never inferred from a name matching a name.

| # | Persona key | EOS Principal | EOS `external_subject` | Auth uid determinable? | Comparison |
| --- | --- | --- | --- | --- | --- |
| 1 | `owner` | `dca03ad1-9278-49e6-b4f9-d09d3f587dc4` | `ajXZSa0gTcWAyDHVSsVifwZfNRf1` | **YES — already determined**, 2026-09-24 17:48 UTC | **MATCH** |
| 2 | `admin` | `639c1970-dbdb-4bc0-af7c-118559151e2f` | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` | No | **NOT_DETERMINABLE** |
| 3 | `generalManager` | `98fbb1ee-4998-4082-adea-bf94fa82f4c8` | `xiyAcX4UQEQRRqbMRrIXv3LwWVi2` | No | **NOT_DETERMINABLE** |
| 4 | `serviceManager` | `45b60e4f-f20f-4915-b9bb-17f851072aa4` | `oQPfzG2AUgWOo8Tm0LJvurj8dXi2` | No | **NOT_DETERMINABLE** |
| 5 | `dispatcher` | `18e54b1f-05e1-402d-8982-66efc8393f05` | `PEiRkebIGRPcEau7yBBV0D77Dho1` | **YES — already determined**, 2026-09-24 21:19 UTC | **MATCH** |
| 6 | `technicianAssigned` | `97652f09-07bf-48e8-90b9-f321a01fe10d` | `i4EYSBGPXPM8lweuhI5a5y2TRgH3` | No | **NOT_DETERMINABLE** |
| 7 | `technicianUnassigned` | `728f5b0d-45bf-4708-8624-0864ab19bcab` | `l2AKXJ44hzUEWpYfEpiQeg208CF2` | No | **NOT_DETERMINABLE** |
| 8 | `partsAssociate` | `29ec481c-51a6-468f-831e-5f84308bad0d` | `Ap6MRSs1gKW5lQtN4lTZOaecHgu1` | No | **NOT_DETERMINABLE** |
| 9 | `partsManager` | `68ab4dec-5922-4d0c-954c-5161befe3bd8` | `p9zXxj5SJiOAwbSoFcKriaQ8NGt1` | No | **NOT_DETERMINABLE** |
| 10 | `warehouseAssociate` | `65a269d9-86f8-4c7a-b974-436dd6779bbf` | `cgVnRUMA2Sc7WxHl1lgTmbQAhwG2` | No | **NOT_DETERMINABLE** |
| 11 | `warehouseManager` | `00e45827-043a-484f-b150-0d8502e8e39f` | `0KBdhU9Z8Yc4aTQqXHODEP1jeHf1` | No | **NOT_DETERMINABLE** |
| 12 | `retailSales` | `c117537e-21ac-43e7-a210-b6cfa5323ed6` | `4OVJwVRisyOlgBQDkjA75rs7djm2` | No | **NOT_DETERMINABLE** |
| 13 | `nationalAccountsSales` | `da330746-66c5-4d99-ba94-57f3d241a814` | `zpfYS0PKUJOwVbskY1WjUreWqg72` | No | **NOT_DETERMINABLE** |
| 14 | `financeAccounting` | *(none)* | *(none)* | No — and there is nothing to compare it to | **NOT_DETERMINABLE** |
| 15 | `reporting` | *(none)* | *(none)* | No — and there is nothing to compare it to | **NOT_DETERMINABLE** |
| 16 | `restricted` | *(none)* | *(none)* | No — and there is nothing to compare it to | **NOT_DETERMINABLE** |

### Why the two `MATCH` rows are evidence and not inference

Both were established by an act that read a real uid, and both left an audit row
in `eos_policy.audit_events`:

- **`owner`** — `bindOwnerPersonaIdentity.js` resolves the subject from the
  `localId` returned by a live `signInWithPassword` against
  `eos-owner@sandbox.invalid`, and writes **that** value. The binding therefore
  *is* the uid, verified at the moment of writing. Audit:
  `rebindPrincipalIdentity`, actor `lane-aw-owner-binding`, 2026-09-24 17:48:24,
  moving the Principal from `eos-synthetic-nonprod / synthetic-np-principal-owner`
  to `firebase / ajXZSa0gTcWAyDHVSsVifwZfNRf1`.
- **`dispatcher`** — corrected from the Owner's live browser session. Audit:
  `rebindPrincipalIdentity`, actor `dispatcher-login-reconciliation`,
  2026-09-24 21:19:06, reason *"after live browser acceptance proved current
  Firebase UID differs from existing EOS binding"*.

Neither is re-measured here. Both remain true **unless the underlying
authentication account is deleted and recreated**, which mints a new uid and
which nothing in EOS would notice.

### Why the other eleven are genuinely unknown — and why that is not paranoia

This is the load-bearing finding of this lane.

The manifest does not record uids. Every login Principal in
`sampleCompany.v2.json` declares `"externalSubject": "RESOLVED_FROM_AUTH_UID"` —
a literal placeholder. The uid in PostgreSQL is therefore **not** a declared
value that can be re-checked against the repository; it is a record of whatever
the seeder resolved on the day it ran, and the repository holds no second copy
to compare it with.

The timestamps show all fourteen fixture login Principals were written by one
batch:

```
tenant.addPrincipal  actor=rudy  2026-09-16 19:34:54 … 19:35:04 UTC   (14 principals)
```

Of that batch, exactly **one** has ever been independently checked against a
real browser session — `dispatcher` — and **that one was wrong**. Its original
subject was `NReyNyXVMdVkv75vpmxWuvGUeOm1`; the live uid is
`PEiRkebIGRPcEau7yBBV0D77Dho1`.

So the measured record is: **1 of 14 from this batch verified, and the
verification found a defect.** The remaining eleven canonical keys (plus the
three supplemental ones) carry subjects from the same run, resolved by the same
mechanism, never checked since — `updated_at` equals `created_at` for every one
of them.

The wrong dispatcher uid was a well-formed 28-character Firebase uid that looked
exactly as legitimate as the other thirteen. **There is no inspection, no query
and no file in this repository that would have caught it.** That is why every
unverified row above reads `NOT_DETERMINABLE` rather than "presumed fine", and
it is also why none of them may be treated as a *candidate* for rebinding: a
suspicion is not a measurement.

---

## Rebind candidates

**NONE.** Zero proven mismatches.

This list is deliberately empty, and empty is the correct answer:

- `dispatcher` was rebound on 2026-09-24 and **verified correct**. It must not
  be rebound again.
- The eleven unverified personas are **not** candidates. A candidate requires a
  proven mismatch — a measured live uid that differs from the stored subject.
  None was measured, so none is proposed.
- No second Principal is proposed for anything. A stale subject is repaired by
  rebinding the existing Principal (`rebindPrincipalIdentity`, which preserves
  the Principal id, its Roles and its capabilities); creating a second Principal
  would split one person's authority across two identities and is never the fix.

`rebindPrincipalIdentity` was **not** run, and no operator script that writes was
run, in this lane.

---

## What could not be measured, and why

**The authentication side is not enumerable from here.** Determining a persona's
live uid requires one of exactly three things, and this lane holds none of them:

| Means | Status |
| --- | --- |
| **(a) Sign in with the password and read the uid.** | Only `owner` has a password on this host, and its uid is already recorded from exactly this act on 2026-09-24. For the other fifteen there is no password to sign in with. |
| **(b) Firebase Admin credentials, to list users.** | Not held and not authorized. Checked and confirmed absent: no `~/.config/gcloud/application_default_credentials.json`, `GOOGLE_APPLICATION_CREDENTIALS` unset. A `firebase-tools` config file exists on the host, but whether it holds a login with access to the nonprod project was **not** tested — testing it is an operator act outside this lane. |
| **(c) The Owner reads the uid from a live browser session.** | An Owner act. This is how the dispatcher defect was found, and it is the only means that has ever caught one. |

Three further specific gaps:

1. **`CREDENTIAL_READY` was not proven end to end even for `owner`.** What is
   proven is that the loader resolves the entry. Whether that credential still
   authenticates was not tested, because testing it means fetching a token.
2. **`PASSWORD_NOT_ACTIVATED` vs `AUTH_ACCOUNT_MISSING` cannot be separated from
   here.** The distinction lives in one place: the
   `listSandboxPersonas()` / `passwordHash` reading inside
   `activateSampleCompanyCredentials`, which needs Admin credentials. Every row
   3–13 was classified `PASSWORD_NOT_ACTIVATED` rather than
   `AUTH_ACCOUNT_MISSING` on the strength of the Principal existing with a
   `firebase` subject written by `ENSURE_SANDBOX_AUTH_ACCOUNT_THEN_LINK`, which
   ensures the account before linking — evidence the account existed on
   2026-09-16, not proof it exists today. **The dry run
   (`--mode activate-credentials` without `--apply`) is the governed way to
   settle this, and it reports a missing account as a finding rather than a
   skip.** It was not run.
3. **No sign-in was attempted at all in this lane, including as the Owner.**
   The option existed — BJ's loader resolves `owner` without a password being
   supplied — and it was declined, because signing in fetches a token and
   updates the account's sign-in metadata, and the one uid it would have yielded
   is already recorded in `eos_policy.audit_events` from the governed binding
   run on the same day. Nothing was gained by repeating it.

---

## Operator actions

Nothing below has been done. Each is an operator act needing explicit
authorization.

| Persona key | Action |
| --- | --- |
| `owner` | **None.** Serviceable, and its binding is verified. |
| `admin` | **Do not activate and do not rotate.** To make it usable on a host, the Owner supplies the existing credential into `~/.eos-sandbox/sandbox-credentials.local.json` out of band. Separately, its uid `ZVu3lHTP…` has never been re-verified since 2026-09-10 and is worth an Owner uid read (means (c)). `avery.fixture@sandbox.invalid` is that Employee's work email, not a login — do not create an account for it. |
| `generalManager`, `serviceManager`, `dispatcher`, `technicianAssigned`, `technicianUnassigned`, `partsAssociate`, `partsManager`, `warehouseAssociate`, `warehouseManager`, `retailSales`, `nationalAccountsSales` | Authorize one run of `node functions/scripts/seedSampleCompany.js --mode activate-credentials`. **Run it without `--apply` first** and read the report: `missing` names any address whose account no longer exists, and `alreadyUsable` names any that already has a password. Only then decide about `--apply`. One run covers all eleven, plus the three supplemental keys. |
| all eleven above, again | **Before trusting a persona run**, have the Owner read the uid from a live session (means (c)) and compare it to Table 2. The dispatcher precedent says this is the only check that works. Any difference is then repaired with `rebindPrincipalIdentity` on the **existing** Principal — never by creating a second one. |
| `financeAccounting` | Declare a finance Employee and Principal in `sampleCompany.v2.json` and assign a finance Role through the governed path. Lane BI separately **declares** `finance-controller` under `ENSURE_SANDBOX_AUTH_ACCOUNT_THEN_LINK` — declared only; nothing is provisioned. An account before the authority exists measures nothing. |
| `reporting` | Grant the Reporting Roles their capabilities first (a governed grant reconciliation), then declare a holder. Today a holder would be indistinguishable from a Principal with no Roles at all. |
| `restricted` | An Owner ruling on what `restricted` is meant to prove. A Principal holding **no** Roles is the honest negative control and needs no new Role, but it still needs a declared Employee/Principal pair. Lane BI declares `restricted-user` under the same contract — declared only. |

---

## Machine-readable companion

**None was produced, deliberately.** No suite in `test/suites.json` reads a
readiness file, and no workflow path filter references one. Emitting a JSON copy
of these tables would create a second artifact that nothing validates and that
drifts silently the first time a persona changes — and adding a workflow path
filter to make it look covered would be worse than not having it. If a suite is
ever written that consumes this state, it should read the live authority
directly, not a snapshot of it.

---

## Invariants, confirmed unchanged after every query on this page

```
capabilities             76
role_capabilities       387
principal_capabilities    0
principals               30
migrations               50
```
