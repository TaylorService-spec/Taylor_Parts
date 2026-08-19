import Icon from "./Icon.jsx";
import { toneClass, toneIcon } from "./tone.js";

// The ONE Semantic Status Pill (Wave-0 composition primitive). Takes a SEMANTIC TONE + a label; a domain
// supplies the tone via its own state->tone map, so "attention always looks like attention" across every
// surface. Deliberately minimal: it does not know domain vocabulary and it is not a badge-per-field default.
//
// Use a pill ONLY where a state must scan at a glance. Where the status is not a scan target, prefer plain
// text (`asText`) — avoid interfaces covered in coloured pills.
//
// Every tone carries its own glyph (tone.js's TONE_ICONS) alongside its colour — a state must never be
// encoded in colour alone, or it disappears for a colour-blind reader or on a greyscale/low-contrast field
// device. Same glyph set primitives/StatusIndicator.jsx uses, so a tone looks the same everywhere it renders.
export default function StatusPill({ tone = "neutral", label, children, asText = false, className = "", ...rest }) {
  const content = label ?? children;
  const IconComp = toneIcon(tone);
  if (asText) {
    return (
      <span className={`fo-status-text ${toneClass(tone, "fo-tone-text")} ${className}`.trim()} {...rest}>
        <Icon icon={IconComp} size="dense" />
        {" "}
        {content}
      </span>
    );
  }
  return (
    <span className={`fo-status-pill ${toneClass(tone, "fo-status-pill")} ${className}`.trim()} {...rest}>
      <Icon icon={IconComp} size="dense" />
      {content}
    </span>
  );
}
