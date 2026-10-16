import { useCallback, useState } from "react";

import { transitionWorkOrder } from "../../services/workOrderService";
import { reassignScheduledWorkOrder, rescheduleWorkOrder } from "../../services/schedulingCommandClient.js";
import { placementWindow } from "../../domain/dispatchBoardGeometry.js";
import { refusalContextFor, schedulingRefusalMessage, schedulingWarningMessages } from "../../domain/schedulingRefusal.js";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { PLACEMENT_INTENT } from "./PlacementDialog.jsx";

// THE ONE PLACEMENT RUNNER (Owner "FIX JOBS AND DISPATCH", 2026-10-16). The Dispatcher Board and the Jobs page both schedule,
// move, reassign, return-to-queue and dispatch through THIS hook, so the two surfaces cannot drift onto different commands,
// different refusal sentences or different concurrency guards. It is the code the Board already ran, moved here unchanged
// in behaviour: the governed Schedule transition, rescheduleWorkOrder / reassignScheduledWorkOrder (each with its stale
// guard), the ND-18 Unschedule edge, and the governed Dispatch transition. Every one is re-checked server-side.
//
//   { runPlacement(payload) -> { ok, message? }, dispatchTo(workOrder, employeeId) -> { ok, message? },
//     busyWorkOrderId, message, setMessage, setBusyWorkOrderId }
export function usePlacementCommands({ workOrders, technicians, onAfterPlacement } = {}) {
  const [busyWorkOrderId, setBusyWorkOrderId] = useState(null);
  const [message, setMessage] = useState(null);

  const runPlacement = useCallback(
    async ({ intent, workOrderId, technicianId, startMillis, endMillis, reason }) => {
      const workOrder = (workOrders ?? []).find((wo) => wo.id === workOrderId);
      if (!workOrder) return { ok: false, message: "That work order is no longer on the board." };

      setBusyWorkOrderId(workOrderId);
      setMessage(null);
      const context = refusalContextFor(technicians ?? [], technicianId ?? workOrder.scheduledTechId, workOrder);

      try {
        if (intent === PLACEMENT_INTENT.SCHEDULE) {
          // The EXISTING governed Schedule path — the same transition every other surface uses. No
          // second scheduling function was invented for the board (ND-24 was exactly that lesson).
          const result = await transitionWorkOrder(workOrder.id, "Schedule", {
            scheduledStart: startMillis,
            scheduledEnd: endMillis,
            scheduledTechId: technicianId,
          });
          announce(schedulingWarningMessages(result?.warnings, context), `${workOrder.woNumber} scheduled.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.RESCHEDULE) {
          const res = await rescheduleWorkOrder({
            workOrderId: workOrder.id,
            scheduledStart: startMillis,
            scheduledEnd: endMillis,
            ...(technicianId ? { scheduledTechId: technicianId } : {}),
            reason,
            // The optimistic-concurrency guard: the start this board BELIEVED it was moving. If
            // somebody else moved it between render and drop, the server refuses STALE_WORK_ORDER
            // rather than silently overwriting a placement this dispatcher never saw.
            expectedScheduledStart: placementWindow(workOrder)?.startMillis,
          });
          if (res.errorStatus) return refusal(res, context);
          announce(schedulingWarningMessages(res.result?.warnings, context), `${workOrder.woNumber} moved.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.REASSIGN) {
          const res = await reassignScheduledWorkOrder({
            workOrderId: workOrder.id,
            scheduledTechId: technicianId,
            reason,
            // The window this board SAW: kept as-is, and the governed command's stale guard.
            currentWindow: placementWindow(workOrder),
          });
          if (res.errorStatus) return refusal(res, context);
          announce(schedulingWarningMessages(res.result?.warnings, context), `${workOrder.woNumber} reassigned.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.UNSCHEDULE) {
          // ND-18's governed reverse edge. MarkReady is NEVER used here: it targets the same status
          // and would be a second, reason-free way out of SCHEDULED — the exact defect
          // ACTION_ALLOWED_FROM exists to prevent.
          await transitionWorkOrder(workOrder.id, "Unschedule", { unscheduleReason: reason });
          setMessage({ tone: "ok", text: `${workOrder.woNumber} returned to the queue.` });
          return { ok: true };
        }

        return { ok: false, message: "That action is not available." };
      } catch (err) {
        // transitionWorkOrder throws; the scheduling callables return. Both end up as a sentence.
        // The governed route's specific refusal rides on `reason` (WorkOrderApiError).
        const code = err?.reason ?? err?.details?.code ?? null;
        const message = code
          ? schedulingRefusalMessage(code, stripPrefix(err?.code), { ...context, serverMessage: err?.message ?? null })
          : workflowActionErrorMessage(err);
        setMessage({ tone: "error", text: message });
        return { ok: false, message };
      } finally {
        setBusyWorkOrderId(null);
        // A placement just consumed or released capacity; re-read so the lane is not still reporting
        // the availability it had a moment ago.
        onAfterPlacement?.();
      }

      function refusal(res, ctx) {
        const message = schedulingRefusalMessage(res.errorCode, res.errorStatus, { ...ctx, serverMessage: res.errorMessage ?? null });
        setMessage({ tone: "error", text: message });
        return { ok: false, message };
      }

      function announce(warnings, okText) {
        // ND-20's warnings ride along with a SUCCESSFUL placement and must not be styled as failures
        // — nor dropped, which would make an out-of-hours placement look unremarkable.
        if (warnings.length) setMessage({ tone: "warn", text: `${okText} ${warnings.join(" ")}` });
        else setMessage({ tone: "ok", text: okText });
      }
    },
    [workOrders, technicians, onAfterPlacement],
  );

  /** The governed Dispatch transition to the technician the job is scheduled for (or a chosen one). */
  const dispatchTo = useCallback(async (workOrder, technicianId) => {
    setBusyWorkOrderId(workOrder.id);
    setMessage(null);
    try {
      await transitionWorkOrder(workOrder.id, "Dispatch", { assignedTechId: technicianId });
      setMessage({ tone: "ok", text: `${workOrder.woNumber} dispatched.` });
      return { ok: true };
    } catch (err) {
      const text = workflowActionErrorMessage(err);
      setMessage({ tone: "error", text });
      return { ok: false, message: text };
    } finally {
      setBusyWorkOrderId(null);
    }
  }, []);

  return { runPlacement, dispatchTo, busyWorkOrderId, setBusyWorkOrderId, message, setMessage };
}

function stripPrefix(code) {
  if (typeof code !== "string") return "";
  return code.startsWith("functions/") ? code.slice("functions/".length) : code;
}
