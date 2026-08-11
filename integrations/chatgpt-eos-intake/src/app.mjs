import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { handleMcpRequest } from "./mcp.mjs";

export function createApp({ config, verifier, store }) {
  const app = createMcpExpressApp();
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.resource);
  const metadata = {
    resource: config.resource.href,
    authorization_servers: [config.issuer.href],
    scopes_supported: ["eos.intake.read", "eos.intake.submit", "eos.authorize_review"],
    resource_name: "Taylor Parts EOS governed intake",
  };
  const metadataPath = new URL(metadataUrl).pathname;
  app.get(metadataPath, (_req, res) => res.json(metadata));
  app.use("/mcp", requireBearerAuth({ verifier, resourceMetadataUrl: metadataUrl }));
  app.post("/mcp", (req, res) => handleMcpRequest(req, res, { store }).catch(() => {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal_error" }, id: null });
  }));
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "method_not_allowed" }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "method_not_allowed" }));
  app.get("/healthz", (_req, res) => res.json({ status: "ready" }));
  return app;
}
