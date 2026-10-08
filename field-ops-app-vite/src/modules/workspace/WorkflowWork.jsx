// WORKFLOW WORK — the records in ACTIVE workflow versions, and what THIS person may do next (DECISIONS #210).
//
// Every row and every decision is the server's (listWorkflowWork on /operations/workflow): the workflow engine's own answer per
// action -- a Security Role binding the person holds, then the action's capability, condition, scope and record relationship.
// An action is offered only when the engine allows it; otherwise its refusal is shown. Advancing a record runs the engine's
// transition (one transaction, one instance event) and the list re-reads. Nothing is decided here.
import { useCallback, useEffect, useState } from "react";
import RuledSection from "../../shared/ui/RuledSection";
import { Button } from "../../shared/ui/primitives";
import { FormError } from "../../shared/ui/form";
import { callWorkflowRuntimeApi } from "../../services/workflowRuntimeClient";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { titleCase } from "../../shared/display/displayLabels.js";

// HEADER SORTING over the items already read; no sort = the server's order. Next Actions is controls, not data.
const WORK_SORT_COLUMNS = Object.freeze({
  workflow: { value: (item) => item.workflowName },
  record: { value: (item) => item.recordId },
  step: { value: (item) => item.currentStepLabel },
});
const NO_ITEMS = Object.freeze([]);

export default function WorkflowWork({ callApi = callWorkflowRuntimeApi }) {
  const [work, setWork] = useState(null);
  const [message, setMessage] = useState(null);
  const load = useCallback(async () => {
    const res = await callApi("listWorkflowWork", {});
    if (res.ok) setWork(res.result); else setMessage(res.message ?? "Workflows could not be read.");
  }, [callApi]);
  useEffect(() => { load(); }, [load]);
  const { sort, toggle, sorted } = useTableSort({ rows: work?.items ?? NO_ITEMS, columns: WORK_SORT_COLUMNS });

  const advance = async (item, action) => {
    const res = await callApi("transitionWorkflowInstance", { objectKey: item.objectKey, recordId: item.recordId, actionKey: action.actionKey, reason: `${action.label} from My work` });
    setMessage(res.ok ? `${action.label}: ${item.recordId} is now at ${titleCase(res.result.currentStepKey)}.` : (res.message ?? "refused"));
    load();
  };

  if (!work || work.items.length === 0) return message ? <FormError>{message}</FormError> : null;
  return (
    <RuledSection title="Workflow Work" meta={String(work.total)}>
      {message && <p className="fo-muted" role="status">{message}</p>}
      <table className="fo-table fo-table--stack">
        <thead><tr><SortableHeader columnKey="workflow" label="Workflow" sort={sort} onSort={toggle} /><SortableHeader columnKey="record" label="Record" sort={sort} onSort={toggle} /><SortableHeader columnKey="step" label="Step" sort={sort} onSort={toggle} /><th scope="col">Next Actions</th></tr></thead>
        <tbody>
          {sorted.map((item) => (
            <tr key={`${item.objectKey}-${item.recordId}`} data-workflow-record={item.recordId}>
              <td data-label="Workflow">{item.workflowName}</td>
              <td data-label="Record"><code>{item.recordId}</code></td>
              <td data-label="Step">{item.currentStepLabel}</td>
              <td data-label="Next Actions">{item.actions.map((a) => (a.allowed
                ? <Button key={a.actionKey} size="sm" variant="secondary" onClick={() => advance(item, a)}>{a.label}</Button>
                : <span key={a.actionKey} className="fo-muted" data-refused={a.actionKey}>{a.label} — not yours ({a.refusal}) </span>))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </RuledSection>
  );
}
