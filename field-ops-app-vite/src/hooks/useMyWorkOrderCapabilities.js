// The caller's OWN Work Order capabilities from the governed EOS Work Order authority (readMyWorkOrderCapabilities, UI
// corrections integration 2026-10-08). Used ONLY to decide what to OFFER -- the New Work Order route and button. Every
// Work Order command re-checks the same capability server-side; a refusal is never turned into an offer.
//   { status: "idle" | "loading" | "ready" | "failed", has(key) }
import { useEffect, useState } from "react";
import { workOrderApiClient } from "../services/workOrderApiClient.js";

/** The one Work Order capability this hook is asked about by the shell (the New Work Order route and button). */
export const WORK_ORDER_CREATE_CAPABILITY = "workOrder.create";

export function useMyWorkOrderCapabilities({ enabled = true, client = workOrderApiClient } = {}) {
  const [state, setState] = useState({ status: enabled ? "loading" : "idle", keys: new Set() });
  useEffect(() => {
    if (!enabled) { setState({ status: "idle", keys: new Set() }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, status: "loading" }));
    Promise.resolve(client.call("readMyWorkOrderCapabilities", {})).then((res) => {
      if (!alive) return;
      setState(res?.ok ? { status: "ready", keys: new Set(res.result?.capabilities ?? []) } : { status: "failed", keys: new Set() });
    });
    return () => { alive = false; };
  }, [enabled, client]);
  // Fail closed: loading and failed hold nothing.
  return { status: state.status, has: (key) => state.status === "ready" && state.keys.has(key) };
}
