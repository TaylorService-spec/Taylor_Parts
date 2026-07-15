// Enterprise Access & Administration Platform (Issue #226) -- the
// shadow/parity comparison harness. Fixed by docs/specifications/
// enterprise-access-and-administration-platform.md §18 and sequenced by
// docs/implementation-plans/enterprise-access-and-administration-
// platform.md (Row 4 / Task 9).
//
// PURE, dependency-free, NON-AUTHORITATIVE. This module evaluates the
// new resolver ALONGSIDE an already-computed legacy decision, logs and
// compares, and enforces NOTHING -- it never reads/writes Firestore,
// never calls a Rule or Function, and its result is never used to
// allow or deny a real request. Any divergence from the seeded-
// compatibility oracle (Spec §7 / functions/src/access/
// compatibilityRoles.ts) is a parity defect that blocks that domain's
// eventual cutover (Implementation Plan Rows 23-25), not something this
// harness itself decides or acts on.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at functions/src/access/shadowParityHarness.ts. If either file
// changes, change the other to match.
import type { PermissionId } from "../types/access";
import {
  resolveEffectivePermission,
  type ResolveInput,
} from "./resolveEffectivePermission";

export type Decision = "ALLOW" | "DENY";

export interface ShadowComparisonInput {
  // An opaque, human-readable fixture label -- never a raw uid, email,
  // or document id. The whole point of shadow mode is comparing
  // DECISIONS, not exposing WHO they were computed for (Spec §18:
  // "expose no raw IDs/tokens/internals in any output").
  fixtureLabel: string;
  permissionId: PermissionId;
  // The decision the CURRENTLY AUTHORITATIVE legacy path (Rules/
  // Function/UI role-check) already made for this fixture. This
  // harness never derives this itself -- it is supplied by whatever
  // domain-specific parity fixture declares "this is what today's
  // behavior does," matching the seeded-compatibility oracle (Spec §7).
  legacyDecision: Decision;
  resolverInput: ResolveInput;
}

export interface ShadowComparisonResult {
  fixtureLabel: string;
  permissionId: PermissionId;
  legacyDecision: Decision;
  resolvedDecision: Decision;
  match: boolean;
}

// Spec §18: "computing a decision that is logged and compared but not
// enforced." This function is the entire enforcement surface of shadow
// mode: it returns a comparison record. Nothing calls .decision to
// gate a real action.
export function compareShadowDecision(
  input: ShadowComparisonInput,
): ShadowComparisonResult {
  const resolved = resolveEffectivePermission(input.resolverInput);
  return {
    fixtureLabel: input.fixtureLabel,
    permissionId: input.permissionId,
    legacyDecision: input.legacyDecision,
    resolvedDecision: resolved.decision,
    match: resolved.decision === input.legacyDecision,
  };
}

export interface ShadowParityReport {
  total: number;
  matched: number;
  mismatches: ShadowComparisonResult[];
  // Spec §21 P1: "100% match required to advance a domain."
  fullParity: boolean;
}

export function runShadowParitySuite(
  comparisons: readonly ShadowComparisonInput[],
): ShadowParityReport {
  const results = comparisons.map(compareShadowDecision);
  const mismatches = results.filter((r) => !r.match);
  return {
    total: results.length,
    matched: results.length - mismatches.length,
    mismatches,
    fullParity: mismatches.length === 0,
  };
}
