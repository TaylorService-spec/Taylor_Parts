// D6 (Part Detail "Used In Equipment") — the compatibility section component. Repository-only + INERT:
// it is gated by the capability prop (package §1a) and, because equipment.compatibility.view is
// active:false, is HIDDEN for every user in the running app and issues no read. All behavior is proven
// by the pure view-model tests (equipmentCompatibilitySection.test.mjs) + the browser gate, which inject
// `hasCapability` through this same production prop and a fixture `source`.
//
// Fail-closed and section-scoped: it renders NOTHING (returns null) when the capability is not exactly
// granted, and any compatibility failure stays inside this card — it never affects Part identity, stock,
// reorder, pricing, or any other Inventory behavior.
import { useEffect, useRef, useState } from "react";
import {
  canViewCompatibility,
  loadCompatibilityPage,
  accumulateCompatibilityPages,
  isWholeQueryComplete,
  SECTION_STATES,
} from "../../domain/equipmentCompatibilitySection";
import { inertEquipmentCompatibilitySource } from "../../services/equipmentCompatibilitySource";

const PAGE_SIZE = 10; // OD-D

const VERIFICATION_LABEL = { VERIFIED: "Verified", CONFLICT: "Conflicting", IN_REVIEW: "In review", UNVERIFIED: "Unverified", REJECTED: "Rejected" };
const REASON_LABEL = {
  conflict: "Conflicting evidence — not for operational use",
  "in-review": "Under review — not for operational use",
  unverified: "Not yet verified — not for operational use",
  "applicability-unresolved": "Serial applicability unresolved",
  "model-unavailable": "Model details unavailable",
  "evidence-incomplete": "Evidence incomplete",
  "evidence-unavailable": "Evidence unavailable",
};

function EvidenceCell({ evidence }) {
  if (evidence.status === "UNAVAILABLE") return <span className="fo-muted">Evidence unavailable</span>;
  const counts = `${evidence.supportsCount} supporting / ${evidence.contradictsCount} contradicting`;
  const suffix = evidence.complete ? "" : " (partial — evidence incomplete)";
  const authority = evidence.strongestSupportingAuthority ? ` · strongest: ${evidence.strongestSupportingAuthority}` : "";
  return <span>{counts}{authority}{suffix}</span>;
}

function RelationshipRow({ item }) {
  const badgeClass = `fo-badge fo-badge-equipment-compat-${item.verificationStatus.toLowerCase().replace(/_/g, "-")}`;
  const model = item.model;
  return (
    <tr className={item.operational ? "" : "fo-equipment-compat-nonoperational"}>
      <td data-label="Equipment model">
        {model ? (
          <>
            <strong>{model.displayName || `${model.manufacturerName} ${model.modelNumber}`.trim()}</strong>
            <div className="fo-muted fo-equipment-compat-model-sub">
              {model.manufacturerName}{model.family ? ` · ${model.family}` : ""}{model.subtype ? ` · ${model.subtype}` : ""}
            </div>
          </>
        ) : (
          <span className="fo-muted">Model details unavailable</span>
        )}
      </td>
      <td data-label="Fit">
        {item.compatibilityType || "—"}
        {item.assembly ? <div className="fo-muted">{item.assembly}{item.installationPosition ? ` · ${item.installationPosition}` : ""}</div> : null}
        {typeof item.quantityRequired === "number" ? <div className="fo-muted">Qty {item.quantityRequired}</div> : null}
      </td>
      <td data-label="Applies to">{item.serialApplicabilitySummary}</td>
      <td data-label="Status">
        <span className={badgeClass}>{VERIFICATION_LABEL[item.verificationStatus] || item.verificationStatus}</span>
        {item.operational
          ? <span className="fo-badge fo-badge-equipment-compat-operational">Usable</span>
          : (item.reasons.length > 0 ? <div className="fo-muted">{item.reasons.map((r) => REASON_LABEL[r] || r).join("; ")}</div> : null)}
      </td>
      <td data-label="Evidence"><EvidenceCell evidence={item.evidence} /></td>
    </tr>
  );
}

export default function UsedInEquipmentSection({ hasCapability, partId, accessVersion, source = inertEquipmentCompatibilitySource, pageSize = PAGE_SIZE }) {
  const canView = canViewCompatibility(hasCapability);
  // The QUERY KEY binds every rendered/loaded page to BOTH the Part and the access version. Any change
  // to either produces a new key; results carrying a stale key are neither rendered nor applied.
  const queryKey = `${partId ?? ""}::${accessVersion ?? ""}`;
  const [stored, setStored] = useState(null); // { key, data } — data is the accumulated view for that key
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reqRef = useRef(0);
  // `hasCapability` from the feed hook is recreated each render; hold it in a ref (kept current) so the
  // load effect depends on the STABLE boolean `canView`, not the changing function identity, while still
  // reading the freshest resolver. loadCompatibilityPage re-checks the gate internally.
  const hasCapabilityRef = useRef(hasCapability);
  hasCapabilityRef.current = hasCapability;

  // Initial load / reset on any query-key (partId OR accessVersion) change, or explicit reload. NO read
  // occurs unless the capability is exactly granted AND a part is selected (loadCompatibilityPage gate).
  useEffect(() => {
    const seq = reqRef.current + 1;
    reqRef.current = seq;
    const key = queryKey;
    setStored(null);
    setLoading(true);
    loadCompatibilityPage(source, { hasCapability: hasCapabilityRef.current, partId, cursor: null, limit: pageSize })
      .then((r) => {
        if (reqRef.current !== seq) return;
        setStored(r.skipped ? null : { key, data: accumulateCompatibilityPages(null, r.page) });
      })
      .finally(() => { if (reqRef.current === seq) setLoading(false); });
  }, [canView, queryKey, partId, source, pageSize, reloadTick]);

  // HIDDEN — render nothing (must come AFTER hooks). The effect above also performed zero reads.
  if (!canView) return null;

  // Render ONLY data whose key matches the CURRENT query key — a prior Part's / access version's rows and
  // cursor are unrenderable immediately (this render), not merely after the reset effect runs.
  const current = stored && stored.key === queryKey ? stored.data : null;

  const showMore = () => {
    if (!current || !current.hasMore || loading) return;
    const seq = reqRef.current + 1;
    reqRef.current = seq;
    const key = queryKey;
    setLoading(true);
    loadCompatibilityPage(source, { hasCapability: hasCapabilityRef.current, partId, cursor: current.nextCursor, limit: pageSize })
      .then((r) => {
        if (reqRef.current !== seq || r.skipped) return;
        setStored((prev) => (prev && prev.key === key ? { key, data: accumulateCompatibilityPages(prev.data, r.page) } : prev));
      })
      .finally(() => { if (reqRef.current === seq) setLoading(false); });
  };
  const reload = () => setReloadTick((t) => t + 1);

  const state = current ? current.state : SECTION_STATES.LOADING;
  const items = current ? current.items : [];
  const counts = current ? current.counts : null;
  const showList = state === SECTION_STATES.AVAILABLE || state === SECTION_STATES.DEGRADED;
  // A neutral end-of-pagination marker is shown ONLY when the traversal is genuinely clean+complete: no
  // more pages, and nothing degraded / excluded / malformed / evidence-incomplete / load-more-errored.
  const cleanComplete = isWholeQueryComplete(current) && state === SECTION_STATES.AVAILABLE && !!counts
    && counts.excludedRejected === 0 && counts.malformedOmitted === 0 && counts.evidenceIncomplete === 0;

  let summary;
  if (loading && !current) summary = "Loading equipment compatibility…";
  else if (state === SECTION_STATES.EMPTY) summary = "No known equipment compatibility is recorded for this part.";
  else if (state === SECTION_STATES.UNAVAILABLE) summary = "Compatibility information is temporarily unavailable.";
  else if (state === SECTION_STATES.DENIED) summary = "You don't have access to compatibility information.";
  else summary = `Showing ${items.length} equipment compatibility record${items.length === 1 ? "" : "s"}.`;

  return (
    <section className="fo-card fo-equipment-compat" aria-labelledby="used-in-equipment-heading">
      <h3 id="used-in-equipment-heading">Used In Equipment</h3>
      <p role="status" className="fo-sr-only">{summary}</p>

      {state === SECTION_STATES.LOADING && <p className="fo-muted">Loading equipment compatibility…</p>}

      {state === SECTION_STATES.DENIED && <p className="fo-muted">You don't have access to compatibility information.</p>}

      {state === SECTION_STATES.UNAVAILABLE && (
        <p className="fo-muted" role="alert">
          Compatibility information is temporarily unavailable.{" "}
          <button type="button" className="fo-link-btn" onClick={reload}>Retry</button>
        </p>
      )}

      {state === SECTION_STATES.EMPTY && <p className="fo-muted">No known equipment compatibility is recorded for this part.</p>}

      {showList && (
        <>
          {state === SECTION_STATES.DEGRADED && (
            <p className="fo-muted" role="status">
              Some compatibility records could not be fully evaluated and are not shown as complete.
            </p>
          )}
          <div className="fo-table-scroll">
            <table className="fo-table fo-equipment-compat-table">
              <thead>
                <tr><th>Equipment model</th><th>Fit</th><th>Applies to</th><th>Status</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                {items.map((item, i) => <RelationshipRow key={i} item={item} />)}
              </tbody>
            </table>
          </div>
          {counts && counts.excludedRejected > 0 && (
            <p className="fo-muted">{counts.excludedRejected} record(s) excluded from review.</p>
          )}
          {current && current.loadMoreError && (
            <p className="fo-muted" role="alert">Couldn't load more right now. The records above are still shown.</p>
          )}
          {current && current.hasMore && (
            <button type="button" className="fo-btn-secondary" onClick={showMore} disabled={loading}>
              {loading ? "Loading…" : "Show more"}
            </button>
          )}
          {cleanComplete && <p className="fo-muted fo-equipment-compat-complete">No more records to load.</p>}
        </>
      )}
    </section>
  );
}
