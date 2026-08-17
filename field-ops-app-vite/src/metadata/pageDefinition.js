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
// what metadata must carry: lifecycle state, readiness, blockers, next actions,
// approvals, queues, custody, demand, attention. Those are not decoration on top of
// fields; on a Work Order they ARE the record.
//
// So SECTION_KIND names them as first-class kinds rather than leaving everything a
// generic "component slot". A Work Order page composed only of FIELD_GROUP and
// RELATED_LIST sections would validate, render, and be wrong — and nothing would say so.
// Naming the operational kinds is what lets Gate B ask a checkable question: does this
// non-CRM entity's page express lifecycle, readiness and blockers, or did we quietly
// build Salesforce?
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

/** Kinds that carry operational meaning. Used by the Gate B check below. */
export const OPERATIONAL_SECTION_KINDS = Object.freeze([
  "LIFECYCLE", "READINESS", "BLOCKERS", "NEXT_ACTIONS", "ATTENTION", "CUSTODY",
]);

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
    collapsedByDefault: input.collapsedByDefault ?? false,
  });
}

export function makePageDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    label: input.label,
    headerActions: Object.freeze([...(input.headerActions ?? [])]),
    sections: Object.freeze([...(input.sections ?? [])]),
    capabilityRequirement: input.capabilityRequirement ?? null,
  });
}

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
 * Does this page express the entity as an OPERATION rather than a record? (§5)
 *
 * Not a validator rule, because it is not universally required — an Account genuinely is
 * a record-shaped thing, and forcing a LIFECYCLE section onto it would be cargo-culting
 * the check. It is a question a caller asks about entities that ARE operational, and it
 * is the mechanical half of the Gate B standard: "if the architecture only works well
 * for CRM records, it is not yet an EOS metadata architecture."
 *
 * @returns {{operationalSectionKinds: string[], isOperationCentric: boolean}}
 */
export function assessOperationalComposition(def) {
  const kinds = new Set((def?.sections ?? []).map((s) => s.kind));
  const operational = OPERATIONAL_SECTION_KINDS.filter((k) => kinds.has(k));
  return Object.freeze({
    operationalSectionKinds: Object.freeze(operational),
    // Two or more, deliberately. One operational section is a metric bolted onto a form;
    // an operational record page shows state AND what to do about it.
    isOperationCentric: operational.length >= 2,
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
