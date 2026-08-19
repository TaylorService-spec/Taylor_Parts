import { useId } from "react";
import Icon from "../Icon.jsx";

// Design-system foundation (PR 1) -- icon-only control with a MANDATORY
// accessible label, a visible tooltip (not just a title attribute -- shows on
// hover AND keyboard focus), a visible focus ring, and a 44x44 minimum touch
// target (the 40px visual box sits inside a 44px hit area via min-width/
// min-height in index.css). `label` is required; there is no icon-only
// escape hatch that skips it.
export default function IconButton({ icon: IconComp, label, disabled = false, className = "", ...rest }) {
  const tooltipId = useId();
  if (!label) {
    // Fail loudly in development rather than silently shipping an unlabeled
    // control -- an icon-only button with no accessible name is a WCAG 4.1.2
    // failure, not a style choice.
    if (typeof console !== "undefined" && import.meta.env?.DEV) {
      console.error("IconButton: `label` is required (accessible name + visible tooltip).");
    }
  }
  return (
    <button
      type="button"
      className={["fo-icon-button", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-describedby={tooltipId}
      disabled={disabled}
      {...rest}
    >
      <Icon icon={IconComp} size="button" />
      <span className="fo-icon-button__tooltip" role="tooltip" id={tooltipId}>
        {label}
      </span>
    </button>
  );
}
