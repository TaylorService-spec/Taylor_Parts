import { Lock } from "lucide-react";
import Icon from "../Icon.jsx";

// Design-system foundation (PR 1) -- the button primitive. Six variants,
// full state matrix (default/hover/focus/pressed/loading/disabled/success/
// error), and a fixed layout box so `loading` never changes the button's
// width (the label is hidden with visibility, not removed -- it keeps
// reserving its layout space; see .fo-button__label / .fo-button--loading
// in index.css).
//
// This does NOT replace fo-btn-primary/fo-btn-ghost (Action Rail's existing
// primitive, 19 consumers) -- those are untouched. This is the fuller
// primitive new work should reach for; migrating existing call sites is a
// later PR's job, not this one's.
//
// `variant="protected"` never grants capability. It renders disabled with a
// lock icon and requires `reason` -- the caller explains why the action is
// unavailable (e.g. "Requires dispatcher role") rather than hiding the
// control. Capability enforcement stays entirely with the authorization
// layer; this primitive only presents its outcome.
const VARIANTS = ["primary", "secondary", "tertiary", "destructive", "protected", "icon"];

export default function Button({
  variant = "primary",
  children,
  icon: IconComp,
  iconPosition = "start",
  loading = false,
  success = false,
  error = false,
  disabled = false,
  reason,
  type = "button",
  className = "",
  ...rest
}) {
  const resolvedVariant = VARIANTS.includes(variant) ? variant : "primary";
  const isProtected = resolvedVariant === "protected";
  const isDisabled = disabled || loading || isProtected;

  const stateClass = success ? "fo-button--success" : error ? "fo-button--error" : "";
  const cls = [
    "fo-button",
    `fo-button--${resolvedVariant}`,
    loading ? "fo-button--loading" : "",
    stateClass,
    className,
  ].filter(Boolean).join(" ");

  const describedById = isProtected && reason ? `${rest.id || "fo-button"}-reason` : undefined;

  return (
    <>
      <button
        type={type}
        className={cls}
        disabled={isDisabled && !isProtected ? true : undefined}
        aria-disabled={isDisabled ? "true" : undefined}
        aria-busy={loading ? "true" : undefined}
        aria-describedby={describedById}
        {...rest}
      >
        <span className="fo-button__label">
          {isProtected ? (
            <Icon icon={Lock} size="button" />
          ) : (
            IconComp && iconPosition === "start" && <Icon icon={IconComp} size="button" />
          )}
          {children}
          {!isProtected && IconComp && iconPosition === "end" && <Icon icon={IconComp} size="button" />}
        </span>
        {loading && (
          <span className="fo-button__spinner" aria-hidden="true">
            <span className="fo-button__spinner-glyph" />
          </span>
        )}
      </button>
      {isProtected && reason ? (
        <p id={describedById} className="fo-button__protected-reason fo-muted" style={{ fontSize: "12px", margin: "4px 0 0" }}>
          {reason}
        </p>
      ) : null}
    </>
  );
}
