# Owner-authenticated review authorization from Claude Desktop

**Operability gap (why this exists):** #790 exposed `authorize_review` only behind the remote Streamable-HTTP
+ OAuth server, which is not deployed and not connectable to Claude Desktop. There was no Owner-facing
authenticated authorization control in Claude Desktop. This adds one — governed, not a bypass.

`integrations/chatgpt-eos-intake/src/local-authorize-mcp.mjs` is a **local stdio MCP server** exposing only
`authorize_review`. It reuses #790's exact `buildReviewAuthorization` contract, derives the authenticated
authorizer from the Owner's **verified GitHub identity** (`gh api user`, fail-closed), runs locally as the
Owner (the same trust domain the DPAPI credential already relies on), binds the **exact grant**, and creates
an authority artifact only — it can read no secret and grant no spend. The broker still independently enforces
the grant at `withCredential`.

## One-time setup (Owner)

1. Install deps:
   ```bash
   npm install --prefix integrations/chatgpt-eos-intake
   ```
2. Ensure GitHub auth (once): `gh auth login`.
3. Add the server to Claude Desktop config (`claude_desktop_config.json` → `mcpServers`):
   ```json
   "eos-authorize-review": {
     "command": "node",
     "args": ["D:\\Taylor_Parts\\integrations\\chatgpt-eos-intake\\src\\local-authorize-mcp.mjs"]
   }
   ```
4. Restart Claude Desktop. The `authorize_review` tool now appears.

## The authenticated action (Owner, per review)

In Claude Desktop, invoke `authorize_review` and approve the tool call with the exact grant, e.g.:

```
workId: EOS-BASELINE-001
reviewId: REV-001
sourceCommit: <exact 40-hex commit>
workArtifactSha256: <exact 64-hex>
maxSpendUsd: 0.10
expiresAt: <near-future UTC>
provenance: Owner authorized one governed GPT baseline
```

Claude Desktop's tool-approval dialog is the authenticated, human-in-the-loop authorization. The server
commits `docs/orchestration/work-intake/authorizations/<workId>/<reviewId>.authorization.json`, stamped with
your verified GitHub identity. No secret is read, printed, or exposed; the legacy API path is not used.
