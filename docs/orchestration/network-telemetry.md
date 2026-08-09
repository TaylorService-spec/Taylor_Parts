# Network Telemetry Integration (Phase 4)

**Status: repo-safe read-only integration (Tier-1).** Integrates the **existing** standalone network logger into
the EOS control plane ([Agent Manager](./agent-manager.md) / Resource Governor) as a **read-only telemetry
source**, to determine the actual safe network/agent operating envelope **before** unattended Option B is
considered. Reuses — does not duplicate — #703/#710/#712/#715/#716/#719/#720. **No second orchestrator, no
second resource governor, no competing network monitor.**

## 1. The logger (reused, not recreated)

`netwatch.ps1` is a standalone Windows PowerShell logger that runs **independently of Claude sessions** and
continues if a session closes. It is not modified by EOS and telemetry measurement never moves inside a Claude
worker — preserving independence so telemetry survives session exit, worker failure, WAN interruption, and
orchestrator restart.

**Discovered contract (live environment, 2026-08-09):**

| Field | Meaning |
|---|---|
| `ts` | `yyyy-MM-dd HH:mm:ss` local time |
| `gw_ms` | gateway `192.168.0.1` ping ms, or `FAIL` |
| `wan1_ms` | `1.1.1.1` ping ms, or `FAIL` |
| `wan2_ms` | `8.8.8.8` ping ms, or `FAIL` |
| `dns` | `ok` / `FAIL` (nslookup `github.com` via `1.1.1.1`) |
| `tcp_conns` | established TCP connection count |

Interval **5s**; each run bounded to 12h then exits; header `ts,gw_ms,wan1_ms,wan2_ms,dns,tcp_conns`;
two WAN targets; `FAIL` failure marker.

**Durable local home (§2).** The logger was found only in ephemeral Claude scratch, so a stable machine-local
EOS runtime home was established: **`%LOCALAPPDATA%\EOS\netwatch\`** (`netwatch.ps1` + `netwatch-standalone.csv`
+ `netwatch.pid`). The script was copied there **unchanged** and runs from there. **Telemetry is never
committed to git** (§13); durable repo evidence contains only sanitized/derived summaries.

## 2. Read-only Network Health Adapter ([`lib/networkHealthAdapter.mjs`](./lib/networkHealthAdapter.mjs))

Pure: `deriveNetworkHealth(csvText, nowMs, opts)` reads recent samples and produces a deterministic result —
`state · confidence · telemetryAvailable · sampleAgeSec · gatewayReachable · wanReachable · dnsHealthy ·
recentLatency · outageSamplesInWindow · connectionCount · evidenceWindow · reasonCodes`. It **never controls,
rewrites, or restarts the logger.** A thin [`networkHealthLoader.mjs`](./lib/networkHealthLoader.mjs) does the
file read at runtime (default `%LOCALAPPDATA%\EOS\netwatch\netwatch-standalone.csv`, override `EOS_NETWATCH_CSV`)
and can emit a **sanitized** committable summary.

## 3. Mapping into the EXISTING Phase-3 states (no new state machine)

The adapter emits the existing governor states ([`networkState.mjs`](./lib/networkState.mjs)):

| Telemetry (obvious facts only) | State | reasonCode |
|---|---|---|
| fresh · gateway+WAN reachable · DNS ok | `NORMAL` | `ALL_HEALTHY` |
| fresh · gateway `FAIL` | `NETWORK_UNAVAILABLE` | `GATEWAY_UNREACHABLE` |
| fresh · gateway ok · both WAN `FAIL` | `NETWORK_UNAVAILABLE` | `WAN_DOWN` |
| fresh · one WAN `FAIL` or DNS `FAIL` | `NETWORK_PRESSURE` | `WAN_PARTIAL` / `DNS_FAIL` |
| telemetry older than the stale window | `NETWORK_PRESSURE` | `TELEMETRY_STALE` (LOW confidence) |
| no telemetry at all | `NETWORK_PRESSURE` | `NO_TELEMETRY` (LOW confidence) |

`RECOVERY` is **temporal**, so it is reused from Phase-3, not reinvented: `reconcileNetworkState(previous,
instantaneous, {stabilityElapsed})` holds in `RECOVERY` after an outage until a stability window elapses.

**PHASE 4A discipline (§5).** States derive from **obvious facts only** — reachability, DNS, staleness.
**Latency values are reported but NOT thresholded**; real `NETWORK_PRESSURE` latency thresholds are gathered
under controlled load first, then proposed/ratified with evidence. Stale/absent telemetry **throttles** new
heavy work (`NETWORK_PRESSURE`) but **never halts** (it is not `NETWORK_UNAVAILABLE`), so a stopped logger
cannot masquerade as a network outage.

## 4. Governor behavior (unchanged limits, §6)

Global conservative limits stay: `REMOTE_AI = 2 · BROWSER_REMOTE = 1 · NETWORK_HEAVY_REMOTE = 1`
(across **all** EOS, not per-workstream) — **not raised in Phase 4.** The existing
[`agentManager.decideDispatch`](./lib/agentManager.mjs) already gates remote dispatch on the network state via
`remotePolicy()`; the adapter simply supplies that state from real telemetry. `NETWORK_UNAVAILABLE` ≠
`WORK_FAILED` ≠ `PRODUCT_BLOCKED` ≠ `OWNER_DECISION` — assignments/results remain durable and recoverable, and
we do **not** aggressively retry or hammer WAN endpoints (the standalone logger already measures recovery).

## 5. Safety / privacy (§13)

Telemetry collects only minimal health metadata (ping latency, DNS ok/fail, connection **count**). It never
collects passwords, credentials, packet contents, browsing contents, or household activity. Raw machine-local
logs are **not** committed; only sanitized/derived summaries appear in the repo.

## 6. Option B still deferred (§14)

Phase 4 is the **proof** that must precede unattended Option B. Agent-Manager automation is **not** unattended
execution. Option B stays gated pending proven resource + network governor stability, budget cap, max work
window, checkpoint cadence, retry/backoff, failure containment, recovery behavior, and unattended-spend control.
