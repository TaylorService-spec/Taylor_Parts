import { useCallback, useEffect, useState } from "react";
import { transferCommandClient } from "../services/transferCommandClient.js";

// The technician's incoming transfers -- IN_TRANSIT and bound for their OWN truck -- from the trusted
// listMyReceivableTransfers read. No Firestore read: `transfer_orders` Rules admit admin/dispatcher
// and assigned warehouse managers only, and they are NOT widened for this.
//
// Every page is read (the server pages by 50). A ceiling stops a runaway loop; hitting it is REPORTED
// as `more`, never passed off as the whole list.
//
// A failure is kept as the server's own answer -- { code, detail } -- so the screen can say "no truck
// assigned" or "not authorized" rather than "nothing incoming". Offline is a failure too: discovery
// needs the server, and this hook does not invent a cached list.
const PAGE_CEILING = 10;

function failureOf(err) {
  const raw = typeof err?.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
  const detail = typeof err?.details?.code === "string" ? err.details.code : null;
  return { code, detail };
}

export function useMyReceivableTransfers(client = transferCommandClient) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, failure: null, orders: [], truck: null, more: false });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    (async () => {
      const orders = [];
      let truck = null;
      let cursor = null;
      let pages = 0;
      do {
        const page = await client.listMyReceivableTransfers(cursor);
        truck = page?.truck ?? truck;
        orders.push(...(page?.transfers ?? []));
        cursor = page?.nextCursor ?? null;
        pages += 1;
      } while (cursor && pages < PAGE_CEILING);
      return { orders, truck, more: cursor !== null };
    })()
      .then((r) => { if (!cancelled) setState({ loading: false, failure: null, ...r }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, failure: failureOf(err), orders: [], truck: null, more: false }); });
    return () => { cancelled = true; };
  }, [client, attempt]);

  return { ...state, retry };
}
