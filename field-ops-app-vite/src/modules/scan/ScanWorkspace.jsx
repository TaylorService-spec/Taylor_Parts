import { useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { Button } from "../../shared/ui/primitives/index.js";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import { RECEIVING_TRANSPORT_READY } from "../../config/receivingReadiness.js";
import {
  deriveScanWorkflows,
  SCAN_WORKFLOW,
  SCAN_WORKFLOW_LABEL,
  SCAN_WORKFLOW_DESCRIPTION,
  UNAVAILABLE_TEXT,
} from "../../access/scanWorkflows.js";
import MultiScanReceiving from "../receiving/MultiScanReceiving.jsx";
import PartsScanner from "../mobile/PartsScanner.jsx";

// THE SHARED SCAN WORKSPACE.
//
// One entry point that offers whichever scanning workflows the caller may actually use, derived from
// the EXISTING effective-access model rather than from a role name. It composes the two journeys that
// exist; it implements neither.
//
// ============================ COMPOSES, DOES NOT COPY ============================
//
// Supplier receiving IS the Phase D component (modules/receiving/MultiScanReceiving.jsx), mounted
// here unchanged. Technician scanning IS the existing PartsScanner, mounted here unchanged and still
// mounted in FieldMode. There is no second receiving component, no second queue, no second
// receipt-progress calculation and no second PO normalizer — so every property Phase D proved (raw
// observations, projected totals, serials never aggregated, duplicate serial blocked, over-receipt
// attributed to the crossing scan, any blocked entry preventing submission, UNKNOWN never becoming
// NONE, scanning moving nothing, one atomic receipt) holds here because it is literally the same
// code.
//
// ============================ THE TECHNICIAN JOURNEY IS NOT MOVED ============================
//
// FieldMode still composes PartsScanner exactly as before. This workspace is an ADDITIONAL entry
// point, not a relocation: nothing is deleted, nothing is stranded, and a technician who never comes
// here loses nothing.
//
// ============================ WHAT IS ABSENT, AND WHY ============================
//
// Put-away, pick, stage, transfer, return, cycle count and truck handoff are not listed — not listed
// DISABLED, not listed at all. A disabled control would say the operation exists and that access is
// the only obstacle. Those commands are not built, so saying so would be false.
//
// Lookup-only scanning is likewise absent: every read it would need
// (inventory.catalog.read, inventory.serializedAsset.read, inventory.location.display.read) is
// registered active:false and denies for everyone, so a lookup screen could only show blanks or
// invented values. Recorded as the immediate follow-on rather than shallow-built.

export default function ScanWorkspace({ deps }) {
  const [active, setActive] = useState(null);

  // TECHNICIAN CONTEXT IS RESOLVED HERE, not passed in. `renderSubnavItem` in App.jsx is a plain
  // function rather than a component and cannot call hooks, so the shell can hand over the
  // capability gate and the role but not an identity that needs a live subscription.
  //
  // These are the SAME two hooks FieldMode uses, so the two entry points cannot disagree about who
  // the technician is or what they are assigned. `deps` overrides them in tests.
  const liveTechnician = useCurrentTechnician();
  const technicianId = deps?.technicianId !== undefined ? deps.technicianId : liveTechnician.technicianId;
  const liveWorkOrders = useAssignedWorkOrders(technicianId);
  const assignedWorkOrderCount = deps?.assignedWorkOrderCount !== undefined
    ? deps.assignedWorkOrderCount
    : (liveWorkOrders.data?.length ?? 0);

  // The trusted gate comes from the shell, which already resolves it for every governed nav surface.
  const workflows = deriveScanWorkflows({
    hasCapability: deps?.hasCapability,
    receivingReady: deps?.receivingReady ?? RECEIVING_TRANSPORT_READY,
    role: deps?.role ?? null,
    technicianId,
    assignedWorkOrderCount,
  });

  if (active === SCAN_WORKFLOW.SUPPLIER_RECEIVING) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Receive" />
        <button type="button" className="fo-link-btn" onClick={() => setActive(null)}>
          ← All scanning workflows
        </button>
        {/* The Phase D journey, unchanged. */}
        <MultiScanReceiving deps={deps?.receivingDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Work order" />
        <button type="button" className="fo-link-btn" onClick={() => setActive(null)}>
          ← All scanning workflows
        </button>
        {/* The existing technician scanner, unchanged and still mounted in FieldMode too. */}
        <PartsScanner technicianId={technicianId} />
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Scan" />
      <p className="fo-muted">
        Scanning identifies what you are holding. What you may then do with it depends on your
        authority and on the job in front of you — so this list shows only workflows you can actually
        complete.
      </p>

      {workflows.empty ? (
        // NEVER A BLANK SCREEN. An empty workspace with no explanation is indistinguishable from a
        // broken one, and the reasons below are what tell the user which it is.
        <section className="fo-panel" aria-label="No scanning workflows available">
          <h3>No scanning workflows are available to you</h3>
          <p className="fo-muted">
            Nothing here is broken — there is simply no scanning workflow your current access and
            assignments allow. The reasons are listed below.
          </p>
        </section>
      ) : (
        <ul className="fo-scan-workflows">
          {workflows.available.map(({ workflow }) => (
            <li key={workflow}>
              <Button type="button" variant="primary" onClick={() => setActive(workflow)}>
                {SCAN_WORKFLOW_LABEL[workflow]}
              </Button>
              <p className="fo-muted">{SCAN_WORKFLOW_DESCRIPTION[workflow]}</p>
            </li>
          ))}
        </ul>
      )}

      {workflows.unavailable.length > 0 && (
        <section className="fo-panel" aria-label="Not available to you">
          <h3>Not available to you</h3>
          <ul className="fo-list">
            {workflows.unavailable.map(({ workflow, reason }) => (
              <li key={workflow} className="fo-muted">
                <strong>{SCAN_WORKFLOW_LABEL[workflow]}</strong> — {UNAVAILABLE_TEXT[reason]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
