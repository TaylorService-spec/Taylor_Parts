import { interpretPage } from "./listRuntime.js";
import { GOVERNED_READS } from "../access/governedReadRegistry.ts";
import { readScopedWorkOrders } from "../access/scopedWorkOrderClient.js";

// Executes a query descriptor against a trusted READ CALLABLE instead of Firestore. The
// counterpart to firestoreListSource.js's fetchPage, for the entities that declare
// `readVia: "CALLABLE"` (opportunity, salesOrder — functions/src/opportunity/
// opportunityReadService.ts, functions/src/salesOrder/salesOrderReadService.ts). Called
// from both surfaces that honor `readVia`: MetadataRecordPage.jsx's `selectListSource` for
// a RELATED section, and useMetadataList.js's own mirror of that dispatch for an INDEX
// list — this module does not know or care which surface called it; it trusts the
// descriptor buildQueryDescriptor already produced (scoped for RELATED, potentially
// unscoped for INDEX — see CALLABLE_SOURCES' `scoped` flag below).
//
// WHY THIS EXISTS. Those two collections are deny-all in Firestore Rules; a direct client
// `getDocs` against them denies every caller, permanently, even one holding the real
// `opportunity.read` / `salesOrder.read` capability. The entity already DECLARES that fact
// (`readVia: "CALLABLE"`, `readCallable: "listOpportunitiesForAccount"` /
// `"listSalesOrdersForAccount"`); this is the translator that honors it, the same way
// firestoreListSource.js honors `readVia: "CLIENT_DIRECT"`. The runtime decided everything
// already — the parent scope, the sort, the bound (buildQueryDescriptor, listRuntime.js) —
// and this adds nothing of its own except the one thing a callable needs that a Firestore
// query does not: which callable to call and how to unwrap its response envelope.
//
// SAME INVOCATION PATTERN AS THE EXISTING CLIENTS. httpsCallable + a lazy import of
// "firebase/functions" and "../firebase/firebase.js" (no import-time initializeApp side
// effect) is exactly services/accountOpportunitiesReadCallableClient.js's and
// services/accountSalesOrdersReadCallableClient.js's own `invoke`. This is not a second way
// to call the same function — it is the metadata list runtime's caller of that same
// pattern, because those two client modules are request-shaped for the hooks that already
// consume them (useAccountOpportunities.js / useAccountSalesOrders.js), not for a query
// descriptor.
async function invokeCallable(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

// httpsCallable errors carry a `functions/`-prefixed code (e.g. "functions/permission-denied"),
// unlike a Firestore SDK error's bare "permission-denied". Stripped here — mirroring
// services/accountOpportunitiesReadCallableClient.js's own mapErrorToStatus — so a caller
// that already checks `err.code === "permission-denied"` (MetadataRecordPage.jsx's
// useRelatedListPresentation, matching firestoreListSource.js's own errors) sees the SAME
// code shape regardless of which source produced it. Doing this here, once, is what keeps
// that check from having to know two different error dialects.
function normalizeCallableError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  const normalized = new Error(err?.message ?? "callable read failed");
  normalized.code = code;
  return normalized;
}

// Which array the callable's own response envelope carries its rows under, and whether
// that callable takes a parent-scope argument at all. Not a generic "items" key / uniform
// "always scoped" assumption because the read services' response shapes AND parameter
// lists are not uniform (each returns its own entity-named list plus its own
// `skipped`/`truncated` bookkeeping — see AccountOpportunityListResult /
// AccountSalesOrderListResult in the read services — and only the account-scoped pair
// requires a scope argument at all). Adding a CALLABLE-read entity, or a new INDEX-capable
// callable for one that already exists, means adding one line here naming the response key
// and scope requirement that read service actually has — not inventing either.
const CALLABLE_SOURCES = Object.freeze({
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
const GOVERNED_LIST_KEY = "rows";
const GOVERNED_CALLABLE = "readGovernedList";

const GOVERNED_SOURCES = Object.freeze(
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

/**
 * Fetch one page through a descriptor's declared `readCallable`.
 *
 * Returns the SAME shape firestoreListSource.js's fetchPage returns — `{ rows, hasMore,
 * nextCursor, nextCursorDoc }` — so interpretPage's caller and buildListPresentation work
 * unchanged regardless of which source produced the page. `nextCursorDoc` is always null:
 * a callable page has no Firestore document to resume from, and today's only caller
 * (MetadataRecordPage's DefaultRelatedList) never requests a second page of a RELATED
 * section, matching the source's own "caps its rows and hands off instead" rule
 * (listPresentation.js).
 *
 * THROWS LOUDLY, NEVER FALLS THROUGH:
 *   - no `readCallable` on the descriptor, or a `readCallable` this module has no known
 *     source for — a misconfigured entity, not a live read to attempt;
 *   - a SCOPED callable (see CALLABLE_SOURCES) with no parent-scope filter on the
 *     descriptor — e.g. a RELATED descriptor missing its scope, which buildQueryDescriptor
 *     never produces but this function does not trust blindly; an UNSCOPED callable never
 *     hits this check, scoped or not, because it has no scope argument to be missing;
 *   - the callable itself rejects — surfaced with a normalized `.code` so DENIED stays
 *     distinct from UNAVAILABLE exactly like a Firestore read failure does.
 * A caller choosing to fall back to a direct Firestore read on any of these is the exact
 * defect this module exists to close, so none of them degrade — they throw.
 */
/**
 * Fetch one page through the governed read callable.
 *
 * WHAT THE BROWSER IS ALLOWED TO SAY. A source id, a sort TOKEN, named filters with values, a page
 * size, and a cursor string it received from a previous page. That is the whole payload. It names
 * no collection, no Firestore field, no where() clause, no operator and no orderBy -- the server
 * resolves every one of those from its own copy of the registry, and refuses anything it did not
 * declare. This is the difference that makes the migration worth doing: the old direct path let the
 * browser compose the query, and only Rules stood between a composed query and the data.
 *
 * THE CURSOR IS A STRING, and that is invisible above this layer. `useMetadataList` stores whatever
 * a source returns as `nextCursorDoc` and hands it straight back as `cursorDoc` without ever
 * looking inside it, so a Firestore document snapshot and an opaque server-issued token are
 * interchangeable there. Nothing above the list source needed to change.
 */
async function fetchGovernedPage(descriptor, governed, cursor) {
  // Named filters, not clauses. Each descriptor filter becomes one NAME the source declared plus a
  // value; the operator stays the server's. Two descriptor filters that collapse to one name would
  // silently drop one of them -- a query narrower or broader than the one presented -- so it
  // throws instead, the same choice buildQueryDescriptor makes for two array filters.
  const filters = {};
  for (const f of descriptor.filters ?? []) {
    const name = governedFilterName(f.fieldId, f.operator);
    if (Object.prototype.hasOwnProperty.call(filters, name)) {
      throw new Error(
        `callableListSource: two filters on this list both resolve to the governed filter "${name}" — ` +
          "one of them would be silently dropped"
      );
    }
    filters[name] = f.value;
  }

  // The descriptor's sort always ends in the client-side tiebreaker (`__name__`, appended
  // unconditionally by buildQueryDescriptor so cursor paging is total). The governed read applies
  // its OWN document-id tiebreak server-side for the same reason, so the token describes only the
  // PRIMARY clause; forwarding the tiebreaker would ask for a sort no source registers. A list
  // sorted by nothing but the tiebreaker sends no token at all and takes the source's default.
  const primary = (descriptor.sort ?? []).find((s) => s.fieldId !== "__name__") ?? null;

  const payload = { sourceId: governed.sourceId, pageSize: descriptor.pageSize, filters };
  if (primary) payload.sortKey = governedSortKey(primary.fieldId, primary.direction);
  if (cursor) payload.cursor = cursor;

  let data;
  try {
    data = await invokeCallable(GOVERNED_CALLABLE, payload);
  } catch (err) {
    throw normalizeCallableError(err);
  }

  const rows = Array.isArray(data?.[GOVERNED_LIST_KEY]) ? data[GOVERNED_LIST_KEY] : [];
  // The server already ran the limit+1 probe and reports the result as `hasMore`, so the sentinel
  // is re-appended here purely to reuse interpretPage's single truncation rule rather than write a
  // second one. interpretPage slices it back off; it never reaches a rendered row.
  const page = interpretPage(descriptor, data?.hasMore ? [...rows, Object.freeze({ __probe: true })] : rows);
  // `nextCursorDoc` carries the server's opaque cursor STRING. Named for the field the hook
  // already round-trips, not for what is inside it -- see the note above.
  return { ...page, nextCursorDoc: data?.nextCursor ?? null };
}


// ══════════════════════ THE SCOPED WORK-ORDER SEAM ══════════════════════
//
// One callable name, standing for a read whose authority is not global. It is NOT in
// CALLABLE_SOURCES and NOT in GOVERNED_SOURCES because it is neither: it takes a registered MODE
// plus that mode's declared parameters, and the server adds an assignment predicate the caller
// neither supplies nor can see.
const SCOPED_WORK_ORDER_CALLABLE = "readScopedWorkOrders";

/**
 * Fetch one page of the metadata Work Order list through the scoped seam.
 *
 * Maps the descriptor onto the seam's `index` mode. The descriptor's own filters become that mode's
 * declared parameters by NAME -- `status` / `statusIn` / `customerId` -- exactly as the governed
 * path does; the field and the operator stay the server's.
 *
 * THERE IS NO SCOPE PARAMETER TO SET. Whether this reader sees every work order or only their own
 * assigned ones is decided server-side from request.auth.uid. The list runtime cannot tell the
 * difference, and must not: a technician's Work Orders list is their assigned work, which is what
 * `firestore.rules` produced for them before this seam existed.
 */
async function fetchScopedWorkOrderPage(descriptor) {
  const params = {};
  for (const f of descriptor.filters ?? []) {
    const name = governedFilterName(f.fieldId, f.operator);
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(
        `callableListSource: two filters on this list both resolve to the work-order parameter "${name}"`,
      );
    }
    params[name] = f.value;
  }

  // The client-side tiebreaker is dropped for the same reason as on the governed path: the seam
  // applies its own document-id tiebreak server-side, and forwarding `__name__` would ask for a
  // sort no mode registers.
  const primary = (descriptor.sort ?? []).find((s) => s.fieldId !== "__name__") ?? null;

  const page = await readScopedWorkOrders({
    mode: "index",
    params,
    ...(primary ? { sortKey: governedSortKey(primary.fieldId, primary.direction) } : {}),
    pageSize: descriptor.pageSize,
  });

  if (!page.ok) {
    // Normalized to the SAME code shape a Firestore read produced, so useMetadataList's existing
    // denied/unavailable split keeps working without learning a third error dialect.
    const err = new Error("scoped work order read failed");
    err.code = page.result === "DENIED" ? "permission-denied" : "unavailable";
    throw err;
  }

  // `hasMore` is the server's observed probe. Re-appended as a sentinel row only so interpretPage's
  // single truncation rule is reused rather than a second one written here; it never reaches a
  // rendered row.
  const interpreted = interpretPage(descriptor, page.hasMore ? [...page.items, Object.freeze({ __probe: true })] : page.items);
  // No cursor: the seam pages by bound, and the metadata Work Order list has never requested a
  // second page through a cursor.
  return { ...interpreted, nextCursorDoc: null };
}

export async function fetchPage(descriptor, { cursorDoc = null } = {}) {
  // WORK ORDERS SPEAK A DIFFERENT VOCABULARY, and that is the point rather than an inconsistency.
  // Every governed source is a global capability check; the work-order read is not, so its seam
  // takes a registered MODE and adds a scope predicate the caller neither supplies nor can see.
  // Routing it here keeps the entity/list dispatch, buildQueryDescriptor and useMetadataList
  // unchanged -- the list runtime never learns that this one read is scoped.
  if (descriptor?.readCallable === SCOPED_WORK_ORDER_CALLABLE) return fetchScopedWorkOrderPage(descriptor);

  const governed = descriptor?.readCallable ? GOVERNED_SOURCES[descriptor.readCallable] : null;
  if (governed) return fetchGovernedPage(descriptor, governed, cursorDoc);

  const source = descriptor?.readCallable ? CALLABLE_SOURCES[descriptor.readCallable] : null;
  if (!source) {
    throw new Error(
      `callableListSource: no known response mapping for readCallable "${descriptor?.readCallable ?? "(none)"}" — ` +
        "a CALLABLE-read entity with no recognized callable cannot be read at all."
    );
  }

  // The parent-scope filter buildQueryDescriptor PREPENDS for a RELATED surface (listRuntime.js
  // — "prepended, not appended, and is not optional"). Read as the callable's own scope
  // argument (`accountId` today) rather than re-declaring the field name here, so this stays
  // correct for any relationship whose `viaField` matches the callable's own parameter name.
  //
  // An INDEX descriptor legitimately carries none of this (buildQueryDescriptor only
  // prepends a scope filter for `def.surface === "RELATED"`), so its absence is only an
  // error for a callable that CALLABLE_SOURCES declares `scoped: true` — an unscoped
  // callable (listOpportunityContext) is simply called without a scope argument, which is
  // the "unscoped path" this branch exists to allow rather than reject.
  const scopeFilter = descriptor?.filters?.[0] ?? null;
  if (source.scoped && !scopeFilter) {
    throw new Error(
      `callableListSource: readCallable "${descriptor.readCallable}" requires a parent-scope filter and the descriptor has none`
    );
  }
  // The other half of "scope must match": an UNSCOPED callable (listOpportunityContext)
  // takes no parent-scope argument at all, so a scope filter arriving here — e.g. a
  // RELATED descriptor whose list view mistakenly named an unscoped callable, or any
  // future caller that hands this an unexpected filter — must not be silently smuggled
  // into the payload. Silently forwarding it would read the WRONG rows (every row the
  // caller's whole scope authorizes, not the parent-scoped set the RELATED section
  // promises), which is worse than failing. Reject loudly instead of guessing which of the
  // two the caller actually meant.
  if (!source.scoped && scopeFilter) {
    throw new Error(
      `callableListSource: readCallable "${descriptor.readCallable}" is unscoped and cannot accept a parent-scope filter ` +
        `(got "${scopeFilter.fieldId}") — an unscoped callable returns the caller's whole authorized scope`
    );
  }

  const payload = { limit: descriptor.pageSize };
  if (scopeFilter) payload[scopeFilter.fieldId] = scopeFilter.value;

  let data;
  try {
    data = await invokeCallable(descriptor.readCallable, payload);
  } catch (err) {
    throw normalizeCallableError(err);
  }

  const rows = Array.isArray(data?.[source.listKey]) ? data[source.listKey] : [];
  // The callable already applies its OWN limit+1 truncation probe server-side
  // (readOpportunitiesForAccount / readSalesOrdersForAccount both fetch `limit + 1` and slice
  // back to `limit`) and reports the result as an explicit `truncated` boolean rather than
  // handing back the extra row the way a raw Firestore snapshot does. A sentinel row is
  // appended here ONLY when `truncated` is true, reusing interpretPage's own "docs.length >
  // pageSize" rule unchanged rather than re-deriving a second truncation rule in this file —
  // interpretPage slices it back off (§ "the probe is never the cursor"), so it never reaches
  // a rendered row.
  const probedDocs = data?.truncated ? [...rows, Object.freeze({ __probe: true })] : rows;
  const page = interpretPage(descriptor, probedDocs);
  return { ...page, nextCursorDoc: null };
}
