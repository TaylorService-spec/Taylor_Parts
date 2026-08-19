// EOS Metadata — page composition runtime.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §5, §6, §7, §8;
// docs/specifications/metadata-architecture.md.
//
// Turns a PageDefinition into a RESOLVED COMPOSITION PLAN: which sections render, in
// which region, in what order, backed by which registered component, and which
// capabilities each one declares. It renders nothing — no React, no JSX, no DOM.
//
// Same separation as the list query core, for the same reason. Composition rules are
// the part worth asserting exhaustively (a section that renders when it should not is a
// governance failure, not a cosmetic one), and they are only assertable offline while
// they are pure. Fused into a component, "does an unauthorized section render?" becomes
// a question you answer by rendering things and looking.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE THING THIS MUST NOT DO (§6)
//
// A plan says a section is PRESENTABLE. It never says a viewer may see it.
//
// Every section carries its declared capability requirement outward, unevaluated, for
// the caller's real resolver to answer. Nothing here reads a decision, and there is no
// argument by which a caller could pass one in — because a runtime that accepted
// `{ allowed: true }` would become the place authorization is decided the first time
// someone was in a hurry.
//
// The distinction that makes this safe rather than pedantic: hiding a section is
// PRESENTATION, and showing one is not permission. Rules and trusted commands remain
// the boundary. A plan that renders a Dispatch action still cannot dispatch.
// ─────────────────────────────────────────────────────────────────────────────

import { REGION, OPERATIONAL_SECTION_KINDS, MIN_OPERATIONAL_SECTION_KINDS } from "./pageDefinition.js";
import { componentRegistry, actionRegistry } from "./registry.js";

/** Why a section was excluded from a plan. Distinct causes, never collapsed. */
export const EXCLUSION = Object.freeze([
  "UNREGISTERED_COMPONENT", // the definition names a component nobody registered
  "MISSING_LIST", // a RELATED_LIST names no list to render
]);

/**
 * Build the composition plan.
 *
 * @param {object} def   PageDefinition
 * @param {object} opts  { listResolver } — maps a listId to a definition, so a related
 *                       section that points at nothing is caught HERE rather than
 *                       rendering an empty box the user reads as "no records".
 * @returns {{regions: object, sections: object[], excluded: object[], declaredCapabilities: string[], operational: object}}
 */
export function buildCompositionPlan(def, opts = {}) {
  const listResolver = opts.listResolver ?? (() => null);

  const sections = [];
  const excluded = [];

  for (const s of def?.sections ?? []) {
    if (s.componentId && !componentRegistry.has(s.componentId)) {
      // Excluded rather than rendered-blank. A section whose component is missing would
      // otherwise be an empty region the user cannot distinguish from "nothing here",
      // which is the failure mode where a broken deploy looks like an empty account.
      excluded.push(Object.freeze({ sectionId: s.id, reason: "UNREGISTERED_COMPONENT", detail: s.componentId }));
      continue;
    }
    if (s.kind === "RELATED_LIST" && !listResolver(s.listId)) {
      excluded.push(Object.freeze({ sectionId: s.id, reason: "MISSING_LIST", detail: s.listId }));
      continue;
    }

    sections.push(Object.freeze({
      id: s.id,
      kind: s.kind,
      label: s.label ?? null,
      region: REGION.includes(s.region) ? s.region : "MAIN",
      order: Number.isFinite(s.order) ? s.order : 0,
      componentId: s.componentId ?? null,
      listId: s.listId ?? null,
      fieldIds: s.fieldIds ?? [],
      actions: s.actions ?? [],
      collapsedByDefault: !!s.collapsedByDefault,
      // DECLARED, not decided (§6). Exactly one of these two is ever populated —
      // pageDefinition.js's validator rejects a section that declares both — but both are
      // carried through here unresolved, same as everywhere else in this file.
      capabilityRequirement: s.capabilityRequirement ?? null,
      capabilityParts: s.capabilityParts ?? null,
    }));
  }

  // Deterministic order: by declared order, then by id. Ties are broken rather than left
  // to array position, so the same definition always composes identically — a page whose
  // layout depends on authoring sequence is a page that changes when someone reorders
  // an unrelated line.
  sections.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const regions = Object.fromEntries(REGION.map((r) => [r, sections.filter((s) => s.region === r)]));

  const distinctOperational = new Set(sections.map((s) => s.kind).filter((k) => OPERATIONAL_SECTION_KINDS.includes(k)));

  return Object.freeze({
    pageId: def?.id ?? null,
    entityId: def?.entityId ?? null,
    compositionMode: def?.compositionMode ?? "RECORD",
    regions: Object.freeze(regions),
    sections: Object.freeze(sections),
    excluded: Object.freeze(excluded),
    declaredCapabilities: declaredPageCapabilities(def, sections),
    operational: Object.freeze({
      kinds: Object.freeze([...distinctOperational]),
      // Reports whether the plan STILL meets what the page declared. Exclusions can drop
      // a page below its own bar — a Work Order whose LIFECYCLE component failed to
      // register is no longer an operational page, and saying so is more useful than
      // rendering a diminished one silently.
      satisfiesDeclaredMode:
        def?.compositionMode === "OPERATIONAL"
          ? distinctOperational.size >= MIN_OPERATIONAL_SECTION_KINDS
          : true,
    }),
  });
}

/** Every capability id a page declares — sections plus their registered actions. §6: ids only. */
export function declaredPageCapabilities(def, sections = null) {
  const out = new Set();
  if (def?.capabilityRequirement) out.add(def.capabilityRequirement);
  for (const s of sections ?? def?.sections ?? []) {
    if (s.capabilityRequirement) out.add(s.capabilityRequirement);
    for (const part of s.capabilityParts ?? []) {
      if (part?.capabilityRequirement) out.add(part.capabilityRequirement);
    }
    for (const a of s.actions ?? []) {
      const entry = typeof a === "string" ? actionRegistry.resolve(a) : null;
      if (entry?.capabilityRequirement) out.add(entry.capabilityRequirement);
    }
  }
  for (const a of def?.headerActions ?? []) {
    const entry = typeof a === "string" ? actionRegistry.resolve(a) : null;
    if (entry?.capabilityRequirement) out.add(entry.capabilityRequirement);
  }
  return Object.freeze([...out].sort());
}

/** A single capabilityParts entry is presentable iff it is ungated or its decision is exactly `true`. */
function partIsVisible(part, decisions) {
  return !part.capabilityRequirement || decisions[part.capabilityRequirement] === true;
}

/**
 * Narrow a plan to what a viewer may see.
 *
 * The decision is the CALLER's: `decisions` is the resolver's already-computed map of
 * capability id to boolean. This function performs no resolution and has no fallback —
 * an undeclared or unresolved capability is treated as DENIED, so a resolver that failed
 * to answer produces a hidden section rather than an exposed one.
 *
 * Fail-closed here is presentation-level defence in depth, not the boundary. The
 * boundary is Rules and trusted commands, and it does not move because this function
 * exists.
 *
 * X-SECTION-CAPABILITY-GRANULARITY — a section with `capabilityParts` (see
 * pageDefinition.js's makeSection doc comment) is resolved per part, the same fail-closed
 * way, and then reduced to a section-level outcome:
 *
 *   - EVERY part denied  → the section is excluded entirely, same as a fully-denied
 *     single-gate section (the "removed from the plan, not empty" precedent this task was
 *     told not to re-open).
 *   - SOME parts denied  → the section stays in the plan — it is NOT empty, some of its
 *     content is genuinely presentable — but carries `visiblePartIds`, `withheldPartIds`,
 *     and `partiallyWithheld: true` so the caller/renderer can say so rather than
 *     presenting a full section as if nothing were gated. This is the state the ledger
 *     item names as silently unrepresentable today.
 *   - NO parts denied    → the section stays in the plan exactly as a section with no
 *     `capabilityRequirement` at all would; `partiallyWithheld` is `false`.
 *
 * A section with no `capabilityParts` is untouched by any of this — it takes the exact
 * branch it always has, so every existing single-capability definition keeps behaving
 * identically (proved by test, see metadataPageRuntime.test.mjs).
 */
export function applyVisibility(plan, decisions = {}) {
  const visible = [];
  const hidden = [];

  for (const s of plan.sections) {
    if (s.capabilityParts?.length) {
      const visiblePartIds = [];
      const withheldPartIds = [];
      for (const part of s.capabilityParts) {
        (partIsVisible(part, decisions) ? visiblePartIds : withheldPartIds).push(part.id);
      }
      if (visiblePartIds.length === 0) {
        hidden.push(s);
        continue;
      }
      visible.push(Object.freeze({
        ...s,
        visiblePartIds: Object.freeze(visiblePartIds),
        withheldPartIds: Object.freeze(withheldPartIds),
        partiallyWithheld: withheldPartIds.length > 0,
      }));
      continue;
    }

    if (!s.capabilityRequirement || decisions[s.capabilityRequirement] === true) {
      visible.push(s);
    } else {
      hidden.push(s);
    }
  }

  return Object.freeze({
    ...plan,
    sections: Object.freeze(visible),
    regions: Object.freeze(Object.fromEntries(REGION.map((r) => [r, visible.filter((s) => s.region === r)]))),
    hidden: Object.freeze(hidden.map((s) => s.id)),
  });
}
