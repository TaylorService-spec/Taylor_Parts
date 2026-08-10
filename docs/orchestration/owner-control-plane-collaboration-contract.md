# Governed Collaboration & Decision Contract (Owner Control Plane, contracts-only)

Repo-safe substrate for the eventual Claude ↔ ChatGPT bridge and the Owner Inbox, built
per the Owner's ratified **contracts-only now** decision (§4): everything needed for the
bridge *except* the paid credential, the deployed transport, and the service identities.
Nothing here claims live integration — `ACCESS != TRIGGER`, and a message nobody is woken to
consume is not seamless collaboration (§3).

## One envelope, three request types (§13)

`collaborationContract.mjs` — a single durable request envelope carries `requestType`
∈ WORK / AI_REVIEW / OWNER_DECISION with distinct `authorityClass` semantics. **Not three
subsystems** (reuse finding, accepted). Shared: `requestId`, `projectId`, `source`, `target`,
`idempotencyKey`, provenance, `respondBy`/`escalateAfter`, `evidence`.

**Reciprocal lifecycle:** `REQUESTED → DELIVERED → ACKNOWLEDGED → IN_PROGRESS → RESPONDED →
CONSUMED → CLOSED`, with off-path dispositions `BLOCKED / REJECTED / STALE / CONTAMINATED /
NEEDS_OWNER`. `advance()` permits only one legal forward hop — no silent jumps. AI review
responses use `REVIEW_VERDICTS` = CONCUR / CONCUR_WITH_CORRECTION / NONCONCUR_ESCALATE /
NEEDS_OWNER / AUTO_RESOLVED (§17).

**Idempotency / replay (§34):** a deterministic `idempotencyKey(type, source, target, subject)`
recognises a redelivered or replayed request so it is never double-acted.

## §11 — exactly one current responsibility owner

`responsibilityOwner(req)` names, at *every* state, who must act next, the event that
discharges that responsibility, and what happens on silence. The responder owns the reply
until `RESPONDED`; then responsibility flips to the requester to `CONSUME`. Neither AI may
assume "the other one has it." **`escalateOnSilence()` converts an overdue wait into
`NEEDS_OWNER` — silence never becomes approval.** A `RESPONDED` request is not "overdue":
the wait is on the requester to consume, not on approval.

## Decision triage (§9/§10) — most questions never reach the Owner

`ownerDecision.mjs` — a durable Owner Decision Request (chat is not the record) + a pure
`triage()` with fixed precedence:

1. **crossesProtectedBoundary → OWNER_AUTHORIZATION** — protected execution needs Owner
   authorization *at execution time even when the direction is obvious*. Ratified policy:
   a recorded decision is intent, not execution (`requiresReconfirmAtExecution`, re-confirm
   at execution).
2. **determinedByExistingAuthority && !establishesNewPolicy → AUTO_RESOLVED** — does not
   reach the Owner.
3. **establishesNewPolicy → RECOMMEND_OWNER.**
4. otherwise → **NEEDS_OWNER.**

Regression cases (must never interrupt the Owner again): CASE 1 (Firestore-gated vs
Function vs App Hosting), CASE 2 (repo-safe prep while deploy stays operator-executed),
CASE 3 (launcher auth-check endpoint) all → **AUTO_RESOLVED**; the actual Rules *deploy* →
**OWNER_AUTHORIZATION**. Encoded in `ownerDecision.test.mjs`.

## Bridge API + mock (§4/§18A) and the Claude-side consumption seam

`bridgeTransport.mjs` — the narrow `BRIDGE_API` (`listPendingRequests`, `getRequest`,
`submitResponse`, `acknowledgeResponse`) — **never arbitrary Firestore access** — plus a
fully in-memory `createMockTransport()` that proves the round-trip, dedupe, and cold-start
escalation recovery with no network/credential/deploy. The mock **cannot report itself live**
(`isLive() === false`, structural guard). `pendingConsumption(source)` is the Claude-side
seam: a `RESPONDED` request the requester hasn't consumed is actionable continuation work,
mirroring the §23 discipline (a completed exchange ≠ consumed work).

## Honest seams (§3/§14)

`FUTURE_SEAMS` (data): claude-autonomous-wake, chatgpt-access, chatgpt-trigger,
claude-receipt-continuation, deployed-bridge, paid-chatgpt-credential, service-identities,
trusted-notification-sender — each with what blocks it. `PC_DEPENDENCE` classifies every
current execution dependency as portable/non-portable for a future "run without the Owner
PC" objective (§14) — **recorded, not built**. The Control Center can project both truthfully
so nothing claims a capability that isn't proven end-to-end.

**Still Owner-gated / not built here:** paid ChatGPT credential, deployed bridge/notification
Functions, production service identities, live integration, autonomous Claude wake.
