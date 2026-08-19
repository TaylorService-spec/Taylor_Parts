import StatusPill from "./StatusPill.jsx";
import CompactMetric from "./primitives/CompactMetric.jsx";

// Peer Operational Card (Wave-4 composition primitive) — the ONE shared card for a meaningful,
// bounded peer object in a browseable collection: a truck, a work order, a part, an equipment
// unit, a technician, an operational exception. It is NOT a page root, a generic section
// wrapper, or a substitute for a table/form/context-band/detail-region — those stay on
// WorkspaceShell/ContextBand/dense tables. Nesting this card inside itself to manufacture
// hierarchy is the anti-pattern it exists to retire.
//
// Two mutually exclusive interaction modes, chosen by which prop is supplied:
//   onSelect  -> the WHOLE card is one <button> (peer-object browsing: click a card to open it).
//                No `actions` in this mode -- a button cannot contain another interactive
//                element without violating HTML nesting rules and screen-reader semantics.
//   actions   -> the card is a plain, non-interactive <article>; the supplied actions (their own
//                <button>/<a> elements) render in a footer row OUTSIDE any interactive wrapper.
// Passing both is a caller error; onSelect wins and actions are dropped structurally, so
// production never silently ships nested interactive elements either way.
//
// state: "ready" (default) | "loading" | "unavailable" | "disabled" — loading/unavailable
// replace the body with an honest placeholder rather than rendering stale or fabricated
// content; disabled keeps the content visible but suppresses the interaction (aria-disabled,
// no click) rather than hiding a card the operator otherwise expects to see. `actions` render
// ONLY in the "ready" state -- a loading/unavailable card has no confirmed object to act on,
// and a disabled card's whole point is that no action should be executable, so its own
// action buttons must not stay live either.
//
// density: "comfortable" (default) | "compact" | "field" | "warehouse" — a data-attribute the
// CSS keys off, matching WorkspaceShell's own density convention (shared/ui/WorkspaceShell.jsx)
// so a page's density choice can flow into its cards uniformly.
const STATES = new Set(["ready", "loading", "unavailable", "disabled"]);

export default function OperationalCard({
  title,
  subtitle = null, // optional muted line under the title (e.g. "who/where" for the object)
  status = null, // { tone, label } — rendered via StatusPill; omit when the object has no status
  metadata = [], // [{ key, label, value }] compact operational metadata, dt/dd pairs
  metric = null, // { label, value } — one prominent primary metric, distinct from metadata rows
  attention = null, // optional exception/attention text or node, shown above metadata
  footer = null, // optional trailing muted note (e.g. "last reconciled …")
  state = "ready",
  selected = false,
  density = "comfortable",
  onSelect = null,
  actions = null,
  unavailableMessage = "Unavailable",
  loadingMessage = "Loading…",
  className = "",
  children,
  ...rest
}) {
  const resolvedState = STATES.has(state) ? state : "ready";
  const selectable = typeof onSelect === "function";
  const disabled = resolvedState === "disabled";
  const isLoading = resolvedState === "loading";
  const isUnavailable = resolvedState === "unavailable";
  // Selectable mode owns the whole card as one interactive element -- actions would nest a
  // second interactive element inside it, so they are dropped rather than silently rendered.
  // Non-ready states drop actions too: loading/unavailable have no confirmed object to act on,
  // and disabled means nothing on the card -- including its own actions -- should be executable.
  const resolvedActions = selectable || resolvedState !== "ready" ? null : actions;

  const classes = [
    "fo-op-card",
    selectable && "fo-op-card--selectable",
    selected && "fo-op-card--selected",
    disabled && "fo-op-card--disabled",
    isLoading && "fo-op-card--loading",
    isUnavailable && "fo-op-card--unavailable",
    attention && !isLoading && !isUnavailable && "fo-op-card--attention",
    className,
  ].filter(Boolean).join(" ");

  const body = isLoading ? (
    <p className="fo-op-card__placeholder" role="status" aria-live="polite">{loadingMessage}</p>
  ) : isUnavailable ? (
    <p className="fo-op-card__placeholder">{unavailableMessage}</p>
  ) : (
    <>
      {/* State-before-text: the status indicator is the FIRST thing in the head, ahead of the
          identity line, so an operator's eye lands on "what state is this" before "what is
          this" -- the scan order the design brief calls for. The title then owns the remaining
          width as a single, non-wrapping identity line (ellipsis rather than a second line,
          which would fight the status indicator for vertical space). */}
      <div className="fo-op-card__head" style={{ gap: "var(--space-2)" }}>
        {status && (
          <StatusPill tone={status.tone ?? "unknown"} asText={status.asText} label={status.label} />
        )}
        {title != null && (
          <span
            className="fo-op-card__title"
            style={{
              fontSize: "var(--font-size-md)",
              fontWeight: "var(--font-weight-semibold)",
              lineHeight: "var(--line-height-tight)",
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
        )}
      </div>

      {subtitle && <div className="fo-op-card__subtitle">{subtitle}</div>}

      {attention && <div className="fo-op-card__attention">{attention}</div>}

      {/* Primary metric routes through the shared CompactMetric primitive (tabular numerals
          baked in) instead of ad hoc markup, so a card's one headline number lines up with
          every other compact metric in the system. */}
      {metric && (
        <div className="fo-op-card__metric" style={{ display: "block" }}>
          <CompactMetric value={metric.value} label={metric.label} />
        </div>
      )}

      {/* Scannable body: metadata values are tabular-numeral so a column of figures (qty,
          value, counts) lines up digit-for-digit instead of jittering with proportional
          numerals. */}
      {metadata.length > 0 && (
        <dl className="fo-op-card__metadata">
          {metadata.map((m, i) => (
            <div className="fo-op-card__metadata-item" key={m.key ?? i}>
              <dt>{m.label}</dt>
              <dd className="fo-tabular-nums">{m.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {footer && <div className="fo-op-card__foot">{footer}</div>}
    </>
  );

  if (selectable) {
    return (
      <div className="fo-op-card-wrap">
        <button
          {...rest}
          type="button"
          className={classes}
          data-density={density}
          onClick={disabled || isLoading || isUnavailable ? undefined : onSelect}
          disabled={disabled}
          aria-pressed={selected || undefined}
          aria-busy={isLoading || undefined}
        >
          {body}
        </button>
      </div>
    );
  }

  return (
    <article
      {...rest}
      className={classes}
      data-density={density}
      aria-disabled={disabled || undefined}
      aria-busy={isLoading || undefined}
    >
      {body}
      {resolvedActions && <div className="fo-op-card__actions">{resolvedActions}</div>}
    </article>
  );
}

// Layout-only wrapper for a collection of OperationalCards — a responsive grid, never itself a
// card. Kept here (rather than duplicated per adopter) so every peer-object grid recomposes the
// same way at every width.
export function OperationalCardGrid({ children, className = "", ...rest }) {
  return (
    <ul className={`fo-op-card-grid ${className}`.trim()} {...rest}>
      {children}
    </ul>
  );
}
