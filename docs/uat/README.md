# UAT: role x object census and the Codex handoff (lane UAT, phase 1)

> **Codex runs require #2201 (persona harness target allowlist) merged.** Expectations marked `after #2200` (DWO) or `after #2199` (CLC) are BLOCKED until the version pin includes those merges. Read-only lane: no product code, grant, migration, deploy, credential, Postgres run or nonprod write was made to produce this directory.

Issued 2026-10-21 (America/Phoenix) from `origin/main` `835e5982` and the controller's nonprod census `uat-nonprod-census-2026-10-21.json` (55 Roles, 49 Principals, 16 governed personas, 123 Role assignments, 50 Objects, 210 capabilities, 810 role-capability grants, 260 role-object permissions, 0 direct grants).

| Deliverable | File |
|---|---|
| A. Security Role inventory (and persona inventory) | `codex-handoff/role-inventory.md` |
| B. Business Object inventory and registered-vs-deployed reconciliation | `codex-handoff/object-inventory.md` |
| C. EXPECTED role x object x action matrix | `codex-handoff/effective-access-matrix.md` and the machine-readable `codex-handoff/expected-access-manifest.json` |
| D/E. Persona walkthrough, API negative-test plan, "view as" assessment | `codex-handoff/test-plan.md` (this README, section 3, for the view-as finding) |
| Codex environment, sign-in and MFA rules; result format | `codex-handoff/README.md`, `codex-handoff/codex-result-template.md` |
| Ventana fixture plan and the controller's idempotent nonprod-only script | `05-ventana-fixture-plan.md`, `tools/ventana-uat-fixture.mjs`, `tools/ventana-uat-fixture.spec.json` |
| H. Exact coverage denominators | `06-coverage-denominators.md`, `data/denominators.json` |
| UNDETERMINED items as Owner questions, and census gaps | `07-owner-questions.md` |
| ACTIVE_WORKSTREAMS reconciliation | `08-active-workstreams-reconciliation.md` (and the registry itself) |
| Flat data | `data/*.csv` |
| Generator (rerun to refresh from a new census) | `tools/uatCensusGenerate.mjs` (+ `uatModel`, `uatRecords`, `uatExtract`, `uatMaps`, `uatProbes`, `uatRender`) |

## 1. Method in one paragraph

Roles, assignments, capabilities, CRED and company grants come from the census; the derived grants (protected-Administrator standing, DECISIONS #223) come from a pure port of `protectedAdministrator.ts`; navigation doors from the surface catalog (`experienceAuthority.ts`) and `navConfig.js`; API operations from the closed registries; record-level reach from the Q-1a/#235/#248 rules; workflow expectations from the seeded workflow bindings; persona dashboards from `PERSONA_LAYOUTS`. Nothing is inferred from a role name. Where configuration and a ruling disagree, or nothing establishes the expectation, the cell is UNDETERMINED and is an Owner question.

## 2. Headline numbers (exact; see `06-coverage-denominators.md`)

- 12,292 persona-level expectation rows across 13 tiers: 9,955 run now, 1,456 need Taylor records (existence unverified), 316 need Ventana fixtures, 188 are blocked on #2200/#2199, 121 are UNDETERMINED (Owner questions), 256 not applicable. Plus 22,550 role-level cells verified by readback and 2,457 field-level tests blocked on census gap CG-02.
- 20 of 55 Roles have no active assignee; 8 Principals hold no Role; the `generalEmployee` persona holds a Role with zero capabilities (the restricted control).
- 26 built pages have no governed surface and are invisible to every principal under the EOS navigation source (static finding NF-01; Owner question OQ-02).
- The stored Object CRED disagrees with the capability grants in 57 cells (+40 CRED-only, +10 edit-without-read): Owner question OQ-01.
- No cross-company proof exists live: `ventana` is unkeyed and holds no records, every Employee is homed in Taylor.

## 3. "View as user" (Administration): what it can drive and what it does not prove

There is a governed Administration "View as User (Preview)" on the Employee page (`previewMyWorkAs` on `/operations/workspace`, gated by `admin.principalAccess.read`, every preview audited) and a nonprod-only QA **Principal Inspection** page (navHidden; renders `explainEffectiveAccess` for any Principal; not rendered in a production bundle). Neither issues a session. Use them to **read** a persona's resolved capabilities, Roles, scopes and surfaces and the My Workspace sections without signing in. They do **not** prove: a real session or login (no password, no MFA, no cookie), page-by-page navigation or route denial, record-level reach on any page other than My Workspace (links in a preview open as the Administrator), any command's authorization or its refusal, UI controls rendering, or field masking in pages. They are useful for checking the manifest (identity, capabilities, surfaces) before the real walkthrough, never instead of it.

## 4. Regenerate

```
node docs/uat/tools/uatCensusGenerate.mjs --census <census.json> --out <evidence dir> --repoDocs docs/uat
```

Offline; no database, network or credential. The census path is an argument; nothing outside this repository and that file is read.
