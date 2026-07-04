// Stop hook: fires every time Claude tries to end a turn. The first
// time in a given session, it blocks and instructs Claude to update
// docs/CLAUDE_CONTEXT.md with a real summary (using its own
// understanding of the conversation -- a shell command has no access
// to that). A marker file (keyed by session_id) makes this a one-time
// block per session: the second time Stop fires (after Claude has
// done the update and tries to end again), the marker already exists
// and the hook allows the session to actually end.
const fs = require("fs");
const path = require("path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let sessionId = "unknown";
try {
  const input = JSON.parse(readStdin() || "{}");
  sessionId = input.session_id || "unknown";
} catch {
  // malformed/missing stdin -- fall back to "unknown", still safe
  // (worst case: one block per malformed-input session)
}

const markerDir = path.join(process.cwd(), ".claude", ".session-markers");
const markerPath = path.join(markerDir, sessionId);

if (fs.existsSync(markerPath)) {
  console.log("{}");
} else {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(markerPath, String(Date.now()));
  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        "Before ending this session, update docs/CLAUDE_CONTEXT.md with a concise summary of what happened this session -- what changed, what was decided, what remains open. Merge it into the existing structure (don't just append unstructured notes). " +
        "Critical: mark every claim as VERIFIED (you grepped/read the code, ran a command, or tested it directly this session) or UNVERIFIED/ASSUMED (stated from memory, inferred, or carried over without independently checking). A prior session once documented a fully-built inventory/job-events/phase system as fact when none of it existed in the actual code -- that's exactly the failure this distinction exists to prevent. Do not write a claim as fact unless you actually verified it this session. Then stop.",
    })
  );
}
