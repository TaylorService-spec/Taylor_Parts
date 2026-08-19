import { useState } from "react";
import { useSalesOrderActions } from "../../hooks/useSalesOrderActions.js";
import { canAdvance, canCancel, canAllocate, canCreateService, nextAdvanceState } from "../../domain/salesOrderActions.js";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";
import { Button } from "../../shared/ui/primitives/index.js";

// Sales Order operational actions -- wires the three trusted, already sandbox-activated write
// commands (transitionSalesOrder / allocateSalesOrder / createServiceForSalesOrder) onto the
// read-only Sales Order workspace. Deliberately narrow: it exposes lifecycle + fulfillment +
// service-creation actions ONLY. It exposes NO field that edits pricing, discount, tax, or quote
// terms -- `unitPrice` was stripped from the trusted read projection in PR #991 and nothing here
// reintroduces it or any other commercial term; this surface is operational, not commercial.
//
// Every offered action is gated by a CLIENT MIRROR of the backend's own precondition
// (domain/salesOrderActions.js) so an operator is never shown a button the server would reject --
// but that mirror is UX ONLY. The server re-checks every one of these preconditions and remains the
// sole authority; a stale/incorrect mirror can only ever produce a worse error message, never an
// unauthorized write (see domain/salesOrderActions.js's header for the one documented gap).
//
// A successful action calls `onChanged()` (the caller's useSalesOrder().refetch) so the page shows
// the SERVER's new state -- this component never fabricates the post-action state itself.
export default function SalesOrderActions({ view, onChanged, actionDeps }) {
  const { pending, runTransition, runAllocate, runCreateService, discardTransitionIntent } = useSalesOrderActions(view.id, actionDeps);
  const [openDialog, setOpenDialog] = useState(null); // null | "ADVANCE" | "CANCEL" | "ALLOCATE" | "SERVICE"

  const hasPartLine = view.lines.some((l) => l.kind === "PART");
  const advanceAllowed = canAdvance(view.state, { allLinesFulfilled: view.allLinesFulfilled });
  const cancelAllowed = canCancel(view.state);
  const allocateAllowed = canAllocate(view.state);
  const serviceAllowed = canCreateService(view.state, { serviceWorkOrderIds: view.serviceWorkOrderIds });
  const nextState = nextAdvanceState(view.state);

  // Dialog copy must use the governed business reference, never the Firestore document id
  // (DECISIONS #106: a missing reference is not permission to display a record id). This matches
  // the honest-unavailable fallback SalesOrderDetail.jsx already uses for the page title.
  const orderLabel = view.salesOrderNumber ? `Sales Order ${view.salesOrderNumber}` : "Sales Order — Reference unavailable";

  function closeDialog(transitionToDiscard) {
    if (transitionToDiscard) discardTransitionIntent(transitionToDiscard);
    setOpenDialog(null);
  }

  async function handleChanged() {
    setOpenDialog(null);
    onChanged?.();
  }

  const anyBusy = pending.advance || pending.cancel || pending.allocate || pending.service;

  return (
    <>
      <ActionRail
        secondary={
          <>
            {allocateAllowed && (
              <button type="button" className="fo-btn-secondary" disabled={anyBusy} onClick={() => setOpenDialog("ALLOCATE")}>
                Allocate
              </button>
            )}
            {serviceAllowed && (
              <button type="button" className="fo-btn-secondary" disabled={anyBusy} onClick={() => setOpenDialog("SERVICE")}>
                Create Service
              </button>
            )}
            {cancelAllowed && (
              <button type="button" className="fo-btn-destructive" disabled={anyBusy} onClick={() => setOpenDialog("CANCEL")}>
                Cancel order
              </button>
            )}
          </>
        }
        primary={
          advanceAllowed && (
            <Button type="button" variant="primary" disabled={anyBusy} onClick={() => setOpenDialog("ADVANCE")}>
              {nextState === "IN_FULFILLMENT" && "Move to In Fulfillment"}
              {nextState === "FULFILLED" && "Mark Fulfilled"}
              {nextState === "CLOSED" && "Close order"}
            </Button>
          )
        }
      />

      {openDialog === "ADVANCE" && (
        <ConfirmDialog
          title="Advance Sales Order"
          destructive={false}
          consequence={`This moves ${orderLabel} from ${view.state} to ${nextState}.`}
          confirmLabel="Advance"
          onConfirm={async () => {
            await runTransition("ADVANCE");
            await handleChanged();
          }}
          onClose={() => closeDialog("ADVANCE")}
          mapError={(err) => err?.outcome?.message ?? "The request could not be completed. Try again."}
        />
      )}

      {openDialog === "CANCEL" && (
        <ConfirmDialog
          title="Cancel Sales Order"
          consequence={`This cancels ${orderLabel}. It cannot be resumed from here.`}
          confirmLabel="Confirm cancel"
          cancelLabel="Keep order"
          onConfirm={async () => {
            await runTransition("CANCEL");
            await handleChanged();
          }}
          onClose={() => closeDialog("CANCEL")}
          mapError={(err) => err?.outcome?.message ?? "The request could not be completed. Try again."}
        />
      )}

      {openDialog === "ALLOCATE" && (
        <ConfirmDialog
          title="Allocate Sales Order"
          destructive={false}
          consequence={`This computes and records current availability against ${orderLabel}'s lines. It does not change pricing or quote terms.`}
          confirmLabel="Confirm allocate"
          onConfirm={async () => {
            await runAllocate();
            await handleChanged();
          }}
          onClose={() => setOpenDialog(null)}
          mapError={(err) => err?.outcome?.message ?? "The request could not be completed. Try again."}
        />
      )}

      {openDialog === "SERVICE" && (
        <ConfirmDialog
          title="Create Service"
          destructive={false}
          consequence={`This creates a Work Order to fulfill ${orderLabel}${hasPartLine ? " (run Allocate first if PART lines have not yet been allocated)" : ""}.`}
          confirmLabel="Confirm create Service"
          onConfirm={async () => {
            await runCreateService();
            await handleChanged();
          }}
          onClose={() => setOpenDialog(null)}
          mapError={(err) => err?.outcome?.message ?? "The request could not be completed. Try again."}
        />
      )}

      {!advanceAllowed && !cancelAllowed && !allocateAllowed && !serviceAllowed && (
        <p className="fo-muted">No further actions are available for a {view.state} Sales Order.</p>
      )}
    </>
  );
}
