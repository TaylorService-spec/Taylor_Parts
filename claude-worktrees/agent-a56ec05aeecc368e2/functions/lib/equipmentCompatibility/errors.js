"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationNotInitiatedError = exports.IllegalOperationTransitionError = exports.ReferentialIntegrityError = exports.IdempotencyConflictError = exports.VersionConflictError = exports.AlreadyExistsError = exports.NotFoundError = exports.UnauthorizedActorError = exports.InvalidInputError = void 0;
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
//# sourceMappingURL=errors.js.map