// LOCAL stdio MCP server exposing ONLY `authorize_review` — the Owner-facing, in-interface authenticated
// authorization action for Claude Desktop. It closes the operability gap where #790 exposed authorize_review
// only behind the remote Streamable-HTTP + OAuth server (not deployed, not connectable to Claude Desktop).
//
// Governed, not a bypass:
//   • It reuses #790's EXACT buildReviewAuthorization contract (identical artifact, identical validation).
//   • The authenticated authorizer is the Owner's VERIFIED GitHub identity (`gh api user`) — an OAuth
//     identity the Owner actually holds; it fails closed if the Owner is not gh-authenticated.
//   • It runs locally as the Owner's user — the SAME trust domain the DPAPI credential already relies on.
//   • Claude Desktop's built-in tool-approval dialog is the explicit human-in-the-loop authorization.
//   • It binds the EXACT grant (workId/reviewId/sourceCommit/workArtifactSha256/OPENAI_REVIEW/maxSpendUsd)
//     and never touches the credential, never uses the legacy path, never prints a secret.
//
// It only CREATES an authority artifact (like the HTTP tool); it can read no secret and grant no spend on
// its own — the broker still independently enforces the grant at withCredential.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewAuthorization, serializeReviewAuthorization, validateReviewAuthorization } from "../../../docs/orchestration/lib/reviewAuthorization.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve the Owner's VERIFIED GitHub identity. Fail-closed: no gh auth ⇒ no authorizer ⇒ no authorization. */
export function resolveGhIdentity({ exec = execFileSync } = {}) {
  let raw;
  try { raw = exec("gh", ["api", "user", "--jq", "{login: .login, id: .id}"], { encoding: "utf8" }); }
  catch { throw new Error("NOT_AUTHENTICATED: run `gh auth login` first — an authenticated GitHub identity is required to authorize a review"); }
  const u = JSON.parse(raw);
  if (!u || !u.login || !u.id) throw new Error("NOT_AUTHENTICATED: gh returned no verified identity");
  return { subject: `github:${u.login}`, clientId: `github-oauth:${u.id}` };
}

/** Build the authorization artifact from the exact grant + the verified identity. Pure (identity injected). */
export function buildLocalAuthorization({ input, identity, now = new Date().toISOString() }) {
  const artifact = buildReviewAuthorization(input, { subject: identity.subject, clientId: identity.clientId }, now);
  const errors = validateReviewAuthorization(artifact);
  if (errors.length) throw new Error(`AUTHORIZATION_INVALID: ${errors.join("; ")}`);
  return artifact;
}

/** Write + commit + push the authorization artifact as the Owner's gh-authenticated commit. */
export function commitAuthorization({ artifact, repoRoot = REPO_ROOT, exec = execFileSync, write = writeFileSync }) {
  const path = join(repoRoot, artifact.artifactLocation);
  mkdirSync(dirname(path), { recursive: true });
  write(path, serializeReviewAuthorization(artifact));
  exec("git", ["-C", repoRoot, "add", artifact.artifactLocation], { encoding: "utf8" });
  exec("git", ["-C", repoRoot, "commit", "-m", `authorize review: ${artifact.workId}/${artifact.reviewId} [skip ci]`], { encoding: "utf8" });
  try { exec("git", ["-C", repoRoot, "push"], { encoding: "utf8" }); } catch { /* push may require an up-to-date branch; the Owner completes it */ }
  return { pointer: `authorization://${artifact.reviewId}`, location: artifact.artifactLocation, sha256: artifact.sha256 };
}

async function main() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");
  const server = new McpServer({ name: "eos-local-authorize-review", version: "0.1.0" });
  server.registerTool("authorize_review", {
    description: "Owner-authenticated: authorize ONE governed OPENAI_REVIEW for an exact work/review at an exact commit + work-artifact hash, with a spend ceiling. Creates the authority artifact only; grants no secret access.",
    inputSchema: {
      workId: z.string(), reviewId: z.string(), sourceCommit: z.string(), workArtifactSha256: z.string(),
      maxSpendUsd: z.number().positive(), expiresAt: z.string(), provenance: z.string(),
    },
  }, async (input) => {
    try {
      const identity = resolveGhIdentity();
      const artifact = buildLocalAuthorization({ input, identity });
      const out = commitAuthorization({ artifact });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...out, authorizedBy: artifact.authorizedBy }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, reason: e.message }, null, 2) }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
