// EI Mobile Inventory -- ISOLATED, UNWIRED presentation for the MOBILE-location activity
// section. It renders the ALREADY-PROJECTED activity section produced by
// domain/mobileLocationInventoryProjection.composeMobileLocationInventory (the
// `{ state, items }` slice). It performs NO reads, NO composition, NO stock/inventory math,
// and has NO production caller in this slice -- it is inert until a later Customer wiring
// gate, after an authoritative MOBILE-location-keyed activity source exists (every section
// source in the composer is UNAVAILABLE today). Mirrors PartsStockSection/ReservationsSection.
//
// GOVERNANCE / DISPLAY CONTRACT enforced structurally here:
//   * The component reads ONLY the explicit DISPLAY_COLUMNS allowlist off each row. It never
//     spreads a row, never iterates a row's own keys, and never renders a value that is not a
//     governed non-blank string. Raw source records, fabricated fields, and any field absent
//     from the merged row contract can NEVER appear -- by construction.
//   * PASS-THROUGH ONLY. Each cell is a verbatim governed display string of its own field, or
//     an em dash. This component performs NO derived inventory calculation of any kind and
//     NEVER infers a location/truck, actor, or any value not carried by the row itself.
//   * FAIL CLOSED -- WHOLE PAYLOAD. A null / undefined / malformed section, an unknown state, a
//     READY section whose `items` is not an array, OR a READY payload containing ANY malformed
//     row (a non-object, a wrong-typed recognized field, or a row with no governed displayable
//     value) all resolve to the sanitized ERROR state for the ENTIRE section. Only a genuine
//     READY `items: []` asserts empty activity; a malformed non-empty payload is an integrity
//     failure -- never a false "empty", never a partial mix. No raw values, error details, or
//     location identifiers reach the UI.
//   * DETERMINISTIC. Pure function of its `section` prop; row order preserved (no sort), the
//     prop is never mutated.
import { useId } from "react";
import { MOBILE_INVENTORY_SECTION_STATE } from "../../../domain/mobileLocationInventoryProjection.js";

const { UNAVAILABLE, LOADING, DENIED, ERROR, READY } = MOBILE_INVENTORY_SECTION_STATE;
const KNOWN_STATES = Object.freeze([UNAVAILABLE, LOADING, DENIED, ERROR, READY]);

// The ONLY fields this slice renders, in display order. The merged activity row contract
// (mobileLocationInventoryProjection.normalizeActivityRow) is { time, type, message } -- all
// governed display strings.
const DISPLAY_COLUMNS = Object.freeze([
  { key: "time", label: "Time" },
  { key: "type", label: "Type" },
  { key: "message", label: "Message" },
]);

// Every recognized merged-contract field (all string-typed). A projected row's value for any
// of these must be a non-blank string or null; anything else is an integrity fault. Unknown
// extra keys are ignored (never read, never rendered).
const RECOGNIZED_KEYS = Object.freeze(["time", "type", "message"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Governed display value: a non-blank STRING passed through verbatim, else null (-> em dash).
function displayString(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// A recognized field is governed-shaped iff it is absent, null, or a non-blank string.
function isGovernedFieldValue(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() !== "");
}

// A row satisfies the projected-row DISPLAY contract iff it is a plain object, every recognized
// field it carries is governed-shaped, AND it carries at least one governed displayable value.
// Unknown extra keys are ignored. Validates the WHOLE payload before render (no silent drop).
function isValidProjectedRow(row) {
  if (!isPlainObject(row)) return false;
  for (const key of RECOGNIZED_KEYS) {
    if (key in row && !isGovernedFieldValue(row[key])) return false;
  }
  return DISPLAY_COLUMNS.some((col) => displayString(row[col.key]) !== null);
}

// Resolve the section to a governed display state, failing closed over the WHOLE payload.
function resolveDisplayState(section) {
  if (section === null || section === undefined) return UNAVAILABLE;
  if (!isPlainObject(section)) return ERROR;
  if (!KNOWN_STATES.includes(section.state)) return ERROR;
  if (section.state === READY) {
    if (!Array.isArray(section.items)) return ERROR;
    if (section.items.length > 0 && !section.items.every(isValidProjectedRow)) return ERROR;
  }
  return section.state;
}

function StateMessage({ testId, role, live, children }) {
  return (
    <p className="fo-muted" data-testid={testId} role={role} aria-live={live}>
      {children}
    </p>
  );
}

function ReadyBody({ items }) {
  if (items.length === 0) {
    return (
      <StateMessage testId="as-empty">
        No activity at this location.
      </StateMessage>
    );
  }
  // overflow-x on the wrapper keeps a wide table scrollable WITHIN its container so the page
  // body never overflows horizontally on mobile.
  return (
    <div style={{ overflowX: "auto" }} data-testid="as-ready">
      <table className="fo-table">
        <caption className="fo-muted">Activity at this location</caption>
        <thead>
          <tr>
            {DISPLAY_COLUMNS.map((col) => (
              <th key={col.key} scope="col">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => {
            // Row key combines a governed identity with the render index so repeated
            // time/type values can never collide (order preserved, read-only slice).
            const identity = displayString(row.time) ?? displayString(row.type) ?? "row";
            return (
              <tr key={`${identity}#${i}`}>
                {DISPLAY_COLUMNS.map((col) => (
                  <td key={col.key}>{displayString(row[col.key]) ?? "—"}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionBody({ state, section }) {
  switch (state) {
    case READY:
      return <ReadyBody items={section.items} />;
    case LOADING:
      return (
        <StateMessage testId="as-loading" role="status" live="polite">
          Loading activity…
        </StateMessage>
      );
    case DENIED:
      return (
        <StateMessage testId="as-denied">
          You do not have access to activity for this location.
        </StateMessage>
      );
    case ERROR:
      return (
        <StateMessage testId="as-error" role="alert">
          Activity could not be loaded.
        </StateMessage>
      );
    case UNAVAILABLE:
    default:
      return (
        <StateMessage testId="as-unavailable">
          Activity is not connected for this location yet.
        </StateMessage>
      );
  }
}

// `section` is the activity slice `{ state, items }` from
// composeMobileLocationInventory(...).sections.activity. No other prop is read.
export default function ActivitySection({ section }) {
  const headingId = useId(); // per-instance -> two instances never collide on id/aria-labelledby
  const state = resolveDisplayState(section);
  return (
    <section className="fo-card" aria-labelledby={headingId} data-testid="activity-section">
      <h3 id={headingId}>Activity</h3>
      <SectionBody state={state} section={section} />
    </section>
  );
}

// Exported for tests only -- the governed display allowlist, state resolver, and row validator.
export const __test__ = Object.freeze({ DISPLAY_COLUMNS, resolveDisplayState, isValidProjectedRow });
