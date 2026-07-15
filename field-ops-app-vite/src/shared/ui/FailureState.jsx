// Issue #214 PR-4 -- shared application-state primitive. A page/collection load
// failure or a not-found. role="alert" so assistive tech announces that the
// requested content can't be shown. `message` MUST already be safe, categorized
// copy (build it with domain/loadErrorMessage.js) -- this component never receives
// or renders a raw Firebase error, code, path, id, or stack. `action` is an
// optional caller-supplied native retry/back button/link. For FORM failures use
// FormError; this is for whole-page/collection failures.
export default function FailureState({ title, message, action, className }) {
  const cls = ["fo-state", "fo-failure-state", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="alert">
      {title && <p className="fo-state-title">{title}</p>}
      <p className="fo-warning fo-state-message">{message}</p>
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
