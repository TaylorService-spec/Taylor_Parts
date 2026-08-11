# Owner-friction evidence — eos-authorize-review MCP setup (2026-08-11)

Recorded so the same setup failure is not repeated for another installation.

## What failed

The MCP package installed and its tests passed (reported 20/20), but the Owner could not make the
`authorize_review` tool usable. Observed failures:

- the assumed **Claude Desktop** config location (`claude_desktop_config.json`) did not exist;
- Desktop vs **embedded Claude Code** applicability was misidentified;
- `claude` was not on `PATH`;
- versioned `claude` executable paths were unreliable;
- process discovery selected the Microsoft Store `Claude.exe`;
- executing that binary produced **Access Denied**.

## Root cause

Two mistakes, both mine:

1. **Wrong integration surface.** The runtime is **embedded Claude Code**, whose supported MCP mechanism is
   a project-root **`.mcp.json`** (stdio server), read at session startup and approved via `/mcp`. It is NOT
   Claude Desktop's `claude_desktop_config.json`, and it does NOT require locating or executing the `claude`
   binary at all — so the whole PATH / versioned-exe / Store-exe / Access-Denied chain was a dead end.
2. **Environment coupling.** The server file + its MCP SDK dependency were on `origin/main`, but the Owner's
   working checkout is dirty on a different branch and must not be touched — so the server was absent/undeployed
   in the directory the Owner was operating from.

## Supported mechanism (confirmed via the Claude Code MCP docs)

- Project-root `.mcp.json`:
  ```json
  { "mcpServers": { "eos-authorize-review": { "type": "stdio", "command": "node", "args": ["<abs path>/local-authorize-mcp.mjs"] } } }
  ```
- Discovered at startup; project servers show `⏸ Pending approval` and are approved with `/mcp`.
- `command: "node"` is valid when node is on PATH (it is); `.mjs` is native. The spawned server's cwd is the
  project root. The `claude` executable is not needed for registration.
- Verify with `claude mcp list` / `claude mcp get <name>` (if the CLI is on PATH) or the in-session `/mcp` panel.

## The fix (reusable, fail-closed)

`tools/eos-secrets/setup-authorize-mcp.mjs` — run once with **node** (not the `claude` binary):
it verifies the server file, installs the MCP SDK if missing, **merges** (never replaces) `.mcp.json`, and
verifies the server + SDK load. It touches no git state and never reads a credential. Output is a single
`READY` (with the one remaining action: restart Claude Code here and approve `eos-authorize-review`) or
`BLOCKED` with the exact reason. This removes every step that failed above and cannot select or execute the
`claude` binary.
