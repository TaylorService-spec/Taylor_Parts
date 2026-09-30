// THE INBOUND WORK COMMAND ROUTE'S CLOSED OPERATION TABLE (/operations/inbound-work).
//
// SCAFFOLD (Work Order cutover completion pass, 2026-09-30): the Inbound Work lane implements the EOS intake review
// and its Work Order actions here -- Accept -> the governed EOS Work Order create, Attach -> a governed association
// with an EOS Work Order, Decline -> a governed intake state. Served through the Work Order executor, so it shares
// the caller resolution and the WORK_ORDER_WRITER_AUTHORITY activation gate: Inbound Work acts on Work Orders.
import type { WorkOrderOp } from "./workOrderOperationTypes";

export const INBOUND_WORK_ROUTE = "/operations/inbound-work";

export const EOS_INBOUND_WORK_OPERATIONS: Readonly<Record<string, WorkOrderOp>> = Object.freeze({});

export const isInboundWorkOperation = (name: unknown): name is string =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_INBOUND_WORK_OPERATIONS, name);
