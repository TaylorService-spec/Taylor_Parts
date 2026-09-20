// MAY FIRESTORE STOP BEING THE REORDER AUTHORITY?
//
// Pure data plus derivations: no database, no Firebase, no I/O, no clock. Its companion suite
// extracts the legacy status transitions FROM firestore.rules and asserts this file accounts for
// every one, so the gate cannot be opened by forgetting something.
//
// ════════════════════ WHY A GATE RATHER THAN A DECISION ════════════════════
//
// Retiring the Firestore Reorder authority is an ACTIVATION, not a code change. The code that makes
// PostgreSQL capable of answering is one thing; the moment Firestore stops answering is another, and
// conflating them is how a system ends up with two authorities and no way to say which one is right.
//
// So nothing here retires anything. It states, mechanically, what would have to be true first -- and
// the two conditions that remain open are open for reasons no amount of code can close.
export const RETIREMENT_GATES = Object.freeze([
  /** Every legacy write transition has a governed PostgreSQL command that answers it. */
  "TRANSITION_COVERAGE",
  /**
   * NOTHING AT RUNTIME STILL REACHES FIRESTORE FOR A REORDER.
   *
   * TRANSITION_COVERAGE proves the replacement commands EXIST. It does not prove anything CALLS
   * them, and those are different facts -- the commands were all present and correct while the
   * client was still writing straight to Firestore. This gate is the one that decides activation.
   */
  "RUNTIME_CUTOVER",
  /** No consumer still decides Reorder access from a Firebase uid. */
  "ASSIGNEE_IDENTITY",
  /**
   * THE SOURCE IS FROZEN, AND THE FREEZE REACHES THE ADMIN SDK.
   *
   * Firestore Rules do NOT constrain the Firebase Admin SDK. A Rules-only freeze therefore stops
   * the browser and leaves the legacy callables -- createReorderRequest, recordReorderPurchaseOrder
   * -- free to keep changing the very population being copied, which would make the copy a
   * photograph of a moving subject.
   *
   * The freeze must deny client writes through Rules AND make the legacy callable/Admin-SDK writers
   * refuse, and quiescence must be proved after both.
   */
  "SOURCE_WRITE_FROZEN",
  /** The legacy objects have been copied and VERIFY passed, in the real environment. */
  "OBJECT_COPY_VERIFIED",
  /** The Rules arms that make Firestore authoritative have been removed and deployed. */
  "RULES_RETIRED",
] as const);
export type RetirementGate = (typeof RETIREMENT_GATES)[number];

export const GATE_STATES = Object.freeze([
  "MET",
  /** Code-complete, but only a real environment and a real operator can close it. */
  "REQUIRES_OPERATOR",
  "OPEN",
] as const);
export type GateState = (typeof GATE_STATES)[number];

export interface LegacyTransition {
  /** The status a Reorder is in. Null means "any", for a create. */
  readonly from: string | null;
  readonly to: string;
  /** The governed command that now answers it, or null when nothing does. */
  readonly governedBy: string | null;
  /** True when the legacy restricted the action to the assigned person. */
  readonly assigneeOnly: boolean;
  readonly note: string;
}

const t = (x: LegacyTransition): LegacyTransition => Object.freeze(x);

/**
 * Every legacy Reorder write, and what answers it now.
 *
 * Derived from firestore.rules' `allow update` arms (and the create). The suite re-extracts those
 * arms and fails if this list does not account for every transition they permit.
 */
export const LEGACY_TRANSITIONS: readonly LegacyTransition[] = Object.freeze([
  t({
    from: null, to: "PENDING_REVIEW", governedBy: "createGovernedReorderRequest", assigneeOnly: false,
    note: "creation. The company is read FROM the governed warehouse rather than accepted from the caller.",
  }),
  t({
    from: "PENDING_REVIEW", to: "READY_FOR_PARTS_MANAGER", governedBy: "reviewReorderRequest", assigneeOnly: false,
    note: "approval. Advances to the Parts Manager's queue rather than resting at APPROVED, exactly as the Rules arm does.",
  }),
  t({
    from: "PENDING_REVIEW", to: "REJECTED", governedBy: "reviewReorderRequest", assigneeOnly: false,
    note: "rejection, which must state its notes -- the Rules require it for REJECTED and not for approval.",
  }),
  t({
    from: "READY_FOR_PARTS_MANAGER", to: "ASSIGNED_TO_PARTS_ASSOCIATE", governedBy: "assignReorderRequestToEmployee",
    assigneeOnly: false,
    note: "assignment. Names an EMPLOYEE and advances the status in the same transaction.",
  }),
  t({
    from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "PURCHASING_IN_PROGRESS", governedBy: "startPurchasingOnReorder",
    assigneeOnly: true, note: "the assignee begins purchasing.",
  }),
  t({
    from: "PURCHASING_IN_PROGRESS", to: "PURCHASING_IN_PROGRESS", governedBy: "postPurchasingUpdate",
    assigneeOnly: true, note: "purchasing progress. A write that does not move the status.",
  }),
  t({
    from: "PURCHASING_IN_PROGRESS", to: "ORDERED", governedBy: "recordPurchaseOrder", assigneeOnly: false,
    note: "recording the purchase order. Never a client write even in the legacy -- it was already a trusted callable.",
  }),
  t({
    from: "ORDERED", to: "RECEIVED", governedBy: "receiveReorderStock", assigneeOnly: true,
    note: "closeout. OWNER RULING R2 MOVED THIS: the transition is now a consequence of the governed "
      + "receipt, which commits it in the same transaction as the Receiving Order, the RECEIVED "
      + "inventory movement, the serialized custody and the acquisition-cost evidence. "
      + "`markReorderReceived` still answers while receiving is inert and is retired at the same "
      + "activation boundary (reorderLifecycleCommands.RECEIVING_POSTGRES_ACTIVE), so no separately "
      + "callable path can report goods as arrived that nothing received. "
      + "`assigneeOnly` remains TRUE because it records what the LEGACY Rules arm restricted, which "
      + "is a historical fact about the source and not a claim about who may receive stock now: the "
      + "receipt's actor is the Principal holding inventory.stock.receive.",
  }),
  t({
    from: "ORDERED", to: "VOIDED", governedBy: "voidReorderPurchaseOrder", assigneeOnly: true,
    note: "the void, written as an append-only record that never touches the purchase order.",
  }),
  t({
    from: "READY_FOR_PARTS_MANAGER", to: "CANCELLED", governedBy: "cancelReorderRequest", assigneeOnly: false,
    note: "cancellation before purchasing. A management action, not the assignee's.",
  }),
  t({
    from: "ASSIGNED_TO_PARTS_ASSOCIATE", to: "CANCELLED", governedBy: "cancelReorderRequest", assigneeOnly: false,
    note: "cancellation after assignment.",
  }),
  t({
    from: "PURCHASING_IN_PROGRESS", to: "CANCELLED", governedBy: "cancelReorderRequest", assigneeOnly: false,
    note: "cancellation during purchasing. The last point before ORDERED, past which the answer is a void.",
  }),
]);

export interface GateReading {
  readonly gate: RetirementGate;
  readonly state: GateState;
  readonly detail: string;
}

export interface RetirementReading {
  readonly gates: readonly GateReading[];
  /** True only when EVERY gate is MET. */
  readonly mayRetire: boolean;
  /** Gates that code cannot close, whatever it does. */
  readonly awaitingOperator: readonly RetirementGate[];
}

/**
 * Read the gates.
 *
 * `blockingAssigneeConsumers` comes from assignedToUserIdCensus.assignmentCutoverReadiness(), passed
 * in rather than imported so this stays a function of its inputs.
 */
export function readReorderRetirementGates(input: {
  readonly blockingAssigneeConsumers: readonly string[];
  /** From reorderFirestoreRuntimeCensus.reorderRuntimeActivationReadiness().blockedBy. */
  readonly runtimeFirestoreConsumers: readonly string[];
  /** Rules deny client writes AND the legacy callable/Admin-SDK writers refuse, proven quiescent. */
  readonly sourceWriteFrozenAndQuiescent?: boolean;
  readonly copyVerifiedInEnvironment?: boolean;
  readonly rulesRetiredAndDeployed?: boolean;
  readonly transitions?: readonly LegacyTransition[];
}): RetirementReading {
  const transitions = input.transitions ?? LEGACY_TRANSITIONS;
  const uncovered = transitions.filter((x) => x.governedBy === null);

  const gates: GateReading[] = [
    {
      gate: "TRANSITION_COVERAGE",
      state: uncovered.length === 0 ? "MET" : "OPEN",
      detail: uncovered.length === 0
        ? `all ${transitions.length} legacy transitions have a governed command`
        : `no governed command answers: ${uncovered.map((x) => `${x.from ?? "(create)"}->${x.to}`).join(", ")}`,
    },
    {
      gate: "RUNTIME_CUTOVER",
      // ZERO, and nothing else. Not "only diagnostics", not "only one".
      state: input.runtimeFirestoreConsumers.length === 0 ? "MET" : "OPEN",
      detail: input.runtimeFirestoreConsumers.length === 0
        ? "no runtime code reaches Firestore for a Reorder Request"
        : `${input.runtimeFirestoreConsumers.length} runtime consumer(s) still reach Firestore: `
          + [...input.runtimeFirestoreConsumers].sort().join(", "),
    },
    {
      gate: "ASSIGNEE_IDENTITY",
      // firestore.rules is expected here and is NOT a defect: its uid comparisons stop mattering when
      // Firestore stops being authoritative, which is what RULES_RETIRED covers. Any OTHER consumer
      // is a real blocker, because it would still decide access from a uid afterwards.
      state: input.blockingAssigneeConsumers.every((p) => p === "firestore.rules") ? "MET" : "OPEN",
      detail: input.blockingAssigneeConsumers.length === 0
        ? "no consumer decides Reorder access from a uid"
        : `still deciding from a uid: ${[...input.blockingAssigneeConsumers].sort().join(", ")}`,
    },
    {
      gate: "SOURCE_WRITE_FROZEN",
      state: input.sourceWriteFrozenAndQuiescent === true ? "MET" : "REQUIRES_OPERATOR",
      detail: input.sourceWriteFrozenAndQuiescent === true
        ? "client writes denied by Rules, legacy callable/Admin-SDK writers refusing, quiescence proved"
        : "a Rules-only freeze does not bind the Firebase Admin SDK: the legacy callables must be "
          + "made to refuse as well, and quiescence proved after both",
    },
    {
      gate: "OBJECT_COPY_VERIFIED",
      state: input.copyVerifiedInEnvironment === true ? "MET" : "REQUIRES_OPERATOR",
      detail: input.copyVerifiedInEnvironment === true
        ? "the legacy Reorders were copied and VERIFY passed"
        : "DRY RUN, COPY and VERIFY must be run against the real source by an operator; local and "
          + "synthetic proof does not establish it",
    },
    {
      gate: "RULES_RETIRED",
      state: input.rulesRetiredAndDeployed === true ? "MET" : "REQUIRES_OPERATOR",
      detail: input.rulesRetiredAndDeployed === true
        ? "the Reorder authority arms are gone from the deployed Rules"
        : "removing the Rules arms is a deployment, and this repository's Rules are fenced from production",
    },
  ];

  return Object.freeze({
    gates: Object.freeze(gates.map((g) => Object.freeze(g))),
    mayRetire: gates.every((g) => g.state === "MET"),
    awaitingOperator: Object.freeze(gates.filter((g) => g.state === "REQUIRES_OPERATOR").map((g) => g.gate)),
  });
}

/** The transitions the legacy restricted to the assigned person. Each must stay restricted. */
export function assigneeOnlyTransitions(
  transitions: readonly LegacyTransition[] = LEGACY_TRANSITIONS,
): readonly LegacyTransition[] {
  return Object.freeze(transitions.filter((x) => x.assigneeOnly));
}
