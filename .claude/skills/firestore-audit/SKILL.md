---
name: firestore-audit
description: Full deployment/rules parity audit for the Taylor_Parts project -- "does what's deployed actually match what the repo assumes exists." Use before/after any Firestore rules or index change, before merging a branch that touches security rules, or whenever there's reason to suspect the live project has drifted from the repo (console edits, a stale deploy, etc.).
---

# firestore-audit

A repeatable version of the audit done manually multiple times in one session: rules parity, index parity, hosting-path sanity, and Firestore collection drift. Uses `.claude/skills/admin-check`'s `lib.js` for every server-side check -- don't re-derive that logic inline.

## Steps

### 1. Rules parity (repo vs. deployed)

```js
const initAdmin = require("../admin-check/lib.js");
const admin = initAdmin("<service-account-key-path>");
const { content } = await admin.getDeployedRules();
require("fs").writeFileSync("deployed.rules.tmp", content);
```

Then `diff deployed.rules.tmp firestore.rules` (repo root). Also `diff firestore.rules field-ops-app-vite/firestore.rules` -- both copies must stay identical (this project mirrors the rules file in two places and has drifted before). Delete the tmp file after.

Flag, don't assume:
- Any console-only draft the user describes verbally is **not evidence of what's deployed** -- only `admin.getDeployedRules()` is ground truth (a console rules-editor edit can sit unpublished indefinitely).
- If deployed != repo, say explicitly which one is ahead and by what, rather than assuming repo is authoritative.

### 2. Index parity

```bash
npx firebase firestore:indexes
```

Compare against `firestore.indexes.json`. Cross-check against what queries actually exist:

```bash
grep -rn "where(\|orderBy(" field-ops-app-vite/src/
```

Every composite index should map to a real query in that grep output -- an index with no matching query, or a query with no matching index, is worth flagging explicitly (a missing index causes a runtime "failed-precondition" error the first time that exact query shape runs in production).

### 3. Single-hosting-path sanity

This project has been bitten by having two live hosting paths simultaneously (GitHub Pages + a broken Firebase Hosting deploy with mismatched `base` paths). Check both:

```bash
curl -s -o /dev/null -w "GH Pages: HTTP %{http_code}\n" https://taylorservice-spec.github.io/Taylor_Parts/field-ops/
curl -s -o /dev/null -w "Firebase Hosting: HTTP %{http_code}\n" https://taylor-parts.web.app/
gh api repos/TaylorService-spec/Taylor_Parts/pages -q '.status, .source.branch'
```

Firebase Hosting should be **404/disabled** (`firebase hosting:disable`) unless the user has deliberately reactivated it with a matching build. If both return 200, that's the exact drift condition to flag -- don't assume it's fine just because both "work."

If Firebase Hosting is ever redeployed, verify asset paths resolve with the *correct* `Content-Type` (not an SPA-fallback `text/html` in place of `application/javascript`) -- HTTP 200 alone doesn't prove the right file is being served, since the SPA rewrite (`** -> /index.html`) will return 200 for literally any path.

### 4. Collection/schema drift

```js
console.log(await admin.listAllCollections());
```

Compare the result against `docs/DataModel.md`'s documented collections. Anything not in both is worth investigating: an undocumented live collection, or a documented collection with zero real data (check `docs/DataModel.md`'s reality markers -- ✅/🧪/❌ -- before assuming a "missing" collection is actually a bug rather than known-scaffolded-unused).

### 5. Report format

State each of the four checks as PASS/FAIL with the actual evidence (diff output, curl status, collection counts), not just a verdict. This audit exists because a plausible-sounding assumption ("it's probably fine") is exactly what caused the drift in the first place.
