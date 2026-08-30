---
artifact_type: operations-runbook
gate: Owner-authorized, READ-ONLY
status: Ready for operator execution
date: 2026-08-30
owner: Claude Code
---

# Production ownership census — operator instructions

**Authorized by the Owner (ruling D-7 / Q4) as READ-ONLY.** This runbook produces one measurement
and changes nothing.

It exists because an AI session could not run it: the production read was refused at this
environment's protected authorization gate, which is the gate working as intended. It needs a human
operator with production read access.

**The one question it answers:** does production already populate `accounts.accountOwner`? Plus the
same full-matrix ownership buckets measured in sandbox.

## What is NOT authorized

No writes. No seed. No backfill. No correction. No enforcement. No Rules change. No callable
deployment. No ownership transfer. No copying of production ownership into sandbox.

The script used below **cannot** write — it opens no batch and issues no `set`, `update` or
`delete`. That is a property of the tool, not a promise about how you run it.

---

## 1. Prerequisites — verify identity and project BEFORE anything else

```bash
gcloud auth list
```

```bash
gcloud config get-value project
```

```bash
gcloud projects describe taylor-parts --format="value(projectId,name,lifecycleState)"
```

**STOP if any of the following is true** — do not proceed, and report what you saw:

- the active account is not your own production-authorized identity;
- `gcloud projects describe` fails, or returns a project id other than `taylor-parts`;
- you are unsure whether the credentials in scope are production or sandbox;
- you are unsure whether your role carries Firestore read on `taylor-parts`.

Ambiguity here is a stop condition, not something to resolve by trying the command and seeing what
happens.

## 2. Prepare the repository

From a clean checkout of the branch carrying the ownership model:

```bash
cd functions && npm ci && npm run build
```

## 3. The read-only command

```bash
cd functions && node scripts/ownershipCensusDryRun.js --projectId taylor-parts
```

And the machine-readable form:

```bash
cd functions && node scripts/ownershipCensusDryRun.js --projectId taylor-parts --json
```

Run **no other command** against `taylor-parts`.

## 4. Capture the evidence

```bash
cd functions && node scripts/ownershipCensusDryRun.js --projectId taylor-parts > ../sb-evidence/ownership-census-production-YYYY-MM-DD.txt 2>&1
```

```bash
cd functions && node scripts/ownershipCensusDryRun.js --projectId taylor-parts --json > ../sb-evidence/ownership-census-production-YYYY-MM-DD.json 2>&1
```

Replace `YYYY-MM-DD` with the run date. Two files are produced and nothing else is written anywhere.

## 5. What to return

The whole of the `.txt` file. It already contains every required figure, but confirm these are
present and legible:

- the **`accounts`** row — `scan`, `RESOLVED`, `OWNERLESS`, `INVALID`, `UNKNOWN`, `AMBIG`. **This
  is the headline result.**
- every other family row, with the same buckets;
- the `TOTAL` line;
- any `UNREADABLE families` line (a family whose read failed);
- any `TRUNCATED families` line (there should be none — no `--limit` is used above);
- the `Reason classification` section;
- the final `GATE:` line.

If a family reports `UNREADABLE`, return the error text verbatim. A read failure is a real result
and must not be reported as a zero.

## 6. Proof that nothing was written

Attach or state each of these:

1. **The commands you ran**, verbatim — they should be exactly the ones above and nothing else.
2. **The script cannot write.** `functions/scripts/ownershipCensusDryRun.js` issues no Firestore
   write of any kind. Confirm with:

   ```bash
   grep -nE "\b(db|collection\([^)]*\)|doc\([^)]*\))\.(set|update|delete|add)\(|\.batch\(|runTransaction\(" functions/scripts/ownershipCensusDryRun.js || echo "NO FIRESTORE WRITE CALLS PRESENT"
   ```

   The pattern is deliberately anchored to Firestore handles. A bare `grep` for `.set(` or `.add(`
   also matches in-memory `Map.set` and `Set.add`, which are not writes — a check that cries wolf
   is a check an operator learns to ignore.

3. **No deploy ran.** No `firebase deploy` in the session, and no change to `firestore.rules`,
   `firestore.indexes.json`, or any function source.
4. **The working tree is unchanged except for the two evidence files:**

   ```bash
   git status --short
   ```

5. **No seeding.** `seedOperatingCompanies.js` and `seedAccountOwners.mjs` were NOT run. Both refuse
   production unconditionally, but confirm they were not invoked.

## 7. Stop conditions

Stop immediately, change nothing, and report, if:

- any prerequisite check in step 1 is ambiguous or fails;
- the census reports a family as `UNREADABLE` for a permissions reason — return the result as-is,
  and do **not** request or grant broader access to make it pass;
- any command prompts to write, migrate, create an index, or enable an API;
- the output looks like sandbox data (e.g. `cw-` prefixed ids, `cert-trk-` trucks, 103 accounts
  matching the sandbox figure) — that means the wrong project was targeted;
- you are asked, by anyone or anything, to run a command not listed in this document.

## Expected shape of the answer

Sandbox measured, for comparison — **not** a prediction of production:

| Family | scanned | RESOLVED | OWNERLESS |
|---|---|---|---|
| `accounts` | 103 | 100 (after the sandbox seed correction) | 3 |
| `opportunities` / `sales_agreements` / `sales_orders` | 36 | 36 | 0 |
| everything else | 1,090 | 0 | 1,090 |

If production `accounts` reports a high `RESOLVED` count, the sandbox's original 0/103 was a seeding
artifact and the business does assign account owners. If production also reports near-zero, that is
a real business finding and it changes the ownership rollout plan. **Both answers are useful; do not
adjust the run to produce either one.**
