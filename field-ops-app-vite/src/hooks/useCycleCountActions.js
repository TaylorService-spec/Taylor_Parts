import { useCallback, useRef, useState } from "react";
import { cycleCountCommandClient } from "../services/cycleCountCommandClient";
import {
  buildCreateCycleCountRequest,
  buildSubmitCycleCountRequest,
  buildReconcileCycleCountRequest,
  buildCycleCountIdOnlyRequest,
  makeIdempotencyKey,
} from "../domain/cycleCountCommandRequest";
import { mapCycleCountActionError, describeCycleCountOutcome } from "../domain/cycleCountActionResult";

// Enterprise Inventory -- Cycle Count operating authority: the Cycle Counts workspace's write seam
// AND its only state source.
//
// THERE IS NO CLIENT READ PATH for cycle_counts (firestore.rules denies all direct client read/write
// for this collection, the same Admin-SDK-only posture as receiving_orders/transfer_orders' ledger
// siblings). Rather than invent a new inventory.cycleCount.read capability this task was not asked to
// build, this hook keeps the workspace's list of cycle counts entirely in LOCAL component state,
// populated from what each callable's own response already returns (createCycleCount/submitCycleCount/
// reconcileCycleCount/cancelCycleCount were all extended to return the record fields the UI needs --
// see functions/src/cycleCount/cycleCountCallables.ts). This makes "status/history" here SESSION-scoped
// (what this browser tab created/updated since it opened), not a durable cross-session list -- an
// honest, bounded posture until a separately-authorized read capability exists.
export function useCycleCountActions() {
  const [status, setStatus] = useState(null); // { kind: "success"|"error", message, action } | null
  const [busyId, setBusyId] = useState(null); // cycleCountId | "create" | null while a call is in flight
  const [counts, setCounts] = useState([]); // session-scoped list, most-recent-first
  const keysRef = useRef(new Map());

  const keyFor = useCallback((k) => {
    if (!keysRef.current.has(k)) keysRef.current.set(k, makeIdempotencyKey());
    return keysRef.current.get(k);
  }, []);
  const clearKey = useCallback((k) => keysRef.current.delete(k), []);

  const upsert = useCallback((cycleCountId, patch) => {
    setCounts((prev) => {
      const idx = prev.findIndex((c) => c.cycleCountId === cycleCountId);
      if (idx === -1) return [{ cycleCountId, ...patch }, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const createCount = useCallback(
    async (draft) => {
      const built = buildCreateCycleCountRequest(draft, { idempotencyKey: keyFor("create") });
      if (!built.ok) return { ok: false, errors: built.errors };
      setBusyId("create");
      setStatus(null);
      try {
        const outcome = await cycleCountCommandClient.createCycleCount(built.value);
        clearKey("create");
        upsert(outcome.cycleCountId, {
          partId: outcome.partId,
          trackingMode: outcome.trackingMode,
          location: outcome.location,
          expectedQuantity: outcome.expectedQuantity,
          expectedSerialNumbers: outcome.expectedSerialNumbers ?? undefined,
          status: outcome.status,
        });
        setStatus({ kind: "success", message: describeCycleCountOutcome("create", outcome?.outcome), action: "create" });
        return { ok: true, errors: {}, cycleCountId: outcome?.cycleCountId };
      } catch (err) {
        setStatus({ kind: "error", message: mapCycleCountActionError(err), action: "create" });
        return { ok: false, errors: {} };
      } finally {
        setBusyId(null);
      }
    },
    [keyFor, clearKey, upsert],
  );

  const submitCount = useCallback(
    async (cycleCountId, trackingMode, draft) => {
      const built = buildSubmitCycleCountRequest(cycleCountId, trackingMode, draft);
      if (!built.ok) return { ok: false, errors: built.errors };
      setBusyId(cycleCountId);
      setStatus(null);
      try {
        const outcome = await cycleCountCommandClient.submitCycleCount(built.value);
        upsert(cycleCountId, {
          status: outcome.status,
          countedQuantity: outcome.countedQuantity ?? undefined,
          countedSerialNumbers: outcome.countedSerialNumbers ?? undefined,
          variance: outcome.variance ?? undefined,
          serialVariance: outcome.serialVariance ?? undefined,
        });
        setStatus({ kind: "success", message: describeCycleCountOutcome("submit", outcome?.outcome), action: "submit", cycleCountId });
        return { ok: true, errors: {} };
      } catch (err) {
        setStatus({ kind: "error", message: mapCycleCountActionError(err), action: "submit", cycleCountId });
        return { ok: false, errors: {} };
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  const reconcileCount = useCallback(
    async (cycleCountId, reasonText) => {
      const built = buildReconcileCycleCountRequest(cycleCountId, reasonText);
      if (!built.ok) return { ok: false };
      setBusyId(cycleCountId);
      setStatus(null);
      try {
        const outcome = await cycleCountCommandClient.reconcileCycleCount(built.value);
        upsert(cycleCountId, {
          status: outcome.status,
          ledgerEventIds: outcome.ledgerEventIds ?? [],
          reconciliationReason: outcome.reconciliationReason ?? undefined,
        });
        setStatus({ kind: "success", message: describeCycleCountOutcome("reconcile", outcome?.outcome), action: "reconcile", cycleCountId });
        return { ok: true };
      } catch (err) {
        setStatus({ kind: "error", message: mapCycleCountActionError(err), action: "reconcile", cycleCountId });
        return { ok: false };
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  const cancelCount = useCallback(
    async (cycleCountId) => {
      const built = buildCycleCountIdOnlyRequest(cycleCountId);
      if (!built.ok) return;
      setBusyId(cycleCountId);
      setStatus(null);
      try {
        const outcome = await cycleCountCommandClient.cancelCycleCount(built.value);
        upsert(cycleCountId, { status: outcome.status });
        setStatus({ kind: "success", message: describeCycleCountOutcome("cancel", outcome?.outcome), action: "cancel", cycleCountId });
      } catch (err) {
        setStatus({ kind: "error", message: mapCycleCountActionError(err), action: "cancel", cycleCountId });
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  return { status, clearStatus: () => setStatus(null), busyId, counts, createCount, submitCount, reconcileCount, cancelCount };
}
