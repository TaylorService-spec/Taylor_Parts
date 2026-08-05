// build-request.mjs
//
// Deterministic Codex review-request builder for Taylor_Parts.
//
// PURE CORE: every exported function below is a pure function of its inputs.
// It does NOT call gh, git, the network, or the filesystem, so it is fully
// unit-testable without side effects. Callers (a human, Claude, or Codex)
// gather the real repo state with gh/git and pass it in as plain data.
//
// A thin CLI at the bottom reads a JSON payload (from --json <file>, --json -,
// or stdin) and prints the rendered block. --dry-run only affects the CLI's
// exit banner; the pure core never mutates anything.

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const DEFAULT_REPO = "TaylorService-spec/Taylor_Parts";

/** A firestore.rules file in either copy (root or functions mirror, any dir). */
export function isRulesPath(p) {
  return /(^|\/)firestore\.rules$/.test(String(p));
}

/** True when the changed set is entirely documentation (docs/ or *.md). */
export function isDocsOnly(files) {
  const list = normalizeFiles(files);
  if (list.length === 0) return false;
  return list.every(
    (f) => f.startsWith("docs/") || /\.md$/i.test(f) || /(^|\/)README\b/i.test(f),
  );
}

/**
 * Heuristic: does the diff plausibly touch query / render / realtime hot paths?
 * Path-based only (the pure core cannot read file contents). Front-end render
 * files, hooks/services, and anything named for queries or onSnapshot count.
 */
export function touchesPerformance(files) {
  const list = normalizeFiles(files);
  return list.some((f) => {
    if (/\.(jsx|tsx|vue|svelte)$/i.test(f)) return true;
    if (/(query|queries|onsnapshot|snapshot|useeffect|render|service|hook)/i.test(f)) {
      // exclude pure docs/tests noise
      if (f.startsWith("docs/")) return false;
      return true;
    }
    return false;
  });
}

export function touchesRules(files) {
  return normalizeFiles(files).some(isRulesPath);
}

/**
 * Decide whether a Codex review is warranted, per docs/ai/workflow.md.
 * Returns { warranted, reason }.
 */
export function assessWarrant(files, opts = {}) {
  const list = normalizeFiles(files);
  if (list.length === 0) {
    return { warranted: false, reason: "no changed files supplied" };
  }
  if (touchesRules(list)) {
    return { warranted: true, reason: "firestore.rules changed — highest-value Codex reason" };
  }
  if (isDocsOnly(list)) {
    return {
      warranted: false,
      reason: "docs-only: every changed path is under docs/ or is Markdown — Codex not warranted per workflow.md",
    };
  }
  if (opts.forceWarrant) {
    return { warranted: true, reason: "caller forced (security/complex-transaction/large-refactor)" };
  }
  // Default: code change -> warranted.
  return { warranted: true, reason: "code change with reviewable behavior" };
}

/**
 * Build the pruned "Review for" list. Correctness/Security/Maintainability/
 * Testing kept by default for code; Firestore Rules and Performance only when
 * the diff justifies them.
 */
export function buildReviewForList(files, opts = {}) {
  const list = normalizeFiles(files);
  const items = ["Correctness", "Security"];
  const rules = opts.rules ?? touchesRules(list);
  const perf = opts.performance ?? touchesPerformance(list);
  if (rules) items.push("Firestore Rules");
  if (perf) items.push("Performance");
  items.push("Maintainability");
  items.push("Testing");
  return items;
}

export function renderChangedFiles(files, maxList = 40) {
  const list = normalizeFiles(files);
  const header = `Changed files (${list.length}):`;
  if (list.length === 0) return `${header}\n- (none listed)`;
  if (list.length > maxList) {
    return `${header}\n- ${list.length} files — see PR diff`;
  }
  return `${header}\n${list.map((f) => `- ${f}`).join("\n")}`;
}

/**
 * Render the full request block from verified state. Pure.
 * input: {
 *   repo?, pr?: {number,title}|null, branch, base,
 *   changedFiles: string[], specPath?, planPath?, outOfScope?,
 *   forceWarrant?, rules?, performance?, maxList?
 * }
 * Returns { block, warranted, reason, reviewFor }.
 */
export function buildReviewRequest(input = {}) {
  const repo = input.repo || DEFAULT_REPO;
  const files = normalizeFiles(input.changedFiles);
  const { warranted, reason } = assessWarrant(files, {
    forceWarrant: input.forceWarrant,
  });

  const prLine =
    input.pr && input.pr.number != null
      ? `#${input.pr.number} — ${input.pr.title ?? "(untitled)"}`
      : `(none yet — branch ${input.branch ?? "(unknown)"})`;

  const branch = input.branch ?? "(unknown)";
  const base = input.base ?? "main";
  const spec = valueOrNotCommitted(input.specPath);
  const plan = valueOrNotCommitted(input.planPath);

  const reviewFor = buildReviewForList(files, {
    rules: input.rules,
    performance: input.performance,
  });

  const lines = [];
  lines.push(`Repository: ${repo}`);
  lines.push(`PR: ${prLine}`);
  lines.push(`Branch: ${branch}  (base: ${base})`);
  lines.push(`Specification: ${spec}`);
  lines.push(`Implementation Plan: ${plan}`);
  lines.push("");
  lines.push("Review for:");
  for (const item of reviewFor) lines.push(`- ${item}`);
  lines.push("");
  lines.push(renderChangedFiles(files, input.maxList ?? 40));

  const block = lines.join("\n");

  const footerLines = [];
  if (input.outOfScope) {
    footerLines.push(`Out of scope for this PR: ${input.outOfScope}`);
  }
  footerLines.push(
    "If architecture appears incorrect: raise it for ChatGPT's next pass — do not redesign.",
  );

  return { block, footer: footerLines.join("\n"), warranted, reason, reviewFor };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function normalizeFiles(files) {
  if (!files) return [];
  const arr = Array.isArray(files) ? files : [files];
  return arr
    .map((f) => (typeof f === "string" ? f : f && f.path))
    .filter((f) => typeof f === "string" && f.trim().length > 0)
    .map((f) => f.trim());
}

function valueOrNotCommitted(p) {
  return p && String(p).trim().length > 0 ? String(p).trim() : "(not committed)";
}

// ---------------------------------------------------------------------------
// CLI (side-effecting shell only — pure core above is untouched)
// ---------------------------------------------------------------------------

function isMainModule() {
  try {
    const thisPath = new URL(import.meta.url).pathname;
    const argv1 = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
    return argv1 && thisPath.replace(/\\/g, "/").endsWith(argv1.split("/").pop());
  } catch {
    return false;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let jsonArg = null;
  const jIdx = args.indexOf("--json");
  if (jIdx !== -1) jsonArg = args[jIdx + 1];

  let raw;
  if (jsonArg && jsonArg !== "-") {
    const fs = await import("node:fs/promises");
    raw = await fs.readFile(jsonArg, "utf8");
  } else {
    raw = await readStdin();
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(
      "Provide the verified PR/branch state as JSON via --json <file>, --json - , or stdin.\n" +
        `Parse error: ${e.message}\n`,
    );
    process.exit(2);
  }

  const { block, footer, warranted, reason } = buildReviewRequest(input);

  if (!warranted) {
    process.stdout.write(`Codex review NOT warranted: ${reason}\n`);
    if (!dryRun) process.exit(0);
  }

  process.stdout.write(block + "\n\n" + footer + "\n");
  if (dryRun) {
    process.stdout.write(`\n[dry-run] assessment: warranted=${warranted} (${reason})\n`);
  }
}

if (isMainModule()) {
  main().catch((e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  });
}
