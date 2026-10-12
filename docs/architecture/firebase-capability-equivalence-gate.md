# Firebase Retirement: the Business Capability Equivalence Gate

Owner directive, 2026-10-11: **Firebase retirement is a business-functionality migration, not code
deletion. No required business capability may disappear because its Firebase implementation is
removed.**

The exit ratchet (`scripts/firebaseExitGuard.mjs`, [firebase-exit-ratchet.md](firebase-exit-ratchet.md))
proves that a Firebase *dependency* went away. It cannot tell whether the *business capability* that
dependency served went with it. This gate closes that gap. It does not replace or weaken the ratchet,
the shim boundary or the F0 deploy guard. It runs beside them.

| Piece | Path |
|---|---|
| Manifest (the records) | `docs/architecture/firebase-capability-equivalence.json` |
| Guard | `scripts/firebaseCapabilityEquivalenceGuard.mjs` |
| Contract tests | `scripts/firebaseCapabilityEquivalenceGuard.test.mjs` |
| CI (unfiltered) | `.github/workflows/firebase-capability-equivalence.yml` |

## 1. Dispositions

Every retired operation has exactly one disposition.

| Disposition | Meaning | May retire? |
|---|---|---|
| `REPLACED` | Equivalent business functionality exists in EOS and is **verified** on every gate. | Yes |
| `SUPERSEDED` | An approved EOS workflow achieves the required outcome differently. It must be verified on every gate. A **material** business-behaviour change also needs an Owner decision. | Yes, with the Owner's acceptance when behaviour materially changes |
| `GAP` | The functionality is missing, inaccessible, untested or still Firebase-dependent. | Only with an Owner decision that explicitly accepts the gap |
| `UNVERIFIED` | **Historical only.** A replacement exists, but the evidence is incomplete. Treated as a gap. | Never for a new retirement |

An unverified replacement is never `REPLACED`. The guard rejects the claim and names the open gates.

## 2. The five gates (plus audit)

Each gate has a status: `VERIFIED`, `PARTIAL`, `UNVERIFIED`, `GAP` or `NOT_APPLICABLE`. Each status
other than `VERIFIED` and `NOT_APPLICABLE` must carry a `limitation` that says what is missing.

| Gate | Question | `VERIFIED` requires |
|---|---|---|
| A, functional equivalence | Can the same business outcome be achieved in EOS, including validation, errors, corrections and exceptions? | At least one valid citation |
| B, employee accessibility | Can an authorized employee reach and use it through an EOS screen or a supported integration, for the right personas? Retail Sales and National Accounts Sales are distinct. | **Both** an executable screen-level test (`ui-test`: the screen calls the EOS operation and handles its **real** result shape) **and** a recorded live run by the persona against a deployed environment (`uat`). A route + capability + grant reading proves reachability only on paper, so it is `PARTIAL`. A test-suite write-up titled "UAT" is `doc` evidence, not `uat`. |
| C, authority equivalence | Are Principal/Employee resolution, tenant isolation, capabilities, Operational Scope, Work Eligibility, ownership, accountability and assignment all correct? | Evidence. **Accepted EOS authority is canonical.** Firebase authorization logic is not copied where it conflicts. |
| D, persistence and integration | Is the operation persisted in PostgreSQL, with correct transactions, downstream workflows, reports, jobs and integrations, and no remaining Firebase reads or writes? | Evidence. May be `NOT_APPLICABLE` with a reason. |
| E, regression evidence | Do executable tests prove the outcome? | At least one **positive** and one **negative** executable test (`test`/`ui-test`). A source citation alone never satisfies E. |
| audit | Are the audit obligations of accepted EOS authority met? | Evidence |

Only B and D may be `NOT_APPLICABLE`, and only with a `reason`. A, C, E and audit always apply.

## 3. The record

```jsonc
{
  "legacyOperation": "createPart",            // the removed export, exactly
  "capabilityId": "catalog.part.create",      // the business capability
  "domain": "catalog",
  "era": "HISTORICAL",                         // or "GATED"
  "retiredIn": { "pr": 2055, "commit": "0de3c06b" },
  "disposition": "UNVERIFIED",
  "verificationStatus": "UNVERIFIED",          // VERIFIED only when every gate is
  "materialBehaviorChange": false,
  "eosReplacement": "POST /operations/catalog createPart",
  "entryPoint": "…UI screen or integration…",
  "postgresImplementation": "…writer…",
  "personas": ["…"],
  "requiredCapabilities": ["…"],
  "ownerDecision": null,                       // "DECISIONS #NNN", never inferred
  "gates": { "A": {…}, "B": {…}, "C": {…}, "D": {…}, "E": {…} },
  "audit": {…},
  "gaps": ["…"]
}
```

Evidence entries: `{ "kind": "test" | "ui-test" | "uat" | "source" | "doc", "path": "…", "contains": "…", "polarity": "positive" | "negative" }`.
`contains` is required, and `polarity` is required, for `test` and `ui-test`.

## 4. What the guard enforces

1. **It enumerates exports by whitelist, not by best effort.** Outside comments, `functions/src/index.ts`
   may contain only:
   - the firebase-admin initialization;
   - `export { name, other as alias } from "...";` blocks.

   Everything else is refused with its line number:
   - any `/` that does not open a comment (regex literals, division);
   - template literals;
   - strings that cross a line;
   - `export const` / `function` / `*` / `default` / `=` / `type`, destructuring, namespaces and
     `module.exports`.

   A best-effort scan could be desynchronized: a regex literal `/'/` made a removed export look present
   behind a fake comment. That was adversarial review finding B1 on #2057; it is now a regression test.
2. **It checks against a frozen export baseline,** the 82 exports of main `acc65f2e` recorded in the
   manifest (`exportBaseline.entries`). Each export is recorded with **its module and original name**
   (`createWorkOrder` → `./createWorkOrder#createWorkOrder`). Re-pointing an export at a stub module,
   or at another function under the old name, is caught as a change to that export.
   - The baseline's digest is **pinned in the guard** (`EXPORT_BASELINE_DIGEST`). An edited baseline
     fails even when no previous manifest exists.
   - **The deploy entry point is pinned too:**
     - `functions/package.json` `main` is `lib/index.js`;
     - `firebase.json` has one functions codebase with source `functions`;
     - tsconfig `rootDir` is `src`.

     Otherwise the guard would be reading a file nothing deploys.
   - The firebase-admin import may come only from `firebase-admin/app`.
   - Line terminators that TypeScript honours but the comment blanker does not are refused: a lone CR,
     U+2028 and U+2029.
   - On **every** run, every baseline export that is no longer exported must have a GATED record that is
     retirement-complete.
   - Nothing outside the baseline may be exported. No new Firebase Function is allowed, and a retired
     one may not return.
   - This makes the gate independent of which commit a run compares against. A cancelled or superseded
     main run, a direct push or a `workflow_dispatch` cannot let a removal through unseen.
   - The baseline itself is frozen against the previous manifest.
3. **It also detects removals since the previously accepted commit** (PR base, or the pre-push commit on
   `main`), and refuses any export added since then.
4. **It rejects missing or malformed records.** Required fields, enums, arrays, duplicates, nameless
   records and gate shapes are all checked.
5. **A GATED record must be retirement-complete, and stay so.** That means one of:
   - `REPLACED`, fully verified;
   - `SUPERSEDED`, fully verified, plus the Owner when behaviour materially changes;
   - a `GAP` the Owner accepted.

   `UNVERIFIED` is refused for a GATED record. Completeness is enforced on every run, not only in the
   change that removes the export, so a later change cannot weaken the record. A GATED record's
   operation may not be (or become) exported.
6. **It rejects unsupported claims in both eras:**
   - `REPLACED` with an open gate;
   - `VERIFIED` with an open gate;
   - a material business-behaviour change without an Owner decision on anything but a `GAP`.
7. **It requires a relevant Owner decision.** A decision that *accepts* a GAP or a material behaviour
   change must name the retired operation itself. The reference must be `DECISIONS #NNN` with a real
   `## #NNN` heading, **and that section must name the retired operation, its capability id or the EOS
   replacement operation.** An existing but unrelated decision accepts nothing. The guard never infers
   or invents a reference.
8. **It refuses evidence that proves nothing:**
   - the gate's own files (manifest, guard, guard test, workflow, this spec) or `docs/DECISIONS.md`,
     which always contain what a record quotes from them;
   - a `test`/`ui-test` citation that is not a `*.test.*` file;
   - a `contains` shorter than 12 characters;
   - a path outside the repository.
9. **It detects stale references.** Every cited path must exist and every `contains` must still be
   found. A renamed or deleted test fails as `STALE`.
10. **It explains the failure.** Every error names the record, the gate and what evidence is missing.

It also:

- keeps records append-only;
- refuses to let a historical retirement be exported again;
- refuses to file a new retirement as `HISTORICAL`.

`candidateDisposition` is informational: what a historical record would be once its open gates close
(`REPLACED` or `SUPERSEDED`). It never makes a record complete.

## 5. Historical baseline vs future enforcement

These two are deliberately separate.

- **HISTORICAL**: the 22 retirements completed before this gate, audited at main `acc65f2e`. They are
  `recordPutAway`, F2 Supplier (8), F4 Work Order Labor (3), F3a Part Master (3) and F3b Part Alias (7).
  - The names are pinned in the guard (`HISTORICAL_RETIREMENTS`) and in its test.
  - These records may remain `UNVERIFIED` or `GAP`. They are reported as open findings, not CI
    failures, so accepted main stays testable. At introduction: **6 UNVERIFIED, 16 GAP, 0 complete.**
  - They may not over-claim: a `REPLACED` claim is held to the full proof.
  - Their citations are re-checked on every run.
- **GATED**: every retirement from this gate onward. It must be retirement-complete to merge.

Historical findings are recorded in
[the retrospective](../audits/firebase-retirement-equivalence-2026-10-11/README.md). This document
and the guard are the future enforcement.

### Known pre-gate retirements outside the audited baseline

The following retirements are outside the Owner's 2026-10-11 audit scope. They are not in
`HISTORICAL_RETIREMENTS`, so this gate makes no claim about them. They are listed as audit backlog in the
[roadmap](firebase-retirement-roadmap.md).

| Commit (2026-10-01) | Retired alongside | Callables |
|---|---|---|
| `5d6a84ac`, Inventory / Warehouse completion | `recordPutAway` | 18 inventory callables: cycle count, transfer orders, relocation, stock-movement reads |
| `dd0ccf4a` | | 11 truck callables, plus `listWorkOrderConsumptionSources` and `updateWorkOrderExecutionData` |
| `5a8fcef7` | | 5 equipment callables |

Earlier waves took the estate from 187 exports to 138.

## 6. What the gate does not prove

- **It does not run the cited tests.** It proves the cited tests *exist* by name. The repository's
  own suites run them. A cited test that is not in any CI workflow is a reviewer's concern.
- **It cannot tell a real UAT record from a fabricated one.** Reviewers own that judgement. The gate
  only forces the claim to be made explicitly and keeps it from going stale.
- **A `DECISIONS` heading added in the same PR passes the existence check.** The Owner's approval
  of that PR is the control.
- **It checks export names, not deployed functions.** Changing a module so that the exported value is
  no longer a Cloud Function, or gutting its handler, keeps the name and passes. Review, the module's
  own tests and the exit ratchet are the controls for that.
- **It runs the PR's own copy of the guard.** A PR that edits the guard, `HISTORICAL_RETIREMENTS`, the
  pinned test or the workflow together with a retirement can weaken the gate in the same change.
  - Recommended: a CODEOWNERS entry for the five gate files.
  - Recommended: branch protection that makes this check **required**. As of 2026-10-11 `main` has no
    branch protection and no rulesets, so every CI check, this one included, is advisory until the
    repository's settings require it.
