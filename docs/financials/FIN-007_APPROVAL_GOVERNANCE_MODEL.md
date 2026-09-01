# FIN-007 — Adjustment / Approval / Exception Governance (F8)

**Status:** approval machinery IMPLEMENTED (repository, dormant — not yet composed by any
command path; policy values Owner-undecided). Recorded 2026-09-01, overnight run phase F8.
**Authority sources composed:** DECISIONS #145/#154; baseline invariant C (corrections are
governed events); FIN-002 §17 (post-commitment corrections → FIN-007); F6 (plan approval
authority deferred here).

## 1. The machinery (fixed, policy-free)

`functions/src/finance/financialApprovals.ts`:

| Piece | Guarantee |
|---|---|
| `APPROVABLE_ACTION_TYPES` | closed set over the modeled actions: `INVOICE_ADJUSTMENT · WRITE_OFF · REFUND · PLAN_APPROVAL · ATTRIBUTION_CORRECTION` |
| `isApprovalRequired(policy, action)` | **fail-closed**: an action type with NO explicit policy line requires approval; duplicate policy lines for one type are thrown (`POLICY_AMBIGUOUS` — ambiguous policy is not policy); a threshold can never exempt an action with no stated amount |
| `buildApprovalRecord` | explicit frozen decision record: action + target + requester + decider + `APPROVED/REJECTED` + **mandatory reason** + ctx-supplied decide time. **Self-approval forbidden unconditionally** — no policy input re-enables it |
| `assertActionApproved(action, record)` | the execution-side guard: refuses on missing record, wrong action/target, `REJECTED` (a rejection is terminal for that request), amount above the approved amount (**approving 100 is not approving 150**), or a monetary action whose approval states no amount |

## 2. Owner-undecided (policy values, not machinery)

- WHICH actions require approval and at what `thresholdMinor` values (per company? per BU?).
- WHO may approve — capability/role assignment (composes FIN-004 visibility and the access
  model; nothing granted, no capability id minted yet).
- Escalation/expiry semantics (does an approval age out?), and whether write-off approval
  is distinct from general adjustment approval in role terms.

These arrive as `ApprovalPolicyLine[]` values + capability grants at activation (F14);
until then every composed action would fail closed to "approval required".

## 3. Composition contract (for later phases)

- `adjustmentCommands`/`refundCommands` callables compose `isApprovalRequired` +
  `assertActionApproved` when FIN-007 activates — the pure cores stay approval-agnostic.
- FIN-003 plan `DRAFT → APPROVED` transitions must be accompanied by a `PLAN_APPROVAL`
  record.
- Future FIN-002 attribution-correction events (`ATTRIBUTION_CORRECTION`) are born requiring
  approval (no policy exists ⇒ fail-closed).
