# ChatGPT → EOS authenticated intake

Integration-ready, repo-safe MCP resource server for the existing governed work-intake bridge. It is an ingress adapter only: it creates or reads artifacts under `docs/orchestration/work-intake/`, while the existing EOS runner, selector, Wake Supervisor, `aiExchange`, review workflow, and authorization boundaries remain authoritative.

## Contract

| Owner-facing operation | MCP tool | Durable response |
|---|---|---|
| Submit | `submit_work` | `work://<requestId>` plus exact location and SHA-256 |
| Status | `get_work_status` | `status://<requestId>` plus verified compact state |
| Result | `get_work_result` | `result://<requestId>` plus verified content-addressed manifest metadata |
| Review authority | `authorize_review` | `authorization://<reviewId>` plus exact location and SHA-256 |

`submit_work` accepts `DISCOVERY`, `DESIGN_STAGING`, or `EOS_READY` and `UNAUTHORIZED`, `REPO_SAFE`, or `OWNER_REQUIRED`. It deliberately rejects `EXECUTION_AUTHORIZED` and `AUTHORIZED`: OAuth proves who submitted an artifact; it does not replace repository authorization or grant execution authority. Only an existing governed Owner authorization path can advance that boundary.

`authorize_review` requires the separate `eos.authorize_review` OAuth scope and records a GitHub-reviewed `OPENAI_REVIEW` authorization artifact bound to the exact work ID/hash, review ID, source commit, cumulative spend ceiling, expiry, and authenticated authorizer. It does not decrypt credentials or call OpenAI. No MCP tool reads, exports, or reports secret material; EOS resolves the credential only inside the trusted runtime through the [Secret Broker](../../docs/orchestration/secret-broker.md).

## Insertion point and flow

1. ChatGPT connects to the HTTPS Streamable HTTP endpoint at `/mcp` and discovers OAuth metadata at `/.well-known/oauth-protected-resource/mcp`.
2. The resource server verifies every bearer JWT against the configured issuer JWKS, issuer, audience, expiry, signature, subject, and tool scope.
3. `submit_work` constructs the existing work-intake schema, binds authenticated subject/client provenance, computes its canonical SHA-256, and opens a GitHub branch and pull request containing `docs/orchestration/work-intake/<id>.work.json`.
4. After the governed PR reaches `main`, the existing EOS runner resolves exactly `requestId + artifactLocation + sha256`, then hands the projected item to the existing selector and Wake Supervisor.
5. Status reads the merged, hash-verified intake. Result reads and verifies the existing content-addressed result manifest. Conversational responses stay pointer-sized.

GitHub is the source of truth. There is no service database, queue, backlog, selector, scheduler, or parallel orchestration state.

## Local verification

```powershell
npm install --ignore-scripts
npm test
```

Tests use local keys, an in-memory store, and mocked HTTP. They make no OpenAI or GitHub calls.

## Integration activation boundary

The repository deliverable stops before these protected/external actions:

1. Provision an OAuth 2.1 authorization server/client policy supporting PKCE and the scopes `eos.intake.read`, `eos.intake.submit`, and separately restricted `eos.authorize_review`.
2. Create/install a least-privilege GitHub App or fine-grained token able to read contents and create branches, commits, and pull requests. Supply it through a secret manager as `EOS_INTAKE_GITHUB_TOKEN`.
3. Deploy this package behind public HTTPS, using `.env.example` as the configuration contract. Do not store credentials in the repository.
4. Validate with MCP Inspector, then add the `/mcp` URL in ChatGPT developer mode and complete OAuth sign-in.
5. Perform a sandbox submission and merge it through normal repository governance. Confirm the existing EOS runner consumes the returned ID/location/hash and returns `status://` and `result://` pointers.

Those steps require external identity, GitHub installation, hosting, and ChatGPT workspace configuration. No live OpenAI call or deployment is performed by this change.

## Runtime security notes

- The OAuth audience should equal the canonical MCP resource URL.
- Keep submit and read scopes separate. Repository governance remains a second authorization layer.
- Tool annotations describe behavior for clients but are not trusted as access control.
- Run a single stateless MCP server per request; all durable state lives in reviewed GitHub artifacts.
- Restrict deployment egress to the configured issuer/JWKS and GitHub API.
