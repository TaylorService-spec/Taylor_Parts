import { useCallback, useRef, useState } from "react";
import { transferCommandClient } from "../services/transferCommandClient";
import { buildCreateTransferRequest, buildTransferActionRequest, makeIdempotencyKey } from "../domain/transferCommandRequest";
import { mapTransferActionError, describeOutcome } from "../domain/transferActionResult";

// Enterprise Inventory Phase 4 -- the Transfers workspace's write seam. Wraps the four transfer
// callables with idempotency-key management, a per-action busy flag, and an honest result banner
// (never a fabricated success). `onSettled` is called after a successful (applied OR replayed) call
// so the caller can re-fetch the read model -- this hook does not itself own the read.
export function useTransferActions({ onSettled } = {}) {
  const [status, setStatus] = useState(null); // { kind: "success"|"error", message, action } | null
  const [busyId, setBusyId] = useState(null); // transferOrderId | "create" | null while a call is in flight
  const keysRef = useRef(new Map()); // action:target -> stable idempotencyKey until it clears

  const keyFor = useCallback((k) => {
    if (!keysRef.current.has(k)) keysRef.current.set(k, makeIdempotencyKey());
    return keysRef.current.get(k);
  }, []);
  const clearKey = useCallback((k) => keysRef.current.delete(k), []);

  const createTransfer = useCallback(
    async (draft) => {
      const built = buildCreateTransferRequest(draft, { idempotencyKey: keyFor("create") });
      if (!built.ok) return { ok: false, errors: built.errors };
      setBusyId("create");
      setStatus(null);
      try {
        const outcome = await transferCommandClient.createTransferOrder(built.value);
        clearKey("create");
        setStatus({ kind: "success", message: describeOutcome("create", outcome?.outcome), action: "create" });
        if (onSettled) onSettled();
        return { ok: true, errors: {}, transferOrderId: outcome?.transferOrderId };
      } catch (err) {
        setStatus({ kind: "error", message: mapTransferActionError(err), action: "create" });
        return { ok: false, errors: {} };
      } finally {
        setBusyId(null);
      }
    },
    [keyFor, clearKey, onSettled],
  );

  const runAction = useCallback(
    (action, method) =>
      async (transferOrderId) => {
        const built = buildTransferActionRequest(transferOrderId);
        if (!built.ok) return;
        const key = `${action}:${transferOrderId}`;
        setBusyId(transferOrderId);
        setStatus(null);
        try {
          const outcome = await method(built.value);
          clearKey(key);
          setStatus({ kind: "success", message: describeOutcome(action, outcome?.outcome), action, transferOrderId });
          if (onSettled) onSettled();
        } catch (err) {
          setStatus({ kind: "error", message: mapTransferActionError(err), action, transferOrderId });
        } finally {
          setBusyId(null);
        }
      },
    [clearKey, onSettled],
  );

  const dispatchTransfer = runAction("dispatch", transferCommandClient.dispatchTransferOrder);
  const receiveTransfer = runAction("receive", transferCommandClient.receiveTransferOrder);
  const cancelTransfer = runAction("cancel", transferCommandClient.cancelTransferOrder);

  return { status, clearStatus: () => setStatus(null), busyId, createTransfer, dispatchTransfer, receiveTransfer, cancelTransfer };
}
