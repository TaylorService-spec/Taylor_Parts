// A refusal from the governed PostgreSQL CRM (EOS API), stated EXACTLY for the screen. Platform-sandbox builds only.
//
// PURE. The EOS API returns `{ code, message, status }` (and `findings` for a row-validated command); the authority's
// messages are written for the caller and carry no secrets, so they are shown verbatim with their code. The lead
// sentence says what KIND of refusal it was, by HTTP status: 403 missing capability / forbidden, 404 not found,
// 412 precondition failed, 409 conflict, 400 invalid request, 503 not available. Client-side states (not signed in,
// not configured, unreachable) have no status and say so plainly.
const LEAD_BY_STATUS = /* @__PURE__ */ Object.freeze({
  400: "The request was refused.",
  403: "You do not have permission to do this.",
  404: "Not found.",
  409: "This conflicts with an earlier request.",
  412: "A precondition for this change was not met.",
  503: "Customer records are not available right now.",
});

export function crmRefusalMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode -- no changes were made.";
  const code = typeof err?.code === "string" && err.code ? err.code : "INTERNAL";
  const message = typeof err?.message === "string" && err.message ? err.message : "the request could not be completed";
  if (code === "NOT_CONFIGURED") return "Customer records are unavailable: the EOS service is not configured for this environment.";
  if (code === "NOT_SIGNED_IN") return "Sign in to change customer records.";
  if (code === "UNREACHABLE") return "Can't reach the server right now. Nothing was saved. Check your connection and try again.";
  const lead = LEAD_BY_STATUS[err?.status] ?? "The request could not be completed.";
  return `${lead} ${message.charAt(0).toUpperCase()}${message.slice(1)} (${code}).`;
}

/**
 * PLATFORM-SANDBOX ONLY. A refused importAccountContacts, stated as what it is: NOTHING was imported (the command is all
 * or none), the exact refusal, and the server's per-row findings mapped back to the CSV row numbers of the preview the
 * user confirmed (finding.index is the position in the accepted list that was sent).
 */
export function contactImportRefusal(err, accepted = []) {
  const message = `Nothing was imported. ${crmRefusalMessage(err)}`;
  const findings = Array.isArray(err?.findings)
    ? err.findings.map((f) => ({
      rowNumber: accepted[f.index]?.rowNumber ?? null,
      text: `${f.message || "refused"} (${f.code})`,
    }))
    : [];
  return { message, findings };
}
