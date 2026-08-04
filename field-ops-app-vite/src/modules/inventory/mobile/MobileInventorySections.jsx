// EI Mobile Inventory -- ISOLATED, UNWIRED composite that accepts the ALREADY-COMPOSED
// MOBILE-location inventory read-model (the output of
// domain/mobileLocationInventoryProjection.composeMobileLocationInventory:
// `{ identity, resolved, sections: { parts, serializedAssets, reservations, reconciliation,
// activity } }`) and DELEGATES each of the five section values, unchanged, to its matching
// merged presentation component. It has NO production caller and no route wiring in this slice.
//
// GOVERNANCE / BEHAVIOR enforced structurally here:
//   * PURE DELEGATION. This composite performs NO composition, NO source fetch, NO identity
//     resolution, and NO inventory calculation. Each `model.sections[key]` is passed BY
//     REFERENCE, unchanged, to its section component; every state/validation/display decision
//     stays inside that already-merged component (each of which is independently fail-closed).
//   * INDEPENDENT SECTION STATES. The five sections render independently -- a malformed or
//     missing value in one section only affects that section's own component (which fails
//     closed to its own unavailable/error), never the others.
//   * ENVELOPE FAIL-CLOSED, RESOLVED BOUNDARY. The composite delegates ONLY when the outer model
//     is a plain object, `model.resolved` is the boolean `true`, and `model.sections` is a plain
//     object. If the model is null/undefined/not-a-plain-object, `resolved` is anything other than
//     the boolean `true` (false, missing, null, string, number, ...), or `sections` is not a plain
//     object, the composite renders a single honest "not available" message and delegates nothing
//     -- it never throws, never inspects section content, and never leaks data. This preserves the
//     composer's guarantee that unresolved identity makes every section unavailable. A missing
//     individual section KEY (under a resolved model) is not an envelope fault: `sections[key]` is
//     `undefined`, which the matching component fail-closes to its own "unavailable" state.
//   * NO INVENTED CONTENT. The composite adds only a grouping heading; it fabricates no section
//     data, counts, totals, or identity, and never renders identity/truck/location values.
//   * DETERMINISTIC. Pure function of its `model` prop; section order is the composer's own
//     fixed order; the prop is never mutated.
import { useId } from "react";
import PartsStockSection from "./PartsStockSection.jsx";
import SerializedAssetsSection from "./SerializedAssetsSection.jsx";
import ReservationsSection from "./ReservationsSection.jsx";
import ReconciliationSection from "./ReconciliationSection.jsx";
import ActivitySection from "./ActivitySection.jsx";

// The five governed sections, in the composer's fixed order (MOBILE_INVENTORY_SECTIONS).
const SECTION_COMPONENTS = Object.freeze([
  { key: "parts", Component: PartsStockSection },
  { key: "serializedAssets", Component: SerializedAssetsSection },
  { key: "reservations", Component: ReservationsSection },
  { key: "reconciliation", Component: ReconciliationSection },
  { key: "activity", Component: ActivitySection },
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Resolve the model envelope, preserving the composer's `resolved` boundary. Returns the
// sections map ONLY when the model is a plain object, `model.resolved` is the boolean `true`,
// and `model.sections` is a plain object; otherwise null (fail closed). The composer guarantees
// that unresolved identity makes every section unavailable -- so `resolved !== true` (false,
// missing, null, string, number, or any non-`true` value) must expose NO section content.
// Never throws on a malformed/missing model. Identity is never resolved or read here.
function resolveSections(model) {
  if (!isPlainObject(model)) return null;
  if (model.resolved !== true) return null; // require the boolean true; false/missing/malformed -> fail closed
  if (!isPlainObject(model.sections)) return null;
  return model.sections;
}

// `model` is the composed MOBILE-location read-model `{ identity, resolved, sections }` from
// composeMobileLocationInventory(...). Only `model.sections` is read; identity/resolved are
// deliberately never rendered (no location/truck/identity leakage).
export default function MobileInventorySections({ model }) {
  const headingId = useId(); // per-instance grouping label
  const sections = resolveSections(model);
  return (
    <section aria-labelledby={headingId} data-testid="mobile-inventory-sections">
      <h2 id={headingId}>Mobile Inventory</h2>
      {sections === null ? (
        <p className="fo-muted" data-testid="mis-unavailable">
          Mobile inventory is not available.
        </p>
      ) : (
        <div data-testid="mis-sections">
          {SECTION_COMPONENTS.map(({ key, Component }) => (
            // Pass the section value BY REFERENCE, unchanged. A missing key is `undefined`,
            // which the component fail-closes to its own "unavailable" state.
            <Component key={key} section={sections[key]} />
          ))}
        </div>
      )}
    </section>
  );
}

// Exported for tests only -- the delegation map and envelope resolver.
export const __test__ = Object.freeze({ SECTION_COMPONENTS, resolveSections });
