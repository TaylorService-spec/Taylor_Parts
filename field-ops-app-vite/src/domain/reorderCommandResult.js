// A REFUSED Reorder command must reach the screen as a failure.
//
// callReorderApi (services/reorderApiClient.js) never throws: it resolves { ok: false, ... } for a
// refusal. The action cards that await these commands only catch, so a refusal used to resolve like a
// success and the screen carried on as if the server had agreed. Wrapping the pending call here turns
// a refusal into an Error carrying the server's code, reason, status and message; a success passes
// through unchanged.
export async function throwIfRefused(pending) {
  const res = await pending;
  if (res?.ok) return res;
  const err = new Error(res?.message ?? "the Reorder service refused the action");
  err.code = res?.code ?? "INTERNAL";
  err.reason = res?.reason ?? null;
  err.status = res?.status ?? null;
  throw err;
}
