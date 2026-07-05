import { useEffect, useRef, useState } from "react";

// Dispatcher Activity Panel -- session-only, in-memory feed of Work
// Order changes observed via useWorkOrders()'s live onSnapshot data.
// Deliberately NOT an audit/event system: nothing here is persisted
// anywhere (no new Firestore collection, no write of any kind), the
// feed lives only in this hook's React state, and it's gone the
// moment the component unmounts or the page reloads. A future real
// event stream (if ADR'd separately) could swap this hook's data
// source for persisted events with minimal change to the rendering
// side (DispatcherActivityFeed.jsx) -- but that's explicitly not what
// this is.
//
// Diffs the current workOrders array against the previous one on every
// change; a status or assignedTechId difference for an already-known
// Work Order becomes one feed entry. The very first snapshot only
// establishes the baseline and produces no entries -- otherwise
// opening the board would "report" every Work Order's entire existing
// state as if it just happened.
const STATUS_VERB = {
  CREATED: "created",
  READY_TO_DISPATCH: "marked ready to dispatch",
  SCHEDULED: "scheduled",
  DISPATCHED: "dispatched",
  ACCEPTED: "accepted by technician",
  EN_ROUTE: "marked Traveling",
  ARRIVED: "marked on site",
  WORK_IN_PROGRESS: "started work",
  COMPLETED: "completed",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

const MAX_ENTRIES = 50;

export function useSessionActivityFeed(workOrders, technicians) {
  const [entries, setEntries] = useState([]);
  const previousRef = useRef(null);

  useEffect(() => {
    const previous = previousRef.current;

    if (previous) {
      const techName = (id) => technicians.find((t) => t.id === id)?.name ?? id;
      const newEntries = [];

      for (const wo of workOrders) {
        const prevState = previous.get(wo.id);
        if (!prevState) continue; // newly-appearing WO this session -- not a reportable "action"
        if (prevState.status === wo.status) continue;

        const message =
          wo.status === "DISPATCHED" && wo.assignedTechId
            ? `${techName(wo.assignedTechId)} assigned to ${wo.woNumber}`
            : `${wo.woNumber} ${STATUS_VERB[wo.status] ?? wo.status}`;

        newEntries.push({ id: `${wo.id}-${Date.now()}-${Math.random()}`, message, at: Date.now() });
      }

      if (newEntries.length > 0) {
        setEntries((prevEntries) => [...newEntries.reverse(), ...prevEntries].slice(0, MAX_ENTRIES));
      }
    }

    previousRef.current = new Map(workOrders.map((wo) => [wo.id, { status: wo.status, assignedTechId: wo.assignedTechId }]));
  }, [workOrders, technicians]);

  return entries;
}
