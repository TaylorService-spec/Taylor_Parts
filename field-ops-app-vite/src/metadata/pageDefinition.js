// EOS Metadata — PageDefinition / PageRegion (record page composition).
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §5, §6, §7, §8;
// docs/specifications/metadata-architecture.md.
//
// Declares HOW A RECORD IS COMPOSED. It does not declare what exists (EntityDefinition)
// or how a collection is shaped (ListViewDefinition), and boundary §7 names collapsing
// those layers into one page schema as the failure mode — so this file holds regions and
// section placement, and reaches the other layers only by id.
//
// ─────────────────────────────────────────────────────────────────────────────
// EOS IS OPERATION-CENTRIC, NOT RECORD-CENTRIC (§5)
//
// The most likely way this program fails is not a security lapse — it is arriving at a
// competent record page that turned an operations platform into CRUD screens. §5 lists
// what metadata must carry: lifecycle state, readiness, blockers, next actions, custody,
// attention. On a Work Order those are not decoration on top of fields; they ARE the
// record.
//
// Naming them as section kinds makes operational intent VISIBLE. It does not make the
// CRUD failure DETECTABLE: a Work Order page built from FIELD_GROUP and RELATED_LIST
// alone would still validate, render, and be wrong.
//
// So a page DECLARES what it is, and validation enforces that declaration:
//
//   compositionMode: RECORD | OPERATIONAL | ANALYTIC | CONFIGURATION
//
// An OPERATIONAL page must carry at least TWO DISTINCT operational section kinds. A page
// of fields and related lists cannot validate as OPERATIONAL — the CRUD failure becomes
// a build error rather than a judgement call.
//
// The DECLARATION is what makes this work without cargo-culting. An Account is genuinely
// record-shaped; forcing a LIFECYCLE section onto it to satisfy a universal rule would
// produce exactly the hollow operational theatre this is meant to prevent. The validator
// enforces the contract a page declares. It does not decide that every entity in EOS is
// operational.
//
// What validation CANNOT do is judge whether a Work Order page is any good — two
// operational sections can be two bad ones. Validation prevents architectural
// regression; Gate B judges product quality. Do not try to encode UX quality here.
// ─────────────────────────────────────────────────────────────────────────────

import { findField } from "./entityDefinition.js";

/**
 * Where a section sits. Deliberately semantic rather than pixel positions: metadata
 * that encoded coordinates would make responsive behavior a configuration problem and
 * hand tenants a way to break layouts they cannot test.
 */
export const REGION = Object.freeze(["HEADER", "HIGHLIGHTS", "MAIN", "SIDE", "FOOTER"]);

/**
 * What a section IS.
 *
 * The first two are the record-centric staples. The rest are the operational concerns
 * §5 requires, named so their absence on an operational entity is visible rather than
 * merely unfortunate.
 */
export const SECTION_KIND = Object.freeze([
  "FIELD_GROUP",
  "RELATED_LIST",
  // Operational — §5. Present as named kinds so a Work Order page cannot be "correct"
  // while expressing none of what makes a Work Order a Work Order.
  "LIFECYCLE", // current state + valid transitions
  "READINESS", // can this proceed
  "BLOCKERS", // what is stopping it
  "NEXT_ACTIONS", // what should happen now
  "ATTENTION", // what needs a human
  "ACTIVITY", // operational history: state, custody, decisions, exceptions
  "CUSTODY", // where it is and who holds it
  "METRIC_STRIP", // highlights
]);

/**
 * What a page IS. Declared, then enforced.
 *
 * RECORD and OPERATIONAL are the two v1 must distinguish. ANALYTIC and CONFIGURATION are
 * named now because dashboards and admin surfaces already exist and would otherwise be
 * mislabelled RECORD — which would quietly make the whole classification meaningless.
 */
export const COMPOSITION_MODE = Object.freeze(["RECORD", "OPERATIONAL", "ANALYTIC", "CONFIGURATION"]);

/**
 * Minimum DISTINCT operational section kinds an OPERATIONAL page must carry.
 *
 * Two, not one: a single lifecycle chip on a form is the shape that looks operational in
 * a screenshot and is not. An operational record shows state AND what to do about it.
 */
export const MIN_OPERATIONAL_SECTION_KINDS = 2;

/** The governed operational set the rule above counts against. */
export const OPERATIONAL_SECTION_KINDS = Object.freeze([
  "LIFECYCLE", "READINESS", "BLOCKERS", "NEXT_ACTIONS", "ATTENTION", "CUSTODY",
]);

/**
 * X-SECTION-CAPABILITY-GRANULARITY — `capabilityParts`.
 *
 * `capabilityRequirement` is a single boolean gate on the WHOLE section: correct when a
 * section is backed by one source, wrong when a section COMPOSES pieces the viewer may be
 * entitled to see separately (the recorded case: Account "Attention", which merges an
 * AR read gated on `finance.read` with an ungated Work-Order-past-due read — one gate can
 * only take the strictest answer, either hiding content the viewer may see or showing
 * content they may not).
 *
 * `capabilityParts` is additive, not a replacement: a section that still has exactly one
 * authority level keeps declaring `capabilityRequirement` and is untouched by this. A
 * section declares `capabilityParts` INSTEAD of `capabilityRequirement` (validated
 * mutually exclusive below) when it needs to say "these are the independently-gated
 * pieces I compose" rather than "here is my one gate":
 *
 *   capabilityParts: [
 *     { id: "ar", capabilityRequirement: "finance.read" },
 *     { id: "workOrders", capabilityRequirement: null }, // ungated, always presentable
 *   ]
 *
 * Each part's `id` is a semantic key the section's own consumer defines (a componentId
 * section's registered component reads it back off the resolved section; a FIELD_GROUP
 * part may additionally name `fieldIds`, a subset of the section's own `fieldIds`, so the
 * generic FieldGroup renderer has a mechanical way to know which fields belong to which
 * authority — see the FIELD_GROUP validation below). `capabilityRequirement: null` on a
 * part means that part is ungated — always presentable, exactly like a section with no
 * `capabilityRequirement` at all today.
 *
 * The runtime (pageRuntime.js `applyVisibility`) resolves per-part visibility the same
 * fail-closed way it already resolves the single-gate case, and — the requirement this
 * exists to satisfy — keeps a section with SOME parts withheld distinct from one with
 * NONE: it stays in the plan with `visiblePartIds`/`withheldPartIds`/`partiallyWithheld`
 * attached, rather than silently dropping the withheld part or rendering the section as
 * if nothing was gated. Only when EVERY part is withheld does the section leave the plan
 * entirely — the same "denied, not empty" outcome a fully-denied single-gate section
 * already produces.
 */
export function makeSection(input = {}) {
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    label: input.label ?? null,
    region: input.region ?? "MAIN",
    order: input.order ?? 0,
    componentId: input.componentId ?? null, // REGISTERED component id, never a function
    fieldIds: Object.freeze([...(input.fieldIds ?? [])]), // FIELD_GROUP only
    listId: input.listId ?? null, // RELATED_LIST only
    actions: Object.freeze([...(input.actions ?? [])]), // REGISTERED action ids
    capabilityRequirement: input.capabilityRequirement ?? null,
    // Mutually exclusive with capabilityRequirement — see the doc comment above. `null`
    // (the default) means this section is still the ordinary single-gate (or ungated)
    // shape every existing definition already uses.
    capabilityParts: input.capabilityParts
      ? Object.freeze(
          input.capabilityParts.map((p) =>
            Object.freeze({
              id: p?.id,
              capabilityRequirement: p?.capabilityRequirement ?? null,
              fieldIds: p?.fieldIds ? Object.freeze([...p.fieldIds]) : null,
            })
          )
        )
      : null,
    collapsedByDefault: input.collapsedByDefault ?? false,
  });
}

export function makePageDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    label: input.label,
    // Declared, never inferred. A page that says nothing defaults to RECORD, which is
    // the honest default: it asserts nothing operational and is held to nothing
    // operational.
    compositionMode: input.compositionMode ?? "RECORD",
    headerActions: Object.freeze([...(input.headerActions ?? [])]),
    sections: Object.freeze([...(input.sections ?? [])]),
    capabilityRequirement: input.capabilityRequirement ?? null,
    // ══════════════════ EDITABILITY IS AN ALLOWLIST, NOT AN ABSENCE OF A BAN ══════════════════
    //
    // `editableFieldIds` names exactly the fields a governed command already writes. A field not
    // on this list renders READ-ONLY — visibly so, not hidden — because the reason it cannot be
    // edited is usually worth seeing.
    //
    // WHY AN EXPLICIT LIST RATHER THAN A PER-FIELD `editable` FLAG. The Account write authority is
    // OBJECT-level: domain/accounts.js's updateAccount takes an arbitrary patch, and firestore.rules
    // decides. There is no per-field write contract to read a flag off, so the honest source is the
    // payload the existing governed form actually sends. Deriving the list from the command keeps
    // it falsifiable — a test compares this list against that payload — where a hand-maintained
    // flag per field would drift the first time the form changed.
    //
    // `writeCommand` names the authority in the same breath, so a page can never claim a field is
    // editable without naming what would write it.
    editableFieldIds: Object.freeze([...(input.editableFieldIds ?? [])]),
    writeCommand: input.writeCommand ?? null,
  });
}

/**
 * Is this field editable on this page, and if not, why not.
 *
 * Returns { editable, reason }. The reason is for a READER, not a log: a field that cannot be
 * edited because nothing writes it is a different fact from one an admin could change and this
 * viewer cannot, and collapsing them tells somebody to go ask the wrong person.
 */
export function fieldEditability(def, fieldId, { isAdmin = false, adminOnlyFieldIds = [] } = {}) {
  if (!def?.editableFieldIds?.includes(fieldId)) {
    return { editable: false, reason: "NOT_WRITABLE" };
  }
  if (adminOnlyFieldIds.includes(fieldId) && !isAdmin) {
    return { editable: false, reason: "ADMIN_ONLY" };
  }
  return { editable: true, reason: null };
}

/** What a reader is told about a field they cannot edit. */
export const EDITABILITY_REASON_TEXT = Object.freeze({
  NOT_WRITABLE: "This value is not editable here.",
  ADMIN_ONLY: "Only an administrator can change this.",
});

export function validatePageDefinition(def, entity) {
  const problems = [];
  const at = def?.id ? `page ${def.id}` : "page (no id)";

  if (!def?.id || typeof def.id !== "string") problems.push(`${at}: id is required`);
  if (!def?.label) problems.push(`${at}: label is required`);
  if (def?.id && def.id === def.label) problems.push(`${at}: id and label must be distinct concepts`);

  if (!entity?.id) {
    problems.push(`${at}: an entity is required — a page cannot be checked in isolation`);
    return problems;
  }
  if (def.entityId !== entity.id) problems.push(`${at}: entityId "${def.entityId}" does not match entity "${entity.id}"`);
  if (!def.sections?.length) problems.push(`${at}: a page needs at least one section`);

  const seen = new Set();
  for (const s of def.sections ?? []) {
    const sat = `${at} section ${s?.id ?? "(no id)"}`;
    if (!s?.id) { problems.push(`${sat}: id is required`); continue; }
    if (seen.has(s.id)) problems.push(`${sat}: duplicate section id`);
    seen.add(s.id);

    if (!SECTION_KIND.includes(s.kind)) problems.push(`${sat}: kind "${s.kind}" is not a known SECTION_KIND`);
    if (!REGION.includes(s.region)) problems.push(`${sat}: region "${s.region}" is not a known REGION`);
    if (typeof s.componentId === "function") {
      problems.push(`${sat}: componentId must be a registered id, never a function (boundary §8)`);
    }

    if (s.kind === "FIELD_GROUP") {
      if (!s.fieldIds?.length) problems.push(`${sat}: a FIELD_GROUP needs fieldIds`);
      for (const fid of s.fieldIds ?? []) {
        if (!findField(entity, fid)) problems.push(`${sat}: field "${fid}" is not on ${entity.id}`);
      }
      if (s.listId) problems.push(`${sat}: listId is meaningful only on a RELATED_LIST`);
    }

    if (s.kind === "RELATED_LIST") {
      // The scoping guarantee, restated at the page layer. A related section without a
      // list to point at cannot be scoped to the parent, and an unscoped section renders
      // every record of the target entity — the shape of the defect where an account's
      // opportunity rows all navigated into the unscoped all-opportunities index.
      if (!s.listId) problems.push(`${sat}: a RELATED_LIST must name the ListViewDefinition it renders`);
      if (s.fieldIds?.length) problems.push(`${sat}: fieldIds are meaningful only on a FIELD_GROUP`);
    }

    // X-SECTION-CAPABILITY-GRANULARITY — a malformed capabilityParts declaration is
    // rejected HERE, loudly, at definition time. Tolerating it at runtime would mean the
    // fail-closed behavior in applyVisibility is the only thing standing between a typo
    // and a silently mis-gated section — validation is where that must be caught instead.
    if (s?.capabilityParts != null) {
      if (s.capabilityRequirement) {
        problems.push(
          `${sat}: capabilityParts and capabilityRequirement are mutually exclusive — a composed ` +
            `section expresses authority per part, not once for the whole section`
        );
      }
      if (!Array.isArray(s.capabilityParts) || s.capabilityParts.length === 0) {
        problems.push(`${sat}: capabilityParts must be a non-empty array when declared`);
      } else {
        const partIds = new Set();
        const claimedFieldIds = new Set();
        for (const part of s.capabilityParts) {
          if (!part || typeof part !== "object" || Array.isArray(part)) {
            problems.push(`${sat}: each capabilityParts entry must be an object`);
            continue;
          }
          if (!part.id || typeof part.id !== "string") {
            problems.push(`${sat}: a capabilityParts entry is missing a string id`);
            continue;
          }
          if (partIds.has(part.id)) problems.push(`${sat}: duplicate capabilityParts id "${part.id}"`);
          partIds.add(part.id);

          if (part.capabilityRequirement != null && typeof part.capabilityRequirement !== "string") {
            problems.push(`${sat}: capabilityParts "${part.id}" capabilityRequirement must be a string or null`);
          }

          if (part.fieldIds != null) {
            if (s.kind !== "FIELD_GROUP") {
              problems.push(`${sat}: capabilityParts "${part.id}" fieldIds are meaningful only on a FIELD_GROUP`);
            } else if (!Array.isArray(part.fieldIds) || part.fieldIds.length === 0) {
              problems.push(`${sat}: capabilityParts "${part.id}" fieldIds must be a non-empty array when declared`);
            } else {
              for (const fid of part.fieldIds) {
                if (!s.fieldIds?.includes(fid)) {
                  problems.push(`${sat}: capabilityParts "${part.id}" names field "${fid}" which is not in this section's own fieldIds`);
                  continue;
                }
                if (claimedFieldIds.has(fid)) {
                  problems.push(`${sat}: field "${fid}" is claimed by more than one capabilityParts entry`);
                }
                claimedFieldIds.add(fid);
              }
            }
          }
        }
      }
    }
  }

  // COMPOSITION MODE — the conditional rule (Owner ruling 2026-08-17 §3/§4).
  if (!COMPOSITION_MODE.includes(def?.compositionMode)) {
    problems.push(`${at}: compositionMode "${def?.compositionMode}" is not a known COMPOSITION_MODE`);
  } else if (def.compositionMode === "OPERATIONAL") {
    const distinct = new Set(
      (def.sections ?? []).map((sec) => sec?.kind).filter((k) => OPERATIONAL_SECTION_KINDS.includes(k))
    );
    if (distinct.size < MIN_OPERATIONAL_SECTION_KINDS) {
      problems.push(
        `${at}: declares compositionMode OPERATIONAL but carries ${distinct.size} distinct operational section ` +
          `kind(s); at least ${MIN_OPERATIONAL_SECTION_KINDS} of ${OPERATIONAL_SECTION_KINDS.join("/")} are required. ` +
          `A page of fields and related lists is a RECORD page — declare it as one rather than weakening this rule.`
      );
    }
  }

  // Ordering must be decidable. Two sections claiming the same slot in the same region
  // render in whatever order the array happened to be built in, which turns a layout
  // into an accident of authoring.
  const byRegion = new Map();
  for (const s of def.sections ?? []) {
    const key = `${s.region}|${s.order}`;
    if (byRegion.has(key)) {
      problems.push(`${at}: sections "${byRegion.get(key)}" and "${s.id}" share region ${s.region} order ${s.order} — ordering must be decidable`);
    }
    byRegion.set(key, s.id);
  }

  return problems;
}

/**
 * DIAGNOSTIC, not enforcement. Its role changed when compositionMode arrived, and the
 * three levels are worth keeping straight:
 *
 *   validation  — enforces the MINIMUM contract a page explicitly declared.
 *   assessment  — reports architectural quality beyond that minimum.
 *   Gate B      — judges whether the resulting experience is genuinely operational.
 *
 * A page can satisfy the minimum and still be poor: two operational sections can be two
 * bad ones. That is deliberately not a validation problem, because encoding UX quality
 * into a validator yields rules that are either trivially satisfiable or simply wrong.
 *
 * @returns {{operationalSectionKinds: string[], isOperationCentric: boolean, satisfiesDeclaredMode: boolean}}
 */
export function assessOperationalComposition(def) {
  const kinds = new Set((def?.sections ?? []).map((s) => s.kind));
  const operational = OPERATIONAL_SECTION_KINDS.filter((k) => kinds.has(k));
  return Object.freeze({
    operationalSectionKinds: Object.freeze(operational),
    isOperationCentric: operational.length >= MIN_OPERATIONAL_SECTION_KINDS,
    // Does the page meet the bar for what it CLAIMS to be? A RECORD page trivially does —
    // which is not a compliment, only the absence of a contradiction.
    satisfiesDeclaredMode:
      def?.compositionMode === "OPERATIONAL"
        ? operational.length >= MIN_OPERATIONAL_SECTION_KINDS
        : true,
  });
}

/** Every registry id a page references, for pre-render validation. */
export function pageRegistryReferences(def) {
  const components = new Set();
  const actions = new Set();
  for (const a of def?.headerActions ?? []) if (typeof a === "string") actions.add(a);
  for (const s of def?.sections ?? []) {
    if (s?.componentId) components.add(s.componentId);
    for (const a of s?.actions ?? []) if (typeof a === "string") actions.add(a);
  }
  return { components: [...components].sort(), actions: [...actions].sort() };
}

/** Every ListViewDefinition id a page's related sections depend on. */
export function referencedListIds(def) {
  return [...new Set((def?.sections ?? []).filter((s) => s.kind === "RELATED_LIST" && s.listId).map((s) => s.listId))].sort();
}
