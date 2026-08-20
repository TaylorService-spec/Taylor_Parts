// Sales Order — transport over the trusted `listSalesOrderIndex` callable
// (functions/src/salesOrder/salesOrderReadService.ts). Third sibling of
// services/salesOrderReadCallableClient.js (exactly ONE order by id) and
// services/accountSalesOrdersReadCallableClient.js (the orders on ONE account):
// this one reads the CROSS-ACCOUNT index, which is what a Sales Orders list page needs.
//
// WHY THIS FILE DID NOT EXIST UNTIL NOW. `listSalesOrderIndex` has been deployed and
// live the whole time, with no client calling it and no page rendering it. The only
// way to reach a Sales Order in the product was to already be looking at the
// Opportunity that created it and follow the link -- so an admin holding every
// salesOrder.* capability, in an environment where all four are activated, still saw
// nothing anywhere in the app about Sales Orders. The capability was never the
// blocker; the missing read client and the missing nav destination were.
//
// Firebase is imported LAZILY (no import-time initializeApp side effect), and this is
// the only place that invokes this callable.
//
// READ, no client-side readiness flag -- `salesOrder.read` authorization and its
// per-environment activation are both enforced server-side; attempting the call and
// mapping whatever comes back is the same governed-read pattern every other read
// client in this codebase uses.
function mapErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? "denied" : "unavailable";
}

async function invoke(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, "listSalesOrderIndex")(payload);
  return res?.data;
}

// Fetch one page of the Sales Order index. Returns { result } on success (the callable's
// own {status, salesOrders, skipped, nextCursor} envelope, passed through VERBATIM for
// domain/salesOrderIndexView.js to interpret) or { errorStatus } on failure
// ("denied" | "unavailable") -- never throws.
//
// `state` and `cursor` are omitted entirely rather than sent as undefined/null: the
// callable REJECTS a present-but-invalid value instead of silently substituting a
// default, so sending a placeholder would turn "no filter" into an invalid-argument
// error. Absent means absent.
export async function fetchSalesOrderIndex({ limit, state, cursor } = {}) {
  try {
    const result = await invoke({
      ...(limit ? { limit } : {}),
      ...(state ? { state } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return { result };
  } catch (err) {
    return { errorStatus: mapErrorToStatus(err) };
  }
}
