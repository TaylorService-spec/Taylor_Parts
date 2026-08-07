# `fieldops_jobs` — Evidence-Based Disposition Assessment

**Status:** EVIDENCE COMPLETE · RECOMMENDATION: **RETIRE** · **NO DISPOSITION EXECUTED**
**Owner directive:** 2026-08-07 §2 — "Do NOT assume `fieldops_jobs` can simply be deleted… Return with the evidence-based disposition."
**Method:** static repository analysis + **read-only** production observation (`taylor-parts`). No writes, no deletes, no schema or Rules changes.

---

## 1. Production evidence

Observed read-only on 2026-08-07 against project `taylor-parts`.

| Collection | Count |
|---|---|
| `fieldops_jobs` | **12** |
| `fieldops_wos` (governed Work Order Engine) | **0** |
| `fieldops_technicians` | 8 |

### `fieldops_jobs` shape

| Signal | Value | Reading |
|---|---|---|
| Status distribution | 7 `open`, 1 `in_progress`, 4 `complete` | never worked to closure as a set |
| `createdAt` range | **2026-07-04T02:50Z → 2026-07-06T01:47Z** | all 12 created inside a ~47-hour window |
| `customer` matching a governed `accounts` record | **0 / 12** | every customer value is free text |
| `customer` distinct values | 8 distinct, length 9–22 chars | short labels, not account references |
| `workOrderId` populated | **0 / 12** (field present on all 12, empty on all 12) | the decorative link ADR-002 described was never populated |
| `technicianId` resolving to a real technician | 5 / 12 (0 dangling, 7 empty) | partial assignment only |
| Records carrying demo-only fields (`phase`, `partsRequired`, `partsReserved`) | 3 / 12 | the `heroConfig` demo jobs |
| Governed `accounts` in production | 2 | the customer base itself is not yet operational |

### A correction worth stating plainly

The 4 `complete` records carry no `completedAt`/`completedBy`. That is **not** evidence of
broken or unrecorded completions — `completeAssignedJob.ts:312` documents that *"the job model
has no `completedAt`/`completedBy` fields"*. The governed completion callable writes only
`status` on the job and `status` on the technician.

The correct reading is stronger than a data defect: **the legacy model is structurally
incapable of carrying completion history.** It has no completion timestamp, no completing
actor, and no execution log. It cannot serve as an audit or history record even if we wanted
it to.

---

## 2. Provenance classification

All twelve records are **development/demonstration artifacts**, not business records:

- created in a single ~47-hour window during platform development, not across an operating period;
- zero correspondence to the governed customer master (`accounts`);
- zero populated Work Order linkage;
- three are explicitly the `heroConfig` demo jobs;
- no monetary field exists on the model at all (corroborated by
  `docs/assessments/customer-account-business-model.md`);
- no completion timestamps or actors are structurally possible.

**No record constitutes history, audit, or a business record.** Nothing requires preservation
or transformation on business grounds.

This is consistent with the standing repository position: `docs/assessments/r1-permission-coverage-design.md`
already records that `fieldops_jobs` is *"one half of the R-2/W4 duplicate-domain problem"* and
that a governed permission there *"would **entrench** the model the platform intends to retire."*

---

## 3. Complete reader / writer inventory

Retirement is small in **data** and non-trivial in **surface area**. Every dependency:

### Routed UI surfaces (5)

| Surface | Route | Use |
|---|---|---|
| `modules/mobile/FieldMode.jsx` | Service ▸ Technician Workspace | read (`useAssignedJobs`) + write (`updateJobStatus`) |
| `modules/mobile/PartsScanner.jsx` | inside FieldMode | read (`useAssignedJobs`) |
| `modules/dispatch/Dispatch.jsx` | Service ▸ Dispatch Queue | full-collection read + write (`assignJob`) |
| `modules/controlTower/ControlTower.jsx` | Service Operations | full-collection read |
| `modules/jobs/Jobs.jsx` | Service ▸ (jobs) | read + create (`createJob`) |

### Domain / infrastructure

- `domain/jobActions.js` — `createJob`, `assignJob`, `updateJobStatus` (sole sanctioned client write path)
- `domain/jobWorkflow.js` — the legacy 4-state machine
- `domain/completionFlow.js`, `hooks/useAssignedJobs.js`, `firebase/collectionStore.js`
- `domain/jobDisplay.js` — F-RULES-1 D3 display normalizer
- `access/legacyAuthorizationSurface.ts` — already tracks `fieldops_jobs` as legacy surface

### Governed backend

- **`completeAssignedJob` Cloud Function** — the jobs↔technicians completion cascade, with idempotent replay
- **`firestore.rules:311`** — hardened per F-RULES-1 (deployed and verified in production)
- **`firestore.indexes.json`** — declared `fieldops_jobs|COLLECTION|technicianId:ASCENDING` index (declared during O-4 specifically so a deploy would not destructively delete the live index)

### Reporting

- `domain/reporting/reportCatalog.js` + `functions/src/reporting/reportCatalog.ts` — declare a
  **`job` reporting object** over `fieldops_jobs`. Retirement must decide whether that object is
  removed or repointed at `fieldops_wos`.

### Sandbox / verification (sandbox-only dependencies)

- `functions/scripts/seedSandboxTransactional.js` — **scenario SBX-SCN-001 seeds 4 `fieldops_jobs` records**
- `functions/scripts/d2SmokeRulesVerification.js`, `d3SmokeUiVerification.js` — F-RULES-1 smoke verifiers
- `scripts/indexDriftGuard.test.mjs` — uses the `fieldops_jobs` index as its O-4 fixture

---

## 4. What must be preserved or transformed

| Item | Disposition |
|---|---|
| The 12 production records | **Nothing to preserve.** No business, audit or history value. |
| `fieldops_technicians` (8 records) | **Out of scope — do not retire alongside.** Technician identity is referenced by `completeAssignedJob` and by `users/{uid}` technicianId mapping (PT-001). Its own disposition is a separate question. |
| The hardened `fieldops_jobs` Rules | Must remain until the last reader/writer is gone; removal is a Rules change (Tier 2). |
| The declared `technicianId` index | Must not be silently dropped — O-4's guard exists precisely to prevent a destructive index deploy. |
| `job` reporting object | Decide: remove, or repoint at `fieldops_wos`. |
| SBX-SCN-001 | Must be **rebuilt on `fieldops_wos`** as part of F0/F5 — it is currently the only end-to-end field scenario and it runs on the retiring model. |
| F-RULES-1 smoke verifiers | Historical evidence tooling; retire with the collection or repoint. |

---

## 5. Recommendation

**RETIRE**, on the evidence — and the preferred outcome in the directive is supported:

```
fieldops_wos    = canonical governed Work Order / field execution authority
fieldops_jobs   = retired legacy model
```

The data carries no business significance, and the model is structurally incapable of the
audit, history and completion semantics the Field requirement demands.

**However, retirement is a sequence, not a deletion.** The recommended order — no destructive
step until the end, and the destructive step separately authorized:

1. **F0** — field surfaces read/transition `fieldops_wos` through `transitionWorkOrder`. Legacy path still present, unused by Field.
2. Migrate the remaining four surfaces (Dispatch, Control Tower, Jobs, and the PartsScanner job picker) off `fieldops_jobs`.
3. Decide the `job` reporting object (remove vs repoint).
4. Rebuild SBX-SCN-001 on `fieldops_wos` (F5).
5. Retire `completeAssignedJob`'s legacy cascade once nothing calls it.
6. **Separately authorized retirement package**: remove the Rules block, remove the index declaration (non-destructively, verified against the O-4 guard), and dispose of the 12 records.

Steps 1–5 are repo-only. **Step 6 is protected** and must not proceed without its own Owner
authorization, per the directive.

---

## 6. What this assessment did not do

- Did not delete, modify, migrate or export any production record.
- Did not read customer names, addresses or free-text descriptions into this report — only
  correspondence counts, enum values, field presence and dates.
- Did not assess `fieldops_technicians` disposition beyond flagging that it is a separate question.
