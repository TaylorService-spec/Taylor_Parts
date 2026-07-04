// SessionStart hook: injects docs/CLAUDE_CONTEXT.md into the new
// session's context automatically, so a fresh Claude session always
// starts with this repo's orientation notes without anyone needing to
// remember to reference it.
const fs = require("fs");
const path = require("path");

const contextPath = path.join(process.cwd(), "docs", "CLAUDE_CONTEXT.md");

let output = {};
try {
  const content = fs.readFileSync(contextPath, "utf8");
  output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Project context from docs/CLAUDE_CONTEXT.md:\n\n${content}`,
    },
  };
} catch {
  // File doesn't exist yet (e.g. first-ever session) -- inject nothing,
  // don't fail the session start.
}

console.log(JSON.stringify(output));
