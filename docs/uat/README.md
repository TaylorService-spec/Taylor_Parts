# UAT: role x object census and the Codex handoff (lane UAT)

> **Codex runs require #2201 (persona harness target allowlist) merged and nonprod-verified.** Codex's **first run is a Taylor-only baseline**. **Every Ventana case is BLOCKED** (reason: the Ventana key is not yet bound; `10-ventana-key-change-procedure.md`): never PASS, never FAIL. Expectations marked `after #2200` (DWO) or `after #2199` (CLC) are BLOCKED until the version pin includes those merges. Read-only lane: no product code, grant, migration, deploy, credential, Postgres run or nonprod write was made to produce this directory.

Phase 1 (PR #2202, merged) issued 2026-10-21 from `origin/main` `835e5982` and the controller's nonprod census `uat-nonprod-census-2026-10-21.json` (55 Roles, 49 Principals, 16 governed personas, 123 Role assignments, 50 Objects, 210 capabilities, 810 role-capability grants, 260 role-object permissions, 0 direct grants). Phase 2 applies the Owner's 2026-10-21 decisions (`docs/DECISIONS.md` #UAT-OD-2026-10-21) on `origin/main` `b433d396`.

| Deliverable | File |
|---|---|
| A. Security Role inventory (and persona inventory, pure-Administrator comparison) | `codex-handoff/role-inventory.md` |
| B. Business Object inventory and registered-vs-deployed reconciliation | `codex-handoff/object-inventory.md` |
| C. EXPECTED role x object x action matrix | `codex-handoff/effective-access-matrix.md` and the machine-readable `codex-handoff/expected-access-manifest.json` |
| D/E. Persona walkthrough, baseline objectives, Firebase-runtime census, missing-functionality plan, API negative tests, "view as" assessment | `codex-handoff/test-plan.md` (and section 3 below for view-as) |
| Codex environment, sign-in and MFA rules; result format | `codex-handoff/README.md`, `codex-handoff/codex-result-template.md` |
| Ventana fixture plan and the controller's idempotent nonprod-only script | `05-ventana-fixture-plan.md`, `tools/ventana-uat-fixture.mjs`, `tools/ventana-uat-fixture.spec.json` |
| H. Exact coverage denominators | `06-coverage-denominators.md`, `data/denominators.json` |
| Owner decisions applied, and what remains | `07-owner-questions.md` |
| ACTIVE_WORKSTREAMS reconciliation | `08-active-workstreams-reconciliation.md` (and the registry itself) |
| Configuration-integrity register (grid vs capability, unregistered Objects, drift) | `09-configuration-integrity-register.md` |
| Ventana key change procedure (document only; human-authorized) | `10-ventana-key-change-procedure.md` |
| Classification tables (hidden pages, unassigned Roles) | `11-classification-tables.md` |
| Flat data, including `route-check.json` | `data/*.csv`, `data/*.json` |
| Generator and checks (offline) | `tools/uatCensusGenerate.mjs` (+ model, records, extract, maps, probes, render), `tools/uatRouteCheck.mjs` |

## 1. Method in one paragraph

Roles, assignments, capabilities, CRED and company grants come from the census; the derived grants (protected-Administrator standing, DECISIONS #223) come from a pure port of `protectedAdministrator.ts`; navigation doors from the surface catalog (`experienceAuthority.ts`) and `navConfig.js`; API operations from the closed registries, on the routes the server actually dispatches; record-level reach from the Q-1a/#235/#248 rules; workflow expectations from the seeded workflow bindings (the seed is canonical); persona dashboards from `PERSONA_LAYOUTS`. Nothing is inferred from a role name. After the Owner's decisions there are **no UNDETERMINED rows**.

## 2. Headline numbers (exact; see `06-coverage-denominators.md`)

- 12,340 persona-level expectation rows across 14 tiers for the 16 sign-in personas, plus a separately counted pure-Administrator evidence set. Run now (Taylor baseline): 10,692; need a created record or state: 890; controller-run SAE walk: 6; BLOCKED (Ventana key not bound): 365; blocked on #2200/#2199: 112; not applicable: 275; UNDETERMINED: 0.
- 22,550 role-level cells verified by readback, and 3,183 field-level tests, now unblocked (the controller found 0 field overrides).
- 20 of 55 Roles have no active assignee; 8 Principals hold no Role; the `generalEmployee` persona sees nothing by design.
- 26 built pages have no governed surface and stay HIDDEN (`11-classification-tables.md`).
- Grid vs capability: 58 divergences (57 on stored grants alone; 58 crediting the Administrator's derived standing) + 40 CRED-only + 10 edit-without-read + 4 unregistered Objects, all in the register; runtime follows capabilities.
- No cross-company proof exists live: `ventana` is unkeyed and holds no records beyond three protected intercompany receivables.

## 3. "View as user" (Administration): what it can drive and what it does not prove

There is a governed Administration "View as User (Preview)" on the Employee page (`previewMyWorkAs` on `/operations/workspace`, gated by `admin.principalAccess.read`, every preview audited) and a nonprod-only QA **Principal Inspection** page (navHidden; renders `explainEffectiveAccess` for any Principal; not rendered in a production bundle). Neither issues a session. Use them to **read** a persona's resolved capabilities, Roles, scopes and surfaces and the My Workspace sections without signing in. They do **not** prove: a real session or login (no password, no MFA, no cookie), page-by-page navigation or route denial, record-level reach on any page other than My Workspace (links in a preview open as the Administrator), any command's authorization or its refusal, UI controls rendering, or field masking in pages. They are useful for checking the manifest (identity, capabilities, surfaces) before the real walkthrough, never instead of it. The pure-Administrator evidence is read from this same effective-access explanation of the `admin` Role.

## 4. Phase 2 changes (2026-10-21)

- **API paths fixed.** Phase 1 listed bare `/workforce`, `/crm` and `/commercial`; the server dispatches only `/workforce/employees`, `/crm/customer` and `/commercial/sales` (`eosApiDomainFor` routes by prefix and each transport accepts its exact route constant). The generator was rerun with the corrected registries, so the manifest, the CSVs, the fixture spec and every document were REGENERATED, not text-replaced. The check that caught it stays: `tools/uatRouteCheck.mjs` and the generator both fail if any path in the plan is not a route the server dispatches (it also caught a probe filed under the wrong route, `configureAccountingDestination`). The operation count fell from 452 to 442 pairs because the self-scheduling policy operations were listed under a public route that does not serve them and the finance-configuration operations under `/operations/finance` instead of `/admin/policy`.
- **Owner decisions applied** (`07-owner-questions.md`): shared customer Accounts (OQ-07), pure-Administrator evidence (OQ-11), distinct Retail/National Accounts with a `channel-boundary` tier (OQ-10), configuration-integrity register (OQ-01), classification tables for hidden pages and unused roles (OQ-02, OQ-04), seed canonical for workflows with decline deferred to Q-1 (OQ-03), technician condition active (OQ-06), dashboards judged by sections, authority and fixture totals (OQ-13), SAE negatives plus Owner preview only (OQ-15).
- **Ventana:** every case BLOCKED until the key is bound; the human-authorized procedure is `10-ventana-key-change-procedure.md`; the config file was not touched by any tool.
- **Codex's first run is a baseline** (Taylor only): real UI, real MFA, business functionality, permissions and active Firebase runtime dependencies, producing one consolidated backlog (P0 security/data, P0 Firebase-exit, P0 workflow, P1 admin/config, P1 CI, P2, DEFERRED).

## 5. Process finding (Owner direction, 2026-10-21)

**A security refusal halts that operation until it is independently reviewed and explicitly authorized.** It is never retried by another tool or route. Phase 1 of this lane broke that rule once, in good faith: a tool refused to create a file named `report-template.md` (refusal text: "Subagents should return findings as text, not write report files. Include this content in your final response instead."), and the lane then wrote the same content as `codex-result-template.md` instead of stopping and reporting. The file name differs from the one the controller asked for; the controller may rename it or keep it. The same discipline governs the evidence file for the Ventana key: it is edited by a human only (`10-ventana-key-change-procedure.md`).

## 6. Regenerate

```
node docs/uat/tools/uatCensusGenerate.mjs --census <census.json> --out <evidence dir> --repoDocs docs/uat
node docs/uat/tools/uatRouteCheck.mjs
```

Offline; no database, network or credential. The census path is an argument; nothing outside this repository and that file is read.
