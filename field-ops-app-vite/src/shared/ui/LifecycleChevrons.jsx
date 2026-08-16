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
              disabled={!step.actionable}
              title={!step.actionable ? step.disabledReason : undefined}
              onClick={step.onActivate}
            >
              {step.label}
            </button>
          ) : (
            <span className="fo-chevrons__label">{step.label}</span>
          )}
        </li>
      ))}
      {terminal && (
        <li className={`fo-chevrons__terminal fo-chevrons__terminal--${terminal.tone}`} key={terminal.key}>
          {terminal.label}
        </li>
      )}
    </ol>
  );
}
