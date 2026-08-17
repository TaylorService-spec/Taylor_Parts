import { findField } from "../entityDefinition.js";

// The EOS Query Model — one governed AST, six consumers.
//
// List filters, saved views, the report builder, automation conditions, EQL, AI-generated
// queries and the admin visual builder all describe the same thing: a scoped, authorized
// read. Today only lists have a model for it. If each of the others builds its own, the
// six will eventually disagree about what a filter MEANS — whether an empty IN matches
// everything or nothing, whether a null equals a missing field, whether a declared
// operator implies an index — and those disagreements surface as data that looks wrong
// rather than as errors.
//
// So this is the AST they compile INTO, not a seventh dialect. It is deliberately not a
// syntax: EQL, a visual builder and a saved view are three surfaces over one model, and
// the model is the thing that gets validated.
//
// WHAT THIS DOES NOT DO. It does not execute, does not know about Firestore, and does not
// resolve authority. Execution belongs to a source adapter (firestoreListSource.js is the
// first), and authority decisions arrive resolved from a caller — §6 of the boundary does
// not soften because a query is involved.
//
// IT DOES NOT COLLAPSE THE BOARD CONTRACT. A board returns a complete working set or
// admits it cannot; a list returns a page and says there is more. Both compile into this
// model, and `completeness` is what keeps them distinguishable — folding a board into
// list paging is exactly the mistake boardScope.js exists to prevent.

export const PREDICATE_KIND = Object.freeze(["COMPARISON", "GROUP", "TRAVERSAL"]);

export const COMPARISON_OPERATOR = Object.freeze([
  "EQUALS", "NOT_EQUALS", "IN", "NOT_IN",
  "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL",
  "ARRAY_CONTAINS", "ARRAY_CONTAINS_ANY",
  "IS_NULL", "IS_NOT_NULL",
]);

export const GROUP_OPERATOR = Object.freeze(["AND", "OR", "NOT"]);

/**
 * What the caller is promising about the result.
 *
 * PAGE     a page, plus an honest "there is more" — a list.
 * COMPLETE every matching row within a declared scope, or a refusal — a board, an export.
 * AGGREGATE a measure over the complete match set; correctness cannot depend on paging.
 *
 * Declared rather than inferred, because the same predicate serves all three and only the
 * caller knows which promise it is making.
 */
export const COMPLETENESS = Object.freeze(["PAGE", "COMPLETE", "AGGREGATE"]);

export const comparison = (fieldSystemName, operator, value) =>
  Object.freeze({ kind: "COMPARISON", field: fieldSystemName, operator, value });

export const group = (operator, ...predicates) =>
  Object.freeze({ kind: "GROUP", operator, predicates: Object.freeze(predicates) });

/**
 * A predicate on a field reached through a REGISTERED relationship.
 *
 * One hop. Named explicitly rather than expressed as a dotted field, so traversal is a
 * thing the validator can see, check authority for, and refuse — a dotted string would
 * make it invisible until execution.
 */
export const traversal = (relationshipId, predicate) =>
  Object.freeze({ kind: "TRAVERSAL", relationship: relationshipId, predicate });

export function makeQuery(input = {}) {
  return Object.freeze({
    entityId: input.entityId,
    select: Object.freeze([...(input.select ?? [])]),
    where: input.where ?? null,
    orderBy: Object.freeze([...(input.orderBy ?? [])]),
    completeness: input.completeness ?? "PAGE",
    limit: input.limit ?? null,
    cursor: input.cursor ?? null,
    // Declared, never decided here. The resolver stays authoritative.
    requiredCapabilities: Object.freeze([...(input.requiredCapabilities ?? [])]),
    // Which consumer produced it. Not decorative: an EQL query and an automation
    // condition fail differently and are audited differently, and losing the origin means
    // an execution record cannot say what asked for the read.
    origin: input.origin ?? "UNKNOWN",
  });
}

export const QUERY_ORIGIN = Object.freeze([
  "LIST", "SAVED_VIEW", "BOARD", "REPORT", "AUTOMATION", "EQL", "AI", "EXPORT", "UNKNOWN",
]);

const problem = (code, message) => Object.freeze({ code, message });

/**
 * Stage 1 — METADATA validation. Does this query describe things that exist?
 *
 * Separate stage from authority and from queryability, because the three answer different
 * questions and a caller needs to know which one refused: "no such field" is an author
 * error, "not permitted" is an access answer, and "no index" is an operations task.
 */
export function validateAgainstMetadata(query, entity) {
  const problems = [];
  if (!query?.entityId || !entity) {
    problems.push(problem("UNKNOWN_ENTITY", "a query must name an entity that exists"));
    return Object.freeze(problems);
  }
  if (entity.id !== query.entityId) {
    problems.push(problem("UNKNOWN_ENTITY", `query names ${query.entityId} but was validated against ${entity.id}`));
  }

  for (const fieldName of query.select) {
    if (!findField(entity, fieldName)) {
      problems.push(problem("UNKNOWN_FIELD", `"${fieldName}" is not a field on ${entity.id}`));
    }
  }
  for (const sort of query.orderBy) {
    const field = findField(entity, sort.field);
    if (!field) problems.push(problem("UNKNOWN_FIELD", `sort field "${sort.field}" is not on ${entity.id}`));
    else if (!field.sortable) problems.push(problem("NOT_SORTABLE", `"${sort.field}" is not declared sortable`));
  }

  const walk = (node, path = "where") => {
    if (!node) return;
    if (node.kind === "GROUP") {
      if (!GROUP_OPERATOR.includes(node.operator)) {
        problems.push(problem("UNKNOWN_OPERATOR", `${path}: "${node.operator}" is not a group operator`));
      }
      if (!node.predicates?.length) {
        problems.push(problem("EMPTY_GROUP", `${path}: a ${node.operator} group needs predicates`));
      }
      node.predicates?.forEach((p, i) => walk(p, `${path}.${node.operator}[${i}]`));
      return;
    }
    if (node.kind === "TRAVERSAL") {
      const rel = (entity.relationships ?? []).find((r) => r.id === node.relationship);
      if (!rel) {
        // A traversal to a relationship nobody registered is the arbitrary join this model
        // exists to forbid — expressible in SQL syntax, not executable honestly here.
        problems.push(problem("UNKNOWN_RELATIONSHIP", `${path}: "${node.relationship}" is not a registered relationship on ${entity.id}`));
      }
      return;
    }
    if (node.kind !== "COMPARISON") {
      problems.push(problem("UNKNOWN_PREDICATE", `${path}: a predicate must be a comparison, a group, or a traversal`));
      return;
    }
    const field = findField(entity, node.field);
    if (!field) {
      problems.push(problem("UNKNOWN_FIELD", `${path}: "${node.field}" is not a field on ${entity.id}`));
      return;
    }
    if (!COMPARISON_OPERATOR.includes(node.operator)) {
      problems.push(problem("UNKNOWN_OPERATOR", `${path}: "${node.operator}" is not a comparison operator`));
      return;
    }
    // A declared operator is a promise. This is the same rule the list contract enforces,
    // applied to every consumer rather than only to lists.
    if (!(field.operators ?? []).includes(node.operator) && !["IS_NULL", "IS_NOT_NULL"].includes(node.operator)) {
      problems.push(problem("UNDECLARED_OPERATOR", `${path}: "${node.field}" does not declare ${node.operator}`));
    }
    if ((node.operator === "IN" || node.operator === "NOT_IN") && Array.isArray(node.value) && node.value.length === 0) {
      // An empty IN is ambiguous by convention — some engines match nothing, some
      // everything — so it is refused rather than resolved by whichever backend runs it.
      problems.push(problem("EMPTY_IN", `${path}: an empty ${node.operator} is ambiguous and must not be issued`));
    }
  };
  walk(query.where);
  return Object.freeze(problems);
}

/**
 * Stage 2 — AUTHORITY validation, against decisions the CALLER resolved.
 *
 * Fails closed: an empty decision map denies everything requiring a capability. The
 * important case is the second loop — a field a viewer may not READ cannot be filtered
 * on either, because a predicate over a hidden field leaks its values by binary search.
 */
export function validateAuthority(query, entity, decisions = {}) {
  const problems = [];
  for (const capability of query.requiredCapabilities) {
    if (decisions[capability] !== true) {
      problems.push(problem("DENIED", `requires ${capability}`));
    }
  }

  const check = (fieldName, where) => {
    const field = findField(entity, fieldName);
    if (field?.readCapability && decisions[field.readCapability] !== true) {
      problems.push(problem("DENIED_FIELD", `${where}: "${fieldName}" requires ${field.readCapability}`));
    }
  };
  for (const fieldName of query.select) check(fieldName, "select");

  const walk = (node, path = "where") => {
    if (!node) return;
    if (node.kind === "GROUP") return node.predicates?.forEach((p, i) => walk(p, `${path}.${node.operator}[${i}]`));
    if (node.kind === "TRAVERSAL") {
      const rel = (entity.relationships ?? []).find((r) => r.id === node.relationship);
      // Traversal authority is the RELATED entity's, not this one's. A viewer who may read
      // the Work Order but not the Account cannot filter Work Orders by Account fields —
      // the same disclosure a LOOKUP field would launder, one level up.
      if (rel?.traversalCapability && decisions[rel.traversalCapability] !== true) {
        problems.push(problem("DENIED_TRAVERSAL", `${path}: traversing "${node.relationship}" requires ${rel.traversalCapability}`));
      }
      return;
    }
    if (node.kind === "COMPARISON") check(node.field, path);
  };
  walk(query.where);
  return Object.freeze(problems);
}

/**
 * Stage 3 — QUERYABILITY. Can the backend honestly serve this shape?
 *
 * The stage that stops a query from being accepted because it reads well. A VIRTUAL
 * derived value is displayable and not filterable; an AGGREGATE promise cannot carry a
 * cursor; a COMPLETE promise cannot carry a page-shaped limit without saying what happens
 * when the set is larger.
 */
export function validateQueryability(query, entity) {
  const problems = [];

  const walk = (node, path = "where") => {
    if (!node) return;
    if (node.kind === "GROUP") return node.predicates?.forEach((p, i) => walk(p, `${path}.${node.operator}[${i}]`));
    if (node.kind !== "COMPARISON") return;
    const field = findField(entity, node.field);
    if (field?.queryability === "VIRTUAL") {
      problems.push(problem("NOT_QUERYABLE", `${path}: "${node.field}" is computed at read time and cannot be filtered`));
    }
  };
  walk(query.where);

  if (query.completeness === "AGGREGATE" && query.cursor) {
    problems.push(problem("AGGREGATE_PAGED", "an aggregate cannot be paged — a page of inputs yields a false total"));
  }
  if (query.completeness === "AGGREGATE" && query.limit) {
    problems.push(problem("AGGREGATE_BOUNDED", "an aggregate cannot be bounded — bounding its input makes the measure partial while it still reads as complete"));
  }
  if (query.completeness === "COMPLETE" && query.cursor) {
    problems.push(problem("COMPLETE_PAGED", "a COMPLETE result is not paged — it is complete within its declared scope or it is refused"));
  }
  if (query.completeness === "PAGE" && !query.limit) {
    problems.push(problem("UNBOUNDED_PAGE", "a PAGE result must declare a limit — an unbounded page is a whole-collection read"));
  }
  if (!COMPLETENESS.includes(query.completeness)) {
    problems.push(problem("UNKNOWN_COMPLETENESS", `"${query.completeness}" is not a known completeness promise`));
  }
  return Object.freeze(problems);
}

/**
 * The pipeline, in order, stopping at the first stage that refuses.
 *
 * Ordered deliberately: metadata before authority before queryability. Reporting "you may
 * not read that field" for a field that does not exist tells the caller something false
 * about their access, and reporting a missing index for a query that was never authorized
 * leaks the shape of data the caller cannot see.
 */
export function validateQuery(query, entity, { decisions = {} } = {}) {
  const metadata = validateAgainstMetadata(query, entity);
  if (metadata.length) return Object.freeze({ stage: "METADATA", problems: metadata });

  const authority = validateAuthority(query, entity, decisions);
  if (authority.length) return Object.freeze({ stage: "AUTHORITY", problems: authority });

  const queryability = validateQueryability(query, entity);
  if (queryability.length) return Object.freeze({ stage: "QUERYABILITY", problems: queryability });

  return Object.freeze({ stage: "VALID", problems: Object.freeze([]) });
}
