# Lane C — Admin / Identity / Security

**Priority 30. Branch prefix `customer1/c-`.**

## Mandate

Make ordinary Taylor administration self-service, reconcile who exists in
production, and prove Day-1 authority from the production environment rather
than from the repository.

This is the most governance-sensitive lane. It implements authority that already
exists. It never creates authority.

## Gates owned

- `C1-IDENTITY-01` — Production identities and roles (OPEN, launch-critical)
- `C1-ADMIN-01` — Taylor administrative self-service (OPEN, launch-critical)
- `C1-SECURITY-01` — Production security and authority verification (IN_PROGRESS, launch-critical)

## Owned paths

```
docs/customer-1/identity/**
docs/customer-1/security/**
docs/customer-1/admin/**
```

Implementation outside these paths requires that the item name the existing
ruling that authorizes it, and it is still subject to the global forbidden-path
check.

## May

- Implement admin capability that an existing ruling **already** authorizes.
- Maintain the governed principal directory and identity bindings.
- Work role and scope mechanics inside existing authority.
- Write negative and security tests — the ones that prove access is *denied*.
- Assemble production-readiness evidence.

## Must not

- Create a new authority ruling. Rulings come from the Owner via DECISIONS.
- Grant broader access in order to make a test pass. If a test needs more
  access to go green, the test is telling you something true.
- Invent Taylor users or production identities.
- Weaken fail-closed behavior anywhere, for any reason.
- Touch `firestore.rules`. Rules changes are always Tier 2 and are outside this
  harness entirely.

## Known state to build from

`PR #1752` found production is barely using the governed access model: two
RoleAssignments on one principal, no manager Roles, no location scopes. Zero
principals were exposed by the measured R-32 change. That narrows one exposure
question and satisfies neither identity nor security close.

## Seeded objectives

1. Enumerate the ordinary Day-1 administrative actions Taylor must perform
   without source-code changes, CLI, direct database edits, or Verenward
   engineering — then classify each as supported, partially supported, or
   missing, with evidence.
2. Define the production user roster reconciliation procedure and the
   least-privilege verification each Day-1 persona must pass.
3. Maintain the production authority verification plan: which Rules, Functions,
   capabilities, roles, protected actions, tenant boundaries, and audit
   behaviors must be verified live, and by what read-only procedure.

## Blocker triggers

- The action needs an authority ruling that does not exist (`BLOCKED_GOVERNANCE`).
- Real Taylor personnel or role assignments are needed (`BLOCKED_TAYLOR`).
- Live production verification is required (`BLOCKED_OWNER` — production access
  is Owner-authorized, per action, never inferred).

## Proofs

Every capability item ships at least one negative test. Positive-only evidence
is not evidence in this lane.
