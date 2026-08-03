// EI Mobile Inventory -- ISOLATED, UNWIRED presentation for the MOBILE-location
// reconciliation (cycle-count observation) section. It renders the ALREADY-PROJECTED
// reconciliation section produced by
// domain/mobileLocationInventoryProjection.composeMobileLocationInventory (the
// `{ state, observation }` slice -- an OBSERVATION object, not an items array). It performs
// NO reads, NO composition, NO stock/variance/cycle-count math, and has NO production caller
// in this slice -- it is inert until a later Customer wiring gate, after an authoritative
// MOBILE-location-keyed reconciliation source exists (every section source in the composer is
// UNAVAILABLE today). Mirrors the sibling mobile section components.
//
// GOVERNANCE / DISPLAY CONTRACT enforced structurally here:
//   * The component reads ONLY the explicit COUNT_FIELDS + ITEM_COLUMNS allowlists. It never
//     spreads/enumerates the observation or an item, so raw fields, fabricated values, and any
//     field absent from the merged contract can NEVER appear.
//   * OBSERVATION IS PURE PASS-THROUGH. Counts are governed finite display numbers; item cells
//     are governed display strings. This component performs NO calculation of any kind -- no
//     variance/discrepancy, no missing/unexpected membership, no totals/balances/on-hand/
//     available/valuation, no cycle-count result/completion, no reconciliation status or
//     recommendation. A governed numeric 0 displays as "0"; a null count displays as an em
//     dash, NEVER zero.
//   * EMPTY SEMANTICS. An empty missing/unexpected array is an honest "none reported" for that
//     list -- NOT a completed/successful cycle count. A valid observation with null counts and
//     empty arrays remains a pass-through observation; no totals or completion are fabricated.
//   * FAIL CLOSED -- WHOLE SECTION. A null/undefined/malformed section, an unknown state, or (in
//     READY) any malformed observation -- a non-object observation, a count that is not a finite
//     number or null, a missing/unexpected that is not an array, an item that is not a plain
//     object, an item field that is not a non-blank string or null, or an item with NO governed
//     displayable value (an anonymous all-null row) -- ALL render the sanitized ERROR state for
//     the ENTIRE section. Malformed entries are never silently dropped and a partially-trusted
//     observation is never shown. Non-READY states never inspect observation contents.
//   * PRIVACY. No raw errors, location/truck IDs, employee/customer data, custody, GPS,
//     valuation, or unsupported fields are ever rendered.
//   * DETERMINISTIC. Pure function of its `section` prop; order preserved; prop never mutated.
import { useId } from "react";
import { MOBILE_INVENTORY_SECTION_STATE } from "../../../domain/mobileLocationInventoryProjection.js";

const { UNAVAILABLE, LOADING, DENIED, ERROR, READY } = MOBILE_INVENTORY_SECTION_STATE;
const KNOWN_STATES = Object.freeze([UNAVAILABLE, LOADING, DENIED, ERROR, READY]);

// Summary count fields (governed finite numbers), in display order.
const COUNT_FIELDS = Object.freeze([
  { key: "expectedSerialized", label: "Expected serialized" },
  { key: "scannedSerialized", label: "Scanned serialized" },
  { key: "expectedParts", label: "Expected parts" },
  { key: "scannedParts", label: "Scanned parts" },
]);

// Missing/Unexpected item columns (governed strings), in display order.
const ITEM_COLUMNS = Object.freeze([
  { key: "assetId", label: "Asset ID" },
  { key: "internalSku", label: "SKU" },
  { key: "label", label: "Label" },
  { key: "serial", label: "Serial" },
  { key: "lastSeen", label: "Last seen" },
  { key: "expected", label: "Expected" },
  { key: "actual", label: "Actual" },
  { key: "note", label: "Note" },
]);

const COUNT_KEYS = Object.freeze(COUNT_FIELDS.map((c) => c.key));
const ITEM_KEYS = Object.freeze(ITEM_COLUMNS.map((c) => c.key));

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
// Governed display STRING: a non-blank string passed through verbatim, else null (-> em dash).
function displayString(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
// Governed display NUMBER: a finite number rendered verbatim (incl. a real 0), else null --
// NEVER computed. A missing count is null (-> em dash), never zero.
function displayNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

// A count field must be absent, null, or a finite number.
function isFiniteOrNull(v) {
  return v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));
}
// A recognized item field must be absent, null, or a non-blank string.
function isGovernedString(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() !== "");
}

// A recon item is valid iff it is a plain object, every recognized field it carries is a
// governed string or null, AND it carries at least one governed displayable value (an all-null
// item fails closed -- never an anonymous blank row). Unknown extra keys are ignored.
function isValidReconItem(item) {
  if (!isPlainObject(item)) return false;
  for (const key of ITEM_KEYS) {
    if (key in item && !isGovernedString(item[key])) return false;
  }
  return ITEM_COLUMNS.some((col) => displayString(item[col.key]) !== null);
}

// The observation is valid iff it is a plain object, every present count is finite-or-null,
// missing/unexpected are BOTH actual arrays, and every array member is a valid recon item.
function isValidObservation(obs) {
  if (!isPlainObject(obs)) return false;
  for (const key of COUNT_KEYS) {
    if (key in obs && !isFiniteOrNull(obs[key])) return false;
  }
  if (!Array.isArray(obs.missing) || !Array.isArray(obs.unexpected)) return false;
  return obs.missing.every(isValidReconItem) && obs.unexpected.every(isValidReconItem);
}

// Resolve the section to a governed display state, failing closed over the WHOLE observation.
function resolveDisplayState(section) {
  if (section === null || section === undefined) return UNAVAILABLE;
  if (!isPlainObject(section)) return ERROR;
  if (!KNOWN_STATES.includes(section.state)) return ERROR;
  if (section.state === READY && !isValidObservation(section.observation)) return ERROR;
  return section.state;
}

function StateMessage({ testId, role, live, children }) {
  return (
    <p className="fo-muted" data-testid={testId} role={role} aria-live={live}>
      {children}
    </p>
  );
}

function SummaryList({ observation }) {
  return (
    <div data-testid="rc-summary">
      <h4>Summary</h4>
      <dl className="fo-table">
        {COUNT_FIELDS.map((c) => (
          <div key={c.key}>
            <dt>{c.label}</dt>
            <dd>{displayNumber(observation[c.key]) ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Render one Missing/Unexpected list: a table of validated items, or an honest "none reported"
// empty state. `variant` is "missing" | "unexpected".
function ItemList({ items, variant, heading, caption, emptyText }) {
  return (
    <div>
      <h4>{heading}</h4>
      {items.length === 0 ? (
        <StateMessage testId={`rc-${variant}-empty`}>{emptyText}</StateMessage>
      ) : (
        <div style={{ overflowX: "auto" }} data-testid={`rc-${variant}-table`}>
          <table className="fo-table">
            <caption className="fo-muted">{caption}</caption>
            <thead>
              <tr>
                {ITEM_COLUMNS.map((col) => (
                  <th key={col.key} scope="col">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                // Row key combines a governed identity with the render index so repeated
                // assetId/serial values can never collide (order preserved, read-only slice).
                const identity = displayString(item.assetId) ?? displayString(item.serial) ?? displayString(item.internalSku) ?? "row";
                return (
                  <tr key={`${identity}#${i}`}>
                    {ITEM_COLUMNS.map((col) => (
                      <td key={col.key}>{displayString(item[col.key]) ?? "—"}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReadyBody({ observation }) {
  return (
    <div data-testid="rc-ready">
      <SummaryList observation={observation} />
      <ItemList
        items={observation.missing}
        variant="missing"
        heading="Missing"
        caption="Missing items reported at this location"
        emptyText="No missing items reported."
      />
      <ItemList
        items={observation.unexpected}
        variant="unexpected"
        heading="Unexpected"
        caption="Unexpected items reported at this location"
        emptyText="No unexpected items reported."
      />
    </div>
  );
}

function SectionBody({ state, section }) {
  switch (state) {
    case READY:
      return <ReadyBody observation={section.observation} />;
    case LOADING:
      return (
        <StateMessage testId="rc-loading" role="status" live="polite">
          Loading reconciliation…
        </StateMessage>
      );
    case DENIED:
      return (
        <StateMessage testId="rc-denied">
          You do not have access to reconciliation for this location.
        </StateMessage>
      );
    case ERROR:
      return (
        <StateMessage testId="rc-error" role="alert">
          Reconciliation could not be loaded.
        </StateMessage>
      );
    case UNAVAILABLE:
    default:
      return (
        <StateMessage testId="rc-unavailable">
          Reconciliation is not connected for this location yet.
        </StateMessage>
      );
  }
}

// `section` is the reconciliation slice `{ state, observation }` from
// composeMobileLocationInventory(...).sections.reconciliation. No other prop is read.
export default function ReconciliationSection({ section }) {
  const headingId = useId(); // per-instance -> two instances never collide on id/aria-labelledby
  const state = resolveDisplayState(section);
  return (
    <section className="fo-card" aria-labelledby={headingId} data-testid="reconciliation-section">
      <h3 id={headingId}>Reconciliation</h3>
      <SectionBody state={state} section={section} />
    </section>
  );
}

// Exported for tests only -- the governed allowlists, state resolver, and validators.
export const __test__ = Object.freeze({ COUNT_FIELDS, ITEM_COLUMNS, resolveDisplayState, isValidObservation, isValidReconItem });
