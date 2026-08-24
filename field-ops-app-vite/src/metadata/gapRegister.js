// THE GAP REGISTER — a known limitation is DATA, not a comment.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
// Converged from the retired `domain/fieldMetadata.js` pilot (PRs #1443/#1444).
//
// ============================ WHAT A GAP IS ============================
//
// A gap says: THIS FIELD OR BEHAVIOUR EXISTS CONCEPTUALLY, AND CANNOT TRUTHFULLY BE PROVIDED YET.
//
// That sentence gets written constantly during a migration — "no total on the Sales Order", "the
// balance callable is per-part", "the Part carries no cost" — and until now it was written in a
// comment beside the field it disabled. Comments are invisible to the three consumers that most need
// this: architecture review deciding what to build next, reporting deciding what it can honestly
// offer, and migrations deciding what a projection has to carry.
//
// So a gap is a validated record with a stable id, and `allGaps()` can be read by any of them.
//
// ============================ WHY IT IS NOT A STRING DUMP ============================
//
// The obvious version is `gaps: ["no total on sales orders"]`, and it rots within a month: nothing
// stops two people writing the same gap differently, nothing connects a gap to the field it
// disables, and nothing records what was REFUSED — which is the part that stops the refusal being
// quietly reversed later by somebody who does not know why it was made.
//
// `makeGap` is therefore validated the same way every other definition in this layer is, and
// `validateGap` is strict about the three fields that carry the meaning: what was found, what it
// costs, and what was refused.
//
// ============================ A GAP IS NOT A REASON ============================
//
// `unsupportedReason.js` explains ONE field's disabled control to a person looking at a screen. A
// gap is the durable, reviewable record of a decision, and usually names the reason it produced.
// Both, or neither — a field disabled with a reason but no gap is fine (most are), and a gap with no
// field is fine too (a behaviour can be missing without a field to hang it on).

/** How much a gap costs today. Ordered from "already hurting" to "recorded for later". */
export const GAP_SEVERITY = Object.freeze({
  /** Present in production and producing wrong or misleading output right now. */
  DEFECT: "DEFECT",
  /** Correct today, but will not hold at real volume. */
  SCALE: "SCALE",
  /** The platform cannot answer this question at all yet. */
  MISSING_AUTHORITY: "MISSING_AUTHORITY",
  /** Works, but the shape is wrong and a later consumer will pay for it. */
  MODELLING: "MODELLING",
});

const SEVERITIES = Object.freeze(Object.values(GAP_SEVERITY));

/**
 * One gap.
 *
 * @param id          STABLE, machine, SCREAMING_SNAKE. Quoted in reviews and roadmaps, so renaming
 *                    one breaks a trail on purpose.
 * @param title       the sentence a person reads. Never compared, never persisted.
 * @param entityId    the entity it belongs to, when it has one.
 * @param fieldId     the field it disables, when it has one.
 * @param severity    GAP_SEVERITY.
 * @param finding     what the trace actually found. Evidence, not opinion.
 * @param consequence what it costs while it stands.
 * @param refused     what was deliberately NOT done. The load-bearing field: without it, the next
 *                    person re-derives the shortcut this gap exists to prevent.
 * @param resolution  what would close it, when that is known.
 * @param reason      the UNSUPPORTED_REASON this gap produces on its field, when it has one.
 */
export function makeGap(input = {}) {
  return Object.freeze({
    id: input.id,
    title: input.title,
    entityId: input.entityId ?? null,
    fieldId: input.fieldId ?? null,
    severity: input.severity ?? GAP_SEVERITY.MISSING_AUTHORITY,
    finding: input.finding ?? null,
    consequence: input.consequence ?? null,
    refused: input.refused ?? null,
    resolution: input.resolution ?? null,
    reason: input.reason ?? null,
  });
}

/** Validate one gap. Returns problem strings; empty means valid. */
export function validateGap(gap) {
  const problems = [];
  const at = gap?.id ? `gap ${gap.id}` : "gap (no id)";

  if (!gap?.id || typeof gap.id !== "string") {
    problems.push(`${at}: id is required and must be a string`);
  } else if (!/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(gap.id)) {
    // An id that drifts in casing stops being quotable, and quotability is the whole point.
    problems.push(`${at}: id must be SCREAMING_SNAKE_CASE so it can be quoted in a review verbatim`);
  }
  if (!gap?.title || typeof gap.title !== "string") problems.push(`${at}: title is required`);
  if (gap?.id && gap.id === gap.title) {
    problems.push(`${at}: id and title must be distinct — a machine id is not a sentence`);
  }
  if (!SEVERITIES.includes(gap?.severity)) {
    problems.push(`${at}: severity "${gap?.severity}" is not a GAP_SEVERITY`);
  }
  if (!gap?.finding) {
    // A gap with no finding is an opinion. The register exists to hold evidence.
    problems.push(`${at}: finding is required — a gap records what a trace FOUND, not what somebody suspects`);
  }
  if (!gap?.refused && !gap?.resolution) {
    // One or the other. A gap that neither says what was refused nor what would close it gives the
    // next reader nothing to act on, and will be re-litigated from scratch.
    problems.push(`${at}: state either what was refused or what would resolve it — otherwise this is just a note`);
  }
  if (typeof gap?.fieldId === "string" && !gap.entityId) {
    problems.push(`${at}: a gap naming a fieldId must also name its entityId`);
  }
  return problems;
}

/**
 * Collect and validate every gap declared across a set of entity definitions.
 *
 * THROWS on an invalid or duplicated gap, at module load, for the same reason
 * `defineObjectFields` did in the pilot and `validateEntityDefinition` does here: a malformed
 * governance record discovered in a code review months later has already failed at its job.
 */
export function collectGaps(entities = []) {
  const byId = new Map();
  const problems = [];
  for (const entity of entities) {
    for (const gap of entity?.gaps ?? []) {
      problems.push(...validateGap(gap));
      if (byId.has(gap?.id)) {
        problems.push(`gap ${gap.id}: declared twice (${byId.get(gap.id)} and ${entity.id})`);
        continue;
      }
      if (gap?.id) byId.set(gap.id, entity.id);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Invalid gap register:\n  ${problems.join("\n  ")}`);
  }
  return Object.freeze(entities.flatMap((e) => [...(e?.gaps ?? [])]));
}

/** Every gap an entity declares against one field. */
export function gapsForField(entity, fieldId) {
  return Object.freeze((entity?.gaps ?? []).filter((g) => g.fieldId === fieldId));
}
