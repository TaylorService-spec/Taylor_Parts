import { useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import {
  SEED_WORKFLOW_FAMILIES,
  WORKFLOW_AREAS,
  areaForMachine,
  buildWorkflowVersionView,
  machinesInArea,
  summarizeWorkflowFamily,
  workflowTerminologyCounts,
} from "../../domain/adminWorkflowView.js";

// ADMINISTRATION > WORKFLOWS -- the business processes EOS knows about.
//
// ════════════════════ WHAT A WORKFLOW IS, AND IS NOT ════════════════════
//
// A workflow answers "what business ACTION may I perform" -- Approve, Dispatch, Void. That is a
// different question from "what DATA may I access", which Objects and Roles & Permissions answer,
// and neither implies the other:
//
//   being allowed to Start Purchasing does NOT mean reading every Purchase Order field
//   holding PurchaseOrder.Read does NOT mean being allowed to Void Purchase Order
//
// The screen says so, because an administrator who assumes otherwise will grant the wrong thing.
//
// ════════════════════ WHAT THESE DEFINITIONS ARE ════════════════════
//
// They are MEASURED from the code that runs today -- the reorder status machine, the work-order
// transition table, and the three Sales lifecycles -- and they are DRAFTS. A draft routes nothing:
// no record moves through these definitions, and none will until each is proved to match the
// behaviour it describes and is then separately published.
//
// Rendering them as though they were live would be the single most misleading thing this screen
// could do, so every version carries its status and the page says it plainly.
//
// ════════════════════ THREE AREAS, FIVE STATE MACHINES ════════════════════
//
// Owner terminology. Administration presents THREE business workflow areas -- Parts / Purchasing,
// Technician / Work Order, Sales -- over FIVE versioned state machines, because Sales is three:
// Opportunity, Agreement and Order.
//
// Those three are chained by EVENTS, not transitions. There is no edge from WON to DRAFT; a won
// opportunity CREATES an agreement, which is a different thing. So an AREA is a presentation
// grouping and nothing more -- it has no state, no transition and no Role binding of its own, and
// no authority is ever resolved against it. Collapsing Sales into one invented machine would draw
// transitions no code performs.
//
// ════════════════════ READ-ONLY, AND WHY ════════════════════
//
// Editing a workflow is a policy-store operation, and the policy store is not stood up. The
// trusted commands exist (functions/src/adminPolicy/policyCommands.ts) and are Admin-only; what is
// missing is the database behind them. A disabled editor would still read as an affordance, so
// none is drawn -- the page states the reason instead.

/** The four columns of a transition table, named once so the header and the rows agree. */
const ACTION_COLUMNS = ["Action", "From", "To", "Who may perform it"];

function StatusPill({ status }) {
  const live = status === "PUBLISHED";
  return (
    <span className={live ? "fo-wf-status fo-wf-status--published" : "fo-wf-status fo-wf-status--draft"}>
      {live ? "Published" : "Draft"}
    </span>
  );
}

export default function AdminWorkflows() {
  const families = SEED_WORKFLOW_FAMILIES;
  const [selectedKey, setSelectedKey] = useState(families[0]?.key ?? null);
  const [expanded, setExpanded] = useState(() => new Set());

  const selected = useMemo(
    () => families.find((f) => f.key === selectedKey) ?? families[0] ?? null,
    [families, selectedKey],
  );
  const view = useMemo(() => (selected ? buildWorkflowVersionView(selected) : null), [selected]);
  const terminology = workflowTerminologyCounts();
  // Named for what it is, so the WORKFLOW_AREAS.map below does not shadow it into ambiguity.
  const selectedArea = selected ? areaForMachine(selected.key) : null;

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <WorkspaceShell title="Workflows" subtitle="The business processes EOS knows about, and who may act in them">
      <section className="fo-panel" aria-label="What a workflow governs">
        <p className="fo-muted">
          A workflow governs <strong>business actions</strong> — Approve, Dispatch, Void. That is a
          different authority from <strong>data access</strong>, which Objects and Roles &amp;
          Permissions govern, and neither grants the other: being allowed to start purchasing does
          not reveal a purchase order&rsquo;s fields, and being able to read one does not permit
          voiding it.
        </p>
        <p className="fo-warning">
          Every definition below is a <strong>draft measured from the code that runs today</strong>.
          No record moves through them. They are read-only here because editing a workflow writes to
          the EOS policy store, and that store is not yet stood up.
        </p>
      </section>

      <section className="fo-panel" aria-label="Workflow areas">
        <h3>
          Business areas{" "}
          <span className="fo-muted">
            · {terminology.areas} areas · {terminology.stateMachines} state machines
          </span>
        </h3>
        {WORKFLOW_AREAS.map((area) => (
          <div key={area.key} className="fo-wf-area">
            <h4>
              {area.name}
              {area.machineKeys.length > 1 && (
                <span className="fo-muted"> · {area.machineKeys.length} linked state machines</span>
              )}
            </h4>
            <p className="fo-muted">{area.description}</p>
            <div className="fo-pill-row">
              {machinesInArea(area.key).map((family) => {
                const summary = summarizeWorkflowFamily(family);
                return (
                  <Button
                    key={family.key}
                    variant={family.key === selected?.key ? "primary" : "secondary"}
                    onClick={() => setSelectedKey(family.key)}
                    aria-pressed={family.key === selected?.key}
                  >
                    {family.name}
                    <span className="fo-muted"> · {summary.stepCount} states · {summary.actionCount} actions</span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="fo-muted">
          An <strong>area</strong> groups related processes for reading. It has no states,
          transitions or Role bindings of its own — every one of those belongs to a state machine,
          and authority is only ever resolved against a machine. Sales is three machines chained by
          events: a won Opportunity <em>creates</em> an Agreement rather than transitioning into
          one, so drawing them as a single process would show transitions no code performs.
        </p>
      </section>

      {selected && view && (
        <>
          <section className="fo-panel" aria-label="Version">
            <h3>
              {selected.name} <StatusPill status={view.status} />
            </h3>
            {selectedArea && (
              <p className="fo-muted">
                A state machine in the <strong>{selectedArea.name}</strong> area.
              </p>
            )}
            <p className="fo-muted">{selected.description}</p>
            <dl className="fo-wf-meta">
              <div><dt>Version</dt><dd>v{view.version}</dd></div>
              <div><dt>Governs</dt><dd>{selected.objectKey ?? "—"}</dd></div>
              <div><dt>States</dt><dd>{view.steps.length}</dd></div>
              <div><dt>Actions</dt><dd>{view.actions.length}</dd></div>
              <div><dt>Role bindings</dt><dd>{view.bindingCount}</dd></div>
            </dl>
          </section>

          <section className="fo-panel" aria-label="States">
            <h3>States</h3>
            <p className="fo-muted">
              A record sits in exactly one state. <strong>Initial</strong> is where an instance
              starts; a <strong>terminal</strong> state accepts no further action.
            </p>
            <div className="fo-table-scroll">
              <table className="fo-table" aria-label={`${selected.name} states`}>
                <thead>
                  <tr>
                    <th scope="col">State</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Actions available from here</th>
                  </tr>
                </thead>
                <tbody>
                  {view.steps.map((step) => (
                    <tr key={step.key}>
                      <td>{step.label}<span className="fo-muted"> · {step.key}</span></td>
                      <td className="fo-muted">
                        {step.initial ? "Initial" : step.terminal ? "Terminal" : "In progress"}
                      </td>
                      <td className="fo-muted">
                        {step.outgoing.length === 0
                          // A terminal state having no outgoing actions is the DEFINITION of
                          // terminal, not a gap. Said in words so it does not read as missing data.
                          ? (step.terminal ? "None — this state is terminal" : "None")
                          : step.outgoing.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="fo-panel" aria-label="Actions and transitions">
            <h3>Actions and transitions</h3>
            <p className="fo-muted">
              Each action moves a record from one state to one other state, and names the Roles
              permitted to perform it. Expand an action to see its Role bindings.
            </p>
            <div className="fo-table-scroll">
              <table className="fo-table" aria-label={`${selected.name} actions`}>
                <thead>
                  <tr>{ACTION_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {view.actions.map((action) => {
                    const isOpen = expanded.has(action.key);
                    return [
                      <tr key={action.key}>
                        <td>
                          <button
                            type="button"
                            className="fo-caret"
                            onClick={() => toggle(action.key)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} the ${action.roleKeys.length} roles bound to ${action.label}`}
                          >
                            {isOpen ? "▾" : "▸"}
                          </button>{" "}
                          {action.label}
                          {action.requiresOwnAssignment && (
                            <span className="fo-muted" title="Only the person the record is assigned to may perform this">
                              {" "}· own assignment
                            </span>
                          )}
                        </td>
                        <td className="fo-muted">{action.from}</td>
                        <td className="fo-muted">{action.to}</td>
                        <td className="fo-muted">{action.roleKeys.length} roles</td>
                      </tr>,
                      ...(isOpen
                        ? [
                            <tr key={`${action.key}:roles`} className="fo-row-nested">
                              <td className="fo-nested-label" colSpan={ACTION_COLUMNS.length}>
                                <span className="fo-muted">↳ May perform:</span>{" "}
                                {action.roleKeys.join(", ")}
                                <div className="fo-muted">
                                  A Role bound here may perform this action. It grants no access to
                                  the record&rsquo;s data.
                                </div>
                                {/* The capability this action is MEASURED to require, shown so an
                                    administrator can see which authority an action answers to. It
                                    appears here and in no CRED checkbox -- that is the Owner's
                                    ruling made visible rather than merely asserted in a test. */}
                                {action.capabilityId ? (
                                  <div className="fo-muted">
                                    Workflow capability: <code>{action.capabilityId}</code>
                                  </div>
                                ) : null}
                              </td>
                            </tr>,
                          ]
                        : []),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
