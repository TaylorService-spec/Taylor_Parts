// One-command, fail-closed setup for the eos-authorize-review MCP server in EMBEDDED CLAUDE CODE.
//
// The supported Claude Code mechanism is a project-root `.mcp.json` (stdio server), read at session
// startup and approved via `/mcp` — NOT Claude Desktop's `claude_desktop_config.json`. This script does
// everything except the final in-app approval: it verifies the server file, installs the MCP SDK if
// missing, merges (never replaces) `.mcp.json`, and verifies the server + SDK actually load. It touches no
// git state (only an untracked `.mcp.json` + node_modules) and never reads/exposes a credential.
//
// Run with node (reliably on PATH; the `claude` executable is intentionally NOT depended on):
//   node tools/eos-secrets/setup-authorize-mcp.mjs
//
// Prints a single READY (with the one remaining Owner action) or BLOCKED (with the exact reason).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_REL = "integrations/chatgpt-eos-intake/src/local-authorize-mcp.mjs";
const INTEGRATION_DIR = join(REPO, "integrations", "chatgpt-eos-intake");
const SERVER_ABS = join(REPO, SERVER_REL);
const SDK = join(INTEGRATION_DIR, "node_modules", "@modelcontextprotocol", "sdk", "package.json");
const MCP_JSON = join(REPO, ".mcp.json");
const SERVER_NAME = "eos-authorize-review";

const blocked = (reason, fix) => { process.stdout.write(JSON.stringify({ result: "BLOCKED", reason, fix }, null, 2) + "\n"); process.exit(1); };

async function main() {
  // 1. The server file must be present in THIS checkout (fail-closed — do not fabricate).
  if (!existsSync(SERVER_ABS)) blocked(`server file missing at ${SERVER_REL}`, "run this from an up-to-date origin/main checkout (the local-authorize MCP landed on main via #799)");

  // 2. Ensure the MCP SDK is installed for the server (fixes the observed dependency gap).
  if (!existsSync(SDK)) {
    // execSync goes through a shell, so `npm` resolves to npm.cmd on Windows (execFile can't spawn .cmd → EINVAL).
    try { execSync("npm install", { cwd: INTEGRATION_DIR, stdio: "ignore" }); }
    catch (e) { blocked(`npm install failed in ${INTEGRATION_DIR}: ${e.message}`, "ensure npm is available on PATH, then re-run"); }
    if (!existsSync(SDK)) blocked("MCP SDK still not present after npm install", "check integrations/chatgpt-eos-intake/package.json and network access");
  }

  // 3. Merge (never replace) .mcp.json — preserve any existing mcpServers.
  let config = { mcpServers: {} };
  if (existsSync(MCP_JSON)) {
    try { config = JSON.parse(readFileSync(MCP_JSON, "utf8")); } catch { blocked(`.mcp.json exists but is not valid JSON`, "fix or remove .mcp.json, then re-run"); }
    if (!config.mcpServers || typeof config.mcpServers !== "object") config.mcpServers = {};
  }
  config.mcpServers[SERVER_NAME] = { type: "stdio", command: "node", args: [SERVER_ABS] };
  writeFileSync(MCP_JSON, JSON.stringify(config, null, 2) + "\n");

  // 4. Verify the server module loads (via a proper file:// URL — Windows absolute paths need pathToFileURL).
  //    The server resolves the MCP SDK from its own node_modules at runtime; the SDK package was confirmed
  //    present in step 2, so importing the server core is a sufficient, robust health check.
  try {
    const core = await import(pathToFileURL(SERVER_ABS).href);
    if (typeof core.buildLocalAuthorization !== "function" || typeof core.resolveGhIdentity !== "function") throw new Error("server core exports missing");
  } catch (e) { blocked(`server failed to load: ${e.message}`, "re-run; if it persists the SDK install is incomplete"); }

  // 5. Confirm the Owner's GitHub identity is available (the authenticated authorizer). Not fatal — the
  //    tool itself fails closed if absent — but reported so the Owner can fix it before invoking.
  let ghReady = false;
  try { execSync("gh auth status", { stdio: "ignore" }); ghReady = true; } catch { ghReady = false; }

  process.stdout.write(JSON.stringify({
    result: "READY",
    registered: { server: SERVER_NAME, mcpConfig: MCP_JSON, command: "node", args: [SERVER_ABS] },
    ghAuthenticated: ghReady,
    ownerAction: `Restart Claude Code in this folder (${REPO}); when prompted, approve the '${SERVER_NAME}' MCP server (or run /mcp and approve). The authorize_review tool then becomes available.` + (ghReady ? "" : " NOTE: run `gh auth login` first — an authenticated GitHub identity is required."),
  }, null, 2) + "\n");
}

main();
