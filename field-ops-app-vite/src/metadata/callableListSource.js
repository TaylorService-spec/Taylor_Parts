import { interpretPage } from "./listRuntime.js";

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
});

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
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(CALLABLE_SOURCES, name);
}

/**
 * The scope/response-shape record for a known callable, or null. Exported for the same
 * reason as `isKnownReadCallable` — `listViewDefinition.js` needs to know whether a
 * callable a list view declares is `scoped` (requires a parent) so it can reject a RELATED
 * list naming an unscoped callable, or an INDEX list naming a scoped one, before either
 * ever reaches a live request.
 */
export function readCallableSourceInfo(name) {
  return isKnownReadCallable(name) ? CALLABLE_SOURCES[name] : null;
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
export async function fetchPage(descriptor) {
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
