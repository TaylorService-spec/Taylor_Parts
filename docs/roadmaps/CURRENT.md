# Current EOS Roadmap

**Current as of 2026-09-16:** [`2026-09-16-full-platform-roadmap-reconciliation.md`](2026-09-16-full-platform-roadmap-reconciliation.md)

That reconciliation is the current program-level authority for:

- where EOS is now;
- business-object completion and remaining work;
- end-to-end business-process completion and remaining work;
- PostgreSQL migration/cutover state;
- Firebase retirement;
- Authorization v2 / identity / roles / permissions;
- Administration and application-platform direction;
- current open-PR disposition;
- sequenced remaining program work.

The dedicated foundation workstream is [`2026-09-16-authorization-v2-application-platform-reset.md`](2026-09-16-authorization-v2-application-platform-reset.md).

## Current execution state — controller refresh against `main @ 7ed9fe11`

This section is the concise live status view. It is updated by small roadmap PRs when a gate changes; it is not a tracking subsystem.

### Controlling delivery order

```text
CRM → Catalog / Supplier / Registry → Commercial → Employee / Workforce tails
    → Work Orders / Service / operational tails → Authorization v2 + EOS session final cutover
    → Firebase Auth retirement → zero-Firebase runtime/repository proof → Administration convergence
    → final North Star / persona / browser acceptance → PWA packaging
    → production cutover planning/authorization (separate Owner gate) → training LAST
```

Where the static Wave ordering in the reconciliation (§12) differs, **this order controls**. Safe Authorization v2 and Employee foundation work may proceed in parallel only when it does not conflict with the active migration lane. Neither Authorization v2 nor Firebase exit reopens accepted business semantics (see the parity fence below).

### Lane state

| Lane | Current authority | Last completed gate | Next gate | Blocker |
|---|---|---|---|---|
| **CRM** (#1925) — Accounts / Contacts / Locations | Firestore (writer state `FROZEN / INACTIVE`); PostgreSQL target built, inactive | #1926 server writers frozen + Render LIVE; #1927 source-quiescence proof merged; **#1929 merged** (`a2f4e457`) — direct Firestore CRM write grants removed in both Rules copies, reads kept for the snapshot only | Deploy #1929 Rules to nonprod Firebase project `eos-platform-sandbox` (explicit `--project`), verify live, then quiescence → census → COPY ONCE → verify → activate → Render → Vercel → retire → browser E2E | **External:** live Rules deploy/verification requires authenticated Firebase operator access; no CI deploys Rules. COPY and PG activation remain **HOLD** until done. |
| **Employee / Workforce** (#1930 → #1931 W1A) | PostgreSQL reads; Firestore Employee profile writer still reachable | #1931 authorized and queued | W1A PG Employee profile command → W1B Render transport → W1C UI cutover + Firestore writer retirement | #1931 runtime execution recorded `BLOCKED_EXECUTION` (no execution capability); **no patch produced** — work to be done through the normal PR flow. Must not block CRM. |
| **Catalog / Supplier / Registry** | PG writers / copy-once / verify merged; per-environment cutover evidence absent | tooling merged | starts after CRM reaches stable PG authority | — |
| **Commercial** (C5) | Firestore-era Opportunity/Agreement/Order; C5 tooling merged **NOT RUN** | tooling merged | after Catalog | depends on CRM + Catalog |
| **Work Orders / Service** | Firestore / Firebase Functions | #1915 assignment census (design input) | PG Work Order + assignment authority | — |
| **Authorization v2 / session** | Principal/Membership/policy in PG; Firebase Auth proves identity | foundations exist | v2 model, OIDC bindings, EOS sessions, single evaluator | — |
| **Zero-Firebase closure** | — | — | after domain + identity cutovers | — |
| **Training** | — | — | **last**, after production cutover and Owner signoff | — |

Environment fences: Production and Certification untouched; no dual write; no Firebase fallback; `.firebaserc` default project is never relied upon.

## Execution strategy — owner-approved hybrid migration

The platform reset is executed through [`2026-09-16-parallel-v2-sandbox-cutover-strategy.md`](2026-09-16-parallel-v2-sandbox-cutover-strategy.md).

**Current EOS remains running and authoritative while the new identity/session/authorization/PostgreSQL/Render control plane is built beside it.** The default is to reuse the current application code and accepted business behavior rather than maintain a second independent EOS product.

Bounded modules may be routed to independently addressable v2 APIs in nonproduction after their replacement authority is proven. A full cloned v2 UI/application is permitted only when shared-code isolation cannot reliably prove parity; if used, it is temporary migration scaffolding with an explicit convergence/removal gate.

No domain moves merely because v2 code exists. Each bounded authority must pass current-state census, isolated replacement, shared-code compatibility where applicable, deterministic parity, connected scenarios, data reconciliation, one-writer cutover, running-application acceptance, and rollback/soak gates before the old path can be retired.

Broad dual-write is not the default. One system remains the business writer until a controlled cutover.

## Protected completed-domain guardrail

Parts / Inventory / Warehouse / Bin / Truck / Mobile Location / Purchasing / Receiving / Transfer / Cycle Count and Work-Order inventory-effect convergence is additionally governed by [`2026-09-16-parts-inventory-truck-parity-fence.md`](2026-09-16-parts-inventory-truck-parity-fence.md).

That fence is mandatory for Authorization v2, PostgreSQL, Render, zero-Firebase, migration, mobile/PWA, and Administration work that touches those domains. The platform reset is a **semantics-preserving migration by default**, not authorization to redesign already-completed business behavior. Any material business-behavior change requires separate explicit review/Owner authorization.

Parts/Inventory/Truck is a protected mature operating family and is **not the proving ground for v2**. It should be cut over only after the new platform pattern has already been proven on lower-coupling domains.

Older dated roadmaps/reconciliations remain historical evidence. They must not override this current pointer when they describe an earlier architecture or implementation state.

## Maintenance rule

When a merge changes a major object's canonical authority, database/source of truth, runtime read/write path, migration/cutover status, or a business process's material maturity, update the current reconciliation (or replace it with a newer dated reconciliation and update this pointer).

Do not report:

- code merged as data cut over;
- migration tooling as migration executed;
- a UI as a completed business process when its governed backend action is unavailable;
- a legacy path as retired until it is actually unreachable/removed;
- a technical cutover as permission to redesign protected Parts/Inventory/Truck business semantics;
- EOS v2 existence as permission to alter current EOS before parity and cutover gates pass;
- a full duplicate application as the default v2 strategy when shared application code can be safely reused.
