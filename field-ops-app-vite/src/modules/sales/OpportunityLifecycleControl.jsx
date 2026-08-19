import { useState } from "react";
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
export default function OpportunityLifecycleControl({ row, readiness, transitions, onChanged }) {
  const [error, setError] = useState(null);
  const { stages, terminal } = stageProgress(row);
  const actions = allowedActions(row);
  const writeDisabled = !readiness.enabled;
  const closed = terminal != null;

  async function fire(intent, label) {
    setError(null);
    try {
      const outcome = await transitions.runTransition(intent);
      if (outcome.kind === "applied" || outcome.kind === "replayed") {
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
        onClick={disabled ? undefined : () => fire({ kind: "OUTCOME", outcome: o }, o === "WON" ? "Mark Won" : "Mark Lost")}
      >
        Mark {o === "WON" ? "Won" : "Lost"}
      </Button>
    );
  });

  return (
    <div className="fo-sales-detail__lifecycle">
      <LifecycleChevrons steps={steps} terminal={terminal} ariaLabel="Opportunity stage" />
      {closed ? (
        <p className="fo-muted">Closed — no further lifecycle actions.</p>
      ) : (
        outcomeButtons.length > 0 && <ActionRail secondary={<>{outcomeButtons}</>} />
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
