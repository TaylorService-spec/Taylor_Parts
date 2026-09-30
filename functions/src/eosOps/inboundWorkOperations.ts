// THE INBOUND WORK COMMAND ROUTE'S CLOSED OPERATION TABLE (/operations/inbound-work).
//
// Owner ruling W9 (INCLUDE NOW, 2026-09-30): the accepted Inbound Work path, ported to the governed PostgreSQL intake
// (migration 1764340000000; inboundWorkIntake.ts, inboundWorkDecisions.ts):
//
//     Accept   -> the governed EOS Work Order create (operating company STATED by the reviewer; replay-safe)
//     Attach   -> a governed, append-only association with an existing, non-terminal EOS Work Order
//     Decline  -> a governed intake state with a governed reason
//
// Served through the Work Order executor (eosOpsHttp.ts executeWorkOrderOperation), so it shares the caller
// resolution and the WORK_ORDER_WRITER_AUTHORITY activation gate: Inbound Work acts on Work Orders, and while that
// authority is INACTIVE every operation here answers 503 NOT_ACTIVATED (the probe below excepted).
//
// THE PROVIDER BOUNDARY IS NOW ON THIS ROUTE TOO (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30): provider
// connections and OAuth, mailbox polling, delivery-failure retry and attachment byte custody are the EOS provider
// runtime (inboundProviderRuntime.ts); the Firebase provider runtime is retired. RECOVERY of an unfinished accept claim
// (RELEASE / REASSIGN, inboundWork.request.recover) is inboundWorkRecovery.ts.
import type { WorkOrderOp } from "./workOrderOperationTypes";
import {
  deliverInboundMessage, only, readInboundIntakeConfiguration, saveInboundMailbox, saveInboundRoutingRule,
} from "./inboundWorkIntake";
import {
  acceptInboundWork, attachInboundWork, declineInboundWork, listInboundWork, readInboundWorkAccess, readInboundWorkRequest,
} from "./inboundWorkDecisions";

import { INBOUND_PROVIDER_OPERATIONS, INBOUND_PROVIDER_READ_OPERATIONS } from "./inboundProviderRuntime";
import { INBOUND_RECOVERY_OPERATIONS, INBOUND_RECOVERY_READ_OPERATIONS } from "./inboundWorkRecovery";

export const INBOUND_WORK_ROUTE = "/operations/inbound-work";

export const EOS_INBOUND_WORK_OPERATIONS: Readonly<Record<string, WorkOrderOp>> = Object.freeze({
  // The readiness probe. executeWorkOrderOperation answers it BEFORE the table is consulted (it works while the
  // authority is INACTIVE); it is listed so the transport's closed-table check admits it on this route too.
  readWorkOrderAuthorityStatus: async () => {
    throw new Error("readWorkOrderAuthorityStatus is answered by the Work Order executor, never by this table");
  },

  // ── reads ──
  readInboundWorkAccess: async (_deps, caller, input) => (only(input, []), readInboundWorkAccess(caller.actor)),
  listInboundWork: (deps, caller, input) => listInboundWork({ pool: deps.pool, now: deps.now }, caller.actor, input),
  readInboundWorkRequest: (deps, caller, input) => readInboundWorkRequest({ pool: deps.pool, now: deps.now }, caller.actor, input),

  // ── the three decisions ──
  acceptInboundWork: (deps, caller, input) => acceptInboundWork({ pool: deps.pool, now: deps.now }, caller.actor, input),
  declineInboundWork: (deps, caller, input) => declineInboundWork({ pool: deps.pool, now: deps.now }, caller.actor, input),
  attachInboundWork: (deps, caller, input) => attachInboundWork({ pool: deps.pool, now: deps.now }, caller.actor, input),

  // ── intake administration (inboundWork.intake.manage) ──
  readInboundIntakeConfiguration: (deps, caller, input) => (only(input, []), readInboundIntakeConfiguration({ pool: deps.pool }, caller.actor)),
  saveInboundMailbox: (deps, caller, input) => saveInboundMailbox({ pool: deps.pool, now: deps.now }, caller.actor, input),
  saveInboundRoutingRule: (deps, caller, input) => saveInboundRoutingRule({ pool: deps.pool, now: deps.now }, caller.actor, input),
  // The non-production delivery seam (parity: deliverInboundEmailMessage). The EOS API refuses to start in production.
  deliverInboundMessage: (deps, caller, input) => deliverInboundMessage({ pool: deps.pool, now: deps.now }, caller.actor, input),

  // ── the EOS provider runtime: connections, OAuth, polling, retry, attachment custody (inboundProviderRuntime.ts) ──
  ...INBOUND_PROVIDER_OPERATIONS,

  // ── recovery of an unfinished accept claim: RELEASE / REASSIGN (inboundWorkRecovery.ts) ──
  ...INBOUND_RECOVERY_OPERATIONS,
});

export const INBOUND_WORK_READ_OPERATIONS: readonly string[] = Object.freeze([
  "readWorkOrderAuthorityStatus", "readInboundWorkAccess", "listInboundWork", "readInboundWorkRequest", "readInboundIntakeConfiguration",
  ...INBOUND_PROVIDER_READ_OPERATIONS, ...INBOUND_RECOVERY_READ_OPERATIONS,
]);

export const isInboundWorkOperation = (name: unknown): name is string =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_INBOUND_WORK_OPERATIONS, name);
