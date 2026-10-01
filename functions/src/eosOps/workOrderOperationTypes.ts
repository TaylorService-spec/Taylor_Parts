// The shared shape of one /operations/work-orders operation. Its own module so the operation table and the domain
// modules that implement its entries can both name it without importing each other.
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import type { ContextualReader } from "./contextualAuthorization";
import type { OperationalActor } from "./entitledActionAuthority";
import type { LifecycleActor } from "./workOrderLifecycle";
import type { PostgresWorkOrderWriterState } from "./workOrderWriterState";

export interface WorkOrderOperationDeps {
  readonly pool: Pool;
  readonly reader: ContextualReader;
  readonly postgresState: PostgresWorkOrderWriterState;
  readonly now?: () => Date;
  /**
   * The Principal resolver, for an operation that must decide ANOTHER Principal's standing authority (an Inbound Work
   * reassignment target; a self-scheduling issuer re-checked at selection). Never authentication.
   */
  readonly policyReader?: PolicyReader;
  /** The Equipment register state, for the /operations/equipment table (EQUIPMENT_WRITER_AUTHORITY otherwise). */
  readonly equipmentPostgresState?: "INACTIVE" | "ACTIVE";
}

/** Both views of one caller: the flat set (conditioned keys withheld) and the entitled actor for record reads. */
export interface WorkOrderCaller {
  readonly actor: LifecycleActor;
  readonly operational: OperationalActor;
}

export type WorkOrderOp = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;
