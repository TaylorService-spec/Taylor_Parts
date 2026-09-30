import { useWorkOrderAuthority } from "../../hooks/useWorkOrderAuthority.js";
import { BOUNDARY_MESSAGES, WORK_ORDER_BOUNDARY } from "../../domain/workOrderOutcome.js";

// NOT_YET_ACTIVATED, said once, as a readiness STATE (DQ-S4) -- not an error banner, not an empty list.
//
// Renders only when the server explicitly answers NOT_YET_ACTIVATED (or a surface's own read was refused
// NOT_ACTIVATED -- pass `notActivated`). ACTIVE, still-asking and could-not-ask render nothing here: the
// surface's own loading / failure states already say those, and a second banner would double-report.
//
// A NAMED BOUNDARY (`boundary`, from domain/workOrderOutcome.js: the Commercial fulfillment hold, Equipment
// install, a not-yet-served operation) is a different, narrower readiness state: the Work Order authority is on,
// but THIS capability is not. It is said as itself, in the same readiness voice, never as a failure.
// WorkOrderBoundaryNotice renders one without asking the server anything.
export function WorkOrderBoundaryNotice({ boundary }) {
  if (!boundary || !BOUNDARY_MESSAGES[boundary]) return null;
  return (
    <div className="fo-muted fo-work-order-readiness" role="status" data-work-order-readiness="NOT_YET_ACTIVATED"
      data-work-order-boundary={boundary}>
      <strong>Not yet activated.</strong> {BOUNDARY_MESSAGES[boundary]}
    </div>
  );
}

export default function WorkOrderAuthorityNotice({ notActivated = false, authority = null, boundary = null }) {
  const live = useWorkOrderAuthority();
  const a = authority ?? live;
  if (boundary && boundary !== WORK_ORDER_BOUNDARY.WORK_ORDER_AUTHORITY) return <WorkOrderBoundaryNotice boundary={boundary} />;
  if (!notActivated && !a.notYetActivated && boundary !== WORK_ORDER_BOUNDARY.WORK_ORDER_AUTHORITY) return null;
  return (
    <div className="fo-muted fo-work-order-readiness" role="status" data-work-order-readiness="NOT_YET_ACTIVATED">
      <strong>Work Orders: NOT_YET_ACTIVATED.</strong>{" "}
      The governed EOS Work Order authority has not been switched on for this environment, so no Work Order
      is shown or changed here. This is a readiness state, not a failure and not an empty list.
    </div>
  );
}
