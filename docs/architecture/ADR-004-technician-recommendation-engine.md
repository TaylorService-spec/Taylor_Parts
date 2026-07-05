# ADR-004 — Technician Recommendation Engine (v1 Realistic)

Status: Accepted (Revised Design)
Phase: Epic 2C (Dispatcher Operations Board)
Supersedes: Initial ADR-004 draft (same PR, not merged -- this revision replaces it in place rather than adding a second file)
Depends on:

- `fieldops_wos` (Work Orders source of truth)
- `transitionEngine.ts` (lifecycle authority)
- `workOrderService.ts` (write path)
- `useWorkOrders()` (read aggregation layer)

**Design-stage only.** This ADR documents an accepted design; no implementation exists yet. Nothing in `functions/src/` or `field-ops-app-vite/src/` implements any part of this ADR as of this writing.

Numbering note (unchanged from the initial draft): renumbered to ADR-004 because `ADR-003` is already taken (`docs/architecture/ADR-003-inventory-trigger-system.md`, Epic 2D's Inventory Trigger System). `ADR-001` doesn't exist as a real file in this repo either -- ADR-004 is the next real, unused number.

Verified against the actual current schema before being saved: `createTechnician(name, phone)` (`domain/jobActions.js`) confirms technician docs really do only have `name`/`phone`/`status` -- no certifications, skills, or territory fields exist anywhere, matching this revision's "no structured technician profile system exists yet" claim exactly. `WorkOrder.type` (`SERVICE_CALL`/`PM`/`INSTALL`/`WARRANTY`/`INSPECTION`) is a job-category enum, not a dedicated "equipment type" field -- usable as a loose proxy for the Assignment History Affinity factor below, but it's an approximation, not a literal equipment match; the ADR's own "(if present)" hedging on that factor already accounts for this.

## 1. Context

Dispatchers currently assign technicians using:

- visual inspection of Work Orders
- workload intuition
- manual experience
- ad hoc knowledge of technician availability

There is no structured recommendation system.

We introduce a lightweight, deterministic recommendation layer to improve dispatch speed and consistency.

## 2. Decision

We will implement Technician Recommendation Engine v1 (TRE-v1) as:

a heuristic ranking system based only on existing operational data in Firestore

It will:

- rank technicians per Work Order
- provide explainable scoring
- remain fully non-blocking (recommendation only)
- require no backend schema changes

## 3. Critical Constraint (Reality-Based)

🚨 TRE-v1 MUST operate only on existing data

We explicitly DO NOT assume:

- certification database
- skills taxonomy
- GPS proximity engine
- truck inventory linkage
- customer preference system
- historical performance scoring model

Any of these are future enhancements only.

## 4. Principles

### 4.1 Recommendation only

The system suggests. The dispatcher decides.

- No auto-assignment
- No forced ranking enforcement
- No backend validation of recommendation output

### 4.2 Deterministic & explainable

All scores must be:

- deterministic
- reproducible
- explainable per factor
- derived from Firestore data only

### 4.3 No new schema required

TRE-v1 must function without:

- Firestore schema migration
- new collections
- new Cloud Functions
- new indexing requirements

## 5. Available Data (REALITY CHECK)

### 5.1 Work Order Data (`fieldops_wos`)

Available fields:

- status
- priority
- assigned technician (if present)
- equipment info (partial structured usage)
- required parts (via inventory snapshot layer)
- timestamps (created, updated, etc.)
- customer metadata (limited)

### 5.2 Technician Data (existing system reality)

Currently available only through:

- user identity (UID, role)
- assignment history inferred from Work Orders
- current workload derived from active WOs

❗ No structured technician profile system exists yet (`createTechnician(name, phone)` -- confirmed, only `name`/`phone`/`status`)

### 5.3 Derived Data (computed at runtime)

We can compute:

- active work order count per technician
- completed work order count per technician
- recent assignment frequency
- workload pressure indicator

## 6. Scoring Model (v1 Realistic)

### 6.1 Core Factors

TRE-v1 uses ONLY these signals:

**A. Workload Balance (Primary Signal)** -- fewer active WOs = higher score

Derived from: count of `fieldops_wos` where `status` ∉ terminal states

Weight: 40%

**B. Assignment History Affinity (Soft Experience Proxy)** -- technician frequently assigned similar WOs → higher score

Derived from: past Work Orders assigned to technician, similarity via `WorkOrder.type` (job-category enum, not a dedicated equipment field -- see numbering note above)

Weight: 25%

**C. Status Availability Signal** -- technician with fewer "active" states is more available

Derived from: current non-completed WOs

Weight: 20%

**D. Territory / Logical Proximity (if present in WO)** -- basic region/sub-region match if available

Derived from: Work Order `locationId` field (a string identifier, not lat/lng -- no `geo` field exists on Job or Work Order yet)

Weight: 15%

### 6.2 Explicitly NOT INCLUDED in v1

These are acknowledged but excluded:

- certifications (no structured data exists)
- skills taxonomy (not modeled)
- truck inventory / parts readiness
- customer preference
- GPS routing / distance calculation
- SLA prediction
- ML scoring

## 7. Output Contract

```ts
type RecommendedTechnician = {
  techId: string
  score: number // 0-100
  rank: number

  breakdown: {
    workload: number
    experienceAffinity: number
    availability: number
    territoryMatch: number
  }

  reasons: string[]
}
```

## 8. System Architecture

### 8.1 Placement

```
UI (Dispatcher Board)
    |
recommendTechnicians(workOrder)
    |
pure scoring function (client-side)
    |
useWorkOrders() aggregated data
```

### 8.2 Stateless design

TRE-v1 is:

- stateless
- recalculated on data refresh
- not persisted
- not cached in Firestore

## 9. UI Behavior Requirements

### 9.1 Ranking display

Technicians shown as:

- ordered list (highest score first)
- score badge (0-100)
- top 3 highlighted

### 9.2 Explainability (required)

Clicking a score reveals:

- workload contribution
- assignment history contribution
- availability contribution
- territory match contribution

No hidden scoring logic.

### 9.3 Recommendation is advisory only

- drag/drop dispatch remains primary action
- recommendation never blocks assignment
- dispatcher always overrides system ranking

## 10. Non-Goals (Explicit)

TRE-v1 does NOT include:

- auto-dispatch
- scheduling optimization
- route planning
- ML or predictive scoring
- SLA enforcement
- real-time geolocation tracking
- technician certification system
- inventory-driven assignment logic

## 11. Future Extensions (Post v1)

- **v2**: structured technician profiles, certifications model, skills taxonomy
- **v3**: GPS-based proximity scoring
- **v4**: parts availability integration
- **v5**: predictive SLA risk scoring

## 12. Acceptance Criteria

TRE-v1 is complete when:

- [ ] technicians are ranked per Work Order using ONLY existing data
- [ ] scoring is deterministic and reproducible
- [ ] no Firestore schema changes required
- [ ] no backend changes required
- [ ] explainability panel is available
- [ ] dispatcher override remains primary interaction
- [ ] system degrades gracefully when data is missing

## 13. Architectural Guarantee

TRE-v1 is a heuristic decision-support layer, not an intelligence system.

It must never:

- infer missing structured data
- assume future schema exists
- enforce assignment decisions
- evolve into a hidden workflow engine

## 14. Summary

This version of ADR-004 aligns the recommendation engine with actual Firestore reality:

- uses only existing operational signals
- avoids phantom data dependencies
- remains fully UI-side and non-invasive
- sets a safe foundation for future structured technician modeling
