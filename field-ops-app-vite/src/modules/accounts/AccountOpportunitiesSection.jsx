import { useAccountOpportunities } from "../../hooks/useAccountOpportunities.js";
import { accountOpportunitiesView, ACCOUNT_OPPORTUNITIES_STATE } from "../../domain/accountOpportunitiesView.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import { stageLabel } from "../../domain/opportunityLifecycle.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";
import { Link } from "react-router-dom";

// Account-scoped Opportunities -- Wave 7 completion PART 2. Reads the trusted
// `listOpportunitiesForAccount` callable (functions/src/opportunity/opportunityReadService.ts,
// capability `opportunity.read` -- the SAME capability listOpportunityContext already uses, reused
// rather than a new one minted). "Deep link" here means the shared Opportunities workspace
// (/opportunities): the app has no per-Opportunity addressable URL today (SalesWorkspace selects a row
// via in-page state, not a route param) -- linking to a route that doesn't exist would be a broken
// link, not a real deep link, so this points at the real destination honestly.
//
// EMPTY vs FAILURE (the single most important behavioral requirement here): EMPTY renders ONLY when
// the read genuinely succeeded with zero rows. denied/unavailable render FailureState -- never the
// empty-state copy. See domain/accountOpportunitiesView.js for the state machine this renders.
function formatDate(millis) {
  if (typeof millis !== "number" || !Number.isFinite(millis)) return null;
  return new Date(millis).toLocaleDateString();
}

function formatValue(expectedValue) {
  // expectedValue is a plain authoritative number on the Opportunity projection (not a minor-unit
  // currency amount like the AR/invoice surfaces) -- shown as-is, never invented from nothing.
  if (typeof expectedValue !== "number" || !Number.isFinite(expectedValue)) return null;
  return expectedValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function AccountOpportunitiesSection({ accountId }) {
  const { loading, errorStatus, result } = useAccountOpportunities(accountId);
  const { byEmployeeId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();
  const view = accountOpportunitiesView({ loading, errorStatus, result });

  return (
    <section id="account-opportunities-section" className="wo-history" aria-label="Opportunities">
      <h4>Opportunities</h4>

      {view.kind === ACCOUNT_OPPORTUNITIES_STATE.LOADING && <p className="fo-muted">Loading opportunities…</p>}

      {view.kind === ACCOUNT_OPPORTUNITIES_STATE.DENIED && (
        <FailureState title="Opportunities unavailable" message="You are not authorized to view Opportunities for this account." />
      )}

      {view.kind === ACCOUNT_OPPORTUNITIES_STATE.UNAVAILABLE && (
        <p className="fo-muted" data-opportunities-unavailable>Opportunities are currently unavailable. Try again later.</p>
      )}

      {/* EMPTY renders ONLY on a genuinely succeeded read with zero rows -- never on denied/unavailable
          above, which is exactly the distinction site-work's fail-closed rule requires. */}
      {view.kind === ACCOUNT_OPPORTUNITIES_STATE.EMPTY && <p className="fo-muted">No opportunities on this account.</p>}

      {view.kind === ACCOUNT_OPPORTUNITIES_STATE.READY && (
        <div>
          {view.truncated && (
            <p className="fo-muted" role="status">
              Showing the first {view.rows.length} opportunities — more may exist on this account.
            </p>
          )}
          <ul className="fo-activity-list">
            {view.rows.map((row) => {
              const owner = resolveEmployeeIdentity(row.ownerEmployeeId, { byEmployeeId, loading: directoryLoading, error: directoryError });
              const value = formatValue(row.expectedValue);
              const closeDate = formatDate(row.expectedCloseAt);
              return (
                <li key={row.key}>
                  <Link to="/opportunities">{row.label}</Link>{" "}
                  <StatusPill tone="info" label={stageLabel(row.stage)} />{" "}
                  <span className="fo-muted">
                    {value ? <>value {value}</> : null}
                    {owner.state !== "unset" && (value ? " · " : "")}
                    {owner.state === "loading" ? "owner loading…" : owner.state === "unset" ? "" : `owner: ${owner.name}`}
                    {closeDate ? ` · expected close ${closeDate}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
