import Icon from "./Icon.jsx";
import { stepIcon, toneIcon } from "./tone.js";

// Generic horizontal stage-progression control ("chevrons"). Deliberately BUSINESS-RULE-FREE: it renders
// whatever step list + optional terminal badge it is handed and knows nothing about Opportunity, stage
// names, or transition legality — that logic lives in the domain layer of whichever workspace uses it
// (today: domain/opportunityLifecycle.js's stageProgress/allowedActions, consumed by
// modules/sales/OpportunityLifecycleControl.jsx). Reusable anywhere else a workspace needs the same
// "completed / current / future (+ terminal outcome)" progression visual.
//
// Each step: { key, label, status: "complete"|"current"|"future", actionable?, onActivate?, disabledReason? }.
// A step with `onActivate` renders as a button (clickable only when `actionable`); one without renders as
// plain text — so a caller can offer exactly ONE legal next action without this component knowing why.
// `terminal`: { key, label, tone } | null — an appended badge for a closed/terminal outcome (e.g. Won/Lost).
//
// Every step's colour (complete/current/future, via CSS) is paired with a glyph from tone.js's
// shared STEP_ICONS — a check for done, a filled ring for current, a hollow ring for not-yet — the
// same glyph set StageProgressTrack uses, so the two controls speak one visual language.
const LABEL_STYLE = { display: "inline-flex", alignItems: "center", gap: "4px" };

export default function LifecycleChevrons({ steps, terminal = null, ariaLabel }) {
  return (
    <ol className="fo-chevrons" aria-label={ariaLabel}>
      {(steps ?? []).map((step) => (
        <li
          key={step.key}
          className={`fo-chevrons__step is-${step.status}`}
          aria-current={step.status === "current" ? "step" : undefined}
        >
          {typeof step.onActivate === "function" ? (
            <button
              type="button"
              className="fo-chevrons__btn"
              style={LABEL_STYLE}
              disabled={!step.actionable}
              title={!step.actionable ? step.disabledReason : undefined}
              onClick={step.onActivate}
            >
              <Icon icon={stepIcon(step.status)} size="dense" />
              {step.label}
            </button>
          ) : (
            <span className="fo-chevrons__label" style={LABEL_STYLE}>
              <Icon icon={stepIcon(step.status)} size="dense" />
              {step.label}
            </span>
          )}
        </li>
      ))}
      {terminal && (
        <li
          className={`fo-chevrons__terminal fo-chevrons__terminal--${terminal.tone}`}
          style={LABEL_STYLE}
          key={terminal.key}
        >
          <Icon icon={toneIcon(terminal.tone)} size="dense" />
          {terminal.label}
        </li>
      )}
    </ol>
  );
}
