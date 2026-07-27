# AUTH-PR-3 — OOB-code validity evidence (extra-link-is-harmless proof)

**Date:** 2026-07-27 · **Lane:** Customer / Authentication Modernization · **PR:** #444
**Scope:** repository-only; Firebase Auth **emulator** only; no production, no real send.

## Question (Codex round 6)

The command may generate an EXTRA `generatePasswordResetLink()` when a worker
resumes after a >5min stale takeover (at-least-once internally). Provider send
dedup protects the *message*, but does a **later** link generation invalidate the
**earlier**, already-delivered reset link? If it did, the delivered link could be
silently broken.

## Result — the earlier code stays valid

Against the Auth emulator, using the Admin SDK `generatePasswordResetLink()` (the
real link generator) and verifying OOB codes via the emulator's Identity Toolkit
`accounts:resetPassword`:

```
DISTINCT: true        # each generation yields a distinct OOB code
B_VALID:  true PASSWORD_RESET   # earlier code still valid after a later generation
A_VALID:  true PASSWORD_RESET   # later code valid too
```

- Each `generatePasswordResetLink` call yields a **distinct** OOB code.
- The **earlier** code remains **valid** after a later generation (verify-only
  succeeds) and can **complete** a password reset (fully usable, not merely
  verifiable).
- The later code is also valid; the two coexist.

**Conclusion:** generating a later link does NOT invalidate the earlier
already-delivered link. Combined with mandatory provider send-dedup on the
governed idempotency key, a stale worker's extra link generation cannot break or
duplicate the user's recovery path. **Design preserved** (link generation stays
outside the provider dedup boundary; only *send* is deduped).

## Reproduce

Formal regression test:
[`functions/test/adminCredentialResetLinkValidity.test.mjs`](../../../functions/test/adminCredentialResetLinkValidity.test.mjs)

```bash
firebase emulators:exec --only auth --project demo-authpr3 \
  "node functions/test/adminCredentialResetLinkValidity.test.mjs"
```

## Production-enablement condition

The emulator proof is **indicative, not a production guarantee**. Wiring a real
delivery provider (D-EMAIL-DELIVERY) MUST re-verify, against real Firebase Auth,
that (a) an earlier delivered reset link is not invalidated by a later
generation, and (b) the provider deduplicates on the governed idempotency key.
If real Firebase ever invalidated the earlier code, link generation must move
inside the idempotent provider boundary so one idempotency key produces and
sends exactly one effective link.

## Sanitization

No OOB codes, reset links, tokens, or real email addresses are printed or stored
— only DISTINCT/VALID booleans and PASS/FAIL. Synthetic emulator-only accounts.
