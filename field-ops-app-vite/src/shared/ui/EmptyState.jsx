// Issue #214 PR-4 -- shared application-state primitive. "No results" content for
// a page/collection. Deliberately has NO alert semantics (an empty result is not
// an error). `variant` distinguishes the two empties the behavior contract
// requires and must never conflate:
//   - "database"  -- nothing exists yet (create the first record);
//   - "filtered"  -- records exist but the current filters hide them all.
// `action` is an optional caller-supplied native button/link (keyboard-accessible).
//
// `guidance` (added by the contextual-help slice) is one or two plain sentences
// explaining WHY this collection exists and what causes a record to appear in it
// -- not how to click. It exists because a first-run `database` empty is the one
// moment a user is guaranteed not to know what the screen is for, and until now
// the app had no help affordance of any kind (repo-wide: zero Tooltip, zero
// Onboard, zero help usages across 464 source files).
//
// Scope rule, deliberately enforced here rather than left to callers: guidance
// renders for the "database" variant ONLY. A "filtered" empty means the user
// already has records and merely over-filtered -- explaining what a work order is
// at that moment is noise, and repeating it on every filter change is worse than
// silence. Callers may pass `guidance` unconditionally; this component decides.
export default function EmptyState({ title, message, guidance, action, variant = "database", className }) {
  const cls = ["fo-state", "fo-empty-state", `fo-empty-${variant}`, className].filter(Boolean).join(" ");
  const showGuidance = variant === "database" && guidance;
  return (
    <div className={cls} data-empty-variant={variant}>
      {title && <p className="fo-state-title">{title}</p>}
      {message && <p className="fo-muted fo-state-message">{message}</p>}
      {showGuidance ? <p className="fo-state-guidance" data-state-guidance="">{guidance}</p> : null}
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
