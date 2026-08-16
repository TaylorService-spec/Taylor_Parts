---
name: EOS work intake
about: Hand a bounded engineering mission to EOS for unattended execution
title: ""
labels: []
assignees: []
---

<!--
HOW THIS BECOMES EOS WORK
  1. Fill in ALL FOUR sections below. Each must be non-empty.
  2. The REPOSITORY OWNER applies the `eos-intake` label.
  3. Nothing runs until that label is applied by the Owner.

WHY THE SECTIONS ARE MANDATORY
  `issue-intake-producer.mjs` fails closed if any is missing or empty. Three intake
  runs failed on 2026-08-13 for exactly this reason. Keep every `## ` heading
  exactly as written -- the parser matches the heading text.
-->

## Purpose

<!-- WHY this work exists. The outcome wanted, not the steps. One or two sentences. -->

## Scope

<!--
WHAT is in bounds. One item per line, as a bullet. Paths, modules, or surfaces.
Be specific -- this is the boundary the worker is held to.

  - functions/src/inventoryReceiving
  - docs/orchestration/lib
-->

-

## Required work

<!--
WHAT must actually be done. Numbered steps or bullets.
Each item should be independently checkable -- if nobody can tell whether it is
done, it is not a requirement yet.
-->

1.

## Completion

<!--
WHAT PROVES IT IS DONE. Not "the work is finished" -- the evidence.

Prefer: tests passing, a specific behaviour verified, an artifact produced, a
capability demonstrably denied for the wrong persona.

Remember the staged truth model: MERGED is not DEPLOYED, DEPLOYED is not
ACTIVATED, and neither is VERIFIED. Say which stage completion actually means.
-->

---

<!--
OPTIONAL, but useful:

Task class     READ_ONLY_ANALYSIS | READ_ONLY_VERIFY | PATCH_PRODUCER
               (omit and the classifier infers it from the text above)

Protected      Anything here requiring production deploy, secrets, credentials,
               Rules changes, capability grants, or destructive/irreversible
               action is NOT authorized by this issue. EOS will stop and return
               the blocker. Say so explicitly if you expect to hit one.
-->
