// Safe handling of externally-supplied review inputs (workflow request_id / diff_path). Pure — path
// existence is via an INJECTED `exists` fn so it is unit-testable without a filesystem.
//
// Threat model: these inputs come from a workflow_dispatch form (attacker-influenceable). They must
// NEVER be interpolated into shell source. In this design they flow ONLY through environment variables
// read here as plain strings and used with fs — there is no shell, no eval, no command substitution, so
// metacharacters (; & | $ ( ) ` < > quotes spaces newlines) are inert filename characters, never syntax.
// This module additionally constrains diff_path to a repository-relative, in-checkout, existing file.

import { isAbsolute, resolve, relative } from "node:path";
import { statSync } from "node:fs";

const defaultExists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Bound + de-newline a request id. It is used only as a string (never shell), so this is hygiene. */
export function safeRequestId(raw) {
  const s = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return (s || "REVIEW").slice(0, 120);
}

/**
 * Validate a diff path before any file access. Empty → valid "no diff". Otherwise it MUST be
 * repository-relative, must not traverse (`..`), must resolve inside the checkout, and must exist.
 * Returns a resolved absolute path only when all hold.
 * @returns {{ ok:true, path:string|null } | { ok:false, reason:string }}
 */
export function safeDiffPath({ repoRoot, rawPath, exists = defaultExists } = {}) {
  const p = String(rawPath ?? "").trim();
  if (!p) return { ok: true, path: null };                                   // empty → omit --diff, valid
  if (isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p)) return { ok: false, reason: "diff_path must be repository-relative (absolute path rejected)" };
  if (p.split(/[\\/]/).includes("..")) return { ok: false, reason: "diff_path must not traverse ('..' rejected)" };
  const resolved = resolve(repoRoot, p);
  const rel = relative(repoRoot, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return { ok: false, reason: "diff_path resolves outside the checkout" };
  if (!exists(resolved)) return { ok: false, reason: "diff_path does not exist in the checkout" };
  return { ok: true, path: resolved };
}

/** Read the two review inputs from an env-like object, applying the safety rules above. Pure. */
export function readReviewInputs({ env = {}, repoRoot, exists } = {}) {
  const requestId = safeRequestId(env.REVIEW_REQUEST_ID);
  const diff = safeDiffPath({ repoRoot, rawPath: env.REVIEW_DIFF_PATH, exists });
  return { requestId, diff };
}

/**
 * Resolve the Claude CLI executable for the wake spawn. Pure (existence + env + platform injected). On
 * Windows `spawnSync("claude")` does NOT resolve via PATH/PATHEXT, and `claude` is often not on PATH, so
 * a bare bin ENOENTs (the observed pilot failure). Order: an explicit `CLAUDE_BIN` (operator override) →
 * the first existing known install path for the platform → the bare `claude` (works when it is genuinely
 * on PATH, e.g. POSIX). Does NOT weaken any guardrail — argv/timeout/allowlist are unchanged.
 * @returns {{ bin:string, source:"CLAUDE_BIN"|"KNOWN_PATH"|"PATH_FALLBACK", resolved:boolean }}
 */
export function resolveClaudeBin({ env = {}, platform = process.platform, exists = (p) => { try { return statSync(p).isFile(); } catch { return false; } } } = {}) {
  const override = (env.CLAUDE_BIN || "").trim();
  if (override) return { bin: override, source: "CLAUDE_BIN", resolved: exists(override) || /[\\/]/.test(override) };
  const home = env.USERPROFILE || env.HOME || "";
  const candidates = platform === "win32"
    ? [`${home}\\.local\\bin\\claude.exe`, `${env.APPDATA || ""}\\npm\\claude.cmd`, `${env.LOCALAPPDATA || ""}\\Programs\\claude\\claude.exe`]
    : [`${home}/.local/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  for (const c of candidates) { if (c && exists(c)) return { bin: c, source: "KNOWN_PATH", resolved: true }; }
  return { bin: "claude", source: "PATH_FALLBACK", resolved: false }; // may still work if genuinely on PATH
}
