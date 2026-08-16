# Repository graph — look it up instead of rediscovering it

`repo-graph.json` in this directory is a **generated, committed** structural map of the
repository. It exists because answering "where does X live / what imports Y / is this cited
path still real" was costing a full grep-and-read sweep every time — per question, per
session, per AI — to rediscover facts that only change when the repo changes.

Regenerate after structural changes:

```bash
node scripts/buildRepoGraph.mjs
```

`--check` reports without writing and exits non-zero on stale references.
A full build over ~2,500 files takes under a second.

## What it contains

| Key | Meaning |
| --- | --- |
| `imports` / `importedBy` | resolved module edges, both directions |
| `docRefs` / `inboundDocLinks` | which docs cite which paths, and what links to a doc |
| `workflowPaths` | each workflow's `paths:` filters — what actually triggers CI |
| `hygiene.staleRefs` | a doc cites a repo path that does not exist |
| `hygiene.orphanDocs` | no other doc links to it |
| `hygiene.testsNoPathTrigger` | editing this test alone triggers no workflow |
| `hygiene.unimportedCode` | no module imports it |

## What it is not

**Structural, not semantic.** It knows `A` imports `B` and that a doc cites a path. It does
not know whether either is a good idea. Use it to find *what* to read — it is not a
substitute for reading.

**Hygiene entries are leads, not verdicts.** An orphan doc may be deliberately standalone;
unimported code may be a not-yet-wired seam. Each needs judgment before action.

## Deliberate precision choices

- **Only root-anchored references are judged stale.** A bare `src/x.js` exists under more
  than one app root here, so it is unresolvable and guessing produces noise. An early version
  reported 1,073 stale refs; anchoring cut it to 54 real ones.
- **`docs/ai/memory-archive/` is exempt.** Those are retired AI working notes retained
  verbatim and explicitly non-authoritative — their citations were true when written and are
  expected to rot.
- **`testsNoPathTrigger` is not "never run in CI."** A workflow can invoke a test in a `run:`
  step without path-filtering on it. The provable claim is narrower: changing only that file
  triggers no workflow.

## Why it is committed

Per [`docs/ai/ai-state-contract.md`](../ai/ai-state-contract.md), project truth lives in the
repository so the Owner, Claude, and ChatGPT read the same words. This applies that principle
to *structure*: one generated map everyone can read, instead of three private indexes nobody
can audit. If the graph disagrees with the repository, the repository wins — regenerate.
