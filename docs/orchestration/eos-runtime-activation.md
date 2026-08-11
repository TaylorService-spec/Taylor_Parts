# EOS persistent execution runtime — activation runbook

The Claude-side integration is complete and acceptance-tested with fakes: the intake capability seam reads
the merged #790 Secret Broker, the paid review runs through the broker's `withCredential` boundary (key
never leaves that callback), and status/result write back to the deterministic paths automatically. This
runbook covers the **one remaining step, which is the Owner's — a protected runtime activation**: turning
on live paid execution on the Owner's Windows machine.

Live paid execution is physically confined to the Owner's Windows user: the credential is stored with DPAPI
`CurrentUser`, so only a process running under that Windows profile can decrypt it. A GitHub-hosted (Linux)
runner can never resolve the secret. This is a security property, not a limitation.

## What is already automatic (no Owner action)

- **Validation + status write-back** — `eos-intake-ingest` (read-only) and `eos-intake-writeback`
  (`contents: write`, main is unprotected) resolve every merged intake fail-closed and commit
  `status://<id>` to its deterministic path. ChatGPT reads status without search.
- **Capability gate** — `assessCapability` consults the broker's `credentialStatus`; no credential ⇒
  `NEEDS_ACTIVATION` ⇒ the paid path is `BLOCKED` (never a fabricated result).
- **Brokered review** — when an `EXECUTION_AUTHORIZED` intake requires `OPENAI_REVIEW`, the runtime resolves
  the credential internally via `broker.withCredential` and runs the review; authorization, budget, and
  at-most-once replay are enforced by the merged transport + spend ledger. The key appears in no artifact,
  status, result, or log.

## The Owner's protected activation (once)

1. **Provision the credential** (Owner's local PowerShell, input hidden, nothing committed):
   ```powershell
   .\tools\eos-secrets\Set-EOSSecret.ps1 -Name OPENAI_API_KEY
   ```
2. **Register a self-hosted runner** on the Owner's Windows machine, running under the same Windows user
   that owns the DPAPI secret, with the labels: `self-hosted`, `windows`, `eos-runtime`. Isolate it from
   untrusted same-user processes (DPAPI does not defend against code already running as that user).
3. **Enable the runtime**: set the repository variable `EOS_RUNTIME_ENABLED` to `true`.

That is the entire activation. After it, the loop is hands-off: ChatGPT submits `work://`, the write-back
workflow publishes `status://`, and on a merged `EXECUTION_AUTHORIZED` intake the `eos-intake-execute`
workflow (self-hosted, gated on `EOS_RUNTIME_ENABLED`) wakes the worker, resolves the credential internally,
runs the review, and commits `result://` — Owner PowerShell = 0, Claude GUI = 0 thereafter.

## Fail-closed guarantees preserved

- Only `EXECUTION_AUTHORIZED` + independent `AUTHORIZED` + no protected boundary may execute; `DESIGN_STAGING`
  / `EOS_READY` never execute.
- The credential releases only for a hash-verified, unexpired review **authorization** artifact bound to the
  exact `workId`/`reviewId`/`sourceCommit`/`workArtifactSha256`; a replayed or over-budget invocation refuses
  before the secret resolves.
- The runtime writes a result ONLY on a genuine worker completion; a wake failure is `FAILED`, a missing
  credential is `BLOCKED` — neither fabricates a result.
- Disabling is immediate: set `EOS_RUNTIME_ENABLED` to anything but `true`, or take the runner offline.
