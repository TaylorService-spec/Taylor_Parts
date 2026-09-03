import { useMemo } from "react";
import { PageHeader, SectionHeader, StatusIndicator } from "../../shared/ui/primitives";
import { buildFinancialPolicyView, VIEW_STATE } from "../../domain/financialPolicyView";

// Administration -> Company Setup -> Financial Policy.
//
// THE ONE PLACE a company's accounting policy is configured. Financials shows a read-only summary
// and links here; there is deliberately no second edit surface, because two places to change an
// accounting method is two places for them to disagree.
//
// ============================ WHY THIS IS CONFIGURATION, NOT FINANCE ============================
//
// This is not routine financial work. It is a deployment activity: the customer's accounting team
// chooses the policy once, it is approved as part of the implementation, and it locks when that
// company's financial authority goes live. It sits with Users, Roles and Warehouse Racking because
// that is the kind of thing it is.
//
// ============================ THE HONEST PARTS ============================
//
// BOTH capabilities are registered `active: false` and granted to no Role, so today this screen
// renders its ungated state everywhere. That is stated rather than dressed up as "no policy
// configured" -- an empty policy and a refused read look identical to an operator, and only one of
// them means the company still needs configuring.
//
// THE LOCK IS NOT THIS SCREEN'S DOING. Read-only rendering here is a courtesy. The trusted command
// re-reads the stored status inside its transaction and refuses a locked profile no matter what any
// client believes, so a crafted request or a stale tab hits the same wall. There is no unlock
// control, and there is no admin bypass -- Admin can do most operational things in EOS and
// deliberately cannot do this one.
//
// A BLOCKED RECOGNITION POINT IS SHOWN, NOT HIDDEN. Work-order consumption appears with the reason
// it cannot be chosen. Omitting it would read as "EOS does not support that"; showing it disabled
// says the true thing, which is that a prerequisite is missing.
//
// STYLING reuses the existing `fo-` vocabulary only (panel / muted / wizard-hint / tabular-nums),
// the same palette AdminWarehouseRacking uses. No new class is invented: a component naming a class
// asserts that rule exists, and cssClassCoverage holds it to that.

const CAP_READ = "financialPolicy.profile.read";
const CAP_CONFIGURE = "financialPolicy.profile.configure";

function Ungated({ capability }) {
  return (
    <StatusIndicator tone="neutral">
      Financial policy is not available to you. It needs <code>{capability}</code>, which is not
      active for this environment and is not granted to any role yet.
    </StatusIndicator>
  );
}

/** One configured choice, shown as a value. A control appears only where editing is real. */
function PolicyChoice({ title, options, selectedId }) {
  const selected = options.find((o) => o.id === selectedId) ?? null;
  return (
    <div>
      <div className="fo-muted">{title}</div>
      <div>{selected ? selected.label : <span className="fo-muted">Not configured</span>}</div>
      {selected ? <p className="fo-wizard-hint">{selected.description}</p> : null}
    </div>
  );
}

export default function AdminFinancialPolicy({
  hasCapability,
  operatingCompanyId = null,
  operatingCompanyName = null,
  profile = null,
  loading = false,
  error = null,
}) {
  const canRead = typeof hasCapability === "function" && hasCapability(CAP_READ);
  const canConfigure = typeof hasCapability === "function" && hasCapability(CAP_CONFIGURE);

  const view = useMemo(
    () =>
      buildFinancialPolicyView({
        canRead,
        canConfigure,
        loading,
        error,
        operatingCompanyId,
        operatingCompanyName,
        profile,
      }),
    [canRead, canConfigure, loading, error, operatingCompanyId, operatingCompanyName, profile],
  );

  return (
    <div>
      <PageHeader
        title="Financial Policy"
        subtitle="Accounting policies are established with your accounting team during EOS deployment. Once financial authority is activated, this profile is locked."
      />

      {view.state === VIEW_STATE.UNGATED ? <Ungated capability={view.capability} /> : null}
      {view.state === VIEW_STATE.LOADING ? (
        <StatusIndicator tone="neutral">Loading this company&rsquo;s financial policy&hellip;</StatusIndicator>
      ) : null}
      {view.state === VIEW_STATE.FAILED ? (
        <StatusIndicator tone="critical">
          This company&rsquo;s financial policy could not be read. Nothing was changed.
        </StatusIndicator>
      ) : null}

      {view.state === VIEW_STATE.READY ? (
        <>
          {/* ── A. STATUS ─────────────────────────────────────────────────────────────────── */}
          <section className="fo-panel" aria-label="Status">
            <SectionHeader title="Status" />
            <div>
              <div className="fo-muted">Operating company</div>
              <div>
                {view.operatingCompanyName ?? view.operatingCompanyId ?? (
                  <span className="fo-muted">Not identified</span>
                )}
              </div>
            </div>
            <StatusIndicator tone={view.statusCopy.tone}>{view.statusCopy.label}</StatusIndicator>
            <p className="fo-wizard-hint">{view.statusCopy.hint}</p>

            {/* ── F. LOCKED STATE ─── prominent, and deliberately not alarming: a locked policy is
                the system working, not a fault. No unlock control exists anywhere on this page. */}
            {view.locked ? (
              <StatusIndicator tone="neutral" role="status">
                {view.lockedMessage}
              </StatusIndicator>
            ) : null}
            {!view.locked && view.readOnlyReason ? (
              <p className="fo-wizard-hint">{view.readOnlyReason}</p>
            ) : null}
          </section>

          {/* ── B. INVENTORY COSTING ──────────────────────────────────────────────────────── */}
          <section className="fo-panel" aria-label="Inventory costing">
            <SectionHeader
              title="Inventory costing"
              description="How EOS determines the cost of stock leaving inventory, and the value of what remains."
            />
            <PolicyChoice
              title="Interchangeable inventory"
              options={view.inventoryCostMethods}
              selectedId={view.policy?.inventoryCostMethod ?? null}
            />
            <PolicyChoice
              title="Identifiable or serialized inventory"
              options={view.serializedCostMethods}
              selectedId={view.policy?.serializedInventoryCostMethod ?? null}
            />
          </section>

          {/* ── C. COGS RECOGNITION ───────────────────────────────────────────────────────── */}
          <section className="fo-panel" aria-label="COGS recognition">
            <SectionHeader
              title="COGS recognition"
              description="The business event at which inventory cost becomes cost of goods sold. Moving stock between locations is never one of them."
            />
            <PolicyChoice
              title="Recognition event"
              options={view.cogsRecognitionPoints}
              selectedId={view.policy?.cogsRecognitionPointId ?? null}
            />
            <ul>
              {view.cogsRecognitionPoints.map((point) => (
                <li key={point.id}>
                  <StatusIndicator tone={point.available ? "positive" : "attention"}>
                    {point.available ? point.label : `${point.label} — unavailable`}
                  </StatusIndicator>
                  <p className="fo-wizard-hint">
                    {point.available ? point.description : point.blockedReason}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* ── D. COST TREATMENT ─────────────────────────────────────────────────────────── */}
          <section className="fo-panel" aria-label="Cost treatment">
            <SectionHeader
              title="Cost treatment"
              description="Deployment choices, and the platform rules that are not choices."
            />
            <div>
              <div className="fo-muted">Inbound freight</div>
              <div>Excluded from inventory cost</div>
              <p className="fo-wizard-hint">
                Capitalizing freight requires an approved, repeatable allocation method. Until one
                exists, EOS records the item&rsquo;s acquisition cost and nothing else &mdash; rather
                than inventing a per-item split.
              </p>
            </div>
            <div>
              <div className="fo-muted">Other landed costs</div>
              <div>Excluded from inventory cost</div>
              <p className="fo-wizard-hint">
                Duties, fees and other inbound costs are treated the same way, for the same reason.
              </p>
            </div>

            {/* Invariants are STATEMENTS. Rendering one as a control would invite a request for the
                other option, and there is no other option. */}
            <SectionHeader
              title="Platform rules"
              description="These apply to every deployment and cannot be configured."
            />
            <ul>
              {view.invariants.map((inv) => (
                <li key={inv.id} className="fo-muted">
                  {inv.statement}
                </li>
              ))}
            </ul>
          </section>

          {/* ── E. ACCOUNTING APPROVAL ────────────────────────────────────────────────────── */}
          <section className="fo-panel" aria-label="Accounting approval">
            <SectionHeader
              title="Accounting approval"
              description="Who signed this policy off during deployment. A record, not an electronic signature."
            />
            {view.approval === null ? (
              <StatusIndicator tone="attention">
                No accounting approval is recorded. This policy cannot be activated without one.
              </StatusIndicator>
            ) : (
              <dl>
                <dt className="fo-muted">Approved by</dt>
                <dd>{view.approval.approvedBy}</dd>
                <dt className="fo-muted">Approval date</dt>
                <dd className="fo-tabular-nums">{view.approval.approvedOn}</dd>
                <dt className="fo-muted">Reference</dt>
                <dd>{view.approval.reference ?? <span className="fo-muted">None</span>}</dd>
                <dt className="fo-muted">Recorded in EOS by</dt>
                <dd>{view.approval.recordedByUid}</dd>
              </dl>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
