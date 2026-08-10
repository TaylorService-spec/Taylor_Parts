# Owner Notification Signal Quality (register / design)

**Principle (Control Plane): RAW SYSTEM EVENT ≠ OWNER NOTIFICATION.**

A real friction event prompted this: GitHub emitted many CI/workflow failure emails from
intermediate runs even though later work converged and authoritative state is healthy. The Owner
should not receive every CI failure, retry, agent event, transient stale condition, or
intermediate correction as an independent interruption.

## The correlation the system should perform

Raw machine events are correlated into **current unresolved state**, not forwarded one-for-one:

```
raw:    17 CI runs · 4 intermediate failures · 4 later corrected
Owner:  CURRENT MAIN: HEALTHY · unresolved failures: 0 · self-corrected: 4 · Owner action: NONE
```

Escalate to the Owner **only** when:
- a meaningful **unresolved** condition remains, or
- automatic recovery fails, or
- repeated failures indicate **systemic** risk, or
- a **protected action stops**, or
- genuine Owner **judgment/authorization** is required.

## Non-negotiables

- **Preserve the raw GitHub/CI evidence underneath.** Do not suppress engineering evidence merely
  to reduce email — correlation summarizes for the Owner; the raw runs remain inspectable.
- A self-corrected/superseded failure is **historical**, not an Owner interruption.
- This is the notification analogue of the compact-not-transcript and context-independence
  principles: the Owner sees the distilled current state; raw history is retrievable, not pushed.

## Scope now (register/design only)

- This is **registered as a principle**, not built as a notification pipeline. The trusted
  server-side **notification sender** remains a FUTURE_SEAM (M9 — deployed Function + identity,
  Owner-gated); nothing here emails anyone.
- A bounded repo-safe implementation is possible once CI-run outcomes are a durable input to the
  envelope: a `notificationSignal` projection that folds raw run outcomes into
  `{ currentMain: HEALTHY|ATTENTION|ACTION_REQUIRED, unresolvedFailures, selfCorrected, ownerAction }`.
  Until that input exists, this stays design; the cockpit's SYSTEM HEALTH already reports only
  **current** governed conditions (never raw event counts), consistent with this principle.

## Relationship to Owner Friction

`DUPLICATE_NOTIFICATION` (multiple machine events representing one condition) is an AVOIDABLE
[Owner Friction](lib/ownerFriction.mjs) category. Notification-signal correlation is how that
friction is driven toward zero without hiding real unresolved conditions.
