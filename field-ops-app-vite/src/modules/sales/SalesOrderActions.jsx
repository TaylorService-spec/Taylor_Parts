import { useState } from "react";
import { useSalesOrderActions } from "../../hooks/useSalesOrderActions.js";
import { canAdvance, canCancel, canAllocate, canCreateService, nextAdvanceState } from "../../domain/salesOrderActions.js";
import {
  SALES_ORDER_WRITE_CAPABILITY,
  SALES_ORDER_FULFILL_CAPABILITY,
  SALES_ORDER_SERVICE_CAPABILITY,
  SALES_ORDER_WRITE_DISABLED_REASON,
} from "../../access/salesOrderCapabilityAccess.js";
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
// Every offered action is gated by TWO independent checks: (1) a CLIENT MIRROR of the backend's own
// STATE precondition (domain/salesOrderActions.js) that decides whether the action is offered AT ALL
// for this Sales Order's current lifecycle state, and (2) the REAL trusted write-CAPABILITY signal
// (`hasCapability`, fed from access/useSalesOrderCapabilities.js's resolveEffectiveAccessCallable
// feed) that decides whether an already-offered action renders LIVE or PROTECTED+disabled+honest.
// This closes the known defect where a principal holding salesOrder.read but not salesOrder.write/
// .fulfill/.service (salesManager, accountingManager, financeManager) saw fully live buttons and only
// learned they were unauthorized after confirming and hitting the server's denial. `hasCapability`
// defaults to fail-closed (denies every capability) when the caller does not inject the real signal --
// same posture as access/opportunityWriteReadiness.js -- so an action is NEVER rendered live unless a
// real grant says so. The state mirror remains UX ONLY regardless: the server re-checks every
// precondition and remains the sole authority (see domain/salesOrderActions.js's header for the one
// documented state-mirror gap).
//
// A successful action calls `onChanged()` (the caller's useSalesOrder().refetch) so the page shows
// the SERVER's new state -- this component never fabricates the post-action state itself.
export default function SalesOrderActions({ view, onChanged, actionDeps, hasCapability }) {
  const { pending, runTransition, runAllocate, runCreateService, discardTransitionIntent } = useSalesOrderActions(view.id, actionDeps);
  const [openDialog, setOpenDialog] = useState(null); // null | "ADVANCE" | "CANCEL" | "ALLOCATE" | "SERVICE"

  const checkCapability = hasCapability ?? (() => false); // fail-closed default -- see header
  const writeGranted = checkCapability(SALES_ORDER_WRITE_CAPABILITY); // Advance + Cancel (transitionSalesOrder)
  const fulfillGranted = checkCapability(SALES_ORDER_FULFILL_CAPABILITY); // Allocate
  const serviceGranted = checkCapability(SALES_ORDER_SERVICE_CAPABILITY); // Create Service

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
              <Button
                type="button"
                variant={fulfillGranted ? "secondary" : "protected"}
                reason={fulfillGranted ? undefined : SALES_ORDER_WRITE_DISABLED_REASON}
                disabled={anyBusy}
                onClick={fulfillGranted ? () => setOpenDialog("ALLOCATE") : undefined}
              >
                Allocate
              </Button>
            )}
            {serviceAllowed && (
              <Button
                type="button"
                variant={serviceGranted ? "secondary" : "protected"}
                reason={serviceGranted ? undefined : SALES_ORDER_WRITE_DISABLED_REASON}
                disabled={anyBusy}
                onClick={serviceGranted ? () => setOpenDialog("SERVICE") : undefined}
              >
                Create Service
              </Button>
            )}
            {cancelAllowed && (
              <Button
                type="button"
                variant={writeGranted ? "destructive" : "protected"}
                reason={writeGranted ? undefined : SALES_ORDER_WRITE_DISABLED_REASON}
                disabled={anyBusy}
                onClick={writeGranted ? () => setOpenDialog("CANCEL") : undefined}
              >
                Cancel order
              </Button>
            )}
          </>
        }
        primary={
          advanceAllowed && (
            <Button
              type="button"
              variant={writeGranted ? "primary" : "protected"}
              reason={writeGranted ? undefined : SALES_ORDER_WRITE_DISABLED_REASON}
              disabled={anyBusy}
              onClick={writeGranted ? () => setOpenDialog("ADVANCE") : undefined}
            >
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
