// DASHBOARD TOOLS. Thin wrappers over `AssistantBusinessDataReader` -- ADR-015 above the line.
//
// No `firebase-admin` import, no Firestore type, no collection name anywhere in this file. Each tool
// asks the storage-neutral reader for a business answer and shapes it for the model; it does not know
// or care what is behind that reader today.
//
// Built as a factory over an injected reader, not a module-level singleton: `execute` receives only
// `{ companyId, actorUid, record }` (the fixed `AssistantToolExecutionInput` contract every surface
// shares), so the reader has to arrive by closure at registration time, from the composition root --
// the same place that decides whether a real reader exists at all.
import type { AssistantTool, AssistantToolExecutionInput, AssistantToolResult } from "./assistantToolRegistry";
import type { AssistantBusinessDataReader, AssistantBusinessScope } from "./assistantBusinessDataReader";

function scopeOf(input: AssistantToolExecutionInput): AssistantBusinessScope {
  return { tenantId: input.companyId, principalUid: input.actorUid };
}

export function buildDashboardTools(reader: AssistantBusinessDataReader): readonly AssistantTool[] {
  return [
    {
      id: "dashboard.serviceAttention",
      surfaces: ["DASHBOARD"],
      description: "Past-due and scheduling-conflict counts across the actor's governed service scope.",
      requires: ["workOrder.transition"],
      deniedMessage: "You do not have visibility into service scheduling attention.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const summary = await reader.getServiceAttentionSummary(scopeOf(input));
        return { toolId: "dashboard.serviceAttention", data: summary, recordsAccessed: [] };
      },
    },
    {
      id: "dashboard.reorderQueue",
      surfaces: ["DASHBOARD"],
      description: "Pending reorder requests waiting for review, oldest first.",
      requires: ["reorder.request.read.queue"],
      deniedMessage: "You do not have visibility into the reorder queue.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const items = await reader.getReorderQueuePreview(scopeOf(input), 10);
        return {
          toolId: "dashboard.reorderQueue",
          data: items,
          recordsAccessed: items.map((i) => ({ type: "reorderRequest", id: i.id })),
        };
      },
    },
    {
      id: "dashboard.workOrdersByStatus",
      surfaces: ["DASHBOARD"],
      description: "Recorded work order statuses, counted across the actor's governed scope.",
      requires: ["workOrder.transition"],
      deniedMessage: "You do not have visibility into work order status counts.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const rows = await reader.getWorkOrdersByStatus(scopeOf(input));
        return { toolId: "dashboard.workOrdersByStatus", data: rows, recordsAccessed: [] };
      },
    },
    {
      id: "dashboard.myGoals",
      surfaces: ["DASHBOARD"],
      description: "The actor's own individual performance goals and recorded actuals.",
      requires: ["performance.goal.read"],
      deniedMessage: "You do not have visibility into performance goals.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const goals = await reader.getMyPerformanceGoals(scopeOf(input));
        return { toolId: "dashboard.myGoals", data: goals, recordsAccessed: [] };
      },
    },
    {
      id: "dashboard.accountPortfolio",
      surfaces: ["DASHBOARD"],
      description: "Account counts by status across the actor's governed customer scope.",
      requires: ["customer.record.read"],
      deniedMessage: "You do not have visibility into the account portfolio.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const summary = await reader.getAccountPortfolioSummary(scopeOf(input));
        return { toolId: "dashboard.accountPortfolio", data: summary, recordsAccessed: [] };
      },
    },
  ];
}
