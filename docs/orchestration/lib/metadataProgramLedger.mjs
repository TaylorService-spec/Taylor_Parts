// EOS Metadata-to-Platform Program — durable execution ledger model.
//
// THE RESUMPTION AUTHORITY. A fresh session (or a fresh agent) reads governance,
// then reads this, reconciles it against GitHub/main, and continues from the next
// executable item WITHOUT asking what happened. Conversation memory is not a
// resumption mechanism; this is.
//
// THE LEDGER IS A CACHE. GitHub and the repository are truth. Every claim here is
// a claim until verified — `reconcile()` exists precisely so a resuming session can
// prove or disprove each row against observed state rather than trusting it. If a
// row and the repository disagree, the repository wins and the row is corrected.
//
// Follows the conventions of ./roadmapModel.mjs deliberately: frozen enums, an
// explicit UNKNOWN sentinel that is never guessed, and orthogonal dimensions kept
// as SEPARATE fields so they can never collapse into one misleading number.
// MERGED != DEPLOYED. REVIEW-QUEUED != BLOCKED. EXEMPT != COMPLETE.
//
// NOT a competing backlog. `../execution-backlog.md` remains the repo-wide
// schedulability ledger and `./roadmapModel.mjs` remains the durable roadmap state.
// This records something neither of them does: per-surface migration/conformance
// status for one program, at a granularity (every routed business surface) that
// would drown a repo-wide backlog.

/**
 * Schedulability state. Single enum per the program ruling — but every state that
 * asserts a repository fact (MERGE_QUEUED, MERGED, DEPLOY_QUEUED) additionally
 * REQUIRES the evidence field that proves it, so status is always re-derivable from
 * evidence rather than merely asserted. See `validateEntry`.
 */
export const STATUS = Object.freeze([
  "IMPLEMENTING",        // actively being built right now
  "READY",               // executable and unblocked, not yet started
  "REVIEW_QUEUED",       // gate package complete; material-architecture review owed, NOT waited on
  "MERGE_QUEUED",        // PR open, checks green, merge not yet performed (may be harness-denied)
  "MERGED",              // on origin/main, proven by mergeSha
  "DEPLOY_QUEUED",       // merged runtime work awaiting a pooled, authorized deploy checkpoint
  "BLOCKED_PROTECTED",   // needs an authority/action outside current delegation
  "BLOCKED_DEPENDENCY",  // needs another ledger item first
  "EXEMPT",              // deliberately not migrated; requires an explicit reason
  "COMPLETE",            // done and evidenced
]);

/** What kind of thing an entry is. Surfaces carry route/classification; others do not. */
export const KIND = Object.freeze([
  "SURFACE",           // a routed business surface being migrated
  "ARCHITECTURE",      // a shared contract/runtime slice
  "AUDIT",             // an evidence-producing investigation
  "GATE",              // a material architecture gate package
  "PROTECTED_ACTION",  // a queued action requiring Owner/operator authority
]);

/** Phase 0 surface classification (program charter Phase 0). */
export const CLASSIFICATION = Object.freeze([
  "A_ENTITY_LIST",
  "B_ENTITY_RECORD",
  "C_OPERATIONAL_COMPOSITE",
  "D_DASHBOARD_ANALYTIC",
  "E_ADMIN_CONFIG",
  "F_UTILITY_EXEMPT",
]);

/** Runtime deployment is ORTHOGONAL to merge. Never infer one from the other. */
export const DEPLOY = Object.freeze(["DEPLOYED", "NOT_DEPLOYED", "NOT_APPLICABLE", "UNKNOWN"]);

/** Material-architecture gates. REVIEW_QUEUED names which gate it belongs to. */
export const GATE = Object.freeze(["GATE_A", "GATE_B", "GATE_C", "NOT_APPLICABLE"]);

export const UNKNOWN = "UNKNOWN";

/** Statuses that assert a repository fact and therefore require proof. */
const REQUIRES_PR = Object.freeze(["MERGE_QUEUED"]);
const REQUIRES_MERGE_SHA = Object.freeze(["MERGED", "DEPLOY_QUEUED"]);
const BLOCKED = Object.freeze(["BLOCKED_PROTECTED", "BLOCKED_DEPENDENCY"]);

/**
 * One ledger entry. Unknown values use the UNKNOWN sentinel; they are never
 * guessed and never silently defaulted to something that reads as progress.
 */
export function makeEntry(input = {}) {
  return Object.freeze({
    id: input.id,
    phase: input.phase ?? UNKNOWN,
    wave: input.wave ?? UNKNOWN,
    kind: input.kind ?? UNKNOWN,
    title: input.title ?? UNKNOWN,
    domain: input.domain ?? UNKNOWN,
    route: input.route ?? null,
    classification: input.classification ?? null,
    entity: input.entity ?? UNKNOWN,
    status: input.status ?? UNKNOWN,
    gate: input.gate ?? "NOT_APPLICABLE",
    issue: input.issue ?? null,
    pr: input.pr ?? null,
    branch: input.branch ?? null,
    headSha: input.headSha ?? null,
    mergeSha: input.mergeSha ?? null,
    deploy: input.deploy ?? "NOT_APPLICABLE",
    sandboxPrep: input.sandboxPrep ?? null,
    checks: input.checks ?? UNKNOWN,
    blockers: Object.freeze([...(input.blockers ?? [])]),
    dependsOn: Object.freeze([...(input.dependsOn ?? [])]),
    nextAction: input.nextAction ?? UNKNOWN,
    governing: Object.freeze([...(input.governing ?? [])]),
    lane: input.lane ?? null,
    notes: input.notes ?? null,
  });
}

/**
 * Validate one entry. Returns an array of problem strings; empty means valid.
 *
 * The rules that matter are the ones preventing a ledger from *reading* as further
 * along than the repository actually is — a status that claims a merge without a
 * merge SHA, a block with no stated reason, or an exemption with no justification.
 * Those are the failure modes that would mislead a resuming session.
 */
export function validateEntry(entry, allIds = new Set()) {
  const problems = [];
  const at = entry?.id ? `entry ${entry.id}` : "entry (no id)";

  if (!entry?.id || typeof entry.id !== "string") problems.push(`${at}: id is required and must be a string`);
  if (!STATUS.includes(entry?.status)) problems.push(`${at}: status "${entry?.status}" is not a known STATUS`);
  if (!KIND.includes(entry?.kind)) problems.push(`${at}: kind "${entry?.kind}" is not a known KIND`);
  if (!DEPLOY.includes(entry?.deploy)) problems.push(`${at}: deploy "${entry?.deploy}" is not a known DEPLOY`);
  if (!GATE.includes(entry?.gate)) problems.push(`${at}: gate "${entry?.gate}" is not a known GATE`);

  // A SURFACE is defined by where it is routed and what shape it is. Without both,
  // conformance accounting (Phase 10) cannot tell whether the site is fully covered.
  if (entry?.kind === "SURFACE") {
    if (!entry.route) problems.push(`${at}: kind SURFACE requires a route`);
    if (!CLASSIFICATION.includes(entry.classification)) {
      problems.push(`${at}: kind SURFACE requires a valid classification, got "${entry.classification}"`);
    }
  }

  // Repository-fact statuses must carry their proof.
  if (REQUIRES_PR.includes(entry?.status)) {
    if (!entry.pr) problems.push(`${at}: status ${entry.status} requires a pr number`);
    if (!entry.headSha) problems.push(`${at}: status ${entry.status} requires the exact headSha`);
  }
  if (REQUIRES_MERGE_SHA.includes(entry?.status) && !entry.mergeSha) {
    problems.push(`${at}: status ${entry.status} requires a mergeSha — never record a merge without one`);
  }

  // A protected block with no reason is indistinguishable from forgotten work, and
  // one with no named decision cannot be unblocked by anyone but its author.
  // BLOCKED_DEPENDENCY is exempt from needing a prose blocker: `dependsOn` already
  // states the reason machine-readably, and demanding both produced pure restatement
  // the first time this ran against a real ledger.
  if (entry?.status === "BLOCKED_PROTECTED" && !entry.blockers?.length) {
    problems.push(`${at}: status ${entry.status} requires at least one blocker`);
  }
  if (BLOCKED.includes(entry?.status)) {
    for (const b of entry.blockers ?? []) {
      if (!b?.reason) problems.push(`${at}: every blocker requires a reason`);
      if (entry.status === "BLOCKED_PROTECTED" && !b?.requiredDecision) {
        problems.push(`${at}: a BLOCKED_PROTECTED blocker requires the requiredDecision it is waiting on`);
      }
    }
  }
  if (entry?.status === "BLOCKED_DEPENDENCY" && !entry.dependsOn?.length) {
    problems.push(`${at}: BLOCKED_DEPENDENCY requires at least one dependsOn id`);
  }

  // An exemption is a decision; it needs to be justified where it is recorded, or
  // Phase 10 conformance silently counts un-migrated surfaces as intentional.
  if (entry?.status === "EXEMPT" && !entry.notes) {
    problems.push(`${at}: EXEMPT requires notes stating why this surface is not migrated`);
  }

  // REVIEW_QUEUED must name its gate, or "review owed" degrades into a vague label.
  if (entry?.status === "REVIEW_QUEUED" && entry.gate === "NOT_APPLICABLE") {
    problems.push(`${at}: REVIEW_QUEUED requires gate GATE_A, GATE_B or GATE_C`);
  }

  for (const dep of entry?.dependsOn ?? []) {
    if (allIds.size && !allIds.has(dep)) problems.push(`${at}: dependsOn "${dep}" is not a known entry id`);
  }

  return problems;
}

/** Validate a whole ledger, including cross-entry rules. */
export function validateLedger(ledger) {
  const problems = [];
  const entries = ledger?.entries ?? [];
  const ids = new Set();

  for (const e of entries) {
    if (ids.has(e?.id)) problems.push(`duplicate entry id "${e.id}"`);
    if (e?.id) ids.add(e.id);
  }
  for (const e of entries) problems.push(...validateEntry(e, ids));

  // Dependency cycles would make "next executable item" undecidable.
  for (const cycle of findCycles(entries)) {
    problems.push(`dependency cycle: ${cycle.join(" -> ")}`);
  }
  return problems;
}

function findCycles(entries) {
  const byId = new Map(entries.filter((e) => e?.id).map((e) => [e.id, e]));
  const cycles = [];
  const state = new Map(); // id -> 1 visiting, 2 done

  const walk = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return;
    }
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) walk(dep, [...path, id]);
    }
    state.set(id, 2);
  };
  for (const e of entries) if (e?.id) walk(e.id, []);
  return cycles;
}

/**
 * Deterministic "what do I do next" — the scheduling rule from the program ruling.
 * Never idles because the preferred item is blocked: it returns every executable
 * item in phase order, and the caller takes the first.
 *
 * Executable means READY or IMPLEMENTING, with every dependency satisfied.
 * A dependency is satisfied when it is MERGED, COMPLETE or EXEMPT — deliberately
 * NOT when it is merely MERGE_QUEUED, because building on an unmerged architecture
 * PR is the dependency-stack risk the ruling warns about.
 */
export function selectExecutable(ledger) {
  const entries = ledger?.entries ?? [];
  const satisfied = new Set(
    entries.filter((e) => ["MERGED", "COMPLETE", "EXEMPT"].includes(e.status)).map((e) => e.id)
  );
  return entries
    .filter((e) => ["READY", "IMPLEMENTING"].includes(e.status))
    .filter((e) => (e.dependsOn ?? []).every((d) => satisfied.has(d)))
    .sort((a, b) => String(a.phase).localeCompare(String(b.phase), "en", { numeric: true }) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Reconcile ledger claims against OBSERVED repository state. The ledger is a cache;
 * this is how a resuming session refuses to trust it.
 *
 * `observed` is supplied by the caller from real commands (gh pr view / git log),
 * never inferred here — this module runs no shell and reads no network.
 *
 * @param {{entries: Array}} ledger
 * @param {{prs?: Record<string|number, {state?: string, mergeCommit?: string|null, headSha?: string|null}>,
 *          mainShas?: string[]}} observed
 * @returns {Array<{id: string, claim: string, observation: string}>} disagreements
 */
export function reconcile(ledger, observed = {}) {
  const out = [];
  const prs = observed.prs ?? {};
  const mainShas = new Set(observed.mainShas ?? []);

  for (const e of ledger?.entries ?? []) {
    const seen = e.pr != null ? prs[String(e.pr)] : undefined;

    if (e.status === "MERGE_QUEUED") {
      if (seen?.state === "MERGED") {
        out.push({ id: e.id, claim: "MERGE_QUEUED", observation: `PR #${e.pr} is MERGED (${seen.mergeCommit ?? "sha unknown"}) — advance the ledger` });
      } else if (seen?.state === "CLOSED") {
        out.push({ id: e.id, claim: "MERGE_QUEUED", observation: `PR #${e.pr} is CLOSED without merge — the work is not queued, it is abandoned` });
      } else if (seen?.headSha && e.headSha && seen.headSha !== e.headSha) {
        out.push({ id: e.id, claim: `headSha ${e.headSha}`, observation: `PR #${e.pr} head is now ${seen.headSha} — recorded checks no longer describe this head` });
      }
    }

    if (["MERGED", "DEPLOY_QUEUED", "COMPLETE"].includes(e.status) && e.mergeSha) {
      if (mainShas.size && !mainShas.has(e.mergeSha)) {
        out.push({ id: e.id, claim: `${e.status} at ${e.mergeSha}`, observation: "mergeSha not found on origin/main — claim unproven" });
      }
      if (seen && seen.state && seen.state !== "MERGED") {
        out.push({ id: e.id, claim: e.status, observation: `PR #${e.pr} reports ${seen.state}, not MERGED` });
      }
    }
  }
  return out;
}

/** Counts for the Phase 10 conformance readout. Surfaces only — the site coverage question. */
export function conformance(ledger) {
  const surfaces = (ledger?.entries ?? []).filter((e) => e.kind === "SURFACE");
  const tally = Object.fromEntries(STATUS.map((s) => [s, 0]));
  for (const s of surfaces) tally[s.status] = (tally[s.status] ?? 0) + 1;
  const accountedFor = surfaces.filter((s) =>
    ["COMPLETE", "EXEMPT", "BLOCKED_PROTECTED", "BLOCKED_DEPENDENCY"].includes(s.status)
  ).length;
  return Object.freeze({
    totalSurfaces: surfaces.length,
    accountedFor,
    unaccountedFor: surfaces.length - accountedFor,
    byStatus: Object.freeze(tally),
  });
}

/** Render the read-only markdown projection. Never hand-edit the output. */
export function renderMarkdown(ledger) {
  const entries = ledger?.entries ?? [];
  const c = conformance(ledger);
  const next = selectExecutable(ledger);

  const lines = [];
  lines.push("# EOS Metadata-to-Platform Program — Execution Ledger");
  lines.push("");
  lines.push("> **Generated file — do not hand-edit.** Rendered from `metadata-program/ledger.json` by");
  lines.push("> `lib/metadataProgramLedger.mjs`. Edit the JSON, re-render, commit both.");
  lines.push("");
  lines.push("**This is a cache. GitHub and `origin/main` are truth.** A resuming session reads governance,");
  lines.push("reads this, reconciles every claim against observed state, corrects what disagrees, and then");
  lines.push("continues from the next executable item — without asking what happened.");
  lines.push("");
  lines.push(`**Baseline:** ${ledger?.baseline ?? UNKNOWN}`);
  lines.push("");
  lines.push("## Surface conformance");
  lines.push("");
  lines.push(`| Total routed surfaces | Accounted for | Unaccounted for |`);
  lines.push(`|---|---|---|`);
  lines.push(`| ${c.totalSurfaces} | ${c.accountedFor} | ${c.unaccountedFor} |`);
  lines.push("");
  lines.push("## Next executable");
  lines.push("");
  if (next.length === 0) {
    lines.push("_Nothing executable. Every remaining item is blocked, queued or complete — check the blocked");
    lines.push("table below before concluding the program is finished._");
  } else {
    for (const e of next.slice(0, 10)) lines.push(`- **${e.id}** (phase ${e.phase}) — ${e.title} → ${e.nextAction}`);
  }
  lines.push("");

  for (const status of STATUS) {
    const rows = entries.filter((e) => e.status === status);
    if (!rows.length) continue;
    lines.push(`## ${status}`);
    lines.push("");
    lines.push("| id | phase | title | route | issue | PR | head | merge | deploy | next action |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const e of rows) {
      lines.push(
        `| ${e.id} | ${e.phase} | ${e.title} | ${e.route ?? "—"} | ${e.issue ? `#${e.issue}` : "—"} | ` +
        `${e.pr ? `#${e.pr}` : "—"} | ${e.headSha ? e.headSha.slice(0, 8) : "—"} | ` +
        `${e.mergeSha ? e.mergeSha.slice(0, 8) : "—"} | ${e.deploy} | ${e.nextAction} |`
      );
    }
    lines.push("");
    const blocked = rows.filter((e) => e.blockers?.length);
    for (const e of blocked) {
      for (const b of e.blockers) {
        lines.push(`> **${e.id}** blocked — ${b.reason}${b.requiredDecision ? ` · requires: ${b.requiredDecision}` : ""}`);
      }
    }
    if (blocked.length) lines.push("");
  }
  return lines.join("\n") + "\n";
}
