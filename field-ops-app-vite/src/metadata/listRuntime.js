// EOS Metadata — list runtime query core.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §6, §8, §9;
// docs/specifications/metadata-architecture.md §6.
//
// Turns a ListViewDefinition plus a request into a BOUNDED QUERY DESCRIPTOR: a plain
// object describing what to fetch. It executes nothing. No Firestore import, no React,
// no grid library.
//
// That separation is not tidiness. It is what makes §9 testable. "No client-side dataset
// ownership" is a claim about the SHAPE of every query this runtime can produce, and a
// shape can be asserted offline and exhaustively. Hidden inside a hook that also owns
// subscriptions, retries and rendering, the same rule becomes something you hope holds.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS DELIBERATELY CANNOT EXPRESS
//
// The guarantees are structural — absences, not validations, because a rule enforced by
// "we check for it" degrades the moment someone adds a code path that forgets to check:
//
//   No offset, no page number. Cursor only. Offset paging bills for every skipped
//   document and invites "jump to page 40" on a 250k collection.
//
//   No unbounded read. Every descriptor carries a limit, always, with no argument that
//   removes it. There is no "fetch all" to reach for at 4pm on a Friday.
//
//   No filter the definition did not declare. A caller cannot smuggle in a field the
//   entity never marked filterable, so a runtime request can never promise something
//   the composite indexes cannot serve.
//
//   No authorization. Capability ids are carried through for a resolver to answer; §6
//   means nothing here decides. There is no code path that returns "allowed".
// ─────────────────────────────────────────────────────────────────────────────

import { findField } from "./entityDefinition.js";
import { MAX_PAGE_SIZE, findParentRelationship } from "./listViewDefinition.js";

/** Why a request was rejected. Distinct kinds so a caller can respond differently. */
export const REQUEST_ERROR = Object.freeze([
  "UNKNOWN_FILTER_FIELD",
  "UNDECLARED_FILTER",
  "UNSUPPORTED_OPERATOR",
  "UNKNOWN_SORT_FIELD",
  "PAGE_SIZE_EXCEEDED",
  "MISSING_PARENT_SCOPE",
]);

const err = (kind, message) => Object.freeze({ kind, message });

/**
 * Build a bounded query descriptor.
 *
 * @param {object} def     ListViewDefinition
 * @param {object} entity  EntityDefinition it lists
 * @param {object} request { filters, sort, pageSize, cursor, parentId }
 * @returns {{descriptor: object|null, errors: object[]}}
 */
export function buildQueryDescriptor(def, entity, request = {}) {
  const errors = [];
  if (!def || !entity) {
    return { descriptor: null, errors: [err("UNKNOWN_FILTER_FIELD", "a definition and its entity are required")] };
  }

  // --- filters: only what the definition declared, only operators it allows ---
  const declared = new Map((def.filters ?? []).map((f) => [f.fieldId, f]));
  const filters = [];
  for (const req of request.filters ?? []) {
    const field = findField(entity, req?.fieldId);
    if (!field) {
      errors.push(err("UNKNOWN_FILTER_FIELD", `"${req?.fieldId}" is not a field on ${entity.id}`));
      continue;
    }
    const allowed = declared.get(req.fieldId);
    if (!allowed) {
      // Not merely unsupported — it was never offered. A caller filtering by something the
      // list does not declare is asking for a query whose index nobody proved exists.
      errors.push(err("UNDECLARED_FILTER", `list ${def.id} does not declare a filter on "${req.fieldId}"`));
      continue;
    }
    if (!allowed.operators.includes(req.operator)) {
      errors.push(
        err("UNSUPPORTED_OPERATOR", `filter "${req.fieldId}" allows ${allowed.operators.join("/")}, not "${req.operator}"`)
      );
      continue;
    }
    filters.push(Object.freeze({ fieldId: req.fieldId, operator: req.operator, value: req.value }));
  }

  // --- parent scope: a RELATED list is meaningless unscoped ---
  if (def.surface === "RELATED") {
    if (!request.parentId) {
      errors.push(err("MISSING_PARENT_SCOPE", `list ${def.id} is a RELATED surface and requires a parentId`));
    } else {
      const rel = findParentRelationship(def, entity, request.relationships ?? []);
      if (!rel) {
        errors.push(err("MISSING_PARENT_SCOPE", `relationship "${def.parentRelationshipId}" is not on ${entity.id}`));
      } else {
        // The scope filter is prepended, not appended, and is not optional. Without it the
        // section renders every record of the target entity.
        filters.unshift(Object.freeze({ fieldId: rel.viaField, operator: "EQUALS", value: request.parentId }));
      }
    }
  }

  // --- sort: always total, always ending in the tiebreaker ---
  const requested = (request.sort ?? []).length ? request.sort : def.defaultSort ?? [];
  const sort = [];
  for (const sreq of requested) {
    const field = findField(entity, sreq?.fieldId);
    if (!field) { errors.push(err("UNKNOWN_SORT_FIELD", `"${sreq?.fieldId}" is not a field on ${entity.id}`)); continue; }
    if (!field.sortable) { errors.push(err("UNKNOWN_SORT_FIELD", `field "${sreq.fieldId}" is not sortable`)); continue; }
    sort.push(Object.freeze({ fieldId: sreq.fieldId, direction: sreq.direction === "DESC" ? "DESC" : "ASC" }));
  }
  // The tiebreaker is appended HERE rather than trusted from the request, so no caller can
  // produce a non-total order — which is what makes cursor paging drop and duplicate rows.
  //
  // ITS DIRECTION FOLLOWS THE CLAUSE BEFORE IT, and that is not cosmetic. Firestore serves
  // "orderBy(field), orderBy(__name__)" from the implicit single-field index ONLY when both
  // point the same way. Mixing them — updatedAt DESC then __name__ ASC — is a composite
  // query that requires an explicitly declared index, and without one Firestore rejects it
  // with failed-precondition.
  //
  // Hardcoding ASC therefore broke every list whose sort ends DESC. The Customers page is
  // the one that was noticed: its defaultSort is updatedAt DESC, so the runtime issued
  // updatedAt DESC + __name__ ASC, Firestore refused the query, and useMetadataList mapped
  // the non-permission error to "unavailable" — the page rendered "Customers could not be
  // loaded. Try again." while the summary counts above it, which come from a callable and
  // never touch this path, cheerfully reported 2 accounts. Nothing was denied and no data
  // was missing; the query was simply unservable. Retrying it could never have worked.
  //
  // Matching the direction is the fix rather than declaring a composite index per list,
  // because the tiebreaker exists ONLY to make the order total for cursor paging. Which way
  // it points is arbitrary; that it agrees with its neighbour is what keeps the query on the
  // index Firestore already maintains for free.
  if (!sort.some((s) => s.fieldId === def.tiebreaker)) {
    const preceding = sort[sort.length - 1];
    sort.push(Object.freeze({ fieldId: def.tiebreaker, direction: preceding?.direction === "DESC" ? "DESC" : "ASC" }));
  }

  // --- bound: clamped, never absent ---
  const requestedSize = Number.isInteger(request.pageSize) ? request.pageSize : def.pageSize;
  if (Number.isInteger(request.pageSize) && request.pageSize > MAX_PAGE_SIZE) {
    errors.push(err("PAGE_SIZE_EXCEEDED", `requested pageSize ${request.pageSize} exceeds MAX_PAGE_SIZE ${MAX_PAGE_SIZE}`));
  }
  const pageSize = Math.min(Math.max(1, requestedSize || def.pageSize), MAX_PAGE_SIZE);

  if (errors.length) return { descriptor: null, errors: Object.freeze(errors) };

  return {
    descriptor: Object.freeze({
      entityId: entity.id,
      listId: def.id,
      collection: entity.collection ?? null,
      readVia: entity.readVia,
      readCallable: entity.readCallable ?? null,
      filters: Object.freeze(filters),
      sort: Object.freeze(sort),
      // limit+1: the extra row is how truncation is DETECTED rather than assumed. Reusing
      // the convention the trusted callables already use, so client and server pages
      // disclose "there is more" the same way.
      limit: pageSize + 1,
      pageSize,
      cursor: request.cursor ?? null,
      // Declared, never decided (§6). Handed to the real resolver by the caller.
      requiredCapabilities: Object.freeze(
        [entity.readCapability, def.capabilityRequirement].filter(Boolean)
      ),
    }),
    errors: Object.freeze([]),
  };
}

/**
 * Interpret a fetched page.
 *
 * Separate from building the query because truncation honesty is a property of the
 * RESULT, and pairing it with the +1 in one place is what keeps the extra row from
 * leaking into the rendered rows — the bug that would silently show one row too many on
 * every page.
 */
export function interpretPage(descriptor, docs = []) {
  const hasMore = docs.length > descriptor.pageSize;
  const rows = hasMore ? docs.slice(0, descriptor.pageSize) : docs;
  return Object.freeze({
    rows: Object.freeze(rows),
    hasMore,
    // The cursor is the LAST RETURNED row, never the extra probe row. Using the probe
    // would skip a record on the next page — invisible, and permanent.
    nextCursor: hasMore && rows.length ? rows[rows.length - 1] : null,
  });
}

// ============================ URL STATE LIVES IN metadata/listUrlState.js ============================
//
// This module used to carry `toUrlParams`/`fromUrlParams`, a descriptor-shaped URL pair. They were
// tested and NEVER mounted on a screen -- the same shape as `descriptorErrors`, which useMetadataList
// returned and nothing rendered: the capability existed and no surface used it.
//
// The object-list metadata convergence (ADR-013) replaced them with `metadata/listUrlState.js`, which
// works at the CRITERIA level rather than the descriptor level and does the thing the retired pair
// could not: it REPORTS what it dropped. A URL asking for a field this build no longer offers used to
// parse to a request that buildQueryDescriptor then rejected, leaving the list unfiltered and silent
// -- and a person following that link reads the whole collection as the filtered subset.
//
// Two URL layers is the duplication this convergence exists to remove, so the unused one went.
