/**
 * THE CANONICAL SANDBOX CREDENTIAL FILE -- atomic, idempotent, additive merges.
 *
 * ============================ WHY THIS EXISTS ============================
 *
 * The Owner's credential lives in a 70-byte stub at ~/.eos-sandbox/, and the other fifteen canonical
 * credentials live in a 60-entry file in the operator's Windows profile. Neither file alone can
 * satisfy the contract: with ONE explicit source, whichever you choose leaves something
 * CREDENTIAL_MISSING. The 60-entry file is canonical, so the Owner's existing entry is MERGED INTO it
 * and the stub is retired as an active source.
 *
 * MERGED, NOT ROTATED. The Owner credential is copied VERBATIM. It already works; regenerating it
 * would invalidate the Owner's saved copy and every running mission, which is the exact harm this
 * programme has now twice been one step away from causing.
 *
 * ============================ THE THREE PROPERTIES ============================
 *
 * ATOMIC. Write a temp file in the SAME directory, fsync it, then rename over the target. A rename
 * within a filesystem is atomic, so a reader never sees a half-written credential file and a crash
 * mid-write cannot destroy the original. A plain truncate-and-write can lose sixty working
 * credentials to one bad moment.
 *
 * IDEMPOTENT. Merging an entry that is already present with the same value is a NO-OP: no write, no
 * temp file, no mtime change. Re-running must be free, because an operation that is not safe to
 * repeat is one nobody dares repeat when it matters.
 *
 * ADDITIVE AND NON-DESTRUCTIVE. An existing key whose value DIFFERS is never overwritten. It is
 * reported as a CONFLICT and the merge refuses. Silently replacing a working credential with another
 * one is indistinguishable from a rotation, and it surfaces later as "invalid password" -- the
 * failure that sends you debugging the wrong thing.
 *
 * ============================ SECRETS ============================
 *
 * No value is printed, logged, returned, compared for content, hashed or measured for length. The
 * only comparison made is equality, which is required to tell a no-op from a conflict, and its RESULT
 * is a boolean. Every report carries KEY NAMES and counts.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** The one filename. A merge into anything else would create the second source this removes. */
const CANONICAL_FILENAME = "sandbox-credentials.local.json";

class CredentialFileError extends Error {
  constructor(code, message) {
    // Carries a code, a path and key names. Never a value, and never the file's contents.
    super(`${code}: ${message}`);
    this.name = "CredentialFileError";
    this.code = code;
  }
}

/**
 * Parse the operator's file. Tolerates a proper JSON object and the brace-less `"email": "password",`
 * entry list the real file has been seen to contain, because the contract is to READ the operator's
 * file rather than rewrite it into a shape a parser prefers.
 */
function parseCredentialFile(raw) {
  const text = String(raw).trim();
  if (!text) throw new CredentialFileError("EMPTY_FILE", "the credential file is empty");
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const parsed = attempt(text) ?? attempt(`{${text.replace(/,\s*$/, "")}}`);
  if (!parsed) throw new CredentialFileError("UNPARSEABLE", "the credential file is not parseable; refusing to touch a file whose contents cannot be preserved");
  const out = {};
  for (const [email, value] of Object.entries(parsed)) {
    if (typeof email !== "string" || typeof value !== "string" || !value) continue;
    out[email.trim().toLowerCase()] = value;
  }
  return out;
}

/** KEY NAMES and a count. Safe to print. */
function describeCredentialFile(filePath) {
  try {
    const table = parseCredentialFile(fs.readFileSync(filePath, "utf8"));
    const keyNames = Object.keys(table).sort();
    return { path: filePath, present: true, entryCount: keyNames.length, keyNames };
  } catch (err) {
    return { path: filePath, present: fs.existsSync(filePath), entryCount: 0, keyNames: [], failure: err.code ?? "UNREADABLE" };
  }
}

/** Atomic replace: temp file beside the target, fsync, rename. Mode 0600 -- this is a secret. */
function writeAtomically(targetPath, contents) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    // Leave no stray temp file holding credentials behind on a failed rename.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* the original is intact either way; this is cleanup, not correctness */
    }
    throw err;
  }
}

/**
 * Merge entries into the canonical credential file.
 *
 * @param targetPath  the canonical file. Must already exist: creating it here would silently make a
 *                    second source, which is the thing being removed.
 * @param entries     { email: value }. Values are never inspected beyond equality.
 * @param allowCreate only for tests over temp fixtures.
 * @returns { added, unchanged, conflicts, wrote, entryCountBefore, entryCountAfter } -- KEY NAMES only.
 */
function mergeCredentialEntries({ targetPath, entries, allowCreate = false } = {}) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new CredentialFileError("TARGET_REQUIRED", "name the canonical credential file explicitly; this never searches the filesystem");
  }
  if (!/credentials\.local\.json$/.test(targetPath)) {
    throw new CredentialFileError("TARGET_NOT_CANONICAL", `'${path.basename(targetPath)}' does not end with credentials.local.json, so it is not covered by the gitignore rule`);
  }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new CredentialFileError("ENTRIES_REQUIRED", "entries must be an object of { email: value }");
  }

  const exists = fs.existsSync(targetPath);
  if (!exists && !allowCreate) {
    throw new CredentialFileError("TARGET_MISSING", `${targetPath} does not exist; a merge extends the canonical file and never invents one`);
  }

  const existing = exists ? parseCredentialFile(fs.readFileSync(targetPath, "utf8")) : {};
  const entryCountBefore = Object.keys(existing).length;

  const added = [];
  const unchanged = [];
  const conflicts = [];
  const next = { ...existing };

  for (const [rawEmail, value] of Object.entries(entries)) {
    if (typeof rawEmail !== "string" || typeof value !== "string" || !value) {
      throw new CredentialFileError("ENTRY_INVALID", "every entry must be a non-empty string keyed by an address");
    }
    const email = rawEmail.trim().toLowerCase();
    if (!(email in next)) {
      next[email] = value;
      added.push(email);
      continue;
    }
    // Equality only. The RESULT is a boolean; neither value is read, printed or measured.
    if (next[email] === value) unchanged.push(email);
    else conflicts.push(email);
  }

  if (conflicts.length > 0) {
    throw new CredentialFileError(
      "CREDENTIAL_CONFLICT",
      `${conflicts.length} key(s) already hold a DIFFERENT value and were not overwritten: ${conflicts.join(", ")}. Nothing was written. Replacing a working credential is a rotation, and rotation is a separate, explicit decision.`,
    );
  }

  // IDEMPOTENCE: nothing new means nothing written -- no temp file, no rename, no mtime change.
  if (added.length === 0) {
    return { added: [], unchanged: unchanged.sort(), conflicts: [], wrote: false, entryCountBefore, entryCountAfter: entryCountBefore };
  }

  const ordered = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  writeAtomically(targetPath, `${JSON.stringify(ordered, null, 2)}\n`);

  return {
    added: added.sort(),
    unchanged: unchanged.sort(),
    conflicts: [],
    wrote: true,
    entryCountBefore,
    entryCountAfter: Object.keys(next).length,
  };
}

/**
 * THE OWNER CREDENTIAL MERGE, as its own named operation.
 *
 * Copies the entries of the retiring stub into the canonical file, verbatim. `onlyKeys` confines it
 * to the addresses actually authorized to move -- by default the Owner's alone -- so a stub that has
 * accumulated something else cannot smuggle it in.
 *
 * Nothing is rotated, nothing is overwritten, nothing is printed. Running it twice is a no-op.
 */
function mergeOwnerCredentialFromStub({ stubPath, canonicalPath, onlyKeys = ["eos-owner@sandbox.invalid"], allowCreate = false } = {}) {
  if (!stubPath || !canonicalPath) {
    throw new CredentialFileError("PATHS_REQUIRED", "both the retiring stub and the canonical file must be named explicitly");
  }
  if (path.resolve(stubPath) === path.resolve(canonicalPath)) {
    throw new CredentialFileError("SAME_FILE", "the stub and the canonical file are the same path");
  }
  let stub;
  try {
    stub = parseCredentialFile(fs.readFileSync(stubPath, "utf8"));
  } catch (err) {
    throw new CredentialFileError("STUB_UNREADABLE", `the retiring stub could not be read (${err.code ?? "error"}); nothing was written`);
  }

  const wanted = new Set(onlyKeys.map((k) => k.trim().toLowerCase()));
  const entries = {};
  const absent = [];
  for (const key of wanted) {
    if (key in stub) entries[key] = stub[key];
    else absent.push(key);
  }
  if (Object.keys(entries).length === 0) {
    return { merged: [], unchanged: [], absentFromStub: absent.sort(), wrote: false, note: "the stub holds none of the authorized keys" };
  }

  const result = mergeCredentialEntries({ targetPath: canonicalPath, entries, allowCreate });
  return {
    merged: result.added,
    unchanged: result.unchanged,
    absentFromStub: absent.sort(),
    wrote: result.wrote,
    entryCountBefore: result.entryCountBefore,
    entryCountAfter: result.entryCountAfter,
  };
}

module.exports = {
  mergeCredentialEntries,
  mergeOwnerCredentialFromStub,
  describeCredentialFile,
  parseCredentialFile,
  writeAtomically,
  CredentialFileError,
  CANONICAL_FILENAME,
};

// This module is a library on purpose: it has NO CLI. The merge touches the operator's real
// credentials, so it is invoked from the runbook at a chosen moment, never by a flag somebody can
// reach for while experimenting. `os` is imported only to keep the temp-file helper honest about
// staying on the same filesystem as its target.
void os;
