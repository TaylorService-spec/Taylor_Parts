# Census mapping — every visible module → fact family

Format: MODULE · CENSUS FACT ID(S) · DISPLAY LABEL · PERSONA · GOVERNED SCOPE · STATUS. STATUS values: REPORTABLE_NOW / ACTIVATION_REQUIRED / HONEST_UNAVAILABLE. Values in frames are DESIGN FIXTURES.

## Frame 1 — Owner/Admin populated (1a) · frames/01-owner-populated-1440.png
| Module | Census id(s) | Display label | Scope | Status |
|---|---|---|---|---|
| Attention: privileged role requests ×2 | A-1 | "Approve or decline privileged role request" | global admin | REPORTABLE_NOW |
| Attention: access request | A-2 | "Decide access request" | global admin | REPORTABLE_NOW |
| KPI: Accounts | C-1, C-2 | "Accounts · active" | customer.record.read, global | REPORTABLE_NOW (complete server count) |
| KPI: Open work orders | SV-1 | "Open work orders" | rules admin/dispatcher | REPORTABLE_NOW |
| KPI: Scheduled today / past due | SV-3, SV-4 | "Scheduled today · past due" | as SV-1 | REPORTABLE_NOW |
| KPI: Receiving queue | W-1 | "Receiving queue" | inventory.stock.receive (active) | REPORTABLE_NOW |
| KPI: Open POs / discrepancies | P-1, P-6 | "Open purchase orders" | rules admin/dispatcher | REPORTABLE_NOW |
| Chart: WOs by status (h-bars) | SV-1 | "Work orders by status" | as SV-1 | REPORTABLE_NOW |
| Chart: Accounts by status (stacked) | C-1, C-2 | "Accounts by status" | global | REPORTABLE_NOW |
| Chart: Today's service composition (stacked) | SV-3/4/5/6 | "Today's service composition" | as SV-1 | REPORTABLE_NOW |
| Waiting list | P-1, W-6, W-2 | "Waiting / in motion" | mixed, per-domain | REPORTABLE_NOW |
| Chart: Reorder workflow state (h-bars) | W-6 | "Reorder workflow state" | global (owner) | REPORTABLE_NOW ("received this week" row deliberately omitted — G-05) |
| Receiving progress bars + discrepancy | W-2, P-6 | "Receiving progress & discrepancies" | inventory.stock.receive | REPORTABLE_NOW |
| Financial summary | F-1..F-13 cluster | "Financial figures are unavailable" | FIN-004 reach | HONEST_UNAVAILABLE (no reach role) |
| Go to | X-6 | "Go to" | per principal | REPORTABLE_NOW |
| Identity block (rail bottom) | A-4 | initials · name · role context | self | REPORTABLE_NOW |

## Frame 2 — Owner/Admin quiet (1b) · frames/02-owner-quiet-1440.png
Same mappings; action queue empty state is words ("Nothing needs your action right now"), health facts (C-1, SV-1, SV-3, W-1, P-1), waiting (P-1, W-6), gated financial slot (FIN-004), Go to (X-6). No invented work.

## Frame 3 — Dispatcher populated (2a) · frames/03-dispatcher-1440.png
| Module | Census id(s) | Status |
|---|---|---|
| Attention: past due / ready-to-dispatch / conflict / parts-blocked | SV-4, SV-2, SV-5, SV-6 | REPORTABLE_NOW (all ACTION_REQUIRED for dispatcher) |
| KPIs: scheduled today, past due, ready, blocked, completed today | SV-3, SV-4, SV-2, SV-6, SV-10 | REPORTABLE_NOW ("today" = calendar day on completedAt; no week window) |
| Chart: WOs by status | SV-1 | REPORTABLE_NOW |
| Chart: Technician workload today (job counts + conflict overlay) | SV-3 + SV-7 | REPORTABLE_NOW — job COUNTS, not utilisation % (SV-8 FORM); "no working schedule recorded" in words |
| Link: stalled-job risk panel | SV-17 | REPORTABLE_NOW — linked in its own 4-tier vocabulary, never re-badged (X-3) |
| Waiting: in-progress WO, reorders w/ purchasing, received PO unblocking | SV-1, W-6, W-2/SV-6 | REPORTABLE_NOW |
| Completed today list | SV-10 | REPORTABLE_NOW |
| Go to | X-6 | REPORTABLE_NOW |

## Frame 4 — Technician populated (2b) · frames/04-technician-1440.png · Frame 8 — 375 · frames/08-technician-375.png
| Module | Census id(s) | Status |
|---|---|---|
| Attention: start job (allowed action) | T-1, T-6 | REPORTABLE_NOW (own assignment) |
| Attention: unverified offline submission | T-9 | REPORTABLE_NOW (device-local; first-class state) |
| Bucket bar + list: my work today | T-1, T-2, SV-3 | REPORTABLE_NOW — ordered by scheduledStart; no governed "next job" rule claimed (T-3 FORM) |
| All-time performance | T-4 | REPORTABLE_NOW (all-time only; no weekly — T-5 DEF) |
| Scan workflows with reasons | T-7 | REPORTABLE_NOW (capability-derived) |
| Go to | X-6 | REPORTABLE_NOW |

## Frame 5 — Parts Manager populated (3a) · frames/05-parts-manager-1440.png · Frame 9 — 375 · frames/09-parts-375.png
| Module | Census id(s) | Status |
|---|---|---|
| Attention: reorders to assign | W-6 | REPORTABLE_NOW, {type:"location"} scope |
| Attention: over-received PO line | P-6 | REPORTABLE_NOW |
| Attention: unverified submission | T-9 | REPORTABLE_NOW |
| KPIs: reorder queue, receivable POs, discrepancies | W-6, W-1, P-6 | REPORTABLE_NOW |
| KPI: On hand / Available | I-1, I-2, I-3 | ACTIVATION_REQUIRED — rendered GATED (INVENTORY_BALANCE_READ_READY false; AB-1); never a number |
| Chart: reorder by workflow state | W-6 | REPORTABLE_NOW |
| Receiving progress bars | W-2, P-6 | REPORTABLE_NOW (unit progress, no value — ND-27) |
| Insights: stockout risk distribution + days remaining | I-7, I-5 | REPORTABLE_NOW as DERIVED, visibly badged "Derived · not stock truth"; dashboard-tile placement flagged as census §9 Owner decision 4 — panel drops cleanly if ruled out |
| Reorder point mention | I-6 / K-6 | derived figure or "Not established" only (ND-29) |
| Waiting: transfers in flight | I-13 | ACTIVATION_REQUIRED — rendered gated |
| Scan destinations | W-11 | REPORTABLE_NOW |

## Frame 6 — Salesperson activation-aware (3b) · frames/06-salesperson-1440.png
| Module | Census id(s) | Status |
|---|---|---|
| Attention: agreement DRAFT | S-6 | ACTIVATION_REQUIRED (sandbox-active; production gated). No "declined" tile — ND-14 |
| Attention: SO fulfillment attention | S-18 | ACTIVATION_REQUIRED (sandbox-active); governed states only |
| Chart: my opportunities by stage | S-1, S-2 | ACTIVATION_REQUIRED (sandbox composition shown; NO COUNT when employee link missing) |
| No staleness / stage-times note | S-5 | HONEST_UNAVAILABLE (authority gap, stated in words) |
| KPI: my accounts | C-1 | REPORTABLE_NOW |
| Sales figures panel | S-9..S-15, S-4 | HONEST_UNAVAILABLE (FIN-004 + plan/forecast/AOV gaps) — no specimen KPIs |

## Frame 7 — Finance Manager gated (3c) · frames/07-finance-gated-1440.png
| Module | Census id(s) | Status |
|---|---|---|
| Gated state panel | F-1..F-13, §9 decision 1 | HONEST_UNAVAILABLE — finance.read carried, no finance.visibility.* on any role; shell/navigation composition only |
| "When reach exists" panel | F-13, F-11, F-5, F-12 | design annotation, not a claim |
| Available now: accounts | C-1 | REPORTABLE_NOW |
| Go to (Financials dashed) | X-6 | REPORTABLE_NOW (zero-reach destination shown disabled with reason) |

## Frame 10 — Owner/Admin 375 · frames/10-owner-375.png
Recomposition of frame 1: action queue first, 2×2 KPIs, service composition bar, waiting, Go to. Same census ids.
