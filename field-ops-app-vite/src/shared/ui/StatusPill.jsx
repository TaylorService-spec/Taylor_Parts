import { toneClass } from "./tone.js";

// The ONE Semantic Status Pill (Wave-0 composition primitive). Takes a SEMANTIC TONE + a label; a domain
// supplies the tone via its own state->tone map, so "attention always looks like attention" across every
// surface. Deliberately minimal: it does not know domain vocabulary and it is not a badge-per-field default.
//
// Use a pill ONLY where a state must scan at a glance. Where the status is not a scan target, prefer plain
// text (`asText`) — avoid interfaces covered in coloured pills.
export default function StatusPill({ tone = "neutral", label, children, asText = false, className = "", ...rest }) {
  const content = label ?? children;
  if (asText) {
    return <span className={`fo-status-text ${toneClass(tone, "fo-tone-text")} ${className}`.trim()} {...rest}>{content}</span>;
  }
  return (
    <span className={`fo-status-pill ${toneClass(tone, "fo-status-pill")} ${className}`.trim()} {...rest}>
      {content}
    </span>
  );
}
