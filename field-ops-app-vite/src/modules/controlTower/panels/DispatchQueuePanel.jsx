import { Link } from "react-router-dom";
import { Button } from "../../../shared/ui/primitives/index.js";
import { SERVICE_OPS_LINKS } from "../../../domain/serviceOperationsNorthStar";

// The suggestion tray — the page's ONE suggestion slot (grammar: AI/derived suggestion is a
// contextual intervention, never a destination, and never more than one band per surface).
//
// Rows come from domain/serviceOperationsNorthStar.js's dispatchSuggestions(), which composes
// domain/dispatchScoring.js's computeDispatchRecommendations(). This file ranks nothing.
//
// SO-G4 — READ-ONLY, AND IT SAYS SO. Assigning a technician is a governed command that exists on the
// Dispatch Board and the Dispatch queue, not here. The footer is not a disclaimer bolted on: a
// recommendation that cannot be accepted where it is shown has to say where it can be, or it reads as
// a broken button. Every row links to the board; none of them acts.
//
// The ruled panel (.ns-section--panel) is the grammar's third structural element, admitted for
// editors, dialogs and suggestion bands only — this is the suggestion-band case, and it is why the
// tray is allowed a surface when the tables around it are not.
export default function DispatchQueuePanel({
  suggestions,
  collapsed = false,
  onToggleCollapsed,
}) {
  const rows = suggestions?.rows ?? [];
  const openCount = suggestions?.openCount ?? 0;
  const placeableCount = suggestions?.placeableCount ?? 0;

  // Nothing awaiting dispatch means no suggestion to make. The tray is absent rather than empty --
  // a clean day should not carry a band explaining that it has nothing to say.
  if (rows.length === 0) return null;

  return (
    <section className="ns-section ns-section--panel" aria-label="Recommended dispatch">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Recommended dispatch</h2>
        <span className="ns-section__meta">
          {openCount} open · {placeableCount} placeable
        </span>
        <div className="ns-section__actions">
          <Button variant="tertiary" onClick={() => onToggleCollapsed?.(!collapsed)}>
            {collapsed ? "Show" : "Collapse"}
          </Button>
        </div>
      </div>

      {!collapsed ? (
        <div className="ns-section__body">
          <ul className="ns-suggestion__list">
            {rows.map((row) => (
              <li key={row.id} className="ns-suggestion__row">
                <span className="ns-suggestion__fact">
                  <strong>{row.reference}</strong>
                  {row.technicianName ? (
                    <>
                      {" → "}
                      {row.technicianName}
                      <span className="ns-muted"> (score {row.score})</span>
                      {row.reasons.length > 0 ? (
                        <span className="ns-muted"> · {row.reasons.join(" · ")}</span>
                      ) : null}
                    </>
                  ) : (
                    // Why there is no candidate is the useful half of a no-candidate row. Stating
                    // "no eligible technician" without it just moves the question.
                    <span className="ns-muted"> · No eligible technician for this work order</span>
                  )}
                </span>
                <Link to={row.href}>Review on board →</Link>
              </li>
            ))}
          </ul>
          <p className="ns-table__note">
            Suggestions are read-only here. Assignment is the governed command on the{" "}
            <Link to={SERVICE_OPS_LINKS.dispatcherBoard}>Dispatch Board</Link>.
          </p>
        </div>
      ) : null}
    </section>
  );
}
