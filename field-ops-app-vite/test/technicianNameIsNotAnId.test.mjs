// A TECHNICIAN IS SHOWN BY NAME, NEVER BY ID. Run: node --test test/technicianNameIsNotAnId.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// The full-site certification sweep reported that Job Assignments printed a bare `assignedTechId`
// in its "Assigned" column -- an opaque `fieldops_technicians` document key sitting where a
// person's name belongs. It tells the reader nothing, and it cannot be recognised or acted on.
//
// It was not one screen. TEN surfaces had each hand-written the same lookup inline, and they had
// drifted into three different answers to the same question:
//
//   ControlTower / DispatchQueuePanel / WorkOrderPreview / WorkOrderQueue / Operations
//                                            `?.name || id`     -> renders the RAW ID
//   Dispatch / DispatcherBoard / useSessionActivityFeed
//                                            `?.name` + `?? id` -> renders the RAW ID
//   WorkOrderAttentionPanel                   `?.name || "..."`  -> never renders an id
//   Jobs                                      (no resolver)      -> renders the RAW ID
//
// One of ten was right. Copy-paste is how the wrong answer reached the other nine, so the fix is
// one shared resolver plus this test -- without it, the next copy re-introduces the defect.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTechnicianIdentity,
  UNKNOWN_TECHNICIAN_DISPLAY_NAME,
} from "../src/domain/actorDisplayName.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("an unresolvable technician id is never returned as if it were a name", () => {
  // The whole defect in one assertion.
  const out = resolveTechnicianIdentity("fieldops_tech_abc123", { technicians: [] });
  assert.equal(out.state, "unknown");
  assert.equal(out.name, UNKNOWN_TECHNICIAN_DISPLAY_NAME);
  assert.doesNotMatch(out.name, /abc123/, "the raw id must not appear in user-facing text");
});

test("unassigned and unnameable stay distinct — they are different facts", () => {
  // Collapsing these would hide "this work order IS assigned, we just cannot name the person",
  // which is the more interesting of the two and the one a dispatcher needs to notice.
  assert.equal(resolveTechnicianIdentity(null, { technicians: [] }).state, "unset");
  assert.equal(resolveTechnicianIdentity("t1", { technicians: [] }).state, "unknown");
});

test("loading and failed are not silently reported as unknown", () => {
  // A directory still loading is not evidence that a technician does not exist, and a failed read
  // is not evidence either. Guessing "Unknown technician" during either states as fact something
  // that is not yet known.
  assert.equal(resolveTechnicianIdentity("t1", { loading: true }).state, "loading");
  assert.equal(resolveTechnicianIdentity("t1", { error: new Error("denied") }).state, "error");
});

test("a resolved technician is shown by name", () => {
  const out = resolveTechnicianIdentity("t1", { technicians: [{ id: "t1", name: "Sam Rivera" }] });
  assert.deepEqual(out, { state: "resolved", name: "Sam Rivera" });
});

function jsxFiles(dir, found = []) {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) jsxFiles(full, found);
    else if (/\.jsx?$/.test(e)) found.push(full);
  }
  return found;
}

// NOTE ON THIS PATTERN, because it has already been wrong once.
//
// The first version used \([^)]*\) for the find() argument. That stops at the `)` closing the arrow
// parameter `(t)` and so never reaches `?.name` -- it matched NOTHING, and this test passed
// vacuously while ten violations sat in the tree. It was caught only by deliberately injecting a
// tenth inline copy and watching the suite stay green.
//
// A guard that cannot fail is worse than no guard, because it also reports success. Any change to
// this pattern must be re-verified the same way: break it on purpose and confirm the test goes red.
const INLINE_LOOKUP = /technicians\s*\.\s*find\b[^\n]*?\?\.\s*name/g;

test("no surface hand-rolls its own technician-name lookup", () => {
  // The structural half. Ten inline copies drifted into three behaviours because nothing stopped a
  // tenth from being written; this is what stops it. A lookup that needs the whole technician
  // RECORD (Dispatch reads other fields off it) is a different operation and is not matched here --
  // only `.name`, which is the rendering path that leaked ids.
  const offenders = [];
  for (const file of jsxFiles(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(INLINE_LOOKUP)) {
      offenders.push(`${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Use resolveTechnicianIdentity from domain/actorDisplayName.js instead of an inline lookup.\n" +
    "Every inline copy but one fell back to rendering the raw technician id:\n  " +
    offenders.join("\n  "),
  );
});
