import { useCallback, useEffect, useMemo, useState } from "react";
import ChangeHistory from "../../shared/ui/ChangeHistory.jsx";
import { normalizeHistoryRows } from "../../domain/changeHistory.js";
import {
  GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS,
  GOVERNED_EMPLOYEE_HISTORY_FIELD_LABELS,
  governedHistoryRows,
} from "../../domain/employeeChangeHistory.js";
import { READ_FAILURE_KIND, WORKFORCE_READS, describeWorkforceFailure } from "../../domain/employeeOperatingProfile.js";

// THE GOVERNED EMPLOYEE CHANGE HISTORY SECTION (EMP-RT-H1).
//
// Reads listEmployeeChangeHistory from the governed Workforce transport -- the PostgreSQL audit trail of every governed
// Employee change (profile, manager, Employment Status, Operating Company, Job Role) -- and renders it in the shared
// Change History grammar. No fallback: a refusal says "not available to you", an outage says it could not be loaded,
// and neither is ever an empty history. Paged by the server's opaque cursor ("Show more" appends the next page).
//
// `reloadKey` is the page's re-read signal: bump it after anything that writes the Employee (a saved edit, a Job Role
// assignment) and the section reads page one again. It never renders what a form typed.

export const GOVERNED_HISTORY_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  REFUSED: "REFUSED",
  FAILED: "FAILED",
});

const PAGE_SIZE = 50;
const SUBJECT = "This Employee's change history";

export default function EmployeeChangeHistorySection({ employeeId, workforce, reloadKey = 0 }) {
  const [state, setState] = useState({ status: GOVERNED_HISTORY_STATE.LOADING, items: [], nextCursor: null, error: null });
  const [more, setMore] = useState({ loading: false, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!employeeId) return undefined;
    let alive = true;
    setState({ status: GOVERNED_HISTORY_STATE.LOADING, items: [], nextCursor: null, error: null });
    setMore({ loading: false, error: null });
    Promise.resolve(workforce.call(WORKFORCE_READS.EMPLOYEE_CHANGE_HISTORY.operation, { employeeId, limit: PAGE_SIZE }))
      .catch(() => ({ ok: false, code: "INTERNAL" }))
      .then((outcome) => {
        if (!alive) return;
        if (outcome?.ok) {
          setState({ status: GOVERNED_HISTORY_STATE.READY, items: outcome.result?.items ?? [], nextCursor: outcome.result?.nextCursor ?? null, error: null });
        } else {
          const error = outcome ?? { ok: false, code: "INTERNAL" };
          const refused = describeWorkforceFailure(error, SUBJECT).kind === READ_FAILURE_KIND.NOT_AVAILABLE_TO_YOU;
          setState({ status: refused ? GOVERNED_HISTORY_STATE.REFUSED : GOVERNED_HISTORY_STATE.FAILED, items: [], nextCursor: null, error });
        }
      });
    return () => {
      alive = false;
    };
  }, [workforce, employeeId, reloadKey, nonce]);

  const showMore = useCallback(async () => {
    if (!state.nextCursor || more.loading) return;
    setMore({ loading: true, error: null });
    const cursor = state.nextCursor;
    const outcome = await Promise.resolve(
      workforce.call(WORKFORCE_READS.EMPLOYEE_CHANGE_HISTORY.operation, { employeeId, limit: PAGE_SIZE, cursor }),
    ).catch(() => ({ ok: false, code: "INTERNAL" }));
    if (outcome?.ok) {
      setState((s) => (s.nextCursor === cursor
        ? { ...s, items: [...s.items, ...(outcome.result?.items ?? [])], nextCursor: outcome.result?.nextCursor ?? null }
        : s));
      setMore({ loading: false, error: null });
    } else {
      setMore({ loading: false, error: describeWorkforceFailure(outcome, "The next page of change history").words });
    }
  }, [workforce, employeeId, state.nextCursor, more.loading]);

  const rows = useMemo(
    () => normalizeHistoryRows(governedHistoryRows(state.items), {
      fieldLabels: GOVERNED_EMPLOYEE_HISTORY_FIELD_LABELS,
      eventLabels: GOVERNED_EMPLOYEE_HISTORY_EVENT_LABELS,
    }),
    [state.items],
  );

  const failure = state.error ? describeWorkforceFailure(state.error, SUBJECT) : null;
  const footer = state.nextCursor || more.error ? (
    <div className="fo-btn-row" data-governed-history-more={more.loading ? "LOADING" : more.error ? "FAILED" : "AVAILABLE"}>
      {more.error ? <p className="ns-state ns-state--denied" role="status">{more.error}</p> : null}
      {state.nextCursor ? (
        <button type="button" onClick={showMore} disabled={more.loading}>
          {more.loading ? "Loading more…" : "Show more"}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div data-governed-history={state.status}>
      <ChangeHistory
        title="Change History"
        meta={`Governed Employee changes, from the Workforce service (${WORKFORCE_READS.EMPLOYEE_CHANGE_HISTORY.id})`}
        sectionId="employee-change-history"
        testId="governed-change-history-table"
        loadingMessage="Loading the governed change history…"
        unavailableTitle={state.status === GOVERNED_HISTORY_STATE.REFUSED ? "Change history not available to you" : "Change history could not be loaded"}
        unknownActorLabel="Not shown"
        rows={rows}
        loading={state.status === GOVERNED_HISTORY_STATE.LOADING}
        unavailable={failure ? failure.words : null}
        onRetry={failure?.retryable ? () => setNonce((n) => n + 1) : null}
        emptyMessage="No governed changes have been recorded for this Employee yet."
        footer={footer}
        showReason
        caption="Manager and Job Role names are shown as they are named today, not as they were named at the time of the change."
      />
    </div>
  );
}
