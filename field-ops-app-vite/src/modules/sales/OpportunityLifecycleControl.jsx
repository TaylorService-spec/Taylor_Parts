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
// ════════════════════ `variant` -- WHERE THE PROGRESSION IS DRAWN, NEVER WHAT IS LEGAL ════════════════════
//
//   "chevrons" (default) the workspace detail pane. This component draws the progression itself, because
//                        nothing else on that surface does.
//   "actions"            the North Star record page, which draws the spine as a LifecycleBand from the SAME
//                        stageProgress derivation. Rendering the chevrons there too would put two
//                        progressions for one deal on one page -- the NS-P4 defect the migration exists to
//                        remove -- so the chevrons are suppressed and the one legal advance becomes a
//                        button in the header action cluster (North Star pattern 6: actions belong at the
//                        right end of the header, never scattered through body sections).
//
// It changes RENDERING ONLY. `allowedActions` still decides what is legal, the same single `fire()` path
// still invokes the same governed command, and the capability/readiness gate is untouched: there is exactly
// one way to transition an Opportunity from the UI in either variant.
export default function OpportunityLifecycleControl({ row, readiness, transitions, onChanged, variant = "chevrons" }) {
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

  // The one legal advance, as a BUTTON rather than a chevron step. Built from the same `steps`
  // entry so the label, the pending state and the disabled reason are the ones the chevron would
  // have carried -- not a second reading of the same rules.
  const advanceStep = steps.find((s) => s.actionable != null) ?? null;
  const advanceButton = advanceStep ? (
    <Button
      type="button"
      variant={advanceStep.actionable ? "primary" : "protected"}
      disabled={!advanceStep.actionable}
      title={advanceStep.disabledReason}
      reason={advanceStep.disabledReason}
      onClick={advanceStep.actionable ? advanceStep.onActivate : undefined}
    >
      {advanceStep.label}
    </Button>
  ) : null;

  return (
    <div className="fo-sales-detail__lifecycle">
      {variant === "actions" ? null : (
        <LifecycleChevrons steps={steps} terminal={terminal} ariaLabel="Opportunity stage" />
      )}
      {won && (
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
      {closed ? (
        <p className="fo-muted">Closed — no further lifecycle actions.</p>
      ) : (
        (outcomeButtons.length > 0 || (variant === "actions" && advanceButton)) && (
          <ActionRail
            // ONE FILLED PRIMARY = the likeliest next state transition (North Star action
            // architecture). Advancing a stage is that; WON and LOST are decisions and stay
            // outlined. In the chevron variant the advance is the chevron, so the rail carries
            // secondaries only, exactly as it did before.
            primary={variant === "actions" ? advanceButton : undefined}
            secondary={outcomeButtons.length > 0 ? <>{outcomeButtons}</> : undefined}
          />
        )
      )}
      {!closed && writeDisabled && <p className="fo-sales-lifecycle-note fo-muted">{readiness.reason}</p>}
      {error && (
        <p className="fo-sales-lifecycle-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
