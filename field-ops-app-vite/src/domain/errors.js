// Thrown when a technician is no longer available at commit time (the normal
// outcome of two dispatchers racing for the same tech) -- distinguished from
// genuine Firestore failures so it isn't logged as "Firestore write failed".
export class AssignmentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}

// Sprint 4: thrown by services/inventoryService.js when a reservation or
// consumption would take quantityAvailable/quantityReserved below zero.
// Distinguished the same way AssignmentConflictError is -- an expected,
// validated business outcome (someone tried to use more than is on the
// truck), not a Firestore failure.
export class InsufficientInventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "InsufficientInventoryError";
  }
}

// Sprint 4: thrown by services/jobService.js when a job.phase transition
// isn't allowed by domain/jobPhaseWorkflow.js's canTransitionPhase().
export class InvalidPhaseTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidPhaseTransitionError";
  }
}
