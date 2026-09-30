// The shared shape of one /operations/work-orders operation. Its own module so the operation table and the domain
// modules that implement its entries can both name it without importing each other.
import type { Pool } from "pg";
import type { ContextualReader } from "./contextualAuthorization";
import type { OperationalActor } from "./entitledActionAuthority";
import type { LifecycleActor } from "./workOrderLifecycle";
import type { PostgresWorkOrderWriterState } from "./workOrderWriterState";

export interface WorkOrderOperationDeps {
  readonly pool: Pool;
  readonly reader: ContextualReader;
  readonly postgresState: PostgresWorkOrderWriterState;
  readonly now?: () => Date;
}

/** Both views of one caller: the flat set (conditioned keys withheld) and the entitled actor for record reads. */
export interface WorkOrderCaller {
  readonly actor: LifecycleActor;
  readonly operational: OperationalActor;
}

export type WorkOrderOp = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
