// The read-source REGISTRY -- which callables exist, what shape they answer in, and whether each
// requires a scope. Pure lookup tables and the four definition-time helpers over them.
//
// ════════════════════ WHY THIS IS A SEPARATE FILE ════════════════════
//
// `listViewDefinition.js` validates every list view against this registry AT DEFINITION TIME --
// that a declared readCallable exists, that a sortable column has a registered sort token, that a
// RELATED list does not name an unscoped callable. Definitions are pure metadata, and this
// project's plain-`node` test runner imports them directly.
//
// They used to reach these helpers through `callableListSource.js`, which also holds the TRANSPORT
// -- and the transport imports the Firebase SDK, whose module initialises from a build-time
// define. So importing one metadata definition under plain node pulled in the whole client SDK and
// failed before a single assertion ran. Same split, and the same reason, as
// `auth/employeeSessionResult.js`: the pure half is separated so it can be tested without dragging
// in app initialisation as a module-level side effect.
//
// The registry stays the SINGLE source of truth for what a callable is named and how it behaves --
// `callableListSource.js` imports from here rather than keeping a second copy that could drift.
import { GOVERNED_READS } from "../access/governedReadRegistry.ts";

// ══════════════════════ THE SCOPED WORK-ORDER SEAM ══════════════════════
//
// One callable name, standing for a read whose authority is not global. It is NOT in
// CALLABLE_SOURCES and NOT in GOVERNED_SOURCES because it is neither: it takes a registered MODE
// plus that mode's declared parameters, and the server adds an assignment predicate the caller
// neither supplies nor can see.
export const SCOPED_WORK_ORDER_CALLABLE = "readScopedWorkOrders";
// "always scoped" assumption because the read services' response shapes AND parameter
// lists are not uniform (each returns its own entity-named list plus its own
// `skipped`/`truncated` bookkeeping — see AccountOpportunityListResult /
// AccountSalesOrderListResult in the read services — and only the account-scoped pair
// requires a scope argument at all). Adding a CALLABLE-read entity, or a new INDEX-capable
// callable for one that already exists, means adding one line here naming the response key
// and scope requirement that read service actually has — not inventing either.
export const CALLABLE_SOURCES = Object.freeze({
  // RELATED (account-scoped) reads. functions/src/opportunity/opportunityReadService.ts
  // readOpportunitiesForAccount / functions/src/salesOrder/salesOrderReadService.ts
  // readSalesOrdersForAccount. Both REQUIRE the scope argument the descriptor's own
  // parent-scope filter supplies (`accountId`) — there is no unscoped way to call either.
  listOpportunitiesForAccount: { listKey: "opportunities", scoped: true },
  listSalesOrdersForAccount: { listKey: "salesOrders", scoped: true },
  // INDEX-capable (unscoped). functions/src/opportunity/opportunityReadService.ts
  // listOpportunityContext — the one governed Opportunity read that genuinely takes no
  // parent-scope argument (returns the caller's WHOLE authorized scope, capped, with its
  // own `truncated` flag). Its response envelope shape is the SAME as the account-scoped
  // read's ({status, opportunities, skipped, truncated}), so no new unwrap rule is
  // needed — only the scope requirement differs.
  //
  // Listed here so a descriptor CAN be served honestly through this path the moment an
  // entity/list definition declares this callable. opportunity.js's ENTITY-level
  // `readCallable` is still the account-scoped "listOpportunitiesForAccount" (an entity
  // declares exactly one, and that is what the RELATED section under an Account needs) —
  // but opportunity.index (definitions/opportunity.js) now declares its OWN `readCallable`
  // of "listOpportunityContext" as a LIST-VIEW-level override (X-ENTITY-SINGLE-READCALLABLE,
  // listViewDefinition.js's `readCallable`), which both useMetadataList.js and
  // MetadataRecordPage.jsx's `selectListSource` resolve ahead of the entity's own value.
  listOpportunityContext: { listKey: "opportunities", scoped: false },
  // functions/src/salesOrder/salesOrderReadService.ts listSalesOrderIndex -- the unscoped
  // Sales Order read built for the INDEX surface. Deliberately a SECOND callable rather than
  // a widened listSalesOrdersForAccount: the account-scoped related list and the unscoped
  // index are different reads with different authority shapes, and reusing one for the other
  // was explicitly ruled out.
  listSalesOrderIndex: { listKey: "salesOrders", scoped: false },
  // functions/src/partMaster/manufacturerReadService.ts getManufacturerCatalog -- reads the
  // WHOLE manufacturers collection unbounded/unfiltered (`.get()`, no accountId or any other
  // scope argument), so `scoped: false` is not a guess but a direct read of the query it
  // actually runs. Response envelope is { status, manufacturers, excludedCount } (verified in
  // manufacturerReadService.ts), hence `listKey: "manufacturers"`. NOTE: unlike the account-
  // scoped pair above, this callable has no `truncated` flag and no `limit` parameter it
  // honors — it always returns the entire collection in one page. fetchPage's generic
  // truncation-sentinel logic (`data?.truncated`) will simply never fire for this callable,
  // which is correct here (there is nothing to truncate) but is a real difference from the
  // other entries in this table, recorded rather than left to be discovered later.
  getManufacturerCatalog: { listKey: "manufacturers", scoped: false },
  // functions/src/finance/financeReadCallables.ts listAccountInvoiceAr -- account-scoped,
  // REQUIRES accountId (`.where("accountId", "==", accountId)`, HttpsError("invalid-argument")
  // if missing), so `scoped: true` is a direct read of that requirement, not a guess.
  // `listKey: "invoices"` matches the real response envelope { status, invoices, summary }
  // (readAccountInvoiceAr). NOTE: that envelope uses `status: "ready" | "unavailable"`, NOT
  // the `truncated: boolean` shape the account-scoped opportunity/salesOrder pair above use —
  // an "unavailable" (the account's rows exceed the requested limit) response carries an EMPTY
  // `invoices` array, which fetchPage's generic unwrap would silently read as "zero rows"
  // rather than "read failed / truncated". This callable is currently registered for
  // correctness (invoice.js's readCallable, and any future RELATED list under account.js, need
  // a truthful CALLABLE_SOURCES entry to validate against) but has NO CALLABLE-served list view
  // consuming it today — invoice.index was removed for being INDEX-surface over a
  // scoped-only callable (X-ENTITY-SINGLE-READCALLABLE would reject any INDEX list that
  // inherited it, since an INDEX list never supplies the parent scope this callable requires).
  // Whoever adds the eventual account.js RELATED list should also close the status/truncated
  // envelope gap noted here before relying on truncation detection.
  listAccountInvoiceAr: { listKey: "invoices", scoped: true },
});

// ══════════════════════ THE GOVERNED READ SOURCES ══════════════════════
//
// Every id in the governed read registry is ALSO a usable `readCallable` name. One deployed
// callable (`readGovernedList`) serves all of them, so an entity names the SOURCE, not the
// function: `readCallable: "metadataAccounts"`. That keeps the whole existing dispatch --
// entityDefinition's readVia check, listViewDefinition's validation, buildQueryDescriptor,
// useMetadataList's selectListSource -- working unchanged, instead of teaching four modules a
// second vocabulary for "which read backs this list".
//
// GENERATED FROM THE REGISTRY, never hand-listed. The registry is the canonical file
// (functions/src/access/governedReadRegistry.ts) mirrored here by scripts/syncAccessContracts.mjs
// with CI drift enforcement, so a source added or removed on the server appears or disappears here
// with no second table to forget to update.
//
// `scoped: "OPTIONAL"`, and that third value is the point. The pre-existing entries are each
// either always-scoped or never-scoped because each is a purpose-built callable with a fixed
// parameter list. A governed source is not: `accountContacts` backs the RELATED contacts section
// under an Account (scope filter present) and `metadataContacts` backs the Contacts INDEX (no
// scope), through the same mechanism, with the SERVER deciding in both cases whether the named
// filter it was handed is one this source offers. Forcing it into the true/false pair would
// falsely reject one surface or the other.
export const GOVERNED_LIST_KEY = "rows";
export const GOVERNED_CALLABLE = "readGovernedList";

export const GOVERNED_SOURCES = Object.freeze(
  Object.fromEntries(
    Object.keys(GOVERNED_READS).map((sourceId) => [
      sourceId,
      Object.freeze({ governed: true, sourceId, listKey: GOVERNED_LIST_KEY, scoped: "OPTIONAL" }),
    ])
  )
);

// A registry source id that collided with a purpose-built callable's name would make
// `readCallable: "<name>"` mean two different reads depending on which table won the lookup --
// exactly the "two routers reading the same field and disagreeing" defect this module's own
// comments name as the program's most-repeated. Checked at MODULE LOAD, so the collision is
// impossible to ship rather than merely unlikely: any import of this file fails immediately.
for (const sourceId of Object.keys(GOVERNED_SOURCES)) {
  if (Object.prototype.hasOwnProperty.call(CALLABLE_SOURCES, sourceId)) {
    throw new Error(
      `callableListSource: governed read source "${sourceId}" collides with a purpose-built callable of the same name`
    );
  }
}

/**
 * The sort TOKEN for a field and direction.
 *
 * The server owns the mapping from token to Firestore field (governedReadRegistry's
 * `allowedSorts`); this only produces the token the caller asks by. The browser therefore never
 * sends a field name to order by -- it sends `"updatedAtDesc"`, and the server decides that means
 * `orderBy("updatedAt", "desc")`, or refuses. A client that invented a token gets an
 * invalid-argument, not a query.
 *
 * Exported so `listViewDefinition.js` can check every sortable field a list offers against the
 * source's registered sorts at DEFINITION time, rather than discovering an unregistered sort when
 * a user clicks that column header.
 */
export function governedSortKey(fieldId, direction) {
  return `${fieldId}${direction === "DESC" ? "Desc" : "Asc"}`;
}

/**
 * The filter NAME for a field and operator.
 *
 * Same division as the sort token: the client supplies a name plus a VALUE, and the server
 * resolves the name to a field and an operator it declared. `status` and `statusIn` are two
 * different named filters over one field precisely because the operator is the server's to choose
 * -- the client cannot ask for `!=` on a filter registered as `==`.
 *
 * Exported for definition-time validation, for the same reason as `governedSortKey`.
 */
export function governedFilterName(fieldId, operator) {
  return operator === "IN" ? `${fieldId}In` : fieldId;
}

/** The registry entry for a source id, or null. */
export function governedSourceSpec(sourceId) {
  return Object.prototype.hasOwnProperty.call(GOVERNED_READS, sourceId) ? GOVERNED_READS[sourceId] : null;
}

/**
 * Whether `name` is a callable this module knows how to unwrap.
 *
 * Exported so `listViewDefinition.js` can validate a list view's declared `readCallable`
 * AT DEFINITION TIME rather than letting an unrecognized name reach `fetchPage` and throw
 * only when a user happens to open that list — the exact "checked nothing until runtime"
 * defect X-UNCONSUMED-DECLARATION-PATTERN names. This module stays the single source of
 * truth for what a callable is named and how it behaves; the validator asks it rather than
 * keeping a second list that could drift.
 */
export function isKnownReadCallable(name) {
  if (name === SCOPED_WORK_ORDER_CALLABLE) return true;
  return (
    typeof name === "string" &&
    (Object.prototype.hasOwnProperty.call(CALLABLE_SOURCES, name) ||
      Object.prototype.hasOwnProperty.call(GOVERNED_SOURCES, name))
  );
}

/**
 * The scope/response-shape record for a known callable, or null. Exported for the same
 * reason as `isKnownReadCallable` — `listViewDefinition.js` needs to know whether a
 * callable a list view declares is `scoped` (requires a parent) so it can reject a RELATED
 * list naming an unscoped callable, or an INDEX list naming a scoped one, before either
 * ever reaches a live request.
 */
export function readCallableSourceInfo(name) {
  // The scoped work-order seam serves an INDEX list and adds its own scope; like a governed source
  // it is neither always-scoped nor never-scoped from the list runtime is point of view.
  if (name === SCOPED_WORK_ORDER_CALLABLE) return { scopedWorkOrder: true, listKey: "items", scoped: "OPTIONAL" };
  if (!isKnownReadCallable(name)) return null;
  return CALLABLE_SOURCES[name] ?? GOVERNED_SOURCES[name];
}

