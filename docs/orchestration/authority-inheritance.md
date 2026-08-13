# Constrained authority inheritance — "approve once, decompose, inherit"

Implements the governed chain:

> Owner approves intent **once** → Agent Manager **decomposes** → children **inherit constrained authority** →
> EOS **executes** them → verifier **checks** them → Agent Manager **consolidates**.

The link this file provides is the third arrow — the one that lets a **single** Owner approval confer authority
on machine-decomposed children **without re-approving each child**, while guaranteeing no child can ever exceed
the parent. `lib/authorityInheritance.mjs`, pure and tested, additive.

## The invariant

A child never gets a fresh Owner approval; it inherits a grant that is a **strict subset** of the parent's on
every axis. Over-asking on **any** axis is **rejected** — never silently clamped, never escalated — and no
partial grant is emitted, so EOS's existing gate can only ever execute children whose authority provably
descends from the one parent approval.

`deriveChildGrant({ parent, request }) → { ok, grant } | { ok:false, violations }` enforces child ⊆ parent on:

| Axis | Rule | Reuses |
|---|---|---|
| **profile** | child rank ≤ parent (READ_ONLY parent can't birth a PATCH child) | `resolveExecutionProfile` (two-key least-privilege) |
| **scope** | every child write path ⊆ parent scope, at a **segment boundary** (`src/foo` covers `src/foo/bar.js`, not `src/foobar.js`) | same containment as `planConcurrentWriteSectors` |
| **budget** | child spend ≤ parent budget | — |
| **capabilities** | child capabilities ⊆ parent's | — |
| **protected boundary** | **strictly inherited** — always exactly the parent's; a child may never *add* (parent none → child some), *clear*, or *change* one. Decomposition must not manufacture a boundary the parent did not carry. Narrowing within an explicitly structured parent boundary model is a future seam (no narrowing until such a model exists) | — |

## Children are real emitted work items

`buildChildWorkItems({ parent, requests, now }) → { ok, accepted, rejected, reason? }` mints each accepted child
as a genuine `*.work.json` artifact stamped `status: EXECUTION_AUTHORIZED` / `authority.authorizationState:
AUTHORIZED` with `basis: "inherited from <parent> (constrained subset)"` and `authority.parentRef`. So each
child is a first-class EOS item that the **existing** per-item gate executes and the verifier checks
independently — the concurrency layer (`runAuthorizedWritesConcurrently`) still authorizes nothing.

Fail-closed at the batch level too: an over-asking child is rejected with its violations and gets **no**
artifact; if the accepted children's budgets **sum** beyond the parent's, the whole decomposition is rejected
(siblings cannot collectively exceed the one approval). A child whose inherited scope or C-7 context tag would
resolve empty is rejected rather than minted invalid.

## Where it sits

`deriveChildGrant` is the governed **input** to the concurrent driver: the Agent Manager decomposes a parent
intent into child requests, `buildChildWorkItems` mints the authorized-by-inheritance artifacts, and the driver
drains them through EOS in disjoint sectors. Activation (committing child artifacts, wiring the decomposition
into a workflow) remains gated — this file adds the pure authority seam, not a live flip.
