import { CheckCircle2, AlertTriangle, XCircle, Info, HelpCircle, MinusCircle } from "lucide-react";
import Icon from "../Icon.jsx";
import { isTone, toneClass } from "../tone.js";

// Design-system foundation (PR 1) -- icon + text + colour, always together.
// Reuses the SAME semantic tone vocabulary as StatusPill (shared/ui/tone.js)
// so a tone means one thing everywhere; this is the standalone-line form
// (a sync state, a connection state), where StatusPill is the inline/table
// form. One glyph per tone -- never variable, so the icon itself is a
// reliable second channel alongside colour and text (never colour alone).
const TONE_ICONS = {
  positive: CheckCircle2,
  attention: AlertTriangle,
  critical: XCircle,
  info: Info,
  unknown: HelpCircle,
  neutral: HelpCircle,
  muted: MinusCircle,
};

export default function StatusIndicator({ tone = "neutral", label, children, className = "", ...rest }) {
  const resolvedTone = isTone(tone) ? tone : "neutral";
  const content = label ?? children;
  const IconComp = TONE_ICONS[resolvedTone];
  return (
    <span className={`fo-status-indicator ${toneClass(resolvedTone, "fo-status-indicator")} ${className}`.trim()} {...rest}>
      <Icon icon={IconComp} size="dense" />
      <span>{content}</span>
    </span>
  );
}
