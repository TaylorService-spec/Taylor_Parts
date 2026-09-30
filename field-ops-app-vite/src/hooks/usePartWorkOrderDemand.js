import { useEffect, useState } from "react";
import { getWorkOrder, listWorkOrders } from "../services/workOrderService";
import { OPEN_WORK_ORDER_STATUSES } from "../domain/accountWorkOrders";

// Part -> Work Order Demand (Wave 7 Item 3) -- the READ half. Answers "Which Work Orders need this part?"
// from the GOVERNED EOS Work Order route, never Firestore:
//
//   1. listWorkOrders { plannedPartId, statuses: OPEN } -- the SERVER filters to the non-terminal Work
//      Orders whose parts plan names this Part (bounded, with an explicit `truncated` flag);
//   2. readWorkOrder for each of those rows -- the summary carries no per-part quantities, and the
//      projection (domain/partWorkOrderDemand.js) needs qtyPlanned / qtyUsed from execution.parts.
//
// The detail reads are bounded by the list's own bound. A failed detail read fails the whole answer
// (UNAVAILABLE) rather than rendering rows with fabricated quantities. `totalOpenWorkOrders` is null:
// the governed route has no count read, and the disclosure uses `truncated` instead.
export const PART_DEMAND_SCAN_CAP = 200;

export const PART_WORK_ORDER_DEMAND_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_ACTIVATED: "NOT_ACTIVATED",
  READY: "READY",
});

export function usePartWorkOrderDemand(partId, { scanCap = PART_DEMAND_SCAN_CAP } = {}) {
  const [state, setState] = useState({ status: PART_WORK_ORDER_DEMAND_STATE.LOADING });

  useEffect(() => {
    if (!partId) {
      setState({ status: PART_WORK_ORDER_DEMAND_STATE.LOADING });
      return;
    }

    let cancelled = false;
    setState({ status: PART_WORK_ORDER_DEMAND_STATE.LOADING });

    (async () => {
      const page = await listWorkOrders({
        plannedPartId: partId,
        statuses: OPEN_WORK_ORDER_STATUSES,
        limit: Math.min(Math.max(1, scanCap), PART_DEMAND_SCAN_CAP),
      });
      const details = await Promise.all(page.items.map((wo) => getWorkOrder(wo.id)));
      return { workOrders: details.filter(Boolean), truncated: page.truncated };
    })()
      .then(({ workOrders, truncated }) => {
        if (cancelled) return;
        setState({
          status: PART_WORK_ORDER_DEMAND_STATE.READY,
          workOrders,
          scannedCount: workOrders.length,
          truncated,
          // null (not 0): the governed route has no count read, and a total it does not know is never claimed.
          totalOpenWorkOrders: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err?.code;
        setState({
          status: code === "NOT_ACTIVATED"
            ? PART_WORK_ORDER_DEMAND_STATE.NOT_ACTIVATED
            : code === "permission-denied" || code === "FORBIDDEN"
              ? PART_WORK_ORDER_DEMAND_STATE.DENIED
              : PART_WORK_ORDER_DEMAND_STATE.UNAVAILABLE,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [partId, scanCap]);

  return state;
}
