// Wave 7 extension, PART 1.6 -- the THIRD bounded attention-projection slice (Account), mirroring the
// Wave 6 Parts Attention Projection (domain/partsAttentionProjection.js) and the Wave 7 PART 5 WO/Dispatch
// Attention Projection (domain/workOrderAttentionProjection.js, PR #1014) EXACTLY: pure normalization of
// ALREADY-READ, AUTHORITATIVE facts into a stable attention model -- NOT business authority, NOT a new
// collection, NOT an independent workflow, NOT a generic Action Center.
//
// This module COMPOSES two existing, already-merged authorities rather than re-deriving either:
//
//   AR overdue      -- domain/accountArView.js's OWN accountArView() output (the trusted
//                       listAccountInvoiceAr callable's view model). This module only reads
//                       view.rows[i].position === "OVERDUE" -- it never recomputes an AR position,
//                       an outstanding balance, or a day-overdue count itself.
//   WO past due     -- domain/workOrderAttentionProjection.js's OWN workOrderPastDueItem() (the
//                       already-merged, authoritative WO/Dispatch PAST_DUE signal, PR #1014), applied
//                       to this account's own SCHEDULED work orders (fetched account-scoped by
//                       domain/accountWorkOrders.js's fetchAccountScheduledWorkOrdersForAttention).
//                       The past-due predicate itself is never re-implemented here.
//
// AUDITED AND DELIBERATELY NOT PROJECTED (see the PART 1.6 task brief's signal inventory -- every one of
// these was verified against the actual repository, not assumed):
//   - Open Work Order COUNT (fetchAccountOpenWorkOrderCount) -- a raw count of open WOs is NOT itself an
//     attention fact (an account with active service normally HAS open WOs; that is healthy, ordinary
//     state, not something needing attention) -- exactly the same "NO_PLAN is not blocked" distinction
//     workOrderPartsReadiness.js/workOrderAttentionProjection.js already draw. Only a WO-level signal that
//     is ALREADY established as attention-worthy (PAST_DUE) is composed above; the bare count is not.
//   - A per-WO parts blocker, account-scoped -- workOrderPartsReadiness.js's buildWorkOrderPartsReadiness()
//     needs resolved warehouse/truck/procurement dimension inputs that are not read anywhere in the
//     Account surface today. Composing it here would require a new, separate multi-source read this slice
//     was not scoped to build -- so it is honestly omitted, not fabricated from a partial input.
//   - Opportunity/commercial attention -- listOpportunityContext returns the caller's WHOLE authorized
//     scope with no accountId parameter; there is no truthful way to scope it to one account without a
//     backend change (out of this repo-only slice's reach). Omitted, reported as a gap.
//   - Sales Order exception -- getSalesOrderContext fetches exactly ONE order by id; there is no
//     account-scoped backlog/list read to compose from. Omitted, reported as a gap.
//   - Equipment issue -- CustomerEquipment.jsx only filters client-side over already-loaded docs; there is
//     no authoritative account-scoped equipment-issue read. Omitted, reported as a gap.
//   - CRM follow-up -- does not exist as an authority anywhere in the codebase (a deliberately separate,
//     not-yet-built roadmap capability). Omitted, reported as a gap.
//
// Taxonomy (Owner's 2-category model, same as Parts and WO/Dispatch): ACTION_ITEM ("you need to do
// something") vs NOTIFICATION ("something happened / is in motion, no action required right now"). No
// third severity tier.
//
// AR and WO past-due are NOT comparable facts -- an overdue invoice is a collections concern, a past-due
// WO is a scheduling concern; there is no shared unit that would make one "worse" than the other. This
// module never ranks or interleaves them: each keeps its OWN, distinct sectionLabel
// ("Accounts Receivable" / "Past Due" -- the latter reused VERBATIM from workOrderPastDueItem's own
// output, never re-labeled), and ACCOUNT_ATTENTION_SECTION_ORDER lists them as separate, ordered groups --
// never merged into one ranked list or scored against each other.

import { workOrderPastDueItem } from "./workOrderAttentionProjection.js";
import { ACCOUNT_AR_STATE } from "./accountArView.js";

export const ACCOUNT_ATTENTION_TYPE = Object.freeze({
  ACTION_ITEM: "ACTION_ITEM",
  NOTIFICATION: "NOTIFICATION",
});

// Per-source status, so a caller/component can tell "confirmed healthy (zero found)" apart from
// "could not confirm" -- never collapsing the two into the same fake zero. Mirrors accountArView.js's
// own ACCOUNT_AR_STATE vocabulary (loading/denied/unavailable/ready), with the addition of "empty" being
// folded into "ready" here (an empty result set IS a confirmed, healthy read -- items just happen to be []).
export const ACCOUNT_ATTENTION_SOURCE_STATUS = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  READY: "ready",
});

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

// -- Source 1: AR overdue -------------------------------------------------------------------------------

// Composes accountArView()'s OWN output (never re-derives AR math). `arView` is that function's return
// value directly -- pass `accountArView({ loading, errorStatus, result })`'s result straight through.
// Resolution deep-links to the AR area within THIS account's own page (`#account-ar-section`, the real
// anchor AccountArSection.jsx renders) -- AR data is never restated here, only referenced.
export function accountArAttentionItems(arView, { accountId } = {}) {
  if (!arView || typeof arView.kind !== "string" || !isNonEmptyString(accountId)) {
    return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE };
  }

  switch (arView.kind) {
    case ACCOUNT_AR_STATE.LOADING:
      return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.LOADING };
    case ACCOUNT_AR_STATE.DENIED:
      return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.DENIED };
    case ACCOUNT_AR_STATE.UNAVAILABLE:
      return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE };
    case ACCOUNT_AR_STATE.EMPTY:
      // Confirmed healthy: the AR read succeeded and found zero invoices at all.
      return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.READY };
    case ACCOUNT_AR_STATE.READY: {
      const rows = Array.isArray(arView.rows) ? arView.rows : [];
      const items = rows
        .filter((r) => r && r.position === "OVERDUE" && isNonEmptyString(r.key))
        .map((r) => ({
          attentionItemId: `account:ar:${accountId}:${r.key}`,
          domain: "ar",
          objectType: "invoice",
          objectId: r.key,
          accountId,
          attentionType: ACCOUNT_ATTENTION_TYPE.ACTION_ITEM,
          requiresAction: true,
          // No established AR/collections role exists anywhere in this codebase's role model
          // (compatibilityRoles.ts has no such role) -- honestly null rather than assigned to a
          // role that isn't real, mirroring workOrderPartsBlockerItem's own "no resolving role ->
          // null" pattern.
          recipientRole: null,
          sectionLabel: "Accounts Receivable",
          reason: "OVERDUE",
          invoiceNumber: r.invoiceNumber ?? r.key,
          outstandingText: r.outstandingText ?? null,
          daysOverdueText: r.daysOverdueText ?? null,
          deepLink: `/customers/${accountId}#account-ar-section`,
        }));
      return { items, sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.READY };
    }
    default:
      return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE };
  }
}

// -- Source 2: WO past due (account-scoped) --------------------------------------------------------------

// Composes workOrderAttentionProjection.js's OWN workOrderPastDueItem() -- the past-due predicate itself
// is never re-implemented here. `workOrders` must be an array of this account's SCHEDULED work orders
// (fetchAccountScheduledWorkOrdersForAttention's shape: { id, woNumber, status, scheduledStart }); `null`/
// non-array means the account-scoped read itself failed or hasn't completed -- an honest "unavailable",
// never a fabricated empty/zero (this is the caller's job to distinguish from a genuine empty array).
export function accountWorkOrderPastDueItems(workOrders, { nowMs = Date.now() } = {}) {
  if (!Array.isArray(workOrders)) {
    return { items: [], sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.UNAVAILABLE };
  }
  const items = [];
  for (const wo of workOrders) {
    const item = workOrderPastDueItem(wo, { nowMs });
    if (item) items.push(item);
  }
  return { items, sourceStatus: ACCOUNT_ATTENTION_SOURCE_STATUS.READY };
}

// -- Batch + grouping ---------------------------------------------------------------------------------

// Combines both composed sources into one flat Attention Item list plus a per-source status map, so a
// caller can render an honest degraded state for whichever source (if any) could not be confirmed --
// never silently drop it into the same list as a confirmed-empty source.
export function accountAttentionItems({ accountId, arView = null, workOrders = null, nowMs = Date.now() } = {}) {
  const ar = accountArAttentionItems(arView, { accountId });
  const wo = accountWorkOrderPastDueItems(workOrders, { nowMs });
  return {
    items: [...ar.items, ...wo.items],
    sourceStatus: { ar: ar.sourceStatus, workOrder: wo.sourceStatus },
  };
}

// Fixed, distinct section order -- AR and WO past-due are NEVER interleaved or ranked against each
// other (see module header). "Past Due" is workOrderPastDueItem's own sectionLabel, reused verbatim.
export const ACCOUNT_ATTENTION_SECTION_ORDER = Object.freeze(["Accounts Receivable", "Past Due"]);

// Groups a flat Attention Item list into `{ sectionLabel, items }[]` in ACCOUNT_ATTENTION_SECTION_ORDER,
// omitting empty sections. Pure, no I/O.
export function groupAccountAttentionItemsBySection(items) {
  if (!Array.isArray(items)) return [];
  const bySection = new Map();
  for (const item of items) {
    if (!item || typeof item.sectionLabel !== "string") continue;
    if (!bySection.has(item.sectionLabel)) bySection.set(item.sectionLabel, []);
    bySection.get(item.sectionLabel).push(item);
  }
  return ACCOUNT_ATTENTION_SECTION_ORDER.filter((label) => bySection.has(label)).map((label) => ({
    sectionLabel: label,
    items: bySection.get(label),
  }));
}
