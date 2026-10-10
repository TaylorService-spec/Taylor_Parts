// W01 D2: the CALLER'S OWN workflow-administration decisions, read from the server (readMyWorkflowAdministration).
//
// Display only. The server computes each answer with the same decision its mutations enforce; this hook decides
// nothing itself and never derives access from Role names. FAIL CLOSED: until the answer is in -- and if it cannot be
// read -- nothing is offered, and the reason says so. Every mutation is still re-checked by the server.
import { useControlPlaneRead } from "./useControlPlaneRead.js";

export function useMyWorkflowAdministration(api) {
  const read = useControlPlaneRead(
    typeof api?.readMyWorkflowAdministration === "function" ? () => api.readMyWorkflowAdministration() : null,
    "my-workflow-administration",
  );
  const operations = read.status === "ready" && read.data && typeof read.data.operations === "object" ? read.data.operations : null;
  const status = operations ? "ready" : read.status === "loading" ? "loading" : "unavailable";
  return {
    status,
    allows: (operation) => operations?.[operation]?.allowed === true,
    /** The server's own name for the permission `operation` requires, or null while unknown. */
    requiredLabel: (operation) => operations?.[operation]?.requiredLabel ?? null,
    /** Why `operation` is not offered, in words -- null when it is. */
    reason: (operation) => {
      if (status === "loading") return "Checking your workflow permissions…";
      if (!operations) return "Your workflow permissions could not be confirmed, so this action is unavailable.";
      const op = operations[operation];
      if (op?.allowed === true) return null;
      return op?.requiredLabel ? `Requires the “${op.requiredLabel}” permission.` : "You are not permitted to do this.";
    },
  };
}
