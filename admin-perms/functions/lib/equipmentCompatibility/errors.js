"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceCapExceededError = exports.OperationNotInitiatedError = exports.IllegalOperationTransitionError = exports.ReferentialIntegrityError = exports.IdempotencyConflictError = exports.VersionConflictError = exports.AlreadyExistsError = exports.NotFoundError = exports.UnauthorizedActorError = exports.InvalidInputError = void 0;
// D4 Equipment Compatibility trusted-command error taxonomy (house class-per-reason convention,
// mirroring functions/src/partMaster/partMasterCommands.ts). Server-only; no production surface.
class InvalidInputError extends Error {
}
exports.InvalidInputError = InvalidInputError;
class UnauthorizedActorError extends Error {
}
exports.UnauthorizedActorError = UnauthorizedActorError;
class NotFoundError extends Error {
}
exports.NotFoundError = NotFoundError;
class AlreadyExistsError extends Error {
}
exports.AlreadyExistsError = AlreadyExistsError;
class VersionConflictError extends Error {
}
exports.VersionConflictError = VersionConflictError;
class IdempotencyConflictError extends Error {
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class ReferentialIntegrityError extends Error {
}
exports.ReferentialIntegrityError = ReferentialIntegrityError;
class IllegalOperationTransitionError extends Error {
}
exports.IllegalOperationTransitionError = IllegalOperationTransitionError;
class OperationNotInitiatedError extends Error {
}
exports.OperationNotInitiatedError = OperationNotInitiatedError;
// A relationship's evidence set has already reached the governed per-relationship cap
// (repository.ts MAX_EVIDENCE_PER_RELATIONSHIP). Raised by the WRITE-time conflict-analysis read in
// compatibilityRepository.ts / commands.ts (importCompatibilitySource) so that path fails closed with a
// clear, stable reason instead of issuing an unbounded in-transaction read.
class EvidenceCapExceededError extends Error {
}
exports.EvidenceCapExceededError = EvidenceCapExceededError;
//# sourceMappingURL=errors.js.map