// THE GATEWAY. The single path from a question to an answer, and the place the ordering is enforced.
//
// ============================ THE PIPELINE, IN THIS ORDER ============================
//
//   context validation  -> reject cross-tenant / authority-shaped input
//   authority resolution-> EMPLOYEE-level union, intersected with what is ACTIVE here
//   tool planning       -> ALLOW/DENY decided with NO retrieval
//   tool execution      -> allowed tools ONLY
//   prompt assembly     -> permitted results ONLY
//   provider call       -> the first moment anything leaves EOS
//
// The order is the security property. Steps 2 and 3 complete before step 4 begins, so there is no
// interleaving in which a denied tool's data exists and then gets filtered out -- it is never
// retrieved. `assembleProviderPrompt` takes only executed results, so a denied tool's data is not
// merely excluded from the prompt: it is not in the process.
//
// PROVIDER FAILURE IS NOT EOS FAILURE. If the model is unreachable, this returns an unavailable
// result. It does not retry indefinitely, does not degrade authorization, and does not affect any
// governed workflow. The assistant is optional assistance and never a transactional dependency.
import type { AiProvider, AiUsage, AssistantMessage } from "./aiProvider";
import { AiProviderError } from "./aiProvider";
import type { AssistantContext } from "./assistantContext";
import type { AssistantTool, AssistantToolResult } from "./assistantToolRegistry";
import { AssistantToolRegistry } from "./assistantToolRegistry";
import type { EffectiveAuthority, ToolAuthorizationResult } from "./assistantAuthorization";
import { planToolExecution } from "./assistantAuthorization";
import { INSUFFICIENT_PERMITTED_DATA } from "./assistantAnswer";

export interface AssistantRequestOutcome {
  readonly status: "ANSWERED" | "NO_PERMITTED_DATA" | "ASSISTANT_UNAVAILABLE";
  readonly text: string;
  readonly decisions: readonly ToolAuthorizationResult[];
  readonly executedToolIds: readonly string[];
  readonly recordsAccessed: readonly { readonly type: string; readonly id: string }[];
  readonly usage: AiUsage | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly errorClass: string | null;
}

/**
 * The system instruction.
 *
 * Note what it is NOT doing: it is not asked to keep secrets, because nothing secret is in the
 * prompt. Everything here has already passed authorization. This governs TRUTHFULNESS, which the
 * ordering cannot enforce, and leaves CONFIDENTIALITY to the retrieval boundary, which prompt text
 * could never enforce.
 */
export const SYSTEM_INSTRUCTION = [
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
export function assembleProviderPrompt(args: {
  readonly context: AssistantContext;
  readonly executedResults: readonly AssistantToolResult[];
  readonly deniedCount: number;
}): readonly AssistantMessage[] {
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

  const messages: AssistantMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    { role: "system", content: situation },
    { role: "system", content: `EOS data available for this question:\n${facts}` },
  ];
  for (const turn of context.history) messages.push({ role: turn.role, content: turn.content });
  messages.push({ role: "user", content: context.question });
  return messages;
}

export interface HandleAssistantRequestDeps {
  readonly registry: AssistantToolRegistry;
  readonly provider: AiProvider;
  readonly authority: EffectiveAuthority;
  readonly now: () => number;
  readonly maxOutputTokens?: number;
}

export async function handleAssistantRequest(
  context: AssistantContext,
  correlationId: string,
  deps: HandleAssistantRequestDeps,
): Promise<AssistantRequestOutcome> {
  const started = deps.now();
  const candidates: readonly AssistantTool[] = deps.registry.forSurface(context.surface);

  // STEP 1 -- decide. No retrieval has happened and none can, because planToolExecution has no
  // access to an executor.
  const { allowed, decisions } = planToolExecution(candidates, deps.authority);

  // STEP 2 -- retrieve, allowed tools only.
  const executedResults: AssistantToolResult[] = [];
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
      text: INSUFFICIENT_PERMITTED_DATA,
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
  } catch (err) {
    // The provider failed. EOS did not. No hidden retry loop: a request that quietly retries for a
    // minute is indistinguishable to a user from a broken page, and hides the outage from telemetry.
    const code = err instanceof AiProviderError ? err.code : "UNKNOWN";
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
