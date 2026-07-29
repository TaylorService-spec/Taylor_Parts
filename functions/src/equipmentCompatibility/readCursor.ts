// D5 (Read service) — the UNTRUSTED NAVIGATION CURSOR (posture B, design package §5.3).
//
// This cursor is a TRANSPARENT position hint, NOT an authorization boundary and NOT tamper-evident. It
// is deliberately unsigned. Every read that consumes it re-executes `where(<key>,==,X)` and every
// returned record is independently authorization-checked and provably belongs to that bound query
// (readService.ts), so a caller who edits `afterId` can only reposition WITHIN their own already-
// authorized result set for the same (dir, key): they cannot broaden the query, cross-bind to another
// Part/Model/direction, or surface a record they are not already authorized to read. Skipping forward
// is a completeness/UX effect, never an authorization escape.
//
// Validation below is SHAPE + REQUEST CONSISTENCY (fail-closed on malformed input), NOT an integrity
// check: a structurally valid `afterId` for the correct (dir, key) is accepted as a reposition. If
// gap-free GOVERNED traversal ever becomes a security requirement, the documented upgrade is a
// server-held-HMAC-signed cursor (posture A) — deferred; D5 needs only authorized-set navigation.
import { isCanonicalCompatibilityId } from "./domain/compatibility";
import { InvalidInputError } from "./errors";

export const CURSOR_SCHEMA_VERSION = 1;
export type ReadDirection = "forward" | "reverse";

export interface CursorPayload {
  readonly dir: ReadDirection;
  readonly key: string; // partId (forward) | equipmentModelId (reverse)
  readonly afterId: string; // the compatibilityId of the last item on the previous page
}

const CURSOR_FIELDS = ["v", "dir", "key", "afterId"] as const;

// Opaque to callers, but not secret and not signed: a base64url of the strict record.
export function encodeCursor(payload: CursorPayload): string {
  const record = { v: CURSOR_SCHEMA_VERSION, dir: payload.dir, key: payload.key, afterId: payload.afterId };
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}

// Decode + validate against the CURRENT request's (dir, key). Any decode failure, unknown/extra field,
// bad version, non-canonical afterId, or (dir, key) mismatch is a MALFORMED REQUEST and fails closed
// with InvalidInputError — NEVER silently treated as "start from the beginning".
export function decodeCursor(raw: string, expected: { dir: ReadDirection; key: string }): { afterId: string } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) {
    throw new InvalidInputError("cursor must be a bounded non-empty string");
  }
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new InvalidInputError("cursor is not valid base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidInputError("cursor is not a valid encoded record");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidInputError("cursor payload must be an object");
  }
  const record = parsed as Record<string, unknown>;
  // Exact field set — no unknown/extra keys, no missing keys.
  const keys = Object.keys(record);
  if (keys.length !== CURSOR_FIELDS.length || !CURSOR_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    throw new InvalidInputError("cursor payload has an unexpected shape");
  }
  if (record.v !== CURSOR_SCHEMA_VERSION) {
    throw new InvalidInputError("cursor schema version is not recognized");
  }
  if (record.dir !== expected.dir) {
    // A forward-Part cursor submitted on a reverse-Model request (or vice versa) is a malformed request.
    throw new InvalidInputError("cursor direction does not match the request");
  }
  if (record.key !== expected.key) {
    // A cursor minted for one Part/Model cannot be submitted against another — request-key binding.
    throw new InvalidInputError("cursor query key does not match the request");
  }
  if (!isCanonicalCompatibilityId(record.afterId)) {
    throw new InvalidInputError("cursor afterId is not a canonical compatibility id");
  }
  return { afterId: record.afterId as string };
}
