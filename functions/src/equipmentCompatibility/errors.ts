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
