import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import { SCOPES, requireScope } from "./auth.mjs";
import { buildIntake, compactSubmitResponse } from "./artifacts.mjs";

const response = (value) => ({
  content: [{ type: "text", text: value.pointer || value.submit || JSON.stringify(value) }],
  structuredContent: value,
});

export function createIntakeMcpServer({ store, now = () => new Date().toISOString() }) {
  const server = new McpServer({ name: "taylor-parts-chatgpt-eos-intake", version: "0.1.0" });

  server.registerTool("submit_work", {
    title: "Submit governed EOS work",
    description: "Writes one authenticated, hash-pinned work artifact to a GitHub pull request. This does not authorize execution.",
    inputSchema: {
      requestId: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{2,79}$/),
      title: z.string().min(1), intent: z.string().min(1),
      scope: z.array(z.string().min(1)).min(1), contextScope: z.array(z.string().min(1)).min(1),
      provenance: z.string().min(1),
      status: z.enum(["DISCOVERY", "DESIGN_STAGING", "EOS_READY"]).default("EOS_READY"),
      authorizationState: z.enum(["UNAUTHORIZED", "REPO_SAFE", "OWNER_REQUIRED"]).default("REPO_SAFE"),
      authorityBasis: z.string().min(1),
      protectedBoundary: z.string().optional(), ownerQuestion: z.string().optional(),
      issueRefs: z.array(z.union([z.string(), z.number()])).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input, extra) => {
    const auth = requireScope(extra, SCOPES.submit);
    const artifact = buildIntake(input, auth, now());
    const refs = await store.submit(artifact);
    return response(compactSubmitResponse(artifact, refs));
  });

  server.registerTool("get_work_status", {
    title: "Get governed EOS work status",
    description: "Reads and hash-verifies the exact GitHub-backed intake artifact.",
    inputSchema: { requestId: z.string().min(3) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ requestId }, extra) => {
    requireScope(extra, SCOPES.read);
    return response(await store.status(requestId));
  });

  server.registerTool("get_work_result", {
    title: "Get governed EOS work result pointer",
    description: "Reads the newest valid content-addressed result manifest from GitHub and returns a compact pointer.",
    inputSchema: { requestId: z.string().min(3) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ requestId }, extra) => {
    requireScope(extra, SCOPES.read);
    return response(await store.result(requestId));
  });
  return server;
}

export async function handleMcpRequest(req, res, dependencies) {
  const server = createIntakeMcpServer(dependencies);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close();
    await server.close();
  }
}
