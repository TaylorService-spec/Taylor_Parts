"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURSOR_SCHEMA_VERSION = void 0;
exports.encodeCursor = encodeCursor;
exports.decodeCursor = decodeCursor;
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
const compatibility_1 = require("./domain/compatibility");
const errors_1 = require("./errors");
exports.CURSOR_SCHEMA_VERSION = 1;
const CURSOR_FIELDS = ["v", "dir", "key", "afterId"];
// Opaque to callers, but not secret and not signed: a base64url of the strict record.
function encodeCursor(payload) {
    const record = { v: exports.CURSOR_SCHEMA_VERSION, dir: payload.dir, key: payload.key, afterId: payload.afterId };
    return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}
// Decode + validate against the CURRENT request's (dir, key). Any decode failure, unknown/extra field,
// bad version, non-canonical afterId, or (dir, key) mismatch is a MALFORMED REQUEST and fails closed
// with InvalidInputError — NEVER silently treated as "start from the beginning".
function decodeCursor(raw, expected) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) {
        throw new errors_1.InvalidInputError("cursor must be a bounded non-empty string");
    }
    let text;
    try {
        text = Buffer.from(raw, "base64url").toString("utf8");
    }
    catch {
        throw new errors_1.InvalidInputError("cursor is not valid base64url");
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new errors_1.InvalidInputError("cursor is not a valid encoded record");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new errors_1.InvalidInputError("cursor payload must be an object");
    }
    const record = parsed;
    // Exact field set — no unknown/extra keys, no missing keys.
    const keys = Object.keys(record);
    if (keys.length !== CURSOR_FIELDS.length || !CURSOR_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
        throw new errors_1.InvalidInputError("cursor payload has an unexpected shape");
    }
    if (record.v !== exports.CURSOR_SCHEMA_VERSION) {
        throw new errors_1.InvalidInputError("cursor schema version is not recognized");
    }
    if (record.dir !== expected.dir) {
        // A forward-Part cursor submitted on a reverse-Model request (or vice versa) is a malformed request.
        throw new errors_1.InvalidInputError("cursor direction does not match the request");
    }
    if (record.key !== expected.key) {
        // A cursor minted for one Part/Model cannot be submitted against another — request-key binding.
        throw new errors_1.InvalidInputError("cursor query key does not match the request");
    }
    if (!(0, compatibility_1.isCanonicalCompatibilityId)(record.afterId)) {
        throw new errors_1.InvalidInputError("cursor afterId is not a canonical compatibility id");
    }
    return { afterId: record.afterId };
}
//# sourceMappingURL=readCursor.js.map