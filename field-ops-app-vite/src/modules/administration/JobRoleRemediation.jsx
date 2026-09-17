import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../shared/ui/primitives/index.js";
import { WORKFORCE_READS, describeLifecycle, describeWorkforceFailure, recordDisplayName } from "../../domain/employeeOperatingProfile.js";
import { describeJobRoleRemediation } from "../../domain/employeeJobRole.js";
import { WorkforceFailure } from "../employees/EmployeeProfileSections.jsx";

// ADMINISTRATION → USERS: EMPLOYEES WITHOUT A JOB ROLE (EMP-RT-08 remediation).
//
// The Owner ruling: an Employee may have no Job Role, nothing is inferred, and Employees without one appear in an
// Administration remediation view so an administrator can assign them explicitly. This is that view: the governed
// read listEmployeesWithoutJobRole (a server count plus a keyset-paged list of directory items), each Employee linking
// to their record, where the Job Role section offers the governed control.
//
// Silent when the count is 0 or the read is still in flight (the directory beside it owns the page's loading state).
// A refusal or an outage is stated, never rendered as "everyone has a Job Role". No fallback, no second source.
export default function JobRoleRemediation({ workforce }) {
  const operation = WORKFORCE_READS.EMPLOYEES_WITHOUT_JOB_ROLE.operation;
  const [state, setState] = useState({ status: "loading", count: 0, items: [], nextCursor: null, error: null, moreError: null, loadingMore: false });
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    setState({ status: "loading", count: 0, items: [], nextCursor: null, error: null, moreError: null, loadingMore: false });
    Promise.resolve(workforce.call(operation, {}))
      .catch(() => ({ ok: false, code: "INTERNAL" }))
      .then((outcome) => {
        if (run !== runRef.current) return;
        if (outcome?.ok) {
          const r = outcome.result ?? {};
          setState({ status: "ready", count: r.count, items: Array.isArray(r.items) ? r.items : [], nextCursor: r.nextCursor ?? null, error: null, moreError: null, loadingMore: false });
        } else {
          setState((s) => ({ ...s, status: "failed", error: outcome ?? { code: "INTERNAL" } }));
        }
      });
  }, [workforce, operation, nonce]);

  const loadMore = useCallback(() => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore) return;
    const run = runRef.current;
    setState((s) => ({ ...s, loadingMore: true, moreError: null }));
    Promise.resolve(workforce.call(operation, { cursor }))
      .catch(() => ({ ok: false, code: "INTERNAL" }))
      .then((outcome) => {
        if (run !== runRef.current) return;
        if (outcome?.ok) {
          const r = outcome.result ?? {};
          setState((s) => ({ ...s, items: [...s.items, ...(Array.isArray(r.items) ? r.items : [])], nextCursor: r.nextCursor ?? null, loadingMore: false }));
        } else {
          setState((s) => ({ ...s, loadingMore: false, moreError: outcome ?? { code: "INTERNAL" } }));
        }
      });
  }, [workforce, operation, state.nextCursor, state.loadingMore]);

  if (state.status === "loading") return null;
  if (state.status === "failed") {
    return (
      <div className="ns-emp-edit-notice" data-job-role-remediation="FAILED">
        <WorkforceFailure
          error={state.error}
          subject="The count of Employees without a Job Role"
          onRetry={() => setNonce((n) => n + 1)}
          readId={WORKFORCE_READS.EMPLOYEES_WITHOUT_JOB_ROLE.id}
        />
      </div>
    );
  }
  const remediation = describeJobRoleRemediation({ count: state.count });
  if (!remediation) return null;

  return (
    <div className="ns-emp-edit-notice" data-job-role-remediation={remediation.count}>
      <p className="ns-state">
        <strong>{remediation.words}</strong>
      </p>
      <p className="fo-muted ns-emp-note">{remediation.note}</p>
      <details className="ns-emp-disclosure">
        <summary>Show Employees without a Job Role</summary>
        <ul className="ns-emp-records" aria-label="Employees without a Job Role">
          {state.items.map((item) => (
            <li key={item.employeeId} className="ns-emp-record">
              <span className="ns-emp-record__title">
                <Link className="ns-emp-link" to={`/administration/users/${item.employeeId}`}>
                  {recordDisplayName(item)}
                </Link>
              </span>
              <span className="ns-emp-record__state">{describeLifecycle(item.employmentStatus).words}</span>
            </li>
          ))}
        </ul>
        {state.moreError ? <p className="ns-state ns-state--denied">{describeWorkforceFailure(state.moreError, "More Employees without a Job Role").words}</p> : null}
        {state.nextCursor ? (
          <div className="fo-btn-row">
            <Button variant="secondary" onClick={loadMore} disabled={state.loadingMore} loading={state.loadingMore}>
              Show more Employees without a Job Role
            </Button>
          </div>
        ) : null}
      </details>
    </div>
  );
}
