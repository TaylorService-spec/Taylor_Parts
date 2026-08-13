import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveChildGrant, buildChildWorkItems } from "./authorityInheritance.mjs";
import { resolveWorkIntake } from "./workIntake.mjs";

// A parent intent the Owner approved once: PATCH authority over a bounded scope, small budget, one capability.
const PARENT = Object.freeze({
  workId: "EOS-INTENT-100",
  profile: "PATCH_PRODUCER",
  scope: ["functions/src/access", "docs/orchestration"],
  contextScope: ["orchestration"],
  budgetUsd: 1.0,
  capabilities: ["OPENAI_REVIEW"],
  protectedBoundary: null,
});

test("a child requesting a strict subset inherits a constrained grant", () => {
  const r = deriveChildGrant({ parent: PARENT, request: { requestId: "C1", profile: "PATCH_PRODUCER", scope: ["functions/src/access/access.ts"], budgetUsd: 0.4, capabilities: ["OPENAI_REVIEW"] } });
  assert.equal(r.ok, true);
  assert.equal(r.grant.profile, "PATCH_PRODUCER");
  assert.deepEqual([...r.grant.scope], ["functions/src/access/access.ts"]);
  assert.equal(r.grant.budgetUsd, 0.4);
  assert.equal(r.grant.inheritedFrom, "EOS-INTENT-100");
});

test("profile escalation above the parent is REJECTED (never silently clamped)", () => {
  const readParent = { ...PARENT, profile: "READ_ONLY_ANALYSIS" };
  const r = deriveChildGrant({ parent: readParent, request: { requestId: "C2", profile: "PATCH_PRODUCER", scope: [] } });
  assert.equal(r.ok, false);
  assert.match(r.violations.join(" "), /profile escalation denied/);
});

test("scope containment: a child under a parent DIRECTORY is allowed; escaping it is rejected", () => {
  const inside = deriveChildGrant({ parent: PARENT, request: { requestId: "C3", profile: "PATCH_PRODUCER", scope: ["functions/src/access/auditEventWriter.ts"] } });
  assert.equal(inside.ok, true, "src/access/... is within parent dir src/access");
  const outside = deriveChildGrant({ parent: PARENT, request: { requestId: "C4", profile: "PATCH_PRODUCER", scope: ["functions/src/billing/charge.ts"] } });
  assert.equal(outside.ok, false);
  assert.match(outside.violations.join(" "), /scope escapes parent/);
  // segment-boundary: a sibling that merely shares a string prefix is NOT within scope
  const sibling = deriveChildGrant({ parent: { ...PARENT, scope: ["functions/src/access"] }, request: { requestId: "C4b", scope: ["functions/src/accessControl.ts"] } });
  assert.equal(sibling.ok, false, "access vs accessControl.ts are different sectors");
});

test("budget over the parent is rejected; within is allowed", () => {
  assert.equal(deriveChildGrant({ parent: PARENT, request: { requestId: "C5", budgetUsd: 1.5 } }).ok, false);
  assert.equal(deriveChildGrant({ parent: PARENT, request: { requestId: "C6", budgetUsd: 0.9 } }).ok, true);
});

test("a capability the parent does not hold is rejected", () => {
  const r = deriveChildGrant({ parent: PARENT, request: { requestId: "C7", capabilities: ["OPENAI_REVIEW", "PROD_DEPLOY"] } });
  assert.equal(r.ok, false);
  assert.match(r.violations.join(" "), /capabilities not held by parent/);
});

test("protected boundary is STRICTLY inherited: never added, cleared, or changed by the child", () => {
  const bounded = { ...PARENT, protectedBoundary: "FIRESTORE_RULES" };
  // child inherits the boundary even if it declares none
  const inherit = deriveChildGrant({ parent: bounded, request: { requestId: "C8", scope: ["functions/src/access/x.ts"] } });
  assert.equal(inherit.ok, true);
  assert.equal(inherit.grant.protectedBoundary, "FIRESTORE_RULES", "boundary flows down unchanged");
  // child restating the SAME boundary is fine
  const restate = deriveChildGrant({ parent: bounded, request: { requestId: "C8b", protectedBoundary: "FIRESTORE_RULES", scope: ["functions/src/access/x.ts"] } });
  assert.equal(restate.ok, true);
  // child trying to CHANGE/CLEAR it is rejected
  const change = deriveChildGrant({ parent: bounded, request: { requestId: "C9", protectedBoundary: "NONE" } });
  assert.equal(change.ok, false);
  assert.match(change.violations.join(" "), /may not add\/clear\/change a protected boundary/);
  // parent with NO boundary: a child may NOT manufacture one (this is new authority appearing at decomposition)
  const add = deriveChildGrant({ parent: PARENT, request: { requestId: "C10", protectedBoundary: "MIGRATION" } });
  assert.equal(add.ok, false, "child cannot add a boundary the parent (none) did not carry");
  assert.match(add.violations.join(" "), /may not add\/clear\/change a protected boundary/);
  // and the derived boundary for a no-boundary parent is exactly none — never the child's request
  const none = deriveChildGrant({ parent: PARENT, request: { requestId: "C10b", scope: ["docs/orchestration/x.md"] } });
  assert.equal(none.ok, true);
  assert.equal(none.grant.protectedBoundary, null);
});

test("buildChildWorkItems mints EXECUTION_AUTHORIZED child artifacts with inherited basis + parentRef", () => {
  const out = buildChildWorkItems({
    parent: PARENT,
    now: "2026-08-13T09:00:00.000Z",
    requests: [
      { requestId: "EOS-INTENT-100-A", title: "sector A", scope: ["functions/src/access/access.ts"], budgetUsd: 0.3, capabilities: ["OPENAI_REVIEW"] },
      { requestId: "EOS-INTENT-100-B", title: "sector B", scope: ["docs/orchestration/notes.md"], budgetUsd: 0.3 },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.accepted.length, 2);
  assert.equal(out.rejected.length, 0);
  for (const art of out.accepted) {
    assert.equal(art.status, "EXECUTION_AUTHORIZED");
    assert.equal(art.authority.authorizationState, "AUTHORIZED");
    assert.equal(art.authority.parentRef, "EOS-INTENT-100");
    assert.match(art.authority.basis, /inherited from EOS-INTENT-100/);
    // the minted artifact is a well-formed, hash-consistent EOS work item EOS can resolve
    const bytes = Buffer.from(JSON.stringify(art), "utf8");
    const resolved = resolveWorkIntake({ requestId: art.requestId, location: art.artifactLocation, sha256: art.sha256, bytes });
    assert.equal(resolved.requestId, art.requestId);
  }
});

test("buildChildWorkItems is fail-closed: an over-asking child is rejected with violations, not minted", () => {
  const out = buildChildWorkItems({
    parent: PARENT,
    now: "2026-08-13T09:00:00.000Z",
    requests: [
      { requestId: "OK", scope: ["functions/src/access/a.ts"], budgetUsd: 0.2 },
      { requestId: "OVERREACH", scope: ["functions/src/billing/charge.ts"], budgetUsd: 0.2 }, // outside parent scope
    ],
  });
  assert.equal(out.accepted.length, 1);
  assert.equal(out.accepted[0].requestId, "OK");
  assert.equal(out.rejected[0].requestId, "OVERREACH");
});

test("buildChildWorkItems rejects sibling budget over-allocation (children cannot collectively exceed the one approval)", () => {
  const out = buildChildWorkItems({
    parent: PARENT, // budget 1.0
    now: "2026-08-13T09:00:00.000Z",
    requests: [
      { requestId: "S1", scope: ["docs/orchestration/a.md"], budgetUsd: 0.6 },
      { requestId: "S2", scope: ["docs/orchestration/b.md"], budgetUsd: 0.6 }, // 0.6+0.6 > 1.0
    ],
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /sibling budget over-allocation/);
});
