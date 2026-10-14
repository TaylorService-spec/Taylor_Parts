---
name: verify-rules-deploy
description: Walk the Firestore Rules deploy-and-verify checklist after a firestore.rules change -- confirm Tier-2 authorization, dual-copy parity, the correct emulator/deploy CWD-branch, that a manual `firebase deploy --only firestore:rules` actually ran, and that live rules match the committed source before declaring a rules change "live." Use after merging or before deploying any firestore.rules change, or when asked whether Firestore rules are actually deployed/live.
---

# verify-rules-deploy (adapter)

The authoritative, platform-neutral workflow for this skill lives in the shared
repository skill at **`skills/verify-rules-deploy/`**:

- `skills/verify-rules-deploy/SKILL.md` -- the concise execution steps.
- `skills/verify-rules-deploy/references/checklist.md` -- full rationale,
  commands, and refusals.
- `skills/verify-rules-deploy/scripts/parity-check.mjs` -- the deterministic
  dual-copy parity check (run `node skills/verify-rules-deploy/scripts/parity-check.mjs`
  from the repo root).
- `skills/verify-rules-deploy/scripts/verify-rules-deploy.test.mjs` -- its test.

Read and follow that skill. Do not duplicate its content here.
