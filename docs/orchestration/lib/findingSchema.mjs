// Structured finding contract — what an audit worker (or a disposition step) must emit so a finding can flow
// through consolidation → the findings register without falling back to "surface everything". A finding is only
// dedup-able and verifiable when it carries a stable location, a stable issue discriminator, a severity, a
// category, and concrete evidence. This module is the fail-closed gate on that contract: anything missing the
// load-bearing fields is INVALID (never silently accepted as a vague finding).
//
// Pure, deterministic. `validateFinding` returns {ok, errors}; `normalizeFinding` returns the canonical shape
// consumed downstream (file+symbol+discriminator identity for fingerprinting, plus severity/category/evidence).

export const SEVERITIES = Object.freeze(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

// A repo-relative path — not absolute, no traversal, forward slashes.
const REPO_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/;
// The stable issue discriminator: a lowercase kebab slug (e.g. "no-technician-availability-check"). Stable across
// audits precisely because it is a deliberate identity, not the drifting prose/line — 3..80 chars.
const DISCRIMINATOR = /^[a-z0-9]([a-z0-9-]{1,78})[a-z0-9]$/;

const norm = (s) => String(s ?? "").trim();
const normPath = (p) => norm(p).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");

/**
 * Validate one structured finding against the contract. Required: `file` (repo-relative), `discriminator`
 * (stable slug), `severity` (one of SEVERITIES), `category` (non-empty), `evidence` (non-empty — a finding
 * without evidence can't be verified or dispositioned). `symbol` is optional but recommended (sharper identity).
 * @returns {{ ok:boolean, errors:string[] }}
 */
export function validateFinding(f = {}) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(f && typeof f === "object" && !Array.isArray(f), "finding must be an object");
  if (!f || typeof f !== "object") return { ok: false, errors };
  need(typeof f.file === "string" && REPO_PATH.test(normPath(f.file)), "file must be a repo-relative path (no absolute, no '..')");
  need(typeof f.discriminator === "string" && DISCRIMINATOR.test(norm(f.discriminator)), "discriminator must be a stable lowercase-kebab slug (3-80 chars) — the issue identity");
  need(SEVERITIES.includes(f.severity), `severity must be one of ${SEVERITIES.join("/")}`);
  need(typeof f.category === "string" && norm(f.category).length > 0, "category is required");
  need(typeof f.evidence === "string" && norm(f.evidence).length > 0, "evidence is required (a finding must be verifiable)");
  if (f.symbol != null) need(typeof f.symbol === "string" && norm(f.symbol).length > 0, "symbol, when present, must be a non-empty string");
  if (f.line != null) need(Number.isInteger(f.line) && f.line > 0, "line, when present, must be a positive integer");
  return { ok: errors.length === 0, errors };
}

/** Canonical shape consumed by consolidation/reconcile. Assumes the finding already passed validateFinding. */
export function normalizeFinding(f) {
  return Object.freeze({
    file: normPath(f.file),
    symbol: f.symbol != null ? norm(f.symbol) : null,
    discriminator: norm(f.discriminator),
    severity: f.severity,
    category: norm(f.category),
    evidence: norm(f.evidence),
    line: f.line ?? null,
  });
}

/**
 * Validate a batch of worker findings. Fail-closed: invalid findings are separated out (with their errors), never
 * silently passed through. Only `valid` (normalized) findings are safe to consolidate/reconcile.
 * @returns {{ valid:Array, invalid:Array<{finding, errors}> }}
 */
export function validateFindings(findings = []) {
  const valid = [], invalid = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    const r = validateFinding(f);
    if (r.ok) valid.push(normalizeFinding(f));
    else invalid.push({ finding: f, errors: r.errors });
  }
  return { valid: Object.freeze(valid), invalid: Object.freeze(invalid) };
}
