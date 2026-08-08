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

`owner` · `admin` · `dispatcher` · `technician` · `warehouseManager` ·
`partsManager` · `partsAssociate` · `restricted`

Tooling requests a `personaId`. It never hard-codes an email or a password, and
prompts never contain password text.

### Where the file is found

`SANDBOX_CREDENTIALS_FILE` if set — and if set it is **authoritative**, never
merely first in a list. Otherwise the repo root, then the operator's Downloads
folder. Every candidate is the same canonical filename. The loader will **never**
fall back to `sandbox.txt` or any other list: a stale fallback is worse than a
clean failure.

## Failure behaviour

On any failure the loader raises `CREDENTIAL_ACCESS_FAILED` carrying the
`personaId`, the paths tried and the failure type — and **never** the password, a
reversible encoding, or the file contents. A test asserts this.

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
