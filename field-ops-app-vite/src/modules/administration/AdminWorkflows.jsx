import { workflowAdminClient } from "../../services/workflowAdminClient.js";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";
import AdminWorkflowBuilder from "./AdminWorkflowBuilder.jsx";
import WorkflowAssignments from "./WorkflowAssignments.jsx";

// Separate page URLs inside the existing Administration route and access gate.
// The view parameter selects presentation only; every read/write remains server-authorized.
export default function AdminWorkflows({ api = workflowAdminClient }) {
  return readAdminQueryParam("view") === "builder"
    ? <AdminWorkflowBuilder api={api} />
    : <WorkflowAssignments api={api} />;
}
