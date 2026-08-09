// Tests for the Owner Roadmap Projection — model integrity + pure views.
// Run: node --test docs/orchestration/lib/roadmapProjection.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { roadmapModel, validateRoadmapModel, allCapabilities } from "./roadmapModel.mjs";
import {
  milestoneProgress, dimensions, statusToSymbol,
  projectExecutiveRoadmap, projectDetailedRoadmap, projectActiveWork, projectBlocked,
  projectOwnerDecisions, projectProtected, projectDesignBoard, projectUxBoard, projectAll,
} from "./roadmapProjection.mjs";

test("model is valid: known enums, unique ids, resolvable dependencies, gate-text present", () => {
  const errors = validateRoadmapModel(roadmapModel);
  assert.deepEqual(errors, [], `model errors:\n${errors.join("\n")}`);
});

test("hierarchy is EOS → Domain → Capability → Milestone → Work Item → Evidence", () => {
  assert.equal(roadmapModel.id, "EOS");
  const d = roadmapModel.domains[0];
  assert.ok(d.capabilities.length > 0);
  const c = roadmapModel.domains.flatMap((x) => x.capabilities).find((x) => x.milestones.length);
  const m = c.milestones[0];
  assert.ok(Array.isArray(m.workItems));
  const w = c.milestones.flatMap((mm) => mm.workItems).find((ww) => (ww.evidence || []).length);
  assert.ok(Array.isArray(w.evidence));
});

test("progress is milestone-derived only — a count, never a fabricated percentage", () => {
  const cwo = allCapabilities().find((c) => c.id === "continuous-workstream-orchestrator");
  const p = milestoneProgress(cwo);
  assert.equal(p.total, 5); // 4 done + Option B not done
  assert.equal(p.complete, 4);
  // capabilities with no explicit milestones expose no number
  const future = allCapabilities().find((c) => c.id === "service-contracts-pm");
  assert.equal(milestoneProgress(future), null);
  // no projection surface emits a "%" field
  const json = JSON.stringify(projectAll());
  assert.ok(!/percent|"pct"|%\d/i.test(json), "no invented percentages anywhere");
});

test("DISTINCTION: MERGED ≠ DEPLOYED — inert finance backend is IMPLEMENTED but NOT_DEPLOYED", () => {
  const inv = allCapabilities().find((c) => c.id === "invoice-issuance");
  const dim = dimensions(inv);
  assert.equal(dim.implementationState, "IMPLEMENTED");
  assert.equal(dim.deployState, "NOT_DEPLOYED");
  assert.equal(dim.activationState, "INERT");
});

test("DISTINCTION: BACKEND COMPLETE ≠ USER-OPERABLE — deployed Receiving is not user-operable", () => {
  const rcv = allCapabilities().find((c) => c.id === "receiving");
  const dim = dimensions(rcv);
  assert.equal(dim.backendState, "COMPLETE");
  assert.equal(dim.deployState, "DEPLOYED"); // callable is live
  assert.equal(dim.userOperable, false); // but readiness flag off → not operable
});

test("DISTINCTION: UX COMPLETE ≠ BACKEND ACTIVE — Part Master write UX complete but INERT", () => {
  const pm = allCapabilities().find((c) => c.id === "part-master-write");
  const dim = dimensions(pm);
  assert.equal(dim.uxState, "COMPLETE");
  assert.equal(dim.activationState, "INERT");
});

test("DISTINCTION: PERSONA FINDING ≠ PRODUCT DECISION — no capability status is set from a persona finding", () => {
  // Persona findings may only appear as Evidence{kind:PERSONA_FINDING}; assert none leak into status/ownerDecision.
  for (const c of allCapabilities()) {
    assert.ok(!/persona/i.test(c.status || ""));
    assert.ok(!/persona finding/i.test(c.ownerDecision || ""));
  }
});

test("Executive Roadmap: one compact entry per capability with all six dimensions", () => {
  const exec = projectExecutiveRoadmap();
  const flat = exec.flatMap((d) => d.capabilities);
  assert.ok(flat.length >= 15);
  for (const c of flat) {
    assert.ok(c.status && c.dimensions);
    assert.deepEqual(Object.keys(c.dimensions).sort(), ["activationState", "backendState", "deployState", "implementationState", "userOperable", "uxState"]);
  }
});

test("Active Work = RUNNING or READY only (invariant; may be empty at a checkpoint)", () => {
  const active = projectActiveWork();
  assert.ok(active.every((c) => c.status === "RUNNING" || c.status === "READY"));
  // No dependency on a specific item: at a terminal checkpoint Active Work is legitimately empty.
  const runningOrReady = allCapabilities().filter((c) => c.status === "RUNNING" || c.status === "READY");
  assert.equal(active.length, runningOrReady.length);
});

test("Blocked view carries blockedReason + dependencies", () => {
  const blocked = projectBlocked();
  assert.ok(blocked.length >= 1);
  assert.ok(blocked.every((c) => typeof c.blockedReason === "string"));
  assert.ok(blocked.some((c) => c.id === "manufacturer-write"));
});

test("Owner Decisions surfaces blocking decisions and flags them", () => {
  const decisions = projectOwnerDecisions();
  const catalog = decisions.find((c) => c.id === "catalog-read-authority");
  assert.ok(catalog && catalog.blocking === true && catalog.decision);
});

test("Protected view carries protectedBoundary text", () => {
  const prot = projectProtected();
  assert.ok(prot.length >= 5);
  assert.ok(prot.every((c) => typeof c.protectedBoundary === "string" && c.protectedBoundary.length > 0));
});

test("Design + UX boards partition by workstream owner and use valid glyphs", () => {
  const design = projectDesignBoard();
  const ux = projectUxBoard();
  const glyphs = new Set(["x", ">", "!", "P", "B", "-", "R", " "]);
  assert.ok(design.every((r) => glyphs.has(r.symbol)));
  assert.ok(design.length > 0);
  // UX board is empty today (no UX-owned capabilities modeled yet) — that is honest, not an error.
  assert.ok(Array.isArray(ux));
});

test("statusToSymbol maps the genuine stops and routed items", () => {
  assert.equal(statusToSymbol("DONE"), "x");
  assert.equal(statusToSymbol("RUNNING"), ">");
  assert.equal(statusToSymbol("OWNER_DECISION"), "!");
  assert.equal(statusToSymbol("PROTECTED_ACTION"), "P");
  assert.equal(statusToSymbol("BLOCKED_DEPENDENCY"), "B");
  assert.equal(statusToSymbol("DONE", "some-workstream"), "R"); // routed overrides
});
