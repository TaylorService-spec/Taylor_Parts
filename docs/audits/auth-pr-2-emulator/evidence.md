# AUTH-PR-2 — Emulator evidence (mapping boundary + recovery containment)

**Date:** 2026-07-27 · **Lane:** Customer / Authentication Modernization · **PR:** #442
**Scope:** repository-only; Firebase Emulator Suite only; **no production touched, no Rules change.**

## What was proven

Using the Firebase **client SDK** (Firestore Rules ARE enforced, unlike the Admin SDK)
against the Firestore + Auth emulators, with a **demo** project id (`demo-authpr2`) so no
live project is reachable:

1. The `usernames/{…}` mapping is **client-inaccessible** — there is **no `usernames` match
   block** in `firestore.rules`, so default-deny applies to every client
   (`PERMISSION_DENIED: No matching allow statements`). Proven for read/create/update/delete,
   **unauthenticated** and **authenticated ordinary** clients. No client mapping
   creation/update/deletion; no unintended public read. (Trusted-writer / Admin-SDK path is
   the only writer and is intentionally **not** exercised here.)
2. A password-reset email is **captured by the Auth emulator** (a `PASSWORD_RESET` OOB code
   exists at the emulator's local `oobCodes` endpoint) — it **stays local, never sent
   externally**.
3. The reset **request** causes **no identity mutation** — the original credential still
   authenticates (the reset link was never consumed).

**No Firestore Rules change was required or made** (default-deny already enforces the
boundary; per architecture §10 a Rules change would be a separate Tier-2 gate).

## Result

```
PASS -- unauthenticated read usernames -> denied
PASS -- unauthenticated create usernames -> denied
PASS -- unauthenticated update usernames -> denied
PASS -- unauthenticated delete usernames -> denied
PASS -- authenticated read usernames -> denied
PASS -- authenticated create usernames -> denied
PASS -- authenticated delete usernames -> denied
PASS -- reset email captured in emulator (stays local; no external send)
PASS -- original credential still valid (no identity mutation from reset request)

9 passed
```

## Reproduce (from repo root, so firebase.json + firestore.rules are used)

```bash
firebase emulators:exec --only firestore,auth --project demo-authpr2 \
  "node field-ops-app-vite/test/emulator/authPr2Boundary.mjs"
```

Test source: [`field-ops-app-vite/test/emulator/authPr2Boundary.mjs`](../../../field-ops-app-vite/test/emulator/authPr2Boundary.mjs).

## Sanitization

No reset links, OOB codes, tokens, UIDs, or real email addresses are printed or stored —
only PASS/FAIL and the boundary conclusions. Synthetic emulator-only accounts were used.
