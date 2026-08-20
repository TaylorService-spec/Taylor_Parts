// EOS Metadata — ListViewDefinition (Entity List Metadata v1).
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md,
// docs/specifications/metadata-architecture.md §6, DECISIONS #102.
//
// Declares HOW A COLLECTION IS SHAPED AND DISPLAYED, and nothing else. It is a
// separate layer from EntityDefinition (what exists) and from the future
// PageDefinition (how a record is composed) — boundary §7 names collapsing those
// into one page schema as the failure mode.
//
// A definition is DATA. It never queries, never renders, never authorizes. A
// runtime consumes it; validators check it; nothing here executes.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE PROPERTIES THIS EXISTS TO ENFORCE
//
// 1. A DECLARED FILTER IS A PROMISE THE BACKEND MUST KEEP (§9, Owner ruling on
//    index governance). Every filter+sort combination a definition permits needs a
//    Firestore composite index. Metadata that offers a filter the query layer
//    cannot serve is metadata that lies, and it fails at runtime for the user
//    rather than at build time for us. `requiredIndexes()` derives exactly what a
//    definition demands so CI can compare it against firestore.indexes.json.
//
// 2. SORT ORDER MUST BE TOTAL. Firestore pages by cursor; if the sort key ties,
//    rows duplicate or vanish across page boundaries. Every definition therefore
//    carries a tiebreaker, and the validator rejects one that does not. This is
//    the single most common way a paginated list silently corrupts itself, and
//    useInstalledEquipmentPage.js already avoids it by ordering on documentId().
//
// 3. NO CLIENT-SIDE DATASET OWNERSHIP (§9). A definition cannot express "read the
//    collection and filter locally". Page size is bounded, pagination is cursor-
//    based, and there is deliberately no offset/page-number concept: offset paging
//    bills for every skipped document and invites "jump to page 40" on a 250k-row
//    collection.
// ─────────────────────────────────────────────────────────────────────────────

import { FIELD_OPERATOR, findField } from "./entityDefinition.js";
import { isKnownReadCallable, readCallableSourceInfo } from "./callableListSource.js";

/** Sort direction. */
export const SORT_DIRECTION = Object.freeze(["ASC", "DESC"]);

/**
 * How a list surface presents itself. The SAME definition serves both — a related
 * section is a lighter configuration of one runtime, not a second implementation.
 *
 *   INDEX    full surface: paging controls, filter bar, saved views
 *   RELATED  embedded in a record: few columns, capped rows, no paging controls,
 *            a "view all" that hands off to the INDEX pre-filtered by parent
 */
export const LIST_SURFACE = Object.freeze(["INDEX", "RELATED"]);

/** Page-size ceiling. Not a preference — the §9 rule expressed as a number. */
export const MAX_PAGE_SIZE = 200;
export const MAX_RELATED_ROWS = 25;

/**
 * A column: a field reference plus how it is displayed.
 *
 * X-LIST-COLUMN-RENDERER-UNCONSUMED: this used to also carry a `renderer` (a
 * REGISTERED component id). `resolveColumns()` (listPresentation.js) resolved it
 * against `componentRegistry` on every call, and `MetadataListGrid.jsx` never read
 * the resolved value back out — a declared renderer was quietly ignored, with no
 * signal to the surface author or the reader. This was the ninth instance of this
 * program's defining defect (metadata declaring something nothing consumes), and the
 * one instance recorded as SILENT rather than merely dead.
 *
 * Removed rather than wired up, on the evidence gathered before deciding: no
 * definition under src/metadata/definitions/ has ever declared a column `renderer`;
 * `componentRegistry` has a CELL_RENDERER kind but nothing in application source has
 * ever registered one; and the one real surface that could have used it — Warehouses'
 * status pill (src/modules/inventory/Warehouses.jsx, S-INV-WAREHOUSES) — could not
 * reproduce its colour coding through this path and shipped without it, because the
 * path did nothing. Building a consumption path for a capability with zero
 * declarations, zero registrations, and one real need that was purely decorative
 * (the pill always carried its own text label; colour was never the only signal)
 * would be speculative complexity, not a fix for a live gap.
 *
 * WHAT THIS GIVES UP: a column can no longer name a custom cell component through
 * the metadata contract. A surface that genuinely needs one (a colour-coded status,
 * an icon, a formatted composite) renders its list through `buildListPresentation` /
 * `MetadataListGrid` as today and post-processes `presentation.rows[].cells` itself —
 * exactly the pattern Warehouses.jsx already uses for its client-side status summary
 * — or, if a real cross-surface need for a shared cell component ever appears, adds a
 * NEW, immediately-consumed mechanism at that point rather than reviving an
 * already-proven-dead one.
 */
export function makeColumn(input = {}) {
  return Object.freeze({
    fieldId: input.fieldId,
    label: input.label ?? null, // null = inherit the FieldDefinition's label
    sortable: input.sortable ?? false,
    width: input.width ?? null,
  });
}

/**
 * Text-query operators (X-QUERY-MODEL-NO-FREE-TEXT).
 *
 * FIELD_OPERATOR (entityDefinition.js) has no free-text member, and that is
 * deliberate — it is a claim about a STRUCTURED backend predicate (equality, range,
 * membership, array containment), and "search this string" is a different kind of
 * claim with a different execution story per operator. This vocabulary exists
 * SEPARATELY from FIELD_OPERATOR so a field's own `operators` (checked against
 * FIELD_OPERATOR by entityDefinition.js's own validator) never has to widen to
 * include it — a list-level filter opts into a text operator explicitly, the field
 * does not have to declare it, and nothing here touches entityDefinition.js.
 *
 *   TEXT_EXACT     — exact string match. Behaves as an equality predicate; kept as
 *                    a distinct semantic (not aliased to EQUALS) because a surface
 *                    that asks for it is asking for TEXT search UX (a search box),
 *                    not a structured equality filter, even though today's only
 *                    backend serves both identically.
 *   TEXT_PREFIX    — "starts with". A range scan on the field's natural ordering.
 *   TEXT_CONTAINS  — substring anywhere in the field. NOT a range or equality
 *                    predicate — no ordered scan produces it.
 *   TEXT_SEARCH    — multi-term / relevance-ranked search. NOT a Firestore
 *                    predicate at all; this is what a real search backend is for.
 *
 * Substring and prefix are different product semantics, not a quality gradient
 * (Owner ruling, this lane). TEXT_CONTAINS must never be served by silently running
 * TEXT_PREFIX instead — see `TEXT_BACKEND_CAPABILITY` and the validation below.
 */
export const TEXT_QUERY_OPERATOR = Object.freeze(["TEXT_EXACT", "TEXT_PREFIX", "TEXT_CONTAINS", "TEXT_SEARCH"]);

/**
 * Text-search backends a filter may name. Today there is exactly one, because that
 * is the only backend that exists — see `TEXT_BACKEND_CAPABILITY`'s doc comment and
 * docs/orchestration/metadata-program/text-search-backend-seam.md for the seam a
 * future provider (e.g. a hosted search index) must satisfy before it is added
 * here. Adding a name to this array is what "the backend exists" means; nothing
 * else in this module may be edited to make a provider real.
 */
export const TEXT_QUERY_BACKEND = Object.freeze(["FIRESTORE_NATIVE"]);

/**
 * What each named backend can execute HONESTLY, at enterprise scale, today.
 *
 * THE POINT OF THIS LANE: declaring an operator in TEXT_QUERY_OPERATOR does not
 * make it executable. A filter naming a text operator its named backend cannot
 * serve is rejected at validation (`validateListViewDefinition` below) — loudly,
 * at definition time — never silently downgraded to a semantic the backend can
 * serve and never left to fail at paint time in front of a user.
 *
 * FIRESTORE_NATIVE can serve TEXT_EXACT (a plain equality query) and TEXT_PREFIX
 * (a range query: `field >= value AND field < value + ''`). It cannot serve
 * TEXT_CONTAINS or TEXT_SEARCH — Firestore has no substring or relevance-search
 * predicate, only prefix ranges over an ordered index, and pretending otherwise is
 * exactly the "browser downloads the whole collection and filters client-side"
 * failure mode §9 exists to forbid (X-QUERY-MODEL-NO-FREE-TEXT).
 */
export const TEXT_BACKEND_CAPABILITY = Object.freeze({
  FIRESTORE_NATIVE: Object.freeze(["TEXT_EXACT", "TEXT_PREFIX"]),
});

/** True if `backend` can honestly execute text `operator` today. Used by the validator; exported so a caller can ask the same question before authoring a filter. */
export function supportsTextOperator(backend, operator) {
  return (TEXT_BACKEND_CAPABILITY[backend] ?? []).includes(operator);
}

/**
 * A declared, indexed filter. `operators` must be a subset of the field's own —
 * UNLESS an operator is a TEXT_QUERY_OPERATOR, which a field never declares (see
 * that vocabulary's doc comment). A filter that declares a text operator MUST also
 * declare `textBackend`: naming the backend is how a surface "explicitly supports
 * the requested semantic" (Owner ruling) instead of merely wishing for it. `null`
 * (the default) means "no text operator here" — the additive case every existing
 * filter falls into, unchanged from before this field existed.
 */
export function makeFilter(input = {}) {
  return Object.freeze({
    fieldId: input.fieldId,
    operators: Object.freeze([...(input.operators ?? [])]),
    required: input.required ?? false,
    textBackend: input.textBackend ?? null,
  });
}

/** One sort clause. */
export function makeSort(input = {}) {
  return Object.freeze({ fieldId: input.fieldId, direction: input.direction ?? "ASC" });
}

/**
 * A named saved view. `RECENTLY_VIEWED` is the landing view for INDEX surfaces:
 * at enterprise volume an unfiltered first page of 250,000 records answers nobody's
 * question, so the default state of a list is not "everything".
 */
export function makeSavedView(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    kind: input.kind ?? "STATIC", // STATIC | RECENTLY_VIEWED | MINE
    filters: Object.freeze([...(input.filters ?? [])]),
    sort: Object.freeze([...(input.sort ?? [])]),
    isDefault: input.isDefault ?? false,
  });
}

export const SAVED_VIEW_KIND = Object.freeze(["STATIC", "RECENTLY_VIEWED", "MINE"]);

export function makeListViewDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    label: input.label,
    surface: input.surface ?? "INDEX",
    columns: Object.freeze([...(input.columns ?? [])]),
    filters: Object.freeze([...(input.filters ?? [])]),
    defaultSort: Object.freeze([...(input.defaultSort ?? [])]),
    // The total-order guarantee. Appended after defaultSort so the composite key can
    // never tie. Defaults to documentId(), the one field every document has.
    tiebreaker: input.tiebreaker ?? "__name__",
    pageSize: input.pageSize ?? 50,
    savedViews: Object.freeze([...(input.savedViews ?? [])]),
    // RELATED only: the relationship whose viaField scopes rows to the parent record.
    parentRelationshipId: input.parentRelationshipId ?? null,
    // RELATED only: where "view all" hands off, pre-filtered by parent.
    viewAllListId: input.viewAllListId ?? null,
    rowNavigationTo: input.rowNavigationTo ?? null, // route template, e.g. /customers/:id
    rowActions: Object.freeze([...(input.rowActions ?? [])]), // REGISTERED action ids
    capabilityRequirement: input.capabilityRequirement ?? null,
    // X-ENTITY-SINGLE-READCALLABLE: which callable THIS list reads through, when it needs
    // one different from the entity's own `readCallable`. An entity can only name one
    // (RELATED and INDEX legitimately need different reads of the same CALLABLE-read
    // entity — an account-scoped one for a related section, an unscoped one for an index),
    // so the override lives on the surface that actually knows which it needs: the list
    // view. `null` (the default) means "defer to the entity's own readCallable" — the
    // additive case every list view that declares nothing falls into, unchanged from
    // before this field existed. Validated against `callableListSource.js`'s own registry
    // by `validateListViewDefinition` below, never trusted un-checked.
    readCallable: input.readCallable ?? null,
  });
}

/**
 * Validate a definition against the entity it lists.
 *
 * The entity is REQUIRED, not optional: a list of columns that reference fields
 * nobody checked exist is precisely the metadata-that-lies problem, and validating a
 * definition in isolation would give false confidence.
 */
/**
 * Find the relationship a RELATED list is scoped by.
 *
 * Looks in the supplied relationship set FIRST (the parent's), then the child's own, so a
 * correctly-declared parent-side edge resolves and nothing that already worked breaks.
 * A match must actually reach this entity — an edge pointing somewhere else is not a
 * parent scope, it is a different relationship with a colliding id.
 */
export function findParentRelationship(def, entity, relationships = []) {
  const candidates = [...relationships, ...(entity?.relationships ?? [])];
  return candidates.find((r) => r.id === def.parentRelationshipId && r.toEntityId === entity?.id) ?? null;
}

export function validateListViewDefinition(def, entity, relationships = []) {
  const problems = [];
  const at = def?.id ? `list ${def.id}` : "list (no id)";

  if (!def?.id || typeof def.id !== "string") problems.push(`${at}: id is required`);
  if (!def?.label) problems.push(`${at}: label is required`);
  if (def?.id && def.id === def.label) problems.push(`${at}: id and label must be distinct concepts`);
  if (!LIST_SURFACE.includes(def?.surface)) problems.push(`${at}: surface "${def?.surface}" is not a known LIST_SURFACE`);

  if (!entity?.id) {
    problems.push(`${at}: an entity is required to validate against — a list cannot be checked in isolation`);
    return problems;
  }
  if (def.entityId !== entity.id) problems.push(`${at}: entityId "${def.entityId}" does not match entity "${entity.id}"`);

  // X-ENTITY-SINGLE-READCALLABLE — the readCallable this list will ACTUALLY run at runtime,
  // checked HERE rather than left to fail wherever a caller happens to open the list
  // (X-UNCONSUMED-DECLARATION-PATTERN: this program's most-repeated defect is a
  // declaration nothing checks).
  //
  // That callable is not always `def.readCallable`. listRuntime.js falls back to the
  // entity's own `readCallable` whenever a list view declares none (`entity.readCallable ??
  // null`) — so a list with NO override still makes a live call through whatever the entity
  // names, and that inherited name is exactly as capable of lying as an explicit override.
  // Validating only `if (def.readCallable)` checked nothing for every list that inherits,
  // which is most of them: it looked like coverage but only ever exercised the override
  // path, so a bad inherited name (unregistered, or scope-incompatible with THIS list's
  // surface) sailed through definition-time validation and threw on the first user to open
  // the list — the exact failure this validator exists to catch.
  //
  // `isOverride` only changes the wording below (an override names its own list view; an
  // inherited name names the entity), never which checks run — both paths are the same live
  // call and must pass the same gate.
  const effectiveReadCallable = def.readCallable ?? entity.readCallable ?? null;
  const isOverride = Boolean(def.readCallable);
  if (effectiveReadCallable) {
    const source = isOverride
      ? `readCallable "${effectiveReadCallable}" is declared`
      : `readCallable "${effectiveReadCallable}" is inherited from entity "${entity.id}"`;
    // Three ways this can lie:
    //   1. naming a callable callableListSource.js has never heard of — a typo or a
    //      not-yet-registered callable, never a live read to attempt;
    //   2. naming one on a CLIENT_DIRECT entity — that entity reads Firestore directly and
    //      has no business routing through a callable at all. In practice this is only ever
    //      reachable via an explicit override (a well-formed CLIENT_DIRECT entity has no
    //      readCallable of its own to inherit), but nothing in entityDefinition.js actually
    //      enforces that the two stay mutually exclusive, so this checks `entity.readVia`
    //      unconditionally rather than trusting that shape;
    //   3. naming one whose SCOPE does not match the surface — a RELATED list always
    //      supplies a parent-scope filter (buildQueryDescriptor prepends it unconditionally
    //      for `surface === "RELATED"`), so an unscoped callable there would either throw at
    //      runtime (callableListSource's own unscoped-cannot-accept-scope guard) or, worse,
    //      silently read the caller's whole authorized scope instead of the parent's rows;
    //      an INDEX list never supplies a parent scope, so a scoped callable there would
    //      throw on every single request. All three are caught here instead of at the first
    //      user who opens the list — whether the name came from this list view or from the
    //      entity it inherited from.
    if (entity.readVia === "CLIENT_DIRECT") {
      problems.push(
        `${at}: ${source} but entity "${entity.id}" reads CLIENT_DIRECT — ` +
          "a list view's readCallable only makes sense for a CALLABLE-read entity"
      );
    } else if (!isKnownReadCallable(effectiveReadCallable)) {
      problems.push(
        `${at}: ${source} but is not a known callable — see CALLABLE_SOURCES in callableListSource.js`
      );
    } else {
      const info = readCallableSourceInfo(effectiveReadCallable);
      if (def.surface === "RELATED" && !info.scoped) {
        problems.push(
          `${at}: ${source}, is unscoped, but a RELATED list always supplies a parent-scope ` +
            "filter — declare a scoped callable, or leave readCallable undeclared to use the entity's own"
        );
      }
      if (def.surface === "INDEX" && info.scoped) {
        problems.push(
          `${at}: ${source}, requires a parent-scope filter, but an INDEX list never ` +
            "supplies one — declare an unscoped callable" +
            (isOverride ? "" : ` (entity "${entity.id}" has no unscoped one to inherit; declare an override on this list)`)
        );
      }
    }
  }

  // Columns
  if (!def.columns?.length) problems.push(`${at}: at least one column is required`);
  const seenCols = new Set();
  for (const col of def.columns ?? []) {
    if (!col?.fieldId) { problems.push(`${at}: a column is missing fieldId`); continue; }
    if (seenCols.has(col.fieldId)) problems.push(`${at}: duplicate column "${col.fieldId}"`);
    seenCols.add(col.fieldId);
    const field = findField(entity, col.fieldId);
    if (!field) { problems.push(`${at}: column "${col.fieldId}" is not a field on ${entity.id}`); continue; }
    if (col.sortable && !field.sortable) {
      problems.push(`${at}: column "${col.fieldId}" is sortable but the field is not — sorting needs an indexed field`);
    }
    // X-LIST-COLUMN-RENDERER-UNCONSUMED: `renderer` is not part of the contract —
    // `makeColumn` no longer accepts one, and nothing downstream (`resolveColumns`,
    // `MetadataListGrid`) reads one. A definition that still declares one (built by
    // hand rather than through `makeColumn`, or carried over from before this change)
    // must fail HERE, loudly, rather than be silently ignored the way it was before —
    // that silent-ignore was the defect this closes. See `makeColumn`'s doc comment
    // for the evidence this removal was decided on and what a caller needing a custom
    // cell renders instead.
    if (col.renderer !== undefined) {
      problems.push(
        `${at}: column "${col.fieldId}" declares "renderer", which is not part of the contract — no runtime ` +
          "consumes it (X-LIST-COLUMN-RENDERER-UNCONSUMED). Render the list normally and post-process " +
          "presentation.rows[].cells for custom cell display instead."
      );
    }
  }

  // Filters — the promise-keeping check.
  for (const f of def.filters ?? []) {
    const field = findField(entity, f?.fieldId);
    if (!field) { problems.push(`${at}: filter "${f?.fieldId}" is not a field on ${entity.id}`); continue; }
    if (!field.filterable) {
      problems.push(
        `${at}: filter "${f.fieldId}" targets a field not declared filterable — a list must not offer a filter ` +
          `the query layer cannot serve`
      );
    }
    if (!f.operators?.length) problems.push(`${at}: filter "${f.fieldId}" declares no operators`);
    const hasTextOperator = (f.operators ?? []).some((op) => TEXT_QUERY_OPERATOR.includes(op));
    for (const op of f.operators ?? []) {
      // TEXT_* operators are a SEPARATE vocabulary from FIELD_OPERATOR (see
      // TEXT_QUERY_OPERATOR's doc comment) — a field never declares one in its own
      // `operators`, so the "list may narrow, never widen" check below does not apply
      // to them. What DOES apply, and is the entire point of this lane: a text
      // operator is only valid when the filter names a `textBackend` that can
      // honestly execute it (X-QUERY-MODEL-NO-FREE-TEXT). Unsupported means REJECTED
      // HERE, at validation — never silently downgraded, never left to fail later.
      if (TEXT_QUERY_OPERATOR.includes(op)) {
        if (!f.textBackend) {
          problems.push(
            `${at}: filter "${f.fieldId}" declares text operator "${op}" but no textBackend — declaring a text ` +
              `operator does not make it executable; name the backend that will serve it (see TEXT_QUERY_BACKEND)`
          );
          continue;
        }
        if (!TEXT_QUERY_BACKEND.includes(f.textBackend)) {
          problems.push(`${at}: filter "${f.fieldId}" declares textBackend "${f.textBackend}", which is not a known TEXT_QUERY_BACKEND`);
          continue;
        }
        if (!supportsTextOperator(f.textBackend, op)) {
          const supported = TEXT_BACKEND_CAPABILITY[f.textBackend] ?? [];
          problems.push(
            `${at}: filter "${f.fieldId}" declares text operator "${op}" against backend "${f.textBackend}", which ` +
              `cannot execute it honestly at enterprise scale — ${f.textBackend} supports [${supported.join(", ")}] only. ` +
              `Substring and prefix are different product semantics, not a quality gradient: this is rejected rather ` +
              `than silently served as a narrower search. See docs/orchestration/metadata-program/text-search-backend-seam.md.`
          );
        }
        continue;
      }
      if (!FIELD_OPERATOR.includes(op)) { problems.push(`${at}: filter "${f.fieldId}" operator "${op}" is unknown`); continue; }
      if (!field.operators.includes(op)) {
        problems.push(
          `${at}: filter "${f.fieldId}" offers operator "${op}" which the field does not support — ` +
            `a list may narrow a field's operators, never widen them`
        );
      }
    }
    if (!hasTextOperator && f.textBackend) {
      problems.push(`${at}: filter "${f.fieldId}" declares textBackend "${f.textBackend}" but no text operator — textBackend is meaningless without one`);
    }
  }

  // Sorting and the total-order guarantee.
  for (const s of def.defaultSort ?? []) {
    const field = findField(entity, s?.fieldId);
    if (!field) { problems.push(`${at}: sort "${s?.fieldId}" is not a field on ${entity.id}`); continue; }
    if (!field.sortable) problems.push(`${at}: sort "${s.fieldId}" targets a field not declared sortable`);
    if (!SORT_DIRECTION.includes(s.direction)) problems.push(`${at}: sort "${s.fieldId}" direction "${s.direction}" is unknown`);
  }
  if (!def.tiebreaker) {
    problems.push(
      `${at}: a tiebreaker is required — without a total order, cursor pagination duplicates or drops rows ` +
        `wherever the sort key ties`
    );
  }
  if (def.tiebreaker && def.tiebreaker !== "__name__" && !findField(entity, def.tiebreaker)) {
    problems.push(`${at}: tiebreaker "${def.tiebreaker}" is not a field on ${entity.id}`);
  }
  if ((def.defaultSort ?? []).some((s) => s.fieldId === def.tiebreaker)) {
    problems.push(`${at}: tiebreaker "${def.tiebreaker}" also appears in defaultSort — it cannot break its own tie`);
  }

  if ((def?.filters ?? []).length > MAX_DECLARED_FILTERS) {
    // Exponential in the optional filters: five already means dozens of composites, which
    // nobody reviews and Firestore charges for. A list needing that many filters wants a
    // search index, not a bigger pile of composites.
    problems.push(
      `${at}: declares ${def.filters.length} filters; more than ${MAX_DECLARED_FILTERS} makes the required index set unreviewable`
    );
  }

  // Bounded reads.
  if (!Number.isInteger(def.pageSize) || def.pageSize <= 0) {
    problems.push(`${at}: pageSize must be a positive integer`);
  } else if (def.pageSize > MAX_PAGE_SIZE) {
    problems.push(`${at}: pageSize ${def.pageSize} exceeds MAX_PAGE_SIZE ${MAX_PAGE_SIZE} (boundary §9)`);
  }

  // Surface-specific rules.
  if (def.surface === "RELATED") {
    if (!def.parentRelationshipId) {
      problems.push(
        `${at}: a RELATED list requires parentRelationshipId — without it the section has no parent key and ` +
          `would render every record of the target entity`
      );
    } else if (!findParentRelationship(def, entity, relationships)) {
      // Resolved from the PARENT's declarations, not the child's. An edge is declared on
      // its owning entity — account.contacts lives on Account — while the list it scopes
      // renders the child. Searching only the child made every real related list
      // unvalidatable, which is why the first multi-entity definitions found it.
      problems.push(
        `${at}: parentRelationshipId "${def.parentRelationshipId}" is not a relationship reaching ${entity.id}. ` +
          "Pass the declaring entity's relationships as the third argument."
      );
    }
    if (!def.viewAllListId) {
      problems.push(`${at}: a RELATED list requires viewAllListId — a capped section must be able to hand off to the full list`);
    }
    if (def.pageSize > MAX_RELATED_ROWS) {
      problems.push(`${at}: a RELATED section shows at most ${MAX_RELATED_ROWS} rows; use viewAllListId for the rest`);
    }
    if (def.savedViews?.length) problems.push(`${at}: saved views belong to INDEX surfaces, not embedded sections`);
  }

  if (def.surface === "INDEX") {
    if (def.parentRelationshipId) problems.push(`${at}: parentRelationshipId is meaningful only on a RELATED list`);
    const defaults = (def.savedViews ?? []).filter((v) => v.isDefault);
    if (defaults.length > 1) problems.push(`${at}: more than one saved view is marked default`);
    for (const v of def.savedViews ?? []) {
      if (!SAVED_VIEW_KIND.includes(v?.kind)) problems.push(`${at}: saved view "${v?.id}" kind "${v?.kind}" is unknown`);
    }
  }

  return problems;
}

/**
 * Sort direction in Firestore's own vocabulary.
 *
 * A sort clause says ASC/DESC because that is the metadata vocabulary. A required index
 * is something a human PASTES INTO firestore.indexes.json, where Firestore accepts only
 * ASCENDING/DESCENDING -- so emitting the metadata spelling produced a demand that read
 * correctly, compared unequal against every existing declaration, and would have been
 * rejected by the deploy if anyone had pasted it. Translating at this boundary keeps one
 * vocabulary on each side of it.
 */
export function firestoreOrder(direction) {
  if (direction === "DESC" || direction === "DESCENDING") return "DESCENDING";
  return "ASCENDING";
}

/** More than this many optional filters and the index set stops being reviewable. */
export const MAX_DECLARED_FILTERS = 4;

const RANGE_OPERATORS = ["GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"];
const ARRAY_OPERATORS = ["ARRAY_CONTAINS", "ARRAY_CONTAINS_ANY"];

// Index-derivation impact of the text vocabulary (X-QUERY-MODEL-NO-FREE-TEXT):
//   TEXT_EXACT    behaves as EQUALITY — same composite-index math as EQUALS.
//   TEXT_PREFIX   behaves as RANGE — a prefix scan is a range scan on the field's
//                 own ordering, same composite-index math as GREATER_THAN et al.
//   TEXT_CONTAINS / TEXT_SEARCH classify as EXTERNAL. A definition can only declare
//                 these when `validateListViewDefinition` has already accepted the
//                 filter (i.e. never, today — no backend can serve them, see
//                 TEXT_BACKEND_CAPABILITY), so in practice an EXTERNAL filter never
//                 reaches a VALID definition. Classified anyway, and excluded below,
//                 so that IF a future backend is added to TEXT_QUERY_BACKEND for one
//                 of these, requiredIndexes() does not start demanding a Firestore
//                 composite index for a predicate Firestore was never asked to run —
//                 that backend owns its own indexing, not firestore.indexes.json.
const TEXT_RANGE_OPERATORS = ["TEXT_PREFIX"];
const TEXT_EXTERNAL_OPERATORS = ["TEXT_CONTAINS", "TEXT_SEARCH"];

const classify = (filter) => {
  const ops = filter.operators ?? [];
  if (ops.some((o) => TEXT_EXTERNAL_OPERATORS.includes(o))) return "EXTERNAL";
  if (ops.some((o) => ARRAY_OPERATORS.includes(o))) return "ARRAY";
  if (ops.some((o) => RANGE_OPERATORS.includes(o) || TEXT_RANGE_OPERATORS.includes(o))) return "RANGE";
  return "EQUALITY"; // includes TEXT_EXACT — an exact-match text query is an equality predicate
};

/** Every subset of a list, declaration order preserved. */
function subsets(items) {
  return items.reduce((acc, item) => [...acc, ...acc.map((set) => [...set, item])], [[]]);
}

/**
 * The composite indexes a definition demands.
 *
 * ONE INDEX PER FILTER COMBINATION, NOT ONE PER DEFINITION. This used to emit a single
 * index containing every declared filter plus the sort, which reads as thorough and is
 * wrong: Firestore will not serve a query filtering on a SUBSET from that index. A list
 * declaring status and relationshipTypes, both optional, can be queried four ways —
 * neither, either, both — and three of those need their own index. The old derivation
 * therefore let CI pass while two of the three real queries would fail in front of a
 * user, which is the exact failure the coverage gate exists to prevent.
 *
 * A filter marked `required` is in every query, so it is in every index rather than
 * doubling the set.
 *
 * ARRAY FILTERS USE arrayConfig, NOT order. `array-contains` is not an ascending scan,
 * and an index declaring it as one is rejected by the deploy. Firestore permits at most
 * one array filter per query, so each array filter produces its own family rather than
 * combining with the others.
 *
 * The count is exponential in the number of optional filters, which is why
 * MAX_DECLARED_FILTERS exists: past four, nobody can review the index list, and a
 * definition that needs that many filters wants a search index rather than composites.
 */
export function requiredIndexes(def, entity) {
  if (!def || !entity) return [];
  const collection = entity.collection;
  if (!collection) return []; // CALLABLE-read entities are the server's problem, not an index's

  const filters = def.filters ?? [];
  const equality = filters.filter((f) => classify(f) === "EQUALITY");
  const ranges = filters.filter((f) => classify(f) === "RANGE");
  const arrays = filters.filter((f) => classify(f) === "ARRAY");

  // The tiebreaker direction must MATCH what listRuntime.buildQueryDescriptor actually
  // appends, which is the direction of the clause before it -- not a hardcoded ASC. These
  // two must agree: this function decides which indexes get DECLARED, the runtime decides
  // which query gets ISSUED, and a disagreement between them declares an index no query
  // uses while the real query goes unserved. That is precisely how the Customers page came
  // to fail -- the runtime issued updatedAt DESC + __name__ ASC, which needs a composite
  // index, and the index this generator would have called for did not describe it either.
  const defaultSort = def.defaultSort ?? [];
  const lastSortDirection = defaultSort[defaultSort.length - 1]?.direction === "DESC" ? "DESC" : "ASC";
  const ordered = [
    ...defaultSort.map((s) => ({ fieldPath: s.fieldId, order: firestoreOrder(s.direction) })),
    { fieldPath: def.tiebreaker === "__name__" ? "__name__" : def.tiebreaker, order: firestoreOrder(lastSortDirection) },
  ];

  // Nothing filtered and nothing ordered needs no composite — Firestore's automatic
  // single-field indexes cover it, and reporting one anyway trains people to ignore the
  // output.
  if (filters.length === 0 && (def.defaultSort ?? []).length === 0) return [];

  const alwaysEquality = equality.filter((f) => f.required);
  const optionalEquality = equality.filter((f) => !f.required);
  const alwaysRange = ranges.filter((f) => f.required);
  const optionalRange = ranges.filter((f) => !f.required);

  // An array filter is optional unless declared required; `null` is the no-array case.
  const arrayChoices = arrays.some((f) => f.required) ? arrays : [null, ...arrays];

  const indexes = [];
  const seen = new Set();
  for (const eqSubset of subsets(optionalEquality)) {
    for (const rangeSubset of subsets(optionalRange)) {
      for (const arrayFilter of arrayChoices) {
        const eqFields = [...alwaysEquality, ...eqSubset];
        const rangeFields = [...alwaysRange, ...rangeSubset];
        // The unfiltered query is served by the sort alone; it still needs its index when
        // the sort is composite, and `ordered` always carries the tiebreaker.
        const fields = [
          ...eqFields.map((f) => ({ fieldPath: f.fieldId, order: firestoreOrder("ASC") })),
          // Firestore's own ordering constraint: equality, then the array filter, then
          // inequalities, then the ordered fields.
          ...(arrayFilter ? [{ fieldPath: arrayFilter.fieldId, arrayConfig: "CONTAINS" }] : []),
          ...rangeFields.map((f) => ({ fieldPath: f.fieldId, order: firestoreOrder("ASC") })),
          ...ordered,
        ];
        const candidate = Object.freeze({
          collectionGroup: collection,
          queryScope: "COLLECTION",
          fields: Object.freeze(fields),
          requiredBy: def.id,
        });
        // The unfiltered, single-field-ordered query is served by Firestore's AUTOMATIC
        // single-field index — the documentId tiebreaker is implicit there. Demanding a
        // composite for it would force a redundant declaration and, worse, train people
        // to ignore a gate that reports indexes nobody needs.
        const realSortFields = (def.defaultSort ?? []).length;
        if (eqFields.length === 0 && rangeFields.length === 0 && !arrayFilter && realSortFields <= 1) continue;

        const key = indexKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        indexes.push(candidate);
      }
    }
  }
  return indexes;
}

/** Stable key for comparing a required index against a declared one. */
export function indexKey(index) {
  const fields = (index.fields ?? [])
    .filter((f) => f.fieldPath !== "__name__") // Firestore appends this implicitly
    // Normalized, so a declaration written ASCENDING and a demand written ASC are one
    // index rather than two -- the difference is spelling, not identity.
    .map((f) => `${f.fieldPath}:${f.arrayConfig ?? firestoreOrder(f.order)}`)
    .join(",");
  return `${index.collectionGroup}|${index.queryScope ?? "COLLECTION"}|${fields}`;
}

/**
 * Compare what the metadata demands against what the repository declares.
 * Returns the demands with no declared index — the set CI must fail on.
 */
export function missingIndexes(required, declared) {
  const have = new Set((declared ?? []).map(indexKey));
  return (required ?? []).filter((r) => !have.has(indexKey(r)));
}
