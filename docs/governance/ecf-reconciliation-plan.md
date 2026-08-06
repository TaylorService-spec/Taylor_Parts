---
artifact_type: governance
gate: ECF reconciliation — prerequisite to activation
status: Plan accepted (Owner, 2026-08-06) — RECONCILE THEN ACTIVATE. Not activated.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
proposed_baseline: c002b5ee0834998207f7966be40bbd718cbd0e28
authority: docs/governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md
scope: Plan only. No certification run, no framework activation.
---

# ECF Reconciliation Plan

Owner accepted the Program 0 recommendation: **RECONCILE THEN ACTIVATE**, with `c002b5e` as the proposed truth baseline. Reconciliation must **reuse existing audit/evidence standards and the promotion lifecycle rather than create parallel governance**.

This plan defines what must be true before the first certification runs. **It does not activate ECF.**

---

## 1. Why ECF survives

The framework was never exercised and its three Core Artifacts do not exist. That is a reason to reconcile it, not to retire it, because **its concern is unowned elsewhere**:

| Concern | Owner |
|---|---|
| Per-capability completion | `AI_ENGINEERING_OPERATING_MODEL.md` §6 |
| Evidence shape and immutability | `governance/audit-artifact-standard.md` |
| Which environment a command may target | `governance/execution-environments.md` |
| Decision provenance | `DECISIONS.md` |
| **Periodic whole-estate conformance certification with executive exception reporting** | **ECF — nothing else** |

Program 0 is the proof of value: index drift, four stale maturity claims, three false deployment statements, and an ungated production release path all persisted undetected. Every one is the kind of finding a cadenced delta certification is designed to catch systematically rather than by a commissioned review.

## 2. The three reconciliations required

**REC-1 · Bind certification scope to the promotion lifecycle.** ECF must not define a parallel review. A certification asserts, for a named baseline, that each capability's claimed lifecycle stage (`DESIGNED → … → OPERATIONALLY VERIFIED`) is **true**. It reuses `AI_ENGINEERING_OPERATING_MODEL.md` §7's stages verbatim; it introduces no new stage, gate, or approval, and it never authorizes a promotion — it only reports whether claimed state matches real state.

**REC-2 · Reuse the evidence standard.** Certification evidence is produced under `governance/audit-artifact-standard.md` (hashing, sanitization, immutability, run metadata) and stored under `docs/audits/`. ECF defines **no** evidence format of its own.

**REC-3 · Define Green/Yellow/Red against the implementation-state axis.** ECF's exception reporting must key on `PlatformCapabilityModel.md` §5a, so certification cannot repeat the maturity-vs-implementation conflation Program 0 corrected:

| Signal | Meaning |
|---|---|
| **Green** | Claimed implementation state matches evidence; no present-tense claim exceeds implementation. |
| **Yellow** | Documentation drift, an unresolved UNKNOWN, or a claim ahead of its evidence. Owner attention; work continues. |
| **Red** | A live security/integrity/production risk, or a governance control asserted but not in force. Stop the affected lane. |

Under these definitions the estate at `c002b5e` would certify **Yellow**, with **Red** on the duplicate authorization model (R-1) and the ungated production release path (R-2) — both already elevated and sequenced. Recording that expected result now is deliberate: an activation that produced an implausibly clean first certification would indicate the criteria were set too loosely.

## 3. The three Core Artifacts, on activation

| Artifact | Shape | Home |
|---|---|---|
| **Enterprise Certification Matrix** | One row per capability and platform service from §5a; claimed stage, evidence citation, signal. | `docs/governance/certification/matrix.md` |
| **Recommendation Register** | Append-only. Each finding: id, severity, owning artifact/issue, status. Findings become work, not prose. | `docs/governance/certification/recommendations.md` |
| **Certification History** | Append-only. One entry per certification: baseline SHA, date, signal summary, delta vs prior baseline. | `docs/governance/certification/history.md` |

Delta certifications compare against the **last certified commit**, which is why the baseline must be explicit.

## 4. Proposed baseline

**`c002b5e`** — the Program 0 merge commit, the first point at which repository statements were verified true against implementation. Certifying an earlier baseline would certify statements now known false.

## 5. Cadence (proposed, for Owner ratification at activation)

Per **capability boundary** rather than per calendar interval — consistent with §1a evidence-based sequencing and with capability-level delivery. A time-based cadence would generate certifications with no delta. A supplementary certification is warranted whenever a Red is opened or closed.

## 6. Sequencing

C5 Certification Activation remains **last** in the accepted program order, and correctly so: certifying an estate whose two Reds are already known and scheduled would generate reporting without changing the work. ECF earns its keep once R-1 and R-2 are closed and the estate's state is no longer obvious — that is when drift resumes silently.

**Nothing in this plan is activated.** Activation is a separate assignment requiring the three reconciliations above, the three artifacts instantiated at the ratified baseline, and Owner ratification of the cadence.
