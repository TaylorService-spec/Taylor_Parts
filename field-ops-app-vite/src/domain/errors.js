// Thrown when a technician is no longer available at commit time (the normal
// outcome of two dispatchers racing for the same tech) -- distinguished from
// genuine Firestore failures so it isn't logged as "Firestore write failed".
export class AssignmentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}
