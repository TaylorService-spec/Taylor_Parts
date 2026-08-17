# EOS Scenario & Behavior Test Framework

Issue: #1105

This directory defines executable business scenarios for EOS. Scenarios are not demo-only fixture blobs: each one states business context, actors, relationships, actions, expected outcomes, and invariants that can later drive seed generation, emulator/integration tests, UI smoke tests, permission regression, concurrency tests, and AI reasoning evaluation.

## Core model

Every scenario uses the same conceptual shape:

- `id` — stable scenario id; never recycled.
- `title` — short human-readable name.
- `domains` — EOS business domains involved.
- `entities` — objects/records participating in the scenario.
- `actors` — personas or system actors involved.
- `startingState` — business facts required before execution.
- `actions` — user/system actions in intended order.
- `behaviors` — optional reusable behavior/chaos variants.
- `expected` — observable business outcomes.
- `invariants` — truths that must remain true even under retry/concurrency/error.
- `boundary` — expected blocked/protected outcome where the product deliberately has no authoritative path yet.
- `sandbox` — whether this scenario is suitable for visible shared-sandbox seeding.
- `generated` — whether the scenario is eligible as a base for generated variants.

## Four suites

1. **Canonical business scenarios** — named deterministic stories humans can inspect in sandbox and use for acceptance.
2. **Generated state matrix** — constrained combinations derived from canonical families; never a blind Cartesian product.
3. **Behavior/chaos suite** — retries, double-submit, stale state, two tabs, concurrent actors, direct unauthorized calls, network interruption, and similar interaction failures.
4. **Scale/adversarial suite** — large relationship counts and dense valid business states. Scale tests must distinguish query-shape support from benchmark claims.

## Boundary discipline

Scenarios describe the system that actually exists. They must not invent missing authority, movements, reads, lifecycle transitions, or financial semantics merely to produce a green test. If EOS intentionally reaches a protected or missing boundary, the expected outcome is the truthful blocked state with no fabricated downstream mutation.

UI hiding is never treated as security. Permission scenarios should attempt the governed command/read path directly and assert the actual authorization result.

## Sandbox discipline

The canonical catalog can grow to ~200 human-readable scenarios, but the shared sandbox should contain only a curated visible subset. Generated and scale matrices belong primarily in disposable/emulator/integration environments.

Future seed tooling must be deterministic, idempotent, dry-run capable, sandbox-guarded, relationship-validating, and cleanup/reset capable.

## Canonical batches

- `canonical-batch-001.json` — first 50 scenarios across CRM, service, sales, inventory, receiving, serialized equipment, dispatch, authorization, concurrency, and cross-franchise operations.
- `behavior-catalog.json` — reusable user/system behavior variants applied selectively to canonical scenarios.

The catalog is intentionally additive. Later batches should extend coverage rather than renumber or repurpose existing scenario ids.
