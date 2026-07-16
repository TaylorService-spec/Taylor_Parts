---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-16
owner: Claude Code (Customer)
related_adrs: [docs/architecture/ADR-007-governed-object-based-report-creator.md]
depends_on: [docs/specifications/governed-object-based-report-creator.md, docs/architecture/ADR-007-governed-object-based-report-creator.md, docs/assessments/governed-object-based-report-creator.md]
implements: [docs/specifications/governed-object-based-report-creator.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 325
target_release: TBD
---

# Implementation Plan: Governed Object-Based Report Creator (#325)

**Status: DRAFT (pending review).** Implements the merged Specification under ADR-007, incorporating the Owner's implementation-planning-gate decisions (#325 comment, main @ `0b90300`): one `readCapability` per field (no operator-differentiated grants in v1); the proposed limits adopted as **configurable governed limits** validated during performance testing; scheduling design-only (not wave 1); private-only first, then governed same-tenant sharing after saved reports + export verify; Purchase Order cost fields stay wave-5 financial.

**This is a documentation-only Plan and authorizes nothing.** It builds no code, Function, Rule, index, collection, schema, permission-engine change, route, UI, deployment, export, or production query. Each PR below is a *proposed* future unit; each is separately Owner-authorized when its stage is reached. It cites Issue #226 / ADR-005 and #15 without modifying Inventory's lanes. **Issue #325 stays OPEN.**

Repository-path convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…` relative to `field-ops-app-vite/`.

---

## 1. Principles

- **Small, reversible PRs.** Each PR is bounded, independently reviewable, and reversible by revert (Customer-lane code/data/UI) or by de-activating a catalog/capability entry (activation waves). No PR requires a data migration to unwind.
- **Unavailable-not-unsafe.** Every user surface Customer builds ships **gated**: until the trusted execution service and the #226 field-level read extension are deployed and verified (#15 lane), the report builder renders and validates definitions but **cannot execute** — the execution seam reports unavailable with a clear reason and never falls back to a client-direct read. This is the established Equipment E9/E10 / trusted-writer pattern (`trustedActionUnavailable`).
- **Lane discipline (§2).** Customer PRs touch only Customer-lane surfaces (report catalogs as repo data, pure query/validation model, builder UI, client seam, tests). The trusted Function, the #226 field-level capability extension, any Firestore collection/Rules/indexes, the export path, and deployment are the **Functions / Inventory lane** — identified here as sequenced dependencies, **not built by Customer**.
- **Field-level enforcement is backend or it is nothing (ADR-007 §2.1).** No Customer PR ever reads a report collection client-direct or hides fields in the UI as a substitute for backend projection. The builder UI reflects only what the trusted service returns.
- **Each PR carries its own gates** — tests, and (for any sensitive-domain activation) a dedicated security review — before merge; activation PRs additionally carry a production gate (§6).

## 2. Lane map (who builds what)

| Surface | Lane | In this Plan |
|---|---|---|
| Report object/field/relationship **catalogs** (static repo data) | **Customer** | F1 |
| Pure **query-definition model + validation** (node-testable) | **Customer** | F2 |
| Report **builder UI** shell + gated execution seam | **Customer** | F3, W1-UI |
| Client **saved-definition model** (pure) + UI | **Customer** | W-SAVE-UI |
| Trusted **execution / projection / export Function** (`functions/…`) | **Functions / Inventory** | dependency D-FN |
| **#226 field-level read capability extension** (permission engine) | **Inventory (#226)** | dependency D-226 |
| Saved-definition **collection + Firestore Rules + indexes** | **Functions / Rules lane** | dependency D-RULES |
| **Audit** integration (`auditEventWriter`) for report actions | **Functions / Inventory** | dependency D-AUDIT |
| **#15** production Functions deployment | **Inventory / #15** | gate G-PROD |

Customer implements the left/top rows; the bottom rows are prerequisites Customer **coordinates with and depends on**, never edits. A Customer PR that discovers it needs a Rule, a Function, an index, or a permission-engine change **stops and routes to the owning lane** (a hard stop of this workstream).

## 3. Foundation PRs (no user-visible capability; Customer-buildable now)

| PR | Title | Lane | Deliverable | Depends on | Reversible by |
|---|---|---|---|---|---|
| **F1** | Report catalogs (data) | Customer | The object/field/relationship catalogs (Spec §3–5) as static, version-controlled repo modules with stable identifiers, plus pure catalog-integrity validators (every field has a `readCapability`; operators are legal for the type; relationships are `hop=1`; sensitivity ∈ the legal set). **Wave-1 objects populated in full; later-wave objects present as catalog stubs marked inactive.** No engine, no read. | — | revert |
| **F2** | Query-definition model + validation | Customer | A pure query-definition type and a **server-shaped validator** (validate a definition against the catalog: object/field existence + activation, legal operators per field, well-typed filters, `hop=1` relationships, reject unknown keys fail-closed). Node-tested; identical validator reused by the future Function so client and server agree (Spec §7). No read. | F1 | revert |
| **F3** | Report-builder UI shell + gated seam | Customer | The object-first builder (pick object → authorized fields → filters/group/sort/aggregate) reading F1's catalog and validating with F2, behind the **gated execution seam** that reports unavailable (no backend yet). Keyboard-first, responsive, empty/loading/permission-denied/unsupported/partially-authorized/failure states (Spec §12). Renders and validates; never executes. | F1, F2 | revert |

F1–F3 are **fully buildable by Customer today** (pure data + pure model + UI shell), ship inert (nothing executes), and are individually revertible. They unblock nothing sensitive: no read path exists until the Function does.

## 4. Cross-lane dependency PRs (Functions / Inventory lane; sequenced, not Customer-built)

These are the prerequisites the report creator's *execution* needs. Customer does not build them; the Plan sequences them and Customer's activation waves gate on them.

| Dep | Title | Owning lane | What it provides | Gates |
|---|---|---|---|---|
| **D-226** | Field-level read capability extension | Inventory (#226) | The `report.<object>.field.<id>.read` capability granularity in the permission engine, resolvable by `resolveEffectivePermission` per field honoring `currentAccessVersion` (Spec §6). One capability per field (Owner decision 1). | #226 review; security review |
| **D-FN** | Trusted execution/projection service | Functions / Inventory | The Cloud Function that reads a governed collection with elevated privilege, **projects to authorized fields**, applies the **predicate-drop rule** (filter/group/sort/aggregate on an unreadable field dropped, ADR-007 §2.4/§2.5), enforces the configurable governed limits, and never caches across principals. Reuses F2's validator. | security review; #15 |
| **D-RULES** | Saved-definitions collection + Rules + indexes | Functions / Rules lane | The Firestore collection for inert saved definitions, its Rules (a definition confers no data access; per-action create/read/rename/duplicate/delete capabilities), and any index. | Rules regression stays green; security review |
| **D-AUDIT** | Report-action audit integration | Functions / Inventory | Emit immutable Audit Events (`recordStandaloneAuditEvent`) for create/share/schedule/run/export, recording actor/action/definition/object/Scope/accessVersion/row-counts/dropped-field+predicate+truncation facts, never row data (Spec §11). | security review; #15 |
| **G-PROD** | #15 production Functions deployment | Inventory / #15 | Deploys + verifies the above Functions live. Until then every Customer surface stays unavailable-not-unsafe. | Owner production authorization |

## 5. Activation waves (Customer catalog/UI activation, each gated on the deps + its review)

Each wave is a **catalog/capability activation over the build-once engine** (ADR-007 §2.9), not new engine code. A wave PR flips wave-N catalog entries to active and wires the UI, once D-226 + D-FN (+ D-RULES/D-AUDIT for the relevant capability) are deployed and verified. Sensitive waves additionally require their **dedicated security review**.

| PR | Wave / capability | Objects/fields activated | Extra gate |
|---|---|---|---|
| **W1** | Wave 1 read-only reports | customer, contact, location, equipment — standard fields; one-hop relationships (e.g. equipment→location); tabular preview; execution limits; run-audit | Architecture + security review of the projection over real data |
| **W-SAVE** | Saved definitions | create/read/rename/duplicate/delete of inert definitions; re-evaluation-at-run; catalog-change tolerance (Spec §8) | D-RULES; security review |
| **W-CSV** | CSV export | `report.export` as a **separate capability**; export re-authorizes + re-projects; export limits 10,000 rows / 10 MB (Owner decision 2) | security review |
| **W-SHARE** | Governed same-tenant sharing | private→governed share to named principals/roles; shared open **re-executes under the recipient's current access**; same-tenant only (#140 inert) | **After** W-SAVE + W-CSV verified (Owner decision 4); security review |
| **W2** | Wave 2 | job, workOrder, technician, serviceHistory (standard operational fields); technician self-scope preserved via Scope re-evaluation | security review |
| **W3** | Wave 3 | reorderRequest, purchaseOrder, inventoryAction (standard fields). **PO cost/price/total fields NOT activated here — they are wave-5 financial** (Owner decision 5) | security review |
| **W4** | Wave 4 | employee (+ `customer.accountOwner`, which is `employee`-classified and deferred here from its wave-1 host) | **dedicated employee-data security review** |
| **W5** | Wave 5 | all `financial` and `audit` fields across every object, activated field-by-field | **dedicated financial/audit security review** |
| **W6** | Wave 6 | invoice — **only once an Invoice domain model + collection exist** (deferred; not plannable until then) | new-domain gate |

**Scheduling** is design-only and is **not** an activation PR in this plan (Owner decision 3); a future `W-SCHED` is named but unplanned until the Owner activates it.

## 6. Gates (applied per PR)

- **Test gate.** Foundation + Customer PRs: unit tests for catalog integrity (F1) and query validation (F2), mutation-proven where a guard is load-bearing; browser verification for the builder UI (F3/W1) with keyboard + 375px + the state matrix. The projection/predicate-drop/limit behavior of D-FN is tested in the Functions lane with emulator field-level cases proving unauthorized fields are absent from the payload and predicates on unreadable fields are dropped.
- **Security-review gate.** A **dedicated independent security review** before merge of: D-226, D-FN, D-RULES, D-AUDIT, and every sensitive-domain wave (W4 employee, W5 financial/audit), specifically checking no field/predicate/membership leakage, no privilege escalation via saved/shared/scheduled definitions, and no cross-principal caching.
- **Rollback gate.** Customer PRs revert cleanly. Activation waves roll back by **de-activating catalog entries/capabilities** — no schema migration, no backfill, no engine change; a field found to leak or be mis-classified is de-activated (denied) without touching other objects (ADR-007 §13).
- **Production gate (G-PROD).** No report executes in production until #15 deploys + verifies the Functions and the Owner issues production authorization. Every surface stays unavailable-not-unsafe until then. Tenant Scope stays inert until #140 across all waves.

## 7. Dependencies summary

- **#226 (Inventory):** the field-level read capability extension (D-226) is the hard prerequisite for any execution; Customer specifies the contract (Spec §6) and depends on the engine.
- **#15 (Inventory):** the trusted execution/projection/export Functions and audit integration cannot run in production until #15 deploys and verifies them (G-PROD).
- **#140:** tenant Scope stays inert; sharing is same-tenant/global only; no wave widens on `tenant`.

## 8. Sequencing summary

F1 → F2 → F3 (Customer, inert) ∥ D-226 + D-FN + D-RULES + D-AUDIT (Inventory/Functions) → G-PROD (#15) → **W1** (wave-1 read-only) → **W-SAVE** → **W-CSV** → **W-SHARE** → **W2 → W3 → W4 → W5** (each behind its review, sensitive waves behind a dedicated security review) → **W6** only if/when an Invoice domain exists. Scheduling (`W-SCHED`) remains design-only.

## 9. Scope honored

Documentation only. This Plan changes and authorizes nothing: no application code, `functions/`, Firestore Rules, indexes, permission-engine code, claims, deployment manifest, global project-status document, or production data; it deploys nothing and queries no production. It does not begin any PR above; each is separately Owner-authorized at its stage. It cites #226 / ADR-005 / #15 without modifying Inventory's lanes, does not resolve #140, does not weaken field-level protection, and selects no production deployment action — the hard stops of this stage. **Issue #325 stays OPEN.**
