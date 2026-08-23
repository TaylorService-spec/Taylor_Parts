# `GRANTROLE — PRINCIPAL EXISTENCE BEFORE WRITE`

**Status: OPEN. Narrow follow-up. Do not fix inside another slice.**
Found 2026-08-23 while verifying a Functions deploy.

---

## What happened

`grantRole` was called with a `principalUid` that does not exist in Auth:

```
POST .../grantRole
  { principalUid: "probe-principal-that-does-not-exist",
    roleId: "equipmentInstaller", scope: { type: "global" }, ... }

503  "Your request was recorded, but a follow-up step is still completing.
      Retry with the same idempotency key shortly."
```

The response was a 503, but the assignment **had been written**. Two live `active` roleAssignment
documents existed for a principal that cannot sign in.

Both were revoked through the governed `revokeRole` callable — the same path that created them, never
a direct delete — and reconciliation afterwards reported **0 UNEXPECTED_GRANT**.

## The defect

The command validates the **role** before it validates the **principal**, and it writes the
assignment before principal existence is established. So an unknown principal produces a durable
`roleAssignments` document plus its audit event, and the caller is told only that a follow-up step is
still completing.

Two distinct problems, worth separating:

1. **Ordering.** An unknown principal should be refused *before* any `roleAssignment` or
   audit-success mutation.
2. **The 503 is misleading.** "Your request was recorded" is accurate and reads as reassurance. A
   caller treating a 503 as "nothing happened" would be wrong, and that is exactly how this went
   unnoticed until the collection was read directly.

## Required behaviour

```
unknown principal  ->  refused before any roleAssignment or audit-success mutation
```

The refusal should be distinguishable from a denied grant: the request was well-formed and the
requester was authorized; the subject simply does not exist.

## Why it matters beyond a bad probe

Grants are the platform's authority record. A grant that exists for a principal nobody can
authenticate as is not immediately dangerous — nobody can use it — but it is a false entry in the
record that reconciliation must then explain, and it makes "who holds this role" answerable only
after cross-checking Auth.

It also means a typo'd uid in an administrative grant produces a silent, durable, wrong record rather
than an error.

## Scope

Narrow. Do **not** fold this into the Work Order closeout installation slice unless it turns out to be
trivial and cleanly isolated. It touches the governed grant writer, which has its own two-person
control, audit and accessVersion behaviour — none of which should be disturbed by work that is
nominally about installing machines.

## What is already true

- The two bogus assignments are revoked (`status: disabled`), through the governed path.
- Reconciliation is clean: 86 ALREADY_CORRECT, 0 UNEXPECTED, 0 UID_MISMATCH, 0 SOD_CONFLICT.
- No real principal was affected.
