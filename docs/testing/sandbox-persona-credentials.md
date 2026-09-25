# Sandbox persona credentials — the contract

**ONE FILE. READ ONLY. NO RECREATION. NO SECRET ECHO. NO ALTERNATE COPY.
NO AUTH RESEED DURING BUSINESS FIXTURE RESET.**

Owner direction, 2026-08-07. This page is the whole policy; there is no
credential platform, dashboard or secrets service, and there must not be one.

## The single source of truth

```
sandbox-credentials.local.json
```

That filename, and only that filename. Local only, gitignored (`.gitignore`
covers `*.local.json` and `*credentials.local.json`), never committed — not to
the repository, CI config, documentation, examples, issue comments, PR bodies,
or agent evidence. If an example is ever needed, use a schema with fictional
values.

`sandbox.txt` is **DEPRECATED and must not be used.** It is stale. It cost two
persona runs that failed as *"invalid password"* rather than as anything
diagnosable, because a stale credential file does not announce itself.

## Read credentials one way only

```js
import { loadSandboxPersona } from "../scripts/sandboxCredentials.mjs";

const { email, password } = loadSandboxPersona("dispatcher");
await page.fill("#email", email);
await page.fill("#password", password);   // straight in; never read back out
```

`scripts/sandboxCredentials.mjs` is the only loader. Do not write your own file
parsing in UX, Design, F2, persona agents, Playwright, or an individual script.
Three separate agent-authored parsers in one day produced two wasted runs, a raw
credential dump, and a password printed as reversible character codes.

The loader has **no write path**, and a test asserts that it never gains one.

### Stable persona ids

Tooling requests a `personaId`. It never hard-codes an email or a password, and
prompts never contain password text.

**A persona key names an identity that EXISTS.** This is the whole point of the
catalog, and it is the rule the catalog broke. Reconciled 2026-09-24 against the
live nonprod authority:

| canonical key | authentication account | live Principal |
| --- | --- | --- |
| `owner` | `eos-owner@sandbox.invalid` | `ajXZSa0g…` — Role `owner`, no employee link |
| `admin` | `admin@sandbox.invalid` | `ZVu3lHTP…` — Role `admin`, Employee `synthetic-np-emp-owner-executive` |
| `generalManager` | `bailey.fixture@sandbox.invalid` | `xiyAcX4U…` — `generalManager` |
| `serviceManager` | `devon.fixture@sandbox.invalid` | `oQPfzG2A…` — `fieldManager` |
| `dispatcher` | `emerson.fixture@sandbox.invalid` | `PEiRkebI…` — `dispatcher` |
| `technicianAssigned` | `finley.fixture@sandbox.invalid` | `i4EYSBGP…` — `technician` |
| `technicianUnassigned` | `gray.fixture@sandbox.invalid` | `l2AKXJ44…` — `technician` |
| `partsAssociate` | `logan.fixture@sandbox.invalid` | `Ap6MRSs1…` — `partsAssociate`, `inventoryReceivingClerk` |
| `partsManager` | `kai.fixture@sandbox.invalid` | `p9zXxj5S…` — `partsManager`, `purchasingManager` |
| `warehouseAssociate` | `noor.fixture@sandbox.invalid` | `cgVnRUMA…` — `warehouseAssociate`, `inventoryCycleCountCounter` |
| `warehouseManager` | `morgan.fixture@sandbox.invalid` | `0KBdhU9Z…` — `warehouseManager` + 2 inventory Roles |
| `retailSales` | `harper.fixture@sandbox.invalid` | `4OVJwVRi…` — `salesperson` |
| `nationalAccountsSales` | `jules.fixture@sandbox.invalid` | `zpfYS0PK…` — `salesperson` |
| `financeAccounting` | — | **UNRECONCILED** |
| `reporting` | — | **UNRECONCILED** |
| `restricted` | — | **UNRECONCILED** |

Three further live logins are mapped so that no real account is unreachable:
`officeManager` (`casey.fixture@`), `contractTechnician` (`oakley.fixture@`,
employment status CONTRACTOR) and `retailSalesB` (`indigo.fixture@`).

`personaDirectory()` returns this table at run time, reads no credential file and
touches no network. It is safe to print.

#### The three unreconciled keys

They are **not missing passwords. They are missing authorities**, and no account
may be created for them — inventing one would manufacture a business permission so
that a test could pass. Asking for one raises `PERSONA_UNRECONCILED` carrying the
reason and the operator action, *before* the credential file is even looked for.

- `financeAccounting` — `financeManager` and `accountingManager` hold **zero**
  active assignments; the Sample Company declares no finance Employee at all.
- `reporting` — `reportAuthor`, `reportViewer` and `reportFinanceViewer` hold zero
  active assignments, **and those Roles hold zero capabilities**, so even a holder
  would be indistinguishable from a persona with no Roles.
- `restricted` — no Role keyed `restricted` exists in nonprod. The legacy
  `restricted@sandbox.invalid` was a Firebase-era control with no EOS Principal.

#### Aliases, and the difference between an alias and a defect

A backward-compatible alias resolves to a canonical key and **carries no address of
its own** — an address is how a collision hides. `loadSandboxPersona` returns the
canonical key, never the alias that was typed.

`technician` → `technicianAssigned` · `fieldManager` → `serviceManager` ·
`salesperson` → `retailSales` · `serviceTechnicianA` / `serviceTechnicianB` ·
`ownerExecutive` → `admin`

Three keys are **retired** with no replacement, because no live Principal holds the
Role they named: `operationsManager`, `salesManager`, `accountingManager`. They
raise `PERSONA_RETIRED` with the reason, rather than a bare `UNKNOWN_PERSONA`.

#### What was wrong, and why it was worse than an empty catalog

The map declared thirteen `sbx-*`-era addresses. **Twelve had no live EOS
Principal**, and **nine of those collided by name with a persona that does exist**
— `owner`, `dispatcher`, `technician`, `warehouseManager`, `partsManager`,
`partsAssociate`, `fieldManager`, `salesperson`, and `restricted` as a control.
`loadSandboxPersona("dispatcher")` therefore returned a perfectly well-formed
credential request **for the wrong identity**. The run failed later — as "invalid
password", or as a surprising authorization answer — which is exactly the failure
mode this module exists to prevent.

`admin@sandbox.invalid` was the one legacy entry that was always right: it is the
reused pre-existing sandbox Administrator (uid `ZVu3lHTP1NQhj0Am04zTAGou0dx1`), and
it is left untouched. `avery.fixture@sandbox.invalid` is that Employee's **work
email, not a login** — no account exists for it and none may be created, because a
second `admin`-Role Principal is an authority change.

A test asserts that no persona key resolves to a retired address, that every alias
points at a canonical key, and that no two keys share one account.

### Where the file is found

`SANDBOX_CREDENTIALS_FILE` if set — and if set it is **authoritative**, never
merely first in a list. Otherwise, in order:

```
<repo>/sandbox-credentials.local.json
<repo>/.sandbox-credentials.local.json
~/.eos-sandbox/sandbox-credentials.local.json
~/Favorites/Downloads/sandbox-credentials.local.json
~/Downloads/sandbox-credentials.local.json
```

`~/.eos-sandbox/` was added 2026-09-24: it is where the operator's file actually
lives, and every other candidate missed it, so a correctly spelled persona failed
`FILE_NOT_FOUND` while the file sat on disk. Every candidate is still the **same
one canonical filename** — a location, never an alternate file. The loader will
**never** fall back to `sandbox.txt` or any other list: a stale fallback is worse
than a clean failure.

The file stays **READ ONLY**. This loader has no write path, and adding a search
location does not give it one.

## Failure behaviour

On any failure the loader raises `CREDENTIAL_ACCESS_FAILED` carrying the
`personaId`, the paths tried and the failure type — and **never** the password, a
reversible encoding, or the file contents. A test asserts this.

Failure types: `UNKNOWN_PERSONA` · `PERSONA_UNRECONCILED` · `PERSONA_RETIRED` ·
`FILE_NOT_FOUND` · `FILE_UNREADABLE` · `EMPTY_FILE` · `UNPARSEABLE` · `NO_ENTRIES` ·
`PERSONA_NOT_IN_FILE`.

**`PERSONA_UNRECONCILED` and `PERSONA_RETIRED` are raised before any path is
tried**, and report an empty `pathsTried`. A key with no identity behind it is not
a missing password, and reporting it as one sends the reader to the credential
file — the wrong place, and the reason this catalog stayed wrong for so long.

`PERSONA_NOT_IN_FILE` on a **mapped** key means the identity is right and the
operator simply has no password for it yet. Activating one is an operator act
(`seedSampleCompany.js --mode activate-credentials`), never an agent act.

A failing mission **STOPS**. It does not retry against stale or random sources,
does not cycle through other personas, and does not manufacture a replacement
user or password.

## Never echo a credential

Not the value, and not any derivative: no character codes, hex, base64, hashes,
partial masks, or per-character inspection. Debug output may contain a success
boolean and a length — `describeLoad(personaId)` returns exactly that and nothing
more.

## Auth personas are not business fixture data

Resetting a scenario must never touch a persona account.

- Fixture scripts (`seedSandboxCoordinatedInstall.js` and friends) restore Work
  Orders, Opportunities, inventory and scenario state. They touch **no**
  credential.
- `activateSandboxPersonas.js` **reports and changes nothing by default**. It
  reuses existing personas and reports a missing one rather than silently issuing
  a new password.
- Rotation requires an explicit `--rotate`. It invalidates every saved copy,
  including the Owner's and any running mission's. It is not part of ordinary
  testing.

This script previously rotated on every run and called that "safe and expected
for a disposable environment." It was neither.

## Every persona/browser agent prompt must say

> Use the canonical sandbox credential loader (`loadSandboxPersona`). Never print,
> encode, transform or reproduce credential values in any form. Never create
> replacement credential files. Never create or recreate sandbox users unless
> explicitly authorized. On credential failure, stop and report
> CREDENTIAL_ACCESS_FAILED with the personaId and failure type.

Agents receive a **persona identity**, never a password.
