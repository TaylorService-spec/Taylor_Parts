"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyStoreError = void 0;
/** Raised when a caller asks for something the store cannot honour. Never leaks another tenant's data. */
class PolicyStoreError extends Error {
}
exports.PolicyStoreError = PolicyStoreError;
//# sourceMappingURL=policyRepository.js.map