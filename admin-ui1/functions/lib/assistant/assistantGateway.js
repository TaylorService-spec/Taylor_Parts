"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_INSTRUCTION = void 0;
exports.assembleProviderPrompt = assembleProviderPrompt;
exports.handleAssistantRequest = handleAssistantRequest;
const aiProvider_1 = require("./aiProvider");
const assistantAuthorization_1 = require("./assistantAuthorization");
const assistantAnswer_1 = require("./assistantAnswer");
/**
 * The system instruction.
 *
 * Note what it is NOT doing: it is not asked to keep secrets, because nothing secret is in the
 * prompt. Everything here has already passed authorization. This governs TRUTHFULNESS, which the
 * ordering cannot enforce, and leaves CONFIDENTIALITY to the retrieval boundary, which prompt text
 * could never enforce.
 */
exports.SYSTEM_INSTRUCTION = [
    "You are the EOS assistant. You help a user understand what is on their screen and what to do next.",
    "",
    "Every EOS fact you state must come from the tool results provided in this request. If the tool",
    "results do not contain something, say you do not have enough permitted EOS data to determine it.",
    "Never estimate or infer inventory balances, assignments, customer history, equipment ownership,",
    "order state, payment state, part locations, or who holds what authority.",
    "",
    "You cannot perform actions. You cannot transfer, receive, count, adjust, transition, invoice,",
    "assign roles, or change any record. If asked to do any of those, explain where the user can do it.",
    "",
    "Refer to records by their business identifiers (work order number, customer name, part number)",
    "rather than internal ids.",
].join("\n");
/**
 * Assemble the provider prompt from EXECUTED tool results only.
 *
 * The signature is the enforcement: there is no parameter through which unexecuted or denied tool
 * data could arrive. Denials are conveyed as a COUNT, never as names or shapes -- telling the model
 * "the balance tool was denied" hands it a fact about the actor's authority that it may then repeat.
 */
function assembleProviderPrompt(args) {
    const { context, executedResults, deniedCount } = args;
    const facts = executedResults.length
        ? executedResults.map((r) => `[${r.toolId}] ${JSON.stringify(r.data)}`).join("\n")
        : "(no permitted EOS data was retrieved for this question)";
    const situation = [
        `Screen: ${context.surface}${context.subView ? " / " + context.subView : ""}`,
        context.record ? `Record in view: ${context.record.type}` : "No specific record in view.",
        deniedCount > 0
            ? `${deniedCount} data source(s) were not available to this user. Do not speculate about their contents.`
            : "",
    ].filter(Boolean).join("\n");
    const messages = [
        { role: "system", content: exports.SYSTEM_INSTRUCTION },
        { role: "system", content: situation },
        { role: "system", content: `EOS data available for this question:\n${facts}` },
    ];
    for (const turn of context.history)
        messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: "user", content: context.question });
    return messages;
}
async function handleAssistantRequest(context, correlationId, deps) {
    const started = deps.now();
    const candidates = deps.registry.forSurface(context.surface);
    // STEP 1 -- decide. No retrieval has happened and none can, because planToolExecution has no
    // access to an executor.
    const { allowed, decisions } = (0, assistantAuthorization_1.planToolExecution)(candidates, deps.authority);
    // STEP 2 -- retrieve, allowed tools only.
    const executedResults = [];
    for (const tool of allowed) {
        executedResults.push(await tool.execute({
            companyId: context.companyId,
            actorUid: context.actorUid,
            record: context.record,
        }));
    }
    const executedToolIds = executedResults.map((r) => r.toolId);
    const recordsAccessed = executedResults.flatMap((r) => r.recordsAccessed);
    const deniedCount = decisions.filter((d) => d.decision === "DENY").length;
    // STEP 3 -- if nothing was permitted, refuse WITHOUT calling the provider. Sending a question with
    // no data would spend money to produce a guess, which is the outcome the answer contract forbids.
    if (executedResults.length === 0) {
        return {
            status: "NO_PERMITTED_DATA",
            text: assistantAnswer_1.INSUFFICIENT_PERMITTED_DATA,
            decisions, executedToolIds: [], recordsAccessed: [],
            usage: null, provider: null, model: null,
            latencyMs: deps.now() - started, correlationId, errorClass: null,
        };
    }
    // STEP 4 -- the first moment anything leaves EOS.
    const messages = assembleProviderPrompt({ context, executedResults, deniedCount });
    try {
        const result = await deps.provider.respond({
            messages,
            maxOutputTokens: deps.maxOutputTokens ?? 800,
            correlationId,
        });
        return {
            status: "ANSWERED",
            text: result.text,
            decisions, executedToolIds, recordsAccessed,
            usage: result.usage,
            provider: result.metadata.provider,
            model: result.metadata.model,
            latencyMs: deps.now() - started,
            correlationId, errorClass: null,
        };
    }
    catch (err) {
        // The provider failed. EOS did not. No hidden retry loop: a request that quietly retries for a
        // minute is indistinguishable to a user from a broken page, and hides the outage from telemetry.
        const code = err instanceof aiProvider_1.AiProviderError ? err.code : "UNKNOWN";
        return {
            status: "ASSISTANT_UNAVAILABLE",
            text: "The assistant is unavailable right now. Everything else in EOS is unaffected.",
            decisions, executedToolIds, recordsAccessed,
            usage: null,
            provider: deps.provider.metadata.provider,
            model: deps.provider.metadata.model,
            latencyMs: deps.now() - started,
            correlationId, errorClass: code,
        };
    }
}
//# sourceMappingURL=assistantGateway.js.map