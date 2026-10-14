---
name: verify-rules-deploy
description: Walk the Firestore Rules deploy-and-verify checklist after a firestore.rules change -- confirm Tier-2 authorization, dual-copy parity, the correct emulator/deploy CWD-branch, that a manual `firebase deploy --only firestore:rules` actually ran, and that live rules match the committed source before declaring a rules change "live." Use after merging or before deploying any firestore.rules change, or when asked whether Firestore rules are actually deployed/live.
---

# Verify Firestore Rules are actually deployed (not just merged)

Two standing facts this repository has been burned by drive this skill:

1. **No CI deploys rules.** No workflow in `.github/workflows/` runs
   `firebase deploy` (see `docs/Deployment.md` Section 3). A `firestore.rules`
   change committed to the repo has **zero effect** on the live project until
   someone manually deploys it. A merged rules change is not a live rules change.
2. **The emulator loads rules from the CWD's branch.** Running the emulator (or
   deploying) from a repo root checked out to a stale branch enforces the WRONG
   rules.

This is a **read-and-checklist** guide. It never runs `firebase deploy` against
a real project itself -- deploying Rules is a Tier-2 action
(`docs/DelegationCharter.md`) that needs the Owner's explicit authorization. It
confirms authorization exists and verifies outcomes.

## Execution steps

0. **Confirm it is a Rules change and it is Tier 2.** Any `firestore.rules`
   change altering who can read/write is Tier 2 -- escalate. Confirm the change
   carried a Tier-2 approval and the Owner authorized deploying to the named
   project. If not, stop -- the blocker is authorization, not mechanics.
1. **Confirm the right branch in the right working copy.** Rules deployed (or
   loaded by the emulator) come from the current CWD's checkout. Run the branch/
   status/remote checks in `references/checklist.md` Step 1. Never verify or
   deploy from a worktree on a different branch than the rules you intend to act
   on.
2. **Confirm dual-copy parity (SCRIPTED).** Run
   `node scripts/parity-check.mjs` from the repo root. It hashes the deploy
   source `firestore.rules` (root, per `firebase.json`) against
   `field-ops-app-vite/firestore.rules` and reports MATCH or MISMATCH. Every
   spec requires changing both copies; a change in only one is a defect. Stop and
   surface the diff on MISMATCH.
3. **Confirm the manual deploy actually ran.** The authorized operator runs
   `firebase deploy --only firestore:rules` from the correct checkout. Do not
   assume a merge deployed it -- get the deploy output/timestamp or the console's
   Rules "published" history. Unconfirmed = **NOT live**.
4. **Verify live rules match the committed source.** A deploy is not proof the
   live rules equal the repo (wrong branch/CWD defeats it). Compare the published
   ruleset against the committed file and record the timestamp/version as
   evidence.
5. **Report status unambiguously** as one of LIVE / MERGED, NOT DEPLOYED /
   BLOCKED, with evidence, as a copy-paste block. See `references/checklist.md`
   Step 5 for the exact state definitions.

Steps 3 and 4 require Firebase credentials and console/CLI access -- they stay
**manual operator steps**, documented in `references/checklist.md`, never
scripted here.

## Refusals

- Do not run `firebase deploy` against a real project without explicit Owner
  authorization for that project.
- Do not verify or deploy from a worktree/checkout on the wrong branch.
- Do not treat a merge as a deploy, or "deploy ran" as "live rules verified."
- Do not deploy with the two `firestore.rules` copies out of parity.
- Do not go looking for or handle production credentials to force a check --
  report the blocker instead.

Detailed rationale, commands, and edge cases: `references/checklist.md`.
