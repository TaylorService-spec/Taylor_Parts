// Wave 6 -- the FIRST bounded Parts attention-projection slice (Owner directive §13-16).
// Pure normalization of AUTHORITATIVE reorder_requests facts into a stable Parts attention
// model -- NOT business authority, NOT a new collection, NOT an independent workflow.
// Source of truth stays reorder_requests + its existing governed lifecycle/actions; this
// module only classifies what already exists.
//
// Flow this sits in (blueprint parts-ux-redesign-blueprint.md §14e):
//   AUTHORITATIVE REORDER REQUEST -> PARTS ATTENTION PROJECTION -> Parts WORK ->
//   transitional notification bell -> (future) Action Center
//
// Taxonomy (Owner's 3-category model): ACTION_ITEM ("you need to do something") vs
// NOTIFICATION ("something happened, no action required"). No ALERT category yet -- no
// repository evidence justifies inventing severity independent of workflow status (see
// blueprint §14e-1's explicit "deliberately NOT included" list).

export const PARTS_ATTENTION_TYPE = Object.freeze({
  ACTION_ITEM: "ACTION_ITEM",
  NOTIFICATION: "NOTIFICATION",
});

// PURCHASING_IN_PROGRESS is NOT automatically an Action Item (Owner directive §8/§16):
// an assignee who just posted an update has live, in-motion work, not a stalled item.
// This threshold is an explicit, adjustable PARAMETER -- not resolvable from repository
// evidence alone (no existing field encodes "how long is too long"); 48h is a reasonable
// starting default, overridable per call.
export const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function isFiniteMillis(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// One reorder_request -> one normalized Attention Item, or null if this status has
// nothing to surface (terminal: RECEIVED/CANCELLED/VOIDED/REJECTED -- matches today's bell
// behavior, where a request simply disappears once terminal). `deepLink` is the EXACT link
// shape NotificationPanel.jsx/PartsList.jsx already use today -- not a new route.
export function partsAttentionItem(request, { nowMs = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  if (!request || typeof request.id !== "string" || request.id.length === 0) return null;
  if (typeof request.partId !== "string" || request.partId.length === 0) return null;
  if (typeof request.status !== "string") return null;

  const base = {
    attentionItemId: `parts:reorderRequest:${request.id}`,
    domain: "parts",
    objectType: "reorderRequest",
    objectId: request.id,
    partId: request.partId,
    urgency: typeof request.urgency === "string" ? request.urgency : null,
    deepLink: `/inventory/${request.partId}?requestId=${request.id}`,
    sourceUpdatedAt:
      (isFiniteMillis(request.lastPurchasingUpdateAt) && request.lastPurchasingUpdateAt) ||
      (isFiniteMillis(request.assignedAt) && request.assignedAt) ||
      (isFiniteMillis(request.reviewedAt) && request.reviewedAt) ||
      (isFiniteMillis(request.createdAt) && request.createdAt) ||
      null,
  };

  switch (request.status) {
    case "PENDING_REVIEW":
      return {
        ...base,
        attentionType: PARTS_ATTENTION_TYPE.ACTION_ITEM,
        requiresAction: true,
        recipientRole: "REVIEWER",
        sectionLabel: "Pending Review",
      };
    case "READY_FOR_PARTS_MANAGER":
      return {
        ...base,
        attentionType: PARTS_ATTENTION_TYPE.ACTION_ITEM,
        requiresAction: true,
        recipientRole: "PARTS_MANAGER",
        sectionLabel: "Ready for Parts Manager",
      };
    case "ASSIGNED_TO_PARTS_ASSOCIATE":
      return {
        ...base,
        attentionType: PARTS_ATTENTION_TYPE.ACTION_ITEM,
        requiresAction: true,
        recipientUserId: typeof request.assignedToUserId === "string" ? request.assignedToUserId : null,
        sectionLabel: "Assigned to You",
      };
    case "PURCHASING_IN_PROGRESS": {
      // requiresAction is DERIVED, never automatic (Owner directive §8/§16): stale (no
      // update within the window, or never updated) -> Action Item; recently updated ->
      // Notification (in-motion, nothing outstanding from the assignee right now).
      const lastUpdate = isFiniteMillis(request.lastPurchasingUpdateAt) ? request.lastPurchasingUpdateAt : null;
      const stale = lastUpdate === null || nowMs - lastUpdate > staleAfterMs;
      return {
        ...base,
        attentionType: stale ? PARTS_ATTENTION_TYPE.ACTION_ITEM : PARTS_ATTENTION_TYPE.NOTIFICATION,
        requiresAction: stale,
        recipientUserId: typeof request.assignedToUserId === "string" ? request.assignedToUserId : null,
        sectionLabel: "Purchasing Started",
      };
    }
    default:
      // Terminal (RECEIVED/CANCELLED/VOIDED/REJECTED) or any unrecognized status -- honestly
      // nothing to surface, never guessed at.
      return null;
  }
}

// Batch form: many reorder_requests -> many Attention Items (malformed/terminal entries
// dropped, never fabricated). `options` forwarded to every item so a single `nowMs` snapshot
// is used consistently across the whole batch (avoids staleness flapping mid-render).
export function partsAttentionItems(requests, options) {
  if (!Array.isArray(requests)) return [];
  return requests.map((r) => partsAttentionItem(r, options)).filter((item) => item !== null);
}

// Fixed section order for the transitional bell migration (§14e-7 step 2) -- preserves
// today's exact visible grouping/order, now driven by the projection's own `sectionLabel`
// instead of four independently-labeled caller-side arrays.
export const PARTS_ATTENTION_SECTION_ORDER = Object.freeze([
  "Pending Review",
  "Ready for Parts Manager",
  "Assigned to You",
  "Purchasing Started",
]);

// Groups a flat Attention Item list into `{ sectionLabel, items }[]` in
// PARTS_ATTENTION_SECTION_ORDER, omitting empty sections. Pure, no I/O.
export function groupPartsAttentionItemsBySection(items) {
  if (!Array.isArray(items)) return [];
  const bySection = new Map();
  for (const item of items) {
    if (!item || typeof item.sectionLabel !== "string") continue;
    if (!bySection.has(item.sectionLabel)) bySection.set(item.sectionLabel, []);
    bySection.get(item.sectionLabel).push(item);
  }
  return PARTS_ATTENTION_SECTION_ORDER.filter((label) => bySection.has(label)).map((label) => ({
    sectionLabel: label,
    items: bySection.get(label),
  }));
}
