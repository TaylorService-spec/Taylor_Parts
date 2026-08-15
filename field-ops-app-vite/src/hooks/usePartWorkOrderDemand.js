import { useEffect, useState } from "react";
import { collection, query, where, orderBy, limit, getDocs, getCountFromServer } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { WORK_ORDERS_COLLECTION } from "../domain/constants";
import { OPEN_WORK_ORDER_STATUSES } from "../domain/accountWorkOrders";

// Part -> Work Order Demand (Wave 7 Item 3) -- the READ half. Answers "Which Work Orders need this part?"
// from the canonical fieldops_wos authority via a bounded Firestore QUERY, never a client-side scan of the
// whole collection.
//
// QUERY STRATEGY (investigated honestly -- see PR report for the full reasoning):
// `inventorySnapshot` is an ARRAY OF OBJECTS (each `{ partId, qtyPlanned, qtyUsed, ... }`), so Firestore's
// `array-contains` cannot match a nested field inside it -- it would require the array to contain an EXACT
// object equal to a probe value, which is not how this document is shaped and would break the instant any
// unrelated field on that row (name, category, qtyUsed, ...) changed. There is no server-side index that
// lets a client query "any array element whose partId field equals X" without a denormalized field the
// Work Order writer would have to maintain (setWorkOrderPartsPlan/createWorkOrder, both functions/src --
// out of this change's scope, and not something a read-only projection should introduce a parallel demand
// engine to work around).
//
// The honest, bounded alternative actually implemented: query only NON-TERMINAL fieldops_wos (the same
// OPEN_WORK_ORDER_STATUSES bucket domain/accountWorkOrders.js already uses -- a completed/closed/cancelled
// Work Order no longer needs the part, so excluding it here is both correct AND the entire point of the
// bound), newest-first, capped at PART_DEMAND_SCAN_CAP, then the pure projection
// (domain/partWorkOrderDemand.js) filters those documents client-side for this partId. A companion
// getCountFromServer() over the SAME status filter (no cap) tells the caller the true size of the open-WO
// population, so the UI can disclose "showing N of M" HONESTLY whenever the cap was actually hit, rather
// than silently truncating or scanning everything.
//
// Requires the composite index fieldops_wos(status ASC, createdAt DESC) -- added to firestore.indexes.json
// in this change; the index itself is not deployed by this change (a separate, later step).
export const PART_DEMAND_SCAN_CAP = 300;

export const PART_WORK_ORDER_DEMAND_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
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

    const base = collection(db, WORK_ORDERS_COLLECTION);
    const openFilter = where("status", "in", OPEN_WORK_ORDER_STATUSES);

    Promise.all([
      getDocs(query(base, openFilter, orderBy("createdAt", "desc"), limit(scanCap))),
      // Independent of the bounded page fetch -- a failure here degrades the disclosure (handled below),
      // it must never block or hide the rows the page fetch DID succeed in reading.
      getCountFromServer(query(base, openFilter)).catch(() => null),
    ])
      .then(([snap, countSnap]) => {
        if (cancelled) return;
        const workOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setState({
          status: PART_WORK_ORDER_DEMAND_STATE.READY,
          workOrders,
          scannedCount: workOrders.length,
          // null (not 0) when the count read itself failed -- the disclosure must not claim a total it
          // doesn't actually know.
          totalOpenWorkOrders: countSnap ? countSnap.data().count : null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: err?.code === "permission-denied" ? PART_WORK_ORDER_DEMAND_STATE.DENIED : PART_WORK_ORDER_DEMAND_STATE.UNAVAILABLE,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [partId, scanCap]);

  return state;
}
