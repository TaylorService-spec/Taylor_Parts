import { useNavigate } from "react-router-dom";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { Button } from "../../shared/ui/primitives";
import { formatMinorUnits } from "../../domain/money.js";
import { useSalesAgreementIndex } from "../../hooks/useSalesAgreementIndex.js";
import {
  SALES_AGREEMENT_INDEX_STATE,
  salesAgreementHref,
} from "../../domain/salesAgreementIndex.js";

// SALES AGREEMENTS -- the cross-account index. Owner ruling D, Wave 16 / Lane BQ.
//
// ════════════════════ WHAT THIS CLOSES ════════════════════
//
// `salesAgreement.read` is registered under Object `salesAgreement` and held by six Security Roles
// (admin, dispatcher, generalManager, owner, salesManager, salesperson), the governed cross-account
// read `listSalesAgreements` has existed since wave C3, and a salesperson still saw nothing about
// Sales Agreements anywhere in the product: the only destination was the record page at
// /customers/opportunities/sales-agreement/:id, reachable by first opening the Opportunity that
// created it. The server catalog carried that as a DESTINATION gap and named the Sales Orders index
// as the precedent for closing it. This is that precedent applied -- and the gap entry is deleted in
// the same commit, because it is no longer true.
//
// NO NEW CAPABILITY AND NO NEW GRANT. This screen reads through `salesAgreement.read` and nothing
// else, and the read re-authorizes server-side regardless of what the navigation let through.
//
// ════════════════════ WHY THIS IS NOT ON THE METADATA LIST RUNTIME ════════════════════
//
// SalesOrdersList.jsx records a correction worth honouring: an earlier version of it was a
// hand-rolled table beside a metadata definition that already described the same object, and "two
// list implementations for one object is how the definitions and the screen drift apart". The
// runtime is the right home for a list.
//
// It cannot serve this one TODAY, for a mechanical reason rather than a preference.
// `useMetadataList` reads through `metadata/callableListSource.js`, whose every source is a FIREBASE
// CALLABLE; the governed Sales Agreement index read is an EOS HTTP operation on the C4 Commercial
// transport (POST /commercial/sales), which that runtime has no source kind for. The two honest ways
// to close that are (a) teach the runtime a second source kind or (b) add a Firebase callable
// mirroring `listSalesAgreements`; (b) would be a second governed read of the same rows behind a
// second authority, which is the drift the correction above is about, and (a) is a change to the
// shared list runtime that this lane does not own. So this screen is deliberately SMALL: one read,
// five columns, no filters, no saved views, no sort controls -- nothing that would have to be
// unpicked when the runtime grows the source kind and `salesAgreementEntity` (which already exists,
// with `listViews: []`) gets its index descriptor.
//
// NOTHING IS INVENTED TO FILL IT, AND TWO COLUMNS ARE ABSENT FOR STATED REASONS.
//
//   No SALESPERSON column. The projection's `owner` is `{ employeeId, displayName: null, resolved }`
//   -- it deliberately does not resolve a name, so a Salesperson column could only ever print the
//   unresolved placeholder on every row. That is precisely the "Created" column SalesOrdersList.jsx
//   removed for being "bound to a field the write path never stores, so that column could only ever
//   print an em dash". A column that cannot carry data is worse than a missing one, because it looks
//   like data that failed to load. When the projection resolves names, the column arrives with them.
//
//   No CREATED column. `createdAt` is real, but the list is sorted `salesAgreementNumber DESC`
//   server-side with no control to change it, and a timestamp column implies a sort the reader
//   cannot use.
//
// Money is rendered from the projection's computed totals through the shared formatter, and a null
// total prints "Not priced" rather than a dash -- NULL IS NOT ZERO, and it is not a missing value
// either: the agreement has an unpriced line, which is a fact about the commitment.
//
// ════════════════════ THE EMPTY STATE IS THE STATE IT WILL BE IN ════════════════════
//
// `eos_commercial.sales_agreements` is EMPTY in nonprod -- the C5 Commercial seed has not been
// executed, and the twelve synthetic records were deleted on 2026-09-23. So this screen ships
// showing its empty state, and that is correct: the alternative is seeding commercial records to
// make a screenshot look populated, which would put fabricated commitments in front of a reader.
// EMPTY, REFUSED and UNAVAILABLE are three different sentences here and none of them is a spinner
// that never resolves -- domain/salesAgreementIndex.js decides which, in pure code a node test can
// reach.
//
// ════════════════════ ...BUT ONLY ONCE THE WRITER IS HERE (lane S3) ════════════════════
//
// The paragraph above is true of the TABLE and was false of the SCREEN: every Agreement command
// still writes Firestore `sales_agreements` through Firebase callables, so "No Sales Agreements
// exist for this company yet" was printed while agreements existed on their Opportunities. Until the
// Commercial writer cuts over, an empty page renders NOT_CUT_OVER (where Agreements actually are, no
// empty-portfolio claim, no retry) and rows that do come back carry an "incomplete" notice. The index
// does NOT read the Firestore-era callables to fill itself: there is no list callable, and adding one
// would be a second authority for the same rows. See domain/salesAgreementIndex.js.

const STATE_LABEL = Object.freeze({
  DRAFT: "Draft",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
});

/** The committed total, or the honest reason there is not one. Never a blank cell, never a zero. */
function totalCell(row) {
  const minor = row?.totals?.totalMinor;
  if (typeof minor !== "number") return "Not priced";
  return `${row.currency ?? ""} ${formatMinorUnits(minor, row.currency)}`.trim();
}

// `client` is the transport seam, defaulted inside the hook to the real Commercial client. It is a
// prop for one reason: so a test can drive the REAL read path against a canned HTTP answer instead
// of a hand-written view object. Production never passes it (App.jsx renders `<SalesAgreementsList />`).
// `writeAuthority` is the same kind of seam, for the post-cutover behaviour; production never passes
// it either, so the domain's current value decides.
export default function SalesAgreementsList({ client = undefined, writeAuthority = undefined }) {
  const navigate = useNavigate();
  const { view, reload } = useSalesAgreementIndex({
    ...(client ? { client } : {}),
    ...(writeAuthority ? { writeAuthority } : {}),
  });

  const body = () => {
    switch (view.state) {
      case SALES_AGREEMENT_INDEX_STATE.LOADING:
        return <HonestState state={HONEST_STATE.LOADING} subject="Sales agreements" />;
      case SALES_AGREEMENT_INDEX_STATE.REFUSED:
        // A PERMISSION FACT, not a failure. No retry affordance: retrying cannot change it.
        return <HonestState state={HONEST_STATE.DENIED} subject="Sales agreements" detail={view.reason} />;
      case SALES_AGREEMENT_INDEX_STATE.UNAVAILABLE:
        return (
          <HonestState
            state={HONEST_STATE.UNAVAILABLE}
            subject="Sales agreements"
            detail={view.reason}
            action={<Button type="button" variant="primary" onClick={reload}>Retry</Button>}
          />
        );
      case SALES_AGREEMENT_INDEX_STATE.EMPTY:
        // TRUE EMPTY: the read succeeded and there are none. Not a filtered view (this list has no
        // filters to have narrowed anything) and not a denial.
        return <HonestState state={HONEST_STATE.EMPTY} subject="Sales agreements" detail={view.reason} />;
      case SALES_AGREEMENT_INDEX_STATE.NOT_CUT_OVER:
        // NOT EMPTY AND NOT A FAILURE. The read succeeded against a store Agreements are not yet
        // written to. No retry: retrying cannot change the answer before the writer moves.
        return <HonestState state={HONEST_STATE.NOT_ENABLED} subject="Sales agreements" detail={view.reason} />;
      default:
        return (
          <>
            {view.reason ? <p className="ns-state ns-state--not-enabled">{view.reason}</p> : null}
            <div className="ns-table-wrap">
              <table className="ns-table ns-collection__table">
                <caption className="sr-only">Sales Agreements</caption>
                <thead>
                  <tr>
                    <th scope="col">Agreement</th>
                    <th scope="col">Customer</th>
                    <th scope="col">State</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      role="link"
                      onClick={() => navigate(salesAgreementHref(row.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(salesAgreementHref(row.id));
                        }
                      }}
                    >
                      <td>{row.salesAgreementNumber}</td>
                      {/* THE NAME, OR THE HONEST ABSENCE OF ONE. The projection LEFT JOINs the CRM
                          account, so `accountName` is null when the customer row is not readable or
                          not there -- and a document id is a routing key, not content, so it is
                          never printed in its place. */}
                      <td>{row.accountName ?? <span className="fo-muted">Unresolved customer</span>}</td>
                      <td>{STATE_LABEL[row.state] ?? row.state}</td>
                      <td>{totalCell(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* THE PAGE IS A PAGE, AND SAYS SO. There is no "load more" because this screen issues
                one read; claiming completeness it does not have would be worse than the sentence. */}
            {view.truncated ? (
              <p className="fo-muted">
                More Sales Agreements exist than are shown. Paging is not built on this screen yet.
              </p>
            ) : null}
          </>
        );
    }
  };

  return (
    <WorkspaceIdentity
      crumb="CRM / Sales"
      title="Sales Agreements"
      // NO COUNT. `count` is for a governed aggregate over the same question the list asked, and
      // there is none for Sales Agreements -- a tally of the loaded page presented as the count is a
      // claim about the business drawn from one screenful, which is the mistake the Sales Orders
      // screen's own header note warns about.
      count={null}
      // NO CREATE ACTION, and its absence is a fact rather than an omission. A Sales Agreement is
      // created FROM an Opportunity, by the governed createSalesAgreement command on that
      // Opportunity's record page. A disabled "New agreement" here would describe a permission
      // boundary when the truth is that creation belongs to another object.
      summaryItems={[]}
    >
      {/* THE PAGE-STATE CONTRACT, MACHINE-READABLE. COMPLETE | PARTIAL_AUTHORITY | UNAVAILABLE (absent
          while loading) -- decided in domain/salesAgreementIndex.js, never here. `display: contents`
          so the marker adds no box and changes no layout. */}
      <div
        className="sales-agreement-index__body"
        style={{ display: "contents" }}
        data-authority-completeness={view.authorityCompleteness ?? undefined}
      >
        {body()}
      </div>
    </WorkspaceIdentity>
  );
}
