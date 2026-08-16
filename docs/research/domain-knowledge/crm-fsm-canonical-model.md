# The canonical CRM / field-service model

**Last researched:** 2026-08-16 · **By:** field-service-domain-researcher (round 1)

**Method:** derived from the official training curricula of the two market leaders — Salesforce
Trailhead (Sales Cloud, Service Cloud, Field Service) and Microsoft Learn (D365 Sales, Customer
Service, Field Service), plus the public **MB-240** exam outline.

**Why a curriculum:** it is effectively a free specification. It reveals the canonical data model,
the workflow the vendor believes in, the vocabulary buyers have already been trained in, and what
is core versus peripheral — a concept with its own module matters; a footnote does not.
**Two independent leaders teaching the same concept is strong evidence it is a genuine primitive
of the domain**, not one vendor's opinion.

## 1. Taught by BOTH — the real primitives

`Account` · `Contact` · `Lead` · `Opportunity` · `Quote` · `Order` · `Case` ·
`Entitlement`/`SLA` · `Asset` (customer equipment) · **`Work Order`** · **`Service
Appointment`** · `Service Resource` · `Service Territory` · `Operating Hours` · `Skill` ·
`Contract`/`Service Contract` · van-stock inventory · `Knowledge Article` · a dedicated
technician mobile app.

## 2. Vocabulary map — the words a buyer already knows

| Concept | Salesforce | Dynamics |
| --- | --- | --- |
| Field job / dispatchable work | **Work Order** | **Work Order** |
| The scheduled visit | **Service Appointment** | **Booking** (schedule board) |
| Technician record | Service Resource | Bookable Resource |
| Competency | **Skill** | **Characteristic** |
| Service area | Service Territory | Territory / Organizational Unit |
| Customer equipment | **Asset** | **Customer Asset** |
| Response commitment | Entitlement / Entitlement Process | **SLA** |
| Recurring preventive service | **Maintenance Plan** (object) | recurring work order / Connected Field Service (pattern) |
| Van/warehouse stock | Product Item | built-in Inventory |
| Scheduling engine | Field Service Optimization | **Resource Scheduling Optimization (RSO)** |

Sources: [Salesforce FS standard objects](https://help.salesforce.com/s/articleView?id=sf.fs_standard_objects.htm) ·
[FS core data model](https://developer.salesforce.com/docs/platform/data-models/guide/field-service-core-data-model.html) ·
[MB-240 outline](https://learn.microsoft.com/en-us/credentials/certifications/exams/mb-240/) ·
[D365 sales entities](https://learn.microsoft.com/en-us/dynamics365/sales/developer/sales-entities-lead-opportunity-competitor-quote-order-invoice)

## 3. The structural rule both teach

**Work Order = *what*. Service Appointment = *when and where*. One work order can have many
appointments.** Salesforce states this directly. Dynamics separates Work Order from Booking the
same way.

Booking a technician requires three matches: **Skill/Characteristic · Territory · Operating
Hours.**

Both ship **manual dispatch** (Dispatcher Console / Schedule Board) and a **separately named
optimizer** as a distinct higher tier — *two capability layers, not one screen.*

## 4. Canonical workflows

**Sales:** Lead → qualify (creates Account + Contact + Opportunity) → Opportunity worked → Quote →
Order → *(Dynamics core)* Invoice.

**Service:** Case → **entitlement/SLA check** → Work Order (+ line items) → Service Appointment(s)
scheduled against Skill/Territory/Hours → dispatch (manual or optimizer) → technician executes on
mobile, consuming inventory against the Asset → completion capture → billing.

**Preventive:** Salesforce uses a `Maintenance Plan` object generating work orders against an
Asset; Dynamics uses recurring work orders / Connected Field Service. **Same capability, different
architecture.**

## 5. Minimum viable data model

Both treat this as the floor before scheduling can happen at all: Account/Contact → Asset → Case
or Work Order → Work Order + line items → Service Resource with ≥1 Skill → Service Territory +
Operating Hours → Service Appointment. Optimization, inventory and entitlements are taught as the
*next* layer, not the floor.

## 6. What both weight most heavily

**Scheduling is the largest tested domain in both certifications** — MB-240 field service
operations **30–35%**; Salesforce FS Consultant scheduling/optimization **~28%**, ahead of Work
Orders (~23%). Two independent vendors both making scheduling the biggest domain is stronger
evidence than either alone: **scheduling correctness is the central competency of field service
software, not a feature among equals.**

## 7. What this changes for us

- **Service Territory as a scheduling boundary decoupled from salesperson** is a named primitive
  in both — this validates the existing Commercial Coverage & Territory requirement as canonical
  rather than scope creep.
- **Skill-based matching** is core to both. Worth checking whether our scheduling has any skill
  concept or only territory and date — commonly missing in smaller systems.
- **Maintenance Plan / recurring preventive service tied to an Asset** is explicit in both.
  Smaller systems commonly omit recurrence entirely. Relevant to the Ventana ice-machine lifecycle.
- **Entitlement/SLA as a gate before service** is a dedicated module and exam domain in both —
  commonly absent or informal in smaller builds. Worth an explicit gap check.
- **Structured completion capture** (Salesforce `Service Report`) is usually the first thing small
  systems skip in favour of free-text notes.
- **Van stock is part of the field-service spine**, not a bolted-on inventory system — validates
  treating Parts as core rather than peripheral.
- **Two-tier dispatch** — manual board *plus* a separately named optimizer. Worth checking whether
  our scheduling surfaces conflate them.

## 8. ASSUMPTIONS

- Salesforce Price Book/Product as core Sales Cloud objects — stated from general knowledge, not
  re-verified from a fetched page this pass.
- That Salesforce keeps Order/Invoice in a separate CPQ/Billing layer while Dynamics treats them
  as core — inferred from what search returned and did not return, not directly confirmed.

## 9. What could NOT be determined

- **Trailhead unit-level content is behind a sign-in wall** — only badge-level summaries retrieved.
- Official Salesforce exam-guide percentages came from a third-party aggregator, not the primary
  PDF.
- **Neither curriculum stated an explicit daily-vs-weekly planning horizon** in the text retrieved.
- Dynamics equivalents for Service Crew and Contract Line Outcome — neither confirmed nor denied.
