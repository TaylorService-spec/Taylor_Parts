// EI Mobile Inventory -- ISOLATED, UNWIRED presentation for the MOBILE-location
// reservations section. It renders the ALREADY-PROJECTED reservations section produced by
// domain/mobileLocationInventoryProjection.composeMobileLocationInventory (the
// `{ state, items }` slice). It performs NO reads, NO composition, NO stock/fulfillment math,
// and has NO production caller in this slice -- it is inert until a later Customer wiring
// gate, after an authoritative MOBILE-location-keyed reservations source exists (every
// section source in the composer is UNAVAILABLE today). Mirrors PartsStockSection.jsx.
//
// GOVERNANCE / DISPLAY CONTRACT enforced structurally here:
//   * The component reads ONLY the explicit DISPLAY_COLUMNS allowlist off each row. It never
//     spreads a row, never iterates a row's own keys, and never renders a value that is not a
//     governed non-blank string / finite number. Raw source records, fabricated fields, and
//     any field absent from the merged row contract can NEVER appear.
//   * QUANTITY IS PASS-THROUGH ONLY. It is a governed finite display number rendered verbatim.
//     This component NEVER computes any total, availability, fulfillment, shortage, balance,
//     valuation, or discrepancy. A missing/absent quantity renders an em dash, NEVER zero (a
//     real governed 0 is a distinct, displayed value). It NEVER infers order/reservation type,
//     lifecycle state, truck/location, customer, employee, custody, or transfer direction --
//     each cell is a pass-through of its own governed field or an em dash.
//   * FAIL CLOSED -- WHOLE PAYLOAD. A null / undefined / malformed section, an unknown state, a
//     READY section whose `items` is not an array, OR a READY payload containing ANY malformed
//     row (a non-object, a wrong-typed recognized field, or a row with no governed displayable
//     value) all resolve to the sanitized ERROR state for the ENTIRE section. Only a genuine
//     READY `items: []` asserts empty reservations; a malformed non-empty payload is an
//     integrity failure -- never a false "empty", never a partial mix. No raw values, error
//     details, or location identifiers reach the UI.
//   * DETERMINISTIC. Pure function of its `section` prop; the DEFAULT row order is the order
//     given (no implicit sort), the prop is never mutated. A person may sort the loaded rows by
//     a column header (shared useTableSort, tri-state back to the default); that reorders a
//     display copy only. Enum-valued cells (kind, state) are shown through the shared statusLabel
//     ("IN_TRANSIT" -> "In Transit") -- a display mapping of the same governed value, never an
//     inference.
import { useId } from "react";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";
import { statusLabel } from "../../../shared/display/displayLabels.js";
import { MOBILE_INVENTORY_SECTION_STATE } from "../../../domain/mobileLocationInventoryProjection.js";

const { UNAVAILABLE, LOADING, DENIED, ERROR, READY } = MOBILE_INVENTORY_SECTION_STATE;
const KNOWN_STATES = Object.freeze([UNAVAILABLE, LOADING, DENIED, ERROR, READY]);

// The ONLY fields this slice renders, in display order, each with its governed value TYPE.
const DISPLAY_COLUMNS = Object.freeze([
  { key: "order", label: "Order", type: "string" },
  { key: "kind", label: "Kind", type: "string", enumValue: true },
  { key: "internalSku", label: "SKU", type: "string" },
  { key: "serial", label: "Serial", type: "string" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "state", label: "State", type: "string", enumValue: true },
]);

// Every recognized merged-contract field and its governed value type. A projected row's value
// for any of these must match its type or be null; anything else is an integrity fault.
// Unknown/extra keys are ignored (never read, never rendered).
const FIELD_TYPES = Object.freeze({
  order: "string",
  kind: "string",
  internalSku: "string",
  serial: "string",
  quantity: "number",
  state: "string",
});
const RECOGNIZED_KEYS = Object.freeze(Object.keys(FIELD_TYPES));

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Governed display STRING: a non-blank string passed through verbatim, else null.
function displayString(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// Governed display NUMBER: a finite number rendered verbatim (incl. a real 0), else null --
// NEVER computed, summed, or derived; a missing value is null (-> em dash), never zero.
function displayNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

// The rendered display value for a column, dispatched by its governed type.
function cellValue(row, col) {
  if (col.type === "number") return displayNumber(row[col.key]);
  const v = displayString(row[col.key]);
  return v !== null && col.enumValue ? statusLabel(v) : v;
}

// Client-side sort over the loaded rows: the governed number for quantity, display text otherwise.
const SORT_COLUMNS = Object.freeze(Object.fromEntries(DISPLAY_COLUMNS.map((col) => [col.key, {
  value: (row) => (col.type === "number"
    ? (typeof row[col.key] === "number" && Number.isFinite(row[col.key]) ? row[col.key] : null)
    : cellValue(row, col)),
}])));

// A recognized field is governed-shaped iff it is absent, null, or matches its declared type
// (a non-blank string, or a finite number).
function isGovernedFieldValue(key, v) {
  if (v === undefined || v === null) return true;
  return FIELD_TYPES[key] === "number"
    ? typeof v === "number" && Number.isFinite(v)
    : typeof v === "string" && v.trim() !== "";
}

// A row satisfies the projected-row DISPLAY contract iff it is a plain object, every recognized
// field it carries is governed-shaped for its type, AND it carries at least one governed value
// in a DISPLAYED column. Unknown extra keys are ignored. Validates the WHOLE payload before
// render (no silent per-row drop).
function isValidProjectedRow(row) {
  if (!isPlainObject(row)) return false;
  for (const key of RECOGNIZED_KEYS) {
    if (key in row && !isGovernedFieldValue(key, row[key])) return false;
  }
  return DISPLAY_COLUMNS.some((col) => cellValue(row, col) !== null);
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
  const { sort, toggle, sorted } = useTableSort({ rows: items, columns: SORT_COLUMNS });
  if (items.length === 0) {
    return (
      <StateMessage testId="rs-empty">
        No reservations at this location.
      </StateMessage>
    );
  }
  // overflow-x on the wrapper keeps a wide table scrollable WITHIN its container so the page
  // body never overflows horizontally on mobile.
  return (
    <div style={{ overflowX: "auto" }} data-testid="rs-ready">
      <table className="fo-table">
        <caption className="fo-muted">Reservations at this location</caption>
        <thead>
          <tr>
            {DISPLAY_COLUMNS.map((col) => (
              <SortableHeader key={col.key} columnKey={col.key} label={col.label} sort={sort} onSort={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            // Row key combines a governed identity with the render index so repeated
            // order/SKU/serial values can never collide (order preserved, read-only slice).
            const identity = displayString(row.order) ?? displayString(row.internalSku) ?? displayString(row.serial) ?? "row";
            return (
              <tr key={`${identity}#${i}`}>
                {DISPLAY_COLUMNS.map((col) => (
                  <td key={col.key}>{cellValue(row, col) ?? "—"}</td>
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
        <StateMessage testId="rs-loading" role="status" live="polite">
          Loading reservations…
        </StateMessage>
      );
    case DENIED:
      return (
        <StateMessage testId="rs-denied">
          You do not have access to reservations for this location.
        </StateMessage>
      );
    case ERROR:
      return (
        <StateMessage testId="rs-error" role="alert">
          Reservations could not be loaded.
        </StateMessage>
      );
    case UNAVAILABLE:
    default:
      return (
        <StateMessage testId="rs-unavailable">
          Reservations are not connected for this location yet.
        </StateMessage>
      );
  }
}

// `section` is the reservations slice `{ state, items }` from
// composeMobileLocationInventory(...).sections.reservations. No other prop is read.
export default function ReservationsSection({ section }) {
  const headingId = useId(); // per-instance -> two instances never collide on id/aria-labelledby
  const state = resolveDisplayState(section);
  return (
    <section className="fo-card" aria-labelledby={headingId} data-testid="reservations-section">
      <h3 id={headingId}>Reservations</h3>
      <SectionBody state={state} section={section} />
    </section>
  );
}

// Exported for tests only -- the governed display allowlist, state resolver, and row validator.
export const __test__ = Object.freeze({ DISPLAY_COLUMNS, resolveDisplayState, isValidProjectedRow });
