import { interpretPage } from "./listRuntime.js";
// The registry is a SEPARATE module so metadata definitions can validate against it without
// importing this file's transport -- see callableSourceRegistry.js's own header for why that
// mattered. Re-exported here so every existing importer is unchanged and there is still one name
// for each of these in the codebase.
import {
  CALLABLE_SOURCES,
  GOVERNED_CALLABLE,
  GOVERNED_LIST_KEY,
  GOVERNED_SOURCES,
  SCOPED_WORK_ORDER_CALLABLE,
  governedFilterName,
  governedSortKey,
  governedSourceSpec,
  isKnownReadCallable,
  readCallableSourceInfo,
} from "./callableSourceRegistry.js";

export {
  governedFilterName,
  governedSortKey,
  governedSourceSpec,
  isKnownReadCallable,
  readCallableSourceInfo,
};
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

/**
 * Fetch one page through a descriptor's declared `readCallable`.
 *
 * Returns the SAME shape the list runtime expects — `{ rows, hasMore,
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
