# Enterprise Certification Framework (ECF)

Status: **v1.0 approved as a framework — NOT ACTIVATED.** No certification has ever been run.

> **Truth-pass correction (2026-08-06).** The prior status line read "Baseline Approved (v1.0)," which
> reads as though a baseline certification had been performed. It had not. **None of the three Core
> Artifacts below exist** — there is no Enterprise Certification Matrix, no Recommendation Register,
> and no Certification History anywhere in the repository. The framework is approved in principle and
> unexercised in practice.
>
> **Disposition recommendation: RECONCILE THEN ACTIVATE** — see
> [`../reviews/eao-program-0-truth-pass.md`](../reviews/eao-program-0-truth-pass.md) for the evidence.
> In summary: ECF's concern (periodic, delta-based, whole-system conformance certification with
> exception reporting) is **not owned by any other governance document** — the AI Engineering
> Operating Model governs per-capability completion, not whole-estate certification — so it is
> complementary rather than duplicative and should not be retired. Before activation it needs three
> reconciliations: bind certification scope to the DESIGNED→…→RETIRED promotion lifecycle rather than
> defining a parallel review; reuse [`audit-artifact-standard.md`](audit-artifact-standard.md) for
> evidence shape instead of inventing one; and adopt an explicit baseline commit. Activation is a
> separate assignment and is **not** performed by the truth pass.

Purpose:
Establish a continuous certification process for Enterprise Operations OS.

Principles:
- Repository is the source of truth.
- One-time baseline certification.
- Future reviews are delta certifications against the last certified commit.
- Executive reporting by exception: Green (auto-approved), Yellow (owner attention), Red (stop).
- Every certification updates the Enterprise Certification Matrix.
- Recommendations are tracked in a Recommendation Register.
- Evidence supports every certification.
- The framework evolves only through evidence from completed certifications.

Core Artifacts:
- Enterprise Certification Matrix
- Recommendation Register
- Certification History
