// SCAFFOLD (Work Order cutover completion pass, 2026-09-30): reserved operations, implemented by their lane.
// Until implemented each refuses NOT_YET_IMPLEMENTED -- never a Firebase fallback.
import { WorkOrderLifecycleError } from "./workOrderLifecycle";
import type { WorkOrderOp } from "./workOrderOperationTypes";
const notYet = (name: string): WorkOrderOp => async () => {
  throw new WorkOrderLifecycleError("NOT_YET_IMPLEMENTED", "UNAVAILABLE", `${name} is not implemented yet`);
};
export const readWorkOrderReadiness: WorkOrderOp = notYet("readWorkOrderReadiness");
