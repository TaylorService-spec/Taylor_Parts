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
//   * FAIL CLOSED. A null / undefined / malformed section, an unknown state, or a
//     READY section whose `items` is not an array all resolve to an honest
//     unavailable/sanitized-error state -- never fabricated inventory, never a raw error.
//   * DETERMINISTIC. Pure function of its `section` prop; row order is preserved
//     (no sort), and the prop is never mutated.
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

const HEADING_ID = "serialized-assets-heading";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Governed display value: a non-blank STRING passed through verbatim, else null. A
// number/object/array/blank is treated as absent (null -> rendered as an em dash), so
// no non-string source value can ever leak into the DOM.
function displayValue(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// Resolve the section to a governed display state, failing closed.
function resolveDisplayState(section) {
  if (section === null || section === undefined) return UNAVAILABLE;
  if (!isPlainObject(section)) return ERROR;
  if (!KNOWN_STATES.includes(section.state)) return ERROR;
  if (section.state === READY && !Array.isArray(section.items)) return ERROR;
  return section.state;
}

// Build the render rows from a READY section, reading ONLY the allowlist keys. Rows that
// are not plain objects, or that carry no governed value in any displayed column, are
// dropped (honest -- nothing to show). Never mutates the input.
function readyRows(section) {
  const items = Array.isArray(section?.items) ? section.items : [];
  const rows = [];
  for (const raw of items) {
    if (!isPlainObject(raw)) continue;
    const cells = {};
    let hasValue = false;
    for (const col of DISPLAY_COLUMNS) {
      const val = displayValue(raw[col.key]);
      cells[col.key] = val;
      if (val !== null) hasValue = true;
    }
    if (!hasValue) continue;
    rows.push(cells);
  }
  return rows;
}

function StateMessage({ testId, role, live, children }) {
  return (
    <p className="fo-muted" data-testid={testId} role={role} aria-live={live}>
      {children}
    </p>
  );
}

function ReadyBody({ section }) {
  const rows = readyRows(section);
  if (rows.length === 0) {
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
          {rows.map((row, i) => (
            <tr key={row.assetId ?? row.serial ?? `row-${i}`}>
              {DISPLAY_COLUMNS.map((col) => (
                <td key={col.key}>{row[col.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBody({ state, section }) {
  switch (state) {
    case READY:
      return <ReadyBody section={section} />;
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
  const state = resolveDisplayState(section);
  return (
    <section className="fo-card" aria-labelledby={HEADING_ID} data-testid="serialized-assets-section">
      <h3 id={HEADING_ID}>Serialized Assets</h3>
      <SectionBody state={state} section={section} />
    </section>
  );
}

// Exported for tests only -- the governed display allowlist and state resolver.
export const __test__ = Object.freeze({ DISPLAY_COLUMNS, resolveDisplayState, readyRows });
