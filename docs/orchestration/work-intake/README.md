# Governed work intake bridge

This directory is the durable ingress seam for an Owner/ChatGPT-produced EOS work request. It is an
adapter into the existing orchestration stack, not a backlog, queue, selector, scheduler, authority, or
execution mechanism.

## Insertion point

`work-intake.mjs` resolves one exact artifact by `requestId + artifactLocation + sha256`, validates it,
and projects it into the ordinary work-item shape consumed by `selectNextWork()`. The selected item is
also emitted in the existing Wake Supervisor state shape. Wake Supervisor remains responsible for the
independent `READY ≠ authorized`, protected-boundary, resource, network, budget, provenance, lease, and
trigger gates.

```
Owner/ChatGPT artifact → hash-pinned intake resolver → existing selectNextWork
                                              └────→ existing Wake Supervisor state contract
worker output → content-addressed content + result manifest → existing result-consumption/review surfaces
```

No entry here grants authority, modifies the execution backlog, or proves execution. Git history and PR
review remain the source of truth.

## Artifact schema

An immutable `*.work.json` envelope contains:

- `requestId`, `title`, `intent`, the smallest sufficient file/surface `scope`, and existing C-7
  `contextScope` tags used to build the Wake context package;
- `source` (`producer`, `provenance`, optional `sourceRef`);
- `status`: `DISCOVERY`, `DESIGN_STAGING`, `EOS_READY`, or `EXECUTION_AUTHORIZED`;
- `authority.authorizationState`: `UNAUTHORIZED`, `REPO_SAFE`, `OWNER_REQUIRED`, or `AUTHORIZED`, plus
  its basis and any protected boundary;
- `artifactLocation` and `sha256`;
- `createdAt`, `updatedAt`; and
- `relatedRefs.issues` / `relatedRefs.pullRequests`.

Because a file cannot contain the byte hash of itself, `sha256` is precisely the SHA-256 of the canonical
JSON envelope with only the top-level `sha256` field omitted. The resolver recomputes it and fails closed
on any ID, location, embedded-hash, or content mismatch.

`EXECUTION_AUTHORIZED` is valid only with independent `authority.authorizationState: AUTHORIZED` and no
protected boundary. Earlier stages can enter the selector for repo-safe discovery/design work but remain
`authorized:false` at the Wake gate. `OWNER_REQUIRED` projects to the selector's existing
`OWNER_DECISION`; it is the only intake condition intended to interrupt the Owner.

## Submit, status, and result

Current repo-native submission is a reviewed Git commit/PR adding the artifact. A runner invocation uses
the exact triple rather than trusting a conversational pointer:

```powershell
node docs/orchestration/context/work-intake.mjs `
  --id EOS-INTAKE-001 `
  --location docs/orchestration/work-intake/EOS-INTAKE-001.work.json `
  --sha256 <64-hex> `
  --source-commit <git-sha>
```

The compact Owner-facing projection is:

```
SUBMIT: work://<id>
STATUS: status://<id>
RESULT: result://<id>
```

The CLI prints a compact resolved pointer, selector decision, and Wake-compatible state; it makes no AI
call. Worker output is stored as immutable `<content-sha>.content.md` plus a compact
`<manifest-sha>.result.json` that binds the result to the source request hash. The manifest also validates
as an existing Agent Result routed to the registered `EOS_INTAKE` workstream with
`AWAITING_INTERPRETATION`, so `resultConsumption.mjs` feeds it back to the same selector. Review artifacts
and `aiExchange` remain the existing downstream evidence/governance surfaces; this bridge does not replace
them. The manifest hash covers its canonical payload before the derived `artifactLocation` and `sha256`
self-reference fields are added.

Result Markdown is canonicalized to UTF-8/LF before hashing so Git's Windows checkout conversion cannot
change its content address.

## Status artifact + deterministic ChatGPT readback

`work://` (the request) and `result://` (the content-addressed result) already resolved, but the result
manifest is content-hash-addressed, so a reader could not fetch it from a requestId alone. `intakeStatus.mjs`
closes that: `status://<id>` resolves to ONE deterministic path derivable from the requestId with no search —

```
status://<id>  →  docs/orchestration/work-intake/status/<id>.status.json
result://<id>  →  docs/orchestration/work-intake/results/<id>/latest.result.json   (index → exact manifest)
work://<id>    →  docs/orchestration/work-intake/<id>.work.json
```

`resolvePointer(pointer)` returns the repo path plus the sibling status/result locations, so a single
deterministic read reaches the others. The compact status artifact summarizes — it does not dump telemetry:
`state` (STAGED · READY · ACTIVE · REVIEWING · CORRECTING · BLOCKED · OWNER_REQUIRED · COMPLETE · FAILED),
`currentWork`, `activeWorker`, `startedAt`/`updatedAt`, `ownerActionRequired`, `costToDateUsd`, the
`workArtifact` ref, the `resultRef` (present once COMPLETE), `provenance`, and its own fail-closed `sha256`.
A ChatGPT read connector, given only a requestId, reads `status://<id>`; when COMPLETE, the `resultRef`
carries the exact content-addressed manifest path + hash.

## Intake-state execution gate (independent of the selector)

`intakeIngress.mjs`'s `assessIntakeExecution` is a fail-closed governance-stage gate in front of any
execution, independent of the selector: `DISCOVERY` / `DESIGN_STAGING` may enter the selector for repo-safe
work but **must not execute**; `EOS_READY` is selector-eligible but is **not** execution authority; only
`EXECUTION_AUTHORIZED` with an independent `AUTHORIZED` authorization and no protected boundary may execute.
`ingestIntake` resolves (fail-closed on any id/location/hash mismatch), applies this gate, projects a single
item into the existing `selectNextWork`, and emits the status artifact — it creates no second queue and
executes nothing.

## OpenAI capability seam (Secret Broker)

`assessCapability({ name: "OPENAI_REVIEW", broker })` is an availability check only — it never returns,
requests, or handles a secret. When no broker is wired (the current state), the paid capability is
`NEEDS_ACTIVATION` and the paid path is `BLOCKED`; staging / read-only paths never consult it and need no
credential. When the EOS Secret Broker exists, execution asks it "do you have OPENAI_REVIEW?" and the broker
supplies the credential internally to the provider call — Claude/ChatGPT never see the key, and no key ever
appears in an artifact, status, result, or log.

## Automatic consumption + status write-back

Two workflows close the loop with no Owner PowerShell:

- `eos-intake-ingest` (read-only) — on any `*.work.json` change it resolves every artifact fail-closed
  (a bad self-hash fails CI), projects it into the existing selector, derives status, and checks the
  committed status matches. $0, no worker, no model, no secret.
- `eos-intake-writeback` (`contents: write`) — on a merge to `main` it derives each artifact's status and
  **commits it to the deterministic `status://<id>` path** so a ChatGPT read connector fetches status
  without search. It is idempotent (status uses the artifact's own `updatedAt`, so re-runs are
  byte-identical — no commit churn), scoped to write only `status/` + `results/`, commits with `[skip ci]`,
  and is triggered only by `*.work.json` so its own commits never re-trigger it. `main` is unprotected, so
  the default token pushes; if branch protection is added later, allow the `github-actions` bot or switch it
  to open a PR.

## Execution runtime (EXECUTION_AUTHORIZED → worker → result)

`intakeExecute.runIntakeExecution` carries an already-resolved intake through the EXISTING Wake Supervisor
(`executeWake`) to a content-addressed result + a `COMPLETE` status — no second execution mechanism. It
spawns **zero** until the intake-state gate (EXECUTION_AUTHORIZED + independent AUTHORIZED + no protected
boundary) AND the capability seam both pass; a paid capability with no Secret Broker is `BLOCKED`, never a
fabricated result; a wake failure is `FAILED`, never reported complete. `context/intake-runtime.mjs execute
--id … --location … --sha256 …` is the persistent-trigger entrypoint a hosted EOS runtime (or a self-hosted
CI runner with the `claude` CLI) calls per eligible item; it writes the status and, on COMPLETE, the
content-addressed result content + manifest + deterministic index. The same pure driver is exercised by the
acceptance test with an injected fake worker (`intakeAcceptance.test.mjs`), so the full chain is proven with
no live model call. Live auto-execution activates when a worker runtime is provisioned and — for paid
capabilities — the EOS Secret Broker (Codex/#790 boundary) is wired; until then paid items resolve to
`BLOCKED` fail-closed and no result is fabricated.

## Producer hash recipe (required)

A submission's `sha256` MUST be the SHA-256 of the canonical envelope with only the top-level `sha256` field
omitted — i.e. `sha256Bytes(stableJson(envelope-without-sha256))`, lowercase hex. This is **not** the hash of
the raw file bytes, nor of the pretty-printed JSON, nor of the envelope with `sha256` present. A producer
that uses any other recipe will be **rejected fail-closed** at resolve time (this is exactly why an
incorrectly-hashed ChatGPT submission does not execute). `intakeDigest(artifact)` computes the correct value.

## Direct ChatGPT gap

ChatGPT already produces the artifact + branch + PR through its GitHub connector. The remaining gap for a
fully hands-off loop is the Owner-enabled repo-write automation that commits the derived status back (above),
and — for paid execution — the EOS Secret Broker. The bridge still embeds no credentials and calls no
OpenAI/GitHub live; the authenticated ChatGPT adapter below is a thin producer of this same schema and does
not become a second queue or authority.

## Authenticated ChatGPT adapter

The integration-ready adapter at [`integrations/chatgpt-eos-intake/`](../../../integrations/chatgpt-eos-intake/README.md)
implements the thin authenticated MCP producer/reader for this schema. It opens a governed GitHub artifact
PR and returns the same pointers; it does not embed credentials, call OpenAI during tests, or add a second
queue or authority.

The remaining direct-use gap is external activation: provision OAuth, install a least-privilege GitHub
credential, host the MCP resource server on HTTPS, and connect it through ChatGPT developer mode. Those
identity, installation, hosting, and workspace operations are intentionally outside this repo-safe build.
