import { useEffect, useState } from "react";
import { fetchPartBalance } from "../services/partsOperationsReads.js";
import { INVENTORY_BALANCE_READ_READY } from "../config/inventoryBalanceReadiness.js";

// ONE Part's governed balance (readPartBalance; Firebase exit B3-x): on-hand / reserved / available / on-order, each a three-valued figure
// ({ state: KNOWN | UNKNOWN | NOT_COUNTED_BY_QUANTITY, value }), plus on-hand by warehouse. The server scopes it to the caller's companies
// and warehouses; this hook only asks and reports HOW the ask ended, so a screen can tell a refusal from a failure from a switched-off read:
//
//   OFF      INVENTORY_BALANCE_READ_READY is false in this environment, or there is no Part yet -- NOTHING was asked
//   LOADING  asked, not answered
//   READY    answered: `balance` carries the figures
//   DENIED   the server refused the caller (capability / company) -- stated, never an empty balance
//   FAILED   the read did not complete -- not a statement about the stock
export const BALANCE_STATUS = Object.freeze({ OFF: "OFF", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", FAILED: "FAILED" });

// `readable` (access map): false = the session does not hold what readPartBalance requires -> DENIED without asking; null = the session answer
// has not arrived -> LOADING without asking; true (the default) is every other caller.
export function usePartBalance(partId, { ready = INVENTORY_BALANCE_READ_READY, fetchBalance = null, readable = true } = {}) {
  const eligible = ready === true && typeof partId === "string" && partId !== "";
  const asked = eligible && readable === true;
  const [state, setState] = useState({ partId: null, status: BALANCE_STATUS.OFF, balance: null });

  useEffect(() => {
    if (!asked) return undefined;
    let cancelled = false;
    // The binding is touched only when a read is actually due (a test double of the reads module need not export it).
    const read = fetchBalance ?? fetchPartBalance;
    Promise.resolve()
      .then(() => read(partId))
      .then((balance) => { if (!cancelled) setState({ partId, status: BALANCE_STATUS.READY, balance }); })
      .catch((err) => {
        if (!cancelled) setState({ partId, status: err?.code === "FORBIDDEN" ? BALANCE_STATUS.DENIED : BALANCE_STATUS.FAILED, balance: null });
      });
    return () => { cancelled = true; };
  }, [asked, partId, fetchBalance]);

  if (eligible && readable !== true) return { status: readable === false ? BALANCE_STATUS.DENIED : BALANCE_STATUS.LOADING, balance: null };
  if (!asked) return { status: BALANCE_STATUS.OFF, balance: null };
  // An answer for another Part is not this Part's answer: it is LOADING until this Part's own arrives.
  return state.partId === partId ? { status: state.status, balance: state.balance } : { status: BALANCE_STATUS.LOADING, balance: null };
}
