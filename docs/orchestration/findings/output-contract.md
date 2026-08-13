# Audit worker output contract — structured findings

For the audit closed loop to self-dedup (instead of fail-closing to "surface everything"), an audit worker must
emit its findings in a machine-readable block **in addition to** its human-readable report. This is the input
side of the loop: worker output → `extractFindings` → validated structured findings → consolidation → reconcile
against the register.

## The block

A single fenced code block tagged `eos-findings` containing a **JSON array** of findings:

```eos-findings
[
  {
    "file": "functions/src/transitionWorkOrder.ts",
    "symbol": "transitionWorkOrder",
    "discriminator": "no-technician-availability-check",
    "severity": "HIGH",
    "category": "concurrency",
    "evidence": "No availability/conflict check anywhere in the file; Dispatch assigns assignedTechId unconditionally.",
    "line": 64
  }
]
```

## Field contract (enforced by `findingSchema.validateFinding`)

| field | required | rule |
|---|---|---|
| `file` | yes | repo-relative path (no absolute, no `..`) |
| `discriminator` | yes | stable lowercase-kebab slug — the **issue identity** (survives line/wording drift; distinct issues in one symbol get distinct slugs) |
| `severity` | yes | `INFO` / `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` |
| `category` | yes | non-empty |
| `evidence` | yes | non-empty — a finding must be verifiable |
| `symbol` | no | function/symbol name (sharper identity) |
| `line` | no | positive integer |

## Rules

- **Choose the discriminator deliberately and stably** — it is what the register fingerprints on. The *same*
  issue re-found in a later audit must use the *same* discriminator; two *different* issues in the same
  `file`/`symbol` must use *different* discriminators.
- **Every finding needs evidence.** No evidence → invalid → dropped from the structured set.
- **A valid empty `[]` is a real answer** ("the worker found zero findings") — that child consolidates clean.
- **Fail-closed on extraction failure:** a MISSING block, invalid JSON, a non-array, OR any individual finding
  that fails the contract is an **extraction failure**, not a clean result. `childFromResult` marks such a child
  `EXTRACTION_INVALID`, which **fails the completeness gate and blocks consolidation** until it's fixed/re-run —
  because the worker may have found real issues it simply failed to emit machine-readably, and treating that as
  "zero findings ⇒ clean" would silently suppress them. A malformed individual finding is preserved in `invalid`
  (surfaced, never dropped).
- The human report is still whatever the worker writes; only the `eos-findings` block is machine-consumed.
