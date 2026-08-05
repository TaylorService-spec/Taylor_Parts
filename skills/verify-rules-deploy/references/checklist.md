# Firestore Rules deploy-and-verify checklist (detail)

Two standing facts this repository has been burned by drive this entire skill:

1. **No CI deploys rules.** `docs/Deployment.md` Section 3 confirms no workflow
   in `.github/workflows/` runs `firebase deploy` -- a `firestore.rules` change
   committed to the repo has **zero effect** on the live project until someone
   manually deploys it. A merged rules change is not a live rules change (rules
   once sat undeployed for months).
2. **The emulator loads rules from the CWD's branch.** Running the emulator (or
   deploying) from a repo root checked out to a stale branch enforces the WRONG
   rules -- this produced a false "Rules gap" finding twice.

This checklist never runs `firebase deploy` itself against production -- deploying
Rules is a Tier-2 action (`docs/DelegationCharter.md`) and, against a real
project, needs the Owner's explicit authorization. It confirms authorization
exists and verifies outcomes.

## Step 0 -- Confirm the change is a Rules change, and that it's Tier 2

Any change to `firestore.rules` that alters who can read or write what is
**Tier 2 -- escalate**, unconditionally, per `docs/DelegationCharter.md`
Section 2 (and `docs/DECISIONS.md` #4, which records this exact
mis-classification being caught at commit time). There is no carve-out for
"follows an existing pattern" or "doesn't touch the ledger." Before any deploy:
confirm the Rules change itself carried a Tier-2 escalation/approval, and that
the Owner has authorized deploying to the named project. If not, stop -- the
blocker is authorization, not mechanics.

## Step 1 -- Verify you are on the right branch in the right working copy

The rules that get deployed (or loaded by the emulator) come from the **current
working directory's checkout**. Confirm before anything else:

```bash
git rev-parse --abbrev-ref HEAD          # the branch whose rules are about to act
git status --porcelain                   # must be clean -- no uncommitted rules edits
git remote get-url origin                # must be the canonical Taylor_Parts remote
```

Never run a verify or deploy from a `.claude/worktrees/*` or `.codex/worktrees/*`
checkout that is on a different branch than the one whose rules you intend to
act on. If the intended rules live on `main`, verify `main` is checked out and
matches `origin/main`:

```bash
git fetch origin && git rev-parse main origin/main
```

## Step 2 -- Confirm dual-copy parity (scripted)

There are two committed copies:

- `firestore.rules` (repo root) -- **this is the deploy source**: `firebase.json`
  sets `"firestore": { "rules": "firestore.rules" }`. Confirm this at runtime;
  do not assume.
- `field-ops-app-vite/firestore.rules` -- the second copy the app tree carries.

Every Sprint Specification requires changing **both** copies
(`docs/ai/templates/specification-template.md`, "Firestore Rules impact"). Run
the deterministic parity script from the repo root:

```bash
node skills/verify-rules-deploy/scripts/parity-check.mjs
```

It SHA-256-hashes both copies and prints `PARITY OK` (exit 0) or
`PARITY MISMATCH` (exit 1). By default it reads `firebase.json` to discover the
deploy-source path rather than hardcoding it. Flags:

- `--root <dir>` -- repo root to resolve paths against (default: cwd).
- `--json` -- machine-readable result.

If they differ, stop and surface the diff (`diff firestore.rules
field-ops-app-vite/firestore.rules`). Resolve parity before deploy; do not
deploy one copy and leave the other stale.

## Step 3 -- Confirm the manual deploy actually ran (the real gap) -- MANUAL

The deploy command (run by an authorized operator, from the correct checkout):

```bash
firebase deploy --only firestore:rules
```

This step needs Firebase credentials and is **not scripted**. Do not assume it
happened because a PR merged. Confirm it explicitly -- ask the operator for the
deploy output/timestamp, or check the Firebase console's Rules "published"
history for the target project. If you cannot confirm a deploy occurred after the
merge commit, the correct status is **"merged, deploy unconfirmed -- NOT live,"**
not "done."

## Step 4 -- Verify live rules match the committed source -- MANUAL

A deploy having run is still not proof the live rules equal what's in the repo
(wrong branch/CWD at deploy time defeats it -- Step 1). This step needs console/
CLI access to the live project and is **not scripted**. Where a comparison is
available, confirm the live published ruleset matches the committed
`firestore.rules` on the intended branch (compare the published Rules text/
version in the console against the committed file, or run the repository's own
rules-verification tooling if present). Record the evidence (published
timestamp/version identifier) rather than a bare "looks right."

## Step 5 -- Report status unambiguously

Return one of exactly these states, with evidence:

- **LIVE** -- both copies in parity, deploy confirmed after the merge commit,
  live ruleset verified to match the committed source (cite the timestamp/
  version).
- **MERGED, NOT DEPLOYED** -- committed but no confirmed deploy. Name the manual
  command an authorized operator must run.
- **BLOCKED** -- Tier-2 authorization for the deploy is missing, or a parity
  mismatch / wrong-branch checkout must be resolved first.

Deliver this as a copy-paste block. Do not describe a rules change as "in
effect," "live," or "done" without Step 3 and Step 4 evidence.

## Explicit refusals

- Do not run `firebase deploy` against a real project without explicit Owner
  authorization for that project (Tier-2 / Tier-3 credential boundary).
- Do not verify or deploy from a worktree/checkout on the wrong branch.
- Do not treat a merge as a deploy, or "deploy ran" as "live rules verified."
- Do not deploy with the two `firestore.rules` copies out of parity.
- Do not go looking for or handle production credentials to force a check --
  report the blocker instead.
