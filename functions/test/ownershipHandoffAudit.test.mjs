// EOS Ownership Model v1 — the OWNERSHIP_HANDOFF audit contract (Owner ruling D-5, 2026-08-30).
//
// The first test here is the important one. `AuditAction` is a TypeScript union, which is ERASED
// at build time, so a value arriving from a callable is checked against the runtime array in
// auditEventWriter.ts or it is checked nowhere. Adding a member to one and not the other compiles
// cleanly and fails in production -- a mistake this repository has already made once and
// documented in the writer's own comments. This suite reads the union out of the SOURCE file and
// the array out of the COMPILED module, so the two cannot silently drift apart.
//
// The validation tests then prove the writer refuses a handoff event that would not be an audit
// trail: one with no record id, no new owner, an identical pair of owners, or an ungoverned source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ACCESS_TYPES_SRC = join(here, "..", "src", "types", "access.ts");
const WRITER_SRC = join(here, "..", "src", "access", "auditEventWriter.ts");

// Strip `//` line comments BEFORE looking for the union's terminating semicolon -- the same order
// adminCredentialEligibility.test.mjs's extractor uses, and for the same reason: several comments
// inside the union legitimately contain a semicolon, and slicing at the raw first one would cut the
// union short and silently exclude every member declared after it (this test found exactly that
// while being written, against a naive slice).
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, "");

function auditActionUnion(src) {
  const stripped = stripComments(src);
  const start = stripped.indexOf("export type AuditAction =");
  assert.ok(start >= 0, "AuditAction union not found");
  const end = stripped.indexOf(";", start);
  assert.ok(end > start, "AuditAction union has no terminator");
  return stripped.slice(start, end);
}

function auditActionsArray(src) {
  const stripped = stripComments(src);
  const start = stripped.indexOf("const AUDIT_ACTIONS");
  assert.ok(start >= 0, "AUDIT_ACTIONS runtime array not found");
  const end = stripped.indexOf("\n];", start);
  assert.ok(end > start, "AUDIT_ACTIONS array has no terminator");
  return stripped.slice(start, end);
}

test("D-5: OWNERSHIP_HANDOFF is present in BOTH the TypeScript union and the runtime array", () => {
  const types = readFileSync(ACCESS_TYPES_SRC, "utf8");
  const writer = readFileSync(WRITER_SRC, "utf8");

  const union = auditActionUnion(types);
  assert.ok(union.includes('"OWNERSHIP_HANDOFF"'), "OWNERSHIP_HANDOFF missing from the AuditAction union");

  const array = auditActionsArray(writer);
  assert.ok(array.includes('"OWNERSHIP_HANDOFF"'), "OWNERSHIP_HANDOFF missing from the AUDIT_ACTIONS runtime array");
});

test("D-5: every member of the runtime array is also a member of the union, and vice versa", () => {
  const types = readFileSync(ACCESS_TYPES_SRC, "utf8");
  const writer = readFileSync(WRITER_SRC, "utf8");

  const union = auditActionUnion(types);
  const array = auditActionsArray(writer);

  // Both slices are already comment-free, so a token merely MENTIONED in a comment on one side
  // cannot be mistaken for a declared member there -- which would let a real asymmetry pass.
  const members = (s) => new Set([...s.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]));

  const inUnion = members(union);
  const inArray = members(array);
  const onlyUnion = [...inUnion].filter((a) => !inArray.has(a)).sort();
  const onlyArray = [...inArray].filter((a) => !inUnion.has(a)).sort();

  assert.deepEqual(onlyUnion, [], `in the union but not the runtime array (these fail at runtime): ${onlyUnion.join(", ")}`);
  assert.deepEqual(onlyArray, [], `in the runtime array but not the union: ${onlyArray.join(", ")}`);
});

// The writer imports firebase-admin, so these validation tests run against it directly and never
// reach Firestore -- assertValid throws long before any document is built.
const { stageAuditEvent, AuditEventValidationError, OWNERSHIP_HANDOFF_SOURCES } = await import(
  "../lib/access/auditEventWriter.js"
);

// A writer that records what was staged without touching Firestore. stageAuditEvent calls
// getFirestore() to mint a document ref, so these cases must all fail in VALIDATION, before that
// line -- which is exactly what they assert.
const rejectingWriter = { set: () => assert.fail("validation should have refused this event") };

const validHandoff = () => ({
  actorUid: "uid-admin",
  action: "OWNERSHIP_HANDOFF",
  targetType: "account",
  targetId: "acct-1",
  objectId: "acct-1",
  outcome: "applied",
  summary: "Ownership of account acct-1 handed off from USER:emp-1 to USER:emp-2",
  previousOwner: { type: "USER", id: "emp-1" },
  newOwner: { type: "USER", id: "emp-2" },
  handoffSource: "DIRECT_HANDOFF",
});

const refuses = (mutate, pattern) => {
  const input = validHandoff();
  mutate(input);
  assert.throws(() => stageAuditEvent(rejectingWriter, input), (e) => e instanceof AuditEventValidationError && pattern.test(e.message), `expected refusal matching ${pattern}`);
};

test("D-5: a handoff event must name the record it moved", () => {
  refuses((i) => delete i.objectId, /objectId is required for OWNERSHIP_HANDOFF/);
});

test("D-5: a handoff event must carry a typed newOwner and an explicit previousOwner", () => {
  refuses((i) => delete i.newOwner, /newOwner is required/);
  refuses((i) => (i.newOwner = { type: "USER", id: "emp-2", name: "Rudy" }), /newOwner is required/);
  refuses((i) => delete i.previousOwner, /previousOwner is required/);
  refuses((i) => (i.previousOwner = "emp-1"), /previousOwner must be a typed owner or null/);
});

test("D-5: a handoff that moves nothing is refused", () => {
  refuses((i) => (i.previousOwner = { type: "USER", id: "emp-2" }), /identical/);
});

test("D-5: handoffSource is a closed set", () => {
  assert.deepEqual([...OWNERSHIP_HANDOFF_SOURCES], ["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]);
  refuses((i) => (i.handoffSource = "BECAUSE_I_SAID_SO"), /handoffSource must be one of/);
  refuses((i) => delete i.handoffSource, /handoffSource must be one of/);
});

test("D-5: ownership fields cannot be attached to an unrelated action, and vice versa", () => {
  // The guard is unconditional in both directions -- the same posture the report-only fields have.
  refuses((i) => {
    i.action = "grantRole";
    i.objectId = undefined;
  }, /previousOwner is only valid for OWNERSHIP_HANDOFF/);

  refuses((i) => {
    i.reason = undefined;
    i.handoffReason = "x".repeat(501);
  }, /handoffReason exceeds/);

  refuses((i) => (i.handoffReason = "password: hunter2"), /secret\/token\/credential/);
});
