# EOS Owner Control Plane + Governed AI Collaboration — Claude Completeness Review

**Perspective:** Claude / execution side (§34–§35). This is a check-and-balance on the
Owner/ChatGPT architecture, not a confirmation. It traces `origin/main` and the existing
orchestration authorities first, then classifies every proposed capability. Agreement is
not the goal; a more complete and trustworthy operating model is.

**Grounding trace (origin/main `d4ba08b`, `docs/orchestration/lib/`):**
- `agentRequest.mjs` — `REQUEST_STATUS` = PENDING·VALIDATED·DEDUPED·READY_BUT_WAITING_RESOURCE·WAITING_NETWORK·DISPATCHED·RUNNING·COMPLETE·FAILED·REJECTED·RETRACTED; `requestFingerprint`; `AGENT_MODES`; `EXECUTION` (REMOTE/LOCAL).
- `agentResult.mjs` — `RESULT_STATUS` = COMPLETE·FAILED; `contaminated`/`retracted`; `isReusableResult`. **No consumption/disposition lifecycle.**
- `agentManager.mjs` — `decideDispatch` (REJECT_INVALID·DEDUPE_REUSE·WAIT_NETWORK·READY_BUT_WAITING_RESOURCE·DISPATCH); `findEquivalentResult`; `efficiencyMetrics`.
- `resourceGovernor.mjs` — global `CAPACITY` REMOTE_AI=2 / BROWSER_REMOTE=1 / NETWORK_HEAVY_REMOTE=1 / MUTATING_REMOTE=1; `classifyResourceNeed`; `allocate`.
- `networkState.mjs` + `networkHealthAdapter/Loader.mjs` — sanitized telemetry, fail-closed.
- `selectNextWork.mjs` — `WORK_STATES` + `DECISIONS` (RUN·PREREQUISITE_AVAILABLE·WAIT_RESOURCE·CHECKPOINT·ROADMAP_COMPLETE). **Operates on a pre-computed `items[]`; never inspects agent results.**
- `roadmapModel.mjs` (authority) → `roadmapProjection.mjs` → `controlCenterAdapter.mjs` (versioned envelope) → `controlCenterContract.mjs` (`freshnessState`) → keystone renderer.
- Continuation: `loop-continuation-driver.md` — Option A is **in-session `/loop` + `ScheduleWakeup` only**; "no scheduler service, no database"; unattended/no-session self-scheduling is the explicitly-unbuilt next stage.

---

## Thesis (the one honest conclusion the design must absorb)

The proposed model separates cleanly into **two layers that live on opposite sides of an
authority/runtime boundary**:

- **Layer 1 — Durable contracts + projections + consumption logic.** Repo-safe, buildable
  now, within existing authority, no credentials, no deploy. This is where almost all
  *durable value* lives: the request/response/decision contracts, dispositions, the §23
  selector correction, the cockpit/Since-Last-Visit/AI-governance/interruption
  *projections* of the existing envelope, and the freshness/refresh contract.

- **Layer 2 — Transport + triggers + identities + notification sender.** The part that
  makes AI↔AI collaboration *automatic* and reaches the Owner's phone. **None of it is
  achievable end-to-end in the current runtime.** It requires deployed Functions/Cloud
  Run, a **ChatGPT API credential (paid service)**, least-privilege service identities,
  and — for the reciprocal path — a mechanism that can make Claude *act* without a human
  starting a session. All Owner/operator-gated.

**Consequence:** v1 should ship Layer 1 in full and represent Layer 2 as proven-separately
integration seams. The Owner's own rule (§18/§19: "Never claim seamless integration until
both ACCESS and TRIGGER are proven end-to-end") is exactly right and must be enforced by
the architecture, not aspired to. **`Silence != approval` cannot be guaranteed by hoping
the transport delivered — it must be enforced by durable disposition + escalation timers
that default to NEEDS_OWNER when a response never arrives.**

---

## CONFIRMED — sufficiently covered by this design / existing authority

- **Firebase v1 (Model A)** (§2) — matches what EOS already governs (Auth + Firestore +
  Rules + trusted publisher). Browser read-only for project truth is preserved by the
  existing adapter→envelope boundary. No new hosting provider. **Confirmed.**
- **Prepare ≠ deploy for the hosted package** (§3, CASE 2) — already how #738/#739/#10
  shipped. Confirmed and encoded as a triage regression test below.
- **Auto-resolved launcher questions** (§4, CASE 3) — reachability-only probe; the app owns
  auth; a 200 is not authenticated access; an *authorization* failure must NOT silently
  fall back to local as if it were a network failure. Confirmed — this is a **one-line
  correction to the shipped launcher** (see FAILURE/RECOVERY #F4).
- **Three request types share infra but not authority class** (§13) — correct; the existing
  `agentRequest` envelope is the right shared substrate (see DUPLICATIVE).
- **DRAINED is legitimate; do not manufacture work** (§7, §24) — already the ratified
  terminal-checkpoint rule. Confirmed.
- **Ceilings unchanged 2/1/1; no authority expansion; overnight still NOT authorized**
  (§30) — confirmed and non-negotiable.
- **Evidence hierarchy + governing principles** (§17, §33) — consistent with the existing
  "AGENT OUTPUT ≠ PRODUCT AUTHORITY" rule. Confirmed.

---

## MISSING — add before the target model can work reliably (classified)

| # | Capability | Why the current model is insufficient | Class |
|---|---|---|---|
| M1 | **Result consumption/disposition lifecycle** (§23) — `agentResult` has no ROUTED/AWAITING_INTERPRETATION/CONSUMED/REJECTED/STALE/CONTAMINATED state, and `selectNextWork` never inspects results. A valid unconsumed result is invisible → false terminal checkpoint (the exact observed defect). | Repo-safe pure logic; no gate; fixes a live defect. | **MUST_HAVE_BEFORE_PILOT** |
| M2 | **Escalation timer / "silence ≠ approval" enforcement** (§14) — a material AI-to-AI or Owner request with no response must, after a bounded interval, become NEEDS_OWNER, not sit silently. Without this the whole no-relay model can strand a decision forever. | Repo-safe contract + a durable `respondBy`/`escalateAfter` field + selector visibility. The *timer firing* needs a running loop or Layer-2 trigger. | **MUST_HAVE_BEFORE_PILOT** (contract) / trigger is FUTURE_SEAM |
| M3 | **Idempotency + delivery-status on requests/responses** (§14, §34) — no `deliveryStatus`/`ackId`/dedupe key spanning the AI bridge; duplicate or out-of-order delivery would double-act. | Extend the request/response contract (fingerprint already exists for WORK). | **MUST_HAVE_BEFORE_PILOT** (contract) |
| M4 | **Owner Decision Request model + triage classes** (§9, §10) — no durable decision record; chat is not authoritative. Triage (AUTO_RESOLVED / RECOMMEND_OWNER / NEEDS_OWNER / OWNER_AUTHORIZATION) is undefined in code. | Repo-safe contract + pure triage function + regression tests (CASE 1–3). | **MUST_HAVE_BEFORE_PILOT** (contract) |
| M5 | **Refresh-that-refetches + full freshness states** (§6) — `freshnessState` exists but only computes CURRENT/STALE/UNKNOWN/INCOMPATIBLE; NOT_AUTHORIZED is absent, and local refresh currently requires a manual Node import / server restart. | Add NOT_AUTHORIZED; a no-terminal local refresh path (server endpoint that re-runs the adapter). Repo-safe. | **MUST_HAVE_BEFORE_PILOT** |
| M6 | **Cockpit / Since-Last-Visit / AI-governance / Owner-interruption projections** (§7, §8, §27, §28) — the envelope has no cockpit rollup, no visit delta, no AI-collab counters, no interruption metric, no BUILT/INERT/DEPLOYED/USER_OPERABLE/PROTECTED/UNKNOWN operability axis. | New *projections* of existing state (reuse the adapter). Repo-safe. | **SHOULD_HAVE_SOON** |
| M7 | **AI collaboration bridge — transport** (§15, §16, §18A, §19) — no way for a request to reach ChatGPT or for its response to reach Claude. | Needs a deployed narrow collaboration API (Function/Cloud Run) + a ChatGPT API credential (paid) + service identity. Cannot be built repo-safe. | **FUTURE_SEAM** (Owner-gated infra) |
| M8 | **Bridge — triggers, both directions** (§18B, §19) — even with transport, ChatGPT can't watch Firestore idle and **Claude cannot be woken by a Firestore write** (in-session `/loop` only). | Needs external scheduled compute that (a) invokes the ChatGPT API and (b) starts/feeds a Claude runner. Runtime-limited. | **FUTURE_SEAM** (proven separately per §18) |
| M9 | **Trusted notification sender** (§21) — must be server-side, not dependent on the Owner's browser being open. | Deployed Function + notification identity + email provider. Not repo-safe. | **FUTURE_SEAM** (Owner-gated) |
| M10 | **Least-privilege service identities** (§20) — publisher / bridge / notification separation is undefined. | Design is repo-safe (doc + IAM plan); *creating* identities/keys is Owner/operator-gated. | **SHOULD_HAVE_SOON** (design) / provisioning FUTURE_SEAM |
| M11 | **Process-improvement lifecycle register** (§24) — OBSERVED_FRICTION→…→MEASURED has no durable home. | Repo-safe register + rule "improvement must originate from evidence, never authority expansion." | **SHOULD_HAVE_SOON** |
| M12 | **Token/AI-capacity governed-resource seam** (§25) — governor models network/browser/remote-AI but not AI token capacity; weekly allowance is material. | Add a capacity *dimension* + honest-proxy projection. **Runtime does not expose main-loop tokens** (only per-subagent), so headline weekly usage is UNKNOWN. | **SHOULD_HAVE_SOON** (proxy) — see TOKEN RISKS |

---

## DUPLICATIVE — reuse an existing authority instead of adding a parallel one

- **Do NOT build three request subsystems** (§13). Extend the existing `agentRequest`/
  `agentResult` envelope with a `requestType` (WORK / AI_REVIEW / OWNER_DECISION) and an
  `authorityClass` discriminator + the M1 disposition lifecycle. One ledger, one
  fingerprint/dedupe, one provenance model — three meanings. The Owner's §13 ("may share
  IDs/provenance/routing/audit/dedupe") already points here.
- **Do NOT create a second queue for unconsumed results** (§23 says so explicitly). M1
  feeds the **existing `selectNextWork`** as ordinary READY "interpret result X" items.
- **Do NOT add a second roadmap/registry/telemetry/governor.** Cockpit, Since-Last-Visit,
  AI-governance, and Owner-interruption are **projections** of the existing
  `roadmapModel` + agent ledger + telemetry, rendered by the existing keystone. The
  Control Center adapter stays the single envelope authority.
- **Do NOT add a second token governor.** M12 is a new *dimension* on `resourceGovernor`,
  not a new module.
- **Do NOT add a second continuation mechanism.** The AI bridge's Claude-side consumption
  must route through the same selector/`/loop`, not a bespoke poller.

---

## RUNTIME LIMITATIONS — cannot be performed end-to-end today; represent honestly as seams

- **R1. Claude has no autonomous trigger.** Continuation is in-session `/loop` +
  `ScheduleWakeup`; a Firestore write, a ChatGPT response, or an Owner decision made on a
  phone **cannot wake Claude** on its own. Until Layer-2 exists, "ChatGPT→Claude becomes
  actionable with no Owner relay" is only true *while a session/loop is already running and
  polling*. (§16, §19 — FUTURE_SEAM, must be proven separately.)
- **R2. Claude cannot invoke ChatGPT.** There is no ChatGPT/OpenAI tool in this runtime,
  and standing policy is that the Owner is the sole Claude↔ChatGPT conduit. The bridge
  therefore cannot be exercised by Claude alone; it needs external compute holding a paid
  API credential. (§15 — FUTURE_SEAM.)
- **R3. ChatGPT cannot watch Firestore idle** (Owner-acknowledged, §18). Its trigger is a
  separate unsolved capability from its access.
- **R4. Main-loop token usage is not runtime-exposed.** Only per-subagent tokens are
  visible (already recorded in `agentResult.metrics`, "never fabricated"). Weekly-allowance
  headline numbers are **UNKNOWN** unless the Owner supplies account metrics. (§25.)
- **R5. Notification delivery cannot depend on a browser.** Server-side sender is Layer-2.
- **R6. Session-only state.** Anything an agent "knows" that isn't written to the durable
  ledger/roadmap does not survive context loss — which is *why* M1–M4 must be durable files,
  not in-session structures. (This is the root cause of the §23 defect.)

---

## SECURITY / AUTHORITY RISKS

- **S1. Bridge scope creep.** A collaboration API must expose only
  `listPendingRequests/getRequest/submitResponse/acknowledgeResponse` over the bridge
  collection — **never arbitrary Firestore access** to ChatGPT or Claude (§18A, §20). Any
  broader grant is an authority expansion and must be refused.
- **S2. Response authority laundering.** A ChatGPT `CONCUR` or an Owner decision arriving
  over the bridge must not be treated as *execution authority* for a protected action —
  it authorizes the *decision*, the protected action still passes its own gate.
  (`Discussion != authorization`, `AI recommendation != authority`.)
- **S3. Publisher over-scope.** The publisher identity must write only sanitized envelopes
  + the request data it owns — not general Taylor production authority (§20).
- **S4. Credential exposure.** No service-account key in the browser; prefer workload
  identity over long-lived local JSON keys (§20). The ChatGPT API credential is a new
  paid secret with its own custody question — **Owner decision**.
- **S5. Auto-authority ratchet.** `autonomous authority expansions MUST remain 0` (§27).
  The improvement loop (§24) and "EOS evolving itself" must be fenced: capability growth
  never widens authority. Encode this as an invariant, not a guideline.

---

## FAILURE / RECOVERY GAPS

- **F1. Orphaned request.** Without M2's escalation timer + M3's delivery status, a request
  can sit REQUESTED forever with both AIs believing the other owns it. Default-to-NEEDS_OWNER
  on timeout is the backstop.
- **F2. Duplicate / out-of-order / replay.** M3 idempotency keys + the existing fingerprint
  dedupe must cover the bridge, or a redelivered response double-acts.
- **F3. Partial publish / stale board.** On refresh failure, preserve last-known-good, mark
  STALE, explain (§6) — `freshnessState` supports this but the refresh *path* (M5) must
  wire it; never infer CURRENT because the page loaded.
- **F4. Launcher authorization-vs-network conflation** (§4A) — the shipped launcher treats a
  non-200 hosted probe as "unreachable → local fallback." An auth **redirect** must be
  distinguished from a network failure so an authorization problem isn't silently masked by
  local mode. One-line correction to `launcher.ps1`. **MUST_HAVE_BEFORE_PILOT.**
- **F5. Auth expiry / identity rotation** (§34) — hosted session expiry must surface as
  NOT_AUTHORIZED (M5), not as STALE or a blank board.
- **F6. Recovery after interruption.** M1–M4 being durable files means a killed session
  resumes from the ledger; verify the selector re-derives interpretation work from
  persisted dispositions on cold start.

---

## SCALE / PORTFOLIO GAPS

- **P1. projectId is present but ownership is not modeled.** Preserve `projectId` +
  project-owner + portfolio-owner as seams now (§26); do **not** build multi-tenant infra.
  The envelope already carries `source.projectId` — extend with an owner reference, gate
  reads per project (Model A Rule already keys on `{projectId}`).
- **P2. Bridge + notification identities must be per-project-scopable later** — design the
  collaboration API path/collection with a project dimension so a second Owner's traffic is
  isolable without redesign.
- **P3. Cockpit must not assume a single project** — the "one overall completion %" the
  Owner forbids (§7) would also break portfolio rollup; keep the operability axes discrete.

---

## TOKEN / RESOURCE RISKS

- **T1. Bridge polling is a token/compute sink.** "Do not aggressively poll" (§6) applies to
  the AI bridge too. A Claude loop that wakes only to check an empty bridge burns capacity
  for nothing. Prefer event/trigger (Layer-2) over tight polling; when polling is the only
  option, widen the interval and log what was skipped.
- **T2. Dedupe/reuse must extend to AI-review requests.** `findEquivalentResult` already
  prevents WORK reruns; the same fingerprint reuse must cover review requests so identical
  architecture questions aren't re-sent to ChatGPT (a paid call).
- **T3. Optimize useful-verified-work-per-token, not activity** (§25, §31). Autonomy should
  degrade gracefully as capacity approaches; never burn remaining capacity to avoid an
  honest checkpoint. Encode as a governor dimension (M12), honestly UNKNOWN where metrics
  aren't exposed (R4).

---

## RECOMMENDED ADDITIONS (only evidence-supported; each classified)

1. **M1 result-disposition lifecycle + selector correction** — MUST_HAVE_BEFORE_PILOT.
   *Repo-safe, no gate, fixes a live defect.* Build first.
2. **M3/M2 idempotency + escalation-timer fields on a unified request/response contract**
   (extend `agentRequest`) — MUST_HAVE_BEFORE_PILOT (contract). *Repo-safe.*
3. **M4 Owner Decision Request + pure triage function + CASE 1–3 regression tests** —
   MUST_HAVE_BEFORE_PILOT. *Repo-safe.*
4. **M5 refresh-refetch + NOT_AUTHORIZED freshness** and **F4 launcher auth/network split**
   — MUST_HAVE_BEFORE_PILOT. *Repo-safe (F4 touches the shipped launcher).*
5. **M6 cockpit/Since-Last-Visit/AI-governance/interruption projections** + M11 improvement
   register + M12 token dimension — SHOULD_HAVE_SOON. *Repo-safe projections.*
6. **M10 service-identity design doc + IAM plan** — SHOULD_HAVE_SOON (design only).
7. **M7/M8/M9 bridge transport + triggers + notification sender** — FUTURE_SEAM. **Requires
   Owner action:** a ChatGPT API credential (paid service), deployed Functions/Cloud Run,
   and service identities. *Route for Owner decision; do not build unilaterally.*

**Items that change Owner authority / product policy / protected boundary / security /
AI-authority — routed for review per §35, NOT adopted unilaterally:**

- Committing to a **ChatGPT API credential + paid usage** and its custody (S4, M7).
- Standing up the **bridge / notification Functions + service identities** (M7–M10) — a
  protected deploy + credential boundary.
- Whether an Owner decision recorded remotely (phone) may **stand as durable authorization**
  for a later protected action, or must be re-confirmed at execution (S2) — a policy call.
- Any mechanism that would let a Firestore write **start/continue Claude unattended** (R1,
  M8) — this is the overnight/unattended autonomy boundary (§30), still NOT authorized.

---

## Reconciliation of the §32 CURRENT RUN board against existing authority

| Board item | Disposition |
|---|---|
| Reconcile architecture vs existing authorities | **This document.** |
| real refresh + freshness | M5 — repo-safe; add NOT_AUTHORIZED; wire refetch. |
| Owner cockpit / Since-Last-Visit / AI-governance / interruption | M6 — repo-safe projections of existing envelope. |
| Owner Inbox / Decision contract / triage | M4 — repo-safe contract + pure triage + CASE tests. |
| AI Review Request + bidirectional lifecycle | Contract repo-safe (extend `agentRequest`); **transport/trigger = M7/M8 FUTURE_SEAM**. |
| ChatGPT ACCESS / TRIGGER; Claude reciprocal ACCESS/continuation | **FUTURE_SEAM** (R1–R3); design the ACCESS API repo-safe, prove nothing until both ends exist. |
| AI check-and-balance contract | Repo-safe (CONCUR/CONCUR_WITH_CORRECTION/NONCONCUR_ESCALATE + evidence hierarchy) — this review is its first exercise. |
| least-privilege identities | M10 — design repo-safe; provisioning Owner-gated. |
| notification policy | Policy repo-safe; **sender = M9 FUTURE_SEAM**. |
| mobile decision experience | Hosted UX (UX workstream, §29) — depends on hosted deploy (Owner-gated). |
| unconsumed Agent Result correction | **M1 — build now.** |
| process-improvement lifecycle | M11 — repo-safe register. |
| token-capacity/governor seam | M12 — repo-safe dimension; honestly UNKNOWN (R4). |
| test / verify / PR / merge / reconcile / selector / continue | Applies per repo-safe increment. |
| Protected Firebase deployment | Remains operator-executed (unchanged). |

**Bottom line for the Owner:** the durable *value* of this phase (contracts, the §23 fix,
projections, triage, freshness) is repo-safe and I can build it within existing authority.
The *automatic AI-to-AI collaboration* the North Star describes is gated on Owner-provided
paid/credentialed/deployed infrastructure and a Claude-trigger mechanism that today does not
exist — so it ships as honest seams, and `Silence != approval` is enforced by disposition +
escalation, never by assuming the wire delivered.
