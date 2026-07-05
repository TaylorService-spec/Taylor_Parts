import { useAuth } from "../../../auth/AuthContext";
import CreateWorkOrderWizard from "./CreateWorkOrderWizard";

// Top-level entry point for Epic 2 Phase 1. Placement in the app's
// nav is a temporary/pragmatic choice (a new NAV tab, see App.jsx) --
// docs/epics/EPIC-2.md's Phase 4 (Domain Language Alignment & Polish)
// is where final placement gets decided, not here.
//
// Role gate is double-enforced on purpose: ROLE_NAV_ACCESS (App.jsx)
// already hides this tab from technicians, and createWorkOrder.ts
// itself rejects non-admin/dispatcher callers -- this component-level
// check is a third, redundant layer purely to avoid a confusing blank
// wizard if this page is ever reached some other way.
export default function CreateWorkOrderPage() {
  const { role } = useAuth();

  if (role !== "admin" && role !== "dispatcher") {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Only Admin or Dispatcher may create Work Orders.</p>
      </div>
    );
  }

  return <CreateWorkOrderWizard />;
}
