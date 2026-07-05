# ADR-004 — Technician Recommendation Engine (Dispatch Decision Support)

Status: Accepted (Design Stage)
Phase: Epic 2C (Dispatcher Operations Board)
Date: 2026-07-05
Supersedes: None
Depends on:

- `transitionEngine.ts` (Work Order lifecycle authority)
- `fieldops_wos` (Work Order source of truth)
- `workOrderService.ts` (write path)

Renumbered from a submitted "ADR-003" to ADR-004 -- `ADR-003` is already taken (`docs/architecture/ADR-003-inventory-trigger-system.md`, the Epic 2D Inventory Trigger System). `ADR-001` doesn't exist as a real file in this repo either (cited historically but never written) -- ADR-004 is the next real, unused number. See `docs/architecture/SYSTEM_AUTHORITIES.md` and `CLAUDE_CONTEXT.md`'s intro paragraph for other instances of this project's docs needing a factual check before being trusted at face value.

**Design-stage only.** This ADR documents an accepted design; no implementation exists yet. Nothing in `functions/src/` or `field-ops-app-vite/src/` implements any part of this ADR as of this writing.

## 1. Context

Dispatchers currently assign Work Orders to technicians using:

- manual inspection of Work Order details
- informal knowledge of technician availability
- visual heuristics (workload, familiarity, proximity)

As the system scales, this approach becomes:

- inconsistent
- non-auditable
- slow under load
- difficult for new dispatchers

We need a decision-support layer that helps rank technicians without automating assignment.

## 2. Decision

We will implement a Technician Recommendation Engine (TRE v1) that:

- ranks technicians per Work Order
- provides explainable scoring breakdowns
- is fully UI-consumable
- does NOT enforce assignment decisions
- does NOT modify backend state logic

## 3. Principles

### 3.1 Recommendation, not automation

The system suggests. The dispatcher decides.

- No auto-dispatch
- No forced assignment
- No backend enforcement of ranking

### 3.2 Explainability required

Every score MUST be explainable:

- No black-box scoring
- Every point must map to a factor
- UI must expose breakdown on demand

### 3.3 Deterministic scoring (v1)

Version 1 must be:

- deterministic
- testable
- config-driven
- non-ML

### 3.4 Configuration-driven weights

Scoring weights MUST NOT be hardcoded in components.

## 4. Functional Requirements

### 4.1 Ranking output

For a given Work Order:

```ts
recommendTechnicians(workOrder): RecommendedTechnician[]
```

Returns:

```ts
type RecommendedTechnician = {
  techId: string
  score: number // 0-100
  rank: number

  breakdown: {
    certification: number
    experience: number
    workload: number
    proximity: number
    skills: number
    partsReadiness: number
    customerPreference: number
  }

  reasons: string[]
}
```

### 4.2 Top-K display

UI will show:

- Top 3 recommended technicians
- Full ranked list available in board view

### 4.3 Explainability panel

Each technician must expose:

- score breakdown
- factor contribution weights
- human-readable explanation strings

Example:

```
Total Score: 86%

+30 Certification match
+18 Low workload
+15 Within territory
+10 Required skills
+8 Parts available
+5 Customer preference
```

### 4.4 Ranking is advisory only

Ranking must NEVER:

- restrict assignment
- block drag/drop
- prevent dispatcher override

## 5. Scoring Model (v1)

### 5.1 Factors

| Factor | Description |
|---|---|
| Certification Match | Technician certified for required equipment |
| Experience | Historical job success with similar equipment |
| Workload | Current active Work Orders |
| Proximity | Geographic/territory proximity (placeholder if GPS unavailable) |
| Skills Match | Required skill tags overlap |
| Parts Readiness | Required parts available in truck/warehouse |
| Customer Preference | Account-specific technician preference |

### 5.2 Default Weights (Configurable)

Stored in `dispatcherScoringConfig.ts`:

```ts
{
  certification: 0.30,
  experience: 0.20,
  workload: 0.15,
  proximity: 0.15,
  skills: 0.10,
  partsReadiness: 0.05,
  customerPreference: 0.05
}
```

### 5.3 Score normalization

- Final score must be normalized to 0-100
- All factors scaled independently before aggregation
- No negative scores allowed

## 6. Data Inputs

### 6.1 Work Order inputs

From `fieldops_wos`:

- equipment type
- required skills
- priority
- customer ID
- location (if available)
- status

### 6.2 Technician inputs (existing or derived)

- certifications
- active workload (from Firestore query)
- completed job history (optional future enhancement)
- territory assignment
- availability status (future phase)

## 7. System Architecture

### 7.1 Placement

```
UI Layer
  |
recommendTechnicians()
  |
scoring engine (pure function)
  |
config (weights)
```

### 7.2 No backend dependency

TRE v1:

- does NOT call Cloud Functions
- does NOT modify Firestore
- does NOT persist scores

### 7.3 Stateless computation

Every call is:

- idempotent
- deterministic
- cacheable (optional future enhancement)

## 8. UI Integration Requirements

### 8.1 Dispatcher Board

Technician column displays:

- ranked list
- score badge
- highlight top recommendation

### 8.2 Work Order Card

Displays:

- Top recommended technician
- Top 3 candidates

### 8.3 Interaction model

- Drag & drop remains primary action
- recommendation only guides selection
- hover reveals "why this tech"

## 9. Non-Goals (Explicit)

NOT included in v1:

- auto-assignment
- scheduling optimization
- route planning
- ML prediction models
- SLA forecasting
- overtime balancing
- dynamic real-time re-ranking engine
- backend enforcement of recommendation

## 10. Future Extensions (Post v1)

Planned evolution path:

- **v2**: real-time workload updates, technician availability signals
- **v3**: GPS-based proximity scoring, travel time estimation
- **v4**: predictive completion time, SLA risk scoring
- **v5**: ML-based ranking model (optional future)

## 11. Acceptance Criteria

TRE v1 is complete when:

- [ ] technicians are ranked per Work Order
- [ ] scores are explainable
- [ ] weights are config-driven
- [ ] dispatcher override is always possible
- [ ] no backend changes required
- [ ] no state machine modifications
- [ ] UI integrates ranking cleanly
- [ ] system remains deterministic

## 12. Architectural Guarantee

The Recommendation Engine MUST NEVER become a hidden workflow engine.

It is strictly:

**Decision support, not decision enforcement.**
