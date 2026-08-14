/**
 * THE canonical sandbox persona credential loader. One file, one loader, read only.
 *
 * Every persona/browser/Playwright mission consumes credentials through this
 * module. Do not write your own file parsing -- three separate agent-authored
 * parsers in one day produced: two wasted runs against a stale file, a raw
 * credential dump, and a password printed as reversible character codes.
 *
 * THE CONTRACT (Owner direction, "Sandbox credentials -- single source of truth"):
 *   - READ ONLY. This module never writes, regenerates, normalizes, reorders,
 *     rotates, encodes or copies the credential file. There is no write path here
 *     and there must never be one.
 *   - ONE filename: sandbox-credentials.local.json. Never falls back to
 *     sandbox.txt or any other list -- a stale fallback is worse than a failure,
 *     because it fails as "invalid password" and sends you debugging the wrong thing.
 *   - NEVER echo. Callers pass the returned password straight into fill() and
 *     never read it back. Nothing here logs, and errors never carry the value.
 *   - On failure: CREDENTIAL_ACCESS_FAILED, with the personaId, the paths tried
 *     and the failure type -- never the file contents.
 *   - Auth personas are NOT business fixture data. Resetting a scenario must
 *     never touch a persona account. See functions/scripts/activateSandboxPersonas.js.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_FILENAME = "sandbox-credentials.local.json";

/** Stable persona keys. Tooling asks for a personaId, never an email/password. */
export const SANDBOX_PERSONAS = Object.freeze({
  owner: "owner@sandbox.invalid",
  admin: "admin@sandbox.invalid",
  dispatcher: "dispatcher@sandbox.invalid",
  technician: "tech@sandbox.invalid",
  warehouseManager: "whmgr@sandbox.invalid",
  partsManager: "partsmgr@sandbox.invalid",
  partsAssociate: "partsassoc@sandbox.invalid",
  restricted: "restricted@sandbox.invalid",
  // Added 2026-08-14 (Owner-directed, sandbox 8 -> 13). accessApprover is a
  // SECOND governed admin -- the distinct privileged approver that satisfies the
  // ADR-005 two-person rule (e.g. to later grant the governed `owner` role).
  // accounting maps to the existing governed accountingManager role. salesperson,
  // controller, shopServiceManager are Auth shells whose governed roles do NOT
  // exist yet (F-New-1 of the Sales-to-Cash-to-Commission lifecycle spec) -- their
  // role assignment is deferred until those roles ship.
  accessApprover: "accessApprover@sandbox.invalid",
  accounting: "accounting@sandbox.invalid",
  salesperson: "salesperson@sandbox.invalid",
  controller: "controller@sandbox.invalid",
  shopServiceManager: "shopmgr@sandbox.invalid",
});

export class CredentialAccessError extends Error {
  constructor(failureType, personaId, pathsTried, detail) {
    // Deliberately carries no credential value -- this message reaches logs.
    super(`CREDENTIAL_ACCESS_FAILED personaId=${personaId ?? "(none)"} type=${failureType}${detail ? ` detail=${detail}` : ""}`);
    this.name = "CredentialAccessError";
    this.code = "CREDENTIAL_ACCESS_FAILED";
    this.failureType = failureType;
    this.personaId = personaId ?? null;
    this.pathsTried = pathsTried;
  }
}

/**
 * Candidate locations for the ONE canonical filename. This is not a list of
 * alternate credential files -- it is the same file, wherever the operator keeps
 * it. SANDBOX_CREDENTIALS_FILE wins if set.
 */
export function candidatePaths() {
  const explicit = process.env.SANDBOX_CREDENTIALS_FILE;
  // An explicit path is AUTHORITATIVE, never merely first. Falling through to
  // some other copy when the named file is missing is precisely the failure that
  // sent two persona runs at a stale file and cost an hour: it does not surface
  // as "file not found", it surfaces as "invalid password".
  if (explicit) return [explicit];

  const home = os.homedir();
  return [
    path.resolve(HERE, "..", CANONICAL_FILENAME),
    path.resolve(HERE, "..", `.${CANONICAL_FILENAME}`),
    path.join(home, "Favorites", "Downloads", CANONICAL_FILENAME),
    path.join(home, "Downloads", CANONICAL_FILENAME),
  ];
}

/**
 * Parses the credential file. Tolerates both a proper JSON object and the
 * brace-less "email": "password", entry list the file has actually been seen to
 * contain -- because the contract says READ the operator's file, not rewrite it
 * into a shape the parser prefers.
 */
export function parseCredentials(raw) {
  const text = String(raw).trim();
  if (!text) throw new CredentialAccessError("EMPTY_FILE", null, []);

  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // Proper JSON object, then the same content wrapped in braces (brace-less
  // entry list), with any trailing comma before the close removed.
  const parsed = attempt(text) ?? attempt(`{${text.replace(/,\s*$/, "")}}`);
  if (!parsed) throw new CredentialAccessError("UNPARSEABLE", null, []);

  const out = {};
  for (const [email, password] of Object.entries(parsed)) {
    if (typeof email !== "string" || typeof password !== "string") continue;
    if (!password) continue;
    out[email.trim().toLowerCase()] = password;
  }
  if (Object.keys(out).length === 0) throw new CredentialAccessError("NO_ENTRIES", null, []);
  return out;
}

/**
 * Load one persona's credentials.
 * @param {string} personaId a key of SANDBOX_PERSONAS
 * @returns {{personaId: string, email: string, password: string}}
 * @throws {CredentialAccessError} never carrying the credential value
 */
export function loadSandboxPersona(personaId) {
  const email = SANDBOX_PERSONAS[personaId];
  if (!email) {
    throw new CredentialAccessError("UNKNOWN_PERSONA", personaId, [], `known: ${Object.keys(SANDBOX_PERSONAS).join(", ")}`);
  }

  const tried = candidatePaths();
  const found = tried.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (!found) throw new CredentialAccessError("FILE_NOT_FOUND", personaId, tried);

  let raw;
  try {
    raw = fs.readFileSync(found, "utf8");
  } catch (err) {
    throw new CredentialAccessError("FILE_UNREADABLE", personaId, tried, err.code);
  }

  let table;
  try {
    table = parseCredentials(raw);
  } catch (err) {
    throw new CredentialAccessError(err.failureType ?? "UNPARSEABLE", personaId, tried);
  }

  const password = table[email.toLowerCase()];
  if (!password) throw new CredentialAccessError("PERSONA_NOT_IN_FILE", personaId, tried);

  return { personaId, email, password };
}

/** Safe to log: proves a load worked without revealing anything reversible. */
export function describeLoad(personaId) {
  const { email, password } = loadSandboxPersona(personaId);
  return { personaId, email, passwordLength: password.length, loaded: true };
}
