import { useWorkOrderAuthority } from "../../hooks/useWorkOrderAuthority.js";

// NOT_YET_ACTIVATED, said once, as a readiness STATE (DQ-S4) -- not an error banner, not an empty list.
//
// Renders only when the server explicitly answers NOT_YET_ACTIVATED (or a surface's own read was refused
// NOT_ACTIVATED -- pass `notActivated`). ACTIVE, still-asking and could-not-ask render nothing here: the
// surface's own loading / failure states already say those, and a second banner would double-report.
export default function WorkOrderAuthorityNotice({ notActivated = false, authority = null }) {
  const live = useWorkOrderAuthority();
  const a = authority ?? live;
  if (!notActivated && !a.notYetActivated) return null;
  return (
    <div className="fo-muted fo-work-order-readiness" role="status" data-work-order-readiness="NOT_YET_ACTIVATED">
      <strong>Work Orders: NOT_YET_ACTIVATED.</strong>{" "}
      The governed EOS Work Order authority has not been switched on for this environment, so no Work Order
      is shown or changed here. This is a readiness state, not a failure and not an empty list.
    </div>
  );
}
