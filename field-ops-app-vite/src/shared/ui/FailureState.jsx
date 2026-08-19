// Issue #214 PR-4 -- shared application-state primitive. A page/collection load
// failure or a not-found. role="alert" so assistive tech announces that the
// requested content can't be shown. `message` MUST already be safe, categorized
// copy (build it with domain/loadErrorMessage.js) -- this component never receives
// or renders a raw Firebase error, code, path, id, or stack. `action` is an
// optional caller-supplied native retry/back button/link. For FORM failures use
// FormError; this is for whole-page/collection failures.
//
// Visual-states migration -- failure states now carry an icon by default,
// through the same `.fo-state--iconic` + `.fo-state--error` treatment the
// design-system foundation PR added to index.css (danger-coloured glyph). The
// icon is deliberately generic (AlertTriangle) because this component covers
// both "could not load" and "not authorized" -- the distinguishing fact belongs
// in the caller's `title`/`message` copy, not in icon choice. Pass `icon={null}`
// to opt a caller back out to the bare text-only rendering; no existing prop
// changes shape.
import Icon from "./Icon.jsx";
import { AlertTriangle } from "lucide-react";

export default function FailureState({ title, message, action, icon, className }) {
  const resolvedIcon = icon === undefined ? AlertTriangle : icon;
  const cls = ["fo-state", "fo-failure-state", resolvedIcon ? "fo-state--iconic fo-state--error" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} role="alert">
      {resolvedIcon && <Icon icon={resolvedIcon} size="empty" />}
      {title && <p className="fo-state-title">{title}</p>}
      <p className="fo-warning fo-state-message">{message}</p>
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
