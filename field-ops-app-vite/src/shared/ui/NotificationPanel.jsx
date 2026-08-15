import { useState } from "react";
import { Link } from "react-router-dom";
import FailureState from "./FailureState";
import StatusPill from "./StatusPill.jsx";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Minimal
// (Version 0.1) notification experience: Header -> Notification Panel
// -> Open Notification -> Inventory Request (no separate "My Work" view,
// no new route -- each entry links to the existing /inventory/:partId
// route). Purely presentational: AppHeader.jsx supplies the data.
//
// Wave 6 -- transitional bell migration (blueprint §14e-7 step 2, Owner directive §17).
// This panel now renders ONE normalized `items` list (domain/partsAttentionProjection.js's
// Attention Items, grouped by AppHeader into the same four section labels this panel has
// always shown), instead of four independently-labeled arrays each re-deriving its own
// status filter inline. Same underlying business visibility, same deep links, same order --
// the bell no longer reconstructs its own status-filter logic; it consumes the ONE shared
// projection Parts -> WORK will eventually share too. This remains transitional (still no
// new persistence, still no separate resolution workflow) -- NOT the generic cross-domain
// Action Center, which is a separate, not-yet-authorized build.
//
// Zero-history reorder behavior sprint, PR 3 -- `request.urgency` is
// null for a NEEDS_PLANNING request; shows a "Needs planning" badge
// instead of crashing on `.toLowerCase()`.
// Notification identity fix (docs/specifications/notification-identity.md,
// Issue #145) -- the deep link carries a `requestId` query param (already
// part of every Attention Item's `deepLink`), so PartDetail resolves the
// EXACT request that produced this notification instead of "whichever
// request for this part happens to be newest."
function NotificationItem({ item, resolveName, onNavigate }) {
  return (
    <Link to={item.deepLink} className="fo-notification-panel-item" onClick={onNavigate}>
      <span>{resolveName(item.partId)}</span>
      {/* Personas read a bare "MEDIUM" here beside the Inventory queue's
          "Critical & High (0)" and took them for one scale -- then reported the two
          screens as contradicting each other. They are different authorities: this is
          a REORDER REQUEST's urgency (a request awaiting review), not a stock-condition
          severity (see the Service<->Inventory material-truth assessment). Same badge
          vocabulary, different meaning, nothing saying which. Name the scale on the
          row. This does not reconcile the two numbers -- they are not the same fact
          and must not be made to agree. */}
      {item.urgency ? (
        <StatusPill tone={inventoryUrgencyTone(item.urgency)} label={`Request urgency: ${item.urgency}`} />
      ) : (
        <StatusPill tone="unknown" label="Needs planning" />
      )}
    </Link>
  );
}

export default function NotificationPanel({
  // Wave 6: `sections` is `groupPartsAttentionItemsBySection()`'s own output shape --
  // `{ sectionLabel, items }[]`, already in fixed display order, empty sections omitted.
  sections = [],
  // site-work round-2 #4 (appheader-discards-reorder-error) -- any one of AppHeader's
  // underlying reorder-request subscriptions failing (permission-denied, unavailable, ...).
  // A failed read must NEVER be shown as a confidently-wrong empty/undercounted bell
  // (mirrors WorkOrdersList.jsx/Dispatch.jsx/DispatcherBoard.jsx's "fail visibly"
  // pattern, test/dispatchSurfacesErrorState.test.jsx) -- so this takes priority over
  // `total` below both on the button and inside the dropdown.
  error = null,
  // OD-3: governed canonical partId -> name resolver supplied by AppHeader (one shared read).
  // Defaults to the raw partId so this presentational component NEVER falls back to a static
  // name and never crashes if a caller omits it -- fail-closed by construction.
  resolveName = (partId) => partId,
}) {
  const [open, setOpen] = useState(false);
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const close = () => setOpen(false);

  return (
    <div className="fo-notification-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={error ? "Notifications, couldn't load" : "Notifications"}
      >
        Notifications{error ? " ⚠" : total > 0 ? ` (${total})` : ""}
      </button>
      {open && (
        <div className="fo-notification-panel-dropdown">
          {error ? (
            <FailureState message={loadErrorMessage(error, { entity: "reorder-request notifications" })} />
          ) : total === 0 ? (
            <p className="fo-muted">No pending reorder requests.</p>
          ) : (
            <>
              {/* State the authority once, at the top. Everything in this panel is a
                  REORDER REQUEST moving through review/assignment/purchasing -- not a
                  stock condition. Without this, readers matched these rows against the
                  Inventory queue's severity counts and reported a contradiction between
                  two surfaces that were never describing the same thing. */}
              <p className="fo-muted fo-notification-panel-scope">
                Reorder requests in progress. Stock levels live in Inventory.
              </p>
              {sections.map((section) => (
                <div key={section.sectionLabel}>
                  <p className="fo-notification-panel-section">{section.sectionLabel}</p>
                  {section.items.map((item) => (
                    <NotificationItem key={item.objectId} item={item} resolveName={resolveName} onNavigate={close} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
