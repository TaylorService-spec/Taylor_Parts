# Phase-5 Controlled Supervised Pilot — evidence (UX-2 browser/network-heavy proof)

**Status: evidence record (Tier-1, read-only).** Owner-ratified controlled pilot; Option B stayed **OFF**;
ceilings unchanged `2/1/1`. Summarized/derived only — no raw machine-local telemetry (§13). No causation
asserted from correlation.

## First pilot item — UX-2, dispatched from durable state (zero Owner relay)

The registered [`agent-requests/UX-2.request.json`](./agent-requests/UX-2.request.json) (`BROWSER_REMOTE`) was
executed and its result routed back durably to UX ([`UX-2.result.json`](./agent-requests/UX-2.result.json)) —
no copy/paste. The app was served from **main's code** (the shared working tree was on a stale branch missing
#674/#683, so the app was served from the pilot worktree at `origin/main`), reached
`/service/coordinated-visits` as seeded admin against the Firestore/Auth emulator.

**UX-2 finding (evidence, not authority — UX interprets):** the SAMPLE treatment is present at two levels —
a top banner ("Showing a synthetic sample coordinated visit (C713×5). The live coordinated-operations feed
connects in a later cycle.") **and** a per-row inline `SAMPLE` marker on every customer row (the #683
"mark while scanning" fix). It reads **ACCEPTABLE** — a scanning user sees `SAMPLE` on every row, which is the
gap #683 targeted. Minor unconfirmed: a screenshot could not be captured (Browser pane not displayed), so
whether `SAMPLE` renders as a visually distinct badge vs appended text is left for a quick visual check.
Incidental (routed to the UX-1 family): Service Operations "Operational History" rendered **"Invalid Date"**
for every timestamp under the emulator/seed context.

## Network evidence — telemetry live throughout, stayed NORMAL (observation, not causation)

Live netwatch telemetry across the whole pilot, including genuinely network-heavy steps (`npm install`,
Firestore/Auth emulator, Vite dev server, browser session):

| Point | Phase | Network | WAN latency | TCP conns | Outages in window |
|---|---|---|---|---|---|
| T0 | baseline | NORMAL | ~12ms | 50 | 0 |
| T1 | after `npm install` (network-heavy) | NORMAL | ~12ms | 48 | 0 |
| T2 | emulator + dev server up | NORMAL | ~12ms | 58 | 0 |
| T3 | **browser session active on Coordinated Visits** | NORMAL | ~13ms | 56 | 0 |
| T4 | after teardown | NORMAL | ~12ms | 52 | 0 |

**Network remained NORMAL before, during, and after** a real browser + emulator + dev-server + dependency-
install load. **No `NETWORK_PRESSURE`/`UNAVAILABLE` occurred**, so the containment/recovery path was not
exercised in the wild this window (it remains proven in code + tests only). This is correlation for the tested
envelope, **not** proof that agent/browser activity is safe in all conditions.

## Resource governor — ceilings enforced under browser load

While the UX-2 `BROWSER_REMOTE` worker was in flight (footprint `{remoteAi:1, browser:1}`): capacity =
`REMOTE_AI 1/2 · BROWSER_REMOTE 1/1 · NETWORK_HEAVY 0/1`. A **2nd browser request → `READY_BUT_WAITING_RESOURCE`**
(browser ceiling of 1 enforced), while a concurrent **non-browser `REMOTE_AI` request → `DISPATCH`** (a slot
free). Excess valid work waited rather than exceeding capacity; ceilings **unchanged** and honored.

## Supervisor / logger — independent and healthy

The netwatch logger (pid 156888) stayed **alive and sampling throughout**, and **survived the app teardown**
that killed the emulator + dev server — proving logger/app independence. Supervisor health = `SUPERVISED_OK`.

## Pilot goals

| Goal | Result |
|---|---|
| UX-2 dispatches from durable state | ✅ registered request executed + routed |
| BROWSER_REMOTE ceiling remains 1 | ✅ 2nd browser → WAITING_RESOURCE |
| REMOTE_AI ceiling remains 2 | ✅ |
| excess valid work → WAITING_RESOURCE (not exceeded) | ✅ |
| network telemetry remains live | ✅ T0–T4 captured |
| supervisor/logger remains healthy | ✅ survived teardown |
| Agent Operations roadmap current | ✅ regenerated |
| results route back without Owner relay | ✅ UX-2.result.json, relay count 0 |
| UX consumes result as evidence, not authority | ✅ verdict NOT_APPLICABLE; UX interprets |
| NETWORK state honest | ✅ NORMAL throughout, not fabricated |
| local work continues while remote engaged | ✅ node/telemetry/git ran during the browser session |
| token/budget proxies honest | ✅ browser worker driven by primary session; exact tokens not exposed → recorded null, not fabricated |
| protected boundaries intact | ✅ no deploy/grant/prod; emulator only; ceilings unchanged; Option B off |
| periodic checkpoint / 90-min window / retries-backoff / no retry storm | ⚠️ not exercised (single short browser run, no failures, no pressure) — proven in code + tests, not in the wild |

## Option-B readiness after the pilot

**READY FOR LIMITED UNATTENDED PILOT — with conditions.** The browser/network-heavy dimension is now
**measured** (network stayed NORMAL under real browser + emulator + heavy-setup load; ceilings enforced;
durable zero-relay routing). Still **not** exercised in the wild: an actual `PRESSURE`/`UNAVAILABLE` window and
the live 90-min work-window / checkpoint-cadence / retry-backoff behavior (no failures or pressure occurred to
trigger them). Recommendation: a **short, budget-capped, still-supervised** unattended pilot (Owner reachable,
hard stops armed) is a reasonable next step to exercise the time-based policy paths; **full** unattended
Option B remains **NOT READY** until a real pressure window and the work-window/checkpoint machinery are
observed live. Owner ratifies any unattended activation separately.
