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

## Direct ChatGPT gap

Today ChatGPT still needs a repository write-capable integration that can authenticate the Owner, create
the validated artifact on a branch, open the governed PR, and return the resulting `work://` pointer.
The bridge deliberately does not embed credentials or call OpenAI/GitHub live. A future ChatGPT custom app
or MCP tool can be a thin producer of this same schema; it must not become a second queue or authority.
