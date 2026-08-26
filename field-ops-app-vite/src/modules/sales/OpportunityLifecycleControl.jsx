import { useState } from "react";
import { Link } from "react-router-dom";
import LifecycleChevrons from "../../shared/ui/LifecycleChevrons.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { allowedActions, stageProgress } from "../../domain/opportunityLifecycle.js";

// The Opportunity-specific lifecycle progression control: a persistent chevron row over the ratified stage
// vocabulary (domain/opportunityLifecycle.js's stageProgress — completed/current/future + a WON/LOST
// terminal badge), plus the WON/LOST decision actions. Business rules for WHICH transition is legal live
// entirely in the domain (allowedActions), never here or in the generic LifecycleChevrons component: this
// component only reads that decision and wires the ONE legal "advance" step (if any) to a click handler,
// and renders WON/LOST as separate action buttons (an outcome is a decision, not a step in the stage row).
//
// `transitions` is a hooks/useOpportunityTransitions(row.id) result (or a test double with the same shape:
// { pending, runTransition, ... }). `readiness` is the write-readiness seam's result. `onChanged` is called
// after ANY applied/replayed transition so the caller re-reads authoritatively (App-level refetch) — this
// component never patches row state itself.
//
// ════════════════════ `slot` -- WHERE EACH CONTROL RENDERS, NEVER WHAT IS LEGAL ════════════════════
//
//   "all" (default)  the workspace detail pane: chevrons and outcome buttons together, exactly as
//                    this component has always rendered them.
//   "chevrons"       the North Star P1v2 record page's stage row. P1v2 puts the chevrons directly
//                    under the header and the outcome actions IN the header cluster, so the page
//                    mounts this component twice, once per slot.
//   "actions"        that header cluster: Mark Won / Mark Lost, the Won acknowledgement, and the
//                    write-readiness reason.
//
// TWO MOUNTS, ONE COMMAND PATH. The page owns the `transitions` object (useOpportunityTransitions)
// and passes the SAME one into both slots, so both share a single idempotency cache and a single
// invocation of the governed command. Nothing about legality is per-slot: `allowedActions` decides
// what may be offered, and it is consulted identically in both.
//
// At earlier stages the ADVANCE chevron is itself the primary action -- P1v2: "the advance chevron
// IS the primary" -- so the actions slot offers no advance button. Mark Won appears only at
// Decision, because that is the only place the engine permits it.
export default function OpportunityLifecycleControl({ row, readiness, transitions, onChanged, slot = "all" }) {
  const [error, setError] = useState(null);
  // What the Won actually PRODUCED. Marking an Opportunity Won creates a Sales Order in the same
  // transaction, and until now the control discarded that fact entirely: the chevrons flipped to
  // "Closed", and the single most consequential moment in the sales process reported nothing. The
  // user had to go and find the order they had just created, with no evidence it existed.
  //
  // Held in local state rather than read from `row`, because it is available IMMEDIATELY -- the
  // command returns it -- whereas `row` only carries it after the refetch lands. `row` remains
  // the durable source once it does (the ContextBand's Sales Order fact), so this is the
  // acknowledgement, not the record.
  const [won, setWon] = useState(null);
  const { stages, terminal } = stageProgress(row);
  const actions = allowedActions(row);
  const writeDisabled = !readiness.enabled;
  const closed = terminal != null;

  async function fire(intent, label) {
    setError(null);
    try {
      const outcome = await transitions.runTransition(intent);
      if (outcome.kind === "applied" || outcome.kind === "replayed") {
        if (intent.outcome === "WON" && outcome.salesOrderId) {
          setWon({
            salesOrderId: outcome.salesOrderId,
            salesOrderNumber: outcome.salesOrderNumber ?? null,
            // `recovered` means the Opportunity was already WON and its order was found rather
            // than created. Said plainly instead of claiming a creation that did not happen.
            recovered: outcome.recovered === true,
          });
        }
        onChanged?.();
      } else {
        setError(outcome.message ?? `${label} could not be completed.`);
      }
    } catch (err) {
      setError(err?.outcome?.message ?? `${label} could not be completed. Try again.`);
    }
  }

  const steps = stages.map((s) => {
    if (actions.advanceTo !== s.key) return { ...s };
    const pendingKey = `ADVANCE:${s.key}`;
    const isPending = !!transitions.pending[pendingKey];
    const actionable = !writeDisabled && !isPending;
    return {
      ...s,
      // The one legal next step reads as a call-to-action ("Advance to X"), not a bare stage name — it is
      // the only chevron step that is ever a clickable button.
      label: `Advance to ${s.label}`,
      actionable,
      disabledReason: writeDisabled ? readiness.reason : isPending ? "Advancing…" : undefined,
      onActivate: () => fire({ kind: "ADVANCE", toStage: s.key }, `Advance to ${s.label}`),
    };
  });

  const outcomeButtons = actions.outcomes.map((o) => {
    const pendingKey = `OUTCOME:${o}`;
    const isPending = !!transitions.pending[pendingKey];
    const disabled = writeDisabled || isPending;
    return (
      <Button
        key={o}
        type="button"
        variant={writeDisabled ? "protected" : "tertiary"}
        disabled={disabled}
        title={writeDisabled ? readiness.reason : undefined}
        reason={writeDisabled ? readiness.reason : undefined}
        onClick={
          disabled
            ? undefined
            : () =>
                fire(
                  // WON carries the Sales Order it will create: that order needs its own
                  // owner and channel, and they come from the Opportunity being closed.
                  // The server still derives account and lines itself -- these two are the
                  // only things it cannot infer. LOST carries neither, because it creates
                  // nothing.
                  o === "WON"
                    ? { kind: "OUTCOME", outcome: o, ownerEmployeeId: row.ownerEmployeeId, salesChannel: row.channel }
                    : { kind: "OUTCOME", outcome: o },
                  o === "WON" ? "Mark Won" : "Mark Lost",
                )
        }
      >
        Mark {o === "WON" ? "Won" : "Lost"}
      </Button>
    );
  });

  const showChevrons = slot === "all" || slot === "chevrons";
  const showActions = slot === "all" || slot === "actions";

  return (
    <div className="fo-sales-detail__lifecycle" data-slot={slot}>
      {showChevrons ? (
        <LifecycleChevrons steps={steps} terminal={terminal} ariaLabel="Opportunity stage" />
      ) : null}
      {showActions && won && (
        <p className="fo-sales-lifecycle-won" role="status">
          {won.recovered ? "This Opportunity was already won. Its Sales Order is " : "Won. Sales Order "}
          {/* THE REFERENCE, OR THE ABSENCE OF ONE -- never the document id (DECISIONS #106, R03).
              This read `won.salesOrderNumber ?? won.salesOrderId`, so an order created from an
              Opportunity whose numbering had not resolved printed a raw Firestore id as the link
              text of the most consequential message in the sales process. The link still works;
              only the label changes, because a routing key is not a name. */}
          <Link to={`/customers/opportunities/sales-order/${won.salesOrderId}`}>
            {won.salesOrderNumber ?? "the new order (reference unavailable)"}
          </Link>
          {won.recovered ? "." : " was created."}
        </p>
      )}
      {showActions && (closed ? (
        <p className="fo-muted">Closed — no further lifecycle actions.</p>
      ) : (
        outcomeButtons.length > 0 && <ActionRail secondary={<>{outcomeButtons}</>} />
      ))}
      {showActions && !closed && writeDisabled && <p className="fo-sales-lifecycle-note fo-muted">{readiness.reason}</p>}
      {error && (
        <p className="fo-sales-lifecycle-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
