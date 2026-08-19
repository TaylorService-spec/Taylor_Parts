// Issue #214 PR-4 -- shared application-state primitive. A page/collection load
// failure or a not-found. role="alert" so assistive tech announces that the
// requested content can't be shown. `message` MUST already be safe, categorized
// copy (build it with domain/loadErrorMessage.js) -- this component never receives
// or renders a raw Firebase error, code, path, id, or stack. `action` is an
// optional caller-supplied native retry/back button/link. For FORM failures use
// FormError; this is for whole-page/collection failures.
//
// Design-system foundation (PR 1) -- `icon` is a new, OPTIONAL prop (a lucide
// icon component). Omitted, this renders exactly as before -- no existing
// consumer's output changes. Passed, it renders through Icon.jsx + the new
// .fo-state--iconic layout, for callers that want the icon+text+colour
// treatment described in the design-system brief.
import Icon from "./Icon.jsx";

export default function FailureState({ title, message, action, icon, className }) {
  const cls = ["fo-state", "fo-failure-state", icon ? "fo-state--iconic fo-state--error" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="alert">
      {icon && <Icon icon={icon} size="empty" />}
      {title && <p className="fo-state-title">{title}</p>}
      <p className="fo-warning fo-state-message">{message}</p>
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
