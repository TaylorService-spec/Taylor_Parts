// D4 Equipment Compatibility trusted-command error taxonomy (house class-per-reason convention,
// mirroring functions/src/partMaster/partMasterCommands.ts). Server-only; no production surface.
export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}
export class NotFoundError extends Error {}
export class AlreadyExistsError extends Error {}
export class VersionConflictError extends Error {}
export class IdempotencyConflictError extends Error {}
export class ReferentialIntegrityError extends Error {}
export class IllegalOperationTransitionError extends Error {}
export class OperationNotInitiatedError extends Error {}
// A relationship's evidence set has already reached the governed per-relationship cap
// (repository.ts MAX_EVIDENCE_PER_RELATIONSHIP). Raised by the WRITE-time conflict-analysis read in
// compatibilityRepository.ts / commands.ts (importCompatibilitySource) so that path fails closed with a
// clear, stable reason instead of issuing an unbounded in-transaction read.
export class EvidenceCapExceededError extends Error {}
