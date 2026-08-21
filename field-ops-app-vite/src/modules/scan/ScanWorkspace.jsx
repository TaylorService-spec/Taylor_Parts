import { useCallback, useEffect, useState } from "react";
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
  unavailableText,
} from "../../access/scanWorkflows.js";
import MultiScanReceiving from "../receiving/MultiScanReceiving.jsx";
import PartsScanner from "../mobile/PartsScanner.jsx";
import LookupScan from "./LookupScan.jsx";
import TransferScan from "./TransferScan.jsx";
import CycleCountScan from "./CycleCountScan.jsx";
import PutAwayScan from "./PutAwayScan.jsx";
import PickScan from "./PickScan.jsx";
import ReturnIntakeScan from "./ReturnIntakeScan.jsx";

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
// Lookup-only scanning IS here (LookupScan.jsx), but only as far as it can be truthful. It reads
// the governed Part Master, which is governed by firestore.rules and needs no capability
// activation. The rows it CANNOT fill -- serialized units and location, whose capabilities are
// registered active:false, and stock balances, which have no governed client read at all -- are
// shown as stated absences rather than omitted or invented.

/**
 * WHERE THE OPERATOR LEFT OFF.
 *
 * A warehouse phone locks in a pocket, a call comes in, a browser tab is reclaimed for memory. On the
 * way back the operator should land in the workflow they were in, not at a menu — re-choosing
 * "Put stock away" every time is the kind of friction that makes people go back to paper.
 *
 * ONLY the workflow choice is remembered. Nothing scanned, no bin, no queue: resuming a half-finished
 * physical count from an hour ago would be worse than starting it again, because the shelf has moved
 * on and the operator has not.
 */
const ACTIVE_WORKFLOW_KEY = "eos.scan.activeWorkflow";

function rememberedWorkflow() {
  try {
    const stored = window.sessionStorage?.getItem(ACTIVE_WORKFLOW_KEY);
    // Validated against the real vocabulary: a stale or tampered value must not route anywhere.
    return stored && Object.values(SCAN_WORKFLOW).includes(stored) ? stored : null;
  } catch {
    // Private browsing and locked-down devices refuse storage. Losing the memory is fine; failing to
    // render the workspace is not.
    return null;
  }
}

/**
 * THE BACK CONTROL — and the one thing it must not do quietly.
 *
 * Two of these workflows accumulate work that exists NOWHERE ELSE until submit succeeds: a cycle
 * count's observations and a transfer's verified scans are not on the server, not in the offline
 * queue and not in storage. Leaving unmounts the workflow and destroys all of it — and this control
 * sits one thumb-width from the scan field, on a phone, held by someone wearing a glove.
 *
 * So when work is pending, leaving becomes a DECISION: the first press states exactly how much is at
 * stake, the second discards it. Deliberately NOT a modal — a dialog on a warehouse phone is a
 * second target to hit and a layer to dismiss, and it steals focus from the scan field on cancel.
 *
 * The count is named rather than summarised. "Discard 24 scans" is a different sentence from
 * "discard your work", and the operator deserves the first one.
 */
function ScanBackControl({ pendingWork, onLeave }) {
  const [confirming, setConfirming] = useState(false);

  // Work finishing (a successful submit reports zero) must clear an armed confirmation, or the next
  // press asks about scans that no longer exist.
  useEffect(() => { if (pendingWork === 0) setConfirming(false); }, [pendingWork]);

  if (pendingWork > 0 && confirming) {
    return (
      <p className="fo-scan__leave" role="alert">
        <span>
          {pendingWork === 1 ? "1 scan has not been submitted." : `${pendingWork} scans have not been submitted.`}
          {" "}Leaving discards them.
        </span>
        <button type="button" className="fo-link-btn fo-scan__leave-discard" onClick={onLeave}>
          Discard and leave
        </button>
        <button type="button" className="fo-link-btn" onClick={() => setConfirming(false)}>
          Keep counting
        </button>
      </p>
    );
  }

  return (
    <button
      type="button"
      className="fo-link-btn"
      onClick={() => (pendingWork > 0 ? setConfirming(true) : onLeave())}
    >
      ← All scanning workflows
    </button>
  );
}

export default function ScanWorkspace({ deps }) {
  const [active, setActiveState] = useState(() => (deps?.rememberWorkflow === false ? null : rememberedWorkflow()));

  const setActive = useCallback((workflow) => {
    setActiveState(workflow);
    try {
      if (workflow) window.sessionStorage?.setItem(ACTIVE_WORKFLOW_KEY, workflow);
      else window.sessionStorage?.removeItem(ACTIVE_WORKFLOW_KEY);
    } catch { /* storage is a convenience, never a requirement */ }
  }, []);

  // TECHNICIAN CONTEXT IS RESOLVED HERE, not passed in. `renderSubnavItem` in App.jsx is a plain
  // function rather than a component and cannot call hooks, so the shell can hand over the
  // capability gate and the role but not an identity that needs a live subscription.
  //
  // These are the SAME two hooks FieldMode uses, so the two entry points cannot disagree about who
  // the technician is or what they are assigned. `deps` overrides them in tests.
  // How much unsubmitted work the active workflow is holding. Only the two workflows that
  // accumulate report it; the rest commit per scan and have nothing to lose by leaving.
  const [pendingWork, setPendingWork] = useState(0);
  const leave = useCallback(() => { setPendingWork(0); setActive(null); }, [setActive]);

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

  if (active === SCAN_WORKFLOW.LOOKUP) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Look up" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* Read-only. It has no command and cannot move anything. */}
        <LookupScan deps={deps?.lookupDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.TRANSFER) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Transfer" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* The EXISTING transfer commands. Scanning verifies; it authors nothing. */}
        <TransferScan deps={{ ...deps?.transferDeps, onPendingWorkChange: setPendingWork }} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.CYCLE_COUNT) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Count" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* Blind by design, and counting is not adjusting: reconcile is a separate authority. */}
        <CycleCountScan deps={{ ...deps?.cycleCountDeps, onPendingWorkChange: setPendingWork }} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.PUT_AWAY) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Put away" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* Records WHERE, never WHAT: a stow changes no balance (DECISIONS #116). */}
        <PutAwayScan deps={deps?.putAwayDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.PICK) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Pick" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* A pick is a placement with a reason. It reserves nothing (DECISIONS #116 + the existing
            DISPATCHED -> reserveParts lifecycle effect). */}
        <PickScan deps={deps?.pickDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.RETURN_INTAKE) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Take a return in" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* Records an ARRIVAL. Disposition is a separate authority that does not exist (#118), so
            nothing here can put stock back on the shelf. */}
        <ReturnIntakeScan deps={deps?.returnDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.SUPPLIER_RECEIVING) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Receive" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
        {/* The Phase D journey, unchanged. */}
        <MultiScanReceiving deps={deps?.receivingDeps} />
      </div>
    );
  }

  if (active === SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scan · Work order" />
        <ScanBackControl pendingWork={pendingWork} onLeave={leave} />
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
                <strong>{SCAN_WORKFLOW_LABEL[workflow]}</strong> — {unavailableText(workflow, reason)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
