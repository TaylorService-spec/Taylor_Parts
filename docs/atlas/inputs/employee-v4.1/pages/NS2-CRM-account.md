# NS2-CRM-01 / NS2-CRM-02 — Customers List / Account Record
P1 sources: Proposed - Customers List (mockup only), North Star - Account P1 + design_handoff_account/ (grounded in accountNorthStar.js, attention/AR/health projections, PR #1511 page as behavioral evidence).

**What they do.** CRM-01: the one customer collection (Lists grammar; "Customers" and "Accounts" are the same concept — no duplicate destination). CRM-02: the account story — who is this customer, health, what needs attention, then job-shaped sections.

**Roles.** Salesperson (relationship, pipeline), Service Coordinator (locations/equipment/service history), Finance (AR, terms), Owner (health drill-in).

**Record layout schema (desktop)**
```
[Identity + health strip + attention .................]
[Tabs (URL-addressable): Overview | Sales | Service |  ]
[                        Financials                    ]
[Overview: situation, open work, recent story, AI      ]
[account summary (grounded, quiet when not) ...........]
```
Stable default = Overview; deep links may target a tab explicitly (e.g. Finance → Account/Financials) — never capability-switched defaults.

**Role interaction.** Each tab surfaces that role's actions under its own capabilities (new opportunity, new WO, record payment → governed commands on the owning objects). Cross-object journey hub: inbound → account → location → equipment → WO.

**States.** healthy / attention (AR overdue, stale opportunities) / merged-duplicate recovery / denied (per tab, honest).
**Sources.** accountAttentionProjection.js, accountArView.js, accountHealthStrip.js, functions/src/ai/accountModelInterpretation.ts.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
