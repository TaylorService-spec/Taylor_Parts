# AUTH-PR-3 — reset-link OOB list-persistence observation

**Date:** 2026-07-27 · **Lane:** Customer / Authentication Modernization · **PR:** #444
**Scope:** repository-only; Firebase Auth **emulator** only; no production, no real send.

## Question (Codex round 5/6)

The command may generate an EXTRA `generatePasswordResetLink()` when a worker
resumes after a >5min stale takeover (delivery is internally at-least-once).
Provider send-dedup protects the *message*. Open question: does a **later** link
generation affect the **earlier**, already-delivered reset link?

## What the committed test demonstrates (list persistence ONLY)

Against the Auth emulator, using the Admin SDK `generatePasswordResetLink()` (the
real link generator) and the **project-scoped** emulator oobCodes list
(`/emulator/v1/projects/{project}/oobCodes` — no ambiguous API key, robust across
firebase-tools versions):

- Each `generatePasswordResetLink` call yields a **distinct** OOB code.
- After the later generation, the **earlier** code is still **listed
  (outstanding)** in the emulator's oobCodes set — a later generation does not
  **remove** the earlier code from that set.
- The later code is listed too; the two coexist.

Regression test:
[`functions/test/adminCredentialResetLinkValidity.test.mjs`](../../../functions/test/adminCredentialResetLinkValidity.test.mjs).

## What this does NOT establish

This is **list membership / non-removal only**. The committed test does **not**:

- call `accounts:resetPassword`;
- consume the earlier code;
- prove the earlier code is **end-to-end consumable** after a later generation.

Emulator list membership is an indicator of non-removal, not a guarantee of
end-to-end consumability, and it is emulator behavior — not a real-Firebase
guarantee. (An earlier exploratory attempt to assert consumption via the raw
`identitytoolkit` `accounts:resetPassword` endpoint was withdrawn: that endpoint
is API-key/project-fragile across emulator versions — it returns HTTP 400 for a
real-named project with a placeholder key — so it tested the emulator, not our
contract.)

## Reproduce

```bash
firebase emulators:exec --only auth --project taylor-parts \
  "node functions/test/adminCredentialResetLinkValidity.test.mjs"
```

## Production-enablement condition (hard gate)

Because the extra-link behavior is not proven end-to-end here, wiring a real
delivery provider (D-EMAIL-DELIVERY) MUST, against **real Firebase Auth**,
verify BOTH:

1. the provider **deduplicates** on the governed idempotency key (so internally
   at-least-once delivery is user-visibly at-most-once); and
2. an earlier **already-delivered** reset link **remains consumable** (completes
   a password reset) after a later `generatePasswordResetLink()` for the same
   user.

**Fallback:** if (2) fails on real Firebase, link generation must move INSIDE the
idempotent provider boundary so one idempotency key produces and sends exactly
one effective link (never a second, and never one that could invalidate the
first).

## Sanitization

No OOB codes, reset links, tokens, or real email addresses are printed or stored
— only distinctness/listed booleans and PASS/FAIL. Synthetic emulator-only
accounts.
