# Audit Artifact Standard

**Status:** Normative. Adopted for the Taylor_Parts / Enterprise Operations OS program.
**Related:** [execution-environments.md](execution-environments.md) · [templates/operational-handoff.md](templates/operational-handoff.md)
**Reference implementation:** the F-RULES-1 production compatibility audit — tooling `functions/scripts/auditLegacyJobTechnicianData.js`, preserved evidence under `../audits/f-rules-1/`.

## Purpose

Audits must produce durable, attributable, immutable evidence rather than relying only on terminal output. A decision that exists only in a scrollback buffer is not governance evidence. This standard defines what a governed audit artifact must contain, how it is named and stored, how its integrity is protected, and how audits relate to the remediations they may trigger.

## Audit Classification

- **Read-only audit** — inspects state and emits a decision; performs no writes.
- **Production-mutating remediation** — changes data/config to resolve findings; a separate, separately-authorized action.
- **Post-remediation verification** — a fresh read-only audit run after a remediation, producing a new artifact.
- **Pre-deployment validation** — confirms readiness before a deploy (e.g. a compatibility GO gate).
- **Post-deployment verification** — confirms behavior after a deploy.

An audit and a remediation are **separate actions**. An audit never corrects; a GO decision never authorizes the remediation of its own REVIEW findings.

## Required Artifact Fields

For machine-readable artifacts, require where applicable:

- `schemaVersion`
- `auditId`
- `auditName`
- `generatedAt` (UTC, ISO-8601)
- `projectId` or environment identifier
- `executionEnvironment`
- `readOnly`
- command or script identity
- source revision or commit
- inspected collection / resource counts
- `checks` and their classifications
- `blockerCount`
- `reviewCount`
- `finalDecision`
- `errors`
- operator / execution actor, without unnecessary personal data

New audit tooling should emit these fields. This standard does **not** require retroactively changing the already-preserved F-RULES-1 artifact, which conforms to the earlier tooling contract (it omits some newer fields such as `schemaVersion`/`auditId`); its integrity as a preserved historical run is paramount and it must not be edited.

## Decision Vocabulary

- **GO** — no defined BLOCKER findings were found under the audit contract.
- **NO-GO** — at least one BLOCKER finding exists.
- **ERROR / INDETERMINATE** — the audit could not complete (e.g. a read failure, missing credentials); no data decision is available.

Rules:
- GO does **not** authorize unrelated cleanup or deployment.
- REVIEW findings must remain visible and must never be silently converted to passes.
- ERROR / INDETERMINATE must **never** be represented as GO. A technical failure is not a decision.

## File Naming

Deterministic convention:

```
<utc-timestamp>-<environment>-<audit-name>-<decision>.json
```

Example:

```
20260721T191600Z-production-legacy-job-technician-GO.json
```

A **stable governed filename** is also permitted when a repository process explicitly requires one (as with the F-RULES-1 evidence file `production-legacy-job-technician-audit.json`), **provided** `generatedAt` and integrity metadata are preserved inside the artifact so the run remains unambiguously identifiable.

## Storage Structure

```
docs/audits/<control-or-issue-id>/
  <audit-artifact>.json
  <audit-record>.md
  checksums.sha256        # required for governed evidence (see below)
```

`checksums.sha256` is **required** whenever an artifact is transferred between environments before being committed (e.g. generated in Cloud Shell, committed from Windows), so byte-integrity across the transfer is provable. It is recommended for all governed evidence.

## Immutability and Integrity

- The generated artifact is copied **verbatim** into the repository.
- No manual editing of counts, findings, document IDs, timestamps, or the decision.
- A **byte comparison** (`cmp`, or SHA-256 match) is performed when transferring between environments.
- Governed evidence carries a **SHA-256 checksum**.
- Regenerated evidence is a **new artifact**, never an overwrite of an existing one.
- Corrections must **preserve historical NO-GO evidence** when it has governance value (e.g. it documents why a remediation was required).

## Sensitive Data Rules

- Audit contracts should emit **identifiers and classifications**, not unnecessary names, emails, phone numbers, addresses, credentials, or tokens.
- A **sensitive-value scan** is performed before commit.
- Secrets are never committed.
- **Document IDs may remain** when required for remediation traceability, subject to the audit contract (the F-RULES-1 audit intentionally emits Firestore document IDs and is sensitive-value-free).
- Redaction happens **only** through an explicitly designed sanitization step that preserves the original securely and documents the transformation — never by hand-editing an artifact in place.

## Evidence Markdown Record

Each artifact is accompanied by a Markdown record with:

- purpose;
- audit scope;
- execution environment;
- script / command;
- source revision;
- `generatedAt`;
- decision;
- blocker findings;
- review findings;
- integrity verification (byte-identity / checksum);
- sensitive-data review;
- limitations;
- explicit **non-authorizations** (what the GO/NO-GO does not permit);
- follow-up gates.

## Audit Lifecycle

1. Define the audit contract.
2. Validate the script locally or against the emulator where possible.
3. Authorize the production read.
4. Execute in the authenticated production environment (operator).
5. Save the machine-readable output.
6. Verify the decision and required assertions.
7. Scan for sensitive values.
8. Transfer and verify byte identity.
9. Calculate the SHA-256 checksum.
10. Preserve the artifact and evidence record in a dedicated PR.
11. Merge the evidence PR.
12. Authorize any next implementation or deployment gate **separately**.

## NO-GO to GO Remediation Trail

- Retain or clearly record the initial **NO-GO** result when it has governance value.
- Document the remediation **separately** from the audit.
- Execute a **fresh audit** after correction.
- **Never modify** the original artifact.
- Preserve the final **GO** artifact as a **distinct run** (different `generatedAt`, different file), not an edit of the NO-GO artifact.

(The F-RULES-1 case is the canonical example: an initial NO-GO run flagged a technician-role user missing a `technicianId` mapping; a correction was applied by the operator; a fresh re-run produced the preserved GO artifact.)

## Standard Audit Handoff Templates

The following handoff shapes reuse the [operational-handoff template](templates/operational-handoff.md); each is a specialization of it.

### Production read-only audit request
State: project id, exact command with `--confirmProduction`, read-only classification, expected artifact output path, expected decision fields, stop conditions.

### Operator execution report
State: environment header, exact command run, resulting decision, per-collection inspected counts, artifact path + SHA-256, any errors, and an explicit "no writes occurred" confirmation.

### Evidence preservation request
State: artifact source path, destination `docs/audits/<id>/`, byte-identity requirement, sensitive-value scan requirement, expected assertions to re-verify before commit.

### NO-GO remediation follow-up
State: the fired BLOCKER categories, the proposed correction (separately authorized), the requirement to preserve the NO-GO artifact, and the requirement for a fresh post-correction audit.

### Post-deployment verification request
State: the deployed change identity (commit/SHA), the positive and negative checks to run, and the pass/fail evidence to preserve.
