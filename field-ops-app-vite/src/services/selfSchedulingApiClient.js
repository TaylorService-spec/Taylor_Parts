// The CUSTOMER's route to self-scheduling (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
//   customer browser -> THIS -> POST /public/self-scheduling (EOS API, functions/src/eosOps/selfSchedulingHttp.ts)
//
// NO LOGIN, NO FIREBASE, NO BEARER HEADER. The scheduling token from the link is the only credential; it travels in
// the request BODY (never a query string, which lands in logs and referrers) and authorizes exactly two operations on
// one Work Order. Nothing else is sent: no Work Order, tenant, customer or Technician id exists on this side.
//
// It never throws: every outcome is { ok: true, result } or { ok: false, code, message, refreshed?, status }.

export const SELF_SCHEDULING_ROUTE = "/public/self-scheduling";

function apiBase(explicit) {
  const raw = explicit ?? (typeof import.meta !== "undefined" ? import.meta.env?.VITE_EOS_API_BASE_URL : undefined);
  return typeof raw === "string" && raw.trim() ? raw.trim().replace(/\/+$/, "") : null;
}

export async function callSelfScheduling(operation, input, options = {}) {
  const base = apiBase(options.baseUrl);
  if (!base) return { ok: false, code: "NOT_CONFIGURED", message: "Online scheduling is not available right now.", status: null };
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { ok: false, code: "UNREACHABLE", message: "Online scheduling could not be reached.", status: null };
  let response;
  try {
    response = await doFetch(`${base}${SELF_SCHEDULING_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, code: "UNREACHABLE", message: "Online scheduling could not be reached. Please try again.", status: null };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body?.ok === true) return { ok: true, result: body.result };
  return {
    ok: false,
    code: typeof body?.code === "string" ? body.code : "UNAVAILABLE",
    message: typeof body?.message === "string" ? body.message : "Online scheduling is not available right now.",
    refreshed: body?.refreshed ?? null,
    status: response.status,
  };
}

export const selfSchedulingClient = Object.freeze({
  readOffer: (token, options) => callSelfScheduling("readSchedulingOffer", { token }, options),
  select: (token, slotStart, options) => callSelfScheduling("selectSchedulingSlot", { token, slotStart }, options),
});

/** Pure: the offered slots grouped by the customer's day label, earliest first. */
export function groupSlotsByDay(slots) {
  const days = [];
  const index = new Map();
  for (const s of slots ?? []) {
    if (!index.has(s.dateLabel)) {
      index.set(s.dateLabel, days.length);
      days.push({ dateLabel: s.dateLabel, slots: [] });
    }
    days[index.get(s.dateLabel)].slots.push(s);
  }
  return days;
}

/** Pure: what the page should say for a refusal code. Plain language, never an internal enum. */
export function customerMessageFor(code) {
  switch (code) {
    case "SESSION_EXPIRED": return "This scheduling link has expired. Please contact us for a new one.";
    case "SESSION_REVOKED": return "This scheduling link is no longer active. Please contact us for a new one.";
    case "SESSION_AUTHORITY_WITHDRAWN": return "This scheduling link is no longer valid. Please contact us for a new one.";
    case "SESSION_NOT_FOUND": return "We could not find this scheduling link. Please check the link or contact us.";
    case "SLOT_NO_LONGER_AVAILABLE": return "That time was just taken. Please choose another time below.";
    case "SESSION_ALREADY_USED": return "Your visit is already booked. The confirmed time has not changed.";
    case "WORK_ORDER_NOT_SCHEDULABLE": return "This visit has already been scheduled by our office. Please contact us with any questions.";
    case "SELF_SCHEDULING_NOT_CONFIGURED": return "Online scheduling is not available for this visit. Please contact us.";
    case "NOT_ACTIVATED": return "Online scheduling is not available yet. Please contact us.";
    default: return "Online scheduling is not available right now. Please try again or contact us.";
  }
}

/** The scheduling token when the path is `<basename>/schedule/<token>`, else null. Pure. */
export function customerSchedulingToken(pathname, basename = "") {
  const base = (basename ?? "").replace(/\/+$/, "");
  const path = base && String(pathname).startsWith(base) ? String(pathname).slice(base.length) : String(pathname);
  const m = /^\/schedule\/([A-Za-z0-9_-]{32,64})\/?$/.exec(path);
  return m ? m[1] : null;
}
