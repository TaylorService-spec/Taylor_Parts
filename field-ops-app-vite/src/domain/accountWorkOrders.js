import { listWorkOrders } from "../services/workOrderService";

// Customer/Account Business Model -- Customer PR 3, Service Activity
// (docs/specifications/customer-account-business-model.md). Account-scoped
// reads of Work Orders over the GOVERNED EOS route (listWorkOrders { customerId }),
// never Firestore. These are OPERATIONAL activity, never a financial figure -- see
// the Framework (docs/architecture/enterprise-business-metrics-framework.md,
// Section 3): Work Order counts are not sales/revenue and never share a label
// with a dollar metric.
//
// THE GOVERNED ROUTE HAS NO COUNT READ AND NO CURSOR. It returns at most
// WORK_ORDER_LIST_MAX (200) rows with an explicit `truncated` flag. So:
//   - a count is the length of a NON-truncated read; a truncated read REFUSES
//     (throws) rather than report a floor as the count -- the caller renders
//     "unavailable", never an under-count;
//   - the timeline pages CLIENT-SIDE over one bounded read, newest-first by
//     createdAt; `hasMore` stops at the bound, and `truncated` says more exist.
const ACCOUNT_READ_BOUND = 200;

// These two buckets partition the canonical 11-value WorkOrderStatus enum
// (the authority is functions/src/transitionEngine.ts, mirrored client-side
// in domain/workOrderWorkflow.js -- verified in sync 2026-08-05, W0). KEEP
// IN SYNC: if a WorkOrderStatus value is ever added/renamed there, update
// these buckets in the same change, or account counts silently drift.
// CANCELLED is deliberately in NEITHER bucket -- a cancelled Work Order is
// excluded from both Completed and Open counts, never folded into either.
export const COMPLETED_WORK_ORDER_STATUSES = ["COMPLETED", "CLOSED"];
export const OPEN_WORK_ORDER_STATUSES = [
  "CREATED",
  "READY_TO_DISPATCH",
  "SCHEDULED",
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
];

export const SERVICE_ACTIVITY_PAGE_SIZE = 10;

// Two SEPARATE, INDEPENDENT counts -- deliberately NOT combined, so a failure of
// one never hides the other (see hooks/useAccountServiceActivity.js).
async function fetchAccountWorkOrderCountForStatuses(accountId, statuses) {
  const { items, truncated } = await listWorkOrders({ customerId: accountId, statuses, limit: ACCOUNT_READ_BOUND });
  if (truncated) {
    const err = new Error(`more than ${ACCOUNT_READ_BOUND} Work Orders; the governed route has no count read`);
    err.code = "UNAVAILABLE";
    err.reason = "COUNT_EXCEEDS_LIST_BOUND";
    throw err;
  }
  return items.length;
}

// Completed = COMPLETED/CLOSED.
export function fetchAccountCompletedWorkOrderCount(accountId) {
  return fetchAccountWorkOrderCountForStatuses(accountId, COMPLETED_WORK_ORDER_STATUSES);
}

// Open = the eight non-terminal, non-cancelled statuses.
export function fetchAccountOpenWorkOrderCount(accountId) {
  return fetchAccountWorkOrderCountForStatuses(accountId, OPEN_WORK_ORDER_STATUSES);
}

const createdMillis = (wo) => (wo?.createdAt && typeof wo.createdAt.toMillis === "function" ? wo.createdAt.toMillis() : 0);

// One page of the Account Activity timeline, newest-first. `afterDoc` is the
// opaque cursor the previous page returned (here: an offset into ONE bounded
// governed read), passed straight back as before. `hasMore` is true while the
// bounded read has rows left; `truncated` says the account has more Work Orders
// than the bound, so the end of the list is not the end of the history.
export async function fetchAccountWorkOrderTimelinePage(
  accountId,
  { pageSize = SERVICE_ACTIVITY_PAGE_SIZE, afterDoc = null } = {}
) {
  const { items: all, truncated } = await listWorkOrders({ customerId: accountId, limit: ACCOUNT_READ_BOUND });
  const sorted = [...all].sort((a, b) => createdMillis(b) - createdMillis(a) || String(a.id).localeCompare(String(b.id)));
  const offset = afterDoc && Number.isInteger(afterDoc.offset) ? afterDoc.offset : 0;
  const pageRows = sorted.slice(offset, offset + pageSize);
  const items = pageRows.map((wo) => ({
    id: wo.id,
    woNumber: wo.woNumber ?? null,
    status: wo.status ?? null,
    createdAt: wo.createdAt ?? null, // Timestamp-compatible instant | null
    // Account North Star P1: SCHEDULE and TECHNICIAN beside the status, off the SAME rows.
    // assignedTechId is an EMPLOYEE id now (domain/workOrderAdapter.js); the governed row also
    // carries the assignee's display name, so no second read resolves it.
    scheduledStart: wo.scheduledStart ?? null,
    assignedTechId: wo.assignedTechId ?? null,
    assigneeDisplayName: wo.assigneeDisplayName ?? null,
  }));
  const next = offset + pageRows.length;
  const lastDoc = pageRows.length ? { offset: next } : null;
  return { items, lastDoc, hasMore: next < sorted.length, truncated };
}

// Wave 7 extension, PART 1.6 -- Account Attention. A bounded, honest, account-scoped read of this
// account's SCHEDULED work orders, carrying exactly the fields domain/workOrderAttentionProjection.js's
// OWN workOrderPastDueItem() needs (id, status, scheduledStart) -- so PART 1.6 can COMPOSE that already-
// merged, authoritative PAST_DUE signal (PR #1014) instead of re-deriving past-due logic here. This is a
// SEPARATE query from fetchAccountWorkOrderTimelinePage (which is createdAt-ordered and omits
// scheduledStart entirely) -- reusing it would silently under-report past-due WOs sitting outside
// whatever page the timeline happened to load.
//
// Governed read: listWorkOrders { customerId, statuses: ["SCHEDULED"] }, bounded; `hasMore` is the
// server's `truncated` flag, so a caller can degrade to an honest "unavailable" instead of confidently
// under-reporting past-due WOs it never saw -- mirrors accountArView.js's "a truncated page is never
// labeled ready" rule.
export async function fetchAccountScheduledWorkOrdersForAttention(accountId, { limit: pageLimit = 200 } = {}) {
  const { items: rows, truncated } = await listWorkOrders({
    customerId: accountId,
    statuses: ["SCHEDULED"],
    limit: Math.min(pageLimit, ACCOUNT_READ_BOUND),
  });
  const items = rows.map((wo) => ({
    id: wo.id,
    woNumber: wo.woNumber ?? null,
    status: wo.status ?? null,
    scheduledStart: wo.scheduledStart ?? null,
  }));
  return { items, hasMore: truncated };
}
