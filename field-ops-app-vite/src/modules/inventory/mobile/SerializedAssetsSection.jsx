// EI Mobile Inventory -- ISOLATED, UNWIRED presentation for the MOBILE-location
// serialized-assets section. It renders the ALREADY-PROJECTED serializedAssets
// section produced by domain/mobileLocationInventoryProjection.composeMobileLocationInventory
// (the `{ state, items }` slice). It performs NO reads, NO composition, NO stock math,
// and has NO production caller in this slice -- it is inert until a later Customer wiring
// gate, after the authoritative MOBILE serialized-asset source exists
// (access/mobileSerializedAssetsSource is INERT/"unavailable" today).
//
// GOVERNANCE / DISPLAY CONTRACT enforced structurally here:
//   * The component reads ONLY the explicit DISPLAY_COLUMNS allowlist off each row.
//     It never spreads a row, never iterates a row's own keys, and never renders a
//     value that is not a governed non-blank string. Therefore raw source records,
//     fabricated fields, and any field absent from the merged row contract can NEVER
//     appear -- by construction, not by filtering after the fact.
//   * WITHHELD FIELDS. The merged serialized row contract
//     (mobileLocationInventoryProjection.normalizeSerializedRow) is
//     { assetId, internalSku, manufacturer, model, serial, condition, status,
//       currentLocation }. This presentation slice deliberately withholds:
//       - `condition` -- named explicitly in the gate's prohibition list;
//       - `status`    -- conservatively withheld to honor the "active status"
//                        prohibition; it is a governed field and re-adding it later is
//                        a one-line allowlist change if the Owner authorizes it.
//     quantity / valuation / custody / driver / GPS / active-status are absent from the
//     merged row contract and are therefore never read at all.
//   * FAIL CLOSED -- WHOLE PAYLOAD. A null / undefined / malformed section, an unknown
//     state, a READY section whose `items` is not an array, OR a READY payload
//     containing ANY malformed row (a non-object, or a row carrying no governed
//     displayable value) all resolve to the sanitized ERROR state for the ENTIRE
//     section. Only a genuine READY `items: []` asserts empty inventory; a malformed
//     non-empty payload is an integrity failure, never a false "empty" and never a
//     partial mix of valid + malformed rows. No raw values or error details reach the UI.
//   * DETERMINISTIC. Pure function of its `section` prop; row order is preserved
//     (no sort), and the prop is never mutated.
import { useId } from "react";
import { MOBILE_INVENTORY_SECTION_STATE } from "../../../domain/mobileLocationInventoryProjection.js";

const { UNAVAILABLE, LOADING, DENIED, ERROR, READY } = MOBILE_INVENTORY_SECTION_STATE;
const KNOWN_STATES = Object.freeze([UNAVAILABLE, LOADING, DENIED, ERROR, READY]);

// The ONLY fields this slice renders, in display order. See the WITHHELD FIELDS note above.
const DISPLAY_COLUMNS = Object.freeze([
  { key: "assetId", label: "Asset ID" },
  { key: "internalSku", label: "SKU" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "model", label: "Model" },
  { key: "serial", label: "Serial" },
  { key: "currentLocation", label: "Location" },
]);

// Every field name the merged serialized-row contract may carry. A projected row's value
// for any of these must be governed-shaped (a non-blank string or null); anything else is
// an integrity fault. Unknown/extra keys are ignored (never read, never rendered).
const RECOGNIZED_KEYS = Object.freeze([
  "assetId", "internalSku", "manufacturer", "model", "serial", "condition", "status", "currentLocation",
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Governed display value: a non-blank STRING passed through verbatim, else null. A
// number/object/array/blank is treated as absent (null -> rendered as an em dash), so
// no non-string source value can ever leak into the DOM.
function displayValue(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// A recognized field is governed-shaped iff it is absent, null, or a non-blank string.
function isGovernedFieldValue(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() !== "");
}

// A row satisfies the projected-row DISPLAY contract iff it is a plain object, every
// recognized field it carries is governed-shaped, AND it carries at least one governed
// value in a DISPLAYED column (so it is a renderable serialized row, not an empty/opaque
// object). Unknown extra keys are ignored. Used to validate the WHOLE payload before render.
function isValidProjectedRow(row) {
  if (!isPlainObject(row)) return false;
  for (const key of RECOGNIZED_KEYS) {
    if (key in row && !isGovernedFieldValue(row[key])) return false;
  }
  return DISPLAY_COLUMNS.some((col) => displayValue(row[col.key]) !== null);
}

// Resolve the section to a governed display state, failing closed over the WHOLE payload.
function resolveDisplayState(section) {
  if (section === null || section === undefined) return UNAVAILABLE;
  if (!isPlainObject(section)) return ERROR;
  if (!KNOWN_STATES.includes(section.state)) return ERROR;
  if (section.state === READY) {
    if (!Array.isArray(section.items)) return ERROR;
    // items:[] is an honest empty result; a non-empty payload with ANY malformed row
    // is an integrity failure -> ERROR the entire section (never partial, never false empty).
    if (section.items.length > 0 && !section.items.every(isValidProjectedRow)) return ERROR;
  }
  return section.state;
}

// Map a validated row to its display cells (allowlist keys only). Never mutates input.
function toDisplayCells(row) {
  const cells = {};
  for (const col of DISPLAY_COLUMNS) cells[col.key] = displayValue(row[col.key]);
  return cells;
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
      <StateMessage testId="sa-empty">
        No serialized assets at this location.
      </StateMessage>
    );
  }
  // overflow-x on the wrapper keeps a wide table scrollable WITHIN its container so the
  // page body never overflows horizontally on mobile.
  return (
    <div style={{ overflowX: "auto" }} data-testid="sa-ready">
      <table className="fo-table">
        <caption className="fo-muted">Serialized assets at this location</caption>
        <thead>
          <tr>
            {DISPLAY_COLUMNS.map((col) => (
              <th key={col.key} scope="col">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => {
            const cells = toDisplayCells(row);
            // Row key combines the governed identity with the render index so duplicate
            // assetId/serial values can never collide (order is preserved, read-only slice).
            const identity = displayValue(row.assetId) ?? displayValue(row.serial) ?? "row";
            return (
              <tr key={`${identity}#${i}`}>
                {DISPLAY_COLUMNS.map((col) => (
                  <td key={col.key}>{cells[col.key] ?? "—"}</td>
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
        <StateMessage testId="sa-loading" role="status" live="polite">
          Loading serialized assets…
        </StateMessage>
      );
    case DENIED:
      return (
        <StateMessage testId="sa-denied">
          You do not have access to serialized assets for this location.
        </StateMessage>
      );
    case ERROR:
      return (
        <StateMessage testId="sa-error" role="alert">
          Serialized assets could not be loaded.
        </StateMessage>
      );
    case UNAVAILABLE:
    default:
      return (
        <StateMessage testId="sa-unavailable">
          Serialized assets are not connected for this location yet.
        </StateMessage>
      );
  }
}

// `section` is the serializedAssets slice `{ state, items }` from
// composeMobileLocationInventory(...).sections.serializedAssets. No other prop is read.
export default function SerializedAssetsSection({ section }) {
  const headingId = useId(); // per-instance -> two instances never collide on id/aria-labelledby
  const state = resolveDisplayState(section);
  return (
    <section className="fo-card" aria-labelledby={headingId} data-testid="serialized-assets-section">
      <h3 id={headingId}>Serialized Assets</h3>
      <SectionBody state={state} section={section} />
    </section>
  );
}

// Exported for tests only -- the governed display allowlist, state resolver, and row validator.
export const __test__ = Object.freeze({ DISPLAY_COLUMNS, resolveDisplayState, isValidProjectedRow });
