# Future Architecture Backlog

Known limitations and deliberate simplifications, tracked so they don't get silently forgotten or accidentally "fixed" in a way that breaks the sprint boundary that deferred them. Each entry says what's deferred, why, and what would need to change to address it.

## No lifecycle timestamps (`assignedAt`/`startedAt`)

**What's deferred:** The job schema only records `createdAt` (set once, at document creation, by `collectionStore.add()`). There is no timestamp for when a job was assigned or when work started.

**Why:** Adding one requires writing to the job document inside `assignJob()` or `updateJobStatus()` — both were explicitly scoped as "no changes" during Sprints 3.2 and 3.3 (dispatch intelligence was required to be strictly read-only/derived-only).

**Impact today:** `dispatchScoring.js`'s "recency" signal and `jobRiskScoring.js`'s entire age/stagnation model are approximations based on time-since-creation, documented inline and surfaced to users via "(approx.)" labels. This undercounts risk for jobs that sat `OPEN` a long time before assignment (their `ASSIGNED`-state clock effectively starts from creation, not from the actual assignment event).

**To resolve:** A sprint explicitly scoped to touch `assignJob()`/`updateJobStatus()`, adding `assignedAt`/`startedAt` fields inside their existing transactions (no new transaction needed, just additional fields on the existing `tx.update()` calls). Once available, `jobRiskScoring.js`'s `ageFactor`/`stagnationFactor` should be updated to use the precise timestamp instead of `createdAt`.

## No real Work Order documents

**What's deferred:** `domain/workOrders.js` defines a `workOrdersStore` pointed at a Firestore `workOrders` collection, but nothing in the app creates or reads documents from it. Control Tower's notion of a "work order" is entirely derived by grouping jobs client-side on `job.workOrderId`.

**Why:** No work-order creation UI has been built yet; jobs currently carry `workOrderId` as a bare string with no backing document.

**Impact today:** Sprint 3.3's `computeDispatchScore()` uses "does this technician have another active job on the same `workOrderId`" (continuity) as a proxy for "work order priority," since there's no real priority field anywhere to read. The `workOrders` prop passed to Control Tower panels is this same derived grouping, not a live Firestore read.

**To resolve:** Build actual Work Order CRUD (customer, priority, scheduledDate — see the shape documented in `domain/workOrders.js`'s comment), wire job creation to reference real work-order documents, then update `computeDispatchScore()`'s `workOrderPriority` factor to read an actual priority field instead of the continuity proxy.

## Dispatch/risk scoring weights are hand-tuned constants

**What's deferred:** The weights in `dispatchScoring.js` (`WEIGHTS`) and `jobRiskScoring.js` (`RISK_WEIGHTS`) are fixed constants chosen for reasonableness, not calibrated against real dispatch outcomes.

**Why:** No historical dispatch/outcome data exists yet to calibrate against; Sprint 3.2/3.3 scope was explicitly the scoring *architecture* (explainability, shared schema), not tuning.

**To resolve:** Once there's enough real usage data, revisit the weight constants — ideally exposed as configuration rather than hardcoded, so they can be tuned without a code change.

## Technician `OFF_SHIFT` status is unmanaged

**What's deferred:** `TECH_STATUS.OFF_SHIFT` exists in the enum and is scored in `dispatchScoring.js` (heavily penalized), but nothing in the current UI ever sets a technician to this status.

**Why:** No shift-scheduling feature has been built.

**To resolve:** A future scheduling sprint would need to decide how/when this status gets set (manual toggle vs. a shift schedule) and ensure it's set through the same domain-layer discipline as job status (i.e., not a raw UI-triggered Firestore write).
