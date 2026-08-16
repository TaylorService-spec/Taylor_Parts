# AI state contract — where truth lives when two AIs work on this repo

**Status: Owner-ratified 2026-08-16.** Applies to **every** AI working on Taylor_Parts — Claude, ChatGPT,
Codex, and any agent any of them dispatches.

This document exists so the Owner never has to re-explain this. Hand it to any AI that starts work here.

## The problem it solves

The Owner grounded both AIs in repository context (`docs/orchestration/context/cold-start.mjs`, the C-7
registry, `docs/CLAUDE_CONTEXT.md`, `docs/architecture/SYSTEM_AUTHORITIES.md`) specifically so that both
would reason from the same source. It did not hold, because **each AI also kept its own private memory
store** that the Owner could not inspect and the other AI could not read.

An audit of Claude's store on 2026-08-16 found **85 entries / 723 KB (~185k tokens)**, of which **88% was
project state** and **71% was long-form journals of already-completed work** — an unversioned shadow copy
of `docs/`. When two AIs disagree and both are reasoning partly from invisible private state, the Owner
cannot adjudicate. He becomes the reconciliation layer. That is the cost this contract removes.

## The contract

### 1. Project truth lives in this repository

Specifications, status, decisions, architecture, capability/authority models, evidence, and workstream
state belong in `docs/`. If it is a fact about the product, it goes where all three parties read the same words.

### 2. Private memory holds only working preferences and pointers

Permitted: how the Owner likes to work, communication format, escalation thresholds, environment/tooling
gotchas, and pointers to repo authority. **Not permitted:** project journals, status narratives, or any
claim about the product that exists only in private memory.

### 3. The repository always wins

If private memory and the repository disagree, the repository is correct and the memory entry is stale.
Fix the memory entry; never "correct" the repo from memory.

### 4. Memory is never evidence

A memory entry naming a file, flag, PR, or capability must be **re-verified against the repo before acting
on it.** Memory records what was true when written, not what is true now.

### 5. Every AI publishes its manifest

Each AI keeps a manifest of what it holds privately, in the repo, so the Owner can open it and diff it.
- Claude: `docs/ai/memory-manifest.md`
- ChatGPT: to be published at `docs/ai/chatgpt-memory-manifest.md` (see request below)

### 6. Status claims are staged and evidenced

`DESIGNED → IMPLEMENTED → MERGED → DEPLOYED → ACTIVATED → USER-VISIBLE → E2E VERIFIED`.
No AI claims a later stage than it has evidence for. **Merged is not deployed. Deployed is not activated.**
Environment state is established by reading the environment (`/version.json`), never by a deploy command's
exit status. See `docs/releases/wave7-completion-truth-matrix.md`.

## Division of labor that works

The Owner runs two AIs deliberately — to get independent verification rather than blind faith in either.
That is correct and should continue. What matters is the shape:

- **Two AIs as builder + checker: strong.** Independent review catches confident-and-wrong output, which
  neither AI reliably self-detects.
- **Two AIs as two builders on one surface: weak.** That is where duplicate work, architectural drift, and
  conflicting implementations come from.
- **Aim review where it pays.** A second opinion is high-value on architecture, security, Firestore Rules,
  authority/capability changes, money, and production actions. It is near-zero-value on behavior-preserving
  Tier-1 work, which `DelegationCharter.md` §8 already authorizes to proceed without a review stop.
  Routing everything through review costs the Owner relay effort without buying safety.

## Request to ChatGPT

1. **Audit your own memory** of this project and produce a list of every durable fact you hold: what it is,
   when you learned it, and whether it is a *project fact* or an *Owner working preference*.
2. **Classify each entry** as: `IN REPO` (already in `docs/`, safe to keep as a pointer) · `PROMOTE`
   (project fact held only in your memory — should be written into `docs/`) · `PREFERENCE` (legitimately
   private) · `STALE` (contradicted by the current repo).
3. **Flag every `PROMOTE`** to the Owner. Those are the invisible facts this contract is designed to eliminate.
4. **Publish the result** as `docs/ai/chatgpt-memory-manifest.md` so it is auditable and diffable, the same
   way Claude's is.
5. **Adopt clauses 1–6 above** going forward.

The Owner should not have to explain this again. If you are an AI reading this file, this is your instruction set.
