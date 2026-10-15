"use strict";
// AI REQUEST CONTRACT. What an AI call must carry before it is allowed to happen.
//
// ============================ WHY THIS EXISTS SEPARATELY FROM assistant/ ============================
//
// `functions/src/assistant/` owns TRANSPORT and PROVIDER POLICY: which vendor, which model, whether
// a private-only request may leave the building. It answers "who may run this inference".
//
// This module owns CAPABILITY and PURPOSE: which caller, holding which permissions, may ask which
// question of which classification of data. It answers "who may ask this at all".
//
// They are different questions and they fail differently. A provider policy that is correct still
// permits a technician to ask a question only an owner should be able to ask, because the provider
// has no idea who the caller is. Merging the two would mean a single "AI is allowed" flag, and a
// single flag is exactly how a capability boundary gets crossed by accident.
//
// ============================ NO PROVIDER IS TRUSTED FOR BEING AI ============================
//
// An AI provider is a caller like any other. It receives what the requesting user's capabilities
// already permit and nothing more. There is deliberately no "AI service account", no elevated
// context, and no path by which asking through a model returns data that asking directly would not.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIError = exports.AI_PERMITTED_CLASSIFICATIONS = void 0;
/** Classifications that may currently reach a model. Everything else fails closed. */
exports.AI_PERMITTED_CLASSIFICATIONS = [
    "REPOSITORY",
    "SYSTEM_METADATA",
    "SYNTHETIC",
];
class AIError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "AIError";
        this.code = code;
    }
}
exports.AIError = AIError;
//# sourceMappingURL=types.js.map